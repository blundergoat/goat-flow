/**
 * Serve the dashboard page, browser assets, project-folder picker, hook controls, and installed-runner detection.
 *
 * Static assets use ETags so the browser can reuse unchanged bundles; hook requests read or update the selected project's installation.
 * Runner detection uses bounded local probes and reuses results until a caller explicitly requests a fresh check.
 *
 * Filesystem and probe failures become error responses or unavailable-runner results so the caller can explain the affected operation.
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

// Writes the dashboard shell response after injecting the default workspace path.
function handleHtmlRequest(
  ctx: DashboardRouteContext,
  url: URL,
  res: ServerResponse,
): boolean {
  // Only the dashboard entry page receives the server's initial workspace and session settings.
  if (url.pathname !== "/") return false;

  const injection = `<script>window.__GOAT_FLOW_DEFAULT_PATH__ = ${JSON.stringify(ctx.absDefault)}; window.__GOAT_FLOW_VERSION__ = ${JSON.stringify(ctx.packageVersion)}; window.__GOAT_FLOW_DASHBOARD_TOKEN__ = ${JSON.stringify(ctx.dashboardToken)}; window.__GOAT_FLOW_AGENTS__ = ${JSON.stringify(SUPPORTED_AGENTS)}; window.__GOAT_FLOW_RUNNER_IDS__ = ${JSON.stringify(KNOWN_AGENT_IDS)}; window.__GOAT_FLOW_PRESETS__ = ${JSON.stringify(ctx.dashboardPresets)};</script>`;
  // Development sessions reconnect after source changes; packaged dashboards need no reload connection.
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
  // Page and API requests must reach their own handlers instead of being treated as browser assets.
  if (!url.pathname.startsWith("/assets/")) return false;

  const filename = url.pathname.slice("/assets/".length);
  // Only a single supported asset filename is served; other paths fall through without reading arbitrary files.
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
    // The browser already has these exact asset bytes, so it can reuse them without downloading the bundle again.
    if (req.headers["if-none-match"] === asset.etag) {
      res.writeHead(304, headers);
      res.end();
      return true;
    }
    res.writeHead(200, headers);
    res.end(asset.content);
  } catch {
    // A missing packaged bundle, such as an asset from an incomplete installation, produces a 404 for that browser request.
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
  // Folder-picker navigation must not consume other project requests.
  if (url.pathname !== "/api/browse") return false;

  try {
    const dirPath = ctx.validatedPath(url.searchParams.get("path"), "browse");
    const entries = readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort();
    const dirs = entries.map((name) => {
      const childDirectoryPath = join(dirPath, name);
      return {
        name,
        path: childDirectoryPath,
        isProject: isProjectDirectory(childDirectoryPath),
      };
    });
    ctx.jsonResponse(res, 200, {
      current: dirPath,
      parent: dirname(dirPath),
      dirs,
    });
  } catch (err) {
    // Navigating into a folder without read permission fails listing; the picker receives the reason it cannot show that folder.
    ctx.jsonResponse(res, ctx.responseStatusForError(err, 500), {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return true;
}

// Return the hook named by a toggle URL, or null when the request belongs to another dashboard route.
function hookIdFromTogglePath(pathname: string): string | null {
  const match = pathname.match(/^\/api\/hooks\/([^/]+)\/toggle$/u);
  // An absent hook segment cannot identify a toggle, so the request continues through normal routing.
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

// Map hook registrar errors to HTTP status codes while preserving generic error handling.
function hookErrorStatus(ctx: DashboardRouteContext, err: unknown): number {
  // Hook validation already chose a useful refusal status; preserve it for the user's toggle result.
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
  // Opening the Hooks card reads installation state without changing any hook.
  if (url.pathname === "/api/hooks") {
    // Hook updates need a specific toggle URL; this collection endpoint only supplies the card's current state.
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
      // A selected project removed since page load cannot supply hook state; the card receives an error rather than missing-hook results.
      ctx.jsonResponse(res, hookErrorStatus(ctx, err), {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  const hookId = hookIdFromTogglePath(url.pathname);
  // A URL that names no hook toggle remains available to another route group.
  if (hookId === null) return false;
  // A hook change requires an explicit submission so fetching a URL cannot enable or disable it.
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
    // An invalid enabled value is rejected before the user's hook configuration can change.
    if (!decoded.ok) {
      ctx.jsonResponse(res, 400, { error: decoded.error, path: decoded.path });
      return true;
    }
    const hook = applyHookState(hookId, decoded.value.enabled, projectPath);
    ctx.jsonResponse(res, 200, { hook });
  } catch (err) {
    // A read-only project can prevent hook installation; return the registrar's error so the user knows the toggle did not complete.
    ctx.jsonResponse(res, hookErrorStatus(ctx, err), {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return true;
}

/**
 * Spawns bounded local probes so the dashboard can show available runners without requiring every agent to be installed.
 *
 * Swallows missing binaries and optional version failures into availability results; null versions mean no version was requested or obtained.
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
      // Normal page loads only need availability; a runner can be installed even when no version has been collected.
      let version: string | null = null;
      // An explicit re-check also asks each installed runner for its version, accepting the extra probe time.
      if (includeVersions) {
        try {
          version = normalizeAgentVersionOutput(
            execFileSync(agent.terminalBinary, ["--version"], {
              timeout: 5000,
              stdio: "pipe",
            }).toString(),
          );
        } catch {
          // Optional version detection can time out; intentionally ignore that failure and keep the runner available with its version unknown.
        }
      }
      return { ...agent, installed: true, version };
    } catch {
      // A runner absent from PATH fails the platform lookup; its unavailable result is sufficient feedback for the dashboard.
      return { ...agent, installed: false, version: null };
    }
  });
}

/**
 * Keep runner availability results for one set of dashboard handlers.
 *
 * A null cache means no local runner check has completed yet.
 * An explicit refresh replaces the saved result, including any newly collected version strings.
 */
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
  // Installed-runner detection must not consume project setup or hook requests.
  if (url.pathname !== "/api/agents/installed") return false;

  const fresh = url.searchParams.get("fresh") === "true";
  // The first visit needs an availability check; an explicit refresh also discovers runners installed since that visit.
  if (fresh || state.cached === null) {
    state.cached = detectInstalledAgents(fresh);
  }

  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ agents: state.cached }));
  return true;
}

/**
 * Bind page, asset, folder-picker, and hook requests to this server and keep runner-detection results available across page visits.
 *
 * @param ctx - per-server dashboard route context with path validation, template/version/token, and IO hooks
 * @returns handlers that answer matching shell or infrastructure requests, or return false for the next route group
 */
export function createShellRouteHandlers(ctx: DashboardRouteContext) {
  const agentDetection: AgentDetectionState = { cached: null };
  return {
    // Connect page loading to this server's default project, session token, and dashboard template.
    handleHtmlRequest: (url: URL, res: ServerResponse) =>
      handleHtmlRequest(ctx, url, res),
    handleAssetRequest,
    // Connect folder-picker navigation to the server's browsing policy and JSON response helper.
    handleBrowseRequest: (url: URL, res: ServerResponse) =>
      handleBrowseRequest(ctx, url, res),
    // Connect Hooks card reads and toggles to this server's selected-project validation.
    handleHooksRequest: (req: IncomingMessage, url: URL, res: ServerResponse) =>
      handleHooksRequest(ctx, req, url, res),
    // Connect runner availability requests to the cache shared by this server's page visits.
    handleAgentDetectRequest: (url: URL, res: ServerResponse) =>
      handleAgentDetectRequest(agentDetection, url, res),
  };
}
