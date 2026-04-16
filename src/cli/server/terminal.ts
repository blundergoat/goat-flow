/**
 * PTY-backed terminal session manager used by the dashboard.
 * It validates runner and project inputs, spawns CLI sessions, and brokers WebSocket traffic.
 */
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import type { WebSocket } from "ws";
import type {
  SessionInfo,
  SessionStatus,
  CreateResponse,
  HealthResponse,
  ClientMessage,
  ServerMessage,
  Runner,
} from "./types.js";

// node-pty types - optional dep, can't use static import
/** Lazily imported node-pty module type */
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type NodePtyModule = typeof import("node-pty");
/** PTY process instance type from node-pty */
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type IPty = ReturnType<typeof import("node-pty").spawn>;

/** Maximum number of concurrent terminal sessions allowed */
const MAX_SESSIONS = 3;
/** Idle timeout before a terminal session is automatically killed.
 *  Resets on both user input (ws 'input' message) and agent output (pty onData). */
const IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes

/** CLI binary names for each runner. */
const RUNNER_BINARIES: Record<Runner, string> = {
  claude: "claude",
  codex: "codex",
  gemini: "gemini",
};

/** Maximum output to buffer while a session is detached (characters). */
const DETACH_BUFFER_LIMIT = 512 * 1024; // 512KB

/** Internal state for a single PTY terminal session */
interface TerminalSession {
  id: string;
  status: SessionStatus;
  createdAt: string;
  projectPath: string;
  runner: Runner;
  lastInputAt: number;
  pty: IPty | null;
  ws: WebSocket | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  /** Buffered PTY output accumulated while no WebSocket is attached. */
  detachBuffer: string[];
  /** Total character count in detachBuffer (for limit enforcement). */
  detachBufferSize: number;
}

/** Resolve the absolute path to a CLI binary. Returns null if not found. */
function resolveCLIPath(name: string): string | null {
  try {
    execFileSync(name, ["--version"], { stdio: "ignore", timeout: 5000 });
    try {
      return execFileSync("which", [name], {
        encoding: "utf-8",
        timeout: 5000,
      }).trim();
    } catch {
      try {
        return (
          execFileSync("where", [name], { encoding: "utf-8", timeout: 5000 })
            .trim()
            .split("\n")[0]
            ?.trim() ?? null
        );
      } catch {
        return name; // Works via PATH even without absolute resolution
      }
    }
  } catch {
    return null;
  }
}

/** Validate that a project path is safe to use as a CWD. */
function validateProjectPath(projectPath: string): string {
  const resolved = resolve(projectPath);

  try {
    const stat = statSync(resolved);
    if (!stat.isDirectory()) {
      throw new Error(`Invalid project path: not a directory`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Invalid project path"))
      throw err;
    throw new Error(`Invalid project path: does not exist`);
  }

  return resolved;
}

/** Send a terminal event to the browser when the socket is still open. */
/** Clamp a terminal dimension to a safe integer range. */
function clampDim(value: unknown, max: number, fallback: number): number {
  return Number.isInteger(value) &&
    (value as number) > 0 &&
    (value as number) <= max
    ? (value as number)
    : fallback;
}

function sendMessage(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === 1) {
    // WebSocket.OPEN
    ws.send(JSON.stringify(msg));
  }
}

/** Manages PTY-backed terminal sessions for the dashboard */
export class TerminalManager {
  private sessions = new Map<string, TerminalSession>();
  private runnerPaths = new Map<Runner, string>();
  private nodePtyModule: NodePtyModule | null = null;
  private nodePtyAvailable: boolean | null = null;
  private startedAt = Date.now();

  constructor() {
    // Resolve all runner CLI paths at startup
    for (const [runner, binary] of Object.entries(RUNNER_BINARIES)) {
      const path = resolveCLIPath(binary);
      if (path) this.runnerPaths.set(runner as Runner, path);
    }
  }

  /** Lazy-load node-pty on first use. */
  private async loadNodePty(): Promise<NodePtyModule> {
    if (this.nodePtyModule) return this.nodePtyModule;
    try {
      this.nodePtyModule = await import("node-pty");
      this.nodePtyAvailable = true;
      return this.nodePtyModule;
    } catch {
      this.nodePtyAvailable = false;
      throw new Error(
        "node-pty is not available. Install it with: npm install node-pty",
      );
    }
  }

  /** Create a new terminal session for the requested runner and project. */
  async create(
    prompt: string,
    projectPath: string,
    runner: Runner = "claude",
  ): Promise<CreateResponse> {
    const activeSessions = Array.from(this.sessions.values()).filter(
      (s) => s.status !== "terminated",
    ).length;
    if (activeSessions >= MAX_SESSIONS) {
      throw new Error(
        `Maximum ${MAX_SESSIONS} concurrent sessions. Kill an existing session first.`,
      );
    }

    const cliPath = this.runnerPaths.get(runner);
    if (!cliPath) {
      console.warn(
        `[terminal] Runner "${runner}" not found. Available: ${[...this.runnerPaths.keys()].join(", ")}`,
      );
      throw new Error(`${runner} CLI not found. Install it first.`);
    }

    const validatedPath = validateProjectPath(projectPath);
    const nodePty = await this.loadNodePty();

    const id = randomUUID();

    // Wrap the runner in a login-ish shell so the PTY remains interactive after
    // the CLI exits - user can keep typing shell commands. Runner path and prompt
    // are passed via env vars (not interpolated into the command string) to avoid
    // shell-injection from user-controlled prompt text.
    const shell = process.env.SHELL || "/bin/bash";
    const shellCmd = prompt
      ? `"$GOAT_RUNNER" "$GOAT_PROMPT"; exec "$SHELL" -i`
      : `"$GOAT_RUNNER"; exec "$SHELL" -i`;

    console.log(`[terminal] Starting ${runner} session in ${validatedPath}`);
    const pty = nodePty.spawn(shell, ["-c", shellCmd], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: validatedPath,
      env: {
        ...process.env,
        GOAT_RUNNER: cliPath,
        GOAT_PROMPT: prompt ?? "",
        SHELL: shell,
      },
    });

    const session: TerminalSession = {
      id,
      status: "active",
      createdAt: new Date().toISOString(),
      projectPath: validatedPath,
      runner,
      lastInputAt: Date.now(),
      pty,
      ws: null,
      idleTimer: null,
      detachBuffer: [],
      detachBufferSize: 0,
    };

    // Wire PTY output at creation - routes to WebSocket if attached, buffer if detached
    pty.onData((data: string) => {
      if (session.ws) {
        this.resetIdleTimer(session);
        sendMessage(session.ws, { type: "output", data });
      } else if (session.detachBufferSize < DETACH_BUFFER_LIMIT) {
        session.detachBuffer.push(data);
        session.detachBufferSize += data.length;
      }
    });

    pty.onExit(({ exitCode, signal }) => {
      session.status = "terminated";
      if (session.ws) {
        sendMessage(session.ws, {
          type: "exit",
          code: exitCode,
          signal: signal?.toString() ?? null,
        });
      }
      this.clearIdleTimer(session);
    });

    this.sessions.set(id, session);
    this.resetIdleTimer(session);

    return {
      id,
      status: session.status,
      wsUrl: `/ws/terminal/${id}`,
    };
  }

  /** Attach a browser WebSocket to an existing terminal session. */
  attachWebSocket(id: string, ws: WebSocket): void {
    const session = this.sessions.get(id);
    if (!session || session.status === "terminated") {
      sendMessage(ws, {
        type: "error",
        message: "Session not found or already terminated",
      });
      ws.close();
      return;
    }

    // Close previous WebSocket if still open (e.g. stale connection)
    if (session.ws) {
      try {
        session.ws.close();
      } catch {
        /* already closed */
      }
    }

    session.ws = ws;

    // Replay buffered output accumulated while detached
    if (session.detachBuffer.length > 0) {
      for (const chunk of session.detachBuffer) {
        sendMessage(ws, { type: "output", data: chunk });
      }
      session.detachBuffer = [];
      session.detachBufferSize = 0;
    }

    ws.on("message", (raw: Buffer | string) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(
          typeof raw === "string" ? raw : raw.toString("utf-8"),
        ) as ClientMessage;
      } catch {
        sendMessage(ws, { type: "error", message: "Invalid JSON" });
        return;
      }

      if (msg.type === "input") {
        session.lastInputAt = Date.now();
        this.resetIdleTimer(session);
        session.pty?.write(msg.data);
      } else {
        session.pty?.resize(
          clampDim(msg.cols, 500, 80),
          clampDim(msg.rows, 200, 24),
        );
      }
    });

    // Detach on WebSocket close - session keeps running
    // Guard: only null if this socket is still the active one (prevents race with reconnect)
    ws.on("close", () => {
      if (session.ws === ws) {
        session.ws = null;
      }
    });
  }

  /** Return the public session snapshot for one terminal session ID. */
  get(id: string): SessionInfo | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    return this.toInfo(session);
  }

  /** Terminate a terminal session by ID. */
  kill(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    this.killSession(session);
    return true;
  }

  /** List every terminal session that is still considered live. */
  list(): SessionInfo[] {
    return Array.from(this.sessions.values())
      .filter((s) => s.status !== "terminated")
      .map((s) => this.toInfo(s));
  }

  /** Report terminal backend health and available runner binaries. */
  async health(): Promise<HealthResponse> {
    // Probe node-pty availability on first health check
    if (this.nodePtyAvailable === null) {
      try {
        await this.loadNodePty();
      } catch {
        /* sets nodePtyAvailable = false */
      }
    }
    return {
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
      activeSessions: Array.from(this.sessions.values()).filter(
        (s) => s.status === "active",
      ).length,
      nodePtyAvailable: this.nodePtyAvailable ?? false,
      availableRunners: Array.from(this.runnerPaths.keys()),
    };
  }

  /** Shut down every tracked session and notify attached clients. */
  shutdown(): void {
    for (const session of this.sessions.values()) {
      if (session.ws) {
        sendMessage(session.ws, { type: "shutdown" });
      }
      this.killSession(session);
    }
  }

  /** Tear down a terminal session and release its resources. */
  private killSession(session: TerminalSession): void {
    this.clearIdleTimer(session);
    if (session.pty && session.status !== "terminated") {
      session.status = "terminated";
      try {
        session.pty.kill();
      } catch {
        /* already dead */
      }
    }
    if (session.ws) {
      try {
        session.ws.close();
      } catch {
        /* already closed */
      }
      session.ws = null;
    }
    this.sessions.delete(session.id);
  }

  /** Reset the idle-timeout timer for a session. */
  private resetIdleTimer(session: TerminalSession): void {
    this.clearIdleTimer(session);
    session.idleTimer = setTimeout(() => {
      if (session.ws) {
        sendMessage(session.ws, {
          type: "error",
          message: "Session killed: idle timeout (60 min)",
        });
      }
      this.killSession(session);
    }, IDLE_TIMEOUT_MS);
  }

  /** Clear the idle-timeout timer for a session. */
  private clearIdleTimer(session: TerminalSession): void {
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = null;
    }
  }

  /** Convert an internal session record into its public response shape. */
  private toInfo(session: TerminalSession): SessionInfo {
    return {
      id: session.id,
      status: session.status,
      createdAt: session.createdAt,
      projectPath: session.projectPath,
      runner: session.runner,
      lastInputAt: session.lastInputAt,
    };
  }
}

export { resolveCLIPath, validateProjectPath };
