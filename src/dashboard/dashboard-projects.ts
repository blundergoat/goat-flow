/**
 * Manage the Projects screen, project browser, saved project list, and dashboard state.
 * Use when a user adds a project, switches between workspaces, edits a display title, or refreshes status.
 * The helpers keep Alpine methods thin while preserving the path, title, and identity data users see.
 */

/**
 * Dashboard state required by project-list, browser, title, and persistence helpers.
 * Use when a Projects action needs the same state that the user sees on screen.
 * Empty strings mean a field is not currently visible or selected in the UI.
 * Invariant: these method names must match the Alpine fragments that call them.
 */
interface DashboardProjectsContext {
  projectPath: string;
  showBrowser: boolean;
  browserCurrent: string;
  browserParent: string;
  browserDirs: BrowseDir[];
  projectsList: ProjectEntry[];
  projectsAuditing: boolean;
  showAddProject: boolean;
  projectsSortKey: ProjectSortKey;
  projectsSortAsc: boolean;
  newProjectPath: string;
  projectTitles: Record<string, string>;
  projectIdentities: Record<string, string>;
  editingProjectTitle: boolean;
  projectTitleDraft: string;
  presetFavorites: string[];
  /**
   * Return the visible project title for a path, honoring saved aliases.
   *
   * @param path - project path shown in the UI; empty means the raw display name fallback is used
   * @returns project title shown to the user, or a path-derived fallback when no alias exists
   */
  displayNameFor(path: string): string;
  /**
   * Return the stable identity key used for saved project titles.
   *
   * @param path - project path being titled; empty means title state cannot bind to a project identity
   * @returns saved title key, or the path when no durable identity is known
   */
  projectKeyFor(path: string): string;
  /**
   * Refresh the active project audit from the user's current workspace.
   *
   * @param includeFresh - when `true`, the user asked for a fresh audit instead of a cached dashboard result
   * @returns promise that settles after audit UI state has been refreshed or an error has been surfaced
   */
  runAudit(includeFresh?: boolean): Promise<void>;
  /**
   * Surface a dashboard toast message for the current user action.
   *
   * @param message - toast copy; empty means the toast would show no useful user feedback
   * @param isError - when `true`, the toast uses error styling for a failed user action
   * @returns nothing; the user sees transient toast state instead
   */
  showToast(message: string, isError?: boolean): void;
  /**
   * Load browser rows for a filesystem path the user wants to inspect.
   *
   * @param path - directory path to open; empty means the browser cannot show meaningful rows
   * @returns promise that settles after browser rows or an error toast are visible
   */
  browseTo(path: string): Promise<void>;
  /**
   * Persist the project list through the legacy method name used by `app.ts`.
   *
   * @returns nothing; saved state changes are reflected on the next dashboard load
   */
  _saveProjectsList(): void;
  /**
   * Persist dashboard path, favorite, and title state after a user changes them.
   *
   * @returns nothing; saved state changes are reflected on the next dashboard load
   */
  _saveDashboardState(): void;
}

/**
 * Remember every path alias that points at the same saved project identity.
 * Use when a server project row tells the UI that moved or renamed paths belong together.
 *
 * @param ctx - dashboard state being updated; missing identity storage means aliases cannot be remembered
 * @param project - project row from the server; missing identity means the UI keeps path-based titles only
 * @returns nothing; aliases are written into dashboard state for later title lookup
 */
function dashboardRememberProjectIdentity(
  ctx: DashboardProjectsContext,
  project: ProjectEntry,
): void {
  // Without a durable identity, the user sees titles tied only to the current path.
  if (!project.identity) return;

  const aliases =
    project.paths && project.paths.length > 0 ? project.paths : [project.path];
  ctx.projectIdentities[project.path] = project.identity;

  // Each known alias should open with the same saved display title.
  for (const alias of aliases) {
    ctx.projectIdentities[alias] = project.identity;
  }
}

/**
 * Remember identity aliases for a list of saved project rows.
 * Use after loading or refreshing projects so titles survive path moves.
 *
 * @param ctx - dashboard state being updated; empty identity storage is filled from project rows
 * @param projects - project rows from storage or audit; empty means there are no aliases to remember
 * @returns nothing; identity lookup state is updated in place
 */
function dashboardRememberProjectIdentities(
  ctx: DashboardProjectsContext,
  projects: ProjectEntry[],
): void {
  // Every saved row can contribute aliases that keep the user's project title stable.
  for (const project of projects) {
    dashboardRememberProjectIdentity(ctx, project);
  }
}

/**
 * Decode one persisted project record into the Projects table shape.
 * Use when the dashboard reloads saved projects from disk.
 *
 * @param storedProject - unknown saved value; non-object values are ignored so the user sees valid rows only
 * @returns project row for the UI, or `null` when the saved record cannot be shown safely
 */
function dashboardReadProjectRecord(
  storedProject: unknown,
): ProjectEntry | null {
  // Invalid saved data is skipped so the Projects view shows valid rows instead of breaking.
  if (!isRecord(storedProject)) return null;

  const path = readString(storedProject.currentPath);
  const identity = readString(storedProject.identity);

  // A row without both path and identity cannot be selected or titled reliably.
  if (!path || !identity) return null;

  const entry: ProjectEntry = {
    path,
    paths: readStringArray(storedProject.paths),
    identity,
    state: "...",
    action: "...",
    details: "Not audited",
  };

  // Known identity sources let the UI explain why a project title follows a moved path.
  if (
    storedProject.identitySource === "git-remote" ||
    storedProject.identitySource === "goat-marker" ||
    storedProject.identitySource === "path"
  ) {
    entry.identitySource = storedProject.identitySource;
  }

  const remoteUrlHash = readString(storedProject.remoteUrlHash);

  // A remote hash keeps the title stable when the same repository is opened from another path.
  if (remoteUrlHash) entry.remoteUrlHash = remoteUrlHash;

  const markerId = readString(storedProject.markerId);

  // A marker id keeps local-only projects recognizable after the folder is moved.
  if (markerId) entry.markerId = markerId;

  return entry;
}

/**
 * Decode the persisted project-record map into Projects table rows.
 * Use when saved dashboard state includes identity-aware project records.
 *
 * @param storedProjects - unknown saved project map; non-object values mean there are no saved rows to show
 * @returns valid project rows, or an empty list when storage has no usable project records
 */
function dashboardReadProjectRecords(storedProjects: unknown): ProjectEntry[] {
  // Missing or invalid project storage leaves the Projects table empty until the user adds a project.
  if (!isRecord(storedProjects)) return [];

  // Only valid project records become visible rows.
  return Object.values(storedProjects)
    .map((project) => dashboardReadProjectRecord(project))
    .filter((project): project is ProjectEntry => project !== null);
}

/**
 * Check whether a saved project list already contains a path or alias.
 * Use before adding launch defaults so the Projects view does not show duplicates.
 *
 * @param projects - saved project rows; empty means the path is not already visible
 * @param path - path being checked; empty cannot match a selectable project row
 * @returns `true` when the path is already represented in the Projects view
 */
function dashboardContainsProjectPath(
  projects: ProjectEntry[],
  path: string,
): boolean {
  return projects.some(
    (project) => project.path === path || project.paths?.includes(path),
  );
}

/**
 * Toggle the project browser at the current workspace path.
 * Use when the user clicks the browse control while choosing or changing a project.
 *
 * @param ctx - dashboard state for the browser; empty current path means the browser opens with no rows
 * @returns promise that settles after the browser has opened or closed
 */
async function dashboardOpenBrowser(
  ctx: DashboardProjectsContext,
): Promise<void> {
  ctx.showBrowser = !ctx.showBrowser;

  // When the browser opens, users expect rows for the workspace they are already viewing.
  if (ctx.showBrowser) await ctx.browseTo(ctx.projectPath);
}

/**
 * Load child directories for the requested project-browser path.
 * Use when a user navigates folders before selecting a project.
 *
 * @param ctx - dashboard state that receives browser rows; empty state means rows replace the current panel
 * @param path - directory requested by the user; empty means the server will return an error toast path
 * @returns promise that settles after rows or an error toast are visible
 */
async function dashboardBrowseTo(
  ctx: DashboardProjectsContext,
  path: string,
): Promise<void> {
  try {
    const res = await dashboardFetch(
      `/api/browse?path=${encodeURIComponent(path)}`,
    );
    const payload = readRecord(await res.json(), "Browse response");
    const error = readErrorMessage(payload);

    // Server validation errors are shown as toasts instead of replacing the browser rows.
    if (error) {
      ctx.showToast(error, true);
      return;
    }

    ctx.browserCurrent = readString(payload.current);
    ctx.browserParent = readString(payload.parent);
    ctx.browserDirs = Array.isArray(payload.dirs)
      ? payload.dirs
          .map((dir) => readBrowseDir(dir))
          .filter((dir): dir is BrowseDir => dir !== null)
      : [];
  } catch {
    // A failed browse keeps the user on the current folder list and explains that loading failed.
    ctx.showToast("Browse failed", true);
  }
}

/**
 * Use a browsed directory as either the active project or the next folder to inspect.
 * Use when the user clicks a row in the project browser.
 *
 * @param ctx - dashboard state being changed; empty project path is replaced when a project row is chosen
 * @param dir - browser row the user clicked; non-project rows continue folder navigation
 * @returns nothing; the Projects browser either closes with an audit or moves deeper into the tree
 */
function dashboardSelectDir(
  ctx: DashboardProjectsContext,
  dir: BrowseDir,
): void {
  // Project rows close the browser and run audit for the newly selected workspace.
  if (dir.isProject) {
    ctx.projectPath = dir.path;
    ctx.showBrowser = false;
    void ctx.runAudit();
  } else {
    // Folder rows keep the browser open so the user can keep drilling down.
    void ctx.browseTo(dir.path);
  }
}

/**
 * Add one project path to the saved Projects list and fetch its first status.
 * Use when the user types a path and clicks Add.
 *
 * @param ctx - dashboard state holding the draft path; empty draft means the user has not chosen a project
 * @returns promise that settles after the row is added, refreshed, and saved
 */
async function dashboardAddProject(
  ctx: DashboardProjectsContext,
): Promise<void> {
  // Nothing was entered, so the Projects view stays open without adding a blank row.
  if (!ctx.newProjectPath) return;

  // Existing projects are not duplicated; the add panel simply closes for the user.
  if (ctx.projectsList.some((project) => project.path === ctx.newProjectPath)) {
    ctx.showAddProject = false;
    ctx.newProjectPath = "";
    return;
  }

  ctx.projectsList.push({
    path: ctx.newProjectPath,
    state: "...",
    action: "...",
    details: "Auditing...",
  });
  ctx.showAddProject = false;
  try {
    const res = await dashboardFetch(
      `/api/projects/status?paths=${encodeURIComponent(ctx.newProjectPath)}`,
    );
    const payload = readRecord(await res.json(), "Project status response");
    const result = Array.isArray(payload.projects)
      ? readProjectEntry(payload.projects[0])
      : null;

    // A successful status response replaces the temporary "Auditing..." row the user saw.
    if (result) {
      const projectIndex = ctx.projectsList.findIndex(
        (project) =>
          project.path === ctx.newProjectPath || project.path === result.path,
      );

      // The row may have moved if the server canonicalized the path.
      if (projectIndex >= 0) ctx.projectsList[projectIndex] = result;
      dashboardRememberProjectIdentity(ctx, result);
    }
  } catch (err) {
    // Surface, don't swallow: the row is already visible as "Auditing...", so silence strands it there.
    console.warn("[goat-flow] Failed to load status for added project:", err);
  }
  ctx.newProjectPath = "";
  ctx._saveProjectsList();
}

/**
 * Remove a project from the saved Projects list.
 * Use when the user confirms removal from the Projects table.
 *
 * @param ctx - dashboard state being updated; empty project list stays empty after removal
 * @param path - project path to remove; empty means no visible row can match
 * @returns nothing; the updated list is saved for the next dashboard load
 */
function dashboardRemoveProject(
  ctx: DashboardProjectsContext,
  path: string,
): void {
  // Only rows with a different path stay visible after the user removes a project.
  ctx.projectsList = ctx.projectsList.filter(
    (project) => project.path !== path,
  );
  ctx._saveProjectsList();
}

/**
 * Toggle or set the Projects table sort column.
 * Use when the user clicks a column heading.
 *
 * @param ctx - dashboard state holding the current sort; empty project rows are unaffected
 * @param key - column key the user clicked; empty is not allowed by the typed table controls
 * @returns nothing; the visible sorted list updates through derived state
 */
function dashboardSortProjects(
  ctx: DashboardProjectsContext,
  key: ProjectSortKey,
): void {
  // Clicking the current column reverses the order the user is already viewing.
  if (ctx.projectsSortKey === key) {
    ctx.projectsSortAsc = !ctx.projectsSortAsc;
  } else {
    // A new column starts ascending so the first click has a predictable order.
    ctx.projectsSortKey = key;
    ctx.projectsSortAsc = true;
  }
}

/**
 * Return Projects table rows in the user's selected sort order.
 * Use whenever the table renders after a sort, audit refresh, add, or remove action.
 *
 * @param ctx - dashboard state with rows and sort choice; empty rows produce an empty table
 * @returns sorted copy of project rows, leaving saved order untouched
 */
function dashboardSortedProjectsList(
  ctx: DashboardProjectsContext,
): ProjectEntry[] {
  const key = ctx.projectsSortKey;
  const dir = ctx.projectsSortAsc ? 1 : -1;

  // Sorting uses a copy so saved project order is not rewritten just by viewing the table.
  return [...ctx.projectsList].sort((firstProject, secondProject) => {
    const firstValue =
      key === "name"
        ? ctx.displayNameFor(firstProject.path)
        : firstProject[key];
    const secondValue =
      key === "name"
        ? ctx.displayNameFor(secondProject.path)
        : secondProject[key];
    return firstValue.localeCompare(secondValue) * dir;
  });
}

/**
 * Refresh audit status for every saved project row.
 * Use when the user clicks Audit All on the Projects screen.
 *
 * @param ctx - dashboard state with project rows; empty rows produce a no-op refresh
 * @returns promise that settles after statuses are refreshed or the existing rows are left intact
 */
async function dashboardAuditAllProjects(
  ctx: DashboardProjectsContext,
): Promise<void> {
  ctx.projectsAuditing = true;
  try {
    // The server receives the visible project paths in the same batch the user asked to audit.
    const paths = ctx.projectsList.map((project) => project.path).join(",");
    const res = await dashboardFetch(
      `/api/projects/status?paths=${encodeURIComponent(paths)}`,
    );
    const payload = readRecord(await res.json(), "Project status response");

    // A valid response replaces every row so the Projects table reflects current audit status.
    if (Array.isArray(payload.projects)) {
      ctx.projectsList = payload.projects
        .map((project) => readProjectEntry(project))
        .filter((project): project is ProjectEntry => project !== null);
      dashboardRememberProjectIdentities(ctx, ctx.projectsList);
    }
  } catch (err) {
    // Surface, don't swallow: stale rows remain visible, so the user needs a retry signal.
    console.warn("[goat-flow] Failed to refresh project statuses:", err);
  }
  ctx.projectsAuditing = false;
}

/**
 * Load saved dashboard state from the server, with localStorage as a migration fallback.
 * Use on dashboard startup so users return to their saved projects, favorites, and titles.
 *
 * @param ctx - dashboard state being hydrated; empty saved state leaves the startup project visible
 * @returns promise that settles after saved state has been applied and re-saved if needed
 */
async function dashboardLoadSavedDashboardState(
  ctx: DashboardProjectsContext,
): Promise<void> {
  let savedPaths: string[] = [];
  let savedFavorites: string[] = [];
  let savedProjectTitles: Record<string, string> = {};
  let savedProjectRecords: ProjectEntry[] = [];
  let loadedFromServer = false;
  try {
    const res = await dashboardFetch("/api/projects/list");
    const payload = readRecord(await res.json(), "Dashboard state response");
    const paths = readStringArray(payload.paths);
    const favorites = readStringArray(payload.favorites);
    const projectRecords = dashboardReadProjectRecords(payload.projects);

    // Server paths restore the Projects table before falling back to browser local storage.
    if (paths.length > 0) {
      savedPaths = paths;
    }

    // Server favorites restore the Prompts shortcuts the user previously chose.
    if (favorites.length > 0) {
      savedFavorites = favorites;
    }
    savedProjectTitles = readStringMap(payload.projectTitles);

    // Identity-aware records are richer than raw paths, so they become the source of visible rows.
    if (projectRecords.length > 0) {
      savedProjectRecords = projectRecords;
      savedPaths = projectRecords.map((project) => project.path);
    }
    loadedFromServer = true;
  } catch {
    // Server storage may be unavailable during migration; localStorage can still restore the UI.
    loadedFromServer = false;
  }
  ctx.projectTitles = savedProjectTitles;
  ctx.projectIdentities = {};
  dashboardRememberProjectIdentities(ctx, savedProjectRecords);
  const localPaths = readStoredStringArray("goat-flow-projects");
  const localFavorites = readStoredStringArray("goat-flow-preset-favorites");

  // Local project paths fill the list when the server has no saved rows yet.
  if (savedPaths.length === 0 && localPaths.length > 0) {
    savedPaths = localPaths;
  }

  // Local favorites fill prompt shortcuts when the server has no saved favorites yet.
  if (savedFavorites.length === 0 && localFavorites.length > 0) {
    savedFavorites = localFavorites;
  }

  // If server storage failed, keep the larger local path list the user already had.
  if (!loadedFromServer && localPaths.length > savedPaths.length) {
    savedPaths = localPaths;
  }

  // If server storage failed, keep the larger local favorites list the user already had.
  if (!loadedFromServer && localFavorites.length > savedFavorites.length) {
    savedFavorites = localFavorites;
  }
  const launchPath = window.__GOAT_FLOW_DEFAULT_PATH__;

  // The launch project appears first so the dashboard opens on the workspace the user selected.
  if (
    launchPath &&
    !savedPaths.includes(launchPath) &&
    !dashboardContainsProjectPath(savedProjectRecords, launchPath)
  ) {
    savedPaths.unshift(launchPath);
    savedProjectRecords.unshift({
      path: launchPath,
      state: "...",
      action: "...",
      details: "Not audited",
    });
  }
  ctx.presetFavorites = [...new Set(savedFavorites)];

  // Identity-aware rows preserve saved display names and path aliases in the Projects table.
  if (savedProjectRecords.length > 0) {
    ctx.projectsList = savedProjectRecords;
  } else if (savedPaths.length > 0) {
    // Raw saved paths still give the user selectable rows until audit status is refreshed.
    ctx.projectsList = savedPaths.map((path) => ({
      path,
      state: "...",
      action: "...",
      details: "Not audited",
    }));
  }
  dashboardRememberProjectIdentities(ctx, ctx.projectsList);

  // Any restored rows or favorites are persisted back through the current server-backed format.
  if (savedPaths.length > 0 || ctx.presetFavorites.length > 0) {
    ctx._saveDashboardState();
  }
}

/**
 * Persist the current dashboard state to localStorage and the server store.
 * Use after users change saved projects, prompt favorites, or project titles.
 * Swallows server persistence failures after logging because localStorage already preserves the UI.
 *
 * @param ctx - dashboard state to save; empty lists mean the next launch has no saved projects or favorites
 * @returns nothing; server failures are logged while local state remains available
 */
function dashboardSaveDashboardState(ctx: DashboardProjectsContext): void {
  // Path aliases are saved so moved projects still resolve to the same visible title later.
  const paths = [
    ...new Set(
      ctx.projectsList.flatMap((project) =>
        project.paths && project.paths.length > 0
          ? project.paths
          : [project.path],
      ),
    ),
  ];
  const favorites = [...new Set(ctx.presetFavorites)];
  const projectTitles = { ...ctx.projectTitles };
  localStorage.setItem("goat-flow-projects", JSON.stringify(paths));
  localStorage.setItem("goat-flow-preset-favorites", JSON.stringify(favorites));
  dashboardFetch("/api/projects/list", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths, favorites, projectTitles }),
  }).catch((err: unknown) => {
    // Local storage already updated, so the user keeps state even if server persistence fails.
    console.warn("[goat-flow] Failed to persist dashboard state:", err);
  });
}

/**
 * Begin inline editing for the current project's display title.
 * Use when the user clicks the project title in the dashboard header.
 *
 * @param ctx - dashboard state for the active project; empty project path shows a path-derived draft
 * @returns nothing; title draft controls become visible in the UI
 */
function dashboardStartEditProjectTitle(ctx: DashboardProjectsContext): void {
  ctx.projectTitleDraft = ctx.displayNameFor(ctx.projectPath);
  ctx.editingProjectTitle = true;
}

/**
 * Save or clear the inline-edited title for the current project.
 * Use when the user confirms the title edit in the dashboard header.
 *
 * @param ctx - dashboard state holding the title draft; empty draft clears the saved custom title
 * @returns nothing; the header title and saved dashboard state are updated
 */
function dashboardSaveProjectTitle(ctx: DashboardProjectsContext): void {
  // If editing is no longer active, there is no visible title draft to save.
  if (!ctx.editingProjectTitle) return;

  ctx.editingProjectTitle = false;
  const trimmed = ctx.projectTitleDraft.trim().slice(0, 120);
  const next = { ...ctx.projectTitles };
  const titleKey = ctx.projectKeyFor(ctx.projectPath);

  // Empty or default titles remove the alias so the UI returns to the path-derived name.
  if (
    trimmed.length === 0 ||
    trimmed === getProjectDisplayName(ctx.projectPath)
  ) {
    Reflect.deleteProperty(next, titleKey);
    Reflect.deleteProperty(next, ctx.projectPath);
  } else {
    next[titleKey] = trimmed;

    // When an identity key exists, stale path-specific titles should not override it later.
    if (titleKey !== ctx.projectPath) {
      Reflect.deleteProperty(next, ctx.projectPath);
    }
  }
  ctx.projectTitles = next;
  ctx.projectTitleDraft = "";
  ctx._saveDashboardState();
  document.title = `${ctx.displayNameFor(ctx.projectPath)} | GOAT Flow`;
}

/**
 * Discard the inline title edit and hide the draft controls.
 * Use when the user cancels editing the current project title.
 *
 * @param ctx - dashboard state holding the draft; empty draft means there is nothing visible to discard
 * @returns nothing; the saved project title is left unchanged
 */
function dashboardCancelEditProjectTitle(ctx: DashboardProjectsContext): void {
  ctx.editingProjectTitle = false;
  ctx.projectTitleDraft = "";
}
