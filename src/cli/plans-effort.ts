/**
 * Effort-estimate notation parser for goat-plan milestones - the shared grammar
 * behind `plans export` (which carries the fields into bundles) and
 * `plans check` (which audits their arithmetic). Owns the `Effort estimate:`
 * line, counted-work `(est: n min category)` entries, and category sums, so the
 * notation is parsed one way everywhere a user sees it reported.
 */

/** Effort category vocabulary from goat-plan's estimation notation. */
export type PlanEffortCategory = "product" | "proof" | "other";

/** Minutes-per-category totals used by milestone effort lines and counted-work sums. */
export interface PlanEffortSplit {
  product: number;
  proof: number;
  other: number;
}

/** Machine-readable effort captured after a milestone finishes. */
export interface PlanEffortActual {
  totalMinutes: number;
  split?: PlanEffortSplit;
  reason: string;
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

/** Headline shape of an effort line: `~25 min agent-time (...)`. */
const EFFORT_TOTAL_PATTERN = /^\s*~?\s*(\d+)\s*min(?:ute)?s?\b/iu;

/** Split shape inside an effort line: `(18 product / 5 proof / 2 other)`. */
const EFFORT_SPLIT_PATTERN =
  /\((\d+)\s+product\s*\/\s*(\d+)\s+proof\s*\/\s*(\d+)\s+other\)/iu;

/** Structured Actual shape with optional category split and explanatory reason. */
const ACTUAL_PATTERN =
  /^\s*~?\s*(\d+)\s*min(?:ute)?s?(?:\s+agent-time)?(?:\s*\((\d+)\s+product\s*\/\s*(\d+)\s+proof\s*\/\s*(\d+)\s+other\))?(?:\s*[-—]\s*(.+))?\s*$/iu;

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
  if (estimateMatch?.[1] && category) {
    return {
      estimateMinutes: Number(estimateMatch[1]),
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
  if (!match?.[1]) {
    warnings.push("plan/admin overhead estimate not parseable");
    return {};
  }
  return {
    estimateMinutes: Number(match[1]),
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
  const totalMatch = estimateText.match(EFFORT_TOTAL_PATTERN);

  // Present-but-unreadable means drifted notation, not a legacy file.
  if (!totalMatch?.[1]) {
    warnings.push("effort estimate not parseable");
    return undefined;
  }

  // A headline without a split parses fine; `plans check` decides what its absence means.
  const splitMatch = estimateText.match(EFFORT_SPLIT_PATTERN);
  const split =
    splitMatch?.[1] && splitMatch[2] && splitMatch[3]
      ? {
          product: Number(splitMatch[1]),
          proof: Number(splitMatch[2]),
          other: Number(splitMatch[3]),
        }
      : undefined;
  const inlineActual = actualParts
    .join("|")
    .replace(/^\s*\*{0,2}Actual:\*{0,2}\s*/iu, "")
    .trim();
  if (actualFieldValue.length > 0 && inlineActual.length > 0) {
    warnings.push("multiple Actual values supplied");
  }
  const actualText = actualFieldValue || inlineActual;
  const actual = parseActualValue(actualText, warnings);

  return {
    totalMinutes: Number(totalMatch[1]),
    ...(split && { split }),
    ...(actual && { actual }),
  };
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
  if (normalized.length === 0 || normalized === "_") return undefined;

  const match = normalized.match(ACTUAL_PATTERN);
  if (!match?.[1]) {
    warnings.push("actual effort not parseable");
    return undefined;
  }
  const split =
    match[2] && match[3] && match[4]
      ? {
          product: Number(match[2]),
          proof: Number(match[3]),
          other: Number(match[4]),
        }
      : undefined;
  return {
    totalMinutes: Number(match[1]),
    ...(split && { split }),
    reason: match[5]?.trim() ?? "",
  };
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
  const splitText = actual.split
    ? ` (${actual.split.product} product / ${actual.split.proof} proof / ${actual.split.other} other)`
    : "";
  const reasonText = actual.reason ? ` - ${actual.reason}` : "";
  return `**Actual:** ~${actual.totalMinutes} min agent-time${splitText}${reasonText}`;
}
