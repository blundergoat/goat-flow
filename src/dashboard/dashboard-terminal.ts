/**
 * Browser-side terminal/session helpers for the dashboard Alpine app.
 * The Alpine app owns view state; this file owns xterm/WebSocket mechanics.
 */

const TERMINAL_REFIT_RETRY_DELAY_MS = 50; // Retry budget: one render tick before measuring xterm again.
const TERMINAL_REFIT_MAX_ATTEMPTS = 20; // Retry cap: one second is enough for hidden panels to become measurable.
const TERMINAL_INITIAL_FIT_DELAYS_MS = [50, 200, 500] as const;
const TERMINAL_LAUNCH_PROMPT_NO_OUTPUT_FALLBACK_DELAY_MS = 6000; // Fallback delay: silent runner startup can precede the first composer prompt.
const TERMINAL_LAUNCH_PROMPT_AFTER_OUTPUT_FALLBACK_DELAY_MS = 2000; // Fallback budget: after output appears, wait for a recognised composer marker.
const TERMINAL_LAUNCH_PROMPT_QUIET_DELAY_MS = 500; // Quiet budget: send after output pauses to avoid racing TUI redraws.
const TERMINAL_PASTE_MARKER_SETTLE_DELAY_MS = 300; // Marker-settle budget: Claude Code v2.1.152 can swallow immediate Enter after fat pasted-text echoes; 300ms is the capped fallback until live Delta A is re-measured.
const TERMINAL_CLAUDE_PASTE_NO_MARKER_FALLBACK_DELAY_MS = 1500; // Claude fallback: if the visible pasted-text marker is not detected, send Enter soon after the paste instead of waiting for the generic 15s safety net.
const TERMINAL_PASTE_COMMIT_FALLBACK_DELAY_MS = 15000; // Fallback budget: runners without paste echoes still need eventual Enter submission.
const TERMINAL_PASTE_FALLBACK_RELEASE_DELAY_MS = 5000; // Release budget: do not hold queued paste state forever after fallback submission.
const TERMINAL_PASTE_SUBMIT_RETRY_CADENCE_MS = 500; // Composer retry cadence: bounded re-Enter loop after a stuck pasted-text marker; distinct from websocket-write retry.
const TERMINAL_PASTE_SUBMIT_RETRY_DELAY_MS = 300; // Retry budget: keep Enter retries responsive without flooding the PTY.
const TERMINAL_PASTE_SUBMIT_MAX_RETRIES = 5; // Retry cap: bounded Enter retries avoid stuck composer state without spamming input.
const AWAITING_INPUT_VISIBLE_DELAY_MS = 1200;
const TERMINAL_LOADING_SLOW_HINT_MS = 3000; // Hint delay: normal xterm startup should finish before slow-load copy appears.
const TERMINAL_LOADING_RETRY_MS = 10000; // Retry budget: give asset loading and socket attach time before offering retry.
// Coalesce bursty launch/route refreshes without delaying user-visible state.
const SESSION_REFRESH_DEBOUNCE_MS = 50;
const BRACKETED_PASTE_MARKER_PATTERN = /\x1b\[(?:200|201)~/g;
const RUNNER_STARTUP_FAILURE_MESSAGE =
  "Runner failed before prompt delivery. Check the terminal output above.";
let xtermLoadPromise: Promise<void> | null = null;
let sessionRefreshPromise: Promise<void> | null = null;
let sessionRefreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;

/** Pending bracketed-paste payload waiting for the runner to commit or echo it. */
interface DashboardQueuedPaste {
  data: string;
  shouldDelaySubmit: boolean;
}

/** Stable Alpine state schema and terminal methods consumed by browser-side helpers. */
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
  /** Format a project path for UI labels without exposing full path noise. */
  displayNameFor(path: string): string;
  /** Apply runner-specific prompt adaptation before sending text to a terminal. */
  adaptPrompt(prompt: string, runner?: RunnerId): string;
  /** Surface terminal errors through the shared dashboard toast channel. */
  showToast(msg: string, isError?: boolean): void;
  /** Check whether a backend session has a browser terminal tab in this project. */
  isSessionBoundLocally(id: string): boolean;
  /** Send text to the active browser terminal connection. */
  sendToTerminal(text: string, options?: { adapt?: boolean }): boolean;
  /** Rehydrate a server-active terminal session into the browser UI. */
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
  /** Load xterm assets once before a browser terminal attaches. */
  loadXterm(): Promise<void>;
  /** Attach one browser terminal tab to a backend WebSocket session. */
  connectTerminal(sessionId: string, wsUrl: string): void;
  /** Refresh backend session counts and max-session state. */
  updateSessionCount(): Promise<void>;
  /** Remove one session id from persisted reconnect state. */
  _forgetSavedSession(sessionId: string): void;
  rememberSessionTitle(
    sessionId: string,
    title: string | null | undefined,
  ): void;
  /** Keep a terminated local session visible briefly after the backend drops it. */
  rememberRecentSession(session: LocalSession): void;
  /** Resolve the stable display title for local and backend terminal rows. */
  sessionTitleFor(session: ServerSessionInfo | LocalSession | null): string;
  /** Terminate a backend session and release browser-side terminal resources. */
  endSession(sessionId: string): void;
  /** Download the scrollback for one browser terminal tab. */
  exportSession(sessionId: string): void;
}

/** Return the dashboard workspace that owns the shipped goat skills. */
function dashboardControllingWorkspace(): string {
  return window.__GOAT_FLOW_DEFAULT_PATH__ ?? ".";
}

/** Return a POSIX-shell-safe single-quoted string for command examples. */
function dashboardShellQuote(commandText: string): string {
  return `'${commandText.replace(/'/g, "'\\''")}'`;
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
  return (
    text
      // OSC (title / hyperlink / progress): ESC ] ... BEL or ESC ] ... ESC \.
      // Title text is captured separately via dashboardTerminalTitlesFromOutput.
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
      .replace(/\x1b\[(\d+)C/g, (_sequence, count: string) =>
        " ".repeat(Math.min(Number.parseInt(count, 10), 240)),
      )
      .replace(/\x1b\[C/g, " ")
      // CUP / HVP (cursor position). Codex lays out every word with `ESC[r;cH`
      // and never emits `\r\n` between rows; without this normalisation those
      // positionings collapse `1. Yes\x1b[9;3H2. No` onto one line, breaking
      // the numbered-choices regex that requires a newline between options.
      // Replace with `\n ` so cross-row positionings produce line breaks and
      // intra-row positionings still leave a token boundary.
      .replace(/\x1b\[\d*(?:;\d*)?[Hf]/g, "\n ")
      // CHA (cursor horizontal absolute). Replace with a single space so
      // column-laid words (Claude Code's "Esc to cancel · Tab to amend" footer
      // and numbered choices) keep a token boundary instead of collapsing.
      .replace(/\x1b\[\d*G/g, " ")
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
      // Unicode box-drawing characters. Copilot and Gemini wrap their approval
      // dialogs in `│ ... │` borders; the leading `│` prevents `numberedChoices`
      // from matching `\n\s*1.` since `│` is not in `\s`. Replace with a space.
      .replace(/[─-╿]/g, " ")
      .replace(/\r/g, "\n")
  );
}

/** Extract OSC 0/1/2 title payloads from raw terminal output. */
function dashboardTerminalTitlesFromOutput(text: string): string[] {
  const titles: string[] = [];
  const pattern = /\x1b\][012];([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
  for (const match of text.matchAll(pattern)) {
    const payload = match[1]?.trim();
    if (payload) titles.push(payload);
  }
  return titles;
}

/** Return true when an OSC title signals the runner is blocked on user input. */
function dashboardTerminalTitleSuggestsAwaitingInput(title: string): boolean {
  return (
    /\baction required\b/i.test(title) ||
    /\[\s*!\s*\]/.test(title) ||
    /\bawaiting (?:input|confirmation|approval)\b/i.test(title)
  );
}

/** Prepare user prompt text for one bracketed-paste payload. */
function dashboardPreparePasteBody(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(BRACKETED_PASTE_MARKER_PATTERN, "");
}

/** Return the last permission prompt intro in plain terminal text. */
function dashboardLastCommandPermissionPromptIndex(plain: string): number {
  let lastIndex = -1;
  const patterns = [
    /\bdo\s+you\s+want\s+to\s+(?:proceed|continue|allow|approve|run\s+(?:this\s+)?command)\??/gi,
    /\bwould\s+you\s+like\s+to\s+run\s+the\s+following\s+command\??/gi,
    /\ballow\s+execution\s+of\b/gi,
    // Trust dialogs: every runner shows one on first launch in a fresh cwd.
    // Codex/Copilot/Gemini phrase it as "Do you trust …"; Claude Code shows
    // "Is this a project you created or one you trust?".
    /\bdo\s+you\s+trust\s+(?:the\s+)?(?:files|contents|this\s+(?:folder|directory))\b/gi,
    /\bis\s+this\s+a\s+project\s+you\s+(?:created|trust)\b/gi,
    /\bconfirm\s+folder\s+trust\b/gi,
  ];
  for (const pattern of patterns) {
    for (const match of plain.matchAll(pattern)) {
      lastIndex = Math.max(lastIndex, match.index);
    }
  }
  return lastIndex;
}

/** Return true when the visible tail ends with a prompt that is not complete yet. */
function dashboardOutputTailEndsWithAwaitingInputStart(text: string): boolean {
  const plain = dashboardPlainTerminalText(text).slice(-1200).trimEnd();
  const promptIndex = dashboardLastCommandPermissionPromptIndex(plain);
  if (promptIndex < 0) return false;
  const promptTail = plain.slice(promptIndex);
  if (promptTail.length > 700) return false;
  return !dashboardOutputLooksAwaitingInput(promptTail);
}

/**
 * Footer pattern that signals "we are parked on a confirmation prompt."
 * Covers Claude Code's trust dialog (`Enter to confirm`), Codex's trust dialog
 * (`Press enter to continue`), and Copilot's selection menu
 * (`↑/↓ to navigate · enter to select · esc to cancel`).
 */
function dashboardOutputHasConfirmFooter(plain: string): boolean {
  return (
    /\bPress\s+enter\s+to\s+(?:continue|confirm|select)\b/i.test(plain) ||
    /\bEnter\s+to\s+(?:confirm|select|continue)\b/i.test(plain) ||
    /\benter\s+to\s+select\b/i.test(plain)
  );
}

/** Heuristic for runner approval prompts because each agent renders choices differently. */
function dashboardOutputLooksAwaitingInput(text: string): boolean {
  const plain = dashboardPlainTerminalText(text);
  const titleSignal = dashboardTerminalTitlesFromOutput(text).some(
    dashboardTerminalTitleSuggestsAwaitingInput,
  );
  const numberedChoices =
    /(^|\n)\s*(?:[›>❯▶▸→●]\s*)?1[.)]\s+\S[\s\S]{0,900}\n\s*(?:[›>❯▶▸→●]\s*)?2[.)]\s+\S/i.test(
      plain,
    );
  const choicePrompt =
    /\b(?:choose|select|pick)\s+(?:an?\s+)?(?:option|choice)\b/i.test(plain) ||
    /\b(?:enter|type)\s+(?:the\s+)?(?:number|choice|option)\b/i.test(plain) ||
    /\bwhich option\b/i.test(plain);
  const commandPermissionPrompt =
    dashboardLastCommandPermissionPromptIndex(plain) >= 0;
  const confirmFooter = dashboardOutputHasConfirmFooter(plain);
  return (
    titleSignal ||
    /\bawaiting (?:input|confirmation|approval)\b/i.test(plain) ||
    /\bEsc\s+to\s+cancel\b[\s\S]{0,240}\bTab\s+to\s+amend\b/i.test(plain) ||
    (commandPermissionPrompt && numberedChoices) ||
    (choicePrompt && numberedChoices) ||
    (confirmFooter && numberedChoices)
  );
}

/** Return true for chunks that complete a permission prompt started earlier. */
function dashboardOutputLooksAwaitingInputContinuation(text: string): boolean {
  const plain = dashboardPlainTerminalText(text);
  return (
    /(^|\n)\s*(?:[›>❯▶▸→●]\s*)?1[.)]\s+\S[\s\S]{0,900}\n\s*(?:[›>❯▶▸→●]\s*)?2[.)]\s+\S/i.test(
      plain,
    ) ||
    /(^|\n)\s*(?:[›>❯▶▸→●]\s*)?[23][.)]\s+\S/i.test(plain) ||
    /\bEsc\s+to\s+(?:cancel|stop)\b/i.test(plain) ||
    /\bPress\s+enter\s+to\s+(?:confirm|continue|select)\b/i.test(plain) ||
    /\bEnter\s+to\s+(?:confirm|select|continue)\b/i.test(plain) ||
    /\bAllow once\b/i.test(plain)
  );
}

/** Return true for single-frame runner status redraws that should not clear waiting state. */
function dashboardOutputLooksTransientStatusRedraw(text: string): boolean {
  const plain = dashboardPlainTerminalText(text).trim();
  if (!plain) return true;
  if (/^\r[^\n\r]*$/u.test(text)) return true;
  // Bare spinner-glyph frame emitted ~2 Hz while a prompt is visible. Claude
  // Code paints `●` (U+25CF), Codex paints `◦` (U+25E6), other runners use
  // braille patterns (U+2800–U+28FF). Without this branch every other spinner
  // tick fell through the classifier and killed the 1200ms reveal timer, so
  // the badge never fired. Match the glyph in isolation, optionally repeated,
  // with no other text.
  if (/^[●✻✢✳✶*•·◦◯○◎⊙◌⠀-⣿]+$/u.test(plain)) return true;
  return /^[●✻✢✳✶*•·◦◯○◎⊙◌]?\s*(?:Thinking|Processing|Checking|Reading|Searching|Working|Loading|Generating)\b/iu.test(
    plain,
  );
}

/** Return true when a server error proves the PTY session is no longer live. */
function dashboardTerminalErrorEndsSession(message: string): boolean {
  return (
    /\bSession not found or already terminated\b/i.test(message) ||
    /\bSession killed: idle timeout\b/i.test(message)
  );
}

/** Heuristic for a freshly launched runner reaching its interactive prompt. */
function dashboardOutputLooksReadyForLaunchPrompt(
  text: string,
  runner?: RunnerId | null,
): boolean {
  const tail = dashboardPlainTerminalText(text).slice(-5000);
  if (dashboardOutputLooksRunnerStartupFailure(tail, runner)) return false;
  // Antigravity composer-ready signal verified live against `agy` 1.0.1
  // (2026-05-24 browser-use smoke against dashboard PTY). Two anchors:
  //   1. "Antigravity CLI <version>" — identity line present from launch.
  //   2. "? for shortcuts" — composer hint shown only after the box border
  //      and model row are drawn.
  // Combined the two patterns are uniquely Antigravity and don't collide with
  // Claude's `/effort`-keyed composer.
  const antigravityReady =
    /Antigravity CLI [0-9]/i.test(tail) &&
    /\?[\s\S]{0,80}for[\s\S]{0,80}shortcuts\b/i.test(tail);
  if (runner === "antigravity") return antigravityReady;
  const claudeReady =
    /\/remote-control is active\b/i.test(tail) &&
    /(^|\n)\s*❯\s*(?:\n|$)/u.test(tail);
  const claudeComposerReady =
    /\?[\s\S]{0,80}for[\s\S]{0,80}shortcuts\b/i.test(tail) &&
    /\/effort\b/i.test(tail);
  const shellReady = /(^|\n)\s*(?:[$#]|>)\s*$/u.test(tail);
  return claudeReady || claudeComposerReady || shellReady;
}

/** Heuristic for runner startup failures where launch prompt delivery is unsafe. */
function dashboardOutputLooksRunnerStartupFailure(
  text: string,
  runner?: RunnerId | null,
): boolean {
  const tail = dashboardPlainTerminalText(text).slice(-5000);
  if (
    (runner === "codex" || /\bcodex\b/i.test(tail)) &&
    /\bError loading configuration:/i.test(tail)
  ) {
    return true;
  }
  return /\bfailed to load Codex config\b/i.test(tail);
}

/**
 * Extract a one-line summary of the runner startup error captured in `text`
 * so we can attach the real cause to the loading-overlay banner instead of
 * the bare generic message. Returns the trimmed first line of the matched
 * error, or null if no recognised error pattern is present.
 */
function dashboardExtractRunnerStartupError(text: string): string | null {
  const tail = dashboardPlainTerminalText(text).slice(-5000);
  const patterns: RegExp[] = [
    /Error loading configuration:[^\n]+/i,
    /failed to load Codex config[^\n]*/i,
  ];
  for (const pattern of patterns) {
    const match = tail.match(pattern);
    if (match) {
      const detail = match[0].trim();
      return detail.length > 300 ? `${detail.slice(0, 300)}...` : detail;
    }
  }
  return null;
}

/** Compose the runner-startup error banner: generic prefix + captured detail. */
function dashboardRunnerStartupFailureMessage(text: string): string {
  const detail = dashboardExtractRunnerStartupError(text);
  return detail
    ? `${RUNNER_STARTUP_FAILURE_MESSAGE} ${detail}`
    : RUNNER_STARTUP_FAILURE_MESSAGE;
}

/** Heuristic for Claude Code committing a long bracketed paste into the composer. */
function dashboardOutputLooksCommittedPaste(text: string): boolean {
  const plain = dashboardPlainTerminalText(text);
  return (
    /\[Pasted\s+text(?:\s+#\d+|:)/i.test(plain) ||
    /paste\s+again\s+to\s+expand/i.test(plain)
  );
}

/** Return true for xterm-generated protocol replies, not deliberate user input. */
function dashboardTerminalDataLooksProtocolResponse(data: string): boolean {
  return (
    /^\x1b\[(?:I|O)$/.test(data) ||
    /^\x1b\[(?:\?|>)?[0-9;]*c$/.test(data) ||
    /^\x1b\[\d+(?:;\d+)*[Rn]$/.test(data)
  );
}

/** Heuristic for a long paste that is still parked in the runner composer. */
function dashboardOutputStillAtCommittedPaste(text: string): boolean {
  const tail = dashboardPlainTerminalText(text)
    .replace(/[ \t]+/g, " ")
    .trim();
  if (!dashboardOutputLooksCommittedPaste(tail)) return false;
  if (dashboardOutputLooksAwaitingInput(tail)) return false;
  if (/\b(?:Running|Working)\b|Do you want to proceed\?/i.test(tail)) {
    return false;
  }
  return /paste\s*again\s*to\s*expand[\s\S]{0,160}$/i.test(tail);
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
  const tailStillAwaiting = dashboardOutputLooksAwaitingInput(nextTail);
  if (!chunkHasText) return previousAwaiting && tailStillAwaiting;
  if (
    tailStillAwaiting &&
    (previousAwaiting ||
      dashboardOutputTailEndsWithAwaitingInputStart(previousTail)) &&
    dashboardOutputLooksAwaitingInputContinuation(outputChunk)
  ) {
    return true;
  }
  if (
    previousAwaiting &&
    tailStillAwaiting &&
    dashboardOutputLooksTransientStatusRedraw(outputChunk)
  ) {
    return true;
  }
  return false;
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

/** Clear the loading-overlay escalation timers for one terminal session. */
function dashboardClearTerminalLoadingTimers(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
  if (!refs) return;
  if (refs.loadingSlowTimer) {
    clearTimeout(refs.loadingSlowTimer);
    refs.loadingSlowTimer = undefined;
  }
  if (refs.loadingRetryTimer) {
    clearTimeout(refs.loadingRetryTimer);
    refs.loadingRetryTimer = undefined;
  }
}

/** Move one session through the terminal loading-overlay state machine. */
function dashboardSetTerminalLoadingPhase(
  ctx: DashboardTerminalContext,
  sessionId: string,
  fallback: LocalSession,
  phase: TerminalLoadingPhase,
  error?: string,
): void {
  if (phase === "ready" || phase === "error") {
    dashboardClearTerminalLoadingTimers(ctx, sessionId);
  }
  dashboardMutateLocalSession(ctx, sessionId, fallback, (target) => {
    target.loadingPhase = phase;
    if (phase === "error") {
      target.loadingError = error || "Could not start session.";
      target.loadingShowRetry = true;
    } else {
      target.loadingError = undefined;
      if (phase === "ready") {
        target.loadingShowSlowHint = false;
        target.loadingShowRetry = false;
      }
    }
  });
}

/** Arm the slow-start and retry affordances for the loading overlay. */
function dashboardArmTerminalLoadingTimers(
  ctx: DashboardTerminalContext,
  sessionId: string,
  fallback: LocalSession,
): void {
  const refs = ctx._terminalRefs[sessionId];
  if (!refs) return;
  dashboardClearTerminalLoadingTimers(ctx, sessionId);
  refs.loadingSlowTimer = setTimeout(() => {
    refs.loadingSlowTimer = undefined;
    const current = ctx.sessions.find((s) => s.id === sessionId) ?? fallback;
    if (current.ended || current.loadingPhase === "ready") return;
    dashboardMutateLocalSession(ctx, sessionId, fallback, (target) => {
      target.loadingShowSlowHint = true;
    });
  }, TERMINAL_LOADING_SLOW_HINT_MS);
  refs.loadingRetryTimer = setTimeout(() => {
    refs.loadingRetryTimer = undefined;
    const current = ctx.sessions.find((s) => s.id === sessionId) ?? fallback;
    if (current.ended || current.loadingPhase === "ready") return;
    dashboardMutateLocalSession(ctx, sessionId, fallback, (target) => {
      target.loadingShowRetry = true;
    });
  }, TERMINAL_LOADING_RETRY_MS);
}

/** Mark the loading overlay ready as soon as the PTY sends its first output. */
function dashboardMarkTerminalLoadingReady(
  ctx: DashboardTerminalContext,
  sessionId: string,
  fallback: LocalSession,
  previousTail: string,
  output: string,
): void {
  if (previousTail.length > 0 || output.length === 0) return;
  dashboardSetTerminalLoadingPhase(ctx, sessionId, fallback, "ready");
}

/** Cancel a pending "awaiting input" reveal for one terminal session. */
function dashboardClearAwaitingInputTimer(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
  if (!refs?.awaitingInputTimer) return;
  clearTimeout(refs.awaitingInputTimer);
  refs.awaitingInputTimer = undefined;
}

/** Show the waiting badge only after waiting-looking output stays quiet. */
function dashboardScheduleAwaitingInputReveal(
  ctx: DashboardTerminalContext,
  sessionId: string,
  fallback: LocalSession,
): void {
  const refs = ctx._terminalRefs[sessionId];
  if (!refs || refs.awaitingInputTimer) return;
  refs.awaitingInputTimer = setTimeout(() => {
    refs.awaitingInputTimer = undefined;
    const reactive = ctx.sessions.find((s) => s.id === sessionId);
    const current = reactive ?? fallback;
    if (current.ended) return;
    if (!dashboardOutputLooksAwaitingInput(current.outputTail ?? "")) return;
    dashboardMutateLocalSession(ctx, sessionId, fallback, (target) => {
      target.awaitingInput = true;
    });
  }, AWAITING_INPUT_VISIBLE_DELAY_MS);
}

/** Cancel a delayed submit for a bracketed paste. */
function dashboardClearPasteSubmitTimer(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
  if (!refs?.pasteSubmitTimer) return;
  clearTimeout(refs.pasteSubmitTimer);
  refs.pasteSubmitTimer = undefined;
}

/** Cancel all pending delayed submit state for a bracketed paste. */
function dashboardClearPasteSubmitState(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  dashboardClearPasteSubmitTimer(ctx, sessionId);
  const refs = ctx._terminalRefs[sessionId];
  if (refs) {
    refs.pasteSubmitQueue = undefined;
    refs.pasteSubmitOutputTail = undefined;
    refs.pasteSubmitAwaitingCommit = false;
    refs.pasteSubmitFallbackSubmitted = false;
  }
}

/** Submit the current terminal composer if the session is still attached. */
function dashboardSendTerminalSubmit(
  ctx: DashboardTerminalContext,
  sessionId: string,
): boolean {
  const refs = ctx._terminalRefs[sessionId];
  if (!refs?.ws || refs.ws.readyState !== WebSocket.OPEN) return false;
  refs.ws.send(JSON.stringify({ type: "input", data: "\r" }));
  return true;
}

function dashboardArmPasteSubmitTimer(
  ctx: DashboardTerminalContext,
  sessionId: string,
  {
    delayMs = TERMINAL_PASTE_MARKER_SETTLE_DELAY_MS,
    retryCount = 0,
    keepAwaitingCommit = false,
    retryIfStillCommitted = false,
  }: {
    delayMs?: number;
    retryCount?: number;
    keepAwaitingCommit?: boolean;
    retryIfStillCommitted?: boolean;
  } = {},
): void {
  const refs = ctx._terminalRefs[sessionId];
  if (!refs) return;
  dashboardClearPasteSubmitTimer(ctx, sessionId);
  if (retryCount === 0) refs.pasteSubmitOutputTail = "";
  refs.pasteSubmitTimer = setTimeout(() => {
    const currentRefs = ctx._terminalRefs[sessionId];
    if (currentRefs) currentRefs.pasteSubmitTimer = undefined;
    const submitted = dashboardSubmitPendingPaste(ctx, sessionId, {
      keepAwaitingCommit,
      retryIfStillCommitted,
    });
    if (!submitted && retryCount < TERMINAL_PASTE_SUBMIT_MAX_RETRIES) {
      dashboardArmPasteSubmitTimer(ctx, sessionId, {
        delayMs: TERMINAL_PASTE_SUBMIT_RETRY_DELAY_MS,
        retryCount: retryCount + 1,
        keepAwaitingCommit,
        retryIfStillCommitted,
      });
    }
  }, delayMs);
}

function dashboardReleaseFallbackPasteSubmit(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
  if (!refs?.pasteSubmitAwaitingCommit) return;
  refs.pasteSubmitTimer = undefined;
  refs.pasteSubmitAwaitingCommit = false;
  refs.pasteSubmitFallbackSubmitted = false;
  dashboardSendNextQueuedPaste(ctx, sessionId);
}

function dashboardArmPasteSubmitRetryIfStillCommitted(
  ctx: DashboardTerminalContext,
  sessionId: string,
  retryCount = 0,
): boolean {
  const refs = ctx._terminalRefs[sessionId];
  const target = ctx.sessions.find((session) => session.id === sessionId);
  if (!refs || typeof target?.outputTail !== "string") {
    return false;
  }
  refs.pasteSubmitTimer = setTimeout(() => {
    const currentRefs = ctx._terminalRefs[sessionId];
    if (currentRefs) currentRefs.pasteSubmitTimer = undefined;
    const currentTarget = ctx.sessions.find(
      (session) => session.id === sessionId,
    );
    const currentTail = currentTarget?.outputTail ?? "";
    // The stuck-paste heuristic is the loop condition; snapshot equality was
    // only a single-shot fallback and can fire on marker text that already moved.
    if (dashboardOutputStillAtCommittedPaste(currentTail)) {
      dashboardSendTerminalSubmit(ctx, sessionId);
      const nextRetryCount = retryCount + 1;
      if (nextRetryCount < TERMINAL_PASTE_SUBMIT_MAX_RETRIES) {
        dashboardArmPasteSubmitRetryIfStillCommitted(
          ctx,
          sessionId,
          nextRetryCount,
        );
        return;
      }
    }
    dashboardSendNextQueuedPaste(ctx, sessionId);
  }, TERMINAL_PASTE_SUBMIT_RETRY_CADENCE_MS);
  return true;
}

function dashboardSendNextQueuedPaste(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
  const next = refs?.pasteSubmitQueue?.shift();
  if (!refs || !next) return;
  if (refs.pasteSubmitQueue?.length === 0) refs.pasteSubmitQueue = undefined;
  dashboardSendBracketedPaste(ctx, sessionId, next);
}

/** Submit a bracketed paste once the runner has had time to commit it. */
function dashboardSubmitPendingPaste(
  ctx: DashboardTerminalContext,
  sessionId: string,
  {
    keepAwaitingCommit = false,
    retryIfStillCommitted = false,
  }: {
    keepAwaitingCommit?: boolean;
    retryIfStillCommitted?: boolean;
  } = {},
): boolean {
  dashboardClearPasteSubmitTimer(ctx, sessionId);
  const submitted = dashboardSendTerminalSubmit(ctx, sessionId);
  const refs = ctx._terminalRefs[sessionId];
  if (!submitted) return false;
  if (keepAwaitingCommit && refs?.pasteSubmitAwaitingCommit) {
    refs.pasteSubmitFallbackSubmitted = true;
    refs.pasteSubmitTimer = setTimeout(() => {
      dashboardReleaseFallbackPasteSubmit(ctx, sessionId);
    }, TERMINAL_PASTE_FALLBACK_RELEASE_DELAY_MS);
    return true;
  }
  if (refs) {
    refs.pasteSubmitAwaitingCommit = false;
    refs.pasteSubmitFallbackSubmitted = retryIfStillCommitted;
  }
  if (
    retryIfStillCommitted &&
    dashboardArmPasteSubmitRetryIfStillCommitted(ctx, sessionId)
  ) {
    return true;
  }
  dashboardSendNextQueuedPaste(ctx, sessionId);
  return submitted;
}

function dashboardSendBracketedPaste(
  ctx: DashboardTerminalContext,
  sessionId: string,
  paste: DashboardQueuedPaste,
): void {
  const refs = ctx._terminalRefs[sessionId];
  if (!refs?.ws || refs.ws.readyState !== WebSocket.OPEN) return;
  refs.ws.send(JSON.stringify({ type: "input", data: paste.data }));
  if (paste.shouldDelaySubmit) {
    const target = ctx.sessions.find((session) => session.id === sessionId);
    const claudeNoMarkerFallback = target?.runner === "claude";
    refs.pasteSubmitAwaitingCommit = true;
    refs.pasteSubmitFallbackSubmitted = false;
    dashboardArmPasteSubmitTimer(ctx, sessionId, {
      delayMs: claudeNoMarkerFallback
        ? TERMINAL_CLAUDE_PASTE_NO_MARKER_FALLBACK_DELAY_MS
        : TERMINAL_PASTE_COMMIT_FALLBACK_DELAY_MS,
      keepAwaitingCommit: !claudeNoMarkerFallback,
      retryIfStillCommitted: claudeNoMarkerFallback,
    });
  } else if (dashboardSendTerminalSubmit(ctx, sessionId)) {
    dashboardSendNextQueuedPaste(ctx, sessionId);
  } else {
    dashboardArmPasteSubmitTimer(ctx, sessionId, {
      delayMs: TERMINAL_PASTE_SUBMIT_RETRY_DELAY_MS,
      retryCount: 1,
    });
  }
}

function dashboardSendOrQueueBracketedPaste(
  ctx: DashboardTerminalContext,
  sessionId: string,
  paste: DashboardQueuedPaste,
): void {
  const refs = ctx._terminalRefs[sessionId];
  if (!refs) return;
  if (refs.pasteSubmitTimer || refs.pasteSubmitAwaitingCommit) {
    refs.pasteSubmitQueue = [...(refs.pasteSubmitQueue ?? []), paste];
    return;
  }
  dashboardSendBracketedPaste(ctx, sessionId, paste);
}

/** React to runner output while a bracketed paste submit is pending. */
function dashboardHandlePasteSubmitOutput(
  ctx: DashboardTerminalContext,
  sessionId: string,
  output: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
  const target = ctx.sessions.find((session) => session.id === sessionId);
  const runnerUsesPasteMarker =
    target?.runner === "claude" || target?.runner === "antigravity";
  const hasPendingPaste =
    refs?.pasteSubmitTimer !== undefined ||
    refs?.pasteSubmitAwaitingCommit === true;
  if (!refs || (!hasPendingPaste && !runnerUsesPasteMarker)) return;
  const outputTail = ((refs.pasteSubmitOutputTail ?? "") + output).slice(-2000);
  refs.pasteSubmitOutputTail = outputTail;
  const committedPaste = dashboardOutputLooksCommittedPaste(
    hasPendingPaste ? outputTail : output,
  );
  if (committedPaste) {
    const alreadySubmitted = refs.pasteSubmitFallbackSubmitted === true;
    refs.pasteSubmitAwaitingCommit = false;
    if (alreadySubmitted) return;
    refs.pasteSubmitFallbackSubmitted = false;
    // A "[Pasted text]" marker echoed back when nothing is awaiting submit
    // means the paste was already submitted (e.g. immediate-submit path for
    // single-line pastes) or originated outside the dashboard. Don't fire a
    // spurious extra Enter.
    if (!hasPendingPaste) return;
    if (target?.runner === "claude" || target?.runner === "antigravity") {
      dashboardArmPasteSubmitTimer(ctx, sessionId, {
        delayMs: TERMINAL_PASTE_MARKER_SETTLE_DELAY_MS,
        retryIfStillCommitted: true,
      });
    } else {
      dashboardSubmitPendingPaste(ctx, sessionId);
    }
  }
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
  // M07: launched prompts may suggest learning-loop follow-up, but automatic
  // durable lesson/footgun/pattern/decision writes require opted-in CLI capture.
  const writeLine = mayWrite
    ? "Write behavior: this preset may write only after the prompt or user explicitly approves it."
    : "Write behavior: default to read-only analysis; do not write files in the selected target unless the user explicitly asks.";
  const routeLine =
    preset?.route === "goat-plan" && /^\/goat-plan\b/.test(presetPrompt)
      ? "goat-plan global mode: honor Step 0 modes; analysis/path-only stay read-only, while File-Write modes may create target .goat-flow/tasks when this preset allows writes or the prompt explicitly requests files."
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

/** Read loaded xterm.js constructors; throws if asset loading did not attach globals. */
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

/** Send text to a specific terminal session without changing the active tab. */
function dashboardSendToTerminalSession(
  ctx: DashboardTerminalContext,
  sessionId: string,
  text: string,
  { adapt = true }: { adapt?: boolean } = {},
): boolean {
  const target = ctx.sessions.find((session) => session.id === sessionId);
  if (!target) {
    ctx.showToast("No active terminal session", true);
    return false;
  }
  const refs = ctx._terminalRefs[sessionId];
  if (!refs?.ws || refs.ws.readyState !== WebSocket.OPEN) {
    ctx.showToast("No active terminal session", true);
    return false;
  }
  const prepared = dashboardPreparePasteBody(
    adapt ? ctx.adaptPrompt(text, target.runner) : text,
  );
  // Bracketed paste prevents shells and REPLs from treating multi-line prompts as
  // a stream of independent keystrokes. Claude Code commits long pastes
  // asynchronously, so submit on its pasted-text echo or fall back after a short
  // bounded delay for CLIs that do not echo that state.
  const pasteData = "\x1b[200~" + prepared + "\x1b[201~";
  // Claude/Antigravity only compress MULTI-LINE pastes into the "[Pasted text]"
  // marker we detect to submit fast. Single-line pastes render inline with no
  // marker, so waiting hits the 15s fallback. Submit those immediately to
  // match the existing single-line/non-Claude semantics. M04 must verify this
  // assumption against captured `agy` PTY output.
  const isMultiLinePaste = prepared.includes("\n");
  const delayedSubmit =
    (target.runner === "claude" || target.runner === "antigravity") &&
    isMultiLinePaste;
  dashboardSendOrQueueBracketedPaste(ctx, sessionId, {
    data: pasteData,
    shouldDelaySubmit: delayedSubmit,
  });
  dashboardClearAwaitingInputTimer(ctx, sessionId);
  target.lastInputTime = Date.now();
  target.awaitingInput = false;
  if (ctx.activeSessionId === sessionId && refs.xterm) refs.xterm.focus();
  return true;
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
  return dashboardSendToTerminalSession(ctx, active.id, text, { adapt });
}

/** Cancel the absolute fallback for one pending dashboard launch prompt. */
function dashboardClearLaunchPromptFallbackTimer(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
  if (!refs?.launchPromptFallbackTimer) return;
  clearTimeout(refs.launchPromptFallbackTimer);
  refs.launchPromptFallbackTimer = undefined;
}

/** Cancel quiet-window delivery for one pending dashboard launch prompt. */
function dashboardClearLaunchPromptQuietTimer(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
  if (!refs?.launchPromptQuietTimer) return;
  clearTimeout(refs.launchPromptQuietTimer);
  refs.launchPromptQuietTimer = undefined;
}

/** Clear any pending dashboard launch prompt state for one terminal session. */
function dashboardClearLaunchPrompt(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
  if (!refs) return;
  dashboardClearLaunchPromptFallbackTimer(ctx, sessionId);
  dashboardClearLaunchPromptQuietTimer(ctx, sessionId);
  refs.launchPrompt = undefined;
  refs.launchPromptOutputSeen = false;
}

/** Send a pending dashboard launch prompt once the terminal is ready. */
function dashboardMaybeSendLaunchPrompt(
  ctx: DashboardTerminalContext,
  sessionId: string,
  { force = false }: { force?: boolean } = {},
): boolean {
  const refs = ctx._terminalRefs[sessionId];
  const prompt = refs?.launchPrompt;
  if (!prompt) return false;
  const target = ctx.sessions.find((session) => session.id === sessionId);
  if (!target || target.ended) {
    dashboardClearLaunchPrompt(ctx, sessionId);
    return false;
  }
  if (!refs.ws || refs.ws.readyState !== WebSocket.OPEN) return false;
  const outputTail = target.outputTail ?? "";
  if (dashboardOutputLooksRunnerStartupFailure(outputTail, target.runner)) {
    dashboardSetTerminalLoadingPhase(
      ctx,
      sessionId,
      target,
      "error",
      dashboardRunnerStartupFailureMessage(outputTail),
    );
    dashboardClearLaunchPrompt(ctx, sessionId);
    return false;
  }
  const ready = dashboardOutputLooksReadyForLaunchPrompt(
    outputTail,
    target.runner,
  );
  if (!ready && (!force || target.runner === "antigravity")) {
    return false;
  }
  refs.launchPrompt = undefined;
  dashboardClearLaunchPromptFallbackTimer(ctx, sessionId);
  dashboardClearLaunchPromptQuietTimer(ctx, sessionId);
  refs.launchPromptOutputSeen = false;
  return dashboardSendToTerminalSession(ctx, sessionId, prompt, {
    adapt: false,
  });
}

/** Arm the conservative fallback used only if the runner produces no output. */
function dashboardArmLaunchPromptNoOutputFallback(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
  if (
    !refs?.launchPrompt ||
    refs.launchPromptOutputSeen === true ||
    refs.launchPromptFallbackTimer ||
    !refs.ws ||
    refs.ws.readyState !== WebSocket.OPEN
  ) {
    return;
  }
  refs.launchPromptFallbackTimer = setTimeout(() => {
    const currentRefs = ctx._terminalRefs[sessionId];
    if (currentRefs) currentRefs.launchPromptFallbackTimer = undefined;
    dashboardMaybeSendLaunchPrompt(ctx, sessionId, { force: true });
  }, TERMINAL_LAUNCH_PROMPT_NO_OUTPUT_FALLBACK_DELAY_MS);
}

/**
 * Arm a short cap once runner output proves the PTY stream is live. The cap
 * is unconditional by design: it exists for runners that emit output but never
 * surface a known readiness marker (custom prompts, alternate CLIs). Gating
 * the force-send on a readiness check would stall those sessions forever; the
 * sibling quiet-window path covers the more common "output settles then send"
 * case.
 */
function dashboardArmLaunchPromptAfterOutputFallback(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
  if (!refs?.launchPrompt || refs.launchPromptFallbackTimer) return;
  refs.launchPromptFallbackTimer = setTimeout(() => {
    const currentRefs = ctx._terminalRefs[sessionId];
    if (currentRefs) currentRefs.launchPromptFallbackTimer = undefined;
    dashboardMaybeSendLaunchPrompt(ctx, sessionId, { force: true });
  }, TERMINAL_LAUNCH_PROMPT_AFTER_OUTPUT_FALLBACK_DELAY_MS);
}

/** Schedule prompt delivery after runner output has settled. */
function dashboardScheduleLaunchPromptQuietSend(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
  if (!refs?.launchPrompt || !refs.ws || refs.ws.readyState !== WebSocket.OPEN)
    return;
  dashboardClearLaunchPromptQuietTimer(ctx, sessionId);
  refs.launchPromptQuietTimer = setTimeout(() => {
    const currentRefs = ctx._terminalRefs[sessionId];
    if (currentRefs) currentRefs.launchPromptQuietTimer = undefined;
    dashboardMaybeSendLaunchPrompt(ctx, sessionId, { force: true });
  }, TERMINAL_LAUNCH_PROMPT_QUIET_DELAY_MS);
}

/** React to a new output chunk while a dashboard launch prompt is pending. */
function dashboardHandleLaunchPromptOutput(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
  if (!refs?.launchPrompt) return;
  const firstOutput = refs.launchPromptOutputSeen !== true;
  refs.launchPromptOutputSeen = true;
  if (dashboardMaybeSendLaunchPrompt(ctx, sessionId)) return;
  if (firstOutput) {
    dashboardClearLaunchPromptFallbackTimer(ctx, sessionId);
    dashboardArmLaunchPromptAfterOutputFallback(ctx, sessionId);
  }
  dashboardScheduleLaunchPromptQuietSend(ctx, sessionId);
}

/** Send a dashboard launch prompt after the browser terminal is attached. */
function dashboardScheduleLaunchPrompt(
  ctx: DashboardTerminalContext,
  sessionId: string,
  prompt: string,
): void {
  if (!prompt.trim()) return;
  dashboardClearLaunchPrompt(ctx, sessionId);
  const refs = ctx._terminalRefs[sessionId] ?? {};
  refs.launchPrompt = prompt;
  refs.launchPromptOutputSeen = false;
  ctx._terminalRefs[sessionId] = refs;
  dashboardArmLaunchPromptNoOutputFallback(ctx, sessionId);
  dashboardMaybeSendLaunchPrompt(ctx, sessionId);
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
    const res = await dashboardFetch("/api/health");
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
      if (
        ctx.terminalAvailable &&
        (ctx.activeView === "workspace" || ctx.activeView === "setup")
      ) {
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
  if (sessionRefreshPromise) return sessionRefreshPromise;
  sessionRefreshPromise = new Promise<void>((resolve) => {
    sessionRefreshDebounceTimer = setTimeout(() => {
      void dashboardUpdateSessionCountImpl(ctx).finally(() => {
        sessionRefreshPromise = null;
        sessionRefreshDebounceTimer = null;
        resolve();
      });
    }, SESSION_REFRESH_DEBOUNCE_MS);
  });
  return sessionRefreshPromise;
}

async function dashboardUpdateSessionCountImpl(
  ctx: DashboardTerminalContext,
): Promise<void> {
  try {
    const res = await dashboardFetch("/api/terminal/sessions");
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
    const activeIds = new Set(ctx.serverSessions.map((session) => session.id));
    for (const session of ctx.sessions) {
      if (session.ended || session.connected || activeIds.has(session.id)) {
        continue;
      }
      dashboardClearAwaitingInputTimer(ctx, session.id);
      dashboardClearTerminalLoadingTimers(ctx, session.id);
      session.ended = true;
      session.awaitingInput = false;
      ctx._forgetSavedSession(session.id);
    }
  } catch {
    /* ignore */
  }
}

/** Clear non-active (terminated/starting) terminal sessions, preserving running ones. */
async function dashboardEndAllSessions(
  ctx: DashboardTerminalContext,
): Promise<void> {
  try {
    const res = await dashboardFetch("/api/terminal/sessions");
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
      await dashboardFetch(`/api/terminal/${session.id}`, {
        method: "DELETE",
      });
    }
    ctx.recentTerminalSessions = [];
    const keptRefs: typeof ctx._terminalRefs = {};
    for (const id of Object.keys(ctx._terminalRefs)) {
      if (activeIds.has(id)) {
        const active = ctx._terminalRefs[id];
        if (active) keptRefs[id] = active;
      } else {
        const refs = ctx._terminalRefs[id];
        dashboardClearTerminalLoadingTimers(ctx, id);
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
function removeXtermAssetElements(): void {
  document
    .querySelector('link[rel="stylesheet"][href="/assets/xterm.css"]')
    ?.remove();
  document.querySelector('script[src="/assets/xterm.js"]')?.remove();
  document.querySelector('script[src="/assets/addon-fit.js"]')?.remove();
}

function waitForAssetElement(
  element: HTMLLinkElement | HTMLScriptElement,
  label: string,
): Promise<void> {
  if (element.dataset["loaded"] === "true") return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} load timeout`));
    }, 5000);
    const cleanup = (): void => {
      clearTimeout(timer);
      element.removeEventListener("load", onLoad);
      element.removeEventListener("error", onError);
    };
    const onLoad = (): void => {
      cleanup();
      element.dataset["loaded"] = "true";
      resolve();
    };
    const onError = (): void => {
      cleanup();
      reject(new Error(`${label} load failed`));
    };
    element.addEventListener("load", onLoad, { once: true });
    element.addEventListener("error", onError, { once: true });
  });
}

/** Load xterm CSS once, reusing an existing tag so reconnects do not duplicate assets. */
async function loadXtermStylesheet(): Promise<void> {
  const existing = document.querySelector<HTMLLinkElement>(
    'link[rel="stylesheet"][href="/assets/xterm.css"]',
  );
  if (existing) {
    await waitForAssetElement(existing, "xterm.css");
    return;
  }
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/assets/xterm.css";
  const loaded = waitForAssetElement(link, "xterm.css");
  document.head.appendChild(link);
  await loaded;
}

/** Load one xterm script asset, waiting for existing tags when another tab started first. */
async function loadXtermScript(src: string, label: string): Promise<void> {
  const existing = document.querySelector<HTMLScriptElement>(
    `script[src="${src}"]`,
  );
  if (existing) {
    await waitForAssetElement(existing, label);
    return;
  }
  const script = document.createElement("script");
  script.src = src;
  const loaded = waitForAssetElement(script, label);
  document.head.appendChild(script);
  await loaded;
}

async function dashboardLoadXterm(
  ctx: DashboardTerminalContext,
): Promise<void> {
  if (ctx._xtermLoaded) return;
  if (!xtermLoadPromise) {
    xtermLoadPromise = (async () => {
      await loadXtermStylesheet();
      // The fit addon patches the global Terminal constructor, so xterm itself
      // has to finish loading before the addon script is appended.
      await loadXtermScript("/assets/xterm.js", "xterm.js");
      await loadXtermScript("/assets/addon-fit.js", "fit addon");
      getXtermConstructors();
    })();
  }
  try {
    await xtermLoadPromise;
    ctx._xtermLoaded = true;
  } catch (err) {
    xtermLoadPromise = null;
    removeXtermAssetElements();
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
    dashboardClearTerminalLoadingTimers(ctx, id);
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
  const aliveMap = new Map<string, ServerSessionInfo>();
  try {
    const res = await dashboardFetch("/api/terminal/sessions");
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
  if (!savedList || savedList.length === 0) {
    const activeId = ctx.activeSessionId;
    const activeServerSession = activeId ? aliveMap.get(activeId) : null;
    if (!activeServerSession) return false;
    await ctx.openServerSession(activeServerSession);
    return true;
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
      loadingPhase: "connecting",
      loadingShowSlowHint: false,
      loadingShowRetry: false,
      age: "",
      presetId: null,
    };
    ctx.rememberSessionTitle(session.id, session.promptLabel);
    ctx.sessions.push(session);
    ctx._terminalRefs[session.id] = {
      retryPrompt: "",
      retryPromptLabel: session.promptLabel,
      retryPresetId: null,
      retryCwdPath: session.cwd,
      retryTargetPath: session.targetPath,
    };
    dashboardArmTerminalLoadingTimers(ctx, session.id, session);
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
    let xtermPromise: Promise<{ ok: true } | { ok: false; error: unknown }>;
    try {
      xtermPromise = ctx.loadXterm().then(
        () => ({ ok: true }) as const,
        (error: unknown) => ({ ok: false, error }) as const,
      );
    } catch (error) {
      xtermPromise = Promise.resolve({ ok: false, error });
    }
    const res = await dashboardFetch("/api/terminal/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "",
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
      loadingPhase: "connecting",
      loadingShowSlowHint: false,
      loadingShowRetry: false,
      age: "",
      presetId,
    };
    createdSessionId = session.id;
    ctx.rememberSessionTitle(session.id, session.promptLabel);
    ctx.sessions.push(session);
    ctx._terminalRefs[session.id] = {
      retryPrompt: prompt,
      retryPromptLabel: session.promptLabel,
      retryPresetId: presetId,
      retryCwdPath: controllingCwd,
      retryTargetPath: selectedTargetPath,
    };
    dashboardArmTerminalLoadingTimers(ctx, session.id, session);
    ctx.activeSessionId = session.id;
    ctx.activeView = "workspace";
    ctx.workspacePanel = "terminal";
    await self.$nextTick();
    const xtermResult = await xtermPromise;
    if (!xtermResult.ok) throw xtermResult.error;
    ctx.connectTerminal(session.id, wsUrl);
    dashboardScheduleLaunchPrompt(ctx, session.id, prompt);
    void ctx.updateSessionCount();
  } catch (err) {
    if (createdSessionId) {
      const failedSessionId = createdSessionId;
      const refs = ctx._terminalRefs[failedSessionId];
      dashboardClearTerminalLoadingTimers(ctx, failedSessionId);
      if (refs?.cleanup) refs.cleanup();
      Reflect.deleteProperty(ctx._terminalRefs, failedSessionId);
      ctx.sessions = ctx.sessions.filter((s) => s.id !== failedSessionId);
      if (ctx.activeSessionId === failedSessionId) {
        ctx.activeSessionId = ctx.sessions[0]?.id || null;
      }
      dashboardFetch(`/api/terminal/${failedSessionId}`, {
        method: "DELETE",
      }).catch(() => {});
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
    scrollback: 10000,
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
  const ws = new WebSocket(
    `${proto}//${location.host}${dashboardTerminalWsPath(wsUrl)}`,
  );
  let ageInterval: ReturnType<typeof setInterval> | null = null;
  /** Handle the terminal WebSocket opening. */
  ws.onopen = () => {
    dashboardMutateLocalSession(ctx, sessionId, session, (target) => {
      target.connected = true;
    });
    dashboardSetTerminalLoadingPhase(ctx, sessionId, session, "loading");
    setTimeout(doFit, TERMINAL_REFIT_RETRY_DELAY_MS);
    dashboardArmLaunchPromptNoOutputFallback(ctx, sessionId);
    dashboardMaybeSendLaunchPrompt(ctx, sessionId);
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
      if (ctx._terminalRefs[sessionId]?.ws !== ws) return;
      if (typeof event.data !== "string") return;
      const msg = readRecord(JSON.parse(event.data), "Terminal message");
      const type = readString(msg.type);
      if (type === "output" && typeof msg.data === "string") {
        const reactive = ctx.sessions.find((s) => s.id === sessionId);
        const refs = ctx._terminalRefs[sessionId];
        const previousTail = reactive?.outputTail ?? session.outputTail ?? "";
        const previousAwaiting =
          reactive?.awaitingInput === true ||
          session.awaitingInput === true ||
          refs.awaitingInputTimer !== undefined;
        const tail = (previousTail + msg.data).slice(-5000);
        const awaitingInput = dashboardNextAwaitingInputState(
          previousAwaiting,
          previousTail,
          msg.data,
        );
        const runnerStartupFailed = dashboardOutputLooksRunnerStartupFailure(
          tail,
          session.runner,
        );
        dashboardMutateLocalSession(ctx, sessionId, session, (target) => {
          target.outputTail = tail;
        });
        if (runnerStartupFailed) {
          dashboardSetTerminalLoadingPhase(
            ctx,
            sessionId,
            session,
            "error",
            dashboardRunnerStartupFailureMessage(tail),
          );
        } else {
          dashboardMarkTerminalLoadingReady(
            ctx,
            sessionId,
            session,
            previousTail,
            msg.data,
          );
        }
        dashboardHandlePasteSubmitOutput(ctx, sessionId, msg.data);
        if (refs.launchPrompt)
          dashboardHandleLaunchPromptOutput(ctx, sessionId);
        if (awaitingInput) {
          if (
            reactive?.awaitingInput === true ||
            session.awaitingInput === true
          ) {
            dashboardClearAwaitingInputTimer(ctx, sessionId);
            dashboardMutateLocalSession(ctx, sessionId, session, (target) => {
              target.awaitingInput = true;
            });
          } else {
            dashboardScheduleAwaitingInputReveal(ctx, sessionId, session);
          }
        }
        // Round-6 design: the awaitingInput badge is NEVER cleared by output
        // chunks. Five rounds of trying to classify chunks (glyph allowlists,
        // tail-end heuristics, OSC-title preservation) failed because runners
        // emit continuous spinner / redraw cycles that vary by version and
        // accumulate over time, pushing the prompt content out of any bounded
        // tail window. The badge is now cleared only by signals that
        // unambiguously mean "user moved on":
        //   1. `term.onData` - user typed in the dashboard xterm. Xterm
        //      protocol replies such as focus-in/focus-out and DA responses
        //      still go to the PTY but do not clear pending paste-submit state.
        //   2. Ctrl+V paste from `attachCustomKeyEventHandler` - clipboard
        //      input goes straight to the WebSocket and bypasses `term.onData`,
        //      so it shares `markUserInputSent()` with the keystroke path
        //   3. `dashboardSendToTerminalSession` - programmatic input from a
        //      preset launch (line ~943)
        //   4. Session lifecycle (exit, terminal-ending error, refresh proves
        //      gone, detach-as-end) - multiple paths in this handler
        // If the runner is answered out-of-band (e.g. via Claude's remote
        // control), the badge stays on until session exit. That trade-off is
        // explicit and acceptable: a stuck badge after out-of-band answer is
        // far less harmful than a badge that never fires at all, which was
        // the bug we shipped five rounds trying to fix. See
        // .goat-flow/lessons/design-decisions.md (search: `Three rounds of
        // the same fix shape`) and .goat-flow/patterns/architecture.md
        // (search: `Asymmetric trust - set state from output`).
        term.write(msg.data);
      } else if (type === "exit") {
        dashboardClearAwaitingInputTimer(ctx, sessionId);
        dashboardClearPasteSubmitState(ctx, sessionId);
        dashboardClearLaunchPrompt(ctx, sessionId);
        dashboardClearTerminalLoadingTimers(ctx, sessionId);
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
        const terminalEnded = dashboardTerminalErrorEndsSession(msg.message);
        if (session.loadingPhase !== "ready") {
          dashboardSetTerminalLoadingPhase(
            ctx,
            sessionId,
            session,
            "error",
            msg.message,
          );
        }
        if (terminalEnded) {
          dashboardClearAwaitingInputTimer(ctx, sessionId);
          dashboardClearPasteSubmitState(ctx, sessionId);
          dashboardClearLaunchPrompt(ctx, sessionId);
          dashboardClearTerminalLoadingTimers(ctx, sessionId);
          dashboardMutateLocalSession(ctx, sessionId, session, (target) => {
            target.ended = true;
            target.connected = false;
            target.awaitingInput = false;
          });
          ctx._forgetSavedSession(sessionId);
          void ctx.updateSessionCount();
        }
        term.write(`\r\n\x1b[31m${msg.message}\x1b[0m\r\n`);
      } else if (type === "shutdown") {
        dashboardClearAwaitingInputTimer(ctx, sessionId);
        dashboardClearPasteSubmitState(ctx, sessionId);
        dashboardClearLaunchPrompt(ctx, sessionId);
        dashboardClearTerminalLoadingTimers(ctx, sessionId);
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
    if (ctx._terminalRefs[sessionId]?.ws !== ws) return;
    dashboardMutateLocalSession(ctx, sessionId, session, (target) => {
      target.connected = false;
    });
    void ctx.updateSessionCount();
  };
  /** Handle terminal WebSocket errors. */
  ws.onerror = () => {
    if (ctx._terminalRefs[sessionId]?.ws !== ws) return;
    if (session.loadingPhase !== "ready") {
      dashboardSetTerminalLoadingPhase(
        ctx,
        sessionId,
        session,
        "error",
        "WebSocket connection failed",
      );
    }
    dashboardMutateLocalSession(ctx, sessionId, session, (target) => {
      target.connected = false;
    });
  };
  const markUserInputSent = (): void => {
    const lastInputTime = Date.now();
    dashboardClearAwaitingInputTimer(ctx, sessionId);
    dashboardClearPasteSubmitState(ctx, sessionId);
    dashboardMutateLocalSession(ctx, sessionId, session, (target) => {
      target.lastInputTime = lastInputTime;
      target.awaitingInput = false;
    });
  };
  term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
    if (e.type === "keydown" && e.ctrlKey && e.key === "v") {
      e.preventDefault();
      navigator.clipboard
        .readText()
        .then((text) => {
          if (text && ws.readyState === WebSocket.OPEN) {
            // Bracketed-paste markers tell runners "this is one paste, do not
            // submit on internal newlines." Copilot in particular submits on
            // every '\n' without these markers, so multi-line clipboard text
            // gets fragmented across queries. Claude / Codex / Antigravity
            // composers tolerate raw multi-line text but still benefit from
            // the explicit marker, so wrap unconditionally.
            const prepared = dashboardPreparePasteBody(text);
            const data = "\x1b[200~" + prepared + "\x1b[201~";
            ws.send(JSON.stringify({ type: "input", data }));
            markUserInputSent();
          }
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
    if (!dashboardTerminalDataLooksProtocolResponse(data)) markUserInputSent();
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
    dashboardClearAwaitingInputTimer(ctx, sessionId);
    dashboardClearPasteSubmitState(ctx, sessionId);
    dashboardClearLaunchPrompt(ctx, sessionId);
    dashboardClearTerminalLoadingTimers(ctx, sessionId);
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
    ...ctx._terminalRefs[sessionId],
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
    dashboardFetch(`/api/terminal/${sessionId}`, { method: "DELETE" }).catch(
      () => {},
    );
  }
  ctx.rememberRecentSession(session);
  const refs = ctx._terminalRefs[sessionId];
  dashboardClearTerminalLoadingTimers(ctx, sessionId);
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

/** Retry a terminal session that failed or stalled before first PTY output. */
async function dashboardRetryTerminalSession(
  ctx: DashboardTerminalContext,
  sessionId: string,
): Promise<void> {
  const session = ctx.sessions.find((s) => s.id === sessionId);
  if (!session) return;
  const refs = ctx._terminalRefs[sessionId];
  const prompt = refs?.retryPrompt ?? refs?.launchPrompt ?? "";
  const runner = session.runner;
  const promptLabel = refs?.retryPromptLabel ?? session.promptLabel;
  const presetId = refs?.retryPresetId ?? session.presetId;
  const cwdPath = refs?.retryCwdPath ?? session.cwd;
  const targetPath = refs?.retryTargetPath ?? session.targetPath;

  dashboardClearTerminalLoadingTimers(ctx, sessionId);
  if (refs?.cleanup) refs.cleanup();
  Reflect.deleteProperty(ctx._terminalRefs, sessionId);
  ctx.sessions = ctx.sessions.filter((s) => s.id !== sessionId);
  if (ctx.activeSessionId === sessionId) ctx.activeSessionId = null;
  await dashboardFetch(`/api/terminal/${sessionId}`, {
    method: "DELETE",
  }).catch(() => {});

  await ctx.launchInTerminal(prompt, runner, {
    promptLabel,
    presetId,
    cwdPath,
    targetPath,
  });
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
  const local = ctx.sessions.find((s) => s.id === serverSession.id && !s.ended);
  if (local) {
    ctx.activeSessionId = local.id;
    ctx.activeView = "workspace";
    ctx.workspacePanel = "terminal";
    if (!local.connected) {
      const refs = ctx._terminalRefs[local.id];
      dashboardClearTerminalLoadingTimers(ctx, local.id);
      if (refs?.cleanup) refs.cleanup();
      ctx._terminalRefs[local.id] = {
        ...ctx._terminalRefs[local.id],
        retryPrompt: "",
        retryPromptLabel: local.promptLabel,
        retryPresetId: null,
        retryCwdPath: local.cwd,
        retryTargetPath: local.targetPath,
      };
      dashboardArmTerminalLoadingTimers(ctx, local.id, local);
      const self = ctx as DashboardTerminalContext &
        AlpineMagics<DashboardTerminalContext>;
      await self.$nextTick();
      ctx.connectTerminal(local.id, `/ws/terminal/${serverSession.id}`);
    }
    return;
  }
  ctx.sessions = ctx.sessions.filter((s) => s.id !== serverSession.id);
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
    loadingPhase: "connecting",
    loadingShowSlowHint: false,
    loadingShowRetry: false,
    age: "",
    presetId: null,
  };
  ctx.rememberSessionTitle(session.id, session.promptLabel);
  ctx.sessions.push(session);
  ctx._terminalRefs[session.id] = {
    retryPrompt: "",
    retryPromptLabel: session.promptLabel,
    retryPresetId: null,
    retryCwdPath: session.cwd,
    retryTargetPath: session.targetPath,
  };
  dashboardArmTerminalLoadingTimers(ctx, session.id, session);
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
    await dashboardFetch(`/api/terminal/${sessionId}`, {
      method: "DELETE",
    }).catch(() => {});
  }
  void ctx.updateSessionCount();
}
