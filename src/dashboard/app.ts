/**
 * Browser-side Alpine.js data model for the GOAT Flow dashboard.
 * This stays as a classic script because the dashboard shell loads it with a
 * plain `<script>` tag rather than an ES module import.
 */

type ProjectSortKey = "name" | keyof ProjectEntry;

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
    /** Optional user-supplied display titles keyed by absolute project path.
     *  Persisted alongside paths/favorites in .goat-flow/dashboard-state.json so
     *  the same repo on WIN vs WSL can carry different labels per machine. */
    projectTitles: {} as Record<string, string>,
    editingProjectTitle: false,
    projectTitleDraft: "",
    /** Resolve the display name for a project path, preferring a user override. */
    displayNameFor(path: string): string {
      const override = this.projectTitles[path];
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
    terminalSessionCount: 0,
    serverSessions: [] as ServerSessionInfo[],
    serverMaxSessions: 10,
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
    /** Return the active terminal age label. */
    get terminalAge(): string {
      return this._activeSession?.age ?? "";
    },
    /** Return the last run prompt label. */
    get lastRunPrompt(): string | null {
      return this._activeSession?.promptLabel ?? null;
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
      return this.sessions.some((s) => s.id === id);
    },
    terminalAuditActions: [
      {
        id: "audit-setup",
        label: "Audit Setup",
        command: "npx goat-flow audit .",
        description: "Run the build checks for the current workspace.",
      },
      {
        id: "audit-harness",
        label: "Audit Harness",
        command: "npx goat-flow audit . --harness",
        description: "Run AI harness completeness checks.",
      },
    ] as AuditAction[],

    // --- Projects state ---
    projectsList: [] as ProjectEntry[],
    projectsAuditing: false,
    showAddProject: false,
    projectsSortKey: "name" as ProjectSortKey,
    projectsSortAsc: true,
    newProjectPath: "",

    // --- Quality state ---
    qualityAgent: defaultRunner,
    qualityLoading: false,
    qualityResult: null as QualityResult | null,
    qualityCopyLabel: "Copy",
    qualityHistoryLoading: false,
    qualityHistoryRows: [] as QualityHistoryRow[],
    qualityHistoryLatest: null as QualityHistoryLatest | null,
    qualityHistoryWarnings: [] as string[],

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
        return { label: "Passing", color: "#4ade80" };
      if (!agentPass) return { label: "Setup failing", color: "#f87171" };
      return { label: "Harness failing", color: "#fbbf24" };
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

    // --- Launcher state ---
    presets: readInjectedPresets(),
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
    /** Move the preview selection up (-1) or down (1) in screen order, with wrap. */
    selectPresetByOffset(delta: number) {
      dashboardSelectPresetByOffset(this, delta);
    },
    /** Return the preset category filters. */
    get presetCats(): PresetCategory[] {
      return dashboardPresetCats(this);
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
    /** Run a predefined audit command in the workspace terminal. */
    async runTerminalAuditCommand(action: AuditAction | null) {
      await dashboardRunTerminalAuditCommand(this, action);
    },

    // --- Init ---
    init() {
      const self = this as typeof this & AlpineMagics<typeof this>;
      self.$watch("darkMode", (v: boolean) => {
        localStorage.setItem("gf-dark", String(v));
        document.documentElement.classList.toggle("dark", v);
      });
      self.$watch("activeView", (v: string) => {
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
        if (v === "projects" || v === "workspace" || v === "prompts") {
          void this.updateSessionCount();
        }
        if (v === "workspace") {
          this._workspacePoll = setInterval(() => {
            void this.updateSessionCount();
          }, 10_000);
        }
        if (v === "quality") {
          void this.generateQuality();
          void this.generateQualityHistory();
        }
        if (v === "setup") {
          void this.detectStack();
          void this.generateSetupPrompt();
        }
      });
      self.$watch("qualityAgent", () => {
        if (this.activeView === "quality") {
          void this.generateQuality();
          void this.generateQualityHistory();
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
            void this.generateQuality();
            void this.generateQualityHistory();
          }
        }
      });
      updateTitle();
      document.documentElement.classList.toggle("dark", this.darkMode);
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

    // -- API Calls --
    async runAudit(fresh = false) {
      this.auditing = true;
      this.toast = "";
      try {
        const freshParam = fresh ? "&fresh=true" : "";
        const res = await fetch(
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
        const res = await fetch("/api/agents/installed");
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
        if (this.supportedAgents.length === 0) {
          this.supportedAgents = agents.map(({ id, name }) => ({ id, name }));
        }
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

    // -- Setup --
    async detectStack() {
      await dashboardDetectStack(this);
    },
    /** Generate setup output for the agent selected in the setup view. */
    async generateSetupPrompt() {
      await dashboardGenerateSetupPrompt(this);
    },

    // -- Quality --
    async generateQuality() {
      await dashboardGenerateQuality(this);
    },
    /** Load persisted quality-history rows for the selected project and agent. */
    async generateQualityHistory() {
      await dashboardGenerateQualityHistory(this);
    },
    /** Copy the current quality prompt to the clipboard. */
    copyQuality() {
      dashboardCopyQuality(this);
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
    copyText(text: string) {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      // Clipboard API is preferred elsewhere; this keeps copy working in
      // browsers/contexts where programmatic clipboard writes are unavailable.
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      document.execCommand("copy");
      document.body.removeChild(el);
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
    /** End every live terminal session for the current project. */
    async endAllSessions() {
      await dashboardEndAllSessions(this);
    },
    /** Load the xterm.js globals on demand before any terminal view is rendered. */
    async loadXterm() {
      await dashboardLoadXterm(this);
    },
    /** Launch a preset prompt in the selected runner. */
    async launchPreset(prompt: string, runner?: RunnerId, label?: string) {
      await dashboardLaunchPreset(this, prompt, runner, label);
    },
    /** Drop a session id from every project's saved list, pruning empty entries. */
    _forgetSavedSession(sessionId: string) {
      dashboardForgetSavedSession(this, sessionId);
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
      }: { promptLabel?: string | null; presetId?: string | null } = {},
    ) {
      await dashboardLaunchInTerminal(this, prompt, runner, {
        promptLabel,
        presetId,
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
    auditDetailScope: null as string | null,
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
  };
}
