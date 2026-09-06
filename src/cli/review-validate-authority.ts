/**
 * Capture the files selected for a review and check later evidence against that original selection.
 * Use this owner to resolve source requests, freeze inventories, and compare a retained receipt with current source state.
 *
 * The CLI and report validator share canonical JSON and raw readers; snapshots retain metadata while file contents stay transient.
 * Capture and revalidation never change the project or run a review gate.
 */
import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import {
  requireAuthority,
  record,
  exactKeys,
  textField,
  comparePaths,
  projectPath,
  pathList,
  rawHash,
  taggedHash,
  canonicalReviewJson,
  parseReviewJson,
  ReviewAuthorityError,
  type JsonValue,
  type JsonRecord,
  type InventoryMember,
  type FileState,
  type GitContext,
  type SelectedFiles,
  type ReviewAuthoritySnapshot,
  type ReviewSnapshotEnvelope,
  type IntegrityField,
  type IntegrityFieldMap,
  type ReviewAnchorAuthority,
} from "./review-validate-common.js";
import {
  readGit,
  nulRecords,
  gitContext,
  objectId,
  commitId,
  baseCommit,
  loadBlobs,
  treeFiles,
  indexEntries,
  indexFiles,
  indexFingerprint,
  livePath,
  liveBytes,
  liveState,
  liveFiles,
  untrackedPaths,
  requireRawComparison,
} from "./review-validate-anchors.js";
export {
  canonicalReviewJson,
  parseReviewJson,
  reviewGateId,
  ReviewAuthorityError,
  type ReviewAuthoritySnapshot,
  type ReviewSnapshotEnvelope,
} from "./review-validate-common.js";

import {
  addViolation,
  type ParsedScopeSnapshot,
  type ReviewValidationViolation,
} from "./review-validate-common.js";

/** Require one actual merge base; a criss-cross history cannot silently choose a different old side. */
function comparisonBase(
  context: GitContext,
  left: string,
  head: string,
): string {
  const bases = readGit(context.root, ["merge-base", "--all", left, head])
    .toString()
    .trim()
    .split("\n");
  requireAuthority(
    bases.length === 1,
    "multiple merge bases require an explicit two-dot comparison",
    "authority-unsupported",
  );
  return objectId(context, bases[0]!);
}

/** Resolve PR, branch, or range endpoints separately from their actual comparison base. */
function selectRange(
  context: GitContext,
  requested: JsonRecord,
): SelectedFiles {
  const isRange = requested.kind === "range";
  exactKeys(
    requested,
    isRange
      ? ["kind", "left", "right", "operator"]
      : ["kind", "target", "head"],
  );
  const operator = isRange ? requested.operator : "...";
  requireAuthority(
    operator === ".." || operator === "...",
    "range operator must be .. or ...",
  );
  const left = commitId(context, isRange ? requested.left : requested.target);
  const head = commitId(context, isRange ? requested.right : requested.head);
  const base = operator === ".." ? left : comparisonBase(context, left, head);
  const endpoint = isRange ? { left } : { targetTip: left };
  return {
    source: {
      kind: textField(requested.kind, "source kind"),
      requested,
      ...endpoint,
      head,
      comparisonBase: base,
      operator,
    },
    before: treeFiles(context, base),
    after: treeFiles(context, head),
    index: null,
  };
}

/** Select a commit's declared parent, preserving the empty old side of a root commit. */
function selectCommit(
  context: GitContext,
  requested: JsonRecord,
): SelectedFiles {
  exactKeys(requested, ["kind", "commit", "parent"]);
  const head = commitId(context, requested.commit);
  const parents = readGit(context.root, ["cat-file", "commit", head])
    .toString()
    .split("\n\n", 1)[0]!
    .split("\n")
    .filter((line) => line.startsWith("parent "))
    .map((line) => objectId(context, line.slice(7)));
  const selected = requested.parent;
  requireAuthority(
    selected === null ||
      (typeof selected === "number" &&
        Number.isSafeInteger(selected) &&
        selected > 0),
    "commit parent must be a positive integer or null",
  );
  requireAuthority(
    selected !== null || parents.length < 2,
    "merge commits require an explicit parent number",
    "authority-unsupported",
  );
  const parentNumber = selected ?? (parents.length === 1 ? 1 : null);
  requireAuthority(
    parentNumber === null || parentNumber <= parents.length,
    "selected commit parent does not exist",
    "authority-object",
  );
  const base = parentNumber === null ? null : parents[parentNumber - 1]!;
  return {
    source: {
      kind: "commit",
      requested,
      head,
      parentNumber,
      comparisonBase: base,
    },
    before: treeFiles(context, base),
    after: treeFiles(context, head),
    index: null,
  };
}

/** Freeze the caller's chosen untracked rule; explicit absent paths remain declared members. */
function selectUntracked(
  context: GitContext,
  selection: JsonValue | undefined,
): string[] {
  const untracked = record(selection, "untracked");
  const mode = untracked.mode;
  exactKeys(untracked, mode === "explicit" ? ["mode", "paths"] : ["mode"]);
  requireAuthority(
    mode === "exclude" || mode === "all-nonignored" || mode === "explicit",
    "invalid untracked membership mode",
  );
  // Excluding untracked files is a deliberate bounded selection, not an enumeration failure.
  if (mode === "exclude") return [];
  // The operator included every nonignored untracked file, so membership must be frozen explicitly.
  if (mode === "all-nonignored") return untrackedPaths(context);
  const paths = pathList(untracked.paths);
  const tracked = new Set(indexEntries(context).map((entry) => entry.path));
  requireAuthority(
    paths.every((path) => !tracked.has(path)),
    "explicit untracked paths must not name index entries",
    "authority-path",
  );
  return paths;
}

/** Select the staged index or the live tracked side without using a Git content diff. */
function selectWorkingFiles(
  context: GitContext,
  requested: JsonRecord,
): SelectedFiles {
  const kind = textField(requested.kind, "source kind");
  const fields = {
    staged: ["kind", "base"],
    unstaged: ["kind"],
    worktree: ["kind", "base", "untracked"],
  };
  exactKeys(requested, fields[kind as keyof typeof fields]);
  const staged = indexFiles(context);
  const index = indexFingerprint(context);
  // Staged review must still show the index when the operator has typed further edits in the same file.
  if (kind === "staged") {
    const base = baseCommit(context, requested.base);
    return {
      source: { kind, requested, base },
      before: treeFiles(context, base),
      after: staged,
      index,
    };
  }
  const trackedPaths = [...staged.keys()];
  requireRawComparison(context, trackedPaths);
  // Unstaged review compares the editor's tracked bytes with the captured index, excluding new untracked files.
  if (kind === "unstaged")
    return {
      source: { kind, requested },
      before: staged,
      after: liveFiles(context, trackedPaths),
      index,
    };
  const base = baseCommit(context, requested.base);
  const untracked = selectUntracked(context, requested.untracked);
  return {
    source: { kind, requested, base, untrackedPaths: untracked },
    before: treeFiles(context, base),
    after: liveFiles(context, [...trackedPaths, ...untracked]),
    index,
  };
}

/** Resolve each explicitly qualified path without borrowing authority from another selected side. */
function selectPaths(
  context: GitContext,
  requested: JsonRecord,
): SelectedFiles {
  exactKeys(requested, ["kind", "paths"]);
  requireAuthority(
    Array.isArray(requested.paths),
    "explicit paths must be an array",
  );
  const after = new Map<string, FileState>();
  const resolvedPaths: JsonRecord[] = [];
  let usesIndex = false;
  // Each member retains its own live/index/Git origin, even in a deliberately mixed selection.
  for (const value of requested.paths) {
    const member = record(value, "selected path");
    exactKeys(
      member,
      member.from === "git" ? ["path", "from", "revision"] : ["path", "from"],
    );
    const path = projectPath(member.path);
    requireAuthority(
      !after.has(path),
      "duplicate selected path",
      "authority-path",
    );
    requireAuthority(
      member.from === "live" ||
        member.from === "index" ||
        member.from === "git",
      "path from must be live, index, or git",
    );
    const resolved = { ...member };
    let state: FileState;
    // A Git-qualified path may be absent at that revision; it never falls back to the editor's file.
    if (member.from === "git") {
      resolved.revision = commitId(context, member.revision);
      state = treeFiles(context, resolved.revision, new Set([path])).get(
        path,
      ) ?? { kind: "absent" };
    } else // An index-qualified file uses its staged bytes even if the editor shows a newer save.
    if (member.from === "index") {
      usesIndex = true;
      state = indexFiles(context).get(path) ?? { kind: "absent" };
    } else state = liveState(context.root, path);
    after.set(path, state);
    resolvedPaths.push(resolved);
  }
  resolvedPaths.sort((left, right) =>
    comparePaths(left.path as string, right.path as string),
  );
  return {
    source: { kind: "paths", requested, paths: resolvedPaths },
    before: null,
    after,
    index: usesIndex ? indexFingerprint(context) : null,
  };
}

/** Walk a standalone project using the same excluded build/tool directories as the repository filesystem adapter. */
function standalonePaths(root: string, directory = "."): string[] {
  const excluded = new Set([
    ".git",
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".next",
    ".turbo",
    "vendor",
    ".venv",
    "__pycache__",
    ".idea",
    ".vscode",
  ]);
  requireAuthority(
    !existsSync(join(root, directory, ".gitignore")),
    "standalone area with ignore rules requires explicit paths or a Git repository",
    "authority-unsupported",
  );
  const paths: string[] = [];
  // Directory enumeration never follows symlinks into another tree or enters a nested checkout.
  for (const entry of readdirSync(join(root, directory), {
    withFileTypes: true,
    encoding: "utf8",
  })) {
    const path = directory === "." ? entry.name : `${directory}/${entry.name}`;
    // Standalone area audits omit symlinks and known generated or tool directories from discovery.
    if (entry.isSymbolicLink() || excluded.has(entry.name)) continue;
    // A directory contributes eligible descendants rather than becoming a file-evidence entry.
    if (entry.isDirectory()) {
      // A nested repository is a separate project and cannot enter this area's discovered membership.
      if (!existsSync(join(root, path, ".git")))
        paths.push(...standalonePaths(root, path));
    } else {
      requireAuthority(
        entry.isFile(),
        "area contains an unsupported file kind",
        "authority-unsupported",
      );
      paths.push(projectPath(path));
    }
  }
  return paths.sort(comparePaths);
}

/**
 * Exclude symlinks and nested repositories from an area without reading their contents.
 *
 * @throws Error for other path failures; unsupported traversal recovers to false so discovery skips that boundary
 */
function withinAreaBoundary(context: GitContext, path: string): boolean {
  try {
    livePath(context.root, path);
    return true;
  } catch (error) {
    // A symlink or nested checkout is outside an area walk; explicitly selecting it reports the unsupported source instead.
    if (
      error instanceof ReviewAuthorityError &&
      error.code === "authority-unsupported"
    )
      return false;
    throw error;
  }
}

/** Enumerate the requested live area or freeze only its declared sample. */
function selectArea(context: GitContext, requested: JsonRecord): SelectedFiles {
  exactKeys(requested, ["kind", "roots", "sample"]);
  const roots = pathList(requested.roots, true);
  requireAuthority(roots.length > 0, "area requires at least one root");
  // Every root must remain a literal directory in this project, including when a sample is supplied.
  for (const root of roots) {
    const path = root === "." ? context.root : livePath(context.root, root);
    requireAuthority(
      existsSync(path) && lstatSync(path).isDirectory(),
      "area root must exist as a directory",
      "authority-path",
    );
  }
  // A sample stays within the declared directories; selecting the project root includes every eligible descendant.
  const withinRoots = (path: string): boolean =>
    roots.some((root) => root === "." || path.startsWith(`${root}/`));
  let paths: string[];
  // A declared sample is its own inventory; added files outside that sample do not imply extra reviewed coverage.
  if (requested.sample !== null) paths = pathList(requested.sample);
  else {
    const candidates =
      context.objectFormat === null
        ? standalonePaths(context.root)
        : [
            ...nulRecords(
              readGit(context.root, ["ls-files", "--cached", "-z"]),
            ),
            ...untrackedPaths(context, true),
          ];
    paths = [...new Set(candidates)]
      .filter(withinRoots)
      .filter((path) => withinAreaBoundary(context, path))
      .sort(comparePaths);
  }
  requireAuthority(
    paths.every(withinRoots),
    "area sample contains a path outside its declared roots",
    "authority-path",
  );
  return {
    source: { kind: "area", requested, paths },
    before: null,
    after: liveFiles(context, paths),
    index: null,
  };
}

/**
 * Route the operator's explicit source choice to the reader that owns its comparison and file membership.
 *
 * @throws ReviewAuthorityError when the source kind is unknown or its selected files cannot be captured
 */
function selectSource(
  context: GitContext,
  requested: JsonRecord,
): SelectedFiles {
  switch (requested.kind) {
    case "pr":
    case "branch":
    case "range":
      return selectRange(context, requested);
    case "commit":
      return selectCommit(context, requested);
    case "staged":
    case "unstaged":
    case "worktree":
      return selectWorkingFiles(context, requested);
    case "paths":
      return selectPaths(context, requested);
    case "area":
      return selectArea(context, requested);
    default:
      throw new ReviewAuthorityError(
        "authority-format",
        "unknown review source kind",
      );
  }
}

/** Compare raw presence, mode, and content while keeping origin metadata available for actual anchor reads. */
function sameFile(left: FileState, right: FileState): boolean {
  // A deletion matches only another absence, never a zero-byte regular file.
  if (left.kind === "absent" || right.kind === "absent")
    return left.kind === right.kind;
  return left.mode === right.mode && left.sha256 === right.sha256;
}

/** Build changed literal members without rename inference; explicit paths retain unchanged and absent members too. */
function selectedInventory(selection: SelectedFiles): InventoryMember[] {
  const paths = [
    ...new Set([
      ...(selection.before?.keys() ?? []),
      ...selection.after.keys(),
    ]),
  ].sort(comparePaths);
  return paths.flatMap((path) => {
    const old =
      selection.before === null
        ? null
        : (selection.before.get(path) ?? { kind: "absent" as const });
    const current = selection.after.get(path) ?? { kind: "absent" as const };
    return old !== null && sameFile(old, current)
      ? []
      : [{ path, old, new: current }];
  });
}

/** Validate optional rename labels against actual deleted and added members, never using them to invent authority. */
function selectedRenames(
  value: JsonValue | undefined,
  inventory: InventoryMember[],
): { old: string; new: string }[] {
  requireAuthority(
    value === undefined || Array.isArray(value),
    "renames must be an array",
  );
  const used = new Set<string>();
  const renames = (value ?? []).map((item) => {
    const rename = record(item, "rename");
    exactKeys(rename, ["old", "new"]);
    const old = projectPath(rename.old);
    const current = projectPath(rename.new);
    const deleted = inventory.find((member) => member.path === old);
    const added = inventory.find((member) => member.path === current);
    requireAuthority(
      deleted?.old?.kind === "file" &&
        deleted.new.kind === "absent" &&
        added?.old?.kind === "absent" &&
        added.new.kind === "file",
      "rename must pair one deleted path with one added path",
      "authority-path",
    );
    requireAuthority(
      !used.has(old) && !used.has(current),
      "rename paths cannot be reused",
      "authority-path",
    );
    used.add(old);
    used.add(current);
    return { old, new: current };
  });
  return renames.sort((left, right) => comparePaths(left.old, right.old));
}

/** Describe executable source files without their review-specific Git/index/live origin labels. */
function workspaceFiles(files: Map<string, FileState>): unknown[] {
  return [...files]
    .sort(([left], [right]) => comparePaths(left, right))
    .map(([path, state]) =>
      state.kind === "absent"
        ? { path, kind: "absent" }
        : { path, kind: "file", mode: state.mode, sha256: state.sha256 },
    );
}

/** Fingerprint a complete execution source; this deliberately makes no dependency or sandbox claim. */
function workspaceFingerprint(
  head: string | null,
  files: Map<string, FileState>,
  untracked: Map<string, FileState>,
): string {
  return taggedHash("workspace", {
    head,
    files: workspaceFiles(files),
    untracked: workspaceFiles(untracked),
  });
}

/** Capture the full live checkout and explicitly selected ignored files for an execution-state comparison. */
function liveWorkspace(
  context: GitContext,
  selection: SelectedFiles,
): {
  head: string | null;
  files: Map<string, FileState>;
  untracked: Map<string, FileState>;
} {
  const head =
    context.objectFormat === null ? null : baseCommit(context, "HEAD");
  const tracked =
    context.objectFormat === null
      ? []
      : indexEntries(context).map((entry) => entry.path);
  const trackedSet = new Set(tracked);
  const extras =
    context.objectFormat === null
      ? standalonePaths(context.root)
      : untrackedPaths(context);
  const selectedExtra = [...selection.after.keys()].filter(
    (path) => !trackedSet.has(path),
  );
  return {
    head,
    files: liveFiles(context, tracked),
    untracked: liveFiles(context, [...new Set([...extras, ...selectedExtra])]),
  };
}

/** Select a gate's complete source; null live input resolves only sources whose execution identity is independent of the checkout. */
function expectedWorkspace(
  context: GitContext,
  selection: SelectedFiles,
  live: ReturnType<typeof liveWorkspace> | null,
): string | null {
  const source = selection.source;
  const kind = source.kind;
  // Commit-oriented reviews execute the selected full head, never the operator's unrelated checkout.
  if (typeof source.head === "string")
    return workspaceFingerprint(source.head, selection.after, new Map());
  // A staged gate would need the full index state, with the selected base and no added untracked files.
  if (kind === "staged")
    return workspaceFingerprint(
      source.base as string | null,
      selection.after,
      new Map(),
    );
  // Live scopes can credit only the captured complete checkout that contains their reviewed files.
  if (kind === "worktree" || kind === "unstaged" || kind === "area")
    return live === null
      ? null
      : workspaceFingerprint(live.head, live.files, live.untracked);
  return expectedPathWorkspace(context, selection, live);
}

/** Resolve qualified paths to one execution state; null means live capture is still needed or the captured views cannot run together. */
function expectedPathWorkspace(
  context: GitContext,
  selection: SelectedFiles,
  live: ReturnType<typeof liveWorkspace> | null,
): string | null {
  const source = selection.source;
  const paths = source.paths as JsonRecord[];
  const origins = new Set(paths.map((path) => path.from));
  const revisions = new Set(paths.map((path) => path.revision));
  // Uniform per-path selections can use their full Git or index state, including files outside the sample.
  if (origins.size === 1 && origins.has("git") && revisions.size === 1) {
    const revision = [...revisions][0] as string;
    return workspaceFingerprint(
      revision,
      treeFiles(context, revision),
      new Map(),
    );
  }
  // A uniform index selection can share one full staged execution state.
  if (origins.size === 1 && origins.has("index"))
    return workspaceFingerprint(
      baseCommit(context, "HEAD"),
      indexFiles(context),
      new Map(),
    );
  // Live or mixed paths need the complete checkout before their shared execution state can be established.
  if (live === null) return null;
  const allLive = new Map([...live.files, ...live.untracked]);
  const compatible = [...selection.after].every(([path, state]) =>
    sameFile(state, allLive.get(path) ?? { kind: "absent" }),
  );
  return compatible
    ? workspaceFingerprint(live.head, live.files, live.untracked)
    : null;
}

/**
 * Capture optional execution identity while preserving a fixed source when the unrelated checkout is unsupported.
 *
 * @throws Error for unexpected read failures; a disclosed checkout refusal retains any resolved source identity and explains the missing measurement
 */
function captureWorkspace(
  context: GitContext,
  selection: SelectedFiles,
  requested: boolean,
): { workspace: string | null; checkout: ReviewSnapshotEnvelope["checkout"] } {
  // A normal review needs no execution inventory; gates require opting in during the initial capture.
  if (!requested)
    return {
      workspace: null,
      checkout: { fingerprint: null, reason: "not-requested" },
    };
  let workspace: string | null = null;
  try {
    workspace = expectedWorkspace(context, selection, null);
    const live = liveWorkspace(context, selection);
    workspace ??= expectedWorkspace(context, selection, live);
    return {
      workspace,
      checkout: {
        fingerprint: workspaceFingerprint(
          live.head,
          live.files,
          live.untracked,
        ),
        reason: workspace === null ? "incompatible-selected-views" : null,
      },
    };
  } catch (error) {
    // A checkout containing a submodule or unreadable file can still support a committed review, but cannot prove a matching gate state.
    if (!(error instanceof ReviewAuthorityError)) throw error;
    return {
      workspace,
      checkout: {
        fingerprint: null,
        reason: `${error.code}: ${error.message}`,
      },
    };
  }
}

/** Capture one selection once; the outer producer compares a second capture before returning its original baseline. */
function captureOnce(
  request: JsonRecord,
  projectRoot: string,
): ReviewSnapshotEnvelope {
  exactKeys(request, ["schema", "source"], ["renames", "execution"]);
  requireAuthority(
    request.schema === "goat-review-request/v1",
    "unsupported review request schema",
  );
  requireAuthority(
    request.execution === undefined || typeof request.execution === "boolean",
    "execution must be a boolean",
  );
  const context = gitContext(projectRoot);
  const selection = selectSource(context, record(request.source, "source"));
  const inventory = selectedInventory(selection);
  const execution = captureWorkspace(
    context,
    selection,
    request.execution === true,
  );
  const unsigned = {
    schema: "goat-review-authority/v1" as const,
    objectFormat: context.objectFormat,
    source: selection.source,
    index: selection.index,
    inventory,
    renames: selectedRenames(request.renames, inventory),
    workspace: execution.workspace,
  };
  return {
    authority: { ...unsigned, fingerprint: taggedHash("authority", unsigned) },
    checkout: execution.checkout,
  };
}

/**
 * Capture a canonical review selection for CLI output or a report fixture, without persisting it.
 *
 * @param requestText - explicit source request; empty input is a capture error, never a default worktree selection
 * @param projectRoot - selected project root whose local files and Git objects supply authority
 * @returns frozen metadata and optional checkout identity; null workspace means gates cannot claim that execution state
 */
export function captureReviewSnapshot(
  requestText: string,
  projectRoot: string,
): ReviewSnapshotEnvelope {
  const request = record(parseReviewJson(requestText), "review request");
  const captured = captureOnce(request, projectRoot);
  const checked = captureOnce(request, projectRoot);
  requireAuthority(
    canonicalReviewJson(captured) === canonicalReviewJson(checked),
    "selected source changed during snapshot capture",
    "authority-drift",
  );
  return captured;
}

/** Reconstruct the original request without replacing its frozen baseline with current files. */
function snapshotRequest(
  snapshot: ReviewAuthoritySnapshot | JsonRecord,
): JsonRecord {
  const source = record(snapshot.source, "resolved source");
  requireAuthority(
    Array.isArray(snapshot.renames),
    "authority renames must be an array",
  );
  return {
    schema: "goat-review-request/v1",
    source: record(source.requested, "requested source"),
    renames: snapshot.renames,
    execution: snapshot.workspace !== null,
  };
}

/** Recheck source identity at a read/pass boundary, including reports with no findings. */
function checkSnapshot(
  projectRoot: string,
  snapshot: ReviewAuthoritySnapshot | JsonRecord,
): ReviewAuthoritySnapshot {
  const current = captureReviewSnapshot(
    canonicalReviewJson(snapshotRequest(snapshot)),
    projectRoot,
  ).authority;
  requireAuthority(
    canonicalReviewJson(current) === canonicalReviewJson(snapshot),
    "selected review bytes, membership, index, or revision changed; retain the original baseline and restart the affected review",
    "authority-drift",
  );
  return current;
}

/** Convert a capture refusal into a stable report issue without printing transient file contents. */
function authorityViolation(
  error: unknown,
  violations: ReviewValidationViolation[],
  line: number | null,
): void {
  const code =
    error instanceof ReviewAuthorityError
      ? error.code
      : "authority-unsupported";
  const message =
    error instanceof ReviewAuthorityError
      ? error.message
      : "cannot read the selected review source";
  addViolation(violations, code, line, message);
}

/**
 * Parse and verify one frozen authority field before any finding can use it.
 *
 * @param text - canonical producer output's authority object; empty or malformed metadata is refused
 * @param projectRoot - selected project, never an inferred controlling workspace
 * @param line - report location for a repairable authority error; null identifies the whole report
 *
 * @param violations - accumulated issues; the first invalid authority prevents dependent anchor reads
 * @returns verified snapshot, or null when the reviewer must repair or recapture the selection
 */
export function readReviewAuthority(
  text: string,
  projectRoot: string,
  line: number | null,
  violations: ReviewValidationViolation[],
): ReviewAuthoritySnapshot | null {
  try {
    const parsed = record(parseReviewJson(text, true), "authority snapshot");
    exactKeys(parsed, [
      "schema",
      "objectFormat",
      "source",
      "index",
      "inventory",
      "renames",
      "workspace",
      "fingerprint",
    ]);
    requireAuthority(
      parsed.schema === "goat-review-authority/v1",
      "unsupported authority schema",
    );
    record(parsed.source, "resolved source");
    const { fingerprint, ...unsigned } = parsed;
    requireAuthority(
      fingerprint === taggedHash("authority", unsigned),
      "authority fingerprint does not match its frozen record",
    );
    requireAuthority(
      parsed.workspace === null ||
        /^workspace-v1:sha256:[0-9a-f]{64}$/u.test(
          textField(parsed.workspace, "workspace"),
        ),
      "invalid execution workspace identity",
    );
    // The producer supplies the typed shape only after its canonical bytes match the retained receipt exactly.
    return checkSnapshot(projectRoot, parsed);
  } catch (error) {
    // A moved branch or an edited file invalidates the receipt; it must not become a newly accepted baseline.
    authorityViolation(error, violations, line);
    return null;
  }
}

/**
 * Recheck the original selection at a pass boundary; drift becomes a report violation without refreshing the baseline.
 *
 * @param projectRoot - reviewed project where the original selection must still resolve
 * @param snapshot - metadata captured before the review began
 * @param violations - failures appended for the reviewer's final repair list
 *
 * @param line - optional report location; omitted or null means the violation concerns the whole report
 * @returns true when the original selection still matches, false after recording a capture or drift failure
 */
export function verifyReviewAuthority(
  projectRoot: string,
  snapshot: ReviewAuthoritySnapshot,
  violations: ReviewValidationViolation[],
  line: number | null = null,
): boolean {
  try {
    checkSnapshot(projectRoot, snapshot);
    return true;
  } catch (error) {
    // A developer may save another edit while the report is being validated; retain that failure even when no findings survive.
    authorityViolation(error, violations, line);
    return false;
  }
}

/**
 * Render the readable scope labels from the same authority that answers anchor reads.
 *
 * @param snapshot - original source metadata; comparison-less sources use n/a only for the base label
 * @returns typed source, base, head, and uncommitted labels for the report's Scope snapshot
 */
export function reviewScopeLabels(snapshot: ReviewAuthoritySnapshot): {
  source: string;
  base: string;
  head: string;
  uncommitted: string;
} {
  const source = snapshot.source;
  const kind = source.kind as string;
  const names: Record<string, string> = {
    pr: "PR",
    branch: "branch diff",
    paths: "explicit path list",
    range: `range ${source.operator as string}`,
  };
  const label = names[kind] ?? kind;
  // Committed sources always name their resolved head and actual comparison, including an empty root-commit old side.
  if (["pr", "branch", "range", "commit"].includes(kind))
    return {
      source: label,
      base: (source.comparisonBase as string | null) ?? "empty-tree",
      head: source.head as string,
      uncommitted: "no",
    };
  // Staged and combined-worktree scopes show their resolved base beside a typed non-commit head label.
  if (["staged", "worktree"].includes(kind))
    return {
      source: label,
      base: (source.base as string | null) ?? "empty-tree",
      head: kind === "staged" ? "index" : "worktree",
      uncommitted: "yes",
    };
  // An unstaged scope names its index comparison side so staged and live evidence cannot be confused.
  if (kind === "unstaged")
    return {
      source: label,
      base: "index",
      head: "worktree",
      uncommitted: "yes",
    };
  return {
    source: label,
    base: "n/a",
    head: kind === "paths" ? "per-path" : "worktree",
    uncommitted: "n/a",
  };
}

/**
 * Require the readable scope to describe the same selected state as the canonical receipt.
 *
 * @param scope - parsed human-readable scope fields
 * @param snapshot - original selected authority used by evidence readers
 * @param line - report location where the reviewer can repair a contradictory scope
 *
 * @param violations - appended contradictions; an empty list after validation means no mismatch was found
 */
export function validateAuthorityScope(
  scope: ParsedScopeSnapshot,
  snapshot: ReviewAuthoritySnapshot,
  line: number,
  violations: ReviewValidationViolation[],
): void {
  const labels = reviewScopeLabels(snapshot);
  const source = scope.source.replace(/^pr\s+#[^\s]+$/u, "pr");
  const matches =
    source === labels.source.toLowerCase() &&
    scope.base === labels.base &&
    scope.head === labels.head &&
    scope.authority === snapshot.fingerprint &&
    scope.uncommitted === labels.uncommitted;
  // A familiar branch label cannot stand in for the resolved comparison and execution state.
  if (!matches)
    addViolation(
      violations,
      "authority-format",
      line,
      "Scope snapshot labels must match its Authority snapshot source, base, head, fingerprint, and uncommitted state",
    );
}

/**
 * Read one inventory member from the frozen side and verify the live/index state around that read.
 *
 * @param projectRoot - root from which the selected review was captured
 * @param snapshot - original verified authority; never substitute a fresh capture here
 * @param path - literal inventory path; absent or out-of-inventory paths cannot support findings
 *
 * @param side - explicit old/new side; undefined selects new, or old for a deleted path
 * @returns transient raw bytes; they are not persisted or used as a replacement snapshot
 */
export function readReviewAnchor(
  projectRoot: string,
  snapshot: ReviewAuthoritySnapshot,
  path: string,
  side?: "old" | "new",
): Buffer {
  projectPath(path);
  checkSnapshot(projectRoot, snapshot);
  const member = snapshot.inventory.find((entry) => entry.path === path);
  requireAuthority(
    member,
    "anchor path is outside the selected review inventory",
    "anchor-unresolved",
  );
  const selectedSide = side ?? (member.new.kind === "absent" ? "old" : "new");
  const state = member[selectedSide];
  requireAuthority(
    state?.kind === "file",
    "anchor side has no selected file",
    "anchor-unresolved",
  );
  let bytes: Buffer;
  // A live anchor gets a second raw read so an editor save during evidence lookup cannot be credited.
  if (state.from === "live") {
    bytes = verifiedLiveAnchor(projectRoot, path, state);
  } else {
    const context = gitContext(projectRoot);
    const blob = objectId(context, textField(state.blob, "selected blob"));
    loadBlobs(context, [blob]);
    const selectedBytes = context.blobs.get(blob);
    requireAuthority(
      selectedBytes,
      "selected blob is unavailable",
      "authority-object",
    );
    bytes = selectedBytes;
    requireAuthority(
      rawHash(bytes) === state.sha256,
      "selected blob does not match its recorded bytes",
      "authority-drift",
    );
  }
  checkSnapshot(projectRoot, snapshot);
  return bytes;
}

/** Keep an editor save between the two raw anchor reads from being credited to the original review. */
function verifiedLiveAnchor(
  projectRoot: string,
  path: string,
  state: Extract<FileState, { kind: "file" }>,
): Buffer {
  const root = realpathSync(projectRoot);
  const before = liveBytes(root, path);
  const after = liveBytes(root, path);
  requireAuthority(
    before &&
      after &&
      before.mode === state.mode &&
      after.mode === state.mode &&
      rawHash(before.bytes) === state.sha256 &&
      rawHash(after.bytes) === state.sha256,
    "live anchor changed while reading its selected bytes",
    "authority-drift",
  );
  return before.bytes;
}

/**
 * Require one visible copy of each authority field so examples or duplicate claims cannot supply review evidence.
 *
 * @param lines - report after non-rendered Markdown has been masked; empty means no authority is visible
 * @param violations - appended missing or duplicate field issues
 */
export function validateVisibleAuthorityFields(
  lines: string[],
  violations: ReviewValidationViolation[],
): void {
  // Repeated fields can contradict one another; examples masked before this pass never provide evidence.
  for (const label of ["Authority snapshot", "Gate authority"]) {
    const matches = lines.flatMap((text, index) =>
      new RegExp(`^\\s*(?:-\\s+)?${label}:`, "u").test(text) ? [index + 1] : [],
    );
    // Missing or repeated authority fields make the source of the review ambiguous.
    if (matches.length !== 1)
      addViolation(
        violations,
        "authority-format",
        matches[0] ?? null,
        `report requires exactly one visible ${label} field`,
      );
  }
}

/**
 * Read the compact receipt's standalone authority fields for the shared source checks.
 *
 * @param lines - visible report lines; full-form list rows cannot substitute for compact fields
 * @returns located authority and coverage fields; missing entries are rejected by the shared reader
 */
export function compactAuthorityFields(lines: string[]): IntegrityFieldMap {
  const fields: IntegrityFieldMap = new Map();
  // Compact reviews still retain the same machine-verifiable selection even when they have no findings.
  for (const [index, text] of lines.entries()) {
    const match = text.match(/^\s*(Authority snapshot|Gate authority): (.*)$/u);
    // Only standalone compact authority rows can bind the compact report's selected bytes.
    if (match) fields.set(match[1]!, { value: match[2]!, line: index + 1 });
    const coverage = text.match(
      /^\s*Review Integrity:[^;]+;\s*(\d+\/\d+) files opened;/u,
    );
    // Compact coverage uses the same absence check as the full receipt after its own grammar has been validated.
    if (coverage)
      fields.set("Files opened in Pass 2", {
        value: coverage[1]!,
        line: index + 1,
      });
  }
  return fields;
}

/**
 * Bind either receipt form to its original source and a reader that rechecks anchor bytes.
 *
 * @param fields - parsed receipt rows; absent authority fields cannot borrow trust from free-text scope
 * @param projectRoot - selected project used for source and anchor revalidation
 * @param violations - appended source, shape, or impossible coverage failures
 *
 * @returns bound authority, or invalid when the original selection cannot be verified
 */
export function readAuthorityFields(
  fields: IntegrityFieldMap,
  projectRoot: string,
  violations: ReviewValidationViolation[],
): ReviewAnchorAuthority {
  const authorityField = fields.get("Authority snapshot");
  const gateField = fields.get("Gate authority");
  // Missing canonical fields cannot borrow authority from a free-text scope description.
  if (!authorityField || !gateField) {
    addViolation(
      violations,
      "authority-format",
      null,
      "receipt requires Authority snapshot and Gate authority in its selected full or compact form",
    );
    return { kind: "invalid" };
  }
  const snapshot = readReviewAuthority(
    authorityField.value,
    projectRoot,
    authorityField.line,
    violations,
  );
  // An invalid source already has a repairable issue; dependent gates and anchors cannot be credited.
  if (snapshot === null) return { kind: "invalid" };
  validateAbsentOpenedFiles(
    fields.get("Files opened in Pass 2"),
    snapshot,
    violations,
  );
  return {
    kind: "snapshot",
    snapshot,
    readAnchor: (path, side) =>
      readReviewAnchor(projectRoot, snapshot, path, side),
  };
}

/** An explicitly absent selection cannot be counted as a file opened in the review. */
function validateAbsentOpenedFiles(
  field: IntegrityField | undefined,
  snapshot: ReviewAuthoritySnapshot,
  violations: ReviewValidationViolation[],
): void {
  const absent = snapshot.inventory.filter(
    (member) => member.new.kind === "absent" && member.old?.kind !== "file",
  ).length;
  // Ordinary coverage arithmetic has its own owner; this check only removes impossible credit for missing selected files.
  if (absent === 0 || !field) return;
  const opened = Number(field.value.match(/^(\d+)\//u)?.[1]);
  // An explicitly absent selected file cannot contribute to the number of files opened.
  if (opened > snapshot.inventory.length - absent)
    addViolation(
      violations,
      "authority-path",
      field.line,
      "absent selected paths cannot count as files opened in Pass 2",
    );
}
