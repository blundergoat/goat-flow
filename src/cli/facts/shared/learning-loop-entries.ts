/**
 * Builds the compact, ranked list of learning-loop entries (footguns, lessons,
 * patterns, decisions) used for bounded prompt retrieval - each bucket file is
 * split into sections, summarized into a small fact with a byte-capped excerpt,
 * and tagged with reference-validation results.
 *
 * The final ordering is deterministic by design (kind, then newest-first by
 * updated/created date, then path, then discovery order) so prompt context is
 * stable across runs and machines. The per-kind order offsets (0, 10k, 20k, 30k)
 * are tiebreak seeds that keep entries from different buckets from interleaving
 * unpredictably; they are not limits on entry count.
 */
import type {
  LearningLoopEntryFact,
  LearningLoopEntryKind,
  ReadonlyFS,
} from "../../types.js";
import type { LoadedConfig } from "../../config/types.js";
import {
  type EntryDir,
  listMarkdownEntries,
  parseMarkdownFrontmatter,
  summarizeFootgunRefs,
  summarizeLessonRefs,
} from "./learning-loop-common.js";
import { isDecisionRecordMarkdown } from "./decision-files.js";
import { splitFootgunSections } from "./learning-loop-sections.js";

/** Extract one metadata date from an entry body. */
function extractEntryDate(
  content: string,
  label: "Created" | "Updated" | "Resolved" | "Date",
): string | null {
  const match = content.match(
    new RegExp(`\\*\\*${label}:\\*\\*\\s*(\\d{4}-\\d{2}-\\d{2})`, "i"),
  );
  return match?.[1] ?? null;
}

/** Return the first markdown heading, or a stable filename fallback. */
function firstHeadingTitle(content: string, fallback: string): string {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading?.length ? heading : fallback;
}

/** Return the last slash-delimited path segment. */
function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

/** Strip light markdown syntax and metadata for prompt-safe excerpts. */
function compactEntryExcerpt(content: string, maxBytes = 900): string {
  const cleaned = content
    .replace(/^##\s+(?:Footgun|Lesson|Pattern):\s+.+$/gm, "")
    .replace(/^#\s+.+$/gm, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        line !== "---" &&
        !/^\*\*Status:\*\*/i.test(line) &&
        !/^>/.test(line),
    )
    .join(" ")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (Buffer.byteLength(cleaned, "utf8") <= maxBytes) return cleaned;

  let out = "";
  for (const char of cleaned) {
    const next = out + char;
    if (Buffer.byteLength(next + "...", "utf8") > maxBytes) break;
    out = next;
  }
  return `${out.trimEnd()}...`;
}

/** Date used for deterministic newest-first ranking. */
function entrySortDate(
  entry: Pick<LearningLoopEntryFact, "updated" | "created">,
) {
  return entry.updated ?? entry.created ?? null;
}

/** Parsed lesson/pattern section with its inferred learning-loop entry kind. */
interface LearningSection {
  title: string;
  kind: LearningLoopEntryKind;
  start: number;
  content: string;
}

/** Split lessons/patterns buckets into individual markdown sections. */
function splitLearningSections(
  body: string,
  defaultKind: "lesson" | "pattern",
): LearningSection[] {
  const headings = Array.from(
    body.matchAll(/^##\s+(Lesson|Pattern):\s+(.+)$/gm),
    (match) => ({
      kind:
        (match[1] ?? defaultKind).toLowerCase() === "pattern"
          ? "pattern"
          : defaultKind,
      title: (match[2] ?? "").trim(),
      start: match.index,
    }),
  );
  return headings.map((heading, index) => {
    const end = headings[index + 1]?.start ?? body.length;
    return {
      ...heading,
      content: body.slice(heading.start, end),
    };
  });
}

/** Build compact entry facts from footgun buckets. */
function extractFootgunEntries(
  fs: ReadonlyFS,
  dir: EntryDir,
  startOrder: number,
): LearningLoopEntryFact[] {
  let order = startOrder;
  const entries: LearningLoopEntryFact[] = [];
  for (const file of dir.files) {
    const { body } = parseMarkdownFrontmatter(file.content);
    const bucketSizeBytes = Buffer.byteLength(file.content, "utf8");
    for (const section of splitFootgunSections(body)) {
      const refs = summarizeFootgunRefs(fs, section.content);
      entries.push({
        sourcePath: file.path,
        kind: "footgun",
        title: section.title,
        status:
          section.status === "active" || section.status === "resolved"
            ? section.status
            : null,
        created: extractEntryDate(section.content, "Created"),
        updated: extractEntryDate(section.content, "Updated"),
        resolved: extractEntryDate(section.content, "Resolved"),
        excerpt: compactEntryExcerpt(section.content),
        staleRefs: refs.staleRefs,
        invalidLineRefs: refs.invalidLineRefs,
        hasValidAnchor: refs.validRefs > 0,
        bucketSizeBytes,
        order: order++,
      });
    }
  }
  return entries;
}

/** Build compact entry facts from lessons or patterns buckets. */
function extractLessonLikeEntries(
  fs: ReadonlyFS,
  dir: EntryDir,
  defaultKind: "lesson" | "pattern",
  startOrder: number,
): LearningLoopEntryFact[] {
  let order = startOrder;
  const entries: LearningLoopEntryFact[] = [];
  for (const file of dir.files) {
    const { body } = parseMarkdownFrontmatter(file.content);
    const bucketSizeBytes = Buffer.byteLength(file.content, "utf8");
    for (const section of splitLearningSections(body, defaultKind)) {
      const refs = summarizeLessonRefs(fs, section.content);
      entries.push({
        sourcePath: file.path,
        kind: section.kind,
        title: section.title,
        status: null,
        created: extractEntryDate(section.content, "Created"),
        updated: extractEntryDate(section.content, "Updated"),
        resolved: extractEntryDate(section.content, "Resolved"),
        excerpt: compactEntryExcerpt(section.content),
        staleRefs: refs.staleRefs,
        invalidLineRefs: refs.invalidLineRefs,
        hasValidAnchor: refs.validRefs > 0,
        bucketSizeBytes,
        order: order++,
      });
    }
  }
  return entries;
}

/** Build compact entry facts from ADR files. */
function extractDecisionEntries(
  dir: EntryDir,
  startOrder: number,
): LearningLoopEntryFact[] {
  let order = startOrder;
  return dir.files
    .filter((file) => isDecisionRecordMarkdown(basename(file.path)))
    .map((file) => {
      const filename = basename(file.path);
      return {
        sourcePath: file.path,
        kind: "decision" as const,
        title: firstHeadingTitle(
          file.content,
          filename.replace(/\.md$/i, "").replace(/^ADR-\d+-/, ""),
        ),
        status: null,
        created: extractEntryDate(file.content, "Date"),
        updated: extractEntryDate(file.content, "Updated"),
        resolved: null,
        excerpt: compactEntryExcerpt(file.content),
        staleRefs: [],
        invalidLineRefs: [],
        hasValidAnchor: true,
        bucketSizeBytes: Buffer.byteLength(file.content, "utf8"),
        order: order++,
      };
    });
}

/**
 * Extract compact learning-loop entries for bounded prompt retrieval.
 *
 * @param fs - filesystem adapter for the target project
 * @param configState - loaded config with footgun, lesson, and decision paths
 * @returns ordered compact entries suitable for prompt context selection
 */
export function extractLearningLoopEntries(
  fs: ReadonlyFS,
  configState: LoadedConfig,
): LearningLoopEntryFact[] {
  const footgunDir = listMarkdownEntries(fs, configState.config.footguns.path);
  const lessonDir = listMarkdownEntries(fs, configState.config.lessons.path);
  const patternDir = listMarkdownEntries(
    fs,
    ".goat-flow/learning-loop/patterns/",
  );
  const decisionDir = listMarkdownEntries(
    fs,
    configState.config.decisions.path,
  );
  const entries = [
    ...extractFootgunEntries(fs, footgunDir, 0),
    ...extractLessonLikeEntries(fs, lessonDir, "lesson", 10_000),
    ...extractLessonLikeEntries(fs, patternDir, "pattern", 20_000),
    ...extractDecisionEntries(decisionDir, 30_000),
  ];
  return entries.sort((left, right) => {
    const kindDiff = left.kind.localeCompare(right.kind);
    if (kindDiff !== 0) return kindDiff;
    const dateDiff = (entrySortDate(right) ?? "").localeCompare(
      entrySortDate(left) ?? "",
    );
    if (dateDiff !== 0) return dateDiff;
    const pathDiff = left.sourcePath.localeCompare(right.sourcePath);
    if (pathDiff !== 0) return pathDiff;
    return left.order - right.order;
  });
}
