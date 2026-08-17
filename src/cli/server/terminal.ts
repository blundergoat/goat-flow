/**
 * PTY-backed terminal session manager used by the dashboard.
 * It validates runner and project inputs, spawns CLI sessions, and brokers WebSocket traffic.
 * Use when a user launches, reconnects to, or ends a runner from the Workspace UI.
 */
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import type { WebSocket } from "ws";
import type {
  SessionInfo,
  SessionStatus,
  CreateResponse,
  HealthResponse,
  Runner,
  TerminalAccessMode,
} from "./types.js";
import { decodeClientMessage } from "./decoders.js";
import { getAgentProfiles } from "../agents/registry.js";
import { validateProjectPath } from "./local-paths.js";
import {
  ensureQualityDraftStagingDirectory,
  startQualityDraftCapture,
  type QualityDraftCapture,
} from "./quality-draft-capture.js";

import { stagedQualityCaptureRoots } from "./terminal-reporting-profile.js";
import {
  buildTerminalSpawnSpec,
  chunkTerminalInput,
  clampDim,
  looksLikePromptSend,
  resolveCLIPath,
  sendMessage,
} from "./terminal-spawn.js";

export {
  buildTerminalSpawnSpec,
  chunkTerminalInput,
  INITIAL_PROMPT_CHUNK_SIZE,
  pickWindowsRunnerPath,
} from "./terminal-spawn.js";

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

const INITIAL_PROMPT_AFTER_OUTPUT_DELAY_MS = 150;
const INITIAL_PROMPT_FALLBACK_DELAY_MS = 5000;

const DETACH_BUFFER_LIMIT = 512 * 1024; // Buffer limit: 512KB preserves reconnect scrollback without unbounded server memory.

/** Internal session contract that keeps PTY resources and user-selected launch authority together. */
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
  accessMode: TerminalAccessMode;
  /** Whether retry/reconnect must restore the dashboard-owned quality receipt channel. */
  captureQualityDrafts: boolean;
  /** Validated mode-selected report owner, or null when this launch did not declare one. */
  qualityReportProjectPath: string | null;
  lastInputAt: number;
  pty: IPty | null;
  ws: WebSocket | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  /** Buffered PTY output accumulated while no WebSocket is attached. */
  detachBuffer: string[];
  /** Total character count in detachBuffer (for limit enforcement). */
  detachBufferSize: number;
  /** Staged-draft persistence pollers for enforced Claude reporting sessions (ADR-044). */
  qualityCaptures: QualityDraftCapture[];
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

/**
 * Own every dashboard PTY session from launch reservation through cleanup.
 * Use when Workspace users start, reconnect, send input to, or close runner terminals.
 * Public snapshots retain the access and report-capture intent needed for safe retries.
 */
class TerminalManager {
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

  /**
   * Reserve and create one runner terminal for the user's selected project.
   * The synchronous placeholder keeps double-clicks under the session cap, then becomes active or is released.
   */
  async create(
    prompt: string,
    projectPath: string,
    runner: Runner = "claude",
    options: {
      targetPath?: string;
      accessMode?: TerminalAccessMode;
      captureQualityDrafts?: boolean;
      qualityReportProjectPath?: string;
    } = {},
  ): Promise<CreateResponse> {
    const activeSessions = Array.from(this.sessions.values()).filter(
      (s) => s.status !== "terminated",
    ).length;
    // Cap is a hard ceiling: refuse once every slot is occupied.
    if (activeSessions >= MAX_SESSIONS) {
      throw new Error(
        `Maximum ${MAX_SESSIONS} concurrent sessions. Kill an existing session first.`,
      );
    }

    // Reserve the slot synchronously, before any await.
    // This placeholder counts toward the cap immediately (its status is not "terminated"), so a burst of concurrent creates that all clear the check
    // above can't each slip a session in while one of them is parked on the loadNodePty() await.
    const id = randomUUID();
    const session: TerminalSession = {
      id,
      status: "starting",
      createdAt: new Date().toISOString(),
      projectPath,
      cwd: projectPath,
      targetPath: projectPath,
      runner,
      accessMode: options.accessMode ?? "workspace",
      captureQualityDrafts: false,
      qualityReportProjectPath: null,
      lastInputAt: Date.now(),
      pty: null,
      ws: null,
      idleTimer: null,
      detachBuffer: [],
      detachBufferSize: 0,
      qualityCaptures: [],
    };
    this.sessions.set(id, session);

    try {
      return await this.startReservedSession(
        session,
        prompt,
        projectPath,
        options,
      );
    } catch (err) {
      // Any failure between reservation and activation frees the slot, so a
      // failed launch never permanently holds one of the MAX_SESSIONS slots.
      this.releaseReservedSession(session);
      throw err;
    }
  }

  /**
   * Launch the runner into an already-reserved session and promote it to `active`.
   * Runs after `create` has parked a `starting` placeholder in the session map; anything thrown here is cleaned up by `create`'s catch.
   * Kept separate from `create` so slot reservation stays synchronous while the spawn - which awaits node-pty - happens under the concurrency guard.
   *
   * @param session - the reserved session to launch and mutate to active
   * @param prompt - launch prompt delivered to the runner once it is ready
   * @param projectPath - requested working directory, validated here before spawn
   * @param options - optional explicit target path for the launched agent
   * @returns the create response describing the now-active session
   */
  // eslint-disable-next-line complexity -- Intentional because owner validation must precede staging, permissions, and spawn.
  private async startReservedSession(
    session: TerminalSession,
    prompt: string,
    projectPath: string,
    options: {
      targetPath?: string;
      accessMode?: TerminalAccessMode;
      captureQualityDrafts?: boolean;
      qualityReportProjectPath?: string;
    },
  ): Promise<CreateResponse> {
    const { id, runner } = session;
    const cliPath = this.runnerPaths.get(runner);
    // Runner binary missing: bail so create() releases the reserved slot.
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
    const validatedQualityReportProject = options.qualityReportProjectPath
      ? validateProjectPath(options.qualityReportProjectPath)
      : null;
    // A missing owner means this launch has no mode-specific report destination to restore later.
    const canonicalQualityReportProject =
      validatedQualityReportProject === null
        ? null
        : realpathSync(validatedQualityReportProject);
    let qualityReportProjectPath: string | null = null;
    // A supplied owner must remain one of the projects the user deliberately launched.
    if (canonicalQualityReportProject !== null) {
      const allowedReportOwner = [validatedCwd, validatedTarget].find(
        (rootPath) => realpathSync(rootPath) === canonicalQualityReportProject,
      );
      // A different owner could redirect a quality report into an unrelated project.
      if (!allowedReportOwner) {
        throw new Error(
          "Quality report owner must match the terminal workspace or selected target.",
        );
      }
      qualityReportProjectPath = allowedReportOwner;
    }
    // Staging must exist BEFORE the permission overlay is built below so a fresh target still receives its `.goat-flow/logs` write allow.
    // Failure here fails the launch closed: a staged-draft session must never start without a working persistence path.
    const reportingCaptureRoots = stagedQualityCaptureRoots(
      runner,
      session.accessMode,
      options.captureQualityDrafts === true,
      qualityReportProjectPath,
    );
    session.captureQualityDrafts = reportingCaptureRoots.length > 0;
    session.qualityReportProjectPath = qualityReportProjectPath;
    // Each capture root must exist before Claude receives permission to write its one draft.
    for (const captureRoot of reportingCaptureRoots) {
      ensureQualityDraftStagingDirectory(captureRoot);
    }
    const nodePty = await this.loadNodePty();

    const spawnSpec = buildTerminalSpawnSpec(
      runner,
      cliPath,
      prompt,
      process.env,
      process.platform,
      {
        accessMode: session.accessMode,
        projectPath: validatedCwd,
        targetPath: validatedTarget,
        ...(qualityReportProjectPath ? { qualityReportProjectPath } : {}),
      },
    );

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

    // A concurrent kill()/DELETE may have cancelled this reservation while we were awaiting loadNodePty() - e.g. the user closed the launching tab.
    // If the session was dropped from the map or marked terminated, kill the PTY we just spawned so it can't outlive its session, and abort instead
    // of resurrecting a deleted session (which would leak an untracked runner).
    if (this.sessions.get(id) !== session || session.status === "terminated") {
      try {
        pty.kill();
      } catch {
        /* already dead */
      }
      this.sessions.delete(id);
      throw new Error("Terminal session was cancelled during startup");
    }

    // PTY is live: promote the reservation to a real session and swap the
    // placeholder paths for the validated ones.
    session.status = "active";
    session.projectPath = validatedTarget;
    session.cwd = validatedCwd;
    session.targetPath = validatedTarget;
    session.pty = pty;
    session.lastInputAt = Date.now();
    for (const captureRoot of reportingCaptureRoots) {
      session.qualityCaptures.push(
        startQualityDraftCapture({ projectRoot: captureRoot }),
      );
    }

    let hasInitialInputSent = false;
    let initialInputTimer: ReturnType<typeof setTimeout> | null = null;
    const initialInputLatestDueAt =
      Date.now() + INITIAL_PROMPT_FALLBACK_DELAY_MS;
    let initialInputDueAt = 0;

    /** Send the launch prompt through the PTY, avoiding shell/native argv limits. */
    const sendInitialInput = (): void => {
      if (!spawnSpec.initialInput || hasInitialInputSent) return;
      const pty = session.pty;
      // Session already gone or PTY missing: nothing to type the prompt into.
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
        // A later or equal reschedule is redundant unless a reset is forced.
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
      // Browser attached: stream live; otherwise buffer for the next reconnect.
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
      this.disposeQualityCaptures(session);
      if (initialInputTimer) {
        clearTimeout(initialInputTimer);
        initialInputTimer = null;
        initialInputDueAt = 0;
      }
      // Tell the attached browser the runner exited so the UI can reflect it.
      if (session.ws) {
        sendMessage(session.ws, {
          type: "exit",
          code: exitCode,
          signal: signal?.toString() ?? null,
        });
      }
      this.clearIdleTimer(session);
    });

    this.resetIdleTimer(session);
    scheduleInitialInput(INITIAL_PROMPT_FALLBACK_DELAY_MS);

    return {
      id,
      status: session.status,
      wsUrl: `/ws/terminal/${id}`,
    };
  }

  /**
   * Release a reserved session after a failed launch: clear any idle timer, kill the PTY if one was spawned before the failure, and drop the
   * placeholder from the session map so the freed slot is reusable at once.
   *
   * Reports PTY cleanup errors as process warnings because the launch failure was already shown to the user.
   *
   * @param session - the reserved session whose slot is being freed; missing PTY means no terminal reached the UI
   * @returns nothing; the reserved slot disappears so the user can start another terminal
   */
  private releaseReservedSession(session: TerminalSession): void {
    this.clearIdleTimer(session);
    this.disposeQualityCaptures(session);
    // A PTY exists only if spawn succeeded but a later step failed; kill it.
    if (session.pty) {
      try {
        session.pty.kill();
      } catch (error) {
        // Cleanup warnings go to the operator while the UI still gets its freed terminal slot.
        process.emitWarning(
          error instanceof Error ? error : new Error(String(error)),
          "GoatFlowTerminalCleanupWarning",
        );
      }
    }
    this.sessions.delete(session.id);
  }

  /**
   * Attach a browser WebSocket to an existing terminal session.
   * Reports an error on the socket when the session is gone; the branching preserves detach semantics because a browser disconnect must not be
   * treated as a PTY exit.
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
    this.replayDetachBuffer(session, socket);

    socket.on("message", (raw: Buffer | string) => {
      this.handleClientMessage(session, socket, raw);
    });

    // WebSocket close means browser detach, not process exit; only the active socket may detach itself.
    socket.on("close", () => {
      if (session.ws === socket) {
        session.ws = null;
      }
    });
  }

  /**
   * Replay buffered PTY output to a newly attached socket so reconnects do not
   * lose terminal context gathered while detached, then drop the buffer.
   *
   * @param session - terminal session holding the detach buffer
   * @param socket - freshly attached browser WebSocket to replay into
   */
  private replayDetachBuffer(
    session: TerminalSession,
    socket: WebSocket,
  ): void {
    if (session.detachBuffer.length === 0) return;
    for (const chunk of session.detachBuffer) {
      sendMessage(socket, { type: "output", data: chunk });
    }
    session.detachBuffer = [];
    session.detachBufferSize = 0;
  }

  /**
   * Handle one client WebSocket payload: input keystrokes feed the PTY (with idle-timer reset and prompt tracing), resize messages clamp and apply
   * terminal dimensions, and undecodable payloads report an error to the socket.
   *
   * @param session - terminal session that owns the PTY the message targets
   * @param socket - browser WebSocket the payload arrived on
   * @param raw - wire payload as received (Buffer or string)
   */
  private handleClientMessage(
    session: TerminalSession,
    socket: WebSocket,
    raw: Buffer | string,
  ): void {
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
      return;
    }
    session.pty?.resize(
      clampDim(msg.cols, 500, 80),
      clampDim(msg.rows, 200, 24),
    );
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
    // Mark the session dead even if its PTY hasn't spawned yet - a "starting" reservation cancelled mid-launch has no PTY to kill, but flagging it
    // terminated lets the in-flight startReservedSession see the cancellation and tear down whatever it spawns instead of leaking an untracked
    // runner.
    if (session.status !== "terminated") {
      session.status = "terminated";
      if (session.pty) {
        try {
          session.pty.kill();
        } catch {
          /* already dead */
        }
      } else {
        // No runner exists, so no process can create another staged draft.
        this.disposeQualityCaptures(session);
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

  /** Swallows one staged-draft teardown error so every sibling capture still releases. */
  private disposeQualityCaptures(session: TerminalSession): void {
    for (const capture of session.qualityCaptures) {
      try {
        capture.dispose();
      } catch {
        // One capture failure cannot block sibling release or terminal teardown.
        continue;
      }
    }
    session.qualityCaptures = [];
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
      accessMode: session.accessMode,
      captureQualityDrafts: session.captureQualityDrafts,
      qualityReportProjectPath: session.qualityReportProjectPath,
      lastInputAt: session.lastInputAt,
    };
  }
}

export { TerminalManager, resolveCLIPath, validateProjectPath };
