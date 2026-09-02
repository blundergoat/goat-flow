/**
 * Builds and publishes one developer-requested learning-loop scaffold.
 * Use after `learn new` parsing has paired the author's evidence paths and literal search anchors.
 *
 * The writer validates the full prospective bucket, then replaces it beside the original so readers never see partial bytes.
 * Index and stats failures preserve the valid bucket and return one exact recovery command instead of hiding partial state.
 */
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fchmodSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { CLIError } from "./cli-error.js";
import { pathWriteClaimInspectCommand } from "./claims-command.js";
import type { LearnEntryType, LearnEvidenceKind } from "./cli-types.js";
import { loadConfig } from "./config/reader.js";
import { createFS } from "./facts/fs.js";
import {
  findResolvedEntriesHeadingIndex,
  parseFrontmatterFields,
  parseMarkdownFrontmatter,
} from "./facts/shared/learning-loop-common.js";
import {
  extractFootgunFacts,
  extractLearningLoopEntries,
  extractLessonsFacts,
} from "./facts/shared/learning-loop.js";
import { collectFootgunStructureDiagnostics } from "./facts/shared/learning-loop-sections.js";
import { evaluateSearchAnchors } from "./facts/shared/search-anchors.js";
import { generateIndexes } from "./learning-loop-index/generate.js";
import {
  INDEX_BUCKETS,
  parseActiveBucketSections,
  resolveIndexBucketPaths,
  type IndexBucket,
} from "./learning-loop-index/parse-bucket.js";
import {
  acquirePathWriteClaims,
  PathWriteClaimError,
  readPathWriteTargetIdentity,
  releasePathWriteClaims,
  type PathWriteClaimBatch,
} from "./path-write-claim.js";
import { maskNonRenderedMarkdown } from "./rendered-markdown.js";
import { collectIndexFreshness } from "./stats/index-freshness.js";
import {
  BUCKET_SIZE_WARN_BYTES,
  buildDecisionsSection,
  buildStatsReport,
  checkStats,
} from "./stats/stats.js";
import type { ReadonlyFS } from "./types.js";

const RECOVERY_COMMAND = "goat-flow index && goat-flow stats --check";
const SAFE_CATEGORY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const UNSAFE_SINGLE_LINE_CHARACTER =
  /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
const RESOLVED_ENTRIES_HEADING = "## Resolved Entries";

const ENTRY_BUCKET: Record<
  LearnEntryType,
  Exclude<IndexBucket, "decisions">
> = {
  footgun: "footguns",
  lesson: "lessons",
  pattern: "patterns",
};

const ENTRY_HEADING: Record<LearnEntryType, string> = {
  footgun: "Footgun",
  lesson: "Lesson",
  pattern: "Pattern",
};

/** Values passed from the CLI after option placement and pair counts are known to be valid. */
export interface LearnScaffoldRequest {
  projectRoot: string;
  entryType: LearnEntryType;
  category: string;
  title: string;
  evidencePaths: readonly string[];
  searchLiterals: readonly string[];
  evidenceKind: LearnEvidenceKind | null;
  shouldDryRun: boolean;
}

/** Test seams for the clock and the two post-publication stages; normal CLI calls omit every member. */
export interface LearnScaffoldDependencies {
  now?: () => Date;
  beforeBucketReplacement?: () => void;
  regenerateIndexes?: (projectRoot: string) => void;
  verifyStats?: (projectRoot: string) => string | null;
}

/** Result rendered by the CLI after validation; `wasWritten: false` means dry-run left the project unchanged. */
export interface LearnScaffoldResult {
  targetPath: string;
  skeleton: string;
  wasWritten: boolean;
  warnings: readonly string[];
  output: string;
}

/** One inspected bucket destination and the bytes/identity used for the cooperative final recheck. */
interface BucketSnapshot {
  absolutePath: string;
  projectRelativePath: string;
  content: string | null;
  fileStats: Stats | null;
}

/** One author-supplied evidence path and the literal text expected inside it. */
interface EvidenceCitation {
  path: string;
  literal: string;
}

/** Format one native path for terminal output that remains copyable on Windows and POSIX. */
function displayPath(path: string): string {
  return path.split(sep).join("/");
}

/** Return today's UTC calendar date so generated frontmatter and entry metadata agree. */
function formatUtcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Reject a category that could escape its learning-loop directory; throws a usage error before any path is opened. */
function validateCategory(category: string): void {
  // A lowercase kebab-case bucket is one filename; slashes, control characters, absolute paths, and dot segments all fail this single rule.
  if (!SAFE_CATEGORY.test(category)) {
    throw new CLIError(
      "--category must be a lowercase kebab-case bucket name such as verification.",
      2,
    );
  }
}

/** Reject title text that could create another heading; throws a usage error before the developer sees a misleading preview. */
function validateTitle(title: string): string {
  const normalizedTitle = title.trim();
  // Blank input would create an unsearchable heading, while control characters can split or hide what the author sees.
  if (
    normalizedTitle.length === 0 ||
    UNSAFE_SINGLE_LINE_CHARACTER.test(title)
  ) {
    throw new CLIError("--title must be one non-empty, control-free line.", 2);
  }
  // A leading hash would let the author's value inject a second Markdown heading into the bucket.
  if (normalizedTitle.startsWith("#")) {
    throw new CLIError(
      "--title must not begin with a Markdown heading marker.",
      2,
    );
  }
  return normalizedTitle;
}

/** Pair evidence flags in developer order; throws a usage error when a missing or unsafe value prevents a checkable citation. */
function buildEvidenceCitations(
  request: LearnScaffoldRequest,
): EvidenceCitation[] {
  // Unequal lists cannot identify which literal belongs to which file, so direct callers receive the same usage failure as CLI callers.
  if (request.evidencePaths.length !== request.searchLiterals.length) {
    throw new CLIError(
      "Each --evidence <path> requires one paired --search <literal>, in the same order.",
      2,
    );
  }
  // A footgun needs at least one locally checkable anchor before it can become durable project guidance.
  if (request.entryType === "footgun" && request.evidencePaths.length === 0) {
    throw new CLIError(
      "Footgun scaffolds require at least one --evidence/--search pair.",
      2,
    );
  }
  // Each pair is validated before Markdown rendering so punctuation cannot change the citation grammar the developer previewed.
  return request.evidencePaths.map((evidencePath, index) => {
    const searchLiteral = request.searchLiterals[index] ?? "";
    // Evidence paths are project-relative Markdown tokens; backticks, Windows separators, and dot segments would make their destination unclear.
    if (
      evidencePath.length === 0 ||
      UNSAFE_SINGLE_LINE_CHARACTER.test(evidencePath) ||
      evidencePath.includes("`") ||
      evidencePath.includes("\\") ||
      isAbsolute(evidencePath) ||
      evidencePath.split("/").some((part) => part === "." || part === "..")
    ) {
      throw new CLIError(
        `Unsafe evidence path: ${JSON.stringify(evidencePath)}. Use one project-relative POSIX file path.`,
        2,
      );
    }
    // An empty or multiline search value cannot identify one stable literal in the cited file.
    if (
      searchLiteral.length === 0 ||
      UNSAFE_SINGLE_LINE_CHARACTER.test(searchLiteral)
    ) {
      throw new CLIError(
        `Invalid search literal paired with ${evidencePath}; use one non-empty, control-free literal.`,
        2,
      );
    }
    return { path: evidencePath, literal: searchLiteral };
  });
}

/** Enforce the footgun-only evidence taxonomy; throws a usage error when the chosen entry type cannot carry the supplied value. */
function validateEvidenceKind(request: LearnScaffoldRequest): void {
  // Footgun readers need one canonical evidence kind before trusting an architectural warning.
  if (request.entryType === "footgun" && request.evidenceKind === null) {
    throw new CLIError("Footgun scaffolds require --evidence-kind.", 2);
  }
  // Lessons and patterns have no evidence-kind field, so accepting one would create a false schema promise.
  if (request.entryType !== "footgun" && request.evidenceKind !== null) {
    throw new CLIError(
      "--evidence-kind is only valid for footgun scaffolds.",
      2,
    );
  }
}

/** Escape one literal for the shared double-quoted search-anchor grammar. */
function escapeSearchLiteral(literal: string): string {
  return literal.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
}

/** Render author-supplied citations as one canonical evidence line, or no line when evidence is optional and omitted. */
function renderEvidenceLine(
  citations: readonly EvidenceCitation[],
): string | null {
  // A lesson or pattern may start without evidence, so its scaffold omits the field instead of inventing a placeholder citation.
  if (citations.length === 0) return null;
  const renderedCitations = citations.map(
    (citation) =>
      `\`${citation.path}\` (search: "${escapeSearchLiteral(citation.literal)}")`,
  );
  return `**Evidence:** ${renderedCitations.join("; ")}`;
}

/**
 * Build a schema-only entry that contains no invented incident or recommendation prose.
 * Use for both dry-run preview and the exact bytes inserted into the selected bucket.
 *
 * Field order follows the learning-loop READMEs (search: `Then lead with`): the metadata block sits under the heading, the rule comes next, and the
 * incident narrative and its evidence follow. A reader who stops after two lines still leaves with the decision the entry exists to change.
 *
 * @param entryType - developer-selected footgun, lesson, or pattern grammar
 * @param title - validated one-line heading text; never empty
 * @param createdDate - UTC creation date in YYYY-MM-DD form
 * @param citations - verified path/literal pairs; empty is allowed only for lessons and patterns
 * @param evidenceKind - canonical footgun taxonomy, or null when the selected schema has no evidence-kind field
 * @returns Markdown ending in one newline, ready for preview or insertion
 */
export function renderLearnEntrySkeleton(
  entryType: LearnEntryType,
  title: string,
  createdDate: string,
  citations: readonly EvidenceCitation[],
  evidenceKind: LearnEvidenceKind | null,
): string {
  const heading = `## ${ENTRY_HEADING[entryType]}: ${title}`;
  const evidenceLine = renderEvidenceLine(citations);
  let skeletonLines: string[];
  // Footguns expose active status, creation date, and evidence taxonomy together because stats validates that canonical line.
  if (entryType === "footgun") {
    skeletonLines = [
      heading,
      "",
      `**Status:** active | **Created:** ${createdDate} | **Evidence:** ${evidenceKind ?? ""}`,
      "**Decision changed:**",
      "",
      "**Prevention:**",
      "",
      "**Symptoms:**",
    ];
  } else if (entryType === "lesson") {
    // Lessons keep status implicit as active and expose the fields an author fills after describing a real behavioural mistake.
    skeletonLines = [
      heading,
      "",
      `**Created:** ${createdDate}`,
      "**Decision changed:**",
      "",
      "**Prevention:**",
      "",
      "**What happened:**",
      "",
      "**Root cause:**",
    ];
  } else {
    // Patterns start with only the context and reusable approach a future developer needs to decide whether to apply them.
    skeletonLines = [heading, "", "**Context:**", "", "**Approach:**"];
  }
  // Supplied evidence appears last so the author can fill prose without separating each file from its literal anchor.
  if (evidenceLine !== null) skeletonLines.push("", evidenceLine);
  return `${skeletonLines.join("\n")}\n`;
}

/** Require one real project directory; throws a usage error when the selected root is missing, unreadable, redirected, or not a directory. */
function inspectProjectRoot(projectRoot: string): void {
  let projectStats: Stats;
  try {
    projectStats = lstatSync(projectRoot);
  } catch (error) {
    // For example, a developer may pass a project path that was moved or became unreadable before the command started.
    throw new CLIError(
      `Cannot inspect selected project: ${error instanceof Error ? error.message : String(error)}`,
      2,
    );
  }
  // A symlinked or non-directory root makes the real write boundary unclear, so no bucket path is resolved beneath it.
  if (projectStats.isSymbolicLink() || !projectStats.isDirectory()) {
    throw new CLIError(
      "Selected project root must be a real directory, not a symlink.",
      2,
    );
  }
}

/** Read one path identity without following links; returns null for a new bucket and throws a usage error for every other inspection failure. */
function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    // A new category has no bucket file yet, so ENOENT becomes an explicit absent destination rather than a failure.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    // For example, filesystem permissions may let the developer name a path but prevent the CLI from inspecting its identity.
    throw new CLIError(
      `Cannot inspect learning-loop path ${displayPath(path)}: ${error instanceof Error ? error.message : String(error)}`,
      2,
    );
  }
}

/** Inspect every parent; throws a usage error when a missing, linked, or non-directory component makes the write destination unsafe. */
function inspectBucketParents(
  projectRoot: string,
  absoluteBucketPath: string,
): void {
  const parentRelativePath = relative(projectRoot, dirname(absoluteBucketPath));
  let currentPath = projectRoot;
  // Each parent component is checked in order because a redirected learning-loop directory would move the write outside the selected project.
  for (const pathPart of parentRelativePath.split(sep)) {
    // The project root has already been checked; an empty relative component adds no child directory to inspect.
    if (pathPart.length === 0 || pathPart === ".") continue;
    currentPath = join(currentPath, pathPart);
    const parentStats = lstatOrNull(currentPath);
    // The command scaffolds bucket files, not directory trees, so a missing parent tells the developer to install or create the harness first.
    if (parentStats === null) {
      throw new CLIError(
        `Learning-loop directory is missing: ${displayPath(relative(projectRoot, currentPath))}`,
        2,
      );
    }
    // A symlink or non-directory parent can redirect or block the requested bucket write.
    if (parentStats.isSymbolicLink() || !parentStats.isDirectory()) {
      throw new CLIError(
        `Learning-loop parent must be a real directory: ${displayPath(relative(projectRoot, currentPath))}`,
        2,
      );
    }
  }
}

/** Return whether a configured bucket path would escape the selected project and write somewhere the developer did not choose. */
function resolvesOutsideProject(projectRelativePath: string): boolean {
  return (
    projectRelativePath === ".." ||
    projectRelativePath.startsWith(`..${sep}`) ||
    isAbsolute(projectRelativePath)
  );
}

/** Resolve and snapshot one category bucket; throws a usage error when containment, link identity, or readable-file checks fail. */
function inspectBucketDestination(
  projectRoot: string,
  bucketDirectory: string,
  category: string,
): BucketSnapshot {
  const absoluteProjectRoot = resolve(projectRoot);
  const absoluteBucketPath = resolve(
    absoluteProjectRoot,
    bucketDirectory,
    `${category}.md`,
  );
  const projectRelativePath = relative(absoluteProjectRoot, absoluteBucketPath);
  inspectProjectRoot(absoluteProjectRoot);
  // The configured path must remain inside the selected project even if a future config source relaxes today's canonical path rules.
  if (resolvesOutsideProject(projectRelativePath)) {
    throw new CLIError(
      "Configured learning-loop bucket resolves outside the selected project.",
      2,
    );
  }
  inspectBucketParents(absoluteProjectRoot, absoluteBucketPath);
  const fileStats = lstatOrNull(absoluteBucketPath);
  // Existing buckets must have one stable regular-file identity before an adjacent replacement can preserve their mode safely.
  if (
    fileStats !== null &&
    (fileStats.isSymbolicLink() || !fileStats.isFile() || fileStats.nlink !== 1)
  ) {
    throw new CLIError(
      "Learning-loop bucket destination must be a single-link regular file, not a symlink or hard link.",
      2,
    );
  }
  let content: string | null = null;
  // A new category has no bytes to preserve; an existing one is read exactly once for prospective generation and the final cooperative recheck.
  if (fileStats !== null) {
    try {
      content = readFileSync(absoluteBucketPath, "utf-8");
    } catch (error) {
      // For example, an editor or permission change may make an existing bucket unreadable after its identity was inspected.
      throw new CLIError(
        `Cannot read learning-loop bucket: ${error instanceof Error ? error.message : String(error)}`,
        2,
      );
    }
  }
  return {
    absolutePath: absoluteBucketPath,
    projectRelativePath: displayPath(projectRelativePath),
    content,
    fileStats,
  };
}

/** Create canonical frontmatter for a category whose bucket file does not exist yet. */
function newBucketFrontmatter(category: string, reviewDate: string): string {
  return `---\ncategory: ${category}\nlast_reviewed: ${reviewDate}\n---\n\n`;
}

/** Return an existing bucket with only its review date changed and no filesystem writes; malformed or mismatched frontmatter throws a usage error. */
function renderRefreshedFrontmatter(
  content: string,
  category: string,
  reviewDate: string,
  targetPath: string,
): string {
  const frontmatterMatch = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(
    content,
  );
  // Existing category buckets need canonical frontmatter before the scaffold can make their stats state trustworthy.
  if (frontmatterMatch === null) {
    throw new CLIError(`${targetPath}: missing leading YAML frontmatter.`, 2);
  }
  const frontmatterBody = frontmatterMatch[1] ?? "";
  const categoryLines =
    frontmatterBody.match(/^category:\s*(.*?)\s*$/gmu) ?? [];
  const reviewLines =
    frontmatterBody.match(/^last_reviewed:\s*(.*?)\s*$/gmu) ?? [];
  // Duplicate or absent fields are ambiguous, so the author must repair the bucket rather than let scaffolding guess which value owns it.
  if (categoryLines.length !== 1 || reviewLines.length !== 1) {
    throw new CLIError(
      `${targetPath}: frontmatter must contain exactly one category and one last_reviewed field.`,
      2,
    );
  }
  const declaredCategory = categoryLines[0]
    .replace(/^category:\s*/u, "")
    .trim();
  // A filename and frontmatter disagreement makes category routing unreliable for readers and generated indexes.
  if (declaredCategory !== category) {
    throw new CLIError(
      `${targetPath}: frontmatter category must equal ${category}.`,
      2,
    );
  }
  const refreshedFrontmatter = frontmatterMatch[0].replace(
    /^last_reviewed:\s*.*$/mu,
    `last_reviewed: ${reviewDate}`,
  );
  return `${refreshedFrontmatter}${content.slice(frontmatterMatch[0].length)}`;
}

/** Insert the new active entry before resolved history without rewriting any existing entry bytes. */
function insertActiveEntry(content: string, skeleton: string): string {
  const resolvedHeadingIndex = findResolvedEntriesHeadingIndex(content);
  // Buckets with resolved history receive the new active entry immediately before that boundary.
  if (resolvedHeadingIndex >= 0) {
    const activeContent = content.slice(0, resolvedHeadingIndex);
    const resolvedContent = content.slice(resolvedHeadingIndex);
    const separator = activeContent.endsWith("\n\n")
      ? ""
      : activeContent.endsWith("\n")
        ? "\n"
        : "\n\n";
    return `${activeContent}${separator}${skeleton}\n${resolvedContent}`;
  }
  const separator = content.endsWith("\n\n")
    ? ""
    : content.endsWith("\n")
      ? "\n"
      : "\n\n";
  return `${content}${separator}${skeleton}`;
}

/** Provide the shared bucket parser with one prospective file and no unrelated directory content. */
function prospectiveBucketFS(
  bucketDirectory: string,
  targetPath: string,
  prospectiveContent: string,
): ReadonlyFS {
  const normalizedDirectory = bucketDirectory.replace(/\/$/u, "");
  const targetFilename = basename(targetPath);
  const normalizedTargetPath = `${normalizedDirectory}/${targetFilename}`;
  return {
    exists: (path) =>
      path.replace(/\/$/u, "") === normalizedDirectory ||
      path === normalizedTargetPath,
    readFile: (path) =>
      path === normalizedTargetPath ? prospectiveContent : null,
    lineCount: (path) =>
      path === normalizedTargetPath ? prospectiveContent.split("\n").length : 0,
    readJson: () => null,
    isReadableDirectory: (path) =>
      path.replace(/\/$/u, "") === normalizedDirectory,
    listDir: (path) =>
      path.replace(/\/$/u, "") === normalizedDirectory ? [targetFilename] : [],
    isExecutable: () => false,
    glob: () => [],
    existsGlob: () => false,
  };
}

/** Confirm the prospective bucket parses as one active entry; throws before publication when shared index/stats grammar disagrees. */
function validateProspectiveBucket(
  entryType: LearnEntryType,
  bucketDirectory: string,
  targetPath: string,
  prospectiveContent: string,
  expectedHeading: string,
): void {
  const normalizedContent = prospectiveContent.replace(/\r\n/gu, "\n");
  const { frontmatter } = parseMarkdownFrontmatter(normalizedContent);
  // The shared parser returning no frontmatter means stats would reject the bucket after publication.
  if (frontmatter === null) {
    throw new CLIError(
      `${targetPath}: prospective bucket has invalid frontmatter.`,
      2,
    );
  }
  const frontmatterFields = parseFrontmatterFields(frontmatter);
  // Both routing and freshness fields must survive generation before the write can proceed.
  if (!frontmatterFields.category || !frontmatterFields.last_reviewed) {
    throw new CLIError(
      `${targetPath}: prospective bucket is missing category or last_reviewed frontmatter.`,
      2,
    );
  }
  // Footguns have extra status, evidence-label, and active/resolved placement checks used by stats.
  if (entryType === "footgun") {
    const diagnostics = collectFootgunStructureDiagnostics(
      targetPath,
      normalizedContent,
    );
    // Any diagnostic would make the post-write stats check disagree with the authoring preview.
    if (diagnostics.length > 0) {
      throw new CLIError(diagnostics.join("; "), 2);
    }
  }
  const bucketKind = ENTRY_BUCKET[entryType];
  const prospectiveFS = prospectiveBucketFS(
    bucketDirectory,
    targetPath,
    normalizedContent,
  );
  const matchingSections = parseActiveBucketSections(
    prospectiveFS,
    bucketDirectory,
    bucketKind,
  ).filter((section) => section.heading === expectedHeading);
  // Exactly one active match proves the heading is reachable above resolved history rather than duplicated or silently filtered out.
  if (matchingSections.length !== 1) {
    throw new CLIError(
      `${targetPath}: prospective entry must appear exactly once above ${RESOLVED_ENTRIES_HEADING}.`,
      2,
    );
  }
}

/** Verify every rendered path-plus-literal pair through the shared extractor; throws one usage error that lists all stale citations. */
function validateCitations(
  projectRoot: string,
  targetPath: string,
  skeleton: string,
  citations: readonly EvidenceCitation[],
): void {
  const evaluations = evaluateSearchAnchors(createFS(projectRoot), skeleton, {
    sourcePath: targetPath,
  });
  // A citation omitted by the extractor is unsafe or uncheckable, so an empty result is not treated as success.
  if (evaluations.length !== citations.length) {
    throw new CLIError(
      "Every --evidence/--search pair must resolve as one checkable project citation.",
      2,
    );
  }
  // The author sees every stale pair together so one retry can fix all missing files or literals.
  const failures = evaluations.filter(
    (evaluation) => evaluation.status !== "valid",
  );
  // Regex-shaped text is checked literally; a pattern that only resembles matching therefore appears here as a missing literal.
  if (failures.length > 0) {
    const failureDetails = failures.map((failure) => {
      const citedLocation =
        failure.diagnostic ?? `${failure.filePath} (search anchor)`;
      return `${citedLocation} [${failure.reason ?? "stale"}]`;
    });
    throw new CLIError(
      `Citation validation failed: ${failureDetails.join("; ")}`,
      2,
    );
  }
}

/** Build the complete target bytes; throws before publication for a duplicate heading or malformed existing frontmatter. */
function buildProspectiveContent(
  snapshot: BucketSnapshot,
  category: string,
  scaffoldDate: string,
  skeleton: string,
  heading: string,
): string {
  // A new category starts with canonical frontmatter and contains only the new scaffold.
  if (snapshot.content === null) {
    return `${newBucketFrontmatter(category, scaffoldDate)}${skeleton}`;
  }
  // An existing exact heading would make retrieval ambiguous, even when one copy sits in resolved history.
  if (
    maskNonRenderedMarkdown(snapshot.content)
      .split(/\r?\n/u)
      .some((line) => line === heading)
  ) {
    throw new CLIError(
      `${snapshot.projectRelativePath}: duplicate entry heading ${JSON.stringify(heading)}.`,
      2,
    );
  }
  const refreshedContent = renderRefreshedFrontmatter(
    snapshot.content,
    category,
    scaffoldDate,
    snapshot.projectRelativePath,
  );
  return insertActiveEntry(refreshedContent, skeleton);
}

/** Recheck the bucket snapshot; throws without publication when a normal editor save changed its existence, identity, or content. */
function assertBucketUnchanged(
  initialSnapshot: BucketSnapshot,
  bucketDirectory: string,
  category: string,
  projectRoot: string,
): void {
  const currentSnapshot = inspectBucketDestination(
    projectRoot,
    bucketDirectory,
    category,
  );
  const existenceChanged =
    (initialSnapshot.fileStats === null) !==
    (currentSnapshot.fileStats === null);
  const identityChanged =
    initialSnapshot.fileStats !== null &&
    currentSnapshot.fileStats !== null &&
    (initialSnapshot.fileStats.dev !== currentSnapshot.fileStats.dev ||
      initialSnapshot.fileStats.ino !== currentSnapshot.fileStats.ino);
  const contentChanged = initialSnapshot.content !== currentSnapshot.content;
  // A detected cooperative edit belongs to the developer, so their newer bucket wins and the prepared replacement is discarded.
  if (existenceChanged || identityChanged || contentChanged) {
    throw new CLIError(
      "Learning-loop bucket changed while learn new was preparing it; no scaffold was published. Re-run against the current file.",
      2,
    );
  }
}

/** Writes complete bucket bytes through an adjacent temporary file; failures throw after cleanup, while the function throws the original error. */
function replaceBucketAtomically(
  snapshot: BucketSnapshot,
  bucketDirectory: string,
  category: string,
  projectRoot: string,
  prospectiveContent: string,
  beforeBucketReplacement?: () => void,
): void {
  const temporaryPath = join(
    dirname(snapshot.absolutePath),
    `.${basename(snapshot.absolutePath)}.learn-new-${process.pid}-${randomUUID()}`,
  );
  let temporaryDescriptor: number | null = null;
  try {
    temporaryDescriptor = openSync(temporaryPath, "wx", 0o600);
    fchmodSync(temporaryDescriptor, snapshot.fileStats?.mode ?? 0o644);
    writeFileSync(temporaryDescriptor, prospectiveContent, "utf-8");
    fsyncSync(temporaryDescriptor);
    closeSync(temporaryDescriptor);
    temporaryDescriptor = null;
    // Tests can model a developer saving the same bucket immediately before the final cooperative recheck.
    beforeBucketReplacement?.();
    assertBucketUnchanged(snapshot, bucketDirectory, category, projectRoot);
    // Rename makes successful readers see either the old complete file or the new complete file; it does not remove the residual post-check race.
    renameSync(temporaryPath, snapshot.absolutePath);
  } catch (error) {
    // For example, another editor save, a full disk, or lost directory permission can interrupt publication after the temporary file was created.
    if (temporaryDescriptor !== null) closeSync(temporaryDescriptor);
    // A failed request must not leave a hidden scaffold file beside the developer's bucket.
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    throw error;
  }
}

/** Regenerate every existing learning-loop index from the bucket bytes just published. */
function regenerateLearningLoopIndexes(projectRoot: string): void {
  const projectFiles = createFS(projectRoot);
  const configState = loadConfig(projectRoot, projectFiles);
  generateIndexes(
    projectRoot,
    projectFiles,
    resolveIndexBucketPaths(configState.config),
  );
}

/**
 * Acquire the bucket and every configured generated index as one cooperative write set.
 * Throws a CLIError that translates a reusable claim refusal into a no-write learn-new diagnostic.
 */
function acquireLearningLoopWriteClaims(
  projectRoot: string,
  targetPath: string,
  bucketDirectories: Record<IndexBucket, string>,
): PathWriteClaimBatch {
  const targetPaths = [
    targetPath,
    ...INDEX_BUCKETS.map(
      (bucket) => `${bucketDirectories[bucket].replace(/\/+$/u, "")}/INDEX.md`,
    ),
  ];
  try {
    return acquirePathWriteClaims(
      projectRoot,
      [...new Set(targetPaths)].map((claimTargetPath) => ({
        targetPath: claimTargetPath,
        expectedIdentity: readPathWriteTargetIdentity(
          projectRoot,
          claimTargetPath,
        ),
      })),
    );
  } catch (error) {
    if (error instanceof PathWriteClaimError) {
      const unreleasedTargets = error.cleanupResults.flatMap((result) =>
        result.status === "released" ? [] : [result.targetPath],
      );
      const recovery =
        unreleasedTargets.length > 0
          ? `inspect .goat-flow/write-claims before retrying; cleanup was not confirmed for ${unreleasedTargets.join(", ")}.`
          : error.reason === "busy"
            ? `inspect the claim before retrying: ${pathWriteClaimInspectCommand(projectRoot, error.targetPath)}.`
            : "re-run learn new against the current project.";
      throw new CLIError(
        `${error.message} No learning-loop files were changed; ${recovery}`,
        2,
      );
    }
    throw error;
  }
}

/**
 * Release one learning-loop write set without hiding an earlier publication failure.
 * Error behavior: reports unsafe cleanup on stderr during failure, or throws after an otherwise successful publication.
 */
function releaseLearningLoopWriteClaims(
  claims: PathWriteClaimBatch,
  didPublicationFail: boolean,
): void {
  let unreleasedTargets: string[];
  try {
    unreleasedTargets = releasePathWriteClaims(claims).flatMap((result) =>
      result.status === "released" ? [] : [result.targetPath],
    );
  } catch {
    unreleasedTargets = [...claims.targetPaths];
  }
  if (unreleasedTargets.length === 0) return;
  const diagnostic = `Learning-loop write completed without confirmed claim release for ${unreleasedTargets.join(", ")}. Inspect .goat-flow/write-claims before retrying.`;
  if (didPublicationFail) {
    console.error(diagnostic);
    return;
  }
  throw new CLIError(diagnostic, 1);
}

/** Run the same invariant as `goat-flow stats --check`; null means no blocking finding remains and both command paths agree. */
function verifyLearningLoopStats(projectRoot: string): string | null {
  const projectFiles = createFS(projectRoot);
  const configState = loadConfig(projectRoot, projectFiles);
  const bucketPaths = resolveIndexBucketPaths(configState.config);
  const report = buildStatsReport({
    footguns: extractFootgunFacts(projectFiles, configState),
    lessons: extractLessonsFacts(projectFiles, configState),
    learningLoopEntries: extractLearningLoopEntries(projectFiles, configState),
    decisions: buildDecisionsSection(
      projectFiles,
      configState.config.decisions.path,
    ),
    indexes: collectIndexFreshness(projectFiles, bucketPaths),
  });
  const statsVerdict = checkStats(report);
  // A passing verdict gives the caller no recovery text; warnings remain advisory exactly as they do for the normal stats command.
  if (statsVerdict.status === "pass") return null;
  return statsVerdict.findings.map((finding) => finding.message).join("; ");
}

/** Convert a post-publication failure into one honest partial-state message and copyable recovery command. */
function partialStateError(
  targetPath: string,
  stage: "index regeneration" | "stats --check",
  failure: unknown,
): CLIError {
  const detail = failure instanceof Error ? failure.message : String(failure);
  return new CLIError(
    `Learning entry was written to ${targetPath}, but ${stage} failed: ${detail}\nIndexes may be stale. Recover with: ${RECOVERY_COMMAND}`,
    1,
  );
}

/**
 * Regenerate the indexes and run the stats gate after publication so the developer can immediately retrieve the new entry.
 * Throws a recovery-focused CLI error when either follow-up fails after the valid bucket is already visible.
 */
function publishLearningLoopFollowUps(
  targetPath: string,
  projectRoot: string,
  dependencies: LearnScaffoldDependencies,
): void {
  try {
    (dependencies.regenerateIndexes ?? regenerateLearningLoopIndexes)(
      projectRoot,
    );
  } catch (error) {
    // For example, a read-only INDEX.md can fail after the valid bucket is already visible to the developer.
    throw partialStateError(targetPath, "index regeneration", error);
  }
  let statsFailure: string | null;
  try {
    statsFailure = (dependencies.verifyStats ?? verifyLearningLoopStats)(
      projectRoot,
    );
  } catch (error) {
    // For example, an unreadable sibling bucket can make the stats stage fail after index publication completed.
    throw partialStateError(targetPath, "stats --check", error);
  }
  // A non-null diagnostic is the literal blocking stats result, so success is withheld while the valid entry remains published.
  if (statsFailure !== null) {
    throw partialStateError(targetPath, "stats --check", statsFailure);
  }
}

/** Render a dry-run preview or the three successful publication stages for the developer's terminal. */
function renderResultOutput(
  targetPath: string,
  skeleton: string,
  warnings: readonly string[],
  wasWritten: boolean,
): string {
  const warningLines = warnings.map((warning) => `Warning: ${warning}`);
  // A dry run shows exactly the entry that passed validation and deliberately omits write/index success claims.
  if (!wasWritten) {
    return [
      ...warningLines,
      `Dry run: validated scaffold for ${targetPath}`,
      "",
      skeleton.trimEnd(),
    ].join("\n");
  }
  return [
    ...warningLines,
    `✓ Wrote ${targetPath}`,
    "✓ Regenerated learning-loop indexes",
    "✓ stats --check passed",
  ].join("\n");
}

/**
 * Validate, preview, or publish one learning-loop scaffold in the developer's selected project.
 * Use for the `learn new` CLI route; pre-write failures leave buckets and indexes unchanged, while post-write failures name exact recovery.
 *
 * @param request - parsed author input; empty evidence is allowed only for lessons and patterns, while a null evidence kind is forbidden for footguns
 * @param dependencies - test seams; omitted members use the real clock, index generator, stats check, and no simulated editor save
 * @returns rendered result plus the validated skeleton; `wasWritten` is false only when the developer requested `--dry-run`
 * @throws CLIError with exit 2 before publication, or exit 1 with the recovery command after a bucket was published but follow-up work failed
 */
export function runLearnScaffold(
  request: LearnScaffoldRequest,
  dependencies: LearnScaffoldDependencies = {},
): LearnScaffoldResult {
  validateCategory(request.category);
  const normalizedTitle = validateTitle(request.title);
  validateEvidenceKind(request);
  const citations = buildEvidenceCitations(request);
  const scaffoldDate = formatUtcDate(
    (dependencies.now ?? (() => new Date()))(),
  );
  const skeleton = renderLearnEntrySkeleton(
    request.entryType,
    normalizedTitle,
    scaffoldDate,
    citations,
    request.evidenceKind,
  );
  const heading = `## ${ENTRY_HEADING[request.entryType]}: ${normalizedTitle}`;
  const projectRoot = resolve(request.projectRoot);
  const projectFiles = createFS(projectRoot);
  const configState = loadConfig(projectRoot, projectFiles);
  // Invalid config cannot safely identify the same learning-loop directory the developer expects, so defaults are not used for a write.
  if (!configState.valid) {
    throw new CLIError(
      `Cannot scaffold with invalid .goat-flow/config.yaml: ${configState.errors.map((error) => error.message).join("; ")}`,
      2,
    );
  }
  const bucketDirectories = resolveIndexBucketPaths(configState.config);
  const bucketDirectory = bucketDirectories[ENTRY_BUCKET[request.entryType]];
  const snapshot = inspectBucketDestination(
    projectRoot,
    bucketDirectory,
    request.category,
  );
  validateCitations(
    projectRoot,
    snapshot.projectRelativePath,
    skeleton,
    citations,
  );
  const prospectiveContent = buildProspectiveContent(
    snapshot,
    request.category,
    scaffoldDate,
    skeleton,
    heading,
  );
  validateProspectiveBucket(
    request.entryType,
    bucketDirectory,
    snapshot.projectRelativePath,
    prospectiveContent,
    heading,
  );
  const warnings: string[] = [];
  const exceedsBucketSizeGate =
    Buffer.byteLength(prospectiveContent, "utf-8") > BUCKET_SIZE_WARN_BYTES;
  // Dry runs expose the prospective size without mutating state; real writes stop before publishing a bucket that the mandatory stats gate rejects.
  if (exceedsBucketSizeGate) {
    const warning = `${snapshot.projectRelativePath} will exceed the ${BUCKET_SIZE_WARN_BYTES}-byte bucket-size gate; split the category before relying on stats --check.`;
    warnings.push(warning);
    if (!request.shouldDryRun) {
      throw new CLIError(`${warning} No scaffold was published.`, 2);
    }
  }
  // Dry-run performs every check above, then returns before the bucket or generated indexes can change.
  if (request.shouldDryRun) {
    return {
      targetPath: snapshot.projectRelativePath,
      skeleton,
      wasWritten: false,
      warnings,
      output: renderResultOutput(
        snapshot.projectRelativePath,
        skeleton,
        warnings,
        false,
      ),
    };
  }
  const claims = acquireLearningLoopWriteClaims(
    projectRoot,
    snapshot.projectRelativePath,
    bucketDirectories,
  );
  let publicationError: unknown = null;
  try {
    replaceBucketAtomically(
      snapshot,
      bucketDirectory,
      request.category,
      projectRoot,
      prospectiveContent,
      dependencies.beforeBucketReplacement,
    );
    publishLearningLoopFollowUps(
      snapshot.projectRelativePath,
      projectRoot,
      dependencies,
    );
  } catch (error) {
    publicationError = error;
    throw error;
  } finally {
    releaseLearningLoopWriteClaims(claims, publicationError !== null);
  }
  return {
    targetPath: snapshot.projectRelativePath,
    skeleton,
    wasWritten: true,
    warnings,
    output: renderResultOutput(
      snapshot.projectRelativePath,
      skeleton,
      warnings,
      true,
    ),
  };
}
