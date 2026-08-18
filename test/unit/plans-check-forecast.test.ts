/**
 * How the checker reports the future: countable inputs, forecast bands,
 * minutes-per-unit history, and read-only usage errors. It runs the real CLI
 * against written milestones, so failures match what plan authors see in the
 * terminal before implementation begins.
 */
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PROJECT_ROOT,
  CLI_PATH,
  runPlansCheck,
  assertSourceLabelledErrors,
  writeCheckFixture,
  writeCheckPlan,
  estimatedMilestoneBody,
  eligibleSampleBody,
  eligibleWorkUnitSampleBody,
} from "./plans-check.helpers.js";

describe("plans check: forecasts, calibration, and CLI usage", () => {
  // Covers an optional forecast band: writes one sharing the headline's unit and centre and expects a pass.
  it("strict mode accepts an ordered forecast range centred on the headline", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-range-"));
    const planPath = writeCheckFixture(
      temporaryRoot,
      estimatedMilestoneBody(
        "Effort estimate: ~10 min agent-time (7 product / 2 proof / 1 other)",
        ["- [ ] Build the thing (est: 7 min product)"],
        {
          forecastRangeLine:
            "Forecast range: 4-30 agent-time minutes on one recorded-unpaused milestone timeline; likely 10; low confidence because no same-shape measured sample exists",
          planAdminOverhead: "1 min other",
          testingGateLines: ["- [ ] Run typecheck (est: 2 min proof)"],
        },
      ),
    );

    try {
      const result = runPlansCheck(planPath, "--strict");
      assert.equal(result.status, 0, result.stdout + result.stderr);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  /**
   * Fixture purpose: a reviewable basis must agree with three positive agent work units.
   * Process/filesystem side effects: writes a temporary plan, runs the CLI, then removes it.
   */
  it("strict mode accepts a forecast basis that matches the plan and its derived range", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-basis-"));
    const planPath = writeCheckFixture(
      temporaryRoot,
      estimatedMilestoneBody(
        "Effort estimate: ~8 min agent-time (3 product / 3 proof / 2 other)",
        ["- [ ] Build the thing (est: 3 min product)"],
        {
          forecastBasisLine:
            "Forecast basis: 3 agent work units; 0.5-2.5-10 min/unit low-likely-high; source: cold-start prior",
          forecastRangeLine:
            "Forecast range: 1-30 agent-time minutes on one recorded-unpaused milestone timeline; likely 8; uncalibrated",
          planAdminOverhead: "2 min other",
          testingGateLines: ["- [ ] Run typecheck (est: 3 min proof)"],
        },
      ),
    );

    try {
      const result = runPlansCheck(planPath, "--strict");
      assert.equal(result.status, 0, result.stdout + result.stderr);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  /**
   * Fixture purpose: a stale four-unit basis must expose the plan's current three-unit scope.
   * Process/filesystem side effects: writes a temporary plan, runs the CLI, then removes it.
   */
  it("strict mode rejects a forecast basis that no longer matches plan work units", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-basis-"));
    const planPath = writeCheckFixture(
      temporaryRoot,
      estimatedMilestoneBody(
        "Effort estimate: ~8 min agent-time (3 product / 3 proof / 2 other)",
        ["- [ ] Build the thing (est: 3 min product)"],
        {
          forecastBasisLine:
            "Forecast basis: 4 agent work units; 0.5-2.5-10 min/unit low-likely-high; source: stale cold-start prior",
          forecastRangeLine:
            "Forecast range: 1-30 agent-time minutes on one recorded-unpaused milestone timeline; likely 8; stale before implementation",
          planAdminOverhead: "2 min other",
          testingGateLines: ["- [ ] Run typecheck (est: 3 min proof)"],
        },
      ),
    );

    try {
      const result = runPlansCheck(planPath, "--strict");
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(
        result.stdout,
        /forecast basis declares 4 agent work units but the plan contains 3/u,
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  const forecastRangeFailureCases = [
    {
      name: "likely-disagrees-with-headline",
      rangeLine:
        "Forecast range: 4-30 agent-time minutes on one recorded-unpaused milestone timeline; likely 12; drifted from the headline",
      expected:
        /forecast range likely \(12 min\) must equal the Effort estimate total \(10 min\)/u,
    },
    {
      name: "low-above-likely",
      rangeLine:
        "Forecast range: 14-30 agent-time minutes on one recorded-unpaused milestone timeline; likely 10; inverted lower bound",
      expected: /forecast range must satisfy low <= likely <= high/u,
    },
    {
      name: "likely-above-high",
      rangeLine:
        "Forecast range: 4-8 agent-time minutes on one recorded-unpaused milestone timeline; likely 10; inverted upper bound",
      expected: /forecast range must satisfy low <= likely <= high/u,
    },
    {
      name: "missing-one-timeline-units",
      rangeLine: "Forecast range: 4-30 minutes; likely 10",
      expected: /forecast range not parseable/u,
    },
  ];

  // Covers each bad forecast band separately so TAP names the exact one.
  for (const testCase of forecastRangeFailureCases) {
    // Covers one malformed band an author could type: writes that plan fixture and expects a rejection.
    it(`strict mode rejects ${testCase.name} forecast ranges`, () => {
      const temporaryRoot = mkdtempSync(
        join(tmpdir(), `goat-flow-plan-range-${testCase.name}-`),
      );
      const planPath = writeCheckFixture(
        temporaryRoot,
        estimatedMilestoneBody(
          "Effort estimate: ~10 min agent-time (7 product / 2 proof / 1 other)",
          ["- [ ] Build the thing (est: 7 min product)"],
          {
            forecastRangeLine: testCase.rangeLine,
            planAdminOverhead: "1 min other",
            testingGateLines: ["- [ ] Run typecheck (est: 2 min proof)"],
          },
        ),
      );

      try {
        const result = runPlansCheck(planPath, "--strict");
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assertSourceLabelledErrors(result.stdout);
        assert.match(result.stdout, testCase.expected);
      } finally {
        rmSync(temporaryRoot, { recursive: true, force: true });
      }
    });
  }

  // Covers thin calibration data: writes fewer than three samples and expects uncalibrated, not a guess.
  it("reports uncalibrated below three eligible measured samples", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-calib-"));
    const planPath = writeCheckPlan(temporaryRoot, {
      "M01-sample.md": eligibleSampleBody(300),
    });

    try {
      const result = runPlansCheck(planPath, "--strict");
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(
        result.stdout,
        /calibration: uncalibrated - 1 of 3 eligible measured samples/u,
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  // Covers the three Actual shapes that must stay out of calibration: writes each and expects all excluded.
  it("excludes prose-measured, retrospective, and empty legacy Actuals from calibration", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-legacy-"));
    // Build a milestone in the older receipt shape, so the forecast is proven to still read plans written before the current format.
    const legacyBody = (
      milestoneId: string,
      actualLine: string | undefined,
      status: string,
    ) =>
      estimatedMilestoneBody(
        "Effort estimate: ~10 min agent-time (7 product / 2 proof / 1 other)",
        [
          `- [${status === "not-started" ? " " : "x"}] Build the thing (est: 7 min product)`,
        ],
        {
          title: `${milestoneId}: Legacy milestone`,
          status,
          actualLine,
          planAdminOverhead: "1 min other",
          testingGateLines: [
            `- [${status === "not-started" ? " " : "x"}] Run typecheck (est: 2 min proof)`,
          ],
        },
      );
    const planPath = writeCheckPlan(temporaryRoot, {
      // Prose claiming measurement never overrides the untagged legacy grammar.
      "M01-prose.md": legacyBody(
        "M01",
        "Actual: ~4 min agent-time (1 product / 1 proof / 2 other) - measured 256 active seconds from prospective UTC/epoch segments; excludes human waits",
        "complete",
      ),
      "M02-guess.md": legacyBody(
        "M02",
        "Actual: ~15 min agent-time (5 product / 10 proof / 0 other) - rough retrospective guess; timing was not instrumented, so treat this figure as low-confidence",
        "complete",
      ),
      "M03-empty.md": legacyBody("M03", "Actual: _", "not-started"),
    });

    try {
      const result = runPlansCheck(planPath, "--strict");
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(
        result.stdout,
        /calibration: uncalibrated - 0 of 3 eligible measured samples/u,
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  // Covers milestones awaiting human sign-off: writes one and expects it excluded until ratified.
  it("excludes human-verification-pending milestones from calibration", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-gate-"));
    const planPath = writeCheckPlan(temporaryRoot, {
      "M01-approved.md": eligibleSampleBody(300),
      "M02-pending.md": eligibleSampleBody(
        600,
        "M02",
        "human-verification-pending",
      ),
    });

    try {
      const result = runPlansCheck(planPath, "--strict");
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(
        result.stdout,
        /calibration: uncalibrated - 1 of 3 eligible measured samples/u,
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  // Covers the calibration maths: writes three eligible samples and expects a median plus observed bounds.
  it("reports a calibration median and observed bounds from three eligible samples", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-median-"));
    const planPath = writeCheckPlan(temporaryRoot, {
      "M01-fast.md": eligibleSampleBody(300),
      "M02-even.md": eligibleSampleBody(600, "M02"),
      "M03-slow.md": eligibleSampleBody(1200, "M03"),
    });

    try {
      const result = runPlansCheck(planPath, "--strict");
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(
        result.stdout,
        /calibration: 3 eligible measured samples - median 1\.00x, observed 0\.50x-2\.00x/u,
      );
      assert.match(
        result.stdout,
        /calibration sample: M01-fast\.md 0\.50x \(300s measured \/ 10 min estimated\)/u,
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  // Writes four temporary milestones, runs the CLI feedback loop, then removes every fixture.
  it("reports minutes-per-unit evidence and requires a stale unfinished forecast to be revised", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-units-"));
    const futureMilestone = estimatedMilestoneBody(
      "Effort estimate: ~10 min agent-time (4 product / 2 proof / 4 other)",
      [
        "- [ ] Build the first part (est: 2 min product)",
        "- [ ] Build the second part (est: 2 min product)",
      ],
      {
        title: "M04: Future milestone",
        forecastBasisLine:
          "Forecast basis: 4 agent work units; 0.5-2.5-10 min/unit low-likely-high; source: cold-start prior",
        forecastRangeLine:
          "Forecast range: 2-40 agent-time minutes on one recorded-unpaused milestone timeline; likely 10; uncalibrated",
        planAdminOverhead: "4 min other",
        testingGateLines: ["- [ ] Prove the result (est: 2 min proof)"],
      },
    );
    const planPath = writeCheckPlan(temporaryRoot, {
      "M01-fast.md": eligibleWorkUnitSampleBody(300),
      "M02-even.md": eligibleWorkUnitSampleBody(600, "M02"),
      "M03-slow.md": eligibleWorkUnitSampleBody(1200, "M03"),
      "M04-future.md": futureMilestone,
    });

    try {
      const result = runPlansCheck(planPath, "--strict");
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(
        result.stdout,
        /work-unit calibration: 3 eligible measured samples - median 3\.33 min\/unit, observed 1\.67-6\.67 min\/unit/u,
      );
      assert.match(
        result.stdout,
        /reforecast required: M04-future\.md - 4 agent work units imply 6-27 agent-time minutes; likely 13 from local evidence/u,
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  // Covers an Actual whose split misses its own total: writes it and expects strict mode to reject it.
  it("strict mode rejects an Actual split that does not sum to its total", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-check-"));
    const planPath = writeCheckFixture(
      temporaryRoot,
      estimatedMilestoneBody(
        "Effort estimate: ~10 min agent-time (7 product / 2 proof / 1 other)",
        ["- [x] Build the thing (est: 7 min product)"],
        {
          status: "complete",
          actualLine:
            "Actual: ~13 min agent-time (8 product / 3 proof / 1 other)",
          planAdminOverhead: "1 min other",
          testingGateLines: ["- [x] Run typecheck (est: 2 min proof)"],
        },
      ),
    );

    try {
      const result = runPlansCheck(planPath, "--strict");

      assert.equal(result.status, 1);
      assert.match(
        result.stdout,
        /Actual split .* sums to 12 min but Actual says 13 min/u,
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("strict mode rejects an estimate-less milestone while default mode preserves legacy plans", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-check-"));
    const planPath = writeCheckFixture(
      temporaryRoot,
      ["# M01: Legacy milestone", "Status: not-started", ""].join("\n"),
    );

    try {
      const strictResult = runPlansCheck(planPath, "--strict");
      const defaultResult = runPlansCheck(planPath);

      assert.equal(strictResult.status, 1);
      assert.match(
        strictResult.stdout,
        /strict mode requires an Effort estimate/u,
      );
      assert.equal(defaultResult.status, 0, defaultResult.stderr);
      assert.match(defaultResult.stdout, /no effort estimates found/u);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("rejects --strict outside plans check", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", CLI_PATH, "plans", "export", ".", "--strict"],
      { cwd: PROJECT_ROOT, encoding: "utf-8" },
    );

    assert.equal(result.status, 2);
    assert.match(result.stderr, /--strict is only valid for plans check/u);
  });

  // Covers write-oriented flags on a read-only report: writes a plan fixture and expects a usage error.
  it("rejects --force and --output as usage errors", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-check-"));
    const planPath = writeCheckFixture(
      temporaryRoot,
      ["# M01: Any milestone", ""].join("\n"),
    );

    try {
      const forced = runPlansCheck(planPath, "--force");
      assert.equal(forced.status, 2);
      assert.match(forced.stderr, /--force is only valid/u);

      const redirected = runPlansCheck(planPath, "--output", "report.txt");
      assert.equal(redirected.status, 2);
      assert.match(redirected.stderr, /does not support --output/u);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("requires exactly one plan path", () => {
    const result = runPlansCheck();

    assert.equal(result.status, 2);
    assert.match(result.stderr, /plans check requires one <plan-path>/u);
  });
});
