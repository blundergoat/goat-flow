/**
 * Shell and infrastructure HTTP route handlers for the dashboard server.
 *
 * Backs the HTML shell (`/`, with the bootstrap injection), static asset serving (`/assets/`, with ETag/304 handling), the directory picker
 * (`/api/browse`), hook state read/toggle (`/api/hooks`), and agent-availability detection (`/api/agents/installed`).
 *
 * Agent detection spawns `which`/`where` and `--version` probes with short timeouts and caches the result per handler set, refreshing only on an
 * explicit `fresh=true`.
 * Filesystem and probe failures are reported as JSON error bodies or recorded as "not installed" rather than thrown.
 *
 * Asset loading lives in dashboard-assets.ts; hook mutation in hook-registrar.ts.
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { loadDashboardAssetCached } from "./dashboard-assets.js";
import type { DashboardRouteContext } from "./dashboard-route-types.js";
import {
  KNOWN_AGENT_IDS,
  SUPPORTED_AGENTS,
  normalizeAgentVersionOutput,
} from "./dashboard-route-types.js";
import {
  HookRegistrarError,
  applyHookState,
  readAllHookStates,
} from "./hook-registrar.js";
import { isProjectDirectory } from "./setup-detect.js";

/** Writes the dashboard shell response after injecting the default workspace path. */
function handleHtmlRequest(
  ctx: DashboardRouteContext,
  url: URL,
  res: ServerResponse,
): boolean {
  if (url.pathname !== "/") return false;

  const injection = `<script>window.__GOAT_FLOW_DEFAULT_PATH__ = ${JSON.stringify(ctx.absDefault)}; window.__GOAT_FLOW_VERSION__ = ${JSON.stringify(ctx.packageVersion)}; window.__GOAT_FLOW_DASHBOARD_TOKEN__ = ${JSON.stringify(ctx.dashboardToken)}; window.__GOAT_FLOW_AGENTS__ = ${JSON.stringify(SUPPORTED_AGENTS)}; window.__GOAT_FLOW_RUNNER_IDS__ = ${JSON.stringify(KNOWN_AGENT_IDS)}; window.__GOAT_FLOW_PRESETS__ = ${JSON.stringify(ctx.dashboardPresets)};</script>`;
  const liveReloadScript = ctx.isDevMode
    ? `<script>(function(){var ws=new WebSocket('ws://'+location.host+'/ws/livereload');ws.onmessage=function(){location.reload()};ws.onclose=function(){setTimeout(function(){location.reload()},1000)}})()</script>`
    : "";
  const html = ctx
    .getTemplate()
    .replace("</body>", `${injection}\n${liveReloadScript}\n</body>`);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
  return true;
}

/**
 * Serve the bundled dashboard assets a browser asks for after loading the shell page.
 * It writes the response itself, and reports a missing or unreadable asset as a 404 so one bad request cannot end the server.
 *
 * @param req - incoming request, whose ETag header decides whether a 304 is enough
 * @param url - request URL under `/assets/`
 * @param res - response written directly by this handler
 * @returns true once this route has answered; false means the URL belongs to another handler
 */
function handleAssetRequest(
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
): boolean {
  if (!url.pathname.startsWith("/assets/")) return false;

  const filename = url.pathname.slice("/assets/".length);
  if (!/^[a-z0-9_-]+\.(js|css|json)$/i.test(filename)) return false;

  const contentType = filename.endsWith(".css")
    ? "text/css; charset=utf-8"
    : filename.endsWith(".json")
      ? "application/json; charset=utf-8"
      : "application/javascript; charset=utf-8";
  try {
    const asset = loadDashboardAssetCached(filename);
    const headers = {
      "Cache-Control": "no-cache",
      "Content-Type": contentType,
      ETag: asset.etag,
    };
    if (req.headers["if-none-match"] === asset.etag) {
      res.writeHead(304, headers);
      res.end();
      return true;
    }
    res.writeHead(200, headers);
    res.end(asset.content);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
  return true;
}

/**
 * List child directories for the path picker with a stable `{ current, parent, dirs }` shape.
 *
 * Reports validation and filesystem read failures as JSON.
 */
function handleBrowseRequest(
  ctx: DashboardRouteContext,
  url: URL,
  res: ServerResponse,
): boolean {
  if (url.pathname !== "/api/browse") return false;

  try {
    const dirPath = ctx.validatedPath(url.searchParams.get("path"), "browse");
    const entries = readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort();
    const dirs = entries.map((name) => {
      const full = join(dirPath, name);
      return { name, path: full, isProject: isProjectDirectory(full) };
    });
    ctx.jsonResponse(res, 200, {
      current: dirPath,
      parent: dirname(dirPath),
      dirs,
    });
  } catch (err) {
    ctx.jsonResponse(res, ctx.responseStatusForError(err, 500), {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return true;
}

/** Extract a hook id from dashboard toggle route paths. */
function hookIdFromTogglePath(pathname: string): string | null {
  const match = pathname.match(/^\/api\/hooks\/([^/]+)\/toggle$/u);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/** Map hook registrar errors to HTTP status codes while preserving generic error handling. */
function hookErrorStatus(ctx: DashboardRouteContext, err: unknown): number {
  if (err instanceof HookRegistrarError) return err.statusCode;
  return ctx.responseStatusForError(err, 500);
}

/**
 * Answer the Hooks card, either reading current hook state or applying the toggle the user just clicked.
 * It reports a bad body or a failed install as a JSON status body rather than throwing at the server.
 *
 * @param ctx - dashboard route context supplying path validation and response helpers
 * @param req - incoming request; a POST carries the toggle the user chose
 * @param url - request URL carrying the project path
 * @param res - JSON response target
 * @returns true once this route has answered; false means the URL belongs to another handler
 */
async function handleHooksRequest(
  ctx: DashboardRouteContext,
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
): Promise<boolean> {
  if (url.pathname === "/api/hooks") {
    if (req.method !== "GET") {
      ctx.jsonResponse(res, 405, { error: "Method not allowed" });
      return true;
    }
    try {
      const projectPath = ctx.validatedPath(
        url.searchParams.get("path"),
        "project-read",
      );
      ctx.jsonResponse(res, 200, { hooks: readAllHookStates(projectPath) });
    } catch (err) {
      ctx.jsonResponse(res, hookErrorStatus(ctx, err), {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  const hookId = hookIdFromTogglePath(url.pathname);
  if (hookId === null) return false;
  if (req.method !== "POST") {
    ctx.jsonResponse(res, 405, { error: "Method not allowed" });
    return true;
  }

  try {
    const projectPath = ctx.validatedPath(
      url.searchParams.get("path"),
      "write-local-state",
    );
    const { decodeHookToggleBody } = await import("./decoders.js");
    const decoded = decodeHookToggleBody(await ctx.readBody(req));
    if (!decoded.ok) {
      ctx.jsonResponse(res, 400, { error: decoded.error, path: decoded.path });
      return true;
    }
    const hook = applyHookState(hookId, decoded.value.enabled, projectPath);
    ctx.jsonResponse(res, 200, { hook });
  } catch (err) {
    ctx.jsonResponse(res, hookErrorStatus(ctx, err), {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return true;
}

/**
 * Spawns lightweight agent probes because the dashboard needs availability
 * without failing page load when a runner is missing.
 *
 * Swallows missing binaries and optional version failures.
 */
function detectInstalledAgents(includeVersions: boolean): {
  id: string;
  name: string;
  installed: boolean;
  version: string | null;
}[] {
  return SUPPORTED_AGENTS.map((agent) => {
    try {
      const whichCmd = process.platform === "win32" ? "where" : "which";
      execFileSync(whichCmd, [agent.terminalBinary], {
        timeout: 3000,
        stdio: "pipe",
      });
      let version: string | null = null;
      if (includeVersions) {
        try {
          version = normalizeAgentVersionOutput(
            execFileSync(agent.terminalBinary, ["--version"], {
              timeout: 5000,
              stdio: "pipe",
            }).toString(),
          );
        } catch {
          /* version detection optional */
        }
      }
      return { ...agent, installed: true, version };
    } catch {
      return { ...agent, installed: false, version: null };
    }
  });
}

type AgentDetectionState = {
  cached: ReturnType<typeof detectInstalledAgents> | null;
};

/**
 * Tell the dashboard which agents are actually installed on this machine, reusing the cached answer unless the user asked to re-check.
 * A fresh probe spawns the platform lookup and version commands, which is why the result is cached rather than recomputed per request.
 *
 * @param state - per-server detection cache
 * @param url - request URL, where `fresh=true` forces a new probe
 * @param res - JSON response target
 * @returns true once this route has answered; false means the URL belongs to another handler
 */
function handleAgentDetectRequest(
  state: AgentDetectionState,
  url: URL,
  res: ServerResponse,
): boolean {
  if (url.pathname !== "/api/agents/installed") return false;

  const fresh = url.searchParams.get("fresh") === "true";
  if (fresh || state.cached === null) {
    state.cached = detectInstalledAgents(fresh);
  }

  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ agents: state.cached }));
  return true;
}

/**
 * Bind the shell/infrastructure handlers to one server's request context and allocate the per-handler
 * agent-detection cache so probe results persist across requests until a fresh probe is requested.
 *
 * @param ctx - per-server dashboard route context with path validation, template/version/token, and IO hooks
 * @returns the HTML, asset, browse, hooks, and agent-detect handlers; each resolves true once it has
 *   answered a matching request, or false to let another handler claim the URL
 */
export function createShellRouteHandlers(ctx: DashboardRouteContext) {
  const agentDetection: AgentDetectionState = { cached: null };
  return {
    handleHtmlRequest: (url: URL, res: ServerResponse) =>
      handleHtmlRequest(ctx, url, res),
    handleAssetRequest,
    handleBrowseRequest: (url: URL, res: ServerResponse) =>
      handleBrowseRequest(ctx, url, res),
    handleHooksRequest: (req: IncomingMessage, url: URL, res: ServerResponse) =>
      handleHooksRequest(ctx, req, url, res),
    handleAgentDetectRequest: (url: URL, res: ServerResponse) =>
      handleAgentDetectRequest(agentDetection, url, res),
  };
}
