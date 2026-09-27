/** Model contracts; synthetic receipt fixtures are correctness cases, never accuracy evidence. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  forecastPlanWork,
  renderForecastModelSummary,
} from "../../src/cli/plans-forecast-model.js";
import {
  selectedPlanForecastBasis,
  renderCalibrationSummary,
} from "../../src/cli/plans-check-summary.js";
import { parseMilestoneMarkdown } from "../../src/cli/plans-export.js";
import type { selectPlanForecastHistory } from "../../src/cli/plans-forecast-history.js";
import {
  registeredHistoryFixture,
  writeRegisteredHistory,
  eligibleWorkUnitSampleBody,
  runPlansCheck,
} from "./plans-check.helpers.js";

/** Explicit normalized samples isolate numerical policy from filesystem admission, which the history suite owns. */
function selectedRates(
  rates: number[],
): ReturnType<typeof selectPlanForecastHistory> {
  return {
    selection: rates.length >= 3 ? "context-matched" : "selected-plan",
    reason: "contract fixture selection",
    intactCount: rates.length,
    exclusions: [],
    samples: rates.map((rate, index) => ({
      id: `.goat-flow/plans/sample-${index}/M01-work.md`,
      sha256: "a".repeat(64),
      forecastId: "F1",
      registeredAt: "1970-01-01T00:00:00Z",
      completedAt: "1970-01-01T00:01:00Z",
      agentWorkUnits: 3,
      measuredSeconds: rate * 180,
      minutesPerUnit: rate,
    })),
  };
}

describe("registered work forecast model", () => {
  /** Real files prove that CLI wiring delivers the selected model without conflicting legacy replacement advice or writes. */
  it("delivers one reproducible matched range through the CLI and preserves sparse external fallback", () => {
    const root = mkdtempSync(join(tmpdir(), "goat-flow-model-"));
    try {
      const plans = join(root, ".goat-flow", "plans");
      const saved = new Map<string, string>();
      for (const [index, seconds] of [180, 540, 1620].entries()) {
        const fixture = registeredHistoryFixture(100 + index * 2000, seconds);
        const directory = writeRegisteredHistory(
          join(plans, `sibling-${index}`),
          fixture,
        );
        saved.set(join(directory, "M01-work.md"), fixture.body);
        const registration = join(
          directory,
          "evaluation",
          "prospective-registration.json",
        );
        saved.set(registration, readFileSync(registration, "utf8"));
      }
      const target = registeredHistoryFixture(10000, 23, false);
      const selected = writeRegisteredHistory(join(plans, "selected"), target);
      saved.set(join(selected, "M01-work.md"), target.body);
      for (const [index, seconds] of [1200, 2400, 3600].entries()) {
        const id = `M0${index + 2}`;
        const path = join(selected, `${id}-legacy.md`);
        const body = eligibleWorkUnitSampleBody(seconds, id);
        writeFileSync(path, body);
        saved.set(path, body);
      }
      const run = runPlansCheck(selected, "--strict");
      assert.equal(run.status, 0, run.stdout + run.stderr);
      assert.match(
        run.stdout,
        /forecast advice: M01-work.md - 4-24 agent-time minutes; likely 9; experimental; method matched-rates-v1; pool context-matched; 3 samples/u,
      );
      assert.equal(
        run.stdout
          .split("\n")
          .filter((line) => line.startsWith("forecast advice:")).length,
        1,
      );
      assert.doesNotMatch(run.stdout, /reforecast required: M01-work.md/u);
      assert.match(run.stdout, /1 proof executions/u);
      assert.match(run.stdout, /planned category splits are not measurements/u);
      assert.equal(runPlansCheck(selected, "--strict").stdout, run.stdout);
      const external = writeRegisteredHistory(join(root, "external"), target);
      saved.set(join(external, "M01-work.md"), target.body);
      const cold = runPlansCheck(external, "--strict");
      assert.equal(cold.status, 0, cold.stdout + cold.stderr);
      assert.match(
        cold.stdout,
        /forecast advice: M01-work.md - 3-18 agent-time minutes; likely 8; provisional; method matched-rates-v1; pool cold-prior; 0 samples/u,
      );
      assert.match(
        cold.stdout,
        /forecast basis advice: M01-work.md - 3 units \(1 proof executions\); 1\.00-2\.50-6\.00 min\/unit/u,
      );
      for (const [path, body] of saved)
        assert.equal(readFileSync(path, "utf8"), body, path);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("uses published interpolated rates and counted units independently of displayed allocations", () => {
    const { forecast } = registeredHistoryFixture(10000, 23, false);
    const before = JSON.stringify(forecast);
    const selected = selectedRates([9, 1, 3]);
    const fallback = selectedPlanForecastBasis([], forecast);
    const result = forecastPlanWork(forecast, selected, fallback);
    assert.equal(result.selection, "context-matched");
    assert.equal(result.sampleCount, 3);
    assert.equal(result.isCompatible, true);
    assert.deepEqual(result.range, {
      lowMinutes: 4,
      likelyMinutes: 9,
      highMinutes: 24,
    });
    assert.deepEqual(
      [
        result.basis.lowMinutesPerUnit,
        result.basis.likelyMinutesPerUnit,
        result.basis.highMinutesPerUnit,
      ],
      [1.4, 3, 7.8],
    );
    const reallocated = structuredClone(forecast);
    reallocated.items.forEach((item, index) => {
      item.estimateMinutes = [1, 4, 4][index] ?? 3;
    });
    assert.deepEqual(forecastPlanWork(reallocated, selected, fallback), result);
    assert.equal(JSON.stringify(forecast), before);
    const doubled = {
      ...forecast,
      items: forecast.items.flatMap((item) => [
        item,
        { ...item, id: item.id + "-repeat" },
      ]),
    };
    assert.deepEqual(forecastPlanWork(doubled, selected, fallback).range, {
      lowMinutes: 8,
      likelyMinutes: 18,
      highMinutes: 47,
    });
  });

  it("uses the frozen percentile pair without trimming short or extreme measurements", () => {
    const { forecast } = registeredHistoryFixture(10000, 23, false, {
      quantiles: [20, 80],
    });
    const selected = selectedRates([0.01, 3, 100]);
    const result = forecastPlanWork(
      forecast,
      selected,
      selectedPlanForecastBasis([], forecast),
    );
    assert.deepEqual(result.range, {
      lowMinutes: 3,
      likelyMinutes: 9,
      highMinutes: 184,
    });
    assert.deepEqual(
      [result.basis.lowMinutesPerUnit, result.basis.highMinutesPerUnit],
      [1.21, 61.2],
    );
  });

  it("retains issued values when positive-integer allocation or published rates cannot express matched output", () => {
    const { forecast } = registeredHistoryFixture(10000, 23, false);
    for (const rates of [
      [0.001, 0.002, 0.003],
      [0.1, 0.2, 0.3],
      [0.01, 1, 3],
    ]) {
      const result = forecastPlanWork(
        forecast,
        selectedRates(rates),
        selectedPlanForecastBasis([], forecast),
      );
      assert.equal(result.isCompatible, false);
      assert.deepEqual(result.range, forecast.range);
      assert.deepEqual(result.basis, forecast.basis);
      assert.match(result.reason, /retain issued values/u);
      assert.ok(
        result.attemptedRange.lowMinutes < 1 ||
          (result.attemptedRange.likelyMinutes ?? 0) < forecast.items.length,
      );
    }
  });

  it("floors only the likely when history runs under one minute per unit and its high rate reaches one", () => {
    const { forecast } = registeredHistoryFixture(10000, 23, false);
    // The median of three rates is the computed likely; three units at this rate round to two minutes, under the unit count.
    const medianRate = 0.8;
    const result = forecastPlanWork(
      forecast,
      selectedRates([0.5, medianRate, 2]),
      selectedPlanForecastBasis([], forecast),
    );
    assert.equal(result.isCompatible, true);
    assert.equal(result.likelyFlooredFrom, medianRate);
    assert.deepEqual(result.range, {
      lowMinutes: 1,
      likelyMinutes: 3,
      highMinutes: 6,
    });
    assert.deepEqual(
      [
        result.basis.lowMinutesPerUnit,
        result.basis.likelyMinutesPerUnit,
        result.basis.highMinutesPerUnit,
      ],
      [0.56, 1, 1.76],
    );
    assert.equal(result.attemptedRange.likelyMinutes, 2);
    assert.match(
      result.reason,
      /likely floored at 1\.00 min\/unit from 0\.80/u,
    );

    // A high rate under one minute per unit cannot hold a floored likely, so the issued values stay.
    const tooFast = forecastPlanWork(
      forecast,
      selectedRates([0.5, 0.6, 0.9]),
      selectedPlanForecastBasis([], forecast),
    );
    assert.equal(tooFast.isCompatible, false);
    assert.equal(tooFast.likelyFlooredFrom, null);
    assert.deepEqual(tooFast.range, forecast.range);

    // Rendered through the selected-plan fallback: three fast finished samples, then an unstarted target.
    const records = [
      ...[90, 144, 360].map((seconds, index) =>
        parseMilestoneMarkdown(
          eligibleWorkUnitSampleBody(seconds, `M0${index + 1}`),
          `M0${index + 1}-sample.md`,
        ),
      ),
      parseMilestoneMarkdown(
        registeredHistoryFixture(20000, 23, false).body,
        "M04-target.md",
      ),
    ];
    const lines = renderForecastModelSummary(records, {
      root: null,
      sources: [],
      exclusions: [],
    });
    assert.match(
      lines.join("\n"),
      /forecast advice: M04-target\.md - 1-6 agent-time minutes; likely 3; provisional, likely floored; method matched-rates-v1; pool selected-plan; 3 samples/u,
    );
    assert.match(
      lines.join("\n"),
      /forecast basis advice: M04-target\.md - 3 units \(1 proof executions\); 0\.56-1\.00-1\.76 min\/unit; .*likely floored at 1\.00 min\/unit from 0\.80/u,
    );
    assert.doesNotMatch(lines.join("\n"), /forecast abstention:/u);
  });

  it("reproduces selected-plan fallback and cold prior using only outcomes earlier than issue", () => {
    const { forecast } = registeredHistoryFixture(20000, 23, false);
    const records = [180, 540, 1620].map((seconds, index) => {
      const fixture = registeredHistoryFixture(100 + index * 2000, seconds);
      return parseMilestoneMarkdown(fixture.body, `M0${index + 1}-work.md`);
    });
    const fallback = selectedPlanForecastBasis(records, forecast);
    const result = forecastPlanWork(
      forecast,
      selectedRates([99, 100]),
      fallback,
    );
    assert.equal(result.selection, "selected-plan");
    assert.equal(result.sampleCount, 3);
    assert.deepEqual(result.range, {
      lowMinutes: 4,
      likelyMinutes: 9,
      highMinutes: 24,
    });
    assert.ok(
      renderCalibrationSummary(records).includes(
        "work-unit calibration: 3 eligible measured samples - median 3.00 min/unit, p10-p90 1.40-7.80 min/unit",
      ),
    );
    for (const [sampleCount, completion] of [
      100 + 180,
      2100 + 540,
      4100 + 1620,
    ].entries()) {
      const tied = {
        ...forecast,
        issuedAt: new Date(completion * 1000).toISOString(),
      };
      const cold = forecastPlanWork(
        tied,
        selectedRates([]),
        selectedPlanForecastBasis(records, tied),
      );
      assert.equal(cold.selection, "cold-prior");
      assert.deepEqual(cold.basis, {
        agentWorkUnits: 3,
        lowMinutesPerUnit: 1,
        likelyMinutesPerUnit: 2.5,
        highMinutesPerUnit: 6,
        source: "cold-start prior",
      });
      assert.deepEqual(cold.range, {
        lowMinutes: 3,
        likelyMinutes: 8,
        highMinutes: 18,
      });
      assert.equal(cold.sampleCount, sampleCount);
    }
  });

  it("withholds whole-work replacements after timing begins and preserves the original forecast", () => {
    const fixture = registeredHistoryFixture(100, 540);
    const record = parseMilestoneMarkdown(
      fixture.body.replace("Status: complete", "Status: in-progress"),
      "M01-work.md",
    );
    const before = JSON.stringify(record);
    const lines = renderForecastModelSummary([record], {
      root: null,
      sources: [],
      exclusions: [],
    });
    assert.equal(lines.length, 1);
    assert.match(
      lines[0] ?? "",
      /retain issued whole forecast F1 and append a remaining-work snapshot/u,
    );
    assert.equal(JSON.stringify(record), before);
  });
});
