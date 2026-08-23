/**
 * Reads the user's learning loop, the footgun and lesson bucket files where their agent's past mistakes are supposed to become permanent knowledge.
 *
 * These facts answer what the dashboard Home card shows: how many entries exist, how stale they are, and which references no longer resolve.
 *
 * Bucket files are read rather than individual entries, because:
 * - the loop stores many entries per category file, so counting files would understate the real total
 * - a stale reference matters per entry, so each one is located and reported separately
 */
import type {
  SharedFacts,
  ReadonlyFS,
  BucketFreshness,
  GraduationCandidate,
} from "../../types.js";
import type { LoadedConfig } from "../../config/types.js";
import {
  EVIDENCE_PATTERN,
  FILE_REF_REGEX,
  ISO_DATE_REGEX,
  type MarkdownEntry,
  computeFreshness,
  countMatches,
  findCompetingArtifactSurfaces,
  listMarkdownEntries,
  parseFrontmatterFields,
  parseMarkdownFrontmatter,
  summarizeFootgunRefs,
  summarizeLessonRefs,
} from "./learning-loop-common.js";
import {
  collectFootgunStructureDiagnostics,
  splitFootgunSections,
} from "./learning-loop-sections.js";
import { extractIncidentCount } from "./learning-loop-entries.js";
import { isFileRef } from "./reference-paths.js";

export { extractLearningLoopEntries } from "./learning-loop-entries.js";

/** Known filesystem locations where footgun artifacts may appear. */
const FOOTGUN_SURFACE_CANDIDATES = [
  ".goat-flow/learning-loop/footguns/",
  "docs/footguns.md",
];
/** Known filesystem locations where lesson artifacts may appear. */
const LESSON_SURFACE_CANDIDATES = [
  ".goat-flow/learning-loop/lessons/",
  "docs/lessons/",
  "docs/lessons.md",
];
/** Exact evidence labels accepted by current learning-loop templates. */
const CANONICAL_EVIDENCE_LABELS = new Set([
  "ACTUAL_MEASURED",
  "OBSERVED",
  "EXTERNAL_REFERENCE",
]);
/** Label-like standalone values; narrative evidence text is not taxonomy metadata. */
const EVIDENCE_LABEL_VALUE_PATTERN =
  /^[A-Za-z_]+(?:[ \t]*\|[ \t]*[A-Za-z_]+)*$/;
/** Evidence taxonomy value embedded in the required Status metadata line. */
const STATUS_EVIDENCE_VALUE_PATTERN =
  /^\*\*Status:\*\*.*?\*\*Evidence:\*\*[ \t]*(.+?)[ \t]*$/;
/** Explicit legacy evidence-type metadata line. */
const TYPED_EVIDENCE_VALUE_PATTERN =
  /^\*\*Evidence[ \t]+type:\*\*[ \t]*(.+?)[ \t]*$/;
/** Standalone Evidence line, accepted only when its value is label-shaped. */
const STANDALONE_EVIDENCE_VALUE_PATTERN =
  /^\*\*Evidence:\*\*[ \t]*(.+?)[ \t]*$/;

/** Count `## Lesson:` or `## Pattern:` bucket entries in one markdown file. */
function countLessonEntries(content: string): number {
  const { body } = parseMarkdownFrontmatter(content);
  return countMatches(body, /^##\s+(?:Lesson|Pattern):\s+/gm);
}

/** Count only explicit footgun sections that generated INDEX-first retrieval can reach. */
function countFootgunEntries(content: string): number {
  const { body } = parseMarkdownFrontmatter(content);
  return countMatches(body, /^##\s+Footgun:\s+/gm);
}

/** Count footgun evidence labels so stats can compare labels to entry count. */
function countFootgunLabels(content: string): number {
  const { body } = parseMarkdownFrontmatter(content);
  const sections = splitFootgunSections(body);
  if (sections.length > 0)
    return sections.filter((section) => hasEvidenceLabel(section.content))
      .length;
  return 0;
}

/** Explain a bucket whose entries do not each carry one canonical evidence label. */
function getEvidenceLabelDiagnostic(
  path: string,
  entryCount: number,
  labelCount: number,
): string | null {
  if (entryCount === 0 || labelCount === entryCount) return null;
  return `${path}: invalid evidence-label count: ${labelCount} of ${entryCount} footgun entries have exactly one canonical evidence label`;
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

/** Extract and normalize one captured metadata value. */
function matchEvidenceValue(line: string, pattern: RegExp): string | null {
  return line.match(pattern)?.[1]?.trim() || null;
}

/** Extract taxonomy metadata from one Markdown line without consuming narrative evidence. */
function extractMarkdownEvidenceLabel(line: string): string | null {
  const explicitValue =
    matchEvidenceValue(line, STATUS_EVIDENCE_VALUE_PATTERN) ??
    matchEvidenceValue(line, TYPED_EVIDENCE_VALUE_PATTERN);
  if (explicitValue !== null) return explicitValue;

  const standaloneValue = matchEvidenceValue(
    line,
    STANDALONE_EVIDENCE_VALUE_PATTERN,
  );
  return standaloneValue !== null &&
    EVIDENCE_LABEL_VALUE_PATTERN.test(standaloneValue)
    ? standaloneValue
    : null;
}

/** Return every non-empty frontmatter or Markdown evidence-label declaration. */
function extractEvidenceLabelValues(content: string): string[] {
  const { frontmatter, body } = parseMarkdownFrontmatter(content);
  const markdownValues = body
    .split(/\r?\n/)
    .map(extractMarkdownEvidenceLabel)
    .filter((value): value is string => value !== null);
  if (frontmatter === null) return markdownValues;

  const frontmatterValue =
    parseFrontmatterFields(frontmatter).evidence_type?.trim() || null;
  return frontmatterValue === null
    ? markdownValues
    : [frontmatterValue, ...markdownValues];
}

/** Detect exactly one canonical evidence label on a footgun entry. */
function hasEvidenceLabel(content: string): boolean {
  const declaredValues = extractEvidenceLabelValues(content);
  return (
    declaredValues.length === 1 &&
    CANONICAL_EVIDENCE_LABELS.has(declaredValues[0] ?? "")
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

/**
 * Reports a bucket that carries entries but no `category:` field, which is the metadata the stats check and the dashboard group memories by.
 *
 * @param path - project-relative bucket path named in any diagnostic
 * @param body - bucket text after frontmatter, scanned for entry headings
 * @param fields - parsed frontmatter fields; a missing category is what triggers the diagnostic
 * @param diagnostics - diagnostic list appended to in place
 * @returns true when the file holds lesson, pattern, or footgun entries, which tells the caller to check the review date as well
 */
function collectCategoryDiagnostic(
  path: string,
  body: string,
  fields: Record<string, string>,
  diagnostics: string[],
): boolean {
  const lessonBuckets = countMatches(body, /^##\s+(?:Lesson|Pattern):\s+/gm);
  const footgunBuckets = countMatches(body, /^##\s+Footgun:\s+/gm);
  const isBucket = lessonBuckets > 0 || footgunBuckets > 0;

  // A lessons bucket without a category cannot be routed, so the user is told which file to label.
  if (!fields.category && lessonBuckets > 0) {
    diagnostics.push(
      `${path} is a lessons category bucket but missing frontmatter category`,
    );
  }
  // Same rule for footguns, reported separately so the message names the right bucket kind.
  if (!fields.category && footgunBuckets > 0) {
    diagnostics.push(
      `${path} is a footguns category bucket but missing frontmatter category`,
    );
  }
  return isBucket;
}

/**
 * Reports a bucket whose review date is missing or unreadable, since freshness banding is what tells a user their memory has gone stale.
 *
 * @param path - project-relative bucket path named in any diagnostic
 * @param fields - parsed frontmatter fields
 * @param diagnostics - diagnostic list appended to in place; left untouched when the date is present and well formed
 */
function collectLastReviewedDiagnostic(
  path: string,
  fields: Record<string, string>,
  diagnostics: string[],
): void {
  const raw = fields.last_reviewed;
  // No date at all, so the bucket can never be banded and the user is told to add one.
  if (raw === undefined || raw === "") {
    diagnostics.push(`${path} missing frontmatter last_reviewed`);
    return;
  }
  // A date in the wrong shape is worse than none, because it reads as reviewed while parsing to nothing.
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

/** Count recognized line-start recurrence labels without interpreting dates or quantities in prose. */
function countRecurrenceLabels(entryContent: string): number {
  return Array.from(
    entryContent.matchAll(/^\*\*([^*\r\n]+):\*\*/gm),
    (labelMatch) => labelMatch[1]?.trim() ?? "",
  ).filter(
    (label) =>
      /\brecurrences?\b/i.test(label) || /^Repeat incident\b/i.test(label),
  ).length;
}

/**
 * Collect feedback-loop graduation candidates from one bucket body.
 *
 * Declared incident totals preserve consolidated histories, while line-start recurrence labels preserve individual incident evidence. The larger
 * total wins so an under-declared total cannot hide stronger prose evidence. Resolved entries are skipped because their trap is closed.
 *
 * The result is report-only `stats` data - never a `--check` finding - so the existing corpus cannot turn the gate into permanent warning noise.
 *
 * @param body Bucket markdown body with frontmatter already stripped.
 * @returns Active entries with at least two effective incidents, in file order.
 */
function collectGraduationCandidates(body: string): GraduationCandidate[] {
  const candidates: GraduationCandidate[] = [];
  for (const section of body.split(/^(?=##\s)/m)) {
    const heading = section.match(/^##\s+(?:Footgun|Lesson|Pattern):\s*(.+)/);
    if (heading?.[1] === undefined) continue;
    if (/^\*\*Status:\*\*\s*resolved\b/im.test(section)) continue;
    const recurrenceCount = countRecurrenceLabels(section);
    const observedIncidentCount = recurrenceCount + 1;
    const declaredIncidentCount = extractIncidentCount(section);
    const incidentCount = Math.max(
      declaredIncidentCount ?? 0,
      observedIncidentCount,
    );
    if (incidentCount < 2) continue;
    candidates.push({
      title: heading[1].trim(),
      recurrenceCount,
      declaredIncidentCount,
      incidentCount,
      hasIncidentCountDivergence:
        declaredIncidentCount !== null &&
        declaredIncidentCount < observedIncidentCount,
    });
  }
  return candidates;
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
    graduationCandidates: collectGraduationCandidates(body),
  };
}

/**
 * Roll every footgun bucket into the one summary the audit and dashboard read: evidence quality, reference health, and freshness per bucket.
 *
 * Format problems are collected as diagnostics rather than thrown, so one malformed bucket still leaves the user a complete report.
 *
 * @param fs - read-only view of the target project
 * @param entries - footgun bucket files found on disk; an empty list yields zero counts, which the caller reads as an unused loop
 * @param now - comparison clock, passed in so freshness bands stay deterministic in tests and reports
 * @returns the aggregated footgun facts, with a null `formatDiagnostic` when every bucket parsed cleanly
 */
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
    const bucketLabelCount = countFootgunLabels(content);
    entryCount += bucketEntryCount;
    labelCount += bucketLabelCount;
    hasEvidence ||= hasFootgunEvidence(content);
    mergeDirMentions(dirMentions, content);
    const refSummary = summarizeFootgunRefs(fs, content);
    totalRefs += refSummary.totalRefs;
    validRefs += refSummary.validRefs;
    staleRefs.push(...refSummary.staleRefs);
    invalidLineRefs.push(...refSummary.invalidLineRefs);
    const diagnostic = getMissingFrontmatterDiagnostic(path, content);
    if (diagnostic) diagnostics.push(diagnostic);
    const evidenceLabelDiagnostic = getEvidenceLabelDiagnostic(
      path,
      bucketEntryCount,
      bucketLabelCount,
    );
    if (evidenceLabelDiagnostic) diagnostics.push(evidenceLabelDiagnostic);
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

/**
 * Roll every lesson bucket into one summary of counts, reference health, and freshness.
 *
 * Format problems are collected as diagnostics rather than thrown, so one malformed bucket still leaves the user a complete report.
 *
 * @param fs - read-only view of the target project
 * @param entries - lesson bucket files found on disk; an empty list yields zero counts, which the caller reads as an unused loop
 * @param now - comparison clock, passed in so freshness bands stay deterministic in tests and reports
 * @returns the aggregated lesson facts, with a null `formatDiagnostic` when every bucket parsed cleanly
 */
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
    const refSummary = summarizeLessonRefs(fs, content);
    staleRefs.push(...refSummary.staleRefs);
    invalidLineRefs.push(...refSummary.invalidLineRefs);
    const diagnostic = getMissingFrontmatterDiagnostic(path, content);
    if (diagnostic) diagnostics.push(diagnostic);
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
    entryCount,
    staleRefs,
    invalidLineRefs,
    formatDiagnostic: diagnostics.length > 0 ? diagnostics.join("; ") : null,
    buckets,
  };
}

/**
 * Extract footgun facts: existence, evidence quality, directory mention counts, and per-bucket freshness.
 *
 * @param fs - filesystem adapter for the target project
 * @param configState - loaded config that chooses the footgun artifact path
 * @param now - comparison clock for deterministic bucket freshness
 * @returns the footgun facts for this project; `exists: false` means the user has no footgun directory yet, which reads differently from an
 *   existing directory holding zero entries
 */
export function extractFootgunFacts(
  fs: ReadonlyFS,
  configState: LoadedConfig,
  now: Date = new Date(),
): SharedFacts["footguns"] {
  const dir = listMarkdownEntries(fs, configState.config.footguns.path);
  const summary = summarizeFootgunEntries(fs, dir.files, now);
  // An empty-but-present directory is its own finding: the user set the loop up and then never wrote to it.
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
      summary.entryCount > 0 && summary.labelCount === summary.entryCount,
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

/**
 * Extract lessons facts: existence, entry presence, and per-bucket freshness.
 *
 * @param fs - filesystem adapter for the target project
 * @param configState - loaded config that chooses the lessons artifact path
 * @param now - comparison clock for deterministic bucket freshness
 * @returns the lesson facts for this project; `exists: false` means the user has no lessons directory yet, which reads differently from an
 *   existing directory holding zero entries
 */
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
