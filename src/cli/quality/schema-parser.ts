/**
 * Validate quality reports before the CLI saves, compares, or shows them.
 *
 * Use when an agent hands back JSON from a quality run, so the user gets a precise schema error instead of a corrupt history entry or a misleading
 * dashboard comparison.
 * The parser keeps legacy-read options explicit while current emissions stay strict.
 */
import { isAbsolute } from "node:path";
import { KNOWN_AGENT_IDS } from "../agents/registry.js";
import {
  QUALITY_AUDIT_STATUSES,
  QUALITY_DELTA_TAGS,
  QUALITY_EVIDENCE_METHODS,
  QUALITY_EVIDENCE_QUALITIES,
  QUALITY_FINDING_SEVERITIES,
  QUALITY_FINDING_TYPES,
  QUALITY_GROUNDING_STATUSES,
  QUALITY_MODES,
  QUALITY_REPORT_KIND,
  QUALITY_SCORE_CONFIDENCES,
  QUALITY_SCOPES,
  QUALITY_WORKTREE_STATES,
  type ParseResult,
  type QualityAssessmentContext,
  type QualityDeltaTag,
  type QualityEvidenceMethod,
  type QualityFinding,
  type QualityRefutedCandidate,
  type QualityReport,
  type QualityMode,
  type QualityReportParseOptions,
  type QualityScoreRationale,
  type QualityScope,
  type QualityScores,
  type QualitySetupScores,
  type QualitySystemScores,
} from "./schema-types.js";
import {
  expectAxisScore,
  expectEnumValue,
  expectNonEmptyString,
  expectNullablePositiveInteger,
  expectNullableString,
  expectOptionalNonEmptyString,
  expectOptionalNonNegativeInteger,
  expectScoreTotal,
  isRecord,
  rejectUnknownKeys,
} from "./schema-expectations.js";
import { parseReportRefutedCandidates } from "./schema-refuted-candidates.js";
import { parseQualityScoreRationale } from "./schema-score-rationale.js";

/**
 * Confirm a formatted run date names a real Gregorian calendar day.
 * Use for new report admission and when legacy history tries to prove consecutive runs.
 * It reads no files and changes no report state.
 *
 * @param runDate - `YYYY-MM-DD` text from a report; empty or malformed values are not real dates
 * @returns true for a real day; false means reject a new report or break legacy streak continuity
 */
export function isRealCalendarDate(runDate: string): boolean {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(runDate);
  // Without three formatted parts, the user has not supplied a comparable calendar date.
  if (!dateMatch) return false;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const februaryDays =
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  const daysPerMonth = [
    31,
    februaryDays,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  // An out-of-range month has no valid maximum day for the report to claim.
  const maximumDay = daysPerMonth[month - 1] ?? 0;
  return year > 0 && day > 0 && day <= maximumDay;
}

/**
 * Parse the setup-score group shown in quality summaries.
 * Use when an agent report is loaded so setup totals match the four visible setup axes.
 *
 * @param raw - raw `scores.setup` value; missing or non-object values mean no setup chart can be shown
 * @param path - schema path shown in validation output; empty hides the broken score group
 * @returns setup scores, or an error before the report is saved or displayed
 */
function parseSetupScores(
  raw: unknown,
  path: string,
): { ok: true; scores: QualitySetupScores } | { ok: false; error: string } {
  // Without a score object, the quality summary has no setup breakdown to render.
  if (!isRecord(raw)) return { ok: false, error: `${path} must be an object` };
  const unknownKeyError = rejectUnknownKeys(
    raw,
    ["total", "accuracy", "relevance", "completeness", "friction"],
    path,
  );
  // Unsupported score axes would not appear in the UI, so reject them instead of hiding them.
  if (unknownKeyError) return { ok: false, error: unknownKeyError };

  const total = expectScoreTotal(raw.total, `${path}.total`);
  // A bad headline setup score would make the whole report summary unreliable.
  if (!total.ok) return total;
  const accuracy = expectAxisScore(raw.accuracy, `${path}.accuracy`);
  // Accuracy is a visible axis, so stop before showing a partial setup score.
  if (!accuracy.ok) return accuracy;
  const relevance = expectAxisScore(raw.relevance, `${path}.relevance`);
  // Relevance is a visible axis, so stop before showing a partial setup score.
  if (!relevance.ok) return relevance;
  const completeness = expectAxisScore(
    raw.completeness,
    `${path}.completeness`,
  );
  // Completeness is a visible axis, so stop before showing a partial setup score.
  if (!completeness.ok) return completeness;
  const friction = expectAxisScore(raw.friction, `${path}.friction`);
  // Friction is a visible axis, so stop before showing a partial setup score.
  if (!friction.ok) return friction;

  const sum =
    accuracy.value + relevance.value + completeness.value + friction.value;
  // Axis rows must add up to the headline number the user sees.
  if (sum !== total.value) {
    return {
      ok: false,
      error: `${path} axis scores must sum exactly to total`,
    };
  }

  return {
    ok: true,
    scores: {
      total: total.value,
      accuracy: accuracy.value,
      relevance: relevance.value,
      completeness: completeness.value,
      friction: friction.value,
    },
  };
}

/**
 * Parse the system-score group shown beside setup scores.
 * Use when an agent report is loaded so the system total matches the visible quality axes.
 *
 * @param raw - raw `scores.system` value; missing or non-object values mean no system chart can be shown
 * @param path - schema path shown in validation output; empty hides the broken score group
 * @returns system scores, or an error before the report is saved or displayed
 */
function parseSystemScores(
  raw: unknown,
  path: string,
): { ok: true; scores: QualitySystemScores } | { ok: false; error: string } {
  // Without a score object, the quality summary has no system breakdown to render.
  if (!isRecord(raw)) return { ok: false, error: `${path} must be an object` };
  const unknownKeyError = rejectUnknownKeys(
    raw,
    ["total", "usefulness", "signal_to_noise", "adaptability", "learnability"],
    path,
  );
  // Unsupported score axes would not appear in the UI, so reject them instead of hiding them.
  if (unknownKeyError) return { ok: false, error: unknownKeyError };

  const total = expectScoreTotal(raw.total, `${path}.total`);
  // A bad headline system score would make the whole report summary unreliable.
  if (!total.ok) return total;
  const usefulness = expectAxisScore(raw.usefulness, `${path}.usefulness`);
  // Usefulness is a visible axis, so stop before showing a partial system score.
  if (!usefulness.ok) return usefulness;
  const signalToNoise = expectAxisScore(
    raw.signal_to_noise,
    `${path}.signal_to_noise`,
  );
  // Signal-to-noise is visible in the breakdown, so stop before showing partial data.
  if (!signalToNoise.ok) return signalToNoise;
  const adaptability = expectAxisScore(
    raw.adaptability,
    `${path}.adaptability`,
  );
  // Adaptability is a visible axis, so stop before showing a partial system score.
  if (!adaptability.ok) return adaptability;
  const learnability = expectAxisScore(
    raw.learnability,
    `${path}.learnability`,
  );
  // Learnability is a visible axis, so stop before showing a partial system score.
  if (!learnability.ok) return learnability;

  const sum =
    usefulness.value +
    signalToNoise.value +
    adaptability.value +
    learnability.value;
  // Axis rows must add up to the headline number the user sees.
  if (sum !== total.value) {
    return {
      ok: false,
      error: `${path} axis scores must sum exactly to total`,
    };
  }

  return {
    ok: true,
    scores: {
      total: total.value,
      usefulness: usefulness.value,
      signal_to_noise: signalToNoise.value,
      adaptability: adaptability.value,
      learnability: learnability.value,
    },
  };
}

/**
 * Parse both quality score groups.
 * Use when loading a report so setup and system panels are either both valid or both rejected.
 *
 * @param raw - raw `scores` value; missing or non-object values mean the report has no score cards
 * @param path - schema path shown in validation output; empty hides the broken score section
 * @returns combined scores, or an error that blocks saving/displaying the report
 */
function parseScores(
  raw: unknown,
  path: string,
): { ok: true; scores: QualityScores } | { ok: false; error: string } {
  // The quality UI needs the named setup/system score groups before it can render a summary.
  if (!isRecord(raw)) return { ok: false, error: `${path} must be an object` };
  const unknownKeyError = rejectUnknownKeys(raw, ["setup", "system"], path);
  // Unknown score groups would be hidden, so reject them before the user sees an incomplete report.
  if (unknownKeyError) return { ok: false, error: unknownKeyError };

  const setup = parseSetupScores(raw.setup, `${path}.setup`);
  // Setup score errors stop the whole report so the headline does not mix valid and invalid groups.
  if (!setup.ok) return setup;
  const system = parseSystemScores(raw.system, `${path}.system`);
  // System score errors stop the whole report so comparisons stay trustworthy.
  if (!system.ok) return system;

  return {
    ok: true,
    scores: {
      setup: setup.scores,
      system: system.scores,
    },
  };
}

/** Parse numeric scores and their optional-for-legacy provenance as one report boundary. */
function parseReportScoring(
  raw: Record<string, unknown>,
  options: QualityReportParseOptions,
): FieldResult<{
  scores: QualityScores;
  scoreRationale: QualityScoreRationale | undefined;
}> {
  const scores = parseScores(raw.scores, "report.scores");
  if (!scores.ok) return scores;
  const scoreRationale = parseOptionalCurrentField(
    raw,
    "score_rationale",
    options,
    parseQualityScoreRationale,
  );
  if (!scoreRationale.ok) return scoreRationale;
  return {
    ok: true,
    value: {
      scores: scores.scores,
      scoreRationale: scoreRationale.value,
    },
  };
}

/**
 * Parse one finding row from an agent quality report.
 * Use when the CLI builds the issue list the user reads after a quality run.
 *
 * @param raw - raw finding value; missing or non-object values mean this row cannot be displayed
 * @param index - zero-based finding position; used only to point the user at the broken row
 * @param options - strictness for current versus legacy reports; missing options keep legacy rows readable
 * @returns parsed finding row, or a path-specific error that blocks the report
 */
/** A parsed value, or the first path-specific error that should stop the whole report. */
type FieldResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** The finding fields every report must carry, whatever version wrote it. */
interface FindingCoreFields {
  type: QualityFinding["type"];
  severity: QualityFinding["severity"];
  file: string | null;
  line: number | null;
  summary: string;
  detail: string;
  evidenceQuality: QualityFinding["evidence_quality"];
}

/**
 * Parse the optional source location a finding points at.
 *
 * Both fields are nullable because a finding can legitimately describe a whole project rather than one line, and a null
 * line with a file still reads correctly as "somewhere in this file".
 *
 * @param raw - the raw finding object
 * @param path - error path prefix identifying which finding failed
 * @returns the file and line, either of which may be null
 */
function parseFindingLocation(
  raw: Record<string, unknown>,
  path: string,
): FieldResult<{ file: string | null; line: number | null }> {
  const file = expectNullableString(raw.file ?? null, `${path}.file`);
  // Invalid file text would point the user at a bogus source location.
  if (!file.ok) return file;
  const line = expectNullablePositiveInteger(raw.line ?? null, `${path}.line`);
  // Invalid line numbers would make source evidence misleading.
  if (!line.ok) return line;
  return { ok: true, value: { file: file.value, line: line.value } };
}

/**
 * Parse the finding fields the issue list cannot render without.
 *
 * The summary length cap exists because the issue row is compact: anything longer belongs in `detail`, where the user can
 * actually read it.
 *
 * @param raw - the raw finding object, already confirmed to be a record
 * @param path - error path prefix identifying which finding failed
 * @returns the core fields, or the first field error
 */
function parseFindingCore(
  raw: Record<string, unknown>,
  path: string,
): FieldResult<FindingCoreFields> {
  const type = expectEnumValue(raw.type, `${path}.type`, QUALITY_FINDING_TYPES);
  // Unknown finding types have no stable grouping in the quality issue list.
  if (!type.ok) return type;
  const severity = expectEnumValue(
    raw.severity,
    `${path}.severity`,
    QUALITY_FINDING_SEVERITIES,
  );
  // Unknown severities cannot be sorted or styled reliably for the user.
  if (!severity.ok) return severity;
  const location = parseFindingLocation(raw, path);
  if (!location.ok) return location;
  const summary = expectNonEmptyString(raw.summary, `${path}.summary`);
  // A finding without summary text leaves the issue list unreadable.
  if (!summary.ok) return summary;
  // Long summaries overflow the compact issue row, so force detail into the detail field.
  if (summary.value.length > 200) {
    return {
      ok: false,
      error: `${path}.summary must be 200 characters or fewer`,
    };
  }
  const detail = expectNonEmptyString(raw.detail, `${path}.detail`);
  // The detail text is the user's explanation of the issue, so it cannot be blank.
  if (!detail.ok) return detail;
  const evidenceQuality = expectEnumValue(
    raw.evidence_quality,
    `${path}.evidence_quality`,
    QUALITY_EVIDENCE_QUALITIES,
  );
  // Evidence quality drives trust labels, so unknown labels cannot be displayed.
  if (!evidenceQuality.ok) return evidenceQuality;

  return {
    ok: true,
    value: {
      type: type.value,
      severity: severity.value,
      file: location.value.file,
      line: location.value.line,
      summary: summary.value,
      detail: detail.value,
      evidenceQuality: evidenceQuality.value,
    },
  };
}

/** The optional evidence fields, each absent when the report did not supply it. */
interface FindingEvidenceFields {
  method: QualityEvidenceMethod;
  command: string | undefined;
  exitCode: number | undefined;
  summary: string | undefined;
  warningCount: number | undefined;
  excerpt: string | undefined;
}

/**
 * Parse how a finding's evidence was gathered, plus the optional proof fields that back it up.
 *
 * Current reports must declare the method so the user can judge how much to trust the finding. Legacy reports predate the
 * field, so they open with the safest visible default rather than failing and hiding the user's history.
 *
 * @param raw - the raw finding object
 * @param path - error path prefix identifying which finding failed
 * @param options - strictness selector; `requireCurrentFields` makes the method mandatory
 * @returns the evidence fields, or the first field error
 */
function parseFindingEvidence(
  raw: Record<string, unknown>,
  path: string,
  options: QualityReportParseOptions,
): FieldResult<FindingEvidenceFields> {
  let method: QualityEvidenceMethod = "static-analysis";
  // Current reports must say how evidence was gathered so users can judge trust level.
  if (
    options.requireCurrentFields === true &&
    !Object.hasOwn(raw, "evidence_method")
  ) {
    return {
      ok: false,
      error: `${path}.evidence_method is required for current quality reports`,
    };
  }
  // Legacy reports lacked this field, so old history opens with the safest visible default.
  if (Object.hasOwn(raw, "evidence_method")) {
    const parsedMethod = expectEnumValue(
      raw.evidence_method,
      `${path}.evidence_method`,
      QUALITY_EVIDENCE_METHODS,
    );
    // Unknown evidence methods cannot be labelled in the report details.
    if (!parsedMethod.ok) return parsedMethod;
    method = parsedMethod.value;
  }

  const command = expectOptionalNonEmptyString(
    raw.evidence_command,
    `${path}.evidence_command`,
  );
  // Bad optional command text is rejected instead of showing an empty evidence row.
  if (!command.ok) return command;
  const exitCode = expectOptionalNonNegativeInteger(
    raw.evidence_exit_code,
    `${path}.evidence_exit_code`,
  );
  // Bad optional exit codes make command evidence misleading.
  if (!exitCode.ok) return exitCode;
  const summary = expectOptionalNonEmptyString(
    raw.evidence_summary,
    `${path}.evidence_summary`,
  );
  // Bad optional evidence summaries would create an unexplained evidence block.
  if (!summary.ok) return summary;
  const warningCount = expectOptionalNonNegativeInteger(
    raw.evidence_warning_count,
    `${path}.evidence_warning_count`,
  );
  // Bad warning counts would distort analyzer evidence in the UI.
  if (!warningCount.ok) return warningCount;
  const excerpt = expectOptionalNonEmptyString(
    raw.evidence_excerpt,
    `${path}.evidence_excerpt`,
  );
  // Bad optional excerpts would show a blank or invalid proof snippet.
  if (!excerpt.ok) return excerpt;

  return {
    ok: true,
    value: {
      method,
      command: command.value,
      exitCode: exitCode.value,
      summary: summary.value,
      warningCount: warningCount.value,
      excerpt: excerpt.value,
    },
  };
}

/**
 * Collect only the evidence fields the report actually supplied.
 *
 * Absent fields are left off the object rather than written as undefined, so a saved report never records a key the user's
 * agent never emitted.
 *
 * @param evidence - the parsed evidence fields
 * @returns an object carrying just the fields that were present
 */
function optionalEvidenceFields(
  evidence: FindingEvidenceFields,
): Partial<QualityFinding> {
  return {
    ...(evidence.command !== undefined
      ? { evidence_command: evidence.command }
      : {}),
    ...(evidence.exitCode !== undefined
      ? { evidence_exit_code: evidence.exitCode }
      : {}),
    ...(evidence.summary !== undefined
      ? { evidence_summary: evidence.summary }
      : {}),
    ...(evidence.warningCount !== undefined
      ? { evidence_warning_count: evidence.warningCount }
      : {}),
    ...(evidence.excerpt !== undefined
      ? { evidence_excerpt: evidence.excerpt }
      : {}),
  };
}

/**
 * Parse the delta tag that says whether this finding is new since the compared report.
 *
 * @param raw - the raw finding object
 * @param path - error path prefix identifying which finding failed
 * @returns the tag, or null when no prior report comparison exists for this finding
 */
function parseFindingDeltaTag(
  raw: Record<string, unknown>,
  path: string,
): FieldResult<QualityDeltaTag | null> {
  const deltaTagRaw = Object.hasOwn(raw, "delta_tag") ? raw.delta_tag : null;
  // Null delta tags mean no prior report comparison exists for this finding.
  if (deltaTagRaw === null) return { ok: true, value: null };
  const parsedDeltaTag = expectEnumValue(
    deltaTagRaw,
    `${path}.delta_tag`,
    QUALITY_DELTA_TAGS,
  );
  // Unknown delta labels cannot be grouped as new or persisted for the user.
  if (!parsedDeltaTag.ok) return parsedDeltaTag;
  return { ok: true, value: parsedDeltaTag.value };
}

/**
 * Parse one finding row from an agent-emitted quality report.
 *
 * Every rejection names the exact field path, because the user's next action is fixing that field in the report their
 * agent produced.
 *
 * The accepted key set is a closed schema: unknown keys and a caller-supplied `id` are both refused, because hidden fields would make the saved
 * report differ from what the user can inspect, and identity belongs to history rather than the emitting agent.
 *
 * @param raw - raw finding value; anything that is not an object cannot be displayed as a row
 * @param index - zero-based position, used only to point the user at the broken row
 * @param options - strictness for current versus legacy reports
 * @returns the parsed finding, or the first path-specific error that blocks the report
 */
function parseFinding(
  raw: unknown,
  index: number,
  options: QualityReportParseOptions,
): { ok: true; finding: QualityFinding } | { ok: false; error: string } {
  const path = `findings[${index}]`;
  // A finding must be an object so the UI can render a stable issue row.
  if (!isRecord(raw)) return { ok: false, error: `${path} must be an object` };
  const allowedKeys = [
    "type",
    "severity",
    "file",
    "line",
    "summary",
    "detail",
    "evidence_quality",
    "evidence_method",
    "evidence_command",
    "evidence_exit_code",
    "evidence_summary",
    "evidence_warning_count",
    "evidence_excerpt",
    "delta_tag",
  ];
  const unknownKeyError = rejectUnknownKeys(raw, allowedKeys, path);
  // Hidden finding fields would make the saved report differ from what the user can inspect.
  if (unknownKeyError) return { ok: false, error: unknownKeyError };
  // Agent-emitted reports cannot choose durable IDs because history assigns its own identity.
  if (Object.hasOwn(raw, "id")) {
    return {
      ok: false,
      error: `${path}.id is not allowed in agent-emitted reports`,
    };
  }

  const core = parseFindingCore(raw, path);
  if (!core.ok) return core;
  const evidence = parseFindingEvidence(raw, path, options);
  if (!evidence.ok) return evidence;
  const deltaTag = parseFindingDeltaTag(raw, path);
  if (!deltaTag.ok) return deltaTag;

  const findingBase: QualityFinding = {
    type: core.value.type,
    severity: core.value.severity,
    file: core.value.file,
    line: core.value.line,
    summary: core.value.summary,
    detail: core.value.detail,
    evidence_quality: core.value.evidenceQuality,
    evidence_method: evidence.value.method,
    ...optionalEvidenceFields(evidence.value),
    delta_tag: deltaTag.value,
  };

  return { ok: true, finding: findingBase };
}

/** The report fields that identify which run this is, all mandatory in every schema version. */
interface ReportIdentity {
  version: string;
  agent: QualityReport["agent"];
  projectPath: string;
  runDate: string;
  auditStatus: QualityReport["audit_status"];
}

/**
 * Parse the fields that say which project, agent, and day a report describes.
 *
 * The project path must be absolute because saved history is keyed on it: a relative path would attach the report
 * to whichever directory happened to be current when it was read back.
 *
 * @param raw - the raw report object
 * @param options - strictness selector; `requireCurrentFields` enables the real-date check
 * @returns the identity fields, or the first path-specific error. The date is format-checked for everyone so
 *   history sorts, but only newly saved reports must name a real calendar day, which keeps older history readable
 *   rather than rejecting it on a rule it predates.
 */
function parseReportIdentity(
  raw: Record<string, unknown>,
  options: QualityReportParseOptions,
): FieldResult<ReportIdentity> {
  const version = expectNonEmptyString(
    raw.goat_flow_version,
    "report.goat_flow_version",
  );
  // The version anchors how the user interprets report shape and scoring rules.
  if (!version.ok) return version;
  const agent = expectEnumValue(raw.agent, "report.agent", KNOWN_AGENT_IDS);
  // Unknown agents cannot be grouped under the dashboard runner tabs.
  if (!agent.ok) return agent;
  const projectPath = expectNonEmptyString(
    raw.project_path,
    "report.project_path",
  );
  // Missing project path would leave history detached from the project being reviewed.
  if (!projectPath.ok) return projectPath;
  // Relative paths cannot safely identify the project in saved history.
  if (!isAbsolute(projectPath.value)) {
    return { ok: false, error: "report.project_path must be an absolute path" };
  }
  const runDate = expectNonEmptyString(raw.run_date, "report.run_date");
  // Missing run date prevents the user from ordering quality history.
  if (!runDate.ok) return runDate;
  // The date must sort predictably in history lists and comparisons.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate.value)) {
    return { ok: false, error: "report.run_date must be YYYY-MM-DD" };
  }
  // Newly saved reports must name a real day; legacy history stays readable under format-only rules.
  if (
    options.requireCurrentFields === true &&
    !isRealCalendarDate(runDate.value)
  ) {
    return {
      ok: false,
      error: "report.run_date must be a real calendar date in YYYY-MM-DD",
    };
  }
  const auditStatus = expectEnumValue(
    raw.audit_status,
    "report.audit_status",
    QUALITY_AUDIT_STATUSES,
  );
  // Unknown audit status cannot be represented in the quality run summary.
  if (!auditStatus.ok) return auditStatus;

  return {
    ok: true,
    value: {
      version: version.value,
      agent: agent.value,
      projectPath: projectPath.value,
      runDate: runDate.value,
      auditStatus: auditStatus.value,
    },
  };
}

/**
 * Parse a field that current reports must carry but older ones are allowed to omit.
 *
 * Current report fields that retain historical compatibility follow this rule, so the
 * "required now, optional then" policy lives here once instead of being restated per
 * field, where the copies could drift apart.
 *
 * @param raw - the raw report object
 * @param key - report field name, used for both lookup and the error path
 * @param options - strictness selector; `requireCurrentFields` makes the field mandatory
 * @param parseValue - how to validate the value once it is known to be present
 * @returns the parsed value, undefined when a legacy report omitted it, or the field's error
 */
function parseOptionalCurrentField<T>(
  raw: Record<string, unknown>,
  key: string,
  options: QualityReportParseOptions,
  parseValue: (value: unknown, path: string) => FieldResult<T>,
): FieldResult<T | undefined> {
  const isPresent = Object.hasOwn(raw, key);
  // A current report that omits the field leaves the user unable to tell what was judged.
  if (options.requireCurrentFields === true && !isPresent) {
    return {
      ok: false,
      error: `report.${key} is required for current quality reports`,
    };
  }
  // Legacy reports predate the field, so their history still opens without it.
  if (!isPresent) return { ok: true, value: undefined };
  const parsed = parseValue(raw[key], `report.${key}`);
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value };
}

/** Parse the commands or probes whose absence limits one report's evidence coverage. */
function parseUnverifiedProbes(
  raw: unknown,
  path: string,
): FieldResult<string[]> {
  if (!Array.isArray(raw)) {
    return { ok: false, error: `${path} must be an array` };
  }
  const probes: string[] = [];
  for (const [index, probe] of raw.entries()) {
    const parsedProbe = expectNonEmptyString(probe, `${path}[${index}]`);
    if (!parsedProbe.ok) return parsedProbe;
    probes.push(parsedProbe.value);
  }
  return { ok: true, value: probes };
}

/** Reject provenance states whose coverage label contradicts their skipped-probe list. */
function validateAssessmentGrounding(
  groundingStatus: QualityAssessmentContext["grounding_status"],
  unverifiedProbes: string[],
  path: string,
): FieldResult<true> {
  if (groundingStatus === "complete" && unverifiedProbes.length > 0) {
    return {
      ok: false,
      error: `${path}.unverified_probes must be empty when grounding_status is complete`,
    };
  }
  if (groundingStatus !== "complete" && unverifiedProbes.length === 0) {
    return {
      ok: false,
      error: `${path}.unverified_probes must name at least one probe when grounding_status is partial or blocked`,
    };
  }
  return { ok: true, value: true };
}

/** Parse the bounded provenance object that makes independent assessment runs comparable. */
function parseAssessmentContext(
  raw: unknown,
  path: string,
): FieldResult<QualityAssessmentContext> {
  if (!isRecord(raw)) return { ok: false, error: `${path} must be an object` };
  const unknownKeyError = rejectUnknownKeys(
    raw,
    [
      "project_revision",
      "working_tree_state",
      "grounding_status",
      "unverified_probes",
      "score_confidence",
    ],
    path,
  );
  if (unknownKeyError) return { ok: false, error: unknownKeyError };

  const projectRevision = expectNullableString(
    raw.project_revision,
    `${path}.project_revision`,
  );
  if (!projectRevision.ok) return projectRevision;
  const workingTreeState = expectEnumValue(
    raw.working_tree_state,
    `${path}.working_tree_state`,
    QUALITY_WORKTREE_STATES,
  );
  if (!workingTreeState.ok) return workingTreeState;
  const groundingStatus = expectEnumValue(
    raw.grounding_status,
    `${path}.grounding_status`,
    QUALITY_GROUNDING_STATUSES,
  );
  if (!groundingStatus.ok) return groundingStatus;
  const unverifiedProbes = parseUnverifiedProbes(
    raw.unverified_probes,
    `${path}.unverified_probes`,
  );
  if (!unverifiedProbes.ok) return unverifiedProbes;
  const grounding = validateAssessmentGrounding(
    groundingStatus.value,
    unverifiedProbes.value,
    path,
  );
  if (!grounding.ok) return grounding;
  const scoreConfidence = expectEnumValue(
    raw.score_confidence,
    `${path}.score_confidence`,
    QUALITY_SCORE_CONFIDENCES,
  );
  if (!scoreConfidence.ok) return scoreConfidence;

  return {
    ok: true,
    value: {
      project_revision: projectRevision.value,
      working_tree_state: workingTreeState.value,
      grounding_status: groundingStatus.value,
      unverified_probes: unverifiedProbes.value,
      score_confidence: scoreConfidence.value,
    },
  };
}

/**
 * Collect only the report fields that were actually supplied.
 *
 * Absent fields are left off rather than written as undefined, so a legacy report re-saved through this parser does not
 * gain keys its original run never emitted.
 *
 * @param fields - the optional values, each undefined when the report omitted it
 * @returns an object carrying just the fields that were present
 */
function optionalReportFields(fields: {
  scope: QualityScope | undefined;
  rubricVersion: string | undefined;
  qualityMode: QualityMode | undefined;
  priorReportId: string | null | undefined;
  assessmentContext: QualityAssessmentContext | undefined;
  scoreRationale: QualityScoreRationale | undefined;
}): Partial<QualityReport> {
  return {
    ...(fields.scope !== undefined ? { scope: fields.scope } : {}),
    ...(fields.rubricVersion !== undefined
      ? { rubric_version: fields.rubricVersion }
      : {}),
    ...(fields.qualityMode !== undefined
      ? { quality_mode: fields.qualityMode }
      : {}),
    ...(fields.priorReportId !== undefined
      ? { prior_report_id: fields.priorReportId }
      : {}),
    ...(fields.assessmentContext !== undefined
      ? { assessment_context: fields.assessmentContext }
      : {}),
    ...(fields.scoreRationale !== undefined
      ? { score_rationale: fields.scoreRationale }
      : {}),
  };
}

/**
 * Parse every finding row, and confirm a compared report labelled all of them.
 *
 * It reports the first bad row and blocks the whole report, because saved history that mixed valid and dropped findings would understate what
 * the run actually found.
 *
 * @param rawFindings - the raw findings value; anything other than an array cannot render as an issue list
 * @param options - strictness selector, passed through to each row
 * @param priorReportId - the compared report, when one was named; its presence requires every delta tag to be set
 * @returns the parsed findings in emitted order, or the first row error. It findings keep their emitted order, so the index in an error path
 *   always names the row the user must fix.
 */
function parseReportFindings(
  rawFindings: unknown,
  options: QualityReportParseOptions,
  priorReportId: string | null | undefined,
): FieldResult<QualityFinding[]> {
  // Findings must be an array so the issue list can render in report order.
  if (!Array.isArray(rawFindings)) {
    return { ok: false, error: "report.findings must be an array" };
  }

  const findings: QualityFinding[] = [];
  // Parse findings in emitted order so validation paths match the row the user can fix.
  for (const [index, item] of rawFindings.entries()) {
    const parsedFinding = parseFinding(item, index, options);
    // One invalid row blocks the report so history never mixes good and bad findings.
    if (!parsedFinding.ok) return parsedFinding;
    findings.push(parsedFinding.finding);
  }

  // Compared reports must label every finding as new or persisted for the diff view.
  if (options.requireCurrentFields && typeof priorReportId === "string") {
    const nullDeltaIndex = findings.findIndex((f) => f.delta_tag === null);
    // A missing delta tag would leave the comparison row uncategorised.
    if (nullDeltaIndex !== -1) {
      return {
        ok: false,
        error: `findings[${nullDeltaIndex}].delta_tag must be "new" or "persisted" when prior_report_id is set`,
      };
    }
  }
  return { ok: true, value: findings };
}

/**
 * Parse the actionable findings and disproved-candidate ledger as one report collection boundary.
 * Use before constructing history output so either invalid list blocks the whole user-visible report.
 *
 * @param rawReport - report object carrying both arrays; missing current arrays produce their own schema errors
 * @param options - strictness for current versus legacy reports; legacy absence is normalized only for the refutation ledger
 * @param priorReportId - compared report id; null or absent means finding delta tags may remain null
 * @returns both validated collections, or the first list error the report author must fix
 */
function parseReportCollections(
  rawReport: Record<string, unknown>,
  options: QualityReportParseOptions,
  priorReportId: string | null | undefined,
): FieldResult<{
  findings: QualityFinding[];
  refutedCandidates: QualityRefutedCandidate[];
}> {
  const findings = parseReportFindings(
    rawReport.findings,
    options,
    priorReportId,
  );
  // Invalid findings stop the report before its actionable issue list reaches the user.
  if (!findings.ok) return findings;
  const refutedCandidates = parseReportRefutedCandidates(rawReport, options);
  // Invalid exclusions stop the report before its refutation ledger reaches the user.
  if (!refutedCandidates.ok) return refutedCandidates;
  return {
    ok: true,
    value: {
      findings: findings.value,
      refutedCandidates: refutedCandidates.value,
    },
  };
}

/**
 * Parse the full quality report object.
 * Use before saving or comparing a run so every user-facing summary and finding row is trustworthy.
 *
 * @param raw - raw report JSON; missing or non-object values mean no report can be shown
 * @param options - strictness for current versus legacy reads; missing options keep default parser behavior
 * @returns parsed report, or the first path-specific error the CLI should show
 */
// eslint-disable-next-line complexity -- intentional because report validation stays fully expanded so schema errors name the exact failing field.
function parseReportInternal(
  raw: unknown,
  options: QualityReportParseOptions = {},
): ParseResult<QualityReport> {
  // The report root must be an object before any dashboard or CLI field can be trusted.
  if (!isRecord(raw)) {
    return { ok: false, error: "quality report must be an object" };
  }
  const unknownKeyError = rejectUnknownKeys(
    raw,
    [
      "report_kind",
      "goat_flow_version",
      "agent",
      "project_path",
      "run_date",
      "audit_status",
      "scope",
      "rubric_version",
      "quality_mode",
      "prior_report_id",
      "assessment_context",
      "scores",
      "score_rationale",
      "findings",
      "refuted_candidates",
    ],
    "report",
  );
  // Unknown top-level fields would be stored but never shown, so reject them at ingest.
  if (unknownKeyError) return { ok: false, error: unknownKeyError };

  // Wrong report kind means the user uploaded or received a different artifact type.
  if (raw.report_kind !== QUALITY_REPORT_KIND) {
    return {
      ok: false,
      error: `report.report_kind must equal "${QUALITY_REPORT_KIND}"`,
    };
  }

  const identity = parseReportIdentity(raw, options);
  if (!identity.ok) return identity;

  const scope = parseOptionalCurrentField(
    raw,
    "scope",
    options,
    (value, path) => expectEnumValue(value, path, QUALITY_SCOPES),
  );
  if (!scope.ok) return scope;
  const rubricVersion = parseOptionalCurrentField(
    raw,
    "rubric_version",
    options,
    (value, path) => expectNonEmptyString(value, path),
  );
  if (!rubricVersion.ok) return rubricVersion;
  const qualityMode = parseOptionalCurrentField(
    raw,
    "quality_mode",
    options,
    (value, path) => expectEnumValue(value, path, QUALITY_MODES),
  );
  if (!qualityMode.ok) return qualityMode;
  const assessmentContext = parseOptionalCurrentField(
    raw,
    "assessment_context",
    options,
    parseAssessmentContext,
  );
  if (!assessmentContext.ok) return assessmentContext;

  let priorReportId: string | null | undefined;
  // A prior report id means the user expects new/persisted labels in the finding list.
  if (Object.hasOwn(raw, "prior_report_id")) {
    const parsedPriorReportId = expectNullableString(
      raw.prior_report_id,
      "report.prior_report_id",
    );
    // Bad prior-report text would break the visible comparison link.
    if (!parsedPriorReportId.ok) return parsedPriorReportId;
    priorReportId = parsedPriorReportId.value;
  }

  const scoring = parseReportScoring(raw, options);
  // Score or rationale errors stop the report before any headline metrics are shown.
  if (!scoring.ok) return scoring;

  const reportCollections = parseReportCollections(raw, options, priorReportId);
  // Invalid findings or exclusions stop the report before either list reaches history.
  if (!reportCollections.ok) return reportCollections;

  const reportBase: Omit<QualityReport, "findings" | "refuted_candidates"> = {
    report_kind: QUALITY_REPORT_KIND,
    goat_flow_version: identity.value.version,
    agent: identity.value.agent,
    project_path: identity.value.projectPath,
    run_date: identity.value.runDate,
    audit_status: identity.value.auditStatus,
    ...optionalReportFields({
      scope: scope.value,
      rubricVersion: rubricVersion.value,
      qualityMode: qualityMode.value,
      priorReportId,
      assessmentContext: assessmentContext.value,
      scoreRationale: scoring.value.scoreRationale,
    }),
    scores: scoring.value.scores,
  };

  return {
    ok: true,
    report: {
      ...reportBase,
      findings: reportCollections.value.findings,
      refuted_candidates: reportCollections.value.refutedCandidates,
    },
  };
}

/**
 * Parse the quality report value callers hand to the public schema API.
 * Use from CLI save/history paths so malformed reports return a clear validation result.
 *
 * @param raw - unknown JSON value to validate; `null` or empty shapes mean no report is available to show
 * @param options - optional strictness override; omitted uses current-report rules for new quality runs
 * @returns parsed quality report, or a path-specific schema error for the user/agent to fix
 */
export function parseQualityReport(
  raw: unknown,
  options: QualityReportParseOptions = { requireCurrentFields: true },
): ParseResult<QualityReport> {
  const result = parseReportInternal(raw, options);
  // Surface the exact parser error so the caller can show one actionable message.
  if (!result.ok) return result;
  return { ok: true, report: result.report };
}
