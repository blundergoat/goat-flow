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
  dashboardEndSession(ctx: LaunchContext, sessionId: string): void;
  dashboardOutputLooksAwaitingInput(text: string): boolean;
  dashboardOutputLooksReadyForLaunchPrompt(
    text: string,
    runner?: string,
  ): boolean;
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
};

type TimerControls = {
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
};

function loadHelpers(
  fetchImpl: typeof fetch,
  timers: TimerControls = { setTimeout, clearTimeout },
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
  });
  runInContext(
    `${js}
globalThis.__helpers = {
  dashboardSendToTerminalSession,
  dashboardLaunchInTerminal,
  dashboardEndSession,
  dashboardOutputLooksAwaitingInput,
  dashboardOutputLooksReadyForLaunchPrompt,
  dashboardNextAwaitingInputState,
  dashboardScheduleLaunchPrompt,
  dashboardHandleLaunchPromptOutput,
  dashboardHandlePasteSubmitOutput,
  dashboardClearPasteSubmitState,
  dashboardSetTerminalLoadingPhase,
  dashboardArmTerminalLoadingTimers,
  dashboardMarkTerminalLoadingReady,
  dashboardRetryTerminalSession,
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

describe("dashboard terminal launch flow", () => {
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
    timers.tick(1000);
    assert.deepStrictEqual(JSON.parse(sent[1] ?? "{}"), {
      type: "input",
      data: "\r",
    });
    assert.equal(timers.pending(), 0);
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

    assert.equal(sent.length, 1);
    timers.tick(299);
    assert.equal(sent.length, 1);
    timers.tick(1);

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

    assert.equal(sent.length, 1);
    timers.tick(300);

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
    timers.tick(1000);
    assert.equal(sent.length, 1);
    assert.equal(timers.pending(), 1);

    ws.readyState = 1;
    timers.tick(300);
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

    assert.equal(sent.length, 1);
    timers.tick(300);

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
    timers.tick(300);
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
    timers.tick(1000);

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

  it("creates the backend session before waiting on xterm assets", async () => {
    const calls: string[] = [];
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

    await helpers.dashboardLaunchInTerminal(ctx, "", "claude", {
      promptLabel: "Manual session",
    });

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
    assert.equal(calls[0], "fetch:POST:/api/terminal/create");
    assert.ok(
      calls.indexOf("fetch:POST:/api/terminal/create") <
        calls.indexOf("loadXterm"),
      "terminal session should be created before xterm loading starts",
    );
    assert.ok(
      calls.indexOf("$nextTick") < calls.indexOf("loadXterm"),
      "the workspace container should render before xterm loads",
    );
    assert.ok(
      calls.indexOf("loadXterm") <
        calls.indexOf("connect:session-1:/ws/terminal/session-1"),
      "xterm should load before the browser terminal attaches",
    );
    assert.ok(calls.includes("updateSessionCount"));
    assert.deepStrictEqual(ctx.toasts, []);
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
    assert.match(source, /script\.src = "\/assets\/xterm\.js"/);
    assert.match(source, /script\.src = "\/assets\/addon-fit\.js"/);
    assert.doesNotMatch(source, /cdn\.jsdelivr\.net\/npm\/@xterm/);
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
        "Bash command\ncommand -v browser-use\nEsc to cancel · Tab to amend · ctrl+e to explain",
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
      helpers.dashboardNextAwaitingInputState(true, prompt, "\nContinuing..."),
      false,
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
    await delay(320);
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

    assert.equal(ctx.sent.length, 1);
    timers.tick(300);

    assert.deepStrictEqual(JSON.parse(ctx.sent[1] ?? "{}"), {
      type: "input",
      data: "\r",
    });
    assert.equal(ctx._terminalRefs["launch-session"]?.launchPrompt, undefined);
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
    await delay(320);
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
    await delay(320);
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
    assert.match(source, /return s\.awaitingInput === true \|\|/);
    assert.match(
      source,
      /this\.allSessions\(\)\.filter\(s => this\.sessionIsWaiting\(s\)\)/,
    );
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
    assert.match(
      source,
      /:style="\{ padding: sessionsCollapsed \? '8px 6px' : '0 12px' \}"/,
    );
  });

  it("keeps the collapsed workspace rail actionable", () => {
    const source = readFileSync(WORKSPACE_VIEW_PATH, "utf-8");
    assert.match(source, /title="Launch from prompts"/);
    assert.match(source, /:key="'ws-collapsed-' \+ s\.id"/);
    assert.match(source, /@click="openSession\(s\)"/);
    assert.match(source, /:aria-label="'Open ' \+ sessionTitleFor\(s\)"/);
    assert.match(source, /justify-content: flex-start;/);
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
  });

  it("renders the Waiting-for-runner badge in the workspace header", () => {
    const source = readFileSync(WORKSPACE_VIEW_PATH, "utf-8");
    assert.match(source, /x-show="terminalWaitingForRunner"/);
    assert.match(source, /Waiting for runner\.\.\./);
  });

  it("renders a terminal loading overlay inside each session shell", () => {
    const workspace = readFileSync(WORKSPACE_VIEW_PATH, "utf-8");
    const styles = readFileSync(
      resolve(PROJECT_ROOT, "src", "dashboard", "styles.css"),
      "utf-8",
    );
    assert.match(workspace, /class="terminal-session-shell"/);
    assert.match(workspace, /class="terminal-loading-overlay"/);
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
