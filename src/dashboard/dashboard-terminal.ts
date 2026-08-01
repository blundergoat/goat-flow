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
// eslint-disable-next-line prefer-const -- false positive because dashboard-terminal-runtime.ts reassigns xtermLoadPromise across the classic-script bundle, which this file cannot see.
let xtermLoadPromise: Promise<void> | null = null;
// eslint-disable-next-line prefer-const -- false positive because dashboard-terminal-runtime.ts reassigns sessionRefreshPromise across the classic-script bundle, which this file cannot see.
let sessionRefreshPromise: Promise<void> | null = null;
// eslint-disable-next-line prefer-const -- false positive because dashboard-terminal-runtime.ts reassigns sessionRefreshDebounceTimer across the classic-script bundle, which this file cannot see.
let sessionRefreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;

/** Pending bracketed-paste payload waiting for the runner to commit or echo it. */
interface DashboardQueuedPaste {
  data: string;
  shouldDelaySubmit: boolean;
}

/** Stable Alpine state schema and terminal methods consumed by browser-side helpers. */
interface DashboardTerminalContext extends Record<
  "launching" | "_xtermLoaded" | "_detaching",
  boolean
> {
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
  availableRunners: RunnerId[];
  presets: Preset[];
  allPresets: Preset[];
  _projectSessions: Record<string, SavedSession[]>;
  _projectActiveSession: Record<string, string>;
  _terminalRefs: Record<string, TerminalRefs>;
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
  sendToTerminal(
    text: string,
    sendOptions?: Partial<Record<"adapt", boolean>>,
  ): boolean;
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
      accessMode?: TerminalAccessMode;
      captureQualityDrafts?: boolean;
      qualityDraftProjectPath?: string | null;
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
    accessMode: session.accessMode,
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
