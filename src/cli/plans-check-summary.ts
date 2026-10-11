/**
 * Builds the report lines `plans check` prints above its `warning:` and `error:` lines, so the plan author can see how the plan is going.
 *
 * The checkers answer "is anything wrong"; this file answers "what is running, what can start next, and how are the estimates landing".
 * Example: the author ran `plans check --max-active 2 <plan-dir>` to pick the next milestone and read its `ready:` and `waiting:` lines.
 *
 * - Effort rows: one line per milestone that declared an estimate, plus the `plan:` mix total and any `excluded:` minutes.
 * - Slots and readiness: `active:` rows above cap one, then one `ready:` or `waiting:` line per unstarted milestone.
 * - Calibration: estimate-to-Actual ratios and work-unit rates need at least three eligible finished milestones.
 * - Coverage and plan-total lines describe smaller cohorts with their sample counts; they do not establish estimator bias.
 * - Forecast history: `history ...` lines for unfinished milestones that use the contextual forecast method.
 */
import { scrubDurableText } from "./evidence/redaction.js";
import {
  selectPlanForecastHistory,
  type PlanForecastHistory,
} from "./plans-forecast-history.js";
import {
  countAgentWorkUnits,
  deriveForecastRangeFromBasis,
  floorUnallocatableLikely,
  isNumericActual,
  renderLikelyFloorNote,
  type FlooredForecastBasis,
  type PlanEffortForecastBasis,
  type PlanEffortSplit,
} from "./plans-effort.js";
import type { PlanForecastRecord } from "./plans-forecast-context.js";
import type { PlanExportRecord } from "./plans-export.js";
import {
  isMilestoneIdShared,
  readActiveMilestones,
  readDeclaredLane,
  readDependencyGraph,
  readSlotHolders,
  readStatusIssue,
  type DependencyGraph,
  type MilestoneIdentity,
  type SlotHolder,
} from "./plans-check-structure.js";
import { DEFAULT_FORECAST_BAND_QUANTILES } from "./config/config-vocabulary.js";
import type { ForecastBandQuantiles } from "./config/types.js";

/** Plan-level effort-mix target percentages from goat-plan's estimation guidance. */
const MIX_TARGET: PlanEffortSplit = { product: 70, proof: 20, other: 10 };

// Drift beyond 15 percentage points prints the `advisory:` line; the margin keeps one small proof-heavy milestone from flagging a healthy plan.
// Sustained imbalance still crosses it; retune this limit once real Actual data accumulates.
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
  // An `unavailable` or `incomplete` Actual has no minutes, so the row shows the author's reason instead.
  if (actual && !isNumericActual(actual)) {
    actualText = ` | actual: ${actual.state} - ${actual.reason}`;
  } else if (actual && isNumericActual(actual)) {
    // A `measured` or `retrospective` Actual shows its minutes, plus its split and reason when the author recorded them.
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
 * Print one `active:` row per milestone holding a slot, then the `plan: N active milestones (cap N)` line, when parallel work is allowed.
 * Example: the author ran `plans check --max-active 2 <plan-dir>` to see which lanes are busy before starting another milestone.
 *
 * @param records - all parsed milestones; inactive milestones contribute no active row
 * @param maxActive - resolved positive safe integer cap; one suppresses this entire block
 * @returns active rows and the cap total; an invalid Lane shows as `lane: <invalid>`
 */
export function renderActivePlanSummary(
  records: PlanExportRecord[],
  maxActive: number,
): string[] {
  // With one slot there are no lanes to show; the readiness lines already name whatever fills the cap.
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

/** Statuses that get a readiness line: not-started work and blocked work that cannot continue; active, finished and dropped work gets none. */
const UNSTARTED_STATUSES = new Set(["not-started", "blocked"]);

/**
 * Render milestones that hold or may hold a slot as `M18 (in-progress), M04 (status invalid), M19 (in-progress, lane invalid)`.
 *
 * @param holders - milestones named in one lane or cap clause
 * @param maxActive - resolved cap; an invalid lane is named only above one, where lanes gate work
 * @returns comma-joined IDs, each with its Status or the unreadable fields that make its slot uncertain
 */
function renderHolders(holders: SlotHolder[], maxActive: number): string {
  return holders
    .map((holder) => {
      const details = [
        holder.statusIssue === null
          ? holder.status
          : `status ${holder.statusIssue}`,
      ];
      // An unreadable lane could be any lane, which explains why this holder blocks a lane it does not appear to name.
      if (maxActive > 1 && holder.lane === null) details.push("lane invalid");
      return `${holder.id} (${details.join(", ")})`;
    })
    .join(", ");
}

/**
 * Name the milestone's own Status and ID problems, so a blocked milestone or one whose ID another file shares never reads ready.
 *
 * @param identity - unstarted milestone with one valid Status
 * @param graph - plan graph that knows which milestone numbers several files claim
 * @returns `status blocked` and `ID duplicated` clauses; empty when neither applies
 */
function listOwnFieldBlockers(
  identity: MilestoneIdentity,
  graph: DependencyGraph,
): string[] {
  const clauses: string[] = [];
  // Blocked work waits on whatever its Status reason records, even when its prerequisites are done.
  if (identity.record.status.trim().toLowerCase() === "blocked") {
    clauses.push("status blocked");
  }
  // Two files with one number cannot both be the milestone the author starts next.
  if (isMilestoneIdShared(graph, identity.id)) clauses.push("ID duplicated");
  return clauses;
}

/**
 * Describe one prerequisite that is not known to be complete.
 *
 * @param dependency - ID from the waiting milestone's `Depends on` list, other than its own
 * @param graph - plan graph; an ID outside the plan reads `missing` and already has its own strict error
 * @returns `M21 (not-started)`-style text, or null when exactly one file has the ID and its one valid Status is `complete`
 */
function describeUnmetPrerequisite(
  dependency: string,
  graph: DependencyGraph,
): string | null {
  // With two files behind one ID, either could be the prerequisite, so neither file's Status settles it.
  if (isMilestoneIdShared(graph, dependency)) {
    return `${dependency} (ID duplicated)`;
  }
  const dependencyRecord = graph.byId.get(dependency)?.record;
  // No file in the plan carries this ID, so it reads as missing until the author fixes the `Depends on` entry or adds the file.
  if (!dependencyRecord) return `${dependency} (missing)`;
  const statusIssue = readStatusIssue(dependencyRecord);
  // An unreadable Status might hide unfinished work, so the prerequisite does not count as done.
  if (statusIssue !== null) return `${dependency} (status ${statusIssue})`;
  const status = dependencyRecord.status.trim().toLowerCase();
  // Only a `complete` prerequisite releases the wait; work still in progress or in testing keeps the milestone waiting.
  return status === "complete" ? null : `${dependency} (${status})`;
}

/**
 * Explain which dependency field or unfinished prerequisites keep a milestone waiting.
 *
 * @param identity - milestone whose `Depends on` list is read
 * @param graph - plan graph used to resolve each prerequisite
 * @returns waiting clauses with prerequisites in declared order; empty when the field is valid and every prerequisite is complete
 */
function listDependencyBlockers(
  identity: MilestoneIdentity,
  graph: DependencyGraph,
): string[] {
  // A missing or invalid `Depends on` field could hide any prerequisite, so the milestone waits until the author fixes it.
  if (identity.dependencyIssue !== null) {
    return [
      identity.dependencyIssue === "missing"
        ? "dependencies missing"
        : "dependency list invalid",
    ];
  }
  const unmet: string[] = [];
  // Every prerequisite not known to be complete joins one `needs ...` clause, in the order the author listed them.
  for (const dependency of identity.dependencies) {
    // Waiting on itself can never be satisfied, even if the field parsed successfully.
    const unmetText =
      dependency === identity.id
        ? `${dependency} (itself)`
        : describeUnmetPrerequisite(dependency, graph);
    // A complete prerequisite adds nothing, so a milestone whose prerequisites are all done gets no `needs` clause.
    if (unmetText !== null) unmet.push(unmetText);
  }
  return unmet.length > 0 ? [`needs ${unmet.join(", ")}`] : [];
}

/**
 * Name the slot holders that could share a milestone's lane above cap one; a holder with an unreadable lane could be in any lane.
 *
 * @param lane - waiting milestone's lane; null means its own Lane field is invalid, so no lane can be checked
 * @param others - slot holders other than the waiting milestone
 * @param maxActive - resolved cap above one
 * @returns `lane invalid`, `lane go occupied by ...` or `lane go may be occupied by ...`; empty when no holder could share the lane
 */
function listLaneBlockers(
  lane: string | null,
  others: SlotHolder[],
  maxActive: number,
): string[] {
  // Without a readable Lane of its own, the milestone cannot be matched to a free lane, so it waits for the author to fix the field.
  if (lane === null) return ["lane invalid"];
  const sharing = others.filter(
    (holder) => holder.lane === lane || holder.lane === null,
  );
  // No holder is in this lane or could be, so the lane does not hold the milestone back.
  if (sharing.length === 0) return [];
  // Only known active work in this exact lane occupies it for certain; every other holder only might.
  const isOccupied = sharing.some(
    (holder) => holder.statusIssue === null && holder.lane === lane,
  );
  const verb = isOccupied ? "occupied" : "may be occupied";
  return [`lane ${lane} ${verb} by ${renderHolders(sharing, maxActive)}`];
}

/**
 * Name the slot holders that fill, or could fill, the active cap.
 *
 * @param others - slot holders other than the waiting milestone
 * @param maxActive - resolved active cap
 * @returns `cap N full: ...` when known active work reaches the cap, `cap N may be full: ...` when counting unreadable Status values does
 */
function listCapBlockers(others: SlotHolder[], maxActive: number): string[] {
  const active = others.filter((holder) => holder.statusIssue === null);
  // A full cap holds every unstarted milestone until something finishes, whatever its prerequisites say.
  if (active.length >= maxActive) {
    return [`cap ${maxActive} full: ${renderHolders(active, maxActive)}`];
  }
  // Each unreadable Status might be active work, so counting it as active is the worst case the author could be in.
  if (others.length >= maxActive) {
    return [
      `cap ${maxActive} may be full: ${renderHolders(others, maxActive)}`,
    ];
  }
  return [];
}

/**
 * Tell the author which unstarted milestones can start now and what blocks the rest, so picking the next one needs no file reading.
 *
 * - Prints at every cap because cap one is the usual case; lanes are named only above cap one, where they affect eligibility.
 * - A line reads `ready:` only when no correction of an unreadable Status, lane, ID or dependency field could make the milestone wait.
 * - The lines report eligibility only: choosing the next milestone stays a human decision, and a `ready:` line grants no writer ownership.
 *
 * @param records - every parsed milestone in file order; only those with one valid `not-started` or `blocked` Status get a line
 * @param maxActive - resolved active cap; once the active count reaches it, every waiting line names the occupants
 * @returns one `ready:` or `waiting:` line per such milestone; empty when the plan has none
 */
export function renderReadinessSummary(
  records: PlanExportRecord[],
  maxActive: number,
): string[] {
  const graph = readDependencyGraph(records, []);
  const holders = readSlotHolders(graph.identities);
  const lines: string[] = [];
  // Each unstarted milestone gets one line: `ready:` when nothing blocks it, otherwise `waiting:` with every blocker at once so all can be fixed.
  for (const identity of graph.identities) {
    const status = identity.record.status.trim().toLowerCase();
    // Active, finished and dropped work is not waiting to start, and an unreadable Status is not known to be unstarted; others still see it.
    if (
      readStatusIssue(identity.record) !== null ||
      !UNSTARTED_STATUSES.has(status)
    ) {
      continue;
    }
    const lane = readDeclaredLane(identity.record);
    const others = holders.filter(
      (holder) => holder.sourceFile !== identity.record.sourceFile,
    );
    const clauses = [
      ...listOwnFieldBlockers(identity, graph),
      ...listDependencyBlockers(identity, graph),
      ...(maxActive > 1 ? listLaneBlockers(lane, others, maxActive) : []),
      ...listCapBlockers(others, maxActive),
    ];
    // Above cap one a ready milestone always has a readable lane, because an invalid one adds a waiting clause.
    const laneText = maxActive > 1 ? ` | lane ${lane}` : "";
    lines.push(
      clauses.length === 0
        ? `ready: ${identity.id}${laneText}`
        : `waiting: ${identity.id} | ${clauses.join("; ")}`,
    );
  }
  return lines;
}

/**
 * Sum every live milestone's split into plan-level per-category totals.
 * Feeds the `plan:` line the author uses to judge the overall mix.
 *
 * @param records - every parsed milestone; one without a split, or superseded or deferred, adds nothing
 * @returns minute totals; all zeros means no live milestone declared a split, so no `plan:` line prints
 */
function sumPlanSplits(records: PlanExportRecord[]): PlanEffortSplit {
  const totals: PlanEffortSplit = { product: 0, proof: 0, other: 0 };

  // Fold each estimate-carrying milestone into the plan-wide picture.
  for (const record of records) {
    // Milestones without a split (legacy or headline-only) cannot shape the mix.
    if (!record.effort?.split) continue;
    // Superseded and deferred work is reported on its own line so the total describes what the plan still owes.
    if (isExcludedFromTotal(record)) continue;
    // Each category adds to its own plan-wide total, which the `plan:` line turns into the mix percentages.
    for (const category of CATEGORIES) {
      totals[category] += record.effort.split[category];
    }
  }
  return totals;
}

/**
 * Print the `plan:` line with total minutes and product/proof/other mix, an `advisory:` line when the mix drifts, then any `excluded:` line.
 *
 * The advisory never fails the check: 70/20/10 is a prior to reason against, and a spike-heavy plan may be right to drift with a stated reason.
 * Example: a plan whose splits are mostly proof minutes gets the advisory, prompting the author to look for duplicated proof.
 *
 * @param records - every parsed milestone; only declared splits on live milestones shape the mix
 * @returns summary lines; empty means no milestone declared a split, and `plans check` then skips the calibration block too
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
  // Only a mix outside the tolerance prints the `advisory:` line; a mix within it stays quiet.
  if (hasDrifted) {
    lines.push(
      "advisory: plan mix drifts more than 15 percentage points from the rough ~70/20/10 guide - check for duplicated proof or missing verification; keep and explain the mix when task risk warrants it",
    );
  }
  lines.push(...excludedLines);
  return lines;
}

/**
 * Print the `excluded:` line for estimates that left the plan total because their milestones are superseded or deferred.
 * The author sees exactly which files carry those minutes, so the total never looks like it silently shrank.
 *
 * @param records - every parsed milestone; only superseded or deferred ones with a declared split are listed
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
/** Eligible finished milestones needed before the calibration lines stop reading `uncalibrated` and local rates replace the cold-start prior. */
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
 * Decide whether a finished milestone's receipt can calibrate estimates, or give the reason its `calibration exclusion:` line prints.
 *
 * Both pools need a human-ratified `complete` Status and a receipt-backed `measured` Actual.
 * Anything pending, retrospective, unavailable or incomplete stays out; raw positive seconds keep short receipts even when they display as 0 min.
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
  // Only human-ratified finished work has a final duration; unfinished milestones are only counted in the `calibration eligibility:` line.
  if (record.status.trim().toLowerCase() !== "complete") {
    return { reason: "status is not complete" };
  }
  // Without an estimate there is nothing for the measured time to be compared against.
  if (!effort) return { reason: "missing effort estimate" };
  // Only a `measured` Actual is receipt-backed; retrospective, unavailable and incomplete ones cannot move calibration.
  if (effort.actual?.state !== "measured") {
    return { reason: "Actual is not measured" };
  }
  // A `measured` Actual whose timing receipt has no summary leaves no raw seconds to trust.
  if (!summary) return { reason: "missing receipt summary" };

  // A zero-minute estimate has no ratio to report, so it contributes nothing.
  if (effort.totalMinutes <= 0) return { reason: "estimate is not positive" };

  // `plans time` permits a same-second receipt, whose 0.00 min/unit rate would be advised as a reforecast that `readSafePositiveRate` rejects.
  // That advice would block the milestone indefinitely.
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

/** Reuse the decision behind the `calibration exclusion:` lines, so the calibration numbers never count a milestone the report excluded. */
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
  // An ineligible milestone, or one whose author recorded no forecast range, cannot be scored for band coverage.
  if (!sample || !range) return undefined;
  return {
    measuredMinutes: sample.measuredSeconds / 60,
    lowMinutes: range.lowMinutes,
    highMinutes: range.highMinutes,
    widthRatio: range.highMinutes / range.lowMinutes,
  };
}

/**
 * Print the `band coverage:` line: how many measured milestones landed inside, below or above the forecast range their author recorded.
 * Raw receipt minutes on either endpoint must count as inside; an empty cohort shows `n/a`, and the line never promises future coverage.
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
  // Before any milestone can be scored the author sees `n/a`, not a misleading 0%.
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

/** Print the `plan total:` line: summed measured minutes over summed estimates for the same eligible milestones, with or without forecast ranges. */
function renderPlanTotalSummary(samples: CalibrationSample[]): string {
  // With no eligible measured milestone yet there is no ratio, so the author sees `unavailable` and the zero count.
  if (samples.length === 0) return "plan total: unavailable over 0 measured";
  const actualMinutes =
    samples.reduce((sum, sample) => sum + sample.measuredSeconds, 0) / 60;
  const forecastMinutes = samples.reduce(
    (sum, sample) => sum + sample.estimatedMinutes,
    0,
  );
  return `plan total: ${actualMinutes.toFixed(2)}/${forecastMinutes} = ${renderRatio(actualMinutes / forecastMinutes)} over ${samples.length} measured`;
}

/** Count the agent-owned units on a milestone's checklist today; missing plan/admin time contributes no unit. */
function countRecordAgentWorkUnits(record: PlanExportRecord): number {
  return countAgentWorkUnits([
    ...record.tasks,
    ...record.testingGateItems,
    ...record.midProofItems,
    record.planAdminEstimate ?? {},
  ]);
}

/** Work one milestone registered at issue and in later revisions, counted by saved item identity. */
interface RegisteredUnitGrowth {
  issuedUnits: number;
  addedUnits: number;
  hasRevision: boolean;
}

/**
 * Read the work a milestone registered in its forecast records.
 * Saved records count under either declared forecast method, and an item added, dropped and added again still counts once.
 *
 * @param record - parsed milestone; one without saved records, or with rejected forecast metadata, has no registered work
 * @returns units in the original forecast and distinct item IDs added by later revisions; undefined without a trusted original
 */
function readRegisteredUnitGrowth(
  record: PlanExportRecord,
): RegisteredUnitGrowth | undefined {
  const context = record.forecastContext;
  // The parser nulls the method when it rejects the metadata, so those records are not evidence.
  if (!context?.method) return undefined;
  const [original, ...revisions] = context.document?.records ?? [];
  // With no saved original forecast there is no issued unit count for later revisions to grow from.
  if (!original) return undefined;
  const addedIds = new Set(
    revisions.flatMap((revision) => revision.scopeDelta.added),
  );
  return {
    issuedUnits: original.items.length,
    addedUnits: addedIds.size,
    hasRevision: revisions.length > 0,
  };
}

/**
 * Decide whether a finished checklist left its forecast basis with nothing registered to explain it.
 *
 * @param record - finished milestone; one without a forecast basis has no count to compare
 * @param growth - the milestone's registered work; a saved revision already explains a moved count
 * @returns true when the count moved with no recorded direction: the work may have been added, removed or re-split
 */
function hasUnexplainedUnitCount(
  record: PlanExportRecord,
  growth: RegisteredUnitGrowth | undefined,
): boolean {
  const forecastBasis = record.effort?.forecastBasis;
  // A saved revision already explains a changed count, and without a forecast basis there is no declared count to drift from.
  if (growth?.hasRevision || !forecastBasis) return false;
  return forecastBasis.agentWorkUnits !== countRecordAgentWorkUnits(record);
}

/** Plan-wide counts behind the `unit growth:` line; units are summed only over milestones with trusted saved records. */
interface UnitGrowthTally {
  registeredCount: number;
  grownCount: number;
  issuedUnits: number;
  addedUnits: number;
  unexplainedCount: number;
}

/**
 * Add up registered growth and unexplained count changes across the plan's finished milestones.
 *
 * @param records - every parsed milestone in the plan directory; only `complete` ones are read
 * @returns the tally; all zeros means the plan has no growth to report
 */
function tallyUnitGrowth(records: PlanExportRecord[]): UnitGrowthTally {
  const tally: UnitGrowthTally = {
    registeredCount: 0,
    grownCount: 0,
    issuedUnits: 0,
    addedUnits: 0,
    unexplainedCount: 0,
  };
  // Each finished milestone adds its registered and unexplained unit changes to the `unit growth:` totals.
  for (const record of records) {
    // Only finished milestones count, so growth on work still under way cannot skew the `unit growth:` line.
    if (record.status.trim().toLowerCase() !== "complete") continue;
    const growth = readRegisteredUnitGrowth(record);
    // Only milestones with trusted saved forecast records add to the issued and added unit totals.
    if (growth) {
      tally.registeredCount++;
      tally.issuedUnits += growth.issuedUnits;
      tally.addedUnits += growth.addedUnits;
      // A milestone whose later revisions added work counts once toward the "registered added work" figure.
      if (growth.addedUnits > 0) tally.grownCount++;
    }
    // A changed checklist with no saved revision is counted separately, because nobody recorded whether work was added or removed.
    if (hasUnexplainedUnitCount(record, growth)) tally.unexplainedCount++;
  }
  return tally;
}

/**
 * Report work added after forecasts, so an overrun caused by new scope is not read as a bad estimate.
 *
 * Registered revisions are the only trusted source. A finished checklist that left its basis is counted without a direction.
 * Unregistered additions leave no trace, which makes the reported growth a floor.
 *
 * @param records - every parsed milestone in the plan directory; only `complete` ones are read
 * @returns one line, or none when no finished milestone registered additions or left its basis
 */
function renderUnitGrowthSummary(records: PlanExportRecord[]): string[] {
  const tally = tallyUnitGrowth(records);
  const clauses: string[] = [];
  // Registered additions show how far the issued unit count grew; the percentage is a floor because unregistered additions leave no trace.
  if (tally.grownCount > 0) {
    const addedShare = ((tally.addedUnits / tally.issuedUnits) * 100).toFixed(
      1,
    );
    clauses.push(
      `${tally.grownCount} of ${tally.registeredCount} finished milestones registered added work - ${tally.issuedUnits} units at issue, ${tally.issuedUnits + tally.addedUnits} after additions (+${addedShare}%, unregistered additions not counted)`,
    );
  }
  // Checklists that drifted from their basis without a revision get their own clause, since the direction of the change is unknown.
  if (tally.unexplainedCount > 0) {
    clauses.push(
      tally.unexplainedCount === 1
        ? "1 finished milestone counts differently from its forecast basis with no registered revision (direction unknown)"
        : `${tally.unexplainedCount} finished milestones count differently from their forecast basis with no registered revision (direction unknown)`,
    );
  }
  return clauses.length === 0 ? [] : [`unit growth: ${clauses.join("; ")}`];
}

/**
 * Turn one eligible receipt into a minutes-per-unit rate, or give the reason the `calibration exclusion:` line shows for the work-unit pool.
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

  const countedAgentWorkUnits = countRecordAgentWorkUnits(record);

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

/** Return one milestone's work-unit sample; a basis-only exclusion here never removes the same receipt from estimate-ratio history. */
function readWorkUnitCalibrationSample(
  record: PlanExportRecord,
): WorkUnitCalibrationSample | undefined {
  return readWorkUnitCalibrationDisposition(record).sample;
}

/**
 * Print the `calibration eligibility:`, `calibration exclusion:` and `calibration note:` lines that explain which finished milestones count.
 * Plans with no `complete` milestone print none of these, so early plans are not flooded with exclusions.
 */
function renderCalibrationEligibility(records: PlanExportRecord[]): string[] {
  const completed = records.filter(
    (record) => record.status.trim().toLowerCase() === "complete",
  );
  // No finished milestone means there is no history to explain yet.
  if (completed.length === 0) return [];
  const lines: string[] = [];
  const nonCompleteCount = records.length - completed.length;
  // One summary line covers every unfinished milestone instead of an exclusion line each.
  if (nonCompleteCount > 0) {
    lines.push(
      `calibration eligibility: ${nonCompleteCount} non-complete milestones excluded from both pools`,
    );
  }
  // A finished milestone gets a line only when a pool excludes it or its receipt displays as 0 min.
  for (const record of completed) {
    const calibration = readCalibrationDisposition(record);
    // Failing the shared rules removes it from both pools, so the work-unit check is not run.
    if (!calibration.sample) {
      lines.push(
        `calibration exclusion: ${record.sourceFile} - both pools: ${calibration.reason}`,
      );
      continue;
    }
    const workUnit = readWorkUnitCalibrationDisposition(record);
    // The receipt still calibrates estimate ratios; only its unit-count basis is unusable.
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

/**
 * Rebuild the per-unit rates this plan's own history offered when a saved forecast was issued; the contextual forecast falls back to them.
 *
 * Only milestones whose closed timing ended before that moment count, with the same eligibility and rounding as `reforecast required:` advice.
 * Under the minimum sample count, the shipped cold-start rates apply instead.
 *
 * @param records - selected-folder records only; later outcomes cannot train this origin
 * @param target - frozen work count and registered percentile pair
 * @returns the unchanged selected-plan method, including its cold prior when sparse
 */
export function selectedPlanForecastBasis(
  records: PlanExportRecord[],
  target: PlanForecastRecord,
) {
  // A milestone finished after the forecast was issued could not have informed it, so only earlier finishes count.
  const finishedBeforeIssue = records.filter((record) => {
    const ends =
      record.timingReceipt?.segments
        .filter((segment) => segment.state === "closed")
        .map((segment) => segment.endEpochSeconds ?? Infinity) ?? [];
    return (
      ends.length > 0 && Math.max(...ends) * 1000 < Date.parse(target.issuedAt)
    );
  });
  const samples = collectWorkUnitCalibrationSamples(finishedBeforeIssue);
  // Enough eligible earlier receipts let this plan's own rates replace the cold-start default.
  const hasLocalHistory = samples.length >= MINIMUM_CALIBRATION_SAMPLES;
  const rates = hasLocalHistory
    ? readLocalWorkUnitRates(samples, target.quantiles)
    : {
        // Shipped cold-start default. The goat-plan skill, its milestone reference and the CLI and skills docs state the same three rates as text,
        // and nothing compares that text with this literal, so change them together.
        lowMinutesPerUnit: 1,
        likelyMinutesPerUnit: 2.5,
        highMinutesPerUnit: 6,
      };
  return {
    samples,
    selection: hasLocalHistory
      ? ("selected-plan" as const)
      : ("cold-prior" as const),
    basis: {
      agentWorkUnits: target.items.length,
      lowMinutesPerUnit: Number(rates.lowMinutesPerUnit.toFixed(2)),
      likelyMinutesPerUnit: Number(rates.likelyMinutesPerUnit.toFixed(2)),
      highMinutesPerUnit: Number(rates.highMinutesPerUnit.toFixed(2)),
      source: hasLocalHistory
        ? "selected-plan earlier measured receipts"
        : "cold-start prior",
    },
  };
}

/**
 * Print the `history ...` lines showing which past milestones in this project feed each unfinished contextual forecast, and which were rejected.
 *
 * They explain selection only, apart from issued forecasts and selected-plan rates; every line passes through redaction before printing.
 *
 * @param records - selected-plan milestones; completed or non-contextual records emit no history advice
 * @param history - bounded same-project discovery, including failures that remain advisory
 * @returns readable redacted selection, provenance and exclusion lines without replacement numerical forecasts
 */
export function renderForecastHistorySummary(
  records: PlanExportRecord[],
  history: PlanForecastHistory,
): string[] {
  const lines: string[] = [];
  // Each open `contextual-v1` milestone gets its own history lines, in plan file order.
  for (const record of records) {
    // Finished milestones and those without the `contextual-v1` forecast method get no history lines.
    if (
      record.forecastContext?.method !== "contextual-v1" ||
      record.status.trim().toLowerCase() === "complete"
    )
      continue;
    const selected = selectPlanForecastHistory(history, record);
    lines.push(
      `history selection: ${record.sourceFile} - pool ${selected.selection}; ${selected.samples.length} matched samples; ${selected.intactCount} intact measurements before deduplication; ${selected.reason}`,
    );
    // One `history sample:` line per matched past milestone lets the author trace each rate to its saved forecast and hash.
    for (const sample of selected.samples)
      lines.push(
        `history sample: ${record.sourceFile} <- ${sample.id}; forecast ${sample.forecastId}; sha256 ${sample.sha256}; registered ${sample.registeredAt}; completed ${sample.completedAt}; ${sample.measuredSeconds}s / ${sample.agentWorkUnits} units`,
      );
    // Each rejected candidate is named with its reason, so a missing sample is never silent.
    for (const exclusion of selected.exclusions)
      lines.push(
        `history exclusion: ${record.sourceFile} <- ${exclusion.id} - ${exclusion.reason}`,
      );
    lines.push(
      `history limitation: ${record.sourceFile} - selection checks provided registration consistency, not independent timestamp authenticity; issued forecasts remain unchanged`,
    );
  }
  return lines.map((line) => scrubDurableText(line));
}

/** Middle value of a sorted ratio list, averaging the pair when the count is even. */
function medianRatio(sortedRatios: number[]): number {
  const middle = Math.floor(sortedRatios.length / 2);
  // An odd count has one middle ratio; an even count falls through and averages the two middle ratios.
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

/** Turn eligible receipts into the low, likely and high min/unit rates used for the next forecast; sorting first keeps those values stable. */
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

/**
 * Decide whether a milestone's saved basis already gives the same low, likely and high minutes as the published local rates.
 * Comparing minutes rather than rates means a rate shift that leaves the range unchanged asks the author for nothing.
 */
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
 * Print a `reforecast required:` line for each unfinished milestone whose saved basis no longer matches this plan's measured rates.
 * Example: three measured milestones finish faster than the cold-start rates assumed, so a not-started milestone is told the new rates to copy.
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
    // Contextual advice owns its frozen origin and residual scope; legacy whole-work replacement would conflict with it.
    if (milestoneRecord.forecastContext?.method === "contextual-v1") return [];
    const forecastBasis = milestoneRecord.effort?.forecastBasis;
    const milestoneStatus = milestoneRecord.status.trim().toLowerCase();

    // Finished, blocked, abandoned, and basis-free milestones have no actionable unit forecast here.
    if (!forecastBasis || !REFORECASTABLE_STATUSES.has(milestoneStatus)) {
      return [];
    }

    const countedAgentWorkUnits = countRecordAgentWorkUnits(milestoneRecord);

    // Count drift already has a strict error, so do not layer a misleading duration on top.
    if (countedAgentWorkUnits !== forecastBasis.agentWorkUnits) return [];

    const advised = readAdvisedLocalBasis(
      forecastBasis,
      localMinutesPerUnitRates,
    );
    // Copyable rates that preserve all three bounds require no new forecast.
    if (basisMatchesLocalRates(forecastBasis, advised.basis)) return [];
    return [
      renderReforecastLine(
        milestoneRecord.sourceFile,
        countedAgentWorkUnits,
        advised,
      ),
    ];
  });
}

/** The rates an author can copy from local history, with the floor applied to the likely when one was needed. */
interface AdvisedLocalBasis {
  basis: PlanEffortForecastBasis;
  floored: FlooredForecastBasis | undefined;
}

/**
 * Publish local rates at the precision authors copy, flooring the likely when whole-minute items cannot express it.
 *
 * @param forecastBasis - the milestone's saved basis, which supplies the unit count and source text
 * @param localMinutesPerUnitRates - receipt-derived rates before rounding
 * @returns the advised basis; `floored` is set when history ran under one minute per unit and its high rate could hold the floor
 */
function readAdvisedLocalBasis(
  forecastBasis: PlanEffortForecastBasis,
  localMinutesPerUnitRates: LocalWorkUnitRates,
): AdvisedLocalBasis {
  const publishedBasis: PlanEffortForecastBasis = {
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
  const floored = floorUnallocatableLikely(
    publishedBasis,
    deriveForecastRangeFromBasis(publishedBasis).likelyMinutes,
  );
  return { basis: floored?.basis ?? publishedBasis, floored };
}

/**
 * Render the advice an author copies into a stale milestone.
 *
 * @param sourceFile - the milestone to edit
 * @param countedAgentWorkUnits - units on its checklist, already equal to its basis
 * @param advised - the rates to copy; a floored likely is named with the measured rate it replaced
 * @returns one `reforecast required:` line
 */
function renderReforecastLine(
  sourceFile: string,
  countedAgentWorkUnits: number,
  advised: AdvisedLocalBasis,
): string {
  const { basis, floored } = advised;
  const range = deriveForecastRangeFromBasis(basis);
  const floorNote = floored ? `; ${renderLikelyFloorNote(floored)}` : "";
  return `reforecast required: ${sourceFile} - ${countedAgentWorkUnits} agent work units imply ${range.lowMinutes}-${range.highMinutes} agent-time minutes; likely ${range.likelyMinutes} from local evidence; use ${renderMinutesPerUnit(basis.lowMinutesPerUnit)}-${renderMinutesPerUnit(basis.likelyMinutesPerUnit)}-${renderMinutesPerUnit(basis.highMinutesPerUnit)} min/unit before implementation${floorNote}`;
}

/**
 * Print the `work-unit calibration:` line, one `work-unit sample:` line per eligible receipt, and any `reforecast required:` advice.
 * Below the minimum sample count it prints only the `uncalibrated` line and no reforecast advice.
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

/**
 * Split eligible work-unit samples into those with a usable completion time, in a stable oldest-first order, and the file names of those without one.
 * Untimed samples must still count in the `rule coverage:` cohort but cannot train or receive a replay prediction.
 */
function collectReplaySamples(records: PlanExportRecord[]): {
  timed: TimedWorkUnitSample[];
  missing: string[];
} {
  const timed: TimedWorkUnitSample[] = [];
  const missing: string[] = [];
  // Each milestone in the work-unit pool is placed in completion order for the replay behind the `rule coverage:` line.
  for (const record of records) {
    const sample = readWorkUnitCalibrationSample(record);
    // Milestones outside the work-unit pool take no part in the replay.
    if (!sample) continue;
    const ends =
      record.timingReceipt?.segments
        .filter((segment) => segment.state === "closed")
        .map((segment) => segment.endEpochSeconds)
        .filter(
          (epoch): epoch is number =>
            epoch !== null && Number.isSafeInteger(epoch) && epoch >= 0,
        ) ?? [];
    // Without a valid closed end time the receipt cannot be placed in completion order, so the author sees a `rule skip:` line for it.
    if (ends.length === 0) {
      missing.push(sample.sourceFile);
      continue;
    }
    timed.push({ ...sample, completionEpoch: Math.max(...ends) });
  }
  // Oldest completion first, with file name breaking ties, so the replay and its lines read the same on every run.
  timed.sort(
    (a, b) =>
      a.completionEpoch - b.completionEpoch ||
      a.sourceFile.localeCompare(b.sourceFile),
  );
  missing.sort();
  return { timed, missing };
}

/**
 * Score one past milestone against the band its earlier history would have given: `inside`, `below` or `above`.
 *
 * Replay predictions use the rounded low and high rates a planner could have copied at that time.
 * The likely is shown as measured, without the whole-minute floor that advice applies, because coverage reads only the band.
 *
 * @param sample - the finished milestone being scored
 * @param prior - eligible samples that completed strictly earlier; the caller skips milestones with fewer than eight
 * @param quantiles - percentile pair that sets the low and high rates
 * @returns the rounded rates, the band in minutes and where the measured time landed
 */
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
  // A measured time on either edge of the band counts as inside, matching the `band coverage:` line.
  const outcome =
    actualMinutes < range.lowMinutes
      ? "below"
      : actualMinutes > range.highMinutes
        ? "above"
        : "inside";
  return { published, range, outcome };
}

/**
 * Print the `forecast rule:` and `rule coverage:` lines: how often past milestones landed inside the band their earlier history would have given.
 *
 * Each milestone is scored only against milestones that finished before it, and needs at least eight of them.
 * Equal completion times share one frozen training history, so ties cannot train each other.
 *
 * @param records - every parsed milestone; only work-unit-eligible ones are replayed
 * @param quantiles - percentile pair the replayed bands use
 * @returns the rule and coverage lines, then one `rule skip:` or `rule sample:` line per eligible milestone
 */
function renderRuleCoverage(
  records: PlanExportRecord[],
  quantiles: ForecastBandQuantiles,
): string[] {
  const { timed, missing } = collectReplaySamples(records);
  const groups = new Map<number, TimedWorkUnitSample[]>();
  // Milestones that finished in the same second form one group, so they are scored against the same history.
  for (const sample of timed) {
    const group = groups.get(sample.completionEpoch) ?? [];
    group.push(sample);
    groups.set(sample.completionEpoch, group);
  }
  const prior: WorkUnitCalibrationSample[] = [];
  const ruleDetailLines = missing.map(
    (sourceFile) =>
      `rule skip: ${sourceFile} - no usable closed completion time; excluded from replay and training`,
  );
  let insufficient = 0;
  let inside = 0;
  let below = 0;
  let above = 0;
  // Groups run oldest first, so each milestone is scored only against history that already existed when it finished.
  for (const [epoch, group] of groups) {
    // Every sample in one completion group is scored against the same earlier history, so tied milestones never train each other.
    for (const sample of group) {
      // Under eight earlier samples the milestone is not scored; the author sees a `rule skip:` line naming the shortfall.
      if (prior.length < 8) {
        insufficient++;
        ruleDetailLines.push(
          `rule skip: ${sample.sourceFile} - completion epoch ${epoch}; only ${prior.length} earlier samples (minimum 8)`,
        );
        continue;
      }
      const { published, range, outcome } = replayForecast(
        sample,
        prior,
        quantiles,
      );
      // Each scored milestone lands inside, below or above its replayed band, and the `rule coverage:` line totals the three.
      if (outcome === "inside") inside++;
      else if (outcome === "below") below++;
      else above++;
      ruleDetailLines.push(
        `rule sample: ${sample.sourceFile} - completion epoch ${epoch}; prior ${prior.length}; rates ${renderMinutesPerUnit(published.lowMinutesPerUnit)}-${renderMinutesPerUnit(published.likelyMinutesPerUnit)}-${renderMinutesPerUnit(published.highMinutesPerUnit)} min/unit; ${sample.agentWorkUnits} units; band ${range.lowMinutes}-${range.highMinutes} min; likely ${range.likelyMinutes}; actual ${sample.measuredSeconds}s; ${outcome}`,
      );
    }
    // Only after every tied prediction is fixed may this completion group enter the next group's history.
    prior.push(...group);
  }
  const scored = inside + below + above;
  // With nothing scored yet the author sees `no score (n/a)` rather than a 0% coverage figure.
  const coverage =
    scored === 0
      ? "no score (n/a)"
      : `${inside} of ${scored} inside (${((inside / scored) * 100).toFixed(1)}%) - ${below} below, ${above} above`;
  return [
    `forecast rule: historical p${quantiles[0]}/p${quantiles[1]}; nominal span ${quantiles[1] - quantiles[0]} percentage points is not a future coverage promise`,
    `rule coverage: scored ${scored} of ${timed.length + missing.length} eligible work-unit samples; ${coverage}; skipped ${insufficient} insufficient history, ${missing.length} missing completion time`,
    ...ruleDetailLines,
  ];
}

/**
 * Print the calibration block after the plan summary: how past measured milestones landed against their estimates.
 *
 * Contract: this block is advisory-only; it never contributes errors, never changes a forecast, and leaves the judgement to the author.
 * Below three eligible samples the `calibration:` line says `uncalibrated`; coverage and plan-total lines still report the available cohort.
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
    ...renderUnitGrowthSummary(records),
    ...renderWorkUnitCalibrationSummary(records, quantiles),
    ...renderRuleCoverage(records, quantiles),
    ...renderCalibrationEligibility(records),
  ];
}
