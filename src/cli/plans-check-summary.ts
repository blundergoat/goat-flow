/**
 * Builds the summary a user reads at the end of `plans check`.
 *
 * Where the checkers answer "is anything wrong", this answers "how is the plan going": one line per milestone, the effort split totalled across the
 * plan, and - once there is enough history - how the author's estimates have been comparing to reality.
 *
 * Calibration is deliberately quiet until a plan has enough finished milestones to say anything honest.
 * Reporting a ratio from one or two samples would tell an author their estimating is off when all it really shows is noise, so the summary stays
 * silent instead.
 */
import {
  countAgentWorkUnits,
  deriveForecastRangeFromBasis,
  isNumericActual,
  type PlanEffortForecastBasis,
  type PlanEffortSplit,
} from "./plans-effort.js";
import type { PlanExportRecord } from "./plans-export.js";

/** Plan-level effort-mix target percentages from goat-plan's estimation guidance. */
const MIX_TARGET: PlanEffortSplit = { product: 70, proof: 20, other: 10 };

// Advisory threshold: 15 percentage points of drift keeps one small proof-heavy
// milestone from flagging a healthy plan while still catching sustained imbalance;
// retune this limit once real Actual data accumulates.
const MIX_TOLERANCE_POINTS = 15;

/** Effort categories reported in plan summaries. */
const CATEGORIES = ["product", "proof", "other"] as const;

/** Terminal statuses whose estimates stay visible on their own rows but leave the plan total the author steers by. */
const EXCLUDED_FROM_TOTAL_STATUSES = new Set(["superseded", "deferred"]);

/**
 * Decide whether a milestone's estimate belongs in the plan total.
 *
 * @param record - parsed milestone; a missing status counts as live work
 * @returns true when the milestone is superseded or deferred and therefore excluded
 */
function isExcludedFromTotal(record: PlanExportRecord): boolean {
  return EXCLUDED_FROM_TOTAL_STATUSES.has(record.status.trim().toLowerCase());
}

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
 * @param record - parsed milestone; one without effort fields produces no line
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
  // A terminal row says why its minutes are missing from the plan total instead of silently dropping out.
  const exclusionText = isExcludedFromTotal(record)
    ? ` | ${record.status.trim().toLowerCase()} - excluded from the plan total`
    : "";
  return `${record.sourceFile}: ~${record.effort.totalMinutes} min${splitText}${actualText}${exclusionText}`;
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
    // Superseded and deferred work is reported on its own line so the total describes what the plan still owes.
    if (isExcludedFromTotal(record)) continue;
    for (const category of CATEGORIES) {
      totals[category] += record.effort.split[category];
    }
  }
  return totals;
}

/**
 * Render the plan summary plus the drift advisory when the mix leaves tolerance.
 * The advisory never fails the check: the 70/20/10 target is a prior to reason against, and a spike-heavy plan may be right to drift with a stated
 * reason.
 *
 * @param records - parsed milestones
 * @returns summary lines; empty means no milestone declared a split to summarise
 */
export function renderPlanSummary(records: PlanExportRecord[]): string[] {
  const totals = sumPlanSplits(records);
  const totalMinutes = totals.product + totals.proof + totals.other;
  const excludedLines = renderExcludedSummary(records);

  // Without any live splits there is no mix to summarise; excluded rows may still explain where the estimate went.
  if (totalMinutes === 0) return excludedLines;

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
  lines.push(...excludedLines);
  return lines;
}

/**
 * Render the estimates that left the plan total because their milestones are superseded or deferred.
 * The author sees exactly which files carry those minutes, so the total never looks like it silently shrank.
 *
 * @param records - parsed milestones
 * @returns one line naming every excluded milestone with its status and minutes; empty means nothing is excluded
 */
function renderExcludedSummary(records: PlanExportRecord[]): string[] {
  const excludedRecords = records.filter(
    (record) =>
      record.effort?.split !== undefined && isExcludedFromTotal(record),
  );
  // No excluded rows means the plan total already describes every estimate.
  if (excludedRecords.length === 0) return [];
  const excludedMinutes = excludedRecords.reduce(
    (sum, record) => sum + (record.effort?.totalMinutes ?? 0),
    0,
  );
  const excludedRows = excludedRecords
    .map(
      (record) =>
        `${record.sourceFile} ${record.status.trim().toLowerCase()} ${record.effort?.totalMinutes ?? 0}`,
    )
    .join(", ");
  return [
    `excluded: ${excludedMinutes} min in ${excludedRecords.length} superseded or deferred milestone${excludedRecords.length === 1 ? "" : "s"} - ${excludedRows}`,
  ];
}
const MINIMUM_CALIBRATION_SAMPLES = 3;

/** One milestone's measured-versus-estimated outcome, expressed as a raw-seconds ratio. */
interface CalibrationSample {
  sourceFile: string;
  ratio: number;
  measuredSeconds: number;
  estimatedMinutes: number;
}

/** One receipt-backed outcome normalized by the plan's countable agent work units. */
interface WorkUnitCalibrationSample {
  sourceFile: string;
  measuredSeconds: number;
  agentWorkUnits: number;
  minutesPerUnit: number;
}

/**
 * Turn one milestone into a calibration sample, or nothing when it is ineligible.
 *
 * Eligibility is deliberately narrow.
 *
 * `complete` is the existing human ratification signal, so `human-verification-pending` never qualifies however good its receipt is; `measured` is
 * the only Actual state backed by system-stamped spans, so retrospective guesses, unavailable, and incomplete states stay out rather than dragging a
 * median toward invented numbers.
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

  // `plans time` permits a same-second receipt. Its 0.00 min/unit rate would be prescribed as a
  // reforecast that `readSafePositiveRate` then rejects, blocking the milestone indefinitely.
  if (summary.totalSeconds <= 0) return undefined;
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

/**
 * Normalize one eligible receipt by its verified forecast-basis unit count.
 *
 * @param record - completed milestone; absent or stale basis means no unit evidence
 * @returns one minutes-per-unit sample; undefined keeps unreviewable data out
 */
function readWorkUnitCalibrationSample(
  record: PlanExportRecord,
): WorkUnitCalibrationSample | undefined {
  const calibrationSample = readCalibrationSample(record);
  const forecastBasis = record.effort?.forecastBasis;

  // Both a receipt-backed Actual and a parsed basis are required to compare like with like.
  if (!calibrationSample || !forecastBasis) return undefined;

  const countedAgentWorkUnits = countAgentWorkUnits([
    ...record.tasks,
    ...record.testingGateItems,
    ...record.midProofItems,
    record.planAdminEstimate ?? {},
  ]);

  // A stale declared count cannot become evidence for the next user's forecast.
  if (countedAgentWorkUnits !== forecastBasis.agentWorkUnits) return undefined;

  return {
    sourceFile: record.sourceFile,
    measuredSeconds: calibrationSample.measuredSeconds,
    agentWorkUnits: countedAgentWorkUnits,
    minutesPerUnit:
      calibrationSample.measuredSeconds / 60 / countedAgentWorkUnits,
  };
}

/** Select completed milestones whose receipts have a matching countable basis. */
function collectWorkUnitCalibrationSamples(
  records: PlanExportRecord[],
): WorkUnitCalibrationSample[] {
  // Only receipt-backed milestones with a matching basis can guide the next user's forecast.
  return records
    .map(readWorkUnitCalibrationSample)
    .filter(
      (sample): sample is WorkUnitCalibrationSample => sample !== undefined,
    );
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

/** Format a per-unit rate at the precision authors copy into `Forecast basis:`. */
function renderMinutesPerUnit(minutesPerUnit: number): string {
  return minutesPerUnit.toFixed(2);
}

/** Local low, median, and high rates derived from completed receipt evidence. */
interface LocalWorkUnitRates {
  lowMinutesPerUnit: number;
  likelyMinutesPerUnit: number;
  highMinutesPerUnit: number;
}

/** Convert sorted receipt samples into the local rates used for the next forecast; the sort is what makes the low, middle, and high values stable. */
function readLocalWorkUnitRates(
  workUnitSamples: WorkUnitCalibrationSample[],
): LocalWorkUnitRates {
  // Sorting measured rates exposes the observed low/high and the robust middle outcome.
  const sortedRates = workUnitSamples
    .map((workUnitSample) => workUnitSample.minutesPerUnit)
    .sort((leftRate, rightRate) => leftRate - rightRate);
  // This path needs three samples, so the fallbacks only protect direct empty helper use.
  return {
    lowMinutesPerUnit: sortedRates[0] ?? 0,
    likelyMinutesPerUnit: medianRatio(sortedRates),
    highMinutesPerUnit: sortedRates.at(-1) ?? 0,
  };
}

/** Compare copied two-decimal local rates with an unfinished milestone's basis. */
function basisMatchesLocalRates(
  forecastBasis: PlanEffortForecastBasis,
  localMinutesPerUnitRates: LocalWorkUnitRates,
): boolean {
  return (
    renderMinutesPerUnit(forecastBasis.lowMinutesPerUnit) ===
      renderMinutesPerUnit(localMinutesPerUnitRates.lowMinutesPerUnit) &&
    renderMinutesPerUnit(forecastBasis.likelyMinutesPerUnit) ===
      renderMinutesPerUnit(localMinutesPerUnitRates.likelyMinutesPerUnit) &&
    renderMinutesPerUnit(forecastBasis.highMinutesPerUnit) ===
      renderMinutesPerUnit(localMinutesPerUnitRates.highMinutesPerUnit)
  );
}

/** Lifecycle states where a fresh forecast can still guide remaining agent work. */
const REFORECASTABLE_STATUSES = new Set([
  "not-started",
  "in-progress",
  "testing-gate",
]);

/**
 * Tell authors exactly which unfinished milestones still use a stale basis.
 *
 * @param records - plan milestones; completed and human-wait states are skipped
 * @param localMinutesPerUnitRates - receipt-derived rates; never empty after three samples
 * @returns one actionable line per stale milestone; empty means no reforecast is needed
 */
function renderRequiredReforecasts(
  records: PlanExportRecord[],
  localMinutesPerUnitRates: LocalWorkUnitRates,
): string[] {
  // Review each milestone separately so the CLI names exactly where the user must edit.
  return records.flatMap((milestoneRecord) => {
    const forecastBasis = milestoneRecord.effort?.forecastBasis;
    const milestoneStatus = milestoneRecord.status.trim().toLowerCase();

    // Finished, blocked, abandoned, and basis-free plans have no actionable unit forecast here.
    if (!forecastBasis || !REFORECASTABLE_STATUSES.has(milestoneStatus)) {
      return [];
    }

    // Missing plan/admin time contributes no unit, matching the milestone's visible checklist.
    const countedAgentWorkUnits = countAgentWorkUnits([
      ...milestoneRecord.tasks,
      ...milestoneRecord.testingGateItems,
      ...milestoneRecord.midProofItems,
      milestoneRecord.planAdminEstimate ?? {},
    ]);

    // Count drift already has a strict error, so do not layer a misleading duration on top.
    if (countedAgentWorkUnits !== forecastBasis.agentWorkUnits) return [];

    // Matching two-decimal rates mean the author already applied the available evidence.
    if (basisMatchesLocalRates(forecastBasis, localMinutesPerUnitRates)) {
      return [];
    }

    const locallyCalibratedBasis: PlanEffortForecastBasis = {
      ...forecastBasis,
      lowMinutesPerUnit: Number(
        renderMinutesPerUnit(localMinutesPerUnitRates.lowMinutesPerUnit),
      ),
      likelyMinutesPerUnit: Number(
        renderMinutesPerUnit(localMinutesPerUnitRates.likelyMinutesPerUnit),
      ),
      highMinutesPerUnit: Number(
        renderMinutesPerUnit(localMinutesPerUnitRates.highMinutesPerUnit),
      ),
    };
    const locallyCalibratedRange = deriveForecastRangeFromBasis(
      locallyCalibratedBasis,
    );
    return [
      `reforecast required: ${milestoneRecord.sourceFile} - ${countedAgentWorkUnits} agent work units imply ${locallyCalibratedRange.lowMinutes}-${locallyCalibratedRange.highMinutes} agent-time minutes; likely ${locallyCalibratedRange.likelyMinutes} from local evidence; use ${renderMinutesPerUnit(localMinutesPerUnitRates.lowMinutesPerUnit)}-${renderMinutesPerUnit(localMinutesPerUnitRates.likelyMinutesPerUnit)}-${renderMinutesPerUnit(localMinutesPerUnitRates.highMinutesPerUnit)} min/unit before implementation`,
    ];
  });
}

/**
 * Render the countable calibration and any next-milestone reforecast action.
 *
 * @param records - every milestone in the plan directory; empty yields uncalibrated
 * @returns unit evidence and advisories; these lines never mutate files or fail the check
 */
function renderWorkUnitCalibrationSummary(
  records: PlanExportRecord[],
): string[] {
  const workUnitSamples = collectWorkUnitCalibrationSamples(records);

  // Fewer than three receipts cannot replace the conservative cold-start prior.
  if (workUnitSamples.length < MINIMUM_CALIBRATION_SAMPLES) {
    return [
      `work-unit calibration: uncalibrated - ${workUnitSamples.length} of ${MINIMUM_CALIBRATION_SAMPLES} eligible measured samples with countable bases`,
    ];
  }

  const localMinutesPerUnitRates = readLocalWorkUnitRates(workUnitSamples);
  return [
    `work-unit calibration: ${workUnitSamples.length} eligible measured samples - median ${renderMinutesPerUnit(localMinutesPerUnitRates.likelyMinutesPerUnit)} min/unit, observed ${renderMinutesPerUnit(localMinutesPerUnitRates.lowMinutesPerUnit)}-${renderMinutesPerUnit(localMinutesPerUnitRates.highMinutesPerUnit)} min/unit`,
    // Each sample line lets the author verify the summary from raw seconds and unit count.
    ...workUnitSamples.map(
      (workUnitSample) =>
        `work-unit sample: ${workUnitSample.sourceFile} ${renderMinutesPerUnit(workUnitSample.minutesPerUnit)} min/unit (${workUnitSample.measuredSeconds}s / ${workUnitSample.agentWorkUnits} units)`,
    ),
    ...renderRequiredReforecasts(records, localMinutesPerUnitRates),
  ];
}

/**
 * Render the informational calibration block.
 *
 * Contract: this block is advisory-only.
 * It must never contribute errors and must never change a forecast: it reports how past measured milestones landed against their estimates and leaves
 * the judgement to the author.
 *
 * Below three eligible samples it says `uncalibrated` rather than offering a multiplier one or two data points cannot support.
 *
 * @param records - every parsed milestone in the plan directory
 * @returns report lines; always at least the count line once the plan has milestones
 */
export function renderCalibrationSummary(
  records: PlanExportRecord[],
): string[] {
  const estimateComparisonSamples = collectCalibrationSamples(records);
  let estimateComparisonLines: string[];

  // Thin history stays explicitly uncalibrated instead of manufacturing a correction factor.
  if (estimateComparisonSamples.length < MINIMUM_CALIBRATION_SAMPLES) {
    estimateComparisonLines = [
      `calibration: uncalibrated - ${estimateComparisonSamples.length} of ${MINIMUM_CALIBRATION_SAMPLES} eligible measured samples`,
    ];
  } else {
    // With enough history, sort outcomes so users see the median and full observed spread.
    const sortedRatios = estimateComparisonSamples
      .map((estimateComparison) => estimateComparison.ratio)
      .sort((leftRatio, rightRatio) => leftRatio - rightRatio);
    // Three or more samples guarantee both ends; fallbacks keep the formatter total.
    const lowestRatio = sortedRatios[0] ?? 0;
    const highestRatio = sortedRatios.at(-1) ?? 0;
    estimateComparisonLines = [
      `calibration: ${estimateComparisonSamples.length} eligible measured samples - median ${renderRatio(medianRatio(sortedRatios))}, observed ${renderRatio(lowestRatio)}-${renderRatio(highestRatio)}`,
      // Per-milestone lines let the author verify the median against each receipt.
      ...estimateComparisonSamples.map(
        (estimateComparison) =>
          `calibration sample: ${estimateComparison.sourceFile} ${renderRatio(estimateComparison.ratio)} (${estimateComparison.measuredSeconds}s measured / ${estimateComparison.estimatedMinutes} min estimated)`,
      ),
    ];
  }
  return [
    ...estimateComparisonLines,
    ...renderWorkUnitCalibrationSummary(records),
  ];
}
