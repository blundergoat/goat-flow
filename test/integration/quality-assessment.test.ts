/**
 * Protect the assessment evidence and recommendations that maintainers save and revisit through quality history.
 *
 * These fixtures exercise the real parser, redacted saver, history loader, and comparison output.
 * Legacy reports remain readable; new evidence limits must survive without changing rubric scores.
 */
import { getQualityRubricId } from "../../src/cli/quality/rubric.js";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { CLIError } from "../../src/cli/cli-error.js";
import { parseCLIArgs } from "../../src/cli/cli-parser.js";
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
import {
  handleQualityCommand,
  persistQualityReportText,
} from "../../src/cli/quality/quality-command.js";
import {
  parseQualityReport,
  type QualityReport,
} from "../../src/cli/quality/schema.js";
import { QUALITY_MODES } from "../../src/cli/quality/schema-types.js";
import { makeCurrentQualityReport } from "../fixtures/quality-report.js";
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
    rubric_version: getQualityRubricId("harness"),
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

const disposables: string[] = [];
after(() => {
  for (const root of disposables)
    rmSync(root, { recursive: true, force: true });
});

/** Keep saved report bytes in an isolated project owned by this test suite. */
function makeTempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "quality-assessment-persistence-"));
  mkdirSync(join(root, ".goat-flow/logs/quality"), { recursive: true });
  disposables.push(root);
  return root;
}

/** Current persistence fixtures need a Git-owned ignored destination; history-only fixtures do not. */
function makePersistenceProject(): string {
  const root = makeTempProject();
  execFileSync("git", ["-C", root, "init", "--quiet"], { stdio: "ignore" });
  writeFileSync(join(root, ".gitignore"), ".goat-flow/logs/quality/*.json\n");
  return root;
}

describe("quality assessment evidence", () => {
  it("retains assessment-time identity and derives spread from the full saved group", async () => {
    const root = makePersistenceProject();
    const identity = {
      model: "assessment-model-fixture",
      tool_version: "cli-version-fixture",
      prompt_sha256: "b".repeat(64),
      settings_sha256: "c".repeat(64),
      fixed_input_protocol: "d".repeat(64),
      capture: "launch-observed" as const,
    };
    const paths = [75, 80, 90].map((total) => {
      const report = makeCurrentQualityReport(
        root,
        "No secrets in this fixture",
      );
      Object.assign(report.assessment_context, {
        assessment_identity: identity,
      });
      Object.assign(report.scores.setup, {
        total,
        accuracy: 25,
        relevance: 25,
        completeness: 25,
        friction: total - 75,
      });
      Object.assign(report.scores.system, {
        total: 100 - total,
        usefulness: 100 - total,
      });
      return persistQualityReportText(
        { projectPath: root, rawText: JSON.stringify(report) },
        { CLIError },
      );
    });
    const bytes = paths.map((path) => readFileSync(path, "utf8"));
    const history = loadQualityHistory(root);
    assert.deepEqual(history.warnings, []);
    assert.equal(history.entries.length, 3);
    for (const entry of history.entries)
      assert.deepEqual(
        entry.report.assessment_context?.assessment_identity,
        identity,
      );
    const rows = buildQualityHistoryRows(history.entries, {
      agent: "claude",
      limit: 1,
    });
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0]?.repeatSpread, {
      kind: "controlled",
      sampleSize: 3,
      setup: { median: 80, min: 75, max: 90, range: 15 },
      system: { median: 20, min: 10, max: 25, range: 15 },
    });
    const text = renderQualityHistoryText(rows, {
      agent: "claude",
      includeAll: false,
      entries: history.entries,
    });
    assert.match(
      text,
      /controlled reruns n=3; median 80\/100; range 75-90\/100/,
    );
    const diff = buildQualityDiff(history.entries, {
      agent: "claude",
      pair: null,
    });
    assert.equal(diff.ok, true);
    if (!diff.ok) throw new Error(diff.error);
    assert.deepEqual(diff.diff.repeatSpread?.from, rows[0]?.repeatSpread);
    assert.deepEqual(diff.diff.repeatSpread?.to, rows[0]?.repeatSpread);
    // Exercise the command's serialization, where row-only statistics could otherwise disappear.
    for (const subcommand of ["history", "diff"]) {
      let output = "";
      const options = parseCLIArgs([
        "quality",
        subcommand,
        ...(subcommand === "history" ? [root] : []),
        "--agent",
        "claude",
        "--format",
        "json",
      ]);
      options.projectPath = root;
      await handleQualityCommand(options, {
        CLIError,
        formatCandidacyArtifact: (artifact) => artifact,
        validAgents: () => ["claude"],
        writeOutput: (_options, rendered) => {
          output = rendered;
        },
      });
      const payload = JSON.parse(output);
      assert.deepEqual(
        subcommand === "history"
          ? payload.deltas[0].repeat_spread
          : payload.repeatSpread.to,
        rows[0]?.repeatSpread,
        subcommand,
      );
    }
    assert.match(
      renderQualityDiffText(diff.diff),
      /To rerun spread: setup controlled reruns n=3/,
    );
    assert.deepEqual(
      paths.map((path) => readFileSync(path, "utf8")),
      bytes,
    );
  });

  // These saved pairs differ in one assessor input, so none may be pooled into controlled spread.
  it("keeps new unknowns outside legacy spread and separates assessor inputs", () => {
    const root = makeTempProject();
    const identity = {
      model: "model-fixture",
      tool_version: "version-fixture",
      prompt_sha256: "b".repeat(64),
      settings_sha256: "c".repeat(64),
      fixed_input_protocol: "d".repeat(64),
      capture: "launch-observed",
    };
    const cases = [
      {
        name: "model",
        identity: { ...identity, model: "other-model-fixture" },
      },
      {
        name: "tool",
        identity: { ...identity, tool_version: "other-version-fixture" },
      },
      {
        name: "prompt",
        identity: { ...identity, prompt_sha256: "e".repeat(64) },
      },
      {
        name: "settings",
        identity: { ...identity, settings_sha256: "e".repeat(64) },
      },
      {
        name: "protocol",
        identity: { ...identity, fixed_input_protocol: "e".repeat(64) },
      },
      {
        name: "no protocol",
        identity: { ...identity, fixed_input_protocol: null },
      },
      {
        name: "assessor reported",
        identity: { ...identity, capture: "assessor-reported" },
      },
      { name: "unknown", identity: undefined },
    ];
    for (const testCase of cases) {
      const project = makePersistenceProject();
      for (const candidateIdentity of [identity, testCase.identity]) {
        const report = makeCurrentQualityReport(
          project,
          "Identity grouping fixture",
        );
        if (candidateIdentity)
          Object.assign(report.assessment_context, {
            assessment_identity: candidateIdentity,
          });
        persistQualityReportText(
          { projectPath: project, rawText: JSON.stringify(report) },
          { CLIError },
        );
      }
      const history = loadQualityHistory(project);
      assert.equal(history.entries.length, 2, testCase.name);
      assert.ok(
        buildQualityHistoryRows(history.entries, {
          agent: null,
          limit: null,
        }).every((row) => row.repeatSpread === null),
        testCase.name,
      );
      if (!testCase.identity)
        assert.equal(
          history.entries.filter(
            (entry) =>
              entry.report.assessment_context?.assessment_identity?.capture ===
              "unknown",
          ).length,
          1,
        );
    }
    // Historical omission is not filled from the current launch or current defaults.
    const dir = join(root, ".goat-flow/logs/quality");
    mkdirSync(dir, { recursive: true });
    const legacy = makeCurrentQualityReport(root, "Legacy grouping fixture");
    for (const suffix of ["aaaaa", "bbbbb"])
      writeFileSync(
        join(dir, `2026-07-31-1200-claude-${suffix}.json`),
        JSON.stringify(legacy),
      );
    const history = loadQualityHistory(root);
    assert.ok(
      history.entries.every(
        (entry) =>
          entry.report.assessment_context?.assessment_identity === undefined,
      ),
    );
    const rows = buildQualityHistoryRows(history.entries, {
      agent: null,
      limit: null,
    });
    assert.ok(rows.every((row) => row.repeatSpread?.kind === "observational"));
    // Missing capture evidence can use a clean full revision; an even sample averages both middle scores.
    const fallback = {
      ...legacy,
      assessment_context: {
        ...legacy.assessment_context,
        workspace_snapshot: { start: null, end: null },
        grounding_status: "partial",
        unverified_probes: ["Fixture capture unavailable"],
      },
    };
    fallback.scores.setup = {
      total: 20,
      accuracy: 20,
      relevance: 0,
      completeness: 0,
      friction: 0,
    };
    writeFileSync(
      join(dir, "2026-07-31-1200-claude-aaaaa.json"),
      JSON.stringify(fallback),
    );
    fallback.scores.setup = {
      total: 25,
      accuracy: 25,
      relevance: 0,
      completeness: 0,
      friction: 0,
    };
    writeFileSync(
      join(dir, "2026-07-31-1200-claude-bbbbb.json"),
      JSON.stringify(fallback),
    );
    assert.deepEqual(
      buildQualityHistoryRows(loadQualityHistory(root).entries, {
        agent: null,
        limit: 1,
      })[0]?.repeatSpread?.setup,
      { median: 22.5, min: 20, max: 25, range: 5 },
    );
    // A different rubric remains a singleton even when bytes and assessor inputs match.
    const alternateRubric = {
      ...fallback,
      rubric_version: `${legacy.rubric_version}-fixture`,
    };
    writeFileSync(
      join(dir, "2026-07-31-1200-claude-ccccc.json"),
      JSON.stringify(alternateRubric),
    );
    const rubricRows = buildQualityHistoryRows(
      loadQualityHistory(root).entries,
      { agent: null, limit: null },
    );
    assert.equal(
      rubricRows.find((row) => row.id.endsWith("ccccc"))?.repeatSpread,
      null,
    );
    assert.equal(
      rubricRows.find((row) => row.id.endsWith("aaaaa"))?.repeatSpread
        ?.sampleSize,
      2,
    );
    // Changed snapshots cannot borrow a clean revision; an unavailable capture on a dirty tree proves nothing.
    for (const start of [null, `review-v1:sha256:${"e".repeat(64)}`]) {
      const withoutStableCapture = {
        ...legacy,
        assessment_context: {
          ...legacy.assessment_context,
          workspace_snapshot: { start, end: STABLE_SNAPSHOT },
        },
      };
      legacy.assessment_context.working_tree_state = "dirty";
      withoutStableCapture.assessment_context.working_tree_state = "dirty";
      withoutStableCapture.assessment_context.grounding_status = "partial";
      withoutStableCapture.assessment_context.unverified_probes = [
        "Fixture capture is incomplete or changed",
      ];
      writeFileSync(
        join(dir, "2026-07-31-1200-claude-bbbbb.json"),
        JSON.stringify(withoutStableCapture),
      );
      const weakerHistory = loadQualityHistory(root);
      assert.deepEqual(weakerHistory.warnings, []);
      assert.equal(weakerHistory.entries.length, 3);
      assert.ok(
        buildQualityHistoryRows(weakerHistory.entries, {
          agent: null,
          limit: null,
        }).every((row) => row.repeatSpread === null),
      );
    }
  });

  it("rejects malformed recommendations while preserving optional legacy absence", () => {
    const legacy = makeAssessmentReport();
    delete legacy.improvements;
    delete legacy.assessment_context?.workspace_snapshot;
    assert.deepEqual(
      parseQualityReport(legacy, { requireCurrentFields: false }),
      { ok: true, report: legacy },
    );
    const strict = parseQualityReport(legacy, { requireCurrentFields: true });
    assert.ok(!strict.ok);
    assert.match(strict.error, /workspace_snapshot/u);

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
      concern: "verification",
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
      execFileSync("git", ["-C", projectPath, "init", "--quiet"], {
        stdio: "ignore",
      });
      writeFileSync(
        resolve(projectPath, ".gitignore"),
        ".goat-flow/logs/quality/*.json\n",
      );
      const report = makeAssessmentReport(projectPath);
      const missingSnapshot = structuredClone(report);
      delete missingSnapshot.assessment_context?.workspace_snapshot;
      assert.throws(
        () =>
          persistQualityReportText(
            { projectPath, rawText: JSON.stringify(missingSnapshot) },
            { CLIError },
          ),
        /workspace_snapshot is required for current reports/u,
      );
      assert.equal(loadQualityHistory(projectPath).entries.length, 0);
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
      assert.deepEqual(saved.report.assessment_context, {
        ...report.assessment_context,
        assessment_identity: {
          model: null,
          tool_version: null,
          prompt_sha256: null,
          settings_sha256: null,
          fixed_input_protocol: null,
          capture: "unknown",
        },
      });
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
});
