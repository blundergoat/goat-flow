/**
 * Core state fragments for the dashboard Alpine app. dashboardMergeAppFragments stitches them into
 * one app object via descriptor merge (so getters and method `this` survive). These fragments seed
 * the injected audit report, selected project path, theme, per-session/terminal UI flags, and the
 * state used by projects, tasks, hooks, quality, and the skill evaluator. Order matters: fields here
 * must exist before later fragments' methods read them.
 */

/**
 * Build the core-state fragment: audit report, project path, theme, and session/terminal UI flags.
 * The returned object is one input to dashboardMergeAppFragments, not a standalone app; its fields
 * are the reactive baseline later fragments' getters and methods assume already exist.
 *
 * @param supportedAgents - agents the server reports as launchable, used to seed runner UI options
 * @param defaultRunner - runner pre-selected in the launcher until the user picks another
 * @returns the fragment object of initial state fields merged into the Alpine app
 */
function dashboardAppFragment01(
  supportedAgents: SupportedAgent[],
  defaultRunner: RunnerId,
): DashboardAppFragment {
  return {
    // --- Core state ---
    report: readInjectedReport(),

    projectPath: window.__GOAT_FLOW_DEFAULT_PATH__ ?? ".",

    dashboardVersion: window.__GOAT_FLOW_VERSION__ ?? "0.0.0",

    darkMode:
      localStorage.getItem("gf-dark") === "true" ||
      (!localStorage.getItem("gf-dark") &&
        window.matchMedia("(prefers-color-scheme: dark)").matches),

    auditing: false,

    toast: "",

    toastError: false,

    copyLabel: "Copy",

    srAnnouncement: "",

    activeView: "home",

    sideNavCollapsed: localStorage.getItem("gf-side-nav-collapsed") === "true",

    supportedAgents,

    installedAgents: [] as AgentInfo[],

    allAgents: [] as AgentInfo[],

    agentsLoaded: false,

    get agentSkeletonList(): SupportedAgent[] {
      return this.installedAgents.length === 0 && !this.agentsLoaded
        ? this.supportedAgents
        : [];
    },

    activeRunner: defaultRunner,

    userRole: "",

    workspacePanel: "terminal",

    sessionsCollapsed: localStorage.getItem("gf-sessions-collapsed") === "true",

    otherCollapsed: false,

    confirmEndSessionId: null as string | null,

    _workspacePoll: null as ReturnType<typeof setInterval> | null,

    /** Optional user-supplied display titles keyed by stable project identity.
     *  Persisted alongside paths/favorites in .goat-flow/dashboard-state.json so
     *  titles follow repos across path moves when the server can resolve identity. */
    projectTitles: {},

    projectIdentities: {},

    editingProjectTitle: false,

    projectTitleDraft: "",

    /** Resolve the stable dashboard-state key for a path, falling back for older payloads. */
    projectKeyFor(path: string): string {
      return this.projectIdentities[path] ?? path;
    },

    /** Resolve the display name for a project path, preferring a user override. */
    displayNameFor(path: string): string {
      const identityKey = this.projectKeyFor(path);
      const override =
        this.projectTitles[identityKey] ?? this.projectTitles[path];
      if (typeof override === "string" && override.length > 0) return override;
      return getProjectDisplayName(path);
    },

    /** Return the current project name. */
    get projectName(): string {
      return this.displayNameFor(this.projectPath);
    },

    /** Keep a stable accent color per project so quick switches stay visually anchored.
     *  Hash the path (not the display name) so renaming doesn't change the accent. */
    get projectColor(): string {
      const key = this.projectPath;
      let hash = 0;
      for (let i = 0; i < key.length; i++)
        hash = key.charCodeAt(i) + ((hash << 5) - hash);
      const hue = Math.abs(hash) % 360;
      return `hsl(${hue}, 60%, 50%)`;
    },

    showBrowser: false,

    browserCurrent: "",

    browserParent: "",

    browserDirs: [] as BrowseDir[],

    lastAuditTime: null as Date | null,

    auditCached: false,

    // --- Audit detail state ---
    selectedFixes: [] as string[],

    fixCopyLabel: "Copy fixes",

    reviewsLoading: false,

    reviewsError: "",

    reviewsArtifact: null as SecurityReviewArtifact | null,

    // --- Terminal state ---
    terminalAvailable: false,

    platformHint: null as string | null,

    idleTimeoutMinutes: 480,

    terminalSessionCount: 0,

    serverSessions: [] as ServerSessionInfo[],

    serverMaxSessions: 10,

    sessionTitles: readStoredStringMap("goat-flow-session-titles"),

    recentTerminalSessions: [] as ServerSessionInfo[],

    showMaxSessionsModal: false,

    sessions: [] as LocalSession[],

    activeSessionId: null as string | null,

    selectedPreset: null as Preset | null,

    promptRunStates: {},

    launching: false,

    availableRunners: [] as RunnerId[],

    // Project switches intentionally preserve backend sessions so returning to a workspace
    // can reattach instead of spawning a fresh agent process. Each project keeps the full
    // list of its bound sessions plus the id that was active at detach time.
    _projectSessions: {},

    _projectActiveSession: {},

    _terminalRefs: {},

    _xtermLoaded: false,

    // detachTerminal() flips this while it closes browser-side sockets so ws.onclose only
    // marks sessions ended when the runner actually exits on the backend.
    _detaching: false,

    // Drag-drop image upload state for the active terminal pane.
    terminalDragActive: false,

    terminalUploading: false,

    _terminalDragDepth: 0,
  };
}

/**
 * Build the active-session and session-list fragment: getters that derive the currently-focused
 * terminal session from `sessions`/`activeSessionId` plus the grouped server-session lists the UI
 * renders. These are intentional getters rather than methods, because they must recompute reactively
 * from raw state and the merge step preserves them (a plain spread would flatten a getter to its value).
 * The list getters hold a stable ordering contract the templates depend on: current-project
 * sessions sort newest-first, and other-project sessions sort by project name then newest-first, so
 * the rendered order is deterministic across re-renders rather than reflecting array insertion order.
 * Merged into the app by dashboardMergeAppFragments.
 */
function dashboardAppFragment02(): DashboardAppFragment {
  return {
    /** Return the active local session. */
    get _activeSession(): LocalSession | null {
      return this.sessions.find((s) => s.id === this.activeSessionId) || null;
    },

    /** Return the active terminal session ID. */
    get terminalSessionId(): string | null {
      return this._activeSession?.id ?? null;
    },

    /** Return whether the active terminal is connected. */
    get terminalConnected(): boolean {
      return this._activeSession?.connected ?? false;
    },

    /** Return whether the active terminal has ended. */
    get terminalEnded(): boolean {
      return this._activeSession?.ended ?? false;
    },

    /** Return whether the active terminal is detached from a live backend session. */
    get terminalDetached(): boolean {
      const session = this._activeSession;
      if (!session || session.ended || session.connected) return false;
      return this.serverSessions.some(
        (s) => s.id === session.id && s.status === "active",
      );
    },

    /** Return whether the active terminal appears to be awaiting a user choice. */
    get terminalAwaitingInput(): boolean {
      return this._activeSession?.awaitingInput === true;
    },

    /**
     * True when the active terminal is connected but the runner has not
     * produced any output yet. Surfaces the gap between WebSocket attach
     * (~100 ms) and Claude Code's first PTY paint (~5 s observed locally) so
     * users see in-place progress instead of a silent terminal.
     */
    get terminalWaitingForRunner(): boolean {
      const session = this._activeSession;
      if (!session) return false;
      if (!session.connected || session.ended) return false;
      if (session.awaitingInput) return false;
      if (session.loadingPhase === "ready" || session.loadingPhase === "error")
        return false;
      const tail = session.outputTail ?? "";
      return tail.length === 0;
    },

    /** Return the active terminal loading-overlay message. */
    terminalLoadingMessage(session: LocalSession | null): string {
      if (!session) return "";
      if (session.loadingPhase === "error") {
        return `Failed to start: ${session.loadingError || "Could not start session."}`;
      }
      if (session.loadingPhase === "loading") {
        return "Connected. Loading shell...";
      }
      return `Spinning up ${session.runner} session...`;
    },

    /** Return the active terminal age label. */
    get terminalAge(): string {
      return this._activeSession?.age ?? "";
    },

    /** Return the last run prompt label. */
    get lastRunPrompt(): string | null {
      return this._activeSession
        ? this.sessionTitleFor(this._activeSession)
        : null;
    },

    /** Return the last run agent ID. */
    get lastRunAgent(): RunnerId | null {
      return this._activeSession?.runner ?? null;
    },

    /** Return the active terminal WebSocket reference. */
    get _terminalWs(): WebSocket | undefined {
      return this._terminalRefs[this.activeSessionId ?? ""]?.ws;
    },

    /** Return the active xterm instance. */
    get _terminalXterm(): XTermInstance | undefined {
      return this._terminalRefs[this.activeSessionId ?? ""]?.xterm;
    },

    /** Sessions whose project matches the current projectPath, newest first. */
    get currentProjectSessions(): ServerSessionInfo[] {
      return this.serverSessions
        .filter((s) => s.projectPath === this.projectPath)
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
    },

    /** Sessions for other projects, grouped by project name then newest first. */
    get otherProjectSessions(): ServerSessionInfo[] {
      return this.serverSessions
        .filter((s) => s.projectPath !== this.projectPath)
        .sort((a, b) => {
          const byName = (a.projectName || "").localeCompare(
            b.projectName || "",
          );
          if (byName !== 0) return byName;
          return (
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
        });
    },

    /** Active sessions for the current project; valid targets for `Send to active`. */
    get sendTargetsInCurrentProject(): ServerSessionInfo[] {
      return this.serverSessions.filter(
        (s) => s.projectPath === this.projectPath && s.status === "active",
      );
    },

    /** Whether a backend session is currently bound to a local xterm instance. */
    isSessionBoundLocally(id: string): boolean {
      return this.sessions.some(
        (s) => s.id === id && s.ended !== true && s.connected === true,
      );
    },

    // --- Projects state ---
    projectsList: [] as ProjectEntry[],

    projectsAuditing: false,

    showAddProject: false,

    projectsSortKey: "name",

    projectsSortAsc: true,

    newProjectPath: "",

    // --- Tasks state ---
    tasksState: null as TaskState | null,

    tasksLoading: false,

    tasksActivePlanSaving: null as string | null,

    tasksError: "",

    selectedTaskPlan: null as string | null,

    // --- Hooks state ---
    hooksState: [] as HookState[],

    hooksLoading: false,

    hooksError: "",

    hookSavingId: null as string | null,

    hooksFilter: "all",

    hooksSearch: "",
  };
}

function dashboardAppFragment03(
  supportedAgents: SupportedAgent[],
  defaultRunner: RunnerId,
  defaultSetupAgents: SetupData["agents"],
): DashboardAppFragment {
  return {
    // --- Quality state ---
    qualityAgent: defaultRunner,

    selectedQualityModeId: "agent-setup",

    qualityLoading: false,

    qualityResult: null as QualityResult | null,

    qualityCopyLabel: "Copy",

    qualityHistoryLoading: false,

    qualityHistoryRows: [] as QualityHistoryRow[],

    qualityHistoryLatest: null as QualityHistoryLatest | null,

    qualityHistoryWarnings: [] as string[],

    _qualityHistoryTimer: null as ReturnType<typeof setTimeout> | null,

    homeQualityLoading: false,

    homeQualityLatest: null as QualityHistoryLatest | null,

    // --- Skill quality state ---
    skillQualityArtifacts: [] as SkillQualityArtifact[],

    skillQualitySelectedId: null as string | null,

    skillQualityReport: null as SkillQualityReport | null,

    skillQualityLoading: false,

    skillQualityAbortController: null as AbortController | null,

    /** Cache of per-artifact reports so the sidebar can show a grade for each
     *  skill without waiting on per-click fetches. Populated by prefetchSkillReports
     *  after loadSkillQualityInventory. */
    skillQualityReports: {},

    skillQualityAuditedAt: null as number | null,

    skillQualityPrefetching: false,

    skillQualityPrefetchGeneration: 0,

    // --- Skill evaluator page state ---
    skillEvaluatorName: "",

    skillEvaluatorContent: "",

    skillEvaluatorFiles: [] as { name: string; content: string }[],

    skillEvaluatorDragActive: false,

    skillEvaluatorResult: null as SkillEvaluateResult | null,

    skillEvaluatorLoading: false,

    skillEvaluatorError: null as string | null,

    skillEvaluatorReportCopied: false,

    _skillEvaluatorReportCopiedTimer: null as ReturnType<
      typeof setTimeout
    > | null,

    /** Per-metric collapse state for the evaluator result tip groups. */
    skillEvaluatorTipCollapsed: {},

    /** Resolve the current display name for one supported agent id. */
    agentName(agentId: RunnerId): string {
      return (
        this.supportedAgents.find((agent) => agent.id === agentId)?.name ??
        agentId
      );
    },

    /** Return the audit-based status shown on each Setup page agent card. */
    setupAgentStatus(agentId: RunnerId): { label: string; color: string } {
      if (!this.report) return { label: "Not audited", color: "#52525b" };
      const score = this.report.agentScores.find(
        (score: AgentScore) => score.id === agentId,
      );
      if (!score) return { label: "Not audited", color: "#52525b" };
      const agentPass = score.agent.status === "pass";
      const harnessPass = !score.harness || score.harness.status === "pass";
      if (agentPass && harnessPass)
        return { label: "Passing", color: "var(--status-pass)" };
      if (!agentPass) return { label: "Setup failing", color: "#f87171" };
      return { label: "Harness failing", color: "#fbbf24" };
    },

    /** Convert one audit scope into a percentage, including score-only maturity checks. */
    auditScopePercent(scope: AuditScope | null | undefined): number | null {
      const checks = scope?.checks ?? [];
      const scored = checks.filter((check) => check.status !== "skipped");
      if (scored.length === 0) return null;
      const passed = scored.filter((check) => check.status === "pass").length;
      return Math.round((passed / scored.length) * 100);
    },

    /** Readiness for the Setup page target card: setup + selected agent + harness. */
    setupTargetScore(agentId: RunnerId): number | null {
      if (!this.report) return null;
      const score = this.report.agentScores.find(
        (score: AgentScore) => score.id === agentId,
      );
      if (!score) return null;
      const parts = [
        this.auditScopePercent(this.report.scopes.setup),
        this.auditScopePercent(score.agent),
        this.auditScopePercent(score.harness),
      ].filter(
        (value): value is number => value !== null && !Number.isNaN(value),
      );
      if (parts.length === 0) return null;
      return Math.round(
        parts.reduce((total, value) => total + value, 0) / parts.length,
      );
    },

    /** Convert the selected setup target's readiness score into a letter grade. */
    setupTargetGrade(agentId: RunnerId): string {
      const score = this.setupTargetScore(agentId);
      if (score === null) return "-";
      if (score >= 90) return "A";
      if (score >= 80) return "B";
      if (score >= 70) return "C";
      if (score >= 60) return "D";
      return "F";
    },

    /** Format the selected setup target's readiness score for the target card. */
    setupTargetPercent(agentId: RunnerId): string {
      const score = this.setupTargetScore(agentId);
      return score === null ? "Not audited" : `${score}%`;
    },

    // --- Setup state ---
    setupDetecting: false,

    setupSelectedAgent: defaultRunner,

    setupData: {
      languages: [],
      frameworks: [],
      commands: { ...DEFAULT_SETUP_COMMANDS },
      agents: { ...defaultSetupAgents },
      existing: { ...DEFAULT_EXISTING_ARTIFACTS },
      nonGoatFlow: [],
    },

    setupGenerating: false,

    setupOutputs: {},

    _setupOutputProjectPath: null as string | null,

    _setupPromptRequestKey: null as string | null,

    _setupPromptTimer: null as ReturnType<typeof setTimeout> | null,

    // --- Launcher state ---
    presets: readInjectedPresets(),

    customPrompts: [] as CustomPrompt[],
  };
}
