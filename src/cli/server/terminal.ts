/**
 * PTY-backed terminal session manager used by the dashboard.
 * It validates runner and project inputs, spawns CLI sessions, and brokers WebSocket traffic.
 */
import { randomUUID } from "node:crypto";
import { extname } from "node:path";
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
import { getAgentProfiles } from "../agents/registry.js";
import { validateProjectPath } from "./local-paths.js";

/** Shape of the optional node-pty module without making startup resolve the native package. */
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- because node-pty may be absent until a user opens a terminal
type NodePtyModule = typeof import("node-pty");
/** PTY process handle shape; kept lazy for the same optional native dependency boundary. */
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- because static type imports still require node-pty to resolve
type IPty = ReturnType<typeof import("node-pty").spawn>;

/** Maximum number of concurrent terminal sessions allowed.
 *  Single source of truth consumed by the dashboard API, client guards, and docs. */
export const MAX_SESSIONS = 10;
const DEFAULT_IDLE_TIMEOUT_MINUTES = 480; // Default limit: one workday keeps abandoned PTYs from surviving overnight.

const WINDOWS_RUNNER_EXTENSION_PRIORITY = [
  ".exe",
  ".cmd",
  ".bat",
  ".com",
  ".ps1",
] as const;
const WINDOWS_TERMINAL_SHELL = "powershell.exe";
const POSIX_PROMPT_ENV_CLEANUP = "unset GOAT_RUNNER";
const WINDOWS_PROMPT_ENV_CLEANUP =
  "Remove-Item Env:GOAT_RUNNER -ErrorAction SilentlyContinue";
const INITIAL_PROMPT_AFTER_OUTPUT_DELAY_MS = 150;
const INITIAL_PROMPT_FALLBACK_DELAY_MS = 5000;
export const INITIAL_PROMPT_CHUNK_SIZE = 2048;

const DETACH_BUFFER_LIMIT = 512 * 1024; // Buffer limit: 512KB preserves reconnect scrollback without unbounded server memory.

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

/** Shell, arguments, environment, and deferred input needed to launch a runner in a durable PTY. */
interface TerminalSpawnSpec {
  shell: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  initialInput: string | null;
}

type TerminalTraceEventKind = "terminal.send" | "prompt.send";

/** Redaction-ready input metadata emitted for terminal auditing without changing PTY delivery. */
export interface TerminalTraceEvent {
  eventKind: TerminalTraceEventKind;
  sessionId: string;
  projectPath: string;
  cwd: string;
  targetPath: string;
  runner: Runner;
  input: string;
  bytes: number;
}

/** Observer hook for terminal input traces; sink failures are isolated from session writes. */
export type TerminalTraceSink = (event: TerminalTraceEvent) => void;

/** Format a full prompt as one terminal paste submitted once to the runner. */
function formatInitialPromptInput(prompt: string): string {
  return "\x1b[200~" + prompt + "\x1b[201~" + "\r";
}

/**
 * Split terminal input into bounded chunks for PTY write reliability.
 *
 * @param input Full terminal payload to write.
 * @param chunkSize Maximum characters per PTY write; must be a positive integer.
 * @returns Ordered chunks that concatenate back to the original input.
 * @throws Error when `chunkSize` is not a positive integer.
 */
export function chunkTerminalInput(
  input: string,
  chunkSize = INITIAL_PROMPT_CHUNK_SIZE,
): string[] {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error("chunkSize must be a positive integer");
  }
  const chunks: string[] = [];
  for (let index = 0; index < input.length; index += chunkSize) {
    chunks.push(input.slice(index, index + chunkSize));
  }
  return chunks;
}

/**
 * Pick the most runnable Windows runner path from a `where` result set.
 *
 * @param candidates Raw paths returned by `where`, including possible blank or duplicate lines.
 * @returns The preferred executable-like path, or null when nothing usable remains.
 */
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

/**
 * Build the PTY shell invocation that keeps a usable terminal open per OS.
 *
 * @param _runner Runner identity retained so spawn-shape callers can stay runner-aware.
 * @param cliPath Absolute runner binary path to launch inside the shell.
 * @param prompt Optional launch prompt delivered through PTY input after startup.
 * @param environment Environment snapshot merged into the spawned process.
 * @param platform Platform selector used by tests and cross-platform launch planning.
 * @returns Spawn details plus deferred initial input; callers own the actual PTY spawn.
 */
export function buildTerminalSpawnSpec(
  _runner: Runner,
  cliPath: string,
  prompt: string,
  environment: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): TerminalSpawnSpec {
  const hasPrompt = prompt.length > 0;
  const env: NodeJS.ProcessEnv = {
    ...environment,
    GOAT_RUNNER: cliPath,
  };
  const initialInput = hasPrompt ? formatInitialPromptInput(prompt) : null;

  if (platform === "win32") {
    return {
      shell: WINDOWS_TERMINAL_SHELL,
      args: [
        "-NoLogo",
        "-NoExit",
        "-Command",
        `try { & $env:GOAT_RUNNER } finally { ${WINDOWS_PROMPT_ENV_CLEANUP} }`,
      ],
      env,
      initialInput,
    };
  }

  const configuredShell = environment.SHELL;
  const shell = configuredShell?.length ? configuredShell : "/bin/bash";
  const shellCmd = `"$GOAT_RUNNER"; ${POSIX_PROMPT_ENV_CLEANUP}; exec "$SHELL" -i`;

  return {
    shell,
    args: ["-c", shellCmd],
    env: {
      ...env,
      SHELL: shell,
    },
    initialInput,
  };
}

/**
 * Resolve a CLI binary by reading the process PATH through platform lookup tools.
 * Reads process state only; swallows lookup errors and reports them as null because missing runners are normal dashboard state.
 */
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
      return null;
    } catch {
      /* passive detection only; do not execute runner binaries at startup */
      return null;
    }
  }

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
      return null;
    }
  }
}

/** Clamp a terminal dimension to a safe integer range. */
function clampDim(
  dimensionValue: unknown,
  max: number,
  fallback: number,
): number {
  return Number.isInteger(dimensionValue) &&
    (dimensionValue as number) > 0 &&
    (dimensionValue as number) <= max
    ? (dimensionValue as number)
    : fallback;
}

/** Send a terminal message when the browser socket is still open. */
function sendMessage(socket: WebSocket, msg: ServerMessage): void {
  if (socket.readyState === 1) {
    // WebSocket.OPEN
    socket.send(JSON.stringify(msg));
  }
}

/** Detect bracketed paste sends so trace output can distinguish launch prompts from typing. */
function looksLikePromptSend(input: string): boolean {
  return input.includes("\x1b[200~");
}

/** Manages PTY-backed terminal sessions for the dashboard */
export class TerminalManager {
  private sessions = new Map<string, TerminalSession>();
  private runnerPaths = new Map<Runner, string>();
  private nodePtyModule: NodePtyModule | null = null;
  private nodePtyAvailable: boolean | null = null;
  private startedAt = Date.now();
  private readonly idleTimeoutMs: number | null;
  private readonly traceSink: TerminalTraceSink | null;

  /** Resolve available runner binaries once and convert idle-timeout minutes into timer state. */
  constructor(idleTimeoutMinutes?: number, traceSink?: TerminalTraceSink) {
    const minutes = idleTimeoutMinutes ?? DEFAULT_IDLE_TIMEOUT_MINUTES;
    this.idleTimeoutMs = minutes === 0 ? null : minutes * 60 * 1000;
    this.traceSink = traceSink ?? null;
    // Resolve all runner CLI paths at startup
    for (const profile of getAgentProfiles()) {
      const path = resolveCLIPath(profile.terminalBinary);
      if (path) this.runnerPaths.set(profile.id, path);
    }
  }

  /** Lazy-load node-pty on first use; throws a rebuild diagnostic when the native module is missing. */
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

    let hasInitialInputSent = false;
    let initialInputTimer: ReturnType<typeof setTimeout> | null = null;
    const initialInputLatestDueAt =
      Date.now() + INITIAL_PROMPT_FALLBACK_DELAY_MS;
    let initialInputDueAt = 0;

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

    /** Send the launch prompt through the PTY, avoiding shell/native argv limits. */
    const sendInitialInput = (): void => {
      if (!spawnSpec.initialInput || hasInitialInputSent) return;
      const pty = session.pty;
      if (session.status === "terminated" || !pty) return;
      hasInitialInputSent = true;
      if (initialInputTimer) {
        clearTimeout(initialInputTimer);
        initialInputTimer = null;
        initialInputDueAt = 0;
      }
      for (const chunk of chunkTerminalInput(spawnSpec.initialInput)) {
        pty.write(chunk);
      }
      session.lastInputAt = Date.now();
    };

    /** Schedule initial prompt delivery after the runner has had time to draw. */
    const scheduleInitialInput = (
      delayMs: number,
      { reset = false }: { reset?: boolean } = {},
    ): void => {
      if (!spawnSpec.initialInput || hasInitialInputSent) return;
      const now = Date.now();
      const boundedDelayMs = Math.max(
        0,
        Math.min(delayMs, initialInputLatestDueAt - now),
      );
      const nextDueAt = now + boundedDelayMs;
      if (initialInputTimer) {
        if (!reset && initialInputDueAt <= nextDueAt) return;
        clearTimeout(initialInputTimer);
      }
      initialInputDueAt = nextDueAt;
      initialInputTimer = setTimeout(sendInitialInput, boundedDelayMs);
    };

    // Wire PTY output at creation - routes to WebSocket if attached, buffer if detached
    pty.onData((data: string) => {
      scheduleInitialInput(INITIAL_PROMPT_AFTER_OUTPUT_DELAY_MS, {
        reset: true,
      });
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
      if (initialInputTimer) {
        clearTimeout(initialInputTimer);
        initialInputTimer = null;
        initialInputDueAt = 0;
      }
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
    scheduleInitialInput(INITIAL_PROMPT_FALLBACK_DELAY_MS);

    return {
      id,
      status: session.status,
      wsUrl: `/ws/terminal/${id}`,
    };
  }

  /**
   * Attach a browser WebSocket to an existing terminal session.
   * Reports an error on the socket when the session is gone; the branching preserves detach semantics
   * because a browser disconnect must not be treated as a PTY exit.
   */
  attachWebSocket(id: string, socket: WebSocket): void {
    const session = this.sessions.get(id);
    if (!session || session.status === "terminated") {
      sendMessage(socket, {
        type: "error",
        message: "Session not found or already terminated",
      });
      socket.close();
      return;
    }

    // Only one browser owns live output at a time; reconnects replace stale sockets while the PTY keeps running.
    if (session.ws) {
      try {
        session.ws.close();
      } catch {
        /* already closed */
      }
    }

    session.ws = socket;

    // Replay buffered output so reconnects do not lose terminal context gathered while detached.
    if (session.detachBuffer.length > 0) {
      for (const chunk of session.detachBuffer) {
        sendMessage(socket, { type: "output", data: chunk });
      }
      session.detachBuffer = [];
      session.detachBufferSize = 0;
    }

    socket.on("message", (raw: Buffer | string) => {
      const text = typeof raw === "string" ? raw : raw.toString("utf-8");
      const decoded = decodeClientMessage(text);
      if (!decoded.ok) {
        sendMessage(socket, {
          type: "error",
          message: `${decoded.path}: ${decoded.error}`,
        });
        return;
      }
      const msg = decoded.value;

      if (msg.type === "input") {
        session.lastInputAt = Date.now();
        this.resetIdleTimer(session);
        this.traceTerminalInput(session, "terminal.send", msg.data);
        if (looksLikePromptSend(msg.data)) {
          this.traceTerminalInput(session, "prompt.send", msg.data);
        }
        session.pty?.write(msg.data);
      } else {
        session.pty?.resize(
          clampDim(msg.cols, 500, 80),
          clampDim(msg.rows, 200, 24),
        );
      }
    });

    // WebSocket close means browser detach, not process exit; only the active socket may detach itself.
    socket.on("close", () => {
      if (session.ws === socket) {
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

  /** Report terminal backend health; node-pty probe errors recover into an unavailable status. */
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

  /** Tear down a terminal session; swallows kill/close races because either side may already be gone. */
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

  /** Emit redaction-ready input metadata; tracing errors never affect PTY writes. */
  private traceTerminalInput(
    session: TerminalSession,
    eventKind: TerminalTraceEventKind,
    input: string,
  ): void {
    try {
      this.traceSink?.({
        eventKind,
        sessionId: session.id,
        projectPath: session.projectPath,
        cwd: session.cwd,
        targetPath: session.targetPath,
        runner: session.runner,
        input,
        bytes: Buffer.byteLength(input, "utf-8"),
      });
    } catch {
      /* trace sink failures must not affect terminal input */
    }
  }

  /** Reset the idle-timeout timer after activity because each session must have at most one expiry path. */
  private resetIdleTimer(session: TerminalSession): void {
    this.clearIdleTimer(session);
    if (this.idleTimeoutMs === null) return;
    const timeoutMs = this.idleTimeoutMs;
    const totalMins = Math.round(timeoutMs / 60000);
    const hours = Math.floor(totalMins / 60);
    const minutes = totalMins % 60;
    const label =
      hours > 0 && minutes > 0
        ? `${hours}h ${minutes} min`
        : hours > 0
          ? `${hours}h`
          : `${totalMins} min`;
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
