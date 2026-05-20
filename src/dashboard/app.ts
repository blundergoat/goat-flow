/**
 * Browser-side Alpine.js data model for the GOAT Flow dashboard.
 * This stays as a classic script because the dashboard shell loads it with a
 * plain `<script>` tag rather than an ES module import.
 */

type ProjectSortKey = "name" | "state" | "action" | "details";

/** Alpine.js data factory for the dashboard shell. */
function app() {
  const supportedAgents = readInjectedSupportedAgents();
  const defaultRunner = supportedAgents[0]?.id ?? "claude";
  const defaultSetupAgents = buildDefaultSetupAgents(
    supportedAgents,
    defaultRunner,
  );
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
    projectTitles: {} as Record<string, string>,
    projectIdentities: {} as Record<string, string>,
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
    promptRunStates: {} as Record<string, string>,
    launching: false,
    availableRunners: [] as RunnerId[],
    // Project switches intentionally preserve backend sessions so returning to a workspace
    // can reattach instead of spawning a fresh agent process. Each project keeps the full
    // list of its bound sessions plus the id that was active at detach time.
    _projectSessions: {} as Record<string, SavedSession[]>,
    _projectActiveSession: {} as Record<string, string>,
    _terminalRefs: {} as Record<string, TerminalRefs>,
    _xtermLoaded: false,
    // detachTerminal() flips this while it closes browser-side sockets so ws.onclose only
    // marks sessions ended when the runner actually exits on the backend.
    _detaching: false,
    // Drag-drop image upload state for the active terminal pane.
    terminalDragActive: false,
    terminalUploading: false,
    _terminalDragDepth: 0,
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
     * (~100 ms) and Claude Code's first PTY paint (~5 s observed in M01) so
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
    projectsSortKey: "name" as ProjectSortKey,
    projectsSortAsc: true,
    newProjectPath: "",

    // --- Tasks state ---
    tasksState: null as TaskState | null,
    tasksLoading: false,
    tasksActivePlanSaving: null as string | null,
    tasksError: "",
    selectedTaskPlan: null as string | null,

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
    skillQualityReports: {} as Record<string, SkillQualityReport>,
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
    skillEvaluatorTipCollapsed: {} as Record<string, boolean>,

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
      const score = this.report.agentScores.find((s) => s.id === agentId);
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
      const score = this.report.agentScores.find((s) => s.id === agentId);
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
    setupTargetGrade(agentId: RunnerId): string {
      const score = this.setupTargetScore(agentId);
      if (score === null) return "-";
      if (score >= 90) return "A";
      if (score >= 80) return "B";
      if (score >= 70) return "C";
      if (score >= 60) return "D";
      return "F";
    },
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
    } as SetupData,
    setupGenerating: false,
    setupOutputs: {} as Record<string, string>,
    _setupOutputProjectPath: null as string | null,
    _setupPromptTimer: null as ReturnType<typeof setTimeout> | null,

    // --- Launcher state ---
    presets: readInjectedPresets(),
    customPrompts: [] as CustomPrompt[],
    showCustomPromptEditor: false,
    editingCustomPromptId: null as string | null,
    customPromptDraft: dashboardDefaultCustomPromptDraft(),
    customPromptSurfaceDraft: "",
    customPromptSubmitAttempted: false,
    showPromptStartPicker: false,
    customPromptStartId: "",
    presetFilter: "all",
    presetSearch: "",
    presetFavorites: readStoredStringArray("goat-flow-preset-favorites"),
    /** Toggle a preset favorite state and persist the combined dashboard state. */
    toggleFavorite(id: string) {
      dashboardToggleFavorite(this, id);
    },
    /** Check whether a preset is marked as a favorite. */
    isFavorite(id: string): boolean {
      return dashboardIsFavorite(this, id);
    },
    /** Select a prompt row and show its preview, leaving custom edit mode. */
    selectPreset(preset: Preset) {
      this.selectedPreset = preset;
      this.showCustomPromptEditor = false;
      this.editingCustomPromptId = null;
      this.customPromptSubmitAttempted = false;
      this.showPromptStartPicker = false;
    },
    /** Move the preview selection up (-1) or down (1) in screen order, with wrap. */
    selectPresetByOffset(delta: number) {
      dashboardSelectPresetByOffset(this, delta);
      if (this.selectedPreset) {
        this.showCustomPromptEditor = false;
        this.editingCustomPromptId = null;
        this.customPromptSubmitAttempted = false;
        this.showPromptStartPicker = false;
      }
    },
    /** Return the preset category filters. */
    get presetCats(): PresetCategory[] {
      return dashboardPresetCats(this);
    },
    /** Compact prerequisite/fit badges for a preset row or detail view. */
    presetBadges(preset: Preset): PresetBadge[] {
      return dashboardPresetBadges(preset);
    },
    /** Route chip label for a prompt card or detail view. */
    presetRouteLabel(preset: Preset): string {
      return dashboardPresetRouteLabel(preset);
    },
    /** Left-edge category accent for a prompt card. */
    presetCategoryAccent(preset: Preset): string {
      return dashboardPresetCategoryAccent(preset);
    },
    /** Built-in presets plus local browser custom prompts. */
    get allPresets(): Preset[] {
      return dashboardAllPresets(this);
    },
    /**
     * Favorites stay pinned to the top unless the user explicitly switches into
     * the favorites-only filter, which keeps mixed browsing fast on large lists.
     */
    get filteredPresets(): Preset[] {
      return dashboardFilteredPresets(this);
    },
    /** Presets grouped by category for the Prompts page grouped rendering. */
    get presetsByCategory(): Array<{
      id: string;
      label: string;
      items: Preset[];
    }> {
      return dashboardPresetsByCategory(this);
    },
    /**
     * Unified sequence of entries for the Prompts page list: inserts category
     * headers before each group in grouped mode, falls back to flat rows
     * otherwise. Rendered with a single `template x-for` in prompts.html.
     */
    get renderedPresetEntries(): Array<
      | { kind: "header"; id: string; label: string }
      | { kind: "row"; preset: Preset }
    > {
      return dashboardRenderedPresetEntries(this);
    },
    /**
     * Flat list of preset IDs in screen order for keyboard nav. Uses grouped
     * order when the list is grouped (filter=all + no search); otherwise
     * falls back to filteredPresets order.
     */
    get flatPresetOrder(): string[] {
      return dashboardFlatPresetOrder(this);
    },
    /**
     * Escaped, optionally search-highlighted HTML for the prompt preview.
     * Escapes user-facing content before injecting <mark> tags so the preview
     * stays safe when rendered via x-html.
     */
    get highlightedPromptHtml(): string {
      return dashboardHighlightedPromptHtml(this);
    },
    /** Adapt a preset prompt to the syntax expected by the selected runner. */
    adaptPrompt(prompt: string, runner?: RunnerId): string {
      return dashboardAdaptPrompt(this, prompt, runner);
    },
    /** Copy a preset prompt after applying runner-specific syntax tweaks. */
    copyPreset(prompt: string) {
      dashboardCopyPreset(this, prompt);
    },
    /** Return custom prompt route options with descriptions. */
    customPromptRouteOptions(): CustomPromptRouteOption[] {
      return dashboardCustomPromptRouteOptions();
    },
    /** Return the selected custom prompt route metadata. */
    selectedCustomPromptRoute(): CustomPromptRouteOption {
      return dashboardSelectedCustomPromptRoute(this.customPromptDraft);
    },
    /** Return grouped custom prompt flag metadata. */
    customPromptFlagGroups(): CustomPromptFlagGroup[] {
      return dashboardCustomPromptFlagGroups();
    },
    /** Check whether a custom prompt flag should be disabled. */
    customPromptFlagDisabled(flag: CustomPromptFlagOption): boolean {
      return (
        flag.field === "globalSafe" &&
        this.customPromptDraft.requiresGoatFlowInstall
      );
    },
    /** Keep Global safe false when a prompt requires target goat-flow install. */
    syncCustomPromptFlag(flag: CustomPromptFlagOption) {
      if (
        flag.field === "requiresGoatFlowInstall" &&
        this.customPromptDraft.requiresGoatFlowInstall
      ) {
        this.customPromptDraft.globalSafe = false;
      }
    },
    /** Return validation errors for the current custom prompt draft. */
    customPromptErrors(): CustomPromptValidationError[] {
      return dashboardValidateCustomPromptDraftDetails(this);
    },
    /** Return the first validation error for one draft field. */
    customPromptFieldError(field: string): string {
      return dashboardCustomPromptFieldError(this, field);
    },
    /** Return non-blocking prompt-body guidance. */
    customPromptWarning(): string {
      return dashboardCustomPromptPromptWarning(this);
    },
    /** Return the current target surface tags. */
    customPromptSurfaceTags(): string[] {
      return dashboardCustomPromptSurfaceTags(this);
    },
    /** Return available target surface suggestions. */
    customPromptSurfaceSuggestions(): string[] {
      return dashboardCustomPromptSurfaceSuggestions(this);
    },
    /** Add a target surface tag. */
    addCustomPromptSurface(surface: string) {
      dashboardAddCustomPromptSurface(this, surface);
    },
    /** Commit the typed target surface tag, if any. */
    commitCustomPromptSurfaceDraft() {
      dashboardAddCustomPromptSurface(this, this.customPromptSurfaceDraft);
    },
    /** Remove a target surface tag. */
    removeCustomPromptSurface(surface: string) {
      dashboardRemoveCustomPromptSurface(this, surface);
    },
    /** Return a live preset-shaped preview for the custom prompt draft. */
    customPromptPreview(): Preset {
      return dashboardPreviewCustomPromptPreset(this);
    },
    /** Return preview name text, including an explicit placeholder. */
    customPromptPreviewName(): string {
      return this.customPromptDraft.name.trim() || "Untitled custom prompt";
    },
    /** Return preview description text, including an explicit placeholder. */
    customPromptPreviewDescription(): string {
      return this.customPromptDraft.desc.trim() || "No description yet";
    },
    /** Focus a custom prompt editor control after Alpine renders it. */
    focusCustomPromptField(id = "custom-prompt-name") {
      const self = this as typeof this & AlpineMagics<typeof this>;
      void self.$nextTick(() => {
        requestAnimationFrame(() => {
          const field = document.getElementById(id);
          if (field instanceof HTMLElement) field.focus();
        });
      });
    },
    /** Focus the first invalid custom prompt field. */
    focusFirstCustomPromptError() {
      const first = this.customPromptErrors()[0];
      this.focusCustomPromptField(first?.anchor ?? "custom-prompt-name");
    },
    /** Open a blank custom prompt editor. */
    openNewCustomPrompt() {
      dashboardOpenNewCustomPrompt(this);
      this.showPromptStartPicker = false;
      this.customPromptStartId = "";
      this.focusCustomPromptField();
    },
    /** Edit the currently selected custom prompt. */
    editSelectedCustomPrompt() {
      dashboardOpenEditCustomPrompt(this, this.selectedPreset);
      this.showPromptStartPicker = false;
      this.focusCustomPromptField();
    },
    /** Start a new custom prompt from the selected preset. */
    duplicateSelectedCustomPrompt() {
      dashboardDuplicateCustomPrompt(this, this.selectedPreset);
      this.showPromptStartPicker = false;
      this.customPromptStartId = "";
      this.focusCustomPromptField();
    },
    /** Start a new custom prompt from one selected existing prompt. */
    startCustomPromptFromPreset() {
      dashboardStartCustomPromptFromPresetId(this, this.customPromptStartId);
      this.showPromptStartPicker = false;
      this.customPromptStartId = "";
      this.focusCustomPromptField();
    },
    /** Save the custom prompt editor draft. */
    saveCustomPrompt(): CustomPrompt | null {
      this.customPromptSubmitAttempted = true;
      const saved = dashboardSaveCustomPrompt(this);
      if (!saved) this.focusFirstCustomPromptError();
      return saved;
    },
    /** Save the draft and immediately launch it with the active runner. */
    async saveAndRunCustomPrompt() {
      const saved = this.saveCustomPrompt();
      if (!saved) return;
      const preset = dashboardCustomPromptToPreset(saved);
      await this.launchPreset(preset.prompt, this.activeRunner, preset.name, {
        presetId: preset.id,
      });
    },
    /** Delete the selected custom prompt after confirmation. */
    deleteSelectedCustomPrompt() {
      dashboardDeleteSelectedCustomPrompt(this);
    },
    /** Cancel custom prompt editing without changing persisted prompts. */
    cancelCustomPromptEdit() {
      this.showCustomPromptEditor = false;
      this.editingCustomPromptId = null;
      this.customPromptSubmitAttempted = false;
      this.showPromptStartPicker = false;
    },
    /** Return quality-page prompt modes. */
    get qualityModes(): QualityModeOption[] {
      return dashboardQualityModes(this);
    },
    /** Return the selected quality mode option. */
    get selectedQualityModeMeta(): QualityModeOption | null {
      return dashboardSelectedQualityModeMeta(this);
    },
    /** Return the label to use for quality-mode terminal sessions. */
    qualityLaunchLabel(): string {
      return dashboardQualityLaunchLabel(this);
    },
    /** Return the selected setup target's instruction/config surfaces. */
    setupInstructionSurfaces(): string {
      return dashboardSetupInstructionSurfaces(this);
    },
    /** Send text to the active terminal session and focus it. */
    sendToTerminal(
      text: string,
      { adapt = true }: { adapt?: boolean } = {},
    ): boolean {
      return dashboardSendToTerminal(this, text, { adapt });
    },
    /** Send a preset prompt to an active session in the current project. */
    async sendToProjectTarget(prompt: string, target: ServerSessionInfo) {
      await dashboardSendToProjectTarget(this, prompt, target);
    },
    // --- Terminal image drag-drop ---
    handleTerminalDragEnter(event: DragEvent) {
      if (!this._dragHasImageFiles(event)) return;
      if (!this.activeSessionId || this.terminalEnded) return;
      this._terminalDragDepth += 1;
      this.terminalDragActive = true;
    },
    handleTerminalDragOver(event: DragEvent) {
      if (!this._dragHasImageFiles(event)) return;
      // Setting dropEffect on the dataTransfer is what lets browsers fire `drop`
      // on this pane instead of routing the file to the OS handler.
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    },
    handleTerminalDragLeave(_event: DragEvent) {
      this._terminalDragDepth = Math.max(0, this._terminalDragDepth - 1);
      if (this._terminalDragDepth === 0) this.terminalDragActive = false;
    },
    async handleTerminalDrop(event: DragEvent) {
      this._terminalDragDepth = 0;
      this.terminalDragActive = false;
      if (!this.activeSessionId || this.terminalEnded) {
        this.showToast("No active terminal session for upload", true);
        return;
      }
      const files = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
        file.type.startsWith("image/"),
      );
      if (files.length === 0) {
        this.showToast(
          "Only image files (.png, .jpg, .webp, .gif) can be dropped here",
          true,
        );
        return;
      }
      await this._uploadTerminalImages(files);
    },
    _dragHasImageFiles(event: DragEvent): boolean {
      const items = event.dataTransfer?.items;
      if (!items || items.length === 0) return false;
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        if (item && item.kind === "file" && item.type.startsWith("image/"))
          return true;
      }
      return false;
    },
    async _uploadTerminalImages(files: File[]) {
      const sessionId = this.activeSessionId;
      if (!sessionId) return;
      this.terminalUploading = true;
      try {
        const encoded = await Promise.all(
          files.map(async (file) => ({
            name: file.name,
            data: await dashboardFileToBase64(file),
          })),
        );
        const res = await dashboardFetch(
          `/api/terminal/${encodeURIComponent(sessionId)}/upload-image`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ files: encoded }),
          },
        );
        const payload = readRecord(
          await res.json(),
          "Terminal upload response",
        );
        const error = readErrorMessage(payload);
        if (error) {
          this.showToast(error, true);
          return;
        }
        const note = typeof payload.note === "string" ? payload.note : "";
        const accepted = Array.isArray(payload.accepted)
          ? payload.accepted
          : [];
        const rejected = Array.isArray(payload.rejected)
          ? payload.rejected
          : [];
        if (note.length > 0) {
          dashboardSendToTerminalSession(this, sessionId, note, {
            adapt: false,
          });
        }
        if (rejected.length > 0) {
          for (const entry of rejected) {
            const r = entry as Record<string, unknown>;
            const name =
              typeof r["originalName"] === "string"
                ? r["originalName"]
                : "file";
            const reason =
              typeof r["reason"] === "string" ? r["reason"] : "unknown reason";
            this.showToast(`Rejected ${name}: ${reason}`, true);
          }
        } else if (accepted.length > 0) {
          this.showToast(
            `Attached ${accepted.length} image${accepted.length === 1 ? "" : "s"}`,
            false,
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.showToast(msg || "Terminal image upload failed", true);
      } finally {
        this.terminalUploading = false;
      }
    },
    // --- Init ---
    init() {
      const self = this as typeof this & AlpineMagics<typeof this>;
      self.$watch("darkMode", (v: boolean) => {
        localStorage.setItem("gf-dark", String(v));
        document.documentElement.classList.toggle("dark", v);
      });
      self.$watch("activeView", (v: string) => {
        if ((v === "workspace" || v === "setup") && this.terminalAvailable) {
          void this.loadXterm().catch(() => {});
        }
        if (v !== "workspace" || !this.activeSessionId) return;
        const refs = this._terminalRefs[this.activeSessionId];
        const xterm = refs?.xterm;
        const fitAddon = xterm?._addonFit;
        if (!xterm || !fitAddon) return;
        /** Resize the active terminal to match its container. */
        const refit = (): boolean => {
          const container = document.getElementById(
            `gf-terminal-${this.activeSessionId}`,
          );
          if (!container || container.offsetWidth === 0) return false;
          fitAddon.fit();
          if (refs.ws?.readyState === WebSocket.OPEN) {
            refs.ws.send(
              JSON.stringify({
                type: "resize",
                cols: xterm.cols,
                rows: xterm.rows,
              }),
            );
          }
          return true;
        };
        /** Retry terminal refits until the workspace view can measure the container. */
        const poll = (attempts = 0): void => {
          if (attempts > TERMINAL_REFIT_MAX_ATTEMPTS) return;
          requestAnimationFrame(() => {
            if (!refit()) {
              setTimeout(() => {
                poll(attempts + 1);
              }, TERMINAL_REFIT_RETRY_DELAY_MS);
            }
          });
        };
        void self.$nextTick(() => {
          poll();
        });
      });
      self.$watch("workspacePanel", (v: string) => {
        const xterm = this._terminalXterm;
        const fitAddon = xterm?._addonFit;
        if (v === "terminal" && xterm && fitAddon) {
          requestAnimationFrame(() => {
            fitAddon.fit();
            if (this._terminalWs?.readyState === WebSocket.OPEN) {
              this._terminalWs.send(
                JSON.stringify({
                  type: "resize",
                  cols: xterm.cols,
                  rows: xterm.rows,
                }),
              );
            }
          });
        }
      });
      self.$watch("activeSessionId", (id: string | null) => {
        if (!id) return;
        const refs = this._terminalRefs[id];
        const xterm = refs?.xterm;
        const fitAddon = xterm?._addonFit;
        if (!xterm || !fitAddon) return;
        void self.$nextTick(() => {
          requestAnimationFrame(() => {
            fitAddon.fit();
            if (refs.ws?.readyState === WebSocket.OPEN) {
              refs.ws.send(
                JSON.stringify({
                  type: "resize",
                  cols: xterm.cols,
                  rows: xterm.rows,
                }),
              );
            }
            xterm.focus();
          });
        });
      });
      self.$watch("activeView", (v: string) => {
        if (this._workspacePoll) {
          clearInterval(this._workspacePoll);
          this._workspacePoll = null;
        }
        if (
          v === "home" ||
          v === "projects" ||
          v === "workspace" ||
          v === "prompts"
        ) {
          void this.updateSessionCount();
        }
        if (v === "home") {
          void this.generateHomeQualitySummary();
        }
        if (v === "workspace") {
          this._workspacePoll = setInterval(() => {
            void this.updateSessionCount();
          }, 10_000);
        }
        if (v === "quality") {
          void this.generateQuality({ fast: true });
          this.scheduleQualityHistory();
        }
        if (v === "skills") {
          void this.loadSkillQualityInventory();
        }
        if (v === "setup") {
          void this.detectStack();
          this.scheduleSetupPrompt();
        }
        if (v === "plans") {
          void this.loadTasks();
        }
      });
      self.$watch("qualityAgent", () => {
        if (this.activeView === "quality") {
          void this.generateQuality({ fast: true });
          this.scheduleQualityHistory();
        }
      });
      self.$watch("activeRunner", () => {
        if (this.activeView === "home") {
          void this.generateHomeQualitySummary();
        }
        if (this.activeView === "skills") {
          this.skillQualityAbortController?.abort();
          this.skillQualityAbortController = null;
          this.skillQualityArtifacts = [];
          this.skillQualitySelectedId = null;
          this.skillQualityReport = null;
          this.skillQualityLoading = false;
          this.skillQualityReports = {};
          this.skillQualityAuditedAt = null;
          this.skillQualityPrefetching = false;
          this.skillQualityPrefetchGeneration += 1;
          void this.loadSkillQualityInventory();
        }
      });
      self.$watch("selectedQualityModeId", () => {
        if (this.activeView === "quality") {
          void this.generateQuality({ fast: true });
          this.scheduleQualityHistory();
        }
      });
      self.$watch("sessionsCollapsed", (v: boolean) => {
        localStorage.setItem("gf-sessions-collapsed", String(v));
      });
      /** Update the browser title to match the current project. */
      const updateTitle = (): void => {
        document.title = `${this.projectName} | GOAT Flow`;
      };
      self.$watch("projectPath", (newPath: string, oldPath: string) => {
        updateTitle();
        if (oldPath && newPath !== oldPath) {
          this.detachTerminal(oldPath);
          void this.reconnectTerminal();
          void this.updateSessionCount();
          if (this.activeView === "quality") {
            void this.generateQuality({ fast: true });
            this.scheduleQualityHistory();
          }
          if (this.activeView === "setup") {
            void this.detectStack();
            this.scheduleSetupPrompt();
          }
          if (this.activeView === "home") {
            void this.generateHomeQualitySummary();
          }
          if (this.activeView === "plans") {
            this.selectedTaskPlan = null;
            void this.loadTasks();
          }
          this.skillQualityAbortController?.abort();
          this.skillQualityAbortController = null;
          this.skillQualityArtifacts = [];
          this.skillQualitySelectedId = null;
          this.skillQualityReport = null;
          this.skillQualityLoading = false;
          this.skillQualityReports = {};
          this.skillQualityAuditedAt = null;
          this.skillQualityPrefetching = false;
          this.skillQualityPrefetchGeneration += 1;
          if (this.activeView === "skills") {
            void this.loadSkillQualityInventory();
          }
        }
      });
      updateTitle();
      document.documentElement.classList.toggle("dark", this.darkMode);
      dashboardLoadCustomPrompts(this);
      void this._loadSavedDashboardState().then(() => {
        if (this.projectsList.length > 0) void this.auditAllProjects();
      });
      if (location.protocol === "http:" || location.protocol === "https:") {
        void this.runAudit();
        void this.checkTerminalAvailable();
        void this.fetchInstalledAgents();
      }
      document.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          this.showBrowser = false;
        }
        if (
          e.key === "D" &&
          e.ctrlKey &&
          e.shiftKey &&
          this.activeView === "workspace" &&
          this.terminalSessionId
        ) {
          e.preventDefault();
          this.exitTerminal();
          return;
        }
        if (
          e.key === "/" &&
          !["INPUT", "TEXTAREA", "SELECT"].includes(
            document.activeElement?.tagName ?? "",
          )
        ) {
          // Preserve focus inside an active terminal session.
          if (
            this.activeView === "workspace" &&
            this.terminalSessionId &&
            !this.terminalEnded
          ) {
            return;
          }
          e.preventDefault();
          this.activeView = "prompts";
          void self.$nextTick(() => {
            const searchInput = self.$refs.presetSearchInput;
            if (searchInput instanceof HTMLInputElement) searchInput.focus();
          });
        }
        if (this.activeView === "prompts") {
          if (e.key === "Escape" && this.showCustomPromptEditor) {
            e.preventDefault();
            this.cancelCustomPromptEdit();
            return;
          }
          const inputFocused = ["INPUT", "TEXTAREA", "SELECT"].includes(
            document.activeElement?.tagName ?? "",
          );
          if (!inputFocused) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              this.selectPresetByOffset(1);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              this.selectPresetByOffset(-1);
            } else if (e.key === "Enter") {
              if (
                this.selectedPreset &&
                !this.launching &&
                Math.max(this.sessions.length, this.serverSessions.length) <
                  this.serverMaxSessions
              ) {
                e.preventDefault();
                void this.launchPreset(
                  this.selectedPreset.prompt,
                  this.activeRunner,
                  this.selectedPreset.name,
                  { presetId: this.selectedPreset.id },
                );
              }
            }
          }
          if (e.key === "Escape") {
            if (this.presetSearch) {
              this.presetSearch = "";
            } else if (this.selectedPreset) {
              this.selectedPreset = null;
            }
          }
        }
      });
    },

    // -- Navigation --
    comingSoonMeta(view: string): { title: string; desc: string } | null {
      const meta: Record<string, { title: string; desc: string }> = {};
      return meta[view] ?? null;
    },
    isComingSoonView(view?: string): boolean {
      return this.comingSoonMeta(view ?? this.activeView) !== null;
    },
    toggleSideNav() {
      this.sideNavCollapsed = !this.sideNavCollapsed;
      localStorage.setItem(
        "gf-side-nav-collapsed",
        String(this.sideNavCollapsed),
      );
    },

    // -- API Calls --
    async runAudit(fresh = false) {
      this.auditing = true;
      this.toast = "";
      try {
        const freshParam = fresh ? "&fresh=true" : "";
        const res = await dashboardFetch(
          `/api/audit?path=${encodeURIComponent(this.projectPath)}&quality=true${freshParam}`,
        );
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const payload = readRecord(await res.json(), "Audit response");
        const error = readErrorMessage(payload);
        if (error) throw new Error(error);
        const cached = payload.cached === true;
        const cachedAt =
          typeof payload.cachedAt === "string" ? payload.cachedAt : null;
        this.report = readDashboardReport(payload);
        this.auditCached = cached;
        this.lastAuditTime = cachedAt ? new Date(cachedAt) : new Date();
        if (fresh) {
          this.setupOutputs = {};
          this._setupOutputProjectPath = this.projectPath;
          if (this.activeView === "setup") this.scheduleSetupPrompt();
        }
        if (this.activeView === "home") {
          void this.generateHomeQualitySummary();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.showToast(
          msg.includes("Failed to fetch")
            ? "Server not running. Start with: goat-flow dashboard ."
            : msg,
          true,
        );
      }
      this.auditing = false;
      if (!this.agentsLoaded) {
        void this.fetchInstalledAgents().then((loaded) => {
          if (!loaded) this.agentsLoaded = true;
        });
      }
    },
    async fetchInstalledAgents(): Promise<boolean> {
      try {
        const res = await dashboardFetch("/api/agents/installed");
        if (!res.ok) return false;
        const payload = readRecord(
          await res.json(),
          "Agent detection response",
        );
        const agents = Array.isArray(payload.agents)
          ? payload.agents
              .map((agent) => readAgentInfo(agent))
              .filter((agent): agent is AgentInfo => agent !== null)
          : [];
        if (this.supportedAgents.length === 0) this.supportedAgents = agents;
        this.allAgents = agents;
        this.installedAgents = agents.filter((a) => a.installed);
        this.agentsLoaded = true;
        if (
          this.installedAgents.length > 0 &&
          !this.installedAgents.find((a) => a.id === this.activeRunner)
        ) {
          const [firstInstalled] = this.installedAgents;
          if (firstInstalled) this.activeRunner = firstInstalled.id;
        }
        return true;
      } catch {
        return false;
      }
    },
    /** Open the project browser at the current workspace path. */
    async openBrowser() {
      await dashboardOpenBrowser(this);
    },
    /** Load child directories for the requested browser path. */
    async browseTo(path: string) {
      await dashboardBrowseTo(this, path);
    },
    /** Set a browsed directory as the active project. */
    selectDir(dir: BrowseDir) {
      dashboardSelectDir(this, dir);
    },

    // -- Tasks --
    async loadTasks(planName?: string) {
      this.tasksLoading = true;
      this.tasksError = "";
      const requestProjectPath = this.projectPath;
      const requestedPlan = planName ?? this.selectedTaskPlan;
      const planParam = requestedPlan
        ? `&plan=${encodeURIComponent(requestedPlan)}`
        : "";
      try {
        const res = await dashboardFetch(
          `/api/tasks?path=${encodeURIComponent(requestProjectPath)}${planParam}`,
        );
        const payload = readRecord(await res.json(), "Tasks response");
        const error = readErrorMessage(payload);
        if (error) throw new Error(error);
        if (this.projectPath !== requestProjectPath) return;
        const state = readTaskState(payload);
        this.tasksState = state;
        this.selectedTaskPlan = state.selectedPlan;
      } catch (err) {
        if (this.projectPath !== requestProjectPath) return;
        this.tasksState = null;
        this.tasksError = err instanceof Error ? err.message : String(err);
      } finally {
        if (this.projectPath === requestProjectPath) this.tasksLoading = false;
      }
    },
    selectTaskPlan(planName: string) {
      this.selectedTaskPlan = planName;
      void this.loadTasks(planName);
    },
    async setActiveTaskPlan(planName: string) {
      if (!planName || this.tasksActivePlanSaving) return;
      this.tasksActivePlanSaving = planName;
      this.tasksError = "";
      const requestProjectPath = this.projectPath;
      try {
        const res = await dashboardFetch(
          `/api/tasks?path=${encodeURIComponent(requestProjectPath)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ plan: planName }),
          },
        );
        const payload = readRecord(await res.json(), "Tasks response");
        const error = readErrorMessage(payload);
        if (error) throw new Error(error);
        if (this.projectPath !== requestProjectPath) return;
        const state = readTaskState(payload);
        this.tasksState = state;
        this.selectedTaskPlan = state.selectedPlan;
        this.showToast(`Active plan set to ${planName}`);
      } catch (err) {
        if (this.projectPath !== requestProjectPath) return;
        this.tasksError = err instanceof Error ? err.message : String(err);
        this.showToast(this.tasksError || "Active plan update failed", true);
      } finally {
        if (
          this.projectPath === requestProjectPath &&
          this.tasksActivePlanSaving === planName
        ) {
          this.tasksActivePlanSaving = null;
        }
      }
    },
    taskProgressLabel(milestone: TaskMilestoneSummary): string {
      return `${milestone.completedTasks}/${milestone.totalTasks}`;
    },
    taskProgressPct(milestone: TaskMilestoneSummary): number {
      if (milestone.totalTasks <= 0) return 0;
      return Math.round(
        (milestone.completedTasks / milestone.totalTasks) * 100,
      );
    },
    taskModifiedLabel(value: string): string {
      if (!value) return "unknown";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "unknown";
      return date.toLocaleString();
    },

    // -- Setup --
    async detectStack() {
      await dashboardDetectStack(this);
    },
    /** Generate setup output for the agent selected in the setup view. */
    async generateSetupPrompt(force = false) {
      await dashboardGenerateSetupPrompt(this, { force });
    },
    /** Generate setup output after setup detection gets a paint. */
    scheduleSetupPrompt() {
      dashboardScheduleSetupPrompt(this);
    },

    // -- Quality --
    async generateQuality(options: { fast?: boolean; fresh?: boolean } = {}) {
      await dashboardGenerateQuality(this, options);
    },
    /** Load persisted quality-history rows for the selected project and agent. */
    async generateQualityHistory() {
      await dashboardGenerateQualityHistory(this);
    },
    /** Load quality history after first prompt paint. */
    scheduleQualityHistory() {
      dashboardScheduleQualityHistory(this);
    },
    /** Load the latest quality-history summary for the Home rollup. */
    async generateHomeQualitySummary() {
      this.homeQualityLoading = true;
      this.homeQualityLatest = null;
      const requestProjectPath = this.projectPath;
      const requestAgent = this.activeRunner;
      const isCurrentRequest = (): boolean =>
        this.projectPath === requestProjectPath &&
        this.activeRunner === requestAgent;
      try {
        const res = await dashboardFetch(
          `/api/quality/history?path=${encodeURIComponent(requestProjectPath)}&agent=${encodeURIComponent(requestAgent)}&mode=agent-setup&limit=1`,
        );
        const payload = readRecord(await res.json(), "Home quality response");
        if (!isCurrentRequest()) return;
        const error = readErrorMessage(payload);
        if (error) {
          this.showToast(error, true);
        } else {
          this.homeQualityLatest = readQualityHistoryLatest(payload.latest);
        }
      } catch (err) {
        if (!isCurrentRequest()) return;
        const msg = err instanceof Error ? err.message : String(err);
        this.showToast(msg || "Home quality loading failed", true);
      }
      if (isCurrentRequest()) this.homeQualityLoading = false;
    },
    /** Copy the current quality prompt to the clipboard. */
    copyQuality() {
      dashboardCopyQuality(this);
    },

    // -- Skill quality --
    async loadSkillQualityInventory() {
      const requestProjectPath = this.projectPath;
      const requestRunner = this.activeRunner;
      const requestGeneration = this.skillQualityPrefetchGeneration + 1;
      this.skillQualityPrefetchGeneration = requestGeneration;
      this.skillQualityPrefetching = false;
      try {
        const res = await dashboardFetch(
          `/api/skill-quality/inventory?path=${encodeURIComponent(requestProjectPath)}&agent=${encodeURIComponent(requestRunner)}`,
        );
        const payload = readRecord(await res.json(), "Skill quality inventory");
        const error = readErrorMessage(payload);
        if (error) {
          this.showToast(error, true);
          return;
        }
        if (
          this.projectPath !== requestProjectPath ||
          this.activeRunner !== requestRunner ||
          this.skillQualityPrefetchGeneration !== requestGeneration
        ) {
          return;
        }
        this.skillQualityArtifacts = Array.isArray(payload.artifacts)
          ? payload.artifacts.filter(
              (artifact): artifact is SkillQualityArtifact =>
                isRecord(artifact) &&
                artifact.kind === "skill" &&
                typeof artifact.id === "string" &&
                typeof artifact.name === "string" &&
                typeof artifact.path === "string" &&
                typeof artifact.source === "string",
            )
          : [];
        if (
          this.skillQualitySelectedId &&
          !this.skillQualityArtifacts.some(
            (artifact) => artifact.id === this.skillQualitySelectedId,
          )
        ) {
          this.skillQualitySelectedId = null;
          this.skillQualityReport = null;
        }
        this.skillQualityReports = {};
        this.skillQualityAuditedAt = null;
        this.skillQualityPrefetching = false;
        void this.prefetchSkillReports(
          requestProjectPath,
          requestRunner,
          requestGeneration,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.showToast(msg || "Skill quality inventory failed", true);
      }
    },
    /** Fetch reports for every artifact in parallel so the sidebar can show
     *  a per-skill grade without requiring the user to click each one first.
     *  Aborts silently if the project/runner changes mid-flight. */
    async prefetchSkillReports(
      projectPath: string,
      runner: string,
      generation: number,
    ) {
      const artifacts = [...this.skillQualityArtifacts];
      if (artifacts.length === 0) return;
      this.skillQualityPrefetching = true;
      const fetches = artifacts.map(async (art) => {
        try {
          const res = await dashboardFetch(
            `/api/skill-quality?path=${encodeURIComponent(projectPath)}&agent=${encodeURIComponent(runner)}&artifact=${encodeURIComponent(art.id)}`,
          );
          const payload = readRecord(await res.json(), "Skill quality report");
          if (readErrorMessage(payload)) return;
          if (
            this.projectPath !== projectPath ||
            this.activeRunner !== runner ||
            this.skillQualityPrefetchGeneration !== generation
          ) {
            return;
          }
          this.skillQualityReports[art.id] =
            payload as unknown as SkillQualityReport;
        } catch {
          /* swallow per-artifact errors so one failure doesn't stop the rest */
        }
      });
      await Promise.all(fetches);
      if (
        this.projectPath === projectPath &&
        this.activeRunner === runner &&
        this.skillQualityPrefetchGeneration === generation
      ) {
        this.skillQualityAuditedAt = Date.now();
        this.skillQualityPrefetching = false;
        if (
          !this.skillQualitySelectedId &&
          this.skillQualityArtifacts.length > 0
        ) {
          const first = this.skillQualityArtifacts[0];
          if (first) void this.loadSkillQualityReport(first.id);
        }
      }
    },
    /** Re-run the inventory + prefetch from scratch — used by the page-level
     *  "Re-audit all" button. */
    async reauditAllSkills() {
      this.skillQualityReport = null;
      this.skillQualitySelectedId = null;
      await this.loadSkillQualityInventory();
    },
    async loadSkillQualityReport(artifactId: string) {
      this.skillQualitySelectedId = artifactId;
      const cached = this.skillQualityReports[artifactId];
      if (cached) {
        this.skillQualityReport = cached;
        this.skillQualityLoading = false;
        return;
      }
      this.skillQualityAbortController?.abort();
      const controller = new AbortController();
      this.skillQualityAbortController = controller;
      const requestProjectPath = this.projectPath;
      const requestRunner = this.activeRunner;
      this.skillQualityReport = null;
      this.skillQualityLoading = true;
      try {
        const res = await dashboardFetch(
          `/api/skill-quality?path=${encodeURIComponent(requestProjectPath)}&agent=${encodeURIComponent(requestRunner)}&artifact=${encodeURIComponent(artifactId)}`,
          { signal: controller.signal },
        );
        const payload = readRecord(await res.json(), "Skill quality report");
        const error = readErrorMessage(payload);
        if (error) {
          this.showToast(error, true);
        } else if (
          this.projectPath === requestProjectPath &&
          this.activeRunner === requestRunner &&
          this.skillQualitySelectedId === artifactId
        ) {
          const report = payload as unknown as SkillQualityReport;
          this.skillQualityReport = report;
          this.skillQualityReports[artifactId] = report;
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        this.showToast(msg || "Skill quality scoring failed", true);
      }
      if (this.skillQualityAbortController === controller) {
        this.skillQualityLoading = false;
        this.skillQualityAbortController = null;
      }
    },
    /** Map a 0..1 ratio to an A/B/C/D/F letter grade. Matches the convention
     *  used on the Setup and Quality pages (≥0.9 A, ≥0.8 B, ≥0.7 C, ≥0.6 D). */
    skillLetterGrade(pct: number): string {
      if (pct >= 0.9) return "A";
      if (pct >= 0.8) return "B";
      if (pct >= 0.7) return "C";
      if (pct >= 0.6) return "D";
      return "F";
    },
    skillReportPct(report: SkillQualityReport | null): number {
      if (!report || !report.profileMax) return 0;
      return report.totalScore / report.profileMax;
    },
    /** Aggregate count of skills whose stored report has at least one
     *  warn/fail metric. Used for the scope-strip "N with warnings" line. */
    skillsWithWarningsCount(): number {
      let count = 0;
      for (const id in this.skillQualityReports) {
        const r = this.skillQualityReports[id];
        if (!r) continue;
        if (
          r.metrics.some((m) => m.severity === "warn" || m.severity === "fail")
        )
          count++;
      }
      return count;
    },
    /** Mean score across all prefetched reports as a 0..1 ratio. */
    skillsAvgPct(): number {
      const reports = Object.values(this.skillQualityReports);
      if (reports.length === 0) return 0;
      let sum = 0;
      for (const r of reports) sum += this.skillReportPct(r);
      return sum / reports.length;
    },
    /** Headline summary for the skills detail panel — derives a one-sentence
     *  conclusion from the recommendation + warn/fail counts so the buried
     *  "two non-blocking issues" line gets promoted into a banner. */
    skillSummaryBanner(report: SkillQualityReport | null): {
      title: string;
      desc: string;
      severity: "pass" | "warn" | "fail";
    } {
      if (!report) return { title: "", desc: "", severity: "warn" };
      const pct = this.skillReportPct(report);
      const warnCount = report.metrics.filter(
        (m) => m.severity === "warn",
      ).length;
      const failCount = report.metrics.filter(
        (m) => m.severity === "fail",
      ).length;
      const rec = report.recommendation;
      if (failCount > 0) {
        return {
          title: "Critical structural issues require attention",
          desc: `${failCount} failing metric${failCount > 1 ? "s" : ""}${
            warnCount
              ? ` and ${warnCount} warning${warnCount > 1 ? "s" : ""}`
              : ""
          }. Recommended: ${rec}.`,
          severity: "fail",
        };
      }
      if (warnCount > 0) {
        const title =
          pct >= 0.85
            ? "Strong skill identity with adequate structural quality"
            : "Acceptable skill with non-blocking issues";
        return {
          title,
          desc: `${warnCount} non-blocking issue${
            warnCount > 1 ? "s" : ""
          }. Recommended: ${rec}, address warnings.`,
          severity: "warn",
        };
      }
      return {
        title: "All structural metrics passing",
        desc: `Recommended: ${rec}.`,
        severity: "pass",
      };
    },
    /** Verdict-banner copy for the Skill Evaluator result.
     *
     *  The headline title softens its tone to match the recommendation: a
     *  `needs-human-review` verdict says "needs review before keeping", not
     *  "block ship" — "block ship" is reserved for verdicts that the engine
     *  is genuinely confident about (retire / consider-revision). Mismatch
     *  between pill and copy was confusing readers about how confident the
     *  engine actually is. */
    skillEvaluatorVerdict(report: SkillEvaluateResult | null): {
      title: string;
      desc: string;
    } {
      if (!report) return { title: "", desc: "" };
      const cls = report.classification;
      const detected = cls.detectedSubtype;
      const detectedShape = report.detectedShape ?? detected;
      const shapeConfidence = report.shapeConfidence ?? cls.confidence;
      const shapeMismatch =
        report.shapeMismatch ?? detectedShape !== report.subtype;
      const failCount = report.metrics.filter(
        (m) => m.severity === "fail",
      ).length;
      const warnCount = report.metrics.filter(
        (m) => m.severity === "warn",
      ).length;
      const isHardVerdict =
        report.recommendation === "retire" ||
        report.recommendation === "consider-revision";
      let title = "";
      if (shapeMismatch && shapeConfidence >= 0.7) {
        const packagedAs =
          report.artifact.kind === "skill" ? "skill" : "reference";
        title = `Packaged as ${packagedAs}, reads like ${detectedShape}`;
      } else if (cls.confidence >= 0.85 && detected !== report.subtype) {
        title = `This reads as a ${detected}, not a ${report.subtype}`;
      } else if (failCount > 0) {
        const tail = isHardVerdict
          ? "block ship"
          : "— needs review before keeping";
        title = `${failCount} failing metric${failCount > 1 ? "s" : ""} ${tail}`;
      } else if (warnCount > 0) {
        title = `${warnCount} non-blocking warning${warnCount > 1 ? "s" : ""}`;
      } else {
        title = "All structural metrics passing";
      }
      const recHuman =
        report.recommendation === "needs-human-review"
          ? "Manual review required"
          : report.recommendation === "consider-reclassifying"
            ? "Consider reclassifying"
            : report.recommendation === "consider-revision"
              ? "Revise before shipping"
              : report.recommendation === "retire"
                ? "Retire or rewrite"
                : report.recommendation === "reference-playbook"
                  ? "Ship as a reference"
                  : "Keep as a skill";
      const detail =
        shapeMismatch && shapeConfidence >= 0.7
          ? `${Math.round(shapeConfidence * 100)}% shape confidence`
          : cls.confidence >= 0.85 && detected !== report.subtype
            ? `${Math.round(cls.confidence * 100)}% ${detected} classification`
            : `${failCount + warnCount} non-passing metric${
                failCount + warnCount === 1 ? "" : "s"
              }`;
      return {
        title,
        desc: `${detail}. ${recHuman} before deciding to keep, convert, or discard.`,
      };
    },
    /** Group improvement tips by their metric so the modal result can render
     *  one collapsible cluster per metric (with the metric's score in the
     *  header). Order follows the metrics array (ranking from skill-quality.ts). */
    skillEvaluatorTipGroups(report: SkillEvaluateResult | null): Array<{
      metric: string;
      label: string;
      score: number;
      maxScore: number;
      severity: SkillQualityMetricSeverity;
      tips: SkillEvaluateTip[];
    }> {
      if (!report || report.tips.length === 0) return [];
      const tipsByMetric = new Map<string, SkillEvaluateTip[]>();
      for (const tip of report.tips) {
        const arr = tipsByMetric.get(tip.metric) ?? [];
        arr.push(tip);
        tipsByMetric.set(tip.metric, arr);
      }
      const groups: Array<{
        metric: string;
        label: string;
        score: number;
        maxScore: number;
        severity: SkillQualityMetricSeverity;
        tips: SkillEvaluateTip[];
      }> = [];
      for (const m of report.metrics) {
        const tips = tipsByMetric.get(m.metric);
        if (!tips || tips.length === 0) continue;
        groups.push({
          metric: m.metric,
          label: m.label,
          score: m.score,
          maxScore: m.maxScore,
          severity: m.severity,
          tips,
        });
      }
      return groups;
    },
    toggleSkillEvaluatorTipGroup(metric: string) {
      this.skillEvaluatorTipCollapsed[metric] =
        !this.skillEvaluatorTipCollapsed[metric];
    },
    /** Pretty "audited just now / 3 minutes ago" formatter for the scope strip. */
    skillAuditedRelative(): string {
      const ts = this.skillQualityAuditedAt;
      if (!ts) return "audited recently";
      const ms = Date.now() - ts;
      if (ms < 60_000) return "audited just now";
      const min = Math.floor(ms / 60_000);
      if (min < 60) return `audited ${min} min${min > 1 ? "s" : ""} ago`;
      const hr = Math.floor(min / 60);
      return `audited ${hr} hr${hr > 1 ? "s" : ""} ago`;
    },
    /** Pill-style file-role label used in the composed-from list and evaluator
     *  file chips. */
    skillFileRole(name: string): string {
      if (name === "skill-preamble.md") return "PREAMBLE";
      if (name === "skill-conventions.md") return "CONVENTIONS";
      if (name === "SKILL.md") return "SKILL";
      if (name.startsWith("references/")) return "REFERENCE";
      return "FILE";
    },
    /** Generate a stable slug for an evaluator result. Used in the result
     *  footer as a copyable identifier so users can reference a specific
     *  evaluation run later (e.g. when comparing two scoring sessions). */
    skillEvaluatorSlug(report: SkillEvaluateResult | null): string {
      if (!report) return "";
      const today = new Date().toISOString().slice(0, 10);
      const safe = (report.artifact.name || "skill")
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "");
      return `evaluation-${today}-${safe}`;
    },
    /** Copy a markdown summary of the current evaluation result to the user's
     *  clipboard. The format mirrors what the engine itself emits so the
     *  result can be pasted into PR descriptions or session notes. */
    async copySkillEvaluatorReport() {
      const r = this.skillEvaluatorResult;
      if (!r) return;
      const lines: string[] = [];
      const pct = Math.round(this.skillReportPct(r) * 100);
      const grade = this.skillLetterGrade(this.skillReportPct(r));
      lines.push(`# ${r.artifact.name} — ${grade} ${pct}%`);
      lines.push(`Slug: \`${this.skillEvaluatorSlug(r)}\``);
      lines.push(
        `Subtype: ${r.subtype} (${Math.round(r.classification.confidence * 100)}% ${r.classification.detectedSubtype})`,
      );
      if (r.shapeMismatch && r.detectedShape) {
        lines.push(
          `Detected shape: ${r.detectedShape} (${Math.round((r.shapeConfidence ?? 0) * 100)}%)`,
        );
      }
      lines.push(`Verdict: \`${r.recommendation}\``);
      lines.push(`Score: ${r.totalScore} / ${r.profileMax}`);
      lines.push("");
      lines.push("## Structural metrics");
      for (const m of r.metrics) {
        const score = m.severity === "n/a" ? "n/a" : `${m.score}/${m.maxScore}`;
        lines.push(`- ${m.label}: ${score} (${m.severity})`);
      }
      if (r.tips.length > 0) {
        lines.push("");
        lines.push("## Improvement tips");
        for (const tip of r.tips) {
          lines.push(`- [${tip.metric}] ${tip.message}`);
        }
      }
      if (r.composedFrom.length > 0) {
        lines.push("");
        lines.push("## Composed from");
        for (const src of r.composedFrom) {
          lines.push(`- ${src}`);
        }
      }
      try {
        const ok = await this.copyTextToClipboard(lines.join("\n"));
        if (!ok) throw new Error("Clipboard write failed");
        this.skillEvaluatorReportCopied = true;
        if (this._skillEvaluatorReportCopiedTimer) {
          clearTimeout(this._skillEvaluatorReportCopiedTimer);
        }
        this._skillEvaluatorReportCopiedTimer = setTimeout(() => {
          this.skillEvaluatorReportCopied = false;
          this._skillEvaluatorReportCopiedTimer = null;
        }, 4000);
        this.showToast("Report copied to clipboard");
      } catch (err) {
        this.skillEvaluatorReportCopied = false;
        if (this._skillEvaluatorReportCopiedTimer) {
          clearTimeout(this._skillEvaluatorReportCopiedTimer);
          this._skillEvaluatorReportCopiedTimer = null;
        }
        const msg = err instanceof Error ? err.message : String(err);
        this.showToast(msg || "Copy failed", true);
      }
    },

    // -- Skill evaluator page --
    resetSkillEvaluator() {
      this.skillEvaluatorName = "";
      this.skillEvaluatorContent = "";
      this.skillEvaluatorFiles = [];
      this.skillEvaluatorDragActive = false;
      this.skillEvaluatorResult = null;
      this.skillEvaluatorError = null;
      this.skillEvaluatorLoading = false;
      this.skillEvaluatorReportCopied = false;
      if (this._skillEvaluatorReportCopiedTimer) {
        clearTimeout(this._skillEvaluatorReportCopiedTimer);
        this._skillEvaluatorReportCopiedTimer = null;
      }
    },
    clearSkillEvaluatorResult() {
      this.skillEvaluatorResult = null;
      this.skillEvaluatorError = null;
      this.skillEvaluatorReportCopied = false;
      if (this._skillEvaluatorReportCopiedTimer) {
        clearTimeout(this._skillEvaluatorReportCopiedTimer);
        this._skillEvaluatorReportCopiedTimer = null;
      }
    },

    /** Read multiple `.md` files via FileReader; populates the file list and
     *  pre-fills the suggestedName from the first file. Skips non-markdown
     *  inputs and surfaces a per-file error if any one fails. */
    async _ingestSkillEvaluatorFiles(fileList: FileList | File[]) {
      const list = Array.from(fileList).filter(
        (file) =>
          file.name.endsWith(".md") ||
          file.name.endsWith(".markdown") ||
          file.type === "text/markdown" ||
          file.type === "text/plain",
      );
      if (list.length === 0) {
        this.skillEvaluatorError =
          "Drop .md / .markdown files only (got 0 valid files).";
        return;
      }
      const reads = list.map(
        (file) =>
          new Promise<{ name: string; content: string }>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              if (typeof reader.result === "string") {
                resolve({ name: file.name, content: reader.result });
              } else {
                reject(new Error(`Could not read ${file.name}`));
              }
            };
            reader.onerror = () => {
              reject(new Error(`Could not read ${file.name}`));
            };
            reader.readAsText(file);
          }),
      );
      try {
        const loaded = await Promise.all(reads);
        const existing = new Set(this.skillEvaluatorFiles.map((f) => f.name));
        for (const item of loaded) {
          if (existing.has(item.name)) continue;
          this.skillEvaluatorFiles.push(item);
        }
        if (!this.skillEvaluatorName && this.skillEvaluatorFiles[0]) {
          const first = this.skillEvaluatorFiles[0];
          this.skillEvaluatorName = first.name.replace(/\.(md|markdown)$/i, "");
        }
        this.skillEvaluatorError = null;
      } catch (err) {
        this.skillEvaluatorError =
          err instanceof Error ? err.message : String(err);
      }
    },

    /** File input change handler (multi-select). */
    loadSkillEvaluatorFile(event: Event) {
      const input = event.target as HTMLInputElement;
      if (!input.files || input.files.length === 0) return;
      void this._ingestSkillEvaluatorFiles(input.files);
      input.value = "";
    },

    /** dragover handler — keep the dropzone visually active. */
    skillEvaluatorDragOver(event: DragEvent) {
      event.preventDefault();
      this.skillEvaluatorDragActive = true;
    },
    /** dragleave handler — only clear when leaving the evaluator panel itself. */
    skillEvaluatorDragLeave(event: DragEvent) {
      const related = event.relatedTarget as Node | null;
      const target = event.currentTarget as Node | null;
      if (target && related && target.contains(related)) return;
      this.skillEvaluatorDragActive = false;
    },
    /** drop handler — read every dropped .md file and append to the list. */
    skillEvaluatorDrop(event: DragEvent) {
      event.preventDefault();
      this.skillEvaluatorDragActive = false;
      const files = event.dataTransfer?.files;
      if (!files || files.length === 0) return;
      void this._ingestSkillEvaluatorFiles(files);
    },
    /** Remove one already-attached file by name. */
    removeSkillEvaluatorFile(name: string) {
      this.skillEvaluatorFiles = this.skillEvaluatorFiles.filter(
        (f) => f.name !== name,
      );
    },

    async runSkillEvaluator() {
      this.skillEvaluatorError = null;
      this.skillEvaluatorResult = null;
      this.skillEvaluatorReportCopied = false;
      if (this._skillEvaluatorReportCopiedTimer) {
        clearTimeout(this._skillEvaluatorReportCopiedTimer);
        this._skillEvaluatorReportCopiedTimer = null;
      }
      const hasFiles = this.skillEvaluatorFiles.length > 0;
      const hasContent = this.skillEvaluatorContent.trim().length > 0;
      if (!hasFiles && !hasContent) {
        this.skillEvaluatorError =
          "Drop .md files, upload, or paste markdown first.";
        return;
      }
      this.skillEvaluatorLoading = true;
      try {
        const url = `/api/quality/evaluate?path=${encodeURIComponent(this.projectPath)}`;
        const body: Record<string, unknown> = {};
        if (hasFiles) {
          body.files = this.skillEvaluatorFiles;
        } else {
          body.content = this.skillEvaluatorContent;
        }
        body.kind = "skill";
        const name = this.skillEvaluatorName.trim();
        if (name.length > 0) body.suggestedName = name;
        const res = await dashboardFetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = readRecord(await res.json(), "Evaluate result");
        const error = readErrorMessage(data);
        if (error) {
          this.skillEvaluatorError = error;
          return;
        }
        this.skillEvaluatorResult = data as unknown as SkillEvaluateResult;
      } catch (err) {
        this.skillEvaluatorError =
          err instanceof Error ? err.message : String(err);
      } finally {
        this.skillEvaluatorLoading = false;
      }
    },

    // -- Projects --
    async addProject() {
      await dashboardAddProject(this);
    },
    /** Remove a project from the saved workspace list. */
    removeProject(path: string) {
      dashboardRemoveProject(this, path);
    },
    /** Sort saved projects by the active key and direction. */
    sortProjects(key: ProjectSortKey) {
      dashboardSortProjects(this, key);
    },
    /** Sort projects by visible columns while keeping the derived "name" column first-class. */
    get sortedProjectsList(): ProjectEntry[] {
      return dashboardSortedProjectsList(this);
    },
    /** Refresh audit status for every saved project. */
    async auditAllProjects() {
      await dashboardAuditAllProjects(this);
    },
    /** Load saved dashboard state from disk, with localStorage as a migration fallback. */
    async _loadSavedDashboardState() {
      await dashboardLoadSavedDashboardState(this);
    },
    /** Persist the current dashboard state to localStorage and the server store. */
    _saveDashboardState() {
      dashboardSaveDashboardState(this);
    },
    /** Begin editing the current project's title (inline header rename). */
    startEditProjectTitle() {
      dashboardStartEditProjectTitle(this);
    },
    /** Commit the inline-edited title for the current project path. An empty
     *  or whitespace-only draft clears the override so the path basename wins. */
    saveProjectTitle() {
      dashboardSaveProjectTitle(this);
    },
    /** Discard the inline-edited title. */
    cancelEditProjectTitle() {
      dashboardCancelEditProjectTitle(this);
    },
    /** Persist the current project list through the shared dashboard state store. */
    _saveProjectsList() {
      this._saveDashboardState();
    },

    // -- Clipboard + Toast --
    async copyTextToClipboard(text: string): Promise<boolean> {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // Falls through to legacy textarea+execCommand on TypeError (clipboard
        // API undefined in insecure contexts) or any Promise reject reason.
      }
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const ok = document.execCommand("copy");
      document.body.removeChild(el);
      return ok;
    },
    copyText(text: string) {
      void this.copyTextToClipboard(text);
      this.copyLabel = "Copied!";
      setTimeout(() => {
        this.copyLabel = "Copy";
      }, 2000);
    },
    /** Show a temporary toast message. */
    showToast(msg: string, isError?: boolean) {
      this.toast = msg;
      this.toastError = isError ?? false;
      setTimeout(() => {
        this.toast = "";
      }, 4000);
    },

    // -- Terminal --
    async checkTerminalAvailable() {
      await dashboardCheckTerminalAvailable(this);
    },
    /** Refresh terminal session state from the server. */
    async updateSessionCount() {
      await dashboardUpdateSessionCount(this);
    },
    /** Clear non-active (terminated/starting) sessions, preserving running ones. */
    async endAllSessions() {
      await dashboardEndAllSessions(this);
    },
    /** Retry a terminal session that failed or stalled before first output. */
    async retryTerminalSession(sessionId: string) {
      await dashboardRetryTerminalSession(this, sessionId);
    },
    /** Load the xterm.js globals on demand before any terminal view is rendered. */
    async loadXterm() {
      await dashboardLoadXterm(this);
    },
    /** Launch a preset prompt in the selected runner. */
    async launchPreset(
      prompt: string,
      runner?: RunnerId,
      label?: string,
      options?: {
        presetId?: string | null;
        cwdPath?: string | null;
        targetPath?: string | null;
      },
    ) {
      await dashboardLaunchPreset(this, prompt, runner, label, options);
    },
    /** Drop a session id from every project's saved list, pruning empty entries. */
    _forgetSavedSession(sessionId: string) {
      dashboardForgetSavedSession(this, sessionId);
    },
    /** Persist a launch-time title for reconnect and refresh recovery. */
    rememberSessionTitle(sessionId: string, title: string | null | undefined) {
      dashboardRememberSessionTitle(this, sessionId, title);
    },
    /** Add an ended local session to the Workspace recent-history list. */
    rememberRecentSession(session: LocalSession) {
      dashboardRememberRecentSession(this, session);
    },
    /** Resolve the display title for a terminal session. */
    sessionTitleFor(session: ServerSessionInfo | LocalSession | null): string {
      return dashboardSessionTitle(this, session);
    },
    /** Detach the current browser terminal while preserving reconnect metadata. */
    detachTerminal(forProjectPath?: string) {
      dashboardDetachTerminal(this, forProjectPath);
    },
    /** Reconnect the workspace to every saved backend session for this project. */
    async reconnectTerminal(): Promise<boolean> {
      return dashboardReconnectTerminal(this);
    },
    /** Create a new backend terminal session and open it in the workspace. */
    async launchInTerminal(
      prompt: string,
      runner: RunnerId = "claude",
      {
        promptLabel = null,
        presetId = null,
        cwdPath = null,
        targetPath = null,
      }: {
        promptLabel?: string | null;
        presetId?: string | null;
        cwdPath?: string | null;
        targetPath?: string | null;
      } = {},
    ) {
      await dashboardLaunchInTerminal(this, prompt, runner, {
        promptLabel,
        presetId,
        cwdPath,
        targetPath,
      });
    },
    /** Bind a browser xterm instance to a backend PTY session. */
    connectTerminal(sessionId: string, wsUrl: string) {
      dashboardConnectTerminal(this, sessionId, wsUrl);
    },
    /** End a local terminal session and release its browser bindings. */
    endSession(sessionId: string) {
      dashboardEndSession(this, sessionId);
    },
    exportSession(sessionId: string) {
      const refs = this._terminalRefs[sessionId];
      if (!refs?.xterm) return;
      const buf = refs.xterm.buffer.active;
      const lines: string[] = [];
      for (let i = 0; i < buf.length; i++) {
        const line = buf.getLine(i);
        if (line) lines.push(line.translateToString(true));
      }
      const text = lines.join("\n");
      const session = this.sessions.find(
        (s: LocalSession) => s.id === sessionId,
      );
      const runner = session?.runner ?? "terminal";
      const shortId = sessionId.slice(0, 8);
      const blob = new Blob([text], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${runner}-${shortId}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    },
    /** Exit the active terminal session from the workspace view. */
    exitTerminal() {
      dashboardExitTerminal(this);
    },
    /** Switch the workspace to an existing local terminal session. */
    switchToSession(sessionId: string) {
      dashboardSwitchToSession(this, sessionId);
    },
    /** Attach the workspace to an existing backend terminal session. */
    async openServerSession(serverSession: ServerSessionInfo) {
      await dashboardOpenServerSession(this, serverSession);
    },
    /** Terminate a backend terminal session by ID. */
    async endServerSession(sessionId: string) {
      await dashboardEndServerSession(this, sessionId);
    },

    // -- Computed Properties --
    auditDetailAgent: null as string | null,
    // -- Helpers --
    formatTimeAgo(date: string | Date | null): string {
      if (!date) return "";
      const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
      if (s < 60) return "just now";
      const m = Math.floor(s / 60);
      if (m < 60) return `${m}m ago`;
      const h = Math.floor(m / 60);
      if (h < 24) return `${h}h ago`;
      return `${Math.floor(h / 24)}d ago`;
    },
    formatAuditAge(date: string | Date | null): string {
      if (!date) return "just now";
      const s = Math.max(
        0,
        Math.floor((Date.now() - new Date(date).getTime()) / 1000),
      );
      if (s < 60) return "just now";
      const m = Math.floor(s / 60);
      if (m < 60) return `${m}m ago`;
      const h = Math.floor(m / 60);
      if (h < 72) return `${h}h ago`;
      return `${Math.floor(h / 24)}d ago`;
    },
  };
}
