/**
 * PTY-backed terminal session manager used by the dashboard.
 * It validates runner and project inputs, spawns CLI sessions, and brokers WebSocket traffic.
 */
import { randomUUID } from "node:crypto";
import { extname, resolve } from "node:path";
import { statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import type { WebSocket } from "ws";
import type {
  SessionInfo,
  SessionStatus,
  CreateResponse,
  HealthResponse,
  ServerMessage,
  Runner,
} from "./types.js";
import { decodeClientMessage } from "./decoders.js";

// node-pty types - optional dep, can't use static import
/** Lazily imported node-pty module type */
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- node-pty is an optional runtime dep; a static type import would break installs that skip the native module
type NodePtyModule = typeof import("node-pty");
/** PTY process instance type from node-pty */
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- same optional-dep constraint as NodePtyModule above
type IPty = ReturnType<typeof import("node-pty").spawn>;

/** Maximum number of concurrent terminal sessions allowed.
 *  Single source of truth consumed by the dashboard API, client guards, and docs. */
export const MAX_SESSIONS = 10;
const DEFAULT_IDLE_TIMEOUT_MINUTES = 480;

/** CLI binary names for each runner. */
const RUNNER_BINARIES: Record<Runner, string> = {
  claude: "claude",
  codex: "codex",
  gemini: "gemini",
  copilot: "copilot",
};

/** Flag to pass the initial prompt in interactive mode.
 *  `null` means the runner accepts the prompt as a positional argument. */
const RUNNER_PROMPT_FLAG: Record<Runner, string | null> = {
  claude: null,
  codex: null,
  gemini: "-i",
  copilot: "-i",
};
const WINDOWS_RUNNER_EXTENSION_PRIORITY = [
  ".exe",
  ".cmd",
  ".bat",
  ".com",
  ".ps1",
] as const;
const WINDOWS_TERMINAL_SHELL = "powershell.exe";

/** Maximum output to buffer while a session is detached (characters). */
const DETACH_BUFFER_LIMIT = 512 * 1024; // 512KB

/** Internal state for a single PTY terminal session */
interface TerminalSession {
  id: string;
  status: SessionStatus;
  createdAt: string;
  /** Selected target project for code evidence and dashboard grouping. */
  projectPath: string;
  /** Actual PTY working directory where the runner was spawned. */
  cwd: string;
  /** Explicit target project path passed to the launched agent. */
  targetPath: string;
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

interface TerminalSpawnSpec {
  shell: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

/** Pick the most runnable Windows runner path from a `where` result set. */
export function pickWindowsRunnerPath(
  candidates: readonly string[],
): string | null {
  const cleaned = Array.from(
    new Set(
      candidates
        .map((candidate) => candidate.trim())
        .filter((candidate) => {
          return candidate.length > 0;
        }),
    ),
  );
  if (cleaned.length === 0) return null;

  const rank = (candidate: string): number => {
    const ext = extname(candidate).toLowerCase();
    const index = WINDOWS_RUNNER_EXTENSION_PRIORITY.indexOf(
      ext as (typeof WINDOWS_RUNNER_EXTENSION_PRIORITY)[number],
    );
    return index === -1 ? WINDOWS_RUNNER_EXTENSION_PRIORITY.length : index;
  };

  cleaned.sort((left, right) => rank(left) - rank(right));
  return cleaned[0] ?? null;
}

/** Build the PTY shell invocation that keeps a usable terminal open per OS. */
export function buildTerminalSpawnSpec(
  runner: Runner,
  cliPath: string,
  prompt: string,
  environment: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): TerminalSpawnSpec {
  const flag = RUNNER_PROMPT_FLAG[runner];
  const hasPrompt = prompt.length > 0;
  const env: NodeJS.ProcessEnv = {
    ...environment,
    GOAT_RUNNER: cliPath,
    GOAT_PROMPT: prompt,
    GOAT_PROMPT_FLAG: flag ?? "",
    GOAT_PROMPT_PRESENT: hasPrompt ? "1" : "0",
  };

  if (platform === "win32") {
    return {
      shell: WINDOWS_TERMINAL_SHELL,
      args: [
        "-NoLogo",
        "-NoExit",
        "-Command",
        "if ($env:GOAT_PROMPT_PRESENT -eq '1') { if ($env:GOAT_PROMPT_FLAG) { & $env:GOAT_RUNNER $env:GOAT_PROMPT_FLAG $env:GOAT_PROMPT } else { & $env:GOAT_RUNNER $env:GOAT_PROMPT } } else { & $env:GOAT_RUNNER }",
      ],
      env,
    };
  }

  const shell = environment.SHELL || "/bin/bash";
  const shellCmd = hasPrompt
    ? flag
      ? `"$GOAT_RUNNER" ${flag} "$GOAT_PROMPT"; exec "$SHELL" -i`
      : `"$GOAT_RUNNER" "$GOAT_PROMPT"; exec "$SHELL" -i`
    : `"$GOAT_RUNNER"; exec "$SHELL" -i`;

  return {
    shell,
    args: ["-c", shellCmd],
    env: {
      ...env,
      SHELL: shell,
    },
  };
}

/** Resolve the absolute path to a CLI binary. Returns null if not found. */
function resolveCLIPath(name: string): string | null {
  if (process.platform === "win32") {
    try {
      const candidates = execFileSync("where", [name], {
        encoding: "utf-8",
        timeout: 5000,
      })
        .split(/\r?\n/)
        .map((candidate) => candidate.trim())
        .filter(Boolean);
      const preferred = pickWindowsRunnerPath(candidates);
      if (preferred) return preferred;
    } catch {
      /* fall through to direct probe */
    }

    try {
      execFileSync(name, ["--version"], { stdio: "ignore", timeout: 5000 });
      return name;
    } catch {
      return null;
    }
  }

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

/** Clamp a terminal dimension to a safe integer range. */
function clampDim(value: unknown, max: number, fallback: number): number {
  return Number.isInteger(value) &&
    (value as number) > 0 &&
    (value as number) <= max
    ? (value as number)
    : fallback;
}

/** Send a terminal message when the browser socket is still open. */
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
  private idleTimeoutMs: number | null;

  constructor(idleTimeoutMinutes?: number) {
    const minutes = idleTimeoutMinutes ?? DEFAULT_IDLE_TIMEOUT_MINUTES;
    this.idleTimeoutMs = minutes === 0 ? null : minutes * 60 * 1000;
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
        "node-pty failed to load. Run: npm rebuild node-pty (requires C++ build tools)",
      );
    }
  }

  /** Create a new terminal session for the requested runner and project. */
  async create(
    prompt: string,
    projectPath: string,
    runner: Runner = "claude",
    options: { targetPath?: string } = {},
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

    const validatedCwd = validateProjectPath(projectPath);
    const validatedTarget = validateProjectPath(
      options.targetPath || validatedCwd,
    );
    const nodePty = await this.loadNodePty();

    const id = randomUUID();
    const spawnSpec = buildTerminalSpawnSpec(runner, cliPath, prompt);

    console.log(
      `[terminal] Starting ${runner} session in ${validatedCwd} for target ${validatedTarget}`,
    );
    const pty = nodePty.spawn(spawnSpec.shell, spawnSpec.args, {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: validatedCwd,
      env: spawnSpec.env,
    });

    const session: TerminalSession = {
      id,
      status: "active",
      createdAt: new Date().toISOString(),
      projectPath: validatedTarget,
      cwd: validatedCwd,
      targetPath: validatedTarget,
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
      const text = typeof raw === "string" ? raw : raw.toString("utf-8");
      const decoded = decodeClientMessage(text);
      if (!decoded.ok) {
        sendMessage(ws, {
          type: "error",
          message: `${decoded.path}: ${decoded.error}`,
        });
        return;
      }
      const msg = decoded.value;

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
    const platform = process.platform;
    const platformHint =
      platform === "linux" || platform === "darwin" || platform === "win32"
        ? platform
        : undefined;
    return {
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
      activeSessions: Array.from(this.sessions.values()).filter(
        (s) => s.status === "active",
      ).length,
      nodePtyAvailable: this.nodePtyAvailable ?? false,
      availableRunners: Array.from(this.runnerPaths.keys()),
      platformHint,
      idleTimeoutMinutes:
        this.idleTimeoutMs === null
          ? 0
          : Math.round(this.idleTimeoutMs / 60000),
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
    if (this.idleTimeoutMs === null) return;
    const timeoutMs = this.idleTimeoutMs;
    const totalMins = Math.round(timeoutMs / 60000);
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    const label =
      h > 0 && m > 0 ? `${h}h ${m} min` : h > 0 ? `${h}h` : `${totalMins} min`;
    session.idleTimer = setTimeout(() => {
      if (session.ws) {
        sendMessage(session.ws, {
          type: "error",
          message: `Session killed: idle timeout (${label})`,
        });
      }
      this.killSession(session);
    }, timeoutMs);
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
      cwd: session.cwd,
      targetPath: session.targetPath,
      runner: session.runner,
      lastInputAt: session.lastInputAt,
    };
  }
}

export { resolveCLIPath, validateProjectPath };
