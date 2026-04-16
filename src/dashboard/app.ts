/**
 * Browser-side Alpine.js data model for the GOAT Flow dashboard.
 * This stays as a classic script because the dashboard shell loads it with a
 * plain `<script>` tag rather than an ES module import.
 */

type JsonRecord = Record<string, unknown>;
type ProjectSortKey = "name" | keyof ProjectEntry;

const DEFAULT_WIZARD_COMMANDS: WizardCommands = {
  test: "",
  lint: "",
  build: "",
  format: "",
};

const DEFAULT_WIZARD_AGENTS: WizardData["agents"] = {
  claude: true,
  codex: false,
  gemini: false,
};

const DEFAULT_EXISTING_ARTIFACTS: ExistingArtifacts = {
  skills: false,
  instructions: false,
  lessons: false,
  footguns: false,
  config: false,
};

const TERMINAL_REFIT_RETRY_DELAY_MS = 50;
const TERMINAL_REFIT_MAX_ATTEMPTS = 20;
const TERMINAL_INITIAL_FIT_DELAYS_MS = [50, 200, 500] as const;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(value: unknown, context: string): JsonRecord {
  if (!isRecord(value)) {
    throw new Error(`${context} returned an invalid payload`);
  }
  return value;
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function readAuditStatus(value: unknown): AuditStatus | null {
  return value === "pass" || value === "fail" ? value : null;
}

function readRunnerId(value: unknown): RunnerId | null {
  return value === "claude" || value === "codex" || value === "gemini"
    ? value
    : null;
}

function readSessionStatus(value: unknown): SessionStatus | null {
  return value === "starting" || value === "active" || value === "terminated"
    ? value
    : null;
}

function readErrorMessage(payload: JsonRecord): string | null {
  return typeof payload.error === "string" ? payload.error : null;
}

function getProjectDisplayName(path: string): string {
  return path.split("/").filter(Boolean).pop() || path;
}

function readAuditFailure(value: unknown): AuditFailure | null {
  if (!isRecord(value)) return null;
  const check = readString(value.check);
  const message = readString(value.message);
  if (!check || !message) return null;

  const failure: AuditFailure = { check, message };
  const evidence = readString(value.evidence);
  const howToFix = readString(value.howToFix);
  if (evidence) failure.evidence = evidence;
  if (howToFix) failure.howToFix = howToFix;
  return failure;
}

function readAuditCheck(value: unknown): AuditCheck | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const name = readString(value.name);
  const status = readAuditStatus(value.status);
  if (!id || !name || !status) return null;

  const check: AuditCheck = { id, name, status };
  const failure = readAuditFailure(value.failure);
  if (failure) check.failure = failure;
  return check;
}

function readStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};

  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return Object.fromEntries(entries);
}

function readAuditScope(value: unknown, context: string): AuditScope {
  const payload = readRecord(value, context);
  const status = readAuditStatus(payload.status);
  if (!status) {
    throw new Error(`${context} returned an invalid audit status`);
  }

  return {
    status,
    checks: Array.isArray(payload.checks)
      ? payload.checks
          .map((check) => readAuditCheck(check))
          .filter((check): check is AuditCheck => check !== null)
      : [],
    failures: Array.isArray(payload.failures)
      ? payload.failures
          .map((failure) => readAuditFailure(failure))
          .filter((failure): failure is AuditFailure => failure !== null)
      : [],
    summary: readStringRecord(payload.summary),
  };
}

function readAuditConcern(value: unknown): AuditConcern | null {
  if (!isRecord(value)) return null;
  const status = readAuditStatus(value.status);
  if (!status || typeof value.score !== "number") return null;

  return {
    status,
    score: value.score,
    findings: readStringArray(value.findings),
    recommendations: readStringArray(value.recommendations),
    howToFix: readStringArray(value.howToFix),
  };
}

function readAgentScore(value: unknown): AgentScore | null {
  if (!isRecord(value)) return null;
  const id = readRunnerId(value.id);
  if (!id) return null;

  const harness =
    value.harness === null
      ? null
      : value.harness === undefined
        ? null
        : readAuditScope(value.harness, "Audit response harness scope");

  const concerns =
    value.concerns === null
      ? null
      : isRecord(value.concerns)
        ? Object.fromEntries(
            Object.entries(value.concerns)
              .map(
                ([key, concern]) => [key, readAuditConcern(concern)] as const,
              )
              .filter(
                (entry): entry is [string, AuditConcern] => entry[1] !== null,
              ),
          )
        : null;

  return {
    id,
    name: readString(value.name, id),
    agent: readAuditScope(value.agent, "Audit response agent scope"),
    harness,
    concerns,
  };
}

function readDashboardReport(value: unknown): DashboardClientReport {
  const payload = readRecord(value, "Audit response");
  const status = readAuditStatus(payload.status);
  if (!status) {
    throw new Error("Audit response returned an invalid status");
  }

  const scopesPayload = readRecord(payload.scopes, "Audit response scopes");
  const overallPayload = readRecord(payload.overall, "Audit response overall");
  const overallStatus = readAuditStatus(overallPayload.status);
  if (!overallStatus) {
    throw new Error("Audit response returned an invalid overall status");
  }

  return {
    agentScores: Array.isArray(payload.agentScores)
      ? payload.agentScores
          .map((score) => readAgentScore(score))
          .filter((score): score is AgentScore => score !== null)
      : [],
    status,
    scopes: {
      setup: readAuditScope(scopesPayload.setup, "Audit response setup scope"),
      agent: readAuditScope(scopesPayload.agent, "Audit response agent scope"),
      ...(scopesPayload.harness
        ? {
            harness: readAuditScope(
              scopesPayload.harness,
              "Audit response harness scope",
            ),
          }
        : {}),
    },
    overall: { status: overallStatus },
    target: readString(payload.target),
  };
}

function readInjectedReport(): DashboardClientReport | null {
  if (window.__GOAT_FLOW_REPORT__ == null) return null;
  try {
    return readDashboardReport(window.__GOAT_FLOW_REPORT__);
  } catch {
    return null;
  }
}

function readAgentInfo(value: unknown): AgentInfo | null {
  if (!isRecord(value)) return null;
  const id = readRunnerId(value.id);
  if (!id || typeof value.installed !== "boolean") return null;

  return {
    id,
    installed: value.installed,
    version: typeof value.version === "string" ? value.version : null,
  };
}

function readBrowseDir(value: unknown): BrowseDir | null {
  if (!isRecord(value)) return null;
  const name = readString(value.name);
  const path = readString(value.path);
  if (!name || !path || typeof value.isProject !== "boolean") return null;

  return { name, path, isProject: value.isProject };
}

function readProjectEntry(value: unknown): ProjectEntry | null {
  if (!isRecord(value)) return null;
  const path = readString(value.path);
  if (!path) return null;

  return {
    path,
    state: readString(value.state),
    action: readString(value.action),
    details: readString(value.details),
  };
}

function readServerSessionInfo(value: unknown): ServerSessionInfo | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const status = readSessionStatus(value.status);
  const runner = readRunnerId(value.runner);
  const createdAt = readString(value.createdAt);
  const projectPath = readString(value.projectPath);
  if (
    !id ||
    !status ||
    !runner ||
    !createdAt ||
    !projectPath ||
    typeof value.lastInputAt !== "number"
  ) {
    return null;
  }

  return {
    id,
    status,
    createdAt,
    projectPath,
    runner,
    lastInputAt: value.lastInputAt,
    age: typeof value.age === "number" ? value.age : undefined,
    idleDuration:
      typeof value.idleDuration === "number" ? value.idleDuration : undefined,
    projectName: readString(value.projectName) || undefined,
  };
}

function readCritiqueResult(value: unknown): CritiqueResult {
  const payload = readRecord(value, "Critique response");
  const agent = readRunnerId(payload.agent);
  const auditStatus = readAuditStatus(payload.auditStatus);
  const command = readString(payload.command);
  if (
    !agent ||
    (!auditStatus && payload.auditStatus !== "unavailable") ||
    command !== "critique"
  ) {
    throw new Error("Critique response returned an invalid payload");
  }

  return {
    command: "critique",
    agent,
    auditStatus: auditStatus ?? "unavailable",
    auditSummary: readString(payload.auditSummary),
    prompt: readString(payload.prompt),
  };
}

function readStoredStringArray(key: string): string[] {
  try {
    return readStringArray(JSON.parse(localStorage.getItem(key) || "[]"));
  } catch {
    return [];
  }
}

function getXtermConstructors(): {
  Terminal: NonNullable<Window["Terminal"]>;
  FitAddon: new () => FitAddonInstance;
} {
  const Terminal = window.Terminal;
  const FitAddon = window.FitAddon?.FitAddon;
  if (!Terminal || !FitAddon) {
    throw new Error("xterm.js globals unavailable after load");
  }
  return { Terminal, FitAddon };
}

/** Alpine.js data factory for the dashboard shell. */
function app() {
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
    installedAgents: [] as AgentInfo[],
    allAgents: [] as AgentInfo[],
    activeRunner: "claude" as RunnerId,
    userRole: "",
    workspacePanel: "prompts",
    sidebarCollapsed: false,
    get projectName(): string {
      return (
        this.projectPath.split("/").filter(Boolean).pop() || this.projectPath
      );
    },
    /** Keep a stable accent color per project so quick switches stay visually anchored. */
    get projectColor(): string {
      const name = this.projectName;
      let hash = 0;
      for (let i = 0; i < name.length; i++)
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
      const hue = Math.abs(hash) % 360;
      return `hsl(${hue}, 60%, 50%)`;
    },
    showBrowser: false,
    browserCurrent: "",
    browserParent: "",
    browserDirs: [] as BrowseDir[],

    lastAuditTime: null as Date | null,

    // --- Audit detail state ---
    selectedFixes: [] as string[],
    fixCopyLabel: "Copy fixes",

    // --- Terminal state ---
    terminalAvailable: false,
    terminalSessionCount: 0,
    serverSessions: [] as ServerSessionInfo[],
    showMaxSessionsModal: false,
    sessions: [] as LocalSession[],
    activeSessionId: null as string | null,
    selectedPreset: null as string | null,
    promptRunStates: {} as Record<string, string>,
    launching: false,
    availableRunners: [] as RunnerId[],
    // Project switches intentionally preserve backend sessions so returning to a workspace
    // can reattach instead of spawning a fresh agent process.
    _projectSessions: {} as Record<string, SavedSession>,
    _terminalRefs: {} as Record<string, TerminalRefs>,
    _xtermLoaded: false,
    // detachTerminal() flips this while it closes browser-side sockets so ws.onclose only
    // marks sessions ended when the runner actually exits on the backend.
    _detaching: false,
    get _activeSession(): LocalSession | null {
      return this.sessions.find((s) => s.id === this.activeSessionId) || null;
    },
    get terminalSessionId(): string | null {
      return this._activeSession?.id ?? null;
    },
    get terminalConnected(): boolean {
      return this._activeSession?.connected ?? false;
    },
    get terminalEnded(): boolean {
      return this._activeSession?.ended ?? false;
    },
    get terminalAge(): string {
      return this._activeSession?.age ?? "";
    },
    get lastRunPrompt(): string | null {
      return this._activeSession?.promptLabel ?? null;
    },
    get lastRunAgent(): RunnerId | null {
      return this._activeSession?.runner ?? null;
    },
    get _terminalWs(): WebSocket | undefined {
      return this._terminalRefs[this.activeSessionId ?? ""]?.ws;
    },
    get _terminalXterm(): XTermInstance | undefined {
      return this._terminalRefs[this.activeSessionId ?? ""]?.xterm;
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

    // --- Critique state ---
    critiqueAgent: "claude" as RunnerId,
    critiqueLoading: false,
    critiqueResult: null as CritiqueResult | null,
    critiqueCopyLabel: "Copy",

    // --- Wizard state ---
    wizardDetecting: false,
    wizardSelectedAgent: "claude" as RunnerId,
    wizardData: {
      languages: [],
      frameworks: [],
      commands: { ...DEFAULT_WIZARD_COMMANDS },
      agents: { ...DEFAULT_WIZARD_AGENTS },
      existing: { ...DEFAULT_EXISTING_ARTIFACTS },
      nonGoatFlow: [],
    } as WizardData,
    wizardGenerating: false,
    wizardSetupOutputs: {} as Record<string, string>,

    // --- Launcher state ---
    presets: PRESETS,
    presetFilter: "all",
    presetSearch: "",
    presetFavorites: readStoredStringArray("goat-flow-preset-favorites"),
    toggleFavorite(id: string) {
      const idx = this.presetFavorites.indexOf(id);
      if (idx === -1) this.presetFavorites.push(id);
      else this.presetFavorites.splice(idx, 1);
      localStorage.setItem(
        "goat-flow-preset-favorites",
        JSON.stringify(this.presetFavorites),
      );
    },
    isFavorite(id: string): boolean {
      return this.presetFavorites.includes(id);
    },
    get presetCats(): Array<{ id: string; label: string }> {
      const cats = new Map<string, string>();
      for (const p of this.presets)
        if (!cats.has(p.cat))
          cats.set(p.cat, p.cat.charAt(0).toUpperCase() + p.cat.slice(1));
      return [
        { id: "all", label: "All" },
        { id: "favorites", label: "\u2605 Favorites" },
        ...Array.from(cats, ([id, label]) => ({ id, label })),
      ];
    },
    /**
     * Favorites stay pinned to the top unless the user explicitly switches into
     * the favorites-only filter, which keeps mixed browsing fast on large lists.
     */
    get filteredPresets(): Preset[] {
      let list: Preset[];
      if (this.presetFilter === "favorites") {
        list = this.presets.filter((p) => this.presetFavorites.includes(p.id));
      } else {
        list =
          this.presetFilter === "all"
            ? this.presets
            : this.presets.filter((p) => p.cat === this.presetFilter);
      }
      if (this.presetSearch.trim()) {
        const q = this.presetSearch.toLowerCase();
        list = list.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.desc.toLowerCase().includes(q) ||
            p.prompt.toLowerCase().includes(q),
        );
      } else if (this.presetFilter !== "favorites") {
        const favSet = new Set(this.presetFavorites);
        list = [
          ...list.filter((p) => favSet.has(p.id)),
          ...list.filter((p) => !favSet.has(p.id)),
        ];
      }
      return list;
    },
    adaptPrompt(prompt: string): string {
      if (this.activeRunner === "codex")
        return prompt.replace(/^\/goat\b/, "$goat");
      return prompt;
    },
    copyPreset(prompt: string) {
      this.copyText(this.adaptPrompt(prompt));
    },
    sendToTerminal(
      text: string,
      { adapt = true }: { adapt?: boolean } = {},
    ): boolean {
      const active = this._activeSession;
      if (!active) {
        this.showToast("No active terminal session", true);
        return false;
      }
      const refs = active ? this._terminalRefs[active.id] : null;
      if (!refs?.ws || refs.ws.readyState !== WebSocket.OPEN) {
        this.showToast("No active terminal session", true);
        return false;
      }
      const prepared = adapt ? this.adaptPrompt(text) : text;
      // Bracketed paste prevents shells and REPLs from treating multi-line prompts as
      // a stream of independent keystrokes. `\x1b[200~` starts paste mode, `\x1b[201~`
      // ends it, and the trailing carriage return submits exactly once.
      const pasteData = "\x1b[200~" + prepared + "\x1b[201~" + "\r";
      refs.ws.send(JSON.stringify({ type: "input", data: pasteData }));
      active.lastInputTime = Date.now();
      if (refs.xterm) refs.xterm.focus();
      return true;
    },
    async runTerminalAuditCommand(action: AuditAction | null) {
      if (!action?.command) return;
      this.activeView = "workspace";
      this.workspacePanel = "terminal";
      if (this.terminalSessionId && !this.terminalEnded) {
        if (this.sendToTerminal(action.command, { adapt: false })) {
          this.showToast(`Sent ${action.command} to terminal`);
        }
        return;
      }
      await this.launchInTerminal(action.command, this.activeRunner, {
        promptLabel: action.label,
      });
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
        const poll = (attempts = 0): void => {
          if (attempts > TERMINAL_REFIT_MAX_ATTEMPTS) return;
          requestAnimationFrame(() => {
            if (!refit()) {
              setTimeout(
                () => poll(attempts + 1),
                TERMINAL_REFIT_RETRY_DELAY_MS,
              );
            }
          });
        };
        self.$nextTick(() => poll());
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
        self.$nextTick(() => {
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
        if (v === "projects") this.updateSessionCount();
      });
      const updateTitle = (): void => {
        document.title = `${this.projectName} | GOAT Flow`;
      };
      self.$watch("projectPath", (newPath: string, oldPath: string) => {
        updateTitle();
        if (oldPath && newPath !== oldPath) {
          this.detachTerminal(oldPath);
          this.reconnectTerminal();
          this.updateSessionCount();
        }
      });
      updateTitle();
      document.documentElement.classList.toggle("dark", this.darkMode);
      this._loadSavedProjects().then(() => {
        if (this.projectsList.length > 0) this.auditAllProjects();
      });
      if (location.protocol === "http:" || location.protocol === "https:") {
        this.runAudit();
        this.checkTerminalAvailable();
        fetch("/api/agents/installed")
          .then((r) => r.json())
          .then((payload) => {
            const data = readRecord(payload, "Agent detection response");
            const agents = Array.isArray(data.agents)
              ? data.agents
                  .map((agent) => readAgentInfo(agent))
                  .filter((agent): agent is AgentInfo => agent !== null)
              : [];
            this.allAgents = agents;
            this.installedAgents = agents.filter((a) => a.installed);
            if (
              this.installedAgents.length > 0 &&
              !this.installedAgents.find((a) => a.id === this.activeRunner)
            ) {
              const [firstInstalled] = this.installedAgents;
              if (firstInstalled) this.activeRunner = firstInstalled.id;
            }
          })
          .catch(() => {});
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
          e.preventDefault();
          const searchInput = self.$refs.presetSearchInput;
          if (searchInput instanceof HTMLInputElement) {
            this.activeView = "workspace";
            self.$nextTick(() => searchInput.focus());
          }
        }
      });
    },

    // -- API Calls --
    async runAudit() {
      this.auditing = true;
      this.toast = "";
      try {
        const res = await fetch(
          `/api/audit?path=${encodeURIComponent(this.projectPath)}&quality=true`,
        );
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const payload = readRecord(await res.json(), "Audit response");
        const error = readErrorMessage(payload);
        if (error) throw new Error(error);
        this.report = readDashboardReport(payload);
        this.lastAuditTime = new Date();
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
    },
    async openBrowser() {
      this.showBrowser = !this.showBrowser;
      if (this.showBrowser) await this.browseTo(this.projectPath);
    },
    async browseTo(path: string) {
      try {
        const res = await fetch(`/api/browse?path=${encodeURIComponent(path)}`);
        const payload = readRecord(await res.json(), "Browse response");
        const error = readErrorMessage(payload);
        if (error) {
          this.showToast(error, true);
          return;
        }
        this.browserCurrent = readString(payload.current);
        this.browserParent = readString(payload.parent);
        this.browserDirs = Array.isArray(payload.dirs)
          ? payload.dirs
              .map((dir) => readBrowseDir(dir))
              .filter((dir): dir is BrowseDir => dir !== null)
          : [];
      } catch {
        this.showToast("Browse failed", true);
      }
    },
    selectDir(dir: BrowseDir) {
      if (dir.isProject) {
        this.projectPath = dir.path;
        this.showBrowser = false;
        this.runAudit();
      } else this.browseTo(dir.path);
    },

    // -- Wizard --
    async detectStack() {
      this.wizardDetecting = true;
      try {
        const res = await fetch(
          `/api/setup/detect?path=${encodeURIComponent(this.projectPath)}`,
        );
        const payload = readRecord(
          await res.json(),
          "Setup detection response",
        );
        const error = readErrorMessage(payload);
        if (error) {
          this.showToast(error, true);
          this.wizardDetecting = false;
          return;
        }
        const commands = isRecord(payload.commands) ? payload.commands : {};
        const agents = isRecord(payload.agents) ? payload.agents : {};
        const existing = isRecord(payload.existing) ? payload.existing : {};
        this.wizardData.languages = readStringArray(payload.languages);
        this.wizardData.frameworks = readStringArray(payload.frameworks);
        this.wizardData.commands = {
          test: readString(commands.test),
          lint: readString(commands.lint),
          build: readString(commands.build),
          format: readString(commands.format),
        };
        this.wizardData.agents = {
          claude:
            typeof agents.claude === "boolean"
              ? agents.claude
              : DEFAULT_WIZARD_AGENTS.claude,
          codex:
            typeof agents.codex === "boolean"
              ? agents.codex
              : DEFAULT_WIZARD_AGENTS.codex,
          gemini:
            typeof agents.gemini === "boolean"
              ? agents.gemini
              : DEFAULT_WIZARD_AGENTS.gemini,
        };
        if (!Object.values(this.wizardData.agents).some((v) => v))
          this.wizardData.agents.claude = true;
        this.wizardData.existing = {
          skills:
            typeof existing.skills === "boolean"
              ? existing.skills
              : DEFAULT_EXISTING_ARTIFACTS.skills,
          instructions:
            typeof existing.instructions === "boolean"
              ? existing.instructions
              : DEFAULT_EXISTING_ARTIFACTS.instructions,
          lessons:
            typeof existing.lessons === "boolean"
              ? existing.lessons
              : DEFAULT_EXISTING_ARTIFACTS.lessons,
          footguns:
            typeof existing.footguns === "boolean"
              ? existing.footguns
              : DEFAULT_EXISTING_ARTIFACTS.footguns,
          config:
            typeof existing.config === "boolean"
              ? existing.config
              : DEFAULT_EXISTING_ARTIFACTS.config,
        };
        this.wizardData.nonGoatFlow = readStringArray(payload.nonGoatFlow);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.showToast(msg || "Detection failed", true);
      }
      this.wizardDetecting = false;
    },
    async generateWizardSetup() {
      this.wizardGenerating = true;
      this.wizardSetupOutputs = {};
      const agent = this.wizardSelectedAgent;
      try {
        const res = await fetch(
          `/api/setup?path=${encodeURIComponent(this.projectPath)}&agent=${agent}`,
        );
        const payload = readRecord(await res.json(), "Setup response");
        const error = readErrorMessage(payload);
        if (error) {
          this.showToast(`${agent}: ${error}`, true);
        } else {
          this.wizardSetupOutputs[agent] =
            readString(payload.output) || "No output generated.";
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.showToast(msg || "Generation failed", true);
      }
      this.wizardGenerating = false;
    },

    // -- Critique --
    async generateCritique() {
      this.critiqueLoading = true;
      this.critiqueResult = null;
      this.critiqueCopyLabel = "Copy";
      try {
        const res = await fetch(
          `/api/critique?path=${encodeURIComponent(this.projectPath)}&agent=${encodeURIComponent(this.critiqueAgent)}`,
        );
        const payload = readRecord(await res.json(), "Critique response");
        const error = readErrorMessage(payload);
        if (error) {
          this.showToast(error, true);
        } else {
          this.critiqueResult = readCritiqueResult(payload);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.showToast(msg || "Critique generation failed", true);
      }
      this.critiqueLoading = false;
    },
    copyCritique() {
      if (!this.critiqueResult?.prompt) return;
      this.copyText(this.critiqueResult.prompt);
      this.critiqueCopyLabel = "Copied!";
      setTimeout(() => (this.critiqueCopyLabel = "Copy"), 2000);
    },

    // -- Projects --
    async addProject() {
      if (!this.newProjectPath) return;
      if (this.projectsList.some((p) => p.path === this.newProjectPath)) {
        this.showAddProject = false;
        this.newProjectPath = "";
        return;
      }
      this.projectsList.push({
        path: this.newProjectPath,
        state: "...",
        action: "...",
        details: "Auditing...",
      });
      this.showAddProject = false;
      try {
        const res = await fetch(
          `/api/projects/status?paths=${encodeURIComponent(this.newProjectPath)}`,
        );
        const payload = readRecord(await res.json(), "Project status response");
        const result = Array.isArray(payload.projects)
          ? readProjectEntry(payload.projects[0])
          : null;
        if (result) {
          const idx = this.projectsList.findIndex(
            (p) => p.path === this.newProjectPath || p.path === result.path,
          );
          if (idx >= 0) this.projectsList[idx] = result;
        }
      } catch {
        /* silent */
      }
      this.newProjectPath = "";
      this._saveProjectsList();
    },
    removeProject(path: string) {
      this.projectsList = this.projectsList.filter((p) => p.path !== path);
      this._saveProjectsList();
    },
    sortProjects(key: ProjectSortKey) {
      if (this.projectsSortKey === key) {
        this.projectsSortAsc = !this.projectsSortAsc;
      } else {
        this.projectsSortKey = key;
        this.projectsSortAsc = true;
      }
    },
    /** Sort projects by visible columns while keeping the derived "name" column first-class. */
    get sortedProjectsList(): ProjectEntry[] {
      if (!this.projectsSortKey) return this.projectsList;
      const key = this.projectsSortKey;
      const dir = this.projectsSortAsc ? 1 : -1;
      return [...this.projectsList].sort((a, b) => {
        const av = key === "name" ? getProjectDisplayName(a.path) : a[key];
        const bv = key === "name" ? getProjectDisplayName(b.path) : b[key];
        return av.localeCompare(bv) * dir;
      });
    },
    async auditAllProjects() {
      this.projectsAuditing = true;
      try {
        const paths = this.projectsList.map((p) => p.path).join(",");
        const res = await fetch(
          `/api/projects/status?paths=${encodeURIComponent(paths)}`,
        );
        const payload = readRecord(await res.json(), "Project status response");
        if (Array.isArray(payload.projects)) {
          this.projectsList = payload.projects
            .map((project) => readProjectEntry(project))
            .filter((project): project is ProjectEntry => project !== null);
        }
      } catch {
        /* silent */
      }
      this.projectsAuditing = false;
    },
    async _loadSavedProjects() {
      let saved: string[] = [];
      try {
        const res = await fetch("/api/projects/list");
        const payload = readRecord(await res.json(), "Projects list response");
        const paths = readStringArray(payload.paths);
        if (paths.length > 0) {
          saved = paths;
        }
      } catch {
        /* server unavailable */
      }
      if (saved.length === 0) {
        saved = readStoredStringArray("goat-flow-projects");
      }
      const launchPath = window.__GOAT_FLOW_DEFAULT_PATH__;
      if (launchPath && !saved.includes(launchPath)) {
        saved.unshift(launchPath);
      }
      if (saved.length > 0) {
        this.projectsList = saved.map((path) => ({
          path,
          state: "...",
          action: "...",
          details: "Not audited",
        }));
        this._saveProjectsList();
      }
    },
    _saveProjectsList() {
      const paths = [...new Set(this.projectsList.map((p) => p.path))];
      localStorage.setItem("goat-flow-projects", JSON.stringify(paths));
      fetch("/api/projects/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths }),
      }).catch(() => {});
    },

    // -- Clipboard + Toast --
    copyText(text: string) {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      this.copyLabel = "Copied!";
      setTimeout(() => (this.copyLabel = "Copy"), 2000);
    },
    showToast(msg: string, isError?: boolean) {
      this.toast = msg;
      this.toastError = isError ?? false;
      setTimeout(() => (this.toast = ""), 4000);
    },

    // -- Terminal --
    async checkTerminalAvailable() {
      try {
        const res = await fetch("/api/health");
        if (res.ok) {
          const payload = readRecord(await res.json(), "Health response");
          this.availableRunners = Array.isArray(payload.availableRunners)
            ? payload.availableRunners
                .map((runner) => readRunnerId(runner))
                .filter((runner): runner is RunnerId => runner !== null)
            : [];
          this.terminalAvailable =
            payload.nodePtyAvailable === true &&
            this.availableRunners.length > 0;
          const [firstRunner] = this.availableRunners;
          if (firstRunner) this.activeRunner = firstRunner;
        }
      } catch {
        this.terminalAvailable = false;
      }
      this.updateSessionCount();
    },
    async updateSessionCount() {
      try {
        const res = await fetch("/api/terminal/sessions");
        const payload = readRecord(
          await res.json(),
          "Terminal sessions response",
        );
        this.terminalSessionCount =
          typeof payload.activeCount === "number" ? payload.activeCount : 0;
        this.serverSessions = Array.isArray(payload.sessions)
          ? payload.sessions
              .map((session) => readServerSessionInfo(session))
              .filter(
                (session): session is ServerSessionInfo => session !== null,
              )
              .map((session) => ({
                ...session,
                projectName:
                  session.projectName ||
                  getProjectDisplayName(session.projectPath),
              }))
          : [];
      } catch {
        /* ignore */
      }
    },
    async endAllSessions() {
      try {
        const res = await fetch("/api/terminal/sessions");
        const payload = readRecord(
          await res.json(),
          "Terminal sessions response",
        );
        const sessions = Array.isArray(payload.sessions)
          ? payload.sessions
              .map((session) => readServerSessionInfo(session))
              .filter(
                (session): session is ServerSessionInfo => session !== null,
              )
          : [];
        for (const session of sessions) {
          await fetch(`/api/terminal/${session.id}`, { method: "DELETE" });
        }
        for (const id of Object.keys(this._terminalRefs)) {
          const refs = this._terminalRefs[id];
          if (refs?.cleanup) refs.cleanup();
        }
        this._terminalRefs = {};
        this._projectSessions = {};
        this.sessions = [];
        this.activeSessionId = null;
        for (const [presetId, state] of Object.entries(this.promptRunStates)) {
          if (state === "running") this.promptRunStates[presetId] = "pass";
        }
        await this.updateSessionCount();
        this.showToast("All sessions ended");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.showToast("Failed to end sessions: " + msg, true);
      }
    },
    /** Load the xterm.js globals on demand before any terminal view is rendered. */
    async loadXterm() {
      if (this._xtermLoaded) return;
      await new Promise<void>((resolve, reject) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href =
          "https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css";
        document.head.appendChild(link);
        // The fit addon patches the global Terminal constructor, so xterm itself
        // has to finish loading before the addon script is appended.
        const script = document.createElement("script");
        script.src =
          "https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js";
        script.onerror = () => reject(new Error("xterm.js load failed"));
        const timer = setTimeout(
          () => reject(new Error("xterm.js load timeout")),
          5000,
        );
        script.onload = () => {
          clearTimeout(timer);
          resolve();
        };
        document.head.appendChild(script);
      });
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src =
          "https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js";
        const timer = setTimeout(
          () => reject(new Error("fit addon load timeout")),
          5000,
        );
        script.onload = () => {
          clearTimeout(timer);
          resolve();
        };
        script.onerror = () => reject(new Error("fit addon load failed"));
        document.head.appendChild(script);
      });
      getXtermConstructors();
      this._xtermLoaded = true;
    },
    async launchPreset(prompt: string, runner?: RunnerId) {
      if (this.launching) return;
      const preset = this.presets.find(
        (p) => this.adaptPrompt(p.prompt) === this.adaptPrompt(prompt),
      );
      const promptLabel = preset?.name || "Custom prompt";
      const presetId = preset?.id || null;
      const runnerResolved = runner || this.activeRunner;
      if (presetId) this.promptRunStates[presetId] = "running";
      let adapted = this.adaptPrompt(prompt);
      if (this.userRole === "investigator") {
        adapted =
          "You are in investigator mode. Read-only - investigate, plan, and review only. Do NOT make any code changes.\n\n" +
          adapted;
      } else if (this.userRole === "tester") {
        adapted =
          "You are in tester mode. Test-focused - generate test plans, verify coverage, run QA analysis. Do NOT make code changes beyond test files.\n\n" +
          adapted;
      }
      await this.launchInTerminal(adapted, runnerResolved, {
        promptLabel,
        presetId,
      });
    },
    /**
     * Drop the current browser-side terminal bindings while keeping enough metadata
     * to reconnect when the user switches back to the same project.
     */
    detachTerminal(forProjectPath?: string) {
      this._detaching = true;
      const savePath = forProjectPath || this.projectPath;
      const active = this._activeSession;
      if (active && !active.ended) {
        this._projectSessions[savePath] = {
          sessionId: active.id,
          startTime: active.startTime,
          prompt: active.promptLabel,
          agent: active.runner,
        };
      }
      for (const id of Object.keys(this._terminalRefs)) {
        const refs = this._terminalRefs[id];
        if (refs?.cleanup) refs.cleanup();
      }
      this._terminalRefs = {};
      this.sessions = [];
      this.activeSessionId = null;
      this.promptRunStates = {};
      this._detaching = false;
    },
    /**
     * Reattach to a live backend session that was previously detached during a
     * project switch instead of creating a fresh runner process.
     */
    async reconnectTerminal(): Promise<boolean> {
      const saved = this._projectSessions[this.projectPath];
      if (!saved) return false;
      let alive: ServerSessionInfo | null = null;
      try {
        const res = await fetch("/api/terminal/sessions");
        const payload = readRecord(
          await res.json(),
          "Terminal sessions response",
        );
        alive = Array.isArray(payload.sessions)
          ? (payload.sessions
              .map((session) => readServerSessionInfo(session))
              .filter(
                (session): session is ServerSessionInfo => session !== null,
              )
              .find((session) => session.id === saved.sessionId) ?? null)
          : null;
        if (!alive) {
          delete this._projectSessions[this.projectPath];
          return false;
        }
      } catch {
        delete this._projectSessions[this.projectPath];
        return false;
      }
      const self = this as typeof this & AlpineMagics<typeof this>;
      await this.loadXterm();
      const session: LocalSession = {
        id: saved.sessionId,
        runner: saved.agent,
        promptLabel: saved.prompt,
        projectPath: this.projectPath,
        startTime: saved.startTime,
        lastInputTime: alive.lastInputAt,
        connected: false,
        ended: false,
        age: "",
        presetId: null,
      };
      this.sessions.push(session);
      this._terminalRefs[session.id] = {};
      this.activeSessionId = session.id;
      this.activeView = "workspace";
      this.workspacePanel = "terminal";
      await self.$nextTick();
      this.connectTerminal(session.id, `/ws/terminal/${saved.sessionId}`);
      this.updateSessionCount();
      return true;
    },
    /**
     * Create a new backend terminal session and make it the active workspace tab.
     * Callers can pass a custom label so reconnect logic preserves the user-facing context.
     */
    async launchInTerminal(
      prompt: string,
      runner: RunnerId = "claude",
      {
        promptLabel = null,
        presetId = null,
      }: { promptLabel?: string | null; presetId?: string | null } = {},
    ) {
      if (this.sessions.length >= 3) {
        this.showMaxSessionsModal = true;
        return;
      }
      this.launching = true;
      try {
        const self = this as typeof this & AlpineMagics<typeof this>;
        await this.loadXterm();
        const res = await fetch("/api/terminal/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            projectPath: this.projectPath,
            runner,
          }),
        });
        const payload = readRecord(
          await res.json(),
          "Terminal create response",
        );
        const error = readErrorMessage(payload);
        if (error) throw new Error(error);
        const id = readString(payload.id);
        const wsUrl = readString(payload.wsUrl);
        if (!id || !wsUrl) {
          throw new Error(
            "Terminal create response returned an invalid payload",
          );
        }
        const session: LocalSession = {
          id,
          runner,
          promptLabel: promptLabel || "Custom prompt",
          projectPath: this.projectPath,
          startTime: Date.now(),
          lastInputTime: Date.now(),
          connected: false,
          ended: false,
          age: "",
          presetId,
        };
        this.sessions.push(session);
        this._terminalRefs[session.id] = {};
        this.activeSessionId = session.id;
        this.activeView = "workspace";
        this.workspacePanel = "terminal";
        await self.$nextTick();
        this.connectTerminal(session.id, wsUrl);
        this.updateSessionCount();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("Maximum") || msg.includes("concurrent")) {
          this.showMaxSessionsModal = true;
        } else {
          this.showToast(msg, true);
        }
      }
      this.launching = false;
    },
    /**
     * Bind a rendered terminal container to a backend PTY session over WebSocket.
     * The returned Alpine object must stay plain so Alpine can wrap it in a reactive proxy.
     */
    connectTerminal(sessionId: string, wsUrl: string) {
      const session = this.sessions.find((s) => s.id === sessionId);
      if (!session) return;
      const container = document.getElementById(`gf-terminal-${sessionId}`);
      if (!container) return;
      container.innerHTML = "";
      let TerminalCtor: NonNullable<Window["Terminal"]>;
      let FitAddonCtor: new () => FitAddonInstance;
      try {
        const constructors = getXtermConstructors();
        TerminalCtor = constructors.Terminal;
        FitAddonCtor = constructors.FitAddon;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.showToast(msg, true);
        return;
      }
      const term = new TerminalCtor({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        theme: {
          background: "#0f1729",
          foreground: "#f3f4f6",
          cursor: "#f3f4f6",
        },
      });
      const fitAddon = new FitAddonCtor();
      term.loadAddon(fitAddon);
      term.open(container);
      term._addonFit = fitAddon;
      const doFit = (): void => {
        if (!container.offsetWidth) return;
        fitAddon.fit();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: "resize",
              cols: term.cols,
              rows: term.rows,
            }),
          );
        }
      };
      // Alpine transitions, font loading, and mobile panel swaps can each land on different
      // layout frames. These staggered fits catch the collapsed-first-render case before the
      // backend locks in the wrong terminal size.
      for (const delay of TERMINAL_INITIAL_FIT_DELAYS_MS) {
        setTimeout(doFit, delay);
      }
      const ro = new ResizeObserver(() => {
        doFit();
      });
      ro.observe(container);
      const resizeHandler = (): void => {
        doFit();
      };
      window.addEventListener("resize", resizeHandler);
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${proto}//${location.host}${wsUrl}`);
      let ageInterval: ReturnType<typeof setInterval> | null = null;
      ws.onopen = () => {
        session.connected = true;
        setTimeout(doFit, TERMINAL_REFIT_RETRY_DELAY_MS);
        if (ageInterval) clearInterval(ageInterval);
        ageInterval = setInterval(() => {
          if (session.ended) {
            if (ageInterval) clearInterval(ageInterval);
            session.age = "";
            return;
          }
          const elapsed = Math.floor((Date.now() - session.startTime) / 1000);
          const mins = Math.floor(elapsed / 60);
          const hrs = Math.floor(mins / 60);
          let age: string;
          if (hrs > 0) age = `Running ${hrs}h ${mins % 60}m`;
          else age = `Running ${mins}m`;
          if (session.lastInputTime) {
            const idleSecs = Math.floor(
              (Date.now() - session.lastInputTime) / 1000,
            );
            const idleMins = Math.floor(idleSecs / 60);
            if (idleMins >= 58) {
              age = `Running ${mins}m | Timeout in ${60 - idleMins}m`;
            } else if (idleMins >= 50) {
              age += ` | Idle ${idleMins}m`;
            }
          }
          session.age = age;
        }, 30000);
        if (this._terminalRefs[sessionId]) {
          this._terminalRefs[sessionId].ageInterval = ageInterval ?? undefined;
        }
      };
      ws.onmessage = (event: MessageEvent) => {
        try {
          if (typeof event.data !== "string") return;
          const msg = readRecord(JSON.parse(event.data), "Terminal message");
          const type = readString(msg.type);
          if (type === "output" && typeof msg.data === "string") {
            term.write(msg.data);
          } else if (type === "exit") {
            session.ended = true;
            session.connected = false;
            for (const [path, sv] of Object.entries(this._projectSessions)) {
              if (sv.sessionId === sessionId)
                delete this._projectSessions[path];
            }
            if (
              session.presetId &&
              this.promptRunStates[session.presetId] === "running"
            ) {
              this.promptRunStates[session.presetId] = "pass";
            }
            this.updateSessionCount();
          } else if (type === "error" && typeof msg.message === "string") {
            term.write(`\r\n\x1b[31m${msg.message}\x1b[0m\r\n`);
          } else if (type === "shutdown") {
            session.ended = true;
            session.connected = false;
          }
        } catch {
          /* ignore malformed messages */
        }
      };
      ws.onclose = () => {
        session.connected = false;
        if (!session.ended && !this._detaching) session.ended = true;
      };
      ws.onerror = () => {
        session.connected = false;
      };
      term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
        if (e.type === "keydown" && e.ctrlKey && e.key === "v") {
          navigator.clipboard
            .readText()
            .then((text) => {
              if (text && ws.readyState === WebSocket.OPEN)
                ws.send(JSON.stringify({ type: "input", data: text }));
            })
            .catch(() => {});
          return false;
        }
        if (
          e.type === "keydown" &&
          e.ctrlKey &&
          e.key === "c" &&
          term.hasSelection()
        ) {
          navigator.clipboard.writeText(term.getSelection()).catch(() => {});
          return false;
        }
        return true;
      });
      term.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: "input", data }));
        session.lastInputTime = Date.now();
      });
      term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
        if (ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: "resize", cols, rows }));
      });
      const cleanup = (): void => {
        ro.disconnect();
        window.removeEventListener("resize", resizeHandler);
        if (ageInterval) clearInterval(ageInterval);
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        try {
          term.dispose();
        } catch {
          /* ignore */
        }
      };
      this._terminalRefs[sessionId] = {
        ws,
        xterm: term,
        cleanup,
        ageInterval: ageInterval ?? undefined,
      };
      term.focus();
    },
    endSession(sessionId: string) {
      const session = this.sessions.find((s) => s.id === sessionId);
      if (!session) return;
      if (
        session.presetId &&
        this.promptRunStates[session.presetId] === "running"
      ) {
        this.promptRunStates[session.presetId] = "pass";
      }
      if (!session.ended) {
        fetch(`/api/terminal/${sessionId}`, { method: "DELETE" }).catch(
          () => {},
        );
      }
      const refs = this._terminalRefs[sessionId];
      if (refs?.cleanup) refs.cleanup();
      delete this._terminalRefs[sessionId];
      this.sessions = this.sessions.filter((s) => s.id !== sessionId);
      for (const [path, sv] of Object.entries(this._projectSessions)) {
        if (sv.sessionId === sessionId) delete this._projectSessions[path];
      }
      if (this.activeSessionId === sessionId) {
        this.activeSessionId = this.sessions[0]?.id || null;
      }
      this.updateSessionCount();
    },
    exitTerminal() {
      if (this.activeSessionId) this.endSession(this.activeSessionId);
    },
    switchToSession(sessionId: string) {
      if (!this.sessions.find((s) => s.id === sessionId)) return;
      this.activeSessionId = sessionId;
    },
    async openServerSession(serverSession: ServerSessionInfo) {
      const local = this.sessions.find((s) => s.id === serverSession.id);
      if (local) {
        this.activeSessionId = local.id;
        this.activeView = "workspace";
        this.workspacePanel = "terminal";
        return;
      }
      const self = this as typeof this & AlpineMagics<typeof this>;
      await this.loadXterm();
      const session: LocalSession = {
        id: serverSession.id,
        runner: serverSession.runner,
        promptLabel: serverSession.projectName || "session",
        projectPath: serverSession.projectPath,
        startTime: new Date(serverSession.createdAt).getTime(),
        lastInputTime: serverSession.lastInputAt || Date.now(),
        connected: false,
        ended: false,
        age: "",
        presetId: null,
      };
      this.sessions.push(session);
      this._terminalRefs[session.id] = {};
      this.activeSessionId = session.id;
      this.activeView = "workspace";
      this.workspacePanel = "terminal";
      await self.$nextTick();
      this.connectTerminal(session.id, `/ws/terminal/${serverSession.id}`);
    },
    async endServerSession(sessionId: string) {
      const local = this.sessions.find((s) => s.id === sessionId);
      if (local) {
        this.endSession(sessionId);
      } else {
        await fetch(`/api/terminal/${sessionId}`, { method: "DELETE" }).catch(
          () => {},
        );
      }
      this.updateSessionCount();
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
      if (m < 60) return m + "m ago";
      const h = Math.floor(m / 60);
      if (h < 24) return h + "h ago";
      return Math.floor(h / 24) + "d ago";
    },
  };
}
