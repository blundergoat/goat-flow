/**
 * Fast smoke tests for dashboard modules.
 * Public HTTP behavior lives in the integration suite; this file checks
 * dashboard exports plus terminal WebSocket boundary behavior that does not
 * require launching a real PTY.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  buildTerminalSpawnSpec,
  pickWindowsRunnerPath,
  resolveCLIPath,
  TerminalManager,
  validateProjectPath,
} from "../../src/cli/server/terminal.js";
import type { ServerMessage } from "../../src/cli/server/types.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const require = createRequire(import.meta.url);
const childProcess =
  require("node:child_process") as typeof import("node:child_process");

type TerminalWebSocket = Parameters<TerminalManager["attachWebSocket"]>[1];

interface TestPty {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

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

interface TestTerminalManagerInternals {
  sessions: Map<string, TestTerminalSession>;
  runnerPaths: Map<string, string>;
  nodePtyModule: unknown;
  nodePtyAvailable: boolean | null;
  startedAt: number;
  idleTimeoutMs: number | null;
}

class FakeWebSocket {
  readyState = 1;
  sent: ServerMessage[] = [];
  closed = false;
  private handlers = new Map<string, Array<(raw: Buffer | string) => void>>();

  send(payload: string): void {
    this.sent.push(JSON.parse(payload) as ServerMessage);
  }

  close(): void {
    this.closed = true;
    this.emit("close", "");
  }

  on(event: string, handler: (raw: Buffer | string) => void): void {
    const existing = this.handlers.get(event) ?? [];
    existing.push(handler);
    this.handlers.set(event, existing);
  }

  emit(event: string, raw: Buffer | string): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(raw);
    }
  }

  asTerminalSocket(): TerminalWebSocket {
    return this as unknown as TerminalWebSocket;
  }
}

function managerInternals(
  manager: TerminalManager,
): TestTerminalManagerInternals {
  return manager as unknown as TestTerminalManagerInternals;
}

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

function makeSession(overrides: Partial<TestTerminalSession> = {}): {
  session: TestTerminalSession;
  writes: string[];
  resizes: Array<{ cols: number; rows: number }>;
} {
  const writes: string[] = [];
  const resizes: Array<{ cols: number; rows: number }> = [];
  const pty: TestPty = {
    write: (data) => writes.push(data),
    resize: (cols, rows) => resizes.push({ cols, rows }),
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

function makeSpawnedPty(): {
  pty: TestPty & {
    onData(handler: (data: string) => void): void;
    onExit(
      handler: (event: { exitCode: number; signal?: number | string }) => void,
    ): void;
  };
  writes: string[];
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
      write: (data) => writes.push(data),
      resize: () => undefined,
      kill: () => exitHandler({ exitCode: 0 }),
      onData: (handler) => {
        dataHandler = handler;
      },
      onExit: (handler) => {
        exitHandler = handler;
      },
    },
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
      /Invalid project path: does not exist/,
    );
    const currentFilePath = fileURLToPath(import.meta.url);
    assert.throws(
      () => validateProjectPath(currentFilePath),
      /Invalid project path: not a directory/,
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

  it("resolves POSIX runner paths without executing the runner binary", () => {
    if (process.platform === "win32") return;
    const originalExecFileSync = childProcess.execFileSync;
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
      "gemini",
      "/usr/local/bin/gemini",
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
    const manager = makeManager();
    const internals = managerInternals(manager);
    const spawned = makeSpawnedPty();
    internals.runnerPaths.set("claude", "/usr/local/bin/claude");
    internals.nodePtyModule = {
      spawn: () => spawned.pty,
    };
    internals.nodePtyAvailable = true;

    await manager.create("review this", PROJECT_ROOT, "claude");
    spawned.emitData("runner banner\n");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    spawned.emitData("runner prompt\n");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 80));

    assert.deepStrictEqual(spawned.writes, []);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 120));
    assert.deepStrictEqual(spawned.writes, ["\x1b[200~review this\x1b[201~\r"]);
    manager.shutdown();
  });

  it("uses the fallback deadline when runner output keeps updating", async () => {
    const manager = makeManager();
    const internals = managerInternals(manager);
    const spawned = makeSpawnedPty();
    internals.runnerPaths.set("claude", "/usr/local/bin/claude");
    internals.nodePtyModule = {
      spawn: () => spawned.pty,
    };
    internals.nodePtyAvailable = true;

    await manager.create("review this", PROJECT_ROOT, "claude");
    const interval = setInterval(
      () => spawned.emitData("status redraw\n"),
      100,
    );
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 5300));
    clearInterval(interval);

    assert.deepStrictEqual(spawned.writes, ["\x1b[200~review this\x1b[201~\r"]);
    manager.shutdown();
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
});
