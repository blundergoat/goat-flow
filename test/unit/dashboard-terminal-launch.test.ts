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
      pasteSubmitQueue?: Array<{ data: string; delayed: boolean }>;
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
  adaptPrompt(prompt: string, runner?: string): string;
  showToast(msg: string, isError?: boolean): void;
  displayNameFor(path: string): string;
  _forgetSavedSession(sessionId: string): void;
  loadXterm(): Promise<void>;
  connectTerminal(sessionId: string, wsUrl: string): void;
  updateSessionCount(): Promise<void>;
  launchInTerminal(
    prompt: string,
    runner?: string,
    options?: LaunchOptions,
  ): Promise<void>;
  rememberSessionTitle(
    sessionId: string,
    title: string | null | undefined,
  ): void;
  rememberRecentSession(session: Record<string, unknown>): void;
  sessionTitleFor(session: Record<string, unknown> | null): string;
  $nextTick(): Promise<void>;
};

type HelperContext = {
  dashboardSendToTerminalSession(
    ctx: LaunchContext,
    sessionId: string,
    text: string,
    options?: { adapt?: boolean },
  ): boolean;
  dashboardLaunchInTerminal(
    ctx: LaunchContext,
    prompt: string,
    runner?: string,
    options?: LaunchOptions,
  ): Promise<void>;
  dashboardConnectTerminal(
    ctx: LaunchContext,
    sessionId: string,
    wsUrl: string,
  ): void;
  dashboardOpenServerSession(
    ctx: LaunchContext,
    serverSession: Record<string, unknown>,
  ): Promise<void>;
  dashboardEndSession(ctx: LaunchContext, sessionId: string): void;
  dashboardOutputLooksAwaitingInput(text: string): boolean;
  dashboardOutputLooksReadyForLaunchPrompt(
    text: string,
    runner?: string,
  ): boolean;
  dashboardOutputLooksRunnerStartupFailure(
    text: string,
    runner?: string,
  ): boolean;
  dashboardExtractRunnerStartupError(text: string): string | null;
  dashboardRunnerStartupFailureMessage(text: string): string;
  dashboardNextAwaitingInputState(
    previousAwaiting: boolean,
    previousTail: string,
    outputChunk: string,
  ): boolean;
  dashboardScheduleLaunchPrompt(
    ctx: LaunchContext,
    sessionId: string,
    prompt: string,
  ): void;
  dashboardHandleLaunchPromptOutput(
    ctx: LaunchContext,
    sessionId: string,
  ): void;
  dashboardHandlePasteSubmitOutput(
    ctx: LaunchContext,
    sessionId: string,
    output: string,
  ): void;
  dashboardClearPasteSubmitState(ctx: LaunchContext, sessionId: string): void;
  dashboardSetTerminalLoadingPhase(
    ctx: LaunchContext,
    sessionId: string,
    fallback: Record<string, unknown>,
    phase: "connecting" | "loading" | "ready" | "error",
    error?: string,
  ): void;
  dashboardArmTerminalLoadingTimers(
    ctx: LaunchContext,
    sessionId: string,
    fallback: Record<string, unknown>,
  ): void;
  dashboardMarkTerminalLoadingReady(
    ctx: LaunchContext,
    sessionId: string,
    fallback: Record<string, unknown>,
    previousTail: string,
    output: string,
  ): void;
  dashboardRetryTerminalSession(
    ctx: LaunchContext,
    sessionId: string,
  ): Promise<void>;
  dashboardUpdateSessionCount(ctx: LaunchContext): Promise<void>;
};

type TimerControls = {
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
};

function loadHelpers(
  fetchImpl: typeof fetch,
  timers: TimerControls = { setTimeout, clearTimeout },
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
    setInterval,
    clearInterval,
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
    adaptPrompt(prompt: string): string {
      return prompt;
    },
    displayNameFor(path: string): string {
      return path.split("/").filter(Boolean).pop() || path;
    },
    _forgetSavedSession(): void {
      return;
    },
    async loadXterm(): Promise<void> {
      return;
    },
    connectTerminal(): void {
      return;
    },
    async updateSessionCount(): Promise<void> {
      return;
    },
    async launchInTerminal(): Promise<void> {
      return;
    },
    rememberSessionTitle(
      sessionId: string,
      title: string | null | undefined,
    ): void {
      if (title) this.sessionTitles[sessionId] = title;
    },
    rememberRecentSession(session: Record<string, unknown>): void {
      this.recentTerminalSessions.push(session);
    },
    sessionTitleFor(session: Record<string, unknown> | null): string {
      if (!session) return "Runner session";
      return (
        this.sessionTitles[String(session.id)] ||
        (typeof session.promptLabel === "string" ? session.promptLabel : "") ||
        "claude session"
      );
    },
    async $nextTick(): Promise<void> {
      return;
    },
    showToast(msg: string, isError = false): void {
      toasts.push({ msg, isError });
    },
    ...overrides,
    toasts,
  };
  return ctx;
}

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
        ws: {
          readyState: 1,
          send(payload: string): void {
            sent.push(payload);
          },
        },
      },
    },
  });
  return Object.assign(ctx, { sent });
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function createFakeTimers(): TimerControls & {
  tick(ms: number): void;
  pending(): number;
} {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();
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
  const fakeClearTimeout = ((handle?: ReturnType<typeof setTimeout>) => {
    timers.delete(Number(handle));
  }) as typeof clearTimeout;
  return {
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
    tick(ms: number): void {
      const target = now + ms;
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, timer] = due;
        timers.delete(id);
        now = timer.at;
        timer.callback();
      }
      now = target;
    },
    pending(): number {
      return timers.size;
    },
  };
}

class FakeTerminal {
  cols = 80;
  rows = 24;
  _addonFit?: FakeFitAddon;
  written: string[] = [];

  loadAddon(addon: FakeFitAddon): void {
    this._addonFit = addon;
  }

  open(): void {
    return;
  }

  write(data: string): void {
    this.written.push(data);
  }

  focus(): void {
    return;
  }

  dispose(): void {
    return;
  }

  attachCustomKeyEventHandler(): void {
    return;
  }

  onData(): void {
    return;
  }

  onResize(): void {
    return;
  }

  hasSelection(): boolean {
    return false;
  }

  getSelection(): string {
    return "";
  }

  buffer = {
    active: {
      length: 0,
      getLine(): null {
        return null;
      },
    },
  };
}

class FakeFitAddon {
  fit(): void {
    return;
  }
}

class FakeResizeObserver {
  observe(): void {
    return;
  }

  disconnect(): void {
    return;
  }
}

class FakeDashboardWebSocket {
  static OPEN = 1;
  readyState = 1;
  sent: string[] = [];
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  onerror?: () => void;

  constructor(
    public readonly url: string,
    public readonly instances: FakeDashboardWebSocket[],
  ) {
    instances.push(this);
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }
}

function makeBrowserTerminalGlobals(): {
  globals: Record<string, unknown>;
  sockets: FakeDashboardWebSocket[];
} {
  const sockets: FakeDashboardWebSocket[] = [];
  const WebSocketCtor = class extends FakeDashboardWebSocket {
    constructor(url: string) {
      super(url, sockets);
    }
  };
  return {
    sockets,
    globals: {
      window: {
        Terminal: FakeTerminal,
        FitAddon: { FitAddon: FakeFitAddon },
        addEventListener(): void {
          return;
        },
        removeEventListener(): void {
          return;
        },
      },
      document: {
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
          ws: {
            readyState: 1,
            send(payload: string): void {
              sent.upload.push(payload);
            },
          },
        },
        "session-active": {
          ws: {
            readyState: 1,
            send(payload: string): void {
              sent.active.push(payload);
            },
          },
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
          ws: {
            readyState: 1,
            send(payload: string): void {
              sent.push(payload);
            },
          },
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
          ws: {
            readyState: 1,
            send(payload: string): void {
              sent.push(payload);
            },
          },
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
          ws: {
            readyState: 1,
            send(payload: string): void {
              sent.push(payload);
            },
          },
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

  it("falls back to submitting pasted terminal text when no paste echo arrives", async () => {
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
          ws: {
            readyState: 1,
            send(payload: string): void {
              sent.push(payload);
            },
          },
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
    timers.tick(15000);
    assert.deepStrictEqual(JSON.parse(sent[1] ?? "{}"), {
      type: "input",
      data: "\r",
    });
    assert.equal(timers.pending(), 1);
    timers.tick(5000);
    assert.equal(timers.pending(), 0);
  });

  it("submits delayed Claude paste when the paste echo arrives after fallback", async () => {
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
          ws: {
            readyState: 1,
            send(payload: string): void {
              sent.push(payload);
            },
          },
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
    timers.tick(15000);
    assert.deepStrictEqual(JSON.parse(sent[1] ?? "{}"), {
      type: "input",
      data: "\r",
    });
    assert.equal(
      ctx._terminalRefs["session-upload"]?.pasteSubmitAwaitingCommit,
      true,
    );

    helpers.dashboardHandlePasteSubmitOutput(
      ctx,
      "session-upload",
      "[Pasted text #1 +2 lines]",
    );
    assert.equal(sent.length, 3);

    assert.deepStrictEqual(JSON.parse(sent[2] ?? "{}"), {
      type: "input",
      data: "\r",
    });
    assert.equal(
      ctx._terminalRefs["session-upload"]?.pasteSubmitAwaitingCommit,
      false,
    );
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
          ws: {
            readyState: 1,
            send(payload: string): void {
              sent.push(payload);
            },
          },
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
    timers.tick(1200);
    assert.deepStrictEqual(JSON.parse(sent[1] ?? "{}"), {
      type: "input",
      data: "\r",
    });
    assert.equal(timers.pending(), 1);

    timers.tick(2500);
    assert.deepStrictEqual(JSON.parse(sent[2] ?? "{}"), {
      type: "input",
      data: "\r",
    });
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
          ws: {
            readyState: 1,
            send(payload: string): void {
              sent.push(payload);
            },
          },
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
          ws: {
            readyState: 1,
            send(payload: string): void {
              sent.push(payload);
            },
          },
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

    assert.equal(sent.length, 2);

    assert.deepStrictEqual(JSON.parse(sent[1] ?? "{}"), {
      type: "input",
      data: "\r",
    });
    assert.equal(timers.pending(), 0);
  });

  it("submits Gemini multiline pasted terminal text after the pasted-text marker", async () => {
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
          runner: "gemini",
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
          ws: {
            readyState: 1,
            send(payload: string): void {
              sent.push(payload);
            },
          },
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

    assert.equal(sent.length, 2);

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
    const ws = {
      readyState: 1,
      send(payload: string): void {
        sent.push(payload);
      },
    };
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
          ws,
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
    ws.readyState = 0;
    timers.tick(15000);
    assert.equal(sent.length, 1);
    assert.equal(timers.pending(), 1);

    ws.readyState = 1;
    timers.tick(300);
    assert.deepStrictEqual(JSON.parse(sent[1] ?? "{}"), {
      type: "input",
      data: "\r",
    });
    assert.equal(timers.pending(), 1);
    timers.tick(5000);
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
          ws: {
            readyState: 1,
            send(payload: string): void {
              sent.push(payload);
            },
          },
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
      async loadXterm(): Promise<void> {
        calls.push("loadXterm");
        await xtermReady;
        calls.push("loadXterm:ready");
      },
      connectTerminal(sessionId: string, wsUrl: string): void {
        calls.push(`connect:${sessionId}:${wsUrl}`);
      },
      async updateSessionCount(): Promise<void> {
        calls.push("updateSessionCount");
      },
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
      runner: "gemini",
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
          cleanup(): void {
            calls.push("cleanup:session-error");
          },
        },
      },
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
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      { setTimeout, clearTimeout },
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
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      { setTimeout, clearTimeout },
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
      async loadXterm(): Promise<void> {
        calls.push("loadXterm");
      },
      connectTerminal(sessionId: string, wsUrl: string): void {
        calls.push(`connect:${sessionId}:${wsUrl}`);
      },
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
      async loadXterm(): Promise<void> {
        calls.push("loadXterm");
        throw new Error("xterm.js load failed");
      },
      async updateSessionCount(): Promise<void> {
        calls.push("updateSessionCount");
      },
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
          cleanup(): void {
            calls.push("cleanup:session-3");
          },
        },
      },
      _forgetSavedSession(sessionId: string): void {
        calls.push(`forget:${sessionId}`);
      },
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
    const explicitAwaiting = "Idle\n\x1b]0;awaiting confirmation — copilot\x07";
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
    // Plain working title — no awaiting signal.
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
  // from the live runner; see .goat-flow/scratchpad/capture-*.mjs and the
  // M00-workspace-terminal-waiting-status milestone for capture procedure.
  // Positive fixtures pin the prompts the heuristic must catch; negative
  // fixtures pin the running-state output the heuristic must NOT false-fire on.
  const AWAITING_FIXTURE_DIR = resolve(
    PROJECT_ROOT,
    "test",
    "unit",
    "__fixtures__",
    "awaiting-input",
  );
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
    // handler's else-branch cleared the 1200ms reveal timer — so the badge
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
    // bullet — it must still be classifiable as non-redraw so the badge does
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

  it("detects Gemini readiness only after the Gemini composer appears", () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );

    assert.equal(
      helpers.dashboardOutputLooksReadyForLaunchPrompt(
        [
          "Gemini CLI v0.41.2",
          "Signed in with Google",
          "/auth",
          "Plan: Gemini Code Assist in Google One AI Pro",
          "? for shortcuts",
        ].join("\n"),
        "gemini",
      ),
      false,
    );
    assert.equal(
      helpers.dashboardOutputLooksReadyForLaunchPrompt(
        [
          "Gemini CLI v0.41.2",
          "Signed in with Google",
          "Type your message or @path/to/file",
          "workspace (/directory) branch sandbox /model quota",
        ].join("\n"),
        "gemini",
      ),
      true,
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

  it("keeps Gemini launch prompts queued through auth output until the composer is ready", () => {
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
    );
    const ctx = makeLaunchPromptContext();
    const session = ctx.sessions[0] as Record<string, unknown>;
    session.runner = "gemini";

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
      "Gemini CLI v0.41.2",
      "Signed in with Google",
      "/auth",
      "Plan: Gemini Code Assist in Google One AI Pro",
      "? for shortcuts",
    ].join("\n");
    helpers.dashboardHandleLaunchPromptOutput(ctx, "launch-session");
    timers.tick(2500);

    assert.deepStrictEqual(ctx.sent, []);
    assert.equal(
      ctx._terminalRefs["launch-session"]?.launchPrompt,
      "run prompt\nsecond line",
    );

    session.outputTail = `${session.outputTail}\nType your message or @path/to/file`;
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

    assert.equal(ctx.sent.length, 2);

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
    // M00 contract: when LocalSession.awaitingInput flips true, the header
    // status dot, the "Awaiting input" pill, the left-rail card style, and
    // the top meterWaiting() count must all flip together. Each surface must
    // derive from the same field so the heuristic fix is reflected uniformly.
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
    assert.match(source, /const TERMINAL_PASTE_COMMIT_DELAY_MS = 1200/);
    assert.match(
      source,
      /const TERMINAL_PASTE_COMMIT_FALLBACK_DELAY_MS = 15000/,
    );
    assert.match(
      source,
      /const TERMINAL_PASTE_POST_SUBMIT_RETRY_DELAY_MS = 2500/,
    );
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
