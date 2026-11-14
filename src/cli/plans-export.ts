/**
 * Read local milestones for portable review through `plans export` and validation through `plans check`.
 * Example: `goat-flow plans export .goat-flow/plans/<version> --format json` previews one redacted JSON record per M*.md milestone file.
 *
 * How the developer's plan is handled:
 * - Task, proof, effort and forecast history are preserved, and missing or conflicting authored fields become record warnings.
 * - Export previews are redacted before reaching stdout.
 * - Only an explicit `--output` request creates generated files, and replacing an earlier export needs `--force`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { CLIError } from "./cli-error.js";
import { PlansExportInputError } from "./plans-export-input-error.js";
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
  readPlanForecastContext,
  maskForecastMethodLines,
  collectPlanForecastProblems,
  type PlanForecastContext,
} from "./plans-forecast-context.js";
import {
  redactPlanExportRecord,
  renderPlanExportMarkdown,
  writeJsonExport,
  writeMarkdownExports,
} from "./plans-export-output.js";

export { redactPlanExportRecord } from "./plans-export-output.js";
export { isPlansExportInputError } from "./plans-export-input-error.js";

/** One Markdown checkbox from Tasks, Proof, Mid-implementation proof or Exit criteria, as JSON consumers of `plans export` see it. */
interface PlanExportTask extends TaskEstimateFields {
  isChecked: boolean;
  text: string;
}

/**
 * Portable milestone fields shared by JSON and Markdown renderers.
 *
 * `plans export --format json` prints an array of these records after redaction, and `plans check` validates the same records.
 * Required parts the author left out, such as Scope or Tasks, export empty and add a `missing ...` warning that `plans check --strict` rejects.
 */
export interface PlanExportRecord {
  /** Parsed H2 sections for local validation; symbol-keyed content never enters JSON or Markdown exports. */
  [PLAN_STRUCTURE_SECTIONS]?: MarkdownSection[];
  sourceFile: string;
  title: string;
  status: string;
  statusReason: string;
  dependencies: string;
  /** An omitted header stays absent; an empty string preserves an explicitly empty Lane header. */
  lane?: string;
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
  /** Absent for legacy milestones; declared inputs survive invalid opt-in metadata. */
  forecastContext?: PlanForecastContext;
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

/** One `## Heading` section of a milestone: a lowercased heading for alias matching and the trimmed body as the author wrote it, minus any `Forecast method:` line. */
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

/**
 * Preserve the author's Lane header as written, without filling in the `default` lane that `plans check` assumes when none is declared.
 *
 * @param content - milestone Markdown; no Lane header leaves the lane out of the export entirely
 * @param warnings - record warnings that gain duplicate or invalid-lane messages, which `plans check --strict` rejects
 * @returns the first declared lane; undefined means no Lane header, and an empty string means an explicitly blank header
 */
function readMilestoneLane(
  content: string,
  warnings: string[],
): string | undefined {
  const laneValues = readRenderedMarkdownFieldValues(content, "Lane");
  const lane = laneValues.at(0);
  // Older milestones must keep their existing export shape when no Lane is declared.
  if (lane === undefined) return undefined;
  // Competing lanes make it unclear where the author intends this milestone to run.
  if (laneValues.length > 1) warnings.push("multiple Lane values supplied");
  // An explicit empty lane retains the default; other values must be portable lane names.
  if (lane !== "" && !/^[a-z0-9][a-z0-9-]{0,39}$/u.test(lane)) {
    warnings.push("invalid Lane value; expected ^[a-z0-9][a-z0-9-]{0,39}$");
  }
  return lane;
}

/**
 * Warn when a milestone's status explanation is duplicated, blank, written in the legacy `Abandoned` form, or written in both forms.
 * `plans check --strict` rejects every one of these warnings, so the developer ends up with one clear `Status reason`.
 *
 * @param canonicalValues - every visible `Status reason` value; empty means the author wrote none
 * @param legacyValues - every visible legacy `Abandoned` value; empty means the plan uses only the current field
 * @param warnings - record warnings that this reports into
 */
function addStatusReasonWarnings(
  canonicalValues: readonly string[],
  legacyValues: readonly string[],
  warnings: string[],
): void {
  const canonicalValue = canonicalValues.at(0);
  const legacyValue = legacyValues.at(0);

  // Multiple reasons leave the author without one clear explanation for the milestone state.
  if (canonicalValues.length > 1) {
    warnings.push("multiple Status reason values supplied");
  }
  // Repeated legacy reasons remain visible as ambiguity when an older plan is exported.
  if (legacyValues.length > 1) {
    warnings.push("multiple Abandoned values supplied");
  }
  // A blank reason was supplied explicitly and cannot explain why work stopped.
  if (canonicalValue !== undefined && canonicalValue.length === 0) {
    warnings.push("blank Status reason supplied");
  }
  // Older abandoned plans retain their explanation, with guidance to use the current field when edited.
  if (legacyValue !== undefined) {
    warnings.push("legacy Abandoned field supplied; use Status reason");
  }
  // Mixing old and current reason fields creates two competing explanations for the same milestone.
  if (canonicalValue !== undefined && legacyValue !== undefined) {
    warnings.push("conflicting status reason representations");
  }
}

/**
 * Read the reason a blocked, abandoned, superseded or deferred milestone gives for its status, preferring `Status reason` over `Abandoned`.
 * Legacy `Abandoned` text is used only while the milestone is still abandoned, preserving old snapshots without mislabelling resumed work.
 *
 * @param content - milestone Markdown; no reason field exports an empty reason
 * @param status - the milestone's Status value; only `abandoned` in any letter case lets legacy `Abandoned` text through
 * @param warnings - record warnings that gain any status-reason problems
 * @returns the reason text; empty means no usable reason: none written, a blank `Status reason`, or legacy text on a resumed milestone
 */
function readStatusReason(
  content: string,
  status: string,
  warnings: string[],
): string {
  const canonicalValues = readRenderedMarkdownFieldValues(
    content,
    "Status reason",
  );
  const legacyValues = readRenderedMarkdownFieldValues(content, "Abandoned");
  const canonicalValue = canonicalValues.at(0);
  const legacyValue = legacyValues.at(0);
  addStatusReasonWarnings(canonicalValues, legacyValues, warnings);

  // Canonical presence owns the field even when blank; strict mode reports that invalid authoring state.
  if (canonicalValue !== undefined) return canonicalValue;
  // Historical Abandoned text is a fallback only for abandoned snapshots, never for resumed work.
  if (status.trim().toLowerCase() === "abandoned") return legacyValue ?? "";
  return "";
}

/**
 * Split a milestone into its `## ` sections so later steps can find Tasks, Proof, Exit criteria and the rest by heading.
 * Headings inside code fences are ignored, and nested `###` headings stay inside the owning section's body.
 *
 * @param content - milestone Markdown; with no visible `## ` heading, section-only parts such as Tasks are reported missing
 * @returns sections in source order with lowercased headings; empty means the milestone has no level-two headings
 */
function readMilestoneSections(content: string): MarkdownSection[] {
  const headingMatches = Array.from(
    maskNonRenderedMarkdown(content).matchAll(
      /^ {0,3}##[\t ]+(.+?)(?:[\t ]+#+)?[\t ]*$/gmu,
    ),
  );

  // Each heading owns text until the next peer heading, matching goat-plan's milestone layout.
  return headingMatches.map((headingMatch, index) => {
    const bodyStart = headingMatch.index + headingMatch[0].length;
    // The last section has no next heading, so it runs to the end of the milestone file.
    const bodyEnd = headingMatches.at(index + 1)?.index ?? content.length;
    return {
      // Lowercasing lets `## Proof` and `## proof` select the same section.
      heading: headingMatch[1]?.trim().toLowerCase() ?? "",
      body: content.slice(bodyStart, bodyEnd).trim(),
    };
  });
}

/**
 * Measure Markdown indentation using four-column tab stops, so a tab-indented checkbox and a four-space-indented one count as the same task level.
 *
 * @param indentation - spaces and tabs before one checklist marker; empty means the checkbox starts at the left margin
 * @returns visual zero-based column where the marker begins
 */
function markdownIndentColumns(indentation: string): number {
  let column = 0;
  // Tabs and spaces must select the same outer checklist level the author sees in Markdown.
  for (const character of indentation) {
    column += character === "\t" ? 4 - (column % 4) : 1;
  }
  return column;
}

/**
 * Return every section whose heading equals an alias or starts with the alias and a space, in source order.
 * Example: `## Tasks and notes` also matches `tasks`, so a heading like that beside `## Tasks` makes the caller warn about competing copies.
 *
 * @param sections - parsed milestone sections; empty means nothing can match
 * @param headingAliases - lowercase headings that mean the same part, such as `exit criteria` and `exit`
 * @returns matching sections in source order; empty means the milestone has no such section
 */
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

/**
 * Join several matching sections into one Markdown block in source order, without inventing headings or reordering evidence.
 * Used for stop conditions, which older plans may split across `## Kill criteria` and `## Stop conditions`.
 *
 * @param sections - matching sections; sections with an empty body are skipped
 * @returns the bodies separated by blank lines; empty means no section had any text
 */
function joinSectionBodies(sections: readonly MarkdownSection[]): string {
  // A section with an empty body is skipped, so it leaves no stray blank gap in the joined text.
  return sections
    .map((section) => section.body)
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Remove the milestone identifier from a title used as the objective fallback, so `# M03: Add drift cache` gives `Add drift cache`.
 *
 * @param title - the milestone's top-level title; never empty, because parsing rejects milestones without one
 * @returns the title without its `M03:` or `Milestone 3:` prefix; empty only when the title is nothing but that prefix
 */
function objectiveFromTitle(title: string): string {
  return title.replace(/^(?:M\d+|Milestone\s+\d+)\s*:\s*/iu, "").trim();
}

/**
 * Add one fixed `conflicting <label> representations` warning when the milestone holds competing copies of the same part.
 * The deterministic wording never copies the author's text, and `plans check --strict` rejects the warning.
 *
 * @param warnings - record warnings shown in the export and checked by `plans check`
 * @param hasConflict - true when the caller found competing copies: a repeated section, a current heading beside a legacy one, a field that disagrees with its section, or a stop section beside an Exit stop line
 * @param label - fixed part name such as `scope` or `stop`; never the author's text
 */
function addRepresentationConflict(
  warnings: string[],
  hasConflict: boolean,
  label: string,
): void {
  // Competing copies leave the user unsure which value an export preserved.
  if (hasConflict) warnings.push(`conflicting ${label} representations`);
}

/**
 * Convert one section's Markdown checkboxes into checked/text records so `plans check` can count each item's `(est: ...)` estimate.
 *
 * An item owns every line until the next checkbox or heading, because real tasks wrap across indented continuation lines with the estimate last.
 * Nested checkboxes and nested lists stay in the parent item's text, but the estimate is read only from the text before them.
 *
 * @param markdown - one estimate-bearing section body; empty or checkbox-free text yields no items
 * @param warnings - record warning sink for malformed est entries
 * @param itemLabel - warning label for this section's items, such as `task` or `testing gate item`
 * @returns checkbox items in source order with optional estimate fields; empty means the section has no checkboxes
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
  // Only the outermost checkbox level counts as an item; a section without checkboxes yields no items at all.
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
    // The last item has no next checkbox, so it can run to the end of the section.
    const nextCheckbox = taskStarts.at(taskIndex + 1)?.index ?? markdown.length;
    const nextHeadingOffset = maskedMarkdown
      .slice(bodyStart)
      .search(/^\s*#{1,6}\s+/mu);
    // With no heading below the item, only the next checkbox or the section end can close it.
    const nextHeading =
      nextHeadingOffset >= 0 ? bodyStart + nextHeadingOffset : markdown.length;
    const bodyEnd = Math.min(nextCheckbox, nextHeading);
    const taskBodyMarkdown = markdown.slice(bodyStart, bodyEnd);
    const maskedTaskBodyMarkdown = maskedMarkdown.slice(bodyStart, bodyEnd);
    // Wrapped lines are joined with single spaces, so the exported text reads as one line.
    const text = taskBodyMarkdown.replace(/\s+/gu, " ").trim();
    const nestedListStart = maskedTaskBodyMarkdown.search(
      NESTED_LIST_ITEM_PATTERN,
    );
    // A nested list under the item is supporting detail, so the estimate is read only from the text before it.
    const estimateSourceMarkdown =
      nestedListStart < 0
        ? taskBodyMarkdown
        : taskBodyMarkdown.slice(0, nestedListStart);
    const estimateSourceText = estimateSourceMarkdown
      .replace(/\s+/gu, " ")
      .trim();
    return {
      // Both `[x]` and `[X]` mark the item done.
      isChecked: startMatch[2]?.toLowerCase() === "x",
      text,
      ...readTaskEstimate(estimateSourceText, taskIndex, warnings, itemLabel),
    };
  });
}

/**
 * Add one `missing <label>` warning when a milestone lacks a part every current plan needs, such as Scope or Proof.
 * Each absent part gets its own warning, and `plans check --strict` reports every one of them as an error in the same run.
 *
 * @param warnings - record warnings shown in the export
 * @param fieldValue - parsed text or checkbox list; empty means the author left this part out, or wrote a Tasks or Proof section with no checkboxes
 * @param label - fixed part name shown after `missing`, such as `stop/rescope`
 */
function addMissingFieldWarning(
  warnings: string[],
  fieldValue: string | readonly unknown[],
  label: string,
): void {
  // Empty text or collections tell export readers which source context was unavailable.
  if (fieldValue.length === 0) warnings.push(`missing ${label}`);
}

/**
 * Pick the preferred value unless it is empty, such as a `**Scope:**` field before a `## Scope` section.
 *
 * @param primary - preferred trimmed value; empty means the author did not write this form or left it blank
 * @param fallback - value used when primary is empty; may itself be empty
 * @returns primary when it has text, otherwise fallback
 */
function firstPopulated(primary: string, fallback: string): string {
  // Callers pass trimmed text, so an empty primary means the author skipped or blanked that form and the fallback is shown instead.
  return primary.length > 0 ? primary : fallback;
}

/**
 * Copy the author's optional effort numbers onto the record, leaving out each one the milestone never supplied.
 * Older milestones without estimates therefore keep their original export shape, with no empty effort fields.
 *
 * @param record - export record being built; this mutates it in place
 * @param effort - parsed `Effort estimate` line; undefined means the milestone has no readable effort line
 * @param taskEstimateTotals - per-category task estimate sums; undefined means no task carries an `(est: ...)` entry
 * @param planAdminEstimate - parsed `Plan/admin overhead` field; no minutes means the field is absent or unreadable
 * @param workEstimateTotals - sums over tasks, proof items, mid-proof items and admin overhead; undefined means none carries an estimate
 */
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
  // Counted work totals let `plans check --strict` compare task, proof, mid-proof and admin estimates with the headline split.
  if (workEstimateTotals) record.workEstimateTotals = workEstimateTotals;
}

/**
 * Read one section such as `## Tasks` and warn when the author supplied competing copies; the first copy is the one exported.
 *
 * @param sections - parsed milestone sections; empty means the section reads as absent
 * @param headingAliases - lowercase headings that mean this section, such as `boundary gate` and `boundary notes`
 * @param warnings - record warnings that gain the conflict message
 * @param conflictLabel - fixed part name used in the conflict warning, such as `task`
 * @returns the first matching section's body; empty means the milestone has no such section
 */
function readSingleSectionMarkdown(
  sections: MarkdownSection[],
  headingAliases: readonly string[],
  warnings: string[],
  conflictLabel: string,
): string {
  const matchingSections = readMilestoneSectionMatches(
    sections,
    headingAliases,
  );
  addRepresentationConflict(
    warnings,
    matchingSections.length > 1,
    conflictLabel,
  );
  // An absent section stays empty so the export can show the missing context explicitly.
  return matchingSections.at(0)?.body ?? "";
}

/**
 * Resolve a compact metadata field or its expanded section representation, such as `**Scope:**` versus `## Scope`; the field wins.
 *
 * A second section, or a field whose text differs from the section, adds a conflict warning that `plans check --strict` rejects.
 * Example: a note line starting `Scope:` under a milestone that already has `## Scope` counts as a competing copy.
 *
 * @param content - milestone Markdown searched for the compact field
 * @param fieldLabel - field label such as `Scope`; a plain `Scope:` line matches as well as the bold form
 * @param sections - parsed sections searched for the expanded form; empty means only the compact field can supply it
 * @param headingAliases - lowercase headings that mean the same part, such as `scope` and `scope discipline`
 * @param warnings - record warnings that gain duplicate-field and conflict messages
 * @param conflictLabel - fixed part name used in the conflict warning
 * @returns the field text, otherwise the first section body; empty means the author wrote neither form
 */
function readFieldOrSectionMarkdown(
  content: string,
  fieldLabel: string,
  sections: MarkdownSection[],
  headingAliases: readonly string[],
  warnings: string[],
  conflictLabel: string,
): string {
  const fieldValue = readMilestoneField(content, fieldLabel, warnings);
  const matchingSections = readMilestoneSectionMatches(
    sections,
    headingAliases,
  );
  // With no matching section, only the compact field can supply the value.
  const sectionBody = matchingSections.at(0)?.body ?? "";
  // The same text in both forms is allowed; only a second section or a disagreeing copy is a conflict.
  addRepresentationConflict(
    warnings,
    matchingSections.length > 1 ||
      (fieldValue.length > 0 &&
        sectionBody.length > 0 &&
        fieldValue !== sectionBody),
    conflictLabel,
  );
  return firstPopulated(fieldValue, sectionBody);
}

/**
 * Resolve explicit or section-style objectives before falling back to the outcome title, so a milestone without an Objective still exports one.
 *
 * @param content - milestone Markdown searched for the `**Objective:**` field
 * @param title - milestone title used when neither objective form exists; never empty
 * @param sections - parsed sections searched for `## Objective`; empty means only the field or the title can supply the objective
 * @param warnings - record warnings that gain duplicate-field and conflict messages
 * @returns the field, else the section, else the title without its `M03:` prefix; empty only when the title is just that prefix
 */
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
  // With no `## Objective` section, the field or the title supplies the objective.
  const objectiveSection = objectiveSections.at(0)?.body ?? "";
  // The same text in both forms is allowed; only a second section or a disagreeing copy is a conflict.
  addRepresentationConflict(
    warnings,
    objectiveSections.length > 1 ||
      (objectiveField.length > 0 &&
        objectiveSection.length > 0 &&
        objectiveField !== objectiveSection),
    "objective",
  );
  // The field wins over the section, and the section wins over the title.
  return firstPopulated(
    objectiveField,
    firstPopulated(objectiveSection, objectiveFromTitle(title)),
  );
}

/**
 * Prefer canonical `## Proof` while accepting one legacy `## Verification gate` or `## Testing gate` heading from older plans.
 *
 * @param sections - parsed milestone sections searched for the current and legacy proof headings; empty means the milestone has no level-two headings, so proof reads as absent
 * @param warnings - record warnings that gain `conflicting proof representations` for duplicates or Proof beside a legacy heading
 * @returns the proof section body; empty means the milestone has no proof heading of either kind
 */
function readProofMarkdown(
  sections: MarkdownSection[],
  warnings: string[],
): string {
  const proofSections = readMilestoneSectionMatches(sections, ["proof"]);
  const legacyProofSections = readMilestoneSectionMatches(sections, [
    "verification gate",
    "testing gate",
  ]);
  // Two Proof headings, two legacy headings, or one of each leave the developer unsure which proof the export kept.
  addRepresentationConflict(
    warnings,
    proofSections.length > 1 ||
      legacyProofSections.length > 1 ||
      (proofSections.length > 0 && legacyProofSections.length > 0),
    "proof",
  );
  // A current `## Proof` heading wins over a legacy one, and a milestone with neither exports empty proof text.
  const exportedProofSections =
    proofSections.length > 0 ? proofSections : legacyProofSections;
  return exportedProofSections.at(0)?.body ?? "";
}

/**
 * Detect multiple explicit or compact stop representations, which `plans check --strict` rejects.
 * Example: a `## Stop / rescope` section plus a `- Stop/rescope if ...` line under Exit counts as two copies.
 *
 * @param canonical - current `## Stop / rescope` or `## Stop / kill` sections; empty means the plan has no current stop heading
 * @param legacyKill - legacy `## Kill criteria` sections; empty means none
 * @param legacyStop - legacy `## Stop conditions` sections; empty means none
 * @param stopSectionText - joined text of the stop sections; empty means no stop section has text
 * @param exitStopLine - the compact stop line found under Exit; empty means there is none
 * @returns true when the developer should see `conflicting stop representations`
 */
function hasStopRepresentationConflict(
  canonical: MarkdownSection[],
  legacyKill: MarkdownSection[],
  legacyStop: MarkdownSection[],
  stopSectionText: string,
  exitStopLine: string,
): boolean {
  // Older plans may pair one Kill criteria section with one Stop conditions section.
  // Two sections of one kind, a current section beside a legacy one, or section text beside a compact Exit stop line is a conflict.
  return (
    canonical.length > 1 ||
    (canonical.length > 0 &&
      (legacyKill.length > 0 || legacyStop.length > 0)) ||
    legacyKill.length > 1 ||
    legacyStop.length > 1 ||
    (stopSectionText.length > 0 && exitStopLine.length > 0)
  );
}

/**
 * Read a dedicated stop section or the compact Exit-block stop line that tells the developer when to stop or rescope.
 *
 * @param sections - parsed milestone sections searched for current and legacy stop headings; empty means the milestone has no level-two headings, so only an Exit stop line could supply stop text
 * @param exitMarkdown - Exit criteria body searched for a `- Stop/rescope if ...` line; empty means the milestone has no Exit section
 * @param warnings - record warnings that gain `conflicting stop representations`
 * @returns the stop text, section first; empty means no stop condition, which the caller reports as `missing stop/rescope`
 */
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
  // Older plans may split stop conditions across Kill criteria and Stop conditions; both are kept in source order.
  const legacyStopSections = sections.filter(
    (section) => legacyKill.includes(section) || legacyStop.includes(section),
  );
  // A current stop heading wins; older plans fall back to their legacy headings.
  const stopSectionText =
    canonical.length > 0
      ? joinSectionBodies(canonical)
      : joinSectionBodies(legacyStopSections);
  // Compact milestones may end Exit with one `- Stop/rescope if ...` line; examples inside code fences are ignored, and no line means empty text.
  const exitStopLine =
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
      stopSectionText,
      exitStopLine,
    ),
    "stop",
  );
  // A dedicated stop section wins over the compact Exit line.
  return firstPopulated(stopSectionText, exitStopLine);
}

/**
 * Parse one goat-plan milestone into the portable export record used by `plans export`, `plans check` and forecast history.
 * Only the top-level title is mandatory: a file holding just `# M01: Name` still parses, with one `missing ...` warning per absent part.
 *
 * @param content - milestone Markdown; empty or title-less text is malformed
 * @param sourceFile - source filename shown to export readers and reused for Markdown output
 * @returns portable fields plus record warnings, including one `missing ...` warning per absent required part; a fully authored milestone has no `missing ...` warnings
 * @throws PlansExportInputError when no top-level milestone title exists
 */
export function parseMilestoneMarkdown(
  content: string,
  sourceFile: string,
): PlanExportRecord {
  // The first visible `# ` heading names the milestone; a heading inside a code fence does not count.
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
  // Forecast method lines are removed from section text, so the Markdown export shows each method selector once, in its header.
  const sections = readMilestoneSections(maskForecastMethodLines(content));
  const status = readMilestoneField(content, "Status", warnings);
  const statusReason = readStatusReason(content, status, warnings);
  const dependencies = readMilestoneField(content, "Depends on", warnings);
  const lane = readMilestoneLane(content, warnings);
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
  // Counted work covers tasks, proof, mid-proof and admin overhead; Exit criteria estimates are parsed but not counted.
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
  // Each absent required part gets its own warning, so the developer sees everything to fix in one run.
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
    // A milestone with no Status exports as `unknown`, alongside its `missing status` warning.
    status: firstPopulated(status, "unknown"),
    statusReason,
    dependencies,
    // Without a Lane header the record has no lane key, so older milestones keep their export shape.
    ...(lane !== undefined ? { lane } : {}),
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
  // Saved forecasts come only from a `## Forecast records` heading with nothing after it, unlike the prefix-matched sections above.
  const forecastContext = readPlanForecastContext(
    content,
    sections
      .filter((section) => section.heading === "forecast records")
      .map((section) => section.body),
    warnings,
  );
  // Optional forecast history is included only when the author supplied context metadata.
  if (forecastContext) {
    record.forecastContext = forecastContext;
    const problems = collectPlanForecastProblems(record);
    // Invalid records remain reviewable, but cannot silently activate forecast advice.
    if (problems.length > 0) forecastContext.method = null;
    warnings.push(...problems.map((problem) => `forecast context: ${problem}`));
  }
  return record;
}

/**
 * List the plan directory's `M*.md` milestone files in a stable numeric-order contract, so M2 comes before M10 in every export and check.
 * Reads the directory once and throws a `Cannot read plan directory` error when the path is missing, unreadable or not a directory.
 *
 * @param planPath - the `<plan-path>` the developer passed to `plans export` or `plans check`
 * @returns milestone filenames only; empty means the directory holds no `M*.md` files
 */
function listMilestoneFiles(planPath: string): string[] {
  try {
    // Only regular files named like `M01-name.md` count; `ISSUE.md`, folders and symlinks are skipped.
    return readdirSync(planPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^M\d.*\.md$/iu.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) =>
        left.localeCompare(right, undefined, { numeric: true }),
      );
  } catch (error) {
    // Example: the developer passed a milestone file instead of its plan directory (ENOTDIR), or mistyped the plan path (ENOENT).
    throw new PlansExportInputError(
      `Cannot read plan directory ${planPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Read and parse every milestone in the plan directory the developer passed to `plans export` or `plans check`.
 * Throws when the plan is empty or any milestone is unreadable or malformed; both commands report that as a usage error (exit 2).
 *
 * @param planPath - selected directory; no M*.md files means a usage error rather than an empty report
 * @returns one record per milestone file in numeric order; never empty
 */
export function loadPlanExportRecords(planPath: string): PlanExportRecord[] {
  const milestoneFiles = listMilestoneFiles(planPath);

  // An empty plan cannot produce a meaningful backlog or issue bundle; e.g. the developer passed `.goat-flow/plans` instead of a version folder.
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
      // A missing-title error already names the milestone file to fix, so it reaches the developer unchanged.
      if (error instanceof PlansExportInputError) throw error;
      // Example: M02 lost its read permission, or another tool deleted it after the directory was listed.
      throw new PlansExportInputError(
        `Cannot read ${sourceFile}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}

/**
 * Preview or persist one local plan export without invoking any remote adapter, and return the text the CLI prints.
 * Nothing is printed and no process state changes, so tests can call it in-process; requested export files are still written.
 *
 * @param options - parsed plan path, format, optional output, and explicit force choice; no `--output` means preview only
 * @returns the preview for stdout, or one `Written to` line per saved file for stderr; each line ends in a newline, and success always exits 0
 * @throws CLIError for unsupported formats, invalid plans, or protected output collisions
 */
export function runPlansExportOutput(options: ParsedCLI): {
  stdout: string;
  stderr: string;
} {
  // `--format sarif` has no plan-body shape, so the developer gets a usage error (exit 2); `text` falls through to the Markdown preview.
  if (options.format === "sarif") {
    throw new CLIError("plans export supports --format markdown or json.", 2);
  }

  let loadedRecords: PlanExportRecord[];
  try {
    loadedRecords = loadPlanExportRecords(options.projectPath);
  } catch (error) {
    // Example: the developer typed a plan path that no longer exists, or a milestone is missing its `# M01: Name` title.
    // Those plan problems become a usage error (exit 2); anything else is unexpected and propagates unchanged.
    if (error instanceof PlansExportInputError) {
      throw new CLIError(error.message, 2);
    }
    throw error;
  }
  // Unredacted filenames are kept only so the write checks can refuse an `--output` path that would overwrite a source milestone.
  const sourceFiles = loadedRecords.map((record) => record.sourceFile);
  const redactedRecords = loadedRecords.map(redactPlanExportRecord);

  const isJson = options.format === "json";
  // JSON prints one array of records; Markdown prints each milestone separated by a `---` rule.
  const renderedPreview = isJson
    ? JSON.stringify(redactedRecords, null, 2)
    : redactedRecords.map(renderPlanExportMarkdown).join("\n\n---\n\n");

  // No output path is the safe preview mode and performs no export writes.
  if (!options.output) {
    return { stdout: `${renderedPreview}\n`, stderr: "" };
  }

  let writtenPaths: string[];
  try {
    // JSON writes one file at the `--output` path; Markdown writes one file per milestone inside the `--output` directory.
    writtenPaths = isJson
      ? writeJsonExport(
          redactedRecords,
          options.output,
          options.shouldForce,
          options.projectPath,
          sourceFiles,
        )
      : writeMarkdownExports(
          redactedRecords,
          options.output,
          options.shouldForce,
          options.projectPath,
          sourceFiles,
        );
  } catch (error) {
    // Example: `--output` names a file from an earlier export and the developer did not pass `--force`.
    // Collisions and unsafe destinations become a usage error (exit 2); other filesystem failures propagate unchanged.
    if (error instanceof PlansExportInputError) {
      throw new CLIError(error.message, 2);
    }
    throw error;
  }

  // Written-path confirmations stay on stderr so scripted stdout remains artifact-free.
  return {
    stdout: "",
    stderr: writtenPaths
      .map((writtenPath) => `Written to ${writtenPath}\n`)
      .join(""),
  };
}

/**
 * Run `plans export` for the CLI: print the preview to stdout or confirm each written file on stderr.
 * Reached when the developer runs `goat-flow plans export <plan-path>`; `plans check` and `plans time` route elsewhere first.
 *
 * @param options - parsed plan path, format, optional output, and explicit force choice
 * @returns nothing; preview goes to stdout and written paths are confirmed on stderr
 * @throws CLIError for unsupported formats, invalid plans, or protected output collisions
 */
export function handlePlansExportCommand(options: ParsedCLI): void {
  const { stdout, stderr } = runPlansExportOutput(options);
  process.stdout.write(stdout);
  process.stderr.write(stderr);
}
