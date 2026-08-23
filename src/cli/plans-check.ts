/**
 * Local contract checker behind `plans check`.
 * Default mode preserves legacy effort arithmetic; strict mode additionally validates current-plan structure, local dependencies, and lifecycle
 * snapshots.
 *
 * Plan-level 70/20/10 mix drift stays advisory.
 *
 * User-invoked only - never part of audit or quality gates.
 */
import { CLIError } from "./cli-error.js";
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
  renderMilestoneLine,
  renderPlanSummary,
} from "./plans-check-summary.js";
import {
  collectPlanStructureAdvisories,
  collectPlanStructureErrors,
} from "./plans-check-structure.js";

/** Category iteration order for split arithmetic and rendering. */
const CATEGORIES = ["product", "proof", "other"] as const;

/** Canonical lifecycle vocabulary accepted by strict current-plan validation. */
const VALID_STATUSES = new Set([
  "not-started",
  "in-progress",
  "testing-gate",
  "human-verification-pending",
  "blocked",
  "abandoned",
  "complete",
]);

/** Missing canonical fields that strict mode can determine without semantic guesses. */
const STRICT_STRUCTURAL_WARNINGS = new Set([
  "missing status",
  "missing scope",
  "missing tasks",
  "missing proof",
  "missing exit criteria",
  "missing stop/rescope",
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
 * Decide which warnings are fatal after strict mode is selected.
 * The public checker routes here to keep complexity bounded; other callers should use {@link isValidationWarning}.
 * Receipt shape stays advisory unless a measured Actual or live clock depends on it.
 *
 * @param warning - one parser warning from the milestone record
 * @param isReceiptClaimed - whether an Actual derives its authority from the receipt
 * @param isReceiptActive - whether the receipt currently controls an executing clock
 * @returns true when the warning should become a check error under strict mode
 */
function isStrictValidationWarning(
  warning: string,
  isReceiptClaimed: boolean,
  isReceiptActive: boolean,
): boolean {
  // A summary claims a final total even when no Actual cites it and no clock is open.
  if (warning === "timing receipt summary requires finalized state")
    return true;
  return (
    warning.includes("actual effort not parseable") ||
    ((isReceiptClaimed || isReceiptActive) &&
      warning.startsWith("timing receipt")) ||
    /^multiple .+ values supplied$/u.test(warning) ||
    STRICT_STRUCTURAL_WARNINGS.has(warning) ||
    /^conflicting .+ representations$/u.test(warning)
  );
}

/**
 * Decide which parser warnings are fatal under the selected compatibility mode.
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
  // Default mode leaves newer structural rules advisory for archived plans.
  if (!isStrict) return false;
  return isStrictValidationWarning(warning, isReceiptClaimed, isReceiptActive);
}

/**
 * Convert fatal parser warnings into source-labelled check errors.
 * Receipt shape is fatal only when a measured Actual or live clock makes the user depend on it; retrospective historical receipts stay advisory.
 * Measured Actuals also undergo receipt reconciliation so both the grammar and recorded allocation are visible.
 *
 * @param record - one parsed milestone
 * @param isStrict - whether strict current-plan validation is selected
 * @returns error lines naming the milestone; empty means no warning was fatal
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

/** Read one category total without spreading optional-record checks through arithmetic. */
function categoryMinutes(
  split: PlanEffortSplit | undefined,
  category: keyof PlanEffortSplit,
): number {
  // A missing optional split contributes zero until the milestone author supplies category totals.
  if (!split) return 0;
  return split[category];
}

/** Compare declared split categories with either strict counted work or legacy task sums. */
function collectCategoryErrors(
  record: PlanExportRecord,
  split: PlanEffortSplit,
  isStrict: boolean,
): string[] {
  const errors: string[] = [];
  // Each category receives its own diagnostic so the user can repair every mismatch in one pass.
  for (const category of CATEGORIES) {
    const taskMinutes = categoryMinutes(record.taskEstimateTotals, category);
    const countedMinutes = categoryMinutes(record.workEstimateTotals, category);
    // Strict plans must account for every task, proof item, and plan-overhead estimate.
    if (isStrict) {
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

/** Check a declared headline split against its total and counted work. */
function collectSplitErrors(
  record: PlanExportRecord,
  isStrict: boolean,
): string[] {
  const errors: string[] = [];
  const effort = record.effort;
  // A milestone without an Effort line has no headline arithmetic to reconcile here.
  if (!effort) return errors;
  const split = effort.split;
  // A missing split is mandatory only for a current strict plan.
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
 * Check an optional forecast band against its own ordering and the headline.
 *
 * Validation exists only when the band does: a milestone that forecasts one point stays valid, so this returns nothing rather than demanding notation
 * legacy and in-flight plans were never written with.
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
 * Check that optional work-unit inputs match the authored plan and forecast.
 *
 * @param record - parsed milestone; a missing basis preserves legacy compatibility
 * @returns source-labelled errors; empty means the basis is absent or fully reconciled
 */
function collectForecastBasisErrors(record: PlanExportRecord): string[] {
  const forecastBasis = record.effort?.forecastBasis;
  // Plans without the opt-in field keep their existing estimate contract and receive no error.
  if (!forecastBasis) return [];
  // Missing plan/admin time contributes no unit, matching what the author sees in the milestone.
  const countedAgentWorkUnits = countAgentWorkUnits([
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

/** Require estimates on every work item that participates in the selected mode. */
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

/** Check machine-readable Actual requirements for strict, current-format plans. */
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

/** Validate the split shared by measured and retrospective numeric Actuals. */
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

/** Require measured minutes and receipt prose to match one finalized summary. */
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

/** Validate the fixed measured-reason grammar and its raw-second claim. */
function collectClaimedSecondsErrors(
  sourceFile: string,
  reason: string,
  receiptSeconds: number,
): string[] {
  const captured = reason.match(
    /^receipt\s+(\d+)\s+recorded-unpaused seconds$/u,
  )?.[1];
  // Missing seconds make the measured claim impossible for a user to trace back to the receipt.
  if (captured === undefined) {
    return [
      `${sourceFile}: measured Actual reason must name receipt <seconds> recorded-unpaused seconds`,
    ];
  }
  const claimedSeconds = Number(captured);
  // Unsafe integers cannot represent a trustworthy recorded duration.
  if (!Number.isSafeInteger(claimedSeconds)) {
    return [
      `${sourceFile}: measured Actual reason must name receipt <seconds> recorded-unpaused seconds`,
    ];
  }
  return claimedSeconds === receiptSeconds
    ? []
    : [
        `${sourceFile}: measured Actual receipt says ${claimedSeconds} seconds but Timing Receipt says ${receiptSeconds}`,
      ];
}

/** Compare numeric Actual fields with the deterministic receipt allocation. */
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

/** Count open checklist items without treating their text as approval evidence. */
function countOpenItems(
  items: PlanExportRecord["tasks"],
  predicate: (item: PlanExportRecord["tasks"][number]) => boolean = () => true,
): number {
  return items.filter((item) => !item.isChecked && predicate(item)).length;
}

/** Human ownership is explicit metadata, never inferred from prose or checkbox state. */
function isHumanOwnedItem(
  gateItem: PlanExportRecord["testingGateItems"][number],
): boolean {
  return /^\s*\[human\](?:\s|$)/iu.test(gateItem.text);
}

/** Validate the executor-owned snapshot before a human receives the milestone. */
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

/** Validate the fully closed snapshot for a completed milestone. */
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

/** Reject every completed-looking checkbox in a not-started snapshot. */
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

/** Reject a running clock from a lifecycle state that cannot execute work. */
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

/** Validate the testing gate while retaining its intentionally active timing state. */
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

/** Validate one milestone's current lifecycle snapshot without reconstructing history. */
function collectLifecycleErrors(record: PlanExportRecord): string[] {
  const status = record.status.trim().toLowerCase();
  const errors: string[] = [];

  // Missing status already has a dedicated structural diagnostic.
  if (status === "unknown" || status.length === 0) return errors;
  // An unfamiliar label cannot tell the user which lifecycle obligations apply.
  if (!VALID_STATUSES.has(status)) {
    return [`${record.sourceFile}: unsupported status \`${status}\``];
  }

  const openTasks = countOpenItems(record.tasks);
  const checkedTasks = record.tasks.length - openTasks;
  switch (status) {
    case "not-started":
      return collectNotStartedSnapshotErrors(record, checkedTasks);
    case "in-progress":
      return errors;
    case "testing-gate":
      return collectTestingGateErrors(record, openTasks);
    case "human-verification-pending":
      return [
        ...collectInactiveReceiptErrors(record, status),
        ...collectHumanPendingErrors(record, openTasks),
      ];
    case "complete":
      return [
        ...collectInactiveReceiptErrors(record, status),
        ...collectCompleteSnapshotErrors(record, openTasks),
      ];
    default:
      return collectInactiveReceiptErrors(record, status);
  }
}

/**
 * Collect deterministic structure, lifecycle, and arithmetic errors for one milestone.
 *
 * Branches gate on what the author declared because each declaration creates its own obligation: notation errors always apply, split-sum errors need
 * a declared split, task-coverage errors need declared tasks - which is why a legacy milestone falls through every check untouched.
 *
 * @param record - parsed milestone; one declaring nothing reaches no check and returns clean
 * @param isStrict - whether current-format authoring obligations are mandatory
 * @returns error lines naming the milestone; empty means its arithmetic holds up
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
 * Reject flags that have no meaning for the read-only check report.
 *
 * `--format` is deliberately ignored rather than rejected: its default value is TTY-dependent, so rejecting it would break piped invocations that
 * never passed the flag.
 *
 * @param options - parsed CLI options
 * @throws CLIError when a write-oriented flag reaches the check
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
 * Check one plan directory and report to stdout.
 * Exit code 1 signals deterministic contract or arithmetic errors; mix drift and default-mode legacy absence never fail.
 * Records are redacted before use.
 *
 * @param options - parsed plan path plus global flags
 * @returns nothing; the report goes to stdout and the exit code carries the verdict
 * @throws CLIError for usage errors or unreadable plans
 */
function handlePlansCheckCommand(options: ParsedCLI): void {
  // e.g. the user finished writing milestones and ran `goat-flow plans check .goat-flow/plans/<active>`.
  assertCheckUsage(options);

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
    errors.push(...collectPlanStructureErrors(records));
  }

  // Milestones with estimates become report rows; legacy ones contribute nothing.
  const milestoneLines = records
    .map(renderMilestoneLine)
    .filter((line): line is string => line !== null);
  const planSummary = renderPlanSummary(records);
  const reportLines = [...milestoneLines, ...planSummary];

  // Calibration only means something next to a mix summary, so it follows the same gate.
  if (planSummary.length > 0) {
    reportLines.push(...renderCalibrationSummary(records));
  }

  // No effort rows and no errors means the user selected a legacy plan, even when prose advice follows.
  if (reportLines.length === 0 && errors.length === 0) {
    reportLines.push(
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
  if (errors.length > 0) {
    reportLines.push(...errors.map((line) => `error: ${line}`));
    process.exitCode = 1;
  }
  writeOutput({ ...options, output: null }, reportLines.join("\n"));
}

/**
 * Route local plan subcommands between the export bundler and the effort check.
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
  handlePlansExportCommand(options);
}
