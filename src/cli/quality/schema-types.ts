/**
 * Strict schema validation for quality reports emitted by agents and persisted by the CLI.
 */
import type { AgentId } from "../types.js";

export const QUALITY_REPORT_KIND = "goat-flow-quality-report";

export const QUALITY_FINDING_TYPES = [
  "setup_quality",
  "skill_flaw",
  "contradiction",
  "false_path",
  "content_quality",
  "framework_flaw",
] as const;

export const QUALITY_FINDING_SEVERITIES = [
  "BLOCKER",
  "MAJOR",
  "MINOR",
] as const;
export const QUALITY_EVIDENCE_QUALITIES = ["OBSERVED", "INFERRED"] as const;
export const QUALITY_EVIDENCE_METHODS = [
  "runtime-probe",
  "static-analysis",
  "mixed",
] as const;
export const QUALITY_SCOPES = ["framework-self", "consumer"] as const;
export const QUALITY_MODES = [
  "process",
  "agent-setup",
  "harness",
  "skills",
] as const;
export const QUALITY_DELTA_TAGS = ["new", "persisted"] as const;
export const QUALITY_AUDIT_STATUSES = ["pass", "fail", "unavailable"] as const;
export const QUALITY_SCORE_VALUES = [0, 5, 10, 15, 20, 25] as const;

type QualityFindingType = (typeof QUALITY_FINDING_TYPES)[number];
type QualityFindingSeverity = (typeof QUALITY_FINDING_SEVERITIES)[number];
type QualityEvidenceQuality = (typeof QUALITY_EVIDENCE_QUALITIES)[number];
/**
 * How a finding was gathered: a live `runtime-probe`, `static-analysis` of source, or a `mixed`
 * combination. Present on v2+ reports; v1 reports omit it and are defaulted to static-analysis at
 * parse time, so readers should treat a defaulted value as "unknown", not a confirmed static check.
 */
export type QualityEvidenceMethod = (typeof QUALITY_EVIDENCE_METHODS)[number];
/**
 * Whether a report reviews goat-flow itself (`framework-self`) or a downstream `consumer` project.
 * Drives self-review filtering; absent on v1 reports, where scope is treated as unspecified.
 */
export type QualityScope = (typeof QUALITY_SCOPES)[number];
/** Quality workflow mode used to keep history and diffs within comparable report families. */
export type QualityMode = (typeof QUALITY_MODES)[number];
/**
 * Whether a finding first appeared in this report (`new`) or carried over from the prior same-agent
 * report (`persisted`). Computed during history comparison; null on findings with no prior context.
 */
export type QualityDeltaTag = (typeof QUALITY_DELTA_TAGS)[number];
type QualityAuditStatus = (typeof QUALITY_AUDIT_STATUSES)[number];
/**
 * A single rubric axis score, constrained to the fixed 0-25 five-point band so totals stay
 * comparable across reports. Values outside this set are rejected by the schema parser.
 */
export type QualityAxisScore = (typeof QUALITY_SCORE_VALUES)[number];

/** Setup-side quality rubric scores; axis values must sum to `total`. */
export interface QualitySetupScores {
  total: number;
  accuracy: QualityAxisScore;
  relevance: QualityAxisScore;
  completeness: QualityAxisScore;
  friction: QualityAxisScore;
}

/** System-side quality rubric scores; axis values must sum to `total`. */
export interface QualitySystemScores {
  total: number;
  usefulness: QualityAxisScore;
  signal_to_noise: QualityAxisScore;
  adaptability: QualityAxisScore;
  learnability: QualityAxisScore;
}

/** Paired score groups used by quality history and dashboard trend views. */
export interface QualityScores {
  setup: QualitySetupScores;
  system: QualitySystemScores;
}

/** One current agent-emitted quality finding before deterministic IDs are attached. */
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

/** Persisted quality finding with a deterministic history/diff ID. */
export interface SavedQualityFinding extends QualityFinding {
  id: string;
}

/** Agent-emitted quality report schema accepted by `quality validate`. */
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

/** Saved quality report schema after `attachFindingIds` has materialized finding IDs. */
export interface SavedQualityReport extends Omit<QualityReport, "findings"> {
  findings: SavedQualityFinding[];
}

/**
 * Discriminated result of a schema parse: either `ok: true` with the validated report, or
 * `ok: false` with a human-readable `error`. Parsing never throws on bad input - callers must
 * branch on `ok` rather than try/catch, so a malformed report surfaces as a checked error value.
 *
 * @template T - the report shape returned on success (`QualityReport` or `SavedQualityReport`).
 */
export type ParseResult<T> =
  { ok: true; report: T } | { ok: false; error: string };

/** Parse strictness switch for current emissions versus legacy history files. */
export interface QualityReportParseOptions {
  requireCurrentFields?: boolean;
}
