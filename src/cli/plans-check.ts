/**
 * Local contract checker behind `plans check`. Default mode preserves legacy
 * effort arithmetic; strict mode additionally validates current-plan structure,
 * local dependencies, and lifecycle snapshots. Plan-level 70/20/10 mix drift
 * stays advisory. User-invoked only - never part of audit or quality gates.
 */
import { CLIError } from "./cli-error.js";
import { writeOutput } from "./cli-output.js";
import type { ParsedCLI } from "./cli-types.js";
import {
  isNumericActual,
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
import { collectPlanStructureErrors } from "./plans-check-structure.js";

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
 * Use wherever the report echoes a split back in the same notation the plan
 * author wrote, so the fix is a copy-edit away.
 *
 * @param split - minutes per category; zeros render literally so gaps stay visible
 * @returns the parenthesised split text
 */
function renderSplit(split: PlanEffortSplit): string {
  return `(${split.product} product / ${split.proof} proof / ${split.other} other)`;
}

/**
 * Decide which warnings are fatal once strict mode is already established.
 *
 * Split out of {@link isValidationWarning} so each function stays inside the
 * project complexity budget; callers should reach the strict rules through
 * that entry point rather than calling this directly. Receipt-shape warnings
 * stay advisory unless a claim or a live clock depends on the receipt, so a
 * hand-written historical receipt beside a retrospective Actual passes here.
 *
 * @param warning - one parser warning from the milestone record
 * @param receiptIsClaimed - whether an Actual derives its authority from the receipt
 * @param receiptIsActive - whether the receipt currently controls an executing clock
 * @returns true when the warning should become a check error under strict mode
 */
function isStrictValidationWarning(
  warning: string,
  receiptIsClaimed: boolean,
  receiptIsActive: boolean,
): boolean {
  // A summary claims a final total even when no Actual cites it and no clock is open.
  if (warning === "timing receipt summary requires finalized state")
    return true;
  return (
    warning.includes("actual effort not parseable") ||
    ((receiptIsClaimed || receiptIsActive) &&
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
 * @param strict - whether strict current-plan validation is selected
 * @param receiptIsClaimed - whether an Actual derives its authority from the receipt
 * @param receiptIsActive - whether the receipt currently controls an executing clock
 * @returns true when the warning should become a check error
 */
function isValidationWarning(
  warning: string,
  strict: boolean,
  receiptIsClaimed: boolean,
  receiptIsActive: boolean,
): boolean {
  if (warning.includes("estimate not parseable")) return true;

  // Drifted range notation is as fatal as a drifted estimate: both hide real numbers.
  if (warning === "forecast range not parseable") return true;
  if (!strict) return false;
  return isStrictValidationWarning(warning, receiptIsClaimed, receiptIsActive);
}

/**
 * Convert fatal parser warnings into source-labelled check errors.
 *
 * A receipt is evidence for a claim or a live clock, so its shape is fatal when
 * an Actual claims authority from it or its state is active. Hand-written
 * historical receipts beside retrospective Actuals remain advisory because
 * neither a measurement claim nor executing workflow depends on them.
 * `measured` Actuals still fail twice over - here and in the reconciliation
 * check that compares their minutes against the receipt allocation.
 *
 * @param record - one parsed milestone
 * @param strict - whether strict current-plan validation is selected
 * @returns error lines naming the milestone; empty means no warning was fatal
 */
function collectWarningErrors(
  record: PlanExportRecord,
  strict: boolean,
): string[] {
  const receiptIsClaimed = record.effort?.actual?.state === "measured";
  const receiptIsActive = record.timingReceipt?.state === "active";
  return record.warnings
    .filter((warning) =>
      isValidationWarning(warning, strict, receiptIsClaimed, receiptIsActive),
    )
    .map((warning) => `${record.sourceFile}: ${warning}`);
}

/** Read one category total without spreading optional-record checks through arithmetic. */
function categoryMinutes(
  split: PlanEffortSplit | undefined,
  category: keyof PlanEffortSplit,
): number {
  if (!split) return 0;
  return split[category];
}

/** Compare declared split categories with either strict counted work or legacy task sums. */
function collectCategoryErrors(
  record: PlanExportRecord,
  split: PlanEffortSplit,
  strict: boolean,
): string[] {
  const errors: string[] = [];
  for (const category of CATEGORIES) {
    const taskMinutes = categoryMinutes(record.taskEstimateTotals, category);
    const countedMinutes = categoryMinutes(record.workEstimateTotals, category);
    if (strict) {
      if (countedMinutes !== split[category]) {
        errors.push(
          `${record.sourceFile}: ${category} counted work (${countedMinutes} min) does not equal the split component (${split[category]} min)`,
        );
      }
      continue;
    }
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
  strict: boolean,
): string[] {
  const errors: string[] = [];
  const effort = record.effort;
  if (!effort) return errors;
  const split = effort.split;
  if (!split) {
    if (strict) {
      errors.push(
        `${record.sourceFile}: strict mode requires a product/proof/other split`,
      );
    }
    return errors;
  }

  const splitSum = split.product + split.proof + split.other;
  if (splitSum !== effort.totalMinutes) {
    errors.push(
      `${record.sourceFile}: split ${renderSplit(split)} sums to ${splitSum} min but the headline says ${effort.totalMinutes} min`,
    );
  }
  errors.push(...collectCategoryErrors(record, split, strict));
  return errors;
}

/**
 * Check an optional forecast band against its own ordering and the headline.
 *
 * Validation exists only when the band does: a milestone that forecasts one
 * point stays valid, so this returns nothing rather than demanding notation
 * legacy and in-flight plans were never written with.
 */
function collectForecastRangeErrors(record: PlanExportRecord): string[] {
  const effort = record.effort;
  const range = effort?.forecastRange;
  if (!effort || !range) return [];

  const errors: string[] = [];
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

/** Require estimates on every work item that participates in the selected mode. */
function collectCoverageErrors(
  record: PlanExportRecord,
  strict: boolean,
): string[] {
  const errors: string[] = [];
  const unestimatedTasks = record.tasks.filter(
    (task) => task.estimateMinutes === undefined,
  ).length;
  if (unestimatedTasks > 0) {
    errors.push(
      `${record.sourceFile}: ${unestimatedTasks} task(s) missing an (est: ...) entry under a declared effort line`,
    );
  }
  if (!strict) return errors;

  const unestimatedTestingItems = record.testingGateItems.filter(
    (item) => item.estimateMinutes === undefined,
  ).length;
  if (unestimatedTestingItems > 0) {
    errors.push(
      `${record.sourceFile}: ${unestimatedTestingItems} testing gate item(s) missing an (est: ...) entry`,
    );
  }

  const unestimatedMidProofItems = record.midProofItems.filter(
    (item) => item.estimateMinutes === undefined,
  ).length;
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
  if (!actual) {
    if (status === "complete" || status === "human-verification-pending") {
      errors.push(
        `${record.sourceFile}: ${status} milestone requires a structured Actual with total and product/proof/other split`,
      );
    }
    return errors;
  }
  if (status === "not-started") {
    errors.push(
      `${record.sourceFile}: not-started milestone must not include Actual before work begins`,
    );
  }
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
  if (!actual.split) {
    return [
      `${record.sourceFile}: structured Actual requires a product/proof/other split`,
    ];
  }
  const errors: string[] = [];
  const actualSplitSum =
    actual.split.product + actual.split.proof + actual.split.other;
  if (actualSplitSum !== actual.totalMinutes) {
    errors.push(
      `${record.sourceFile}: Actual split ${renderSplit(actual.split)} sums to ${actualSplitSum} min but Actual says ${actual.totalMinutes} min`,
    );
  }
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
  if (captured === undefined) {
    return [
      `${sourceFile}: measured Actual reason must name receipt <seconds> recorded-unpaused seconds`,
    ];
  }
  const claimedSeconds = Number(captured);
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
  item: PlanExportRecord["testingGateItems"][number],
): boolean {
  return /^\s*\[human\](?:\s|$)/iu.test(item.text);
}

/** Validate the executor-owned snapshot before a human receives the milestone. */
function collectHumanPendingErrors(
  record: PlanExportRecord,
  openTasks: number,
): string[] {
  const errors: string[] = [];
  if (openTasks > 0) {
    errors.push(
      `${record.sourceFile}: human-verification-pending milestone has open implementation tasks`,
    );
  }
  const openExecutorProof = countOpenItems(
    record.testingGateItems,
    (item) => !isHumanOwnedItem(item),
  );
  if (openExecutorProof > 0) {
    errors.push(
      `${record.sourceFile}: executor proof item remains open at human-verification-pending`,
    );
  }
  if (countOpenItems(record.midProofItems) > 0) {
    errors.push(
      `${record.sourceFile}: executor mid-proof item remains open at human-verification-pending`,
    );
  }
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
  if (openTasks > 0) {
    errors.push(
      `${record.sourceFile}: complete milestone has open implementation tasks`,
    );
  }
  if (countOpenItems(record.testingGateItems) > 0) {
    errors.push(
      `${record.sourceFile}: complete milestone has open proof items`,
    );
  }
  if (countOpenItems(record.midProofItems) > 0) {
    errors.push(
      `${record.sourceFile}: complete milestone has open mid-proof items`,
    );
  }
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
  if (checkedTasks > 0) {
    errors.push(
      `${record.sourceFile}: not-started milestone has checked implementation tasks`,
    );
  }
  if (record.testingGateItems.some((item) => item.isChecked)) {
    errors.push(
      `${record.sourceFile}: not-started milestone has checked proof items`,
    );
  }
  if (record.midProofItems.some((item) => item.isChecked)) {
    errors.push(
      `${record.sourceFile}: not-started milestone has checked mid-proof items`,
    );
  }
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
 * Branches gate on what the author declared because each declaration creates
 * its own obligation: notation errors always apply, split-sum errors need a
 * declared split, task-coverage errors need declared tasks - which is why a
 * legacy milestone falls through every check untouched.
 *
 * @param record - parsed milestone
 * @param strict - whether current-format authoring obligations are mandatory
 * @returns error lines naming the milestone; empty means its arithmetic holds up
 */
function collectMilestoneErrors(
  record: PlanExportRecord,
  strict: boolean,
): string[] {
  const errors = collectWarningErrors(record, strict);
  if (strict) {
    errors.push(...collectLifecycleErrors(record));
  }

  // Default mode preserves legacy plans; strict authoring requires the current notation.
  if (!record.effort) {
    if (strict) {
      errors.push(
        `${record.sourceFile}: strict mode requires an Effort estimate with a product/proof/other split`,
      );
    }
    return errors;
  }

  errors.push(...collectSplitErrors(record, strict));
  errors.push(...collectCoverageErrors(record, strict));
  errors.push(...collectForecastRangeErrors(record));
  if (strict) {
    errors.push(...collectActualErrors(record));
  }
  return errors;
}

/**
 * Reject flags that have no meaning for the read-only check report.
 * `--format` is deliberately ignored rather than rejected: its default value is
 * TTY-dependent, so rejecting it would break piped invocations that never
 * passed the flag.
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
 * Exit code 1 signals deterministic contract or arithmetic errors; mix drift
 * and default-mode legacy absence never fail. Records are redacted before use.
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

  // Nothing estimated and nothing wrong: tell the user the plan predates the notation.
  if (reportLines.length === 0 && errors.length === 0) {
    reportLines.push(
      "no effort estimates found - this plan predates the estimation notation (informational)",
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
 * The single `plans` dispatch entry - every `goat-flow plans ...` invocation
 * lands here first.
 *
 * @param options - parsed CLI options carrying the chosen subcommand
 * @returns nothing; the chosen subcommand owns all output and exit codes
 */
export function handlePlansCommand(options: ParsedCLI): void {
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
