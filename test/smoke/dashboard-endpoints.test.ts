/**
 * Fast smoke tests for dashboard modules.
 * Public HTTP behavior lives in the integration suite; this file checks
 * dashboard exports plus terminal WebSocket boundary behavior that does not
 * require launching a real PTY.
 */
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  buildTerminalSpawnSpec,
  pickWindowsRunnerPath,
  resolveCLIPath,
  TerminalManager,
  type TerminalTraceEvent,
  validateProjectPath,
} from "../../src/cli/server/terminal.js";
import type { ServerMessage } from "../../src/cli/server/types.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const require = createRequire(import.meta.url);
const childProcess =
  require("node:child_process") as typeof import("node:child_process");

type TerminalWebSocket = Parameters<TerminalManager["attachWebSocket"]>[1];

/** Minimal PTY surface TerminalManager needs for endpoint smoke tests. */
interface TestPty {
  /** Writes terminal input sent through the fake PTY. */
  write(data: string): void;
  /** Record terminal resize requests without opening a real PTY. */
  resize(cols: number, rows: number): void;
  /** Terminate the fake PTY lifecycle used by shutdown assertions. */
  kill(): void;
}

/** Mutable terminal session shape used to seed TerminalManager internals. */
interface TestTerminalSession {
  id: string;
  status: "active" | "terminated";
  createdAt: string;
  projectPath: string;
  cwd: string;
  targetPath: string;
  runner: "claude";
  lastInputAt: number;
  pty: TestPty | null;
  ws: TerminalWebSocket | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  detachBuffer: string[];
  detachBufferSize: number;
}

/** Private TerminalManager fields initialized directly for focused tests. */
interface TestTerminalManagerInternals {
  sessions: Map<string, TestTerminalSession>;
  runnerPaths: Map<string, string>;
  nodePtyModule: unknown;
  nodePtyAvailable: boolean | null;
  startedAt: number;
  idleTimeoutMs: number | null;
  traceSink?: (event: TerminalTraceEvent) => void;
}

class FakeWebSocket {
  readyState = 1;
  sent: ServerMessage[] = [];
  closed = false;
  private handlers = new Map<string, Array<(raw: Buffer | string) => void>>();

  /** Capture serialized server messages for WebSocket boundary assertions. */
  send(payload: string): void {
    this.sent.push(JSON.parse(payload) as ServerMessage);
  }

  /** Move the fake socket to closed state and notify close listeners. */
  close(): void {
    this.closed = true;
    this.emit("close", "");
  }

  /** Register a fake socket listener using the server-facing callback shape. */
  on(event: string, handler: (raw: Buffer | string) => void): void {
    const existing = this.handlers.get(event) ?? [];
    existing.push(handler);
    this.handlers.set(event, existing);
  }

  /** Dispatch a fake socket event to registered terminal handlers. */
  emit(event: string, raw: Buffer | string): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(raw);
    }
  }

  /** Cast this focused fake to the WebSocket subset TerminalManager consumes. */
  asTerminalSocket(): TerminalWebSocket {
    return this as TerminalWebSocket;
  }
}

type TestTerminalManager = TerminalManager & TestTerminalManagerInternals;

/** Expose test-seeded private fields without widening the production TerminalManager API. */
function managerInternals(manager: TerminalManager): TestTerminalManager {
  return manager as TestTerminalManager;
}

/**
 * Enable mocked timers for TerminalManager launch-prompt timing tests.
 *
 * @returns the node:test timer controller, with Date and timer APIs mocked
 */
function enableTerminalMockTimers(): typeof mock.timers {
  mock.timers.enable({
    apis: ["Date", "setTimeout", "setInterval"],
    now: 0,
  });
  return mock.timers;
}

/** Build a TerminalManager instance with explicit test-owned internals. */
function makeManager(): TerminalManager {
  const manager = Object.create(TerminalManager.prototype) as TerminalManager;
  const internals = managerInternals(manager);
  internals.sessions = new Map();
  internals.runnerPaths = new Map();
  internals.nodePtyModule = null;
  internals.nodePtyAvailable = null;
  internals.startedAt = Date.now();
  internals.idleTimeoutMs = null;
  return manager;
}

/** Create an active session fixture plus arrays that record PTY calls. */
function makeSession(overrides: Partial<TestTerminalSession> = {}): {
  session: TestTerminalSession;
  writes: string[];
  resizes: Array<{ cols: number; rows: number }>;
} {
  const writes: string[] = [];
  const resizes: Array<{ cols: number; rows: number }> = [];
  const pty: TestPty = {
    /** Capture input routed from decoded WebSocket messages. */
    write: (data) => writes.push(data),
    /** Capture clamped resize dimensions routed from WebSocket messages. */
    resize: (cols, rows) => resizes.push({ cols, rows }),
    /** Keep shutdown paths synchronous for session-list tests. */
    kill: () => undefined,
  };
  const session: TestTerminalSession = {
    id: "session-1",
    status: "active",
    createdAt: "2026-04-26T00:00:00.000Z",
    projectPath: "/tmp/project",
    cwd: "/tmp/project",
    targetPath: "/tmp/project",
    runner: "claude",
    lastInputAt: 0,
    pty,
    ws: null,
    idleTimer: null,
    detachBuffer: [],
    detachBufferSize: 0,
    ...overrides,
  };
  return { session, writes, resizes };
}

/** Create the fake spawned PTY used by prompt-delivery timing tests. */
function makeSpawnedPty(): {
  pty: TestPty & {
    onData(handler: (data: string) => void): void;
    onExit(
      handler: (event: { exitCode: number; signal?: number | string }) => void,
    ): void;
  };
  writes: string[];
  /** Emit fake runner output into TerminalManager's PTY data handler. */
  emitData(data: string): void;
} {
  const writes: string[] = [];
  let dataHandler: (data: string) => void = () => undefined;
  let exitHandler: (event: {
    exitCode: number;
    signal?: number | string;
  }) => void = () => undefined;
  return {
    writes,
    pty: {
      /** Capture delayed prompt input written into the spawned PTY. */
      write: (data) => writes.push(data),
      /** Ignore resize calls because prompt timing tests do not inspect them. */
      resize: () => undefined,
      /** Route termination through the registered exit handler. */
      kill: () => exitHandler({ exitCode: 0 }),
      /** Store the data handler so tests can emit runner output deterministically. */
      onData: (handler) => {
        dataHandler = handler;
      },
      /** Store the exit handler so fake kill mirrors node-pty shutdown. */
      onExit: (handler) => {
        exitHandler = handler;
      },
    },
    /** Emit fake runner output into TerminalManager's PTY data handler. */
    emitData(data: string): void {
      dataHandler(data);
    },
  };
}

describe("dashboard server exports", () => {
  it("serveDashboard is exported as a function", async () => {
    const mod = await import("../../src/cli/server/dashboard.js");
    assert.equal(typeof mod.serveDashboard, "function");
  });
});

describe("terminal exports", () => {
  it("TerminalManager is exported as a class", async () => {
    const mod = await import("../../src/cli/server/terminal.js");
    assert.equal(typeof mod.TerminalManager, "function");
  });

  it("rejects missing and file project paths before PTY launch", () => {
    assert.throws(
      () => validateProjectPath("/definitely/missing/goat-flow/project"),
      /Local path validation failed \(terminal-cwd\): missing/,
    );
    const currentFilePath = fileURLToPath(import.meta.url);
    assert.throws(
      () => validateProjectPath(currentFilePath),
      /Local path validation failed \(terminal-cwd\): not directory/,
    );
  });

  it("prefers runnable Windows shims over POSIX npm wrappers", () => {
    assert.equal(
      pickWindowsRunnerPath([
        "C:\\Users\\thatm\\AppData\\Roaming\\npm\\codex",
        "C:\\Users\\thatm\\AppData\\Roaming\\npm\\codex.cmd",
        "C:\\Users\\thatm\\AppData\\Roaming\\npm\\codex.ps1",
      ]),
      "C:\\Users\\thatm\\AppData\\Roaming\\npm\\codex.cmd",
    );
  });

  // Fixture purpose: covers PATH lookup without runner execution; the mock throws if anything but lookup runs.
  it("resolves POSIX runner paths without executing the runner binary", () => {
    if (process.platform === "win32") return;
    const originalExecFileSync = childProcess.execFileSync;
    // The fake lookup command records `which` usage and fails on anything that would execute a runner.
    const calls: Array<{ command: string; args: string[] }> = [];
    childProcess.execFileSync = ((
      command: string,
      args?: readonly string[],
    ) => {
      calls.push({ command, args: Array.from(args ?? []) });
      if (command === "which") return "/usr/local/bin/claude\n";
      throw new Error(`unexpected command: ${command}`);
    }) as typeof childProcess.execFileSync;
    syncBuiltinESMExports();
    try {
      assert.equal(resolveCLIPath("claude"), "/usr/local/bin/claude");
      assert.deepEqual(calls, [{ command: "which", args: ["claude"] }]);
    } finally {
      childProcess.execFileSync = originalExecFileSync;
      syncBuiltinESMExports();
    }
  });

  it("builds a Windows PTY launch that keeps PowerShell open after the runner exits", () => {
    const spec = buildTerminalSpawnSpec(
      "copilot",
      "C:\\Users\\thatm\\AppData\\Roaming\\npm\\copilot.cmd",
      "review this",
      {},
      "win32",
    );

    assert.equal(spec.shell, "powershell.exe");
    assert.deepStrictEqual(spec.args.slice(0, 3), [
      "-NoLogo",
      "-NoExit",
      "-Command",
    ]);
    assert.match(spec.args[3] ?? "", /GOAT_RUNNER/);
    assert.match(spec.args[3] ?? "", /Remove-Item Env:GOAT_RUNNER/);
    assert.doesNotMatch(spec.args[3] ?? "", /review this/);
    assert.equal(spec.env.GOAT_PROMPT, undefined);
    assert.equal(
      spec.env.GOAT_RUNNER,
      "C:\\Users\\thatm\\AppData\\Roaming\\npm\\copilot.cmd",
    );
    assert.equal(spec.initialInput, "\x1b[200~review this\x1b[201~\r");
  });

  it("builds a POSIX PTY launch that returns to the interactive shell", () => {
    const spec = buildTerminalSpawnSpec(
      "claude",
      "/usr/local/bin/claude",
      "",
      { SHELL: "/bin/zsh" },
      "linux",
    );

    assert.equal(spec.shell, "/bin/zsh");
    assert.deepStrictEqual(spec.args, [
      "-c",
      '"$GOAT_RUNNER"; unset GOAT_RUNNER; exec "$SHELL" -i',
    ]);
    assert.equal(spec.env.GOAT_PROMPT, undefined);
    assert.equal(spec.initialInput, null);
    assert.equal(spec.env.SHELL, "/bin/zsh");
  });

  it("injects POSIX launch prompts through PTY input instead of runner flags", () => {
    const spec = buildTerminalSpawnSpec(
      "antigravity",
      "/usr/local/bin/agy",
      "audit target",
      { SHELL: "/bin/bash" },
      "darwin",
    );

    assert.equal(spec.shell, "/bin/bash");
    assert.deepStrictEqual(spec.args, [
      "-c",
      '"$GOAT_RUNNER"; unset GOAT_RUNNER; exec "$SHELL" -i',
    ]);
    assert.equal(spec.env.GOAT_PROMPT, undefined);
    assert.equal(spec.initialInput, "\x1b[200~audit target\x1b[201~\r");
  });

  it("waits for runner output to settle before initial prompt delivery", async () => {
    const timers = enableTerminalMockTimers();
    const manager = makeManager();
    const internals = managerInternals(manager);
    const spawned = makeSpawnedPty();
    internals.runnerPaths.set("claude", "/usr/local/bin/claude");
    internals.nodePtyModule = {
      spawn: () => spawned.pty,
    };
    internals.nodePtyAvailable = true;

    try {
      await manager.create("review this", PROJECT_ROOT, "claude");
      spawned.emitData("runner banner\n");
      timers.tick(100);
      spawned.emitData("runner prompt\n");
      timers.tick(80);

      assert.deepStrictEqual(spawned.writes, []);
      timers.tick(70);
      assert.deepStrictEqual(spawned.writes, [
        "\x1b[200~review this\x1b[201~\r",
      ]);
    } finally {
      manager.shutdown();
      timers.reset();
    }
  });

  it("uses the fallback deadline when runner output keeps updating", async () => {
    const timers = enableTerminalMockTimers();
    const manager = makeManager();
    const internals = managerInternals(manager);
    const spawned = makeSpawnedPty();
    internals.runnerPaths.set("claude", "/usr/local/bin/claude");
    internals.nodePtyModule = {
      spawn: () => spawned.pty,
    };
    internals.nodePtyAvailable = true;

    let interval: ReturnType<typeof setInterval> | null = null;
    try {
      await manager.create("review this", PROJECT_ROOT, "claude");
      interval = setInterval(() => spawned.emitData("status redraw\n"), 100);
      timers.tick(4999);
      assert.deepStrictEqual(spawned.writes, []);
      timers.tick(1);

      assert.deepStrictEqual(spawned.writes, [
        "\x1b[200~review this\x1b[201~\r",
      ]);
    } finally {
      if (interval) clearInterval(interval);
      manager.shutdown();
      timers.reset();
    }
  });

  it("sends a typed error and closes when attaching to a missing session", () => {
    const manager = makeManager();
    const socket = new FakeWebSocket();

    manager.attachWebSocket("missing", socket.asTerminalSocket());

    assert.deepStrictEqual(socket.sent, [
      {
        type: "error",
        message: "Session not found or already terminated",
      },
    ]);
    assert.equal(socket.closed, true);
  });

  it("does not expose prompt content in terminal session snapshots", () => {
    const manager = makeManager();
    const internals = managerInternals(manager);
    const { session } = makeSession({
      id: "session-prompt",
      projectPath: "/tmp/project",
      cwd: "/tmp/project",
      targetPath: "/tmp/project",
    });
    (session as TestTerminalSession & { prompt?: string }).prompt =
      "sensitive prompt text";
    internals.sessions.set(session.id, session);

    const payload = JSON.stringify(manager.list());
    assert.equal(payload.includes("sensitive prompt text"), false);
    assert.equal(payload.includes("GOAT_PROMPT"), false);
  });

  it("replays detached output exactly once when a browser reconnects", () => {
    const manager = makeManager();
    const { session } = makeSession({
      detachBuffer: ["hello", " world"],
      detachBufferSize: "hello world".length,
    });
    managerInternals(manager).sessions.set(session.id, session);
    const socket = new FakeWebSocket();

    manager.attachWebSocket(session.id, socket.asTerminalSocket());

    assert.deepStrictEqual(socket.sent, [
      { type: "output", data: "hello" },
      { type: "output", data: " world" },
    ]);
    assert.deepStrictEqual(session.detachBuffer, []);
    assert.equal(session.detachBufferSize, 0);
  });

  it("routes decoded input and clamps unsafe resize dimensions", () => {
    const manager = makeManager();
    const { session, writes, resizes } = makeSession();
    managerInternals(manager).sessions.set(session.id, session);
    const socket = new FakeWebSocket();

    manager.attachWebSocket(session.id, socket.asTerminalSocket());
    socket.emit("message", JSON.stringify({ type: "input", data: "ls\n" }));
    socket.emit(
      "message",
      JSON.stringify({ type: "resize", cols: 120, rows: 40 }),
    );
    socket.emit(
      "message",
      JSON.stringify({ type: "resize", cols: 9999, rows: -1 }),
    );
    socket.emit("message", JSON.stringify({ type: "input", data: 42 }));

    assert.deepStrictEqual(writes, ["ls\n"]);
    assert.deepStrictEqual(resizes, [
      { cols: 120, rows: 40 },
      { cols: 80, rows: 24 },
    ]);
    assert.deepStrictEqual(socket.sent, [
      {
        type: "error",
        message: "message.data: must be a string on input messages",
      },
    ]);
  });

  it("traces prompt sends only for bracketed-paste prompt input", () => {
    const manager = makeManager();
    const events: TerminalTraceEvent[] = [];
    managerInternals(manager).traceSink = (event) => events.push(event);
    const { session, writes } = makeSession();
    managerInternals(manager).sessions.set(session.id, session);
    const socket = new FakeWebSocket();
    const longCommand = `${"x".repeat(100)}\n`;
    const bracketedPrompt = "\x1b[200~review this diff\x1b[201~";

    manager.attachWebSocket(session.id, socket.asTerminalSocket());
    socket.emit(
      "message",
      JSON.stringify({ type: "input", data: longCommand }),
    );
    socket.emit(
      "message",
      JSON.stringify({ type: "input", data: bracketedPrompt }),
    );

    assert.deepStrictEqual(writes, [longCommand, bracketedPrompt]);
    assert.deepStrictEqual(
      events.map((event) => event.eventKind),
      ["terminal.send", "terminal.send", "prompt.send"],
    );
  });
});
