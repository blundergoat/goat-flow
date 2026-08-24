/**
 * Validates the refutation ledger attached to a quality report.
 *
 * A user sees this ledger when an assessor tested a suspected finding and ruled it out, so each row must explain the verdict with reproducible
 * source or command evidence.
 *
 * Current reports must include the array, while legacy reports that predate the feature load with an honest empty ledger.
 */
import {
  QUALITY_EVIDENCE_METHODS,
  QUALITY_EVIDENCE_QUALITIES,
  type QualityRefutedCandidate,
  type QualityReportParseOptions,
} from "./schema-types.js";
import {
  expectEnumValue,
  expectNonEmptyString,
  expectNullablePositiveInteger,
  expectNullableString,
  expectOptionalNonEmptyString,
  expectOptionalNonNegativeInteger,
  isRecord,
  rejectUnknownKeys,
} from "./schema-expectations.js";

/** A parsed value, or the first path-specific error that should stop the whole report. */
type FieldResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Canonical grep-friendly anchor accepted in source-backed disproval summaries. */
const SEMANTIC_ANCHOR_PATTERN =
  /\(search:\s*(?:`[^`\r\n]+`|"(?:\\.|[^"\\])+"|'(?:\\.|[^'\\])+')\)/u;

/** Required claim, reason, and source fields for one disproved candidate. */
interface RefutedCandidateCoreFields {
  claim: string;
  exclusionReason: string;
  file: string | null;
  line: number | null;
}

/** Parsed evidence fields, with optional command details absent when the agent did not emit them. */
interface RefutedCandidateEvidenceFields {
  quality: QualityRefutedCandidate["evidence_quality"];
  method: QualityRefutedCandidate["evidence_method"];
  summary: string;
  command: string | undefined;
  exitCode: number | undefined;
  excerpt: string | undefined;
}

/**
 * Parse the explicit source location for one disproved candidate.
 * Use before evidence rules so a missing field is distinct from the user's intentional `null` location.
 *
 * @param rawCandidate - candidate object; missing file or line means the agent omitted part of the ledger schema
 * @param candidatePath - row path shown in errors; empty text would hide which candidate needs repair
 * @returns parsed nullable location, or the first field error that blocks the report
 */
function parseRefutedCandidateLocation(
  rawCandidate: Record<string, unknown>,
  candidatePath: string,
): FieldResult<{ file: string | null; line: number | null }> {
  const file = expectNullableString(rawCandidate.file, `${candidatePath}.file`);
  // Invalid or missing file text would make the candidate's evidence location ambiguous.
  if (!file.ok) return file;
  const line = expectNullablePositiveInteger(
    rawCandidate.line,
    `${candidatePath}.line`,
  );
  // Invalid or missing line data would make the candidate's source pointer misleading.
  if (!line.ok) return line;
  return { ok: true, value: { file: file.value, line: line.value } };
}

/**
 * Parse the claim, exclusion reason, and explicit nullable location shown in the refutation ledger.
 * Use before evidence validation so field errors point to the part of the row the user must repair.
 *
 * @param rawCandidate - candidate object; missing required fields make the row unusable in the report
 * @param candidatePath - row path shown in errors; empty text would hide which candidate needs repair
 * @returns parsed core fields, or the first path-specific error that blocks the report
 */
function parseRefutedCandidateCore(
  rawCandidate: Record<string, unknown>,
  candidatePath: string,
): FieldResult<RefutedCandidateCoreFields> {
  const claim = expectNonEmptyString(
    rawCandidate.claim,
    `${candidatePath}.claim`,
  );
  // A blank claim would not tell the user which suspected problem was disproved.
  if (!claim.ok) return claim;
  const exclusionReason = expectNonEmptyString(
    rawCandidate.why_excluded,
    `${candidatePath}.why_excluded`,
  );
  // A blank reason would preserve the candidate without explaining why it was excluded.
  if (!exclusionReason.ok) return exclusionReason;
  const location = parseRefutedCandidateLocation(rawCandidate, candidatePath);
  // Location errors stop the row before evidence claims point at an unusable source.
  if (!location.ok) return location;
  return {
    ok: true,
    value: {
      claim: claim.value,
      exclusionReason: exclusionReason.value,
      file: location.value.file,
      line: location.value.line,
    },
  };
}

/**
 * Parse the proof fields that explain why one suspected finding was excluded.
 * Use before method-specific checks so malformed values receive their direct field error first.
 *
 * @param rawCandidate - candidate object; missing optional fields stay absent unless its evidence method requires them
 * @param candidatePath - row path shown in errors; empty text would hide which evidence field needs repair
 * @returns validated evidence fields, or the first path-specific error that blocks the report
 */
function parseRefutedCandidateEvidenceFields(
  rawCandidate: Record<string, unknown>,
  candidatePath: string,
): FieldResult<RefutedCandidateEvidenceFields> {
  const quality = expectEnumValue(
    rawCandidate.evidence_quality,
    `${candidatePath}.evidence_quality`,
    QUALITY_EVIDENCE_QUALITIES,
  );
  // Unknown quality labels cannot communicate whether the disproval was observed or inferred.
  if (!quality.ok) return quality;
  // An inferred candidate remains unresolved; only observed evidence can support a disproval ledger.
  if (quality.value !== "OBSERVED") {
    return {
      ok: false,
      error: `${candidatePath}.evidence_quality must be OBSERVED for a refuted candidate`,
    };
  }
  const method = expectEnumValue(
    rawCandidate.evidence_method,
    `${candidatePath}.evidence_method`,
    QUALITY_EVIDENCE_METHODS,
  );
  // Unknown methods leave the user unable to tell whether source reading or a live probe disproved the claim.
  if (!method.ok) return method;
  const summary = expectNonEmptyString(
    rawCandidate.evidence_summary,
    `${candidatePath}.evidence_summary`,
  );
  // Every excluded claim needs a concise result that explains what the evidence established.
  if (!summary.ok) return summary;
  const command = expectOptionalNonEmptyString(
    rawCandidate.evidence_command,
    `${candidatePath}.evidence_command`,
  );
  // Invalid optional command text would show an empty or unusable reproduction step.
  if (!command.ok) return command;
  const exitCode = expectOptionalNonNegativeInteger(
    rawCandidate.evidence_exit_code,
    `${candidatePath}.evidence_exit_code`,
  );
  // Invalid optional exit codes would misstate the result of the user's command evidence.
  if (!exitCode.ok) return exitCode;
  const excerpt = expectOptionalNonEmptyString(
    rawCandidate.evidence_excerpt,
    `${candidatePath}.evidence_excerpt`,
  );
  // Invalid optional excerpts would leave an empty proof snippet in the ledger.
  if (!excerpt.ok) return excerpt;
  return {
    ok: true,
    value: {
      quality: quality.value,
      method: method.value,
      summary: summary.value,
      command: command.value,
      exitCode: exitCode.value,
      excerpt: excerpt.value,
    },
  };
}

/** Check the command and exit-code half of runtime or mixed evidence. */
function validateRefutedCandidateRuntimeProvenance(
  evidence: RefutedCandidateEvidenceFields,
  candidatePath: string,
): FieldResult<true> {
  const requiresRuntimeProvenance =
    evidence.method === "runtime-probe" || evidence.method === "mixed";
  if (!requiresRuntimeProvenance) return { ok: true, value: true };
  // Runtime-backed exclusions need the exact command so the user can reproduce the disproval.
  if (evidence.command === undefined) {
    return {
      ok: false,
      error: `${candidatePath}.evidence_command is required for ${evidence.method} evidence`,
    };
  }
  // Runtime-backed exclusions need the exit code so pass and failure outcomes are not confused.
  if (evidence.exitCode === undefined) {
    return {
      ok: false,
      error: `${candidatePath}.evidence_exit_code is required for ${evidence.method} evidence`,
    };
  }
  return { ok: true, value: true };
}

/** Check the file and semantic-anchor half of static or mixed evidence. */
function validateRefutedCandidateStaticProvenance(
  evidence: RefutedCandidateEvidenceFields,
  sourceFile: string | null,
  candidatePath: string,
): FieldResult<true> {
  const requiresStaticProvenance =
    evidence.method === "static-analysis" || evidence.method === "mixed";
  if (!requiresStaticProvenance) return { ok: true, value: true };
  // Static exclusions need a source file so the user can inspect the evidence that killed the claim.
  if (sourceFile === null) {
    return {
      ok: false,
      error: `${candidatePath}.file is required for ${evidence.method} evidence`,
    };
  }
  // Static exclusions need a durable search anchor instead of a line number that will drift.
  if (!SEMANTIC_ANCHOR_PATTERN.test(evidence.summary)) {
    return {
      ok: false,
      error: `${candidatePath}.evidence_summary must include a semantic anchor such as (search: "pattern") for ${evidence.method} evidence`,
    };
  }
  return { ok: true, value: true };
}

/**
 * Check that an evidence method carries the provenance a user needs to reproduce it.
 * Runtime and static paths intentionally differ because commands and source anchors prove different kinds of disproval.
 *
 * @param evidence - parsed evidence values; optional command fields may still be absent at this stage
 * @param sourceFile - parsed source path; null is valid for runtime-only evidence but not static analysis
 * @param candidatePath - row path shown in errors; empty text would hide which provenance field needs repair
 * @returns true when provenance is complete, or a path-specific error for the report author
 */
function validateRefutedCandidateProvenance(
  evidence: RefutedCandidateEvidenceFields,
  sourceFile: string | null,
  candidatePath: string,
): FieldResult<true> {
  const runtimeProvenance = validateRefutedCandidateRuntimeProvenance(
    evidence,
    candidatePath,
  );
  if (!runtimeProvenance.ok) return runtimeProvenance;
  return validateRefutedCandidateStaticProvenance(
    evidence,
    sourceFile,
    candidatePath,
  );
}

/**
 * Parse one candidate the assessor disproved before assembling the user's findings.
 * Use for ledger rows so every exclusion remains explainable through source or command evidence.
 *
 * @param rawCandidate - raw row value; null, arrays, and primitives cannot describe a disproved claim
 * @param candidateIndex - zero-based row position; used only to identify the broken ledger entry
 * @returns validated candidate, or the first path-specific error the report author must fix
 */
function parseRefutedCandidate(
  rawCandidate: unknown,
  candidateIndex: number,
): FieldResult<QualityRefutedCandidate> {
  const candidatePath = `refuted_candidates[${candidateIndex}]`;
  // A candidate must be an object before the report can show its claim and disproval evidence.
  if (!isRecord(rawCandidate)) {
    return { ok: false, error: `${candidatePath} must be an object` };
  }
  const allowedKeys = [
    "claim",
    "why_excluded",
    "file",
    "line",
    "evidence_quality",
    "evidence_method",
    "evidence_summary",
    "evidence_command",
    "evidence_exit_code",
    "evidence_excerpt",
  ];
  const unknownKeyError = rejectUnknownKeys(
    rawCandidate,
    allowedKeys,
    candidatePath,
  );
  // Hidden candidate fields would be saved without a defined user-facing meaning.
  if (unknownKeyError) return { ok: false, error: unknownKeyError };
  const coreFields = parseRefutedCandidateCore(rawCandidate, candidatePath);
  // Core errors stop the row before the report tries to explain its evidence.
  if (!coreFields.ok) return coreFields;
  const evidenceFields = parseRefutedCandidateEvidenceFields(
    rawCandidate,
    candidatePath,
  );
  // Evidence errors stop the candidate from entering a ledger the user may trust.
  if (!evidenceFields.ok) return evidenceFields;
  const provenance = validateRefutedCandidateProvenance(
    evidenceFields.value,
    coreFields.value.file,
    candidatePath,
  );
  // Incomplete provenance would preserve a verdict the user cannot reproduce.
  if (!provenance.ok) return provenance;
  return {
    ok: true,
    value: {
      claim: coreFields.value.claim,
      why_excluded: coreFields.value.exclusionReason,
      file: coreFields.value.file,
      line: coreFields.value.line,
      evidence_quality: evidenceFields.value.quality,
      evidence_method: evidenceFields.value.method,
      evidence_summary: evidenceFields.value.summary,
      ...(evidenceFields.value.command !== undefined
        ? { evidence_command: evidenceFields.value.command }
        : {}),
      ...(evidenceFields.value.exitCode !== undefined
        ? { evidence_exit_code: evidenceFields.value.exitCode }
        : {}),
      ...(evidenceFields.value.excerpt !== undefined
        ? { evidence_excerpt: evidenceFields.value.excerpt }
        : {}),
    },
  };
}

/**
 * Parse the report ledger of suspected findings the assessor disproved.
 * Use beside findings so current reports preserve exclusions while legacy reports without the field still open as an empty ledger.
 *
 * @param rawReport - report object; an absent ledger is allowed only for legacy reads
 * @param options - strictness selector; `requireCurrentFields` makes the ledger mandatory even when it is empty
 * @returns candidates in emitted order, `[]` for legacy absence, or the first row error that blocks the report
 */
export function parseReportRefutedCandidates(
  rawReport: Record<string, unknown>,
  options: QualityReportParseOptions,
): FieldResult<QualityRefutedCandidate[]> {
  const hasRefutationLedger = Object.hasOwn(rawReport, "refuted_candidates");
  // Current reports must state whether disproval found anything, even when the honest answer is an empty ledger.
  if (options.requireCurrentFields === true && !hasRefutationLedger) {
    return {
      ok: false,
      error:
        "report.refuted_candidates is required for current quality reports",
    };
  }
  // Legacy reports predate candidate tracking, so their missing ledger appears as an empty history section.
  if (!hasRefutationLedger) return { ok: true, value: [] };
  const rawCandidates = rawReport.refuted_candidates;
  // The ledger must preserve report order as an array so users can inspect every excluded claim.
  if (!Array.isArray(rawCandidates)) {
    return {
      ok: false,
      error: "report.refuted_candidates must be an array",
    };
  }
  const refutedCandidates: QualityRefutedCandidate[] = [];
  // Parse candidates in emitted order so an error index names the row the user sees.
  for (const [candidateIndex, rawCandidate] of rawCandidates.entries()) {
    const parsedCandidate = parseRefutedCandidate(rawCandidate, candidateIndex);
    // One invalid row blocks the report so the ledger never mixes reproducible and unsupported exclusions.
    if (!parsedCandidate.ok) return parsedCandidate;
    refutedCandidates.push(parsedCandidate.value);
  }
  return { ok: true, value: refutedCandidates };
}
