/**
 * Terminal-specific dashboard server wiring.
 * This keeps terminal HTTP routes, WebSocket upgrades, startup health checks, and shutdown handling out of the main dashboard HTTP server.
 */
import type {
  IncomingMessage,
  Server as HttpServer,
  ServerResponse,
} from "node:http";
import type { Duplex } from "node:stream";
import type { WebSocketServer } from "ws";
import {
  decodeTerminalCreateBody,
  decodeTerminalUploadBody,
} from "./decoders.js";
import type { Runner, TerminalAccessMode } from "./types.js";
import type { TerminalManager } from "./terminal.js";
import { MAX_SESSIONS } from "./terminal.js";
import {
  buildAttachmentNote,
  persistUploads,
  TERMINAL_UPLOAD_MAX_BODY_BYTES,
  TERMINAL_UPLOAD_MAX_FILES,
  uploadDirForSession,
} from "./terminal-uploads.js";
import {
  recordEvidenceEvent,
  type EvidenceEventKind,
  type EvidencePayload,
} from "../evidence/envelope.js";
import { redactEvidenceText } from "../evidence/redaction.js";
import type { TerminalTraceEvent } from "./terminal.js";

type JsonResponder = (
  res: ServerResponse,
  status: number,
  body: unknown,
) => void;

/** Request-body limits used by terminal create and upload endpoints. */
interface BodyReadOptions {
  maxBytes?: number;
  tooLargeMessage?: string;
}

type BodyReader = (
  req: IncomingMessage,
  options?: BodyReadOptions,
) => Promise<string>;

/** Dependencies injected by the dashboard server so terminal handlers stay route-local and testable. */
interface DashboardTerminalDependencies {
  absDefault: string;
  validRunners: ReadonlySet<string>;
  defaultRunner: Runner;
  jsonResponse: JsonResponder;
  readBody: BodyReader;
  idleTimeoutMinutes?: number;
}

/** Validated terminal launch request after path, runner, and prompt decoding. */
interface DecodedTerminalCreate {
  prompt: string;
  projectPath: string;
  targetPath: string;
  runner: Runner;
  accessMode: TerminalAccessMode;
  captureQualityDrafts: boolean;
  qualityReportProjectPath: string;
}

/** Everything the terminal routes share for one dashboard run: the lazily created backends plus the wiring the server handed in. */
interface TerminalHandlerContext {
  absDefault: string;
  validRunners: ReadonlySet<string>;
  defaultRunner: Runner;
  jsonResponse: JsonResponder;
  readBody: BodyReader;
  /** Load the terminal manager, creating it on first use so a dashboard that never opens a terminal never loads node-pty. */
  getManager: () => Promise<TerminalManager>;
  /** Load the WebSocket server that bridges browser terminals to PTY sessions, created on first upgrade. */
  getWSS: () => Promise<WebSocketServer>;
  /** Record one terminal evidence event against the project that owns it. */
  recordTerminalEvent: (
    projectPath: string,
    eventKind: EvidenceEventKind,
    payload?: EvidencePayload,
  ) => void;
}

/** Turn any thrown value into the message the dashboard shows the user. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Map a terminal-launch failure to the HTTP status the dashboard reads.
 *
 * The split matters to the user: a 400 means they picked something the launch cannot accept - a missing CLI, a path that is
 * not a directory, too many sessions - and is worth fixing and retrying, while a 500 means the server itself broke.
 *
 * @param message - the failure message thrown by the launch
 * @returns 400 for a request the user can correct, 500 for anything else
 */
function terminalCreateStatus(message: string): number {
  return message.includes("Local path validation failed") ||
    message.includes("Maximum") ||
    message.includes("not found") ||
    message.includes("not available") ||
    message.includes("not a directory") ||
    message.includes("does not exist") ||
    message.includes("too large")
    ? 400
    : 500;
}

/** Print the terminal-unavailable notice with the rebuild steps that usually fix it. */
function logTerminalUnavailableNotice(): void {
  console.log("Note: Terminal feature unavailable (node-pty failed to load)");
  console.log("  Fix: npm rebuild node-pty (requires C++ build tools)");
  console.log("  pnpm: pnpm approve-builds");
  console.log(
    "  See: https://github.com/blundergoat/goat-flow#troubleshooting",
  );
}

/**
 * Read the raw upload body up to TERMINAL_UPLOAD_MAX_BODY_BYTES.
 *
 * Separate from the dashboard's 64KB readBody so other endpoints stay capped tightly while a user dragging screenshots into
 * a terminal can still send several MiB of base64.
 *
 * @param req - the upload request whose body is read
 * @returns the body text; rejects with "Upload body too large" once the cap is passed, having dropped what it buffered
 */
function readUploadBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let isTooLarge = false;

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      // Already over the cap: keep draining the socket but hold nothing, so an oversized upload cannot fill memory.
      if (isTooLarge) return;
      if (size > TERMINAL_UPLOAD_MAX_BODY_BYTES) {
        isTooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      // The user dragged in more than the endpoint accepts, so the whole upload is refused rather than silently trimmed.
      if (isTooLarge) {
        rejectBody(new Error("Upload body too large"));
        return;
      }
      resolveBody(Buffer.concat(chunks).toString("utf-8"));
    });
    req.on("error", rejectBody);
  });
}

/**
 * Start one backend terminal session and resolve the paths it actually ended up using.
 *
 * The manager may substitute its own target path, so the resolved value is read back rather than assumed; falling through
 * to the request path and finally the server default keeps every session attributable to some project.
 *
 * @param manager - terminal manager owning session lifecycle
 * @param decoded - validated create request
 * @param absDefault - the dashboard's own project, used when the request named no path at all
 * @returns the create result, the live session if the manager still holds it, and the resolved target path for
 *   evidence; it starts a backend PTY session, so a returned session is a live process
 */
async function createTerminalSession(
  manager: TerminalManager,
  decoded: DecodedTerminalCreate,
  absDefault: string,
) {
  const {
    prompt,
    projectPath,
    targetPath,
    runner,
    accessMode,
    captureQualityDrafts,
    qualityReportProjectPath,
  } = decoded;
  const result = await manager.create(
    prompt,
    projectPath || absDefault,
    runner,
    {
      targetPath: targetPath || projectPath || absDefault,
      accessMode,
      captureQualityDrafts,
      qualityReportProjectPath,
    },
  );
  const session = manager.get(result.id);
  return {
    result,
    session,
    resolvedTargetPath:
      session?.targetPath || targetPath || projectPath || absDefault,
  };
}

/**
 * Record the create event, and the prompt event when the launch carried prompt text.
 *
 * Side effect: writes one or two evidence events.
 *
 * @param decoded - validated create request supplying runner, access mode, and prompt
 * @param sessionId - id of the session just created
 * @param session - live session if still held, used for its resolved working directory
 * @param resolvedTargetPath - project the events are attributed to
 * @param ctx - shared handler context, used for the evidence recorder and the server default path
 * @returns nothing; a user who launched without typing a prompt records only the create event
 */
function recordTerminalLaunchEvents(
  decoded: DecodedTerminalCreate,
  sessionId: string,
  session: ReturnType<TerminalManager["get"]>,
  resolvedTargetPath: string,
  ctx: TerminalHandlerContext,
): void {
  const { prompt, projectPath, runner, accessMode } = decoded;
  ctx.recordTerminalEvent(resolvedTargetPath, "terminal.create", {
    session_id: sessionId,
    runner,
    cwd: session?.cwd || projectPath || ctx.absDefault,
    target_path: resolvedTargetPath,
    access_mode: accessMode,
  });
  // An empty prompt means the user just opened a terminal, so there is no prompt worth recording.
  if (prompt.trim().length > 0) {
    ctx.recordTerminalEvent(resolvedTargetPath, "prompt.launch", {
      session_id: sessionId,
      runner,
      prompt: redactEvidenceText("terminal launch prompt", prompt),
    });
  }
}

/**
 * Warn once at startup when terminals will not work on this machine.
 *
 * The user would otherwise only find out by clicking Launch and getting a failure, so the fix is printed while they are
 * still reading the startup output.
 *
 * @param ctx - shared handler context, used to load the terminal manager and probe it
 * @returns nothing; a healthy backend prints no notice at all, and it swallows a failed health probe into the same
 *   notice rather than throwing during startup
 */
function logStartupNotice(ctx: TerminalHandlerContext): void {
  void ctx
    .getManager()
    .then((manager) => manager.health())
    .then((health) => {
      // node-pty missing means every Launch button in the Workspace UI would fail.
      if (!health.nodePtyAvailable) logTerminalUnavailableNotice();
    })
    .catch(() => {
      /* ignore: the probe itself failing means the same thing to the user - no terminals */
      logTerminalUnavailableNotice();
    });
}

/**
 * Start a terminal session for the requested runner and workspace.
 *
 * This is what a user's click on Launch reaches: the request names a runner, a project, and an optional prompt.
 *
 * @param req - the incoming request; only POST is handled
 * @param url - parsed request URL; anything other than `/api/terminal/create` is left for the next route
 * @param res - response written with the new session, or the reason the launch was refused
 * @param ctx - shared handler context
 * @returns true when this route claimed the request; it throws nothing, and reports a rejected launch as a JSON
 *   error whose status is derived from the failure message, so the dashboard can tell a bad request from a fault
 */
async function handleTerminalCreateRequest(
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
  ctx: TerminalHandlerContext,
): Promise<boolean> {
  if (url.pathname !== "/api/terminal/create" || req.method !== "POST") {
    return false;
  }

  try {
    const manager = await ctx.getManager();
    const decoded = decodeTerminalCreateBody(await ctx.readBody(req), {
      validRunners: ctx.validRunners,
      defaultRunner: ctx.defaultRunner,
    });
    // A rejected body names the exact field at fault, so the dashboard can point at it rather than saying "bad request".
    if (!decoded.ok) {
      ctx.jsonResponse(res, 400, { error: decoded.error, path: decoded.path });
      return true;
    }

    const { result, session, resolvedTargetPath } = await createTerminalSession(
      manager,
      decoded.value,
      ctx.absDefault,
    );
    recordTerminalLaunchEvents(
      decoded.value,
      result.id,
      session,
      resolvedTargetPath,
      ctx,
    );
    ctx.jsonResponse(res, 200, result);
  } catch (err) {
    const message = errorMessage(err);
    ctx.jsonResponse(res, terminalCreateStatus(message), { error: message });
  }
  return true;
}

/**
 * Return the set of currently live terminal sessions.
 *
 * Error behavior: throws nothing; a manager failure reports as a 500 JSON error.
 *
 * @param req - the incoming request; only GET is handled
 * @param url - parsed request URL; anything other than `/api/terminal/list` is left for the next route
 * @param res - response written with the session list, which is empty when nothing is running
 * @param ctx - shared handler context
 * @returns true when this route claimed the request
 */
async function handleTerminalListRequest(
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
  ctx: TerminalHandlerContext,
): Promise<boolean> {
  if (url.pathname !== "/api/terminal/list" || req.method !== "GET") {
    return false;
  }

  try {
    const manager = await ctx.getManager();
    ctx.jsonResponse(res, 200, manager.list());
  } catch (err) {
    ctx.jsonResponse(res, 500, { error: errorMessage(err) });
  }
  return true;
}

/**
 * Kill one terminal session and report whether it existed.
 *
 * This is the user closing a terminal tab or clearing a stale row from the recent-sessions list.
 *
 * @param req - the incoming request; only DELETE is handled
 * @param url - parsed request URL carrying the session id after `/api/terminal/`
 * @param res - response written with the outcome; a 404 means the session was already gone
 * @param ctx - shared handler context
 * @returns true when this route claimed the request; it throws nothing, reports a manager failure as a 500 JSON
 *   error, and treats an unknown session id as a normal negative result rather than a fault
 */
async function handleTerminalDeleteRequest(
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
  ctx: TerminalHandlerContext,
): Promise<boolean> {
  if (!url.pathname.startsWith("/api/terminal/") || req.method !== "DELETE") {
    return false;
  }

  const id = url.pathname.slice("/api/terminal/".length);
  try {
    const manager = await ctx.getManager();
    const session = manager.get(id);
    const killed = manager.kill(id);
    // Nothing was killed, so the id names a session this server no longer has.
    if (!killed) {
      ctx.jsonResponse(res, 404, { error: "Session not found" });
      return true;
    }
    // A session record survives long enough to attribute the close; without one there is nothing to attribute it to.
    if (session) {
      ctx.recordTerminalEvent(
        session.targetPath || session.projectPath,
        "terminal.delete",
        { session_id: id, runner: session.runner, status: session.status },
      );
    }
    ctx.jsonResponse(res, 200, { ok: true });
  } catch (err) {
    ctx.jsonResponse(res, 500, { error: errorMessage(err) });
  }
  return true;
}

/**
 * Find the session an upload names, refusing anything that cannot receive files.
 *
 * Each refusal is its own status so the dashboard can tell the user which rule the drop broke: the terminal is gone, it has
 * already exited, or it has no project folder to save into.
 *
 * @param sessionId - session id taken from the upload URL
 * @param res - response written with the refusal when the session cannot take an upload
 * @param ctx - shared handler context
 * @returns the session ready to receive files, or null when a refusal has already been written
 */
async function resolveUploadTargetSession(
  sessionId: string,
  res: ServerResponse,
  ctx: TerminalHandlerContext,
): Promise<ReturnType<TerminalManager["get"]> | null> {
  const manager = await ctx.getManager();
  const session = manager.get(sessionId);

  // The terminal was closed between the user picking the file and the drop landing.
  if (!session) {
    ctx.jsonResponse(res, 404, { error: "Session not found" });
    return null;
  }
  // A terminated or still-starting session has no live runner to hand the attachment to.
  if (session.status !== "active") {
    ctx.jsonResponse(res, 409, {
      error: `Session is ${session.status}; uploads require an active session`,
    });
    return null;
  }
  // Without a target project there is no folder on disk that the upload belongs in.
  if (!session.targetPath) {
    ctx.jsonResponse(res, 409, {
      error: "Session has no target path; cannot resolve upload directory",
    });
    return null;
  }
  return session;
}

/**
 * Save the accepted files and answer with what landed, what was refused, and the note to paste into the terminal.
 *
 * Side effect: writes files under the session's upload directory and records an upload evidence event.
 *
 * @param session - the active session receiving the files
 * @param sessionId - session id, used for the upload directory and the evidence event
 * @param files - the decoded files from the request body
 * @param res - response written with the accepted and rejected lists
 * @param ctx - shared handler context
 * @returns nothing; an upload where every file was refused still answers 200 with an empty accepted list
 */
function persistUploadedFiles(
  session: NonNullable<ReturnType<TerminalManager["get"]>>,
  sessionId: string,
  files: Parameters<typeof persistUploads>[1],
  res: ServerResponse,
  ctx: TerminalHandlerContext,
): void {
  const uploadDir = uploadDirForSession(session.targetPath, sessionId);
  const result = persistUploads(uploadDir, files);
  const note = buildAttachmentNote(result.accepted);

  ctx.recordTerminalEvent(session.targetPath, "terminal.upload", {
    session_id: sessionId,
    runner: session.runner,
    accepted_count: result.accepted.length,
    rejected_count: result.rejected.length,
    bytes: result.accepted.reduce((total, file) => total + file.bytes, 0),
  });
  ctx.jsonResponse(res, 200, {
    accepted: result.accepted.map((file) => ({
      originalName: file.originalName,
      savedName: file.savedName,
      savedRelPath: file.savedRelPath,
      bytes: file.bytes,
    })),
    rejected: result.rejected,
    note,
  });
}

/**
 * Accept dragged image files for the active terminal session.
 *
 * A user drops a screenshot onto a running terminal; the files are saved beside the project and a note naming them is
 * returned for the agent to read.
 *
 * @param req - the incoming request; only POST is handled
 * @param url - parsed request URL carrying the session id
 * @param res - response written with the saved files, or the reason the drop was refused
 * @param ctx - shared handler context
 * @returns true when this route claimed the request; it throws nothing, and reports each rejection class as its own
 *   JSON status so the dashboard can name the rule the drop broke rather than a generic failure
 */
async function handleTerminalUploadRequest(
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
  ctx: TerminalHandlerContext,
): Promise<boolean> {
  const match = url.pathname.match(/^\/api\/terminal\/([^/]+)\/upload-image$/u);
  if (!match || req.method !== "POST") return false;

  const sessionId = match[1] ?? "";
  // A session id with anything but safe characters could steer the upload directory somewhere it should not go.
  if (!/^[a-zA-Z0-9_-]+$/u.test(sessionId)) {
    ctx.jsonResponse(res, 400, { error: "Invalid session id" });
    return true;
  }

  let body: string;
  try {
    body = await readUploadBody(req);
  } catch (err) {
    /* The user dropped more than the endpoint accepts, so this reports the size limit rather than a server fault. */
    ctx.jsonResponse(res, 413, { error: errorMessage(err) });
    return true;
  }

  const decoded = decodeTerminalUploadBody(body, {
    maxFiles: TERMINAL_UPLOAD_MAX_FILES,
  });
  // A rejected body names the exact file at fault, so the dashboard can say which one it refused.
  if (!decoded.ok) {
    ctx.jsonResponse(res, 400, { error: decoded.error, path: decoded.path });
    return true;
  }

  try {
    const session = await resolveUploadTargetSession(sessionId, res, ctx);
    // A null session means the refusal has already been written, so there is nothing left to answer.
    if (session) {
      persistUploadedFiles(session, sessionId, decoded.value.files, res, ctx);
    }
  } catch (err) {
    ctx.jsonResponse(res, 500, { error: errorMessage(err) });
  }
  return true;
}

/**
 * Return terminal-backend health details for dashboard diagnostics.
 *
 * Error behavior: throws nothing; a manager failure reports as a 500 JSON error, which the dashboard reads as terminals
 * being unavailable.
 *
 * @param req - the incoming request; only GET is handled
 * @param url - parsed request URL; anything other than `/api/health` is left for the next route
 * @param res - response written with the health detail
 * @param ctx - shared handler context
 * @returns true when this route claimed the request
 */
async function handleHealthRequest(
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
  ctx: TerminalHandlerContext,
): Promise<boolean> {
  if (url.pathname !== "/api/health" || req.method !== "GET") return false;

  try {
    const manager = await ctx.getManager();
    ctx.jsonResponse(res, 200, await manager.health());
  } catch (err) {
    ctx.jsonResponse(res, 500, { error: errorMessage(err) });
  }
  return true;
}

/**
 * Return terminal session info enriched with how old and how idle each session is.
 *
 * Those two numbers are what the Workspace list shows under each row, so a user can see which terminal has been sitting
 * untouched before deciding what to clear.
 *
 * @param req - the incoming request; only GET is handled
 * @param url - parsed request URL; anything other than `/api/terminal/sessions` is left for the next route
 * @param res - response written with the enriched sessions and the server's session cap
 * @param ctx - shared handler context
 * @returns true when this route claimed the request; it throws nothing and reports a manager failure as a 500 error
 */
async function handleTerminalSessionsRequest(
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
  ctx: TerminalHandlerContext,
): Promise<boolean> {
  if (url.pathname !== "/api/terminal/sessions" || req.method !== "GET") {
    return false;
  }

  try {
    const manager = await ctx.getManager();
    const sessions = manager.list();
    const now = Date.now();
    // Ages are computed per row here so the browser does not have to know the server's clock.
    const enriched = sessions.map((session) => ({
      ...session,
      age: Math.floor((now - new Date(session.createdAt).getTime()) / 1000),
      idleDuration: Math.floor((now - session.lastInputAt) / 1000),
    }));
    ctx.jsonResponse(res, 200, {
      sessions: enriched,
      maxSessions: MAX_SESSIONS,
      activeCount: sessions.length,
    });
  } catch (err) {
    ctx.jsonResponse(res, 500, { error: errorMessage(err) });
  }
  return true;
}

/**
 * Handle terminal WebSocket upgrades and reject bad origins.
 *
 * This is the socket behind a live terminal pane, so a page from anywhere but this server is refused before the handshake.
 *
 * @param req - the upgrade request
 * @param socket - raw socket, destroyed when the origin is refused or the attach fails
 * @param head - the first packet of the upgraded stream
 * @param server - the running dashboard server, read for the port it bound
 * @param ctx - shared handler context
 * @returns true when this handler claimed the upgrade; it throws nothing, and a disallowed origin destroys the
 *   socket rather than answering, because an upgrade that failed origin checks has no trusted channel to reply on
 */
function handleTerminalUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  server: HttpServer,
  ctx: TerminalHandlerContext,
): boolean {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (!url.pathname.startsWith("/ws/terminal/")) return false;

  const origin = req.headers.origin;
  const addr = server.address();
  // No Origin, or no bound port to compare it against, leaves nothing this check can prove either way.
  if (origin && addr && typeof addr !== "string") {
    const expected = `http://127.0.0.1:${addr.port}`;
    // An Origin from any other page means something outside this dashboard is trying to open a shell.
    if (origin !== expected && origin !== `http://localhost:${addr.port}`) {
      socket.destroy();
      return true;
    }
  }

  const sessionId = url.pathname.slice("/ws/terminal/".length);
  void (async () => {
    try {
      const wss = await ctx.getWSS();
      const manager = await ctx.getManager();
      wss.handleUpgrade(req, socket, head, (ws) => {
        manager.attachWebSocket(sessionId, ws);
      });
    } catch {
      /* ignore: the terminal simply fails to open, and closing the socket is what the browser needs to see */
      socket.destroy();
    }
  })();
  return true;
}

/**
 * Build the terminal-only dashboard handlers for one server instance.
 *
 * Every handler shares one lazily created manager, WebSocket server, and shutdown promise, because those are per-server
 * singletons that must be created at most once and torn down together.
 *
 * @param deps - server-local dependencies and limits shared by terminal routes
 * @returns terminal route handlers plus the shutdown hook for active sessions; each route reports its own failure
 *   as a JSON response and throws nothing, so one bad request cannot take the server down
 */
export function createDashboardTerminalHandlers(
  deps: DashboardTerminalDependencies,
): {
  handleTerminalCreateRequest: (
    req: IncomingMessage,
    url: URL,
    res: ServerResponse,
  ) => Promise<boolean>;
  handleTerminalListRequest: (
    req: IncomingMessage,
    url: URL,
    res: ServerResponse,
  ) => Promise<boolean>;
  handleTerminalDeleteRequest: (
    req: IncomingMessage,
    url: URL,
    res: ServerResponse,
  ) => Promise<boolean>;
  handleTerminalUploadRequest: (
    req: IncomingMessage,
    url: URL,
    res: ServerResponse,
  ) => Promise<boolean>;
  handleHealthRequest: (
    req: IncomingMessage,
    url: URL,
    res: ServerResponse,
  ) => Promise<boolean>;
  handleTerminalSessionsRequest: (
    req: IncomingMessage,
    url: URL,
    res: ServerResponse,
  ) => Promise<boolean>;
  handleTerminalUpgrade: (
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    server: HttpServer,
  ) => boolean;
  logStartupNotice: () => void;
  close: () => Promise<void>;
} {
  let managerPromise: Promise<TerminalManager> | null = null;
  let wssPromise: Promise<WebSocketServer> | null = null;
  let closePromise: Promise<void> | null = null;

  /**
   * Record one terminal evidence event against the project that owns it.
   * Side effect: writes an evidence event through the shared recorder.
   */
  const recordTerminalEvent = (
    projectPath: string,
    eventKind: EvidenceEventKind,
    payload?: EvidencePayload,
  ): void => {
    recordEvidenceEvent({
      producer: "dashboard-session-trace",
      actor: "server",
      eventType: eventKind,
      projectRoot: projectPath,
      payload,
    });
  };

  /** Record terminal input trace events without forcing callers to know whether tracing is enabled. */
  const recordTerminalTraceInput = (event: TerminalTraceEvent): void => {
    recordTerminalEvent(event.projectPath, event.eventKind, {
      session_id: event.sessionId,
      runner: event.runner,
      cwd: event.cwd,
      target_path: event.targetPath,
      bytes: event.bytes,
      input: redactEvidenceText("terminal input", event.input),
    });
  };

  const ctx: TerminalHandlerContext = {
    absDefault: deps.absDefault,
    validRunners: deps.validRunners,
    defaultRunner: deps.defaultRunner,
    jsonResponse: deps.jsonResponse,
    readBody: deps.readBody,
    recordTerminalEvent,
    getManager: async () => {
      managerPromise ??= import("./terminal.js").then(
        ({ TerminalManager: TM }) =>
          new TM(deps.idleTimeoutMinutes, recordTerminalTraceInput),
      );
      return managerPromise;
    },
    getWSS: async () => {
      wssPromise ??= import("ws").then(
        ({ WebSocketServer: WSS }) => new WSS({ noServer: true }),
      );
      return wssPromise;
    },
  };

  /** Close terminal resources with one shared promise because shutdown can be triggered from tests and signals. */
  async function close(): Promise<void> {
    closePromise ??= closeTerminalBackends(
      () => managerPromise,
      () => wssPromise,
    );
    return closePromise;
  }

  return {
    handleTerminalCreateRequest: (req, url, res) =>
      handleTerminalCreateRequest(req, url, res, ctx),
    handleTerminalListRequest: (req, url, res) =>
      handleTerminalListRequest(req, url, res, ctx),
    handleTerminalDeleteRequest: (req, url, res) =>
      handleTerminalDeleteRequest(req, url, res, ctx),
    handleTerminalUploadRequest: (req, url, res) =>
      handleTerminalUploadRequest(req, url, res, ctx),
    handleHealthRequest: (req, url, res) =>
      handleHealthRequest(req, url, res, ctx),
    handleTerminalSessionsRequest: (req, url, res) =>
      handleTerminalSessionsRequest(req, url, res, ctx),
    handleTerminalUpgrade: (req, socket, head, server) =>
      handleTerminalUpgrade(req, socket, head, server, ctx),
    logStartupNotice: () => {
      logStartupNotice(ctx);
    },
    close,
  };
}

/**
 * Shut down whichever terminal backends this dashboard actually started.
 *
 * A dashboard where nobody ever opened a terminal has neither backend loaded, so this closes only what exists rather than
 * forcing node-pty to load just to tear it down again.
 *
 * @param getManagerPromise - returns the manager promise, or null when no terminal was ever opened
 * @param getWssPromise - returns the WebSocket server promise, or null when no terminal ever connected
 * @returns a promise that resolves once both backends are closed; it kills every live PTY session and closes the
 *   terminal WebSocket server on the way
 */
async function closeTerminalBackends(
  getManagerPromise: () => Promise<TerminalManager> | null,
  getWssPromise: () => Promise<WebSocketServer> | null,
): Promise<void> {
  const managerPromise = getManagerPromise();
  // Null means node-pty was never loaded, so there are no sessions to kill.
  if (managerPromise) {
    const manager = await managerPromise;
    manager.shutdown();
  }

  const wssPromise = getWssPromise();
  // Null means no browser ever attached a terminal socket, so there is no server to close.
  if (wssPromise) {
    const wss = await wssPromise;
    await new Promise<void>((resolveClosed) => {
      wss.close(() => {
        resolveClosed();
      });
    });
  }
}
