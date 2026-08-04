/**
 * Builds the summary a user reads at the end of `plans check`.
 * Where the checkers answer "is anything wrong", this answers "how is the plan going": one
 * line per milestone, the effort split totalled across the plan, and - once there is enough
 * history - how the author's estimates have been comparing to reality.
 *
 * Calibration is deliberately quiet until a plan has enough finished milestones to say
 * anything honest. Reporting a ratio from one or two samples would tell an author their
 * estimating is off when all it really shows is noise, so the summary stays silent instead.
 */
import { isNumericActual, type PlanEffortSplit } from "./plans-effort.js";
import type { PlanExportRecord } from "./plans-export.js";

/** Plan-level effort-mix target percentages from goat-plan's estimation guidance. */
const MIX_TARGET: PlanEffortSplit = { product: 70, proof: 20, other: 10 };

// Advisory threshold: 15 percentage points of drift keeps one small proof-heavy
// milestone from flagging a healthy plan while still catching sustained imbalance;
// retune this limit once real Actual data accumulates.
const MIX_TOLERANCE_POINTS = 15;

/** Effort categories reported in plan summaries. */
const CATEGORIES = ["product", "proof", "other"] as const;

/**
 * Render `(18 product / 5 proof / 2 other)`-style split text for report lines.
 *
 * @param split - minutes per category; zeros render literally so gaps stay visible
 * @returns the parenthesised split text
 */
function renderSplit(split: PlanEffortSplit): string {
  return `(${split.product} product / ${split.proof} proof / ${split.other} other)`;
}

/**
 * Build one stdout report line for a milestone that declared effort data.
 * Gives the plan author a per-milestone estimate/actual overview at a glance.
 *
 * @param record - parsed milestone
 * @returns the line, or null when the milestone has no effort fields to show
 */
export function renderMilestoneLine(record: PlanExportRecord): string | null {
  // Legacy milestones stay off the report entirely rather than showing empty columns.
  if (!record.effort) return null;

  // Echo the split only when the author declared one.
  const splitText = record.effort.split
    ? ` ${renderSplit(record.effort.split)}`
    : "";
  const actual = record.effort.actual;
  let actualText = "";
  if (actual && !isNumericActual(actual)) {
    actualText = ` | actual: ${actual.state} - ${actual.reason}`;
  } else if (actual && isNumericActual(actual)) {
    const actualSplitText = actual.split ? ` ${renderSplit(actual.split)}` : "";
    const actualReasonText = actual.reason ? ` - ${actual.reason}` : "";
    actualText = ` | actual: ${actual.state} ~${actual.totalMinutes} min${actualSplitText}${actualReasonText}`;
  }
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
export function renderPlanSummary(records: PlanExportRecord[]): string[] {
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

/** Below this many eligible samples a correction factor would be a guess, not calibration. */
const MINIMUM_CALIBRATION_SAMPLES = 3;

/** One milestone's measured-versus-estimated outcome, expressed as a raw-seconds ratio. */
interface CalibrationSample {
  sourceFile: string;
  ratio: number;
  measuredSeconds: number;
  estimatedMinutes: number;
}

/**
 * Turn one milestone into a calibration sample, or nothing when it is ineligible.
 *
 * Eligibility is deliberately narrow. `complete` is the existing human
 * ratification signal, so `human-verification-pending` never qualifies however
 * good its receipt is; `measured` is the only Actual state backed by
 * system-stamped spans, so retrospective guesses, unavailable, and incomplete
 * states stay out rather than dragging a median toward invented numbers.
 *
 * @param record - one parsed milestone
 * @returns the sample; undefined means this milestone cannot calibrate anything
 */
function readCalibrationSample(
  record: PlanExportRecord,
): CalibrationSample | undefined {
  const effort = record.effort;

  // Raw seconds are the authority; the rounded Actual minutes would compound rounding.
  const summary = record.timingReceipt?.summary;
  if (!effort || !summary) return undefined;
  if (record.status.trim().toLowerCase() !== "complete") return undefined;
  if (effort.actual?.state !== "measured") return undefined;

  // A zero-minute estimate has no ratio to report, so it contributes nothing.
  if (effort.totalMinutes <= 0) return undefined;
  return {
    sourceFile: record.sourceFile,
    ratio: summary.totalSeconds / (effort.totalMinutes * 60),
    measuredSeconds: summary.totalSeconds,
    estimatedMinutes: effort.totalMinutes,
  };
}

/**
 * Select the milestones whose Actual may legitimately calibrate a forecast.
 *
 * @param records - every parsed milestone in the plan directory
 * @returns one sample per eligible milestone, in source order
 */
function collectCalibrationSamples(
  records: PlanExportRecord[],
): CalibrationSample[] {
  return records
    .map(readCalibrationSample)
    .filter((sample): sample is CalibrationSample => sample !== undefined);
}

/** Middle value of a sorted ratio list, averaging the pair when the count is even. */
function medianRatio(sortedRatios: number[]): number {
  const middle = Math.floor(sortedRatios.length / 2);
  if (sortedRatios.length % 2 === 1) return sortedRatios[middle] ?? 0;
  return ((sortedRatios[middle - 1] ?? 0) + (sortedRatios[middle] ?? 0)) / 2;
}

/** Format a ratio the way the report shows it, so comparisons stay eyeball-able. */
function renderRatio(ratio: number): string {
  return `${ratio.toFixed(2)}x`;
}

/**
 * Render the informational calibration block.
 *
 * Contract: this block is advisory-only. It must never contribute errors and
 * must never change a forecast: it reports how
 * past measured milestones landed against their estimates and leaves the
 * judgement to the author. Below three eligible samples it says `uncalibrated`
 * rather than offering a multiplier one or two data points cannot support.
 *
 * @param records - every parsed milestone in the plan directory
 * @returns report lines; always at least the count line once the plan has milestones
 */
export function renderCalibrationSummary(
  records: PlanExportRecord[],
): string[] {
  const samples = collectCalibrationSamples(records);
  if (samples.length < MINIMUM_CALIBRATION_SAMPLES) {
    return [
      `calibration: uncalibrated - ${samples.length} of ${MINIMUM_CALIBRATION_SAMPLES} eligible measured samples`,
    ];
  }

  const sortedRatios = samples
    .map((sample) => sample.ratio)
    .sort((a, b) => a - b);
  const lowest = sortedRatios[0] ?? 0;
  const highest = sortedRatios[sortedRatios.length - 1] ?? 0;
  return [
    `calibration: ${samples.length} eligible measured samples - median ${renderRatio(medianRatio(sortedRatios))}, observed ${renderRatio(lowest)}-${renderRatio(highest)}`,
    ...samples.map(
      (sample) =>
        `calibration sample: ${sample.sourceFile} ${renderRatio(sample.ratio)} (${sample.measuredSeconds}s measured / ${sample.estimatedMinutes} min estimated)`,
    ),
  ];
}
