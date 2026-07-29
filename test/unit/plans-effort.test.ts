/**
 * Verifies the effort-estimate notation grammar directly: milestone effort
 * lines, per-task est entries, and category sums parse one way for both
 * `plans export` and `plans check`, with legacy absence staying warning-free.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  parseEffortLineValue,
  readPlanAdminEstimate,
  readTaskEstimate,
  renderActualLine,
  renderEffortLine,
  sumTaskEstimates,
} from "../../src/cli/plans-effort.js";

describe("plans effort notation", () => {
  it("parses a bare effort value with split and no Actual", () => {
    const warnings: string[] = [];
    const effort = parseEffortLineValue(
      "~25 min agent-time (18 product / 5 proof / 2 other)",
      warnings,
    );

    assert.deepEqual(effort, {
      totalMinutes: 25,
      split: { product: 18, proof: 5, other: 2 },
    });
    assert.deepEqual(warnings, []);
  });

  it("parses a structured Actual tail with an optional reason", () => {
    const warnings: string[] = [];
    const effort = parseEffortLineValue(
      "~44 min agent-time (34 product / 7 proof / 3 other) | **Actual:** ~51 min agent-time (39 product / 9 proof / 3 other) - one extra proof cycle",
      warnings,
    );

    assert.deepEqual(effort?.actual, {
      totalMinutes: 51,
      split: { product: 39, proof: 9, other: 3 },
      reason: "one extra proof cycle",
    });
    assert.deepEqual(warnings, []);
  });

  it("parses a separate structured Actual field", () => {
    const warnings: string[] = [];
    const effort = parseEffortLineValue(
      "~25 min agent-time (18 product / 5 proof / 2 other)",
      warnings,
      "~35 min agent-time (22 product / 10 proof / 3 other) - rotation needed another check",
    );

    assert.deepEqual(effort?.actual, {
      totalMinutes: 35,
      split: { product: 22, proof: 10, other: 3 },
      reason: "rotation needed another check",
    });
    assert.deepEqual(warnings, []);
  });

  it("treats an empty value as legacy silence and drifted text as a warning", () => {
    const warnings: string[] = [];

    assert.equal(parseEffortLineValue("", warnings), undefined);
    assert.deepEqual(warnings, []);

    assert.equal(parseEffortLineValue("about a day", warnings), undefined);
    assert.deepEqual(warnings, ["effort estimate not parseable"]);
  });

  it("warns when a supplied Actual is not machine-readable", () => {
    const warnings: string[] = [];
    const effort = parseEffortLineValue(
      "~10 min agent-time (7 product / 2 proof / 1 other)",
      warnings,
      "about half an hour",
    );

    assert.equal(effort?.actual, undefined);
    assert.deepEqual(warnings, ["actual effort not parseable"]);
  });

  it("parses well-formed task est entries and warns on drifted ones", () => {
    const warnings: string[] = [];

    assert.deepEqual(
      readTaskEstimate("Build the parser (est: 8 min product)", 0, warnings),
      { estimateMinutes: 8, estimateCategory: "product" },
    );
    assert.deepEqual(
      readTaskEstimate("Plain task without entry", 1, warnings),
      {},
    );
    assert.deepEqual(
      readTaskEstimate("Vague task (est: soon)", 2, warnings),
      {},
    );
    assert.deepEqual(
      readTaskEstimate("Foreign category (est: 5 min docs)", 3, warnings),
      {},
    );
    assert.deepEqual(warnings, [
      "task 3: estimate not parseable",
      "task 4: estimate not parseable",
    ]);
  });

  it("parses plan/admin overhead only as other work", () => {
    const warnings: string[] = [];

    assert.deepEqual(readPlanAdminEstimate("2 min other", warnings), {
      estimateMinutes: 2,
      estimateCategory: "other",
    });
    assert.deepEqual(readPlanAdminEstimate("", warnings), {});
    assert.deepEqual(readPlanAdminEstimate("2 min proof", warnings), {});
    assert.deepEqual(warnings, [
      "plan/admin overhead estimate not parseable",
    ]);
  });

  it("sums estimates by category and stays absent without any", () => {
    assert.equal(sumTaskEstimates([{}, {}]), undefined);
    assert.deepEqual(
      sumTaskEstimates([
        { estimateMinutes: 8, estimateCategory: "product" },
        { estimateMinutes: 4, estimateCategory: "product" },
        { estimateMinutes: 5, estimateCategory: "proof" },
      ]),
      { product: 12, proof: 5, other: 0 },
    );
  });

  it("renders effort back into the notation authors write", () => {
    assert.equal(
      renderEffortLine({
        totalMinutes: 25,
        split: { product: 18, proof: 5, other: 2 },
        actual: {
          totalMinutes: 35,
          split: { product: 22, proof: 10, other: 3 },
          reason: "one extra proof cycle",
        },
      }),
      "**Effort estimate:** ~25 min agent-time (18 product / 5 proof / 2 other)",
    );
    assert.equal(
      renderActualLine({
        totalMinutes: 35,
        split: { product: 22, proof: 10, other: 3 },
        reason: "one extra proof cycle",
      }),
      "**Actual:** ~35 min agent-time (22 product / 10 proof / 3 other) - one extra proof cycle",
    );
  });
});
