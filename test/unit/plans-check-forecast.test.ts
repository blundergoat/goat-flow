/**
 * How the checker reports the future: countable inputs, forecast bands,
 * minutes-per-unit history, and read-only usage errors. It runs the real CLI
 * against written milestones, so failures match what plan authors see in the
 * terminal before implementation begins.
 */
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCLIArgs } from "../../src/cli/cli-parser.js";
import { CLIError } from "../../src/cli/cli-error.js";
import {
  interpolatedQuantile,
  renderCalibrationSummary,
} from "../../src/cli/plans-check-summary.js";
import { parseMilestoneMarkdown } from "../../src/cli/plans-export.js";
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
  receiptStamp,
} from "./plans-check.helpers.js";

describe("plans check: configured forecast bands", () => {
  it("rejects malformed percentile flags and flags outside the check route", () => {
    for (const raw of [
      "",
      "10",
      "10,90,95",
      "0,90",
      "10,100",
      "50,90",
      "10,50",
      "90,10",
      "NaN,90",
      "10,Infinity",
      "1e1,90",
      "10, 90",
    ]) {
      assert.throws(
        () => parseCLIArgs(["plans", "check", ".", "--band-quantiles", raw]),
        (error: unknown) =>
          error instanceof CLIError &&
          error.exitCode === 2 &&
          /--band-quantiles/u.test(error.message),
        raw,
      );
    }
    for (const args of [
      ["plans", "export", ".", "--band-quantiles", "20,80"],
      ["plans", "check", ".", "--band-quantiles"],
    ]) {
      assert.throws(
        () => parseCLIArgs(args),
        (error: unknown) =>
          error instanceof CLIError &&
          error.exitCode === 2 &&
          /--band-quantiles/u.test(error.message),
      );
    }
  });

  /** Fixture purpose: identical temporary histories isolate project ownership and flag precedence through the real CLI.
   * Filesystem side effects: writes config and plans under one temporary root, then removes that root. */
  it("uses the selected canonical project's pair, lets a flag override it, and leaves external plans at defaults", () => {
    const root = mkdtempSync(join(tmpdir(), "goat-flow-band-policy-"));
    try {
      const files = Object.fromEntries(
        [180, 540, 1620].map((seconds, index) => [
          `M0${index + 1}-sample.md`,
          eligibleWorkUnitSampleBody(seconds, `M0${index + 1}`),
        ]),
      );
      const canonical = writeCheckPlan(
        join(root, ".goat-flow", "plans"),
        files,
      );
      const external = writeCheckPlan(join(root, "external"), files);
      const configPath = join(root, ".goat-flow", "config.yaml");
      const config = "plans:\n  forecastBandQuantiles: [20, 80]\n";
      writeFileSync(configPath, config);
      for (const [plan, flags, pair, rates] of [
        [canonical, [], "p20-p80", "1.80-6.60"],
        [canonical, ["--band-quantiles", "12.5,95"], "p12.5-p95", "1.50-8.40"],
        [external, [], "p10-p90", "1.40-7.80"],
      ] as const) {
        const result = runPlansCheck(plan, ...flags);
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.ok(
          result.stdout.includes(
            `median 3.00 min/unit, ${pair} ${rates} min/unit`,
          ),
          result.stdout,
        );
        assert.match(
          result.stdout,
          /rule coverage: scored 0 of 3 eligible work-unit samples; no score \(n\/a\)/u,
        );
      }
      assert.equal(readFileSync(configPath, "utf8"), config);
      writeFileSync(configPath, "plans:\n  forecastBandQuantiles: [50, 90]\n");
      const invalid = runPlansCheck(canonical);
      assert.equal(invalid.status, 2);
      assert.match(
        invalid.stderr,
        /plans\.forecastBandQuantiles.*0 < low < 50 < high < 100/u,
      );
      assert.equal(runPlansCheck(canonical, "--max-active", "1").status, 2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /** Vary completion time independently of the measured rate so tied and future samples can expose training leakage. */
  const replayRecord = (seconds: number, id: number, completion: number) => {
    const milestoneId = `M${String(id).padStart(2, "0")}`;
    const body = eligibleWorkUnitSampleBody(seconds, milestoneId)
      .replace(receiptStamp(100), receiptStamp(completion - seconds))
      .replace(receiptStamp(100 + seconds), receiptStamp(completion));
    return parseMilestoneMarkdown(body, `${milestoneId}-sample.md`);
  };

  it("replays tied completions from strictly earlier history with nested bands and a fixed median", () => {
    const prior = Array.from({ length: 8 }, (_, i) =>
      replayRecord((i + 1) * 180, i + 1, 10000 + i * 10000),
    );
    const missing = replayRecord(18000, 12, 70000);
    assert.ok(missing.timingReceipt);
    missing.timingReceipt.segments = [];
    const records = [
      ...prior,
      replayRecord(360, 9, 90000),
      replayRecord(1260, 10, 90000),
      replayRecord(720, 11, 100000),
      missing,
    ];
    const wide = renderCalibrationSummary(records, [10, 90]);
    const narrow = renderCalibrationSummary([...records].reverse(), [20, 80]);
    const samples = (lines: string[]) =>
      lines.filter((line) => line.startsWith("rule sample:"));
    assert.deepEqual(samples(wide), [
      "rule sample: M09-sample.md - completion epoch 90000; prior 8; rates 1.70-4.50-7.30 min/unit; 3 units; band 5-22 min; likely 14; actual 360s; inside",
      "rule sample: M10-sample.md - completion epoch 90000; prior 8; rates 1.70-4.50-7.30 min/unit; 3 units; band 5-22 min; likely 14; actual 1260s; inside",
      "rule sample: M11-sample.md - completion epoch 100000; prior 10; rates 1.90-4.50-7.10 min/unit; 3 units; band 5-22 min; likely 14; actual 720s; inside",
    ]);
    assert.deepEqual(samples(narrow), [
      "rule sample: M09-sample.md - completion epoch 90000; prior 8; rates 2.40-4.50-6.60 min/unit; 3 units; band 7-20 min; likely 14; actual 360s; below",
      "rule sample: M10-sample.md - completion epoch 90000; prior 8; rates 2.40-4.50-6.60 min/unit; 3 units; band 7-20 min; likely 14; actual 1260s; above",
      "rule sample: M11-sample.md - completion epoch 100000; prior 10; rates 2.00-4.50-7.00 min/unit; 3 units; band 6-21 min; likely 14; actual 720s; inside",
    ]);
    assert.ok(
      wide.includes(
        "rule coverage: scored 3 of 12 eligible work-unit samples; 3 of 3 inside (100.0%) - 0 below, 0 above; skipped 8 insufficient history, 1 missing completion time",
      ),
    );
    assert.ok(
      narrow.includes(
        "rule coverage: scored 3 of 12 eligible work-unit samples; 1 of 3 inside (33.3%) - 1 below, 1 above; skipped 8 insufficient history, 1 missing completion time",
      ),
    );
    assert.ok(
      wide.includes(
        "rule skip: M12-sample.md - no usable closed completion time; excluded from replay and training",
      ),
    );
    assert.equal(
      wide.find((line) => line.startsWith("band coverage:")),
      narrow.find((line) => line.startsWith("band coverage:")),
    );
    assert.deepEqual(
      samples(wide),
      samples(renderCalibrationSummary([...records].reverse())),
    );
  });

  it("discloses no score for empty history and for a tied group with only seven earlier samples", () => {
    assert.ok(
      renderCalibrationSummary([]).includes(
        "rule coverage: scored 0 of 0 eligible work-unit samples; no score (n/a); skipped 0 insufficient history, 0 missing completion time",
      ),
    );
    const prior = Array.from({ length: 7 }, (_, i) =>
      replayRecord(180, i + 1, 10000 + i * 10000),
    );
    const lines = renderCalibrationSummary([
      ...prior,
      replayRecord(180, 8, 80000),
      replayRecord(180, 9, 80000),
    ]);
    assert.ok(
      lines.includes(
        "rule coverage: scored 0 of 9 eligible work-unit samples; no score (n/a); skipped 9 insufficient history, 0 missing completion time",
      ),
    );
    assert.ok(
      lines.includes(
        "rule skip: M08-sample.md - completion epoch 80000; only 7 earlier samples (minimum 8)",
      ),
    );
    assert.ok(
      lines.includes(
        "rule skip: M09-sample.md - completion epoch 80000; only 7 earlier samples (minimum 8)",
      ),
    );
  });
});

describe("plans check: calibration eligibility", () => {
  /** The real parser supplies receipt shapes; summary assertions distinguish admission from explanation. */
  const parseSample = (body = eligibleWorkUnitSampleBody(30)) =>
    parseMilestoneMarkdown(body, "M01-sample.md");

  it("explains common exclusions consistently for both pools", () => {
    const eligible = parseSample();
    assert.ok(eligible.effort);
    const cases = [
      ["missing effort estimate", { ...parseSample(), effort: undefined }],
      [
        "missing receipt summary",
        { ...parseSample(), timingReceipt: undefined },
      ],
      [
        "estimate is not positive",
        { ...eligible, effort: { ...eligible.effort, totalMinutes: 0 } },
      ],
      [
        "raw receipt seconds are not positive",
        parseSample(eligibleWorkUnitSampleBody(0)),
      ],
      ...[
        "unavailable: category allocation missing",
        "incomplete: receipt missing a span",
        "retrospective: ~1 min agent-time - reconstructed",
      ].map(
        (actual) =>
          [
            "Actual is not measured",
            parseSample(
              eligibleWorkUnitSampleBody(30).replace(
                /^Actual:.*$/mu,
                `Actual: ${actual}`,
              ),
            ),
          ] as const,
      ),
    ] as const;
    for (const [reason, record] of cases) {
      const lines = renderCalibrationSummary([record]);
      assert.ok(
        lines.includes(
          `calibration exclusion: M01-sample.md - both pools: ${reason}`,
        ),
      );
      assert.ok(
        lines.includes(
          "calibration: uncalibrated - 0 of 3 eligible measured samples",
        ),
      );
      assert.ok(
        lines.includes(
          "work-unit calibration: uncalibrated - 0 of 3 eligible measured samples with countable bases",
        ),
      );
    }
  });

  it("keeps positive raw receipts even when rounded zero or below the rejected rate floor", () => {
    for (const seconds of [20, 30]) {
      const record = parseSample(eligibleWorkUnitSampleBody(seconds));
      const lines = renderCalibrationSummary([record]);
      assert.ok(
        lines.includes(
          "calibration: uncalibrated - 1 of 3 eligible measured samples",
        ),
      );
      assert.ok(
        lines.includes(
          "work-unit calibration: uncalibrated - 1 of 3 eligible measured samples with countable bases",
        ),
      );
      assert.equal(
        lines.some((line) => line.startsWith("calibration note:")),
        seconds === 20,
      );
      if (seconds === 20)
        assert.ok(
          lines.includes(
            "calibration note: M01-sample.md - 20s raw rounds to 0 min; estimate-ratio eligible; work-unit eligible",
          ),
        );
      assert.doesNotMatch(
        lines.join("\n"),
        /late timer|invalid receipt|fabricated/iu,
      );
    }
  });

  it("explains missing and stale bases without excluding valid ratio samples", () => {
    for (const [body, reason] of [
      [eligibleSampleBody(20), "missing countable forecast basis"],
      [
        eligibleWorkUnitSampleBody(20).replace(
          "3 agent work units;",
          "4 agent work units;",
        ),
        "forecast basis declares 4 units; current count is 3",
      ],
    ]) {
      const lines = renderCalibrationSummary([parseSample(body)]);
      assert.ok(
        lines.includes(
          `calibration exclusion: M01-sample.md - work-unit pool only: ${reason}; estimate-ratio eligible`,
        ),
      );
      assert.ok(
        lines.includes(
          "calibration: uncalibrated - 1 of 3 eligible measured samples",
        ),
      );
      assert.ok(
        lines.includes(
          "work-unit calibration: uncalibrated - 0 of 3 eligible measured samples with countable bases",
        ),
      );
      assert.ok(
        lines.includes(
          "calibration note: M01-sample.md - 20s raw rounds to 0 min; estimate-ratio eligible; work-unit excluded",
        ),
      );
    }
  });

  it("aggregates non-complete exclusions only when a completed cohort exists", () => {
    const unfinished = [
      "not-started",
      "human-verification-pending",
      "abandoned",
    ].map((status) => ({ ...parseSample(), status }));
    const lines = renderCalibrationSummary([parseSample(), ...unfinished]);
    assert.ok(
      lines.includes(
        "calibration eligibility: 3 non-complete milestones excluded from both pools",
      ),
    );
    assert.equal(
      lines.filter((line) => line.startsWith("calibration exclusion:")).length,
      0,
    );
    assert.equal(
      renderCalibrationSummary(unfinished).some((line) =>
        line.startsWith("calibration eligibility:"),
      ),
      false,
    );
  });
});

describe("plans check: historical forecast diagnostics", () => {
  /** Attach a stored band to the existing receipt-backed CLI fixture. */
  function rangedSample(
    seconds: number,
    milestoneId: string,
    low: number,
    high: number,
  ): string {
    return eligibleSampleBody(seconds, milestoneId).replace(
      "Actual: measured:",
      `Forecast range: ${low}-${high} agent-time minutes on one recorded-unpaused milestone timeline; likely 10; recorded fixture band\nActual: measured:`,
    );
  }

  const cases = [
    {
      name: "uses inclusive endpoints, raw seconds and the median band width",
      files: {
        "M01-below.md": rangedSample(299, "M01", 5, 20),
        "M02-lower.md": rangedSample(300, "M02", 5, 10),
        "M03-upper.md": rangedSample(600, "M03", 2, 10),
        "M04-above.md": rangedSample(601, "M04", 5, 10),
      },
      coverage:
        "band coverage: 2 of 4 inside (50.0%) - 1 below, 1 above; median width 3.00x",
      total: "plan total: 30.00/40 = 0.75x over 4 measured",
    },
    {
      name: "keeps range-less receipts in totals and excludes incomplete Actuals",
      files: {
        "M01-legacy.md": eligibleSampleBody(301, "M01"),
        "M02-ranged.md": rangedSample(600, "M02", 2, 20),
        "M03-incomplete.md": rangedSample(36000, "M03", 5, 10).replace(
          /^Actual:.*$/mu,
          "Actual: incomplete: controlled missing measurement",
        ),
      },
      coverage:
        "band coverage: 1 of 1 inside (100.0%) - 0 below, 0 above; median width 10.00x",
      total: "plan total: 15.02/20 = 0.75x over 2 measured",
    },
    {
      name: "reports unavailable diagnostics when no milestone is scoreable",
      files: {
        "M01-pending.md": eligibleSampleBody(
          300,
          "M01",
          "human-verification-pending",
        ),
      },
      coverage:
        "band coverage: 0 of 0 inside (n/a) - 0 below, 0 above; median width n/a",
      total: "plan total: unavailable over 0 measured",
    },
    {
      name: "retains coverage for a valid zero lower bound with unbounded width",
      files: { "M01-zero.md": rangedSample(300, "M01", 0, 20) },
      coverage:
        "band coverage: 1 of 1 inside (100.0%) - 0 below, 0 above; median width unbounded",
      total: "plan total: 5.00/10 = 0.50x over 1 measured",
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      const root = mkdtempSync(join(tmpdir(), "goat-flow-band-diagnostics-"));
      const plan = writeCheckPlan(root, testCase.files);
      try {
        const result = runPlansCheck(plan, "--strict");
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.ok(result.stdout.includes(testCase.coverage), result.stdout);
        assert.ok(result.stdout.includes(testCase.total), result.stdout);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
});

describe("plans check: quantile-based reforecasting", () => {
  /**
   * Three short receipts must clamp advice to one minute while the authored plan stays valid.
   * Writes temporary plan files, runs the CLI, then removes the fixtures.
   */
  it("keeps the one-minute clamp for sub-minute quantile forecasts", () => {
    const root = mkdtempSync(join(tmpdir(), "goat-flow-quantile-clamp-"));
    const plan = writeCheckPlan(root, {
      "M01-fast.md": eligibleWorkUnitSampleBody(18),
      "M02-middle.md": eligibleWorkUnitSampleBody(36, "M02"),
      "M03-slow.md": eligibleWorkUnitSampleBody(54, "M03"),
      "M04-future.md": estimatedMilestoneBody(
        "Effort estimate: ~9 min agent-time (3 product / 3 proof / 3 other)",
        ["- [ ] Build the result (est: 3 min product)"],
        {
          title: "M04: Future milestone",
          forecastBasisLine:
            "Forecast basis: 3 agent work units; 0.5-3-10 min/unit low-likely-high; source: recorded fixture basis",
          forecastRangeLine:
            "Forecast range: 1-30 agent-time minutes on one recorded-unpaused milestone timeline; likely 9; recorded fixture range",
          planAdminOverhead: "3 min other",
          testingGateLines: ["- [ ] Prove the result (est: 3 min proof)"],
        },
      ),
    });
    try {
      const result = runPlansCheck(plan, "--strict");
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.ok(
        result.stdout.includes(
          "3 agent work units imply 1-1 agent-time minutes; likely 1 from local evidence; use 0.12-0.20-0.28 min/unit",
        ),
        result.stdout,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  const quantileCases = [
    { name: "empty sample", values: [], p: 0.9, expected: 0 },
    { name: "single sample", values: [7], p: 0.1, expected: 7 },
    {
      name: "three-sample lower interpolation",
      values: [1, 5, 9],
      p: 0.1,
      expected: 1.8,
    },
    {
      name: "three-sample upper interpolation",
      values: [1, 5, 9],
      p: 0.9,
      expected: 8.2,
    },
    {
      name: "four-sample index convention",
      values: [1, 2, 4, 8],
      p: 0.25,
      expected: 1.75,
    },
    { name: "zero quantile", values: [1, 2, 4], p: 0, expected: 1 },
    { name: "one quantile", values: [1, 2, 4], p: 1, expected: 4 },
  ];
  for (const testCase of quantileCases) {
    it(`interpolates ${testCase.name}`, () => {
      assert.equal(
        interpolatedQuantile(testCase.values, testCase.p),
        testCase.expected,
      );
    });
  }

  const cases = [
    {
      name: "suppresses changed rates when all published derived bounds agree",
      rates: "2.01-3.01-3.99",
      low: 6,
      high: 12,
      likely: 9,
      product: 3,
      requiresReforecast: false,
    },
    {
      name: "reports a changed derived lower bound",
      rates: "1.99-3.01-3.99",
      low: 5,
      high: 12,
      likely: 9,
      product: 3,
      requiresReforecast: true,
    },
    {
      name: "reports a changed derived likely value",
      rates: "2.01-3.20-3.99",
      low: 6,
      high: 12,
      likely: 10,
      product: 4,
      requiresReforecast: true,
    },
    {
      name: "reports a changed derived upper bound",
      rates: "2.01-3.01-4.01",
      low: 6,
      high: 13,
      likely: 9,
      product: 3,
      requiresReforecast: true,
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      const root = mkdtempSync(join(tmpdir(), "goat-flow-derived-reforecast-"));
      // Raw quantiles exceed 2 and 4 slightly; copied rates must still derive 6-12.
      const plan = writeCheckPlan(root, {
        "M01-fast.md": eligibleWorkUnitSampleBody(315),
        "M02-middle.md": eligibleWorkUnitSampleBody(543, "M02"),
        "M03-slow.md": eligibleWorkUnitSampleBody(765, "M03"),
        "M04-future.md": estimatedMilestoneBody(
          `Effort estimate: ~${testCase.likely} min agent-time (${testCase.product} product / 3 proof / 3 other)`,
          [`- [ ] Build the result (est: ${testCase.product} min product)`],
          {
            title: "M04: Future milestone",
            forecastBasisLine: `Forecast basis: 3 agent work units; ${testCase.rates} min/unit low-likely-high; source: recorded fixture basis`,
            forecastRangeLine: `Forecast range: ${testCase.low}-${testCase.high} agent-time minutes on one recorded-unpaused milestone timeline; likely ${testCase.likely}; recorded fixture range`,
            planAdminOverhead: "3 min other",
            testingGateLines: ["- [ ] Prove the result (est: 3 min proof)"],
          },
        ),
      });
      try {
        const result = runPlansCheck(plan, "--strict");
        assert.equal(result.status, 0, result.stdout + result.stderr);
        const advice = result.stdout
          .split("\n")
          .find((line) =>
            line.startsWith("reforecast required: M04-future.md"),
          );
        assert.equal(
          advice !== undefined,
          testCase.requiresReforecast,
          result.stdout,
        );
        if (testCase.requiresReforecast) {
          assert.equal(
            advice,
            "reforecast required: M04-future.md - 3 agent work units imply 6-12 agent-time minutes; likely 9 from local evidence; use 2.00-3.02-4.00 min/unit before implementation",
          );
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
});

describe("plans check: forecasts, calibration, and CLI usage", () => {
  /** Writes a basis-only fixture to guard the missing-range rejection in default mode as well as strict mode. */
  it("default mode requires the derived range when a forecast basis is supplied", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-basis-range-"),
    );
    const planPath = writeCheckFixture(
      temporaryRoot,
      estimatedMilestoneBody(
        "Effort estimate: ~8 min agent-time (3 product / 3 proof / 2 other)",
        ["- [ ] Build the thing (est: 3 min product)"],
        {
          forecastBasisLine:
            "Forecast basis: 3 agent work units; 0.5-2.5-10 min/unit low-likely-high; source: cold-start prior",
          planAdminOverhead: "2 min other",
          testingGateLines: ["- [ ] Run typecheck (est: 3 min proof)"],
        },
      ),
    );
    try {
      const result = runPlansCheck(planPath);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(
        result.stdout,
        /Forecast basis requires a derived Forecast range/u,
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

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
        /work-unit calibration: 3 eligible measured samples - median 3\.33 min\/unit, p10-p90 2\.00-6\.00 min\/unit/u,
      );
      assert.match(
        result.stdout,
        /reforecast required: M04-future\.md - 4 agent work units imply 8-24 agent-time minutes; likely 13 from local evidence/u,
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
