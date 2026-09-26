/**
 * Compute experimental forecasts from registered work and comparable receipts.
 * Saved item minutes never size work. The checker emits advice without editing
 * originals or converting planned splits to evidence. The one rate it adjusts is a
 * likely floored at one minute per unit for whole-minute items, and the advice says so.
 */
import { scrubDurableText } from "./evidence/redaction.js";
import {
  interpolatedQuantile,
  selectedPlanForecastBasis,
} from "./plans-check-summary.js";
import {
  collectPlanForecastProblems,
  type PlanForecastRecord,
} from "./plans-forecast-context.js";
import {
  selectPlanForecastHistory,
  type PlanForecastHistory,
} from "./plans-forecast-history.js";
import {
  deriveForecastRangeFromBasis,
  floorUnallocatableLikely,
  renderLikelyFloorNote,
  type FlooredForecastBasis,
  type PlanEffortForecastBasis,
  type PlanEffortForecastRange,
} from "./plans-effort.js";
import type { PlanExportRecord } from "./plans-export.js";

/** Registered policy identity; prospective evaluation also pins source hashes. */
const SOURCE_VERSION = "matched-rates-v1";

/**
 * The delivered range remains distinct from an incompatible attempted prediction.
 * `likelyFlooredFrom` holds the measured likely rate when the delivered likely is the whole-minute floor; null means no floor applied.
 */
interface WorkForecast {
  sourceVersion: string;
  selection: PlanForecastRecord["selection"];
  sampleCount: number;
  basis: PlanEffortForecastBasis;
  range: PlanEffortForecastRange;
  attemptedRange: PlanEffortForecastRange;
  isCompatible: boolean;
  likelyFlooredFrom: number | null;
  reason: string;
}

/** Publish exactly the precision authors save; quantiles use raw receipt rates. */
function matchedBasis(
  target: PlanForecastRecord,
  selected: ReturnType<typeof selectPlanForecastHistory>,
): PlanEffortForecastBasis {
  const rates = selected.samples
    .map((sample) => sample.minutesPerUnit)
    .sort((a, b) => a - b);
  const published = (percentile: number) =>
    Number(interpolatedQuantile(rates, percentile / 100).toFixed(2));
  return {
    agentWorkUnits: target.items.length,
    lowMinutesPerUnit: published(target.quantiles[0]),
    likelyMinutesPerUnit: published(50),
    highMinutesPerUnit: published(target.quantiles[1]),
    source: `${SOURCE_VERSION}; registered compatible earlier receipts`,
  };
}

/** Preserve raw rounding for matched predictions; legacy fallback owns its existing floor. */
function matchedRange(basis: PlanEffortForecastBasis) {
  return {
    lowMinutes: Math.floor(basis.agentWorkUnits * basis.lowMinutesPerUnit),
    likelyMinutes: Math.round(
      basis.agentWorkUnits * basis.likelyMinutesPerUnit,
    ),
    highMinutes: Math.ceil(basis.agentWorkUnits * basis.highMinutesPerUnit),
  };
}

/** Check whether the model output fits the existing positive-integer basis and item grammar without clamping. */
function hasRepresentableAllocation(
  basis: PlanEffortForecastBasis,
  range: PlanEffortForecastRange,
  units: number,
): boolean {
  return (
    basis.lowMinutesPerUnit > 0 &&
    range.lowMinutes >= 1 &&
    range.likelyMinutes >= units &&
    Number.isSafeInteger(range.highMinutes)
  );
}

/** One target's computed rates and ranges before compatibility is judged; `attemptedRange` keeps the unfloored attempt. */
interface ComputedForecast {
  basis: PlanEffortForecastBasis;
  range: PlanEffortForecastRange;
  attemptedRange: PlanEffortForecastRange;
  floored: FlooredForecastBasis | undefined;
}

/**
 * Derive the range a basis implies, flooring the likely alone when history ran under one minute per unit.
 *
 * @param computedBasis - matched or fallback rates at published precision
 * @param deriveRange - the rounding owner for that pool; matched predictions keep raw rounding, the fallback keeps its one-minute clamp
 * @returns the basis and range to deliver, the unfloored attempt, and the floor when one applied
 */
function computeForecast(
  computedBasis: PlanEffortForecastBasis,
  deriveRange: (basis: PlanEffortForecastBasis) => PlanEffortForecastRange,
): ComputedForecast {
  const attemptedRange = deriveRange(computedBasis);
  const floored = floorUnallocatableLikely(
    computedBasis,
    attemptedRange.likelyMinutes,
  );
  if (!floored) {
    return {
      basis: computedBasis,
      range: attemptedRange,
      attemptedRange,
      floored,
    };
  }
  return {
    basis: floored.basis,
    range: deriveRange(floored.basis),
    attemptedRange,
    floored,
  };
}

/**
 * Forecast counted work using the accepted matched policy or unchanged fallback.
 *
 * @param target - validated frozen snapshot; each proof execution is one saved unit
 * @param selected - history owner's integrity, compatibility and temporal selection
 * @param fallback - selected-folder numerical method at this same frozen origin
 * @returns delivered values plus the attempted range when integer allocation is impossible
 */
export function forecastPlanWork(
  target: PlanForecastRecord,
  selected: ReturnType<typeof selectPlanForecastHistory>,
  fallback: ReturnType<typeof selectedPlanForecastBasis>,
): WorkForecast {
  const matched =
    selected.selection === "context-matched" && selected.samples.length >= 3;
  const { basis, range, attemptedRange, floored } = computeForecast(
    matched ? matchedBasis(target, selected) : fallback.basis,
    matched ? matchedRange : deriveForecastRangeFromBasis,
  );
  const isCompatible = hasRepresentableAllocation(
    basis,
    range,
    target.items.length,
  );
  return {
    sourceVersion: SOURCE_VERSION,
    selection: matched ? "context-matched" : fallback.selection,
    sampleCount: matched ? selected.samples.length : fallback.samples.length,
    basis: isCompatible ? basis : target.basis,
    range: isCompatible ? range : target.range,
    attemptedRange,
    isCompatible,
    likelyFlooredFrom:
      isCompatible && floored ? floored.computedLikelyMinutesPerUnit : null,
    reason: renderForecastReason(isCompatible, floored, selected.reason),
  };
}

/**
 * Explain a delivered forecast to the author.
 *
 * @param isCompatible - false when the output still cannot fit whole-minute items and the issued values were kept
 * @param floored - the floor applied to the likely; undefined when the computed likely already fitted
 * @param selectionReason - the history owner's reason for the pool it selected
 * @returns the selection reason, extended with the floor when one applied, or the retained-values explanation
 */
function renderForecastReason(
  isCompatible: boolean,
  floored: FlooredForecastBasis | undefined,
  selectionReason: string,
): string {
  if (!isCompatible) {
    return "model output cannot support the positive-integer item allocation and existing basis grammar; retain issued values and investigate sizing";
  }
  return floored
    ? `${selectionReason}; ${renderLikelyFloorNote(floored)}`
    : selectionReason;
}

/** Keep the only prospective replacement on a validated remaining-work cutoff once timing starts. */
function needsRemainingSnapshot(
  record: PlanExportRecord,
  target: PlanForecastRecord,
): boolean {
  return (
    target.scopeKind === "whole" &&
    (record.timingReceipt?.segments.some(
      (segment) => segment.state !== "discarded",
    ) ??
      false)
  );
}

/**
 * Name how far an author can rely on the advice: matched history is experimental, the selected-plan fallback provisional.
 *
 * @param result - delivered forecast; an incompatible result kept the issued values
 * @returns the state label, marked when the likely is the whole-minute floor and not a measured rate
 */
function renderForecastState(result: WorkForecast): string {
  if (!result.isCompatible) return "incompatible; issued values retained";
  const evidence =
    result.selection === "context-matched" ? "experimental" : "provisional";
  return result.likelyFlooredFrom === null
    ? evidence
    : `${evidence}, likely floored`;
}

/** Render one primary advice range; incompatible output retains the saved forecast explicitly. */
function renderWorkForecast(
  record: PlanExportRecord,
  target: PlanForecastRecord,
  result: WorkForecast,
): string[] {
  const range = result.range;
  const rates = result.basis;
  const proofUnits = target.items.filter(
    (item) => item.category === "proof",
  ).length;
  const state = renderForecastState(result);
  const lines = [
    `forecast advice: ${record.sourceFile} - ${range.lowMinutes}-${range.highMinutes} agent-time minutes; likely ${range.likelyMinutes}; ${state}; method ${result.sourceVersion}; pool ${result.selection}; ${result.sampleCount} samples; ${target.workState}/${target.scopeKind}/${target.unitRubric}; origin ${target.id} at ${target.issuedAt}`,
    `forecast basis advice: ${record.sourceFile} - ${target.items.length} units (${proofUnits} proof executions); ${rates.lowMinutesPerUnit.toFixed(2)}-${rates.likelyMinutesPerUnit.toFixed(2)}-${rates.highMinutesPerUnit.toFixed(2)} min/unit; ${result.reason}`,
    `forecast limits: ${record.sourceFile} - p${target.quantiles[0]}/p${target.quantiles[1]} are historical percentiles, not guaranteed future coverage; receipts include recorded foreground verification; planned category splits are not measurements; fast-case proof cost needs comparable receipts and review of required commands and repetitions before work`,
  ];
  if (!result.isCompatible) {
    const attempted = result.attemptedRange;
    lines.push(
      `forecast abstention: ${record.sourceFile} - attempted ${attempted.lowMinutes}-${attempted.highMinutes} minutes; likely ${attempted.likelyMinutes}; no clamp or replacement rates applied`,
    );
  }
  const cutoff = target.receiptCutoff;
  if (cutoff) {
    const measured = cutoff.recordedSeconds / 60;
    lines.push(
      `forecast overview at cutoff: ${record.sourceFile} - ${cutoff.segmentId}, ${cutoff.recordedSeconds}s measured plus remaining ${range.lowMinutes}-${range.highMinutes} minutes; likely total ${(measured + range.likelyMinutes).toFixed(2)} minutes; score only subsequent receipt seconds`,
    );
  }
  lines.push(
    `forecast action: ${record.sourceFile} - preserve ${target.id}; register an appended ${target.scopeKind} revision before its work, with stable item IDs and scope changes; checker is read-only`,
  );
  return lines;
}

/**
 * Render opt-in advice separately from selected-plan descriptive calibration.
 *
 * @param records - selected-folder milestones; legacy and terminal rows get no experimental advice
 * @param history - physically bounded project history, already loaded once
 * @returns source-controlled text scrubbed at the readable output boundary
 */
export function renderForecastModelSummary(
  records: PlanExportRecord[],
  history: PlanForecastHistory,
): string[] {
  const lines: string[] = [];
  for (const record of records) {
    if (
      record.forecastContext?.method !== "contextual-v1" ||
      !["not-started", "in-progress", "testing-gate"].includes(
        record.status.trim().toLowerCase(),
      )
    )
      continue;
    const target = record.forecastContext.document?.records.at(-1);
    if (!target || collectPlanForecastProblems(record).length > 0) continue;
    if (needsRemainingSnapshot(record, target)) {
      lines.push(
        `forecast action: ${record.sourceFile} - work has started; retain issued whole forecast ${target.id} and append a remaining-work snapshot at a closed receipt cutoff before new numerical advice`,
      );
      continue;
    }
    const selected = selectPlanForecastHistory(history, record);
    const forecast = forecastPlanWork(
      target,
      selected,
      selectedPlanForecastBasis(records, target),
    );
    lines.push(...renderWorkForecast(record, target, forecast));
  }
  return lines.map((line) => scrubDurableText(line));
}
