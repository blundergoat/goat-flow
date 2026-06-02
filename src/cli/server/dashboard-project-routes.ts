/**
 * Project-management HTTP route handlers for the dashboard server.
 *
 * Backs `/api/tasks` (read/write the active milestone plan), `/api/projects/list` (load and persist
 * the recent-projects list to disk), and `/api/projects/status` (classify adoption for one or many
 * paths). Mutating routes validate every incoming path through the route context before any write and
 * report failures as JSON status bodies rather than throwing. Persistence and identity normalisation
 * live in dashboard-project-state.ts; task-plan parsing in dashboard-task-state.ts.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname } from "node:path";
import { classifyProjectState } from "../classify-state.js";
import { createFS } from "../facts/fs.js";
import {
  hydrateDashboardState,
  loadDashboardState,
  resolveProjectIdentity,
} from "./dashboard-project-state.js";
import type { DashboardRouteContext } from "./dashboard-route-types.js";
import {
  buildDashboardTaskState,
  readActiveTaskPlanBody,
  writeActiveTaskPlan,
} from "./dashboard-task-state.js";
import { validateLocalPath } from "./local-paths.js";

/**
 * Load the persisted recent-projects state, preferring the current state file and falling back to the
 * legacy projects-only file. Delegates to loadDashboardState, which swallows missing or malformed
 * files and returns empty state, so callers always receive a usable object.
 */
function readDashboardState(ctx: DashboardRouteContext) {
  return loadDashboardState(ctx.dashboardStateFile, ctx.legacyProjectsListFile);
}

/** Return or update milestone/task state for the selected project. */
async function handleTasksRequest(
  ctx: DashboardRouteContext,
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
): Promise<boolean> {
  if (url.pathname !== "/api/tasks") return false;

  const requestedPlan = url.searchParams.get("plan");
  if (req.method === "POST") {
    try {
      const projectPath = ctx.validatedPath(
        url.searchParams.get("path"),
        "write-local-state",
      );
      const planName = readActiveTaskPlanBody(await ctx.readBody(req));
      writeActiveTaskPlan(projectPath, planName);
      ctx.jsonResponse(
        res,
        200,
        buildDashboardTaskState(projectPath, planName),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status =
        message.includes("does not exist") || message.includes("not found")
          ? 404
          : 400;
      ctx.jsonResponse(res, status, { error: message });
    }
    return true;
  }

  if (req.method !== "GET") {
    ctx.jsonResponse(res, 405, { error: "Method not allowed" });
    return true;
  }

  try {
    const projectPath = ctx.validatedPath(
      url.searchParams.get("path"),
      "project-read",
    );
    ctx.jsonResponse(
      res,
      200,
      buildDashboardTaskState(projectPath, requestedPlan),
    );
  } catch (err) {
    ctx.jsonResponse(res, ctx.responseStatusForError(err, 500), {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return true;
}

/** Save/load the dashboard state to/from disk so it survives server restarts. */
async function handleProjectsListRequest(
  ctx: DashboardRouteContext,
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
): Promise<boolean> {
  if (url.pathname !== "/api/projects/list") return false;

  if (req.method === "GET") {
    ctx.jsonResponse(res, 200, await readDashboardState(ctx));
    return true;
  }

  if (req.method === "POST") {
    const body = await ctx.readBody(req);
    try {
      const { decodeProjectsListBody } = await import("./decoders.js");
      const decoded = decodeProjectsListBody(body);
      if (!decoded.ok) {
        ctx.jsonResponse(res, 400, {
          error: decoded.error,
          path: decoded.path,
        });
        return true;
      }
      const { mkdir, rm: remove, writeFile } = await import("node:fs/promises");
      const previousState = await readDashboardState(ctx);
      const validatedProjectPaths = decoded.value.paths.map(
        (path) => validateLocalPath(path, "write-local-state").path,
      );
      const nextState = hydrateDashboardState(
        {
          ...decoded.value,
          paths: validatedProjectPaths,
          projects: {},
        },
        { allowMarkerWrite: true },
      );
      const previousPaths = new Set(previousState.paths);
      const nextPaths = new Set(nextState.paths);
      const removedCount = previousState.paths.filter(
        (path) => !nextPaths.has(path),
      ).length;
      const addedCount = nextState.paths.filter(
        (path) => !previousPaths.has(path),
      ).length;
      await mkdir(dirname(ctx.dashboardStateFile), { recursive: true });
      await writeFile(
        ctx.dashboardStateFile,
        JSON.stringify(nextState, null, 2),
      );
      await remove(ctx.legacyProjectsListFile, { force: true });
      ctx.recordDashboardEvent(ctx.absDefault, "project.save", {
        project_count: nextState.paths.length,
        favorite_count: nextState.favorites.length,
        added_count: addedCount,
        removed_count: removedCount,
      });
      if (removedCount > 0) {
        ctx.recordDashboardEvent(ctx.absDefault, "project.remove", {
          removed_count: removedCount,
        });
      }
      ctx.jsonResponse(res, 200, { ok: true });
    } catch (err) {
      ctx.jsonResponse(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  ctx.jsonResponse(res, 405, { error: "Method not allowed" });
  return true;
}

/**
 * Classify project adoption for one or more paths because the dashboard sends
 * both the current project and stored recent projects through the same route.
 *
 * Reports malformed path lists and validation failures as JSON.
 */
function handleProjectsStatusRequest(
  ctx: DashboardRouteContext,
  url: URL,
  res: ServerResponse,
): boolean {
  if (url.pathname !== "/api/projects/status") return false;

  const pathsParam = url.searchParams.get("paths");
  if (!pathsParam) {
    ctx.jsonResponse(res, 400, { error: "Missing paths parameter" });
    return true;
  }

  const paths = pathsParam
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  const results = paths.map((p) => {
    try {
      const projectPath = validateLocalPath(p, "write-local-state").path;
      const identity = resolveProjectIdentity(projectPath, {
        allowMarkerWrite: true,
      });
      const fs = createFS(identity.currentPath);
      return {
        path: identity.currentPath,
        paths: [identity.currentPath],
        ...identity,
        ...classifyProjectState(fs),
      };
    } catch (err) {
      return {
        path: p,
        state: "error" as const,
        action: "none" as const,
        details: String(err),
      };
    }
  });

  if (paths.length === 1) {
    const result = results[0];
    if (result?.state !== "error" && typeof result?.path === "string") {
      ctx.recordDashboardEvent(result.path, "project.switch", {
        state: result.state,
        identity: "identity" in result ? result.identity : "",
        identity_source:
          "identitySource" in result ? result.identitySource : "",
      });
    }
  }

  ctx.jsonResponse(res, 200, { projects: results });
  return true;
}

/**
 * Bind the project-management handlers to one server's request context so each closure carries the
 * shared path validator, state-file locations, and evidence recorder.
 *
 * @param ctx - per-server dashboard route context with path validation, state-file paths, and IO hooks
 * @returns the tasks, projects-list, and projects-status handlers; each resolves true once it has
 *   answered a matching request, or false to let another handler claim the URL
 */
export function createProjectRouteHandlers(ctx: DashboardRouteContext) {
  return {
    handleTasksRequest: (req: IncomingMessage, url: URL, res: ServerResponse) =>
      handleTasksRequest(ctx, req, url, res),
    handleProjectsListRequest: (
      req: IncomingMessage,
      url: URL,
      res: ServerResponse,
    ) => handleProjectsListRequest(ctx, req, url, res),
    handleProjectsStatusRequest: (url: URL, res: ServerResponse) =>
      handleProjectsStatusRequest(ctx, url, res),
  };
}
