/**
 * Parses learning-loop bucket markdown into the entry list behind generated INDEX.md files.
 * One parser covers all four buckets: footguns/lessons/patterns split per `## <Kind>:` heading
 * (skipping `## Resolved Entries` sections and `**Status:** resolved` entries), while decisions
 * derive one entry per ADR file. Hooks are extracted mechanically - first sentence of the
 * bucket-specific lead paragraph - so regeneration stays deterministic and never needs
 * hand-curated metadata. Nothing here reads the clock; `index-fresh` re-runs this parser and
 * diffs, so any time-derived output would break freshness detection.
 */
import type { ReadonlyFS } from "../types.js";
import type { GoatFlowConfig } from "../config/types.js";
import {
  listMarkdownEntries,
  parseMarkdownFrontmatter,
  type MarkdownEntry,
} from "../facts/shared/learning-loop-common.js";

/** Learning-loop buckets that receive a generated INDEX.md. */
export type IndexBucket = "footguns" | "lessons" | "patterns" | "decisions";

/** Generation order for the four indexed buckets; stable so command output is deterministic. */
export const INDEX_BUCKETS: IndexBucket[] = [
  "footguns",
  "lessons",
  "patterns",
  "decisions",
];

/**
 * One generated index row. The anchor is the entry's verbatim heading line (semantic anchor,
 * never a line number) so `(search: "...")` retrieval survives bucket edits.
 */
export interface IndexEntry {
  /** Entry heading text without the `## <Kind>:` prefix; decisions carry the full H1 text. */
  title: string;
  /** Bucket-relative source file name the row links to (INDEX.md sits in the same directory). */
  sourceFile: string;
  /** Grep needle for the `(search: "...")` anchor - heading line, cut before any embedded quote. */
  anchor: string;
  /** One-sentence routing hook extracted mechanically from the entry body. */
  hook: string;
}

/** Heading keyword per entry-style bucket (`## Footgun:` / `## Lesson:` / `## Pattern:`). */
const HEADING_KIND = {
  footguns: "Footgun",
  lessons: "Lesson",
  patterns: "Pattern",
} as const;

/** Lead-paragraph marker per entry-style bucket; the hook is its first sentence. */
const HOOK_MARKER = {
  footguns: "**Symptoms:**",
  lessons: "**What happened:**",
  patterns: "**Context:**",
} as const;

/** Entries below this marker are resolved history and stay out of the generated index. */
const RESOLVED_MARKER = "## Resolved Entries";

/** Metadata-only paragraphs skipped when falling back to the first body paragraph. */
const METADATA_LABEL =
  /^\*\*(?:Status|Created|Updated|Resolved|Evidence|Date|Related):\*\*/;

/** ADR record filenames; non-ADR files in the decisions dir are a stats finding, not index rows. */
const ADR_FILE = /^ADR-\d{3}-.+\.md$/;

/** Limit rationale: 200 chars keeps index rows scannable in prompt context while preserving detail. */
const HOOK_MAX_CHARS = 200;

/**
 * The patterns bucket has no config.yaml key (unlike footguns/lessons/decisions), so the path is
 * fixed by convention - the same convention `extractLearningLoopEntries` already relies on.
 */
const PATTERNS_BUCKET_PATH = ".goat-flow/learning-loop/patterns/";

/**
 * Resolve the four indexed bucket directories from loaded project config.
 *
 * @param config - validated goat-flow config carrying the footguns/lessons/decisions paths
 * @returns bucket-keyed relative directory paths; patterns falls back to the fixed convention path
 */
export function resolveIndexBucketPaths(
  config: GoatFlowConfig,
): Record<IndexBucket, string> {
  return {
    footguns: config.footguns.path,
    lessons: config.lessons.path,
    patterns: PATTERNS_BUCKET_PATH,
    decisions: config.decisions.path,
  };
}

/** Return the file name from a POSIX-joined entry path. */
function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

/** Cut a heading line before any embedded double quote so the search needle stays greppable. */
function searchNeedle(headingLine: string): string {
  const quote = headingLine.indexOf('"');
  return quote === -1 ? headingLine : headingLine.slice(0, quote).trimEnd();
}

/**
 * Extract the first sentence of a paragraph, collapsing whitespace and truncating run-ons at a
 * word boundary. The sentence break requires a capital/backtick/quote follow-up so file names
 * like `cli.ts` inside a sentence do not split it early. Bold markers are stripped because a
 * sentence cut can otherwise leave an unbalanced `**` pair in the rendered row.
 */
function firstSentence(text: string): string {
  const collapsed = text.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  const sentence =
    collapsed.split(/(?<=[.!?])\s+(?=[A-Z`"([])/)[0] ?? collapsed;
  if (sentence.length <= HOOK_MAX_CHARS) return sentence;
  const cut = sentence.slice(0, HOOK_MAX_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : HOOK_MAX_CHARS)}…`;
}

/** Return the first paragraph following a literal marker, or null when the marker is absent. */
function paragraphAfter(content: string, marker: string): string | null {
  const idx = content.indexOf(marker);
  if (idx === -1) return null;
  const after = content.slice(idx + marker.length).trimStart();
  const paragraph = (after.split(/\n\s*\n/)[0] ?? "").trim();
  return paragraph.length > 0 ? paragraph : null;
}

/** First non-metadata body paragraph, with any leading `**Label:**` stripped - the hook fallback. */
function firstBodyParagraph(content: string): string {
  const withoutHeading = content.replace(/^#{1,2}[^\n]*\n/, "");
  for (const raw of withoutHeading.split(/\n\s*\n/)) {
    const paragraph = raw.trim();
    if (paragraph.length === 0 || METADATA_LABEL.test(paragraph)) continue;
    return paragraph.replace(/^\*\*[^*\n]+:\*\*\s*/, "");
  }
  return "";
}

/** One `## <Kind>:` section sliced out of a bucket body with its heading line preserved. */
interface RawSection {
  title: string;
  headingLine: string;
  start: number;
  content: string;
}

/** Slice a bucket body at each `## <Kind>:` heading into document-ordered sections. */
function splitEntrySections(body: string, kind: string): RawSection[] {
  const headingPattern = new RegExp(`^##\\s+${kind}:\\s+(.+)$`, "gm");
  const headings = Array.from(body.matchAll(headingPattern), (match) => ({
    title: (match[1] ?? "").trim(),
    headingLine: match[0],
    start: match.index,
  }));
  return headings.map((heading, index) => ({
    ...heading,
    content: body.slice(
      heading.start,
      headings[index + 1]?.start ?? body.length,
    ),
  }));
}

/** Parse one footgun/lesson/pattern bucket file into active-entry index rows. */
function parseEntryFile(
  file: MarkdownEntry,
  bucket: Exclude<IndexBucket, "decisions">,
): IndexEntry[] {
  const { body } = parseMarkdownFrontmatter(file.content);
  const resolvedAt = body.indexOf(RESOLVED_MARKER);
  const sourceFile = baseName(file.path);
  return splitEntrySections(body, HEADING_KIND[bucket])
    .filter((section) => resolvedAt === -1 || section.start < resolvedAt)
    .filter((section) => !/\*\*Status:\*\*\s*resolved\b/i.test(section.content))
    .map((section) => ({
      title: section.title,
      sourceFile,
      anchor: searchNeedle(section.headingLine),
      hook: firstSentence(
        paragraphAfter(section.content, HOOK_MARKER[bucket]) ??
          firstBodyParagraph(section.content),
      ),
    }));
}

/** Read the status/date prefix for one ADR index hook. */
function decisionStatusPart(body: string): string {
  const status = firstSentence(
    body.match(/^\*\*Status:\*\*\s*(.+)$/m)?.[1]?.trim() ?? "Unknown status",
  );
  const date = body.match(/^\*\*Date:\*\*\s*(\d{4}-\d{2}-\d{2})/m)?.[1] ?? null;
  return date === null ? status : `${status}, ${date}`;
}

/** Read the first ADR decision sentence, falling back to body prose for older ADR shapes. */
function decisionSummary(body: string): string {
  return firstSentence(
    paragraphAfter(body, "\n## Decision") ?? firstBodyParagraph(body),
  );
}

/** Parse one ADR file into its index row; null when the file lacks an H1 title. */
function parseDecisionFile(file: MarkdownEntry): IndexEntry | null {
  const { body } = parseMarkdownFrontmatter(file.content);
  const titleMatch = body.match(/^#\s+(.+)$/m);
  if (!titleMatch) return null;
  // ADR shapes vary: status/date lines are mandatory in current records, but older records may put
  // status prose in paragraphs, so the parser composes a compact hook from whichever stable parts exist.
  return {
    title: (titleMatch[1] ?? "").trim(),
    sourceFile: baseName(file.path),
    anchor: searchNeedle(titleMatch[0]),
    hook: `${decisionStatusPart(body)} - ${decisionSummary(body)}`,
  };
}

/**
 * Parse one learning-loop bucket directory into the deterministic entry list a generated
 * INDEX.md is rendered from. Files come back lexicographically sorted (ADR number order for
 * decisions) with entries in document order, so repeated runs over unchanged content always
 * produce the same list.
 *
 * @param fs - read-only filesystem adapter rooted at the target project
 * @param dirPath - bucket directory path relative to the project root
 * @param bucket - which bucket grammar to apply (entry headings vs one-ADR-per-file)
 * @returns active-entry rows; empty when the directory is missing or holds no active entries
 */
export function parseBucket(
  fs: ReadonlyFS,
  dirPath: string,
  bucket: IndexBucket,
): IndexEntry[] {
  const dir = listMarkdownEntries(fs, dirPath);
  if (bucket === "decisions") {
    return dir.files
      .filter((file) => ADR_FILE.test(baseName(file.path)))
      .flatMap((file) => parseDecisionFile(file) ?? []);
  }
  return dir.files.flatMap((file) => parseEntryFile(file, bucket));
}
