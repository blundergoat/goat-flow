/**
 * Defines the score-provenance contract shared by current report parsing and every quality prompt.
 * Legacy reports stay readable, while new reports must explain each numeric axis in bounded text.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { getPackageVersion } from "../../src/cli/paths.js";
import { composeQuality } from "../../src/cli/prompt/compose-quality.js";
import type { QualityInput } from "../../src/cli/prompt/compose-quality-common.js";
import { parseQualityReport } from "../../src/cli/quality/schema.js";
import { makeQualityScoreRationale } from "../fixtures/quality-score-rationale.js";

const QUALITY_MODES = ["agent-setup", "process", "harness", "skills"] as const;
const RATIONALE_GUIDANCE =
  "Every score axis requires `evidence` and `deduction` as non-empty single-line strings of 240 characters or fewer.";

/** Build one strict current report whose only variable is the score rationale ledger. */
function currentReport(scoreRationale: unknown = makeQualityScoreRationale()) {
  const version = getPackageVersion();
  return {
    report_kind: "goat-flow-quality-report",
    goat_flow_version: version,
    agent: "codex",
    project_path: "/tmp/example-project",
    run_date: "2026-08-29",
    audit_status: "pass",
    scope: "consumer",
    rubric_version: version,
    quality_mode: "agent-setup",
    prior_report_id: null,
    assessment_context: {
      project_revision: "a".repeat(40),
      working_tree_state: "clean",
      grounding_status: "complete",
      unverified_probes: [],
      score_confidence: "high",
    },
    scores: {
      setup: {
        total: 80,
        accuracy: 20,
        relevance: 20,
        completeness: 20,
        friction: 20,
      },
      system: {
        total: 80,
        usefulness: 20,
        signal_to_noise: 20,
        adaptability: 20,
        learnability: 20,
      },
    },
    score_rationale: scoreRationale,
    findings: [],
    refuted_candidates: [],
  };
}

/** Build the minimum prompt input used to verify every public quality mode. */
function promptInput(qualityMode: QualityInput["qualityMode"]): QualityInput {
  return {
    agent: "codex",
    projectPath: "/tmp/example-project",
    auditReport: null,
    auditUnavailableReason: "audit unavailable in contract fixture",
    priorReport: null,
    qualityMode,
    runDate: "2026-08-29",
  };
}

describe("quality score rationale schema", () => {
  it("accepts a complete rationale ledger on current reports", () => {
    const report = currentReport();

    assert.deepEqual(parseQualityReport(report), { ok: true, report });
  });

  it("requires rationale only for current reports", () => {
    const report = currentReport();
    delete (report as Partial<typeof report>).score_rationale;

    assert.deepEqual(parseQualityReport(report), {
      ok: false,
      error: "report.score_rationale is required for current quality reports",
    });
    const legacy = parseQualityReport(report, { requireCurrentFields: false });
    assert.deepEqual(legacy, { ok: true, report });
  });

  it("rejects unbounded and multi-line rationale at the exact axis field", () => {
    const oversized = makeQualityScoreRationale();
    oversized.setup.accuracy.evidence = "x".repeat(241);
    assert.deepEqual(parseQualityReport(currentReport(oversized)), {
      ok: false,
      error:
        "report.score_rationale.setup.accuracy.evidence must be 240 characters or fewer",
    });

    const multiLine = makeQualityScoreRationale();
    multiLine.system.learnability.deduction = "First line\nSecond line";
    assert.deepEqual(parseQualityReport(currentReport(multiLine)), {
      ok: false,
      error:
        "report.score_rationale.system.learnability.deduction must be a single-line string",
    });
  });
});

describe("quality score rationale prompt contract", () => {
  for (const qualityMode of QUALITY_MODES) {
    it(`shows the ledger shape and bounds in ${qualityMode} mode`, () => {
      const prompt = composeQuality(promptInput(qualityMode)).prompt;

      assert.ok(prompt.includes('"score_rationale"'), qualityMode);
      assert.ok(prompt.includes(RATIONALE_GUIDANCE), qualityMode);
    });
  }

  it("keeps the browser-side dashboard mirror on the same contract", () => {
    const source = readFileSync(
      resolve(
        import.meta.dirname,
        "../../src/dashboard/dashboard-setup-quality.ts",
      ),
      "utf8",
    );

    assert.ok(source.includes('"score_rationale"'));
    assert.ok(source.includes(RATIONALE_GUIDANCE));
  });
});
