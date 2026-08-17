/**
 * The building blocks for reading an agent-written quality report safely.
 *
 * A saved report is JSON an agent produced, so every field arrives as `unknown` and could be missing, the wrong type, or a value outside the accepted
 * set.
 * These helpers turn each expectation into either a typed value or a precise error naming the field.
 *
 * The style is deliberately uniform: one helper per expectation, each reporting the field path rather than throwing.
 * A malformed report should tell its author exactly which key is wrong - a stack trace would just tell them the tool broke, and they would have no
 * way to fix it.
 */
import { QUALITY_SCORE_VALUES } from "./schema-types.js";
import type { QualityAxisScore } from "./schema-types.js";

/**
 * Decide whether parsed JSON can be read as a named-field report object.
 * Use before field validation so malformed agent output becomes one clear user-facing error.
 *
 * @param candidate - value from JSON parsing; `null`, arrays, or primitives mean there is no report object to show
 * @returns whether the value has named fields; `false` means validation stops before reading report keys
 */
export function isRecord(
  candidate: unknown,
): candidate is Record<string, unknown> {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    !Array.isArray(candidate)
  );
}

/**
 * Find unsupported keys in one report object.
 * Use when validating agent output so extra fields do not silently appear in saved quality history.
 *
 * @param reportObject - object to inspect; an empty object has no unknown keys but may fail required fields later
 * @param allowedKeys - keys the UI and history readers understand; empty means no keys are accepted
 * @param path - schema path shown in the error; empty would produce a less useful user message
 * @returns error text for the first unknown-key group, or `null` when all keys are displayable
 */
export function rejectUnknownKeys(
  reportObject: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string,
): string | null {
  // Extra keys would make the saved report promise fields the UI cannot display.
  const unknown = Object.keys(reportObject).filter(
    (key) => !allowedKeys.includes(key),
  );
  // No unsupported fields were found, so validation can continue to required user-visible fields.
  if (unknown.length === 0) return null;
  return `${path} has unknown key(s): ${unknown.join(", ")}`;
}

/**
 * Read a required string field from an agent report.
 * Use for values the CLI prints or stores exactly, such as summaries and dates.
 *
 * @param candidate - raw field value; `null`, missing, or non-string values become a path-specific error
 * @param path - schema path shown to the user; empty makes the failure harder to fix
 * @returns parsed string, or an error that tells the user which report field is wrong
 */
function expectString(
  candidate: unknown,
  path: string,
): { ok: true; value: string } | { ok: false; error: string } {
  // Non-string report fields cannot be rendered safely in quality history.
  if (typeof candidate !== "string") {
    return { ok: false, error: `${path} must be a string` };
  }
  return { ok: true, value: candidate };
}

/**
 * Read text that must be visible to the user.
 * Use for report fields where blank text would leave a card, table row, or history entry unexplained.
 *
 * @param candidate - raw report value; `null`, missing, or blank text means the user would see an empty label
 * @param path - schema path shown in validation output; empty makes the remediation unclear
 * @returns non-empty string, or a path-specific error for the quality command
 */
export function expectNonEmptyString(
  candidate: unknown,
  path: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const parsed = expectString(candidate, path);
  // Type errors are already user-ready, so keep the original field-specific message.
  if (!parsed.ok) return parsed;
  // Blank text would produce an unexplained quality row, so reject it before saving.
  if (parsed.value.trim().length === 0) {
    return { ok: false, error: `${path} must not be empty` };
  }
  return { ok: true, value: parsed.value };
}

/**
 * Read a field whose value must match the quality UI vocabulary.
 * Use for statuses, severities, modes, and evidence labels that drive badges and filters.
 *
 * @param candidate - raw report value; missing or unknown text means the UI has no badge to show
 * @param path - schema path shown in validation output; empty hides where the bad value came from
 * @param values - allowed display values; empty means every candidate is rejected
 * @returns one allowed value, or a path-specific error listing the accepted choices
 */
export function expectEnumValue<T extends string>(
  candidate: unknown,
  path: string,
  values: readonly T[],
): { ok: true; value: T } | { ok: false; error: string } {
  // Unknown enum text cannot be mapped to a stable badge, filter, or report mode.
  if (typeof candidate !== "string" || !values.includes(candidate as T)) {
    return {
      ok: false,
      error: `${path} must be one of: ${values.join(", ")}`,
    };
  }
  return { ok: true, value: candidate as T };
}

/**
 * Read optional text where `null` is a meaningful blank state.
 * Use for fields like file paths where absence means the finding is project-wide.
 *
 * @param candidate - raw field value; `null` means no user-visible file value is attached
 * @param path - schema path shown in validation output; empty makes a bad optional field hard to fix
 * @returns non-empty string or `null`; errors when the field cannot be shown safely
 */
export function expectNullableString(
  candidate: unknown,
  path: string,
): { ok: true; value: string | null } | { ok: false; error: string } {
  // Null is the report's explicit "no specific text to show" state.
  if (candidate === null) return { ok: true, value: null };
  const parsed = expectNonEmptyString(candidate, path);
  // Preserve the path-specific message so the user can repair the emitted report.
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value };
}

/**
 * Read an optional positive line number.
 * Use for finding rows where `null` means the issue applies to a whole file or project.
 *
 * @param candidate - raw field value; `null` means the UI should omit the line suffix
 * @param path - schema path shown in validation output; empty makes the bad number hard to locate
 * @returns positive integer or `null`; errors for zero, negative, fractional, or non-number values
 */
export function expectNullablePositiveInteger(
  candidate: unknown,
  path: string,
): { ok: true; value: number | null } | { ok: false; error: string } {
  // Null keeps project-wide findings visible without inventing a line number.
  if (candidate === null) return { ok: true, value: null };
  // Non-positive or fractional lines cannot point the user to a real source location.
  if (!Number.isInteger(candidate) || Number(candidate) <= 0) {
    return { ok: false, error: `${path} must be a positive integer or null` };
  }
  return { ok: true, value: Number(candidate) };
}

/**
 * Read optional text that may be absent on legacy reports.
 * Use for evidence fields where missing means the old report cannot show that detail.
 *
 * @param candidate - raw field value; `undefined` means the UI leaves the optional evidence field blank
 * @param path - schema path shown in validation output; empty hides the invalid optional field
 * @returns non-empty string or `undefined`; errors when present text would render empty
 */
export function expectOptionalNonEmptyString(
  candidate: unknown,
  path: string,
): { ok: true; value: string | undefined } | { ok: false; error: string } {
  // Missing legacy evidence stays blank instead of failing old history reads.
  if (candidate === undefined) return { ok: true, value: undefined };
  const parsed = expectNonEmptyString(candidate, path);
  // Keep the exact field error so the report author can fix the emitted JSON.
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value };
}

/**
 * Read an optional count or exit code that may be absent on legacy reports.
 * Use when the UI can show the number when present and omit it when absent.
 *
 * @param candidate - raw field value; `undefined` means no count is shown for this report
 * @param path - schema path shown in validation output; empty hides the invalid numeric field
 * @returns non-negative integer or `undefined`; errors for negative, fractional, or non-number values
 */
export function expectOptionalNonNegativeInteger(
  candidate: unknown,
  path: string,
): { ok: true; value: number | undefined } | { ok: false; error: string } {
  // Missing legacy count fields stay absent so old reports still open.
  if (candidate === undefined) return { ok: true, value: undefined };
  // Negative or fractional counts cannot be displayed as reliable evidence.
  if (!Number.isInteger(candidate) || Number(candidate) < 0) {
    return { ok: false, error: `${path} must be a non-negative integer` };
  }
  return { ok: true, value: Number(candidate) };
}

/**
 * Read one rubric-axis score.
 * Use for the setup and system score breakdown that users compare across quality runs.
 *
 * @param candidate - raw score value; missing or unknown scores make the totals misleading
 * @param path - schema path shown in validation output; empty hides which axis failed
 * @returns accepted axis score, or an error listing the score values the UI supports
 */
export function expectAxisScore(
  candidate: unknown,
  path: string,
): { ok: true; value: QualityAxisScore } | { ok: false; error: string } {
  // Unknown score values cannot be compared on the quality scale.
  if (
    !Number.isInteger(candidate) ||
    !QUALITY_SCORE_VALUES.includes(Number(candidate) as QualityAxisScore)
  ) {
    return {
      ok: false,
      error: `${path} must be one of: ${QUALITY_SCORE_VALUES.join(", ")}`,
    };
  }
  return { ok: true, value: Number(candidate) as QualityAxisScore };
}

/**
 * Read a 0-100 score total.
 * Use for the headline quality score that appears in CLI history and dashboard summaries.
 *
 * @param candidate - raw total value; missing or out-of-range totals would mislead the user
 * @param path - schema path shown in validation output; empty hides which total failed
 * @returns integer score total, or an error when the headline score cannot be displayed
 */
export function expectScoreTotal(
  candidate: unknown,
  path: string,
): { ok: true; value: number } | { ok: false; error: string } {
  // The headline score must fit the 0-100 scale the UI labels and compares.
  if (
    !Number.isInteger(candidate) ||
    Number(candidate) < 0 ||
    Number(candidate) > 100
  ) {
    return { ok: false, error: `${path} must be an integer between 0 and 100` };
  }
  return { ok: true, value: Number(candidate) };
}
