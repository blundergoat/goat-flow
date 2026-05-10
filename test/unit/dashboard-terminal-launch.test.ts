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
      launchPrompt?: string;
      launchPromptTimer?: ReturnType<typeof setTimeout>;
    }
  >;
  showMaxSessionsModal: boolean;
  adaptPrompt(prompt: string, runner?: string): string;
  showToast(msg: string, isError?: boolean): void;
  _forgetSavedSession(sessionId: string): void;
  loadXterm(): Promise<void>;
  connectTerminal(sessionId: string, wsUrl: string): void;
  updateSessionCount(): Promise<void>;
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
  dashboardOutputLooksReadyForLaunchPrompt(text: string): boolean;
  dashboardNextAwaitingInputState(
    previousAwaiting: boolean,
    previousTail: string,
    outputChunk: string,
  ): boolean;
};

function loadHelpers(fetchImpl: typeof fetch): HelperContext {
  const source = readFileSync(DASHBOARD_TERMINAL_PATH, "utf-8");
  const js = transpileModule(source, {
    compilerOptions: { target: ScriptTarget.ES2023 },
  }).outputText;
  const context = createContext({
    fetch: fetchImpl,
    dashboardFetch: fetchImpl,
    dashboardTerminalWsPath: (path: string) => path,
    console,
    setTimeout,
    clearTimeout,
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

describe("dashboard terminal launch flow", () => {
  it("sends terminal text to the requested session instead of the current active tab", () => {
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
      data: "\x1b[200~Attached files\x1b[201~\r",
    });
    assert.equal(ctx.sessions[0]?.awaitingInput, false);
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
        "/remote-control is active · Code in CLI\nloading project...",
      ),
      false,
    );
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

  it("warms xterm when the workspace view opens", () => {
    const source = readFileSync(DASHBOARD_APP_PATH, "utf-8");
    assert.match(
      source,
      /if \(v === "workspace" && this\.terminalAvailable\) \{\s+void this\.loadXterm\(\)\.catch\(\(\) => \{\}\);\s+\}/,
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
      /const TERMINAL_LAUNCH_PROMPT_FALLBACK_DELAY_MS = 6000/,
    );
    assert.match(source, /body: JSON\.stringify\(\{\s+prompt: ""/);
    assert.match(
      source,
      /ctx\.connectTerminal\(session\.id, wsUrl\);\s+dashboardScheduleLaunchPrompt\(ctx, session\.id, prompt\)/,
    );
    assert.match(
      source,
      /dashboardOutputLooksReadyForLaunchPrompt\(target\.outputTail \?\? ""\)/,
    );
  });

  it("only treats image file drag items as terminal upload candidates", () => {
    const source = readFileSync(DASHBOARD_APP_PATH, "utf-8");
    assert.match(
      source,
      /item\.kind === "file" && item\.type\.startsWith\("image\/"\)/,
    );
  });
});
