/**
 * Builds compact learning-loop entry facts for stats, dashboard, and prompts.
 * Use this parser when users need stable memory health without scraping Markdown.
 * Entries retain user-facing headings, recurrence metadata, reference health,
 * bounded excerpts, and deterministic ordering without changing project files.
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

/**
 * Read one metadata value from an entry body.
 * Use when stats needs an optional author-supplied field; missing or empty means null.
 */
function extractEntryMetadata(
  entryContent: string,
  metadataLabel: string,
): string | null {
  const metadataMatch = entryContent.match(
    new RegExp(`\\*\\*${metadataLabel}:\\*\\*\\s*([^|\\r\\n]+)`, "i"),
  );
  // A missing or blank field means the author has not supplied this optional metadata.
  const metadataValue = metadataMatch?.[1]?.trim() ?? "";
  return metadataValue.length > 0 ? metadataValue : null;
}

/**
 * Read one ISO metadata date from an entry body.
 * Use when users sort or validate memory chronology; missing or malformed means null.
 */
function extractEntryDate(
  entryContent: string,
  metadataLabel:
    "Created" | "Updated" | "Resolved" | "Date" | "Latest occurrence",
): string | null {
  const metadataValue = extractEntryMetadata(entryContent, metadataLabel);
  // Only exact ISO dates enter the user-facing chronology; other values stay unknown.
  if (metadataValue === null || !/^\d{4}-\d{2}-\d{2}$/.test(metadataValue)) {
    return null;
  }
  return metadataValue;
}

/**
 * Return the first Markdown title used to identify a decision to users.
 * Use the filename fallback when a malformed ADR has no readable heading.
 */
function firstHeadingTitle(
  markdownContent: string,
  fallbackTitle: string,
): string {
  // Missing or empty headings fall back to a stable filename-derived label in the UI.
  const headingTitle = markdownContent.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "";
  return headingTitle.length > 0 ? headingTitle : fallbackTitle;
}

/**
 * Return the filename users see for a slash-delimited source path.
 * Use when decision filters or fallbacks should not expose the whole project path.
 */
function sourceFilename(sourcePath: string): string {
  const lastSeparatorIndex = sourcePath.lastIndexOf("/");
  // A bare filename is already ready for display; a project path is reduced to its final segment.
  if (lastSeparatorIndex === -1) {
    return sourcePath;
  }
  return sourcePath.slice(lastSeparatorIndex + 1);
}

/**
 * Strip Markdown noise and cap one entry excerpt for prompt users.
 * Use when retrieval needs readable context without loading the complete bucket.
 */
function compactEntryExcerpt(
  entryContent: string,
  maximumExcerptBytes = 900,
): string {
  const entryLines = entryContent
    .replace(/^##\s+(?:Footgun|Lesson|Pattern):\s+.+$/gm, "")
    .replace(/^#\s+.+$/gm, "")
    .split("\n");
  // Each line is normalized so users receive one predictable excerpt sentence.
  const normalizedEntryLines = entryLines.map((entryLine) => entryLine.trim());
  // Empty, frontmatter, status, and quoted lines add no decision-bearing prompt context.
  const userFacingEntryLines = normalizedEntryLines.filter(
    (entryLine) =>
      entryLine.length > 0 &&
      entryLine !== "---" &&
      !/^\*\*Status:\*\*/i.test(entryLine) &&
      !/^>/.test(entryLine),
  );
  const cleanedExcerpt = userFacingEntryLines
    .join(" ")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // Short entries fit the prompt budget and can be shown without truncation.
  if (Buffer.byteLength(cleanedExcerpt, "utf8") <= maximumExcerptBytes) {
    return cleanedExcerpt;
  }

  let boundedExcerpt = "";
  // Characters are added until the rendered ellipsis would exceed the user's byte budget.
  for (const excerptCharacter of cleanedExcerpt) {
    const nextExcerpt = boundedExcerpt + excerptCharacter;
    // Stop before this character would make the prompt excerpt exceed its configured cap.
    if (Buffer.byteLength(nextExcerpt + "...", "utf8") > maximumExcerptBytes) {
      break;
    }
    boundedExcerpt = nextExcerpt;
  }
  return `${boundedExcerpt.trimEnd()}...`;
}

/**
 * Pick the date used for newest-first memory ordering.
 * Use the creation date when users have never updated the entry; no dates means null.
 */
function entrySortDate(
  entry: Pick<LearningLoopEntryFact, "updated" | "created">,
): string | null {
  // An absent update falls back to creation; entries with neither date remain unsorted by date.
  return entry.updated ?? entry.created ?? null;
}

/**
 * Parse an optional recurrence count for stats and dashboard users.
 * Missing or non-numeric values stay null so malformed metadata never invents incidents.
 */
function extractIncidentCount(entryContent: string): number | null {
  const incidentCountText = extractEntryMetadata(
    entryContent,
    "Incident count",
  );
  // Missing or non-numeric counts mean the UI cannot claim a measured recurrence total.
  if (incidentCountText === null || !/^\d+$/.test(incidentCountText)) {
    return null;
  }
  return Number.parseInt(incidentCountText, 10);
}

/**
 * Return forward-looking metadata shared by footgun and lesson facts.
 * Use when stats or dashboard users inspect why and when one memory should trigger.
 */
function extractMemoryQualityMetadata(
  entryContent: string,
): Pick<
  LearningLoopEntryFact,
  | "hasDecisionChangedGuidance"
  | "triggerPhase"
  | "incidentCount"
  | "latestOccurrence"
> {
  // A missing Decision changed field becomes an advisory backfill flag for the user.
  const hasDecisionChangedGuidance =
    extractEntryMetadata(entryContent, "Decision changed") !== null;
  return {
    hasDecisionChangedGuidance,
    triggerPhase: extractEntryMetadata(entryContent, "Trigger phase"),
    incidentCount: extractIncidentCount(entryContent),
    latestOccurrence: extractEntryDate(entryContent, "Latest occurrence"),
  };
}

/**
 * Stores one parsed lesson or pattern section for user-facing fact creation.
 * Use while splitting a shared bucket into independently inspectable memories.
 */
interface LearningSection {
  title: string;
  heading: string;
  kind: LearningLoopEntryKind;
  start: number;
  content: string;
}

/**
 * Split a lesson or pattern bucket into individual user-facing memories.
 * Use before extraction so each heading receives its own metadata and health record.
 */
function splitLearningSections(
  bucketBody: string,
  defaultEntryKind: "lesson" | "pattern",
): LearningSection[] {
  // Every matching heading becomes one memory row a stats or dashboard user can inspect.
  const sectionHeadings = Array.from(
    bucketBody.matchAll(/^##\s+(Lesson|Pattern):\s+(.+)$/gm),
    (headingMatch) => {
      // Missing captures use the bucket's known kind and an empty title instead of inventing text.
      const headingKind = headingMatch[1] ?? defaultEntryKind;
      const headingTitle = (headingMatch[2] ?? "").trim();
      const normalizedKind =
        headingKind.toLowerCase() === "pattern" ? "pattern" : defaultEntryKind;
      return {
        kind: normalizedKind,
        title: headingTitle,
        heading: `## ${headingKind}: ${headingTitle}`,
        start: headingMatch.index,
      };
    },
  );
  // Each heading owns content until the next memory heading or the bucket's end.
  return sectionHeadings.map((sectionHeading, headingIndex) => {
    // The final memory has no sibling, so its user-facing content continues to EOF.
    const sectionEnd =
      sectionHeadings[headingIndex + 1]?.start ?? bucketBody.length;
    return {
      ...sectionHeading,
      content: bucketBody.slice(sectionHeading.start, sectionEnd),
    };
  });
}

/**
 * Build compact footgun facts for retrieval, stats, and dashboard users.
 * Use after bucket discovery so every hazard keeps its own metadata and reference health.
 */
function extractFootgunEntries(
  projectFiles: ReadonlyFS,
  learningDirectory: EntryDir,
  firstDisplayOrder: number,
): LearningLoopEntryFact[] {
  let nextDisplayOrder = firstDisplayOrder;
  const learningEntries: LearningLoopEntryFact[] = [];
  // Each bucket file can hold several hazards that users need to inspect separately.
  for (const bucketFile of learningDirectory.files) {
    const { body: bucketBody } = parseMarkdownFrontmatter(bucketFile.content);
    const bucketSizeBytes = Buffer.byteLength(bucketFile.content, "utf8");
    // Each footgun section becomes one independently ranked memory fact.
    for (const footgunSection of splitFootgunSections(bucketBody)) {
      const referenceHealth = summarizeFootgunRefs(
        projectFiles,
        footgunSection.content,
      );
      // Malformed status remains null so the existing structure check can explain the repair.
      const canonicalStatus =
        footgunSection.status === "active" ||
        footgunSection.status === "resolved"
          ? footgunSection.status
          : null;
      learningEntries.push({
        sourcePath: bucketFile.path,
        kind: "footgun",
        title: footgunSection.title,
        heading: `## Footgun: ${footgunSection.title}`,
        status: canonicalStatus,
        created: extractEntryDate(footgunSection.content, "Created"),
        updated: extractEntryDate(footgunSection.content, "Updated"),
        resolved: extractEntryDate(footgunSection.content, "Resolved"),
        ...extractMemoryQualityMetadata(footgunSection.content),
        excerpt: compactEntryExcerpt(footgunSection.content),
        staleRefs: referenceHealth.staleRefs,
        invalidLineRefs: referenceHealth.invalidLineRefs,
        hasValidAnchor: referenceHealth.validRefs > 0,
        bucketSizeBytes,
        order: nextDisplayOrder++,
      });
    }
  }
  return learningEntries;
}

/**
 * Build lesson or pattern facts for retrieval, stats, and dashboard users.
 * Use when one bucket mixes entry headings but shares the same source file.
 */
function extractLessonLikeEntries(
  projectFiles: ReadonlyFS,
  learningDirectory: EntryDir,
  defaultEntryKind: "lesson" | "pattern",
  firstDisplayOrder: number,
): LearningLoopEntryFact[] {
  let nextDisplayOrder = firstDisplayOrder;
  const learningEntries: LearningLoopEntryFact[] = [];
  // Each bucket file can hold several lessons or patterns shown as separate user memories.
  for (const bucketFile of learningDirectory.files) {
    const { body: bucketBody } = parseMarkdownFrontmatter(bucketFile.content);
    const bucketSizeBytes = Buffer.byteLength(bucketFile.content, "utf8");
    // Each heading receives its own metadata rather than inheriting a neighboring entry's fields.
    for (const learningSection of splitLearningSections(
      bucketBody,
      defaultEntryKind,
    )) {
      const referenceHealth = summarizeLessonRefs(
        projectFiles,
        learningSection.content,
      );
      learningEntries.push({
        sourcePath: bucketFile.path,
        kind: learningSection.kind,
        title: learningSection.title,
        heading: learningSection.heading,
        status: null,
        created: extractEntryDate(learningSection.content, "Created"),
        updated: extractEntryDate(learningSection.content, "Updated"),
        resolved: extractEntryDate(learningSection.content, "Resolved"),
        ...extractMemoryQualityMetadata(learningSection.content),
        excerpt: compactEntryExcerpt(learningSection.content),
        staleRefs: referenceHealth.staleRefs,
        invalidLineRefs: referenceHealth.invalidLineRefs,
        hasValidAnchor: referenceHealth.validRefs > 0,
        bucketSizeBytes,
        order: nextDisplayOrder++,
      });
    }
  }
  return learningEntries;
}

/**
 * Build compact decision facts for architecture-oriented retrieval users.
 * Use when ADR files need the same stable ordering shape as other learning entries.
 */
function extractDecisionEntries(
  learningDirectory: EntryDir,
  firstDisplayOrder: number,
): LearningLoopEntryFact[] {
  let nextDisplayOrder = firstDisplayOrder;
  // README and INDEX files are excluded because users need actual ADR memories only.
  const decisionFiles = learningDirectory.files.filter((decisionFile) =>
    isDecisionRecordMarkdown(sourceFilename(decisionFile.path)),
  );
  // Each ADR becomes one retrieval fact with neutral forward-memory metadata.
  return decisionFiles.map((decisionFile) => {
    const filename = sourceFilename(decisionFile.path);
    const decisionTitle = firstHeadingTitle(
      decisionFile.content,
      filename.replace(/\.md$/i, "").replace(/^ADR-\d+-/, ""),
    );
    return {
      sourcePath: decisionFile.path,
      kind: "decision" as const,
      title: decisionTitle,
      heading: `# ${decisionTitle}`,
      status: null,
      created: extractEntryDate(decisionFile.content, "Date"),
      updated: extractEntryDate(decisionFile.content, "Updated"),
      resolved: null,
      hasDecisionChangedGuidance: true,
      triggerPhase: null,
      incidentCount: null,
      latestOccurrence: null,
      excerpt: compactEntryExcerpt(decisionFile.content),
      staleRefs: [],
      invalidLineRefs: [],
      hasValidAnchor: true,
      bucketSizeBytes: Buffer.byteLength(decisionFile.content, "utf8"),
      order: nextDisplayOrder++,
    };
  });
}

/**
 * Extract compact learning-loop entries for bounded prompt retrieval.
 *
 * @param projectFiles - selected-project files; an empty project produces no memory rows for users.
 * @param configState - memory paths; absent directories produce no entries for that memory kind.
 * @returns ordered facts; an empty array means the selected project has no durable memories to show.
 */
export function extractLearningLoopEntries(
  projectFiles: ReadonlyFS,
  configState: LoadedConfig,
): LearningLoopEntryFact[] {
  const footgunDirectory = listMarkdownEntries(
    projectFiles,
    configState.config.footguns.path,
  );
  const lessonDirectory = listMarkdownEntries(
    projectFiles,
    configState.config.lessons.path,
  );
  const patternDirectory = listMarkdownEntries(
    projectFiles,
    ".goat-flow/learning-loop/patterns/",
  );
  const decisionDirectory = listMarkdownEntries(
    projectFiles,
    configState.config.decisions.path,
  );
  const learningEntries = [
    ...extractFootgunEntries(projectFiles, footgunDirectory, 0),
    ...extractLessonLikeEntries(
      projectFiles,
      lessonDirectory,
      "lesson",
      10_000,
    ),
    ...extractLessonLikeEntries(
      projectFiles,
      patternDirectory,
      "pattern",
      20_000,
    ),
    ...extractDecisionEntries(decisionDirectory, 30_000),
  ];
  // Stable ordering keeps the same memory rows in the same user-visible order across runs.
  return learningEntries.sort((leftEntry, rightEntry) => {
    const kindOrder = leftEntry.kind.localeCompare(rightEntry.kind);
    // Different memory kinds retain their deterministic grouping for prompt consumers.
    if (kindOrder !== 0) return kindOrder;
    // Missing dates sort as empty so undated legacy entries remain readable and deterministic.
    const dateOrder = (entrySortDate(rightEntry) ?? "").localeCompare(
      entrySortDate(leftEntry) ?? "",
    );
    // Newer entries appear first within their kind when users review selected memory.
    if (dateOrder !== 0) return dateOrder;
    const sourcePathOrder = leftEntry.sourcePath.localeCompare(
      rightEntry.sourcePath,
    );
    // Source paths break date ties so machines discover the same user-visible order.
    if (sourcePathOrder !== 0) return sourcePathOrder;
    return leftEntry.order - rightEntry.order;
  });
}
