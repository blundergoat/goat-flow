/**
 * Resolve a review's cited evidence against its original selected bytes.
 * Use these readers for literal Git, index, and live paths and for validating finding anchors.
 *
 * Paths and file kinds stay within the reviewed project; unavailable or changed evidence produces a repairable violation.
 * Raw reads avoid filters and Git writes, while the supplied authority checks drift before and after anchor lookup.
 */
import { execFileSync } from "node:child_process";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { join } from "node:path";
import {
  canonicalReviewJson,
  parseReviewJson,
  ReviewAuthorityError,
  requireAuthority,
  textField,
  projectPath,
  rawHash,
  taggedHash,
  comparePaths,
  type JsonValue,
  type GitContext,
  type IndexEntry,
  type FileState,
  type FileMode,
} from "./review-validate-common.js";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { FINDING_SECTIONS } from "./review-validate-common.js";
import {
  FINDING_CANDIDATE,
  FINDING_PREFIX,
  EVIDENCE_TAG,
  PROOF_TAG,
  HARM_TAG,
  ANCHOR,
  addViolation,
  type ReviewValidationViolation,
  type LocatedLine,
  type FindingDefinition,
  type FindingAction,
  type FindingSeverity,
  type ReviewAnchorAuthority,
} from "./review-validate-common.js";

/**
 * Return whether a resolved path remains under the reviewed project's real path.
 *
 * @param projectRoot - reviewed project root; anchors are confined to it so a report cannot cite files it was never authorised to read
 * @param candidatePath - path an anchor points at; anything resolving outside the reviewed project is refused rather than followed
 * @returns true when the path stays inside the reviewed project; false means the anchor is refused rather than resolved
 */
export function isWithinProject(
  projectRoot: string,
  candidatePath: string,
): boolean {
  const pathFromRoot = relative(projectRoot, candidatePath);
  return (
    pathFromRoot !== ".." &&
    !pathFromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromRoot)
  );
}

/**
 * Resolve a finding's literal evidence from its frozen source before the report can credit it.
 *
 * @param projectRoot - reviewed root used to reject paths outside the selected project
 * @param authority - captured source and reader; invalid means an earlier scope issue already blocks evidence
 * @param filePath - literal selected path; an absent side cannot provide finding evidence
 *
 * @param searchText - nonempty literal the reviewer expects in the selected bytes
 * @param line - visible report line where an unresolved anchor is reported
 * @param violations - appended evidence failures, preserving the repair list
 *
 * @param side - optional old/new selection; omitted uses new, or old for a deleted file
 */
export function validateAnchor(
  projectRoot: string,
  authority: ReviewAnchorAuthority,
  filePath: string,
  searchText: string,
  line: number,
  violations: ReviewValidationViolation[],
  side?: "old" | "new",
): void {
  const lexicalProjectRoot = resolve(projectRoot);
  const candidatePath = resolve(lexicalProjectRoot, filePath);
  // An anchor outside the selected project would cite evidence the review did not cover.
  if (!isWithinProject(lexicalProjectRoot, candidatePath)) {
    addViolation(
      violations,
      "anchor-outside-project",
      line,
      `anchor path escapes the reviewed project: ${filePath}`,
    );
    return;
  }

  // The scope violation already explains why no byte authority is available.
  if (authority.kind === "invalid") return;

  try {
    const bytes = authority.readAnchor(filePath, side);
    // A finding is evidence only when its nonempty literal occurs in the selected raw bytes.
    if (
      searchText.length === 0 ||
      !bytes.includes(Buffer.from(searchText, "utf8"))
    ) {
      addViolation(
        violations,
        "anchor-unresolved",
        line,
        `search text not found on the selected side of ${filePath}: ${searchText}`,
      );
    }
  } catch (error) {
    // An editor save, deleted file, or unavailable object stops evidence lookup instead of falling back to the checkout.
    const code =
      error instanceof ReviewAuthorityError ? error.code : "anchor-unresolved";
    addViolation(
      violations,
      code === "authority-path" ? "anchor-outside-project" : code,
      line,
      error instanceof ReviewAuthorityError
        ? error.message
        : "cannot read selected anchor bytes",
    );
  }
}

/**
 * Validate Evidence, Proof, and severity-dependent Harm fields.
 *
 * @param text - raw line text exactly as the author wrote it
 * @param severity - declared finding severity, which decides whether it can block the ship verdict
 * @param line - visible report line where the reviewer can repair the finding's evidence fields
 *
 * @param violations - shared violation list, appended in report order so a reader sees issues top-down; a violation makes the report fail
 */
function validateFindingFields(
  text: string,
  severity: string,
  line: number,
  violations: ReviewValidationViolation[],
): void {
  // Findings need an evidence certainty tag before readers can distinguish observation from inference.
  if (!EVIDENCE_TAG.test(text)) {
    addViolation(
      violations,
      "finding-evidence",
      line,
      "finding is missing Evidence: OBSERVED or Evidence: INFERRED",
    );
  }
  // Findings need the verification method that supports their evidence claim.
  if (!PROOF_TAG.test(text)) {
    addViolation(
      violations,
      "finding-proof",
      line,
      "finding is missing a supported Proof: class",
    );
  }
  const needsHarm = severity === "MUST" || severity === "SHOULD";
  // A MUST or SHOULD finding needs concrete harm to justify its requested action.
  if (needsHarm && !HARM_TAG.test(text)) {
    addViolation(
      violations,
      "finding-harm",
      line,
      "MUST and SHOULD findings require a non-empty Harm: segment",
    );
  }
}

/**
 * Validate every literal semantic anchor carried by one finding.
 *
 * @param locatedLine - one report line with its number, so a violation can point at it
 * @param projectRoot - reviewed project root; anchors are confined to it so a report cannot cite files it was never authorised to read
 * @param authority - frozen Git/index/live selection and its reader; invalid means an earlier scope failure prevents evidence credit
 *
 * @param violations - shared violation list, appended in report order so a reader sees issues top-down; a violation makes the report fail
 */
function validateFindingAnchors(
  locatedLine: LocatedLine,
  projectRoot: string,
  authority: ReviewAnchorAuthority,
  violations: ReviewValidationViolation[],
): void {
  const anchors = [...locatedLine.text.matchAll(ANCHOR)];
  // A finding without either supported anchor form gives the reader no file evidence to inspect.
  if (anchors.length === 0 && !/\banchor=/u.test(locatedLine.text)) {
    addViolation(
      violations,
      "anchor-format",
      locatedLine.line,
      "finding requires at least one `path` (search: `literal`) anchor",
    );
    return;
  }
  // Each cited file must resolve; one valid anchor cannot compensate for another missing one.
  for (const anchor of anchors) {
    const filePath = anchor[1];
    const searchText = anchor[2] ?? anchor[3];
    // Incomplete anchor captures cannot supply a literal file and search value.
    if (filePath === undefined || searchText === undefined) continue;
    validateAnchor(
      projectRoot,
      authority,
      filePath,
      searchText,
      locatedLine.line,
      violations,
    );
  }
}

/**
 * Check escaped evidence in visible report prose, including findings and risk summaries.
 *
 * @param lines - visible report lines; receipt metadata and ordinary anchor literals cannot introduce another anchor
 * @param projectRoot - selected root that bounds every evidence path
 * @param authority - frozen source reader; invalid authority cannot provide evidence
 *
 * @param violations - malformed or unresolved anchors appended for the reviewer to repair
 */
export function validateEscapedReviewAnchors(
  lines: string[],
  projectRoot: string,
  authority: ReviewAnchorAuthority,
  violations: ReviewValidationViolation[],
): void {
  // Authority JSON contains source text as data; only report prose can introduce a semantic anchor.
  for (const [index, text] of lines.entries()) {
    // Receipt metadata lists paths as data; a filename containing anchor= cannot introduce finding evidence.
    if (
      /^\s*(?:-\s+)?(?:Authority snapshot|Gate authority|Files opened in Pass 2):/u.test(
        text,
      )
    )
      continue;
    const prose = text.replace(ANCHOR, (anchor) => " ".repeat(anchor.length));
    const candidates = /\banchor=/gu;
    let candidate: RegExpExecArray | null;
    // Ordinary anchors have already been checked; only markers outside their literal path/search text introduce escaped evidence.
    while ((candidate = candidates.exec(prose)) !== null) {
      const start = candidate.index + candidate[0].length;
      const json = text
        .slice(start)
        .match(/^\{(?:[^"{}]|"(?:[^"\\]|\\.)*")*\}/u)?.[0];
      // Malformed escaped evidence cannot be silently skipped beside an otherwise valid finding.
      if (!json) {
        addViolation(
          violations,
          "anchor-format",
          index + 1,
          "anchor= requires one canonical JSON object with path, search, and side",
        );
        break;
      }
      candidates.lastIndex = start + json.length;
      validateEscapedAnchor(
        json,
        projectRoot,
        authority,
        index + 1,
        violations,
      );
    }
  }
}

/** Parse one escaped literal without letting quotes, pipes, tabs, or newlines change the selected file. */
function validateEscapedAnchor(
  json: string,
  projectRoot: string,
  authority: ReviewAnchorAuthority,
  line: number,
  violations: ReviewValidationViolation[],
): void {
  try {
    const anchor = parseReviewJson(json, true);
    const isRecord =
      anchor !== null && typeof anchor === "object" && !Array.isArray(anchor);
    // Exactly three string fields keep malformed candidates from being silently ignored beside a valid anchor.
    if (
      !isRecord ||
      Object.keys(anchor).sort().join(",") !== "path,search,side"
    )
      throw new Error("fields");
    const { path, search, side } = anchor;
    // Empty search text or an unknown side cannot identify evidence in the selected file state.
    if (
      typeof path !== "string" ||
      typeof search !== "string" ||
      search.length === 0 ||
      !new Set<unknown>(["old", "new"]).has(side)
    )
      throw new Error("values");
    validateAnchor(
      projectRoot,
      authority,
      path,
      search,
      line,
      violations,
      side as "old" | "new",
    );
  } catch {
    // A copied filename containing quotes needs producer-compatible JSON escaping before a reader can follow the evidence.
    addViolation(
      violations,
      "anchor-format",
      line,
      "escaped anchor must use canonical JSON with nonempty path/search and side old or new",
    );
  }
}

/** Read the bounded evidence tag already checked by finding-field validation. */
function readFindingEvidence(text: string): FindingDefinition["evidence"] {
  const evidence = text.match(EVIDENCE_TAG)?.[1];
  // Observed evidence contributes to the report's independently checked observation total.
  if (evidence === "OBSERVED") return evidence;
  // Inferred evidence remains separate so it cannot inflate observed certainty.
  if (evidence === "INFERRED") return evidence;
  return null;
}

/**
 * Read one finding and check its evidence before it contributes to the report's totals.
 *
 * @param locatedLine - visible report line used to locate any repairable issue
 * @param section - containing finding-section name; it determines where the definition is recorded
 * @param isAreaAudit - true permits pre-existing findings that are outside a specific diff
 *
 * @param projectRoot - reviewed root used to confine cited evidence
 * @param authority - original source reader; invalid means an earlier scope check already blocks evidence
 * @param violations - appended finding grammar and evidence failures
 *
 * @returns the parsed finding, or null when the line is ordinary prose or lacks a valid finding label
 */
export function validateFindingLine(
  locatedLine: LocatedLine,
  section: (typeof FINDING_SECTIONS)[number],
  isAreaAudit: boolean,
  projectRoot: string,
  authority: ReviewAnchorAuthority,
  violations: ReviewValidationViolation[],
): FindingDefinition | null {
  // Ordinary report prose does not define a finding or consume an R-ID.
  if (!FINDING_CANDIDATE.test(locatedLine.text)) return null;
  const prefixMatch = locatedLine.text.match(FINDING_PREFIX);
  // Malformed finding labels cannot establish severity, action, or stable reference identity.
  if (!prefixMatch) {
    addViolation(
      violations,
      "finding-grammar",
      locatedLine.line,
      "finding must use R-NNN, a supported severity/action, optional current provenance/refuter tags, and a bold title",
    );
    return null;
  }

  // A diff finding must relate to the selected change; pre-existing findings are reserved for an area audit.
  if (prefixMatch[3] === "pre-existing" && !isAreaAudit) {
    addViolation(
      violations,
      "finding-action-scope",
      locatedLine.line,
      "the pre-existing action is permitted only when Scope snapshot declares source=area",
    );
  }

  validateFindingFields(
    locatedLine.text,
    prefixMatch[2] ?? "",
    locatedLine.line,
    violations,
  );
  validateFindingAnchors(locatedLine, projectRoot, authority, violations);
  return {
    action: (prefixMatch[3] ?? "patch") as FindingAction,
    evidence: readFindingEvidence(locatedLine.text),
    id: prefixMatch[1] ?? "",
    line: locatedLine.line,
    section,
    severity: (prefixMatch[2] ?? "MAY") as FindingSeverity,
  };
}

/**
 * Read local Git metadata without optional writes, replacements, execution helpers, or lazy fetching.
 *
 * @param root - selected project's real root; inherited Git location overrides cannot select a different project
 * @param args - fixed read command and literal arguments chosen by the authority reader
 * @param input - transient command input; absent means no stdin payload
 *
 * @returns raw Git output, including NUL-delimited paths where requested
 * @throws ReviewAuthorityError when local metadata or objects are unavailable; Git diagnostics are not exposed
 */
export function readGit(
  root: string,
  args: string[],
  input?: Buffer | string,
): Buffer {
  // A caller's alternate index or Git directory must not substitute another project for the selected root.
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^GIT_(?:DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|CONFIG|CONFIG_PARAMETERS|CONFIG_COUNT|CONFIG_KEY_\d+|CONFIG_VALUE_\d+)$/u.test(
          key,
        ),
    ),
  );
  try {
    return execFileSync(
      "git",
      [
        "--no-optional-locks",
        "--no-replace-objects",
        "--literal-pathspecs",
        "-C",
        root,
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.untrackedCache=false",
        ...args,
      ],
      {
        input,
        maxBuffer: 128 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...environment,
          GIT_OPTIONAL_LOCKS: "0",
          GIT_NO_LAZY_FETCH: "1",
          GIT_TERMINAL_PROMPT: "0",
        },
      },
    );
  } catch {
    // A removed branch or unavailable object leaves the review without its selected source; Git diagnostics may contain file content.
    throw new ReviewAuthorityError(
      "authority-object",
      `cannot read local Git ${args[0]} metadata for the selected review`,
    );
  }
}

/**
 * Read literal NUL-delimited paths without letting whitespace split one selected file into several.
 *
 * @param bytes - raw Git output; empty means there are no entries
 * @returns complete UTF-8 records with the final delimiter removed
 * @throws ReviewAuthorityError when output is unterminated or a path cannot round-trip as UTF-8
 */
export function nulRecords(bytes: Buffer): string[] {
  const text = bytes.toString("utf8");
  requireAuthority(
    Buffer.from(text).equals(bytes),
    "Git paths are not round-trip UTF-8",
    "authority-path",
  );
  requireAuthority(
    text === "" || text.endsWith("\0"),
    "Git path output is not NUL terminated",
    "authority-object",
  );
  return text === "" ? [] : text.slice(0, -1).split("\0");
}

/**
 * Bind metadata reads to the exact reviewed root, including a standalone folder outside Git.
 *
 * @param projectRoot - operator-selected project; a subfolder cannot silently borrow its parent repository
 * @returns transient read context; null objectFormat means only supported non-Git sources can be selected
 * @throws ReviewAuthorityError when the root is not the repository root or its object format is unsupported
 */
export function gitContext(projectRoot: string): GitContext {
  const root = realpathSync(projectRoot);
  let topLevel: string;
  try {
    // Remove only Git's record terminator; trailing whitespace belongs to the selected project's directory name.
    topLevel = readGit(root, ["rev-parse", "--show-toplevel"])
      .toString()
      .replace(/\n$/u, "");
  } catch {
    // A standalone folder can still be reviewed through explicit live paths or an area selection.
    return { root, objectFormat: null, blobs: new Map() };
  }
  requireAuthority(
    realpathSync(topLevel) === root,
    "selected project must be the repository root",
    "authority-path",
  );
  const objectFormat = readGit(root, ["rev-parse", "--show-object-format"])
    .toString()
    .trim();
  requireAuthority(
    objectFormat === "sha1" || objectFormat === "sha256",
    "unsupported Git object format",
    "authority-unsupported",
  );
  return { root, objectFormat, blobs: new Map() };
}

/**
 * Validate a full object ID against the selected repository's hash format.
 *
 * @param context - local repository format established for this capture
 * @param value - resolved full object ID; abbreviations and non-Git contexts cannot provide this authority
 * @returns the unchanged complete object ID
 *
 * @throws ReviewAuthorityError when the ID length or spelling does not match the repository
 */
export function objectId(context: GitContext, value: string): string {
  requireAuthority(
    context.objectFormat !== null,
    "this source requires a local Git repository",
    "authority-object",
  );
  const length = context.objectFormat === "sha1" ? 40 : 64;
  requireAuthority(
    new RegExp(`^[0-9a-f]{${length}}$`, "u").test(value),
    "invalid Git object identifier",
    "authority-object",
  );
  return value;
}

/**
 * Resolve the operator's selector to a commit; a tree or missing endpoint cannot become a review head.
 *
 * @param context - selected repository and its object format
 * @param selector - named revision; absent or empty means the review did not identify an endpoint
 * @returns the full resolved commit ID used throughout the frozen review
 *
 * @throws ReviewAuthorityError when the selector is missing, invalid, or unavailable locally
 */
export function commitId(
  context: GitContext,
  selector: JsonValue | undefined,
): string {
  const requested = textField(selector, "commit selector");
  return objectId(
    context,
    readGit(context.root, [
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${requested}^{commit}`,
    ])
      .toString()
      .trim(),
  );
}

/**
 * Resolve a comparison base, allowing an empty old side only before a repository's first commit.
 *
 * @param context - selected local repository
 * @param selector - explicit base; only HEAD on an unborn symbolic branch may resolve to null
 * @returns the base commit, or null when there is no first commit to compare against
 *
 * @throws ReviewAuthorityError when an existing or mistyped reference cannot be resolved
 */
export function baseCommit(
  context: GitContext,
  selector: JsonValue | undefined,
): string | null {
  try {
    return commitId(context, selector);
  } catch (error) {
    // A new repository has no first commit yet; a typo or a broken existing reference must still fail.
    if (selector !== "HEAD") throw error;
    const headReference = readGit(context.root, ["symbolic-ref", "-q", "HEAD"])
      .toString()
      .trim();
    const references = readGit(context.root, [
      "for-each-ref",
      "--format=%(refname)",
    ])
      .toString()
      .split("\n");
    requireAuthority(
      headReference.startsWith("refs/heads/") &&
        !references.includes(headReference),
      "HEAD is not an unborn branch",
      "authority-object",
    );
    return null;
  }
}

/**
 * Load raw blobs in one local read and cache them for this capture.
 *
 * @param context - selected repository; only its transient blob cache is changed
 * @param identifiers - required blob IDs; an empty or already cached set needs no Git call
 * @throws ReviewAuthorityError when a selected blob or its length-delimited response is unavailable
 */
export function loadBlobs(context: GitContext, identifiers: string[]): void {
  const missing = [...new Set(identifiers)].filter(
    (identifier) => !context.blobs.has(identifier),
  );
  // Reused old/new blobs already have the same immutable bytes in this capture.
  if (missing.length === 0) return;
  const output = readGit(
    context.root,
    ["cat-file", "--batch"],
    `${missing.join("\n")}\n`,
  );
  let offset = 0;
  // Each length-delimited blob keeps embedded newlines and NUL bytes out of Git's response grammar.
  for (const identifier of missing) {
    const end = output.indexOf(10, offset);
    const header = output
      .subarray(offset, end)
      .toString()
      .match(/^([0-9a-f]+) blob (\d+)$/u);
    requireAuthority(
      end >= offset && header?.[1] === identifier,
      "selected Git blob is unavailable",
      "authority-object",
    );
    const size = Number(header[2]);
    requireAuthority(
      Number.isSafeInteger(size) &&
        size >= 0 &&
        end + size + 1 < output.length &&
        output[end + size + 1] === 10,
      "invalid Git blob length",
      "authority-object",
    );
    context.blobs.set(identifier, output.subarray(end + 1, end + size + 1));
    offset = end + size + 2;
  }
  requireAuthority(
    offset === output.length,
    "unexpected Git blob response",
    "authority-object",
  );
}

/** Require a regular-file mode; symlinks, submodules, and sparse directory entries need another review mechanism. */
function fileMode(mode: string): FileMode {
  requireAuthority(
    mode === "100644" || mode === "100755",
    `unsupported selected file mode: ${mode}`,
    "authority-unsupported",
  );
  return mode;
}

/**
 * Bind immutable tree files to literal paths, regular-file modes, and raw blob hashes.
 *
 * @param context - selected repository and transient blob cache
 * @param revision - selected commit; null records an empty old side for a root commit or unborn branch
 * @param selectedPaths - optional exact path filter; absent selects the whole tree, while empty selects no files
 *
 * @returns selected tree files; an absent path has no map entry and is retained later as an absent inventory member
 * @throws ReviewAuthorityError when a selected tree entry or its raw blob cannot supply supported file evidence
 */
export function treeFiles(
  context: GitContext,
  revision: string | null,
  selectedPaths?: Set<string>,
): Map<string, FileState> {
  // An unborn branch or root commit has an explicitly empty old side.
  if (revision === null) return new Map();
  const entries = nulRecords(
    readGit(context.root, ["ls-tree", "-r", "-z", "--full-tree", revision]),
  ).flatMap((entry) => {
    const match = entry.match(/^(\d+) (\S+) ([0-9a-f]+)\t([\s\S]+)$/u);
    requireAuthority(
      match,
      "invalid selected Git tree record",
      "authority-object",
    );
    const path = projectPath(match[4]);
    // Explicit file reviews need no byte authority for an unrelated symlink or submodule elsewhere in the tree.
    if (selectedPaths && !selectedPaths.has(path)) return [];
    requireAuthority(
      match[2] === "blob",
      "selected tree contains an unsupported entry",
      "authority-unsupported",
    );
    return [
      { path, mode: fileMode(match[1]!), blob: objectId(context, match[3]!) },
    ];
  });
  loadBlobs(
    context,
    entries.map((entry) => entry.blob),
  );
  return new Map(
    entries.map((entry) => [
      entry.path,
      {
        kind: "file",
        from: "git",
        mode: entry.mode,
        blob: entry.blob,
        revision,
        sha256: rawHash(context.blobs.get(entry.blob)!),
      },
    ]),
  );
}

/**
 * Capture stage-zero paths and semantic index flags without refreshing or writing the index.
 *
 * @param context - selected repository; a previously read index is reused only within this capture
 * @returns sorted staged entries; an empty index is a valid empty selection
 * @throws ReviewAuthorityError when the index is unmerged, sparse, intent-to-add, malformed, or contains unsupported file kinds
 */
export function indexEntries(context: GitContext): IndexEntry[] {
  // A capture shares one index read; later checkpoints create a fresh context to detect changes.
  if (context.index) return context.index;
  requireAuthority(
    context.objectFormat !== null,
    "index selection requires Git",
    "authority-object",
  );
  const output = readGit(context.root, [
    "ls-files",
    "--stage",
    "--debug",
    "--sparse",
    "-z",
  ]);
  let offset = 0;
  const entries: IndexEntry[] = [];
  // Read every semantic index entry so one hidden flag or unresolved stage cannot be omitted from its fingerprint.
  while (offset < output.length) {
    const end = output.indexOf(0, offset);
    requireAuthority(
      end >= offset,
      "unreadable index path record",
      "authority-object",
    );
    const [entry = ""] = nulRecords(output.subarray(offset, end + 1));
    const match = entry.match(/^(\d+) ([0-9a-f]+) (\d)\t([\s\S]+)$/u);
    // Bound each decode so a large staged review does not repeatedly copy the remaining index.
    const nextPathEnd = output.indexOf(0, end + 1);
    const details = output
      .subarray(end + 1, nextPathEnd < 0 ? output.length : nextPathEnd)
      .toString()
      .match(
        /^  ctime: [^\n]*\n  mtime: [^\n]*\n  dev: [^\n]*\n  uid: [^\n]*\n  size: [^\n]*\tflags: ([0-9a-f]+)\n/u,
      );
    requireAuthority(
      match && details,
      "unsupported Git index debug format",
      "authority-unsupported",
    );
    const flags = Number.parseInt(details[1]!, 16);
    const stage = Number(match[3]);
    const intentToAdd = (flags & 0x20000000) !== 0;
    const skipWorktree = (flags & 0x40000000) !== 0;
    requireAuthority(
      stage === 0 && !intentToAdd && !skipWorktree,
      "unmerged, intent-to-add, or sparse index cannot supply review authority",
      "authority-unsupported",
    );
    entries.push({
      path: projectPath(match[4]),
      mode: fileMode(match[1]!),
      blob: objectId(context, match[2]!),
      stage,
      intentToAdd,
      skipWorktree,
      assumeUnchanged: (flags & 0x8000) !== 0,
    });
    offset = end + 1 + Buffer.byteLength(details[0]);
  }
  entries.sort((left, right) => comparePaths(left.path, right.path));
  requireAuthority(
    new Set(entries.map((entry) => entry.path)).size === entries.length,
    "duplicate index path",
    "authority-path",
  );
  context.index = entries;
  return entries;
}

/**
 * Bind each staged path to its index blob rather than HEAD or an editor's newer save.
 *
 * @param context - selected repository and captured semantic index
 * @returns staged file states; empty means the index has no files
 * @throws ReviewAuthorityError when an index entry or blob cannot supply supported evidence
 */
export function indexFiles(context: GitContext): Map<string, FileState> {
  const entries = indexEntries(context);
  loadBlobs(
    context,
    entries.map((entry) => entry.blob),
  );
  return new Map(
    entries.map((entry) => [
      entry.path,
      {
        kind: "file",
        from: "index",
        mode: entry.mode,
        blob: entry.blob,
        sha256: rawHash(context.blobs.get(entry.blob)!),
      },
    ]),
  );
}

/**
 * Identify the semantic index while ignoring timestamps and refresh-only metadata.
 *
 * @param context - selected repository whose full index must be captured
 * @returns the index-v1 identity, including an empty index
 */
export function indexFingerprint(context: GitContext): string {
  return taggedHash("index", {
    objectFormat: context.objectFormat,
    entries: indexEntries(context),
  });
}

/**
 * Check every live path boundary before opening the file selected by the reviewer.
 *
 * @param root - selected project's real root
 * @param path - literal project-relative file path; no segment may enter a symlink or nested repository
 * @returns the checked path; a missing segment remains missing so capture can record absence
 *
 * @throws ReviewAuthorityError for unsupported traversal; other filesystem errors stop capture
 */
export function livePath(root: string, path: string): string {
  projectPath(path);
  const parts = path.split("/");
  let current = root;
  // An editor-selected path remains inside this project at every directory boundary.
  for (const part of parts) {
    current = join(current, part);
    try {
      const details = lstatSync(current);
      requireAuthority(
        !details.isSymbolicLink(),
        "live review paths cannot traverse symlinks",
        "authority-unsupported",
      );
      requireAuthority(
        !details.isDirectory() || !existsSync(join(current, ".git")),
        "live review paths cannot enter nested repositories",
        "authority-unsupported",
      );
    } catch (error) {
      // A selected file may have been deleted; its absent state remains part of the review inventory.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return current;
      throw error;
    }
  }
  return current;
}

/**
 * Read one regular live file without following its final symlink.
 *
 * @param root - selected project's real root
 * @param path - literal selected file path; a deleted file is represented by null
 * @returns raw bytes and executable mode, or null when the file is absent
 *
 * @throws ReviewAuthorityError for unsupported paths or kinds; permission and read failures stop capture
 */
export function liveBytes(
  root: string,
  path: string,
): { bytes: Buffer; mode: FileMode } | null {
  const selectedPath = livePath(root, path);
  let descriptor: number;
  try {
    descriptor = openSync(
      selectedPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    // Removing a file in the editor produces an absent member; permission or file-kind failures stop capture.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new ReviewAuthorityError(
      "authority-unsupported",
      `cannot open selected live file: ${canonicalReviewJson(path)}`,
    );
  }
  try {
    const details = fstatSync(descriptor);
    requireAuthority(
      details.isFile(),
      `selected live path is not a regular file: ${canonicalReviewJson(path)}`,
      "authority-unsupported",
    );
    return {
      bytes: readFileSync(descriptor),
      mode: (details.mode & 0o111) === 0 ? "100644" : "100755",
    };
  } finally {
    closeSync(descriptor);
  }
}

/**
 * Freeze a live file's mode and hash across two reads; a saved edit cannot become a fresh baseline.
 *
 * @param root - selected project's real root
 * @param path - literal selected path, retained even when the file is absent
 * @returns matching file metadata, or an explicit absent state when both reads find no file
 *
 * @throws ReviewAuthorityError when the file's bytes or mode change during capture
 */
export function liveState(root: string, path: string): FileState {
  const before = liveBytes(root, path);
  const after = liveBytes(root, path);
  // Both observations use the same absent/file shape so an editor save cannot be hidden by inconsistent metadata.
  const describe = (file: ReturnType<typeof liveBytes>): FileState =>
    file === null
      ? { kind: "absent" }
      : {
          kind: "file",
          from: "live",
          mode: file.mode,
          sha256: rawHash(file.bytes),
        };
  const state = describe(before);
  requireAuthority(
    canonicalReviewJson(state) === canonicalReviewJson(describe(after)),
    "selected live file changed during capture",
    "authority-drift",
  );
  return state;
}

/**
 * Capture every declared live member, retaining deleted paths so removal remains reviewable.
 *
 * @param context - selected project root
 * @param paths - frozen literal membership; empty produces an empty file map
 * @returns each selected file's raw state, including explicit absence
 *
 * @throws ReviewAuthorityError when a selected member changes or cannot be read safely
 */
export function liveFiles(
  context: GitContext,
  paths: string[],
): Map<string, FileState> {
  return new Map(paths.map((path) => [path, liveState(context.root, path)]));
}

/**
 * List nonignored untracked files without refreshing the index or reading their contents.
 *
 * @param context - selected local repository
 * @param excludeNestedRepositories - true lets an area audit omit nested repositories; full execution inventories refuse them
 * @returns paths in stable byte order; empty means no eligible untracked files
 *
 * @throws ReviewAuthorityError when unsupported nested membership would make a full source inventory incomplete
 */
export function untrackedPaths(
  context: GitContext,
  excludeNestedRepositories = false,
): string[] {
  return nulRecords(
    readGit(context.root, ["ls-files", "--others", "--exclude-standard", "-z"]),
  )
    .flatMap((path) => {
      // Git emits a trailing slash for an untracked nested repository; area walks exclude that boundary explicitly.
      if (path.endsWith("/")) {
        const directory = projectPath(path.slice(0, -1));
        requireAuthority(
          excludeNestedRepositories &&
            existsSync(join(context.root, directory, ".git")),
          "untracked nested repository cannot supply a full execution/source inventory",
          "authority-unsupported",
        );
        return [];
      }
      return [projectPath(path)];
    })
    .sort(comparePaths);
}

/**
 * Refuse comparisons whose Git attributes would transform the bytes the reviewer actually sees.
 *
 * @param context - selected local repository whose attributes and config determine conversion
 * @param paths - comparison membership; empty has no content to convert
 * @throws ReviewAuthorityError when filters, encoding, text, or line-ending conversion prevent a raw-byte comparison
 */
export function requireRawComparison(
  context: GitContext,
  paths: string[],
): void {
  // A zero-path source still has endpoint authority, but no content can require a filter.
  if (paths.length === 0) return;
  const attributes = nulRecords(
    readGit(
      context.root,
      [
        "check-attr",
        "-z",
        "--stdin",
        "filter",
        "working-tree-encoding",
        "text",
        "eol",
      ],
      `${paths.join("\0")}\0`,
    ),
  );
  const unsafe = attributes.some(
    (value, index) =>
      index % 3 === 2 && value !== "unspecified" && value !== "unset",
  );
  // Read the effective setting, so an overridden true value cannot block the operator's current raw-byte selection.
  const autocrlf = readGit(context.root, [
    "config",
    "--default",
    "false",
    "--get",
    "core.autocrlf",
  ])
    .toString()
    .trim();
  // Git owns boolean spellings such as yes and on; input is a separate conversion mode and must be refused before boolean parsing.
  requireAuthority(
    !unsafe &&
      autocrlf !== "input" &&
      readGit(context.root, [
        "config",
        "--type=bool",
        "--default",
        "false",
        "--get",
        "core.autocrlf",
      ])
        .toString()
        .trim() === "false",
    "live comparison requires unsupported content conversion; select explicit raw paths",
    "authority-unsupported",
  );
}
