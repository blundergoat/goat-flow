/**
 * Unit tests for dashboard terminal launch responsiveness helpers.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { ScriptTarget, transpileModule } from "typescript";
import { makeCapturingWebSocket, type TimerControls } from "./fakes.js";
import { assertExists } from "../../helpers/assert-exists.ts";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..", "..");
const DASHBOARD_TERMINAL_PATH = resolve(
  PROJECT_ROOT,
  "src",
  "dashboard",
  "dashboard-terminal.ts",
);
const DASHBOARD_TERMINAL_SOURCE_PATHS = [
  DASHBOARD_TERMINAL_PATH,
  resolve(PROJECT_ROOT, "src", "dashboard", "dashboard-terminal-paste.ts"),
  resolve(PROJECT_ROOT, "src", "dashboard", "dashboard-terminal-runtime.ts"),
  resolve(PROJECT_ROOT, "src", "dashboard", "dashboard-terminal-connect.ts"),
];
const DASHBOARD_APP_PATH = resolve(PROJECT_ROOT, "src", "dashboard", "app.ts");
const DASHBOARD_APP_SOURCE_PATHS = [
  resolve(PROJECT_ROOT, "src", "dashboard", "dashboard-app-merge.ts"),
  resolve(PROJECT_ROOT, "src", "dashboard", "dashboard-app-init.ts"),
  resolve(PROJECT_ROOT, "src", "dashboard", "dashboard-app-state-fragments.ts"),
  resolve(
    PROJECT_ROOT,
    "src",
    "dashboard",
    "dashboard-app-prompts-audit-fragments.ts",
  ),
  resolve(
    PROJECT_ROOT,
    "src",
    "dashboard",
    "dashboard-app-data-loading-fragments.ts",
  ),
  resolve(
    PROJECT_ROOT,
    "src",
    "dashboard",
    "dashboard-app-hook-setup-fragments.ts",
  ),
  resolve(
    PROJECT_ROOT,
    "src",
    "dashboard",
    "dashboard-app-skill-quality-fragments.ts",
  ),
  resolve(
    PROJECT_ROOT,
    "src",
    "dashboard",
    "dashboard-app-project-terminal-fragments.ts",
  ),
  DASHBOARD_APP_PATH,
];
const WORKSPACE_VIEW_PATH = resolve(
  PROJECT_ROOT,
  "src",
  "dashboard",
  "views",
  "workspace.html",
);
const SETUP_VIEW_PATH = resolve(
  PROJECT_ROOT,
  "src",
  "dashboard",
  "views",
  "setup.html",
);

type LaunchOptions = {
  promptLabel?: string | null;
  presetId?: string | null;
  cwdPath?: string | null;
  targetPath?: string | null;
  accessMode?: "workspace" | "reporting";
  captureQualityDrafts?: boolean;
  qualityDraftProjectPath?: string | null;
};

type LaunchContext = Record<"launching", boolean> & {
  projectPath: string;
  activeView: string;
  workspacePanel: string;
  terminalAvailable: boolean;
  terminalSessionCount: number;
  serverMaxSessions: number;
  serverSessions: unknown[];
  sessionTitles: Record<string, string>;
  recentTerminalSessions: unknown[];
  sessions: Array<Record<string, unknown>>;
  promptRunStates: Record<string, string>;
  activeSessionId: string | null;
  _terminalRefs: Record<
    string,
    {
      cleanup?: () => void;
      ws?: { readyState: number; send(payload: string): void };
      xterm?: { focus(): void };
      awaitingInputTimer?: ReturnType<typeof setTimeout>;
      pasteSubmitTimer?: ReturnType<typeof setTimeout>;
      pasteSubmitQueue?: Array<{ data: string; shouldDelaySubmit: boolean }>;
      pasteSubmitOutputTail?: string;
      pasteSubmitAwaitingCommit?: boolean;
      pasteSubmitFallbackSubmitted?: boolean;
      launchPrompt?: string;
      retryPrompt?: string;
      retryPromptLabel?: string | null;
      retryPresetId?: string | null;
      retryCwdPath?: string | null;
      retryTargetPath?: string | null;
      retryAccessMode?: "workspace" | "reporting";
      retryCaptureQualityDrafts?: boolean;
      retryQualityDraftProjectPath?: string | null;
      loadingSlowTimer?: ReturnType<typeof setTimeout>;
      loadingRetryTimer?: ReturnType<typeof setTimeout>;
      launchPromptFallbackTimer?: ReturnType<typeof setTimeout>;
      launchPromptQuietTimer?: ReturnType<typeof setTimeout>;
      launchPromptOutputSeen?: boolean;
    }
  >;
  _projectSessions: Record<string, Array<Record<string, unknown>>>;
  _projectActiveSession: Record<string, string>;
  showMaxSessionsModal: boolean;
  /**
   * Keeps runner-specific prompt rewriting injectable so payload tests can opt
   * into raw terminal bytes with `{ adapt: false }`.
   */
  adaptPrompt(prompt: string, runner?: string): string;
  /**
   * Captures dashboard toast side effects without coupling terminal tests to
   * Alpine's notification DOM.
   */
  showToast(msg: string, isError?: boolean): void;
  /**
   * Mirrors the dashboard path label helper used when terminal titles fall back
   * to the selected project or target path.
   */
  displayNameFor(path: string): string;
  /**
   * Removes saved browser-side session state when lifecycle tests end a shell.
   */
  _forgetSavedSession(sessionId: string): void;
  /**
   * Resolves once xterm assets are ready; launch ordering tests deliberately
   * delay or reject this hook.
   */
  loadXterm(): Promise<void>;
  /**
   * Attaches the browser terminal to an already-created backend session.
   */
  connectTerminal(sessionId: string, wsUrl: string): void;
  /**
   * Refreshes server terminal counts after create, reconnect, and end flows.
   */
  updateSessionCount(): Promise<void>;
  /**
   * Re-enters the launch flow when retrying a failed terminal session.
   */
  launchInTerminal(
    prompt: string,
    runner?: string,
    options?: LaunchOptions,
  ): Promise<void>;
  /**
   * Stores display titles separately from mutable backend session records.
   */
  rememberSessionTitle(
    sessionId: string,
    title: string | null | undefined,
  ): void;
  /**
   * Moves ended sessions into the recent-session rail with a UI-safe shape.
   */
  rememberRecentSession(session: Record<string, unknown>): void;
  /**
   * Derives the visible session title when the backend record lacks one.
   */
  sessionTitleFor(session: Record<string, unknown> | null): string;
  /**
   * Emulates Alpine's post-render scheduling point before terminal attachment.
   */
  $nextTick(): Promise<void>;
};

type TestTerminalSession = Record<string, unknown> & {
  id: string;
  runner: string;
  promptLabel: string;
  projectPath: string;
  cwd: string;
  targetPath: string;
  startTime: number;
  lastInputTime: number;
  connected: boolean;
  ended: boolean;
  awaitingInput: boolean;
  outputTail: string;
  loadingPhase: string;
  loadingShowSlowHint: boolean;
  loadingShowRetry: boolean;
  age: string;
  presetId: string | null;
  accessMode?: "workspace" | "reporting";
  captureQualityDrafts: boolean;
  qualityDraftProjectPath: string | null;
};

type TerminalSendHarness = {
  ctx: ReturnType<typeof makeContext>;
  sent: string[];
  session: TestTerminalSession;
  websocket: ReturnType<typeof makeCapturingWebSocket>;
};

type TerminalSendHarnessOptions = {
  id?: string;
  runner?: string;
  sent?: string[];
  session?: Partial<TestTerminalSession>;
  ref?: Record<string, unknown>;
};

type HelperContext = {
  TERMINAL_PASTE_MARKER_SETTLE_DELAY_MS: number;
  TERMINAL_CLAUDE_PASTE_NO_MARKER_FALLBACK_DELAY_MS: number;
  TERMINAL_PASTE_SUBMIT_RETRY_CADENCE_MS: number;
  TERMINAL_PASTE_SUBMIT_MAX_RETRIES: number;
  dashboardTerminalAccessMode(
    preset: { mayWriteFiles?: boolean } | null,
    userRole: string,
  ): "workspace" | "reporting";
  /** Resolve a preset/custom prompt and launch it with explicit access overrides. */
  dashboardLaunchPreset(
    ctx: LaunchContext,
    prompt: string,
    runner?: string,
    label?: string,
    options?: LaunchOptions,
  ): Promise<void>;
  /**
   * Sends text through an existing terminal WebSocket, including bracketed-paste
   * and delayed-submit behaviour.
   */
  dashboardSendToTerminalSession(
    ctx: LaunchContext,
    sessionId: string,
    text: string,
    options?: { adapt?: boolean },
  ): boolean;
  /**
   * Drives the full create/load/connect path used by dashboard launch buttons.
   */
  dashboardLaunchInTerminal(
    ctx: LaunchContext,
    prompt: string,
    runner?: string,
    options?: LaunchOptions,
  ): Promise<void>;
  /**
   * Wires a browser WebSocket and xterm instance to an existing local session.
   */
  dashboardConnectTerminal(
    ctx: LaunchContext,
    sessionId: string,
    wsUrl: string,
  ): void;
  /**
   * Rehydrates a server-active terminal session into the browser session list.
   */
  dashboardOpenServerSession(
    ctx: LaunchContext,
    serverSession: Record<string, unknown>,
  ): Promise<void>;
  /** Reconnect every saved browser session that the backend still reports active. */
  dashboardReconnectTerminal(ctx: LaunchContext): Promise<boolean>;
  /** Save browser session metadata before detaching from the current project. */
  dashboardDetachTerminal(ctx: LaunchContext, projectPath?: string): void;
  /** Project one ended local session into the recent-session rail. */
  dashboardRememberRecentSession(
    ctx: LaunchContext,
    session: TestTerminalSession,
  ): void;
  /**
   * Ends a local session and records the recent-session fallback title.
   */
  dashboardEndSession(ctx: LaunchContext, sessionId: string): void;
  /**
   * Detects runner output that should display the Workspace awaiting-input badge.
   */
  dashboardOutputLooksAwaitingInput(text: string): boolean;
  /**
   * Detects the first safe point to paste a queued launch prompt into a runner.
   */
  dashboardOutputLooksReadyForLaunchPrompt(
    text: string,
    runner?: string,
  ): boolean;
  /**
   * Detects startup failures where a queued prompt would otherwise land in a shell.
   */
  dashboardOutputLooksRunnerStartupFailure(
    text: string,
    runner?: string,
  ): boolean;
  /**
   * Extracts the most useful runner-startup error detail for the loading banner.
   */
  dashboardExtractRunnerStartupError(text: string): string | null;
  /**
   * Formats startup failure output for a user-visible retry/error message.
   */
  dashboardRunnerStartupFailureMessage(text: string): string;
  /**
   * Updates awaiting-input state from a new PTY output chunk and prior tail.
   */
  dashboardNextAwaitingInputState(
    previousAwaiting: boolean,
    previousTail: string,
    outputChunk: string,
  ): boolean;
  /**
   * Queues a launch prompt until the runner composer is safe to receive input.
   */
  dashboardScheduleLaunchPrompt(
    ctx: LaunchContext,
    sessionId: string,
    prompt: string,
  ): void;
  /**
   * Feeds fresh PTY output into queued-launch readiness and fallback timers.
   */
  dashboardHandleLaunchPromptOutput(
    ctx: LaunchContext,
    sessionId: string,
  ): void;
  /**
   * Handles collapsed pasted-text echoes before sending the final Enter.
   */
  dashboardHandlePasteSubmitOutput(
    ctx: LaunchContext,
    sessionId: string,
    output: string,
  ): void;
  /**
   * Clears delayed paste state when a session ends or a submit completes.
   */
  dashboardClearPasteSubmitState(ctx: LaunchContext, sessionId: string): void;
  /**
   * Applies loading overlay state while preserving the fallback session object.
   */
  dashboardSetTerminalLoadingPhase(
    ctx: LaunchContext,
    sessionId: string,
    fallback: Record<string, unknown>,
    phase: "connecting" | "loading" | "ready" | "error",
    error?: string,
  ): void;
  /**
   * Arms the slow-start and retry affordance timers for a launching session.
   */
  dashboardArmTerminalLoadingTimers(
    ctx: LaunchContext,
    sessionId: string,
    fallback: Record<string, unknown>,
  ): void;
  /**
   * Marks a session ready on first useful output without leaking loading timers.
   */
  dashboardMarkTerminalLoadingReady(
    ctx: LaunchContext,
    sessionId: string,
    fallback: Record<string, unknown>,
    previousTail: string,
    output: string,
  ): void;
  /**
   * Retries a failed launch from the prompt and path metadata stored on the ref.
   */
  dashboardRetryTerminalSession(
    ctx: LaunchContext,
    sessionId: string,
  ): Promise<void>;
  /**
   * Debounces terminal count refreshes so bursty lifecycle events share one fetch.
   */
  dashboardUpdateSessionCount(ctx: LaunchContext): Promise<void>;
};

/**
 * Concatenate the dashboard terminal-helper source files into one string for tests that assert on the shipped
 * source text (rather than executing it) - e.g. confirming a code path or asset route exists in the real file.
 *
 * @returns the joined contents of every dashboard terminal source path, newline-separated
 */
function readDashboardTerminalSource(): string {
  return DASHBOARD_TERMINAL_SOURCE_PATHS.map((path) =>
    readFileSync(path, "utf-8"),
  ).join("\n");
}

/**
 * Concatenate the dashboard app source files into one string, the app-shell counterpart to
 * readDashboardTerminalSource, for tests that assert on workspace wiring in the shipped source.
 *
 * @returns the joined contents of every dashboard app source path, newline-separated
 */
function readDashboardAppSource(): string {
  return DASHBOARD_APP_SOURCE_PATHS.map((path) =>
    readFileSync(path, "utf-8"),
  ).join("\n");
}

/**
 * Read a captured awaiting-input fixture (real PTY byte capture) from the shared __fixtures__ directory, used to
 * drive the detector tests against runner output recorded from actual sessions.
 *
 * @param name - fixture file name within test/unit/__fixtures__/awaiting-input
 * @returns the fixture file's UTF-8 contents
 */
function loadFixture(name: string): string {
  return readFileSync(
    resolve(
      PROJECT_ROOT,
      "test",
      "unit",
      "__fixtures__",
      "awaiting-input",
      name,
    ),
    "utf-8",
  );
}

function loadHelpers(
  fetchImpl: typeof fetch,
  timers: TimerControls = {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  },
  extraGlobals: Record<string, unknown> = {},
): HelperContext {
  const source = readDashboardTerminalSource();
  const js = transpileModule(source, {
    compilerOptions: { target: ScriptTarget.ES2023 },
  }).outputText;
  const context = createContext({
    fetch: fetchImpl,
    dashboardFetch: fetchImpl,
    dashboardTerminalWsPath: (path: string) => path,
    console,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    WebSocket: { OPEN: 1 },
    readRecord: (value: unknown): unknown => value,
    readErrorMessage: (value: unknown): string | null =>
      typeof value === "object" &&
      value !== null &&
      "error" in value &&
      typeof (value as { error?: unknown }).error === "string"
        ? ((value as { error: string }).error ?? null)
        : null,
    readString: (value: unknown): string | null =>
      typeof value === "string" ? value : null,
    ...extraGlobals,
  });
  runInContext(
    `${js}
globalThis.__helpers = {
  TERMINAL_PASTE_MARKER_SETTLE_DELAY_MS,
  TERMINAL_CLAUDE_PASTE_NO_MARKER_FALLBACK_DELAY_MS,
  TERMINAL_PASTE_SUBMIT_RETRY_CADENCE_MS,
  TERMINAL_PASTE_SUBMIT_MAX_RETRIES,
  dashboardTerminalAccessMode,
  dashboardLaunchPreset,
  dashboardSendToTerminalSession,
  dashboardLaunchInTerminal,
  dashboardConnectTerminal,
  dashboardOpenServerSession,
  dashboardReconnectTerminal,
  dashboardDetachTerminal,
  dashboardRememberRecentSession,
  dashboardEndSession,
  dashboardOutputLooksAwaitingInput,
  dashboardOutputLooksReadyForLaunchPrompt,
  dashboardOutputLooksRunnerStartupFailure,
  dashboardExtractRunnerStartupError,
  dashboardRunnerStartupFailureMessage,
  dashboardNextAwaitingInputState,
  dashboardScheduleLaunchPrompt,
  dashboardHandleLaunchPromptOutput,
  dashboardHandlePasteSubmitOutput,
  dashboardClearPasteSubmitState,
  dashboardSetTerminalLoadingPhase,
  dashboardArmTerminalLoadingTimers,
  dashboardMarkTerminalLoadingReady,
  dashboardRetryTerminalSession,
  dashboardUpdateSessionCount,
};`,
    context,
  );
  return (context as typeof context & { __helpers: HelperContext }).__helpers;
}

function makeContext(
  overrides: Partial<LaunchContext> = {},
): LaunchContext & { toasts: Array<{ msg: string; isError: boolean }> } {
  const toasts: Array<{ msg: string; isError: boolean }> = [];
  const ctx = {
    projectPath: "/tmp/example",
    activeView: "home",
    workspacePanel: "prompts",
    terminalAvailable: true,
    terminalSessionCount: 0,
    serverMaxSessions: 10,
    serverSessions: [],
    sessionTitles: {},
    recentTerminalSessions: [],
    sessions: [],
    promptRunStates: {},
    launching: false,
    activeSessionId: null,
    _terminalRefs: {},
    _projectSessions: {},
    _projectActiveSession: {},
    showMaxSessionsModal: false,
    // Default contexts assert raw payloads, so prompt adaptation is opt-in per test.
    adaptPrompt(prompt: string): string {
      return prompt;
    },
    // Match dashboard fallback labels without pulling in the full project reader.
    displayNameFor(path: string): string {
      return path.split("/").filter(Boolean).pop() || path;
    },
    // Most tests do not care about saved-session cleanup; override when they do.
    _forgetSavedSession(): void {
      return;
    },
    // Launch tests override this to delay or fail asset loading.
    async loadXterm(): Promise<void> {
      return;
    },
    // Browser socket wiring is exercised by makeBrowserTerminalGlobals instead.
    connectTerminal(): void {
      return;
    },
    // Count refresh is asserted only in tests that install a fetch-backed override.
    async updateSessionCount(): Promise<void> {
      return;
    },
    // Retry tests replace this hook to capture the relaunch payload.
    async launchInTerminal(): Promise<void> {
      return;
    },
    // Titles are cached outside session records because recent-session tests trim records.
    rememberSessionTitle(
      sessionId: string,
      title: string | null | undefined,
    ): void {
      if (title) this.sessionTitles[sessionId] = title;
    },
    // The recent rail preserves ended sessions after dashboardEndSession removes them.
    rememberRecentSession(session: Record<string, unknown>): void {
      this.recentTerminalSessions.push(session);
    },
    // Title fallback order mirrors the UI path: cached title, prompt label, runner default.
    sessionTitleFor(session: Record<string, unknown> | null): string {
      if (!session) return "Runner session";
      return (
        this.sessionTitles[String(session.id)] ||
        (typeof session.promptLabel === "string" ? session.promptLabel : "") ||
        "claude session"
      );
    },
    // Alpine schedules terminal attachment after DOM rendering; default tests are synchronous.
    async $nextTick(): Promise<void> {
      return;
    },
    // Toasts are test-observable side effects, not real dashboard notifications.
    showToast(msg: string, isError = false): void {
      toasts.push({ msg, isError });
    },
    ...overrides,
    toasts,
  };
  return ctx;
}

/**
 * Build a browser-side terminal session with the full state shape dashboard
 * helpers expect, while letting tests override only the behavior under review.
 */
function makeTerminalSession(
  overrides: Partial<TestTerminalSession> = {},
): TestTerminalSession {
  const id = overrides.id ?? "session-upload";
  return {
    id,
    runner: "claude",
    promptLabel: "Upload target",
    projectPath: "/tmp/example",
    cwd: "/tmp/example",
    targetPath: "/tmp/example",
    startTime: Date.now(),
    lastInputTime: 0,
    connected: true,
    ended: false,
    awaitingInput: false,
    outputTail: "",
    loadingPhase: "ready",
    loadingShowSlowHint: false,
    loadingShowRetry: false,
    age: "0s",
    presetId: null,
    accessMode: "workspace",
    captureQualityDrafts: false,
    qualityDraftProjectPath: null,
    ...overrides,
  };
}

/**
 * Create the common one-session WebSocket harness used by terminal-send tests.
 *
 * @param options - session/ref overrides for the specific behavior under test
 * @returns context, captured wire payloads, session object, and mutable websocket
 */
function makeTerminalSendHarness(
  options: TerminalSendHarnessOptions = {},
): TerminalSendHarness {
  const sent = options.sent ?? [];
  const sessionOverrides: Partial<TestTerminalSession> = {
    ...options.session,
  };
  if (options.id !== undefined) sessionOverrides.id = options.id;
  if (options.runner !== undefined) sessionOverrides.runner = options.runner;
  const session = makeTerminalSession(sessionOverrides);
  const websocket = makeCapturingWebSocket(sent);
  const ctx = makeContext({
    activeSessionId: session.id,
    sessions: [session],
    _terminalRefs: {
      [session.id]: {
        ws: websocket,
        ...options.ref,
      },
    },
  });
  return { ctx, sent, session, websocket };
}

/**
 * Keeps queued-launch tests on the same local session shape so they differ
 * only by runner output and timer behaviour.
 */
function makeLaunchPromptContext(): ReturnType<typeof makeContext> & {
  sent: string[];
} {
  const sent: string[] = [];
  const ctx = makeContext({
    activeSessionId: "launch-session",
    sessions: [
      {
        id: "launch-session",
        runner: "claude",
        promptLabel: "Launch prompt",
        projectPath: "/tmp/example",
        cwd: "/tmp/example",
        targetPath: "/tmp/example",
        startTime: Date.now(),
        lastInputTime: 0,
        connected: true,
        ended: false,
        awaitingInput: false,
        outputTail: "",
        age: "0s",
        presetId: null,
      },
    ],
    _terminalRefs: {
      "launch-session": {
        ws: makeCapturingWebSocket(sent),
      },
    },
  });
  return Object.assign(ctx, { sent });
}

/**
 * Uses real timers for behaviours that intentionally exercise production delays.
 */
async function delay(durationMs: number): Promise<void> {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, durationMs));
}

/**
 * Provides one fake clock for VM-loaded helpers because timeout and interval
 * cleanup must be verified together; otherwise this focused file can pass
 * assertions and still hang until an outer timeout kills it.
 *
 * Invariant: callbacks scheduled for earlier timestamps run before later
 * callbacks, and an interval cleared during its own callback must not reschedule.
 */

export {
  assert,
  assertExists,
  delay,
  describe,
  it,
  loadHelpers,
  loadFixture,
  makeContext,
  makeLaunchPromptContext,
  makeTerminalSendHarness,
  makeTerminalSession,
  makeCapturingWebSocket,
  PROJECT_ROOT,
  DASHBOARD_TERMINAL_PATH,
  DASHBOARD_APP_PATH,
  WORKSPACE_VIEW_PATH,
  SETUP_VIEW_PATH,
  readFileSync,
  readDashboardAppSource,
  readDashboardTerminalSource,
  resolve,
};
export type {
  HelperContext,
  LaunchContext,
  LaunchOptions,
  TestTerminalSession,
};
export {
  createFakeTimers,
  FakeDashboardWebSocket,
  FakeFitAddon,
  FakeResizeObserver,
  FakeTerminal,
  makeBrowserTerminalGlobals,
} from "./fakes.js";
