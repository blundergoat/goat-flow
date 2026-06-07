/**
 * Shared parsing and reference-validation primitives for the learning-loop fact
 * extractors (footguns, lessons, patterns, decisions). Owns the markdown reading,
 * frontmatter parsing, freshness computation, and the evidence-reference checks
 * that flag stale paths, out-of-bounds line numbers, and broken `(search: ...)`
 * anchors.
 *
 * Reference validation is intentionally conservative: ambiguous shorthand (bare
 * source filenames, gitignored task paths, URLs/hostnames) is skipped rather than
 * reported, because a false "stale" finding on a clean checkout erodes trust in the
 * whole audit. The regexes here are the canonical evidence grammar - footgun and
 * lesson extractors must reuse them so the same string is judged identically
 * everywhere. ADR-024 governs the line-number-versus-semantic-anchor policy these
 * checks enforce.
 */
import type { BucketFreshness, ReadonlyFS } from "../../types.js";

/** Strict YYYY-MM-DD format - rejects full ISO 8601 timestamps in `last_reviewed`. */
export const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Matches file path evidence in multiple formats:
 * - `src/auth.ts` (backtick-wrapped file path)
 * - `src/auth.ts:42` (backtick-wrapped with line number)
 * - `src/auth.ts:42-50` (backtick-wrapped with line range)
 * - (lines 866-880) or (line 52) (prose-style)
 * Line numbers are discouraged per ADR-024; flagged for cleanup when found alongside a semantic anchor.
 * File paths alone remain valid evidence.
 */
export const EVIDENCE_PATTERN =
  /`[^`]+\.[a-zA-Z]{1,10}(?::[0-9]+(?:[-,][0-9]+)*)?`|\(lines?\s+[0-9]+/;

/** Regex to extract file paths from backtick-wrapped references (with optional line numbers). */
export const FILE_REF_REGEX =
  /`([^`]+\.[a-zA-Z]{1,10})(?::[0-9]+(?:[-,][0-9]+)*)?`/g;

/** Matches backtick and double-quoted `(search: ...)` evidence anchors. */
const SEARCH_ANCHOR_REGEX =
  /`([^`]+\.[a-zA-Z0-9]{1,10})`\s*\(search:\s*(?:`([^`]+)`|"((?:\\.|[^"\\])*)")\)/g;

const BARE_EVIDENCE_ANCHOR_LINE_REGEX =
  /(?:^|\s)(?:\*\*)?Evidence anchors?(?:\*\*)?:/i;

/** One markdown file read from a learning-loop directory. */
export interface MarkdownEntry {
  path: string;
  content: string;
}

/** A learning-loop directory with its existence flag and contained markdown entries. */
export interface EntryDir {
  path: string;
  exists: boolean;
  files: MarkdownEntry[];
}

/** Aggregated file-reference validation results for footgun entries. */
export interface FootgunRefSummary {
  staleRefs: string[];
  invalidLineRefs: string[];
  totalRefs: number;
  validRefs: number;
}

/**
 * Decide whether a backtick-wrapped reference names a real file path rather than a
 * URL or hostname (which share the `host:port` shape). Used to gate staleness
 * checks so a `localhost:3000`-style token is never treated as a missing file.
 *
 * @param filePath - candidate reference text with any trailing `:line` already split off
 * @returns true for paths with a slash or a root-level filename extension; false for URLs, hostnames, and bare extensionless names
 */
export function isFileRef(filePath: string): boolean {
  // Skip hostname/URL patterns (not file references)
  if (
    /^https?:|:\/\//.test(filePath) ||
    /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(filePath)
  )
    return false;
  // Paths with '/' are clearly file paths
  if (filePath.includes("/")) return true;
  // Root-level files with extensions (e.g., AGENTS.md:42) are valid refs
  // Bare names without extensions (e.g., webpack:123) are ambiguous - skip
  return /\.[a-zA-Z0-9]+$/.test(filePath);
}

/** Check whether a file reference can be validated for staleness without guessing. */
/** Paths under these dirs are intentionally gitignored per `.goat-flow/plans/.gitignore`
 *  (milestone files + plan subdirs + `.active` marker are local-session state by
 *  design). References to them in lessons/footguns are navigation pointers,
 *  not resolvable artifacts - treating absence as "stale" false-positives on
 *  any clean checkout or CI run. Keep this list short and specific. */
function isIntentionallyGitignored(filePath: string): boolean {
  return (
    filePath.startsWith(".goat-flow/plans/") ||
    filePath.startsWith(".goat-flow/scratchpad/") ||
    filePath.startsWith(".goat-flow/logs/")
  );
}

/** Check whether the file path is checkable for staleness. */
function isCheckableForStaleness(filePath: string, fs: ReadonlyFS): boolean {
  if (isIntentionallyGitignored(filePath)) return false;
  if (filePath.includes("/")) return true;
  // If it exists at root, it's checkable regardless of extension
  if (fs.exists(filePath)) return true;
  // A bare source filename that doesn't exist at the repo root is probably
  // shorthand for a deeply nested file; skip it to avoid false positives.
  if (
    /\.(go|ts|tsx|js|jsx|py|php|rs|java|kt|rb|cs|c|cpp|h|hpp|swift|scala)$/i.test(
      filePath,
    )
  )
    return false;
  // Non-source files (AGENTS.md, package.json, etc.) should be at root
  return true;
}

/** Normalize a surface path so trailing slashes do not affect comparisons. */
function normalizeSurfacePath(path: string): string {
  return path.replace(/\/$/, "");
}

/**
 * Find learning-loop artifact surfaces that exist on disk but sit outside the
 * configured canonical location - the signal that a project is splitting one
 * concern across two directories. Returns nothing unless a canonical path is
 * actually present, so a project that simply hasn't adopted the surface yet is
 * not flagged. Trailing slashes are normalized before comparison.
 *
 * @param fs - read-only filesystem adapter for the target project
 * @param canonicalPaths - the configured/blessed locations; at least one must exist or the result is empty
 * @param knownPaths - candidate surfaces to test against the canonical set
 * @returns existing non-canonical paths, sorted lexicographically for deterministic output; empty when none compete
 */
export function findCompetingArtifactSurfaces(
  fs: ReadonlyFS,
  canonicalPaths: string[],
  knownPaths: string[],
): string[] {
  if (!canonicalPaths.some((path) => fs.exists(path))) return [];

  const canonicalSet = new Set(canonicalPaths.map(normalizeSurfacePath));
  return knownPaths
    .filter((path) => !canonicalSet.has(normalizeSurfacePath(path)))
    .filter((path) => fs.exists(path))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Read a learning-loop location into a stable, sorted set of markdown entries.
 * Handles both config shapes uniformly: a directory (every non-README `.md`,
 * sorted lexicographically) and a single flat `.md` file (one entry). The sort is
 * load-bearing - downstream entry ordering and report output must be deterministic
 * across machines, so directory listing order is never trusted.
 *
 * @param fs - read-only filesystem adapter for the target project
 * @param dir - directory path, or a single `.md` file path for flat-file config mode
 * @returns the location with its existence flag and entries; files is empty when the location is absent or unreadable
 */
export function listMarkdownEntries(fs: ReadonlyFS, dir: string): EntryDir {
  // Flat-file mode: config points at a single .md file instead of a directory
  if (dir.endsWith(".md")) {
    const exists = fs.exists(dir);
    const content = exists ? fs.readFile(dir) : null;
    const files = content !== null ? [{ path: dir, content }] : [];
    return { path: dir, exists, files };
  }

  const exists = fs.exists(dir);
  const files = exists
    ? fs
        .listDir(dir)
        .filter((file) => file.endsWith(".md") && file !== "README.md")
        .sort((a, b) => a.localeCompare(b))
        .flatMap((file) => {
          const path = dir.endsWith("/") ? `${dir}${file}` : `${dir}/${file}`;
          const content = fs.readFile(path);
          if (content === null) return [];
          return [{ path, content }];
        })
    : [];
  return { path: dir, exists, files };
}

/**
 * Separate a leading `---`-delimited YAML frontmatter block from the markdown body.
 * Recognizes frontmatter only at the very start of the content; a `---` later in
 * the document is left in the body untouched.
 *
 * @param content - raw markdown file content
 * @returns the frontmatter text without its `---` fences (null when there is none) and the remaining body
 */
export function parseMarkdownFrontmatter(content: string): {
  frontmatter: string | null;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: null, body: content };
  return { frontmatter: match[1] ?? "", body: match[2] ?? "" };
}

/**
 * Parse simple `key: value` pairs from a YAML frontmatter block.
 * Only handles flat scalar fields (sufficient for goat-flow's single-level frontmatter);
 * nested structures, arrays, and multi-line scalars are intentionally unsupported.
 *
 * @param frontmatter - YAML frontmatter body without the surrounding `---` markers
 * @returns flat key/value fields parsed from the frontmatter block
 */
export function parseFrontmatterFields(
  frontmatter: string,
): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of frontmatter.split("\n")) {
    const match = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*?)\s*$/);
    if (!match || match[1] === undefined) continue;
    fields[match[1]] = match[2] ?? "";
  }
  return fields;
}

/**
 * Compute days-since-review and a coarse freshness band for a bucket file.
 * Returns `unknown` for missing or non-YYYY-MM-DD values so callers can flag them.
 *
 * @param lastReviewed - ISO date from bucket frontmatter, or null when absent
 * @param now - comparison clock for deterministic tests and reports
 */
export function computeFreshness(
  lastReviewed: string | null,
  now: Date = new Date(),
): { days: number | null; band: BucketFreshness["freshnessBand"] } {
  if (lastReviewed === null || !ISO_DATE_REGEX.test(lastReviewed)) {
    return { days: null, band: "unknown" };
  }
  const reviewedMs = Date.parse(`${lastReviewed}T00:00:00Z`);
  if (Number.isNaN(reviewedMs)) return { days: null, band: "unknown" };

  const todayMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const days = Math.max(0, Math.floor((todayMs - reviewedMs) / 86400000));
  if (days <= 30) return { days, band: "fresh" };
  if (days <= 90) return { days, band: "aging" };
  return { days, band: "stale" };
}

/**
 * Count how many times a pattern matches across a string. Pass a global (`/g`)
 * regex - `matchAll` requires it, and without the flag the match count is not what
 * a caller expects.
 *
 * @param content - text to scan
 * @param pattern - global regular expression; non-global patterns will throw under matchAll
 * @returns the total number of non-overlapping matches; 0 when none match
 */
export function countMatches(content: string, pattern: RegExp): number {
  return Array.from(content.matchAll(pattern)).length;
}

/**
 * Remove `~~...~~` strikethrough spans before evidence is scanned, so a reference
 * an author has struck through (marked as historical) is not counted as live
 * evidence. Run this first in every reference check; otherwise retired anchors
 * resurface as findings.
 *
 * @param content - markdown that may contain strikethrough spans, including multi-line ones
 * @returns the content with all strikethrough spans removed
 */
export function stripStrikethrough(content: string): string {
  return content.replace(/~~[\s\S]*?~~/g, "");
}

/** Check a concrete file:line reference for out-of-bounds lines or missing anchors. */
function getLineRefDiagnostic(
  fs: ReadonlyFS,
  filePath: string,
  rawLines: string,
  hasSemanticAnchor: boolean,
): string | null {
  const lineCount = fs.lineCount(filePath);
  const lineNumbers = Array.from(rawLines.matchAll(/[0-9]+/g)).flatMap(
    (lineMatch) => {
      const value = Number.parseInt(lineMatch[0], 10);
      return Number.isNaN(value) ? [] : [value];
    },
  );
  const ref = `${filePath}:${rawLines}`;
  if (
    lineNumbers.some((lineNumber) => lineNumber < 1 || lineNumber > lineCount)
  ) {
    return ref;
  }
  if (!hasSemanticAnchor) return `${ref} (missing semantic anchor)`;
  return lineNumbers.length > 0
    ? `${ref} (line ref redundant, semantic anchor exists)`
    : null;
}

/**
 * Validate every file reference in one footgun section and tally the result.
 * Reports a path as stale when the file no longer exists, and flags a `file:line`
 * reference when the line is out of bounds, lacks a semantic anchor, or carries a
 * line number made redundant by an anchor (the ADR-024 anchor-over-line-number
 * contract). Strikethrough is stripped first so struck evidence is ignored.
 *
 * @param fs - read-only filesystem adapter used to resolve and line-count referenced files
 * @param content - the footgun section's markdown
 * @returns counts plus the stale-path and invalid-line-reference lists; all empty when every reference is valid
 */
export function summarizeFootgunRefs(
  fs: ReadonlyFS,
  content: string,
): FootgunRefSummary {
  const summary: FootgunRefSummary = {
    staleRefs: [],
    invalidLineRefs: [],
    totalRefs: 0,
    validRefs: 0,
  };
  const cleanedContent = stripStrikethrough(content);
  for (const line of cleanedContent.split("\n")) {
    const hasSemanticAnchor = new RegExp(SEARCH_ANCHOR_REGEX.source).test(line);
    const fileRefs = line.matchAll(/`([^`]+):([0-9]+(?:[-,][0-9]+)*)`/g);
    for (const match of fileRefs) {
      const filePath = match[1];
      const rawLines = match[2];
      if (
        filePath === undefined ||
        rawLines === undefined ||
        !isFileRef(filePath) ||
        !isCheckableForStaleness(filePath, fs)
      )
        continue;
      summary.totalRefs++;
      if (!fs.exists(filePath)) {
        summary.staleRefs.push(`${filePath}:${rawLines}`);
        continue;
      }
      const diagnostic = getLineRefDiagnostic(
        fs,
        filePath,
        rawLines,
        hasSemanticAnchor,
      );
      if (diagnostic !== null) {
        summary.invalidLineRefs.push(diagnostic);
        continue;
      }
      summary.validRefs++;
    }
  }

  scanBareEvidenceAnchors(fs, cleanedContent, summary);
  scanSearchAnchors(fs, cleanedContent, summary);

  return summary;
}

/** Bare `Evidence anchors:` path references are durable evidence and must not go stale silently. */
function scanBareEvidenceAnchors(
  fs: ReadonlyFS,
  cleanedContent: string,
  summary: FootgunRefSummary,
): void {
  for (const line of cleanedContent.split("\n")) {
    if (!BARE_EVIDENCE_ANCHOR_LINE_REGEX.test(line)) continue;

    for (const match of line.matchAll(new RegExp(FILE_REF_REGEX.source, "g"))) {
      const filePath = checkableBareEvidenceAnchorPath(fs, line, match);
      if (filePath === null) continue;

      summary.totalRefs++;
      if (fs.exists(filePath)) {
        summary.validRefs++;
      } else {
        summary.staleRefs.push(filePath);
      }
    }
  }
}

function checkableBareEvidenceAnchorPath(
  fs: ReadonlyFS,
  line: string,
  match: RegExpMatchArray,
): string | null {
  const filePath = match[1];
  if (filePath === undefined) return null;
  if (/[*?{}<>]|\.\.\./.test(filePath)) return null;
  if (/:[0-9]+/.test(match[0])) return null;
  if (isFollowedBySearchAnchor(line, match)) return null;
  if (!isFileRef(filePath)) return null;
  if (!isCheckableForStaleness(filePath, fs)) return null;
  return filePath;
}

function isFollowedBySearchAnchor(
  line: string,
  match: RegExpMatchArray,
): boolean {
  const matchIndex = match.index;
  if (matchIndex === undefined) return false;
  return line
    .slice(matchIndex + match[0].length)
    .trimStart()
    .startsWith("(search:");
}

/** `(search: "<needle>")` anchors: confirm the literal string still appears in
 *  the referenced file. A stale anchor is the mechanism that lets retired-code
 *  footguns pass validation while pointing at code that no longer exists. */
function scanSearchAnchors(
  fs: ReadonlyFS,
  cleanedContent: string,
  summary: FootgunRefSummary,
): void {
  const searchAnchors = cleanedContent.matchAll(
    new RegExp(SEARCH_ANCHOR_REGEX.source, "g"),
  );
  for (const match of searchAnchors) {
    const anchor = searchAnchorFromMatch(match);
    if (
      anchor === null ||
      !isFileRef(anchor.filePath) ||
      !isCheckableForStaleness(anchor.filePath, fs)
    )
      continue;
    summary.totalRefs++;
    if (!fs.exists(anchor.filePath)) {
      summary.staleRefs.push(
        `${anchor.filePath} (search: \`${anchor.needle}\`)`,
      );
      continue;
    }
    const fileContent = fs.readFile(anchor.filePath);
    if (fileContent === null || !fileContent.includes(anchor.needle)) {
      summary.staleRefs.push(
        `${anchor.filePath} (search: \`${anchor.needle}\`)`,
      );
      continue;
    }
    summary.validRefs++;
  }
}

function searchAnchorFromMatch(
  match: RegExpMatchArray,
): { filePath: string; needle: string } | null {
  const filePath = match[1];
  const rawNeedle = match[2] ?? match[3];
  if (filePath === undefined || rawNeedle === undefined) return null;
  return { filePath, needle: rawNeedle.replace(/\\(["\\])/g, "$1") };
}

/**
 * Validate the file references in one lesson or pattern section, sharing the same
 * staleness and ADR-024 line-reference rules as footguns. Lessons cite full
 * project-rooted paths (src/, lib/, docs/, .goat-flow/, ...), so this matches that
 * prefix grammar and skips glob-like or `...`-elided tokens that cannot be resolved
 * to a single file.
 *
 * @param fs - read-only filesystem adapter used to resolve and line-count referenced files
 * @param content - the lesson or pattern section's markdown
 * @returns counts plus the stale-path and invalid-line-reference lists; all empty when every reference is valid
 */
export function summarizeLessonRefs(
  fs: ReadonlyFS,
  content: string,
): FootgunRefSummary {
  const summary: FootgunRefSummary = {
    staleRefs: [],
    invalidLineRefs: [],
    totalRefs: 0,
    validRefs: 0,
  };
  const pathPattern =
    /`((?:src|config|app|apps|lib|docs|scripts|setup|workflow|agents|\.goat-flow)\/[^`]+)`/g;
  const cleanedContent = stripStrikethrough(content);
  for (const match of cleanedContent.matchAll(pathPattern)) {
    const ref = match[1];
    if (ref === undefined || /[*?{}<>]|\.\.\./.test(ref)) continue;
    const filePath = ref.replace(/:[0-9]+(?:[-,][0-9]+)*$/, "");
    if (isIntentionallyGitignored(filePath)) continue;
    summary.totalRefs++;
    if (fs.exists(filePath)) {
      summary.validRefs++;
    } else {
      summary.staleRefs.push(filePath);
    }
  }
  summary.invalidLineRefs.push(
    ...collectInvalidLessonLineRefs(fs, cleanedContent),
  );
  scanSearchAnchors(fs, cleanedContent, summary);
  return summary;
}

/** Validate `file:line` refs in lesson content, returning out-of-bounds or anchorless refs. */
function collectInvalidLessonLineRefs(
  fs: ReadonlyFS,
  cleanedContent: string,
): string[] {
  const invalid: string[] = [];
  for (const line of cleanedContent.split("\n")) {
    const hasSemanticAnchor = new RegExp(SEARCH_ANCHOR_REGEX.source).test(line);
    for (const match of line.matchAll(/`([^`]+):([0-9]+(?:[-,][0-9]+)*)`/g)) {
      const filePath = match[1];
      const rawLines = match[2];
      if (
        filePath === undefined ||
        rawLines === undefined ||
        !isFileRef(filePath) ||
        !isCheckableForStaleness(filePath, fs) ||
        !fs.exists(filePath)
      )
        continue;
      const diagnostic = getLineRefDiagnostic(
        fs,
        filePath,
        rawLines,
        hasSemanticAnchor,
      );
      if (diagnostic !== null) invalid.push(diagnostic);
    }
  }
  return invalid;
}
