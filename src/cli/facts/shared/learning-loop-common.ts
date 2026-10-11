/**
 * Read learning-loop files and check their evidence for audit, stats, and dashboard users.
 *
 * All extractors share this grammar so the same citation gets the same result; ADR-024 requires semantic anchors instead of line numbers.
 * Skip ambiguous references rather than show users a stale-evidence warning that cannot be justified.
 */
import type { BucketFreshness, ReadonlyFS } from "../../types.js";
import {
  isCheckableForStaleness,
  isFileRef,
  isIntentionallyGitignored,
  SEARCH_ANCHOR_REGEX,
  type ReferenceValidationOptions,
} from "./reference-paths.js";
import { evaluateSearchAnchors } from "./search-anchors.js";
import { maskNonRenderedMarkdown } from "../../rendered-markdown.js";

/** Strict YYYY-MM-DD format - rejects full ISO 8601 timestamps in `last_reviewed`. */
export const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Locate the visible active/resolved boundary while ignoring prose, examples, and longer headings.
 *
 * @param content - original bucket Markdown whose offsets stay stable; empty content has no resolved-entry boundary
 * @returns zero-based heading offset, or -1 when the bucket has no rendered boundary
 */
export function findResolvedEntriesHeadingIndex(content: string): number {
  return maskNonRenderedMarkdown(content).search(
    /^ {0,3}##[\t ]+Resolved Entries(?:[\t ]+#+)?[\t ]*$/mu,
  );
}

/**
 * Recognize file evidence, including legacy line references that validation must still diagnose.
 *
 * ADR-024 prohibits line numbers in evidence; recognizing old syntax does not authorize it.
 * - Backtick-wrapped paths may carry a legacy line number or range.
 * - Prose-style line references are recognized separately; plain file paths remain valid evidence.
 */
export const EVIDENCE_PATTERN =
  /`[^`]+\.[a-zA-Z]{1,10}(?::[0-9]+(?:[-,][0-9]+)*)?`|\(lines?\s+[0-9]+/;

/** Regex to extract file paths from backtick-wrapped references (with optional line numbers). */
export const FILE_REF_REGEX =
  /`([^`]+\.[a-zA-Z]{1,10})(?::[0-9]+(?:[-,][0-9]+)*)?`/g;

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
  validSearchAnchors: number;
}

/** Normalize a surface path so trailing slashes do not affect comparisons. */
function normalizeSurfacePath(path: string): string {
  return path.replace(/\/$/, "");
}

/**
 * Find competing learning-loop locations so audit users can consolidate one concern into its configured home.
 *
 * @param fs - read-only filesystem adapter for the target project
 * @param canonicalPaths - configured locations; empty or wholly absent locations suppress duplicate-surface warnings
 * @param knownPaths - candidate locations; empty means there are no competing surfaces to check
 * @returns existing non-canonical paths, sorted lexicographically for deterministic output; empty when none compete
 */
export function findCompetingArtifactSurfaces(
  fs: ReadonlyFS,
  canonicalPaths: string[],
  knownPaths: string[],
): string[] {
  // A project that has not adopted this surface cannot have a competing configured location.
  if (!canonicalPaths.some((path) => fs.exists(path))) return [];

  const canonicalSet = new Set(canonicalPaths.map(normalizeSurfacePath));
  return knownPaths
    .filter((path) => !canonicalSet.has(normalizeSurfacePath(path)))
    .filter((path) => fs.exists(path))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Load the user's configured learning-loop directory or flat Markdown file for deterministic reports.
 *
 * @param fs - read-only filesystem adapter for the target project
 * @param dir - directory path, or a single `.md` file path for flat-file config mode
 * @returns existence and sorted entries, excluding README/INDEX metadata; files is empty when absent or no eligible file is readable
 */
export function listMarkdownEntries(fs: ReadonlyFS, dir: string): EntryDir {
  // A user can configure one Markdown file instead of adopting category buckets.
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
        .filter(
          (file) =>
            file.endsWith(".md") && file !== "README.md" && file !== "INDEX.md",
        )
        .sort((a, b) => a.localeCompare(b))
        // Read each eligible entry once; a file lost during the listing cannot contribute invented content.
        .flatMap((file) => {
          const path = dir.endsWith("/") ? `${dir}${file}` : `${dir}/${file}`;
          const content = fs.readFile(path);
          // A listed file may become unreadable; omit it rather than invent an empty learning entry.
          if (content === null) return [];
          return [{ path, content }];
        })
    : [];
  return { path: dir, exists, files };
}

/**
 * Separate a leading `---`-delimited YAML frontmatter block from the markdown body.
 * Recognizes frontmatter only at the very start of the content; a `---` later in the document is left in the body untouched.
 *
 * @param content - raw Markdown; empty content has no frontmatter and remains an empty body
 * @returns unfenced frontmatter, or null when absent, plus the remaining body; empty fields retain their actual empty text
 */
export function parseMarkdownFrontmatter(content: string): {
  frontmatter: string | null;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  // Without an opening frontmatter block, the user's whole document stays available as entry text.
  if (!match) return { frontmatter: null, body: content };
  return { frontmatter: match[1] ?? "", body: match[2] ?? "" };
}

/**
 * Read flat `key: value` metadata for learning-loop reports; nested YAML and multiline values are unsupported.
 *
 * @param frontmatter - unfenced metadata text; empty means no fields were supplied
 * @returns recognized scalar fields; an empty object supplies no metadata, while an empty value preserves a blank field
 */
export function parseFrontmatterFields(
  frontmatter: string,
): Record<string, string> {
  const fields: Record<string, string> = {};
  // Each recognized metadata line contributes one field to the user's entry report.
  for (const line of frontmatter.split("\n")) {
    const match = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*?)\s*$/);
    // Prose and unsupported YAML lines cannot supply a reliable metadata field.
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
 * @returns days since review with its band; `days: null` and band `unknown` mean the date could not be read, not that the bucket is fresh
 */
export function computeFreshness(
  lastReviewed: string | null,
  now: Date = new Date(),
): { days: number | null; band: BucketFreshness["freshnessBand"] } {
  // Absent or wrongly shaped dates report as unknown so a caller can flag them instead of showing a made-up age.
  if (lastReviewed === null || !ISO_DATE_REGEX.test(lastReviewed)) {
    return { days: null, band: "unknown" };
  }
  const reviewedMs = Date.parse(`${lastReviewed}T00:00:00Z`);
  // An unparseable review date stays unknown rather than displaying a misleading freshness colour.
  if (Number.isNaN(reviewedMs)) return { days: null, band: "unknown" };

  const todayMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const days = Math.max(0, Math.floor((todayMs - reviewedMs) / 86400000));
  // Bands the dashboard colours: a month is fresh, a quarter is aging, anything older reads as stale.
  if (days <= 30) return { days, band: "fresh" };
  // A review older than a month but within the quarter gets the dashboard's aging band.
  if (days <= 90) return { days, band: "aging" };
  return { days, band: "stale" };
}

/**
 * Count how many times a pattern matches across a string.
 * Pass a global (`/g`) regex - `matchAll` requires it, and without the flag the match count is not what a caller expects.
 *
 * @param content - text to scan; empty text contributes zero matches
 * @param pattern - global regular expression; non-global patterns will throw under matchAll
 * @returns the total number of non-overlapping matches; 0 when none match
 */
export function countMatches(content: string, pattern: RegExp): number {
  return Array.from(content.matchAll(pattern)).length;
}

/**
 * Remove struck-through evidence so an author's retired citation cannot trigger a current-reference warning.
 * Run this first in every reference check; otherwise retired anchors resurface as findings.
 *
 * @param content - Markdown with optional multiline strikethrough; empty input stays empty
 * @returns content without retired spans; empty means no live text remains to check
 */
export function stripStrikethrough(content: string): string {
  return content.replace(/~~[\s\S]*?~~/g, "");
}

/** Diagnose legacy file:line evidence for the report; null means no numeric reference was found to flag. */
function getLineRefDiagnostic(
  fs: ReadonlyFS,
  filePath: string,
  rawLines: string,
  hasSemanticAnchor: boolean,
): string | null {
  const lineCount = fs.lineCount(filePath);
  const lineNumbers = Array.from(rawLines.matchAll(/[0-9]+/g)).flatMap(
    // Keep concrete numeric references for ADR-024 diagnostics rather than guessing at unparseable tokens.
    (lineMatch) => {
      const lineNumber = Number.parseInt(lineMatch[0], 10);
      return Number.isNaN(lineNumber) ? [] : [lineNumber];
    },
  );
  const ref = `${filePath}:${rawLines}`;
  // A citation outside the current file cannot guide the user to the claimed evidence.
  if (
    lineNumbers.some((lineNumber) => lineNumber < 1 || lineNumber > lineCount)
  ) {
    return ref;
  }
  // A bare line number leaves the user without the stable citation required by ADR-024.
  if (!hasSemanticAnchor) return `${ref} (missing semantic anchor)`;
  return lineNumbers.length > 0
    ? `${ref} (line ref redundant, semantic anchor exists)`
    : null;
}

/**
 * Validate every file reference in one footgun section and tally the result.
 *
 * Missing files and prohibited line references become actionable diagnostics under ADR-024.
 *
 * @param fs - read-only filesystem adapter used to resolve and line-count referenced files
 * @param content - the footgun section's markdown; strikethrough is stripped first, so struck evidence is ignored
 * @returns reference counts and diagnostic lists; empty lists mean no stale or invalid citations, while counts may still be nonzero
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
    validSearchAnchors: 0,
  };
  const cleanedContent = stripStrikethrough(content);
  // Anchors apply to their own citation line, so one valid anchor cannot excuse unrelated line references.
  for (const line of cleanedContent.split("\n")) {
    const hasSemanticAnchor = new RegExp(SEARCH_ANCHOR_REGEX.source).test(line);
    const fileRefs = line.matchAll(/`([^`]+):([0-9]+(?:[-,][0-9]+)*)`/g);
    // Inspect every legacy numeric citation so the report identifies all references the author must repair.
    for (const match of fileRefs) {
      const filePath = match[1];
      const rawLines = match[2];
      // Unsupported or exempt path syntax cannot support a concrete stale-reference warning.
      if (
        filePath === undefined ||
        rawLines === undefined ||
        !isFileRef(filePath) ||
        !isCheckableForStaleness(filePath, fs)
      )
        continue;
      summary.totalRefs++;
      // A deleted or moved evidence file needs a replacement citation before this entry can be trusted.
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
      // Retain the precise line-reference problem so the user knows how to repair this citation.
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
  // Only explicitly labelled evidence lines use this bare-path citation grammar.
  for (const line of cleanedContent.split("\n")) {
    // Ordinary prose references are handled by their own scanners and must not be counted twice.
    if (!BARE_EVIDENCE_ANCHOR_LINE_REGEX.test(line)) continue;

    // Every bare path on the evidence line must remain usable from a clean checkout.
    for (const match of line.matchAll(new RegExp(FILE_REF_REGEX.source, "g"))) {
      const filePath = bareEvidenceAnchorPath(line, match);
      // A token owned by another citation grammar is checked there instead.
      if (filePath === null) continue;
      // Local workspace evidence cannot be recovered by another contributor from version control.
      if (flagGitignoredEvidenceAnchor(filePath, summary)) continue;
      // Exempt paths must not generate unsupported stale-reference warnings.
      if (!isCheckableForStaleness(filePath, fs)) continue;

      summary.totalRefs++;
      // An existing file remains usable evidence; a missing one is shown to the author as stale.
      if (fs.exists(filePath)) {
        summary.validRefs++;
      } else {
        summary.staleRefs.push(filePath);
      }
    }
  }
}

/**
 * Extract a plain file path from an `Evidence anchors:` line match.
 *
 * @param line - the evidence-anchors line being scanned
 * @param match - the token match under test
 * @returns plain path, or null for ambiguous tokens and references handled by numeric or search-anchor scanners
 */
function bareEvidenceAnchorPath(
  line: string,
  match: RegExpMatchArray,
): string | null {
  const filePath = match[1];
  // An unmatched token supplies no path the report can validate.
  if (filePath === undefined) return null;
  // A glob or elided path cannot identify one concrete evidence file for the reader.
  if (/[*?{}<>]|\.\.\./.test(filePath)) return null;
  // Numeric citations need the dedicated ADR-024 diagnostic instead of a second bare-path count.
  if (/:[0-9]+/.test(match[0])) return null;
  // Search-anchored citations are validated together with their literal search text.
  if (isFollowedBySearchAnchor(line, match)) return null;
  // Non-file tokens cannot be verified as repository evidence.
  if (!isFileRef(filePath)) return null;
  return filePath;
}

/**
 * Flag a gitignored path used in a durable-evidence grammar as a policy violation.
 *
 * Local-state paths (plans/scratchpad/logs) vanish on a clean checkout; flag them even when they exist in this workspace.
 *
 * @param filePath - the cited path
 * @param summary - reference summary the violation is recorded in
 * @returns true when the path was flagged, which tells the caller to skip it
 */
function flagGitignoredEvidenceAnchor(
  filePath: string,
  summary: FootgunRefSummary,
): boolean {
  // A committed path is eligible for normal validation rather than this local-state warning.
  if (!isIntentionallyGitignored(filePath)) return false;
  summary.totalRefs++;
  summary.staleRefs.push(
    `${filePath} (gitignored path used as durable evidence anchor)`,
  );
  return true;
}

/**
 * Whether a file reference is immediately followed by its `(search: ...)` anchor, which is the shape that makes a citation checkable.
 *
 * @param line - entry line holding the reference
 * @param match - the file-reference match found on that line
 * @returns true when an anchor follows; a match with no index reports false rather than guessing a position
 */
function isFollowedBySearchAnchor(
  line: string,
  match: RegExpMatchArray,
): boolean {
  const matchIndex = match.index;
  // Without a position there is no text to look at after the reference, so the citation cannot be confirmed.
  if (matchIndex === undefined) return false;
  return line
    .slice(matchIndex + match[0].length)
    .trimStart()
    .startsWith("(search:");
}

/** For search anchors, confirm the literal string still appears so users are not directed to removed code. */
function scanSearchAnchors(
  fs: ReadonlyFS,
  cleanedContent: string,
  summary: FootgunRefSummary,
  options: ReferenceValidationOptions = {},
): void {
  // Each evaluated anchor contributes one citation to the user's reference summary.
  for (const anchor of evaluateSearchAnchors(fs, cleanedContent, options)) {
    summary.totalRefs++;
    // A stale anchor identifies evidence the author must refresh instead of receiving a valid-reference count.
    if (anchor.status === "stale") {
      // Some stale states have no displayable detail; retain only diagnostics the evaluator actually supplied.
      if (anchor.diagnostic !== null) summary.staleRefs.push(anchor.diagnostic);
      continue;
    }
    summary.validRefs++;
    summary.validSearchAnchors++;
  }
}

/**
 * Validate the file references in one lesson or pattern section, sharing the same staleness and ADR-024 line-reference rules as footguns.
 * Check project-rooted paths; globs and elided tokens cannot identify one evidence file.
 *
 * @param fs - read-only filesystem adapter used to resolve and line-count referenced files
 * @param content - lesson or pattern Markdown; empty text or no references yields zero counts
 * @param options - external-evidence policy; omitted means missing local files are reported as stale
 * @returns counts and diagnostic lists; empty lists mean no stale or invalid citations, while valid counts may be nonzero
 */
export function summarizeLessonRefs(
  fs: ReadonlyFS,
  content: string,
  options: ReferenceValidationOptions = {},
): FootgunRefSummary {
  const summary: FootgunRefSummary = {
    staleRefs: [],
    invalidLineRefs: [],
    totalRefs: 0,
    validRefs: 0,
    validSearchAnchors: 0,
  };
  const pathPattern =
    /`((?:src|config|app|apps|lib|docs|scripts|setup|workflow|agents|\.goat-flow)\/[^`]+)`/g;
  const cleanedContent = stripStrikethrough(content);
  // Check every concrete project-rooted citation that an author has kept as live evidence.
  for (const match of cleanedContent.matchAll(pathPattern)) {
    const ref = match[1];
    // Missing captures, globs, and elided tokens cannot identify a file another contributor can open.
    if (ref === undefined || /[*?{}<>]|\.\.\./.test(ref)) continue;
    const filePath = ref.replace(/:[0-9]+(?:[-,][0-9]+)*$/, "");
    // Local-state references are outside this general path scan and cannot increase its valid count.
    if (isIntentionallyGitignored(filePath)) continue;
    summary.totalRefs++;
    // Existing evidence contributes to coverage; missing files are warnings unless the caller allows external evidence.
    if (fs.exists(filePath)) {
      summary.validRefs++;
    } else if (options.allowMissingFiles !== true) {
      // External-evidence mode may excuse a missing local file; ordinary project evidence must resolve here.
      summary.staleRefs.push(filePath);
    }
  }
  summary.invalidLineRefs.push(
    ...collectInvalidLessonLineRefs(fs, cleanedContent),
  );
  scanSearchAnchors(fs, cleanedContent, summary, options);
  return summary;
}

/** Validate `file:line` refs in lesson content, returning out-of-bounds or anchorless refs. */
function collectInvalidLessonLineRefs(
  fs: ReadonlyFS,
  cleanedContent: string,
): string[] {
  const invalid: string[] = [];
  // Compare each legacy numeric citation with anchors on the same line of the author's entry.
  for (const line of cleanedContent.split("\n")) {
    const hasSemanticAnchor = new RegExp(SEARCH_ANCHOR_REGEX.source).test(line);
    // Retain a separate diagnostic for every prohibited numeric citation the author needs to replace.
    for (const match of line.matchAll(/`([^`]+):([0-9]+(?:[-,][0-9]+)*)`/g)) {
      const filePath = match[1];
      const rawLines = match[2];
      // Missing or exempt evidence files are not suitable for an additional numeric-reference diagnosis.
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
      // Null means this scanner found no numeric problem to add to the user's report.
      if (diagnostic !== null) invalid.push(diagnostic);
    }
  }
  return invalid;
}
