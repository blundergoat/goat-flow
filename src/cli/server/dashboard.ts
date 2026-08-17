/**
 * The local HTTP server behind the goat-flow dashboard: it serves the UI shell and every audit, quality, setup, and terminal endpoint.
 *
 * This is what starts when a user runs `goat-flow dashboard` and their browser opens on a loopback URL carrying a one-run token.
 *
 * The server is deliberately locked to the machine it runs on, so:
 * - it binds loopback only, and rejects API requests whose Host or Origin header does not match its own address
 * - the token is regenerated per run, so a stale bookmark cannot reach a later session
 * - terminal sessions are torn down on SIGTERM and SIGINT rather than left holding a PTY
 */
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { Duplex } from "node:stream";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { watch } from "node:fs";
import { dirname, resolve } from "node:path";
import { getPackageVersion, getTemplatePath } from "../paths.js";
import { getKnownAgentIds } from "../agents/registry.js";
import {
  assembleDashboardHtml,
  loadDashboardPresets,
} from "./dashboard-assets.js";
import { createDashboardRouteHandlers } from "./dashboard-routes.js";
import { createDashboardTerminalHandlers } from "./dashboard-terminal.js";
import type { Runner } from "./types.js";
import type { WebSocket as WsWebSocket, WebSocketServer } from "ws";
import { loadConfig } from "../config/reader.js";

const KNOWN_AGENT_IDS = getKnownAgentIds();
/** Recognized runner identifiers for terminal session creation. */
const VALID_RUNNERS = new Set<string>(KNOWN_AGENT_IDS);
const DEFAULT_RUNNER: Runner = KNOWN_AGENT_IDS[0] ?? "claude";
/** Maximum request body size accepted by POST endpoints */
const MAX_BODY_BYTES = 64 * 1024; // 64 KB
/** Current goat-flow package version for dashboard UI */
const PACKAGE_VERSION = getPackageVersion();
const DASHBOARD_TOKEN_HEADER = "x-goat-flow-dashboard-token";

/** Request-body limits and error text used by JSON POST handlers. */
interface ReadBodyOptions {
  maxBytes?: number;
  tooLargeMessage?: string;
}

/** Read the request body as a string, capped at the configured byte limit. */
function readBody(
  req: IncomingMessage,
  options: ReadBodyOptions = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const maxBytes = options.maxBytes ?? MAX_BODY_BYTES;
    const tooLargeMessage = options.tooLargeMessage ?? "Request body too large";
    const chunks: Buffer[] = [];
    let size = 0;
    let hasRejectedBody = false;
    req.on("data", (chunk: Buffer) => {
      if (hasRejectedBody) return;
      size += chunk.length;
      if (size > maxBytes) {
        hasRejectedBody = true;
        chunks.length = 0;
        req.resume();
        reject(new Error(tooLargeMessage));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (hasRejectedBody) return;
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    req.on("error", (err) => {
      if (!hasRejectedBody) reject(err);
    });
  });
}

/**
 * Send a JSON response and end the request.
 * Side effect: writes response headers and body, so the response cannot be modified afterwards.
 *
 * @param res - response to complete
 * @param status - HTTP status code to send
 * @param body - value serialised as the JSON body
 * @returns nothing; the response is closed on return
 */
function jsonResponse(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

/** Configuration options for launching the dashboard server */
interface DashboardOptions {
  projectPath: string;
  isDevMode?: boolean;
}

/** Handle returned by serveDashboard for closing the server and reading the port */
interface DashboardServer {
  close: () => Promise<void>;
  port: number;
  url: string;
}

/**
 * Side-effectful API route registry.
 *
 * Every POST/DELETE handler that mutates local state, executes a command, or could be CSRF-bait MUST appear in this set.
 * The Origin/CSRF check fires via `isSideEffectfulApiRoute → SIDE_EFFECTFUL_EXACT_API_ROUTES.has(routeKey)`.
 *
 * Convention: register the exact route key `"<METHOD> <path>"` here whenever
 * you add a side-effectful endpoint.
 */
const SIDE_EFFECTFUL_EXACT_API_ROUTES = new Set([
  "POST /api/projects/list",
  "POST /api/projects/archive",
  "POST /api/projects/restore",
  "POST /api/plans",
  "POST /api/tasks",
  "POST /api/index/regenerate",
  "POST /api/quality/evaluate",
  "POST /api/quality/analyse",
  "POST /api/terminal/create",
]);
const HOOK_TOGGLE_API_ROUTE = /^\/api\/hooks\/[^/]+\/toggle$/u;
const TERMINAL_UPLOAD_IMAGE_API_ROUTE =
  /^\/api\/terminal\/[^/]+\/upload-image$/u;

/** Read the dashboard authorization token supplied by a browser/API client. */
function readDashboardToken(req: IncomingMessage, url: URL): string | null {
  const header = req.headers[DASHBOARD_TOKEN_HEADER];
  if (typeof header === "string" && header.length > 0) return header;
  if (Array.isArray(header) && typeof header[0] === "string") return header[0];
  return url.searchParams.get("token");
}

/** Compare dashboard tokens without leaking length-matched timing. */
function tokenMatches(expected: string, actual: string | null): boolean {
  if (!actual) return false;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

/**
 * Check the browser Origin header against this server's own loopback address.
 *
 * A non-browser client such as curl sends no Origin at all, which cannot be cross-origin and is therefore allowed.
 *
 * @param req - incoming request whose Origin header is read; a missing Origin is treated as same-origin
 * @param server - the running dashboard server, read for the port it actually bound
 * @returns true when the request may proceed; false for an Origin belonging to some other page
 */
function originAllowed(req: IncomingMessage, server: Server): boolean {
  const origin = req.headers.origin;
  // No Origin header (non-browser client) can't be cross-origin, so allow it.
  if (!origin) return true;
  const addr = server.address();
  // Address not bound yet or a pipe rather than a port: no loopback origin can be proven, so refuse.
  if (!addr || typeof addr === "string") return false;
  return (
    origin === `http://127.0.0.1:${addr.port}` ||
    origin === `http://localhost:${addr.port}`
  );
}

/**
 * Check the browser Host header against this server's own loopback address for WebSocket upgrades.
 *
 * A page on another origin can script an upgrade but cannot forge the Host the browser sends, so a mismatched Host is the
 * DNS-rebinding shape we refuse.
 *
 * @param req - incoming upgrade request whose Host header is validated
 * @param server - the running dashboard server, read for the port it actually bound
 * @returns true when Host is loopback for this port, or when the address is not known yet and the token gate still applies
 */
function hostAllowed(req: IncomingMessage, server: Server): boolean {
  const addr = server.address();
  // Address not bound yet: fall through to the token/Origin gates instead.
  if (!addr || typeof addr === "string") return true;
  const host = req.headers.host;
  return host === `127.0.0.1:${addr.port}` || host === `localhost:${addr.port}`;
}

/**
 * Reject API requests whose Host header points somewhere other than this server, which is the DNS-rebinding shape.
 *
 * Side effect: writes and ends the response when the request is rejected.
 *
 * @param req - incoming request whose headers are checked
 * @param url - parsed request URL; only `/api/` paths are guarded
 * @param res - response ended with a rejection when the headers are not allowed
 * @param server - the running dashboard server, read for the port it actually bound
 * @returns true when the request was rejected and the caller must stop handling it
 */
function rejectBadHostOrOrigin(
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
  server: Server,
): boolean {
  // Only the API is guarded here; the UI shell and its assets are harmless to serve.
  if (!url.pathname.startsWith("/api/")) return false;

  const host = req.headers.host;
  const addr = server.address();
  // No bound port to compare against yet, so there is nothing this check can prove either way.
  if (!addr || typeof addr === "string") return false;

  const allowed = [`127.0.0.1:${addr.port}`, `localhost:${addr.port}`];
  // A Host we did not bind means the browser was pointed here by some other name.
  if (!host || !allowed.includes(host)) {
    console.warn(
      `[dashboard] Blocked ${req.method} ${url.pathname} - Host: ${host || "(none)"}`,
    );
    res.writeHead(403);
    res.end("Forbidden");
    return true;
  }
  return false;
}

/**
 * Report whether a request targets a route that can mutate local state.
 *
 * These are the routes worth an extra Origin check, because they are the ones that create a terminal, write a plan, or flip
 * a hook rather than just reading something back.
 *
 * @param req - incoming request; a missing method is read as GET
 * @param url - parsed request URL matched against the mutating-route list
 * @returns true when the route can change something on the user's machine
 */
function isSideEffectfulApiRoute(req: IncomingMessage, url: URL): boolean {
  const method = req.method ?? "GET";
  const routeKey = `${method} ${url.pathname}`;
  if (SIDE_EFFECTFUL_EXACT_API_ROUTES.has(routeKey)) return true;
  if (method === "POST" && HOOK_TOGGLE_API_ROUTE.test(url.pathname)) {
    return true;
  }
  if (method === "POST" && TERMINAL_UPLOAD_IMAGE_API_ROUTE.test(url.pathname)) {
    return true;
  }
  return method === "DELETE" && url.pathname.startsWith("/api/terminal/");
}

/**
 * Enforce process-local authorization for every API request.
 *
 * The token is regenerated per run, so a stale bookmark from an earlier dashboard cannot reach this one.
 *
 * Side effect: writes a 403 JSON response when the request is rejected.
 *
 * @param req - incoming request carrying the token as a header or query parameter
 * @param url - parsed request URL; only `/api/` paths are guarded
 * @param res - response ended with a 403 when the caller is not this local browser
 * @param gates - the running server and its per-run token
 * @returns true when the request was rejected and the caller must stop handling it
 */
function rejectUnauthorizedApi(
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
  gates: { server: Server; dashboardToken: string },
): boolean {
  if (!url.pathname.startsWith("/api/")) return false;

  // No valid token means this is not the browser tab the dashboard printed a URL for.
  if (!tokenMatches(gates.dashboardToken, readDashboardToken(req, url))) {
    jsonResponse(res, 403, { error: "Forbidden" });
    return true;
  }
  // A mutating route additionally has to come from a page this server itself served.
  if (isSideEffectfulApiRoute(req, url) && !originAllowed(req, gates.server)) {
    jsonResponse(res, 403, { error: "Forbidden" });
    return true;
  }
  return false;
}

/**
 * Enforce Host, token, and Origin checks for terminal WebSocket upgrades.
 *
 * A terminal socket is a live shell on the user's machine, so it clears every gate the API does before the handshake runs.
 *
 * @param req - incoming upgrade request
 * @param url - parsed request URL; only `/ws/terminal/` paths are guarded
 * @param gates - the running server and its per-run token
 * @returns true when the upgrade must be refused and its socket destroyed
 */
function rejectUnauthorizedTerminalUpgrade(
  req: IncomingMessage,
  url: URL,
  gates: { server: Server; dashboardToken: string },
): boolean {
  if (!url.pathname.startsWith("/ws/terminal/")) return false;
  // A foreign Host (DNS-rebinding shape) is refused before anything else.
  if (!hostAllowed(req, gates.server)) return true;
  // No valid dashboard token means the caller isn't this local browser.
  if (!tokenMatches(gates.dashboardToken, readDashboardToken(req, url))) {
    return true;
  }
  return !originAllowed(req, gates.server);
}

/** One dashboard route attempt: returns true when it claimed the request and already wrote the response. */
type DashboardRoute = () => Promise<boolean> | boolean;

/**
 * Order every dashboard endpoint into the chain one request is offered to.
 *
 * Order is the routing table: the first handler that recognises the URL claims it, so the UI shell and its assets are
 * matched before the API endpoints and the catch-all 404 is only reached when nothing above it wanted the request.
 *
 * @param handlers - the route handlers built for this server run, each returning true when it claimed the request
 * @returns a builder that produces the ordered attempts for one request
 */
function buildDashboardRoutes(handlers: {
  handleHtmlRequest: (url: URL, res: ServerResponse) => boolean;
  handleAssetRequest: (
    req: IncomingMessage,
    url: URL,
    res: ServerResponse,
  ) => boolean;
  handleAuditRequest: (url: URL, res: ServerResponse) => boolean;
  handleSetupDetectRequest: (url: URL, res: ServerResponse) => boolean;
  handleSetupRequest: (url: URL, res: ServerResponse) => Promise<boolean>;
  handleQualityRequest: (url: URL, res: ServerResponse) => boolean;
  handleQualityHistoryRequest: (
    url: URL,
    res: ServerResponse,
  ) => Promise<boolean>;
  handleSkillQualityRequest: (url: URL, res: ServerResponse) => boolean;
  handleSkillQualityInventoryRequest: (
    url: URL,
    res: ServerResponse,
  ) => boolean;
  handleQualityEvaluateRequest: (
    req: IncomingMessage,
    url: URL,
    res: ServerResponse,
  ) => Promise<boolean>;
  handleBrowseRequest: (url: URL, res: ServerResponse) => boolean;
  handleTasksRequest: (
    req: IncomingMessage,
    url: URL,
    res: ServerResponse,
  ) => Promise<boolean>;
  handleHooksRequest: (
    req: IncomingMessage,
    url: URL,
    res: ServerResponse,
  ) => Promise<boolean>;
  handleAgentDetectRequest: (url: URL, res: ServerResponse) => boolean;
  handleProjectsListRequest: (
    req: IncomingMessage,
    url: URL,
    res: ServerResponse,
  ) => Promise<boolean>;
  handleProjectsStatusRequest: (url: URL, res: ServerResponse) => boolean;
  handleIndexRegenerateRequest: (
    req: IncomingMessage,
    url: URL,
    res: ServerResponse,
  ) => Promise<boolean>;
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
  handleTerminalSessionsRequest: (
    req: IncomingMessage,
    url: URL,
    res: ServerResponse,
  ) => Promise<boolean>;
  handleTerminalUploadRequest: (
    req: IncomingMessage,
    url: URL,
    res: ServerResponse,
  ) => Promise<boolean>;
  handleTerminalDeleteRequest: (
    req: IncomingMessage,
    url: URL,
    res: ServerResponse,
  ) => Promise<boolean>;
  handleHealthRequest: (
    req: IncomingMessage,
    url: URL,
    res: ServerResponse,
  ) => Promise<boolean>;
}): (req: IncomingMessage, url: URL, res: ServerResponse) => DashboardRoute[] {
  return (req, url, res) => [
    () => handlers.handleHtmlRequest(url, res),
    () => handlers.handleAssetRequest(req, url, res),
    () => handlers.handleAuditRequest(url, res),
    () => handlers.handleSetupDetectRequest(url, res),
    () => handlers.handleSetupRequest(url, res),
    () => handlers.handleQualityRequest(url, res),
    () => handlers.handleQualityHistoryRequest(url, res),
    () => handlers.handleSkillQualityRequest(url, res),
    () => handlers.handleSkillQualityInventoryRequest(url, res),
    () => handlers.handleQualityEvaluateRequest(req, url, res),
    () => handlers.handleBrowseRequest(url, res),
    () => handlers.handleTasksRequest(req, url, res),
    () => handlers.handleHooksRequest(req, url, res),
    () => handlers.handleAgentDetectRequest(url, res),
    () => handlers.handleProjectsListRequest(req, url, res),
    () => handlers.handleProjectsStatusRequest(url, res),
    () => handlers.handleIndexRegenerateRequest(req, url, res),
    () => handlers.handleTerminalCreateRequest(req, url, res),
    () => handlers.handleTerminalListRequest(req, url, res),
    () => handlers.handleTerminalSessionsRequest(req, url, res),
    () => handlers.handleTerminalUploadRequest(req, url, res),
    () => handlers.handleTerminalDeleteRequest(req, url, res),
    () => handlers.handleHealthRequest(req, url, res),
  ];
}

/**
 * Dispatch one HTTP request across the dashboard routes in priority order.
 *
 * Side effect: writes the response through whichever route claims the request, or a 404 when none does.
 *
 * @param req - incoming request
 * @param res - response completed by the matching route
 * @param context - the running server, its per-run token, dev-mode flag, and the ordered route chain
 * @returns nothing; the response is ended before this resolves
 */
async function dispatchDashboardRequest(
  req: IncomingMessage,
  res: ServerResponse,
  context: {
    server: Server;
    dashboardToken: string;
    devMode: boolean;
    routes: (
      req: IncomingMessage,
      url: URL,
      res: ServerResponse,
    ) => DashboardRoute[];
  },
): Promise<void> {
  const url = new URL(
    req.url ?? "/",
    `http://${req.headers.host ?? "127.0.0.1"}`,
  );

  if (rejectBadHostOrOrigin(req, url, res, context.server)) return;
  if (rejectUnauthorizedApi(req, url, res, context)) return;

  // Log API requests in dev mode
  if (context.devMode && url.pathname.startsWith("/api/")) {
    console.log(`[dashboard] ${req.method} ${url.pathname}${url.search}`);
  }

  // Offer the request to each route in turn; the first one to claim it has already written the response.
  for (const route of context.routes(req, url, res)) {
    if (await route()) return;
  }

  res.writeHead(404);
  res.end("Not found");
}

/**
 * Turn an unhandled request failure into a 500 the browser can show, and a stack trace in the terminal.
 *
 * The user sees a red toast in the dashboard rather than a hung panel, while the terminal running `goat-flow dashboard`
 * keeps the stack needed to actually diagnose it.
 *
 * @param req - the request that failed, named in the terminal log line
 * @param res - the response; nothing is written when headers already went out mid-stream
 * @param err - whatever was thrown; a non-Error value reports as a generic internal error with no stack
 * @returns nothing; this is the last stop, so it never rethrows
 */
function reportDashboardRequestFailure(
  req: IncomingMessage,
  res: ServerResponse,
  err: unknown,
): void {
  const msg = err instanceof Error ? err.message : "Internal error";
  const stack = err instanceof Error ? err.stack : "";
  console.error(`[dashboard] ${req.method} ${req.url} → 500: ${msg}`);
  if (stack) console.error(stack);
  // Headers already sent means a route started streaming before it failed, so there is no status left to set.
  if (!res.headersSent) {
    jsonResponse(res, 500, { error: msg });
  }
}

/**
 * Watch the built dashboard assets and push a reload to every open browser tab when they change.
 *
 * This is the dev-mode loop: edit a dashboard file, and the tab refreshes itself instead of waiting for a manual reload.
 *
 * Side effect: starts a recursive filesystem watcher and registers a process `exit` hook to close it.
 * Error behavior: throws nothing; a send to a closed tab swallows its error so one dead client cannot stop the others reloading.
 *
 * @param dashDir - directory of built dashboard assets to watch recursively
 * @param liveReloadClients - currently connected reload sockets; an empty set simply means no tab is open to notify
 * @returns a function that stops the watcher and releases its exit hook
 */
function startDashboardDevWatcher(
  dashDir: string,
  liveReloadClients: Set<WsWebSocket>,
): () => void {
  /**
   * Notify live-reload clients that dashboard assets changed.
   * Error behavior: throws nothing; a send to a closed socket is swallowed so one dead client cannot stop the others from reloading.
   */
  const notifyReload = (): void => {
    for (const client of liveReloadClients) {
      try {
        client.send("reload");
      } catch {
        /* ignore: the tab was closed, so this client no longer needs reloading */
      }
    }
  };

  let debounce: ReturnType<typeof setTimeout> | null = null;
  const watcher = watch(dashDir, { recursive: true }, () => {
    // A save often lands as several events; debouncing means one reload rather than a flicker.
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(notifyReload, 100);
  });

  /** Close the dev-mode dashboard file watcher and release its process hook. */
  const closeWatcher = (): void => {
    watcher.close();
  };
  process.on("exit", closeWatcher);
  console.log("Dev mode: watching dist/dashboard/ for changes");

  return () => {
    process.off("exit", closeWatcher);
    closeWatcher();
  };
}

/**
 * Open the dev-mode live-reload socket for a browser tab that cleared the loopback checks.
 *
 * Side effect: completes the WebSocket handshake and adds the tab to the reload broadcast set, or destroys the socket.
 * Error behavior: throws nothing; a failed handshake swallows its error and closes the socket, because reload is a convenience.
 *
 * @param req - the upgrade request
 * @param socket - the raw socket, destroyed when the reload server cannot start
 * @param head - the first packet of the upgraded stream
 * @param context - the reload client set and the lazy reload WebSocket server
 * @returns nothing; failures close the socket rather than surfacing to the user, since reload is a convenience
 */
async function openLiveReloadSocket(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  context: {
    liveReloadClients: Set<WsWebSocket>;
    getLiveReloadWSS: () => Promise<WebSocketServer>;
  },
): Promise<void> {
  try {
    const wss = await context.getLiveReloadWSS();
    wss.handleUpgrade(req, socket, head, (ws: WsWebSocket) => {
      context.liveReloadClients.add(ws);
      // A browser tab closing drops it from the reload broadcast set.
      ws.on("close", () => {
        context.liveReloadClients.delete(ws);
      });
    });
  } catch {
    /* ignore: reload is best effort, so a failed handshake just closes the socket */
    socket.destroy();
  }
}

/**
 * Route one WebSocket upgrade to either the dev reload channel or a terminal session.
 *
 * The reload channel is dev-only and carries no token, because the injected reload client has none and demanding one would
 * break auto-refresh - so it clears the same Host and Origin allowlist the terminal upgrade uses instead.
 *
 * Side effect: completes a handshake or destroys the socket; nothing is left half-open.
 *
 * @param req - the upgrade request
 * @param socket - the raw socket, destroyed for any upgrade that is not allowed or not recognised
 * @param head - the first packet of the upgraded stream
 * @param context - the running server, its token, dev-mode flag, reload state, and the terminal upgrade handler
 * @returns nothing; every path either hands the socket over or closes it
 */
async function handleDashboardUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  context: {
    server: Server;
    dashboardToken: string;
    devMode: boolean;
    liveReloadClients: Set<WsWebSocket>;
    getLiveReloadWSS: () => Promise<WebSocketServer>;
    handleTerminalUpgrade: (
      req: IncomingMessage,
      socket: Duplex,
      head: Buffer,
      server: Server,
    ) => boolean;
  },
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://127.0.0.1`);

  if (url.pathname === "/ws/livereload" && context.devMode) {
    // Hostile Host or Origin: drop the socket before the reload handshake.
    if (
      !hostAllowed(req, context.server) ||
      !originAllowed(req, context.server)
    ) {
      socket.destroy();
      return;
    }
    await openLiveReloadSocket(req, socket, head, context);
    return;
  }

  if (rejectUnauthorizedTerminalUpgrade(req, url, context)) {
    socket.destroy();
    return;
  }
  // The terminal handler claims the socket when the path names a session it knows.
  if (context.handleTerminalUpgrade(req, socket, head, context.server)) return;

  // Anything else is an upgrade this server has no channel for.
  if (!url.pathname.startsWith("/ws/terminal/")) socket.destroy();
}

/**
 * Close the HTTP server, the reload socket server, the dev watcher, and every live terminal, in that order.
 *
 * Terminals go before the HTTP server so a user's running agent is shut down properly rather than having its socket cut
 * from under it.
 *
 * Side effect: removes the SIGTERM and SIGINT handlers and closes every open connection.
 *
 * @param context - the running server, its signal handler, and the resources to release
 * @returns a promise that resolves once everything is closed; rejects only if the HTTP server itself fails to close
 */
async function shutDownDashboard(context: {
  server: Server;
  onSignal: () => void;
  closeDevWatcher: (() => void) | null;
  getLiveReloadWss: () => Promise<WebSocketServer> | null;
  closeTerminalResources: () => Promise<void>;
}): Promise<void> {
  process.off("SIGTERM", context.onSignal);
  process.off("SIGINT", context.onSignal);
  context.closeDevWatcher?.();

  const liveReloadWssPromise = context.getLiveReloadWss();
  // Null means no browser ever opened a reload socket, so there is no reload server to close.
  if (liveReloadWssPromise) {
    const liveReloadWss = await liveReloadWssPromise;
    await new Promise<void>((resolveClosed) => {
      liveReloadWss.close(() => {
        resolveClosed();
      });
    });
  }

  await context.closeTerminalResources();
  await new Promise<void>((resolveClose, rejectClose) => {
    context.server.close((err) => {
      if (err) rejectClose(err);
      else resolveClose();
    });
    context.server.closeIdleConnections();
    context.server.closeAllConnections();
  });
}

/**
 * Start the local dashboard server and expose its API endpoints.
 *
 * The whole server lives in one closure because every route shares the same per-run token, live reload set, and terminal state; hoisting the routes
 * out would mean threading that mutable state through each one, so the length here is deliberate rather than accidental.
 *
 * Side effect: binds a loopback TCP port, starts a filesystem watcher in dev mode, and registers SIGTERM and SIGINT handlers that exit the process.
 * Error behavior: throws nothing out of this call; the promise resolves once the port is listening, and each per-request failure reports as an HTTP
 * response instead of escaping the server.
 *
 * @param options - selected project path plus optional dev-mode/dashboard configuration
 * @returns running dashboard handle with URL, token, and close method
 */
export function serveDashboard(
  options: DashboardOptions,
): Promise<DashboardServer> {
  return new Promise((resolveStart) => {
    const shellPath = getTemplatePath("dist/dashboard/index.html");
    const dashboardPresets = loadDashboardPresets();
    const devMode = options.isDevMode === true;
    const dashboardToken = randomBytes(32).toString("base64url");
    // In dev mode, re-read on every request. In prod, cache once.
    let cachedTemplate: string | null = devMode
      ? null
      : assembleDashboardHtml(shellPath);
    /** Read the current dashboard HTML shell, using the cache when possible. */
    function getTemplate(): string {
      if (devMode) return assembleDashboardHtml(shellPath);
      if (!cachedTemplate) cachedTemplate = assembleDashboardHtml(shellPath);
      return cachedTemplate;
    }
    const absDefault = resolve(options.projectPath);
    const loadedConfig = loadConfig(absDefault);
    const idleTimeoutMinutes = loadedConfig.config.terminal.idleTimeoutMinutes;
    const {
      handleHtmlRequest,
      handleAssetRequest,
      handleAuditRequest,
      handleSetupDetectRequest,
      handleSetupRequest,
      handleQualityRequest,
      handleQualityHistoryRequest,
      handleSkillQualityRequest,
      handleSkillQualityInventoryRequest,
      handleQualityEvaluateRequest,
      handleBrowseRequest,
      handleTasksRequest,
      handleHooksRequest,
      handleAgentDetectRequest,
      handleProjectsListRequest,
      handleProjectsStatusRequest,
      handleIndexRegenerateRequest,
    } = createDashboardRouteHandlers({
      absDefault,
      devMode,
      getTemplate,
      packageVersion: PACKAGE_VERSION,
      dashboardToken,
      dashboardPresets,
      jsonResponse,
      readBody,
    });
    const {
      handleTerminalCreateRequest,
      handleTerminalListRequest,
      handleTerminalDeleteRequest,
      handleTerminalUploadRequest,
      handleHealthRequest,
      handleTerminalSessionsRequest,
      handleTerminalUpgrade,
      logStartupNotice,
      close: closeTerminalResources,
    } = createDashboardTerminalHandlers({
      absDefault,
      validRunners: VALID_RUNNERS,
      defaultRunner: DEFAULT_RUNNER,
      jsonResponse,
      readBody,
      idleTimeoutMinutes,
    });

    // Live reload state (dev mode only)
    const liveReloadClients = new Set<WsWebSocket>();
    let liveReloadWssPromise: Promise<WebSocketServer> | null = null;

    /** Lazy-load the live-reload WebSocket server for dev-mode browser refreshes. */
    async function getLiveReloadWSS(): Promise<WebSocketServer> {
      if (!liveReloadWssPromise) {
        liveReloadWssPromise = import("ws").then(
          ({ WebSocketServer: WSS }) => new WSS({ noServer: true }),
        );
      }
      return liveReloadWssPromise;
    }

    const routes = buildDashboardRoutes({
      handleHtmlRequest,
      handleAssetRequest,
      handleAuditRequest,
      handleSetupDetectRequest,
      handleSetupRequest,
      handleQualityRequest,
      handleQualityHistoryRequest,
      handleSkillQualityRequest,
      handleSkillQualityInventoryRequest,
      handleQualityEvaluateRequest,
      handleBrowseRequest,
      handleTasksRequest,
      handleHooksRequest,
      handleAgentDetectRequest,
      handleProjectsListRequest,
      handleProjectsStatusRequest,
      handleIndexRegenerateRequest,
      handleTerminalCreateRequest,
      handleTerminalListRequest,
      handleTerminalSessionsRequest,
      handleTerminalUploadRequest,
      handleTerminalDeleteRequest,
      handleHealthRequest,
    });

    const server: Server = createServer((req, res) => {
      dispatchDashboardRequest(req, res, {
        server,
        dashboardToken,
        devMode,
        routes,
      }).catch((err: unknown) => {
        reportDashboardRequestFailure(req, res, err);
      });
    });

    // Dev mode: watch dashboard files and notify connected browsers.
    const closeDevWatcher = devMode
      ? startDashboardDevWatcher(dirname(shellPath), liveReloadClients)
      : null;

    // WebSocket upgrade for terminal and live-reload sessions
    server.on("upgrade", (req, socket, head) => {
      void handleDashboardUpgrade(req, socket, head, {
        server,
        dashboardToken,
        devMode,
        liveReloadClients,
        getLiveReloadWSS,
        handleTerminalUpgrade,
      });
    });

    // Shutdown joins HTTP, WebSocket, watcher, and terminal cleanup so callers
    // can await one idempotent close even when signals and tests race.
    let closePromise: Promise<void> | null = null;
    /** Close the dashboard server, watchers, and terminal sessions through one promise because signals can race. */
    async function closeServer(): Promise<void> {
      closePromise ??= shutDownDashboard({
        server,
        onSignal: doShutdown,
        closeDevWatcher,
        getLiveReloadWss: () => liveReloadWssPromise,
        closeTerminalResources,
      });
      return closePromise;
    }

    /**
     * Shut down the dashboard server's live terminal state before exiting the process.
     * Error behavior: exits the process regardless of whether the shutdown succeeded, so a stuck terminal cannot leave the signal unhandled.
     */
    const doShutdown = (): void => {
      void closeServer().finally(() => {
        process.exit(0);
      });
    };
    process.on("SIGTERM", doShutdown);
    process.on("SIGINT", doShutdown);

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") return;
      const url = `http://127.0.0.1:${addr.port}/?token=${encodeURIComponent(dashboardToken)}`;
      console.log(`Dashboard: ${url}`);
      logStartupNotice();
      resolveStart({
        port: addr.port,
        url,
        close: closeServer,
      });
    });
  }); // end Promise
}
