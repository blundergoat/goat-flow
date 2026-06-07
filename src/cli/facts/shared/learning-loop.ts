/**
 * Footgun and lesson fact extractors for the learning-loop system.
 * Analyzes category-bucket markdown files for evidence quality, entry counts, and stale references.
 */
import type { SharedFacts, ReadonlyFS, BucketFreshness } from "../../types.js";
import type { LoadedConfig } from "../../config/types.js";
import {
  EVIDENCE_PATTERN,
  FILE_REF_REGEX,
  ISO_DATE_REGEX,
  type MarkdownEntry,
  computeFreshness,
  countMatches,
  findCompetingArtifactSurfaces,
  isFileRef,
  listMarkdownEntries,
  parseFrontmatterFields,
  parseMarkdownFrontmatter,
  summarizeFootgunRefs,
  summarizeLessonRefs,
} from "./learning-loop-common.js";
import { collectFootgunStructureDiagnostics } from "./learning-loop-sections.js";

export {
  computeFreshness,
  parseFrontmatterFields,
} from "./learning-loop-common.js";
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

/** Count `## Lesson:` or `## Pattern:` bucket entries in one markdown file. */
function countLessonEntries(content: string): number {
  const { body } = parseMarkdownFrontmatter(content);
  const bucketCount = countMatches(body, /^##\s+(?:Lesson|Pattern):\s+/gm);
  return bucketCount > 0 ? bucketCount : 1;
}

/** Count active footgun sections, preserving legacy single-entry files as one entry. */
function countFootgunEntries(content: string): number {
  const { body } = parseMarkdownFrontmatter(content);
  const bucketCount = countMatches(body, /^##\s+Footgun:\s+/gm);
  return bucketCount > 0 ? bucketCount : 1;
}

/** Count footgun evidence labels so stats can compare labels to entry count. */
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
 */
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

/**
 * Extract lessons facts: existence, entry presence, and per-bucket freshness.
 *
 * @param fs - filesystem adapter for the target project
 * @param configState - loaded config that chooses the lessons artifact path
 * @param now - comparison clock for deterministic bucket freshness
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
