/**
 * Unit tests for dashboard terminal launch responsiveness helpers.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { ScriptTarget, transpileModule } from "typescript";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const DASHBOARD_TERMINAL_PATH = resolve(
  PROJECT_ROOT,
  "src",
  "dashboard",
  "dashboard-terminal.ts",
);
const DASHBOARD_APP_PATH = resolve(PROJECT_ROOT, "src", "dashboard", "app.ts");
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
};

type LaunchContext = {
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
  launching: boolean;
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
      loadingSlowTimer?: ReturnType<typeof setTimeout>;
      loadingRetryTimer?: ReturnType<typeof setTimeout>;
      launchPromptFallbackTimer?: ReturnType<typeof setTimeout>;
      launchPromptQuietTimer?: ReturnType<typeof setTimeout>;
      launchPromptOutputSeen?: boolean;
    }
  >;
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

type HelperContext = {
  TERMINAL_PASTE_MARKER_SETTLE_DELAY_MS: number;
  TERMINAL_CLAUDE_PASTE_NO_MARKER_FALLBACK_DELAY_MS: number;
  TERMINAL_PASTE_SUBMIT_RETRY_CADENCE_MS: number;
  TERMINAL_PASTE_SUBMIT_MAX_RETRIES: number;
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

type TimerControls = {
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
};

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
  const source = readFileSync(DASHBOARD_TERMINAL_PATH, "utf-8");
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
  dashboardSendToTerminalSession,
  dashboardLaunchInTerminal,
  dashboardConnectTerminal,
  dashboardOpenServerSession,
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
function createFakeTimers(): TimerControls & {
  /**
   * Advances all due timeout and interval callbacks in timestamp order.
   */
  tick(durationMs: number): void;
  /**
   * Reports outstanding timers so tests can catch leaked fallback work.
   */
  pending(): number;
} {
  let now = 0;
  let nextId = 1;
  const timers = new Map<
    number,
    { at: number; callback: () => void; intervalMs?: number }
  >();
  const cancelled = new Set<number>();
  const fakeSetTimeout = ((
    callback: (...args: unknown[]) => void,
    ms?: number,
    ...args: unknown[]
  ) => {
    const id = nextId;
    nextId += 1;
    timers.set(id, {
      at: now + (ms ?? 0),
      callback: () => callback(...args),
    });
    return id as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  // Fired intervals can be cleared by their own callback; cancelled keeps that
  // clear from being lost after the callback returns.
  const fakeClearTimeout = ((handle?: ReturnType<typeof setTimeout>) => {
    const id = Number(handle);
    if (!timers.delete(id)) cancelled.add(id);
  }) as typeof clearTimeout;
  const fakeSetInterval = ((
    callback: (...args: unknown[]) => void,
    ms?: number,
    ...args: unknown[]
  ) => {
    const id = nextId;
    nextId += 1;
    timers.set(id, {
      at: now + (ms ?? 0),
      callback: () => callback(...args),
      intervalMs: ms ?? 0,
    });
    return id as unknown as ReturnType<typeof setInterval>;
  }) as typeof setInterval;
  // Shares cancellation bookkeeping with timeouts because browser helpers use
  // both APIs through the same VM-injected fake clock.
  const fakeClearInterval = ((handle?: ReturnType<typeof setInterval>) => {
    const id = Number(handle);
    if (!timers.delete(id)) cancelled.add(id);
  }) as typeof clearInterval;
  return {
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
    setInterval: fakeSetInterval,
    clearInterval: fakeClearInterval,
    /**
     * Invariant: one tick drains every callback due at or before the target
     * before moving the fake clock to the target timestamp.
     */
    tick(durationMs: number): void {
      const target = now + durationMs;
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, timer] = due;
        timers.delete(id);
        now = timer.at;
        timer.callback();
        if (timer.intervalMs !== undefined && !cancelled.has(id)) {
          timers.set(id, { ...timer, at: now + timer.intervalMs });
        }
        cancelled.delete(id);
      }
      now = target;
    },
    // A non-zero pending count after a scenario catches leaked fallback work.
    pending(): number {
      return timers.size;
    },
  };
}

class FakeTerminal {
  cols = 80;
  rows = 24;
  _addonFit?: FakeFitAddon;
  dataHandler?: (data: string) => void;
  written: string[] = [];

  /**
   * Stores the fit addon so terminal setup can run without loading xterm.
   */
  loadAddon(addon: FakeFitAddon): void {
    this._addonFit = addon;
  }

  /**
   * DOM mounting is outside these tests; the method only satisfies xterm's API.
   */
  open(): void {}

  /**
   * Mutates `written` by appending output that helpers would write into xterm.
   */
  write(data: string): void {
    this.written.push(data);
  }

  /**
   * Focus changes are not observable in this harness.
   */
  focus(): void {}

  /**
   * Disposal side effects are asserted through session refs, not xterm internals.
   */
  dispose(): void {}

  /**
   * Keyboard shortcut wiring is not under test in this launch-focused suite.
   */
  attachCustomKeyEventHandler(): void {}

  /**
   * Tests drive input through dashboardSendToTerminalSession instead of xterm events.
   */
  onData(handler: (data: string) => void): void {
    this.dataHandler = handler;
  }

  /**
   * Simulates xterm input events emitted toward the PTY.
   */
  emitData(data: string): void {
    this.dataHandler?.(data);
  }

  /**
   * Resize paths are triggered through the fake ResizeObserver when needed.
   */
  onResize(): void {}

  /**
   * Keeps paste tests on the no-selection branch unless a test overrides xterm.
   */
  hasSelection(): boolean {
    return false;
  }

  /**
   * Mirrors xterm's empty-selection return value for clipboard tests.
   */
  getSelection(): string {
    return "";
  }

  buffer = {
    active: {
      length: 0,
      /**
       * Forces helpers to rely on session outputTail, the state these tests set.
       */
      getLine(): null {
        return null;
      },
    },
  };
}

class FakeFitAddon {
  /**
   * Layout measurements are not meaningful in the VM harness.
   */
  fit(): void {}
}

class FakeResizeObserver {
  /**
   * Observed elements are static fake DOM nodes, so no callback is needed.
   */
  observe(): void {}

  /**
   * Disconnect is present so terminal cleanup can call the browser API shape.
   */
  disconnect(): void {}
}

class FakeDashboardWebSocket {
  static OPEN = 1;
  readyState = 1;
  sent: string[] = [];
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  onerror?: () => void;

  /**
   * Registers constructed sockets so tests can drive open/message/close events.
   */
  constructor(
    public readonly url: string,
    public readonly instances: FakeDashboardWebSocket[],
  ) {
    instances.push(this);
  }

  /**
   * Records browser-to-server terminal payloads for assertions.
   */
  send(payload: string): void {
    this.sent.push(payload);
  }

  /**
   * Simulates browser close semantics and notifies the dashboard helper.
   */
  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }
}

/**
 * Creates the mutable WebSocket double used by tests that only assert terminal
 * wire payloads; `readyState` stays writable for retry and reconnect scenarios.
 */
function makeCapturingWebSocket(sent: string[]): {
  readyState: number;
  /**
   * Mutates the provided array with raw browser wire payloads.
   */
  send(payload: string): void;
} {
  return {
    readyState: 1,
    // Side effect: appends raw browser wire payloads for order-sensitive checks.
    send(payload: string): void {
      sent.push(payload);
    },
  };
}

/**
 * Creates the minimum browser global surface needed by dashboard-terminal.ts
 * because these tests load the classic dashboard script in a VM, not a browser.
 */
function makeBrowserTerminalGlobals(): {
  globals: Record<string, unknown>;
  sockets: FakeDashboardWebSocket[];
  terminals: FakeTerminal[];
} {
  const sockets: FakeDashboardWebSocket[] = [];
  const terminals: FakeTerminal[] = [];
  const WebSocketCtor = class extends FakeDashboardWebSocket {
    /**
     * Binds the browser-facing constructor to this test's socket registry.
     */
    constructor(url: string) {
      super(url, sockets);
    }
  };
  const TerminalCtor = class extends FakeTerminal {
    constructor() {
      super();
      terminals.push(this);
    }
  };
  return {
    sockets,
    terminals,
    globals: {
      window: {
        Terminal: TerminalCtor,
        FitAddon: { FitAddon: FakeFitAddon },
        // Dashboard helpers register listeners, but these tests invoke events directly.
        addEventListener(): void {
          return;
        },
        // Cleanup calls this even though the fake window has no listener registry.
        removeEventListener(): void {
          return;
        },
      },
      document: {
        // Stable dimensions let terminal setup run without a real layout engine.
        getElementById(): { innerHTML: string; offsetWidth: number } {
          return { innerHTML: "", offsetWidth: 80 };
        },
      },
      location: { protocol: "http:", host: "127.0.0.1:31337" },
      navigator: {
        clipboard: {
          readText: async (): Promise<string> => "",
          writeText: async (): Promise<void> => {},
        },
      },
      ResizeObserver: FakeResizeObserver,
      WebSocket: WebSocketCtor,
    },
  };
}

describe("dashboard terminal launch flow", () => {
  it("keeps controlling cwd and selected target separate in terminal create payloads", async () => {
    const createBodies: unknown[] = [];
    const helpers = loadHelpers(async (input, init) => {
      if (String(input) === "/api/terminal/create") {
        createBodies.push(JSON.parse(String(init?.body ?? "{}")));
        return {
          json: async () => ({
            id: "session-boundary",
            wsUrl: "/ws/terminal/session-boundary",
          }),
        } as Response;
      }
      return { json: async () => ({ ok: true }) } as Response;
    });
    const ctx = makeContext({
      projectPath: "/tmp/selected-target",
    });

    await helpers.dashboardLaunchInTerminal(ctx, "inspect target", "claude", {
      cwdPath: "/tmp/controlling-goat-flow",
      targetPath: "/tmp/selected-target",
      promptLabel: "Boundary check",
    });

    assert.deepStrictEqual(createBodies, [
      {
        prompt: "",
        projectPath: "/tmp/controlling-goat-flow",
        targetPath: "/tmp/selected-target",
        runner: "claude",
      },
    ]);
    assert.equal(ctx.sessions[0]?.cwd, "/tmp/controlling-goat-flow");
    assert.equal(ctx.sessions[0]?.targetPath, "/tmp/selected-target");
    assert.equal(ctx.sessions[0]?.projectPath, "/tmp/selected-target");
  });

  it("sends terminal text to the requested session instead of the current active tab", async () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const sent: Record<string, string[]> = {
      upload: [],
      active: [],
    };
    const ctx = makeContext({
      activeSessionId: "session-active",
      sessions: [
        {
          id: "session-upload",
          runner: "claude",
          promptLabel: "Upload target",
          projectPath: "/tmp/example",
          cwd: "/tmp/example",
          targetPath: "/tmp/example",
          startTime: Date.now(),
          lastInputTime: 0,
          connected: true,
          ended: false,
          awaitingInput: true,
          age: "0s",
          presetId: null,
        },
        {
          id: "session-active",
          runner: "codex",
          promptLabel: "Active target",
          projectPath: "/tmp/example",
          cwd: "/tmp/example",
          targetPath: "/tmp/example",
          startTime: Date.now(),
          lastInputTime: 0,
          connected: true,
          ended: false,
          awaitingInput: false,
          age: "0s",
          presetId: null,
        },
      ],
      _terminalRefs: {
        "session-upload": {
          ws: makeCapturingWebSocket(sent.upload),
        },
        "session-active": {
          ws: makeCapturingWebSocket(sent.active),
        },
      },
    });

    assert.equal(
      helpers.dashboardSendToTerminalSession(
        ctx,
        "session-upload",
        "Attached files",
        { adapt: false },
      ),
      true,
    );

    assert.equal(sent.active.length, 0);
    assert.deepStrictEqual(JSON.parse(sent.upload[0] ?? "{}"), {
      type: "input",
      data: "\x1b[200~Attached files\x1b[201~",
    });
    helpers.dashboardHandlePasteSubmitOutput(
      ctx,
      "session-upload",
      "[Pasted text #1 +1 lines]",
    );
    assert.deepStrictEqual(JSON.parse(sent.upload[1] ?? "{}"), {
      type: "input",
      data: "\r",
    });
    assert.equal(sent.active.length, 0);
    assert.equal(ctx.sessions[0]?.awaitingInput, false);
  });

  it("submits single-line or non-Claude sends immediately", async () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const sent: string[] = [];
    const ctx = makeContext({
      activeSessionId: "session-upload",
      sessions: [
        {
          id: "session-upload",
          runner: "codex",
          promptLabel: "Upload target",
          projectPath: "/tmp/example",
          cwd: "/tmp/example",
          targetPath: "/tmp/example",
          startTime: Date.now(),
          lastInputTime: 0,
          connected: true,
          ended: false,
          awaitingInput: false,
          age: "0s",
          presetId: null,
        },
      ],
      _terminalRefs: {
        "session-upload": {
          ws: makeCapturingWebSocket(sent),
        },
      },
    });

    assert.equal(
      helpers.dashboardSendToTerminalSession(
        ctx,
        "session-upload",
        "Attached files",
        { adapt: false },
      ),
      true,
    );

    assert.deepStrictEqual(JSON.parse(sent[0] ?? "{}"), {
      type: "input",
      data: "\x1b[200~Attached files\x1b[201~",
    });
    assert.deepStrictEqual(JSON.parse(sent[1] ?? "{}"), {
      type: "input",
      data: "\r",
    });
    assert.equal(
      ctx._terminalRefs["session-upload"]?.pasteSubmitTimer,
      undefined,
    );
  });

  it("submits single-line Claude pastes immediately without waiting for the paste-text marker", async () => {
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
    );
    const sent: string[] = [];
    const ctx = makeContext({
      activeSessionId: "session-upload",
      sessions: [
        {
          id: "session-upload",
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
          age: "0s",
          presetId: null,
        },
      ],
      _terminalRefs: {
        "session-upload": {
          ws: makeCapturingWebSocket(sent),
        },
      },
    });

    assert.equal(
      helpers.dashboardSendToTerminalSession(
        ctx,
        "session-upload",
        "goat-flow setup . --agent claude",
        { adapt: false },
      ),
      true,
    );

    assert.deepStrictEqual(JSON.parse(sent[0] ?? "{}"), {
      type: "input",
      data: "\x1b[200~goat-flow setup . --agent claude\x1b[201~",
    });
    assert.deepStrictEqual(JSON.parse(sent[1] ?? "{}"), {
      type: "input",
      data: "\r",
    });
    assert.equal(
      ctx._terminalRefs["session-upload"]?.pasteSubmitTimer,
      undefined,
    );
    assert.ok(!ctx._terminalRefs["session-upload"]?.pasteSubmitAwaitingCommit);
    assert.equal(timers.pending(), 0);
  });

  it("normalizes paste bodies before wrapping them in bracketed paste markers", async () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const sent: string[] = [];
    const ctx = makeContext({
      activeSessionId: "session-upload",
      sessions: [
        {
          id: "session-upload",
          runner: "codex",
          promptLabel: "Upload target",
          projectPath: "/tmp/example",
          cwd: "/tmp/example",
          targetPath: "/tmp/example",
          startTime: Date.now(),
          lastInputTime: 0,
          connected: true,
          ended: false,
          awaitingInput: false,
          age: "0s",
          presetId: null,
        },
      ],
      _terminalRefs: {
        "session-upload": {
          ws: makeCapturingWebSocket(sent),
        },
      },
    });

    assert.equal(
      helpers.dashboardSendToTerminalSession(
        ctx,
        "session-upload",
        "first\r\nsecond\x1b[201~third\x1b[200~\rfourth",
        { adapt: false },
      ),
      true,
    );

    assert.deepStrictEqual(JSON.parse(sent[0] ?? "{}"), {
      type: "input",
      data: "\x1b[200~first\nsecondthird\nfourth\x1b[201~",
    });
    assert.deepStrictEqual(JSON.parse(sent[1] ?? "{}"), {
      type: "input",
      data: "\r",
    });
  });

  it("falls back quickly for Claude pasted terminal text when no paste echo arrives", async () => {
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
    );
    const sent: string[] = [];
    const ctx = makeContext({
      activeSessionId: "session-upload",
      sessions: [
        {
          id: "session-upload",
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
          age: "0s",
          presetId: null,
        },
      ],
      _terminalRefs: {
        "session-upload": {
          ws: makeCapturingWebSocket(sent),
        },
      },
    });

    assert.equal(
      helpers.dashboardSendToTerminalSession(
        ctx,
        "session-upload",
        "Attached files\nsecond line",
        { adapt: false },
      ),
      true,
    );

    assert.equal(sent.length, 1);
    ctx.sessions[0]!.outputTail = "";
    timers.tick(helpers.TERMINAL_CLAUDE_PASTE_NO_MARKER_FALLBACK_DELAY_MS);
    assert.deepStrictEqual(JSON.parse(sent[1] ?? "{}"), {
      type: "input",
      data: "\r",
    });
    assert.equal(timers.pending(), 1);
    timers.tick(helpers.TERMINAL_PASTE_SUBMIT_RETRY_CADENCE_MS);
    assert.equal(timers.pending(), 0);
  });

  it("keeps Claude no-marker fallback armed across xterm protocol replies", () => {
    const { globals, sockets, terminals } = makeBrowserTerminalGlobals();
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
      globals,
    );
    const ctx = makeContext({
      activeSessionId: "session-protocol",
      sessions: [
        {
          id: "session-protocol",
          runner: "claude",
          promptLabel: "Protocol reply test",
          projectPath: "/tmp/example",
          cwd: "/tmp/example",
          targetPath: "/tmp/example",
          startTime: Date.now(),
          lastInputTime: 0,
          connected: false,
          ended: false,
          awaitingInput: false,
          outputTail: "",
          loadingPhase: "ready",
          loadingShowSlowHint: false,
          loadingShowRetry: false,
          age: "",
          presetId: null,
        },
      ],
      _terminalRefs: { "session-protocol": {} },
    });

    helpers.dashboardConnectTerminal(
      ctx,
      "session-protocol",
      "/ws/terminal/session-protocol",
    );
    const socket = sockets[0];
    const term = terminals[0];
    assert.ok(socket);
    assert.ok(term);
    socket.onopen?.();

    assert.equal(
      helpers.dashboardSendToTerminalSession(
        ctx,
        "session-protocol",
        "Setup prompt\nsecond line",
        { adapt: false },
      ),
      true,
    );
    term.emitData("\x1b[?1;2c");

    const beforeFallbackInputs = socket.sent
      .map((payload) => JSON.parse(payload) as { type: string; data?: string })
      .filter((payload) => payload.type === "input")
      .map((payload) => payload.data);
    assert.deepStrictEqual(beforeFallbackInputs, [
      "\x1b[200~Setup prompt\nsecond line\x1b[201~",
      "\x1b[?1;2c",
    ]);
    assert.notEqual(
      ctx._terminalRefs["session-protocol"]?.pasteSubmitTimer,
      undefined,
      "xterm protocol replies must not clear the pending Claude fallback",
    );

    timers.tick(helpers.TERMINAL_CLAUDE_PASTE_NO_MARKER_FALLBACK_DELAY_MS);

    const afterFallbackInputs = socket.sent
      .map((payload) => JSON.parse(payload) as { type: string; data?: string })
      .filter((payload) => payload.type === "input")
      .map((payload) => payload.data);
    assert.deepStrictEqual(afterFallbackInputs.slice(-1), ["\r"]);
  });

  it("retries Claude fallback submit when the visible composer stays parked", async () => {
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
    );
    const sent: string[] = [];
    const ctx = makeContext({
      activeSessionId: "session-upload",
      sessions: [
        {
          id: "session-upload",
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
          age: "0s",
          presetId: null,
          outputTail:
            "[Pasted text #1 +2 lines]\n────────────────\npaste again to expand ❯",
        },
      ],
      _terminalRefs: {
        "session-upload": {
          ws: makeCapturingWebSocket(sent),
        },
      },
    });

    assert.equal(
      helpers.dashboardSendToTerminalSession(
        ctx,
        "session-upload",
        "Setup prompt\nsecond line",
        { adapt: false },
      ),
      true,
    );

    assert.equal(sent.length, 1);
    timers.tick(helpers.TERMINAL_CLAUDE_PASTE_NO_MARKER_FALLBACK_DELAY_MS);
    assert.deepStrictEqual(JSON.parse(sent[1] ?? "{}"), {
      type: "input",
      data: "\r",
    });

    timers.tick(helpers.TERMINAL_PASTE_SUBMIT_RETRY_CADENCE_MS);
    assert.deepStrictEqual(JSON.parse(sent[2] ?? "{}"), {
      type: "input",
      data: "\r",
    });

    ctx.sessions[0]!.outputTail = "Running quality assessment";
    timers.tick(helpers.TERMINAL_PASTE_SUBMIT_RETRY_CADENCE_MS);
    assert.equal(timers.pending(), 0);
  });

  it("ignores a late Claude paste echo after the no-marker fallback submitted", async () => {
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
    );
    const sent: string[] = [];
    const ctx = makeContext({
      activeSessionId: "session-upload",
      sessions: [
        {
          id: "session-upload",
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
          age: "0s",
          presetId: null,
        },
      ],
      _terminalRefs: {
        "session-upload": {
          ws: makeCapturingWebSocket(sent),
        },
      },
    });

    assert.equal(
      helpers.dashboardSendToTerminalSession(
        ctx,
        "session-upload",
        "Setup prompt\nsecond line",
        { adapt: false },
      ),
      true,
    );

    assert.equal(sent.length, 1);
    ctx.sessions[0]!.outputTail = "";
    timers.tick(helpers.TERMINAL_CLAUDE_PASTE_NO_MARKER_FALLBACK_DELAY_MS);
    assert.deepStrictEqual(JSON.parse(sent[1] ?? "{}"), {
      type: "input",
      data: "\r",
    });
    assert.equal(
      ctx._terminalRefs["session-upload"]?.pasteSubmitAwaitingCommit,
      false,
    );

    helpers.dashboardHandlePasteSubmitOutput(
      ctx,
      "session-upload",
      "[Pasted text #1 +2 lines]",
    );
    assert.equal(sent.length, 2);
    timers.tick(helpers.TERMINAL_PASTE_MARKER_SETTLE_DELAY_MS);
    timers.tick(helpers.TERMINAL_PASTE_SUBMIT_RETRY_CADENCE_MS);

    assert.equal(sent.length, 2);
    assert.equal(timers.pending(), 0);
  });

  it("retries Claude submit when output is still on the pasted-text placeholder", async () => {
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
    );
    const sent: string[] = [];
    const ctx = makeContext({
      activeSessionId: "session-upload",
      sessions: [
        {
          id: "session-upload",
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
          age: "0s",
          presetId: null,
          outputTail:
            "[Pasted text #1 +2 lines]\n────────────────\npasteagaintoexpand ◉ xhigh · /effort",
        },
      ],
      _terminalRefs: {
        "session-upload": {
          ws: makeCapturingWebSocket(sent),
        },
      },
    });

    assert.equal(
      helpers.dashboardSendToTerminalSession(
        ctx,
        "session-upload",
        "Setup prompt\nsecond line",
        { adapt: false },
      ),
      true,
    );

    helpers.dashboardHandlePasteSubmitOutput(
      ctx,
      "session-upload",
      "[Pasted text #1 +2 lines]",
    );
    assert.equal(sent.length, 1);
    timers.tick(helpers.TERMINAL_PASTE_MARKER_SETTLE_DELAY_MS);
    assert.deepStrictEqual(JSON.parse(sent[1] ?? "{}"), {
      type: "input",
      data: "\r",
    });
    assert.equal(timers.pending(), 1);

    timers.tick(helpers.TERMINAL_PASTE_SUBMIT_RETRY_CADENCE_MS);
    assert.deepStrictEqual(JSON.parse(sent[2] ?? "{}"), {
      type: "input",
      data: "\r",
    });
    assert.equal(timers.pending(), 1);

    ctx.sessions[0]!.outputTail = "Running quality assessment";
    timers.tick(helpers.TERMINAL_PASTE_SUBMIT_RETRY_CADENCE_MS);
    assert.equal(timers.pending(), 0);
  });

  it("retries up to the cap while Claude composer stays parked at pasted-text", async () => {
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
    );
    const sent: string[] = [];
    const ctx = makeContext({
      activeSessionId: "session-upload",
      sessions: [
        {
          id: "session-upload",
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
          age: "0s",
          presetId: null,
          outputTail:
            "[Pasted text #1 +2 lines]\n────────────────\npaste again to expand ❯",
        },
      ],
      _terminalRefs: {
        "session-upload": {
          ws: makeCapturingWebSocket(sent),
        },
      },
    });

    assert.equal(
      helpers.dashboardSendToTerminalSession(
        ctx,
        "session-upload",
        "Setup prompt\nsecond line",
        { adapt: false },
      ),
      true,
    );

    helpers.dashboardHandlePasteSubmitOutput(
      ctx,
      "session-upload",
      "[Pasted text #1 +2 lines]",
    );
    timers.tick(helpers.TERMINAL_PASTE_MARKER_SETTLE_DELAY_MS);

    for (
      let index = 0;
      index < helpers.TERMINAL_PASTE_SUBMIT_MAX_RETRIES;
      index += 1
    ) {
      timers.tick(helpers.TERMINAL_PASTE_SUBMIT_RETRY_CADENCE_MS);
    }

    assert.equal(
      sent.length,
      1 + 1 + helpers.TERMINAL_PASTE_SUBMIT_MAX_RETRIES,
    );
    assert.equal(timers.pending(), 0);
  });

  it("stops the Claude pasted-text retry loop once output advances", async () => {
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
    );
    const sent: string[] = [];
    const ctx = makeContext({
      activeSessionId: "session-upload",
      sessions: [
        {
          id: "session-upload",
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
          age: "0s",
          presetId: null,
          outputTail:
            "[Pasted text #1 +2 lines]\n────────────────\npaste again to expand ❯",
        },
      ],
      _terminalRefs: {
        "session-upload": {
          ws: makeCapturingWebSocket(sent),
        },
      },
    });

    assert.equal(
      helpers.dashboardSendToTerminalSession(
        ctx,
        "session-upload",
        "Setup prompt\nsecond line",
        { adapt: false },
      ),
      true,
    );

    helpers.dashboardHandlePasteSubmitOutput(
      ctx,
      "session-upload",
      "[Pasted text #1 +2 lines]",
    );
    timers.tick(helpers.TERMINAL_PASTE_MARKER_SETTLE_DELAY_MS);
    ctx.sessions[0]!.outputTail = "Running quality assessment";
    timers.tick(helpers.TERMINAL_PASTE_SUBMIT_RETRY_CADENCE_MS);

    assert.equal(sent.length, 2);
    assert.equal(timers.pending(), 0);
  });

  it("ignores Claude paste markers when no submit is pending", async () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const sent: string[] = [];
    const ctx = makeContext({
      activeSessionId: "session-upload",
      sessions: [
        {
          id: "session-upload",
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
          age: "0s",
          presetId: null,
        },
      ],
      _terminalRefs: {
        "session-upload": {
          ws: makeCapturingWebSocket(sent),
        },
      },
    });

    helpers.dashboardHandlePasteSubmitOutput(
      ctx,
      "session-upload",
      "[Pasted text #1 +2 lines]",
    );

    assert.equal(sent.length, 0);
  });

  it("waits for Claude pasted-text marker to settle before submitting multiline paste", async () => {
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
    );
    const sent: string[] = [];
    const ctx = makeContext({
      activeSessionId: "session-upload",
      sessions: [
        {
          id: "session-upload",
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
          age: "0s",
          presetId: null,
        },
      ],
      _terminalRefs: {
        "session-upload": {
          ws: makeCapturingWebSocket(sent),
        },
      },
    });

    assert.equal(
      helpers.dashboardSendToTerminalSession(
        ctx,
        "session-upload",
        "Setup prompt\nsecond line",
        { adapt: false },
      ),
      true,
    );

    assert.deepStrictEqual(JSON.parse(sent[0] ?? "{}"), {
      type: "input",
      data: "\x1b[200~Setup prompt\nsecond line\x1b[201~",
    });
    assert.equal(sent.length, 1);

    helpers.dashboardHandlePasteSubmitOutput(
      ctx,
      "session-upload",
      "[Pasted text #1 +2 lines]",
    );

    assert.equal(sent.length, 1);
    timers.tick(helpers.TERMINAL_PASTE_MARKER_SETTLE_DELAY_MS);

    assert.deepStrictEqual(JSON.parse(sent[1] ?? "{}"), {
      type: "input",
      data: "\r",
    });
    assert.equal(timers.pending(), 0);
  });

  it("submits Antigravity multiline pasted terminal text after the pasted-text marker", async () => {
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
    );
    const sent: string[] = [];
    const ctx = makeContext({
      activeSessionId: "session-upload",
      sessions: [
        {
          id: "session-upload",
          runner: "antigravity",
          promptLabel: "Upload target",
          projectPath: "/tmp/example",
          cwd: "/tmp/example",
          targetPath: "/tmp/example",
          startTime: Date.now(),
          lastInputTime: 0,
          connected: true,
          ended: false,
          awaitingInput: false,
          age: "0s",
          presetId: null,
        },
      ],
      _terminalRefs: {
        "session-upload": {
          ws: makeCapturingWebSocket(sent),
        },
      },
    });

    assert.equal(
      helpers.dashboardSendToTerminalSession(
        ctx,
        "session-upload",
        "Setup prompt\nsecond line",
        { adapt: false },
      ),
      true,
    );

    assert.deepStrictEqual(JSON.parse(sent[0] ?? "{}"), {
      type: "input",
      data: "\x1b[200~Setup prompt\nsecond line\x1b[201~",
    });
    assert.equal(sent.length, 1);

    helpers.dashboardHandlePasteSubmitOutput(
      ctx,
      "session-upload",
      "[Pasted Text: 2 lines]",
    );

    assert.equal(sent.length, 1);
    timers.tick(helpers.TERMINAL_PASTE_MARKER_SETTLE_DELAY_MS);

    assert.deepStrictEqual(JSON.parse(sent[1] ?? "{}"), {
      type: "input",
      data: "\r",
    });
    assert.equal(timers.pending(), 0);
  });

  it("retries delayed paste submit when the websocket is briefly unavailable", async () => {
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
    );
    const sent: string[] = [];
    const websocket = makeCapturingWebSocket(sent);
    const ctx = makeContext({
      activeSessionId: "session-upload",
      sessions: [
        {
          id: "session-upload",
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
          age: "0s",
          presetId: null,
        },
      ],
      _terminalRefs: {
        "session-upload": {
          ws: websocket,
        },
      },
    });

    assert.equal(
      helpers.dashboardSendToTerminalSession(
        ctx,
        "session-upload",
        "Attached files\nsecond line",
        { adapt: false },
      ),
      true,
    );

    assert.equal(sent.length, 1);
    websocket.readyState = 0;
    timers.tick(helpers.TERMINAL_CLAUDE_PASTE_NO_MARKER_FALLBACK_DELAY_MS);
    assert.equal(sent.length, 1);
    assert.equal(timers.pending(), 1);

    websocket.readyState = 1;
    timers.tick(helpers.TERMINAL_PASTE_SUBMIT_RETRY_CADENCE_MS);
    assert.deepStrictEqual(JSON.parse(sent[1] ?? "{}"), {
      type: "input",
      data: "\r",
    });
    assert.equal(timers.pending(), 0);
  });

  it("queues later delayed Claude pastes behind the pending submit", async () => {
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
    );
    const sent: string[] = [];
    const ctx = makeContext({
      activeSessionId: "session-upload",
      sessions: [
        {
          id: "session-upload",
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
          age: "0s",
          presetId: null,
        },
      ],
      _terminalRefs: {
        "session-upload": {
          ws: makeCapturingWebSocket(sent),
        },
      },
    });

    assert.equal(
      helpers.dashboardSendToTerminalSession(
        ctx,
        "session-upload",
        "First\nprompt",
        { adapt: false },
      ),
      true,
    );
    assert.equal(
      helpers.dashboardSendToTerminalSession(
        ctx,
        "session-upload",
        "Second\nprompt",
        { adapt: false },
      ),
      true,
    );

    assert.equal(sent.length, 1);
    assert.deepStrictEqual(JSON.parse(sent[0] ?? "{}"), {
      type: "input",
      data: "\x1b[200~First\nprompt\x1b[201~",
    });
    assert.equal(
      ctx._terminalRefs["session-upload"]?.pasteSubmitQueue?.length,
      1,
    );

    helpers.dashboardHandlePasteSubmitOutput(
      ctx,
      "session-upload",
      "[Pasted text #1 +1 lines]",
    );

    assert.equal(sent.length, 1);
    timers.tick(helpers.TERMINAL_PASTE_MARKER_SETTLE_DELAY_MS);
    assert.equal(sent.length, 3);

    assert.deepStrictEqual(JSON.parse(sent[1] ?? "{}"), {
      type: "input",
      data: "\r",
    });
    assert.deepStrictEqual(JSON.parse(sent[2] ?? "{}"), {
      type: "input",
      data: "\x1b[200~Second\nprompt\x1b[201~",
    });

    helpers.dashboardHandlePasteSubmitOutput(
      ctx,
      "session-upload",
      "[Pasted text #2 +1 lines]",
    );
    timers.tick(helpers.TERMINAL_PASTE_MARKER_SETTLE_DELAY_MS);
    assert.deepStrictEqual(JSON.parse(sent[3] ?? "{}"), {
      type: "input",
      data: "\r",
    });
  });

  it("clears pending delayed paste submit state when user input takes over", async () => {
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
    );
    const ctx = makeLaunchPromptContext();

    assert.equal(
      helpers.dashboardSendToTerminalSession(
        ctx,
        "launch-session",
        "First\nprompt",
        { adapt: false },
      ),
      true,
    );
    assert.equal(
      helpers.dashboardSendToTerminalSession(
        ctx,
        "launch-session",
        "Second\nprompt",
        { adapt: false },
      ),
      true,
    );

    helpers.dashboardClearPasteSubmitState(ctx, "launch-session");
    timers.tick(15000);

    assert.equal(
      ctx._terminalRefs["launch-session"]?.pasteSubmitTimer,
      undefined,
    );
    assert.equal(
      ctx._terminalRefs["launch-session"]?.pasteSubmitQueue,
      undefined,
    );
    assert.equal(ctx.sent.length, 1);
  });

  it("starts xterm loading before create returns and connects after both finish", async () => {
    const calls: string[] = [];
    let resolveXterm!: () => void;
    const xtermReady = new Promise<void>((resolve) => {
      resolveXterm = resolve;
    });
    const helpers = loadHelpers(async (input, init) => {
      calls.push(`fetch:${init?.method ?? "GET"}:${String(input)}`);
      return {
        json: async () => ({
          id: "session-1",
          wsUrl: "/ws/terminal/session-1",
        }),
      } as Response;
    });
    const ctx = makeContext({
      // Holding xterm readiness open proves backend create can start before
      // the browser terminal assets finish loading.
      async loadXterm(): Promise<void> {
        calls.push("loadXterm");
        await xtermReady;
        calls.push("loadXterm:ready");
      },
      // The attach call is order-sensitive: it must happen after loadXterm and $nextTick.
      connectTerminal(sessionId: string, wsUrl: string): void {
        calls.push(`connect:${sessionId}:${wsUrl}`);
      },
      // Count refresh is only evidence here that the successful launch path completed.
      async updateSessionCount(): Promise<void> {
        calls.push("updateSessionCount");
      },
      // Terminal attach must wait for Alpine to render the workspace container.
      async $nextTick(): Promise<void> {
        calls.push("$nextTick");
      },
    });

    const launchPromise = helpers.dashboardLaunchInTerminal(ctx, "", "claude", {
      promptLabel: "Manual session",
    });
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(calls[0], "loadXterm");
    assert.equal(calls[1], "fetch:POST:/api/terminal/create");
    assert.ok(
      !calls.includes("connect:session-1:/ws/terminal/session-1"),
      "terminal should not attach until xterm has loaded",
    );
    resolveXterm();
    await launchPromise;

    assert.equal(ctx.sessions.length, 1);
    assert.equal(ctx.sessions[0]?.promptLabel, "Manual session");
    assert.equal(ctx.sessions[0]?.loadingPhase, "connecting");
    assert.equal(ctx._terminalRefs["session-1"]?.retryPrompt, "");
    assert.equal(
      ctx._terminalRefs["session-1"]?.retryPromptLabel,
      "Manual session",
    );
    assert.equal(ctx.sessionTitles["session-1"], "Manual session");
    assert.equal(ctx.activeView, "workspace");
    assert.equal(ctx.workspacePanel, "terminal");
    assert.ok(
      calls.indexOf("loadXterm") <
        calls.indexOf("fetch:POST:/api/terminal/create"),
      "xterm loading should start before the create POST resolves",
    );
    assert.ok(
      calls.indexOf("$nextTick") <
        calls.indexOf("connect:session-1:/ws/terminal/session-1"),
      "the workspace container should render before the terminal attaches",
    );
    assert.ok(
      calls.indexOf("loadXterm:ready") <
        calls.indexOf("connect:session-1:/ws/terminal/session-1"),
      "xterm should load before the browser terminal attaches",
    );
    assert.ok(calls.includes("updateSessionCount"));
    assert.deepStrictEqual(ctx.toasts, []);
  });

  it("coalesces bursty terminal session refreshes behind one fetch", async () => {
    const timers = createFakeTimers();
    let fetchCount = 0;
    const helpers = loadHelpers(async (input) => {
      fetchCount += 1;
      assert.equal(String(input), "/api/terminal/sessions");
      return {
        json: async () => ({
          activeCount: 2,
          maxSessions: 4,
          sessions: [],
        }),
      } as Response;
    }, timers);
    const ctx = makeContext();

    const first = helpers.dashboardUpdateSessionCount(ctx);
    const second = helpers.dashboardUpdateSessionCount(ctx);

    timers.tick(49);
    await Promise.resolve();
    assert.equal(fetchCount, 0);
    timers.tick(1);
    await Promise.all([first, second]);

    assert.equal(fetchCount, 1);
    assert.equal(ctx.terminalSessionCount, 2);
    assert.equal(ctx.serverMaxSessions, 4);

    const third = helpers.dashboardUpdateSessionCount(ctx);
    timers.tick(50);
    await third;
    assert.equal(fetchCount, 2);
  });

  it("marks disconnected local sessions ended when refresh proves they are gone", async () => {
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () =>
        ({
          json: async () => ({
            activeCount: 0,
            maxSessions: 10,
            sessions: [],
          }),
        }) as Response,
      timers,
    );
    const session = {
      id: "session-gone",
      runner: "claude",
      promptLabel: "Gone session",
      projectPath: "/tmp/example",
      cwd: "/tmp/example",
      targetPath: "/tmp/example",
      startTime: Date.now(),
      lastInputTime: Date.now(),
      connected: false,
      ended: false,
      awaitingInput: true,
      outputTail: "Do you want to proceed?\n1. Yes\n2. No",
      loadingPhase: "ready",
      age: "",
      presetId: null,
    };
    const ctx = makeContext({
      sessions: [session],
      _terminalRefs: { "session-gone": {} },
    });

    const refresh = helpers.dashboardUpdateSessionCount(ctx);
    timers.tick(50);
    await refresh;

    assert.equal(session.ended, true);
    assert.equal(session.awaitingInput, false);
  });

  it("loading overlay escalates slow starts and clears on first output", () => {
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
    );
    const session = {
      id: "session-loading",
      runner: "claude",
      promptLabel: "Loading session",
      loadingPhase: "connecting",
      loadingShowSlowHint: false,
      loadingShowRetry: false,
      ended: false,
      outputTail: "",
    };
    const ctx = makeContext({
      sessions: [session],
      _terminalRefs: {
        "session-loading": {},
      },
    });

    helpers.dashboardArmTerminalLoadingTimers(ctx, "session-loading", session);

    timers.tick(2999);
    assert.equal(session.loadingShowSlowHint, false);
    assert.equal(session.loadingShowRetry, false);

    timers.tick(1);
    assert.equal(session.loadingShowSlowHint, true);
    assert.equal(session.loadingShowRetry, false);

    timers.tick(7000);
    assert.equal(session.loadingShowRetry, true);

    helpers.dashboardSetTerminalLoadingPhase(
      ctx,
      "session-loading",
      session,
      "loading",
    );
    helpers.dashboardMarkTerminalLoadingReady(
      ctx,
      "session-loading",
      session,
      "",
      "first byte",
    );

    assert.equal(session.loadingPhase, "ready");
    assert.equal(session.loadingShowSlowHint, false);
    assert.equal(session.loadingShowRetry, false);
    assert.equal(timers.pending(), 0);
  });

  it("loading overlay avoids escalation when first output arrives quickly", () => {
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
    );
    const session = {
      id: "session-fast",
      runner: "codex",
      promptLabel: "Fast session",
      loadingPhase: "connecting",
      loadingShowSlowHint: false,
      loadingShowRetry: false,
      ended: false,
      outputTail: "",
    };
    const ctx = makeContext({
      sessions: [session],
      _terminalRefs: {
        "session-fast": {},
      },
    });

    helpers.dashboardArmTerminalLoadingTimers(ctx, "session-fast", session);
    helpers.dashboardMarkTerminalLoadingReady(
      ctx,
      "session-fast",
      session,
      "",
      "first byte",
    );
    timers.tick(10000);

    assert.equal(session.loadingPhase, "ready");
    assert.equal(session.loadingShowSlowHint, false);
    assert.equal(session.loadingShowRetry, false);
    assert.equal(timers.pending(), 0);
  });

  it("loading overlay state stays per-session when switching active sessions", () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const connecting = {
      id: "session-connecting",
      runner: "claude",
      promptLabel: "Connecting session",
      loadingPhase: "connecting",
      ended: false,
    };
    const loading = {
      id: "session-loading",
      runner: "antigravity",
      promptLabel: "Loading session",
      loadingPhase: "loading",
      ended: false,
    };
    const ctx = makeContext({
      activeSessionId: "session-connecting",
      sessions: [connecting, loading],
      _terminalRefs: {
        "session-connecting": {},
        "session-loading": {},
      },
    });

    ctx.activeSessionId = "session-loading";
    helpers.dashboardMarkTerminalLoadingReady(
      ctx,
      "session-loading",
      loading,
      "",
      "first byte",
    );

    assert.equal(connecting.loadingPhase, "connecting");
    assert.equal(loading.loadingPhase, "ready");
  });

  it("loading overlay records pre-output errors and retries the original launch", async () => {
    const calls: string[] = [];
    const helpers = loadHelpers(async (input, init) => {
      calls.push(`fetch:${init?.method ?? "GET"}:${String(input)}`);
      return { json: async () => ({ ok: true }) } as Response;
    });
    const launchCalls: Array<{
      prompt: string;
      runner?: string;
      options?: LaunchOptions;
    }> = [];
    const session = {
      id: "session-error",
      runner: "claude",
      promptLabel: "Setup Claude",
      presetId: "preset-setup",
      cwd: "/tmp/example",
      targetPath: "/tmp/target",
      loadingPhase: "connecting",
      loadingShowSlowHint: false,
      loadingShowRetry: false,
      ended: false,
    };
    const ctx = makeContext({
      activeSessionId: "session-error",
      sessions: [session],
      _terminalRefs: {
        "session-error": {
          retryPrompt: "setup prompt",
          retryPromptLabel: "Setup Claude",
          retryPresetId: "preset-setup",
          retryCwdPath: "/tmp/example",
          retryTargetPath: "/tmp/target",
          // Retry must clean up the failed backend shell before relaunching.
          cleanup(): void {
            calls.push("cleanup:session-error");
          },
        },
      },
      // Capture retry metadata without starting a second real terminal session.
      async launchInTerminal(
        prompt: string,
        runner?: string,
        options?: LaunchOptions,
      ): Promise<void> {
        launchCalls.push({ prompt, runner, options });
      },
    });

    helpers.dashboardSetTerminalLoadingPhase(
      ctx,
      "session-error",
      session,
      "error",
      "WebSocket connection failed",
    );

    assert.equal(session.loadingPhase, "error");
    assert.equal(session.loadingError, "WebSocket connection failed");
    assert.equal(session.loadingShowRetry, true);

    await helpers.dashboardRetryTerminalSession(ctx, "session-error");

    assert.ok(calls.includes("cleanup:session-error"));
    assert.ok(calls.includes("fetch:DELETE:/api/terminal/session-error"));
    assert.deepStrictEqual(ctx.sessions, []);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(launchCalls)), [
      {
        prompt: "setup prompt",
        runner: "claude",
        options: {
          promptLabel: "Setup Claude",
          presetId: "preset-setup",
          cwdPath: "/tmp/example",
          targetPath: "/tmp/target",
        },
      },
    ]);
  });

  it("treats terminal WebSocket close as detach until an exit message arrives", () => {
    const { globals, sockets } = makeBrowserTerminalGlobals();
    const calls: string[] = [];
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
      globals,
    );
    const session = {
      id: "session-detach",
      runner: "copilot",
      promptLabel: "Detached session",
      projectPath: "/tmp/example",
      cwd: "/tmp/example",
      targetPath: "/tmp/example",
      startTime: Date.now(),
      lastInputTime: Date.now(),
      connected: false,
      ended: false,
      awaitingInput: true,
      outputTail: "Do you want to run this command?\n1. Yes\n2. No",
      loadingPhase: "ready",
      loadingShowSlowHint: false,
      loadingShowRetry: false,
      age: "",
      presetId: null,
    };
    const ctx = makeContext({
      activeSessionId: "session-detach",
      sessions: [session],
      _terminalRefs: { "session-detach": {} },
      // Detach should refresh counts without converting the local session to ended.
      async updateSessionCount(): Promise<void> {
        calls.push("updateSessionCount");
      },
    });

    helpers.dashboardConnectTerminal(
      ctx,
      "session-detach",
      "/ws/terminal/session-detach",
    );
    const socket = sockets[0];
    assert.ok(socket);
    socket.onopen?.();
    assert.equal(session.connected, true);

    socket.onclose?.();

    assert.equal(session.connected, false);
    assert.equal(session.ended, false);
    assert.equal(session.awaitingInput, true);
    assert.deepStrictEqual(ctx.recentTerminalSessions, []);

    socket.onmessage?.({
      data: JSON.stringify({ type: "exit", code: 0, signal: null }),
    });

    assert.equal(session.ended, true);
    assert.equal(session.connected, false);
    assert.equal(session.awaitingInput, false);
  });

  it("treats missing-session WebSocket errors as true termination", () => {
    const { globals, sockets } = makeBrowserTerminalGlobals();
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
      globals,
    );
    const session = {
      id: "session-missing",
      runner: "claude",
      promptLabel: "Missing session",
      projectPath: "/tmp/example",
      cwd: "/tmp/example",
      targetPath: "/tmp/example",
      startTime: Date.now(),
      lastInputTime: Date.now(),
      connected: false,
      ended: false,
      awaitingInput: true,
      outputTail: "",
      loadingPhase: "connecting",
      loadingShowSlowHint: false,
      loadingShowRetry: false,
      age: "",
      presetId: null,
    };
    const ctx = makeContext({
      activeSessionId: "session-missing",
      sessions: [session],
      _terminalRefs: { "session-missing": {} },
    });

    helpers.dashboardConnectTerminal(
      ctx,
      "session-missing",
      "/ws/terminal/session-missing",
    );
    const socket = sockets[0];
    assert.ok(socket);
    socket.onmessage?.({
      data: JSON.stringify({
        type: "error",
        message: "Session not found or already terminated",
      }),
    });
    socket.onclose?.();

    assert.equal(session.ended, true);
    assert.equal(session.connected, false);
    assert.equal(session.awaitingInput, false);
  });

  it("reconnects server-active sessions when an ended local shell is stale", async () => {
    const calls: string[] = [];
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const endedLocal = {
      id: "session-live",
      runner: "codex",
      promptLabel: "Stale local session",
      projectPath: "/tmp/example",
      cwd: "/tmp/example",
      targetPath: "/tmp/example",
      startTime: Date.now(),
      lastInputTime: Date.now(),
      connected: false,
      ended: true,
      awaitingInput: false,
      outputTail: "",
      loadingPhase: "ready",
      age: "",
      presetId: null,
    };
    const ctx = makeContext({
      activeSessionId: "session-live",
      sessions: [endedLocal],
      // Reconnect should reopen xterm for the server-active session.
      async loadXterm(): Promise<void> {
        calls.push("loadXterm");
      },
      // Captures the fresh WebSocket URL chosen for the rehydrated session.
      connectTerminal(sessionId: string, wsUrl: string): void {
        calls.push(`connect:${sessionId}:${wsUrl}`);
      },
      // Mirrors Alpine's render boundary before reconnecting stale local state.
      async $nextTick(): Promise<void> {
        calls.push("$nextTick");
      },
    });

    await helpers.dashboardOpenServerSession(ctx, {
      id: "session-live",
      runner: "codex",
      status: "active",
      createdAt: new Date().toISOString(),
      projectPath: "/tmp/example",
      cwd: "/tmp/example",
      targetPath: "/tmp/example",
      lastInputAt: Date.now(),
    });

    assert.equal(ctx.sessions.length, 1);
    assert.equal(ctx.sessions[0]?.id, "session-live");
    assert.equal(ctx.sessions[0]?.ended, false);
    assert.deepStrictEqual(calls, [
      "loadXterm",
      "$nextTick",
      "connect:session-live:/ws/terminal/session-live",
    ]);
  });

  it("cleans up the backend session when xterm loading fails after creation", async () => {
    const calls: string[] = [];
    const helpers = loadHelpers(async (input, init) => {
      calls.push(`fetch:${init?.method ?? "GET"}:${String(input)}`);
      if (String(input) === "/api/terminal/create") {
        return {
          json: async () => ({
            id: "session-2",
            wsUrl: "/ws/terminal/session-2",
          }),
        } as Response;
      }
      return { json: async () => ({ ok: true }) } as Response;
    });
    const ctx = makeContext({
      // Throws after backend create so the failure path must delete that shell.
      async loadXterm(): Promise<void> {
        calls.push("loadXterm");
        throw new Error("xterm.js load failed");
      },
      // Count refresh proves the failure path reconciles server state.
      async updateSessionCount(): Promise<void> {
        calls.push("updateSessionCount");
      },
      // Included so the failed path can still reach the normal attach boundary.
      async $nextTick(): Promise<void> {
        calls.push("$nextTick");
      },
    });

    await helpers.dashboardLaunchInTerminal(ctx, "", "claude", {
      promptLabel: "Manual session",
    });

    assert.equal(ctx.sessions.length, 0);
    assert.equal(ctx.activeSessionId, null);
    assert.ok(calls.includes("fetch:DELETE:/api/terminal/session-2"));
    assert.equal(ctx.toasts[0]?.isError, true);
    assert.match(ctx.toasts[0]?.msg ?? "", /xterm\.js load failed/);
  });

  it("loads xterm assets from the local dashboard asset route", () => {
    const source = readFileSync(DASHBOARD_TERMINAL_PATH, "utf-8");
    assert.match(source, /link\.href = "\/assets\/xterm\.css"/);
    assert.match(
      source,
      /loadXtermScript\("\/assets\/xterm\.js", "xterm\.js"\)/,
    );
    assert.match(
      source,
      /loadXtermScript\("\/assets\/addon-fit\.js", "fit addon"\)/,
    );
    assert.doesNotMatch(source, /cdn\.jsdelivr\.net\/npm\/@xterm/);
  });

  it("deduplicates xterm DOM elements and removes partial inserts on retry", () => {
    const source = readFileSync(DASHBOARD_TERMINAL_PATH, "utf-8");
    assert.match(
      source,
      /document\.querySelector<HTMLLinkElement>\(\s*'link\[rel="stylesheet"\]\[href="\/assets\/xterm\.css"\]'/,
    );
    assert.match(source, /document\.querySelector<HTMLScriptElement>/);
    assert.match(source, /element\.dataset\["loaded"\] = "true"/);
    assert.match(source, /removeXtermAssetElements\(\)/);
    assert.match(source, /xtermLoadPromise = null/);
  });

  it("keeps the launch title when a local session is ended into recent history", () => {
    const calls: string[] = [];
    const helpers = loadHelpers(async (input, init) => {
      calls.push(`fetch:${init?.method ?? "GET"}:${String(input)}`);
      return { json: async () => ({ ok: true }) } as Response;
    });
    const ctx = makeContext({
      activeSessionId: "session-3",
      promptRunStates: { "preset-debug-ui": "running" },
      sessions: [
        {
          id: "session-3",
          runner: "claude",
          promptLabel: "Debug UI in Browser",
          presetId: "preset-debug-ui",
          projectPath: "/tmp/example",
          cwd: "/tmp/example",
          targetPath: "/tmp/example",
          startTime: Date.now() - 120_000,
          awaitingInput: false,
          outputTail: "",
        },
      ],
      _terminalRefs: {
        "session-3": {
          // Ending a session must release browser-side terminal resources.
          cleanup(): void {
            calls.push("cleanup:session-3");
          },
        },
      },
      // Saved session state should be removed alongside the backend delete call.
      _forgetSavedSession(sessionId: string): void {
        calls.push(`forget:${sessionId}`);
      },
      // Recent history keeps only fields the UI needs after the live record is gone.
      rememberRecentSession(session: Record<string, unknown>): void {
        this.recentTerminalSessions.push({
          id: session.id,
          promptLabel: session.promptLabel,
          runner: session.runner,
        });
      },
    });

    helpers.dashboardEndSession(ctx, "session-3");

    assert.deepStrictEqual(ctx.sessions, []);
    assert.equal(ctx.activeSessionId, null);
    assert.equal(ctx.promptRunStates["preset-debug-ui"], "pass");
    assert.deepStrictEqual(ctx.recentTerminalSessions, [
      {
        id: "session-3",
        promptLabel: "Debug UI in Browser",
        runner: "claude",
      },
    ]);
    assert.ok(calls.includes("fetch:DELETE:/api/terminal/session-3"));
    assert.ok(calls.includes("cleanup:session-3"));
    assert.ok(calls.includes("forget:session-3"));
  });

  it("detects terminal output that is awaiting interactive input", () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );

    assert.equal(
      helpers.dashboardOutputLooksAwaitingInput(
        "Do you want to proceed?\n1. Yes\n2. Yes, and remember\n3. No",
      ),
      true,
    );
    assert.equal(
      helpers.dashboardOutputLooksAwaitingInput(
        "Do\x1b[1Cyou\x1b[1Cwant\x1b[1Cto\x1b[1Cproceed?\n1. Yes\n2. Yes, and remember\n3. No",
      ),
      true,
    );
    assert.equal(
      helpers.dashboardOutputLooksAwaitingInput(
        "Bash command\ncommand -v browser-use\nEsc to cancel · Tab to amend · ctrl+e to explain",
      ),
      true,
    );
    assert.equal(
      helpers.dashboardOutputLooksAwaitingInput(
        "Bash command\ncommand -v browser-use\nEsc\x1b[1Cto\x1b[1Ccancel\x1b[1C·\x1b[1CTab\x1b[1Cto\x1b[1Camend\x1b[1C·\x1b[1Cctrl+e\x1b[1Cto\x1b[1Cexplain",
      ),
      true,
    );
    assert.equal(
      helpers.dashboardOutputLooksAwaitingInput("All checks passing\nDone."),
      false,
    );
    assert.equal(
      helpers.dashboardOutputLooksAwaitingInput(
        "Implementation plan\n1. Read files\n2. Patch code\n3. Run tests",
      ),
      false,
    );
    assert.equal(
      helpers.dashboardOutputLooksAwaitingInput(
        "Choose an option:\n1) Continue\n2) Explain\n3) Cancel",
      ),
      true,
    );
    assert.equal(
      helpers.dashboardOutputLooksAwaitingInput(
        "Do you want to run this command?\n1. Yes\n2. Yes, and don't ask again for [...] in this repo\n3. No, and tell Copilot what to do differently (Esc to stop)",
      ),
      true,
    );
    assert.equal(
      helpers.dashboardOutputLooksAwaitingInput(
        "Allow execution of [bash]\n1. Allow once\n2. Allow for this session\n3. No, suggest changes (esc)",
      ),
      true,
    );
    assert.equal(
      helpers.dashboardOutputLooksAwaitingInput(
        "Would you like to run the following command?\n1. Yes, proceed\n2. Yes, and don't ask again for commands that start with '...'\n3. No, and tell Codex what to do differently\n(esc)",
      ),
      true,
    );
    assert.equal(
      helpers.dashboardOutputLooksAwaitingInput(
        "Bash command ...\nDo you want to proceed?\n1. Yes\n2. No\nEsc to cancel · Tab to amend · ctrl+e to explain",
      ),
      true,
    );
  });

  it("detects awaiting-input when Claude Code lays out the footer with CHA cursor-absolute jumps", () => {
    // Real Claude Code TUI fragment: it positions every word of the
    // "Esc to cancel · Tab to amend" footer with CHA (ESC[<col>G).
    // Before the parser fix the words collapsed to "Esctocanceltoamend"
    // and every word-boundary regex failed.
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const claudeFooter =
      "\x1b[2G\x1b[38;5;246mEsc\x1b[6Gto\x1b[9Gcancel\x1b[16G·" +
      "\x1b[18GTab\x1b[22Gto\x1b[25Gamend\x1b[31G·\x1b[33Gctrl+e\x1b[40Gto\x1b[43Gexplain";
    assert.equal(helpers.dashboardOutputLooksAwaitingInput(claudeFooter), true);
    assert.equal(
      helpers.dashboardNextAwaitingInputState(false, "", claudeFooter),
      true,
    );
  });

  it("detects awaiting-input when Claude Code marks numbered choices with ❯ and CHA layout", () => {
    // Real Claude Code permission prompt: marker is U+276F (❯), not [›>],
    // and the words inside each option are positioned by CHA. Even after
    // CHA is normalised to spaces the marker class must accept ❯.
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const claudePrompt = [
      "Do you want to proceed?",
      "❯\x1b[4G\x1b[38;5;246m1.\x1b[7G\x1b[38;5;153mYes",
      "",
      " \x1b[4G\x1b[38;5;246m2.\x1b[7G\x1b[38;5;153mNo",
    ].join("\n");
    assert.equal(helpers.dashboardOutputLooksAwaitingInput(claudePrompt), true);
  });

  it("detects awaiting-input when a runner broadcasts an Action Required OSC title", () => {
    // codex and gemini signal blocked state through the terminal title bar
    // (OSC 0). The dashboard never reads xterm's title, so the OSC payload
    // itself is the only signal we get in outputTail.
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const codexBell =
      "Running tool…\n\x1b]0;[ ! ] Action Required | goat-flow\x07";
    const geminiBell =
      "Waiting on user…\n\x1b]0;✋  Action Required (goat-flow)\x07";
    const explicitAwaiting = "Idle\n\x1b]0;awaiting confirmation - copilot\x07";
    assert.equal(helpers.dashboardOutputLooksAwaitingInput(codexBell), true);
    assert.equal(helpers.dashboardOutputLooksAwaitingInput(geminiBell), true);
    assert.equal(
      helpers.dashboardOutputLooksAwaitingInput(explicitAwaiting),
      true,
    );
    // ESC \ string-terminator form must work too.
    assert.equal(
      helpers.dashboardOutputLooksAwaitingInput(
        "tool running\n\x1b]0;[ ! ] Action Required\x1b\\",
      ),
      true,
    );
  });

  it("does not trip awaiting-input on benign OSC titles or text containing 'action required'", () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    // Plain working title - no awaiting signal.
    assert.equal(
      helpers.dashboardOutputLooksAwaitingInput(
        "\x1b]0;~/projects/goat-flow\x07All checks passing.",
      ),
      false,
    );
    // "Action Required" inside body prose, no title, no numbered prompt.
    assert.equal(
      helpers.dashboardOutputLooksAwaitingInput(
        "Reading ticket: Action Required by Friday.\nDone.",
      ),
      false,
    );
  });

  it("clears awaiting-input state when later output resumes normally", () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );

    const prompt = "Do you want to proceed?\n1. Yes\n2. Explain\n3. No";
    assert.equal(
      helpers.dashboardNextAwaitingInputState(false, "", prompt),
      true,
    );
    assert.equal(
      helpers.dashboardNextAwaitingInputState(
        false,
        "",
        "Do\x1b[1Cyou\x1b[1Cwant\x1b[1Cto\x1b[1Cproceed?\n1. Yes\n2. Explain\n3. No",
      ),
      true,
    );
    assert.equal(
      helpers.dashboardNextAwaitingInputState(true, prompt, "\nContinuing..."),
      false,
    );
    assert.equal(
      helpers.dashboardNextAwaitingInputState(true, prompt, "\r✻ Thinking…"),
      true,
    );
    assert.equal(
      helpers.dashboardNextAwaitingInputState(true, prompt, "\r✢ Thinking…"),
      true,
    );
    assert.equal(
      helpers.dashboardNextAwaitingInputState(false, prompt, "\nRunning..."),
      false,
    );
    assert.equal(
      helpers.dashboardNextAwaitingInputState(true, prompt, "\n   "),
      true,
    );
  });

  it("detects awaiting-input prompts split across terminal chunks", () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );

    assert.equal(
      helpers.dashboardNextAwaitingInputState(
        false,
        "Do you want to run this command?\n",
        "1. Yes\n2. Yes, and don't ask again for [...] in this repo\n3. No, and tell Copilot what to do differently (Esc to stop)",
      ),
      true,
    );
    assert.equal(
      helpers.dashboardNextAwaitingInputState(
        false,
        "Allow execution of [bash]\n",
        "1. Allow once\n2. Allow for this session\n3. No, suggest changes (esc)",
      ),
      true,
    );
    assert.equal(
      helpers.dashboardNextAwaitingInputState(
        false,
        "Would you like to run the following command?\n",
        "1. Yes, proceed\n2. Yes, and don't ask again for commands that start with 'ls'\n3. No, and tell Codex what to do differently\n(esc)",
      ),
      true,
    );
    assert.equal(
      helpers.dashboardNextAwaitingInputState(
        false,
        "Bash command ...\nDo you want to proceed?\n",
        "1. Yes\n2. No\nEsc to cancel · Tab to amend · ctrl+e to explain",
      ),
      true,
    );
    assert.equal(
      helpers.dashboardNextAwaitingInputState(
        true,
        "Do you want to run this command?\n",
        "1. Yes\n2. Yes, and don't ask again\n3. No",
      ),
      true,
    );
    assert.equal(
      helpers.dashboardNextAwaitingInputState(
        false,
        "Do you want to run this command?\n1. Yes\n",
        "2. No\nEsc to cancel",
      ),
      true,
    );
    assert.equal(
      helpers.dashboardNextAwaitingInputState(
        false,
        [
          "Do you want to run this command?",
          "1. Yes",
          "2. No",
          "1",
          "Running command...",
          "Done.",
        ].join("\n"),
        "\nNext steps:\n1. Inspect the result\n2. Update the docs\n",
      ),
      false,
    );
  });

  // Per-runner fixture-driven tests. Each fixture is captured under node-pty
  // from the live runner. Positive fixtures pin the prompts the heuristic must
  // catch; negative fixtures pin the running-state output the heuristic must
  // NOT false-fire on.
  const AWAITING_FIXTURE_DIR = resolve(
    PROJECT_ROOT,
    "test",
    "unit",
    "__fixtures__",
    "awaiting-input",
  );
  /**
   * Loads captured PTY bytes so prompt detection is pinned to real runner output.
   */
  function loadFixture(name: string): string {
    return readFileSync(resolve(AWAITING_FIXTURE_DIR, name), "utf-8");
  }

  it("detects Claude Code workspace trust prompt from captured PTY bytes", () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const bytes = loadFixture("claude-trust.txt");
    assert.equal(helpers.dashboardOutputLooksAwaitingInput(bytes), true);
    assert.equal(
      helpers.dashboardNextAwaitingInputState(false, "", bytes),
      true,
    );
    // A transient redraw frame after the prompt must keep the state on.
    assert.equal(
      helpers.dashboardNextAwaitingInputState(true, bytes, "\r✻ Thinking…"),
      true,
    );
  });

  it("detects Claude Code in-session Bash approval prompt from captured PTY bytes", () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const bytes = loadFixture("claude-bash-approval.txt");
    assert.equal(helpers.dashboardOutputLooksAwaitingInput(bytes), true);
    assert.equal(
      helpers.dashboardNextAwaitingInputState(false, "", bytes),
      true,
    );
    assert.equal(
      helpers.dashboardNextAwaitingInputState(true, bytes, "\r✻ Thinking…"),
      true,
    );
  });

  it("detects Codex workspace trust prompt from captured PTY bytes (CUP layout)", () => {
    // Codex lays each word out with `ESC[r;cH` (CUP) instead of CHA, and never
    // emits an inter-line `\r\n`. Without the CUP→newline normalisation the
    // numbered-choices regex never sees a newline between `1.` and `2.`.
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const bytes = loadFixture("codex-startup.txt");
    assert.equal(helpers.dashboardOutputLooksAwaitingInput(bytes), true);
    assert.equal(
      helpers.dashboardNextAwaitingInputState(false, "", bytes),
      true,
    );
  });

  it("detects Copilot workspace trust prompt from captured PTY bytes (boxed layout)", () => {
    // Copilot renders the prompt inside a `│ ... │` border. Without the
    // box-drawing strip the numbered-choices regex never sees `\n\s*1.`.
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const bytes = loadFixture("copilot-startup.txt");
    assert.equal(helpers.dashboardOutputLooksAwaitingInput(bytes), true);
    assert.equal(
      helpers.dashboardNextAwaitingInputState(false, "", bytes),
      true,
    );
  });

  it("detects Gemini workspace trust prompt from captured PTY bytes (● bullet + box)", () => {
    // Gemini uses `●` as the selection bullet (not `❯`) and wraps the menu in
    // a `│ ... │` border. The fix extends the bullet class and strips box.
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const bytes = loadFixture("gemini-startup.txt");
    assert.equal(helpers.dashboardOutputLooksAwaitingInput(bytes), true);
    assert.equal(
      helpers.dashboardNextAwaitingInputState(false, "", bytes),
      true,
    );
  });

  it("does NOT false-fire on captured running output from Claude Code", () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const bytes = loadFixture("claude-running.txt");
    assert.equal(helpers.dashboardOutputLooksAwaitingInput(bytes), false);
    assert.equal(
      helpers.dashboardNextAwaitingInputState(false, "", bytes),
      false,
    );
  });

  it("does NOT false-fire on captured running output from Codex", () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const bytes = loadFixture("codex-running.txt");
    assert.equal(helpers.dashboardOutputLooksAwaitingInput(bytes), false);
    assert.equal(
      helpers.dashboardNextAwaitingInputState(false, "", bytes),
      false,
    );
  });

  it("does NOT false-fire on captured running output from Copilot", () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const bytes = loadFixture("copilot-running.txt");
    assert.equal(helpers.dashboardOutputLooksAwaitingInput(bytes), false);
    assert.equal(
      helpers.dashboardNextAwaitingInputState(false, "", bytes),
      false,
    );
  });

  it("does NOT false-fire on captured running output from Gemini", () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const bytes = loadFixture("gemini-running.txt");
    assert.equal(helpers.dashboardOutputLooksAwaitingInput(bytes), false);
    assert.equal(
      helpers.dashboardNextAwaitingInputState(false, "", bytes),
      false,
    );
  });

  it("keeps awaiting state across Claude Code's lone-bullet spinner frame", () => {
    // Live investigation (browser console, 2026-05-21) traced the M00 badge
    // failure to this exact chunk: Claude Code paints a single `●` (U+25CF)
    // in dim grey via CHA/CUP cursor walks about twice per second while a
    // prompt is visible. Before the fix the chunk had `chunkHasText === true`
    // (the lone `●` survives ANSI stripping and trim), fell through every
    // classifier in `dashboardNextAwaitingInputState`, and the message
    // handler's else-branch cleared the 1200ms reveal timer - so the badge
    // never appeared even though the prompt was clearly on screen.
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const prompt =
      "Do you want to proceed?\n❯ 1. Yes\n  2. No\n\nEsc to cancel · Tab to amend · ctrl+e to explain";
    const bulletOn =
      "\r\x1b[25A\x1b[38;5;246m●\x1b[39m\r" +
      "\r\n".repeat(25) +
      "\x1b[1C\x1b[4A\x1b[1D\x1b[4B";
    const bulletOff =
      "\r\x1b[25A\x1b[38;5;246m \x1b[39m\r" +
      "\r\n".repeat(25) +
      "\x1b[1C\x1b[4A\x1b[1D\x1b[4B";
    // Sanity: the lone-bullet chunk on its own is a transient redraw.
    assert.equal(helpers.dashboardOutputLooksAwaitingInput(bulletOn), false);
    // The bullet-on frame must KEEP the awaiting state when prompt is in tail.
    assert.equal(
      helpers.dashboardNextAwaitingInputState(true, prompt, bulletOn),
      true,
    );
    // The bullet-off frame (already empty after stripping) keeps state too.
    assert.equal(
      helpers.dashboardNextAwaitingInputState(true, prompt, bulletOff),
      true,
    );
    // Alternating bullet frames simulating ~2 seconds of spinner ticks must
    // never knock the state down.
    let state = true;
    let tail = prompt;
    for (let i = 0; i < 8; i += 1) {
      const chunk = i % 2 === 0 ? bulletOn : bulletOff;
      state = helpers.dashboardNextAwaitingInputState(state, tail, chunk);
      tail = (tail + chunk).slice(-5000);
      assert.equal(state, true, `spinner frame ${i} cleared the state`);
    }
    // Genuine "moved on" output (the user pressed 1, Claude continues) still
    // clears: the chunk is non-bullet text without prompt markers.
    assert.equal(
      helpers.dashboardNextAwaitingInputState(
        true,
        prompt,
        "\nRunning command...\nDone.\n",
      ),
      false,
    );
    // Real running output starting with `●` followed by text is NOT a lone
    // bullet - it must still be classifiable as non-redraw so the badge does
    // clear when Claude prints status lines like `● Now let me read…`.
    assert.equal(
      helpers.dashboardNextAwaitingInputState(
        true,
        prompt,
        "● Now let me read the remaining skills and check key supporting docs.",
      ),
      false,
    );
  });

  it("keeps the badge on across unknown chunks while the session is awaiting", () => {
    // Output chunks never prove the user moved on. Earlier fixes tried
    // glyph allowlists, OSC preservation, and tail-window heuristics, but
    // each failed on a real runner redraw pattern; only user input or
    // lifecycle events can clear the awaiting state.
    const { globals, sockets } = makeBrowserTerminalGlobals();
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
      globals,
    );
    const session = {
      id: "session-defensive",
      runner: "claude" as const,
      promptLabel: "Defensive test",
      projectPath: "/tmp/example",
      cwd: "/tmp/example",
      targetPath: "/tmp/example",
      startTime: Date.now(),
      lastInputTime: Date.now(),
      connected: false,
      ended: false,
      awaitingInput: false,
      outputTail: "",
      loadingPhase: "ready",
      loadingShowSlowHint: false,
      loadingShowRetry: false,
      age: "",
      presetId: null,
    };
    const ctx = makeContext({
      activeSessionId: "session-defensive",
      sessions: [session],
      _terminalRefs: { "session-defensive": {} },
    });
    helpers.dashboardConnectTerminal(
      ctx,
      "session-defensive",
      "/ws/terminal/session-defensive",
    );
    const socket = sockets[0];
    assert.ok(socket);
    socket.onopen?.();

    // 1. Prompt chunk arrives. Heuristic fires → reveal timer scheduled.
    socket.onmessage?.({
      data: JSON.stringify({
        type: "output",
        data:
          "Do you want to proceed?\n❯ 1. Yes\n  2. No\n\n" +
          "Esc to cancel · Tab to amend · ctrl+e to explain",
      }),
    });
    assert.equal(session.awaitingInput, false, "badge waits for reveal delay");

    // 2. Send 8 chunks of UNKNOWN glyph nobody added to the classifier yet.
    //    These are non-empty (chunkHasText=true), don't match any positive
    //    pattern, and aren't in the spinner-glyph class. Old behavior:
    //    every one of these would call dashboardClearAwaitingInputTimer.
    //    New behavior: tail still has prompt in last 1500 chars, so no clear.
    for (let i = 0; i < 8; i += 1) {
      socket.onmessage?.({
        data: JSON.stringify({
          type: "output",
          // A made-up "future" runner spinner glyph not in our class.
          data: "\r\x1b[2m⚡\x1b[0m",
        }),
      });
    }

    // 3. Tick past the 1200ms reveal delay. The timer survived.
    timers.tick(1500);
    assert.equal(
      session.awaitingInput,
      true,
      "badge fires after reveal delay despite unknown glyph chunks",
    );

    // 4. More unknown chunks after badge is showing. State must persist.
    for (let i = 0; i < 4; i += 1) {
      socket.onmessage?.({
        data: JSON.stringify({
          type: "output",
          data: "\r\x1b[2m⚡\x1b[0m",
        }),
      });
    }
    assert.equal(
      session.awaitingInput,
      true,
      "badge stays on through more unknown chunks",
    );
  });

  /*
   * Fixture covers the ANSI-heavy prompt-tail regression where the visible
   * question can disappear from a too-short raw tail window.
   */
  it("keeps the badge on across unknown chunks for ANSI-heavy prompt tails", () => {
    // Gemini/Copilot captured prompts contain enough ANSI and box drawing
    // bytes that raw tail.slice(-1500) can miss the visible prompt. R4's
    // visible-tail check uses a 3000-byte raw slice (~1500 plain chars
    // post-stripping for ANSI-heavy runners) so both body content AND OSC
    // titles survive into the matcher.
    const { globals, sockets } = makeBrowserTerminalGlobals();
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
      globals,
    );
    const session = {
      id: "session-ansi-heavy",
      runner: "antigravity" as const,
      promptLabel: "ANSI-heavy test",
      projectPath: "/tmp/example",
      cwd: "/tmp/example",
      targetPath: "/tmp/example",
      startTime: Date.now(),
      lastInputTime: Date.now(),
      connected: false,
      ended: false,
      awaitingInput: false,
      outputTail: "",
      loadingPhase: "ready",
      loadingShowSlowHint: false,
      loadingShowRetry: false,
      age: "",
      presetId: null,
    };
    const ctx = makeContext({
      activeSessionId: "session-ansi-heavy",
      sessions: [session],
      _terminalRefs: { "session-ansi-heavy": {} },
    });
    helpers.dashboardConnectTerminal(
      ctx,
      "session-ansi-heavy",
      "/ws/terminal/session-ansi-heavy",
    );
    const socket = sockets[0];
    assert.ok(socket);
    socket.onopen?.();

    socket.onmessage?.({
      data: JSON.stringify({
        type: "output",
        // Fixture purpose: Gemini's ANSI-heavy prompt previously pushed the
        // visible question outside the raw 1500-byte tail window.
        data: loadFixture("gemini-startup.txt"),
      }),
    });
    assert.equal(session.awaitingInput, false, "badge waits for reveal delay");

    socket.onmessage?.({
      data: JSON.stringify({
        type: "output",
        data: "\r\x1b[2m⚡\x1b[0m",
      }),
    });
    timers.tick(1500);
    assert.equal(
      session.awaitingInput,
      true,
      "badge fires when the normalized visible tail still shows the prompt",
    );
  });

  it("keeps the badge on for Codex's sustained-CUP idle state held by OSC title alone", () => {
    // Round-5 finding (browser-extension live trace): in a long-running Codex
    // session in steady-state waiting, CUP positioning escapes fill the tail
    // so the visible plain-text content is ~100 chars - the question phrase
    // and numbered choices are NOT in the window. The signal that holds the
    // badge is Codex's window-title broadcast `[ ! ] Action Required`. The
    // R4 tail check MUST pass raw bytes so the OSC title is extracted by
    // `dashboardTerminalTitlesFromOutput` before normalization. A
    // normalize-first slice would strip the OSC entirely and clear the badge
    // on the next spinner chunk.
    const { globals, sockets } = makeBrowserTerminalGlobals();
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
      globals,
    );
    const session = {
      id: "session-codex-sustained",
      runner: "codex" as const,
      promptLabel: "Codex sustained CUP test",
      projectPath: "/tmp/example",
      cwd: "/tmp/example",
      targetPath: "/tmp/example",
      startTime: Date.now(),
      lastInputTime: Date.now(),
      connected: false,
      ended: false,
      awaitingInput: false,
      outputTail: "",
      loadingPhase: "ready",
      loadingShowSlowHint: false,
      loadingShowRetry: false,
      age: "",
      presetId: null,
    };
    const ctx = makeContext({
      activeSessionId: "session-codex-sustained",
      sessions: [session],
      _terminalRefs: { "session-codex-sustained": {} },
    });
    helpers.dashboardConnectTerminal(
      ctx,
      "session-codex-sustained",
      "/ws/terminal/session-codex-sustained",
    );
    const socket = sockets[0];
    assert.ok(socket);
    socket.onopen?.();

    // Sustained CUP redraw (~4400 bytes of cursor positioning) wrapping an
    // OSC title broadcast that signals attention.
    const cupNoise = Array(400)
      .fill("\x1b[5;1H\x1b[2K \x1b[6;1H\x1b[2K ")
      .join("");
    socket.onmessage?.({
      data: JSON.stringify({
        type: "output",
        data:
          cupNoise.slice(0, 2200) +
          "\x1b]0;[ ! ] Action Required | goat-flow\x07" +
          cupNoise.slice(0, 2200),
      }),
    });
    timers.tick(1500);
    assert.equal(
      session.awaitingInput,
      true,
      "Codex badge fires via OSC title even when plain-text content is mostly empty",
    );

    // Next chunk is an unknown spinner glyph - badge must stay on because
    // the OSC title is still in the raw tail window.
    socket.onmessage?.({
      data: JSON.stringify({ type: "output", data: "\r\x1b[2m⚡\x1b[0m" }),
    });
    assert.equal(
      session.awaitingInput,
      true,
      "Codex badge survives unknown spinner chunk because OSC title is still in raw tail",
    );
  });

  it("badge persists across arbitrary output volume - only user input clears", () => {
    // Regression guard: output chunks can never clear the awaiting badge.
    // Five rounds of trying to classify chunks (glyph allowlists, tail-end
    // heuristics, OSC-title preservation) failed because runners emit
    // continuous spinner/redraw cycles that vary by version and accumulate
    // over time, eventually pushing the prompt out of any bounded tail
    // window. The badge is now cleared only by signals that unambiguously
    // mean "user moved on": term.onData, sendToTerminalSession, lifecycle.
    const { globals, sockets } = makeBrowserTerminalGlobals();
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
      globals,
    );
    const session = {
      id: "session-persist",
      runner: "claude" as const,
      promptLabel: "Persistence test",
      projectPath: "/tmp/example",
      cwd: "/tmp/example",
      targetPath: "/tmp/example",
      startTime: Date.now(),
      lastInputTime: Date.now(),
      connected: false,
      ended: false,
      awaitingInput: false,
      outputTail: "",
      loadingPhase: "ready",
      loadingShowSlowHint: false,
      loadingShowRetry: false,
      age: "",
      presetId: null,
    };
    const ctx = makeContext({
      activeSessionId: "session-persist",
      sessions: [session],
      _terminalRefs: { "session-persist": {} },
    });
    helpers.dashboardConnectTerminal(
      ctx,
      "session-persist",
      "/ws/terminal/session-persist",
    );
    const socket = sockets[0];
    assert.ok(socket);
    socket.onopen?.();
    // Prompt arrives and the reveal timer fires.
    socket.onmessage?.({
      data: JSON.stringify({
        type: "output",
        data:
          "Do you want to proceed?\n❯ 1. Yes\n  2. No\n\n" +
          "Esc to cancel · Tab to amend · ctrl+e to explain",
      }),
    });
    timers.tick(1500);
    assert.equal(session.awaitingInput, true);

    // A LARGE block of output arrives - under the round-6 contract this
    // must NOT clear the badge. Pre-round-6, this output would push the
    // prompt out of the visible tail window and the badge would clear.
    const bigOutput = "Tool output line " + "x".repeat(8000);
    socket.onmessage?.({
      data: JSON.stringify({ type: "output", data: bigOutput }),
    });
    assert.equal(
      session.awaitingInput,
      true,
      "badge must persist across large output - only user input or lifecycle clears",
    );

    // Many spinner cycles accumulate.
    const spinnerOn =
      "\r\x1b[25A\x1b[38;5;246m●\x1b[39m\r" +
      "\r\n".repeat(25) +
      "\x1b[1C\x1b[4A\x1b[1D\x1b[4B";
    for (let i = 0; i < 100; i += 1) {
      socket.onmessage?.({
        data: JSON.stringify({ type: "output", data: spinnerOn }),
      });
    }
    assert.equal(
      session.awaitingInput,
      true,
      "badge survives 100 spinner cycles (~9000 accumulated bytes)",
    );
  });

  it("badge clears when the user types in the dashboard xterm (term.onData)", () => {
    // User input is the authoritative clear signal; term.onData fires for
    // any keystroke routed through the xterm widget.
    const { globals, sockets } = makeBrowserTerminalGlobals();
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
      globals,
    );
    const session = {
      id: "session-userinput",
      runner: "claude" as const,
      promptLabel: "User-input test",
      projectPath: "/tmp/example",
      cwd: "/tmp/example",
      targetPath: "/tmp/example",
      startTime: Date.now(),
      lastInputTime: Date.now(),
      connected: false,
      ended: false,
      awaitingInput: false,
      outputTail: "",
      loadingPhase: "ready",
      loadingShowSlowHint: false,
      loadingShowRetry: false,
      age: "",
      presetId: null,
    };
    const ctx = makeContext({
      activeSessionId: "session-userinput",
      sessions: [session],
      _terminalRefs: { "session-userinput": {} },
    });
    helpers.dashboardConnectTerminal(
      ctx,
      "session-userinput",
      "/ws/terminal/session-userinput",
    );
    const socket = sockets[0];
    assert.ok(socket);
    socket.onopen?.();
    socket.onmessage?.({
      data: JSON.stringify({
        type: "output",
        data:
          "Do you want to proceed?\n❯ 1. Yes\n  2. No\n\n" +
          "Esc to cancel · Tab to amend · ctrl+e to explain",
      }),
    });
    timers.tick(1500);
    assert.equal(session.awaitingInput, true);

    // User answers via xterm. dashboardSendToTerminalSession is the dashboard
    // path that simulates the same effect as term.onData - both clear the
    // badge by directly mutating session.awaitingInput.
    const sent = helpers.dashboardSendToTerminalSession(
      ctx,
      "session-userinput",
      "1",
      { adapt: false },
    );
    assert.equal(sent, true);
    assert.equal(
      session.awaitingInput,
      false,
      "badge clears immediately when user input is sent through the dashboard",
    );
  });

  it("clearing one session's badge does not affect another session", () => {
    // Multi-session independence: each LocalSession.awaitingInput is a
    // per-session field, mutations target a specific session id, and clears
    // from one session's input must NOT touch any other session's state.
    const { globals, sockets } = makeBrowserTerminalGlobals();
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
      globals,
    );
    /**
     * Builds sessions that differ only by id/runner so the test isolates
     * per-session awaitingInput mutation.
     */
    function makeAwaitingSession(id: string, runner: "claude" | "codex") {
      return {
        id,
        runner,
        promptLabel: `${id} test`,
        projectPath: "/tmp/example",
        cwd: "/tmp/example",
        targetPath: "/tmp/example",
        startTime: Date.now(),
        lastInputTime: Date.now(),
        connected: false,
        ended: false,
        awaitingInput: false,
        outputTail: "",
        loadingPhase: "ready",
        loadingShowSlowHint: false,
        loadingShowRetry: false,
        age: "",
        presetId: null,
      };
    }
    const sA = makeAwaitingSession("multi-a", "claude");
    const sB = makeAwaitingSession("multi-b", "codex");
    const sC = makeAwaitingSession("multi-c", "claude");
    const ctx = makeContext({
      activeSessionId: "multi-a",
      sessions: [sA, sB, sC],
      _terminalRefs: {
        "multi-a": {},
        "multi-b": {},
        "multi-c": {},
      },
    });
    for (const id of ["multi-a", "multi-b", "multi-c"]) {
      helpers.dashboardConnectTerminal(ctx, id, `/ws/terminal/${id}`);
    }
    const [skA, skB, skC] = sockets;
    [skA, skB, skC].forEach((s) => s?.onopen?.());

    // Each session receives a prompt and the reveal fires.
    for (const sock of [skA, skB, skC]) {
      sock?.onmessage?.({
        data: JSON.stringify({
          type: "output",
          data:
            "Do you want to proceed?\n❯ 1. Yes\n  2. No\n\n" +
            "Esc to cancel · Tab to amend · ctrl+e to explain",
        }),
      });
    }
    timers.tick(1500);
    assert.equal(sA.awaitingInput, true, "A fires");
    assert.equal(sB.awaitingInput, true, "B fires");
    assert.equal(sC.awaitingInput, true, "C fires");

    // Clear only session B's badge by sending input there.
    const ok = helpers.dashboardSendToTerminalSession(ctx, "multi-b", "1", {
      adapt: false,
    });
    assert.equal(ok, true);
    assert.equal(sB.awaitingInput, false, "B cleared by its own input");
    assert.equal(sA.awaitingInput, true, "A unaffected by B's input");
    assert.equal(sC.awaitingInput, true, "C unaffected by B's input");
  });

  it("session exit message clears the awaitingInput badge", () => {
    // Lifecycle path: when the PTY exits (runner died, user closed it), the
    // badge must clear via the exit-message branch even if no user input
    // arrived first. Pins one of the three input-side clear paths from R6.
    const { globals, sockets } = makeBrowserTerminalGlobals();
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
      globals,
    );
    const session = {
      id: "session-exit",
      runner: "claude" as const,
      promptLabel: "Exit test",
      projectPath: "/tmp/example",
      cwd: "/tmp/example",
      targetPath: "/tmp/example",
      startTime: Date.now(),
      lastInputTime: Date.now(),
      connected: false,
      ended: false,
      awaitingInput: false,
      outputTail: "",
      loadingPhase: "ready",
      loadingShowSlowHint: false,
      loadingShowRetry: false,
      age: "",
      presetId: null,
    };
    const ctx = makeContext({
      activeSessionId: "session-exit",
      sessions: [session],
      _terminalRefs: { "session-exit": {} },
    });
    helpers.dashboardConnectTerminal(
      ctx,
      "session-exit",
      "/ws/terminal/session-exit",
    );
    const socket = sockets[0];
    assert.ok(socket);
    socket.onopen?.();
    socket.onmessage?.({
      data: JSON.stringify({
        type: "output",
        data:
          "Do you want to proceed?\n❯ 1. Yes\n  2. No\n\n" +
          "Esc to cancel · Tab to amend · ctrl+e to explain",
      }),
    });
    timers.tick(1500);
    assert.equal(session.awaitingInput, true);

    // PTY exits before user answers - lifecycle MUST clear the badge,
    // otherwise terminated sessions would render as "Waiting" forever.
    socket.onmessage?.({
      data: JSON.stringify({ type: "exit", code: 0, signal: null }),
    });
    assert.equal(session.ended, true, "exit message marks session ended");
    assert.equal(
      session.awaitingInput,
      false,
      "exit message clears awaitingInput badge",
    );
  });

  it("keeps awaiting state across Codex's lone-bullet spinner frame (◦ U+25E6)", () => {
    // Round-3 live trace (2026-05-21): after the round-2 fix Claude was stable
    // but Codex still flickered. Codex's idle-spinner glyph is `◦` (U+25E6
    // WHITE BULLET), painted via `CUP \x1b[28;1H\x1b[2m` dim. The round-2
    // class `[●✻✢✳✶*•·]` did not include `◦`, so every spinner tick still
    // returned false from `dashboardNextAwaitingInputState` and the badge
    // flickered set→clear within ~100ms on a 2.4s cadence. Also exercised
    // braille spinners (U+2800–U+28FF) used by many other CLIs.
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const prompt =
      "Would you like to run the following command?\n› 1. Yes, proceed\n  2. No, suggest changes\nPress enter to confirm or esc to cancel";
    const codexBullet =
      "\r\x1b[28;1H\x1b[2m\x1b[39;49m◦\x1b[39m\x1b[49m\x1b[0m\x1b[?25l\x1b[?2026l";
    const codexBulletOff =
      "\r\x1b[28;1H\x1b[2m\x1b[39;49m \x1b[39m\x1b[49m\x1b[0m\x1b[?25l\x1b[?2026l";
    const brailleFrame = "\r\x1b[2m⠋\x1b[0m";
    // Sanity: each frame on its own is not awaiting input.
    assert.equal(helpers.dashboardOutputLooksAwaitingInput(codexBullet), false);
    assert.equal(
      helpers.dashboardOutputLooksAwaitingInput(brailleFrame),
      false,
    );
    // The Codex bullet, the off frame, and the braille tick must all KEEP
    // the awaiting state when the prompt is still in the tail.
    assert.equal(
      helpers.dashboardNextAwaitingInputState(true, prompt, codexBullet),
      true,
    );
    assert.equal(
      helpers.dashboardNextAwaitingInputState(true, prompt, codexBulletOff),
      true,
    );
    assert.equal(
      helpers.dashboardNextAwaitingInputState(true, prompt, brailleFrame),
      true,
    );
    // 8-tick simulation alternating Codex bullet-on / bullet-off must never
    // knock state down (the actual flicker reproducer).
    let state = true;
    let tail = prompt;
    for (let i = 0; i < 8; i += 1) {
      const chunk = i % 2 === 0 ? codexBullet : codexBulletOff;
      state = helpers.dashboardNextAwaitingInputState(state, tail, chunk);
      tail = (tail + chunk).slice(-5000);
      assert.equal(state, true, `codex tick ${i} cleared the state`);
    }
    // Real Codex status output starting with `◦` followed by text must still
    // clear so the badge drops when the user has answered.
    assert.equal(
      helpers.dashboardNextAwaitingInputState(
        true,
        prompt,
        "◦ Running shell command: ls /tmp",
      ),
      false,
    );
  });

  it("detects freshly launched runner readiness before sending launch prompts", () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );

    assert.equal(
      helpers.dashboardOutputLooksReadyForLaunchPrompt(
        "/remote-control is active · Code in CLI\n\n❯  ",
      ),
      true,
    );
    assert.equal(
      helpers.dashboardOutputLooksReadyForLaunchPrompt(
        [
          "Claude Code v2.1.138",
          "/remote-control is active · Code in CLI",
          "────────────────────────────────",
          "? for shortcuts     ● high · /effort",
        ].join("\n"),
      ),
      true,
    );
    assert.equal(
      helpers.dashboardOutputLooksReadyForLaunchPrompt(
        "/remote-control is active · Code in CLI\nloading project...",
      ),
      false,
    );
  });

  it("does not treat a Codex config failure followed by a shell prompt as runner readiness", () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const output = [
      "Error loading configuration: filesystem glob path `**/*.key` only supports `none` access; use an exact path or trailing `/**` for `none` subtree access",
      "$ ",
    ].join("\n");

    assert.equal(
      helpers.dashboardOutputLooksRunnerStartupFailure(output, "codex"),
      true,
    );
    assert.equal(
      helpers.dashboardOutputLooksReadyForLaunchPrompt(output, "codex"),
      false,
    );
  });

  it("detects Antigravity readiness only after the composer appears", () => {
    // Verified live against `agy` 1.0.1 (2026-05-24 browser-use smoke):
    // - Pre-composer auth output (no `Antigravity CLI <version>` identity row
    //   yet OR no `? for shortcuts` hint) must not fire readiness.
    // - The full composer-ready signature (identity row + composer hint) must.
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );

    assert.equal(
      helpers.dashboardOutputLooksReadyForLaunchPrompt(
        [
          "Welcome to the Antigravity CLI. You are currently not signed in.",
          "Signing in...",
        ].join("\n"),
        "antigravity",
      ),
      false,
    );
    assert.equal(
      helpers.dashboardOutputLooksReadyForLaunchPrompt(
        [
          "Antigravity CLI 1.0.1",
          "thatmatthansen@gmail.com (Google AI Pro)",
          "Gemini 3.5 Flash (High)",
          "~/projects/goat-flow",
          "────────────────────────────────────────",
          ">",
          "────────────────────────────────────────",
          "? for shortcuts            Gemini 3.5 Flash (High)",
        ].join("\n"),
        "antigravity",
      ),
      true,
    );
  });

  it("detects Antigravity readiness from a real captured `agy` startup", () => {
    // Fixture captured 2026-05-24 by spawning `agy` through node-pty (see
    // scripts/capture-agy.mjs in the M04 milestone log). The raw bytes include
    // ANSI escapes, the Antigravity logo, "Antigravity CLI 1.0.1" identity
    // row, and the `? for shortcuts` composer hint - exactly the two anchors
    // the readiness regex relies on.
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const bytes = loadFixture("antigravity-startup.txt");
    assert.equal(
      helpers.dashboardOutputLooksReadyForLaunchPrompt(bytes, "antigravity"),
      true,
    );
  });

  it("does NOT fire Antigravity readiness on running output from another runner", () => {
    // Negative regression: the Antigravity-specific readiness regex must not
    // match a runner-busy capture from a different runner (Gemini fixture
    // retained for parser regression coverage). The `Antigravity CLI` anchor
    // is unique to `agy`, so cross-runner captures cannot trigger.
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const bytes = loadFixture("gemini-running.txt");
    assert.equal(
      helpers.dashboardOutputLooksReadyForLaunchPrompt(bytes, "antigravity"),
      false,
    );
  });

  it("does NOT fire Antigravity readiness on pre-composer auth output", () => {
    // The "signing in" spinner state must not be treated as ready - the
    // `Antigravity CLI <version>` identity row only appears AFTER auth.
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const preComposer = [
      "Welcome to the Antigravity CLI. You are currently not signed in.",
      "Signing in...",
    ].join("\n");
    assert.equal(
      helpers.dashboardOutputLooksReadyForLaunchPrompt(
        preComposer,
        "antigravity",
      ),
      false,
    );
  });

  it("sends launch prompts immediately when runner readiness is already visible", async () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const ctx = makeLaunchPromptContext();
    const session = ctx.sessions[0] as Record<string, unknown>;
    session.outputTail = [
      "Claude Code v2.1.138",
      "/remote-control is active · Code in CLI",
      "────────────────────────────────",
      "? for shortcuts     ● high · /effort",
    ].join("\n");

    helpers.dashboardScheduleLaunchPrompt(ctx, "launch-session", "run prompt");

    assert.deepStrictEqual(JSON.parse(ctx.sent[0] ?? "{}"), {
      type: "input",
      data: "\x1b[200~run prompt\x1b[201~",
    });
    helpers.dashboardHandlePasteSubmitOutput(
      ctx,
      "launch-session",
      "[Pasted text #1 +1 lines]",
    );
    await delay(1220);
    assert.deepStrictEqual(JSON.parse(ctx.sent[1] ?? "{}"), {
      type: "input",
      data: "\r",
    });
    assert.equal(ctx._terminalRefs["launch-session"]?.launchPrompt, undefined);
    assert.equal(
      ctx._terminalRefs["launch-session"]?.launchPromptFallbackTimer,
      undefined,
    );
  });

  it("keeps Antigravity launch prompts queued through auth output until the composer is ready", () => {
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
    );
    const ctx = makeLaunchPromptContext();
    const session = ctx.sessions[0] as Record<string, unknown>;
    session.runner = "antigravity";

    helpers.dashboardScheduleLaunchPrompt(
      ctx,
      "launch-session",
      "run prompt\nsecond line",
    );

    timers.tick(6000);
    assert.deepStrictEqual(ctx.sent, []);
    assert.equal(
      ctx._terminalRefs["launch-session"]?.launchPrompt,
      "run prompt\nsecond line",
    );

    session.outputTail = [
      "Welcome to the Antigravity CLI. You are currently not signed in.",
      "Signing in...",
    ].join("\n");
    helpers.dashboardHandleLaunchPromptOutput(ctx, "launch-session");
    timers.tick(2500);

    assert.deepStrictEqual(ctx.sent, []);
    assert.equal(
      ctx._terminalRefs["launch-session"]?.launchPrompt,
      "run prompt\nsecond line",
    );

    session.outputTail = `${session.outputTail}\nAntigravity CLI 1.0.1\nthatmatthansen@gmail.com\n? for shortcuts`;
    helpers.dashboardHandleLaunchPromptOutput(ctx, "launch-session");

    assert.deepStrictEqual(JSON.parse(ctx.sent[0] ?? "{}"), {
      type: "input",
      data: "\x1b[200~run prompt\nsecond line\x1b[201~",
    });
    assert.equal(ctx.sent.length, 1);

    helpers.dashboardHandlePasteSubmitOutput(
      ctx,
      "launch-session",
      "[Pasted Text: 2 lines]",
    );

    assert.equal(ctx.sent.length, 1);
    timers.tick(helpers.TERMINAL_PASTE_MARKER_SETTLE_DELAY_MS);

    assert.deepStrictEqual(JSON.parse(ctx.sent[1] ?? "{}"), {
      type: "input",
      data: "\r",
    });
    assert.equal(ctx._terminalRefs["launch-session"]?.launchPrompt, undefined);
  });

  it("clears queued launch prompts when Codex fails before prompt delivery", () => {
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
    );
    const ctx = makeLaunchPromptContext();
    const session = ctx.sessions[0] as Record<string, unknown>;
    session.runner = "codex";

    helpers.dashboardScheduleLaunchPrompt(ctx, "launch-session", "run prompt");
    session.outputTail = [
      "Error loading configuration: filesystem glob path `**/*.key` only supports `none` access; use an exact path or trailing `/**` for `none` subtree access",
      "$ ",
    ].join("\n");
    helpers.dashboardHandleLaunchPromptOutput(ctx, "launch-session");
    timers.tick(7000);

    assert.deepStrictEqual(ctx.sent, []);
    assert.equal(ctx._terminalRefs["launch-session"]?.launchPrompt, undefined);
    assert.equal(session.loadingPhase, "error");
    assert.equal(
      session.loadingError,
      "Runner failed before prompt delivery. Check the terminal output above. Error loading configuration: filesystem glob path `**/*.key` only supports `none` access; use an exact path or trailing `/**` for `none` subtree access",
    );
  });

  it("extracts the Codex config-error detail from the runner output tail", () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const tail = [
      "OpenAI Codex v0.131.0",
      "Error loading configuration: filesystem glob path `**/*.key` only supports `none` access; use an exact path or trailing `/**` for `none` subtree access",
      "$ ",
    ].join("\n");

    assert.equal(
      helpers.dashboardExtractRunnerStartupError(tail),
      "Error loading configuration: filesystem glob path `**/*.key` only supports `none` access; use an exact path or trailing `/**` for `none` subtree access",
    );
    assert.equal(
      helpers.dashboardRunnerStartupFailureMessage(tail),
      "Runner failed before prompt delivery. Check the terminal output above. Error loading configuration: filesystem glob path `**/*.key` only supports `none` access; use an exact path or trailing `/**` for `none` subtree access",
    );
  });

  it("falls back to the generic runner-startup message when no error pattern is captured", () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    assert.equal(helpers.dashboardExtractRunnerStartupError("$ "), null);
    assert.equal(
      helpers.dashboardRunnerStartupFailureMessage("$ "),
      "Runner failed before prompt delivery. Check the terminal output above.",
    );
  });

  it("truncates very long captured runner-startup errors to keep the banner readable", () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const longDetail = "Error loading configuration: " + "x".repeat(500);
    const detail = helpers.dashboardExtractRunnerStartupError(longDetail);
    assert.ok(detail !== null);
    assert.ok(detail!.length <= 303);
    assert.ok(detail!.endsWith("..."));
  });

  it("detects the compact Claude composer footer as runner readiness", () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );

    assert.equal(
      helpers.dashboardOutputLooksReadyForLaunchPrompt(
        "Claude Code v2.1.138\n/remote-control is active\n?forshortcuts●high·/effort",
      ),
      true,
    );
  });

  it("sends launch prompts after output stays quiet and resets quiet timing per chunk", async () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const ctx = makeLaunchPromptContext();
    const session = ctx.sessions[0] as Record<string, unknown>;

    helpers.dashboardScheduleLaunchPrompt(ctx, "launch-session", "run prompt");
    await delay(120);

    assert.deepStrictEqual(ctx.sent, []);

    session.outputTail = "runner banner\n";
    helpers.dashboardHandleLaunchPromptOutput(ctx, "launch-session");
    await delay(300);
    session.outputTail = String(session.outputTail) + "still loading\n";
    helpers.dashboardHandleLaunchPromptOutput(ctx, "launch-session");
    await delay(300);

    assert.deepStrictEqual(ctx.sent, []);

    await delay(260);
    assert.deepStrictEqual(JSON.parse(ctx.sent[0] ?? "{}"), {
      type: "input",
      data: "\x1b[200~run prompt\x1b[201~",
    });
    helpers.dashboardHandlePasteSubmitOutput(
      ctx,
      "launch-session",
      "[Pasted text #1 +1 lines]",
    );
    await delay(1220);
    assert.deepStrictEqual(JSON.parse(ctx.sent[1] ?? "{}"), {
      type: "input",
      data: "\r",
    });
    assert.equal(ctx.sent.length, 2);
    assert.equal(ctx._terminalRefs["launch-session"]?.launchPrompt, undefined);
    assert.equal(
      ctx._terminalRefs["launch-session"]?.launchPromptQuietTimer,
      undefined,
    );
    assert.equal(
      ctx._terminalRefs["launch-session"]?.launchPromptFallbackTimer,
      undefined,
    );
  });

  it("keeps the after-output fallback capped from the first output chunk", async () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const ctx = makeLaunchPromptContext();
    const session = ctx.sessions[0] as Record<string, unknown>;

    helpers.dashboardScheduleLaunchPrompt(ctx, "launch-session", "run prompt");
    await delay(120);

    for (let index = 0; index < 6; index += 1) {
      session.outputTail = `${String(session.outputTail)}loading ${index}\n`;
      helpers.dashboardHandleLaunchPromptOutput(ctx, "launch-session");
      await delay(320);
    }
    await delay(220);

    assert.deepStrictEqual(JSON.parse(ctx.sent[0] ?? "{}"), {
      type: "input",
      data: "\x1b[200~run prompt\x1b[201~",
    });
    helpers.dashboardHandlePasteSubmitOutput(
      ctx,
      "launch-session",
      "paste again to expand",
    );
    await delay(1220);
    assert.deepStrictEqual(JSON.parse(ctx.sent[1] ?? "{}"), {
      type: "input",
      data: "\r",
    });
    assert.equal(ctx.sent.length, 2);
    assert.equal(ctx._terminalRefs["launch-session"]?.launchPrompt, undefined);
  });

  it("debounces the visible awaiting-input badge", () => {
    const source = readFileSync(DASHBOARD_TERMINAL_PATH, "utf-8");
    assert.match(source, /const AWAITING_INPUT_VISIBLE_DELAY_MS = 1200/);
    assert.match(
      source,
      /dashboardScheduleAwaitingInputReveal\(ctx, sessionId, session\)/,
    );
    assert.match(source, /dashboardClearAwaitingInputTimer\(ctx, sessionId\)/);
    assert.doesNotMatch(source, /target\.awaitingInput = awaitingInput/);
  });

  it("maps awaiting-input sessions into the workspace waiting state", () => {
    const source = readFileSync(WORKSPACE_VIEW_PATH, "utf-8");
    assert.match(source, /awaitingInput: s\.awaitingInput === true/);
    assert.match(source, /waitingForRunner: s\.connected === true/);
    assert.match(source, /return s\.awaitingInput === true \|\|/);
    assert.match(source, /s\.waitingForRunner === true/);
    assert.match(
      source,
      /this\.allSessions\(\)\.filter\(s => this\.sessionIsWaiting\(s\)\)/,
    );
  });

  it("keeps detached live sessions out of recent history", () => {
    const source = readFileSync(WORKSPACE_VIEW_PATH, "utf-8");
    assert.match(
      source,
      /const inactive = this\.serverSessions\.filter\(s => s\.status !== 'active'\)/,
    );
    assert.match(
      source,
      /const rows = \[\.\.\.this\.recentTerminalSessions, \.\.\.inactive\]/,
    );
    assert.doesNotMatch(
      source,
      /recentSessions\(\)[\s\S]{0,500}localSessionRows/,
    );
  });

  it("excludes waiting sessions from the Workspace running meter", () => {
    const source = readFileSync(WORKSPACE_VIEW_PATH, "utf-8");
    assert.match(source, /runningSessions\(\) \{/);
    assert.match(
      source,
      /s\.status === 'active' && !this\.sessionIsWaiting\(s\)/,
    );
    assert.match(
      source,
      /meterRunning\(\) \{ return this\.runningSessions\(\)\.length; \}/,
    );
  });

  it("wires all four Workspace waiting surfaces to a single awaitingInput field", () => {
    // All Workspace waiting surfaces derive from LocalSession.awaitingInput
    // so the header dot, pill, left-rail style, and meter count cannot drift
    // when the terminal heuristic changes.
    const workspace = readFileSync(WORKSPACE_VIEW_PATH, "utf-8");
    const app = readFileSync(DASHBOARD_APP_PATH, "utf-8");
    // (1) Active terminal header dot reads terminalAwaitingInput (or waiting-for-runner).
    assert.match(
      workspace,
      /:class="\(terminalWaitingForRunner \|\| terminalAwaitingInput\) \? 'gf-status-waiting'/,
    );
    // (2) "Awaiting input" pill is x-show on terminalAwaitingInput.
    assert.match(workspace, /x-show="terminalAwaitingInput"/);
    assert.match(workspace, />Awaiting input</);
    // (3) Left-rail card adds the is-waiting class via sessionIsWaiting(s).
    assert.match(workspace, /'is-waiting': sessionIsWaiting\(s\)/);
    // (4) sessionIsWaiting derives from awaitingInput so the meter, dot, and
    //     left-rail share one source of truth.
    assert.match(
      workspace,
      /sessionIsWaiting\(s\) \{[\s\S]{0,200}s\.awaitingInput === true/,
    );
    // app.ts must define terminalAwaitingInput off the same field.
    assert.match(
      app,
      /get terminalAwaitingInput\(\): boolean \{[\s\S]{0,120}_activeSession\?\.awaitingInput === true/,
    );
    // localSessionRows passes awaitingInput through unchanged so the rail
    // and meters see the same value the header sees.
    assert.match(workspace, /awaitingInput: s\.awaitingInput === true/);
  });

  it("warms xterm when the workspace or setup view opens", () => {
    const source = readFileSync(DASHBOARD_APP_PATH, "utf-8");
    assert.match(
      source,
      /if \(\(v === "workspace" \|\| v === "setup"\) && this\.terminalAvailable\) \{\s+void this\.loadXterm\(\)\.catch\(\(\) => \{\}\);\s+\}/,
    );
  });

  it("shows a visible launching label on the workspace terminal button", () => {
    const source = readFileSync(WORKSPACE_VIEW_PATH, "utf-8");
    assert.match(
      source,
      /x-text="launching \? 'Launching terminal\.\.\.' : 'Open terminal'"/,
    );
  });

  it("keeps manual terminal launch available from the active workspace", () => {
    const source = readFileSync(WORKSPACE_VIEW_PATH, "utf-8");
    assert.match(source, /Open new terminal/);
    assert.match(
      source,
      /x-text="launching \? 'Launching\.\.\.' : 'New terminal'"/,
    );
    assert.match(source, /class="workspace-session-rail"/);
    assert.match(source, /'is-collapsed': sessionsCollapsed/);
  });

  it("keeps the collapsed workspace rail actionable", () => {
    const source = readFileSync(WORKSPACE_VIEW_PATH, "utf-8");
    assert.match(source, /aria-label="New session"/);
    assert.match(source, /:key="'ws-collapsed-' \+ s\.id"/);
    assert.match(source, /@click="openSession\(s\)"/);
    assert.match(source, /:aria-label="'Open ' \+ sessionTitleFor\(s\)"/);
    assert.match(source, /class="workspace-session-dot"/);
    assert.match(source, /:class="'is-' \+ sessionPipTone\(s\)"/);
    assert.match(source, />Expand sessions</);
  });

  it("routes terminal upload notes to the originating session", () => {
    const source = readFileSync(DASHBOARD_APP_PATH, "utf-8");
    assert.match(
      source,
      /dashboardSendToTerminalSession\(this, sessionId, note, \{\s+adapt: false,\s+\}\)/,
    );
  });

  it("defers dashboard launch prompts until after terminal attachment", () => {
    const source = readFileSync(DASHBOARD_TERMINAL_PATH, "utf-8");
    assert.match(
      source,
      /const TERMINAL_LAUNCH_PROMPT_NO_OUTPUT_FALLBACK_DELAY_MS = 6000/,
    );
    assert.match(
      source,
      /const TERMINAL_LAUNCH_PROMPT_AFTER_OUTPUT_FALLBACK_DELAY_MS = 2000/,
    );
    assert.match(source, /const TERMINAL_LAUNCH_PROMPT_QUIET_DELAY_MS = 500/);
    assert.match(source, /const TERMINAL_PASTE_MARKER_SETTLE_DELAY_MS = 300/);
    assert.match(
      source,
      /const TERMINAL_CLAUDE_PASTE_NO_MARKER_FALLBACK_DELAY_MS = 1500/,
    );
    assert.match(
      source,
      /const TERMINAL_PASTE_COMMIT_FALLBACK_DELAY_MS = 15000/,
    );
    assert.match(source, /const TERMINAL_PASTE_SUBMIT_RETRY_CADENCE_MS = 500/);
    assert.match(source, /const TERMINAL_PASTE_SUBMIT_RETRY_DELAY_MS = 300/);
    assert.match(source, /body: JSON\.stringify\(\{\s+prompt: ""/);
    assert.match(
      source,
      /ctx\.connectTerminal\(session\.id, wsUrl\);\s+dashboardScheduleLaunchPrompt\(ctx, session\.id, prompt\)/,
    );
    assert.match(source, /dashboardHandleLaunchPromptOutput\(ctx, sessionId\)/);
  });

  it("only treats image file drag items as terminal upload candidates", () => {
    const source = readFileSync(DASHBOARD_APP_PATH, "utf-8");
    assert.match(
      source,
      /item\.kind === "file" && item\.type\.startsWith\("image\/"\)/,
    );
  });

  it("shows an in-place launching label on the Setup terminal button", () => {
    const source = readFileSync(SETUP_VIEW_PATH, "utf-8");
    assert.match(
      source,
      /x-text="launching \? 'Starting setup\.\.\.' : 'Run Setup in Terminal'"/,
    );
  });

  it("uses agent-specific copy on the Setup prompt generating row", () => {
    const source = readFileSync(SETUP_VIEW_PATH, "utf-8");
    assert.match(
      source,
      /x-text="'Generating setup prompt for ' \+ agentName\(setupSelectedAgent\) \+ '\.\.\.'"/,
    );
  });

  it("exposes terminalWaitingForRunner so Workspace can show inline progress", () => {
    const source = readFileSync(DASHBOARD_APP_PATH, "utf-8");
    assert.match(source, /get terminalWaitingForRunner\(\): boolean/);
    assert.match(
      source,
      /if \(!session\.connected \|\| session\.ended\) return false/,
    );
    assert.match(source, /if \(session\.awaitingInput\) return false/);
    assert.match(
      source,
      /session\.loadingPhase === "ready" \|\| session\.loadingPhase === "error"/,
    );
    assert.match(source, /return tail\.length === 0/);
    assert.match(source, /get terminalDetached\(\): boolean/);
    assert.match(source, /s\.id === session\.id && s\.status === "active"/);
    assert.match(
      source,
      /s\.id === id && s\.ended !== true && s\.connected === true/,
    );
  });

  it("renders the Waiting-for-runner badge in the workspace header", () => {
    const source = readFileSync(WORKSPACE_VIEW_PATH, "utf-8");
    assert.match(source, /x-show="terminalWaitingForRunner"/);
    assert.match(source, /Waiting for runner\.\.\./);
    assert.match(
      source,
      /\(terminalWaitingForRunner \|\| terminalAwaitingInput\) \? 'gf-status-waiting'/,
    );
  });

  it("renders a terminal loading overlay inside each session shell", () => {
    const workspace = readFileSync(WORKSPACE_VIEW_PATH, "utf-8");
    const styles = readFileSync(
      resolve(PROJECT_ROOT, "src", "dashboard", "styles.css"),
      "utf-8",
    );
    assert.match(workspace, /class="terminal-session-shell"/);
    assert.match(workspace, /class="terminal-loading-overlay"/);
    assert.match(workspace, /terminalDetached \|\| terminalEnded/);
    assert.match(workspace, /Session detached/);
    assert.match(
      workspace,
      /x-show="!session\.ended && session\.loadingPhase !== 'ready'"/,
    );
    assert.match(workspace, /terminalLoadingMessage\(session\)/);
    assert.match(workspace, /retryTerminalSession\(session\.id\)/);
    assert.match(styles, /\.terminal-loading-overlay/);
    assert.match(styles, /@keyframes terminal-loading-spinner/);
  });
});
