/**
 * Browser-side terminal/session helpers for the dashboard Alpine app.
 * The Alpine app owns view state; this file owns xterm/WebSocket mechanics.
 */

const TERMINAL_REFIT_RETRY_DELAY_MS = 50;
const TERMINAL_REFIT_MAX_ATTEMPTS = 20;
const TERMINAL_INITIAL_FIT_DELAYS_MS = [50, 200, 500] as const;
let xtermLoadPromise: Promise<void> | null = null;

interface DashboardTerminalContext {
  projectPath: string;
  activeView: string;
  activeRunner: RunnerId;
  userRole: string;
  workspacePanel: string;
  terminalAvailable: boolean;
  platformHint: string | null;
  idleTimeoutMinutes: number;
  terminalSessionCount: number;
  serverSessions: ServerSessionInfo[];
  serverMaxSessions: number;
  sessionTitles: Record<string, string>;
  recentTerminalSessions: ServerSessionInfo[];
  showMaxSessionsModal: boolean;
  sessions: LocalSession[];
  activeSessionId: string | null;
  promptRunStates: Record<string, string>;
  launching: boolean;
  availableRunners: RunnerId[];
  presets: Preset[];
  allPresets: Preset[];
  _projectSessions: Record<string, SavedSession[]>;
  _projectActiveSession: Record<string, string>;
  _terminalRefs: Record<string, TerminalRefs>;
  _xtermLoaded: boolean;
  _detaching: boolean;
  _activeSession: LocalSession | null;
  terminalAwaitingInput: boolean;
  terminalSessionId: string | null;
  terminalEnded: boolean;
  displayNameFor(path: string): string;
  adaptPrompt(prompt: string, runner?: RunnerId): string;
  showToast(msg: string, isError?: boolean): void;
  isSessionBoundLocally(id: string): boolean;
  sendToTerminal(text: string, options?: { adapt?: boolean }): boolean;
  openServerSession(serverSession: ServerSessionInfo): Promise<void>;
  launchInTerminal(
    prompt: string,
    runner?: RunnerId,
    options?: {
      promptLabel?: string | null;
      presetId?: string | null;
      cwdPath?: string | null;
      targetPath?: string | null;
    },
  ): Promise<void>;
  loadXterm(): Promise<void>;
  connectTerminal(sessionId: string, wsUrl: string): void;
  updateSessionCount(): Promise<void>;
  _forgetSavedSession(sessionId: string): void;
  rememberSessionTitle(
    sessionId: string,
    title: string | null | undefined,
  ): void;
  rememberRecentSession(session: LocalSession): void;
  sessionTitleFor(session: ServerSessionInfo | LocalSession | null): string;
  endSession(sessionId: string): void;
  exportSession(sessionId: string): void;
}

/** Return the dashboard workspace that owns the shipped goat skills. */
function dashboardControllingWorkspace(): string {
  return window.__GOAT_FLOW_DEFAULT_PATH__ ?? ".";
}

/** Return a POSIX-shell-safe single-quoted string for command examples. */
function dashboardShellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** Remove generic labels that hide the actual session identity. */
function dashboardMeaningfulSessionTitle(
  title: string | null | undefined,
): string | null {
  const trimmed = typeof title === "string" ? title.trim() : "";
  if (!trimmed) return null;
  if (/^(terminal|terminal session|session)$/i.test(trimmed)) return null;
  return trimmed;
}

/** Build a non-generic fallback when no launch-time title is available. */
function dashboardFallbackSessionTitle(
  runner: RunnerId | null | undefined,
  id: string | null | undefined,
): string {
  const suffix = id ? id.slice(0, 8) : "new";
  return `${runner || "runner"} session ${suffix}`;
}

/** Persist a launch-time session title so reconnects do not collapse to "Terminal". */
function dashboardRememberSessionTitle(
  ctx: DashboardTerminalContext,
  sessionId: string,
  title: string | null | undefined,
): void {
  const meaningful = dashboardMeaningfulSessionTitle(title);
  if (!meaningful) return;
  const next = { ...ctx.sessionTitles, [sessionId]: meaningful };
  const entries = Object.entries(next).slice(-80);
  ctx.sessionTitles = Object.fromEntries(entries);
  localStorage.setItem(
    "goat-flow-session-titles",
    JSON.stringify(ctx.sessionTitles),
  );
}

/** Keep a short client-side history for sessions that the backend no longer lists. */
function dashboardRememberRecentSession(
  ctx: DashboardTerminalContext,
  session: LocalSession,
): void {
  ctx.rememberSessionTitle(session.id, session.promptLabel);
  const recent: ServerSessionInfo = {
    id: session.id,
    status: "terminated",
    createdAt: new Date(session.startTime).toISOString(),
    projectPath: session.projectPath,
    cwd: session.cwd,
    targetPath: session.targetPath,
    runner: session.runner,
    lastInputAt: session.lastInputTime,
    age: Math.max(0, Math.floor((Date.now() - session.startTime) / 1000)),
    projectName: ctx.displayNameFor(session.projectPath),
  };
  ctx.recentTerminalSessions = [
    recent,
    ...ctx.recentTerminalSessions.filter((item) => item.id !== session.id),
  ].slice(0, 8);
}

/** Resolve the title shown for local and server-backed terminal sessions. */
function dashboardSessionTitle(
  ctx: DashboardTerminalContext,
  session: ServerSessionInfo | LocalSession | null,
): string {
  if (!session) return "Runner session";
  const local = ctx.sessions.find((s) => s.id === session.id);
  return (
    dashboardMeaningfulSessionTitle(local?.promptLabel) ||
    dashboardMeaningfulSessionTitle(
      "promptLabel" in session ? session.promptLabel : null,
    ) ||
    dashboardMeaningfulSessionTitle(ctx.sessionTitles[session.id]) ||
    dashboardFallbackSessionTitle(session.runner, session.id)
  );
}

/** Strip common terminal control codes before scanning output text. */
function dashboardPlainTerminalText(text: string): string {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\r/g, "\n");
}

/** Heuristic for agent prompts waiting on a numbered human choice. */
function dashboardOutputLooksAwaitingInput(text: string): boolean {
  const plain = dashboardPlainTerminalText(text);
  const numberedChoices =
    /(^|\n)\s*1[.)]\s+\S[\s\S]{0,900}\n\s*2[.)]\s+\S[\s\S]{0,900}\n\s*3[.)]\s+\S/i.test(
      plain,
    );
  const choicePrompt =
    /\b(?:choose|select|pick)\s+(?:an?\s+)?(?:option|choice)\b/i.test(plain) ||
    /\b(?:enter|type)\s+(?:the\s+)?(?:number|choice|option)\b/i.test(plain) ||
    /\bwhich option\b/i.test(plain);
  return (
    /\bdo you want to (?:proceed|continue|allow|approve)\??/i.test(plain) ||
    /\bawaiting (?:input|confirmation|approval)\b/i.test(plain) ||
    /\bEsc to cancel\b[\s\S]{0,240}\bTab to amend\b/i.test(plain) ||
    (choicePrompt && numberedChoices)
  );
}

/** Decide whether a new output chunk should leave a session waiting. */
function dashboardNextAwaitingInputState(
  previousAwaiting: boolean,
  previousTail: string,
  outputChunk: string,
): boolean {
  const nextTail = (previousTail + outputChunk).slice(-5000);
  const chunkHasText =
    dashboardPlainTerminalText(outputChunk).trim().length > 0;
  if (dashboardOutputLooksAwaitingInput(outputChunk)) return true;
  if (!dashboardOutputLooksAwaitingInput(nextTail)) return false;
  return !previousAwaiting || !chunkHasText;
}

/** Mutate the Alpine-backed local session and the launch-time reference together. */
function dashboardMutateLocalSession(
  ctx: DashboardTerminalContext,
  sessionId: string,
  fallback: LocalSession,
  mutate: (session: LocalSession) => void,
): void {
  const reactive = ctx.sessions.find((s) => s.id === sessionId);
  if (reactive) mutate(reactive);
  if (reactive !== fallback) mutate(fallback);
}

/** Build target context appended to launched preset prompts. */
function dashboardGlobalLaunchContext(
  ctx: DashboardTerminalContext,
  runner: RunnerId,
  preset: Preset | null,
): string {
  const controllingWorkspace = dashboardControllingWorkspace();
  const mayWrite = preset?.mayWriteFiles === true;
  const presetPrompt = preset?.prompt.trim() ?? "";
  const writeLine = mayWrite
    ? "Write behavior: this preset may write only after the prompt or user explicitly approves it."
    : "Write behavior: default to read-only analysis; do not write files in the selected target unless the user explicitly asks.";
  const routeLine =
    preset?.route === "goat-plan" && /^\/goat-plan\b/.test(presetPrompt)
      ? "goat-plan global mode: keep plans inline; treat bare task paths as read-only context; do not create or mutate target .goat-flow/tasks unless the user explicitly approves writes."
      : preset?.route === "goat-critique" &&
          /^\/goat-critique\b/.test(presetPrompt)
        ? "goat-critique global mode: keep gitignored critique logs/artifacts in the controlling workspace; do not write goat-flow logs in the selected target unless the user explicitly makes that target the controlling workspace."
        : "";
  return [
    "GOAT Flow target context:",
    `- Controlling workspace for goat skills/reference files: ${controllingWorkspace}`,
    `- Selected target project for code evidence: ${ctx.projectPath}`,
    `- Runner: ${runner}`,
    "- Target projects do not need goat-flow installed; missing target .goat-flow, skills, hooks, or stale goat-flow files are normal unless this preset audits goat-flow installation.",
    `- Use target-scoped commands such as git -C ${dashboardShellQuote(ctx.projectPath)} status when inspecting the selected target.`,
    `- ${writeLine}`,
    ...(routeLine ? [`- ${routeLine}`] : []),
  ].join("\n");
}

/** Read the loaded xterm.js constructors from window globals. */
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

/** Send text to the active terminal session and focus it. */
function dashboardSendToTerminal(
  ctx: DashboardTerminalContext,
  text: string,
  { adapt = true }: { adapt?: boolean } = {},
): boolean {
  const active = ctx._activeSession;
  if (!active) {
    ctx.showToast("No active terminal session", true);
    return false;
  }
  const refs = ctx._terminalRefs[active.id];
  if (!refs?.ws || refs.ws.readyState !== WebSocket.OPEN) {
    ctx.showToast("No active terminal session", true);
    return false;
  }
  const prepared = adapt ? ctx.adaptPrompt(text) : text;
  // Bracketed paste prevents shells and REPLs from treating multi-line prompts as
  // a stream of independent keystrokes. `\x1b[200~` starts paste mode, `\x1b[201~`
  // ends it, and the trailing carriage return submits exactly once.
  const pasteData = "\x1b[200~" + prepared + "\x1b[201~" + "\r";
  refs.ws.send(JSON.stringify({ type: "input", data: pasteData }));
  active.lastInputTime = Date.now();
  active.awaitingInput = false;
  if (refs.xterm) refs.xterm.focus();
  return true;
}

/** Send a preset prompt to an active session in the current project. */
async function dashboardSendToProjectTarget(
  ctx: DashboardTerminalContext,
  prompt: string,
  target: ServerSessionInfo,
): Promise<void> {
  if (target.projectPath !== ctx.projectPath) {
    ctx.showToast("Target session is not in this project", true);
    return;
  }
  if (ctx.isSessionBoundLocally(target.id)) {
    ctx.activeSessionId = target.id;
    ctx.activeView = "workspace";
    ctx.workspacePanel = "terminal";
  } else {
    await ctx.openServerSession(target);
  }
  const prepared = ctx.adaptPrompt(prompt, target.runner);
  /** Retry a project-scoped send until the target terminal is ready. */
  const deliver = async (attempts: number): Promise<void> => {
    const refs = ctx._terminalRefs[ctx.activeSessionId ?? ""];
    if (refs?.ws && refs.ws.readyState === WebSocket.OPEN) {
      ctx.sendToTerminal(prepared, { adapt: false });
      return;
    }
    if (attempts > 20) {
      ctx.showToast("Could not connect to terminal", true);
      return;
    }
    await new Promise<void>((r) => setTimeout(r, 100));
    return deliver(attempts + 1);
  };
  await deliver(0);
}

/** Refresh terminal feature availability from the health endpoint. */
async function dashboardCheckTerminalAvailable(
  ctx: DashboardTerminalContext,
): Promise<void> {
  try {
    const res = await fetch("/api/health");
    if (res.ok) {
      const payload = readRecord(await res.json(), "Health response");
      ctx.availableRunners = Array.isArray(payload.availableRunners)
        ? payload.availableRunners
            .map((runner) => readRunnerId(runner))
            .filter((runner): runner is RunnerId => runner !== null)
        : [];
      ctx.terminalAvailable =
        payload.nodePtyAvailable === true && ctx.availableRunners.length > 0;
      ctx.platformHint =
        typeof payload.platformHint === "string" ? payload.platformHint : null;
      ctx.idleTimeoutMinutes =
        typeof payload.idleTimeoutMinutes === "number"
          ? payload.idleTimeoutMinutes
          : 480;
      const [firstRunner] = ctx.availableRunners;
      if (firstRunner) ctx.activeRunner = firstRunner;
      if (ctx.terminalAvailable && ctx.activeView === "workspace") {
        void dashboardWarmXterm(ctx);
      }
    }
  } catch {
    ctx.terminalAvailable = false;
  }
  void ctx.updateSessionCount();
}

/** Refresh terminal session state from the server. */
async function dashboardUpdateSessionCount(
  ctx: DashboardTerminalContext,
): Promise<void> {
  try {
    const res = await fetch("/api/terminal/sessions");
    const payload = readRecord(await res.json(), "Terminal sessions response");
    ctx.terminalSessionCount =
      typeof payload.activeCount === "number" ? payload.activeCount : 0;
    if (typeof payload.maxSessions === "number") {
      ctx.serverMaxSessions = payload.maxSessions;
    }
    ctx.serverSessions = Array.isArray(payload.sessions)
      ? payload.sessions
          .map((session) => readServerSessionInfo(session))
          .filter((session): session is ServerSessionInfo => session !== null)
          .map((session) => ({
            ...session,
            projectName: ctx.displayNameFor(session.projectPath),
          }))
      : [];
  } catch {
    /* ignore */
  }
}

/** Clear non-active (terminated/starting) terminal sessions, preserving running ones. */
async function dashboardEndAllSessions(
  ctx: DashboardTerminalContext,
): Promise<void> {
  try {
    const res = await fetch("/api/terminal/sessions");
    const payload = readRecord(await res.json(), "Terminal sessions response");
    const sessions = Array.isArray(payload.sessions)
      ? payload.sessions
          .map((session) => readServerSessionInfo(session))
          .filter((session): session is ServerSessionInfo => session !== null)
      : [];
    const inactive = sessions.filter((session) => session.status !== "active");
    const activeIds = new Set(
      sessions
        .filter((session) => session.status === "active")
        .map((session) => session.id),
    );
    const localRecentCount = ctx.recentTerminalSessions.length;
    for (const session of inactive) {
      await fetch(`/api/terminal/${session.id}`, { method: "DELETE" });
    }
    ctx.recentTerminalSessions = [];
    const keptRefs: typeof ctx._terminalRefs = {};
    for (const id of Object.keys(ctx._terminalRefs)) {
      if (activeIds.has(id)) {
        const active = ctx._terminalRefs[id];
        if (active) keptRefs[id] = active;
      } else {
        const refs = ctx._terminalRefs[id];
        if (refs?.cleanup) refs.cleanup();
      }
    }
    ctx._terminalRefs = keptRefs;
    const keptProjects: typeof ctx._projectSessions = {};
    for (const key of Object.keys(ctx._projectSessions)) {
      const kept = (ctx._projectSessions[key] ?? []).filter((s) =>
        activeIds.has(s.sessionId),
      );
      if (kept.length > 0) keptProjects[key] = kept;
    }
    ctx._projectSessions = keptProjects;
    for (const key of Object.keys(ctx._projectActiveSession)) {
      const activeSessionForProject = ctx._projectActiveSession[key];
      if (activeSessionForProject && !activeIds.has(activeSessionForProject)) {
        const projectSessions = keptProjects[key];
        if (projectSessions?.[0]) {
          ctx._projectActiveSession[key] = projectSessions[0].sessionId;
        } else {
          Reflect.deleteProperty(ctx._projectActiveSession, key);
        }
      }
    }
    ctx.sessions = ctx.sessions.filter((s) => activeIds.has(s.id));
    if (ctx.activeSessionId && !activeIds.has(ctx.activeSessionId)) {
      ctx.activeSessionId = null;
    }
    for (const [presetId, state] of Object.entries(ctx.promptRunStates)) {
      if (
        state === "running" &&
        !ctx.sessions.some((s) => s.presetId === presetId)
      ) {
        ctx.promptRunStates[presetId] = "pass";
      }
    }
    await ctx.updateSessionCount();
    const count = inactive.length + localRecentCount;
    ctx.showToast(
      count > 0
        ? `Cleared ${count} recent session${count !== 1 ? "s" : ""}`
        : "No recent sessions to clear",
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.showToast("Failed to clear sessions: " + msg, true);
  }
}

/** Load the xterm.js globals on demand before any terminal view is rendered. */
async function dashboardLoadXterm(
  ctx: DashboardTerminalContext,
): Promise<void> {
  if (ctx._xtermLoaded) return;
  if (!xtermLoadPromise) {
    xtermLoadPromise = (async () => {
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
        /** Handle script load failures. */
        script.onerror = () => {
          reject(new Error("xterm.js load failed"));
        };
        const timer = setTimeout(() => {
          reject(new Error("xterm.js load timeout"));
        }, 5000);
        /** Handle successful script loads. */
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
        const timer = setTimeout(() => {
          reject(new Error("fit addon load timeout"));
        }, 5000);
        /** Handle successful script loads. */
        script.onload = () => {
          clearTimeout(timer);
          resolve();
        };
        /** Handle script load failures. */
        script.onerror = () => {
          reject(new Error("fit addon load failed"));
        };
        document.head.appendChild(script);
      });
      getXtermConstructors();
    })();
  }
  try {
    await xtermLoadPromise;
    ctx._xtermLoaded = true;
  } catch (err) {
    xtermLoadPromise = null;
    throw err;
  }
}

/** Warm xterm.js in the background so the first launch does less visible work. */
async function dashboardWarmXterm(
  ctx: DashboardTerminalContext,
): Promise<void> {
  if (!ctx.terminalAvailable || ctx._xtermLoaded) return;
  try {
    await ctx.loadXterm();
  } catch {
    // Surface load failures only on explicit launch.
  }
}

/** Launch a preset prompt in the selected runner. */
async function dashboardLaunchPreset(
  ctx: DashboardTerminalContext,
  prompt: string,
  runner?: RunnerId,
  label?: string,
  options: {
    presetId?: string | null;
    cwdPath?: string | null;
    targetPath?: string | null;
  } = {},
): Promise<void> {
  if (ctx.launching) return;
  const preset =
    (options.presetId
      ? (ctx.allPresets.find((p) => p.id === options.presetId) ?? null)
      : null) ??
    ctx.allPresets.find(
      (p) =>
        ctx.adaptPrompt(p.prompt) === ctx.adaptPrompt(prompt) ||
        (typeof label === "string" && p.name === label),
    ) ??
    null;
  const promptLabel = label || preset?.name || "Custom prompt";
  const presetId = preset?.id || options.presetId || null;
  const runnerResolved = runner || ctx.activeRunner;
  if (presetId) ctx.promptRunStates[presetId] = "running";
  let adapted = ctx.adaptPrompt(prompt, runnerResolved);
  adapted +=
    "\n\n" + dashboardGlobalLaunchContext(ctx, runnerResolved, preset ?? null);
  if (ctx.userRole === "investigator") {
    adapted =
      "You are in investigator mode. Read-only - investigate, plan, and review only. Do NOT make any code changes.\n\n" +
      adapted;
  } else if (ctx.userRole === "tester") {
    adapted =
      "You are in tester mode. Test-focused - generate test plans, verify coverage, run QA analysis. Do NOT make code changes beyond test files.\n\n" +
      adapted;
  }
  await ctx.launchInTerminal(adapted, runnerResolved, {
    promptLabel,
    presetId,
    cwdPath: options.cwdPath ?? null,
    targetPath: options.targetPath ?? ctx.projectPath,
  });
}

/** Drop a session id from every project's saved list, pruning empty entries. */
function dashboardForgetSavedSession(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  for (const [path, list] of Object.entries(ctx._projectSessions)) {
    const filtered = list.filter((sv) => sv.sessionId !== sessionId);
    if (filtered.length === 0) {
      Reflect.deleteProperty(ctx._projectSessions, path);
    } else if (filtered.length !== list.length) {
      ctx._projectSessions[path] = filtered;
    }
    if (ctx._projectActiveSession[path] === sessionId) {
      const first = filtered[0];
      if (first) {
        ctx._projectActiveSession[path] = first.sessionId;
      } else {
        Reflect.deleteProperty(ctx._projectActiveSession, path);
      }
    }
  }
}

/** Detach the current browser terminal while preserving reconnect metadata. */
function dashboardDetachTerminal(
  ctx: DashboardTerminalContext,
  forProjectPath?: string,
): void {
  ctx._detaching = true;
  const savePath = forProjectPath || ctx.projectPath;
  const toSave: SavedSession[] = ctx.sessions
    .filter((s) => s.projectPath === savePath && !s.ended)
    .map((s) => ({
      sessionId: s.id,
      startTime: s.startTime,
      prompt: s.promptLabel,
      agent: s.runner,
      cwd: s.cwd,
      targetPath: s.targetPath,
    }));
  if (toSave.length > 0) {
    ctx._projectSessions[savePath] = toSave;
    const activeId = ctx.activeSessionId;
    const fallback = toSave[0];
    if (activeId && toSave.some((s) => s.sessionId === activeId)) {
      ctx._projectActiveSession[savePath] = activeId;
    } else if (fallback) {
      ctx._projectActiveSession[savePath] = fallback.sessionId;
    }
  } else {
    Reflect.deleteProperty(ctx._projectSessions, savePath);
    Reflect.deleteProperty(ctx._projectActiveSession, savePath);
  }
  for (const id of Object.keys(ctx._terminalRefs)) {
    const refs = ctx._terminalRefs[id];
    if (refs?.cleanup) refs.cleanup();
  }
  ctx._terminalRefs = {};
  ctx.sessions = [];
  ctx.activeSessionId = null;
  ctx.promptRunStates = {};
  ctx._detaching = false;
}

/** Reconnect the workspace to every saved backend session for this project. */
async function dashboardReconnectTerminal(
  ctx: DashboardTerminalContext,
): Promise<boolean> {
  const savedList = ctx._projectSessions[ctx.projectPath];
  if (!savedList || savedList.length === 0) return false;
  const aliveMap = new Map<string, ServerSessionInfo>();
  try {
    const res = await fetch("/api/terminal/sessions");
    const payload = readRecord(await res.json(), "Terminal sessions response");
    if (Array.isArray(payload.sessions)) {
      for (const raw of payload.sessions) {
        const session = readServerSessionInfo(raw);
        if (session) aliveMap.set(session.id, session);
      }
    }
  } catch {
    Reflect.deleteProperty(ctx._projectSessions, ctx.projectPath);
    Reflect.deleteProperty(ctx._projectActiveSession, ctx.projectPath);
    return false;
  }
  const liveSaved = savedList.filter((sv) => aliveMap.has(sv.sessionId));
  if (liveSaved.length === 0) {
    Reflect.deleteProperty(ctx._projectSessions, ctx.projectPath);
    Reflect.deleteProperty(ctx._projectActiveSession, ctx.projectPath);
    return false;
  }
  ctx._projectSessions[ctx.projectPath] = liveSaved;
  const self = ctx as DashboardTerminalContext &
    AlpineMagics<DashboardTerminalContext>;
  await ctx.loadXterm();
  for (const saved of liveSaved) {
    const alive = aliveMap.get(saved.sessionId);
    if (!alive) continue;
    const session: LocalSession = {
      id: saved.sessionId,
      runner: saved.agent,
      promptLabel: saved.prompt,
      projectPath: alive.projectPath,
      cwd: alive.cwd || saved.cwd || alive.projectPath,
      targetPath: alive.targetPath || saved.targetPath || alive.projectPath,
      startTime: saved.startTime,
      lastInputTime: alive.lastInputAt,
      connected: false,
      ended: false,
      awaitingInput: false,
      outputTail: "",
      age: "",
      presetId: null,
    };
    ctx.rememberSessionTitle(session.id, session.promptLabel);
    ctx.sessions.push(session);
    ctx._terminalRefs[session.id] = {};
  }
  const savedActiveId = ctx._projectActiveSession[ctx.projectPath];
  const first = liveSaved[0];
  ctx.activeSessionId =
    savedActiveId && liveSaved.some((s) => s.sessionId === savedActiveId)
      ? savedActiveId
      : (first?.sessionId ?? null);
  ctx.activeView = "workspace";
  ctx.workspacePanel = "terminal";
  await self.$nextTick();
  for (const saved of liveSaved) {
    ctx.connectTerminal(saved.sessionId, `/ws/terminal/${saved.sessionId}`);
  }
  void ctx.updateSessionCount();
  return true;
}

/** Create a new backend terminal session and open it in the workspace. */
async function dashboardLaunchInTerminal(
  ctx: DashboardTerminalContext,
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
): Promise<void> {
  if (
    Math.max(ctx.sessions.length, ctx.serverSessions.length) >=
    ctx.serverMaxSessions
  ) {
    ctx.showMaxSessionsModal = true;
    return;
  }
  let createdSessionId: string | null = null;
  ctx.launching = true;
  try {
    const self = ctx as DashboardTerminalContext &
      AlpineMagics<DashboardTerminalContext>;
    const selectedTargetPath = targetPath || ctx.projectPath;
    const controllingCwd = cwdPath || selectedTargetPath;
    const res = await fetch("/api/terminal/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        projectPath: controllingCwd,
        targetPath: selectedTargetPath,
        runner,
      }),
    });
    const payload = readRecord(await res.json(), "Terminal create response");
    const error = readErrorMessage(payload);
    if (error) throw new Error(error);
    const id = readString(payload.id);
    const wsUrl = readString(payload.wsUrl);
    if (!id || !wsUrl) {
      throw new Error("Terminal create response returned an invalid payload");
    }
    const session: LocalSession = {
      id,
      runner,
      promptLabel: promptLabel || "Custom prompt",
      projectPath: selectedTargetPath,
      cwd: controllingCwd,
      targetPath: selectedTargetPath,
      startTime: Date.now(),
      lastInputTime: Date.now(),
      connected: false,
      ended: false,
      awaitingInput: false,
      outputTail: "",
      age: "",
      presetId,
    };
    createdSessionId = session.id;
    ctx.rememberSessionTitle(session.id, session.promptLabel);
    ctx.sessions.push(session);
    ctx._terminalRefs[session.id] = {};
    ctx.activeSessionId = session.id;
    ctx.activeView = "workspace";
    ctx.workspacePanel = "terminal";
    await self.$nextTick();
    await ctx.loadXterm();
    ctx.connectTerminal(session.id, wsUrl);
    void ctx.updateSessionCount();
  } catch (err) {
    if (createdSessionId) {
      const failedSessionId = createdSessionId;
      const refs = ctx._terminalRefs[failedSessionId];
      if (refs?.cleanup) refs.cleanup();
      Reflect.deleteProperty(ctx._terminalRefs, failedSessionId);
      ctx.sessions = ctx.sessions.filter((s) => s.id !== failedSessionId);
      if (ctx.activeSessionId === failedSessionId) {
        ctx.activeSessionId = ctx.sessions[0]?.id || null;
      }
      fetch(`/api/terminal/${failedSessionId}`, { method: "DELETE" }).catch(
        () => {},
      );
      void ctx.updateSessionCount();
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Maximum") || msg.includes("concurrent")) {
      ctx.showMaxSessionsModal = true;
    } else {
      ctx.showToast(msg, true);
    }
  }
  ctx.launching = false;
}

/** Bind a browser xterm instance to a backend PTY session. */
function dashboardConnectTerminal(
  ctx: DashboardTerminalContext,
  sessionId: string,
  wsUrl: string,
): void {
  const session = ctx.sessions.find((s) => s.id === sessionId);
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
    ctx.showToast(msg, true);
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
  /** Fit the active xterm instance and report its size to the server. */
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
  /** Handle browser resizes for the active terminal. */
  const resizeHandler = (): void => {
    doFit();
  };
  window.addEventListener("resize", resizeHandler);
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}${wsUrl}`);
  let ageInterval: ReturnType<typeof setInterval> | null = null;
  /** Handle the terminal WebSocket opening. */
  ws.onopen = () => {
    dashboardMutateLocalSession(ctx, sessionId, session, (target) => {
      target.connected = true;
    });
    setTimeout(doFit, TERMINAL_REFIT_RETRY_DELAY_MS);
    if (ageInterval) clearInterval(ageInterval);
    ageInterval = setInterval(() => {
      if (session.ended) {
        if (ageInterval) clearInterval(ageInterval);
        dashboardMutateLocalSession(ctx, sessionId, session, (target) => {
          target.age = "";
        });
        return;
      }
      const elapsed = Math.floor((Date.now() - session.startTime) / 1000);
      const mins = Math.floor(elapsed / 60);
      const hrs = Math.floor(mins / 60);
      let age: string;
      if (hrs > 0) age = `${hrs}h ${mins % 60}m`;
      else age = `${mins}m`;
      if (session.lastInputTime && ctx.idleTimeoutMinutes > 0) {
        const idleSecs = Math.floor(
          (Date.now() - session.lastInputTime) / 1000,
        );
        const idleMins = Math.floor(idleSecs / 60);
        const timeout = ctx.idleTimeoutMinutes;
        const countdownAt = Math.floor(timeout * 0.97);
        const warnAt = Math.floor(timeout * 0.85);
        if (idleMins >= countdownAt) {
          age = `${mins}m | Timeout in ${Math.max(0, timeout - idleMins)}m`;
        } else if (idleMins >= warnAt) {
          age += ` | Idle ${idleMins}m`;
        }
      }
      dashboardMutateLocalSession(ctx, sessionId, session, (target) => {
        target.age = age;
      });
    }, 30000);
    if (ctx._terminalRefs[sessionId]) {
      ctx._terminalRefs[sessionId].ageInterval = ageInterval;
    }
  };
  /** Handle incoming terminal WebSocket messages. */
  ws.onmessage = (event: MessageEvent) => {
    try {
      if (typeof event.data !== "string") return;
      const msg = readRecord(JSON.parse(event.data), "Terminal message");
      const type = readString(msg.type);
      if (type === "output" && typeof msg.data === "string") {
        const reactive = ctx.sessions.find((s) => s.id === sessionId);
        const previousTail = reactive?.outputTail ?? session.outputTail ?? "";
        const previousAwaiting =
          reactive?.awaitingInput === true || session.awaitingInput === true;
        const tail = (previousTail + msg.data).slice(-5000);
        const awaitingInput = dashboardNextAwaitingInputState(
          previousAwaiting,
          previousTail,
          msg.data,
        );
        dashboardMutateLocalSession(ctx, sessionId, session, (target) => {
          target.outputTail = tail;
          target.awaitingInput = awaitingInput;
        });
        term.write(msg.data);
      } else if (type === "exit") {
        dashboardMutateLocalSession(ctx, sessionId, session, (target) => {
          target.ended = true;
          target.connected = false;
          target.awaitingInput = false;
        });
        ctx.rememberRecentSession(session);
        ctx._forgetSavedSession(sessionId);
        if (
          session.presetId &&
          ctx.promptRunStates[session.presetId] === "running"
        ) {
          ctx.promptRunStates[session.presetId] = "pass";
        }
        void ctx.updateSessionCount();
      } else if (type === "error" && typeof msg.message === "string") {
        term.write(`\r\n\x1b[31m${msg.message}\x1b[0m\r\n`);
      } else if (type === "shutdown") {
        dashboardMutateLocalSession(ctx, sessionId, session, (target) => {
          target.ended = true;
          target.connected = false;
          target.awaitingInput = false;
        });
      }
    } catch {
      /* ignore malformed messages */
    }
  };
  /** Handle the terminal WebSocket closing. */
  ws.onclose = () => {
    dashboardMutateLocalSession(ctx, sessionId, session, (target) => {
      target.connected = false;
      if (!target.ended && !ctx._detaching) target.ended = true;
    });
  };
  /** Handle terminal WebSocket errors. */
  ws.onerror = () => {
    dashboardMutateLocalSession(ctx, sessionId, session, (target) => {
      target.connected = false;
    });
  };
  term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
    if (e.type === "keydown" && e.ctrlKey && e.key === "v") {
      e.preventDefault();
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
    const lastInputTime = Date.now();
    dashboardMutateLocalSession(ctx, sessionId, session, (target) => {
      target.lastInputTime = lastInputTime;
      target.awaitingInput = false;
    });
  });
  term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: "resize", cols, rows }));
  });
  /** Tear down dashboard resources before the page unloads. */
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
  ctx._terminalRefs[sessionId] = {
    ws,
    xterm: term,
    cleanup,
  };
  term.focus();
}

/** End a local terminal session and release its browser bindings. */
function dashboardEndSession(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  const session = ctx.sessions.find((s) => s.id === sessionId);
  if (!session) return;
  if (session.presetId && ctx.promptRunStates[session.presetId] === "running") {
    ctx.promptRunStates[session.presetId] = "pass";
  }
  if (!session.ended) {
    fetch(`/api/terminal/${sessionId}`, { method: "DELETE" }).catch(() => {});
  }
  ctx.rememberRecentSession(session);
  const refs = ctx._terminalRefs[sessionId];
  if (refs?.cleanup) refs.cleanup();
  Reflect.deleteProperty(ctx._terminalRefs, sessionId);
  ctx.sessions = ctx.sessions.filter((s) => s.id !== sessionId);
  ctx._forgetSavedSession(sessionId);
  if (ctx.activeSessionId === sessionId) {
    ctx.activeSessionId = ctx.sessions[0]?.id || null;
  }
  void ctx.updateSessionCount();
}

/** Exit the active terminal session from the workspace view. */
function dashboardExitTerminal(ctx: DashboardTerminalContext): void {
  if (ctx.activeSessionId) ctx.endSession(ctx.activeSessionId);
}

/** Switch the workspace to an existing local terminal session. */
function dashboardSwitchToSession(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  if (!ctx.sessions.find((s) => s.id === sessionId)) return;
  ctx.activeSessionId = sessionId;
}

/** Attach the workspace to an existing backend terminal session. */
async function dashboardOpenServerSession(
  ctx: DashboardTerminalContext,
  serverSession: ServerSessionInfo,
): Promise<void> {
  const local = ctx.sessions.find((s) => s.id === serverSession.id);
  if (local) {
    ctx.activeSessionId = local.id;
    ctx.activeView = "workspace";
    ctx.workspacePanel = "terminal";
    return;
  }
  const self = ctx as DashboardTerminalContext &
    AlpineMagics<DashboardTerminalContext>;
  await ctx.loadXterm();
  const session: LocalSession = {
    id: serverSession.id,
    runner: serverSession.runner,
    promptLabel: ctx.sessionTitleFor(serverSession),
    projectPath: serverSession.projectPath,
    cwd: serverSession.cwd,
    targetPath: serverSession.targetPath,
    startTime: new Date(serverSession.createdAt).getTime(),
    lastInputTime: serverSession.lastInputAt || Date.now(),
    connected: false,
    ended: false,
    awaitingInput: false,
    outputTail: "",
    age: "",
    presetId: null,
  };
  ctx.rememberSessionTitle(session.id, session.promptLabel);
  ctx.sessions.push(session);
  ctx._terminalRefs[session.id] = {};
  ctx.activeSessionId = session.id;
  ctx.activeView = "workspace";
  ctx.workspacePanel = "terminal";
  await self.$nextTick();
  ctx.connectTerminal(session.id, `/ws/terminal/${serverSession.id}`);
}

/** Terminate a backend terminal session by ID. */
async function dashboardEndServerSession(
  ctx: DashboardTerminalContext,
  sessionId: string,
): Promise<void> {
  const local = ctx.sessions.find((s) => s.id === sessionId);
  if (local) {
    ctx.endSession(sessionId);
  } else {
    await fetch(`/api/terminal/${sessionId}`, { method: "DELETE" }).catch(
      () => {},
    );
  }
  void ctx.updateSessionCount();
}
