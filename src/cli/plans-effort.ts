/**
 * Effort-estimate notation parser for goat-plan milestones - the shared grammar behind `plans export` (which carries the fields into bundles) and
 * `plans check` (which audits their arithmetic).
 * Owns the `Effort estimate:` line, countable `Forecast basis:`, forecast range, counted-work `(est: n min category)` entries, and category sums.
 *
 * This keeps the numbers a plan author reviews consistent across checks and portable exports.
 */

/** Effort category vocabulary from goat-plan's estimation notation. */
type PlanEffortCategory = "product" | "proof" | "other";

/** Minutes-per-category totals used by milestone effort lines and counted-work sums. */
export interface PlanEffortSplit {
  product: number;
  proof: number;
  other: number;
}

/** Numeric Actuals are either receipt-backed measurements or explicit estimates after the fact. */
export interface PlanEffortNumericActual {
  state: "measured" | "retrospective";
  totalMinutes: number;
  split?: PlanEffortSplit;
  reason: string;
}

/** Honest no-number states avoid manufacturing precision when timing is absent or interrupted. */
interface PlanEffortUnknownActual {
  state: "unavailable" | "incomplete";
  reason: string;
}

/** Machine-readable effort captured or disclosed after a milestone finishes. */
export type PlanEffortActual =
  PlanEffortNumericActual | PlanEffortUnknownActual;

/**
 * Narrow an Actual to the two states that carry numeric minute fields.
 *
 * @param actual - The recorded Actual to test, in any of its states.
 * @returns True when `actual` is measured or retrospective, so callers may read its minute fields.
 */
export function isNumericActual(
  actual: PlanEffortActual,
): actual is PlanEffortNumericActual {
  return actual.state === "measured" || actual.state === "retrospective";
}

/**
 * Optional `Forecast range:` uncertainty band for a milestone estimate.
 *
 * Every value is recorded-unpaused coding-agent minutes on one active milestone timeline - the same unit as the headline - so `likelyMinutes` must
 * equal the headline total.
 * The band is optional by contract: legacy and in-flight point-estimate plans stay valid without it, so absence is never an error.
 *
 * Human waiting is excluded, matching the Actual it will later be compared to.
 */
export interface PlanEffortForecastRange {
  lowMinutes: number;
  likelyMinutes: number;
  highMinutes: number;
  rationale?: string;
}

/**
 * Countable inputs behind a milestone forecast.
 * Users can review the work-unit count, per-unit rates, and evidence source instead of trusting an unexplained duration estimate.
 */
export interface PlanEffortForecastBasis {
  agentWorkUnits: number;
  lowMinutesPerUnit: number;
  likelyMinutesPerUnit: number;
  highMinutesPerUnit: number;
  source: string;
}

/**
 * Parsed `Effort estimate:` milestone line in agent-time minutes.
 * Records omit this entirely when a milestone predates effort estimation - legacy plans are valid local state and must stay noise-free.
 */
export interface PlanExportEffort {
  totalMinutes: number;
  split?: PlanEffortSplit;
  actual?: PlanEffortActual;
  forecastBasis?: PlanEffortForecastBasis;
  forecastRange?: PlanEffortForecastRange;
}

/** Optional estimate fields a work item gains when it carries an `(est: ...)` entry. */
export interface TaskEstimateFields {
  estimateMinutes?: number;
  estimateCategory?: PlanEffortCategory;
}

/** Well-formed task est entry: `(est: 8 min product)` at the end of a task line. */
const TASK_ESTIMATE_PATTERN =
  /\(est:\s*(\d+)\s*min(?:ute)?s?\s+([a-z]+)\)\s*$/iu;

/** Anything est-shaped at a task's end, used to warn on drifted notation. */
const TASK_ESTIMATE_SHAPE = /\(est:[^)]*\)\s*$/iu;

/** Copy-ready task estimate shape shown when an author supplies unreadable notation. */
const TASK_ESTIMATE_GRAMMAR = "(est: <minutes> min <product|proof|other>)";

/** Complete effort-line grammar, including an optional category split. */
const EFFORT_ESTIMATE_PATTERN =
  /^\s*~?\s*(\d+)\s*min(?:ute)?s?(?:\s+agent-time)?(?:\s*\((\d+)\s+product\s*\/\s*(\d+)\s+proof\s*\/\s*(\d+)\s+other\))?\s*$/iu;

/** Numeric Actual shape with optional category split and explanatory reason. */
const ACTUAL_PATTERN =
  /^\s*~?\s*(\d+)\s*min(?:ute)?s?(?:\s+agent-time)?(?:\s*\((\d+)\s+product\s*\/\s*(\d+)\s+proof\s*\/\s*(\d+)\s+other\))?(?:\s*[-—]\s*(.+))?\s*$/iu;

/** Explicit provenance marker preceding a numeric Actual. */
const ACTUAL_NUMERIC_STATE_PATTERN = /^\s*(measured|retrospective):\s*(.+)$/iu;

/** Honest states that intentionally carry no invented minute value. */
const ACTUAL_UNKNOWN_STATE_PATTERN = /^\s*(unavailable|incomplete):\s*(.+)$/iu;

/** Dedicated non-checkbox estimate for orientation, plan upkeep, and status work. */
const PLAN_ADMIN_PATTERN = /^\s*(\d+)\s*min(?:ute)?s?\s+other\s*$/iu;

/** Copy-ready plan/admin shape shown when an author supplies unreadable overhead. */
const PLAN_ADMIN_GRAMMAR = "<minutes> min other";

/**
 * Optional forecast band, unit phrase included so the range can never be read
 * in different units from the headline it must agree with.
 */
const FORECAST_RANGE_PATTERN =
  /^\s*(\d+)\s*-\s*(\d+)\s+agent-time minutes on one recorded-unpaused milestone timeline;\s*likely\s+(\d+)\s*(?:;\s*(.+))?$/iu;

/** Canonical forecast-range shape shown directly in a parse error. */
const FORECAST_RANGE_GRAMMAR =
  "<low>-<high> agent-time minutes on one recorded-unpaused milestone timeline; likely <minutes>[; <rationale>]";

/** Countable forecast inputs with decimal minute-per-unit rates and visible provenance. */
const FORECAST_BASIS_PATTERN =
  /^\s*(\d+)\s+agent work units;\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s+min\/unit low-likely-high;\s*source:\s*(\S(?:.*\S)?)\s*$/iu;

/** Canonical forecast-basis shape shown directly in a parse error. */
const FORECAST_BASIS_GRAMMAR =
  "<units> agent work units; <low>-<likely>-<high> min/unit low-likely-high; source: <source>";

/** A `[HUMAN]` prefix keeps approval time outside coding-agent forecasts. */
const HUMAN_ONLY_WORK_PATTERN = /^\s*\[human\](?:\s|$)/iu;

/**
 * Build a parse warning that tells a plan author both how to fix the field and what the checker received.
 * JSON string encoding keeps pasted control characters visible as escaped text instead of executing them in the user's terminal.
 */
function formatActionableParseWarning(
  fieldLabel: string,
  expectedGrammar: string,
  receivedValue: string,
): string {
  return `${fieldLabel} not parseable; expected ${JSON.stringify(expectedGrammar)}; received ${JSON.stringify(receivedValue.trim())}`;
}

/**
 * Narrow a regex-captured category word to the effort vocabulary without casting.
 *
 * @param word - captured category text from a task est entry
 * @returns the matching category; undefined means a foreign word the caller warns about
 */
function normalizeEstimateCategory(
  word: string,
): PlanEffortCategory | undefined {
  const lowered = word.toLowerCase();

  // Foreign words (e.g. `docs`) fall out as undefined so the caller warns instead of guessing.
  return lowered === "product" || lowered === "proof" || lowered === "other"
    ? lowered
    : undefined;
}

/** Convert three optional regex captures into one complete effort split. */
function readCapturedSplit(
  product: string | undefined,
  proof: string | undefined,
  other: string | undefined,
): PlanEffortSplit | undefined {
  // Without product minutes, the user did not provide a complete category split.
  if (product === undefined) return undefined;
  // Without proof minutes, the user did not provide a complete category split.
  if (proof === undefined) return undefined;
  // Without other minutes, the user did not provide a complete category split.
  if (other === undefined) return undefined;
  const parsedProduct = readSafeMinutes(product);
  const parsedProof = readSafeMinutes(proof);
  const parsedOther = readSafeMinutes(other);
  // Any unsafe category value makes the displayed split unreliable as a whole.
  if (
    parsedProduct === undefined ||
    parsedProof === undefined ||
    parsedOther === undefined
  ) {
    return undefined;
  }
  return { product: parsedProduct, proof: parsedProof, other: parsedOther };
}

/** Parse decimal minute text without admitting precision-losing integers. */
function readSafeMinutes(minutesText: string): number | undefined {
  const parsed = Number(minutesText);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

/** Parse a positive decimal rate without accepting infinity or unsafe magnitudes. */
function readSafePositiveRate(
  minutesText: string | undefined,
): number | undefined {
  // Missing rate text means the user did not supply the full low-likely-high basis.
  if (minutesText === undefined) return undefined;
  const parsedRate = Number(minutesText);
  return Number.isFinite(parsedRate) && parsedRate > 0 ? parsedRate : undefined;
}

/** Numeric fields shared by estimate and Actual declarations. */
interface ParsedEffortNumbers {
  totalMinutes: number;
  split?: PlanEffortSplit;
}

/** Parse the shared total-and-optional-split captures without precision loss. */
function readEffortNumbers(
  match: RegExpMatchArray | null,
): ParsedEffortNumbers | undefined {
  // A missing headline capture means the user's effort text did not match the accepted shape.
  if (!match?.[1]) return undefined;
  const totalMinutes = readSafeMinutes(match[1]);
  // Unsafe headline minutes cannot become arithmetic authority in checks or exports.
  if (totalMinutes === undefined) return undefined;

  const split = readCapturedSplit(match[2], match[3], match[4]);
  // If the user started a split, every category must parse before the headline is usable.
  if (match[2] !== undefined && split === undefined) return undefined;

  const parsed: ParsedEffortNumbers = { totalMinutes };
  // A headline-only legacy estimate stays valid, while a supplied split travels with it.
  if (split) parsed.split = split;
  return parsed;
}

/** Extract the legacy inline Actual tail from an effort line. */
function readInlineActual(actualParts: string[]): string {
  return actualParts
    .join("|")
    .replace(/^\s*\*{0,2}Actual:\*{0,2}\s*/iu, "")
    .trim();
}

/** Prefer the standalone Actual field and warn when both supported shapes appear. */
function selectActualText(
  actualFieldValue: string,
  inlineActual: string,
  warnings: string[],
): string {
  // Without a standalone field, the user's legacy inline Actual remains the selected value.
  if (actualFieldValue.length === 0) return inlineActual;
  // Two visible Actual representations are ambiguous, even when their text happens to match.
  if (inlineActual.length > 0) {
    warnings.push("multiple Actual values supplied");
  }
  return actualFieldValue;
}

/**
 * Parse one task line's trailing est entry into estimate fields.
 * Est-shaped but unreadable text (or a foreign category) warns with a fixed string naming the task position - never user text.
 *
 * @param text - full task text after the checkbox
 * @param taskIndex - zero-based task position used in warning labels
 * @param warnings - record warning sink for malformed est entries
 * @param itemLabel - stable source label such as task or testing gate item
 * @returns estimate fields to spread onto the task; empty means the task has no usable entry
 */
export function readTaskEstimate(
  text: string,
  taskIndex: number,
  warnings: string[],
  itemLabel = "task",
): TaskEstimateFields {
  const estimateMatch = text.match(TASK_ESTIMATE_PATTERN);
  const category = estimateMatch?.[2]
    ? normalizeEstimateCategory(estimateMatch[2])
    : undefined;

  // A well-formed entry gives the task the minutes and category later sums rely on.
  const estimateMinutes = estimateMatch?.[1]
    ? readSafeMinutes(estimateMatch[1])
    : undefined;
  // A complete estimate gives the user's task both minutes and a category for later reconciliation.
  if (estimateMinutes !== undefined && category) {
    return {
      estimateMinutes,
      estimateCategory: category,
    };
  }

  const receivedEstimate = text.match(TASK_ESTIMATE_SHAPE)?.[0];
  // Est-shaped but unreadable text gives the author its accepted shape and the exact safe value to replace.
  if (receivedEstimate !== undefined) {
    warnings.push(
      formatActionableParseWarning(
        `${itemLabel} ${taskIndex + 1}: estimate`,
        TASK_ESTIMATE_GRAMMAR,
        receivedEstimate,
      ),
    );
  }
  return {};
}

/**
 * Parse the dedicated plan/admin estimate field.
 *
 * @param estimateText - field text such as `2 min other`; empty means no declared overhead
 * @param warnings - record warning sink for malformed supplied values
 * @returns estimate fields for category summing; empty means absent or malformed
 */
export function readPlanAdminEstimate(
  estimateText: string,
  warnings: string[],
): TaskEstimateFields {
  // No overhead field means the author intentionally declared no separate plan/admin estimate.
  if (estimateText.length === 0) return {};
  const match = estimateText.match(PLAN_ADMIN_PATTERN);
  const estimateMinutes = match?.[1] ? readSafeMinutes(match[1]) : undefined;
  // An unreadable supplied value needs a copy-ready shape and the exact safe text the author should replace.
  if (estimateMinutes === undefined) {
    warnings.push(
      formatActionableParseWarning(
        "plan/admin overhead estimate",
        PLAN_ADMIN_GRAMMAR,
        estimateText,
      ),
    );
    return {};
  }
  return {
    estimateMinutes,
    estimateCategory: "other",
  };
}

/**
 * Convert the three required band captures into minutes without precision loss.
 *
 * @param match - a `FORECAST_RANGE_PATTERN` result, or null when the text drifted
 * @returns the three bounds; undefined means the band cannot be trusted as numbers
 */
function readRangeMinutes(
  match: RegExpMatchArray | null,
): Omit<PlanEffortForecastRange, "rationale"> | undefined {
  const lowMinutes = readOptionalMinutes(match?.[1]);
  const highMinutes = readOptionalMinutes(match?.[2]);
  const likelyMinutes = readOptionalMinutes(match?.[3]);
  // All three bounds must be safe numbers before the user can rely on the displayed band.
  if (
    lowMinutes === undefined ||
    highMinutes === undefined ||
    likelyMinutes === undefined
  ) {
    return undefined;
  }
  return { lowMinutes, likelyMinutes, highMinutes };
}

/** Read one optional numeric capture, treating absence and unsafe values alike. */
function readOptionalMinutes(capture: string | undefined): number | undefined {
  return capture === undefined ? undefined : readSafeMinutes(capture);
}

/**
 * Parse the optional forecast band users see beside a milestone estimate.
 * Missing text preserves legacy point estimates; malformed text emits a fixed warning.
 * `plans check` owns ordering and headline agreement after parsing.
 * @param rangeText - raw text after the `Forecast range:` label; empty means absent
 * @param warnings - record warning sink receiving the fixed-string parse warning
 * @returns the parsed band; undefined means absent or unreadable
 */
function parseForecastRangeValue(
  rangeText: string,
  warnings: string[],
): PlanEffortForecastRange | undefined {
  const normalized = rangeText.trim();

  // No band at all - the common case for legacy and point-estimate milestones.
  if (normalized.length === 0) return undefined;

  const match = normalized.match(FORECAST_RANGE_PATTERN);
  const bounds = readRangeMinutes(match);
  // A supplied but unreadable band cannot support the duration shown to the user.
  if (!bounds) {
    warnings.push(
      formatActionableParseWarning(
        "forecast range",
        FORECAST_RANGE_GRAMMAR,
        normalized,
      ),
    );
    return undefined;
  }

  const range: PlanEffortForecastRange = { ...bounds };
  const rationale = match?.[4]?.trim();
  // Optional rationale is preserved only when the user supplied visible text.
  if (rationale) range.rationale = rationale;
  return range;
}

/** Values captured from user-authored forecast text before completeness is proven. */
interface ForecastBasisCandidate {
  agentWorkUnits: number | undefined;
  lowMinutesPerUnit: number | undefined;
  likelyMinutesPerUnit: number | undefined;
  highMinutesPerUnit: number | undefined;
  source: string | undefined;
}

/**
 * Confirm that a candidate contains every value users need to audit a forecast.
 * Use before exports or checks treat user-authored basis text as trusted plan data.
 * @param candidate - parsed fields; undefined or zero values mean the text was incomplete
 * @returns true when every numeric value is positive and the source is non-empty
 */
function hasCompleteForecastBasis(
  candidate: ForecastBasisCandidate,
): candidate is PlanEffortForecastBasis {
  return (
    candidate.agentWorkUnits !== undefined &&
    candidate.agentWorkUnits > 0 &&
    candidate.lowMinutesPerUnit !== undefined &&
    candidate.likelyMinutesPerUnit !== undefined &&
    candidate.highMinutesPerUnit !== undefined &&
    candidate.source !== undefined &&
    candidate.source.length > 0
  );
}

/**
 * Parse the countable units and evidence source behind an optional forecast.
 * @param basisText - text after `Forecast basis:`; empty means a legacy or point estimate
 * @param warnings - fixed warning sink; empty stays unchanged for users
 * @returns parsed basis; undefined means the field is absent or cannot be reviewed safely
 */
function parseForecastBasisValue(
  basisText: string,
  warnings: string[],
): PlanEffortForecastBasis | undefined {
  const normalizedBasis = basisText.trim();
  // No basis is valid compatibility state for plans written before work-unit forecasting.
  if (normalizedBasis.length === 0) return undefined;

  const basisMatch = normalizedBasis.match(FORECAST_BASIS_PATTERN);
  const forecastBasisCandidate: ForecastBasisCandidate = {
    agentWorkUnits: basisMatch?.[1]
      ? readSafeMinutes(basisMatch[1])
      : undefined,
    lowMinutesPerUnit: readSafePositiveRate(basisMatch?.[2]),
    likelyMinutesPerUnit: readSafePositiveRate(basisMatch?.[3]),
    highMinutesPerUnit: readSafePositiveRate(basisMatch?.[4]),
    source: basisMatch?.[5]?.trim(),
  };

  // A partial or zero-unit basis cannot explain the duration shown to the user.
  if (!hasCompleteForecastBasis(forecastBasisCandidate)) {
    warnings.push(
      formatActionableParseWarning(
        "forecast basis",
        FORECAST_BASIS_GRAMMAR,
        normalizedBasis,
      ),
    );
    return undefined;
  }

  return forecastBasisCandidate;
}

/** Candidate estimate that may count as one coding-agent work unit. */
interface AgentWorkUnitCandidate extends TaskEstimateFields {
  text?: string;
}

/**
 * Count positive-time agent-owned checklist and plan/admin items.
 *
 * @param workItems - estimate-bearing items; empty means the plan declares zero agent units
 * @returns countable agent work units; `[HUMAN]` and zero-minute items contribute zero
 */
export function countAgentWorkUnits(
  workItems: readonly AgentWorkUnitCandidate[],
): number {
  // Evaluate every visible checklist/admin item once so the displayed count is reproducible.
  return workItems.filter((workItem) => {
    // Missing minutes are unestimated from the user's view, so they cannot become forecast units.
    const estimatedAgentMinutes = workItem.estimateMinutes ?? 0;
    const hasPositiveAgentTime = estimatedAgentMinutes > 0;
    // Plan/admin has no checkbox text; only an explicit `[HUMAN]` label removes a timed item.
    const visibleWorkItemText = workItem.text ?? "";
    const isHumanOnly = HUMAN_ONLY_WORK_PATTERN.test(visibleWorkItemText);
    return hasPositiveAgentTime && !isHumanOnly;
  }).length;
}

/**
 * Convert one work-unit basis into the whole-minute range shown in a plan.
 *
 * @param basis - positive unit count and rates; absent is handled before calling
 * @returns outward-rounded low/high minutes and nearest-minute likely duration
 */
export function deriveForecastRangeFromBasis(
  basis: PlanEffortForecastBasis,
): Omit<PlanEffortForecastRange, "rationale"> {
  const lowMinutes = Math.max(
    1,
    Math.floor(basis.agentWorkUnits * basis.lowMinutesPerUnit),
  );
  const likelyMinutes = Math.max(
    1,
    Math.round(basis.agentWorkUnits * basis.likelyMinutesPerUnit),
  );
  const highMinutes = Math.max(
    1,
    Math.ceil(basis.agentWorkUnits * basis.highMinutesPerUnit),
  );
  return { lowMinutes, likelyMinutes, highMinutes };
}

/**
 * Validate that a countable basis still matches plan scope and its displayed range.
 *
 * @param forecastBasis - parsed units and rates the user supplied
 * @param forecastRange - displayed output; undefined means the user omitted the derived range
 * @param countedAgentWorkUnits - current positive agent-owned items; zero means no agent work remains declared
 * @returns plain user-facing problems; empty means the basis and displayed range agree
 */
export function validateForecastBasis(
  forecastBasis: PlanEffortForecastBasis,
  forecastRange: PlanEffortForecastRange | undefined,
  countedAgentWorkUnits: number,
): string[] {
  const validationProblems: string[] = [];

  // A scope edit changes the checklist count, so the old duration no longer represents the plan.
  if (forecastBasis.agentWorkUnits !== countedAgentWorkUnits) {
    validationProblems.push(
      `forecast basis declares ${forecastBasis.agentWorkUnits} agent work units but the plan contains ${countedAgentWorkUnits}`,
    );
  }

  // Ordered per-unit rates give the user a real low-likely-high uncertainty band.
  if (
    forecastBasis.lowMinutesPerUnit > forecastBasis.likelyMinutesPerUnit ||
    forecastBasis.likelyMinutesPerUnit > forecastBasis.highMinutesPerUnit
  ) {
    validationProblems.push(
      "forecast basis must satisfy low <= likely <= high minutes per unit",
    );
  }

  // A basis without its visible output leaves the user unable to review the duration.
  if (!forecastRange) {
    validationProblems.push("Forecast basis requires a derived Forecast range");
    return validationProblems;
  }

  const derivedRange = deriveForecastRangeFromBasis(forecastBasis);
  // Changed units or rates must flow through to all three displayed forecast values.
  if (
    derivedRange.lowMinutes !== forecastRange.lowMinutes ||
    derivedRange.likelyMinutes !== forecastRange.likelyMinutes ||
    derivedRange.highMinutes !== forecastRange.highMinutes
  ) {
    validationProblems.push(
      `forecast basis derives ${derivedRange.lowMinutes}-${derivedRange.highMinutes} agent-time minutes; likely ${derivedRange.likelyMinutes}, but Forecast range says ${forecastRange.lowMinutes}-${forecastRange.highMinutes}; likely ${forecastRange.likelyMinutes}`,
    );
  }
  return validationProblems;
}

/**
 * Sum parsed work estimates by category for downstream arithmetic checking.
 *
 * @param tasks - work items that may carry estimate fields
 * @returns per-category totals; undefined means no item carries an estimate, so
 *   legacy exports gain no noise
 */
export function sumTaskEstimates(
  tasks: readonly TaskEstimateFields[],
): PlanEffortSplit | undefined {
  // Only tasks that parsed an est entry can take part in arithmetic checks.
  const estimatedTasks = tasks.filter(
    (task) => task.estimateMinutes !== undefined,
  );

  // No estimates at all - the field stays absent so legacy exports gain no noise.
  if (estimatedTasks.length === 0) return undefined;

  const totals: PlanEffortSplit = { product: 0, proof: 0, other: 0 };

  // Accumulate minutes under each task's declared category.
  for (const task of estimatedTasks) {
    // Only a parsed category can receive the task's minutes; malformed categories already produced a warning.
    if (task.estimateCategory) {
      totals[task.estimateCategory] += task.estimateMinutes ?? 0;
    }
  }
  return totals;
}

/**
 * Parse a milestone's `Effort estimate:` field value into agent-time fields.
 * Because a missing line is valid legacy state while a present-but-unreadable one is drifted notation, only the latter warns (fixed string, never
 * user text).
 *
 * @param fieldValue - raw text after the `Effort estimate:` label; empty means the
 *   milestone predates estimation and stays silent
 * @param warnings - record warning sink receiving fixed-string parse warnings
 * @param actualFieldValue - optional structured Actual text; empty means no completed-work comparison is available
 * @param forecastRangeFieldValue - optional `Forecast range:` text; empty means the milestone forecasts one point
 * @param forecastBasisFieldValue - optional countable forecast inputs; empty preserves legacy plans
 * @returns parsed effort fields; undefined means the line is absent or unusable
 */
export function parseEffortLineValue(
  fieldValue: string,
  warnings: string[],
  actualFieldValue = "",
  forecastRangeFieldValue = "",
  forecastBasisFieldValue = "",
): PlanExportEffort | undefined {
  // Parse the basis first so malformed user input warns even when the effort headline is absent.
  const forecastBasis = parseForecastBasisValue(
    forecastBasisFieldValue,
    warnings,
  );

  // Parse the band first so drifted range notation still warns on a legacy milestone.
  const forecastRange = parseForecastRangeValue(
    forecastRangeFieldValue,
    warnings,
  );

  // No effort line at all - a legacy milestone, valid and reported nowhere.
  if (fieldValue.length === 0) return undefined;

  // Everything before the first `|` is the estimate; the remainder carries `Actual:`.
  // Splitting non-empty plan text always gives the user-visible estimate as its first item.
  const effortLineParts = fieldValue.split("|") as [string, ...string[]];
  const [estimateText, ...actualParts] = effortLineParts;
  const parsedNumbers = readEffortNumbers(
    estimateText.match(EFFORT_ESTIMATE_PATTERN),
  );

  // Present-but-unreadable means drifted notation, not a legacy file.
  if (!parsedNumbers) {
    warnings.push("effort estimate not parseable");
    return undefined;
  }

  // A headline without a split parses fine; `plans check` decides what its absence means.
  const inlineActual = readInlineActual(actualParts);
  const actual = parseActualValue(
    selectActualText(actualFieldValue, inlineActual, warnings),
    warnings,
  );
  const effort: PlanExportEffort = {
    totalMinutes: parsedNumbers.totalMinutes,
  };
  // A missing split keeps headline-only legacy estimates intact for export users.
  if (parsedNumbers.split) effort.split = parsedNumbers.split;
  // Before work finishes, no Actual is expected in the milestone users review.
  if (actual) effort.actual = actual;
  // Plans written before countable forecasting keep this field absent without migration noise.
  if (forecastBasis) effort.forecastBasis = forecastBasis;
  // A point estimate intentionally has no range, so exports omit the field rather than inventing one.
  if (forecastRange) effort.forecastRange = forecastRange;
  return effort;
}

/**
 * Parse one machine-readable Actual value while allowing an empty placeholder.
 *
 * @param actualText - raw Actual field or inline tail
 * @param warnings - warning sink for supplied but unreadable values
 * @returns numeric Actual fields; undefined means absent, placeholder, or malformed
 */
function parseActualValue(
  actualText: string,
  warnings: string[],
): PlanEffortActual | undefined {
  const normalized = actualText.trim();
  // An empty field means completed-work evidence is not available yet.
  if (normalized.length === 0) return undefined;
  // The milestone template's underscore is an explicit placeholder, not an Actual value.
  if (normalized === "_") return undefined;

  const unknownActual = parseUnknownActual(normalized);
  // An honest no-number state is complete as soon as its reason parses.
  if (unknownActual) return unknownActual;
  const numericActual = parseNumericActual(normalized);
  // A valid measured or retrospective value can now feed reconciliation and reporting.
  if (numericActual) return numericActual;
  warnings.push("actual effort not parseable");
  return undefined;
}

/** Parse an explicit honest state that intentionally carries no minute value. */
function parseUnknownActual(
  normalized: string,
): PlanEffortUnknownActual | undefined {
  const unknownMatch = normalized.match(ACTUAL_UNKNOWN_STATE_PATTERN);
  const state = unknownMatch?.[1]?.toLowerCase();
  const reason = unknownMatch?.[2]?.trim();
  // Missing state or reason means the user has not supplied an actionable honest no-number declaration.
  if (!state || !reason) return undefined;
  return {
    state: state === "unavailable" ? "unavailable" : "incomplete",
    reason,
  };
}

/** Parse an explicit numeric state or classify untagged legacy notation retrospectively. */
function parseNumericActual(
  normalized: string,
): PlanEffortNumericActual | undefined {
  const explicitMatch = normalized.match(ACTUAL_NUMERIC_STATE_PATTERN);
  const numericText = readNumericActualText(explicitMatch, normalized);
  const match = numericText.match(ACTUAL_PATTERN);
  const parsedNumbers = readEffortNumbers(match);
  // A numeric Actual is unusable unless both its outer shape and safe minute values parse.
  if (!match || !parsedNumbers) return undefined;
  const actual: PlanEffortNumericActual = {
    state: readNumericActualState(explicitMatch),
    totalMinutes: parsedNumbers.totalMinutes,
    reason: match[5]?.trim() ?? "",
  };
  // A supplied category split travels with the Actual so strict checks can reconcile it.
  if (parsedNumbers.split) actual.split = parsedNumbers.split;
  return actual;
}

/** Return the numeric portion after an optional explicit state marker. */
function readNumericActualText(
  explicitMatch: RegExpMatchArray | null,
  normalized: string,
): string {
  return explicitMatch?.[2] ?? normalized;
}

/** Untagged numeric Actuals are retrospective by compatibility contract. */
function readNumericActualState(
  explicitMatch: RegExpMatchArray | null,
): "measured" | "retrospective" {
  return explicitMatch?.[1]?.toLowerCase() === "measured"
    ? "measured"
    : "retrospective";
}

/**
 * Render one parsed effort object back into milestone-line notation.
 *
 * @param effort - parsed milestone effort fields
 * @returns one `**Effort estimate:**` Markdown line for issue bodies
 */
export function renderEffortLine(effort: PlanExportEffort): string {
  // Echo the split in the notation the author wrote, only when one was declared.
  const splitText = effort.split
    ? ` (${effort.split.product} product / ${effort.split.proof} proof / ${effort.split.other} other)`
    : "";

  return `**Effort estimate:** ~${effort.totalMinutes} min agent-time${splitText}`;
}

/**
 * Render one parsed forecast band back into the notation authors write.
 *
 * Exports rebuild known fields rather than copying source lines, so a band that
 * cannot round-trip through here would be silently dropped from every export.
 *
 * @param range - parsed low, likely, high minutes and optional rationale
 * @returns one standalone `**Forecast range:**` Markdown line
 */
export function renderForecastRangeLine(
  range: PlanEffortForecastRange,
): string {
  // The rationale is free text the author supplied; absence is normal, not a gap.
  const rationaleText = range.rationale ? `; ${range.rationale}` : "";

  return `**Forecast range:** ${range.lowMinutes}-${range.highMinutes} agent-time minutes on one recorded-unpaused milestone timeline; likely ${range.likelyMinutes}${rationaleText}`;
}

/**
 * Render the work-unit inputs users can review beside a forecast range.
 *
 * @param basis - parsed count, per-unit rates, and provenance; source must be non-empty
 * @returns one standalone `**Forecast basis:**` Markdown line
 */
export function renderForecastBasisLine(
  basis: PlanEffortForecastBasis,
): string {
  return `**Forecast basis:** ${basis.agentWorkUnits} agent work units; ${basis.lowMinutesPerUnit}-${basis.likelyMinutesPerUnit}-${basis.highMinutesPerUnit} min/unit low-likely-high; source: ${basis.source}`;
}

/**
 * Render one parsed Actual value in the same machine-readable notation milestones use.
 *
 * @param actual - measured effort and optional explanatory reason
 * @returns one standalone `**Actual:**` Markdown line
 */
export function renderActualLine(actual: PlanEffortActual): string {
  // Honest no-number states render their reason directly because they have no minute fields.
  if (!isNumericActual(actual)) {
    return `**Actual:** ${actual.state}: ${actual.reason}`;
  }
  const splitText = actual.split
    ? ` (${actual.split.product} product / ${actual.split.proof} proof / ${actual.split.other} other)`
    : "";
  const reasonText = actual.reason ? ` - ${actual.reason}` : "";
  return `**Actual:** ${actual.state}: ~${actual.totalMinutes} min agent-time${splitText}${reasonText}`;
}
