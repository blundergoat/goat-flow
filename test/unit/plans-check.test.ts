/**
 * How the checker treats the numbers a plan author writes: required task estimates, category sums, legacy estimate-less plans, and mix drift.
 * Every case runs the real CLI against a written milestone, so failures match the guidance users see before implementation rather than internals.
 * Temporary plans are removed after each case, leaving only the asserted terminal contract.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runPlansCheck,
  writeCheckFixture,
  writeCheckPlan,
  estimatedMilestoneBody,
  canonicalMilestoneBody,
  withActiveTimingReceipt,
  receiptStamp,
} from "./plans-check.helpers.js";

describe("plans check: effort arithmetic and plan shapes", () => {
  const timingEvidenceFailureCases = [
    {
      name: "an open segment on an inactive milestone",
      body: withActiveTimingReceipt(
        canonicalMilestoneBody({
          status: "blocked",
          statusReason: "Waiting for receipt recovery before resuming.",
        }),
      ).replace("**Receipt state:** active", "**Receipt state:** incomplete"),
      expected: /blocked milestone must not have an active Timing Receipt/u,
    },
    {
      name: "a normalized impossible calendar date",
      body: withActiveTimingReceipt(
        canonicalMilestoneBody({ status: "in-progress" }),
      ).replace(receiptStamp(100), "1970-02-30T00:01:40Z / 5184100"),
      expected: /timing receipt segment 1 is not parseable/u,
    },
  ];

  for (const testCase of timingEvidenceFailureCases) {
    /** Fixture purpose: each hand-edited receipt must fail at its exact evidence boundary.
     * Filesystem side effects: writes and removes one temporary milestone per case. */
    it(`strict mode rejects ${testCase.name}`, () => {
      const temporaryRoot = mkdtempSync(
        join(tmpdir(), "goat-flow-plan-check-"),
      );
      try {
        const planPath = writeCheckFixture(temporaryRoot, testCase.body);
        const result = runPlansCheck(planPath, "--strict");
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assert.match(result.stdout, testCase.expected);
      } finally {
        rmSync(temporaryRoot, { recursive: true, force: true });
      }
    });
  }

  // Covers the smallest plan an author writes: writes it and expects strict mode to accept the compact shape.
  it("accepts the compact Small rendering in strict mode", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-check-"));
    const planPath = writeCheckFixture(
      temporaryRoot,
      [
        "# Deliver the compact outcome",
        "**Status:** not-started",
        "**Effort estimate:** ~3 min agent-time (1 product / 1 proof / 1 other)",
        "**Plan/admin overhead:** 1 min other",
        "**Scope:** deliver one bounded result",
        "",
        "## Tasks",
        "- [ ] Deliver the result; done when C1 passes. (est: 1 min product)",
        "",
        "## Proof",
        "- [ ] C1: result is delivered → focused check passes. [automated] (est: 1 min proof)",
        "",
        "## Exit",
        "- C1 is green with fresh evidence.",
        "- Stop/rescope if the bounded result requires adjacent work.",
        "",
      ].join("\n"),
    );

    try {
      const result = runPlansCheck(planPath, "--strict");

      assert.equal(result.status, 0, result.stdout);
      assert.doesNotMatch(result.stdout, /error:/u);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  // Covers the worked example authors copy (18 + 5 + 2 = 25): writes it and expects a clean exit 0.
  it("reports a consistent plan and exits 0", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-check-"));
    const planPath = writeCheckFixture(
      temporaryRoot,
      estimatedMilestoneBody(
        "Effort estimate: ~25 min agent-time (18 product / 5 proof / 2 other)",
        [
          "- [ ] [RISKY] Verify rotation (est: 8 min product)",
          "- [ ] [RISKY] Confirm atomic replace (est: 6 min product)",
          "- [ ] [CORE] Add persistence path (est: 4 min product)",
        ],
      ),
    );

    try {
      const result = runPlansCheck(planPath);

      assert.equal(result.status, 0, result.stderr);
      assert.match(
        result.stdout,
        /~25 min \(18 product \/ 5 proof \/ 2 other\)/u,
      );
      assert.match(result.stdout, /mix 72% product \/ 20% proof \/ 8% other/u);
      assert.doesNotMatch(result.stdout, /advisory/u);
      assert.doesNotMatch(result.stdout, /error:/u);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  // Covers the unauditable aggregate this command exists to catch: writes a split that misses its headline.
  it("exits 1 when the split does not sum to the headline", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-check-"));
    const planPath = writeCheckFixture(
      temporaryRoot,
      estimatedMilestoneBody(
        "Effort estimate: ~25 min agent-time (10 product / 5 proof / 2 other)",
        ["- [ ] [CORE] Build the thing (est: 10 min product)"],
      ),
    );

    try {
      const result = runPlansCheck(planPath);

      assert.equal(result.status, 1);
      assert.match(
        result.stdout,
        /error: M01-fixture\.md: split .* sums to 17 min but the headline says 25 min/u,
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  // Covers the obligation an effort line creates: writes tasks with no est entries the author must fill.
  it("exits 1 when tasks lack est entries under a declared effort line", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-check-"));
    const planPath = writeCheckFixture(
      temporaryRoot,
      estimatedMilestoneBody(
        "Effort estimate: ~25 min agent-time (18 product / 5 proof / 2 other)",
        ["- [ ] [CORE] Build the thing"],
      ),
    );

    try {
      const result = runPlansCheck(planPath);

      assert.equal(result.status, 1);
      assert.match(
        result.stdout,
        /error: M01-fixture\.md: 1 task\(s\) missing an \(est: \.\.\.\) entry/u,
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  /** Fixture purpose: a user who mistypes several estimate fields should receive every grammar and received value in the first check run.
   * Filesystem/process side effects: writes one temporary milestone, runs the CLI once, and removes the fixture. */
  it("reports every malformed estimate grammar and received value together", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-errors-"));
    const planPath = writeCheckFixture(
      temporaryRoot,
      estimatedMilestoneBody(
        "Effort estimate: ~8 min agent-time (3 product / 3 proof / 2 other)",
        ["- [ ] Build the thing (est: soon)"],
        {
          forecastBasisLine:
            "Forecast basis: 3 agent work units at 0.5-2.5-10 min/unit",
          forecastRangeLine: "Forecast range: 1-30 minutes; likely 8",
          planAdminOverhead: "two min other",
          testingGateLines: ["- [ ] Run typecheck (est: 3 min proof)"],
        },
      ),
    );

    try {
      const result = runPlansCheck(planPath, "--strict");

      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(
        result.stdout,
        /task 1: estimate not parseable; expected "\(est: <minutes> min <product\|proof\|other>\)"; received "\(est: soon\)"/u,
      );
      assert.match(
        result.stdout,
        /plan\/admin overhead estimate not parseable; expected "<minutes> min other"; received "two min other"/u,
      );
      assert.match(
        result.stdout,
        /forecast basis not parseable; expected "<units> agent work units; <low>-<likely>-<high> min\/unit low-likely-high; source: <source>"; received "3 agent work units at 0\.5-2\.5-10 min\/unit"/u,
      );
      assert.match(
        result.stdout,
        /forecast range not parseable; expected "<low>-<high> agent-time minutes on one recorded-unpaused milestone timeline; likely <minutes>\[; <rationale>\]"; received "1-30 minutes; likely 8"/u,
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  /** Fixture purpose: nested rationale remains readable without hiding the estimate that keeps the user's totals and forecast reviewable.
   * Filesystem/process side effects: writes one temporary milestone, runs the CLI once, and removes the fixture. */
  it("keeps a parent task estimate when indented prose follows it", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-nested-"));
    const planPath = writeCheckFixture(
      temporaryRoot,
      estimatedMilestoneBody(
        "Effort estimate: ~8 min agent-time (3 product / 3 proof / 2 other)",
        [
          "- [ ] Build the thing (est: 3 min product)",
          "  - M01 records why this exact edit was denied.",
        ],
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
      assert.doesNotMatch(result.stdout, /missing an \(est: \.+\) entry/u);
      assert.doesNotMatch(result.stdout, /forecast basis declares/u);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  // Covers older estimate-less plans: writes one and expects one info line, because local state is not scored.
  it("passes legacy estimate-less plans with a single info line", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-check-"));
    const planPath = writeCheckFixture(
      temporaryRoot,
      [
        "# M01: Legacy milestone",
        "Status: complete",
        "",
        "## Tasks",
        "",
        "- [x] Ship it",
        "",
      ].join("\n"),
    );

    try {
      const result = runPlansCheck(planPath);

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /no effort estimates found/u);
      assert.doesNotMatch(result.stdout, /error:/u);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  // Covers drift from the 70/20/10 prior: writes a proof-heavy plan and expects advice, not a failing gate.
  it("reports proof-heavy mix drift as advisory with exit 0", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-check-"));
    const planPath = writeCheckFixture(
      temporaryRoot,
      estimatedMilestoneBody(
        "Effort estimate: ~25 min agent-time (5 product / 18 proof / 2 other)",
        [
          "- [ ] [CORE] Build the thing (est: 5 min product)",
          "- [ ] [CORE] Re-verify everything twice (est: 18 min proof)",
        ],
      ),
    );

    try {
      const result = runPlansCheck(planPath);

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /advisory: plan mix drifts/u);
      assert.doesNotMatch(result.stdout, /error:/u);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  // Covers derived work that still drifts on mix: writes it and expects a pass with drift left advisory.
  it("strict mode accepts fully derived work while keeping mix drift advisory", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-check-"));
    const planPath = writeCheckFixture(
      temporaryRoot,
      estimatedMilestoneBody(
        "Effort estimate: ~25 min agent-time (18 product / 5 proof / 2 other)",
        [
          "- [ ] [RISKY] Verify rotation (est: 8 min product)",
          "- [ ] [RISKY] Confirm atomic replace (est: 6 min product)",
          "- [ ] [CORE] Add persistence path (est: 4 min product)",
        ],
        {
          planAdminOverhead: "2 min other",
          testingGateLines: [
            "- [ ] `npm run typecheck` exits 0 (est: 2 min proof)",
            "- [ ] Exercise refresh flow; expected: token rotates (est: 2 min proof)",
          ],
          midProofLines: [
            "- [ ] Run the focused refresh smoke check after persistence edits (est: 1 min proof)",
          ],
        },
      ),
    );

    try {
      const result = runPlansCheck(planPath, "--strict");

      assert.equal(result.status, 0, result.stderr);
      assert.doesNotMatch(result.stdout, /error:/u);
      assert.doesNotMatch(result.stdout, /advisory:/u);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  // Covers the three canonical shapes an author picks: writes each and expects strict mode to accept all.
  it("strict mode accepts canonical Small, Standard, and high-risk shapes", () => {
    const temporaryRoots: string[] = [];
    try {
      const smallRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-small-"));
      temporaryRoots.push(smallRoot);
      const smallPath = writeCheckPlan(smallRoot, {
        "M01-small.md": canonicalMilestoneBody({
          includeDependencies: false,
          proofHeading: "Proof",
        }),
      });

      const standardRoot = mkdtempSync(
        join(tmpdir(), "goat-flow-plan-standard-"),
      );
      temporaryRoots.push(standardRoot);
      const standardPath = writeCheckPlan(standardRoot, {
        "M01-foundation.md": canonicalMilestoneBody({
          title: "M01: Foundation works",
          status: "complete",
          isTaskChecked: true,
          proofHeading: "Proof",
          proofLines: [
            "- [x] Foundation is proven → focused check passes. [automated] (est: 1 min proof)",
          ],
          includeActual: true,
        }),
        "M02-integration.md": canonicalMilestoneBody({
          title: "M02: Integration works",
          dependsOn: "M01",
          proofHeading: "Proof",
          status: "complete",
          isTaskChecked: true,
          proofLines: [
            "- [x] Integration is proven → focused check passes. [automated] (est: 1 min proof)",
          ],
          includeActual: true,
        }),
        "M04-outcome.md": canonicalMilestoneBody({
          title: "M04: Outcome is available",
          dependsOn: "M01, M02",
          proofHeading: "Proof",
        }),
      });

      const highRiskRoot = mkdtempSync(
        join(tmpdir(), "goat-flow-plan-high-risk-"),
      );
      temporaryRoots.push(highRiskRoot);
      const highRiskPath = writeCheckPlan(highRiskRoot, {
        "M01-migrate-safely.md": [
          canonicalMilestoneBody({
            title: "M01: Existing data migrates safely",
            proofHeading: "Proof",
          }),
          "## Boundary Notes",
          "The migration remains reversible and requires explicit production approval.",
          "",
          "## Assumptions",
          "- [ ] Existing rows satisfy the compatibility query.",
          "",
        ].join("\n"),
      });

      for (const planPath of [smallPath, standardPath, highRiskPath]) {
        const result = runPlansCheck(planPath, "--strict");
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.doesNotMatch(result.stdout, /error:/u);
      }
    } finally {
      for (const root of temporaryRoots) {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });
});
