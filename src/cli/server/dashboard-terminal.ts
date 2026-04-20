/**
 * Terminal-specific dashboard server wiring.
 * This keeps terminal HTTP routes, WebSocket upgrades, startup health checks,
 * and shutdown handling out of the main dashboard HTTP server.
 */
import type {
  IncomingMessage,
  Server as HttpServer,
  ServerResponse,
} from "node:http";
import type { Duplex } from "node:stream";
import type { WebSocket as WsWebSocket, WebSocketServer } from "ws";
import { decodeTerminalCreateBody } from "./decoders.js";
import type { Runner } from "./types.js";
import type { TerminalManager } from "./terminal.js";
import { MAX_SESSIONS } from "./terminal.js";

type JsonResponder = (
  res: ServerResponse,
  status: number,
  body: unknown,
) => void;

type BodyReader = (req: IncomingMessage) => Promise<string>;

interface DashboardTerminalDependencies {
  absDefault: string;
  validRunners: ReadonlySet<string>;
  defaultRunner: Runner;
  jsonResponse: JsonResponder;
  readBody: BodyReader;
}

/** Build the terminal-only dashboard handlers for one server instance. */
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
  const { absDefault, validRunners, defaultRunner, jsonResponse, readBody } =
    deps;
  let managerPromise: Promise<TerminalManager> | null = null;
  let wssPromise: Promise<WebSocketServer> | null = null;
  let closePromise: Promise<void> | null = null;

  /** Lazy-load the terminal manager the first time a terminal route is used. */
  async function getManager(): Promise<TerminalManager> {
    if (!managerPromise) {
      managerPromise = import("./terminal.js").then(
        ({ TerminalManager: TM }) => new TM(),
      );
    }
    return managerPromise;
  }

  /** Lazy-load the WebSocket server that bridges browser terminals to PTY sessions. */
  async function getWSS(): Promise<WebSocketServer> {
    if (!wssPromise) {
      wssPromise = import("ws").then(
        ({ WebSocketServer: WSS }) => new WSS({ noServer: true }),
      );
    }
    return wssPromise;
  }

  /** Map terminal-launch failures to the client-facing HTTP status codes we expose. */
  function terminalCreateStatus(message: string): number {
    return message.includes("Maximum") ||
      message.includes("not found") ||
      message.includes("not available") ||
      message.includes("not a directory") ||
      message.includes("does not exist") ||
      message.includes("too large")
      ? 400
      : 500;
  }

  /** Emit the terminal-unavailable startup warning once. */
  function logStartupNotice(): void {
    void getManager()
      .then((manager) => manager.health())
      .then((health) => {
        if (!health.nodePtyAvailable) {
          console.log(
            "Note: Terminal feature unavailable (node-pty not installed)",
          );
          console.log("  Fix: npm install node-pty (or: pnpm approve-builds)");
          console.log(
            "  See: https://github.com/blundergoat/goat-flow#troubleshooting",
          );
        }
      })
      .catch(() => {
        console.log(
          "Note: Terminal feature unavailable (node-pty not installed)",
        );
        console.log("  Fix: npm install node-pty (or: pnpm approve-builds)");
        console.log(
          "  See: https://github.com/blundergoat/goat-flow#troubleshooting",
        );
      });
  }

  /** Start a terminal session for the requested runner and workspace. */
  async function handleTerminalCreateRequest(
    req: IncomingMessage,
    url: URL,
    res: ServerResponse,
  ): Promise<boolean> {
    if (url.pathname !== "/api/terminal/create" || req.method !== "POST")
      return false;

    try {
      const manager = await getManager();
      const decoded = decodeTerminalCreateBody(await readBody(req), {
        validRunners,
        defaultRunner,
      });
      if (!decoded.ok) {
        jsonResponse(res, 400, { error: decoded.error, path: decoded.path });
        return true;
      }
      const { prompt, projectPath, runner } = decoded.value;
      const result = await manager.create(
        prompt,
        projectPath || absDefault,
        runner,
      );
      jsonResponse(res, 200, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      jsonResponse(res, terminalCreateStatus(message), { error: message });
    }
    return true;
  }

  /** Return the set of currently live terminal sessions. */
  async function handleTerminalListRequest(
    req: IncomingMessage,
    url: URL,
    res: ServerResponse,
  ): Promise<boolean> {
    if (url.pathname !== "/api/terminal/list" || req.method !== "GET")
      return false;

    try {
      const manager = await getManager();
      jsonResponse(res, 200, manager.list());
    } catch (err) {
      jsonResponse(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  /** Kill one terminal session and report whether it existed. */
  async function handleTerminalDeleteRequest(
    req: IncomingMessage,
    url: URL,
    res: ServerResponse,
  ): Promise<boolean> {
    if (!url.pathname.startsWith("/api/terminal/") || req.method !== "DELETE")
      return false;

    const id = url.pathname.slice("/api/terminal/".length);
    try {
      const manager = await getManager();
      const killed = manager.kill(id);
      if (killed) {
        jsonResponse(res, 200, { ok: true });
      } else {
        jsonResponse(res, 404, { error: "Session not found" });
      }
    } catch (err) {
      jsonResponse(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  /** Return terminal-backend health details for dashboard diagnostics. */
  async function handleHealthRequest(
    req: IncomingMessage,
    url: URL,
    res: ServerResponse,
  ): Promise<boolean> {
    if (url.pathname !== "/api/health" || req.method !== "GET") return false;

    try {
      const manager = await getManager();
      jsonResponse(res, 200, await manager.health());
    } catch (err) {
      jsonResponse(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  /** Return enriched terminal session info with age and idle duration. */
  async function handleTerminalSessionsRequest(
    req: IncomingMessage,
    url: URL,
    res: ServerResponse,
  ): Promise<boolean> {
    if (url.pathname !== "/api/terminal/sessions" || req.method !== "GET")
      return false;

    try {
      const manager = await getManager();
      const sessions = manager.list();
      const now = Date.now();
      const enriched = sessions.map((session) => ({
        ...session,
        age: Math.floor((now - new Date(session.createdAt).getTime()) / 1000),
        idleDuration: Math.floor((now - session.lastInputAt) / 1000),
      }));
      jsonResponse(res, 200, {
        sessions: enriched,
        maxSessions: MAX_SESSIONS,
        activeCount: sessions.length,
      });
    } catch (err) {
      jsonResponse(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  /** Handle terminal WebSocket upgrades and reject bad origins. */
  function handleTerminalUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    server: HttpServer,
  ): boolean {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (!url.pathname.startsWith("/ws/terminal/")) return false;

    const origin = req.headers.origin;
    const addr = server.address();
    if (origin && addr && typeof addr !== "string") {
      const expected = `http://127.0.0.1:${addr.port}`;
      if (origin !== expected && origin !== `http://localhost:${addr.port}`) {
        socket.destroy();
        return true;
      }
    }

    const sessionId = url.pathname.slice("/ws/terminal/".length);
    void (async () => {
      try {
        const wss = await getWSS();
        const manager = await getManager();
        wss.handleUpgrade(req, socket, head, (ws) => {
          manager.attachWebSocket(sessionId, ws as unknown as WsWebSocket);
        });
      } catch {
        socket.destroy();
      }
    })();
    return true;
  }

  /** Close terminal resources, including any active manager and WebSocket server. */
  async function close(): Promise<void> {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      if (managerPromise) {
        const manager = await managerPromise;
        manager.shutdown();
      }
      if (wssPromise) {
        const wss = await wssPromise;
        await new Promise<void>((resolve) => {
          wss.close(() => {
            resolve();
          });
        });
      }
    })();
    return closePromise;
  }

  return {
    handleTerminalCreateRequest,
    handleTerminalListRequest,
    handleTerminalDeleteRequest,
    handleHealthRequest,
    handleTerminalSessionsRequest,
    handleTerminalUpgrade,
    logStartupNotice,
    close,
  };
}
