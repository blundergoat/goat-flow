/**
 * Check the plan folder an author passes to `goat-flow plans check` and print one report; this file also routes every `plans` subcommand.
 * Run it after writing or editing milestone files, before an agent starts the next milestone.
 *
 * Each run has three steps and one verdict:
 * - Parse: load the folder's `M*.md` milestone files and redact their text before anything is printed.
 * - Validate: check Effort arithmetic and forecast fields; `--strict` adds structure, dependency and lifecycle rules.
 * - Report: print milestone rows, `active:`, `ready:`/`waiting:` and `plan:` lines and advice, then `warning:` and `error:` lines.
 * - Exit code 1 means at least one `error:` line; advice and warnings never fail the run, and no audit or quality gate reads it.
 */
import { realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { CLIError } from "./cli-error.js";
import { loadConfig } from "./config/reader.js";
import { DEFAULT_FORECAST_BAND_QUANTILES } from "./config/config-vocabulary.js";
import type { ForecastBandQuantiles } from "./config/types.js";
import { writeOutput } from "./cli-output.js";
import type { ParsedCLI } from "./cli-types.js";
import {
  countAgentWorkUnits,
  isNumericActual,
  validateForecastBasis,
  type PlanEffortNumericActual,
  type PlanEffortSplit,
} from "./plans-effort.js";
import {
  handlePlansExportCommand,
  isPlansExportInputError,
  loadPlanExportRecords,
  redactPlanExportRecord,
  type PlanExportRecord,
} from "./plans-export.js";
import {
  handlePlansTimeCommand,
  type PlanTimingSummary,
} from "./plans-time.js";
import {
  renderCalibrationSummary,
  renderForecastHistorySummary,
  renderActivePlanSummary,
  renderReadinessSummary,
  renderMilestoneLine,
  renderPlanSummary,
} from "./plans-check-summary.js";
import {
  collectPlanStructureAdvisories,
  collectPlanStructureErrors,
  VALID_STATUSES,
} from "./plans-check-structure.js";
import {
  forecastAllocation,
  issuedPlanForecast,
} from "./plans-forecast-context.js";
import { discoverPlanForecastHistory } from "./plans-forecast-history.js";
import { renderForecastModelSummary } from "./plans-forecast-model.js";

/** Effort categories in the order their split mismatch errors are reported. */
const CATEGORIES = ["product", "proof", "other"] as const;

/**
 * States that stop ordinary execution and therefore owe the reader one `Status reason:`.
 * `superseded` names the milestone that carries the remainder; `deferred` names the later release or record that owns the scope.
 */
const EXCEPTIONAL_STATUSES = new Set([
  "blocked",
  "abandoned",
  "superseded",
  "deferred",
]);

/** Warnings for a missing required milestone field or section, or an unfinalized receipt summary; `--strict` always fails on these. */
const STRICT_STRUCTURAL_WARNINGS = new Set([
  "missing status",
  "missing scope",
  "missing tasks",
  "missing proof",
  "missing exit criteria",
  "missing stop/rescope",
  // A summary claims a final total even when no Actual cites it and no clock is open.
  "timing receipt summary requires finalized state",
]);

/**
 * Render `(18 product / 5 proof / 2 other)`-style split text for report lines.
 * Use wherever the report echoes a split back in the same notation the plan author wrote, so the fix is a copy-edit away.
 *
 * @param split - minutes per category; zeros render literally so gaps stay visible
 * @returns the parenthesised split text
 */
function renderSplit(split: PlanEffortSplit): string {
  return `(${split.product} product / ${split.proof} proof / ${split.other} other)`;
}

/**
 * Decide which parser warnings fail a `--strict` run; Timing Receipt warnings fail only when a measured Actual or running clock relies on it.
 *
 * Example: the author ran `plans check --strict` on a plan whose M02 file repeats its Status line, so `multiple Status values supplied` fails.
 *
 * @param warning - parser diagnostic shown with the milestone that needs repair
 * @param isReceiptClaimed - whether the authored Actual relies on measured receipt evidence
 * @param isReceiptActive - whether the receipt controls a running clock
 * @returns true when the warning prevents strict validation
 */
function isStrictValidationWarning(
  warning: string,
  isReceiptClaimed: boolean,
  isReceiptActive: boolean,
): boolean {
  return (
    warning.includes("actual effort not parseable") ||
    warning === "blank Status reason supplied" ||
    warning === "legacy Abandoned field supplied; use Status reason" ||
    warning.startsWith("invalid Lane value;") ||
    ((isReceiptClaimed || isReceiptActive) &&
      warning.startsWith("timing receipt")) ||
    /^multiple .+ values supplied$/u.test(warning) ||
    STRICT_STRUCTURAL_WARNINGS.has(warning) ||
    /^conflicting .+ representations$/u.test(warning)
  );
}

/**
 * Decide which parser warnings become `error:` lines: unreadable estimate or forecast fields fail every run; others can fail only under `--strict`.
 *
 * @param warning - one parser warning from the milestone record
 * @param isStrict - whether strict current-plan validation is selected
 * @param isReceiptClaimed - whether an Actual derives its authority from the receipt
 * @param isReceiptActive - whether the receipt currently controls an executing clock
 * @returns true when the warning should become a check error
 */
function isValidationWarning(
  warning: string,
  isStrict: boolean,
  isReceiptClaimed: boolean,
  isReceiptActive: boolean,
): boolean {
  // A malformed task or admin estimate hides the work value the user intended to validate.
  if (warning.includes("estimate not parseable")) return true;

  // Drifted range notation is as fatal as a drifted estimate: both hide real numbers.
  if (warning.startsWith("forecast range not parseable")) return true;
  // An unreadable basis hides the work-unit count and provenance behind the headline.
  if (warning.startsWith("forecast basis not parseable")) return true;
  // Invalid opt-in metadata must be repaired before the author can rely on a contextual forecast.
  if (warning.startsWith("forecast context:")) return true;
  // Default mode leaves newer structural rules advisory for archived plans.
  if (!isStrict) return false;
  return isStrictValidationWarning(warning, isReceiptClaimed, isReceiptActive);
}

/**
 * Turn fatal parser warnings into errors that start with the milestone file the author must fix; the report prints each as an `error:` line.
 *
 * Under `--strict`, Timing Receipt warnings count only when the Actual is measured or the receipt clock is still running.
 *
 * @param record - milestone with its authored fields and parser warnings
 * @param isStrict - whether current-plan structural obligations apply
 * @returns source-labelled errors; empty means no parser warning was fatal
 */
function collectWarningErrors(
  record: PlanExportRecord,
  isStrict: boolean,
): string[] {
  const receiptIsClaimed = record.effort?.actual?.state === "measured";
  const receiptIsActive = record.timingReceipt?.state === "active";
  return record.warnings
    .filter((warning) =>
      isValidationWarning(warning, isStrict, receiptIsClaimed, receiptIsActive),
    )
    .map((warning) => `${record.sourceFile}: ${warning}`);
}

/**
 * Read one category's minutes from a set of category totals so the split check can compare product, proof and other separately.
 *
 * @param split - task or counted-work totals; undefined counts as 0 minutes, so a milestone without those estimates is still compared
 * @param category - which category to read: product, proof or other
 * @returns that category's minutes; 0 when the totals are absent
 */
function categoryMinutes(
  split: PlanEffortSplit | undefined,
  category: keyof PlanEffortSplit,
): number {
  // A missing optional split contributes zero until the milestone author supplies category totals.
  if (!split) return 0;
  return split[category];
}

/**
 * Check each split category against the minutes the milestone counts, adding one error per category that disagrees.
 *
 * A saved original forecast or `--strict` needs an exact match; a default-mode plan fails only when its task estimates exceed a category.
 *
 * @param record - milestone whose estimated tasks, proof and admin work, or saved original forecast items, supply the counted minutes
 * @param split - product/proof/other minutes the author wrote on the Effort line
 * @param isStrict - whether the author passed `--strict`
 * @returns `counted work` or `task estimates` mismatch errors; empty when every category reconciles
 */
function collectCategoryErrors(
  record: PlanExportRecord,
  split: PlanEffortSplit,
  isStrict: boolean,
): string[] {
  const errors: string[] = [];
  const issuedForecast = issuedPlanForecast(record);
  // With a saved original forecast, the split is checked against its items, so a later remaining-work revision cannot move the headline.
  const countedWork = issuedForecast
    ? forecastAllocation(issuedForecast)
    : record.workEstimateTotals;
  // Each category receives its own diagnostic so the user can repair every mismatch in one pass.
  for (const category of CATEGORIES) {
    const taskMinutes = categoryMinutes(record.taskEstimateTotals, category);
    const countedMinutes = categoryMinutes(countedWork, category);
    // A saved original forecast must match in every run; without one, `--strict` compares the split with every task, proof and admin estimate.
    if (isStrict || issuedForecast) {
      // A mismatch means the authored split does not describe all work visible in the milestone.
      if (countedMinutes !== split[category]) {
        errors.push(
          `${record.sourceFile}: ${category} counted work (${countedMinutes} min) does not equal the split component (${split[category]} min)`,
        );
      }
      continue;
    }
    // Legacy plans fail only when their task estimates already exceed the declared category budget.
    if (taskMinutes > split[category]) {
      errors.push(
        `${record.sourceFile}: ${category} task estimates (${taskMinutes} min) exceed the split component (${split[category]} min)`,
      );
    }
  }
  return errors;
}

/**
 * Check that the Effort line's product/proof/other split adds up to its headline total and matches the work the milestone counts.
 *
 * @param record - milestone whose Effort line is checked; no Effort line means nothing to check
 * @param isStrict - whether the author passed `--strict`, which also makes a missing split an error
 * @returns split errors for the report; empty when the split is absent in default mode or every sum matches
 */
function collectSplitErrors(
  record: PlanExportRecord,
  isStrict: boolean,
): string[] {
  const errors: string[] = [];
  const effort = record.effort;
  // A milestone without an Effort line has no headline arithmetic to reconcile here.
  if (!effort) return errors;
  const split = effort.split;
  // Without a split there is no category arithmetic; only `--strict` reports the missing split itself.
  if (!split) {
    // Strict users need all three categories before the report can explain where time goes.
    if (isStrict) {
      errors.push(
        `${record.sourceFile}: strict mode requires a product/proof/other split`,
      );
    }
    return errors;
  }

  const splitSum = split.product + split.proof + split.other;
  // The category total must equal the headline number shown to the user.
  if (splitSum !== effort.totalMinutes) {
    errors.push(
      `${record.sourceFile}: split ${renderSplit(split)} sums to ${splitSum} min but the headline says ${effort.totalMinutes} min`,
    );
  }
  errors.push(...collectCategoryErrors(record, split, isStrict));
  return errors;
}

/**
 * Check the optional `Forecast range:` band: low, likely and high must be in order, and likely must equal the Effort headline.
 *
 * @param record - milestone whose range is checked; no range means a plain point estimate with nothing to check
 * @returns range errors for the report; empty when the range is absent or consistent
 */
function collectForecastRangeErrors(record: PlanExportRecord): string[] {
  const effort = record.effort;
  const range = effort?.forecastRange;
  // A point estimate or legacy milestone has no optional range arithmetic to check.
  if (!effort || !range) return [];

  const errors: string[] = [];
  // Reversed bounds would make the displayed low-likely-high forecast misleading.
  if (
    range.lowMinutes > range.likelyMinutes ||
    range.likelyMinutes > range.highMinutes
  ) {
    errors.push(
      `${record.sourceFile}: forecast range must satisfy low <= likely <= high (${range.lowMinutes}-${range.likelyMinutes}-${range.highMinutes} min)`,
    );
  }

  // One milestone cannot forecast two different centres, whatever the band's width.
  if (range.likelyMinutes !== effort.totalMinutes) {
    errors.push(
      `${record.sourceFile}: forecast range likely (${range.likelyMinutes} min) must equal the Effort estimate total (${effort.totalMinutes} min)`,
    );
  }
  return errors;
}

/**
 * Check that the optional `Forecast basis:` line agrees with the milestone's counted work items and the `Forecast range:` it derives.
 *
 * @param record - milestone with an optional `Forecast basis:` line; without one, its plain estimate gets no basis errors
 * @returns source-labelled errors; empty means the basis is absent or fully reconciled
 */
function collectForecastBasisErrors(record: PlanExportRecord): string[] {
  const forecastBasis = record.effort?.forecastBasis;
  // Plans without the opt-in field keep their existing estimate contract and receive no error.
  if (!forecastBasis) return [];
  // A saved original forecast fixes the work-item count; otherwise count today's tasks, proof items and admin estimate, if one exists.
  const countedAgentWorkUnits =
    issuedPlanForecast(record)?.items.length ??
    countAgentWorkUnits([
      ...record.tasks,
      ...record.testingGateItems,
      ...record.midProofItems,
      record.planAdminEstimate ?? {},
    ]);
  // Prefix each shared validation message with the milestone the user needs to edit.
  return validateForecastBasis(
    forecastBasis,
    record.effort?.forecastRange,
    countedAgentWorkUnits,
  ).map((forecastProblem) => `${record.sourceFile}: ${forecastProblem}`);
}

/**
 * Report work items with no `(est: ...)` entry once a milestone declares Effort, so the headline covers every listed item.
 * Tasks always need one; `--strict` also requires them on testing gate and mid-proof items.
 *
 * @param record - milestone with a declared Effort line
 * @param isStrict - whether the author passed `--strict`; false skips proof-item coverage so older plans still pass
 * @returns one error per item kind with missing estimates; empty when every counted item has one
 */
function collectCoverageErrors(
  record: PlanExportRecord,
  isStrict: boolean,
): string[] {
  const errors: string[] = [];
  const unestimatedTasks = record.tasks.filter(
    (task) => task.estimateMinutes === undefined,
  ).length;
  // Every implementation task needs a visible estimate when the milestone declares effort.
  if (unestimatedTasks > 0) {
    errors.push(
      `${record.sourceFile}: ${unestimatedTasks} task(s) missing an (est: ...) entry under a declared effort line`,
    );
  }
  // Default mode preserves archived plans that predate proof-item estimates.
  if (!isStrict) return errors;

  const unestimatedTestingItems = record.testingGateItems.filter(
    (item) => item.estimateMinutes === undefined,
  ).length;
  // Strict-plan users need estimates on final proof so the forecast includes verification.
  if (unestimatedTestingItems > 0) {
    errors.push(
      `${record.sourceFile}: ${unestimatedTestingItems} testing gate item(s) missing an (est: ...) entry`,
    );
  }

  const unestimatedMidProofItems = record.midProofItems.filter(
    (item) => item.estimateMinutes === undefined,
  ).length;
  // Mid-work checkpoints also consume agent time and must be visible in strict forecasts.
  if (unestimatedMidProofItems > 0) {
    errors.push(
      `${record.sourceFile}: ${unestimatedMidProofItems} mid-proof item(s) missing an (est: ...) entry`,
    );
  }
  return errors;
}

/**
 * Under `--strict`, compare the milestone's Actual with its Status: complete or handed-off work needs one, and not-started work must not.
 * Example: the author set M03 to complete but has not yet recorded its Actual.
 *
 * @param record - milestone whose Status and optional Actual are compared
 * @returns Actual errors for the report; empty when no Actual is due yet or the Actual passes its checks
 */
function collectActualErrors(record: PlanExportRecord): string[] {
  const errors: string[] = [];
  const actual = record.effort?.actual;
  const status = record.status.trim().toLowerCase();
  // No Actual is expected before work, but finished or handed-off work needs a recorded outcome.
  if (!actual) {
    // These lifecycle states tell readers execution is over, so missing actuals would hide the result.
    if (status === "complete" || status === "human-verification-pending") {
      errors.push(
        `${record.sourceFile}: ${status} milestone requires a structured Actual with total and product/proof/other split`,
      );
    }
    return errors;
  }
  // A not-started label must not coexist with evidence that work already happened.
  if (status === "not-started") {
    errors.push(
      `${record.sourceFile}: not-started milestone must not include Actual before work begins`,
    );
  }
  // Unknown or unavailable Actuals carry prose, not numeric split arithmetic.
  if (!isNumericActual(actual)) {
    return errors;
  }
  errors.push(...collectNumericActualErrors(record, actual));
  return errors;
}

/**
 * Check that a numeric Actual's product/proof/other split adds up to its total, then pass measured Actuals on to the receipt check.
 *
 * @param record - milestone that owns the Actual, named in each error
 * @param actual - measured or retrospective numeric Actual; a missing split is itself an error
 * @returns split errors; empty when the split sums correctly and any measured claim matches its receipt
 */
function collectNumericActualErrors(
  record: PlanExportRecord,
  actual: PlanEffortNumericActual,
): string[] {
  // Numeric Actuals need category totals so users can compare the outcome with the forecast.
  if (!actual.split) {
    return [
      `${record.sourceFile}: structured Actual requires a product/proof/other split`,
    ];
  }
  const errors: string[] = [];
  const actualSplitSum =
    actual.split.product + actual.split.proof + actual.split.other;
  // The recorded categories must add up to the Actual headline shown in the milestone.
  if (actualSplitSum !== actual.totalMinutes) {
    errors.push(
      `${record.sourceFile}: Actual split ${renderSplit(actual.split)} sums to ${actualSplitSum} min but Actual says ${actual.totalMinutes} min`,
    );
  }
  // A measured claim must reconcile with its embedded timing receipt.
  if (actual.state === "measured") {
    errors.push(...collectMeasuredActualErrors(record, actual, actual.split));
  }
  return errors;
}

/**
 * Check a measured Actual against the milestone's Timing Receipt: the receipt must be finalized and its seconds and minutes must match.
 * Example: the author wrote a measured Actual while the milestone's Timing Receipt was still active or paused.
 *
 * @param record - milestone whose embedded Timing Receipt is the evidence
 * @param actual - the measured Actual, whose reason must quote the receipt's seconds
 * @param split - the Actual's category minutes, compared with the receipt's allocation
 * @returns receipt errors; empty when the Actual matches the finalized receipt exactly
 */
function collectMeasuredActualErrors(
  record: PlanExportRecord,
  actual: PlanEffortNumericActual,
  split: PlanEffortSplit,
): string[] {
  const receipt = record.timingReceipt;
  // Without a finalized summary, the user cannot audit a measured Actual.
  if (receipt?.state !== "finalized" || receipt.summary === undefined) {
    return [
      `${record.sourceFile}: measured Actual requires a finalized embedded Timing Receipt`,
    ];
  }
  const errors = collectClaimedSecondsErrors(
    record.sourceFile,
    actual.reason,
    receipt.summary.totalSeconds,
  );
  // Minute totals and category allocation must tell the same story as the receipt.
  if (!actualMatchesTimingSummary(actual, split, receipt.summary)) {
    errors.push(
      `${record.sourceFile}: measured Actual total and split must match the Timing Receipt minute allocation`,
    );
  }
  return errors;
}

/**
 * Check that a measured Actual's reason reads `receipt <seconds> recorded-unpaused seconds` and that those seconds equal the receipt total.
 *
 * @param sourceFile - milestone file named at the start of each error
 * @param reason - the Actual's reason text; any other wording, including an empty reason, fails the format check
 * @param receiptSeconds - recorded unpaused seconds from the finalized Timing Receipt summary
 * @returns one format or mismatch error; empty when the reason names exactly the receipt's seconds
 */
function collectClaimedSecondsErrors(
  sourceFile: string,
  reason: string,
  receiptSeconds: number,
): string[] {
  const claimedSecondsText = reason.match(
    /^receipt\s+(\d+)\s+recorded-unpaused seconds$/u,
  )?.[1];
  // Missing seconds make the measured claim impossible for a user to trace back to the receipt.
  if (claimedSecondsText === undefined) {
    return [
      `${sourceFile}: measured Actual reason must name receipt <seconds> recorded-unpaused seconds`,
    ];
  }
  const claimedSeconds = Number(claimedSecondsText);
  // Unsafe integers cannot represent a trustworthy recorded duration.
  if (!Number.isSafeInteger(claimedSeconds)) {
    return [
      `${sourceFile}: measured Actual reason must name receipt <seconds> recorded-unpaused seconds`,
    ];
  }
  // A different number is reported beside the receipt's figure so the author can copy the right value into the Actual.
  return claimedSeconds === receiptSeconds
    ? []
    : [
        `${sourceFile}: measured Actual receipt says ${claimedSeconds} seconds but Timing Receipt says ${receiptSeconds}`,
      ];
}

/**
 * Report whether a measured Actual's total and split equal the minutes the finalized Timing Receipt assigns to each category.
 *
 * @param actual - measured Actual whose total minutes are compared
 * @param split - the Actual's product/proof/other minutes
 * @param summary - finalized receipt summary with total and per-category minutes
 * @returns true when the total and every category match; false adds the minute-allocation error
 */
function actualMatchesTimingSummary(
  actual: PlanEffortNumericActual,
  split: PlanEffortSplit,
  summary: PlanTimingSummary,
): boolean {
  return (
    actual.totalMinutes === summary.totalMinutes &&
    split.product === summary.minutes.product &&
    split.proof === summary.minutes.proof &&
    split.other === summary.minutes.other
  );
}

/**
 * Count unticked boxes in one checklist so Status checks can catch a milestone that claims more progress than its boxes show.
 *
 * @param items - task, proof, mid-proof or exit-criteria checkboxes; an empty list counts as 0 open
 * @param predicate - optional filter, such as skipping `[human]` proof items; absent counts every unticked box
 * @returns number of unticked boxes that pass the filter
 */
function countOpenItems(
  items: PlanExportRecord["tasks"],
  predicate: (item: PlanExportRecord["tasks"][number]) => boolean = () => true,
): number {
  return items.filter((item) => !item.isChecked && predicate(item)).length;
}

/**
 * Human ownership is explicit metadata, never inferred from prose or checkbox state.
 * A testing gate item belongs to the human verifier only when its text starts with the word `[human]`, in any letter case.
 *
 * @param gateItem - one testing gate checkbox
 * @returns true when the item waits for a human; false means the agent must tick it before handoff
 */
function isHumanOwnedItem(
  gateItem: PlanExportRecord["testingGateItems"][number],
): boolean {
  return /^\s*\[human\](?:\s|$)/iu.test(gateItem.text);
}

/**
 * Check a `human-verification-pending` milestone: tasks, agent proof, mid-proof and exit criteria must all be ticked before the handoff.
 * Unticked `[human]` testing gate items are allowed because they are the checks the human still has to run.
 *
 * @param record - milestone whose checklists are inspected
 * @param openTasks - unticked implementation tasks; 0 means implementation is finished
 * @returns one error per checklist that is still open; empty when the milestone is ready for human verification
 */
function collectHumanPendingErrors(
  record: PlanExportRecord,
  openTasks: number,
): string[] {
  const errors: string[] = [];
  // Open implementation work means the milestone is not ready for the user's manual checks.
  if (openTasks > 0) {
    errors.push(
      `${record.sourceFile}: human-verification-pending milestone has open implementation tasks`,
    );
  }
  const openExecutorProof = countOpenItems(
    record.testingGateItems,
    (item) => !isHumanOwnedItem(item),
  );
  // Executor-owned proof must finish before responsibility passes to the user.
  if (openExecutorProof > 0) {
    errors.push(
      `${record.sourceFile}: executor proof item remains open at human-verification-pending`,
    );
  }
  // Mid-work proof is agent-owned and cannot remain open at handoff.
  if (countOpenItems(record.midProofItems) > 0) {
    errors.push(
      `${record.sourceFile}: executor mid-proof item remains open at human-verification-pending`,
    );
  }
  // Exit criteria must be satisfied before the user receives a verification-ready milestone.
  if (countOpenItems(record.exitCriteriaItems) > 0) {
    errors.push(
      `${record.sourceFile}: human-verification-pending milestone has open exit criteria`,
    );
  }
  return errors;
}

/**
 * Check a `complete` milestone: every task, proof item, mid-proof item and exit criterion must be ticked, `[human]` items included.
 * Example: the author set Status to complete while a testing gate box was still unticked.
 *
 * @param record - milestone whose checklists are inspected
 * @param openTasks - unticked implementation tasks; 0 means implementation is finished
 * @returns one error per checklist that is still open; empty when the milestone is fully closed
 */
function collectCompleteSnapshotErrors(
  record: PlanExportRecord,
  openTasks: number,
): string[] {
  const errors: string[] = [];
  // A complete label cannot hide unfinished implementation work from the user.
  if (openTasks > 0) {
    errors.push(
      `${record.sourceFile}: complete milestone has open implementation tasks`,
    );
  }
  // Final proof must be closed before the milestone appears complete.
  if (countOpenItems(record.testingGateItems) > 0) {
    errors.push(
      `${record.sourceFile}: complete milestone has open proof items`,
    );
  }
  // Mid-work proof must also be closed in the final snapshot.
  if (countOpenItems(record.midProofItems) > 0) {
    errors.push(
      `${record.sourceFile}: complete milestone has open mid-proof items`,
    );
  }
  // Open exit criteria tell the user the declared outcome is not fully delivered.
  if (countOpenItems(record.exitCriteriaItems) > 0) {
    errors.push(
      `${record.sourceFile}: complete milestone has open exit criteria`,
    );
  }
  return errors;
}

/**
 * Check a `not-started` milestone: no box may be ticked and no Timing Receipt may exist, because either shows work already began.
 *
 * @param record - milestone whose checklists and receipt are inspected
 * @param checkedTasks - ticked implementation tasks; 0 is the only count a not-started milestone allows
 * @returns one error per checklist or receipt that shows work began; empty when the file shows none
 */
function collectNotStartedSnapshotErrors(
  record: PlanExportRecord,
  checkedTasks: number,
): string[] {
  const errors: string[] = [];
  // Checked tasks reveal work that conflicts with the not-started label.
  if (checkedTasks > 0) {
    errors.push(
      `${record.sourceFile}: not-started milestone has checked implementation tasks`,
    );
  }
  // Completed final proof also means execution already began.
  if (record.testingGateItems.some((item) => item.isChecked)) {
    errors.push(
      `${record.sourceFile}: not-started milestone has checked proof items`,
    );
  }
  // Completed mid-work proof contradicts a milestone that claims no work started.
  if (record.midProofItems.some((item) => item.isChecked)) {
    errors.push(
      `${record.sourceFile}: not-started milestone has checked mid-proof items`,
    );
  }
  // Completed exit criteria are outcome evidence and cannot belong to a not-started snapshot.
  if (record.exitCriteriaItems.some((item) => item.isChecked)) {
    errors.push(
      `${record.sourceFile}: not-started milestone has checked exit criteria`,
    );
  }

  // Any receipt means timing already began; paused work contradicts not-started just as active work does.
  if (record.timingReceipt !== undefined) {
    errors.push(
      `${record.sourceFile}: not-started milestone must not include a Timing Receipt`,
    );
  }
  return errors;
}

/**
 * Flag a Timing Receipt clock that is still running on a milestone whose Status says agent work has stopped, such as `complete`.
 * Example: the author marked the milestone complete while its `plans time` clock was still running.
 *
 * @param record - milestone whose receipt segments are inspected; no receipt means no running clock
 * @param status - lowercased Status, quoted in the error
 * @returns one active-receipt error; empty when no timing segment is open
 */
function collectInactiveReceiptErrors(
  record: PlanExportRecord,
  status: string,
): string[] {
  // A later open span still runs even when an earlier discard keeps the receipt incomplete.
  const hasOpenTimingSegment =
    record.timingReceipt?.segments.some(
      (segment) => segment.state === "open",
    ) ?? false;
  // With no live span, the milestone's inactive status and timing evidence agree.
  if (!hasOpenTimingSegment) return [];
  return [
    `${record.sourceFile}: ${status} milestone must not have an active Timing Receipt`,
  ];
}

/**
 * Check a `testing-gate` milestone: every implementation task must be ticked first; its timing clock may keep running during proof.
 *
 * @param record - milestone named in the error
 * @param openTasks - unticked implementation tasks; 0 means testing may proceed
 * @returns one open-tasks error; empty when implementation is finished
 */
function collectTestingGateErrors(
  record: PlanExportRecord,
  openTasks: number,
): string[] {
  // Testing can begin only after the implementation checklist is closed.
  if (openTasks === 0) return [];
  return [
    `${record.sourceFile}: testing-gate milestone has open implementation tasks`,
  ];
}

/**
 * Check `Status reason:` against Status: blocked, abandoned, superseded and deferred milestones need one; other states must not keep one.
 *
 * @param record - milestone whose Status reason is read; blank text counts as no reason
 * @param status - lowercased Status that decides whether a reason is required
 * @returns one missing-reason or stale-reason error; empty when the reason matches the Status
 */
function collectStatusReasonErrors(
  record: PlanExportRecord,
  status: string,
): string[] {
  const errors: string[] = [];
  const statusReason = record.statusReason.trim();
  const hasExceptionalStatus = EXCEPTIONAL_STATUSES.has(status);
  // A blocked, abandoned, superseded or deferred milestone must explain why ordinary execution stopped.
  if (hasExceptionalStatus && statusReason.length === 0) {
    errors.push(
      `${record.sourceFile}: ${status} milestone requires Status reason`,
    );
  } else if (
    // Ordinary lifecycle states cannot retain a stale explanation that says execution stopped.
    !hasExceptionalStatus &&
    statusReason.length > 0
  ) {
    errors.push(
      `${record.sourceFile}: ${status} milestone must not include Status reason`,
    );
  }
  return errors;
}

/**
 * Under `--strict`, check that a milestone's Status agrees with its checkboxes, Status reason and Timing Receipt.
 * Only the file as it stands is judged; earlier Status values are not visible to the check.
 *
 * @param record - milestone parsed from one `M*.md` file
 * @returns lifecycle errors; empty when Status is missing (already reported) or consistent with the file
 */
function collectLifecycleErrors(record: PlanExportRecord): string[] {
  const status = record.status.trim().toLowerCase();

  // An absent or blank Status already has the dedicated `missing status` diagnostic; a written `unknown` names no lifecycle state.
  if (record.warnings.includes("missing status")) return [];
  // An unfamiliar label cannot tell the user which lifecycle obligations apply.
  if (!VALID_STATUSES.has(status)) {
    return [`${record.sourceFile}: unsupported status \`${status}\``];
  }

  const errors = collectStatusReasonErrors(record, status);

  const openTasks = countOpenItems(record.tasks);
  const checkedTasks = record.tasks.length - openTasks;
  // Each Status brings its own checklist rules; `in-progress` adds none, and the default branch only requires a stopped clock.
  switch (status) {
    case "not-started":
      return [
        ...errors,
        ...collectNotStartedSnapshotErrors(record, checkedTasks),
      ];
    case "in-progress":
      return errors;
    case "testing-gate":
      return [...errors, ...collectTestingGateErrors(record, openTasks)];
    case "human-verification-pending":
      return [
        ...errors,
        ...collectInactiveReceiptErrors(record, status),
        ...collectHumanPendingErrors(record, openTasks),
      ];
    case "complete":
      return [
        ...errors,
        ...collectInactiveReceiptErrors(record, status),
        ...collectCompleteSnapshotErrors(record, openTasks),
      ];
    default:
      return [...errors, ...collectInactiveReceiptErrors(record, status)];
  }
}

/**
 * Gather every error for one milestone file: fatal parser warnings, `--strict` lifecycle rules, then Effort, estimate, forecast and Actual checks.
 *
 * @param record - parsed milestone; optional legacy fields create no obligations unless supplied
 * @param isStrict - whether current-plan structure and lifecycle requirements also apply
 * @returns source-labelled errors; empty means the applicable contracts hold
 */
function collectMilestoneErrors(
  record: PlanExportRecord,
  isStrict: boolean,
): string[] {
  const errors = collectWarningErrors(record, isStrict);
  // Strict mode validates the visible status against tasks, proof, and timing evidence.
  if (isStrict) {
    errors.push(...collectLifecycleErrors(record));
  }

  // Default mode preserves legacy plans; strict authoring requires the current notation.
  if (!record.effort) {
    // A current-format plan needs an estimate before users can assess its size.
    if (isStrict) {
      errors.push(
        `${record.sourceFile}: strict mode requires an Effort estimate with a product/proof/other split`,
      );
    }
    return errors;
  }

  errors.push(...collectSplitErrors(record, isStrict));
  errors.push(...collectCoverageErrors(record, isStrict));
  errors.push(...collectForecastRangeErrors(record));
  errors.push(...collectForecastBasisErrors(record));
  // Structured Actual requirements apply only to current strict authoring.
  if (isStrict) {
    errors.push(...collectActualErrors(record));
  }
  return errors;
}

/**
 * Stop `plans check` before any work when the author passes a flag that writes files, since the check only prints a report.
 *
 * `--format` is ignored, not rejected: its default depends on whether stdout is a terminal, so rejecting it would break piped runs without the flag.
 *
 * @param options - flags from the author's `plans check` command line
 * @throws CLIError with exit code 2 when `--force` or `--output` is passed
 */
function assertCheckUsage(options: ParsedCLI): void {
  // e.g. the user copied a `plans export ... --force` line and swapped in `check`.
  if (options.shouldForce) {
    throw new CLIError(
      "--force is only valid for install, setup --apply, or plans export.",
      2,
    );
  }

  // The report is a terminal read, not an artifact - redirecting it would imply a write contract.
  if (options.output) {
    throw new CLIError(
      "plans check does not support --output; the report prints to stdout.",
      2,
    );
  }
}

/**
 * Build the `plans check` report for one plan folder: load its milestones, validate them and render every report line.
 *
 * Exit code 1 means at least one `error:` line; an off-target product/proof/other mix or a default-mode plan with no estimates never fails.
 * Milestone text is redacted before validation, and history entries are redacted when their advice lines are rendered.
 * Nothing is printed and no process state changes, so tests can call it in-process.
 *
 * @param options - parsed plan path plus global flags
 * @returns the verdict and the report text the CLI prints, without its trailing newline
 * @throws CLIError with exit code 2 for a rejected flag, an unreadable or empty plan folder, or unreadable project config
 */
export function runPlansCheckReport(options: ParsedCLI): {
  exitCode: 0 | 1;
  report: string;
} {
  // e.g. the user finished writing milestones and ran `goat-flow plans check .goat-flow/plans/<active>`.
  assertCheckUsage(options);
  const { maxActiveMilestones: maxActive, forecastBandQuantiles } =
    resolvePlanPolicy(options);

  let records: PlanExportRecord[];
  try {
    records = loadPlanExportRecords(options.projectPath).map(
      redactPlanExportRecord,
    );
  } catch (error) {
    // Example: the user pointed at an archived plan folder that no longer holds M*.md files.
    if (isPlansExportInputError(error)) {
      throw new CLIError(error.message, 2);
    }
    throw error;
  }

  const errors = records.flatMap((record) =>
    collectMilestoneErrors(record, options.plansStrict),
  );
  const structureAdvisories = collectPlanStructureAdvisories(
    records,
    options.plansStrict,
  );
  // Strict mode also checks ordering and dependencies across the whole selected plan.
  if (options.plansStrict) {
    errors.push(...collectPlanStructureErrors(records, maxActive));
  }

  // Milestones with estimates become report rows; legacy ones contribute nothing.
  const milestoneLines = records
    .map(renderMilestoneLine)
    .filter((line): line is string => line !== null);
  const planSummary = renderPlanSummary(records);
  // Readiness follows the active rows so the author reads what is running, then what can start next, before the totals.
  const reportLines = [
    ...milestoneLines,
    ...renderActivePlanSummary(records, maxActive),
    ...renderReadinessSummary(records, maxActive),
    ...planSummary,
  ];

  // Calibration only means something next to a mix summary, so it follows the same gate.
  if (planSummary.length > 0) {
    reportLines.push(
      ...renderCalibrationSummary(records, forecastBandQuantiles),
    );
  }

  reportLines.push(...renderProjectHistory(records, options.projectPath));

  // No effort rows and no errors means the user selected a legacy plan, even when prose advice follows.
  if (
    milestoneLines.length === 0 &&
    planSummary.length === 0 &&
    errors.length === 0
  ) {
    reportLines.unshift(
      "no effort estimates found - this plan predates the estimation notation (informational)",
    );
  }

  // Non-blocking findings stay visible so authors can clean old or default-mode prose without breaking automation.
  if (structureAdvisories.length > 0) {
    reportLines.push(
      ...structureAdvisories.map((advisory) => `warning: ${advisory}`),
    );
  }

  // Deterministic errors end the report and flip the exit code so scripts can gate on it.
  let exitCode: 0 | 1 = 0;
  if (errors.length > 0) {
    reportLines.push(...errors.map((line) => `error: ${line}`));
    exitCode = 1;
  }
  return { exitCode, report: reportLines.join("\n") };
}

/**
 * Run `plans check` for the CLI: print the report to stdout and set exit code 1 when it contains an error.
 *
 * @param options - parsed plan path plus global flags
 * @returns nothing; the report goes to stdout and the exit code carries the verdict
 * @throws CLIError with exit code 2 for a rejected flag, an unreadable or empty plan folder, or unreadable project config
 */
function handlePlansCheckCommand(options: ParsedCLI): void {
  const { exitCode, report } = runPlansCheckReport(options);
  // An error line makes the process fail so scripts can gate on the report.
  if (exitCode === 1) process.exitCode = 1;
  writeOutput({ ...options, output: null }, report);
}

/**
 * Add forecast history and model advice from the project's other plans when a milestone opts in with `Forecast method: contextual-v1`.
 * Problems in other plans stay advice and never add `error:` lines or change this plan's totals.
 *
 * @param records - milestones in the selected plan; if none opts in, no history lines are printed
 * @param selectedPath - plan folder the author passed, used to find the owning project and its other plans
 * @returns history and model advice lines; always empty when no milestone opts in
 */
function renderProjectHistory(
  records: PlanExportRecord[],
  selectedPath: string,
): string[] {
  // A plan with no `contextual-v1` milestone gets no history lines and no search of other plans.
  if (
    !records.some(
      (record) => record.forecastContext?.method === "contextual-v1",
    )
  )
    return [];
  const history = discoverPlanForecastHistory(
    canonicalPlanProjectRoot(selectedPath),
    selectedPath,
  );
  return [
    ...renderForecastHistorySummary(records, history),
    ...renderForecastModelSummary(records, history),
  ];
}

/**
 * Report whether a resolved path is a root folder or sits inside it, comparing whole path parts so `plans-old` never counts as inside `plans`.
 *
 * @param root - real path of the containing folder
 * @param selectedPath - real path being tested
 * @returns true when the path is the root or below it; false for a parent, a sibling or another drive
 */
function isWithinPlanRoot(root: string, selectedPath: string): boolean {
  const relativePath = relative(root, selectedPath);
  return (
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}

/**
 * Find the project that owns the selected plan folder, so its `.goat-flow/config.yaml` and other plans can inform this check.
 *
 * The folder must really sit under that project's `.goat-flow/plans/` once symlinks resolve; anything else returns null and defaults apply.
 * A path that cannot be resolved also returns null, and the plan loader then reports it as unreadable.
 *
 * @param planPath - selected plan directory; absence or an unresolved path cannot grant project-config authority
 * @returns owning project root, or null when no trusted owner can be established
 */
function canonicalPlanProjectRoot(planPath: string): string | null {
  const absolutePath = resolve(planPath);
  const marker = `${sep}.goat-flow${sep}plans${sep}`;
  const markerIndex = `${absolutePath}${sep}`.lastIndexOf(marker);
  // A plan outside the canonical local workspace uses defaults instead of borrowing this checkout's config.
  if (markerIndex < 0) return null;
  const projectRoot = resolve(`${absolutePath.slice(0, markerIndex)}${sep}`);
  try {
    const realProject = realpathSync(projectRoot);
    const realPlans = realpathSync(join(projectRoot, ".goat-flow", "plans"));
    const realSelected = realpathSync(absolutePath);
    // A symlink that leads the plans folder or the plan outside the project means no owner is trusted, so defaults apply.
    return isWithinPlanRoot(realProject, realPlans) &&
      isWithinPlanRoot(realPlans, realSelected)
      ? projectRoot
      : null;
  } catch {
    // Example: a typo in the plan folder name makes realpath fail, so defaults apply and the plan loader then reports the bad path.
    return null;
  }
}

/**
 * Choose this run's active-milestone cap and forecast band: the author's flags first, then the owning project's config, then built-in defaults.
 * Example: `plans check --max-active 2` overrides the cap in the project config for that run only.
 *
 * @param options - the author's flags; a null `plansMaxActive` or `plansBandQuantiles` means that flag was not passed
 * @returns the cap used by `active:`, `ready:` and strict structure checks, and the band used by calibration advice
 * @throws CLIError with exit 2 and the config path when canonical config cannot be read or validated
 */
function resolvePlanPolicy(options: ParsedCLI): {
  maxActiveMilestones: number;
  forecastBandQuantiles: ForecastBandQuantiles;
} {
  const defaults = {
    maxActiveMilestones: options.plansMaxActive ?? 1,
    forecastBandQuantiles:
      options.plansBandQuantiles ?? DEFAULT_FORECAST_BAND_QUANTILES,
  };
  // Fully explicit policy can run even when the project's config cannot be trusted.
  if (options.plansMaxActive !== null && options.plansBandQuantiles !== null)
    return defaults;
  const projectRoot = canonicalPlanProjectRoot(options.projectPath);
  // Without a trusted owning project, the user's explicit flags and built-in defaults remain authoritative.
  if (projectRoot === null) return defaults;
  const policy = readPlanPolicy(projectRoot);
  return {
    maxActiveMilestones: options.plansMaxActive ?? policy.maxActiveMilestones,
    forecastBandQuantiles:
      options.plansBandQuantiles ?? policy.forecastBandQuantiles,
  };
}

/**
 * Read the `plans` settings from the owning project's `.goat-flow/config.yaml`; config warnings never appear in the check report.
 * Invalid config stops the run and names the file, so the author fixes it before the check relies on its cap or band.
 *
 * @param projectRoot - owning project found from the selected plan folder
 * @returns the `plans` policy from that project's config
 * @throws CLIError with exit code 2 if reading or validating the owning config fails
 */
function readPlanPolicy(projectRoot: string) {
  const configPath = join(projectRoot, ".goat-flow", "config.yaml");
  let loadedConfig: ReturnType<typeof loadConfig>;
  try {
    loadedConfig = loadConfig(projectRoot);
  } catch (error) {
    // If the selected project's config became unreadable, report its path so the user can repair access and retry.
    throw new CLIError(
      `${configPath}: ${error instanceof Error ? error.message : String(error)}`,
      2,
    );
  }
  // Invalid project policy must be repaired before this plan check can rely on its limits or forecast settings.
  if (!loadedConfig.valid) {
    throw new CLIError(
      `${configPath}: ${loadedConfig.errors.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`,
      2,
    );
  }
  return loadedConfig.config.plans;
}

/**
 * Route the author's plan request to export, effort validation or receipt timing.
 * The single `plans` dispatch entry - every `goat-flow plans ...` invocation lands here first.
 *
 * @param options - parsed CLI options carrying the chosen subcommand
 * @returns nothing; the chosen subcommand owns all output and exit codes
 */
export function handlePlansCommand(options: ParsedCLI): void {
  // A timing request owns its receipt lifecycle and never enters read-only plan validation.
  if (options.plansSubcommand === "time") {
    handlePlansTimeCommand(options);
    return;
  }
  // The user asked for the effort report rather than an export bundle.
  if (options.plansSubcommand === "check") {
    handlePlansCheckCommand(options);
    return;
  }
  // A request without check or time selects the portable plan export.
  handlePlansExportCommand(options);
}
