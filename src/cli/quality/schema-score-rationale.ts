/**
 * Validates the compact evidence ledger that explains each assessor-chosen quality score.
 * Current reports require all eight axes; bounded single-line text keeps history and diff readable.
 */
import {
  QUALITY_SCORE_RATIONALE_MAX_CHARACTERS,
  QUALITY_SETUP_SCORE_AXES,
  QUALITY_SYSTEM_SCORE_AXES,
  type QualityScoreAxisRationale,
  type QualityScoreRationale,
} from "./schema-types.js";
import {
  expectNonEmptyString,
  isRecord,
  rejectUnknownKeys,
} from "./schema-expectations.js";

type FieldResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Parse one bounded rationale string before it reaches terminal or dashboard output. */
function parseRationaleText(raw: unknown, path: string): FieldResult<string> {
  const parsed = expectNonEmptyString(raw, path);
  if (!parsed.ok) return parsed;
  if (
    /\r|\n|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]/u.test(
      parsed.value,
    )
  ) {
    return { ok: false, error: `${path} must be a single-line string` };
  }
  if (parsed.value.length > QUALITY_SCORE_RATIONALE_MAX_CHARACTERS) {
    return {
      ok: false,
      error: `${path} must be ${QUALITY_SCORE_RATIONALE_MAX_CHARACTERS} characters or fewer`,
    };
  }
  return parsed;
}

/** Parse the evidence and deduction attached to one numeric score axis. */
function parseAxisRationale(
  raw: unknown,
  path: string,
): FieldResult<QualityScoreAxisRationale> {
  if (!isRecord(raw)) return { ok: false, error: `${path} must be an object` };
  const unknownKeyError = rejectUnknownKeys(
    raw,
    ["evidence", "deduction"],
    path,
  );
  if (unknownKeyError) return { ok: false, error: unknownKeyError };

  const evidence = parseRationaleText(raw.evidence, `${path}.evidence`);
  if (!evidence.ok) return evidence;
  const deduction = parseRationaleText(raw.deduction, `${path}.deduction`);
  if (!deduction.ok) return deduction;
  return {
    ok: true,
    value: { evidence: evidence.value, deduction: deduction.value },
  };
}

/** Parse one closed set of setup or system axis rationale rows. */
function parseRationaleGroup<const Axis extends string>(
  raw: unknown,
  axes: readonly Axis[],
  path: string,
): FieldResult<Record<Axis, QualityScoreAxisRationale>> {
  if (!isRecord(raw)) return { ok: false, error: `${path} must be an object` };
  const unknownKeyError = rejectUnknownKeys(raw, axes, path);
  if (unknownKeyError) return { ok: false, error: unknownKeyError };

  const rows: [Axis, QualityScoreAxisRationale][] = [];
  for (const axis of axes) {
    const parsed = parseAxisRationale(raw[axis], `${path}.${axis}`);
    if (!parsed.ok) return parsed;
    rows.push([axis, parsed.value]);
  }
  return {
    ok: true,
    value: Object.fromEntries(rows) as Record<Axis, QualityScoreAxisRationale>,
  };
}

/**
 * Parse the complete setup/system rationale ledger for one quality report.
 *
 * @param raw - untrusted report value containing the two rationale groups
 * @param path - schema path included in every validation error
 * @returns the complete eight-axis ledger, or the first field-specific error
 */
export function parseQualityScoreRationale(
  raw: unknown,
  path: string,
): FieldResult<QualityScoreRationale> {
  if (!isRecord(raw)) return { ok: false, error: `${path} must be an object` };
  const unknownKeyError = rejectUnknownKeys(raw, ["setup", "system"], path);
  if (unknownKeyError) return { ok: false, error: unknownKeyError };

  const setup = parseRationaleGroup(
    raw.setup,
    QUALITY_SETUP_SCORE_AXES,
    `${path}.setup`,
  );
  if (!setup.ok) return setup;
  const system = parseRationaleGroup(
    raw.system,
    QUALITY_SYSTEM_SCORE_AXES,
    `${path}.system`,
  );
  if (!system.ok) return system;
  return { ok: true, value: { setup: setup.value, system: system.value } };
}
