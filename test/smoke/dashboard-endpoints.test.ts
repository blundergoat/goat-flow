/**
 * Check dashboard exports and terminal behavior using fake sockets and PTYs.
 *
 * These smoke tests cover prompt timing, browser reconnection, input validation, and session limits.
 * Use the integration suite for HTTP behavior; this file does not launch a real terminal.
 */
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  buildTerminalSpawnSpec,
  MAX_SESSIONS,
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

// Record terminal input, resizing, and shutdown without launching a runner.
interface TestPty {
  // Writes terminal input sent through the fake PTY.
  write(chunk: string): void;
  // Record terminal resize requests without opening a real PTY.
  resize(cols: number, rows: number): void;
  // Terminate the fake PTY lifecycle used by shutdown assertions.
  kill(): void;
}

/**
 * Seed the session state needed to check what a dashboard user sees or sends.
 * Null PTY, socket, and timer values represent resources the scenario has not attached.
 */
interface TestTerminalSession {
  id: string;
  status: "active" | "terminated";
  createdAt: string;
  projectPath: string;
  cwd: string;
  targetPath: string;
  runner: "claude";
  accessMode: "workspace" | "reporting";
  captureQualityDrafts: boolean;
  qualityReportProjectPath: string | null;
  lastInputAt: number;
  pty: TestPty | null;
  ws: TerminalWebSocket | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  detachBuffer: string[];
  detachBufferSize: number;
  // Capture stubs the test can close, standing in for the real quality-draft watchers.
  qualityCaptures: Array<{ dispose(): void }>;
}

/**
 * Expose test-owned session and runner state without adding a public production API.
 * Null capability and timeout values leave those controls unset in the fixture.
 */
interface TestTerminalManagerInternals {
  sessions: Map<string, TestTerminalSession>;
  runnerPaths: Map<string, string>;
  nodePtyModule: unknown;
  nodePtyAvailable: boolean | null;
  startedAt: number;
  idleTimeoutMs: number | null;
  traceSink?: (event: TerminalTraceEvent) => void;
}

/**
 * Stand in for the browser connection while smoke tests drive terminal messages.
 *
 * Tests inspect sent messages and closure after calling TerminalManager.
 * Listeners run synchronously; this fake does not model network timing.
 */
class FakeWebSocket {
  readyState = 1;
  sent: ServerMessage[] = [];
  closed = false;
  private handlers = new Map<string, Array<(raw: Buffer | string) => void>>();

  // Capture serialized server messages for WebSocket boundary assertions.
  send(payload: string): void {
    this.sent.push(JSON.parse(payload) as ServerMessage);
  }

  // Move the fake socket to closed state and notify close listeners.
  close(): void {
    this.closed = true;
    this.emit("close", "");
  }

  // Register a fake socket listener using the server-facing callback shape.
  on(event: string, handler: (raw: Buffer | string) => void): void {
    // The first listener starts an empty list; later listeners share the same simulated browser event.
    const existing = this.handlers.get(event) ?? [];
    existing.push(handler);
    this.handlers.set(event, existing);
  }

  // Dispatch a fake socket event to registered terminal handlers.
  emit(event: string, raw: Buffer | string): void {
    // Notify every listener for this browser event; an event with no listeners has no effect.
    for (const handler of this.handlers.get(event) ?? []) {
      handler(raw);
    }
  }

  // Cast this focused fake to the WebSocket subset TerminalManager consumes.
  asTerminalSocket(): TerminalWebSocket {
    return this as TerminalWebSocket;
  }
}

type TestTerminalManager = TerminalManager & TestTerminalManagerInternals;

// Expose test-seeded private fields without widening the production TerminalManager API.
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

/**
 * Create an isolated manager with no sessions, runner paths, PTY module, or idle timeout.
 * Tests supply only the launch resources required by their scenario.
 */
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

/**
 * Create an active session and record the terminal input and resize requests it receives.
 * Omitted overrides keep the browser disconnected, timers unset, and quality capture disabled.
 */
function makeSession(overrides: Partial<TestTerminalSession> = {}): {
  session: TestTerminalSession;
  writes: string[];
  resizes: Array<{ cols: number; rows: number }>;
} {
  const writes: string[] = [];
  const resizes: Array<{ cols: number; rows: number }> = [];
  const pty: TestPty = {
    // Capture input routed from decoded WebSocket messages.
    write: (data) => writes.push(data),
    // Capture clamped resize dimensions routed from WebSocket messages.
    resize: (cols, rows) => resizes.push({ cols, rows }),
    // Keep shutdown paths synchronous for session-list tests.
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
    accessMode: "workspace",
    captureQualityDrafts: false,
    qualityReportProjectPath: null,
    lastInputAt: 0,
    pty,
    ws: null,
    idleTimer: null,
    detachBuffer: [],
    detachBufferSize: 0,
    qualityCaptures: [],
    ...overrides,
  };
  return { session, writes, resizes };
}

/**
 * Create a fake runner whose output and exit events tests can control.
 * Recorded writes show when the dashboard's launch prompt reaches the runner.
 */
function makeSpawnedPty(): {
  pty: TestPty & {
    // Register the handler the fake PTY calls when it emits output.
    onData(handler: (data: string) => void): void;
    // Register the handler the fake PTY calls when the session ends.
    onExit(
      handler: (event: { exitCode: number; signal?: number | string }) => void,
    ): void;
  };
  writes: string[];
  // Emit fake runner output into TerminalManager's PTY data handler.
  emitData(chunk: string): void;
  // Emit runner exit independently from kill for teardown-order tests.
  emitExit(): void;
} {
  const writes: string[] = [];
  // Handlers start as no-ops so a test that never wires them up cannot fail on an undefined call.
  let dataHandler: (data: string) => void = () => undefined;
  // Same no-op default for the exit path, so a test that only exercises output still runs cleanly.
  let exitHandler: (event: {
    exitCode: number;
    signal?: number | string;
  }) => void = () => undefined;
  return {
    writes,
    pty: {
      // Capture delayed prompt input written into the spawned PTY.
      write: (data) => writes.push(data),
      // Ignore resize calls because prompt timing tests do not inspect them.
      resize: () => undefined,
      // Route termination through the registered exit handler.
      kill: () => exitHandler({ exitCode: 0 }),
      // Store the data handler so tests can emit runner output deterministically.
      onData: (handler) => {
        dataHandler = handler;
      },
      // Store the exit handler so fake kill mirrors node-pty shutdown.
      onExit: (handler) => {
        exitHandler = handler;
      },
    },
    // Emit fake runner output into TerminalManager's PTY data handler.
    emitData(chunk: string): void {
      dataHandler(chunk);
    },
    // Emit one synthetic PTY exit so endpoint tests can observe terminal teardown.
    emitExit(): void {
      exitHandler({ exitCode: 0 });
    },
  };
}

describe("dashboard server exports", () => {
  it("serveDashboard is exported as a function", async () => {
    const moduleExports = await import("../../src/cli/server/dashboard.js");
    assert.equal(typeof moduleExports.serveDashboard, "function");
  });
});

describe("terminal exports", () => {
  it("TerminalManager is exported as a class", async () => {
    const moduleExports = await import("../../src/cli/server/terminal.js");
    assert.equal(typeof moduleExports.TerminalManager, "function");
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
    // Windows uses a different runner lookup; this scenario checks the POSIX command only.
    if (process.platform === "win32") return;
    const originalExecFileSync = childProcess.execFileSync;
    // The fake lookup command records `which` usage and fails on anything that would execute a runner.
    const calls: Array<{ command: string; args: string[] }> = [];
    childProcess.execFileSync = ((
      command: string,
      args?: readonly string[],
    ) => {
      calls.push({ command, args: Array.from(args ?? []) });
      // Return an installed runner path only for lookup; executing a runner fails this fixture.
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
    const launchSpec = buildTerminalSpawnSpec(
      "copilot",
      "C:\\Users\\thatm\\AppData\\Roaming\\npm\\copilot.cmd",
      "review this",
      {},
      "win32",
    );

    assert.equal(launchSpec.shell, "powershell.exe");
    assert.deepStrictEqual(launchSpec.args.slice(0, 3), [
      "-NoLogo",
      "-NoExit",
      "-Command",
    ]);
    assert.match(launchSpec.args[3] ?? "", /GOAT_RUNNER/);
    assert.match(launchSpec.args[3] ?? "", /Remove-Item Env:GOAT_RUNNER/);
    assert.doesNotMatch(launchSpec.args[3] ?? "", /danger-full-access/);
    assert.doesNotMatch(launchSpec.args[3] ?? "", /review this/);
    assert.equal(launchSpec.env.GOAT_PROMPT, undefined);
    assert.equal(
      launchSpec.env.GOAT_RUNNER,
      "C:\\Users\\thatm\\AppData\\Roaming\\npm\\copilot.cmd",
    );
    assert.equal(launchSpec.initialInput, "\x1b[200~review this\x1b[201~\r");
  });

  it("launches Codex on Windows with an explicit preflight-capable sandbox", () => {
    const launchSpec = buildTerminalSpawnSpec(
      "codex",
      "C:\\Users\\thatm\\AppData\\Roaming\\npm\\codex.cmd",
      "",
      {},
      "win32",
    );

    assert.equal(launchSpec.shell, "powershell.exe");
    assert.match(launchSpec.args[3] ?? "", /& \$env:GOAT_RUNNER/);
    assert.match(launchSpec.args[3] ?? "", /--sandbox danger-full-access/);
    assert.equal(
      launchSpec.env.GOAT_RUNNER,
      "C:\\Users\\thatm\\AppData\\Roaming\\npm\\codex.cmd",
    );
    assert.equal(launchSpec.initialInput, null);
  });

  it("builds a POSIX PTY launch that returns to the interactive shell", () => {
    const launchSpec = buildTerminalSpawnSpec(
      "claude",
      "/usr/local/bin/claude",
      "",
      { SHELL: "/bin/zsh" },
      "linux",
    );

    assert.equal(launchSpec.shell, "/bin/zsh");
    assert.deepStrictEqual(launchSpec.args, [
      "-c",
      '"$GOAT_RUNNER"; unset GOAT_RUNNER GOAT_CODEX_REPORTING_PROFILE GOAT_CLAUDE_REPORTING_SETTINGS; exec "$SHELL" -i',
    ]);
    assert.equal(launchSpec.env.GOAT_PROMPT, undefined);
    assert.equal(launchSpec.initialInput, null);
    assert.equal(launchSpec.env.SHELL, "/bin/zsh");
  });

  it("launches Codex on POSIX with an explicit preflight-capable sandbox", () => {
    const launchSpec = buildTerminalSpawnSpec(
      "codex",
      "/usr/local/bin/codex",
      "",
      { SHELL: "/bin/bash" },
      "linux",
    );

    assert.equal(launchSpec.shell, "/bin/bash");
    assert.deepStrictEqual(launchSpec.args, [
      "-c",
      '"$GOAT_RUNNER" --sandbox danger-full-access; unset GOAT_RUNNER GOAT_CODEX_REPORTING_PROFILE GOAT_CLAUDE_REPORTING_SETTINGS; exec "$SHELL" -i',
    ]);
    assert.equal(launchSpec.env.GOAT_RUNNER, "/usr/local/bin/codex");
    assert.equal(launchSpec.initialInput, null);
  });

  it("injects POSIX launch prompts through PTY input instead of runner flags", () => {
    const launchSpec = buildTerminalSpawnSpec(
      "antigravity",
      "/usr/local/bin/agy",
      "audit target",
      { SHELL: "/bin/bash" },
      "darwin",
    );

    assert.equal(launchSpec.shell, "/bin/bash");
    assert.deepStrictEqual(launchSpec.args, [
      "-c",
      '"$GOAT_RUNNER"; unset GOAT_RUNNER GOAT_CODEX_REPORTING_PROFILE GOAT_CLAUDE_REPORTING_SETTINGS; exec "$SHELL" -i',
    ]);
    assert.equal(launchSpec.env.GOAT_PROMPT, undefined);
    assert.equal(launchSpec.initialInput, "\x1b[200~audit target\x1b[201~\r");
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
      // Stop the simulated runner redraws if this test reached the repeating-output setup.
      if (interval) clearInterval(interval);
      manager.shutdown();
      timers.reset();
    }
  });

  it("cancels deferred prompt delivery when a reporting runner exits early", async () => {
    const timers = enableTerminalMockTimers();
    const manager = makeManager();
    const internals = managerInternals(manager);
    const spawned = makeSpawnedPty();
    internals.runnerPaths.set("claude", "/usr/local/bin/claude");
    internals.nodePtyModule = { spawn: () => spawned.pty };
    internals.nodePtyAvailable = true;

    try {
      const created = await manager.create(
        "run the quality report",
        PROJECT_ROOT,
        "claude",
        { accessMode: "reporting" },
      );
      // For example, a user can close the runner before its launch prompt delay expires.
      spawned.emitExit();
      timers.tick(5000);

      assert.deepStrictEqual(spawned.writes, []);
      assert.equal(manager.get(created.id)?.status, "terminated");
    } finally {
      manager.shutdown();
      timers.reset();
    }
  });

  it("releases quality capture only after PTY termination begins", async () => {
    const manager = makeManager();
    const internals = managerInternals(manager);
    const spawned = makeSpawnedPty();
    const events: string[] = [];
    const originalKill = spawned.pty.kill;
    spawned.pty.kill = () => {
      events.push("pty-kill");
      originalKill();
    };
    internals.runnerPaths.set("claude", "/usr/local/bin/claude");
    internals.nodePtyModule = { spawn: () => spawned.pty };
    internals.nodePtyAvailable = true;

    const created = await manager.create("", PROJECT_ROOT, "claude");
    const session = internals.sessions.get(created.id);
    assert.ok(session);
    session.qualityCaptures = [
      { dispose: () => events.push("capture-dispose") },
    ];

    assert.equal(manager.kill(created.id), true);
    assert.deepStrictEqual(events, ["pty-kill", "capture-dispose"]);
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

  it("projects report ownership independently of Claude draft capture", () => {
    const manager = makeManager();
    const { session } = makeSession({
      accessMode: "reporting",
      captureQualityDrafts: false,
      qualityReportProjectPath: "/tmp/project",
    });
    managerInternals(manager).sessions.set(session.id, session);

    const projected = manager.list()[0];

    assert.equal(projected?.captureQualityDrafts, false);
    assert.equal(projected?.qualityReportProjectPath, "/tmp/project");
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

/**
 * Confirm overflow launches fail with the session-limit message a dashboard user sees.
 * Use after a concurrent launch burst to distinguish the intended refusal from an unrelated failure.
 *
 * @param rejections - refused launches; an empty list means no refusal occurred, which the caller checks separately
 */
function assertRejectionsCarryCapMessage(
  rejections: PromiseRejectedResult[],
): void {
  // Overflow creates fail with the visible cap message, not a stray crash.
  for (const rejection of rejections) {
    const message =
      rejection.reason instanceof Error ? rejection.reason.message : "";
    assert.match(message, /Maximum \d+ concurrent sessions/);
  }
}

describe("terminal session concurrency cap", () => {
  // Covers racing terminal creates: spawns concurrent requests and expects MAX_SESSIONS never exceeded.
  it("never exceeds MAX_SESSIONS when creates race around loadNodePty", async () => {
    const manager = makeManager();
    const internals = managerInternals(manager);
    internals.runnerPaths.set("claude", "/usr/local/bin/claude");
    // Each spawn hands back a fresh fake PTY so every racing create can finish.
    internals.nodePtyModule = {
      spawn: () => makeSpawnedPty().pty,
    };
    internals.nodePtyAvailable = true;

    try {
      // Start more launches than the cap before PTY loading resolves, reproducing concurrent requests for the remaining session slots.
      const attempts = MAX_SESSIONS + 3;
      const results = await Promise.allSettled(
        Array.from({ length: attempts }, () =>
          // An empty prompt leaves the initial-input timer unset, keeping this concurrency test independent of prompt timing.
          manager.create("", PROJECT_ROOT, "claude"),
        ),
      );

      const created = results.filter(
        (outcome) => outcome.status === "fulfilled",
      ).length;
      const rejected = results.filter(
        (outcome): outcome is PromiseRejectedResult =>
          outcome.status === "rejected",
      );

      // The cap is a hard ceiling; concurrency must not admit extra sessions.
      assert.equal(manager.list().length, MAX_SESSIONS);
      assert.equal(created, MAX_SESSIONS);
      assert.equal(rejected.length, attempts - MAX_SESSIONS);
      assertRejectionsCarryCapMessage(rejected);
    } finally {
      manager.shutdown();
    }
  });

  it("frees the reserved slot when a create fails path validation", async () => {
    const manager = makeManager();
    const internals = managerInternals(manager);
    internals.runnerPaths.set("claude", "/usr/local/bin/claude");
    internals.nodePtyModule = { spawn: () => makeSpawnedPty().pty };
    internals.nodePtyAvailable = true;

    // A rejected project path must release its reserved session slot so the user can start another terminal.
    await assert.rejects(
      manager.create("", "/definitely/missing/goat-flow/project", "claude"),
      /Local path validation failed/,
    );
    assert.equal(manager.list().length, 0);
  });

  it("kills the PTY and frees the slot when a starting session is deleted mid-launch", async () => {
    const manager = makeManager();
    const internals = managerInternals(manager);
    internals.runnerPaths.set("claude", "/usr/local/bin/claude");
    // Track whether the PTY spawned after the delete gets torn down.
    let wasSpawnedPtyKilled = false;
    internals.nodePtyModule = {
      spawn: () => {
        const spawned = makeSpawnedPty();
        const originalKill = spawned.pty.kill;
        spawned.pty.kill = () => {
          wasSpawnedPtyKilled = true;
          originalKill();
        };
        return spawned.pty;
      },
    };
    internals.nodePtyAvailable = true;

    // create() reserves a visible starting session before awaiting PTY loading, allowing the user to delete it during launch.
    const createPromise = manager.create("", PROJECT_ROOT, "claude");
    const startingId = manager.list()[0]?.id;
    assert.ok(startingId, "expected a starting reservation to be listed");
    // Simulate DELETE /api/terminal/<id> arriving mid-launch.
    assert.equal(manager.kill(startingId), true);

    // Resuming a deleted launch must terminate its PTY and leave the session list empty.
    await assert.rejects(createPromise, /cancelled during startup/);
    assert.equal(manager.list().length, 0);
    assert.equal(wasSpawnedPtyKilled, true);
  });
});
