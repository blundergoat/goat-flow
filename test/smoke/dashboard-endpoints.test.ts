/**
 * Fast smoke tests for dashboard modules.
 * Public HTTP behavior lives in the integration suite; this file checks
 * dashboard exports plus terminal WebSocket boundary behavior that does not
 * require launching a real PTY.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  buildTerminalSpawnSpec,
  pickWindowsRunnerPath,
  TerminalManager,
  validateProjectPath,
} from "../../src/cli/server/terminal.js";
import type { ServerMessage } from "../../src/cli/server/types.js";

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
    assert.equal(spec.env.GOAT_PROMPT, "review this");
    assert.equal(spec.env.GOAT_PROMPT_FLAG, "-i");
    assert.equal(spec.env.GOAT_PROMPT_PRESENT, "1");
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
      '"$GOAT_RUNNER"; exec "$SHELL" -i',
    ]);
    assert.equal(spec.env.GOAT_PROMPT_PRESENT, "0");
    assert.equal(spec.env.SHELL, "/bin/zsh");
  });

  it("preserves prompt flags for POSIX runners that require them", () => {
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
      '"$GOAT_RUNNER" -i "$GOAT_PROMPT"; exec "$SHELL" -i',
    ]);
    assert.equal(spec.env.GOAT_PROMPT_FLAG, "-i");
    assert.equal(spec.env.GOAT_PROMPT_PRESENT, "1");
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
