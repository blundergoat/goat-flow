/**
 * Effort-estimate notation parser for goat-plan milestones - the shared grammar
 * behind `plans export` (which carries the fields into bundles) and
 * `plans check` (which audits their arithmetic). Owns the `Effort estimate:`
 * line, counted-work `(est: n min category)` entries, and category sums, so the
 * notation is parsed one way everywhere a user sees it reported.
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

/** Narrow an Actual to the two states that carry numeric minute fields. */
export function isNumericActual(
  actual: PlanEffortActual,
): actual is PlanEffortNumericActual {
  return actual.state === "measured" || actual.state === "retrospective";
}

/**
 * Parsed `Effort estimate:` milestone line in agent-time minutes.
 * Records omit this entirely when a milestone predates effort estimation -
 * legacy plans are valid local state and must stay noise-free.
 */
export interface PlanExportEffort {
  totalMinutes: number;
  split?: PlanEffortSplit;
  actual?: PlanEffortActual;
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
  if (product === undefined) return undefined;
  if (proof === undefined) return undefined;
  if (other === undefined) return undefined;
  const parsedProduct = readSafeMinutes(product);
  const parsedProof = readSafeMinutes(proof);
  const parsedOther = readSafeMinutes(other);
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
function readSafeMinutes(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
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
  if (!match?.[1]) return undefined;
  const totalMinutes = readSafeMinutes(match[1]);
  if (totalMinutes === undefined) return undefined;

  const split = readCapturedSplit(match[2], match[3], match[4]);
  if (match[2] !== undefined && split === undefined) return undefined;

  const parsed: ParsedEffortNumbers = { totalMinutes };
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
  if (actualFieldValue.length === 0) return inlineActual;
  if (inlineActual.length > 0) {
    warnings.push("multiple Actual values supplied");
  }
  return actualFieldValue;
}

/**
 * Parse one task line's trailing est entry into estimate fields.
 * Est-shaped but unreadable text (or a foreign category) warns with a fixed
 * string naming the task position - never user text.
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
  if (estimateMinutes !== undefined && category) {
    return {
      estimateMinutes,
      estimateCategory: category,
    };
  }

  // Est-shaped but unreadable is drifted notation the plan author needs to fix.
  if (TASK_ESTIMATE_SHAPE.test(text)) {
    warnings.push(`${itemLabel} ${taskIndex + 1}: estimate not parseable`);
  }
  return {};
}

/**
 * Parse the dedicated plan/admin estimate field.
 *
 * @param value - field text such as `2 min other`; empty means no declared overhead
 * @param warnings - record warning sink for malformed supplied values
 * @returns estimate fields for category summing; empty means absent or malformed
 */
export function readPlanAdminEstimate(
  value: string,
  warnings: string[],
): TaskEstimateFields {
  if (value.length === 0) return {};
  const match = value.match(PLAN_ADMIN_PATTERN);
  const estimateMinutes = match?.[1] ? readSafeMinutes(match[1]) : undefined;
  if (estimateMinutes === undefined) {
    warnings.push("plan/admin overhead estimate not parseable");
    return {};
  }
  return {
    estimateMinutes,
    estimateCategory: "other",
  };
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
    if (task.estimateCategory) {
      totals[task.estimateCategory] += task.estimateMinutes ?? 0;
    }
  }
  return totals;
}

/**
 * Parse a milestone's `Effort estimate:` field value into agent-time fields.
 * Because a missing line is valid legacy state while a present-but-unreadable
 * one is drifted notation, only the latter warns (fixed string, never user text).
 *
 * @param fieldValue - raw text after the `Effort estimate:` label; empty means the
 *   milestone predates estimation and stays silent
 * @param warnings - record warning sink receiving fixed-string parse warnings
 * @param actualFieldValue - optional structured Actual text; empty means no completed-work comparison is available
 * @returns parsed effort fields; undefined means the line is absent or unusable
 */
export function parseEffortLineValue(
  fieldValue: string,
  warnings: string[],
  actualFieldValue = "",
): PlanExportEffort | undefined {
  // No effort line at all - a legacy milestone, valid and reported nowhere.
  if (fieldValue.length === 0) return undefined;

  // Everything before the first `|` is the estimate; the remainder carries `Actual:`.
  const [estimateText = "", ...actualParts] = fieldValue.split("|");
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
  if (parsedNumbers.split) effort.split = parsedNumbers.split;
  if (actual) effort.actual = actual;
  return effort;
}

/**
 * Parse one machine-readable Actual value while allowing an empty placeholder.
 *
 * @param value - raw Actual field or inline tail
 * @param warnings - warning sink for supplied but unreadable values
 * @returns numeric Actual fields; undefined means absent, placeholder, or malformed
 */
function parseActualValue(
  value: string,
  warnings: string[],
): PlanEffortActual | undefined {
  const normalized = value.trim();
  if (normalized.length === 0) return undefined;
  if (normalized === "_") return undefined;

  const unknownActual = parseUnknownActual(normalized);
  if (unknownActual) return unknownActual;
  const numericActual = parseNumericActual(normalized);
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
  if (!match || !parsedNumbers) return undefined;
  const actual: PlanEffortNumericActual = {
    state: readNumericActualState(explicitMatch),
    totalMinutes: parsedNumbers.totalMinutes,
    reason: match[5]?.trim() ?? "",
  };
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
 * Render one parsed Actual value in the same machine-readable notation milestones use.
 *
 * @param actual - measured effort and optional explanatory reason
 * @returns one standalone `**Actual:**` Markdown line
 */
export function renderActualLine(actual: PlanEffortActual): string {
  if (!isNumericActual(actual)) {
    return `**Actual:** ${actual.state}: ${actual.reason}`;
  }
  const splitText = actual.split
    ? ` (${actual.split.product} product / ${actual.split.proof} proof / ${actual.split.other} other)`
    : "";
  const reasonText = actual.reason ? ` - ${actual.reason}` : "";
  return `**Actual:** ${actual.state}: ~${actual.totalMinutes} min agent-time${splitText}${reasonText}`;
}
