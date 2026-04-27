/**
 * Footgun and lesson fact extractors for the learning-loop system.
 * Analyzes category-bucket markdown files for evidence quality, entry counts, and stale references.
 */
import type { SharedFacts, ReadonlyFS, BucketFreshness } from "../../types.js";
import type { LoadedConfig } from "../../config/types.js";

/** Strict YYYY-MM-DD format - rejects full ISO 8601 timestamps in `last_reviewed`. */
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Matches file path evidence in multiple formats:
 * - `src/auth.ts` (backtick-wrapped file path)
 * - `src/auth.ts:42` (backtick-wrapped with line number)
 * - `src/auth.ts:42-50` (backtick-wrapped with line range)
 * - (lines 866-880) or (line 52) (prose-style)
 * Line numbers are discouraged per ADR-024; flagged for cleanup when found alongside a semantic anchor.
 * File paths alone remain valid evidence.
 */
const EVIDENCE_PATTERN =
  /`[^`]+\.[a-zA-Z]{1,10}(?::[0-9]+(?:[-,][0-9]+)*)?`|\(lines?\s+[0-9]+/;

/** Regex to extract file paths from backtick-wrapped references (with optional line numbers). */
const FILE_REF_REGEX = /`([^`]+\.[a-zA-Z]{1,10})(?::[0-9]+(?:[-,][0-9]+)*)?`/g;

/** Matches `` `<file>` (search: `<needle>`) `` - the footgun evidence form that
 *  cites a literal string to grep for inside the referenced file. */
const SEARCH_ANCHOR_REGEX =
  /`([^`]+\.[a-zA-Z0-9]{1,10})`\s*\(search:\s*`([^`]+)`\)/g;

/** Check if a backtick-wrapped file:line reference is a real file path (not a URL/hostname) */
function isFileRef(filePath: string): boolean {
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
/** Paths under these dirs are intentionally gitignored per `.goat-flow/tasks/.gitignore`
 *  (milestone files + plan subdirs + `.active` marker are local-session state by
 *  design). References to them in lessons/footguns are navigation pointers,
 *  not resolvable artifacts - treating absence as "stale" false-positives on
 *  any clean checkout or CI run. Keep this list short and specific. */
function isIntentionallyGitignored(filePath: string): boolean {
  return (
    filePath.startsWith(".goat-flow/tasks/") ||
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
  // Bare source filenames that don't exist at root are likely shorthand
  // for deeply nested files - skip to avoid false positives
  if (
    /\.(go|ts|tsx|js|jsx|py|php|rs|java|kt|rb|cs|c|cpp|h|hpp|swift|scala)$/i.test(
      filePath,
    )
  )
    return false;
  // Non-source files (AGENTS.md, package.json, etc.) should be at root
  return true;
}

/** One markdown file read from a learning-loop directory. */
interface MarkdownEntry {
  path: string;
  content: string;
}

/** A learning-loop directory with its existence flag and contained markdown entries. */
interface EntryDir {
  path: string;
  exists: boolean;
  files: MarkdownEntry[];
}

/** Aggregated file-reference validation results for footgun entries. */
interface FootgunRefSummary {
  staleRefs: string[];
  invalidLineRefs: string[];
  totalRefs: number;
  validRefs: number;
}

/** Known filesystem locations where footgun artifacts may appear. */
const FOOTGUN_SURFACE_CANDIDATES = [".goat-flow/footguns/", "docs/footguns.md"];
/** Known filesystem locations where lesson artifacts may appear. */
const LESSON_SURFACE_CANDIDATES = [
  ".goat-flow/lessons/",
  "docs/lessons/",
  "docs/lessons.md",
];

/** Normalize a surface path so trailing slashes do not affect comparisons. */
function normalizeSurfacePath(path: string): string {
  return path.replace(/\/$/, "");
}

/** Detect competing artifact surfaces outside the configured canonical path. */
function findCompetingArtifactSurfaces(
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

/** List markdown files in a directory (or read a single flat .md file), returning path+content pairs. */
function listMarkdownEntries(fs: ReadonlyFS, dir: string): EntryDir {
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

/** Split markdown content into optional YAML frontmatter and remaining body. */
function parseMarkdownFrontmatter(content: string): {
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

/** Count all regex matches within a string. */
function countMatches(content: string, pattern: RegExp): number {
  return Array.from(content.matchAll(pattern)).length;
}

/** Remove strikethrough history so historical notes do not count as live evidence. */
function stripStrikethrough(content: string): string {
  return content.replace(/~~[\s\S]*?~~/g, "");
}

/** Count `## Lesson:` or `## Pattern:` bucket entries in one markdown file. */
function countLessonEntries(content: string): number {
  const { body } = parseMarkdownFrontmatter(content);
  const bucketCount = countMatches(body, /^##\s+(?:Lesson|Pattern):\s+/gm);
  return bucketCount > 0 ? bucketCount : 1;
}

/** Count footgun entries. */
function countFootgunEntries(content: string): number {
  const { body } = parseMarkdownFrontmatter(content);
  const bucketCount = countMatches(body, /^##\s+Footgun:\s+/gm);
  return bucketCount > 0 ? bucketCount : 1;
}

/** Count footgun labels. */
function countFootgunLabels(content: string): number {
  const { body } = parseMarkdownFrontmatter(content);
  const bucketCount = countMatches(body, /^##\s+Footgun:\s+/gm);
  if (bucketCount > 0) {
    return countMatches(
      body,
      /\*\*Evidence(?:\s+type)?:\*\*\s*(?:ACTUAL_MEASURED|DESIGN_TARGET|HYPOTHETICAL_EXAMPLE)/gim,
    );
  }
  return hasEvidenceLabel(content) ? 1 : 0;
}

/** Accumulate directory mention counts from file references in markdown content. */
function mergeDirMentions(target: Map<string, number>, content: string): void {
  const pathRefs = content.matchAll(new RegExp(FILE_REF_REGEX.source, "g"));
  for (const match of pathRefs) {
    const group = match[1];
    if (group === undefined || !isFileRef(group)) continue;
    const dir = group.split("/").slice(0, -1).join("/");
    if (!dir) continue;
    target.set(dir, (target.get(dir) ?? 0) + 1);
  }
}

/** Detect whether a footgun entry declares an explicit evidence label. */
function hasEvidenceLabel(content: string): boolean {
  return (
    /^evidence_type:\s*.+$/im.test(content) ||
    /^\*\*Evidence type:\*\*/m.test(content) ||
    /\*\*Evidence:\*\*\s*(?:ACTUAL_MEASURED|DESIGN_TARGET|HYPOTHETICAL_EXAMPLE)/m.test(
      content,
    )
  );
}

/** Detect whether markdown content cites at least one file reference. */
function hasFileEvidence(content: string): boolean {
  const refs = content.matchAll(
    /`([^`]+\.[a-zA-Z]{1,10}:[0-9]+(?:[-,][0-9]+)*)`/g,
  );
  for (const match of refs) {
    if (match[1] !== undefined && isFileRef(match[1])) return true;
  }
  return false;
}

/** Detect whether a footgun entry includes usable file or line evidence. */
function hasFootgunEvidence(content: string): boolean {
  if (!EVIDENCE_PATTERN.test(content)) return false;
  return hasFileEvidence(content);
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

/** Check referenced `file:line` evidence for stale footgun paths and ADR-024 compliance. */
function summarizeFootgunRefs(
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

  scanSearchAnchors(fs, cleanedContent, summary);

  return summary;
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
    const filePath = match[1];
    const needle = match[2];
    if (
      filePath === undefined ||
      needle === undefined ||
      !isFileRef(filePath) ||
      !isCheckableForStaleness(filePath, fs)
    )
      continue;
    summary.totalRefs++;
    if (!fs.exists(filePath)) {
      summary.staleRefs.push(`${filePath} (search: \`${needle}\`)`);
      continue;
    }
    const fileContent = fs.readFile(filePath);
    if (fileContent === null || !fileContent.includes(needle)) {
      summary.staleRefs.push(`${filePath} (search: \`${needle}\`)`);
      continue;
    }
    summary.validRefs++;
  }
}

interface FootgunSection {
  title: string;
  start: number;
  content: string;
  status: string | null;
}

/** Split one footgun bucket into its individual `## Footgun:` sections. */
function splitFootgunSections(body: string): FootgunSection[] {
  const headings = Array.from(
    body.matchAll(/^##\s+Footgun:\s+(.+)$/gm),
    (match) => ({
      title: (match[1] ?? "").trim(),
      start: match.index,
    }),
  );
  return headings.map((heading, index) => {
    const end = headings[index + 1]?.start ?? body.length;
    const content = body.slice(heading.start, end);
    const statusMatch = content.match(/\*\*Status:\*\*\s*([^|\n]+)/i);
    return {
      title: heading.title,
      start: heading.start,
      content,
      status:
        statusMatch?.[1] !== undefined
          ? statusMatch[1].trim().toLowerCase()
          : null,
    };
  });
}

/** Detect whether a footgun section has file:line or (search: ...) evidence. */
function hasSectionEvidence(content: string): boolean {
  return EVIDENCE_PATTERN.test(content) || /\(search:/i.test(content);
}

/** Check one active footgun section for placement, evidence, and retired-file patterns. */
function diagnoseActiveSection(
  section: FootgunSection,
  path: string,
  resolvedIndex: number,
): string[] {
  const out: string[] = [];
  if (resolvedIndex !== -1 && section.start > resolvedIndex) {
    out.push(
      `${path} has active footgun "${section.title}" below ## Resolved Entries`,
    );
  }
  if (!hasSectionEvidence(section.content)) {
    out.push(
      `${path} active footgun "${section.title}" missing file:line or (search: ...) evidence`,
    );
  }
  const cleaned = stripStrikethrough(section.content);
  if (/\(file retired/i.test(cleaned) || /\bretired in v\d/i.test(cleaned)) {
    out.push(
      `${path} active footgun "${section.title}" uses retired-file evidence`,
    );
  }
  return out;
}

/** Check that resolved footguns live below the bucket's resolved marker. */
function diagnoseResolvedSection(
  section: FootgunSection,
  path: string,
  resolvedIndex: number,
): string[] {
  if (resolvedIndex === -1) {
    return [
      `${path} has resolved footgun "${section.title}" but no ## Resolved Entries marker`,
    ];
  }
  if (section.start < resolvedIndex) {
    return [
      `${path} has resolved footgun "${section.title}" above ## Resolved Entries`,
    ];
  }
  return [];
}

/** Check one footgun section's schema + (if active) its placement and evidence. */
function diagnoseFootgunSection(
  section: FootgunSection,
  path: string,
  resolvedIndex: number,
): string[] {
  if (section.status === null) {
    return [`${path} footgun "${section.title}" missing Status field`];
  }
  // Schema: status must be exactly "active" or "resolved" (machine-simple per footguns/README.md:14)
  if (section.status !== "active" && section.status !== "resolved") {
    return [
      `${path} footgun "${section.title}" has non-canonical status "${section.status}" (expected "active" or "resolved")`,
    ];
  }
  if (section.status === "active") {
    return diagnoseActiveSection(section, path, resolvedIndex);
  }
  return diagnoseResolvedSection(section, path, resolvedIndex);
}

/** Detect stale active-footgun structure, evidence patterns, and schema violations. */
function collectFootgunStructureDiagnostics(
  path: string,
  content: string,
): string[] {
  const { body } = parseMarkdownFrontmatter(content);
  const resolvedIndex = body.indexOf("## Resolved Entries");
  const sections = splitFootgunSections(body);
  return sections.flatMap((section) =>
    diagnoseFootgunSection(section, path, resolvedIndex),
  );
}

/** Append a category-missing diagnostic when the bucket body requires one. */
function collectCategoryDiagnostic(
  path: string,
  body: string,
  fields: Record<string, string>,
  diagnostics: string[],
): boolean {
  const lessonBuckets = countMatches(body, /^##\s+(?:Lesson|Pattern):\s+/gm);
  const footgunBuckets = countMatches(body, /^##\s+Footgun:\s+/gm);
  const isBucket = lessonBuckets > 0 || footgunBuckets > 0;

  if (!fields.category && lessonBuckets > 0) {
    diagnostics.push(
      `${path} is a lessons category bucket but missing frontmatter category`,
    );
  }
  if (!fields.category && footgunBuckets > 0) {
    diagnostics.push(
      `${path} is a footguns category bucket but missing frontmatter category`,
    );
  }
  return isBucket;
}

/** Append a last_reviewed diagnostic when the field is missing or malformed. */
function collectLastReviewedDiagnostic(
  path: string,
  fields: Record<string, string>,
  diagnostics: string[],
): void {
  const raw = fields.last_reviewed;
  if (raw === undefined || raw === "") {
    diagnostics.push(`${path} missing frontmatter last_reviewed`);
    return;
  }
  if (!ISO_DATE_REGEX.test(raw)) {
    diagnostics.push(
      `${path} has invalid last_reviewed format "${raw}" (expected YYYY-MM-DD)`,
    );
  }
}

/** Return a format diagnostic when a lesson or footgun bucket is missing required frontmatter. */
function getMissingFrontmatterDiagnostic(
  path: string,
  content: string,
): string | null {
  const { frontmatter, body } = parseMarkdownFrontmatter(content);
  if (frontmatter === null) return `${path} missing YAML frontmatter`;

  const fields = parseFrontmatterFields(frontmatter);
  const diagnostics: string[] = [];
  const isBucket = collectCategoryDiagnostic(path, body, fields, diagnostics);
  if (isBucket) collectLastReviewedDiagnostic(path, fields, diagnostics);

  return diagnostics.length === 0 ? null : diagnostics.join("; ");
}

/** Extract the most recent `**Created:**` or `**Updated:**` date from a bucket body.
 *  Returns YYYY-MM-DD or null if no parseable dates are found. Any non-YYYY-MM-DD
 *  value is ignored; malformed dates would already be caught elsewhere. */
function extractMaxEntryDate(body: string): string | null {
  const pattern =
    /\*\*(?:Created|Updated|Resolved):\*\*\s*(\d{4}-\d{2}-\d{2})/gi;
  let max: string | null = null;
  for (const match of body.matchAll(pattern)) {
    const date = match[1];
    if (date === undefined || !ISO_DATE_REGEX.test(date)) continue;
    if (max === null || date > max) max = date;
  }
  return max;
}

/** Build a per-bucket freshness record from one markdown entry. */
function buildBucketFreshness(
  entry: MarkdownEntry,
  entryCount: number,
  staleRefs: string[],
  invalidLineRefs: string[],
  now: Date,
): BucketFreshness {
  const { frontmatter, body } = parseMarkdownFrontmatter(entry.content);
  const fields =
    frontmatter === null ? {} : parseFrontmatterFields(frontmatter);
  const raw = fields.last_reviewed;
  const lastReviewed =
    raw !== undefined && raw !== "" && ISO_DATE_REGEX.test(raw) ? raw : null;
  const { days, band } = computeFreshness(lastReviewed, now);
  const maxEntryDate = extractMaxEntryDate(body);
  return {
    path: entry.path,
    lastReviewed,
    freshnessDays: days,
    freshnessBand: band,
    entryCount,
    staleRefs,
    invalidLineRefs,
    maxEntryDate,
    sizeBytes: Buffer.byteLength(entry.content, "utf8"),
    lineCount:
      entry.content.split("\n").length - (entry.content.endsWith("\n") ? 1 : 0),
  };
}

/** Aggregate evidence, labels, directory mentions, stale refs, and per-bucket freshness across footgun entries. */
function summarizeFootgunEntries(
  fs: ReadonlyFS,
  entries: MarkdownEntry[],
  now: Date,
): Pick<
  SharedFacts["footguns"],
  | "hasEvidence"
  | "entryCount"
  | "labelCount"
  | "dirMentions"
  | "staleRefs"
  | "invalidLineRefs"
  | "totalRefs"
  | "validRefs"
  | "formatDiagnostic"
  | "buckets"
> {
  const dirMentions = new Map<string, number>();
  const staleRefs: string[] = [];
  const invalidLineRefs: string[] = [];
  const diagnostics: string[] = [];
  const buckets: BucketFreshness[] = [];
  let hasEvidence = false;
  let entryCount = 0;
  let labelCount = 0;
  let totalRefs = 0;
  let validRefs = 0;

  for (const entry of entries) {
    const { content, path } = entry;
    const bucketEntryCount = countFootgunEntries(content);
    entryCount += bucketEntryCount;
    labelCount += countFootgunLabels(content);
    hasEvidence ||= hasFootgunEvidence(content);
    mergeDirMentions(dirMentions, content);
    const refSummary = summarizeFootgunRefs(fs, content);
    totalRefs += refSummary.totalRefs;
    validRefs += refSummary.validRefs;
    staleRefs.push(...refSummary.staleRefs);
    invalidLineRefs.push(...refSummary.invalidLineRefs);
    const diagnostic = getMissingFrontmatterDiagnostic(path, content);
    if (diagnostic) diagnostics.push(diagnostic);
    diagnostics.push(...collectFootgunStructureDiagnostics(path, content));
    buckets.push(
      buildBucketFreshness(
        entry,
        bucketEntryCount,
        refSummary.staleRefs,
        refSummary.invalidLineRefs,
        now,
      ),
    );
  }

  return {
    hasEvidence,
    entryCount,
    labelCount,
    dirMentions,
    staleRefs,
    invalidLineRefs,
    totalRefs,
    validRefs,
    formatDiagnostic: diagnostics.length > 0 ? diagnostics.join("; ") : null,
    buckets,
  };
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

/** Aggregate entry counts, stale refs, diagnostics, and per-bucket freshness across lesson entries. */
function summarizeLessonEntries(
  fs: ReadonlyFS,
  entries: MarkdownEntry[],
  now: Date,
): Pick<
  SharedFacts["lessons"],
  | "entryCount"
  | "staleRefs"
  | "invalidLineRefs"
  | "formatDiagnostic"
  | "buckets"
> {
  const staleRefs: string[] = [];
  const invalidLineRefs: string[] = [];
  const diagnostics: string[] = [];
  const buckets: BucketFreshness[] = [];
  let entryCount = 0;

  for (const entry of entries) {
    const { content, path } = entry;
    const bucketEntryCount = countLessonEntries(content);
    entryCount += bucketEntryCount;
    const pathPattern =
      /`((?:src|config|app|apps|lib|docs|scripts|setup|workflow|agents|\.goat-flow)\/[^`]+)`/g;
    const bucketStaleRefs: string[] = [];
    const bucketInvalidLineRefs: string[] = [];
    // Strip strikethrough history (~~resolved~~) before scanning for stale refs,
    // mirroring the footgun extractor.
    const cleanedContent = stripStrikethrough(content);
    for (const match of cleanedContent.matchAll(pathPattern)) {
      const ref = match[1];
      // Skip glob wildcards (`*`, `?`, `{}`), angle-bracket placeholders
      // (`<date>`, `<agent>`), and ellipsis elisions (`workflow/...`): none of
      // these are concrete file refs that can be validated against the filesystem.
      if (ref === undefined || /[*?{}<>]|\.\.\./.test(ref)) continue;
      const filePath = ref.replace(/:[0-9]+(?:[-,][0-9]+)*$/, "");
      // Gitignored-by-design paths (.goat-flow/tasks, scratchpad, logs) are
      // navigation pointers, not committed artifacts - don't flag them stale.
      if (isIntentionallyGitignored(filePath)) continue;
      if (!fs.exists(filePath)) bucketStaleRefs.push(filePath);
    }
    bucketInvalidLineRefs.push(
      ...collectInvalidLessonLineRefs(fs, cleanedContent),
    );
    const anchorSummary: FootgunRefSummary = {
      staleRefs: [],
      invalidLineRefs: [],
      totalRefs: 0,
      validRefs: 0,
    };
    scanSearchAnchors(fs, cleanedContent, anchorSummary);
    bucketStaleRefs.push(...anchorSummary.staleRefs);
    staleRefs.push(...bucketStaleRefs);
    invalidLineRefs.push(...bucketInvalidLineRefs);
    const diagnostic = getMissingFrontmatterDiagnostic(path, content);
    if (diagnostic) diagnostics.push(diagnostic);
    buckets.push(
      buildBucketFreshness(
        entry,
        bucketEntryCount,
        bucketStaleRefs,
        bucketInvalidLineRefs,
        now,
      ),
    );
  }

  return {
    entryCount,
    staleRefs,
    invalidLineRefs,
    formatDiagnostic: diagnostics.length > 0 ? diagnostics.join("; ") : null,
    buckets,
  };
}

/** Extract footgun facts: existence, evidence quality, directory mention counts, and per-bucket freshness. */
export function extractFootgunFacts(
  fs: ReadonlyFS,
  configState: LoadedConfig,
  now: Date = new Date(),
): SharedFacts["footguns"] {
  const dir = listMarkdownEntries(fs, configState.config.footguns.path);
  const summary = summarizeFootgunEntries(fs, dir.files, now);
  const formatDiagnostic =
    summary.entryCount === 0 && dir.exists
      ? "Footgun directory exists but contains 0 entries"
      : summary.formatDiagnostic;

  return {
    exists: dir.exists,
    hasEvidence: summary.hasEvidence,
    entryCount: summary.entryCount,
    labelCount: summary.labelCount,
    hasEvidenceLabels:
      summary.entryCount > 0 && summary.labelCount >= summary.entryCount,
    dirMentions: summary.dirMentions,
    staleRefs: summary.staleRefs,
    invalidLineRefs: summary.invalidLineRefs,
    duplicateSurfacePaths: findCompetingArtifactSurfaces(
      fs,
      [configState.config.footguns.path],
      FOOTGUN_SURFACE_CANDIDATES,
    ),
    totalRefs: summary.totalRefs,
    validRefs: summary.validRefs,
    formatDiagnostic,
    path: configState.config.footguns.path,
    buckets: summary.buckets,
  };
}

/** Extract lessons facts: existence, entry presence, and per-bucket freshness. */
export function extractLessonsFacts(
  fs: ReadonlyFS,
  configState: LoadedConfig,
  now: Date = new Date(),
): SharedFacts["lessons"] {
  const dir = listMarkdownEntries(fs, configState.config.lessons.path);
  const summary = summarizeLessonEntries(fs, dir.files, now);
  const formatDiagnostic =
    summary.entryCount === 0 && dir.exists
      ? "Lesson directory exists but contains 0 entries"
      : summary.formatDiagnostic;

  return {
    exists: dir.exists,
    hasEntries: summary.entryCount > 0,
    entryCount: summary.entryCount,
    staleRefs: summary.staleRefs,
    invalidLineRefs: summary.invalidLineRefs,
    duplicateSurfacePaths: findCompetingArtifactSurfaces(
      fs,
      [configState.config.lessons.path],
      LESSON_SURFACE_CANDIDATES,
    ),
    formatDiagnostic,
    path: configState.config.lessons.path,
    buckets: summary.buckets,
  };
}
