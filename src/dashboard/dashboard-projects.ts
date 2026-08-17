/**
 * Powers the Projects screen: the folder browser, the saved project table, display titles, and the state that survives a reload.
 *
 * This is where a user starts a session, adding a workspace, switching between them, renaming one, or re-running Audit All.
 *
 * The helpers keep Alpine methods thin while protecting what the user can see, so:
 * - saved order is never rewritten just by sorting or viewing the table
 * - a project keeps its identity across path changes, so a renamed folder does not lose its title
 * - server state wins, with browser localStorage kept only as a migration fallback
 */

/**
 * The Projects screen state shared by the list, browser, title-editing, and persistence helpers.
 *
 * Every field here is something the user can see or has chosen, so an empty string means "not currently selected or visible".
 *
 * Invariant: these method names must match the Alpine fragments that call them, or the template silently binds to nothing.
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
 * Loads the folder rows the user sees while drilling down to pick a project.
 *
 * Error behavior: never throws; a rejected path reports as a toast and leaves the user on the folder they were already viewing.
 *
 * @param ctx - dashboard state that receives the browser rows
 * @param path - directory the user clicked; an empty path comes back as a server error toast rather than a blank panel
 * @returns promise that settles once either new rows or an error toast are on screen
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
    // For example, the user clicked into a folder they lack permission to read, or an external drive was unplugged mid-browse.
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
 * Adds the path the user typed to the saved Projects table and fetches its first audit status.
 *
 * The row appears immediately showing "Auditing...", so the user gets feedback before the server has answered.
 *
 * Error behavior: never throws; a failed status leaves the placeholder row in place rather than removing the project the user just added.
 *
 * @param ctx - dashboard state holding the draft path; an empty draft means the user clicked Add without choosing anything, so nothing happens
 * @returns promise that settles once the row is added, refreshed, and persisted
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
 * Returns the Projects rows in whichever order the user last clicked a column header.
 *
 * Invariant: this sorts a copy, so simply viewing or re-sorting the table never rewrites the saved project order.
 *
 * @param ctx - dashboard state with the rows and the user's sort choice; no rows means the table renders empty
 * @returns a sorted copy of the rows, leaving the persisted order untouched
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
 * Re-runs the audit for every saved project when the user clicks Audit All.
 *
 * Error behavior: never throws; a failure reports to the console and leaves the existing rows visible, so the table never blanks out mid-refresh.
 *
 * @param ctx - dashboard state holding the project rows; an empty table makes this a no-op
 * @returns promise that settles once statuses are refreshed or the previous rows are confirmed intact
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
    // For example, the user clicked Audit All with a saved project whose folder has since been deleted or moved off the machine.
    // Surface, don't swallow: stale rows stay visible, so the user needs a retry signal rather than silence.
    console.warn("[goat-flow] Failed to refresh project statuses:", err);
  }
  ctx.projectsAuditing = false;
}

/**
 * Picks whichever saved list the user would rather keep when server state and browser storage disagree.
 *
 * Server state normally wins, but a failed load must never silently shrink the projects or favorites the user already had on this machine.
 *
 * @param serverList - list restored from the server; empty means the server had nothing saved for this user yet
 * @param localList - list restored from browser storage, kept only as a migration fallback for older builds
 * @param wasLoadedFromServer - false when the server request failed, which promotes the larger local list instead
 * @returns the list to show; never shorter than what the user already had locally
 */
function dashboardPreferredSavedList(
  serverList: string[],
  localList: string[],
  wasLoadedFromServer: boolean,
): string[] {
  // The server had nothing saved, so browser storage is the only place the user's earlier choices still exist.
  if (serverList.length === 0) return localList;

  // The server request failed, so a longer local list is more likely to be what the user actually had.
  if (!wasLoadedFromServer && localList.length > serverList.length) {
    return localList;
  }
  return serverList;
}

/**
 * Restores the user's projects, favorites, and titles on dashboard startup so they reopen where they left off.
 *
 * Server state is authoritative; browser localStorage is read only as a migration fallback for users upgrading from an older build.
 *
 * The comparisons below deliberately keep the larger of the two lists, because:
 * - a half-written server response must never silently shrink the user's saved project list
 * - a user who added projects before the server store existed keeps them on first load
 * - Error behavior: never throws; an unreachable endpoint falls back to localStorage instead of opening an empty dashboard
 *
 * @param ctx - dashboard state being hydrated; no saved state leaves just the launch project visible
 * @returns promise that settles once saved state has been applied, and re-saved when a migration happened
 */
async function dashboardLoadSavedDashboardState(
  ctx: DashboardProjectsContext,
): Promise<void> {
  let savedPaths: string[] = [];
  let savedFavorites: string[] = [];
  let savedProjectTitles: Record<string, string> = {};
  let savedProjectRecords: ProjectEntry[] = [];
  let wasLoadedFromServer = false;
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
    wasLoadedFromServer = true;
  } catch {
    // For example, the user is on a build whose server predates the projects store, so nothing answers and localStorage restores the screen instead.
    wasLoadedFromServer = false;
  }
  ctx.projectTitles = savedProjectTitles;
  ctx.projectIdentities = {};
  dashboardRememberProjectIdentities(ctx, savedProjectRecords);
  const localPaths = readStoredStringArray("goat-flow-projects");
  const localFavorites = readStoredStringArray("goat-flow-preset-favorites");

  savedPaths = dashboardPreferredSavedList(
    savedPaths,
    localPaths,
    wasLoadedFromServer,
  );
  savedFavorites = dashboardPreferredSavedList(
    savedFavorites,
    localFavorites,
    wasLoadedFromServer,
  );
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
