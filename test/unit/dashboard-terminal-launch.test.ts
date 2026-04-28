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
  sessions: Array<Record<string, unknown>>;
  promptRunStates: Record<string, string>;
  launching: boolean;
  activeSessionId: string | null;
  _terminalRefs: Record<string, { cleanup?: () => void }>;
  showMaxSessionsModal: boolean;
  showToast(msg: string, isError?: boolean): void;
  loadXterm(): Promise<void>;
  connectTerminal(sessionId: string, wsUrl: string): void;
  updateSessionCount(): Promise<void>;
  $nextTick(): Promise<void>;
};

type HelperContext = {
  dashboardLaunchInTerminal(
    ctx: LaunchContext,
    prompt: string,
    runner?: string,
    options?: LaunchOptions,
  ): Promise<void>;
};

function loadHelpers(fetchImpl: typeof fetch): HelperContext {
  const source = readFileSync(DASHBOARD_TERMINAL_PATH, "utf-8");
  const js = transpileModule(source, {
    compilerOptions: { target: ScriptTarget.ES2023 },
  }).outputText;
  const context = createContext({
    fetch: fetchImpl,
    console,
    setTimeout,
    clearTimeout,
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
  dashboardLaunchInTerminal,
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
    sessions: [],
    promptRunStates: {},
    launching: false,
    activeSessionId: null,
    _terminalRefs: {},
    showMaxSessionsModal: false,
    async loadXterm(): Promise<void> {
      return;
    },
    connectTerminal(): void {
      return;
    },
    async updateSessionCount(): Promise<void> {
      return;
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
      promptLabel: "Terminal",
    });

    assert.equal(ctx.sessions.length, 1);
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
      promptLabel: "Terminal",
    });

    assert.equal(ctx.sessions.length, 0);
    assert.equal(ctx.activeSessionId, null);
    assert.ok(calls.includes("fetch:DELETE:/api/terminal/session-2"));
    assert.equal(ctx.toasts[0]?.isError, true);
    assert.match(ctx.toasts[0]?.msg ?? "", /xterm\.js load failed/);
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
});
