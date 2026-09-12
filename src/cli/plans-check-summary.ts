/**
 * Builds the summary a user reads at the end of `plans check`.
 *
 * Where the checkers answer "is anything wrong", this answers "how is the plan going": one line per milestone, the effort split totalled across the
 * plan, and - once there is enough history - how the author's estimates have been comparing to reality.
 *
 * Estimate-to-Actual calibration and work-unit rates need at least three eligible finished milestones.
 * Coverage and plan-total diagnostics describe even smaller cohorts and always display their sample counts; they do not establish estimator bias.
 */
import {
  countAgentWorkUnits,
  deriveForecastRangeFromBasis,
  isNumericActual,
  type PlanEffortForecastBasis,
  type PlanEffortSplit,
} from "./plans-effort.js";
import type { PlanExportRecord } from "./plans-export.js";
import { readActiveMilestones } from "./plans-check-structure.js";
import { DEFAULT_FORECAST_BAND_QUANTILES } from "./config/config-vocabulary.js";
import type { ForecastBandQuantiles } from "./config/types.js";

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
 * Report the active lanes only when parallel policy is enabled.
 * @param records - all parsed milestones; inactive milestones contribute no active row
 * @param maxActive - resolved positive safe integer cap; one suppresses this entire block
 * @returns active rows and the cap total; invalid declarations display a fixed marker
 */
export function renderActivePlanSummary(
  records: PlanExportRecord[],
  maxActive: number,
): string[] {
  if (maxActive === 1) return [];
  const active = readActiveMilestones(records);
  return [
    ...active.map(
      (milestone) =>
        `active: ${milestone.id} (${milestone.status}) | lane: ${milestone.lane ?? "<invalid>"}`,
    ),
    `plan: ${active.length} active milestones (cap ${maxActive})`,
  ];
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

/** An exclusion retains the reason that the author sees beside the affected pool. */
type CalibrationDisposition<T> =
  { sample: T; reason?: never } | { sample?: never; reason: string };

/**
 * Both pools require human-ratified `complete` status and receipt-backed `measured` Actual; pending, retrospective, unavailable and incomplete stay out.
 * Raw positive seconds retain short measurements even when their displayed Actual rounds to zero.
 *
 * @param record - candidate milestone; missing effort or receipt summary excludes it from both pools
 * @returns the sample or one factual exclusion reason shared by both pools
 */
function readCalibrationDisposition(
  record: PlanExportRecord,
): CalibrationDisposition<CalibrationSample> {
  const effort = record.effort;

  // Raw seconds are the authority; the rounded Actual minutes would compound rounding.
  const summary = record.timingReceipt?.summary;
  if (record.status.trim().toLowerCase() !== "complete") {
    return { reason: "status is not complete" };
  }
  if (!effort) return { reason: "missing effort estimate" };
  if (effort.actual?.state !== "measured") {
    return { reason: "Actual is not measured" };
  }
  if (!summary) return { reason: "missing receipt summary" };

  // A zero-minute estimate has no ratio to report, so it contributes nothing.
  if (effort.totalMinutes <= 0) return { reason: "estimate is not positive" };

  // `plans time` permits a same-second receipt. Its 0.00 min/unit rate would be prescribed as a
  // reforecast that `readSafePositiveRate` then rejects, blocking the milestone indefinitely.
  if (summary.totalSeconds <= 0) {
    return { reason: "raw receipt seconds are not positive" };
  }
  return {
    sample: {
      sourceFile: record.sourceFile,
      ratio: summary.totalSeconds / (effort.totalMinutes * 60),
      measuredSeconds: summary.totalSeconds,
      estimatedMinutes: effort.totalMinutes,
    },
  };
}

/** Numerical consumers use the same admission decision as the explanatory output. */
function readCalibrationSample(
  record: PlanExportRecord,
): CalibrationSample | undefined {
  return readCalibrationDisposition(record).sample;
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

/** One eligible receipt compared with the forecast range its author recorded. */
interface BandCoverageSample {
  measuredMinutes: number;
  lowMinutes: number;
  highMinutes: number;
  widthRatio: number;
}

/** Reuse calibration eligibility, adding only the stored range needed for coverage. */
function readBandCoverageSample(
  record: PlanExportRecord,
): BandCoverageSample | undefined {
  const sample = readCalibrationSample(record);
  const range = record.effort?.forecastRange;
  if (!sample || !range) return undefined;
  return {
    measuredMinutes: sample.measuredSeconds / 60,
    lowMinutes: range.lowMinutes,
    highMinutes: range.highMinutes,
    widthRatio: range.highMinutes / range.lowMinutes,
  };
}

/**
 * Count below/above using raw receipt minutes, keeping both endpoints inside.
 * Empty cohorts have no percentage or width; these descriptive lines never promise future coverage.
 *
 * @param records - parsed milestones whose stored ranges remain unchanged
 * @returns one advisory line with the scoreable count, observed coverage and median high/low width
 */
function renderBandCoverageSummary(records: PlanExportRecord[]): string {
  const samples = records
    .map(readBandCoverageSample)
    .filter((sample): sample is BandCoverageSample => sample !== undefined);
  const below = samples.filter((s) => s.measuredMinutes < s.lowMinutes).length;
  const above = samples.filter((s) => s.measuredMinutes > s.highMinutes).length;
  const inside = samples.length - below - above;
  const percentage =
    samples.length === 0
      ? "n/a"
      : `${((inside / samples.length) * 100).toFixed(1)}%`;
  const medianWidth = medianRatio(
    samples.map((s) => s.widthRatio).sort((a, b) => a - b),
  );
  // Zero lower bounds are valid legacy ranges and have unbounded multiplicative width.
  const width =
    samples.length === 0
      ? "n/a"
      : Number.isFinite(medianWidth)
        ? renderRatio(medianWidth)
        : "unbounded";
  return `band coverage: ${inside} of ${samples.length} inside (${percentage}) - ${below} below, ${above} above; median width ${width}`;
}

/** Compare totals over the same receipt-eligible IDs, including range-less legacy plans. */
function renderPlanTotalSummary(samples: CalibrationSample[]): string {
  if (samples.length === 0) return "plan total: unavailable over 0 measured";
  const actualMinutes =
    samples.reduce((sum, sample) => sum + sample.measuredSeconds, 0) / 60;
  const forecastMinutes = samples.reduce(
    (sum, sample) => sum + sample.estimatedMinutes,
    0,
  );
  return `plan total: ${actualMinutes.toFixed(2)}/${forecastMinutes} = ${renderRatio(actualMinutes / forecastMinutes)} over ${samples.length} measured`;
}

/**
 * Normalize one eligible receipt by its verified forecast-basis unit count.
 *
 * @param record - completed milestone; absent or stale basis means no unit evidence
 * @returns a minutes-per-unit sample or the common/basis-specific exclusion reason
 */
function readWorkUnitCalibrationDisposition(
  record: PlanExportRecord,
): CalibrationDisposition<WorkUnitCalibrationSample> {
  const calibration = readCalibrationDisposition(record);
  const forecastBasis = record.effort?.forecastBasis;

  // Both a receipt-backed Actual and a parsed basis are required to compare like with like.
  if (!calibration.sample) return { reason: calibration.reason };
  if (!forecastBasis) return { reason: "missing countable forecast basis" };

  const countedAgentWorkUnits = countAgentWorkUnits([
    ...record.tasks,
    ...record.testingGateItems,
    ...record.midProofItems,
    record.planAdminEstimate ?? {},
  ]);

  // A stale declared count cannot become evidence for the next user's forecast.
  if (countedAgentWorkUnits !== forecastBasis.agentWorkUnits) {
    return {
      reason: `forecast basis declares ${forecastBasis.agentWorkUnits} units; current count is ${countedAgentWorkUnits}`,
    };
  }

  return {
    sample: {
      sourceFile: record.sourceFile,
      measuredSeconds: calibration.sample.measuredSeconds,
      agentWorkUnits: countedAgentWorkUnits,
      minutesPerUnit:
        calibration.sample.measuredSeconds / 60 / countedAgentWorkUnits,
    },
  };
}

/** Basis-only exclusions never remove the same receipt from estimate-ratio history. */
function readWorkUnitCalibrationSample(
  record: PlanExportRecord,
): WorkUnitCalibrationSample | undefined {
  return readWorkUnitCalibrationDisposition(record).sample;
}

/** Explain completed history without flooding plans that have no completed work yet. */
function renderCalibrationEligibility(records: PlanExportRecord[]): string[] {
  const completed = records.filter(
    (record) => record.status.trim().toLowerCase() === "complete",
  );
  if (completed.length === 0) return [];
  const lines: string[] = [];
  const nonCompleteCount = records.length - completed.length;
  if (nonCompleteCount > 0) {
    lines.push(
      `calibration eligibility: ${nonCompleteCount} non-complete milestones excluded from both pools`,
    );
  }
  for (const record of completed) {
    const calibration = readCalibrationDisposition(record);
    if (!calibration.sample) {
      lines.push(
        `calibration exclusion: ${record.sourceFile} - both pools: ${calibration.reason}`,
      );
      continue;
    }
    const workUnit = readWorkUnitCalibrationDisposition(record);
    if (!workUnit.sample) {
      lines.push(
        `calibration exclusion: ${record.sourceFile} - work-unit pool only: ${workUnit.reason}; estimate-ratio eligible`,
      );
    }
    // Rounding a positive receipt to zero changes its display, not its admission or provenance.
    if (Math.round(calibration.sample.measuredSeconds / 60) === 0) {
      lines.push(
        `calibration note: ${record.sourceFile} - ${calibration.sample.measuredSeconds}s raw rounds to 0 min; estimate-ratio eligible; work-unit ${workUnit.sample ? "eligible" : "excluded"}`,
      );
    }
  }
  return lines;
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

/**
 * Interpolate at index (n - 1) * p in an ascending rate sample.
 * This convention keeps the reported endpoints deterministic, including small samples.
 *
 * @param sortedRates - ascending measured rates; empty returns zero, one sample returns itself
 * @param quantile - fraction from zero to one, including the observed endpoints
 * @returns the interpolated rate before rounding to the published two-decimal precision
 */
export function interpolatedQuantile(
  sortedRates: readonly number[],
  quantile: number,
): number {
  const position = (sortedRates.length - 1) * quantile;
  const lowerIndex = Math.floor(position);
  const lower = sortedRates[lowerIndex] ?? 0;
  const upper = sortedRates[Math.ceil(position)] ?? lower;
  return lower + (upper - lower) * (position - lowerIndex);
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
  quantiles: ForecastBandQuantiles,
): LocalWorkUnitRates {
  // Interpolated endpoints reduce sensitivity to isolated extremes without removing samples.
  const sortedRates = workUnitSamples
    .map((workUnitSample) => workUnitSample.minutesPerUnit)
    .sort((leftRate, rightRate) => leftRate - rightRate);
  return {
    lowMinutesPerUnit: interpolatedQuantile(sortedRates, quantiles[0] / 100),
    likelyMinutesPerUnit: medianRatio(sortedRates),
    highMinutesPerUnit: interpolatedQuantile(sortedRates, quantiles[1] / 100),
  };
}

/** Rates may move without changing the plan; compare every derived bound using the published local rates. */
function basisMatchesLocalRates(
  forecastBasis: PlanEffortForecastBasis,
  localMinutesPerUnitRates: LocalWorkUnitRates,
): boolean {
  const recordedRange = deriveForecastRangeFromBasis(forecastBasis);
  const localRange = deriveForecastRangeFromBasis({
    ...forecastBasis,
    ...localMinutesPerUnitRates,
  });
  return (
    recordedRange.lowMinutes === localRange.lowMinutes &&
    recordedRange.likelyMinutes === localRange.likelyMinutes &&
    recordedRange.highMinutes === localRange.highMinutes
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
    // Copyable rates that preserve all three bounds require no new forecast.
    if (basisMatchesLocalRates(forecastBasis, locallyCalibratedBasis)) {
      return [];
    }
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
 * @param quantiles - selected historical percentiles; the median and rounding rules stay fixed
 * @returns unit evidence and advisories; these lines never mutate files or fail the check
 */
function renderWorkUnitCalibrationSummary(
  records: PlanExportRecord[],
  quantiles: ForecastBandQuantiles,
): string[] {
  const workUnitSamples = collectWorkUnitCalibrationSamples(records);

  // Fewer than three receipts cannot replace the conservative cold-start prior.
  if (workUnitSamples.length < MINIMUM_CALIBRATION_SAMPLES) {
    return [
      `work-unit calibration: uncalibrated - ${workUnitSamples.length} of ${MINIMUM_CALIBRATION_SAMPLES} eligible measured samples with countable bases`,
    ];
  }

  const localMinutesPerUnitRates = readLocalWorkUnitRates(
    workUnitSamples,
    quantiles,
  );
  return [
    `work-unit calibration: ${workUnitSamples.length} eligible measured samples - median ${renderMinutesPerUnit(localMinutesPerUnitRates.likelyMinutesPerUnit)} min/unit, p${quantiles[0]}-p${quantiles[1]} ${renderMinutesPerUnit(localMinutesPerUnitRates.lowMinutesPerUnit)}-${renderMinutesPerUnit(localMinutesPerUnitRates.highMinutesPerUnit)} min/unit`,
    // Each sample line lets the author verify the summary from raw seconds and unit count.
    ...workUnitSamples.map(
      (workUnitSample) =>
        `work-unit sample: ${workUnitSample.sourceFile} ${renderMinutesPerUnit(workUnitSample.minutesPerUnit)} min/unit (${workUnitSample.measuredSeconds}s / ${workUnitSample.agentWorkUnits} units)`,
    ),
    ...renderRequiredReforecasts(records, localMinutesPerUnitRates),
  ];
}

/** Completion time binds a measured rate to the history that was available before its completion group. */
interface TimedWorkUnitSample extends WorkUnitCalibrationSample {
  completionEpoch: number;
}

/** Untimed eligible samples still count in the cohort, but cannot train or receive a replay prediction. */
function collectReplaySamples(records: PlanExportRecord[]): {
  timed: TimedWorkUnitSample[];
  missing: string[];
} {
  const timed: TimedWorkUnitSample[] = [];
  const missing: string[] = [];
  for (const record of records) {
    const sample = readWorkUnitCalibrationSample(record);
    if (!sample) continue;
    const ends =
      record.timingReceipt?.segments
        .filter((segment) => segment.state === "closed")
        .map((segment) => segment.endEpochSeconds)
        .filter(
          (epoch): epoch is number =>
            epoch !== null && Number.isSafeInteger(epoch) && epoch >= 0,
        ) ?? [];
    if (ends.length === 0) {
      missing.push(sample.sourceFile);
      continue;
    }
    timed.push({ ...sample, completionEpoch: Math.max(...ends) });
  }
  timed.sort(
    (a, b) =>
      a.completionEpoch - b.completionEpoch ||
      a.sourceFile.localeCompare(b.sourceFile),
  );
  missing.sort();
  return { timed, missing };
}

/** Replay predictions use exactly the rounded rates a planner could have copied at that time. */
function replayForecast(
  sample: WorkUnitCalibrationSample,
  prior: WorkUnitCalibrationSample[],
  quantiles: ForecastBandQuantiles,
) {
  const rates = readLocalWorkUnitRates(prior, quantiles);
  const published = {
    lowMinutesPerUnit: Number(renderMinutesPerUnit(rates.lowMinutesPerUnit)),
    likelyMinutesPerUnit: Number(
      renderMinutesPerUnit(rates.likelyMinutesPerUnit),
    ),
    highMinutesPerUnit: Number(renderMinutesPerUnit(rates.highMinutesPerUnit)),
  };
  const range = deriveForecastRangeFromBasis({
    ...published,
    agentWorkUnits: sample.agentWorkUnits,
    source: "completion-ordered history",
  });
  const actualMinutes = sample.measuredSeconds / 60;
  const outcome =
    actualMinutes < range.lowMinutes
      ? "below"
      : actualMinutes > range.highMinutes
        ? "above"
        : "inside";
  return { published, range, outcome };
}

/** Equal completion times share one frozen training history, so ties cannot train each other. */
function renderRuleCoverage(
  records: PlanExportRecord[],
  quantiles: ForecastBandQuantiles,
): string[] {
  const { timed, missing } = collectReplaySamples(records);
  const groups = new Map<number, TimedWorkUnitSample[]>();
  for (const sample of timed) {
    const group = groups.get(sample.completionEpoch) ?? [];
    group.push(sample);
    groups.set(sample.completionEpoch, group);
  }
  const prior: WorkUnitCalibrationSample[] = [];
  const detail = missing.map(
    (sourceFile) =>
      `rule skip: ${sourceFile} - no usable closed completion time; excluded from replay and training`,
  );
  let insufficient = 0;
  let inside = 0;
  let below = 0;
  let above = 0;
  for (const [epoch, group] of groups) {
    for (const sample of group) {
      if (prior.length < 8) {
        insufficient++;
        detail.push(
          `rule skip: ${sample.sourceFile} - completion epoch ${epoch}; only ${prior.length} earlier samples (minimum 8)`,
        );
        continue;
      }
      const { published, range, outcome } = replayForecast(
        sample,
        prior,
        quantiles,
      );
      if (outcome === "inside") inside++;
      else if (outcome === "below") below++;
      else above++;
      detail.push(
        `rule sample: ${sample.sourceFile} - completion epoch ${epoch}; prior ${prior.length}; rates ${renderMinutesPerUnit(published.lowMinutesPerUnit)}-${renderMinutesPerUnit(published.likelyMinutesPerUnit)}-${renderMinutesPerUnit(published.highMinutesPerUnit)} min/unit; ${sample.agentWorkUnits} units; band ${range.lowMinutes}-${range.highMinutes} min; likely ${range.likelyMinutes}; actual ${sample.measuredSeconds}s; ${outcome}`,
      );
    }
    // Only after every tied prediction is fixed may this completion group enter the next group's history.
    prior.push(...group);
  }
  const scored = inside + below + above;
  const coverage =
    scored === 0
      ? "no score (n/a)"
      : `${inside} of ${scored} inside (${((inside / scored) * 100).toFixed(1)}%) - ${below} below, ${above} above`;
  return [
    `forecast rule: historical p${quantiles[0]}/p${quantiles[1]}; nominal span ${quantiles[1] - quantiles[0]} percentage points is not a future coverage promise`,
    `rule coverage: scored ${scored} of ${timed.length + missing.length} eligible work-unit samples; ${coverage}; skipped ${insufficient} insufficient history, ${missing.length} missing completion time`,
    ...detail,
  ];
}

/**
 * Render the informational calibration block.
 *
 * Contract: this block is advisory-only.
 * It must never contribute errors and must never change a forecast: it reports how past measured milestones landed against their estimates and leaves
 * the judgement to the author.
 *
 * Below three eligible samples the calibration line says `uncalibrated`; descriptive coverage and plan-total lines still report the available cohort.
 *
 * @param records - every parsed milestone in the plan directory
 * @param quantiles - validated historical percentiles; omitted uses p10/p90 without changing the median
 * @returns report lines; always at least the count line once the plan has milestones
 */
export function renderCalibrationSummary(
  records: PlanExportRecord[],
  quantiles: ForecastBandQuantiles = DEFAULT_FORECAST_BAND_QUANTILES,
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
    renderBandCoverageSummary(records),
    renderPlanTotalSummary(estimateComparisonSamples),
    ...renderWorkUnitCalibrationSummary(records, quantiles),
    ...renderRuleCoverage(records, quantiles),
    ...renderCalibrationEligibility(records),
  ];
}
