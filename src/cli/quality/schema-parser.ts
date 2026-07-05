/**
 * Validate quality reports before the CLI saves, compares, or shows them.
 * Use when an agent hands back JSON from a quality run, so the user gets a precise schema error
 * instead of a corrupt history entry or a misleading dashboard comparison.
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
  QUALITY_MODES,
  QUALITY_REPORT_KIND,
  QUALITY_SCOPES,
  QUALITY_SCORE_VALUES,
  type ParseResult,
  type QualityAxisScore,
  type QualityDeltaTag,
  type QualityEvidenceMethod,
  type QualityFinding,
  type QualityMode,
  type QualityReport,
  type QualityReportParseOptions,
  type QualityScope,
  type QualityScores,
  type QualitySetupScores,
  type QualitySystemScores,
} from "./schema-types.js";

/**
 * Decide whether parsed JSON can be read as a named-field report object.
 * Use before field validation so malformed agent output becomes one clear user-facing error.
 *
 * @param candidate - value from JSON parsing; `null`, arrays, or primitives mean there is no report object to show
 * @returns whether the value has named fields; `false` means validation stops before reading report keys
 */
function isRecord(candidate: unknown): candidate is Record<string, unknown> {
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
 * @param value - report object to inspect; an empty object has no unknown keys but may fail required fields later
 * @param allowedKeys - keys the UI and history readers understand; empty means no keys are accepted
 * @param path - schema path shown in the error; empty would produce a less useful user message
 * @returns error text for the first unknown-key group, or `null` when all keys are displayable
 */
function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string,
): string | null {
  // Extra keys would make the saved report promise fields the UI cannot display.
  const unknown = Object.keys(value).filter(
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
 * @param value - raw field value; `null`, missing, or non-string values become a path-specific error
 * @param path - schema path shown to the user; empty makes the failure harder to fix
 * @returns parsed string, or an error that tells the user which report field is wrong
 */
function expectString(
  value: unknown,
  path: string,
): { ok: true; value: string } | { ok: false; error: string } {
  // Non-string report fields cannot be rendered safely in quality history.
  if (typeof value !== "string") {
    return { ok: false, error: `${path} must be a string` };
  }
  return { ok: true, value };
}

/**
 * Read text that must be visible to the user.
 * Use for report fields where blank text would leave a card, table row, or history entry unexplained.
 *
 * @param value - raw report value; `null`, missing, or blank text means the user would see an empty label
 * @param path - schema path shown in validation output; empty makes the remediation unclear
 * @returns non-empty string, or a path-specific error for the quality command
 */
function expectNonEmptyString(
  value: unknown,
  path: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const parsed = expectString(value, path);
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
 * @param value - raw report value; missing or unknown text means the UI has no badge to show
 * @param path - schema path shown in validation output; empty hides where the bad value came from
 * @param values - allowed display values; empty means every candidate is rejected
 * @returns one allowed value, or a path-specific error listing the accepted choices
 */
function expectEnumValue<T extends string>(
  value: unknown,
  path: string,
  values: readonly T[],
): { ok: true; value: T } | { ok: false; error: string } {
  // Unknown enum text cannot be mapped to a stable badge, filter, or report mode.
  if (typeof value !== "string" || !values.includes(value as T)) {
    return {
      ok: false,
      error: `${path} must be one of: ${values.join(", ")}`,
    };
  }
  return { ok: true, value: value as T };
}

/**
 * Read optional text where `null` is a meaningful blank state.
 * Use for fields like file paths where absence means the finding is project-wide.
 *
 * @param value - raw field value; `null` means no user-visible file value is attached
 * @param path - schema path shown in validation output; empty makes a bad optional field hard to fix
 * @returns non-empty string or `null`; errors when the field cannot be shown safely
 */
function expectNullableString(
  value: unknown,
  path: string,
): { ok: true; value: string | null } | { ok: false; error: string } {
  // Null is the report's explicit "no specific text to show" state.
  if (value === null) return { ok: true, value: null };
  const parsed = expectNonEmptyString(value, path);
  // Preserve the path-specific message so the user can repair the emitted report.
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value };
}

/**
 * Read an optional positive line number.
 * Use for finding rows where `null` means the issue applies to a whole file or project.
 *
 * @param value - raw field value; `null` means the UI should omit the line suffix
 * @param path - schema path shown in validation output; empty makes the bad number hard to locate
 * @returns positive integer or `null`; errors for zero, negative, fractional, or non-number values
 */
function expectNullablePositiveInteger(
  value: unknown,
  path: string,
): { ok: true; value: number | null } | { ok: false; error: string } {
  // Null keeps project-wide findings visible without inventing a line number.
  if (value === null) return { ok: true, value: null };
  // Non-positive or fractional lines cannot point the user to a real source location.
  if (!Number.isInteger(value) || Number(value) <= 0) {
    return { ok: false, error: `${path} must be a positive integer or null` };
  }
  return { ok: true, value: Number(value) };
}

/**
 * Read optional text that may be absent on legacy reports.
 * Use for evidence fields where missing means the old report cannot show that detail.
 *
 * @param value - raw field value; `undefined` means the UI leaves the optional evidence field blank
 * @param path - schema path shown in validation output; empty hides the invalid optional field
 * @returns non-empty string or `undefined`; errors when present text would render empty
 */
function expectOptionalNonEmptyString(
  value: unknown,
  path: string,
): { ok: true; value: string | undefined } | { ok: false; error: string } {
  // Missing legacy evidence stays blank instead of failing old history reads.
  if (value === undefined) return { ok: true, value: undefined };
  const parsed = expectNonEmptyString(value, path);
  // Keep the exact field error so the report author can fix the emitted JSON.
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value };
}

/**
 * Read an optional count or exit code that may be absent on legacy reports.
 * Use when the UI can show the number when present and omit it when absent.
 *
 * @param value - raw field value; `undefined` means no count is shown for this report
 * @param path - schema path shown in validation output; empty hides the invalid numeric field
 * @returns non-negative integer or `undefined`; errors for negative, fractional, or non-number values
 */
function expectOptionalNonNegativeInteger(
  value: unknown,
  path: string,
): { ok: true; value: number | undefined } | { ok: false; error: string } {
  // Missing legacy count fields stay absent so old reports still open.
  if (value === undefined) return { ok: true, value: undefined };
  // Negative or fractional counts cannot be displayed as reliable evidence.
  if (!Number.isInteger(value) || Number(value) < 0) {
    return { ok: false, error: `${path} must be a non-negative integer` };
  }
  return { ok: true, value: Number(value) };
}

/**
 * Read one rubric-axis score.
 * Use for the setup and system score breakdown that users compare across quality runs.
 *
 * @param value - raw score value; missing or unknown scores make the totals misleading
 * @param path - schema path shown in validation output; empty hides which axis failed
 * @returns accepted axis score, or an error listing the score values the UI supports
 */
function expectAxisScore(
  value: unknown,
  path: string,
): { ok: true; value: QualityAxisScore } | { ok: false; error: string } {
  // Unknown score values cannot be compared on the quality scale.
  if (
    !Number.isInteger(value) ||
    !QUALITY_SCORE_VALUES.includes(Number(value) as QualityAxisScore)
  ) {
    return {
      ok: false,
      error: `${path} must be one of: ${QUALITY_SCORE_VALUES.join(", ")}`,
    };
  }
  return { ok: true, value: Number(value) as QualityAxisScore };
}

/**
 * Read a 0-100 score total.
 * Use for the headline quality score that appears in CLI history and dashboard summaries.
 *
 * @param value - raw total value; missing or out-of-range totals would mislead the user
 * @param path - schema path shown in validation output; empty hides which total failed
 * @returns integer score total, or an error when the headline score cannot be displayed
 */
function expectScoreTotal(
  value: unknown,
  path: string,
): { ok: true; value: number } | { ok: false; error: string } {
  // The headline score must fit the 0-100 scale the UI labels and compares.
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 100) {
    return { ok: false, error: `${path} must be an integer between 0 and 100` };
  }
  return { ok: true, value: Number(value) };
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

/**
 * Parse one finding row from an agent quality report.
 * Use when the CLI builds the issue list the user reads after a quality run.
 *
 * @param raw - raw finding value; missing or non-object values mean this row cannot be displayed
 * @param index - zero-based finding position; used only to point the user at the broken row
 * @param options - strictness for current versus legacy reports; missing options keep legacy rows readable
 * @returns parsed finding row, or a path-specific error that blocks the report
 */
// eslint-disable-next-line complexity -- intentional because finding validation stays explicit so every rejected field gets a precise path-specific error.
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
  const file = expectNullableString(raw.file ?? null, `${path}.file`);
  // Invalid file text would point the user at a bogus source location.
  if (!file.ok) return file;
  const line = expectNullablePositiveInteger(raw.line ?? null, `${path}.line`);
  // Invalid line numbers would make source evidence misleading.
  if (!line.ok) return line;
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

  let evidenceMethod: QualityEvidenceMethod = "static-analysis";
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
    evidenceMethod = parsedMethod.value;
  }

  const evidenceCommand = expectOptionalNonEmptyString(
    raw.evidence_command,
    `${path}.evidence_command`,
  );
  // Bad optional command text is rejected instead of showing an empty evidence row.
  if (!evidenceCommand.ok) return evidenceCommand;
  const evidenceExitCode = expectOptionalNonNegativeInteger(
    raw.evidence_exit_code,
    `${path}.evidence_exit_code`,
  );
  // Bad optional exit codes make command evidence misleading.
  if (!evidenceExitCode.ok) return evidenceExitCode;
  const evidenceSummary = expectOptionalNonEmptyString(
    raw.evidence_summary,
    `${path}.evidence_summary`,
  );
  // Bad optional evidence summaries would create an unexplained evidence block.
  if (!evidenceSummary.ok) return evidenceSummary;
  const evidenceWarningCount = expectOptionalNonNegativeInteger(
    raw.evidence_warning_count,
    `${path}.evidence_warning_count`,
  );
  // Bad warning counts would distort analyzer evidence in the UI.
  if (!evidenceWarningCount.ok) return evidenceWarningCount;
  const evidenceExcerpt = expectOptionalNonEmptyString(
    raw.evidence_excerpt,
    `${path}.evidence_excerpt`,
  );
  // Bad optional excerpts would show a blank or invalid proof snippet.
  if (!evidenceExcerpt.ok) return evidenceExcerpt;

  const deltaTagRaw = Object.hasOwn(raw, "delta_tag") ? raw.delta_tag : null;
  let deltaTag: QualityDeltaTag | null = null;
  // Null delta tags mean no prior report comparison exists for this finding.
  if (deltaTagRaw !== null) {
    const parsedDeltaTag = expectEnumValue(
      deltaTagRaw,
      `${path}.delta_tag`,
      QUALITY_DELTA_TAGS,
    );
    // Unknown delta labels cannot be grouped as new or persisted for the user.
    if (!parsedDeltaTag.ok) return parsedDeltaTag;
    deltaTag = parsedDeltaTag.value;
  }

  const findingBase: QualityFinding = {
    type: type.value,
    severity: severity.value,
    file: file.value,
    line: line.value,
    summary: summary.value,
    detail: detail.value,
    evidence_quality: evidenceQuality.value,
    evidence_method: evidenceMethod,
    ...(evidenceCommand.value !== undefined
      ? { evidence_command: evidenceCommand.value }
      : {}),
    ...(evidenceExitCode.value !== undefined
      ? { evidence_exit_code: evidenceExitCode.value }
      : {}),
    ...(evidenceSummary.value !== undefined
      ? { evidence_summary: evidenceSummary.value }
      : {}),
    ...(evidenceWarningCount.value !== undefined
      ? { evidence_warning_count: evidenceWarningCount.value }
      : {}),
    ...(evidenceExcerpt.value !== undefined
      ? { evidence_excerpt: evidenceExcerpt.value }
      : {}),
    delta_tag: deltaTag,
  };

  return { ok: true, finding: findingBase };
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
      "scores",
      "findings",
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
    return {
      ok: false,
      error: "report.project_path must be an absolute path",
    };
  }
  const runDate = expectNonEmptyString(raw.run_date, "report.run_date");
  // Missing run date prevents the user from ordering quality history.
  if (!runDate.ok) return runDate;
  // The date must sort predictably in history lists and comparisons.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate.value)) {
    return { ok: false, error: "report.run_date must be YYYY-MM-DD" };
  }
  const auditStatus = expectEnumValue(
    raw.audit_status,
    "report.audit_status",
    QUALITY_AUDIT_STATUSES,
  );
  // Unknown audit status cannot be represented in the quality run summary.
  if (!auditStatus.ok) return auditStatus;

  let scope: QualityScope | undefined;
  // Current reports must name the reviewed scope so users know what was judged.
  if (options.requireCurrentFields === true && !Object.hasOwn(raw, "scope")) {
    return {
      ok: false,
      error: "report.scope is required for current quality reports",
    };
  }
  // Legacy reports may omit scope; when absent, older history opens without a scope badge.
  if (Object.hasOwn(raw, "scope")) {
    const parsedScope = expectEnumValue(
      raw.scope,
      "report.scope",
      QUALITY_SCOPES,
    );
    // Unknown scope text cannot be mapped to the user's setup/system view.
    if (!parsedScope.ok) return parsedScope;
    scope = parsedScope.value;
  }

  let rubricVersion: string | undefined;
  // Current reports must state the rubric so users know which scoring contract produced the result.
  if (
    options.requireCurrentFields === true &&
    !Object.hasOwn(raw, "rubric_version")
  ) {
    return {
      ok: false,
      error: "report.rubric_version is required for current quality reports",
    };
  }
  // Legacy reports may omit rubric version; current ones show it for auditability.
  if (Object.hasOwn(raw, "rubric_version")) {
    const parsedRubric = expectNonEmptyString(
      raw.rubric_version,
      "report.rubric_version",
    );
    // Blank rubric text would make the report provenance unclear.
    if (!parsedRubric.ok) return parsedRubric;
    rubricVersion = parsedRubric.value;
  }

  let qualityMode: QualityMode | undefined;
  // Current reports must name the mode so users do not compare different review types blindly.
  if (
    options.requireCurrentFields === true &&
    !Object.hasOwn(raw, "quality_mode")
  ) {
    return {
      ok: false,
      error: "report.quality_mode is required for current quality reports",
    };
  }
  // Legacy reports may omit mode; when present it still has to match a visible mode label.
  if (Object.hasOwn(raw, "quality_mode")) {
    const parsedQualityMode = expectEnumValue(
      raw.quality_mode,
      "report.quality_mode",
      QUALITY_MODES,
    );
    // Unknown modes cannot be filtered or compared in quality history.
    if (!parsedQualityMode.ok) return parsedQualityMode;
    qualityMode = parsedQualityMode.value;
  }

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

  const scores = parseScores(raw.scores, "report.scores");
  // Score errors stop the report before any headline metrics are shown.
  if (!scores.ok) return scores;
  // Findings must be an array so the issue list can render in report order.
  if (!Array.isArray(raw.findings)) {
    return { ok: false, error: "report.findings must be an array" };
  }

  const findings: QualityFinding[] = [];
  // Parse findings in emitted order so validation paths match the row the user can fix.
  for (const [index, item] of raw.findings.entries()) {
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

  const reportBase: Omit<QualityReport, "findings"> = {
    report_kind: QUALITY_REPORT_KIND,
    goat_flow_version: version.value,
    agent: agent.value,
    project_path: projectPath.value,
    run_date: runDate.value,
    audit_status: auditStatus.value,
    ...(scope !== undefined ? { scope } : {}),
    ...(rubricVersion !== undefined ? { rubric_version: rubricVersion } : {}),
    ...(qualityMode !== undefined ? { quality_mode: qualityMode } : {}),
    ...(priorReportId !== undefined ? { prior_report_id: priorReportId } : {}),
    scores: scores.scores,
  };

  return {
    ok: true,
    report: {
      ...reportBase,
      findings,
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
