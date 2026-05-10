/**
 * HTTP server for the local goat-flow dashboard.
 * It serves the frontend shell, exposes audit, quality, setup, and terminal endpoints.
 */
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
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
    let rejected = false;
    req.on("data", (chunk: Buffer) => {
      if (rejected) return;
      size += chunk.length;
      if (size > maxBytes) {
        rejected = true;
        chunks.length = 0;
        req.resume();
        reject(new Error(tooLargeMessage));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (rejected) return;
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    req.on("error", (err) => {
      if (!rejected) reject(err);
    });
  });
}

/** Send a JSON response. */
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
  dev?: boolean;
}

/** Handle returned by serveDashboard for closing the server and reading the port */
interface DashboardServer {
  close: () => Promise<void>;
  port: number;
  url: string;
}

/** Route inventory for the local privileged dashboard control plane. */
const DASHBOARD_ROUTE_INVENTORY = [
  { method: "GET", path: "/", class: "bootstrap" },
  { method: "GET", path: "/assets/*", class: "static" },
  { method: "GET", path: "/api/health", class: "privileged-read" },
  { method: "GET", path: "/api/audit", class: "privileged-read" },
  { method: "GET", path: "/api/setup/detect", class: "privileged-read" },
  { method: "GET", path: "/api/setup", class: "privileged-read" },
  { method: "GET", path: "/api/quality", class: "privileged-read" },
  { method: "GET", path: "/api/quality/history", class: "privileged-read" },
  { method: "GET", path: "/api/browse", class: "privileged-read" },
  { method: "GET", path: "/api/agents/installed", class: "privileged-read" },
  { method: "GET", path: "/api/projects/list", class: "privileged-read" },
  { method: "POST", path: "/api/projects/list", class: "side-effectful" },
  { method: "GET", path: "/api/projects/status", class: "privileged-read" },
  { method: "POST", path: "/api/quality/evaluate", class: "side-effectful" },
  // Deprecated alias for /api/quality/evaluate. Same handler, response carries
  // Deprecation + Link headers. Slated for removal one release after the
  // dashboard-side migration completes.
  { method: "POST", path: "/api/quality/analyse", class: "side-effectful" },
  { method: "POST", path: "/api/terminal/create", class: "side-effectful" },
  { method: "GET", path: "/api/terminal/list", class: "privileged-read" },
  { method: "GET", path: "/api/terminal/sessions", class: "privileged-read" },
  { method: "DELETE", path: "/api/terminal/:id", class: "side-effectful" },
  {
    method: "POST",
    path: "/api/terminal/:id/upload-image",
    class: "side-effectful",
  },
  { method: "GET", path: "/ws/terminal/:id", class: "privileged-websocket" },
] as const;

void DASHBOARD_ROUTE_INVENTORY;

const SIDE_EFFECTFUL_EXACT_API_ROUTES = new Set([
  "POST /api/projects/list",
  "POST /api/quality/evaluate",
  "POST /api/quality/analyse",
  "POST /api/terminal/create",
]);
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

/** Start the local dashboard server and expose its API endpoints. */
export function serveDashboard(
  options: DashboardOptions,
): Promise<DashboardServer> {
  return new Promise((resolveStart) => {
    const shellPath = getTemplatePath("dist/dashboard/index.html");
    const dashboardPresets = loadDashboardPresets();
    const devMode = options.dev === true;
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
      handleAgentDetectRequest,
      handleProjectsListRequest,
      handleProjectsStatusRequest,
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

    /** DNS rebinding protection: reject API requests with unexpected Host header. */
    function rejectBadHostOrOrigin(
      req: IncomingMessage,
      url: URL,
      res: ServerResponse,
    ): boolean {
      if (!url.pathname.startsWith("/api/")) return false;
      const host = req.headers.host;
      const addr = server.address();
      if (addr && typeof addr !== "string") {
        const allowed = [`127.0.0.1:${addr.port}`, `localhost:${addr.port}`];
        if (!host || !allowed.includes(host)) {
          console.warn(
            `[dashboard] Blocked ${req.method} ${url.pathname} - Host: ${host || "(none)"}`,
          );
          res.writeHead(403);
          res.end("Forbidden");
          return true;
        }
      }
      return false;
    }

    /** Return whether a request targets a route that can mutate local state. */
    function isSideEffectfulApiRoute(req: IncomingMessage, url: URL): boolean {
      const method = req.method ?? "GET";
      const routeKey = `${method} ${url.pathname}`;
      if (SIDE_EFFECTFUL_EXACT_API_ROUTES.has(routeKey)) return true;
      if (
        method === "POST" &&
        TERMINAL_UPLOAD_IMAGE_API_ROUTE.test(url.pathname)
      )
        return true;
      return method === "DELETE" && url.pathname.startsWith("/api/terminal/");
    }

    /** Check browser Origin headers for side-effectful dashboard routes. */
    function originAllowed(req: IncomingMessage): boolean {
      const origin = req.headers.origin;
      if (!origin) return true;
      const addr = server.address();
      if (!addr || typeof addr === "string") return false;
      return (
        origin === `http://127.0.0.1:${addr.port}` ||
        origin === `http://localhost:${addr.port}`
      );
    }

    /** Enforce process-local dashboard authorization for all API requests. */
    function rejectUnauthorizedApi(
      req: IncomingMessage,
      url: URL,
      res: ServerResponse,
    ): boolean {
      if (!url.pathname.startsWith("/api/")) return false;
      if (!tokenMatches(dashboardToken, readDashboardToken(req, url))) {
        jsonResponse(res, 403, { error: "Forbidden" });
        return true;
      }
      if (isSideEffectfulApiRoute(req, url) && !originAllowed(req)) {
        jsonResponse(res, 403, { error: "Forbidden" });
        return true;
      }
      return false;
    }

    /** Enforce Host + token + Origin checks for terminal WebSocket upgrades. */
    function rejectUnauthorizedTerminalUpgrade(
      req: IncomingMessage,
      url: URL,
    ): boolean {
      if (!url.pathname.startsWith("/ws/terminal/")) return false;
      const host = req.headers.host;
      const addr = server.address();
      if (addr && typeof addr !== "string") {
        const allowed = [`127.0.0.1:${addr.port}`, `localhost:${addr.port}`];
        if (!host || !allowed.includes(host)) return true;
      }
      if (!tokenMatches(dashboardToken, readDashboardToken(req, url))) {
        return true;
      }
      return !originAllowed(req);
    }

    /** Dispatch one HTTP request across the dashboard routes in priority order. */
    async function handleRequest(
      req: IncomingMessage,
      res: ServerResponse,
    ): Promise<void> {
      const url = new URL(
        req.url ?? "/",
        `http://${req.headers.host ?? "127.0.0.1"}`,
      );

      if (rejectBadHostOrOrigin(req, url, res)) return;
      if (rejectUnauthorizedApi(req, url, res)) return;

      // Log API requests in dev mode
      if (devMode && url.pathname.startsWith("/api/")) {
        console.log(`[dashboard] ${req.method} ${url.pathname}${url.search}`);
      }

      const routeHandlers = [
        () => Promise.resolve(handleHtmlRequest(url, res)),
        () => Promise.resolve(handleAssetRequest(url, res)),
        () => Promise.resolve(handleAuditRequest(url, res)),
        () => Promise.resolve(handleSetupDetectRequest(url, res)),
        () => handleSetupRequest(url, res),
        () => Promise.resolve(handleQualityRequest(url, res)),
        () => handleQualityHistoryRequest(url, res),
        () => Promise.resolve(handleSkillQualityRequest(url, res)),
        () => Promise.resolve(handleSkillQualityInventoryRequest(url, res)),
        () => handleQualityEvaluateRequest(req, url, res),

        () => Promise.resolve(handleBrowseRequest(url, res)),
        () => Promise.resolve(handleAgentDetectRequest(url, res)),
        () => handleProjectsListRequest(req, url, res),
        () => Promise.resolve(handleProjectsStatusRequest(url, res)),
        () => handleTerminalCreateRequest(req, url, res),
        () => handleTerminalListRequest(req, url, res),
        () => handleTerminalSessionsRequest(req, url, res),
        () => handleTerminalUploadRequest(req, url, res),
        () => handleTerminalDeleteRequest(req, url, res),
        () => handleHealthRequest(req, url, res),
      ];

      for (const route of routeHandlers) {
        if (await route()) return;
      }

      res.writeHead(404);
      res.end("Not found");
    }

    const server = createServer((req, res) => {
      handleRequest(req, res).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "Internal error";
        const stack = err instanceof Error ? err.stack : "";
        console.error(`[dashboard] ${req.method} ${req.url} → 500: ${msg}`);
        if (stack) console.error(stack);
        if (!res.headersSent) {
          jsonResponse(res, 500, { error: msg });
        }
      });
    });

    // Dev mode: watch dashboard files and notify connected browsers
    let closeDevWatcher: (() => void) | null = null;
    if (devMode) {
      const dashDir = dirname(shellPath);
      /** Notify live-reload clients that dashboard assets changed. */
      const notifyReload = (): void => {
        for (const client of liveReloadClients) {
          try {
            client.send("reload");
          } catch {
            /* ignore */
          }
        }
      };
      let debounce: ReturnType<typeof setTimeout> | null = null;
      const watcher = watch(dashDir, { recursive: true }, () => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(notifyReload, 100);
      });
      /** Close the dev-mode dashboard file watcher and release its process hook. */
      const closeWatcher = (): void => {
        watcher.close();
      };
      process.on("exit", closeWatcher);
      /** Release the dev watcher and its exit hook. */
      closeDevWatcher = () => {
        process.off("exit", closeWatcher);
        closeWatcher();
      };
      console.log("Dev mode: watching dist/dashboard/ for changes");
    }

    // WebSocket upgrade for terminal and live-reload sessions
    server.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1`);

      // Live reload WebSocket (dev mode)
      if (url.pathname === "/ws/livereload" && devMode) {
        void (async () => {
          try {
            const wss = await getLiveReloadWSS();
            wss.handleUpgrade(req, socket, head, (ws: WsWebSocket) => {
              liveReloadClients.add(ws);
              ws.on("close", () => {
                liveReloadClients.delete(ws);
              });
            });
          } catch {
            socket.destroy();
          }
        })();
        return;
      }

      if (rejectUnauthorizedTerminalUpgrade(req, url)) {
        socket.destroy();
        return;
      }

      if (handleTerminalUpgrade(req, socket, head, server)) {
        return;
      }

      if (!url.pathname.startsWith("/ws/terminal/")) {
        socket.destroy();
        return;
      }
    });

    // Gracefully stop any live terminal sessions before the process exits.
    let closePromise: Promise<void> | null = null;
    /** Close the dashboard server, watchers, and terminal sessions cleanly. */
    async function closeServer(): Promise<void> {
      if (closePromise) return closePromise;

      closePromise = (async () => {
        process.off("SIGTERM", doShutdown);
        process.off("SIGINT", doShutdown);
        closeDevWatcher?.();
        if (liveReloadWssPromise) {
          const liveReloadWss = await liveReloadWssPromise;
          await new Promise<void>((resolve) => {
            liveReloadWss.close(() => {
              resolve();
            });
          });
        }
        await closeTerminalResources();
        await new Promise<void>((resolveClose, rejectClose) => {
          server.close((err) => {
            if (err) rejectClose(err);
            else resolveClose();
          });
          server.closeIdleConnections();
          server.closeAllConnections();
        });
      })();

      return closePromise;
    }

    /** Shut down the dashboard server's live terminal state before exiting the process. */
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
