/** Parse optional assessor fix claims without promoting missing proof into confirmation. */
import {
  QUALITY_EVIDENCE_METHODS,
  type QualityEvidenceReference,
  type QualityFix,
  type QualityFixEvidence,
  type QualityFixTarget,
  type QualityFixReferenceCheck,
} from "./schema-types.js";
import {
  expectEnumValue,
  expectSingleLineString,
  isRecord,
  rejectUnknownKeys,
} from "./schema-expectations.js";

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** Throw the first field error for the public parser to convert into a checked result. */
function requireValue<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

/** Reject unknown nested keys so retained claims cannot hide unsupported evidence fields. */
function objectFields(
  raw: unknown,
  path: string,
  keys: string[],
): Record<string, unknown> {
  if (!isRecord(raw)) throw new Error(`${path} must be an object`);
  const error = rejectUnknownKeys(raw, keys, path);
  if (error) throw new Error(error);
  return raw;
}

/** Preserve omitted proof as null; throws on empty, multiline, unsafe or oversized supplied text. */
function optionalText(raw: unknown, path: string): string | null {
  if (raw === undefined || raw === null) return null;
  const text = requireValue(expectSingleLineString(raw, path));
  if (text.length > 2000) throw new Error(`${path} exceeds 2000 characters`);
  return text;
}

/** Required evidence fields cannot masquerade as a usable empty reference. */
function requiredText(raw: unknown, path: string): string {
  const text = optionalText(raw, path);
  if (text === null) throw new Error(`${path} is required`);
  return text;
}

/** A retained file needs a path and exact digest; resolution belongs to the saver. */
function parseReference(
  raw: Record<string, unknown>,
  path: string,
): QualityEvidenceReference {
  const file = requiredText(raw.file, `${path}.file`);
  const sha256 = requiredText(raw.sha256, `${path}.sha256`);
  if (!/^[a-f0-9]{64}$/u.test(sha256))
    throw new Error(`${path}.sha256 must be lowercase SHA-256`);
  return { file, sha256 };
}

/** Parse the capture reference and fingerprint; throws on malformed fields without reading source files. */
function parseWorkspaceTarget(raw: unknown, path: string): QualityFixTarget {
  const fields = objectFields(raw, path, ["kind", "fingerprint", "capture"]);
  if (fields.kind !== "workspace-snapshot")
    throw new Error(`${path}.kind must be commit or workspace-snapshot`);
  const fingerprint = requiredText(fields.fingerprint, `${path}.fingerprint`);
  if (!/^review-v1:sha256:[a-f0-9]{64}$/u.test(fingerprint))
    throw new Error(`${path}.fingerprint must identify a review capture`);
  const capture = parseReference(
    objectFields(fields.capture, `${path}.capture`, ["file", "sha256"]),
    `${path}.capture`,
  );
  return { kind: "workspace-snapshot", fingerprint, capture };
}

/** Preserve missing targets as null; throws on malformed supplied targets or mutable revisions such as HEAD. */
function parseTarget(raw: unknown, path: string): QualityFixTarget | null {
  if (raw === undefined || raw === null) return null;
  if (!isRecord(raw) || raw.kind !== "commit")
    return parseWorkspaceTarget(raw, path);
  const fields = objectFields(raw, path, ["kind", "revision"]);
  const revision = requiredText(fields.revision, `${path}.revision`);
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(revision))
    throw new Error(`${path}.revision must be a full commit ID`);
  return { kind: "commit", revision };
}

/** Keep method-specific proof optional here so unsupported claims can be shown as unconfirmed. */
function parseProofDetails(
  raw: Record<string, unknown>,
  path: string,
): Pick<QualityFixEvidence, "anchor" | "command" | "exit_code"> {
  const anchor = optionalText(raw.anchor, `${path}.anchor`);
  const command = optionalText(raw.command, `${path}.command`);
  if (raw.exit_code !== undefined && !Number.isSafeInteger(raw.exit_code))
    throw new Error(`${path}.exit_code must be an integer`);
  return {
    ...(anchor === null ? {} : { anchor }),
    ...(command === null ? {} : { command }),
    ...(raw.exit_code === undefined
      ? {}
      : { exit_code: raw.exit_code as number }),
  };
}

/** Parse one evidence record without executing or interpreting its saved command. */
function parseEvidence(raw: unknown, path: string): QualityFixEvidence | null {
  if (raw === undefined || raw === null) return null;
  const fields = objectFields(raw, path, [
    "file",
    "sha256",
    "method",
    "summary",
    "anchor",
    "command",
    "exit_code",
  ]);
  return {
    ...parseReference(fields, path),
    method: requireValue(
      expectEnumValue(
        fields.method,
        `${path}.method`,
        QUALITY_EVIDENCE_METHODS,
      ),
    ),
    summary: requiredText(fields.summary, `${path}.summary`),
    ...parseProofDetails(fields, path),
  };
}

/** The saver replaces incoming admission claims; history alone retains the original check. */
function parseReferenceCheck(
  raw: unknown,
  path: string,
): QualityFixReferenceCheck | undefined {
  if (raw === undefined) return undefined;
  const fields = objectFields(raw, path, ["status", "reason"]);
  return {
    status: requireValue(
      expectEnumValue(fields.status, `${path}.status`, [
        "confirmed",
        "unconfirmed",
      ] as const),
    ),
    reason: requiredText(fields.reason, `${path}.reason`),
  };
}

/** Preserve the original assessor conclusion even when the saver cannot confirm its references. */
function parseFix(raw: unknown, path: string, isCurrent: boolean): QualityFix {
  const fields = objectFields(raw, path, [
    "prior_report_id",
    "finding_id",
    "conclusion",
    "explanation",
    "target",
    "evidence",
    "reference_check",
  ]);
  const referenceCheck = parseReferenceCheck(
    fields.reference_check,
    `${path}.reference_check`,
  );
  return {
    prior_report_id: optionalText(
      fields.prior_report_id,
      `${path}.prior_report_id`,
    ),
    finding_id: optionalText(fields.finding_id, `${path}.finding_id`),
    conclusion: requireValue(
      expectEnumValue(fields.conclusion, `${path}.conclusion`, [
        "assessor-verified",
      ] as const),
    ),
    explanation: optionalText(fields.explanation, `${path}.explanation`),
    target: parseTarget(fields.target, `${path}.target`),
    evidence: parseEvidence(fields.evidence, `${path}.evidence`),
    ...(!isCurrent && referenceCheck
      ? { reference_check: referenceCheck }
      : {}),
  };
}

/**
 * Preserve an absent legacy section and bound supplied claims independently of finding totals.
 * @param raw - optional report fixes; omission preserves legacy absence
 * @param isCurrent - discard incoming admission checks when saving a new report
 * @returns normalized claims or a field-specific error; never throws on malformed JSON values
 */
export function parseQualityFixes(
  raw: unknown,
  isCurrent: boolean,
): Result<QualityFix[] | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  if (!Array.isArray(raw) || raw.length > 20)
    return { ok: false, error: "report.fixes must contain at most 20 records" };
  try {
    return {
      ok: true,
      value: raw.map((item, index) =>
        parseFix(item, `report.fixes[${index}]`, isCurrent),
      ),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid fix record",
    };
  }
}
