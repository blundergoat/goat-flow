/**
 * Project-management HTTP route handlers for the dashboard server.
 *
 * Backs `/api/plans` (read/write the active milestone plan), `/api/projects/list` (load and persist the recent-projects list to disk), and
 * `/api/projects/status` (classify adoption for one or many paths).
 *
 * Mutating routes validate every incoming path through the route context before any write and report failures as JSON status bodies rather than
 * throwing.
 * Persistence and identity normalisation live in dashboard-project-state.ts; task-plan parsing in dashboard-task-state.ts.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { classifyProjectState } from "../classify-state.js";
import { createFS } from "../facts/fs.js";
import {
  hydrateDashboardState,
  loadDashboardState,
  resolveProjectIdentity,
  setDashboardProjectArchived,
  type DashboardStateData,
} from "./dashboard-project-state.js";
import type { DashboardRouteContext } from "./dashboard-route-types.js";
import {
  buildDashboardTaskState,
  readActiveTaskPlanBody,
  writeActiveTaskPlan,
} from "./dashboard-task-state.js";
import { validateLocalPath } from "./local-paths.js";

/**
 * Load the persisted recent-projects state, preferring the current state file and falling back to the legacy projects-only file.
 * Delegates to loadDashboardState, which swallows missing or malformed files and returns empty state, so callers always receive a usable object.
 */
function readDashboardState(ctx: DashboardRouteContext) {
  return loadDashboardState(ctx.dashboardStateFile, ctx.legacyProjectsListFile);
}

/**
 * Offer the folders sitting beside the project the dashboard was launched from, so a user can add a neighbouring repo without typing its path.
 * It swallows an unreadable parent directory into an empty list, and the alphabetical order is a stable contract so the suggestions do not
 * reshuffle between visits.
 *
 * @param launchProjectPath - project path supplied when the dashboard server started
 * @returns sorted absolute sibling paths, excluding hidden directories and the parent itself; empty when nothing could be listed
 */
export function discoverSiblingProjectPaths(
  launchProjectPath: string,
): string[] {
  const discoveryRoot = dirname(launchProjectPath);
  // The launch project is a filesystem root, so it has no siblings to offer.
  if (discoveryRoot === launchProjectPath) return [];

  try {
    return readdirSync(discoveryRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => join(discoveryRoot, entry.name))
      .sort((first, second) => first.localeCompare(second));
    // For example, the user launched from a directory whose parent they cannot read, so no suggestions are offered.
  } catch {
    return [];
  }
}

/** Return discovered siblings that have not been archived in this dashboard state. */
function activeDiscoveredProjectPaths(
  launchProjectPath: string,
  state: DashboardStateData,
): string[] {
  const archivedProjects = Object.values(state.projects).filter((project) =>
    Boolean(project.archivedAt),
  );

  return discoverSiblingProjectPaths(launchProjectPath).filter((path) => {
    const identity = resolveProjectIdentity(path, { allowMarkerWrite: false });
    return !archivedProjects.some(
      (project) =>
        project.identity === identity.identity ||
        project.paths.includes(identity.currentPath),
    );
  });
}

/**
 * Writes the normalized dashboard state to disk, then removes the legacy list once the replacement is safely on disk.
 *
 * @param ctx - dashboard route context supplying the state and legacy file paths
 * @param state - complete state to persist; it replaces the stored file rather than merging into it
 */
async function writeDashboardState(
  ctx: DashboardRouteContext,
  state: DashboardStateData,
): Promise<void> {
  const { mkdir, rm: remove, writeFile } = await import("node:fs/promises");
  await mkdir(dirname(ctx.dashboardStateFile), { recursive: true });
  await writeFile(ctx.dashboardStateFile, JSON.stringify(state, null, 2));
  await remove(ctx.legacyProjectsListFile, { force: true });
}

type ProjectArchiveAction = "archive" | "restore";

/**
 * Archive or restore one project after the user clicks it in the Projects list, then answer with the updated state.
 * It reports a wrong method, a bad body, or an unusable path as a JSON status body rather than throwing at the server.
 *
 * @param ctx - dashboard route context supplying path validation and response helpers
 * @param req - incoming POST request carrying the project path
 * @param res - JSON response target
 * @param action - whether the user asked to archive or restore
 */
async function handleProjectArchiveRequest(
  ctx: DashboardRouteContext,
  req: IncomingMessage,
  res: ServerResponse,
  action: ProjectArchiveAction,
): Promise<void> {
  if (req.method !== "POST") {
    ctx.jsonResponse(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const { decodeProjectPathBody } = await import("./decoders.js");
    const decoded = decodeProjectPathBody(await ctx.readBody(req));
    if (!decoded.ok) {
      ctx.jsonResponse(res, 400, {
        error: decoded.error,
        path: decoded.path,
      });
      return;
    }
    const projectPath = validateLocalPath(
      decoded.value.path,
      "write-local-state",
    ).path;
    const previousState = await readDashboardState(ctx);
    const nextState = setDashboardProjectArchived(
      previousState,
      projectPath,
      action === "archive" ? new Date().toISOString() : null,
    );
    await writeDashboardState(ctx, nextState);
    ctx.recordDashboardEvent(ctx.absDefault, "project.save", {
      project_count: nextState.paths.length,
      favorite_count: nextState.favorites.length,
      archived_count: action === "archive" ? 1 : 0,
      restored_count: action === "restore" ? 1 : 0,
    });
    ctx.jsonResponse(res, 200, { ok: true });
  } catch (err) {
    ctx.jsonResponse(res, 400, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Persists a whole projects list sent by an older client, keeping already-archived records rather than dropping them.
 * It reports a bad body or an unusable path as a JSON status body rather than throwing at the server.
 *
 * @param ctx - dashboard route context supplying path validation and response helpers
 * @param req - incoming POST request carrying the list of project paths
 * @param res - JSON response target
 */
async function handleProjectsListWriteRequest(
  ctx: DashboardRouteContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = await ctx.readBody(req);
  try {
    const { decodeProjectsListBody } = await import("./decoders.js");
    const decoded = decodeProjectsListBody(body);
    if (!decoded.ok) {
      ctx.jsonResponse(res, 400, {
        error: decoded.error,
        path: decoded.path,
      });
      return;
    }
    const previousState = await readDashboardState(ctx);
    const validatedProjectPaths = decoded.value.paths.map(
      (path) => validateLocalPath(path, "write-local-state").path,
    );
    const activeIdentities = new Set(
      validatedProjectPaths.map(
        (path) =>
          resolveProjectIdentity(path, { allowMarkerWrite: true }).identity,
      ),
    );
    const archivedAt = new Date().toISOString();
    const previousProjects = Object.fromEntries(
      Object.entries(previousState.projects).map(([identity, project]) => {
        const nextProject = { ...project };
        if (activeIdentities.has(identity)) {
          Reflect.deleteProperty(nextProject, "archivedAt");
          const title =
            decoded.value.projectTitles[identity] ??
            decoded.value.projectTitles[project.currentPath];
          if (title) nextProject.title = title;
          else Reflect.deleteProperty(nextProject, "title");
        } else if (!nextProject.archivedAt) {
          nextProject.archivedAt = archivedAt;
        }
        return [identity, nextProject];
      }),
    );
    const nextState = hydrateDashboardState(
      {
        ...decoded.value,
        paths: validatedProjectPaths,
        projects: previousProjects,
      },
      { allowMarkerWrite: true },
    );
    const previousActiveIdentities = new Set(
      Object.values(previousState.projects)
        .filter((project) => !project.archivedAt)
        .map((project) => project.identity),
    );
    const previousArchivedIdentities = new Set(
      Object.values(previousState.projects)
        .filter((project) => Boolean(project.archivedAt))
        .map((project) => project.identity),
    );
    const nextActiveIdentities = new Set(
      Object.values(nextState.projects)
        .filter((project) => !project.archivedAt)
        .map((project) => project.identity),
    );
    const archivedCount = [...previousActiveIdentities].filter(
      (identity) => !nextActiveIdentities.has(identity),
    ).length;
    const restoredCount = [...previousArchivedIdentities].filter((identity) =>
      nextActiveIdentities.has(identity),
    ).length;
    const addedCount = [...nextActiveIdentities].filter(
      (identity) => !Object.hasOwn(previousState.projects, identity),
    ).length;
    await writeDashboardState(ctx, nextState);
    ctx.recordDashboardEvent(ctx.absDefault, "project.save", {
      project_count: nextState.paths.length,
      favorite_count: nextState.favorites.length,
      added_count: addedCount,
      archived_count: archivedCount,
      restored_count: restoredCount,
    });
    ctx.jsonResponse(res, 200, { ok: true });
  } catch (err) {
    ctx.jsonResponse(res, 400, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Map an active-plan write error message to an HTTP status: a missing target is a
 * 404, anything else is treated as a 400 bad request.
 *
 * @param message - The error message thrown while writing the active plan.
 * @returns `404` when the message indicates a missing target, otherwise `400`.
 */
function planWriteErrorStatus(message: string): number {
  return message.includes("does not exist") || message.includes("not found")
    ? 404
    : 400;
}

/**
 * Switch which plan the Tasks view is working on, writing the `.active` marker and answering with the refreshed state.
 * It reports an unknown plan or an unwritable project as a JSON status body, so the user sees why the selection did not stick.
 *
 * @param ctx - dashboard route context supplying path validation and response helpers
 * @param req - incoming POST request carrying the plan name
 * @param url - request URL carrying the project path
 * @param res - JSON response target
 */
async function writeDashboardActivePlan(
  ctx: DashboardRouteContext,
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
): Promise<void> {
  try {
    const projectPath = ctx.validatedPath(
      url.searchParams.get("path"),
      "write-local-state",
    );
    const planName = readActiveTaskPlanBody(await ctx.readBody(req));
    writeActiveTaskPlan(projectPath, planName);
    ctx.jsonResponse(res, 200, buildDashboardTaskState(projectPath, planName));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.jsonResponse(res, planWriteErrorStatus(message), { error: message });
  }
}

/**
 * Answer the Tasks view with the plans in this project and the milestones of the selected one.
 * It reports an unreadable project as a JSON status body rather than throwing at the server.
 *
 * @param ctx - dashboard route context supplying path validation and response helpers
 * @param url - request URL carrying the project path and the plan the user clicked
 * @param res - JSON response target
 */
function readDashboardPlans(
  ctx: DashboardRouteContext,
  url: URL,
  res: ServerResponse,
): void {
  try {
    const projectPath = ctx.validatedPath(
      url.searchParams.get("path"),
      "project-read",
    );
    ctx.jsonResponse(
      res,
      200,
      buildDashboardTaskState(projectPath, url.searchParams.get("plan")),
    );
  } catch (err) {
    ctx.jsonResponse(res, ctx.responseStatusForError(err, 500), {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Return or update milestone/plan state for the selected project. */
async function handleTasksRequest(
  ctx: DashboardRouteContext,
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
): Promise<boolean> {
  if (url.pathname !== "/api/plans" && url.pathname !== "/api/tasks") {
    return false;
  }

  if (req.method === "POST") {
    await writeDashboardActivePlan(ctx, req, url, res);
    return true;
  }

  if (req.method !== "GET") {
    ctx.jsonResponse(res, 405, { error: "Method not allowed" });
    return true;
  }

  readDashboardPlans(ctx, url, res);
  return true;
}

/** Save/load the dashboard state to/from disk so it survives server restarts. */
async function handleProjectsListRequest(
  ctx: DashboardRouteContext,
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
): Promise<boolean> {
  const archiveAction =
    url.pathname === "/api/projects/archive"
      ? "archive"
      : url.pathname === "/api/projects/restore"
        ? "restore"
        : null;

  if (archiveAction !== null) {
    await handleProjectArchiveRequest(ctx, req, res, archiveAction);
    return true;
  }

  if (url.pathname !== "/api/projects/list") return false;

  if (req.method === "GET") {
    const state = await readDashboardState(ctx);
    ctx.jsonResponse(res, 200, {
      ...state,
      discoveredPaths: activeDiscoveredProjectPaths(ctx.absDefault, state),
    });
    return true;
  }

  if (req.method === "POST") {
    await handleProjectsListWriteRequest(ctx, req, res);
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
        allowMarkerWrite: false,
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
 * @returns the plans, projects-list, and projects-status handlers; each resolves true once it has
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
