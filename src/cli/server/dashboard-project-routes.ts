/**
 * Serve the selected project's plans and the dashboard's saved and nearby project lists.
 *
 * The Projects view can add, archive, restore, and classify folders; the Tasks view reads plans and selects the active plan.
 * Path validation protects writes, and route handlers report rejected requests and storage failures as JSON errors.
 *
 * dashboard-project-state.ts owns saved identities; dashboard-task-state.ts owns plan parsing and active-plan updates.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { classifyProjectState } from "../classify-state.js";
import { createFS } from "../facts/fs.js";
import {
  dashboardStateHasProjectPath,
  freshIdentityForSavedRecord,
  hydrateDashboardState,
  loadDashboardState,
  moveProjectRecordToIdentity,
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
import { LocalPathValidationError, validateLocalPath } from "./local-paths.js";
import { writeFileAtomic } from "./safe-exec.js";

/**
 * Load the persisted recent-projects state, preferring the current state file and falling back to the legacy projects-only file.
 * Delegates to loadDashboardState, which swallows missing or malformed files and returns empty state, so callers always receive a usable object.
 */
function readDashboardState(ctx: DashboardRouteContext) {
  return loadDashboardState(ctx.dashboardStateFile, ctx.legacyProjectsListFile);
}

/**
 * Offer nearby repositories beside the launch project so the Projects view can suggest folders without manual path entry.
 *
 * Swallows listing failures into an empty result; alphabetical ordering keeps suggestions stable between visits.
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
  } catch {
    // A parent directory without read permission leaves the Projects view with no nearby suggestions.
    return [];
  }
}

/**
 * List the neighbouring folders the Projects view suggests as "nearby projects", leaving out any the user has archived.
 * Runs on every load of the Projects list, so it has to stay cheap for a parent folder holding many repositories.
 *
 * @param launchProjectPath - project the dashboard was started from; its parent folder is what gets listed
 * @param state - saved dashboard state; an empty `projects` map means nothing has been archived yet
 * @returns sibling folder paths in alphabetical order; empty when the parent folder is unreadable or the project sits at a filesystem root
 */
function activeDiscoveredProjectPaths(
  launchProjectPath: string,
  state: DashboardStateData,
): string[] {
  const archivedProjects = Object.values(state.projects).filter((project) =>
    Boolean(project.archivedAt),
  );
  const discoveredPaths = discoverSiblingProjectPaths(launchProjectPath);
  // Nothing archived means nothing to hide, so skip the per-folder identity lookups (each one shells out to git).
  // The user sees the same suggestions in the same order; only the wait on a folder of many repositories disappears.
  if (archivedProjects.length === 0) return discoveredPaths;

  return discoveredPaths.filter((path) => {
    const identity = resolveProjectIdentity(path, { allowMarkerWrite: false });
    // A folder stays hidden when it matches an archived row by identity or by any path that row was ever saved under.
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
  const { rm: remove } = await import("node:fs/promises");
  writeFileAtomic(
    ctx.dashboardStateFile,
    JSON.stringify(state, null, 2),
    ctx.absDefault,
  );
  await remove(ctx.legacyProjectsListFile, { force: true });
}

type ProjectArchiveAction = "archive" | "restore";

/**
 * Resolve the folder for Archive or Restore; Archive also accepts an exact saved path whose folder has been deleted.
 *
 * Throws validation errors for Restore, other path failures, or missing paths absent from saved state.
 *
 * @param rawPath - path of the row the user clicked, exactly as the browser sent it
 * @param action - `archive` may name a deleted saved row; `restore` always needs a folder that exists
 * @param state - saved dashboard state the stale-row check looks the path up in
 * @returns absolute path to archive or restore; never empty
 */
function resolveArchiveRequestPath(
  rawPath: string,
  action: ProjectArchiveAction,
  state: DashboardStateData,
): string {
  try {
    return validateLocalPath(rawPath, "write-local-state").path;
  } catch (err) {
    // Typical cause: the user deleted a project folder from disk and now clicks Archive on its leftover row in the Projects list.
    // Only that case passes, by the exact saved path; Restore, other failures, and unknown missing paths keep the original error.
    if (
      action === "archive" &&
      err instanceof LocalPathValidationError &&
      err.validationClass === "missing" &&
      dashboardStateHasProjectPath(state, rawPath)
    ) {
      return resolve(rawPath);
    }
    throw err;
  }
}

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
  // Archiving or restoring a saved project requires an explicit update request.
  if (req.method !== "POST") {
    ctx.jsonResponse(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const { decodeProjectPathBody } = await import("./decoders.js");
    const decoded = decodeProjectPathBody(await ctx.readBody(req));
    // The request carried no `path` field or a non-string one, so the click is refused before anything is read or written.
    if (!decoded.ok) {
      ctx.jsonResponse(res, 400, {
        error: decoded.error,
        path: decoded.path,
      });
      return;
    }
    // Saved state is read before the path is validated so a deleted project can still be matched to the row the user saved.
    const previousState = await readDashboardState(ctx);
    const projectPath = resolveArchiveRequestPath(
      decoded.value.path,
      action,
      previousState,
    );
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
    // For example the user clicks Restore on a row whose folder was deleted, or the dashboard state file cannot be written.
    // The Projects view receives an error response so it can explain why the action did not complete.
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
    // Invalid list fields must be corrected before any saved project or favorite can change.
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
    const resolvedIdentities = validatedProjectPaths.map((path) =>
      resolveProjectIdentity(path, { allowMarkerWrite: true }),
    );
    const activeIdentities = new Set(
      resolvedIdentities.map((identity) => identity.identity),
    );
    const archivedAt = new Date().toISOString();
    const previousProjects = Object.fromEntries(
      Object.entries(previousState.projects).map(([identity, project]) => {
        const nextProject = { ...project };
        // A saved row whose folder now resolves to a different identity (its git remote changed) is moved onto that identity first;
        // otherwise it would be archived below and the rebuild would add a second active row for the same checkout.
        const freshIdentity = freshIdentityForSavedRecord(
          nextProject,
          resolvedIdentities,
        );
        // A changed repository identity must keep the user's saved row attached to the same checkout.
        if (freshIdentity)
          moveProjectRecordToIdentity(nextProject, freshIdentity);
        // The browser may still title the row by the key it last loaded, so both keys and the path are tried.
        if (activeIdentities.has(nextProject.identity)) {
          Reflect.deleteProperty(nextProject, "archivedAt");
          const title =
            decoded.value.projectTitles[identity] ??
            decoded.value.projectTitles[nextProject.identity] ??
            decoded.value.projectTitles[project.currentPath];
          // A supplied title is kept; an empty or omitted title restores the row's automatic name.
          if (title) nextProject.title = title;
          else Reflect.deleteProperty(nextProject, "title");
        } else if (
          // Omitted active rows become archived so their saved identity remains available for Restore.
          !nextProject.archivedAt
        ) {
          nextProject.archivedAt = archivedAt;
        }
        // The rebuild keys rows by their identity field, so a moved row lands under its fresh key even though this map keeps the old one.
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
    // A submitted folder that no longer exists fails validation; the Projects view receives the reason the list could not be saved.
    ctx.jsonResponse(res, 400, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Distinguish a missing plan from other rejected selections so the Tasks view receives a useful failure status.
 *
 * @param message - error thrown while selecting the active plan
 * @returns 404 when the target is missing, otherwise 400 for a rejected selection
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
    // A plan deleted after the Tasks list loaded cannot be selected; return the missing-target status and explanation.
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
    // A project folder removed since selection cannot supply plans; the Tasks view receives an error instead of an empty plan list.
    ctx.jsonResponse(res, ctx.responseStatusForError(err, 500), {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Return or update milestone/plan state for the selected project.
async function handleTasksRequest(
  ctx: DashboardRouteContext,
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
): Promise<boolean> {
  // The current plan endpoint and its Tasks alias share this handler; other URLs must continue through routing.
  if (url.pathname !== "/api/plans" && url.pathname !== "/api/tasks") {
    return false;
  }

  // A submitted selection updates the active-plan marker before returning refreshed Tasks state.
  if (req.method === "POST") {
    await writeDashboardActivePlan(ctx, req, url, res);
    return true;
  }

  // Tasks supports reading plans or submitting a selection, so other methods receive a rejection.
  if (req.method !== "GET") {
    ctx.jsonResponse(res, 405, { error: "Method not allowed" });
    return true;
  }

  readDashboardPlans(ctx, url, res);
  return true;
}

// Save/load the dashboard state to/from disk so it survives server restarts.
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

  // Archive and Restore update one saved row without requiring the caller to resubmit its whole project list.
  if (archiveAction !== null) {
    await handleProjectArchiveRequest(ctx, req, res, archiveAction);
    return true;
  }

  // A URL outside the saved-project routes remains available to another dashboard handler.
  if (url.pathname !== "/api/projects/list") return false;

  // Opening Projects combines the persisted list with nearby folders the user has not archived.
  if (req.method === "GET") {
    const state = await readDashboardState(ctx);
    ctx.jsonResponse(res, 200, {
      ...state,
      discoveredPaths: activeDiscoveredProjectPaths(ctx.absDefault, state),
    });
    return true;
  }

  // A list submission persists the caller's projects and favorites for future dashboard sessions.
  if (req.method === "POST") {
    await handleProjectsListWriteRequest(ctx, req, res);
    return true;
  }

  ctx.jsonResponse(res, 405, { error: "Method not allowed" });
  return true;
}

/**
 * Classify the selected and saved project folders so their dashboard rows show the next available setup action.
 *
 * Reports missing path lists as a request error and individual invalid folders as error rows.
 */
function handleProjectsStatusRequest(
  ctx: DashboardRouteContext,
  url: URL,
  res: ServerResponse,
): boolean {
  // Adoption status is separate from saving the project list, so unrelated URLs are left for other handlers.
  if (url.pathname !== "/api/projects/status") return false;

  const pathsParam = url.searchParams.get("paths");
  // Without a folder list, the caller has not identified any project whose setup state can be shown.
  if (!pathsParam) {
    ctx.jsonResponse(res, 400, { error: "Missing paths parameter" });
    return true;
  }

  const paths = pathsParam
    .split(",")
    .map((requestedPath) => requestedPath.trim())
    .filter(Boolean);

  const results = paths.map((requestedPath) => {
    try {
      const projectPath = validateLocalPath(
        requestedPath,
        "write-local-state",
      ).path;
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
      // A saved folder may have been deleted; retain its error row so the other projects can still display their setup status.
      return {
        path: requestedPath,
        state: "error" as const,
        action: "none" as const,
        details: String(err),
      };
    }
  });

  // A single-folder lookup represents a project switch; bulk row refreshes do not add switch events.
  if (paths.length === 1) {
    const result = results[0];
    // Only a successfully classified folder counts as a completed project switch in the timeline.
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
 * Bind the Projects and Tasks requests to this server's path validator, saved-state locations, and evidence recorder.
 *
 * @param ctx - per-server dashboard route context with path validation, state-file paths, and IO hooks
 * @returns handlers that answer matching plan or project requests, or return false for the next route group
 */
export function createProjectRouteHandlers(ctx: DashboardRouteContext) {
  return {
    // Connect Tasks reads and active-plan selections to this dashboard server.
    handleTasksRequest: (req: IncomingMessage, url: URL, res: ServerResponse) =>
      handleTasksRequest(ctx, req, url, res),
    // Connect saved-project list, Archive, and Restore requests to this server's persisted state.
    handleProjectsListRequest: (
      req: IncomingMessage,
      url: URL,
      res: ServerResponse,
    ) => handleProjectsListRequest(ctx, req, url, res),
    // Connect project-row status checks to this server's response and timeline helpers.
    handleProjectsStatusRequest: (url: URL, res: ServerResponse) =>
      handleProjectsStatusRequest(ctx, url, res),
  };
}
