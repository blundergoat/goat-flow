/**
 * Effort-arithmetic checker behind `plans check` - the executable side of
 * goat-plan's estimation notation. Milestones that declare an effort line must
 * have consistent arithmetic (errors, exit 1); plan-level 70/20/10 mix drift is
 * advisory only; estimate-less legacy plans pass with one info line because
 * optional local workflow state is never scored. User-invoked only - never part
 * of `audit` or deterministic quality gates.
 */
import { CLIError } from "./cli-error.js";
import { writeOutput } from "./cli-output.js";
import type { ParsedCLI } from "./cli-types.js";
import { type PlanEffortSplit } from "./plans-effort.js";
import {
  handlePlansExportCommand,
  isPlansExportInputError,
  loadPlanExportRecords,
  redactPlanExportRecord,
  type PlanExportRecord,
} from "./plans-export.js";

/** Plan-level effort-mix target percentages from goat-plan's estimation guidance. */
const MIX_TARGET: PlanEffortSplit = { product: 70, proof: 20, other: 10 };

// Advisory threshold: 15 percentage points of drift keeps one small proof-heavy
// milestone from flagging a healthy plan while still catching sustained imbalance;
// retune this limit once real Actual data accumulates.
const MIX_TOLERANCE_POINTS = 15;

/** Category iteration order for split arithmetic and rendering. */
const CATEGORIES = ["product", "proof", "other"] as const;

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
 * Collect arithmetic errors for one milestone.
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
  // Drifted est notation (e.g. `(est: soon)`) is an error even before any sums run.
  const errors = record.warnings
    .filter(
      (warning) =>
        warning.includes("estimate not parseable") ||
        (strict &&
          (warning.includes("actual effort not parseable") ||
            warning.includes("multiple Actual values"))),
    )
    .map((warning) => `${record.sourceFile}: ${warning}`);
  const { effort, taskEstimateTotals, workEstimateTotals } = record;

  // Default mode preserves legacy plans; strict authoring requires the current notation.
  if (!effort) {
    if (strict) {
      errors.push(
        `${record.sourceFile}: strict mode requires an Effort estimate with a product/proof/other split`,
      );
    }
    return errors;
  }

  if (strict && !effort.split) {
    errors.push(
      `${record.sourceFile}: strict mode requires a product/proof/other split`,
    );
  }

  // A declared split must reproduce its own headline and cover its task sums.
  if (effort.split) {
    const splitSum =
      effort.split.product + effort.split.proof + effort.split.other;

    // Components that cannot rebuild the headline are the unauditable aggregate this check exists for.
    if (splitSum !== effort.totalMinutes) {
      errors.push(
        `${record.sourceFile}: split ${renderSplit(effort.split)} sums to ${splitSum} min but the headline says ${effort.totalMinutes} min`,
      );
    }

    // Default mode retains the legacy one-way protection; strict mode requires exact derivation.
    for (const category of CATEGORIES) {
      const taskMinutes = taskEstimateTotals?.[category] ?? 0;
      const countedMinutes = workEstimateTotals?.[category] ?? 0;
      if (strict && countedMinutes !== effort.split[category]) {
        errors.push(
          `${record.sourceFile}: ${category} counted work (${countedMinutes} min) does not equal the split component (${effort.split[category]} min)`,
        );
      } else if (!strict && taskMinutes > effort.split[category]) {
        errors.push(
          `${record.sourceFile}: ${category} task estimates (${taskMinutes} min) exceed the split component (${effort.split[category]} min)`,
        );
      }
    }
  }

  // Tasks left without est entries make the milestone total underivable.
  const unestimatedTasks = record.tasks.filter(
    (task) => task.estimateMinutes === undefined,
  ).length;
  if (record.tasks.length > 0 && unestimatedTasks > 0) {
    errors.push(
      `${record.sourceFile}: ${unestimatedTasks} task(s) missing an (est: ...) entry under a declared effort line`,
    );
  }

  if (strict) {
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

    const actual = effort.actual;
    if (record.status.trim().toLowerCase() === "complete" && !actual) {
      errors.push(
        `${record.sourceFile}: complete milestone requires a structured Actual with total and product/proof/other split`,
      );
    }
    if (actual && !actual.split) {
      errors.push(
        `${record.sourceFile}: structured Actual requires a product/proof/other split`,
      );
    }
    if (actual?.split) {
      const actualSplitSum =
        actual.split.product + actual.split.proof + actual.split.other;
      if (actualSplitSum !== actual.totalMinutes) {
        errors.push(
          `${record.sourceFile}: Actual split ${renderSplit(actual.split)} sums to ${actualSplitSum} min but Actual says ${actual.totalMinutes} min`,
        );
      }
    }
  }
  return errors;
}

/**
 * Build one stdout report line for a milestone that declared effort data.
 * Gives the plan author a per-milestone estimate/actual overview at a glance.
 *
 * @param record - parsed milestone
 * @returns the line, or null when the milestone has no effort fields to show
 */
function renderMilestoneLine(record: PlanExportRecord): string | null {
  // Legacy milestones stay off the report entirely rather than showing empty columns.
  if (!record.effort) return null;

  // Echo the split only when the author declared one.
  const splitText = record.effort.split
    ? ` ${renderSplit(record.effort.split)}`
    : "";
  const actual = record.effort.actual;
  const actualText = actual
    ? ` | actual: ~${actual.totalMinutes} min${actual.split ? ` ${renderSplit(actual.split)}` : ""}${actual.reason ? ` - ${actual.reason}` : ""}`
    : "";
  return `${record.sourceFile}: ~${record.effort.totalMinutes} min${splitText}${actualText}`;
}

/**
 * Sum every milestone's split into plan-level per-category totals.
 * Feeds the plan summary the author uses to judge the overall mix.
 *
 * @param records - parsed milestones
 * @returns minute totals; all zeros means no milestone declared a split yet
 */
function sumPlanSplits(records: PlanExportRecord[]): PlanEffortSplit {
  const totals: PlanEffortSplit = { product: 0, proof: 0, other: 0 };

  // Fold each estimate-carrying milestone into the plan-wide picture.
  for (const record of records) {
    // Milestones without a split (legacy or headline-only) cannot shape the mix.
    if (!record.effort?.split) continue;
    for (const category of CATEGORIES) {
      totals[category] += record.effort.split[category];
    }
  }
  return totals;
}

/**
 * Render the plan summary plus the drift advisory when the mix leaves tolerance.
 * The advisory never fails the check: the 70/20/10 target is a prior to reason
 * against, and a spike-heavy plan may be right to drift with a stated reason.
 *
 * @param records - parsed milestones
 * @returns summary lines; empty means no milestone declared a split to summarise
 */
function renderPlanSummary(records: PlanExportRecord[]): string[] {
  const totals = sumPlanSplits(records);
  const totalMinutes = totals.product + totals.proof + totals.other;

  // Without any splits there is no mix to summarise, so the summary stays out of the report.
  if (totalMinutes === 0) return [];

  // Convert minutes to the percentage mix the author compares against 70/20/10.
  const percentages = CATEGORIES.map((category) =>
    Math.round((totals[category] / totalMinutes) * 100),
  );
  const [productShare = 0, proofShare = 0, otherShare = 0] = percentages;
  const lines = [
    `plan: ${totalMinutes} min estimated - mix ${productShare}% product / ${proofShare}% proof / ${otherShare}% other (rough guide ~70/20/10)`,
  ];

  // Outside tolerance the author gets a review prompt, never forced ratio compliance.
  const hasDrifted = CATEGORIES.some(
    (category, index) =>
      Math.abs((percentages[index] ?? 0) - MIX_TARGET[category]) >
      MIX_TOLERANCE_POINTS,
  );
  if (hasDrifted) {
    lines.push(
      "advisory: plan mix drifts more than 15 percentage points from the rough ~70/20/10 guide - check for duplicated proof or missing verification; keep and explain the mix when task risk warrants it",
    );
  }
  return lines;
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
 * Check one plan directory's effort arithmetic and report to stdout.
 * Exit code 1 signals arithmetic errors; mix drift and legacy absence never
 * fail. Records are redacted before rendering, matching the export preview.
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

  // Milestones with estimates become report rows; legacy ones contribute nothing.
  const milestoneLines = records
    .map(renderMilestoneLine)
    .filter((line): line is string => line !== null);
  const reportLines = [...milestoneLines, ...renderPlanSummary(records)];

  // Nothing estimated and nothing wrong: tell the user the plan predates the notation.
  if (reportLines.length === 0 && errors.length === 0) {
    reportLines.push(
      "no effort estimates found - this plan predates the estimation notation (informational)",
    );
  }

  // Arithmetic errors end the report and flip the exit code so scripts can gate on it.
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
  // The user asked for the effort report rather than an export bundle.
  if (options.plansSubcommand === "check") {
    handlePlansCheckCommand(options);
    return;
  }
  handlePlansExportCommand(options);
}
