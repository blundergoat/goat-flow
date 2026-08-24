/**
 * Local milestone export adapter for portable plan review and issue drafting.
 *
 * It parses goat-plan Markdown, preserves delivery and verification context, scrubs readable text before rendering, previews to stdout by default,
 * and writes generated JSON or Markdown only when users choose `--output`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { CLIError } from "./cli-error.js";
import { PlansExportInputError } from "./plans-export-input-error.js";
import { writeOutput } from "./cli-output.js";
import type { ParsedCLI } from "./cli-types.js";
import {
  maskNonRenderedMarkdown,
  readRenderedMarkdownFieldValues,
} from "./rendered-markdown.js";
import {
  parseEffortLineValue,
  readPlanAdminEstimate,
  readTaskEstimate,
  sumTaskEstimates,
  type PlanEffortSplit,
  type PlanExportEffort,
  type TaskEstimateFields,
} from "./plans-effort.js";
import {
  parseTimingReceiptMarkdown,
  type PlanTimingReceipt,
} from "./plans-time.js";
import { PLAN_STRUCTURE_SECTIONS } from "./plans-check-structure.js";
import {
  redactPlanExportRecord,
  renderPlanExportMarkdown,
  writeJsonExport,
  writeMarkdownExports,
} from "./plans-export-output.js";

export { redactPlanExportRecord } from "./plans-export-output.js";
export { isPlansExportInputError } from "./plans-export-input-error.js";

/** One task checkbox preserved for JSON consumers and future body generators. */
interface PlanExportTask extends TaskEstimateFields {
  isChecked: boolean;
  text: string;
}

/** Portable milestone fields shared by JSON and Markdown renderers. */
export interface PlanExportRecord {
  /** Parsed H2 sections for local validation; symbol-keyed content never enters JSON or Markdown exports. */
  [PLAN_STRUCTURE_SECTIONS]?: MarkdownSection[];
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

/** Checkbox prefix used to find every possible task before retaining only the shallowest task level. */
const CHECKLIST_ITEM_PATTERN = /^([ \t]*)-\s+\[([ xX])\]\s+/gmu;

/** An indented Markdown list item is supporting task prose, not part of the parent's estimate notation. */
const NESTED_LIST_ITEM_PATTERN = /^[ \t]+(?:[-+*]|\d+[.)])[ \t]+/mu;

/**
 * Read the first visible milestone field and report competing copies.
 * Use while exporting the plan so users see ambiguity instead of a silently chosen value.
 *
 * @param content - milestone Markdown; empty means every requested field is absent
 * @param label - field name shown to the user; empty means no field can be selected
 * @param warnings - export warnings to extend; absent means duplicate details are not requested
 * @returns the first trimmed value; empty means the milestone has no usable field value
 */
function readMilestoneField(
  content: string,
  label: string,
  warnings?: string[],
): string {
  const fieldValues = readRenderedMarkdownFieldValues(content, label);
  // Competing visible values make the export ambiguous, so the user gets a warning.
  if (fieldValues.length > 1 && warnings) {
    const warning = `multiple ${label} values supplied`;
    // Repeated parser paths should not repeat the same warning in the exported plan.
    if (!warnings.includes(warning)) warnings.push(warning);
  }
  // A missing or empty first field stays empty so existing missing-field guidance remains authoritative.
  return fieldValues.at(0) ?? "";
}

/** Split level-two sections while preserving nested headings and user-authored Markdown. */
function readMilestoneSections(content: string): MarkdownSection[] {
  const headingMatches = Array.from(
    maskNonRenderedMarkdown(content).matchAll(
      /^ {0,3}##[\t ]+(.+?)(?:[\t ]+#+)?[\t ]*$/gmu,
    ),
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

/**
 * Measure Markdown indentation using four-column tab stops.
 *
 * @param indentation - spaces and tabs before one checklist marker
 * @returns visual zero-based column where the marker begins
 */
function markdownIndentColumns(indentation: string): number {
  let column = 0;
  for (const character of indentation) {
    column += character === "\t" ? 4 - (column % 4) : 1;
  }
  return column;
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
  // Competing copies leave the user unsure which value an export preserved.
  if (hasConflict) warnings.push(`conflicting ${label} representations`);
}

/**
 * Convert Markdown checkbox lines into stable checked/text records for JSON consumers.
 *
 * An item owns every line until the next checkbox or heading, because real tasks wrap across indented continuation lines with the `(est: ...)` entry
 * at the block's end; single-line tasks keep their exact prior text.
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
  const checkboxMatches = Array.from(
    maskedMarkdown.matchAll(CHECKLIST_ITEM_PATTERN),
  );
  const shallowestTaskIndentation = Math.min(
    ...checkboxMatches.map((checkboxMatch) =>
      markdownIndentColumns(checkboxMatch[1] ?? ""),
    ),
  );
  const taskStarts = checkboxMatches.filter(
    (checkboxMatch) =>
      markdownIndentColumns(checkboxMatch[1] ?? "") ===
      shallowestTaskIndentation,
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
    const taskBodyMarkdown = markdown.slice(bodyStart, bodyEnd);
    const maskedTaskBodyMarkdown = maskedMarkdown.slice(bodyStart, bodyEnd);
    const text = taskBodyMarkdown.replace(/\s+/gu, " ").trim();
    const nestedListStart = maskedTaskBodyMarkdown.search(
      NESTED_LIST_ITEM_PATTERN,
    );
    const estimateSourceMarkdown =
      nestedListStart < 0
        ? taskBodyMarkdown
        : taskBodyMarkdown.slice(0, nestedListStart);
    const estimateSourceText = estimateSourceMarkdown
      .replace(/\s+/gu, " ")
      .trim();
    return {
      isChecked: startMatch[2]?.toLowerCase() === "x",
      text,
      ...readTaskEstimate(estimateSourceText, taskIndex, warnings, itemLabel),
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
  // An Effort line gives exported readers the milestone's headline forecast.
  if (effort) record.effort = effort;
  // Task totals appear only when at least one task supplied an estimate.
  if (taskEstimateTotals) record.taskEstimateTotals = taskEstimateTotals;
  // Plan overhead stays absent when the author did not estimate administrative work.
  if (planAdminEstimate.estimateMinutes !== undefined) {
    record.planAdminEstimate = planAdminEstimate;
  }
  // Counted work totals let strict-plan users compare every checklist estimate with the headline split.
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
      .match(/^ {0,3}#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/mu)?.[1]
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
    readMilestoneField(content, "Forecast basis", warnings),
  );
  addMissingFieldWarning(warnings, status, "status");
  addMissingFieldWarning(warnings, scopeMarkdown, "scope");
  addMissingFieldWarning(warnings, tasks, "tasks");
  addMissingFieldWarning(warnings, testingGateItems, "proof");
  addMissingFieldWarning(warnings, exitCriteriaMarkdown, "exit criteria");
  addMissingFieldWarning(warnings, stopMarkdown, "stop/rescope");

  const record: PlanExportRecord = {
    [PLAN_STRUCTURE_SECTIONS]: sections,
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
  // A valid receipt travels with the export so readers can audit measured Actuals.
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

  let loadedRecords: PlanExportRecord[];
  try {
    loadedRecords = loadPlanExportRecords(options.projectPath);
  } catch (error) {
    // Example: a user selected a stale plan path or a milestone without a title.
    if (error instanceof PlansExportInputError) {
      throw new CLIError(error.message, 2);
    }
    throw error;
  }
  const sourceFiles = loadedRecords.map((record) => record.sourceFile);
  const records = loadedRecords.map(redactPlanExportRecord);

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
      ? writeJsonExport(
          records,
          options.output,
          options.shouldForce,
          options.projectPath,
          sourceFiles,
        )
      : writeMarkdownExports(
          records,
          options.output,
          options.shouldForce,
          options.projectPath,
          sourceFiles,
        );
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
