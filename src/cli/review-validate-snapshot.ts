/** Validate retained review metadata without reading Git or today's workspace. */
import {
  canonicalReviewJson,
  comparePaths,
  exactKeys,
  pathList,
  projectPath,
  record,
  requireAuthority,
  taggedHash,
  textField,
  type InventoryMember,
  type FileState,
  type JsonRecord,
  type JsonValue,
  type ReviewAuthoritySnapshot,
} from "./review-validate-common.js";

/** Require an object name in the capture's declared Git format. */
function objectName(
  value: JsonValue | undefined,
  format: JsonValue | undefined,
): void {
  requireAuthority(
    typeof value === "string" &&
      (format === "sha1"
        ? /^[a-f0-9]{40}$/u
        : format === "sha256"
          ? /^[a-f0-9]{64}$/u
          : /$a/u
      ).test(value),
    "invalid captured Git object name",
  );
}

/** Validate one file's origin and required metadata, including absence. */
function fileState(
  value: JsonValue | undefined,
  format: JsonValue | undefined,
): FileState {
  const state = record(value, "file state");
  if (state.kind === "absent") {
    exactKeys(state, ["kind"]);
    return { kind: "absent" };
  }
  requireAuthority(state.kind === "file", "invalid file state kind");
  const from = state.from;
  requireAuthority(
    from === "live" || from === "index" || from === "git",
    "invalid file origin",
  );
  exactKeys(state, [
    "kind",
    "from",
    "mode",
    "sha256",
    ...{ live: [], index: ["blob"], git: ["blob", "revision"] }[from],
  ]);
  requireAuthority(
    state.mode === "100644" || state.mode === "100755",
    "invalid file mode",
  );
  requireAuthority(
    typeof state.sha256 === "string" && /^[a-f0-9]{64}$/u.test(state.sha256),
    "invalid file digest",
  );
  if (from !== "live") objectName(state.blob, format);
  if (from === "git") objectName(state.revision, format);
  const base: Extract<FileState, { kind: "file" }> = {
    kind: "file",
    from,
    mode: state.mode,
    sha256: state.sha256,
  };
  if (from === "live") return base;
  return {
    ...base,
    blob: state.blob as string,
    ...(from === "git" ? { revision: state.revision as string } : {}),
  };
}

/** Validate qualified paths in either the original request or its resolved receipt. */
function qualifiedPaths(
  value: JsonValue | undefined,
  format: JsonValue | undefined,
  resolved: boolean,
): JsonRecord[] {
  requireAuthority(Array.isArray(value), "selected paths must be an array");
  const paths = value.map((item) => {
    const path = record(item, "selected path");
    exactKeys(
      path,
      path.from === "git" ? ["path", "from", "revision"] : ["path", "from"],
    );
    projectPath(path.path);
    requireAuthority(
      path.from === "live" || path.from === "git" || path.from === "index",
      "invalid selected path origin",
    );
    if (path.from === "git") {
      if (resolved) objectName(path.revision, format);
      else textField(path.revision, "requested revision");
    }
    return path;
  });
  pathList(paths.map((path) => projectPath(path.path)));
  return paths;
}

/** Check comparison endpoints and their operator. */
function rangeSource(
  source: JsonRecord,
  requested: JsonRecord,
  format: JsonValue | undefined,
): void {
  const range = source.kind === "range";
  exactKeys(
    requested,
    range ? ["kind", "left", "right", "operator"] : ["kind", "target", "head"],
  );
  textField(requested[range ? "left" : "target"], "requested base");
  textField(requested[range ? "right" : "head"], "requested head");
  exactKeys(source, [
    "kind",
    "requested",
    range ? "left" : "targetTip",
    "head",
    "comparisonBase",
    "operator",
  ]);
  requireAuthority(
    source.operator === ".." || source.operator === "...",
    "invalid comparison operator",
  );
  requireAuthority(
    range ? requested.operator === source.operator : source.operator === "...",
    "comparison operator differs from request",
  );
  objectName(source[range ? "left" : "targetTip"], format);
  objectName(source.head, format);
  objectName(source.comparisonBase, format);
  requireAuthority(
    source.operator !== ".." || source.comparisonBase === source.left,
    "two-dot comparison base differs from left endpoint",
  );
}

/** Check a single commit and its selected comparison parent. */
function commitSource(
  source: JsonRecord,
  requested: JsonRecord,
  format: JsonValue | undefined,
): void {
  exactKeys(requested, ["kind", "commit", "parent"]);
  textField(requested.commit, "requested commit");
  exactKeys(source, [
    "kind",
    "requested",
    "head",
    "parentNumber",
    "comparisonBase",
  ]);
  for (const parent of [requested.parent, source.parentNumber])
    requireAuthority(
      parent === null ||
        (typeof parent === "number" &&
          Number.isSafeInteger(parent) &&
          parent > 0),
      "invalid commit parent",
    );
  requireAuthority(
    requested.parent === null || requested.parent === source.parentNumber,
    "commit parent differs from request",
  );
  requireAuthority(
    requested.parent !== null ||
      source.parentNumber === null ||
      source.parentNumber === 1,
    "implicit commit parent is invalid",
  );
  requireAuthority(
    (source.parentNumber === null) === (source.comparisonBase === null),
    "commit parent and base disagree",
  );
  objectName(source.head, format);
  if (source.comparisonBase !== null) objectName(source.comparisonBase, format);
}

/** Check index-backed selections and explicit untracked membership. */
function workingSource(
  source: JsonRecord,
  requested: JsonRecord,
  format: JsonValue | undefined,
): void {
  const kind = source.kind;
  exactKeys(
    requested,
    kind === "unstaged"
      ? ["kind"]
      : kind === "staged"
        ? ["kind", "base"]
        : ["kind", "base", "untracked"],
  );
  exactKeys(
    source,
    kind === "unstaged"
      ? ["kind", "requested"]
      : kind === "staged"
        ? ["kind", "requested", "base"]
        : ["kind", "requested", "base", "untrackedPaths"],
  );
  if (kind !== "unstaged") {
    textField(requested.base, "requested base");
    if (source.base !== null) objectName(source.base, format);
    requireAuthority(
      source.base !== null || requested.base === "HEAD",
      "only an unborn HEAD can have an absent comparison base",
    );
  }
  if (kind === "worktree")
    untrackedSelection(requested.untracked, source.untrackedPaths);
}

/** Match frozen untracked membership to the requested policy. */
function untrackedSelection(
  rawSelection: JsonValue | undefined,
  rawPaths: JsonValue | undefined,
): void {
  const untracked = record(rawSelection, "untracked selection");
  exactKeys(
    untracked,
    untracked.mode === "explicit" ? ["mode", "paths"] : ["mode"],
  );
  requireAuthority(
    untracked.mode === "explicit" ||
      untracked.mode === "exclude" ||
      untracked.mode === "all-nonignored",
    "invalid untracked mode",
  );
  const paths = pathList(rawPaths);
  if (untracked.mode === "explicit")
    requireAuthority(
      canonicalReviewJson(paths) ===
        canonicalReviewJson(pathList(untracked.paths)),
      "untracked selection differs from request",
    );
  if (untracked.mode === "exclude")
    requireAuthority(
      paths.length === 0,
      "excluded untracked paths are present",
    );
}

/** Match resolved path origins to the explicit request. */
function pathSource(
  source: JsonRecord,
  requested: JsonRecord,
  format: JsonValue | undefined,
): void {
  exactKeys(requested, ["kind", "paths"]);
  exactKeys(source, ["kind", "requested", "paths"]);
  const original = qualifiedPaths(requested.paths, format, false);
  const resolved = qualifiedPaths(source.paths, format, true);
  requireAuthority(
    original.length === resolved.length &&
      original.every((path) =>
        resolved.some(
          (item) => item.path === path.path && item.from === path.from,
        ),
      ),
    "resolved paths differ from request",
  );
}

/** Keep discovered or sampled files within the declared area. */
function areaSource(source: JsonRecord, requested: JsonRecord): void {
  exactKeys(requested, ["kind", "roots", "sample"]);
  exactKeys(source, ["kind", "requested", "paths"]);
  const roots = pathList(requested.roots, true);
  requireAuthority(roots.length > 0, "area requires roots");
  const paths = pathList(source.paths);
  requireAuthority(
    paths.every((path) =>
      roots.some((root) => root === "." || path.startsWith(`${root}/`)),
    ),
    "area path escapes roots",
  );
  if (requested.sample !== null)
    requireAuthority(
      canonicalReviewJson(paths) ===
        canonicalReviewJson(pathList(requested.sample)),
      "area sample differs from request",
    );
}

/** Dispatch by source kind so each request is checked against its producer contract. */
function resolvedSource(
  source: JsonRecord,
  format: JsonValue | undefined,
): void {
  const requested = record(source.requested, "requested source");
  requireAuthority(
    requested.kind === source.kind,
    "requested and resolved source kinds differ",
  );
  switch (source.kind) {
    case "pr":
    case "branch":
    case "range":
      rangeSource(source, requested, format);
      return;
    case "commit":
      commitSource(source, requested, format);
      return;
    case "staged":
    case "unstaged":
    case "worktree":
      workingSource(source, requested, format);
      return;
    case "paths":
      pathSource(source, requested, format);
      return;
    case "area":
      areaSource(source, requested);
      return;
    default:
      requireAuthority(false, "unknown review source kind");
  }
}

/** Match present file bytes to the origin and revision selected by the source. */
function checkFileOrigin(state: FileState | null, expected: JsonRecord): void {
  if (state?.kind !== "file") return;
  requireAuthority(
    state.from === expected.from &&
      (state.from !== "git" || state.revision === expected.revision),
    "inventory file origin differs from selected source",
  );
}

/** Derive each comparison side from the validated source without reading current Git state. */
function checkInventoryOrigins(source: JsonRecord, row: InventoryMember): void {
  if (source.kind === "paths") {
    const selected = (source.paths as JsonRecord[]).find(
      (path) => path.path === row.path,
    );
    requireAuthority(selected !== undefined, "inventory path is not selected");
    checkFileOrigin(row.new, selected);
    return;
  }
  if (source.kind === "area") {
    checkFileOrigin(row.new, { from: "live" });
    return;
  }
  if (typeof source.head === "string") {
    checkFileOrigin(row.old, {
      from: "git",
      revision: source.comparisonBase ?? null,
    });
    checkFileOrigin(row.new, { from: "git", revision: source.head });
    return;
  }
  checkFileOrigin(
    row.old,
    source.kind === "unstaged"
      ? { from: "index" }
      : { from: "git", revision: source.base ?? null },
  );
  checkFileOrigin(row.new, {
    from: source.kind === "staged" ? "index" : "live",
  });
}

/** Explicit paths may be unchanged; comparison inventories contain changed bytes or modes only. */
function hasChangedBytes({ old, new: current }: InventoryMember): boolean {
  if (old === null) return true;
  if (old.kind === "absent" || current.kind === "absent")
    return old.kind !== current.kind;
  return old.mode !== current.mode || old.sha256 !== current.sha256;
}

/** Check complete file records and unique, ordered selection membership. */
function retainedInventory(
  rawInventory: JsonValue | undefined,
  source: JsonRecord,
  format: JsonValue | undefined,
): InventoryMember[] {
  requireAuthority(Array.isArray(rawInventory), "inventory must be an array");
  const inventory = rawInventory.map((value) => {
    const row = record(value, "inventory member");
    exactKeys(row, ["path", "old", "new"]);
    projectPath(row.path);
    requireAuthority(
      (row.old === null) ===
        (source.kind === "paths" || source.kind === "area"),
      "invalid inventory comparison side",
    );
    const member: InventoryMember = {
      path: projectPath(row.path),
      old: row.old === null ? null : fileState(row.old, format),
      new: fileState(row.new, format),
    };
    checkInventoryOrigins(source, member);
    requireAuthority(hasChangedBytes(member), "unchanged comparison member");
    return member;
  });
  const paths = inventory.map((row) => row.path);
  requireAuthority(
    canonicalReviewJson(paths) === canonicalReviewJson(pathList(paths)),
    "inventory must be unique and sorted",
  );
  if (source.kind === "area" || source.kind === "paths") {
    const selected =
      source.kind === "area"
        ? source.paths
        : (source.paths as JsonRecord[]).map((path) => projectPath(path.path));
    requireAuthority(
      canonicalReviewJson(paths) === canonicalReviewJson(pathList(selected)),
      "inventory differs from selected paths",
    );
  }
  return inventory;
}

/** Check rename labels against actual deleted and added members. */
function retainedRenames(
  rawRenames: JsonValue | undefined,
  inventory: InventoryMember[],
): { old: string; new: string }[] {
  requireAuthority(Array.isArray(rawRenames), "renames must be an array");
  const used = new Set<string>();
  const renames = rawRenames.map((value) => {
    const rename = record(value, "rename");
    exactKeys(rename, ["old", "new"]);
    const old = projectPath(rename.old);
    const current = projectPath(rename.new);
    requireAuthority(
      !used.has(old) && !used.has(current) && old !== current,
      "rename paths are reused",
    );
    const deleted = inventory.find((row) => row.path === old);
    const added = inventory.find((row) => row.path === current);
    requireAuthority(
      deleted?.old?.kind === "file" &&
        deleted.new.kind === "absent" &&
        added?.old?.kind === "absent" &&
        added.new.kind === "file",
      "rename must pair deleted and added files",
    );
    used.add(old);
    used.add(current);
    return { old, new: current };
  });
  requireAuthority(
    canonicalReviewJson(renames) ===
      canonicalReviewJson(
        [...renames].sort((left, right) => comparePaths(left.old, right.old)),
      ),
    "renames must be sorted",
  );
  return renames;
}

/** Keep index and Git context consistent with the selected source. */
function retainedIndex(capture: JsonRecord, source: JsonRecord): string | null {
  requireAuthority(
    capture.index === null ||
      (typeof capture.index === "string" &&
        /^index-v1:sha256:[a-f0-9]{64}$/u.test(capture.index)),
    "invalid index identity",
  );
  const usesIndex =
    ["staged", "unstaged", "worktree"].includes(
      textField(source.kind, "source kind"),
    ) ||
    (source.kind === "paths" &&
      (source.paths as JsonRecord[]).some((path) => path.from === "index"));
  requireAuthority(
    usesIndex === (capture.index !== null),
    "source and index identity disagree",
  );
  requireAuthority(
    capture.objectFormat !== null ||
      ((source.kind === "area" || source.kind === "paths") &&
        capture.index === null),
    "Git-backed source requires an object format",
  );
  return capture.index;
}

/**
 * Validate every retained field and its fingerprint without recapturing mutable source state.
 * @param value - authority object from a saved snapshot; invalid metadata throws
 * @returns the validated frozen authority, usable even after the workspace changes
 */
export function parseRetainedReviewAuthority(
  value: JsonValue | undefined,
): ReviewAuthoritySnapshot {
  const capture = record(value, "capture authority");
  exactKeys(capture, [
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
    capture.schema === "goat-review-authority/v1",
    "invalid authority schema",
  );
  requireAuthority(
    capture.objectFormat === null ||
      capture.objectFormat === "sha1" ||
      capture.objectFormat === "sha256",
    "invalid object format",
  );
  const source = record(capture.source, "resolved source");
  resolvedSource(source, capture.objectFormat);
  const index = retainedIndex(capture, source);
  requireAuthority(
    capture.workspace === null ||
      (typeof capture.workspace === "string" &&
        /^workspace-v1:sha256:[a-f0-9]{64}$/u.test(capture.workspace)),
    "invalid execution workspace identity",
  );
  const inventory = retainedInventory(
    capture.inventory,
    source,
    capture.objectFormat,
  );
  const renames = retainedRenames(capture.renames, inventory);
  const { fingerprint, ...unsigned } = capture;
  requireAuthority(
    typeof fingerprint === "string" &&
      fingerprint === taggedHash("authority", unsigned),
    "authority fingerprint does not match its frozen record",
  );
  return {
    schema: capture.schema,
    objectFormat: capture.objectFormat,
    source,
    index,
    inventory,
    renames,
    workspace: capture.workspace,
    fingerprint,
  };
}
