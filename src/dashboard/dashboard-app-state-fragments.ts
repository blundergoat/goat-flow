/**
 * Set the dashboard's initial selections, empty results, and loading flags before its feature methods run.
 *
 * Derived getters keep terminal status, project labels, and setup scores aligned with the user's current selection.
 * Merge these fragments with dashboardMergeAppFragments so those getters remain reactive as requests complete.
 */

/**
 * Initialize the selected project, saved theme, audit result, and terminal controls when the dashboard opens.
 * Merge this state before feature methods run so they share the same reactive selections and loading flags.
 *
 * @param supportedAgents - agents the server reports as launchable, used to seed runner UI options
 * @param defaultRunner - runner pre-selected in the launcher until the user picks another
 * @returns the fragment object of initial state fields merged into the Alpine app
 */
function dashboardCoreStateFragment(
  supportedAgents: SupportedAgent[],
  defaultRunner: RunnerId,
): DashboardAppFragment {
  return {
    // --- Core state ---
    report: readInjectedReport(),

    // A shell without an injected project starts at the server's current directory.
    projectPath: window.__GOAT_FLOW_DEFAULT_PATH__ ?? ".",

    // An unversioned shell displays the explicit placeholder until a versioned build is served.
    dashboardVersion: window.__GOAT_FLOW_VERSION__ ?? "0.0.0",

    // A saved theme choice wins; first-time visitors inherit their operating system preference.
    darkMode:
      localStorage.getItem("gf-dark") === "true" ||
      (!localStorage.getItem("gf-dark") &&
        window.matchMedia("(prefers-color-scheme: dark)").matches),

    auditing: false,

    indexRegenerating: false,

    indexRegenerateError: "",

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

    // Show placeholder agent cards during first discovery; an empty result after loading needs no skeletons.
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

    // Keep user-chosen project titles with stable identities so a resolved path move can retain the displayed name.
    projectTitles: {},

    projectIdentities: {},

    editingProjectTitle: false,

    projectTitleDraft: "",

    // Find the saved-project key; older payloads without identities continue using the project path.
    projectKeyFor(path: string): string {
      return this.projectIdentities[path] ?? path;
    },

    // Show the user's saved project title when available, otherwise use the directory name.
    displayNameFor(path: string): string {
      const identityKey = this.projectKeyFor(path);
      const override =
        this.projectTitles[identityKey] ?? this.projectTitles[path];
      // An empty or invalid saved title leaves the directory name visible instead of a blank project label.
      if (typeof override === "string" && override.length > 0) return override;
      return getProjectDisplayName(path);
    },

    // Keep the current project heading in sync with its saved title or directory name.
    get projectName(): string {
      return this.displayNameFor(this.projectPath);
    },

    // Keep the project accent tied to its path so changing the displayed title preserves its familiar color.
    get projectColor(): string {
      const key = this.projectPath;
      let hash = 0;
      // Every path character contributes to the stable accent used when returning to this project.
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

    // Returning to a project restores its bound sessions and selected tab without starting another backend agent.
    _projectSessions: {},

    _projectActiveSession: {},

    _terminalRefs: {},

    _xtermLoaded: false,

    // Closing browser sockets during a project switch must not mark the still-running backend sessions as ended.
    _detaching: false,

    // Drag-drop image upload state for the active terminal pane.
    terminalDragActive: false,

    terminalUploading: false,

    _terminalDragDepth: 0,
  };
}

// Find the selected terminal tab; null means no local session is available for its controls.
function activeTerminalSession(
  sessions: LocalSession[],
  activeSessionId: string | null,
): LocalSession | null {
  // With no tab selected, hide session-specific controls instead of choosing another session implicitly.
  if (activeSessionId === null) return null;
  // A tab removed since selection has no local session left to operate on.
  return sessions.find((session) => session.id === activeSessionId) ?? null;
}

// Return true only when a browser tab is disconnected from a still-live backend session.
function isTerminalDetached(
  session: LocalSession | null,
  serverSessions: ServerSessionInfo[],
): boolean {
  // Missing, ended, or already connected tabs need no reconnect affordance.
  if (!session || session.ended || session.connected) return false;
  return serverSessions.some(
    (serverSession) =>
      serverSession.id === session.id && serverSession.status === "active",
  );
}

/**
 * Show startup progress only while a connected runner has produced no output.
 * Ended sessions, input prompts, and known ready or error states must not be covered by the loading overlay.
 */
function isTerminalWaitingForRunner(session: LocalSession | null): boolean {
  // No selected terminal means there is no startup work to show.
  if (!session) return false;
  // A disconnected or finished session is not waiting for first output from a live connection.
  if (!session.connected || session.ended) return false;
  // A runner asking the user a question needs its prompt exposed, not covered by loading progress.
  if (session.awaitingInput) return false;
  // Completed startup and explicit failures each have their own visible state.
  if (session.loadingPhase === "ready" || session.loadingPhase === "error")
    return false;
  // Legacy sessions without captured output are treated as having no first output yet.
  const tail = session.outputTail ?? "";
  return tail.length === 0;
}

// Choose startup progress or failure text for a terminal; no session produces no overlay message.
function terminalLoadingMessageFor(session: LocalSession | null): string {
  // Closing the selected tab removes its startup message.
  if (!session) return "";
  // A failed launch displays its recorded cause, with a usable message when no cause was supplied.
  if (session.loadingPhase === "error") {
    return `Failed to start: ${session.loadingError || "Could not start session."}`;
  }
  // The socket is attached, but shell startup still needs progress text.
  if (session.loadingPhase === "loading") {
    return "Connected. Loading shell...";
  }
  return `Spinning up ${session.runner} session...`;
}

// Find the selected tab's transport handles; undefined means its browser terminal has not been attached.
function terminalRefFor(
  refs: Record<string, TerminalRefs>,
  activeSessionId: string | null,
): TerminalRefs | undefined {
  return refs[activeSessionId ?? ""];
}

/**
 * Expose the selected terminal's connection, completion, and input state to workspace controls.
 * Keep these as getters so tab switches recompute the displayed state through the fragment merge.
 */
function dashboardActiveTerminalSessionFragment(): DashboardAppFragment {
  return {
    // Supply the selected tab's local state; null leaves session-specific controls inactive.
    get _activeSession(): LocalSession | null {
      return activeTerminalSession(this.sessions, this.activeSessionId);
    },

    // Identify the selected terminal for actions; null means the user has no local session selected.
    get terminalSessionId(): string | null {
      return this._activeSession?.id ?? null;
    },

    // Enable connected-session controls only while the selected tab has a live connection.
    get terminalConnected(): boolean {
      return this._activeSession?.connected ?? false;
    },

    // Show ended-session actions only for a selected terminal whose runner has finished.
    get terminalEnded(): boolean {
      return this._activeSession?.ended ?? false;
    },

    // Offer reconnect context when the selected tab is disconnected but its backend runner is still active.
    get terminalDetached(): boolean {
      return isTerminalDetached(this._activeSession, this.serverSessions);
    },

    // Expose a detected runner question so the workspace can ask the user to respond.
    get terminalAwaitingInput(): boolean {
      return this._activeSession?.awaitingInput === true;
    },
  };
}

// Build active terminal loading, title, and transport getters.
function dashboardTerminalStatusAccessorsFragment(): DashboardAppFragment {
  return {
    // Keep startup progress visible after connection until the runner produces output or needs a user response.
    get terminalWaitingForRunner(): boolean {
      return isTerminalWaitingForRunner(this._activeSession);
    },

    // Display startup progress for the supplied terminal; null removes the message.
    terminalLoadingMessage(session: LocalSession | null): string {
      return terminalLoadingMessageFor(session);
    },

    // Show the selected terminal's age; an absent session leaves the label empty.
    get terminalAge(): string {
      return this._activeSession?.age ?? "";
    },

    // Show the selected session's title or prompt label; null means no session is selected.
    get lastRunPrompt(): string | null {
      return this._activeSession
        ? this.sessionTitleFor(this._activeSession)
        : null;
    },

    // Identify the selected session's runner for its controls; null means there is no selected session.
    get lastRunAgent(): RunnerId | null {
      return this._activeSession?.runner ?? null;
    },

    // Give terminal actions the selected tab's socket; undefined means that tab has no attached transport.
    get _terminalWs(): WebSocket | undefined {
      return terminalRefFor(this._terminalRefs, this.activeSessionId)?.ws;
    },

    // Give workspace actions the selected browser terminal; undefined means its view has not been created.
    get _terminalXterm(): XTermInstance | undefined {
      return terminalRefFor(this._terminalRefs, this.activeSessionId)?.xterm;
    },
  };
}

/**
 * Initialize Projects, Plans, and Hooks state alongside the workspace session lists.
 * Keep the session ordering contract: current project newest first; other projects by name, then newest first.
 */
function dashboardWorkspaceCollectionsStateFragment(): DashboardAppFragment {
  return {
    // Sessions whose project matches the current projectPath, newest first.
    get currentProjectSessions(): ServerSessionInfo[] {
      return this.serverSessions
        .filter((s) => s.projectPath === this.projectPath)
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
    },

    // Sessions for other projects, grouped by project name then newest first.
    get otherProjectSessions(): ServerSessionInfo[] {
      return this.serverSessions
        .filter((s) => s.projectPath !== this.projectPath)
        .sort((a, b) => {
          const byName = (a.projectName || "").localeCompare(
            b.projectName || "",
          );
          // Sessions from different projects stay grouped by project label before their creation times are compared.
          if (byName !== 0) return byName;
          return (
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
        });
    },

    // Active sessions for the current project; valid targets for `Send to active`.
    get sendTargetsInCurrentProject(): ServerSessionInfo[] {
      return this.serverSessions.filter(
        (s) => s.projectPath === this.projectPath && s.status === "active",
      );
    },

    // Whether a backend session is currently bound to a local xterm instance.
    isSessionBoundLocally(id: string): boolean {
      return this.sessions.some(
        (s) => s.id === id && s.ended !== true && s.connected === true,
      );
    },

    // --- Projects state ---
    projectsList: [] as ProjectEntry[],

    projectsRefreshing: false,

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

/**
 * Seed the Quality and Setup views with the state they open on, before any request has returned.
 *
 * @param supportedAgents - agents this build knows about, shown in the runner pickers
 * @param defaultRunner - runner selected until the user picks another
 * @param defaultSetupAgents - setup rows rendered before the first audit response arrives
 * @returns the fragment merged into the dashboard app
 */
function dashboardQualitySetupStateFragment(
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

    // Cache prefetched skill reports so sidebar grades are available before the user opens each skill.
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

    // Per-metric collapse state for the evaluator result tip groups.
    skillEvaluatorTipCollapsed: {},

    // Show the runner's supported display name, falling back to its ID when metadata is unavailable.
    agentName(agentId: RunnerId): string {
      return (
        this.supportedAgents.find((agent) => agent.id === agentId)?.name ??
        agentId
      );
    },

    // Return the audit-based status shown on each Setup page agent card.
    setupAgentStatus(agentId: RunnerId): { label: string; color: string } {
      // No audit report means the Setup card has no result to classify.
      if (!this.report) return { label: "Not audited", color: "#52525b" };
      const score = this.report.agentScores.find(
        (score: AgentScore) => score.id === agentId,
      );
      // An audit without this runner cannot establish whether its setup is passing.
      if (!score) return { label: "Not audited", color: "#52525b" };
      const agentPass = score.agent.status === "pass";
      // An omitted harness scope adds no harness failure to the runner card.
      const harnessPass = !score.harness || score.harness.status === "pass";
      // The card is passing only when neither the agent setup nor its available harness scope fails.
      if (agentPass && harnessPass)
        return { label: "Passing", color: "var(--status-pass)" };
      // Agent setup failure takes priority over a harness failure in the card label.
      if (!agentPass) return { label: "Setup failing", color: "#f87171" };
      return { label: "Harness failing", color: "#fbbf24" };
    },

    // Score applicable checks for the Setup card; null means the scope has no scored checks, not a zero-percent result.
    auditScopePercent(scope: AuditScope | null | undefined): number | null {
      // An absent scope contributes no checks to setup readiness.
      const checks = scope?.checks ?? [];
      const scored = checks.filter((check) => check.status !== "skipped");
      // A missing scope or all-skipped checks must display no score rather than a failing zero.
      if (scored.length === 0) return null;
      const passed = scored.filter((check) => check.status === "pass").length;
      return Math.round((passed / scored.length) * 100);
    },

    // Average available setup, runner, and harness percentages for the target card; null means no readiness score is available.
    setupTargetScore(agentId: RunnerId): number | null {
      // Before auditing, the target card must not imply a measured readiness score.
      if (!this.report) return null;
      const score = this.report.agentScores.find(
        (score: AgentScore) => score.id === agentId,
      );
      // A report for other runners cannot supply readiness for the runner the user selected.
      if (!score) return null;
      const parts = [
        this.auditScopePercent(this.report.scopes.setup),
        this.auditScopePercent(score.agent),
        this.auditScopePercent(score.harness),
      ].filter(
        (value): value is number => value !== null && !Number.isNaN(value),
      );
      // When every scope is absent or unscored, the target remains unaudited.
      if (parts.length === 0) return null;
      return Math.round(
        parts.reduce((total, value) => total + value, 0) / parts.length,
      );
    },

    // Convert the selected setup target's readiness score into a letter grade.
    setupTargetGrade(agentId: RunnerId): string {
      const score = this.setupTargetScore(agentId);
      // A missing readiness score gets a placeholder, keeping an unaudited target distinct from a failing grade.
      if (score === null) return "-";
      // Scores in the highest ten-point band receive the target card's top grade.
      if (score >= 90) return "A";
      // The next ten-point band is the card's B grade.
      if (score >= 80) return "B";
      // A score in the seventies maps to the card's C grade.
      if (score >= 70) return "C";
      // Scores in the sixties receive D; lower scores fall through to the card's F grade.
      if (score >= 60) return "D";
      return "F";
    },

    // Format the selected setup target's readiness score for the target card.
    setupTargetPercent(agentId: RunnerId): string {
      const score = this.setupTargetScore(agentId);
      // Preserve the unaudited label until an actual readiness percentage is available.
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
