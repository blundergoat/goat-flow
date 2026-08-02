/**
 * Local milestone export adapter for portable plan review and issue drafting.
 * It parses goat-plan Markdown, preserves delivery and verification context,
 * scrubs readable text before rendering, previews to stdout by default, and
 * writes generated JSON or Markdown only when users choose `--output`.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, parse, resolve, sep } from "node:path";

import { CLIError } from "./cli-error.js";
import { writeOutput } from "./cli-output.js";
import type { ParsedCLI } from "./cli-types.js";
import { scrubDurableText } from "./evidence/redaction.js";
import { maskNonRenderedMarkdown } from "./rendered-markdown.js";
import {
  parseEffortLineValue,
  readPlanAdminEstimate,
  readTaskEstimate,
  renderActualLine,
  renderEffortLine,
  renderForecastRangeLine,
  sumTaskEstimates,
  type PlanEffortSplit,
  type PlanExportEffort,
  type TaskEstimateFields,
} from "./plans-effort.js";
import {
  parseTimingReceiptMarkdown,
  type PlanTimingReceipt,
} from "./plans-time.js";

/** One task checkbox preserved for JSON consumers and future body generators. */
interface PlanExportTask extends TaskEstimateFields {
  isChecked: boolean;
  text: string;
}

/** Portable milestone fields shared by JSON and Markdown renderers. */
export interface PlanExportRecord {
  sourceFile: string;
  title: string;
  status: string;
  dependencies: string;
  objective: string;
  scopeMarkdown: string;
  boundaryMarkdown: string;
  taskMarkdown: string;
  tasks: PlanExportTask[];
  testingGateItems: PlanExportTask[];
  midProofMarkdown: string;
  midProofItems: PlanExportTask[];
  exitCriteriaItems: PlanExportTask[];
  effort?: PlanExportEffort;
  timingReceiptMarkdown: string;
  timingReceipt?: PlanTimingReceipt;
  taskEstimateTotals?: PlanEffortSplit;
  planAdminEstimate?: TaskEstimateFields;
  workEstimateTotals?: PlanEffortSplit;
  verificationMarkdown: string;
  exitCriteriaMarkdown: string;
  stopMarkdown: string;
  warnings: string[];
}

/** One parsed level-two Markdown section and its unchanged body. */
interface MarkdownSection {
  heading: string;
  body: string;
}

/**
 * Invalid plan input that users can fix without a stack trace.
 * Use for missing plan directories, unreadable milestones, or absent titles.
 */
class PlansExportInputError extends Error {
  /** Create one usage-safe plan error that the CLI can show without a stack trace. */
  constructor(message: string) {
    super(message);
    this.name = "PlansExportInputError";
  }
}

/**
 * Identify plan-input failures so callers can convert them to friendly usage
 * errors instead of stack traces.
 *
 * @param error - anything thrown while loading a plan; non-plan errors stay unrecognised
 *   so they crash loudly instead of being reworded
 * @returns true when the error is a user-fixable plan input problem
 */
export function isPlansExportInputError(
  error: unknown,
): error is PlansExportInputError {
  return error instanceof PlansExportInputError;
}

/** Read one live bold or plain field and report competing copies. */
function readMilestoneField(
  content: string,
  label: string,
  warnings?: string[],
): string {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const matches = Array.from(
    maskNonRenderedMarkdown(content).matchAll(
      new RegExp(
        `^(?:\\*\\*${escapedLabel}:\\*\\*|${escapedLabel}:)\\s*(.+)$`,
        "gimu",
      ),
    ),
  );
  if (matches.length > 1 && warnings) {
    const warning = `multiple ${label} values supplied`;
    if (!warnings.includes(warning)) warnings.push(warning);
  }
  return matches.at(0)?.[1]?.trim() ?? "";
}

/** Split level-two sections while preserving nested headings and user-authored Markdown. */
function readMilestoneSections(content: string): MarkdownSection[] {
  const headingMatches = Array.from(
    maskNonRenderedMarkdown(content).matchAll(/^##\s+(.+)$/gmu),
  );

  // Each heading owns text until the next peer heading, matching goat-plan's milestone layout.
  return headingMatches.map((headingMatch, index) => {
    const bodyStart = headingMatch.index + headingMatch[0].length;
    const bodyEnd = headingMatches.at(index + 1)?.index ?? content.length;
    return {
      heading: headingMatch[1]?.trim().toLowerCase() ?? "",
      body: content.slice(bodyStart, bodyEnd).trim(),
    };
  });
}

/** Return every section matching one semantic alias group in source order. */
function readMilestoneSectionMatches(
  sections: MarkdownSection[],
  headingAliases: readonly string[],
): MarkdownSection[] {
  return sections.filter((section) =>
    headingAliases.some(
      (alias) =>
        section.heading === alias || section.heading.startsWith(`${alias} `),
    ),
  );
}

/** Join complementary section bodies without inventing headings or reordering evidence. */
function joinSectionBodies(sections: readonly MarkdownSection[]): string {
  return sections
    .map((section) => section.body)
    .filter(Boolean)
    .join("\n\n");
}

/** Remove a milestone identifier from an outcome title used as the objective fallback. */
function objectiveFromTitle(title: string): string {
  return title.replace(/^(?:M\d+|Milestone\s+\d+)\s*:\s*/iu, "").trim();
}

/** Record a deterministic alias conflict without copying user-authored text. */
function addRepresentationConflict(
  warnings: string[],
  hasConflict: boolean,
  label: string,
): void {
  if (hasConflict) warnings.push(`conflicting ${label} representations`);
}

/**
 * Convert Markdown checkbox lines into stable checked/text records for JSON consumers.
 * An item owns every line until the next checkbox or heading, because real tasks
 * wrap across indented continuation lines with the `(est: ...)` entry at the
 * block's end; single-line tasks keep their exact prior text.
 *
 * @param markdown - one estimate-bearing section body
 * @param warnings - record warning sink for malformed est entries
 * @param itemLabel - warning label for this section's items
 * @returns checkbox items in source order with optional estimate fields
 */
function readChecklistItems(
  markdown: string,
  warnings: string[],
  itemLabel: string,
): PlanExportTask[] {
  const maskedMarkdown = maskNonRenderedMarkdown(markdown);
  const taskStarts = Array.from(
    maskedMarkdown.matchAll(/^\s*-\s+\[([ xX])\]\s+/gmu),
  );

  // Headings also end an item so nested Testing Gate labels do not swallow its trailing estimate.
  return taskStarts.map((startMatch, taskIndex) => {
    const bodyStart = startMatch.index + startMatch[0].length;
    const nextCheckbox = taskStarts.at(taskIndex + 1)?.index ?? markdown.length;
    const nextHeadingOffset = maskedMarkdown
      .slice(bodyStart)
      .search(/^\s*#{1,6}\s+/mu);
    const nextHeading =
      nextHeadingOffset >= 0 ? bodyStart + nextHeadingOffset : markdown.length;
    const bodyEnd = Math.min(nextCheckbox, nextHeading);
    const text = markdown
      .slice(bodyStart, bodyEnd)
      .replace(/\s+/gu, " ")
      .trim();
    return {
      isChecked: startMatch[1]?.toLowerCase() === "x",
      text,
      ...readTaskEstimate(text, taskIndex, warnings, itemLabel),
    };
  });
}

/** Add one warning when a portable field is absent from a partial milestone. */
function addMissingFieldWarning(
  warnings: string[],
  fieldValue: string | readonly unknown[],
  label: string,
): void {
  // Empty text or collections tell export readers which source context was unavailable.
  if (fieldValue.length === 0) warnings.push(`missing ${label}`);
}

/** Return the first populated field while preserving an empty fallback. */
function firstPopulated(primary: string, fallback: string): string {
  return primary.length > 0 ? primary : fallback;
}

/** Attach optional effort fields without conditional-spread complexity in the parser. */
function addEffortFields(
  record: PlanExportRecord,
  effort: PlanExportEffort | undefined,
  taskEstimateTotals: PlanEffortSplit | undefined,
  planAdminEstimate: TaskEstimateFields,
  workEstimateTotals: PlanEffortSplit | undefined,
): void {
  if (effort) record.effort = effort;
  if (taskEstimateTotals) record.taskEstimateTotals = taskEstimateTotals;
  if (planAdminEstimate.estimateMinutes !== undefined) {
    record.planAdminEstimate = planAdminEstimate;
  }
  if (workEstimateTotals) record.workEstimateTotals = workEstimateTotals;
}

/** Read one semantic section and warn when the author supplied competing copies. */
function readSingleSectionMarkdown(
  sections: MarkdownSection[],
  headingAliases: readonly string[],
  warnings: string[],
  conflictLabel: string,
): string {
  const matches = readMilestoneSectionMatches(sections, headingAliases);
  addRepresentationConflict(warnings, matches.length > 1, conflictLabel);
  return matches.at(0)?.body ?? "";
}

/** Resolve a compact metadata field or its expanded section representation. */
function readFieldOrSectionMarkdown(
  content: string,
  fieldLabel: string,
  sections: MarkdownSection[],
  headingAliases: readonly string[],
  warnings: string[],
  conflictLabel: string,
): string {
  const field = readMilestoneField(content, fieldLabel, warnings);
  const matches = readMilestoneSectionMatches(sections, headingAliases);
  const section = matches.at(0)?.body ?? "";
  addRepresentationConflict(
    warnings,
    matches.length > 1 ||
      (field.length > 0 && section.length > 0 && field !== section),
    conflictLabel,
  );
  return firstPopulated(field, section);
}

/** Resolve explicit or section-style objectives before falling back to the outcome title. */
function readObjective(
  content: string,
  title: string,
  sections: MarkdownSection[],
  warnings: string[],
): string {
  const objectiveField = readMilestoneField(content, "Objective", warnings);
  const objectiveSections = readMilestoneSectionMatches(sections, [
    "objective",
  ]);
  const objectiveSection = objectiveSections.at(0)?.body ?? "";
  addRepresentationConflict(
    warnings,
    objectiveSections.length > 1 ||
      (objectiveField.length > 0 &&
        objectiveSection.length > 0 &&
        objectiveField !== objectiveSection),
    "objective",
  );
  return firstPopulated(
    objectiveField,
    firstPopulated(objectiveSection, objectiveFromTitle(title)),
  );
}

/** Prefer canonical Proof while accepting one legacy verification heading. */
function readProofMarkdown(
  sections: MarkdownSection[],
  warnings: string[],
): string {
  const canonical = readMilestoneSectionMatches(sections, ["proof"]);
  const legacy = readMilestoneSectionMatches(sections, [
    "verification gate",
    "testing gate",
  ]);
  addRepresentationConflict(
    warnings,
    canonical.length > 1 ||
      legacy.length > 1 ||
      (canonical.length > 0 && legacy.length > 0),
    "proof",
  );
  const selected = canonical.length > 0 ? canonical : legacy;
  return selected.at(0)?.body ?? "";
}

/** Detect multiple explicit or compact stop representations. */
function hasStopRepresentationConflict(
  canonical: MarkdownSection[],
  legacyKill: MarkdownSection[],
  legacyStop: MarkdownSection[],
  explicit: string,
  embedded: string,
): boolean {
  return (
    canonical.length > 1 ||
    (canonical.length > 0 &&
      (legacyKill.length > 0 || legacyStop.length > 0)) ||
    legacyKill.length > 1 ||
    legacyStop.length > 1 ||
    (explicit.length > 0 && embedded.length > 0)
  );
}

/** Read a dedicated stop section or the compact Exit-block stop line. */
function readStopMarkdown(
  sections: MarkdownSection[],
  exitMarkdown: string,
  warnings: string[],
): string {
  const canonical = readMilestoneSectionMatches(sections, [
    "stop / rescope",
    "stop/rescope",
    "stop / kill",
    "stop/kill",
  ]);
  const legacyKill = readMilestoneSectionMatches(sections, ["kill criteria"]);
  const legacyStop = readMilestoneSectionMatches(sections, ["stop conditions"]);
  const legacySet = sections.filter(
    (section) => legacyKill.includes(section) || legacyStop.includes(section),
  );
  const explicit =
    canonical.length > 0
      ? joinSectionBodies(canonical)
      : joinSectionBodies(legacySet);
  const embedded =
    maskNonRenderedMarkdown(exitMarkdown)
      .match(/^\s*-\s+Stop\s*\/\s*rescope if\s+.+$/imu)
      ?.at(0)
      ?.trim() ?? "";
  addRepresentationConflict(
    warnings,
    hasStopRepresentationConflict(
      canonical,
      legacyKill,
      legacyStop,
      explicit,
      embedded,
    ),
    "stop",
  );
  return firstPopulated(explicit, embedded);
}

/**
 * Parse one goat-plan milestone into the portable export contract.
 * Use for previews and writes; only the top-level title is mandatory.
 *
 * @param content - milestone Markdown; empty or title-less text is malformed
 * @param sourceFile - source filename shown to export readers and reused for Markdown output
 * @returns portable fields plus warnings for every missing optional section
 * @throws PlansExportInputError when no top-level milestone title exists
 */
export function parseMilestoneMarkdown(
  content: string,
  sourceFile: string,
): PlanExportRecord {
  const title =
    maskNonRenderedMarkdown(content)
      .match(/^#\s+(.+)$/mu)?.[1]
      ?.trim() ?? "";

  // Without a title, users cannot identify or create the resulting issue safely.
  if (title.length === 0) {
    throw new PlansExportInputError(
      `${sourceFile}: milestone must include a top-level title such as "# M01: Name".`,
    );
  }

  const warnings: string[] = [];
  const sections = readMilestoneSections(content);
  const status = readMilestoneField(content, "Status", warnings);
  const dependencies = readMilestoneField(content, "Depends on", warnings);
  const objective = readObjective(content, title, sections, warnings);
  const scopeMarkdown = readFieldOrSectionMarkdown(
    content,
    "Scope",
    sections,
    ["scope", "scope discipline"],
    warnings,
    "scope",
  );
  const boundaryMarkdown = readSingleSectionMarkdown(
    sections,
    ["boundary gate", "boundary notes"],
    warnings,
    "boundary",
  );
  const taskMarkdown = readSingleSectionMarkdown(
    sections,
    ["tasks"],
    warnings,
    "task",
  );
  const timingReceiptMarkdown = readSingleSectionMarkdown(
    sections,
    ["timing receipt"],
    warnings,
    "timing receipt",
  );
  const timingReceipt = parseTimingReceiptMarkdown(
    timingReceiptMarkdown,
    warnings,
  );
  const verificationMarkdown = readProofMarkdown(sections, warnings);
  const midProofMarkdown = readSingleSectionMarkdown(
    sections,
    ["mid-implementation proof"],
    warnings,
    "mid-proof",
  );
  const exitCriteriaMarkdown = readSingleSectionMarkdown(
    sections,
    ["exit criteria", "exit"],
    warnings,
    "exit criteria",
  );
  const stopMarkdown = readStopMarkdown(
    sections,
    exitCriteriaMarkdown,
    warnings,
  );
  const tasks = readChecklistItems(taskMarkdown, warnings, "task");
  const testingGateItems = readChecklistItems(
    verificationMarkdown,
    warnings,
    "testing gate item",
  );
  const midProofItems = readChecklistItems(
    midProofMarkdown,
    warnings,
    "mid-proof item",
  );
  const exitCriteriaItems = readChecklistItems(
    exitCriteriaMarkdown,
    warnings,
    "exit criteria item",
  );
  const taskEstimateTotals = sumTaskEstimates(tasks);
  const planAdminEstimate = readPlanAdminEstimate(
    readMilestoneField(content, "Plan/admin overhead", warnings),
    warnings,
  );
  const workEstimateTotals = sumTaskEstimates([
    ...tasks,
    ...testingGateItems,
    ...midProofItems,
    planAdminEstimate,
  ]);
  const effort = parseEffortLineValue(
    readMilestoneField(content, "Effort estimate", warnings),
    warnings,
    readMilestoneField(content, "Actual", warnings),
    readMilestoneField(content, "Forecast range", warnings),
  );
  addMissingFieldWarning(warnings, status, "status");
  addMissingFieldWarning(warnings, scopeMarkdown, "scope");
  addMissingFieldWarning(warnings, tasks, "tasks");
  addMissingFieldWarning(warnings, testingGateItems, "proof");
  addMissingFieldWarning(warnings, exitCriteriaMarkdown, "exit criteria");
  addMissingFieldWarning(warnings, stopMarkdown, "stop/rescope");

  const record: PlanExportRecord = {
    sourceFile,
    title,
    status: firstPopulated(status, "unknown"),
    dependencies,
    objective,
    scopeMarkdown,
    boundaryMarkdown,
    taskMarkdown,
    timingReceiptMarkdown,
    tasks,
    testingGateItems,
    midProofMarkdown,
    midProofItems,
    exitCriteriaItems,
    verificationMarkdown,
    exitCriteriaMarkdown,
    stopMarkdown,
    warnings,
  };
  addEffortFields(
    record,
    effort,
    taskEstimateTotals,
    planAdminEstimate,
    workEstimateTotals,
  );
  if (timingReceipt) record.timingReceipt = timingReceipt;
  return record;
}

/**
 * List milestone filenames in a stable numeric-order contract.
 * Throws when a selected plan directory disappears or becomes unreadable.
 */
function listMilestoneFiles(planPath: string): string[] {
  try {
    return readdirSync(planPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^M\d.*\.md$/iu.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) =>
        left.localeCompare(right, undefined, { numeric: true }),
      );
  } catch (error) {
    // Example: a user selected a completed plan folder that was moved between listing and export.
    throw new PlansExportInputError(
      `Cannot read plan directory ${planPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Load every milestone record from one selected plan directory.
 * Throws when the plan is empty or any milestone is unreadable or malformed.
 *
 * @param planPath - plan directory the user selected; one without M*.md files is a
 *   usage error, never a silently empty report
 * @returns one record per milestone file in numeric order; never empty
 */
export function loadPlanExportRecords(planPath: string): PlanExportRecord[] {
  const milestoneFiles = listMilestoneFiles(planPath);

  // An empty plan cannot produce a meaningful backlog or issue bundle.
  if (milestoneFiles.length === 0) {
    throw new PlansExportInputError(
      `No M*.md milestone files found in ${planPath}.`,
    );
  }

  // Every source file becomes one independently portable export record.
  return milestoneFiles.map((sourceFile) => {
    try {
      return parseMilestoneMarkdown(
        readFileSync(join(planPath, sourceFile), "utf-8"),
        sourceFile,
      );
    } catch (error) {
      // Example: an editor changed file permissions after the user selected the plan.
      if (error instanceof PlansExportInputError) throw error;
      throw new PlansExportInputError(
        `Cannot read ${sourceFile}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}

/**
 * Scrub the optional explanations nested inside effort metadata before a preview or file export.
 * Numeric estimates stay unchanged, while absent Actuals or forecast bands remain absent for users.
 *
 * @param effort - parsed effort data whose explanations may contain pasted credentials
 * @returns export-safe effort data with every user-authored explanation scrubbed
 */
function redactExportEffort(effort: PlanExportEffort): PlanExportEffort {
  // An absent Actual is normal before work finishes, so the export keeps that field absent.
  const redactedActual = effort.actual
    ? {
        ...effort.actual,
        reason: scrubDurableText(effort.actual.reason),
      }
    : undefined;

  // A missing forecast band means the author supplied one point estimate, not incomplete data.
  const redactedForecastRange = effort.forecastRange
    ? {
        ...effort.forecastRange,
        // The optional rationale is user-authored, so pasted tokens receive the shared redaction.
        ...(effort.forecastRange.rationale !== undefined && {
          rationale: scrubDurableText(effort.forecastRange.rationale),
        }),
      }
    : undefined;

  return {
    ...effort,
    ...(redactedActual && { actual: redactedActual }),
    ...(redactedForecastRange && { forecastRange: redactedForecastRange }),
  };
}

/**
 * Scrub every user-authored string before it can reach stdout or a generated file.
 *
 * @param record - parsed milestone whose text fields may hold tokens or secrets
 * @returns the same record shape with readable text scrubbed; numeric effort fields
 *   pass through unchanged
 */
export function redactPlanExportRecord(
  record: PlanExportRecord,
): PlanExportRecord {
  return {
    ...record,
    sourceFile: scrubDurableText(record.sourceFile),
    title: scrubDurableText(record.title),
    status: scrubDurableText(record.status),
    dependencies: scrubDurableText(record.dependencies),
    objective: scrubDurableText(record.objective),
    scopeMarkdown: scrubDurableText(record.scopeMarkdown),
    boundaryMarkdown: scrubDurableText(record.boundaryMarkdown),
    taskMarkdown: scrubDurableText(record.taskMarkdown),
    timingReceiptMarkdown: scrubDurableText(record.timingReceiptMarkdown),
    ...(record.timingReceipt && {
      timingReceipt: {
        ...record.timingReceipt,
        segments: record.timingReceipt.segments.map((segment) => ({
          ...segment,
          id: scrubDurableText(segment.id),
        })),
      },
    }),
    tasks: record.tasks.map((task) => ({
      ...task,
      text: scrubDurableText(task.text),
    })),
    testingGateItems: record.testingGateItems.map((item) => ({
      ...item,
      text: scrubDurableText(item.text),
    })),
    midProofMarkdown: scrubDurableText(record.midProofMarkdown),
    midProofItems: record.midProofItems.map((item) => ({
      ...item,
      text: scrubDurableText(item.text),
    })),
    exitCriteriaItems: record.exitCriteriaItems.map((item) => ({
      ...item,
      text: scrubDurableText(item.text),
    })),
    verificationMarkdown: scrubDurableText(record.verificationMarkdown),
    exitCriteriaMarkdown: scrubDurableText(record.exitCriteriaMarkdown),
    stopMarkdown: scrubDurableText(record.stopMarkdown),
    // Effort numbers are safe to preserve, while nested author explanations need redaction.
    ...(record.effort && {
      effort: redactExportEffort(record.effort),
    }),
  };
}

/** Convert a redacted source label into a portable generated Markdown filename. */
function markdownExportFilename(sourceFile: string): string {
  return sourceFile.replace(/[^A-Za-z0-9._-]+/gu, "-");
}

/** Render the optional effort metadata shared by legacy and current milestones. */
function renderEffortMetadata(record: PlanExportRecord): string[] {
  const lines: string[] = [];
  if (record.effort) {
    lines.push(renderEffortLine(record.effort));
  }
  if (record.effort?.forecastRange) {
    lines.push(renderForecastRangeLine(record.effort.forecastRange));
  }
  if (record.effort?.actual) {
    lines.push(renderActualLine(record.effort.actual));
  }
  if (record.planAdminEstimate?.estimateMinutes !== undefined) {
    lines.push(
      `**Plan/admin overhead:** ${record.planAdminEstimate.estimateMinutes} min other`,
    );
  }
  return lines;
}

/** Substitute the export placeholder only when a source field is empty. */
function providedOrMissing(value: string, missingText: string): string {
  return value.length > 0 ? value : missingText;
}

/** Render one milestone as an issue-ready Markdown body without posting it remotely. */
function renderPlanExportMarkdown(record: PlanExportRecord): string {
  const missingText = "_Not provided in the source milestone._";
  const lines = [
    `# ${record.title}`,
    "",
    `**Status:** ${record.status}`,
    `**Depends on:** ${providedOrMissing(record.dependencies, "none declared")}`,
    ...renderEffortMetadata(record),
    `**Objective:** ${providedOrMissing(record.objective, missingText)}`,
    "",
    ...(record.timingReceiptMarkdown
      ? ["## Timing Receipt", "", record.timingReceiptMarkdown, ""]
      : []),
    "## Scope",
    "",
    providedOrMissing(record.scopeMarkdown, missingText),
    "",
    "## Boundary Notes",
    "",
    providedOrMissing(record.boundaryMarkdown, missingText),
    "",
    "## Tasks",
    "",
    providedOrMissing(record.taskMarkdown, missingText),
    "",
    "## Proof",
    "",
    providedOrMissing(record.verificationMarkdown, missingText),
    "",
    "## Mid-implementation proof",
    "",
    providedOrMissing(record.midProofMarkdown, missingText),
    "",
    "## Exit Criteria",
    "",
    providedOrMissing(record.exitCriteriaMarkdown, missingText),
    "",
    "## Stop / rescope",
    "",
    providedOrMissing(record.stopMarkdown, missingText),
  ];

  // Partial milestones surface warnings so issue readers do not mistake missing gates for approval.
  if (record.warnings.length > 0) {
    lines.push(
      "",
      "## Export Warnings",
      "",
      ...record.warnings.map((warning) => `- ${warning}`),
    );
  }
  return lines.join("\n");
}

/** Refuse implicit regeneration when any generated destination already exists. */
function assertOutputPathsAvailable(
  outputPaths: string[],
  shouldForce: boolean,
): void {
  // Explicit force is the only signal that existing generated exports may be replaced.
  if (shouldForce) return;
  const existingOutputPath = outputPaths.find((path) => existsSync(path));

  // Preserving the first collision prevents partial writes and protects user edits.
  if (existingOutputPath) {
    throw new PlansExportInputError(
      `Export output already exists: ${existingOutputPath}. Pass --force to regenerate it.`,
    );
  }
}

/**
 * Require every export destination to be a single-link regular file or absent before writing.
 * Runs even under force: replacement authorizes new content, never writing
 * through a symlink, hardlink, or directory that shadows a generated filename.
 * Throws a usage-safe error naming the first unsafe destination so nothing is written.
 */
function assertWritableDestinations(outputPaths: string[]): void {
  for (const outputPath of outputPaths) {
    let destinationStats;
    try {
      destinationStats = lstatSync(outputPath);
    } catch (error) {
      // Absent is the normal case: the export write creates the file.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new PlansExportInputError(
        `Cannot inspect export output ${outputPath} before writing.`,
      );
    }
    if (!destinationStats.isFile() || destinationStats.nlink !== 1) {
      throw new PlansExportInputError(
        `Export output must be a single-link regular file or absent: ${outputPath}. Move the conflicting path before exporting.`,
      );
    }
  }
}

/** Require every existing export-directory component to be a real directory. */
function assertRealDirectoryPathOrAbsent(
  directoryPath: string,
  outputLabel: string,
): void {
  const absoluteDirectoryPath = resolve(directoryPath);
  const rootPath = parse(absoluteDirectoryPath).root;
  const pathComponents = absoluteDirectoryPath
    .slice(rootPath.length)
    .split(sep)
    .filter(Boolean);
  let inspectedPath = rootPath;

  for (const component of pathComponents) {
    inspectedPath = join(inspectedPath, component);
    let componentStats;
    try {
      componentStats = lstatSync(inspectedPath);
    } catch (error) {
      // Once a component is absent, all descendants are absent and mkdirSync may create them.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw new PlansExportInputError(
        `Cannot inspect ${outputLabel} path component ${inspectedPath} before writing.`,
      );
    }
    if (!componentStats.isDirectory()) {
      throw new PlansExportInputError(
        `${outputLabel} must be a real directory or absent at every existing path component: ${inspectedPath}. Move the conflicting path before exporting.`,
      );
    }
  }
}

/**
 * Reject filename sanitization or redaction collisions before any export is written.
 * Throws when two milestones resolve to one destination, so no partial bundle lands.
 */
function assertUniqueOutputPaths(outputPaths: string[]): void {
  const uniqueOutputPaths = new Set(outputPaths);
  if (uniqueOutputPaths.size === outputPaths.length) return;
  throw new PlansExportInputError(
    "Multiple milestones resolve to the same export filename after redaction and sanitization. Rename the source milestone files before exporting.",
  );
}

/** Write one Markdown file per milestone after every destination passes collision checks. */
function writeMarkdownExports(
  records: PlanExportRecord[],
  outputDirectory: string,
  shouldForce: boolean,
): string[] {
  // No existing ancestor may redirect output outside the requested logical tree.
  assertRealDirectoryPathOrAbsent(outputDirectory, "Markdown --output");
  const outputPaths = records.map((record) =>
    join(outputDirectory, markdownExportFilename(record.sourceFile)),
  );
  assertUniqueOutputPaths(outputPaths);
  assertOutputPathsAvailable(outputPaths, shouldForce);
  assertWritableDestinations(outputPaths);
  mkdirSync(outputDirectory, { recursive: true });

  // Each milestone stays independent so future issue adapters can consume one body at a time.
  for (const [index, record] of records.entries()) {
    const outputPath = outputPaths[index];

    // A mapped destination always exists because outputPaths was built from the same records.
    if (!outputPath) continue;
    writeFileSync(outputPath, `${renderPlanExportMarkdown(record)}\n`, "utf-8");
  }
  return outputPaths;
}

/** Write one JSON array after preserving an existing file unless force is explicit. */
function writeJsonExport(
  records: PlanExportRecord[],
  outputPath: string,
  shouldForce: boolean,
): string[] {
  if (existsSync(outputPath) && statSync(outputPath).isDirectory()) {
    throw new PlansExportInputError(
      `JSON --output must be a file: ${outputPath}.`,
    );
  }
  assertRealDirectoryPathOrAbsent(dirname(outputPath), "JSON --output parent");
  assertOutputPathsAvailable([outputPath], shouldForce);
  assertWritableDestinations([outputPath]);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(records, null, 2)}\n`, "utf-8");
  return [outputPath];
}

/**
 * Preview or persist one local plan export without invoking any remote adapter.
 * Use from `plans export`; unsupported formats and input errors become usage failures.
 *
 * @param options - parsed plan path, format, optional output, and explicit force choice
 * @returns nothing; preview goes to stdout and written paths are confirmed on stderr
 * @throws CLIError for unsupported formats, invalid plans, or protected output collisions
 */
export function handlePlansExportCommand(options: ParsedCLI): void {
  // SARIF has no plan-body contract and text aliases the human-readable Markdown preview.
  if (options.format === "sarif") {
    throw new CLIError("plans export supports --format markdown or json.", 2);
  }

  let records: PlanExportRecord[];
  try {
    records = loadPlanExportRecords(options.projectPath).map(
      redactPlanExportRecord,
    );
  } catch (error) {
    // Example: a user selected a stale plan path or a milestone without a title.
    if (error instanceof PlansExportInputError) {
      throw new CLIError(error.message, 2);
    }
    throw error;
  }

  const isJson = options.format === "json";
  const renderedPreview = isJson
    ? JSON.stringify(records, null, 2)
    : records.map(renderPlanExportMarkdown).join("\n\n---\n\n");

  // No output path is the safe preview mode and performs no export writes.
  if (!options.output) {
    writeOutput({ ...options, output: null }, renderedPreview);
    return;
  }

  let writtenPaths: string[];
  try {
    writtenPaths = isJson
      ? writeJsonExport(records, options.output, options.shouldForce)
      : writeMarkdownExports(records, options.output, options.shouldForce);
  } catch (error) {
    // Example: a prior export exists and the user did not authorize regeneration.
    if (error instanceof PlansExportInputError) {
      throw new CLIError(error.message, 2);
    }
    throw error;
  }

  // Written-path confirmations stay on stderr so scripted stdout remains artifact-free.
  for (const writtenPath of writtenPaths)
    console.error(`Written to ${writtenPath}`);
}
