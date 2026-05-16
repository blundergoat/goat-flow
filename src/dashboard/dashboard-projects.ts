/**
 * Project-list, project-browser, and dashboard-state helpers.
 * Loaded as a classic script and called by thin Alpine methods in app.ts.
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
  displayNameFor(path: string): string;
  projectKeyFor(path: string): string;
  runAudit(fresh?: boolean): Promise<void>;
  showToast(msg: string, isError?: boolean): void;
  browseTo(path: string): Promise<void>;
  _saveProjectsList(): void;
  _saveDashboardState(): void;
}

function dashboardRememberProjectIdentity(
  ctx: DashboardProjectsContext,
  project: ProjectEntry,
): void {
  if (!project.identity) return;
  const aliases =
    project.paths && project.paths.length > 0 ? project.paths : [project.path];
  ctx.projectIdentities[project.path] = project.identity;
  for (const alias of aliases) {
    ctx.projectIdentities[alias] = project.identity;
  }
}

function dashboardRememberProjectIdentities(
  ctx: DashboardProjectsContext,
  projects: ProjectEntry[],
): void {
  for (const project of projects) {
    dashboardRememberProjectIdentity(ctx, project);
  }
}

function dashboardReadProjectRecord(value: unknown): ProjectEntry | null {
  if (!isRecord(value)) return null;
  const path = readString(value.currentPath);
  const identity = readString(value.identity);
  if (!path || !identity) return null;
  const entry: ProjectEntry = {
    path,
    paths: readStringArray(value.paths),
    identity,
    state: "...",
    action: "...",
    details: "Not audited",
  };
  if (
    value.identitySource === "git-remote" ||
    value.identitySource === "goat-marker" ||
    value.identitySource === "path"
  ) {
    entry.identitySource = value.identitySource;
  }
  const remoteUrlHash = readString(value.remoteUrlHash);
  if (remoteUrlHash) entry.remoteUrlHash = remoteUrlHash;
  const markerId = readString(value.markerId);
  if (markerId) entry.markerId = markerId;
  return entry;
}

function dashboardReadProjectRecords(value: unknown): ProjectEntry[] {
  if (!isRecord(value)) return [];
  return Object.values(value)
    .map((project) => dashboardReadProjectRecord(project))
    .filter((project): project is ProjectEntry => project !== null);
}

function dashboardContainsProjectPath(
  projects: ProjectEntry[],
  path: string,
): boolean {
  return projects.some(
    (project) => project.path === path || project.paths?.includes(path),
  );
}

/** Open the project browser at the current workspace path. */
async function dashboardOpenBrowser(
  ctx: DashboardProjectsContext,
): Promise<void> {
  ctx.showBrowser = !ctx.showBrowser;
  if (ctx.showBrowser) await ctx.browseTo(ctx.projectPath);
}

/** Load child directories for the requested browser path. */
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
    ctx.showToast("Browse failed", true);
  }
}

/** Set a browsed directory as the active project. */
function dashboardSelectDir(
  ctx: DashboardProjectsContext,
  dir: BrowseDir,
): void {
  if (dir.isProject) {
    ctx.projectPath = dir.path;
    ctx.showBrowser = false;
    void ctx.runAudit();
  } else {
    void ctx.browseTo(dir.path);
  }
}

/** Add one project to the saved workspace list and fetch its status. */
async function dashboardAddProject(
  ctx: DashboardProjectsContext,
): Promise<void> {
  if (!ctx.newProjectPath) return;
  if (ctx.projectsList.some((p) => p.path === ctx.newProjectPath)) {
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
    if (result) {
      const idx = ctx.projectsList.findIndex(
        (p) => p.path === ctx.newProjectPath || p.path === result.path,
      );
      if (idx >= 0) ctx.projectsList[idx] = result;
      dashboardRememberProjectIdentity(ctx, result);
    }
  } catch {
    /* silent */
  }
  ctx.newProjectPath = "";
  ctx._saveProjectsList();
}

/** Remove a project from the saved workspace list. */
function dashboardRemoveProject(
  ctx: DashboardProjectsContext,
  path: string,
): void {
  ctx.projectsList = ctx.projectsList.filter((p) => p.path !== path);
  ctx._saveProjectsList();
}

/** Sort saved projects by the active key and direction. */
function dashboardSortProjects(
  ctx: DashboardProjectsContext,
  key: ProjectSortKey,
): void {
  if (ctx.projectsSortKey === key) {
    ctx.projectsSortAsc = !ctx.projectsSortAsc;
  } else {
    ctx.projectsSortKey = key;
    ctx.projectsSortAsc = true;
  }
}

/** Sort projects by visible columns while keeping the derived "name" column first-class. */
function dashboardSortedProjectsList(
  ctx: DashboardProjectsContext,
): ProjectEntry[] {
  const key = ctx.projectsSortKey;
  const dir = ctx.projectsSortAsc ? 1 : -1;
  return [...ctx.projectsList].sort((a, b) => {
    const av = key === "name" ? ctx.displayNameFor(a.path) : a[key];
    const bv = key === "name" ? ctx.displayNameFor(b.path) : b[key];
    return av.localeCompare(bv) * dir;
  });
}

/** Refresh audit status for every saved project. */
async function dashboardAuditAllProjects(
  ctx: DashboardProjectsContext,
): Promise<void> {
  ctx.projectsAuditing = true;
  try {
    const paths = ctx.projectsList.map((p) => p.path).join(",");
    const res = await dashboardFetch(
      `/api/projects/status?paths=${encodeURIComponent(paths)}`,
    );
    const payload = readRecord(await res.json(), "Project status response");
    if (Array.isArray(payload.projects)) {
      ctx.projectsList = payload.projects
        .map((project) => readProjectEntry(project))
        .filter((project): project is ProjectEntry => project !== null);
      dashboardRememberProjectIdentities(ctx, ctx.projectsList);
    }
  } catch {
    /* silent */
  }
  ctx.projectsAuditing = false;
}

/** Load saved dashboard state from disk, with localStorage as a migration fallback. */
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
    if (paths.length > 0) {
      savedPaths = paths;
    }
    if (favorites.length > 0) {
      savedFavorites = favorites;
    }
    savedProjectTitles = readStringMap(payload.projectTitles);
    if (projectRecords.length > 0) {
      savedProjectRecords = projectRecords;
      savedPaths = projectRecords.map((project) => project.path);
    }
    loadedFromServer = true;
  } catch {
    /* server unavailable */
  }
  ctx.projectTitles = savedProjectTitles;
  ctx.projectIdentities = {};
  dashboardRememberProjectIdentities(ctx, savedProjectRecords);
  const localPaths = readStoredStringArray("goat-flow-projects");
  const localFavorites = readStoredStringArray("goat-flow-preset-favorites");
  if (savedPaths.length === 0 && localPaths.length > 0) {
    savedPaths = localPaths;
  }
  if (savedFavorites.length === 0 && localFavorites.length > 0) {
    savedFavorites = localFavorites;
  }
  if (!loadedFromServer && localPaths.length > savedPaths.length) {
    savedPaths = localPaths;
  }
  if (!loadedFromServer && localFavorites.length > savedFavorites.length) {
    savedFavorites = localFavorites;
  }
  const launchPath = window.__GOAT_FLOW_DEFAULT_PATH__;
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
  if (savedProjectRecords.length > 0) {
    ctx.projectsList = savedProjectRecords;
  } else if (savedPaths.length > 0) {
    ctx.projectsList = savedPaths.map((path) => ({
      path,
      state: "...",
      action: "...",
      details: "Not audited",
    }));
  }
  dashboardRememberProjectIdentities(ctx, ctx.projectsList);
  if (savedPaths.length > 0 || ctx.presetFavorites.length > 0) {
    ctx._saveDashboardState();
  }
}

/** Persist the current dashboard state to localStorage and the server store. */
function dashboardSaveDashboardState(ctx: DashboardProjectsContext): void {
  const paths = [
    ...new Set(
      ctx.projectsList.flatMap((p) =>
        p.paths && p.paths.length > 0 ? p.paths : [p.path],
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
    console.warn("[goat-flow] Failed to persist dashboard state:", err);
  });
}

/** Begin editing the current project's title. */
function dashboardStartEditProjectTitle(ctx: DashboardProjectsContext): void {
  ctx.projectTitleDraft = ctx.displayNameFor(ctx.projectPath);
  ctx.editingProjectTitle = true;
}

/** Commit the inline-edited title for the current project path. */
function dashboardSaveProjectTitle(ctx: DashboardProjectsContext): void {
  if (!ctx.editingProjectTitle) return;
  ctx.editingProjectTitle = false;
  const trimmed = ctx.projectTitleDraft.trim().slice(0, 120);
  const next = { ...ctx.projectTitles };
  const titleKey = ctx.projectKeyFor(ctx.projectPath);
  if (
    trimmed.length === 0 ||
    trimmed === getProjectDisplayName(ctx.projectPath)
  ) {
    Reflect.deleteProperty(next, titleKey);
    Reflect.deleteProperty(next, ctx.projectPath);
  } else {
    next[titleKey] = trimmed;
    if (titleKey !== ctx.projectPath) {
      Reflect.deleteProperty(next, ctx.projectPath);
    }
  }
  ctx.projectTitles = next;
  ctx.projectTitleDraft = "";
  ctx._saveDashboardState();
  document.title = `${ctx.displayNameFor(ctx.projectPath)} | GOAT Flow`;
}

/** Discard the inline-edited title. */
function dashboardCancelEditProjectTitle(ctx: DashboardProjectsContext): void {
  ctx.editingProjectTitle = false;
  ctx.projectTitleDraft = "";
}
