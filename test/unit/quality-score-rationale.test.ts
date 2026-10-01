/**
 * Defines the score-provenance contract shared by current report parsing and every quality prompt.
 * Legacy reports stay readable, while new reports must explain each numeric axis in bounded text.
 */
import { getQualityRubricId } from "../../src/cli/quality/rubric.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { getPackageVersion } from "../../src/cli/paths.js";
import { composeQuality } from "../../src/cli/prompt/compose-quality.js";
import type { QualityInput } from "../../src/cli/prompt/compose-quality-common.js";
import { parseQualityReport } from "../../src/cli/quality/schema.js";
import { makeQualityScoreRationale } from "../fixtures/quality-score-rationale.js";
import { createHash } from "node:crypto";
import { qualityScoringText } from "../../src/cli/prompt/compose-quality-static-sections.js";

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
    rubric_version: getQualityRubricId("agent-setup"),
    quality_mode: "agent-setup",
    prior_report_id: null,
    assessment_context: {
      project_revision: "a".repeat(40),
      working_tree_state: "clean",
      grounding_status: "complete",
      unverified_probes: [],
      score_confidence: "high",
      workspace_snapshot: {
        start: `review-v1:sha256:${"a".repeat(64)}`,
        end: `review-v1:sha256:${"a".repeat(64)}`,
      },
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
    improvements: [],
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
  it("requires recommendations for current reports while preserving legacy omission", () => {
    const { improvements: _improvements, ...report } = currentReport();
    assert.deepEqual(parseQualityReport(report), {
      ok: false,
      error: "report.improvements is required for current reports",
    });
    assert.equal(
      parseQualityReport(report, { requireCurrentFields: false }).ok,
      true,
    );
  });

  it("rejects terminal and bidirectional controls in persisted provenance", () => {
    for (const control of [
      "\n",
      "\u001b",
      "\u0085",
      "\u061c",
      "\u200e",
      "\u202e",
      "\u2066",
      "\u2069",
    ]) {
      const rationale = makeQualityScoreRationale();
      rationale.setup.accuracy.evidence = `Evidence${control}suffix`;
      assert.equal(
        parseQualityReport(currentReport(rationale)).ok,
        false,
        `rationale ${JSON.stringify(control)}`,
      );
      const report = currentReport();
      report.assessment_context.grounding_status = "partial";
      const withProbe = {
        ...report,
        assessment_context: {
          ...report.assessment_context,
          unverified_probes: [`Probe${control}suffix`],
        },
      };
      assert.equal(
        parseQualityReport(withProbe).ok,
        false,
        `probe ${JSON.stringify(control)}`,
      );
      const revisionReport = currentReport();
      revisionReport.assessment_context.project_revision = `revision${control}suffix`;
      assert.equal(
        parseQualityReport(revisionReport, { requireCurrentFields: false }).ok,
        false,
        `revision ${JSON.stringify(control)}`,
      );
    }
  });

  it("accepts full Git IDs and null, requiring valid IDs only for current reports", () => {
    for (const revision of ["a".repeat(40), "b".repeat(64), null]) {
      const report = currentReport();
      const context = {
        ...report.assessment_context,
        project_revision: revision,
      };
      assert.equal(
        parseQualityReport({ ...report, assessment_context: context }).ok,
        true,
        String(revision),
      );
    }
    const report = currentReport();
    report.assessment_context.project_revision = "not-a-commit";
    assert.equal(parseQualityReport(report).ok, false);
    assert.equal(
      parseQualityReport(report, { requireCurrentFields: false }).ok,
      true,
    );
  });

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

  it("keeps the documented quality-save example on the strict current schema", () => {
    const docs = readFileSync(
      resolve(import.meta.dirname, "../../docs/cli.md"),
      "utf8",
    );
    const qualitySaveSection = docs.match(
      /### `goat-flow quality save <project>`[\s\S]*?(?=\n### |\n## |$)/u,
    )?.[0];

    assert.ok(qualitySaveSection, "docs must retain the quality-save section");
    const exampleJson = qualitySaveSection.match(
      /quality save \. <<'JSON'\n([\s\S]*?)\nJSON/u,
    )?.[1];
    assert.ok(exampleJson, "quality save must retain its JSON stdin example");

    const materializedExampleJson = exampleJson
      .replaceAll("<current-version>", getPackageVersion())
      .replaceAll("<current-rubric-id>", getQualityRubricId("skills"))
      .replace("<absolute-project-path>", "/tmp/example-project")
      .replace("YYYY-MM-DD", "2026-08-29")
      .replace("<git-head>", "a".repeat(40));
    const parsedReport = parseQualityReport(
      JSON.parse(materializedExampleJson),
      { requireCurrentFields: true },
    );
    assert.equal(
      parsedReport.ok,
      true,
      parsedReport.ok
        ? undefined
        : `documented quality report is invalid: ${parsedReport.error}`,
    );
  });
});

describe("quality rubric identity and integer scores", () => {
  it("uses distinct per-mode scoring hashes independently of run and persistence inputs", () => {
    const ids = new Set<string>();
    for (const qualityMode of QUALITY_MODES) {
      const id = getQualityRubricId(qualityMode);
      const text = qualityScoringText(qualityMode);
      assert.match(
        id,
        new RegExp(`^quality-${qualityMode}-r1-[a-f0-9]{64}$`, "u"),
      );
      assert.ok(id.endsWith(createHash("sha256").update(text).digest("hex")));
      assert.doesNotMatch(
        text,
        /Persist through|goat_flow_version|project_path|Prior report context|Top 5 Improvements/u,
      );
      ids.add(id);
      for (const persistence of ["bounded-saver", "staged-draft"] as const) {
        const prompt = composeQuality({
          ...promptInput(qualityMode),
          agent: "claude",
          projectPath: "/tmp/other-project",
          runDate: "2026-09-30",
          persistence,
        }).prompt;
        assert.ok(prompt.includes(`"rubric_version": "${id}"`));
      }
      const report = {
        ...currentReport(),
        quality_mode: qualityMode,
        rubric_version: id,
      };
      assert.equal(parseQualityReport(report).ok, true);
      assert.equal(
        parseQualityReport({
          ...report,
          rubric_version: getQualityRubricId(
            qualityMode === "skills" ? "harness" : "skills",
          ),
        }).ok,
        false,
      );
    }
    assert.equal(ids.size, 4);
  });

  it("accepts every integer axis value and rejects fractions, bounds and incorrect totals", () => {
    for (let value = 0; value <= 25; value++) {
      const report = currentReport();
      report.scores.setup.accuracy = value;
      report.scores.setup.total = 60 + value;
      assert.equal(parseQualityReport(report).ok, true, `integer ${value}`);
    }
    for (const value of [-1, 25.5, 26]) {
      const report = currentReport();
      report.scores.setup.accuracy = value;
      report.scores.setup.total = 60 + value;
      assert.equal(
        parseQualityReport(report).ok,
        false,
        `invalid axis ${value}`,
      );
    }
    const wrongSum = currentReport();
    wrongSum.scores.system.total = 81;
    assert.equal(parseQualityReport(wrongSum).ok, false);
    const legacy = { ...currentReport(), rubric_version: "1.15.0" };
    assert.equal(parseQualityReport(legacy).ok, false);
    assert.equal(
      parseQualityReport(legacy, { requireCurrentFields: false }).ok,
      true,
    );
  });
});
