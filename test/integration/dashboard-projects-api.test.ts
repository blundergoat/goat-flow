/**
 * Dashboard /api/projects state endpoint: classifies a project's state, persists titles/favorites
 * and identities (deduping by git remote, using a local marker for non-git projects across renames)
 * without leaking raw private remote URLs or creating markers during passive browse, migrates the
 * legacy projects file, blocks shared temp roots, and returns 400/405 for bad input or methods.
 */
import { discoverSiblingProjectPaths } from "../../src/cli/server/dashboard-project-routes.js";
import {
  assert,
  childProcess,
  DASHBOARD_STATE_PATH,
  describe,
  expectRecord,
  fetchJson,
  it,
  join,
  LEGACY_PROJECTS_LIST_PATH,
  mkdir,
  mkdtemp,
  originalExecFileSync,
  PROJECT_PATH,
  readFile,
  readdir,
  rename,
  resolve,
  rm,
  runGit,
  syncBuiltinESMExports,
  tmpdir,
  writeFile,
  writeProjectFile,
} from "./dashboard-server.helpers.js";

/** Return only the persisted part of a /api/projects/list body, dropping the filesystem-derived discoveredPaths. */
function persistedProjectsState(body: unknown): Record<string, unknown> {
  const payload = expectRecord(body, "projects list state");
  return {
    paths: payload.paths,
    favorites: payload.favorites,
    projectTitles: payload.projectTitles,
    projects: payload.projects,
  };
}

/** Return the persisted project records whose alias list contains the given path. */
function projectRecordsWithPath(
  body: unknown,
  path: string,
): Record<string, unknown>[] {
  const payload = expectRecord(body, "projects list state");
  return Object.values(expectRecord(payload.projects, "projects map"))
    .map((project) => expectRecord(project, "project record"))
    .filter(
      (project) =>
        Array.isArray(project.paths) &&
        (project.paths as unknown[]).includes(path),
    );
}
describe("dashboard /api/projects", () => {
  it("discovers immediate non-hidden sibling directories", async () => {
    const parent = await mkdtemp(
      join(tmpdir(), "goat-flow-project-discovery-"),
    );
    const launchProject = join(parent, "launch-project");
    const siblingProject = join(parent, "sibling-project");
    try {
      await mkdir(launchProject);
      await mkdir(siblingProject);
      await mkdir(join(parent, ".hidden-project"));

      assert.deepEqual(discoverSiblingProjectPaths(launchProject), [
        launchProject,
        siblingProject,
      ]);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("classifies project state for a valid path", async () => {
    const { res, body } = await fetchJson(
      `/api/projects/status?paths=${encodeURIComponent(PROJECT_PATH)}`,
    );
    assert.equal(res.status, 200);

    const payload = expectRecord(body, "Projects status response");
    assert.ok(Array.isArray(payload.projects));
    assert.equal((payload.projects as unknown[]).length, 1);
    const project = expectRecord(
      (payload.projects as unknown[])[0],
      "Projects status item",
    );
    assert.equal(project.path, PROJECT_PATH);
    assert.equal(typeof project.identity, "string");
    assert.match(
      String(project.identitySource),
      /^(git-remote|goat-marker|path)$/,
    );
    assert.equal(typeof project.state, "string");
    assert.equal(typeof project.action, "string");
    assert.equal(typeof project.details, "string");
  });

  it("clears a project title when an empty string is posted", async () => {
    const post = await fetchJson("/api/projects/list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paths: [PROJECT_PATH],
        favorites: [],
        projectTitles: { [PROJECT_PATH]: "" },
      }),
    });
    assert.equal(post.res.status, 200);

    const get = await fetchJson("/api/projects/list");
    const body = expectRecord(get.body, "dashboard state");
    assert.deepEqual(body.projectTitles, {});
    assert.ok(
      Object.keys(expectRecord(body.projects, "dashboard projects")).length >=
        1,
    );
  });

  it("does not create project identity markers during passive browse", async () => {
    const root = await mkdtemp(join(tmpdir(), "goat-flow-browse-project-"));
    try {
      await writeProjectFile(
        root,
        ".goat-flow/config.yaml",
        "version: 1.7.0\n",
      );
      const { res } = await fetchJson(
        `/api/browse?path=${encodeURIComponent(root)}`,
      );
      assert.equal(res.status, 200);
      await assert.rejects(
        readFile(join(root, ".goat-flow", "project-id"), "utf-8"),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not create project identity markers during passive status refresh", async () => {
    const root = await mkdtemp(join(tmpdir(), "goat-flow-status-project-"));
    try {
      await writeProjectFile(
        root,
        ".goat-flow/config.yaml",
        "version: 1.7.0\n",
      );
      const { res } = await fetchJson(
        `/api/projects/status?paths=${encodeURIComponent(root)}`,
      );
      assert.equal(res.status, 200);
      await assert.rejects(
        readFile(join(root, ".goat-flow", "project-id"), "utf-8"),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("migrates the legacy projects file with empty favorites and titles", async () => {
    await rm(DASHBOARD_STATE_PATH, { force: true });
    const nextPaths = [PROJECT_PATH, resolve(PROJECT_PATH, "docs")];
    await writeFile(
      LEGACY_PROJECTS_LIST_PATH,
      JSON.stringify({ paths: nextPaths }, null, 2),
    );

    const get = await fetchJson("/api/projects/list");
    assert.equal(get.res.status, 200);
    const body = expectRecord(get.body, "dashboard state");
    assert.deepEqual(body.paths, nextPaths);
    assert.deepEqual(body.favorites, []);
    assert.deepEqual(body.projectTitles, {});
    const projects = expectRecord(body.projects, "dashboard projects");
    assert.ok(Object.keys(projects).length >= 1);
  });

  it("persists project identities without raw private remote URLs", async () => {
    const root = await mkdtemp(join(tmpdir(), "goat-flow-private-remote-"));
    const alias = await mkdtemp(join(tmpdir(), "goat-flow-private-alias-"));
    const remoteUrl = "ssh://git@example.internal/private/repo.git";
    try {
      runGit(root, ["init"]);
      runGit(root, ["remote", "add", "origin", remoteUrl]);
      runGit(alias, ["init"]);
      runGit(alias, ["remote", "add", "origin", remoteUrl]);
      const post = await fetchJson("/api/projects/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paths: [root, alias],
          favorites: [],
          projectTitles: { [root]: "Private Project" },
        }),
      });
      assert.equal(post.res.status, 200);
      const persisted = await readFile(DASHBOARD_STATE_PATH, "utf-8");
      assert.equal(persisted.includes(remoteUrl), false);
      assert.match(persisted, /"remoteUrlHash":/);
      assert.match(persisted, /"title": "Private Project"/);
      const parsed = expectRecord(
        JSON.parse(persisted),
        "Persisted dashboard state",
      );
      const projects = expectRecord(parsed.projects, "Persisted projects");
      const matchingProjects = Object.values(projects)
        .map((value) => expectRecord(value, "Persisted project"))
        .filter(
          (project) =>
            Array.isArray(project.paths) &&
            (project.paths.includes(root) || project.paths.includes(alias)),
        );
      assert.equal(matchingProjects.length, 1);
      const [project] = matchingProjects;
      assert.ok(project);
      assert.deepEqual(
        new Set(project.paths as string[]),
        new Set([root, alias]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(alias, { recursive: true, force: true });
    }
  });

  it("persists the dashboard state roundtrip", async () => {
    const first = await mkdtemp(join(tmpdir(), "goat-flow-roundtrip-one-"));
    const second = await mkdtemp(join(tmpdir(), "goat-flow-roundtrip-two-"));
    const nextPaths = [first, second];
    const nextFavorites = ["goat-review", "goat-qa"];
    const nextProjectTitles = { [first]: "Roundtrip project" };
    try {
      const post = await fetchJson("/api/projects/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paths: nextPaths,
          favorites: nextFavorites,
          projectTitles: nextProjectTitles,
        }),
      });
      assert.equal(post.res.status, 200);
      assert.deepEqual(post.body, { ok: true });

      const get = await fetchJson("/api/projects/list");
      assert.equal(get.res.status, 200);
      const body = expectRecord(get.body, "dashboard state");
      assert.deepEqual(new Set(body.paths as string[]), new Set(nextPaths));
      assert.deepEqual(body.favorites, nextFavorites);
      const projectTitles = expectRecord(
        body.projectTitles,
        "dashboard state projectTitles",
      );
      assert.ok(Object.values(projectTitles).includes("Roundtrip project"));
      const projects = expectRecord(body.projects, "dashboard state projects");
      assert.ok(Object.keys(projects).length >= 1);
      const persisted = expectRecord(
        JSON.parse(await readFile(DASHBOARD_STATE_PATH, "utf-8")),
        "persisted dashboard state",
      );
      assert.deepEqual(
        persistedProjectsState(persisted),
        persistedProjectsState(body),
      );
    } finally {
      await rm(first, { recursive: true, force: true });
      await rm(second, { recursive: true, force: true });
    }
  });

  it("archives and restores a project without deleting its directory or metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "goat-flow-archive-project-"));
    try {
      await writeProjectFile(root, "sentinel.txt", "retained\n");
      const save = await fetchJson("/api/projects/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paths: [root],
          favorites: [],
          projectTitles: { [root]: "Archived fixture" },
        }),
      });
      assert.equal(save.res.status, 200);

      const archive = await fetchJson("/api/projects/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: root }),
      });
      assert.equal(archive.res.status, 200);

      const archived = await fetchJson("/api/projects/list");
      const archivedBody = expectRecord(archived.body, "archived state");
      assert.equal((archivedBody.paths as string[]).includes(root), false);
      const archivedProjects = Object.values(
        expectRecord(archivedBody.projects, "archived projects"),
      ).map((project) => expectRecord(project, "archived project"));
      const archivedProject = archivedProjects.find(
        (project) => project.currentPath === root,
      );
      assert.ok(archivedProject);
      assert.equal(typeof archivedProject.archivedAt, "string");
      assert.equal(archivedProject.title, "Archived fixture");
      assert.equal(
        await readFile(join(root, "sentinel.txt"), "utf-8"),
        "retained\n",
      );

      const restore = await fetchJson("/api/projects/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: root }),
      });
      assert.equal(restore.res.status, 200);

      const restored = await fetchJson("/api/projects/list");
      const restoredBody = expectRecord(restored.body, "restored state");
      assert.ok((restoredBody.paths as string[]).includes(root));
      const restoredProjects = Object.values(
        expectRecord(restoredBody.projects, "restored projects"),
      ).map((project) => expectRecord(project, "restored project"));
      const restoredProject = restoredProjects.find(
        (project) => project.currentPath === root,
      );
      assert.ok(restoredProject);
      assert.equal(restoredProject.archivedAt, undefined);
      assert.equal(restoredProject.title, "Archived fixture");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("converts a shortened legacy project save into archive state", async () => {
    const first = await mkdtemp(join(tmpdir(), "goat-flow-active-project-"));
    const second = await mkdtemp(join(tmpdir(), "goat-flow-legacy-remove-"));
    try {
      for (const paths of [[first, second], [first]]) {
        const save = await fetchJson("/api/projects/list", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paths, favorites: [], projectTitles: {} }),
        });
        assert.equal(save.res.status, 200);
      }

      const get = await fetchJson("/api/projects/list");
      const body = expectRecord(get.body, "legacy archive state");
      const projects = Object.values(
        expectRecord(body.projects, "legacy archive projects"),
      ).map((project) => expectRecord(project, "legacy archive project"));
      const archivedProject = projects.find(
        (project) => project.currentPath === second,
      );
      assert.ok(archivedProject);
      assert.equal(typeof archivedProject.archivedAt, "string");
      assert.equal((body.paths as string[]).includes(second), false);
    } finally {
      await rm(first, { recursive: true, force: true });
      await rm(second, { recursive: true, force: true });
    }
  });

  it("rejects exact shared temp roots when saving project state", async () => {
    if (process.platform === "win32") return;

    const { res, body } = await fetchJson("/api/projects/list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paths: ["/tmp"],
        favorites: [],
        projectTitles: {},
      }),
    });
    assert.equal(res.status, 400);
    const payload = expectRecord(body, "Projects list blocked-root error");
    assert.match(String(payload.error), /Local path validation failed/);
    assert.doesNotMatch(String(payload.error), /\/tmp/);
  });

  it("reports blocked roots through the project status result", async () => {
    if (process.platform === "win32") return;

    const { res, body } = await fetchJson(
      `/api/projects/status?paths=${encodeURIComponent("/tmp")}`,
    );
    assert.equal(res.status, 200);
    const payload = expectRecord(body, "Projects status blocked-root response");
    assert.ok(Array.isArray(payload.projects));
    const project = expectRecord(
      (payload.projects as unknown[])[0],
      "Projects status blocked-root item",
    );
    assert.equal(project.state, "error");
    assert.match(String(project.details), /Local path validation failed/);
  });

  it("resolves matching git remotes to one dashboard project identity", async () => {
    const one = await mkdtemp(join(tmpdir(), "goat-flow-git-project-one-"));
    const two = await mkdtemp(join(tmpdir(), "goat-flow-git-project-two-"));
    const remoteUrl = "git@github.com:Example/PrivateRepo.git";
    try {
      runGit(one, ["init"]);
      runGit(one, ["remote", "add", "origin", remoteUrl]);
      runGit(two, ["init"]);
      runGit(two, ["remote", "add", "origin", remoteUrl]);

      // Hoisted out of the fetch template: nested template literals corrupt gruff-ts's
      // source masker (false waste.unused-import on `rename`); inline again once gruff-ts
      // masks nested templates correctly.
      const pathsParam = `${one},${two}`;
      const { body } = await fetchJson(
        `/api/projects/status?paths=${encodeURIComponent(pathsParam)}`,
      );
      const payload = expectRecord(body, "Projects status response");
      assert.ok(Array.isArray(payload.projects));
      const [first, second] = payload.projects as unknown[];
      const firstProject = expectRecord(first, "First project");
      const secondProject = expectRecord(second, "Second project");
      assert.equal(firstProject.identity, secondProject.identity);
      assert.equal(firstProject.identitySource, "git-remote");
      assert.equal(typeof firstProject.remoteUrlHash, "string");
      assert.equal(JSON.stringify(payload).includes(remoteUrl), false);
    } finally {
      await rm(one, { recursive: true, force: true });
      await rm(two, { recursive: true, force: true });
    }
  });

  it("returns 400 for invalid project list JSON", async () => {
    const { res, body } = await fetchJson("/api/projects/list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    assert.equal(res.status, 400);

    const payload = expectRecord(body, "Projects list error");
    assert.equal(typeof payload.error, "string");
  });

  it("returns 400 without paths", async () => {
    const { res } = await fetchJson("/api/projects/status");
    assert.equal(res.status, 400);
  });

  it("returns 405 for unsupported project list methods", async () => {
    const { res, body } = await fetchJson("/api/projects/list", {
      method: "DELETE",
    });
    assert.equal(res.status, 405);
    assert.deepEqual(body, { error: "Method not allowed" });
  });

  it("uses a local goat-flow marker for non-git projects across renames", async () => {
    const root = await mkdtemp(join(tmpdir(), "goat-flow-marker-project-"));
    const moved = `${root}-renamed`;
    try {
      await writeProjectFile(
        root,
        ".goat-flow/config.yaml",
        "version: 1.7.0\n",
      );
      const registration = await fetchJson("/api/projects/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paths: [root],
          favorites: [],
          projectTitles: {},
        }),
      });
      assert.equal(registration.res.status, 200);
      const first = await fetchJson(
        `/api/projects/status?paths=${encodeURIComponent(root)}`,
      );
      const firstBody = expectRecord(first.body, "First status");
      assert.ok(Array.isArray(firstBody.projects));
      const firstProject = expectRecord(
        (firstBody.projects as unknown[])[0],
        "First project",
      );
      assert.equal(firstProject.identitySource, "goat-marker");
      const marker = await readFile(
        join(root, ".goat-flow", "project-id"),
        "utf-8",
      );
      assert.match(
        marker,
        /^# Local goat-flow dashboard project identity\. Gitignored by default\.\ngf_[0-9a-f-]{36}\n$/iu,
      );
      assert.deepEqual(
        (await readdir(join(root, ".goat-flow"))).filter(
          (name) => name.startsWith(".project-id.") && name.endsWith(".tmp"),
        ),
        [],
      );

      await rename(root, moved);
      const second = await fetchJson(
        `/api/projects/status?paths=${encodeURIComponent(moved)}`,
      );
      const secondBody = expectRecord(second.body, "Second status");
      assert.ok(Array.isArray(secondBody.projects));
      const secondProject = expectRecord(
        (secondBody.projects as unknown[])[0],
        "Second project",
      );
      assert.equal(secondProject.identity, firstProject.identity);
      assert.equal(secondProject.path, moved);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(moved, { recursive: true, force: true });
    }
  });
  it("lists discovered siblings without probing git when nothing is archived", async () => {
    // A clean empty state means hydration has no saved paths to re-resolve, so every git probe counted below
    // belongs to sibling discovery alone.
    await writeFile(
      DASHBOARD_STATE_PATH,
      JSON.stringify({
        paths: [],
        favorites: [],
        projectTitles: {},
        projects: {},
      }),
    );
    const control = await fetchJson("/api/projects/list");
    assert.equal(control.res.status, 200);
    const controlBody = expectRecord(control.body, "control list");
    assert.ok(Array.isArray(controlBody.discoveredPaths));

    // The server never logs identity lookups, so counting its git remote reads is the only way to see that a list load skipped them.
    let gitRemoteProbes = 0;
    childProcess.execFileSync = ((file, args, options) => {
      if (
        file === "git" &&
        Array.isArray(args) &&
        args.includes("remote.origin.url")
      ) {
        gitRemoteProbes += 1;
      }
      return Reflect.apply(originalExecFileSync, childProcess, [
        file,
        args,
        options,
      ]);
    }) as typeof childProcess.execFileSync;
    syncBuiltinESMExports();
    try {
      const probed = await fetchJson("/api/projects/list");
      assert.equal(probed.res.status, 200);
      const probedBody = expectRecord(probed.body, "probed list");
      assert.deepEqual(probedBody.discoveredPaths, controlBody.discoveredPaths);
      assert.equal(gitRemoteProbes, 0);
    } finally {
      childProcess.execFileSync = originalExecFileSync;
      syncBuiltinESMExports();
    }
  });

  it("archives a deleted project by its saved row but rejects unknown missing paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "goat-flow-stale-archive-"));
    const unknownMissing = `${root}-never-saved`;
    try {
      const save = await fetchJson("/api/projects/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paths: [root],
          favorites: [],
          projectTitles: { [root]: "Stale fixture" },
        }),
      });
      assert.equal(save.res.status, 200);
      await rm(root, { recursive: true, force: true });

      const before = await fetchJson("/api/projects/list");
      const unknownArchive = await fetchJson("/api/projects/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: unknownMissing }),
      });
      assert.equal(unknownArchive.res.status, 400);
      const after = await fetchJson("/api/projects/list");
      assert.deepEqual(
        persistedProjectsState(after.body),
        persistedProjectsState(before.body),
      );

      const archive = await fetchJson("/api/projects/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: root }),
      });
      assert.equal(archive.res.status, 200);
      const archived = await fetchJson("/api/projects/list");
      const archivedBody = expectRecord(archived.body, "stale archived state");
      assert.equal((archivedBody.paths as string[]).includes(root), false);
      const [archivedProject, ...extraArchived] = projectRecordsWithPath(
        archived.body,
        root,
      );
      assert.ok(archivedProject);
      assert.deepEqual(extraArchived, []);
      assert.equal(typeof archivedProject.archivedAt, "string");
      assert.equal(archivedProject.title, "Stale fixture");

      const restore = await fetchJson("/api/projects/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: root }),
      });
      assert.equal(restore.res.status, 400);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps one project record when a restored project's identity changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "goat-flow-rekey-project-"));
    try {
      const save = await fetchJson("/api/projects/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paths: [root],
          favorites: [],
          projectTitles: { [root]: "Rekey fixture" },
        }),
      });
      assert.equal(save.res.status, 200);
      const [savedProject] = projectRecordsWithPath(
        (await fetchJson("/api/projects/list")).body,
        root,
      );
      assert.ok(savedProject);
      assert.equal(savedProject.identitySource, "path");

      const archive = await fetchJson("/api/projects/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: root }),
      });
      assert.equal(archive.res.status, 200);

      // The project gains a git remote while archived, so its identity is no longer the path.
      runGit(root, ["init"]);
      runGit(root, [
        "remote",
        "add",
        "origin",
        "git@github.com:Example/RekeyFixture.git",
      ]);

      const restore = await fetchJson("/api/projects/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: root }),
      });
      assert.equal(restore.res.status, 200);

      const restored = await fetchJson("/api/projects/list");
      const restoredBody = expectRecord(restored.body, "rekeyed state");
      assert.ok((restoredBody.paths as string[]).includes(root));
      const [restoredProject, ...extraRestored] = projectRecordsWithPath(
        restored.body,
        root,
      );
      assert.ok(restoredProject);
      assert.deepEqual(extraRestored, []);
      assert.equal(restoredProject.archivedAt, undefined);
      assert.equal(restoredProject.title, "Rekey fixture");
      assert.equal(restoredProject.identitySource, "git-remote");
      assert.notEqual(restoredProject.identity, savedProject.identity);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("keeps one project record when a saved project's identity changes before a whole-list save", async () => {
    const root = await mkdtemp(join(tmpdir(), "goat-flow-list-rekey-project-"));
    try {
      const firstSave = await fetchJson("/api/projects/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paths: [root],
          favorites: [],
          projectTitles: { [root]: "List rekey fixture" },
        }),
      });
      assert.equal(firstSave.res.status, 200);
      const [savedProject] = projectRecordsWithPath(
        (await fetchJson("/api/projects/list")).body,
        root,
      );
      assert.ok(savedProject);
      assert.equal(savedProject.identitySource, "path");

      // The project gains a git remote, then the user edits its title, which the dashboard sends as a whole-list save.
      runGit(root, ["init"]);
      runGit(root, [
        "remote",
        "add",
        "origin",
        "git@github.com:Example/ListRekeyFixture.git",
      ]);
      const secondSave = await fetchJson("/api/projects/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paths: [root],
          favorites: [],
          projectTitles: { [String(savedProject.identity)]: "Renamed fixture" },
        }),
      });
      assert.equal(secondSave.res.status, 200);

      const saved = await fetchJson("/api/projects/list");
      const savedBody = expectRecord(saved.body, "list rekey state");
      assert.ok((savedBody.paths as string[]).includes(root));
      const [savedProjectAfter, ...extraProjects] = projectRecordsWithPath(
        saved.body,
        root,
      );
      assert.ok(savedProjectAfter);
      assert.deepEqual(extraProjects, []);
      assert.equal(savedProjectAfter.archivedAt, undefined);
      assert.equal(savedProjectAfter.title, "Renamed fixture");
      assert.equal(savedProjectAfter.identitySource, "git-remote");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
