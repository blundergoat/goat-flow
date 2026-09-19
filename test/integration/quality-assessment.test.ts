/**
 * Protect the assessment evidence and recommendations that maintainers save and revisit through quality history.
 *
 * These fixtures exercise the real parser, redacted saver, history loader, and comparison output.
 * Legacy reports remain readable; new evidence limits must survive without changing rubric scores.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { CLIError } from "../../src/cli/cli-error.js";
import { getPackageVersion } from "../../src/cli/paths.js";
import { composeQuality } from "../../src/cli/prompt/compose-quality.js";
import { buildQualityDiff } from "../../src/cli/quality/history-diff.js";
import {
  renderQualityDiffText,
  renderQualityHistoryText,
} from "../../src/cli/quality/history-render.js";
import {
  buildQualityHistoryRows,
  loadQualityHistory,
  type QualityHistoryEntry,
} from "../../src/cli/quality/history.js";
import { persistQualityReportText } from "../../src/cli/quality/quality-command.js";
import {
  parseQualityReport,
  type QualityReport,
} from "../../src/cli/quality/schema.js";
import { QUALITY_MODES } from "../../src/cli/quality/schema-types.js";
import { makeQualityScoreRationale } from "../fixtures/quality-score-rationale.js";

const STABLE_SNAPSHOT = `review-v1:sha256:${"a".repeat(64)}`;
const CHANGED_SNAPSHOT = `review-v1:sha256:${"b".repeat(64)}`;

/**
 * Build a valid assessment fixture with a concrete recommendation for the reproduced preflight failure.
 * Use a caller-owned temporary project when exercising save; the default path is only for in-memory parsing.
 *
 * @param projectPath - report owner; an absent argument keeps parser-only tests independent of disk
 * @returns a complete report whose empty finding list keeps recommendation counts separate from defects
 */
function makeAssessmentReport(
  projectPath = "/tmp/quality-assessment-fixture",
): QualityReport {
  return {
    report_kind: "goat-flow-quality-report",
    goat_flow_version: getPackageVersion(),
    agent: "codex",
    project_path: projectPath,
    run_date: "2026-09-13",
    audit_status: "pass",
    scope: "consumer",
    rubric_version: getPackageVersion(),
    quality_mode: "harness",
    prior_report_id: null,
    assessment_context: {
      project_revision: "c".repeat(40),
      working_tree_state: "dirty",
      grounding_status: "complete",
      unverified_probes: [],
      score_confidence: "high",
      workspace_snapshot: { start: STABLE_SNAPSHOT, end: STABLE_SNAPSHOT },
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
    score_rationale: makeQualityScoreRationale(),
    findings: [],
    refuted_candidates: [],
    improvements: [
      {
        category: "defect",
        summary: "Make fatal ESLint startup failures fail preflight",
        action:
          "Keep the original exit code when lint emits no diagnostic rows.",
        evidence:
          '(search: "ESLint execution failed") identifies the corrected production verdict.',
        file: "scripts/preflight-checks.sh",
      },
    ],
  };
}

/**
 * Give an in-memory report the filename metadata used by the real history loader.
 * Use for controlled before/after comparisons; these entries intentionally contain no finding identities.
 *
 * @param report - validated assessment fixture; an empty recommendation list means none were proposed
 * @param time - four-digit filename time used to distinguish this pair of runs
 * @returns a comparable saved entry without writing a historical report to disk
 */
function historyEntry(
  report: QualityReport,
  time: string,
): QualityHistoryEntry {
  const id = `2026-09-13-${time}-codex-abcde`;
  return {
    id,
    path: `${id}.json`,
    date: report.run_date,
    time,
    agent: report.agent,
    randomId: "abcde",
    report: { ...report, findings: [] },
  };
}

describe("quality assessment evidence", () => {
  it("rejects malformed recommendations while preserving optional legacy absence", () => {
    const legacy = makeAssessmentReport();
    delete legacy.improvements;
    delete legacy.assessment_context?.workspace_snapshot;
    assert.deepEqual(parseQualityReport(legacy), { ok: true, report: legacy });

    const report = makeAssessmentReport();
    const recommendation = report.improvements?.[0];
    assert.ok(recommendation);
    // Each malformed author input must fail before the saver can lose or mislabel the proposed work.
    for (const improvements of [
      Array.from({ length: 6 }, () => recommendation),
      [{ ...recommendation, category: "automatic-fix" }],
      [{ ...recommendation, summary: "x".repeat(241) }],
      [{ ...recommendation, action: "first line\nsecond line" }],
      [{ ...recommendation, evidence: "" }],
      [{ ...recommendation, command: "unexpected field" }],
    ]) {
      const parsed = parseQualityReport({ ...report, improvements });
      assert.equal(parsed.ok, false, JSON.stringify(improvements));
    }
  });

  it("requires runtime results for new findings but accepts historical omissions", () => {
    const report = makeAssessmentReport();
    const finding = {
      type: "framework_flaw",
      severity: "MAJOR",
      file: "scripts/preflight-checks.sh",
      line: null,
      summary: "Fatal lint startup reported success",
      detail: "Missing configuration exits before lint diagnostics exist.",
      evidence_quality: "OBSERVED",
      evidence_method: "runtime-probe",
      delta_tag: null,
    };
    assert.equal(
      parseQualityReport({ ...report, findings: [finding] }).ok,
      false,
    );
    assert.equal(
      parseQualityReport(
        { ...report, findings: [finding] },
        { requireCurrentFields: false },
      ).ok,
      true,
    );
    assert.equal(
      parseQualityReport({
        ...report,
        findings: [
          {
            ...finding,
            evidence_command:
              "grep -c absent-marker scripts/preflight-checks.sh",
            evidence_exit_code: 1,
            evidence_summary: "0 matches; grep exited 1",
          },
        ],
      }).ok,
      true,
    );
  });

  it("rejects invalid or changing snapshots presented as complete grounding", () => {
    const report = makeAssessmentReport();
    const context = report.assessment_context;
    assert.ok(context);
    assert.equal(
      parseQualityReport({
        ...report,
        assessment_context: {
          ...context,
          workspace_snapshot: { start: null, end: null },
        },
      }).ok,
      false,
    );
    const changedContext = {
      ...context,
      workspace_snapshot: { start: STABLE_SNAPSHOT, end: CHANGED_SNAPSHOT },
    };
    assert.equal(
      parseQualityReport({ ...report, assessment_context: changedContext }).ok,
      false,
    );
    assert.equal(
      parseQualityReport({
        ...report,
        assessment_context: {
          ...changedContext,
          grounding_status: "partial",
          unverified_probes: ["Concurrent edits require a fresh assessment"],
        },
      }).ok,
      true,
    );
    assert.equal(
      parseQualityReport({
        ...report,
        assessment_context: {
          ...context,
          workspace_snapshot: { start: "invented", end: "invented" },
        },
      }).ok,
      false,
    );
  });

  // This test writes a report in a temporary Git project to prove save and history retain the author's evidence and recommendations.
  it("retains recommendations and provenance through real save, load, and text history", () => {
    const projectPath = mkdtempSync(resolve(tmpdir(), "quality-assessment-"));
    try {
      execFileSync("git", ["-C", projectPath, "init", "--quiet"]);
      writeFileSync(
        resolve(projectPath, ".gitignore"),
        ".goat-flow/logs/quality/*.json\n",
      );
      const report = makeAssessmentReport(projectPath);
      const savedPath = persistQualityReportText(
        { projectPath, rawText: JSON.stringify(report) },
        { CLIError },
      );
      const history = loadQualityHistory(projectPath);
      assert.deepEqual(history.warnings, []);
      assert.equal(history.entries.length, 1);
      const saved = history.entries[0];
      assert.ok(saved);
      assert.equal(saved.path, savedPath);
      assert.deepEqual(saved.report.improvements, report.improvements);
      assert.deepEqual(
        saved.report.assessment_context,
        report.assessment_context,
      );
      assert.deepEqual(saved.report.scores, report.scores);
      const output = renderQualityHistoryText(
        buildQualityHistoryRows(history.entries, {
          agent: "codex",
          limit: null,
        }),
        {
          agent: "codex",
          qualityMode: "harness",
          includeAll: true,
          entries: history.entries,
        },
      );
      assert.match(
        output,
        /improvement \[defect\]: Make fatal ESLint startup failures fail preflight/u,
      );
      assert.match(output, /assessment: complete; confidence: high/u);
    } finally {
      // A rejected save or failed assertion must still remove only the temporary project owned by this test.
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it("discloses missing, changed, or different workspace evidence without changing score deltas", () => {
    const olderReport = makeAssessmentReport();
    const newerReport = makeAssessmentReport();
    const newerContext = newerReport.assessment_context;
    assert.ok(newerContext);
    const previous = historyEntry(olderReport, "1000");
    const current = historyEntry(newerReport, "1100");
    // Maintainers must distinguish absent evidence, an edit during one run, and two stable but different assessed states.
    for (const [snapshot, expected] of [
      [undefined, /snapshot evidence is unavailable/u],
      [{ start: null, end: null }, /snapshot evidence is unavailable/u],
      [
        { start: STABLE_SNAPSHOT, end: CHANGED_SNAPSHOT },
        /changed during an assessment/u,
      ],
      [
        { start: CHANGED_SNAPSHOT, end: CHANGED_SNAPSHOT },
        /snapshots differ between reports/u,
      ],
      [{ start: STABLE_SNAPSHOT, end: STABLE_SNAPSHOT }, null],
    ] as const) {
      // Legacy omission remains absent rather than being normalized into a made-up captured state.
      if (snapshot === undefined) delete newerContext.workspace_snapshot;
      else newerContext.workspace_snapshot = snapshot;
      const result = buildQualityDiff([current, previous], {
        agent: "codex",
        pair: null,
      });
      assert.ok(result.ok);
      assert.equal(result.diff.setupDelta, 0);
      assert.equal(result.diff.systemDelta, 0);
      // Matching stable snapshots need no caveat; every weaker case must expose its specific limit in terminal output.
      if (expected === null)
        assert.deepEqual(result.diff.comparisonWarnings, []);
      else assert.match(renderQualityDiffText(result.diff), expected);
    }
  });
});

describe("quality assessment prompt consistency", () => {
  // Each launch mode must retain the same evidence rules so mode selection cannot silently weaken saved reports.
  for (const qualityMode of QUALITY_MODES) {
    it(`preserves recommendations, snapshot capture, and actual exits in ${qualityMode} prompts`, () => {
      const prompt = composeQuality({
        agent: "codex",
        projectPath: "/tmp/quality-assessment-fixture",
        auditReport: null,
        auditUnavailableReason: "fixture audit not run",
        priorReport: null,
        qualityMode,
        runDate: "2026-09-13",
      }).prompt;
      assert.match(prompt, /"improvements": \[\]/u);
      assert.match(
        prompt,
        /"workspace_snapshot": \{ "start": null, "end": null \}/u,
      );
      assert.match(prompt, /same completed tool call/u);
      assert.match(prompt, /"kind":"area","roots":\["\."\],"sample":null/u);
      assert.match(prompt, /not launcher attestation/u);
      assert.match(prompt, /qualification-gap/u);
    });
  }

  it("keeps the browser fallback aligned with the shared report evidence contract", () => {
    const source = readFileSync(
      resolve(
        import.meta.dirname,
        "../../src/dashboard/dashboard-setup-quality.ts",
      ),
      "utf8",
    );
    assert.match(source, /"improvements": \[\]/u);
    assert.match(
      source,
      /"workspace_snapshot": \{ "start": null, "end": null \}/u,
    );
    assert.match(source, /same completed tool call/u);
    assert.match(source, /not launcher attestation/u);
  });
});
