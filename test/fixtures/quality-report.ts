/** Current quality-report fixture for schema and persistence regressions. */
import { getPackageVersion } from "../../src/cli/paths.js";
import { makeQualityScoreRationale } from "./quality-score-rationale.js";

const QUALITY_REPORT_TOKEN_FIXTURE = `ghp_${"abcdefghijklmnopqrstuvwxyz"}`;

/** Build one current report accepted by the strict quality schema. */
export function makeCurrentQualityReport(
  projectPath: string,
  detail = `Token fixture ${QUALITY_REPORT_TOKEN_FIXTURE}`,
) {
  const version = getPackageVersion();
  const snapshot = `review-v1:sha256:${"a".repeat(64)}`;
  return {
    report_kind: "goat-flow-quality-report",
    goat_flow_version: version,
    agent: "claude",
    project_path: projectPath,
    run_date: "2026-07-31",
    audit_status: "pass",
    scope: "framework-self",
    rubric_version: version,
    quality_mode: "skills",
    prior_report_id: null,
    assessment_context: {
      project_revision: "6d95e75d4c8a6770fdeede79bb1cf22d9c3a9aa0",
      working_tree_state: "clean",
      grounding_status: "complete",
      unverified_probes: [],
      score_confidence: "high",
      workspace_snapshot: { start: snapshot, end: snapshot },
    },
    scores: {
      setup: {
        total: 0,
        accuracy: 0,
        relevance: 0,
        completeness: 0,
        friction: 0,
      },
      system: {
        total: 0,
        usefulness: 0,
        signal_to_noise: 0,
        adaptability: 0,
        learnability: 0,
      },
    },
    score_rationale: makeQualityScoreRationale(),
    findings: [
      {
        type: "setup_quality",
        severity: "MINOR",
        file: null,
        line: null,
        summary: "Persistence fixture",
        detail,
        evidence_quality: "OBSERVED",
        evidence_method: "static-analysis",
        delta_tag: null,
      },
    ],
    refuted_candidates: [],
    improvements: [],
  };
}
