/**
 * Powers the Projects screen: the folder browser, the saved project table, display titles, and the state that survives a reload.
 *
 * This is where a user starts a session, adding a workspace, switching between them, renaming one, or refreshing their status.
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
  projectsRefreshing: boolean;
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

  const archivedAt = readString(storedProject.archivedAt);

  // Archived records stay recoverable but are rendered outside the active table.
  if (archivedAt) entry.archivedAt = archivedAt;

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
    const existingProject = ctx.projectsList.find(
      (project) =>
        project.path === dir.path || project.paths?.includes(dir.path),
    );

    // Choosing a discovered row is an explicit registration, so it may now be persisted.
    if (existingProject) {
      Reflect.deleteProperty(existingProject, "discovered");
      if (existingProject.archivedAt) {
        void dashboardSetProjectArchived(ctx, dir.path, false).then(() =>
          ctx.runAudit(),
        );
      } else {
        ctx._saveProjectsList();
        void ctx.runAudit();
      }
    } else {
      ctx.newProjectPath = dir.path;
      void dashboardAddProject(ctx).then(() => ctx.runAudit());
    }
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

  const existingProject = ctx.projectsList.find(
    (project) =>
      project.path === ctx.newProjectPath ||
      project.paths?.includes(ctx.newProjectPath),
  );

  // Adding an existing discovered or archived row explicitly registers or restores it.
  if (existingProject) {
    const projectPath = ctx.newProjectPath;
    ctx.showAddProject = false;
    ctx.newProjectPath = "";
    if (existingProject.archivedAt) {
      await dashboardSetProjectArchived(ctx, projectPath, false);
    } else if (existingProject.discovered) {
      Reflect.deleteProperty(existingProject, "discovered");
      ctx._saveProjectsList();
    }
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
 * Archive or restore a project through the server-owned dashboard state.
 * Use when the user wants to hide an active row or return a retained archived record.
 *
 * @param ctx - dashboard state being refreshed after the server action
 * @param path - project path selected by the user
 * @param isArchived - `true` archives the record; `false` restores it
 * @returns promise that settles after state and visible status rows are refreshed; it reports a failed server action as a toast
 */
async function dashboardSetProjectArchived(
  ctx: DashboardProjectsContext,
  path: string,
  isArchived: boolean,
): Promise<void> {
  const action = isArchived ? "archive" : "restore";
  try {
    const res = await dashboardFetch(`/api/projects/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    const payload = readRecord(await res.json(), "Project archive response");
    const error = readErrorMessage(payload);
    if (!res.ok || error) {
      throw new Error(error || `Server returned ${res.status}`);
    }
    await dashboardLoadSavedDashboardState(ctx);
    await dashboardRefreshProjectStatuses(ctx);
    ctx.showToast(isArchived ? "Project archived" : "Project restored");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.showToast(message || `Project ${action} failed`, true);
  }
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
 * Refreshes lightweight adoption status for every active project row when the user clicks Refresh Status.
 *
 * Error behavior: never throws; a failure reports to the console and leaves the existing rows visible, so the table never blanks out mid-refresh.
 *
 * @param ctx - dashboard state with active and archived rows; empty active rows produce a no-op
 * @returns promise that settles after statuses are refreshed or existing rows are left intact
 */
async function dashboardRefreshProjectStatuses(
  ctx: DashboardProjectsContext,
): Promise<void> {
  const activeProjects = ctx.projectsList.filter(
    (project) => !project.archivedAt,
  );
  if (activeProjects.length === 0) return;

  ctx.projectsRefreshing = true;
  try {
    // The server receives active paths only; archived rows remain retained and untouched.
    const paths = activeProjects.map((project) => project.path).join(",");
    const res = await dashboardFetch(
      `/api/projects/status?paths=${encodeURIComponent(paths)}`,
    );
    const payload = readRecord(await res.json(), "Project status response");

    // A valid response refreshes active rows while retaining archive and discovery metadata.
    if (Array.isArray(payload.projects)) {
      const refreshedProjects = payload.projects
        .map((project) => readProjectEntry(project))
        .filter((project): project is ProjectEntry => project !== null)
        .map((project) => {
          const previous = activeProjects.find(
            (candidate) =>
              candidate.path === project.path ||
              candidate.paths?.includes(project.path),
          );
          return previous?.discovered
            ? { ...project, discovered: true }
            : project;
        });
      ctx.projectsList = [
        ...refreshedProjects,
        ...ctx.projectsList.filter((project) => Boolean(project.archivedAt)),
      ];
      dashboardRememberProjectIdentities(ctx, ctx.projectsList);
    }
  } catch (err) {
    // For example, the user clicked Refresh Status with a saved project whose folder has since been deleted or moved off the machine.
    // Surface, don't swallow: stale rows stay visible, so the user needs a retry signal rather than silence.
    console.warn("[goat-flow] Failed to refresh project statuses:", err);
  }
  ctx.projectsRefreshing = false;
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
 * Reads whatever saved dashboard state the server holds, so startup has a single place that talks to the projects store.
 *
 * Error behavior: never throws. An unreachable or pre-projects-store server reports `wasLoadedFromServer` false
 * with empty lists, which is the caller's signal to fall back to browser storage.
 *
 * @returns saved paths, favorites, titles, identity-aware records, and discovered siblings; a false
 *   `wasLoadedFromServer` means every list is empty because the request or its parse failed
 */
async function dashboardReadSavedServerState(): Promise<{
  savedPaths: string[];
  savedFavorites: string[];
  savedProjectTitles: Record<string, string>;
  savedProjectRecords: ProjectEntry[];
  discoveredPaths: string[];
  wasLoadedFromServer: boolean;
}> {
  try {
    const res = await dashboardFetch("/api/projects/list");
    const payload = readRecord(await res.json(), "Dashboard state response");
    const paths = readStringArray(payload.paths);
    const projectRecords = dashboardReadProjectRecords(payload.projects);

    // Identity-aware records include retained archives, so only the unarchived subset seeds active rows.
    const activeRecordPaths = projectRecords
      .filter((project) => !project.archivedAt)
      .map((project) => project.path);
    return {
      // Server paths restore the Projects table before falling back to browser local storage.
      savedPaths: paths.length > 0 ? paths : activeRecordPaths,
      // Server favorites restore the Prompts shortcuts the user previously chose.
      savedFavorites: readStringArray(payload.favorites),
      savedProjectTitles: readStringMap(payload.projectTitles),
      savedProjectRecords: projectRecords,
      discoveredPaths: readStringArray(payload.discoveredPaths),
      wasLoadedFromServer: true,
    };
  } catch {
    // For example, the user is on a build whose server predates the projects store, so nothing answers and localStorage restores the screen instead.
    return {
      savedPaths: [],
      savedFavorites: [],
      savedProjectTitles: {},
      savedProjectRecords: [],
      discoveredPaths: [],
      wasLoadedFromServer: false,
    };
  }
}

/**
 * Builds the rows the Projects table shows, combining the user's saved state with the siblings the server discovered.
 *
 * Invariant: discovered rows are appended as unregistered entries only, so browsing them never turns into a saved registration.
 *
 * @param savedProjectRecords - identity-aware saved rows including archives; empty falls back to raw saved paths
 * @param savedPaths - raw saved paths used when no identity-aware records exist; empty leaves discovery as the only source of rows
 * @param discoveredPaths - sibling folders the server found; paths already listed are skipped
 * @returns the rows to display, saved rows first and discovered siblings appended
 */
function dashboardBuildProjectRows(
  savedProjectRecords: ProjectEntry[],
  savedPaths: string[],
  discoveredPaths: string[],
): ProjectEntry[] {
  // Identity-aware rows preserve saved display names, archives, and path aliases.
  // Raw saved paths still give the user selectable rows until audit status is refreshed.
  const projectRows: ProjectEntry[] =
    savedProjectRecords.length > 0
      ? savedProjectRecords
      : savedPaths.map((path) => ({
          path,
          state: "...",
          action: "...",
          details: "Not audited",
        }));

  // Discovered siblings are visible without becoming persisted registrations or writing markers.
  for (const path of discoveredPaths) {
    if (dashboardContainsProjectPath(projectRows, path)) continue;
    projectRows.push({
      path,
      discovered: true,
      state: "...",
      action: "...",
      details: "Not refreshed",
    });
  }
  return projectRows;
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
  const serverState = await dashboardReadSavedServerState();
  const {
    savedProjectTitles,
    savedProjectRecords,
    discoveredPaths,
    wasLoadedFromServer,
  } = serverState;
  let savedPaths = serverState.savedPaths;
  let savedFavorites = serverState.savedFavorites;
  let requiresServerMigration = false;
  ctx.projectTitles = savedProjectTitles;
  ctx.projectIdentities = {};
  dashboardRememberProjectIdentities(ctx, savedProjectRecords);
  const localPaths = readStoredStringArray("goat-flow-projects");
  const localFavorites = readStoredStringArray("goat-flow-preset-favorites");

  const serverHadProjects =
    savedPaths.length > 0 || savedProjectRecords.length > 0;
  const serverHadFavorites = savedFavorites.length > 0;
  const serverHasOnlyArchivedProjects =
    savedPaths.length === 0 && savedProjectRecords.length > 0;

  // An all-archived server response is still saved state, so browser storage must not resurrect those rows as active.
  if (!serverHasOnlyArchivedProjects) {
    savedPaths = dashboardPreferredSavedList(
      savedPaths,
      localPaths,
      wasLoadedFromServer,
    );
  }
  savedFavorites = dashboardPreferredSavedList(
    savedFavorites,
    localFavorites,
    wasLoadedFromServer,
  );

  // Browser storage that filled empty server state predates the projects store, so it is written back once.
  if (
    (!serverHadProjects && savedPaths.length > 0) ||
    (!serverHadFavorites && savedFavorites.length > 0)
  ) {
    requiresServerMigration = wasLoadedFromServer;
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
    requiresServerMigration = wasLoadedFromServer;
  }
  ctx.presetFavorites = [...new Set(savedFavorites)];

  ctx.projectsList = dashboardBuildProjectRows(
    savedProjectRecords,
    savedPaths,
    discoveredPaths,
  );
  dashboardRememberProjectIdentities(ctx, ctx.projectsList);

  // Only legacy/local fallback or the launch-path seed is written back; discovery stays read-only.
  if (requiresServerMigration) {
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
  const savedActiveProjects = ctx.projectsList.filter(
    (project) => !project.archivedAt && !project.discovered,
  );

  // Only explicitly registered active aliases are saved; discovery and archives remain server-owned.
  const paths = [
    ...new Set(
      savedActiveProjects.flatMap((project) =>
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
