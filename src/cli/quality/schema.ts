/**
 * Strict schema validation for quality reports emitted by agents and persisted by the CLI.
 */
import { isAbsolute } from "node:path";
import type { AgentId } from "../types.js";
import { KNOWN_AGENT_IDS } from "../agents/registry.js";

export const QUALITY_REPORT_KIND = "goat-flow-quality-report";

const QUALITY_FINDING_TYPES = [
  "setup_quality",
  "skill_flaw",
  "contradiction",
  "false_path",
  "content_quality",
  "framework_flaw",
] as const;

const QUALITY_FINDING_SEVERITIES = ["BLOCKER", "MAJOR", "MINOR"] as const;
const QUALITY_EVIDENCE_QUALITIES = ["OBSERVED", "INFERRED"] as const;
const QUALITY_EVIDENCE_METHODS = [
  "runtime-probe",
  "static-analysis",
  "mixed",
] as const;
const QUALITY_SCOPES = ["framework-self", "consumer"] as const;
export const QUALITY_MODES = [
  "process",
  "agent-setup",
  "harness",
  "skills",
] as const;
const QUALITY_DELTA_TAGS = ["new", "persisted"] as const;
const QUALITY_AUDIT_STATUSES = ["pass", "fail", "unavailable"] as const;
const QUALITY_SCORE_VALUES = [0, 5, 10, 15, 20, 25] as const;

type QualityFindingType = (typeof QUALITY_FINDING_TYPES)[number];
type QualityFindingSeverity = (typeof QUALITY_FINDING_SEVERITIES)[number];
type QualityEvidenceQuality = (typeof QUALITY_EVIDENCE_QUALITIES)[number];
type QualityEvidenceMethod = (typeof QUALITY_EVIDENCE_METHODS)[number];
type QualityScope = (typeof QUALITY_SCOPES)[number];
export type QualityMode = (typeof QUALITY_MODES)[number];
type QualityDeltaTag = (typeof QUALITY_DELTA_TAGS)[number];
type QualityAuditStatus = (typeof QUALITY_AUDIT_STATUSES)[number];
type QualityAxisScore = (typeof QUALITY_SCORE_VALUES)[number];

interface QualitySetupScores {
  total: number;
  accuracy: QualityAxisScore;
  relevance: QualityAxisScore;
  completeness: QualityAxisScore;
  friction: QualityAxisScore;
}

interface QualitySystemScores {
  total: number;
  usefulness: QualityAxisScore;
  signal_to_noise: QualityAxisScore;
  adaptability: QualityAxisScore;
  learnability: QualityAxisScore;
}

interface QualityScores {
  setup: QualitySetupScores;
  system: QualitySystemScores;
}

export interface QualityFinding {
  type: QualityFindingType;
  severity: QualityFindingSeverity;
  file: string | null;
  line: number | null;
  summary: string;
  detail: string;
  evidence_quality: QualityEvidenceQuality;
  /** How the finding was observed. Present on v2+ reports (2026-04-19+).
   *  Absent on v1 reports, defaulted to "static-analysis" at parse time. */
  evidence_method: QualityEvidenceMethod;
  /** Optional compact command provenance for runtime-probe or mixed evidence.
   *  These fields are intentionally summaries, not raw terminal transcripts. */
  evidence_command?: string;
  evidence_exit_code?: number;
  evidence_summary?: string;
  evidence_warning_count?: number;
  evidence_excerpt?: string;
  delta_tag: QualityDeltaTag | null;
}

export interface SavedQualityFinding extends QualityFinding {
  id: string;
}

export interface QualityReport {
  report_kind: typeof QUALITY_REPORT_KIND;
  goat_flow_version: string;
  agent: AgentId;
  project_path: string;
  run_date: string;
  audit_status: QualityAuditStatus;
  /** Optional: "framework-self" for a goat-flow-on-goat-flow review,
   *  "consumer" for a review of a downstream project. Absent on v1 reports. */
  scope?: QualityScope;
  /** Optional: the rubric version under which scores were produced.
   *  Lets readers trace score derivation. Absent on v1 reports. */
  rubric_version?: string;
  /** Optional: the quality workflow that produced the report.
   *  Absent on legacy reports, which are treated as agent-setup history. */
  quality_mode?: QualityMode;
  /** Optional: the previous same-agent report used for delta_tag comparison.
   *  Null or absent means no prior report context was available. */
  prior_report_id?: string | null;
  scores: QualityScores;
  findings: QualityFinding[];
}

export interface SavedQualityReport extends Omit<QualityReport, "findings"> {
  findings: SavedQualityFinding[];
}

type ParseResult<T> = { ok: true; report: T } | { ok: false; error: string };

interface QualityReportParseOptions {
  requireCurrentFields?: boolean;
}

/** Check whether a value is a record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reject unknown keys. */
function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string,
): string | null {
  const unknown = Object.keys(value).filter(
    (key) => !allowedKeys.includes(key),
  );
  if (unknown.length === 0) return null;
  return `${path} has unknown key(s): ${unknown.join(", ")}`;
}

/** Expect string. */
function expectString(
  value: unknown,
  path: string,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string") {
    return { ok: false, error: `${path} must be a string` };
  }
  return { ok: true, value };
}

/** Expect non empty string. */
function expectNonEmptyString(
  value: unknown,
  path: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const parsed = expectString(value, path);
  if (!parsed.ok) return parsed;
  if (parsed.value.trim().length === 0) {
    return { ok: false, error: `${path} must not be empty` };
  }
  return { ok: true, value: parsed.value };
}

/** Expect enum value. */
function expectEnumValue<T extends string>(
  value: unknown,
  path: string,
  values: readonly T[],
): { ok: true; value: T } | { ok: false; error: string } {
  if (typeof value !== "string" || !values.includes(value as T)) {
    return {
      ok: false,
      error: `${path} must be one of: ${values.join(", ")}`,
    };
  }
  return { ok: true, value: value as T };
}

/** Expect nullable string. */
function expectNullableString(
  value: unknown,
  path: string,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null) return { ok: true, value: null };
  const parsed = expectNonEmptyString(value, path);
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value };
}

/** Expect nullable positive integer. */
function expectNullablePositiveInteger(
  value: unknown,
  path: string,
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value === null) return { ok: true, value: null };
  if (!Number.isInteger(value) || Number(value) <= 0) {
    return { ok: false, error: `${path} must be a positive integer or null` };
  }
  return { ok: true, value: Number(value) };
}

/** Expect optional non-empty string. */
function expectOptionalNonEmptyString(
  value: unknown,
  path: string,
): { ok: true; value: string | undefined } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: undefined };
  const parsed = expectNonEmptyString(value, path);
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value };
}

/** Expect optional non-negative integer. */
function expectOptionalNonNegativeInteger(
  value: unknown,
  path: string,
): { ok: true; value: number | undefined } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: undefined };
  if (!Number.isInteger(value) || Number(value) < 0) {
    return { ok: false, error: `${path} must be a non-negative integer` };
  }
  return { ok: true, value: Number(value) };
}

/** Expect axis score. */
function expectAxisScore(
  value: unknown,
  path: string,
): { ok: true; value: QualityAxisScore } | { ok: false; error: string } {
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

/** Expect score total. */
function expectScoreTotal(
  value: unknown,
  path: string,
): { ok: true; value: number } | { ok: false; error: string } {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 100) {
    return { ok: false, error: `${path} must be an integer between 0 and 100` };
  }
  return { ok: true, value: Number(value) };
}

/** Parse the setup scores. */
function parseSetupScores(
  raw: unknown,
  path: string,
): { ok: true; scores: QualitySetupScores } | { ok: false; error: string } {
  if (!isRecord(raw)) return { ok: false, error: `${path} must be an object` };
  const unknownKeyError = rejectUnknownKeys(
    raw,
    ["total", "accuracy", "relevance", "completeness", "friction"],
    path,
  );
  if (unknownKeyError) return { ok: false, error: unknownKeyError };

  const total = expectScoreTotal(raw.total, `${path}.total`);
  if (!total.ok) return total;
  const accuracy = expectAxisScore(raw.accuracy, `${path}.accuracy`);
  if (!accuracy.ok) return accuracy;
  const relevance = expectAxisScore(raw.relevance, `${path}.relevance`);
  if (!relevance.ok) return relevance;
  const completeness = expectAxisScore(
    raw.completeness,
    `${path}.completeness`,
  );
  if (!completeness.ok) return completeness;
  const friction = expectAxisScore(raw.friction, `${path}.friction`);
  if (!friction.ok) return friction;

  const sum =
    accuracy.value + relevance.value + completeness.value + friction.value;
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

/** Parse the system scores. */
function parseSystemScores(
  raw: unknown,
  path: string,
): { ok: true; scores: QualitySystemScores } | { ok: false; error: string } {
  if (!isRecord(raw)) return { ok: false, error: `${path} must be an object` };
  const unknownKeyError = rejectUnknownKeys(
    raw,
    ["total", "usefulness", "signal_to_noise", "adaptability", "learnability"],
    path,
  );
  if (unknownKeyError) return { ok: false, error: unknownKeyError };

  const total = expectScoreTotal(raw.total, `${path}.total`);
  if (!total.ok) return total;
  const usefulness = expectAxisScore(raw.usefulness, `${path}.usefulness`);
  if (!usefulness.ok) return usefulness;
  const signalToNoise = expectAxisScore(
    raw.signal_to_noise,
    `${path}.signal_to_noise`,
  );
  if (!signalToNoise.ok) return signalToNoise;
  const adaptability = expectAxisScore(
    raw.adaptability,
    `${path}.adaptability`,
  );
  if (!adaptability.ok) return adaptability;
  const learnability = expectAxisScore(
    raw.learnability,
    `${path}.learnability`,
  );
  if (!learnability.ok) return learnability;

  const sum =
    usefulness.value +
    signalToNoise.value +
    adaptability.value +
    learnability.value;
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

/** Parse the scores. */
function parseScores(
  raw: unknown,
  path: string,
): { ok: true; scores: QualityScores } | { ok: false; error: string } {
  if (!isRecord(raw)) return { ok: false, error: `${path} must be an object` };
  const unknownKeyError = rejectUnknownKeys(raw, ["setup", "system"], path);
  if (unknownKeyError) return { ok: false, error: unknownKeyError };

  const setup = parseSetupScores(raw.setup, `${path}.setup`);
  if (!setup.ok) return setup;
  const system = parseSystemScores(raw.system, `${path}.system`);
  if (!system.ok) return system;

  return {
    ok: true,
    scores: {
      setup: setup.scores,
      system: system.scores,
    },
  };
}

/** Parse one quality finding payload. */
// eslint-disable-next-line complexity -- finding validation is intentionally explicit so every rejected field gets a precise path-specific error
function parseFinding(
  raw: unknown,
  index: number,
  allowId: boolean,
  options: QualityReportParseOptions,
):
  | { ok: true; finding: QualityFinding | SavedQualityFinding }
  | { ok: false; error: string } {
  const path = `findings[${index}]`;
  if (!isRecord(raw)) return { ok: false, error: `${path} must be an object` };
  const allowedKeys = allowId
    ? [
        "id",
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
      ]
    : [
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
  if (unknownKeyError) return { ok: false, error: unknownKeyError };
  if (!allowId && Object.hasOwn(raw, "id")) {
    return {
      ok: false,
      error: `${path}.id is not allowed in agent-emitted reports`,
    };
  }

  const type = expectEnumValue(raw.type, `${path}.type`, QUALITY_FINDING_TYPES);
  if (!type.ok) return type;
  const severity = expectEnumValue(
    raw.severity,
    `${path}.severity`,
    QUALITY_FINDING_SEVERITIES,
  );
  if (!severity.ok) return severity;
  const file = expectNullableString(raw.file ?? null, `${path}.file`);
  if (!file.ok) return file;
  const line = expectNullablePositiveInteger(raw.line ?? null, `${path}.line`);
  if (!line.ok) return line;
  const summary = expectNonEmptyString(raw.summary, `${path}.summary`);
  if (!summary.ok) return summary;
  if (summary.value.length > 200) {
    return {
      ok: false,
      error: `${path}.summary must be 200 characters or fewer`,
    };
  }
  const detail = expectNonEmptyString(raw.detail, `${path}.detail`);
  if (!detail.ok) return detail;
  const evidenceQuality = expectEnumValue(
    raw.evidence_quality,
    `${path}.evidence_quality`,
    QUALITY_EVIDENCE_QUALITIES,
  );
  if (!evidenceQuality.ok) return evidenceQuality;

  let evidenceMethod: QualityEvidenceMethod = "static-analysis";
  if (
    options.requireCurrentFields === true &&
    !Object.hasOwn(raw, "evidence_method")
  ) {
    return {
      ok: false,
      error: `${path}.evidence_method is required for current quality reports`,
    };
  }
  // evidence_method: optional on legacy reports, defaulted to "static-analysis".
  // Required on current emissions by quality validate.
  if (Object.hasOwn(raw, "evidence_method")) {
    const parsedMethod = expectEnumValue(
      raw.evidence_method,
      `${path}.evidence_method`,
      QUALITY_EVIDENCE_METHODS,
    );
    if (!parsedMethod.ok) return parsedMethod;
    evidenceMethod = parsedMethod.value;
  }

  const evidenceCommand = expectOptionalNonEmptyString(
    raw.evidence_command,
    `${path}.evidence_command`,
  );
  if (!evidenceCommand.ok) return evidenceCommand;
  const evidenceExitCode = expectOptionalNonNegativeInteger(
    raw.evidence_exit_code,
    `${path}.evidence_exit_code`,
  );
  if (!evidenceExitCode.ok) return evidenceExitCode;
  const evidenceSummary = expectOptionalNonEmptyString(
    raw.evidence_summary,
    `${path}.evidence_summary`,
  );
  if (!evidenceSummary.ok) return evidenceSummary;
  const evidenceWarningCount = expectOptionalNonNegativeInteger(
    raw.evidence_warning_count,
    `${path}.evidence_warning_count`,
  );
  if (!evidenceWarningCount.ok) return evidenceWarningCount;
  const evidenceExcerpt = expectOptionalNonEmptyString(
    raw.evidence_excerpt,
    `${path}.evidence_excerpt`,
  );
  if (!evidenceExcerpt.ok) return evidenceExcerpt;

  const deltaTagRaw = Object.hasOwn(raw, "delta_tag") ? raw.delta_tag : null;
  let deltaTag: QualityDeltaTag | null = null;
  if (deltaTagRaw !== null) {
    const parsedDeltaTag = expectEnumValue(
      deltaTagRaw,
      `${path}.delta_tag`,
      QUALITY_DELTA_TAGS,
    );
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

  if (!allowId) {
    return { ok: true, finding: findingBase };
  }

  const id = expectNonEmptyString(raw.id, `${path}.id`);
  if (!id.ok) return id;
  return {
    ok: true,
    finding: {
      ...findingBase,
      id: id.value,
    },
  };
}

/** Parse a quality report with optional finding IDs. */
// eslint-disable-next-line complexity -- report validation stays fully expanded so schema errors name the exact failing field
function parseReportInternal(
  raw: unknown,
  allowFindingId: boolean,
  options: QualityReportParseOptions = {},
): ParseResult<QualityReport | SavedQualityReport> {
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
  if (unknownKeyError) return { ok: false, error: unknownKeyError };

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
  if (!version.ok) return version;
  const agent = expectEnumValue(raw.agent, "report.agent", KNOWN_AGENT_IDS);
  if (!agent.ok) return agent;
  const projectPath = expectNonEmptyString(
    raw.project_path,
    "report.project_path",
  );
  if (!projectPath.ok) return projectPath;
  if (!isAbsolute(projectPath.value)) {
    return {
      ok: false,
      error: "report.project_path must be an absolute path",
    };
  }
  const runDate = expectNonEmptyString(raw.run_date, "report.run_date");
  if (!runDate.ok) return runDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate.value)) {
    return { ok: false, error: "report.run_date must be YYYY-MM-DD" };
  }
  const auditStatus = expectEnumValue(
    raw.audit_status,
    "report.audit_status",
    QUALITY_AUDIT_STATUSES,
  );
  if (!auditStatus.ok) return auditStatus;

  let scope: QualityScope | undefined;
  if (options.requireCurrentFields === true && !Object.hasOwn(raw, "scope")) {
    return {
      ok: false,
      error: "report.scope is required for current quality reports",
    };
  }
  // scope: optional on legacy reports, enum-validated when present.
  if (Object.hasOwn(raw, "scope")) {
    const parsedScope = expectEnumValue(
      raw.scope,
      "report.scope",
      QUALITY_SCOPES,
    );
    if (!parsedScope.ok) return parsedScope;
    scope = parsedScope.value;
  }

  let rubricVersion: string | undefined;
  if (
    options.requireCurrentFields === true &&
    !Object.hasOwn(raw, "rubric_version")
  ) {
    return {
      ok: false,
      error: "report.rubric_version is required for current quality reports",
    };
  }
  // rubric_version: optional on legacy reports, non-empty string when present.
  if (Object.hasOwn(raw, "rubric_version")) {
    const parsedRubric = expectNonEmptyString(
      raw.rubric_version,
      "report.rubric_version",
    );
    if (!parsedRubric.ok) return parsedRubric;
    rubricVersion = parsedRubric.value;
  }

  let qualityMode: QualityMode | undefined;
  if (
    options.requireCurrentFields === true &&
    !Object.hasOwn(raw, "quality_mode")
  ) {
    return {
      ok: false,
      error: "report.quality_mode is required for current quality reports",
    };
  }
  // quality_mode: optional on legacy reports, enum-validated when present.
  if (Object.hasOwn(raw, "quality_mode")) {
    const parsedQualityMode = expectEnumValue(
      raw.quality_mode,
      "report.quality_mode",
      QUALITY_MODES,
    );
    if (!parsedQualityMode.ok) return parsedQualityMode;
    qualityMode = parsedQualityMode.value;
  }

  let priorReportId: string | null | undefined;
  if (Object.hasOwn(raw, "prior_report_id")) {
    const parsedPriorReportId = expectNullableString(
      raw.prior_report_id,
      "report.prior_report_id",
    );
    if (!parsedPriorReportId.ok) return parsedPriorReportId;
    priorReportId = parsedPriorReportId.value;
  }

  const scores = parseScores(raw.scores, "report.scores");
  if (!scores.ok) return scores;
  if (!Array.isArray(raw.findings)) {
    return { ok: false, error: "report.findings must be an array" };
  }

  const findings: Array<QualityFinding | SavedQualityFinding> = [];
  for (const [index, item] of raw.findings.entries()) {
    const parsedFinding = parseFinding(item, index, allowFindingId, options);
    if (!parsedFinding.ok) return parsedFinding;
    findings.push(parsedFinding.finding);
  }

  if (options.requireCurrentFields && typeof priorReportId === "string") {
    const nullDeltaIndex = findings.findIndex((f) => f.delta_tag === null);
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

  if (allowFindingId) {
    return {
      ok: true,
      report: {
        ...reportBase,
        findings: findings as SavedQualityFinding[],
      },
    };
  }

  return {
    ok: true,
    report: {
      ...reportBase,
      findings: findings as QualityFinding[],
    },
  };
}

/** Parse the quality report. */
export function parseQualityReport(
  raw: unknown,
  options: QualityReportParseOptions = { requireCurrentFields: true },
): ParseResult<QualityReport> {
  const result = parseReportInternal(raw, false, options);
  if (!result.ok) return result;
  return { ok: true, report: result.report };
}

/** Parse the saved quality report. */
export function parseSavedQualityReport(
  raw: unknown,
  options: QualityReportParseOptions = {},
): ParseResult<SavedQualityReport> {
  const result = parseReportInternal(raw, true, options);
  if (!result.ok) return result;
  return { ok: true, report: result.report as SavedQualityReport };
}
