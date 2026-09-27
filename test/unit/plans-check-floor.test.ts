/**
 * How the checker advises a plan whose measured history runs under one minute per work unit. Whole-minute items
 * cannot sum below the unit count, so the advised likely is floored at one minute per unit and says so.
 * Both cases run the real CLI against written milestones.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  eligibleWorkUnitSampleBody,
  estimatedMilestoneBody,
  runPlansCheck,
  writeCheckPlan,
} from "./plans-check.helpers.js";

/** Three finished three-unit samples at 0.5, 0.8 and 2.0 minutes per unit: published local rates 0.56-0.80-1.76. */
function fastHistory(): Record<string, string> {
  return {
    "M01-fast.md": eligibleWorkUnitSampleBody(90),
    "M02-middle.md": eligibleWorkUnitSampleBody(144, "M02"),
    "M03-slow.md": eligibleWorkUnitSampleBody(360, "M03"),
  };
}

/** Keep only the reforecast advice for the unfinished milestone, so each case states the whole line an author reads. */
function reforecastAdvice(stdout: string): string[] {
  return stdout
    .split("\n")
    .filter((line) => line.startsWith("reforecast required: M04-future.md"));
}

describe("plans check: likely floor for fast plans", () => {
  /** Fixture purpose: a cold-start milestone beside fast history shows the advice an author reads before copying rates.
   * Filesystem side effects: writes four milestones under one temporary root, then removes that root. */
  it("advises the floored likely and names the computed rate", () => {
    const root = mkdtempSync(join(tmpdir(), "goat-flow-likely-floor-"));
    try {
      const plan = writeCheckPlan(root, {
        ...fastHistory(),
        "M04-future.md": estimatedMilestoneBody(
          "Effort estimate: ~8 min agent-time (2 product / 3 proof / 3 other)",
          ["- [ ] Build the result (est: 2 min product)"],
          {
            title: "M04: Future milestone",
            forecastBasisLine:
              "Forecast basis: 3 agent work units; 0.5-2.5-6 min/unit low-likely-high; source: cold-start prior",
            forecastRangeLine:
              "Forecast range: 1-18 agent-time minutes on one recorded-unpaused milestone timeline; likely 8; cold-start prior",
            planAdminOverhead: "3 min other",
            testingGateLines: ["- [ ] Prove the result (est: 3 min proof)"],
          },
        ),
      });
      const result = runPlansCheck(plan, "--strict");
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.deepEqual(reforecastAdvice(result.stdout), [
        "reforecast required: M04-future.md - 3 agent work units imply 1-6 agent-time minutes; likely 3 from local evidence; use 0.56-1.00-1.76 min/unit before implementation; likely floored at 1.00 min/unit from 0.80 because whole-minute items cannot sum lower",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /** Fixture purpose: the same history with the advised rates already copied proves strict validation accepts a floored basis.
   * Filesystem side effects: writes four milestones under one temporary root, then removes that root. */
  it("accepts a milestone that copied the floored rates and asks for nothing more", () => {
    const root = mkdtempSync(join(tmpdir(), "goat-flow-likely-floor-"));
    try {
      const plan = writeCheckPlan(root, {
        ...fastHistory(),
        "M04-future.md": estimatedMilestoneBody(
          "Effort estimate: ~3 min agent-time (1 product / 1 proof / 1 other)",
          ["- [ ] Build the result (est: 1 min product)"],
          {
            title: "M04: Future milestone",
            forecastBasisLine:
              "Forecast basis: 3 agent work units; 0.56-1.00-1.76 min/unit low-likely-high; source: local p10/p90 receipt history, likely floored at 1.00 from 0.80",
            forecastRangeLine:
              "Forecast range: 1-6 agent-time minutes on one recorded-unpaused milestone timeline; likely 3; floored likely",
            planAdminOverhead: "1 min other",
            testingGateLines: ["- [ ] Prove the result (est: 1 min proof)"],
          },
        ),
      });
      const result = runPlansCheck(plan, "--strict");
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.deepEqual(reforecastAdvice(result.stdout), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
