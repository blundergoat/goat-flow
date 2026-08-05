/**
 * How the checker ties claims to evidence: lifecycle snapshots, active-milestone limits,
 * and the timing receipts a measured Actual must reconcile against.
 * Runs the real CLI against written milestone fixtures, so failures read as an author would
 * see them in a terminal rather than as internals.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runPlansCheck,
  assertSourceLabelledErrors,
  writeCheckFixture,
  writeCheckPlan,
  estimatedMilestoneBody,
  canonicalMilestoneBody,
  withFinalizedTimingReceipt,
  withPausedTimingReceipt,
  withActiveTimingReceipt,
  withTimingSummary,
  receiptStamp,
} from "./plans-check.helpers.js";

describe("plans check: lifecycle states and timing receipts", () => {
  const lifecycleFailureCases: Array<{
    name: string;
    body: string;
    expected: RegExp;
  }> = [
    {
      name: "not-started-work",
      body: canonicalMilestoneBody({ isTaskChecked: true }),
      expected: /not-started milestone has checked implementation tasks/u,
    },
    {
      name: "not-started-proof",
      body: canonicalMilestoneBody({
        proofLines: [
          "- [x] Outcome is already proven. [automated] (est: 1 min proof)",
        ],
      }),
      expected: /not-started milestone has checked proof items/u,
    },
    {
      name: "not-started-actual",
      body: canonicalMilestoneBody({ includeActual: true }),
      expected: /not-started milestone must not include Actual/u,
    },
    {
      name: "not-started-paused-receipt",
      body: withPausedTimingReceipt(canonicalMilestoneBody()),
      expected: /not-started milestone must not include a Timing Receipt/u,
    },
    {
      name: "testing-open-task",
      body: canonicalMilestoneBody({ status: "testing-gate" }),
      expected: /testing-gate milestone has open implementation tasks/u,
    },
    {
      name: "pending-open-proof",
      body: canonicalMilestoneBody({
        status: "human-verification-pending",
        isTaskChecked: true,
      }),
      expected:
        /human-verification-pending milestone requires structured Actual|executor proof item remains open/u,
    },
    {
      name: "complete-open-human",
      body: canonicalMilestoneBody({
        status: "complete",
        isTaskChecked: true,
        proofLines: [
          "- [x] Outcome is proven. [automated] (est: 1 min proof)",
          "- [ ] [human] Approve completion. (est: 1 min proof)",
        ],
        includeActual: true,
      }),
      expected: /complete milestone has open proof items/u,
    },
    {
      name: "complete-active-receipt",
      body: withActiveTimingReceipt(
        canonicalMilestoneBody({
          status: "complete",
          isTaskChecked: true,
          proofLines: [
            "- [x] Outcome is proven. [automated] (est: 1 min proof)",
          ],
          includeActual: true,
        }),
      ),
      expected: /complete milestone must not have an active Timing Receipt/u,
    },
    {
      name: "human-pending-active-receipt",
      body: withActiveTimingReceipt(
        canonicalMilestoneBody({
          status: "human-verification-pending",
          isTaskChecked: true,
          proofLines: [
            "- [x] Outcome is proven. [automated] (est: 1 min proof)",
            "- [ ] [human] Approve completion. (est: 1 min proof)",
          ],
          includeActual: true,
        }),
      ),
      expected:
        /human-verification-pending milestone must not have an active Timing Receipt/u,
    },
    {
      name: "blocked-active-receipt",
      body: withActiveTimingReceipt(
        canonicalMilestoneBody({ status: "blocked" }),
      ),
      expected: /blocked milestone must not have an active Timing Receipt/u,
    },
    {
      name: "abandoned-active-receipt",
      body: withActiveTimingReceipt(
        canonicalMilestoneBody({ status: "abandoned" }),
      ),
      expected: /abandoned milestone must not have an active Timing Receipt/u,
    },
    {
      name: "invalid-status",
      body: canonicalMilestoneBody({ status: "planned" }),
      expected: /unsupported status `planned`/u,
    },
  ];

  // Covers each lifecycle failure separately so TAP names the exact one: every case writes a plan fixture.
  for (const testCase of lifecycleFailureCases) {
    it(`strict mode rejects ${testCase.name} lifecycle state`, () => {
      const temporaryRoot = mkdtempSync(
        join(tmpdir(), `goat-flow-plan-lifecycle-${testCase.name}-`),
      );
      try {
        const planPath = writeCheckFixture(temporaryRoot, testCase.body);
        const result = runPlansCheck(planPath, "--strict");
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assertSourceLabelledErrors(result.stdout);
        assert.match(result.stdout, testCase.expected);
      } finally {
        rmSync(temporaryRoot, { recursive: true, force: true });
      }
    });
  }

  for (const status of ["in-progress", "testing-gate"] as const) {
    /** Fixture purpose: writes a valid open segment for each state that executes work. */
    it(`strict mode allows an active receipt while ${status} is executing`, () => {
      const temporaryRoot = mkdtempSync(
        join(tmpdir(), `goat-flow-plan-running-${status}-`),
      );
      const planPath = writeCheckFixture(
        temporaryRoot,
        withActiveTimingReceipt(
          canonicalMilestoneBody({
            status,
            isTaskChecked: status === "testing-gate",
          }),
        ),
      );

      try {
        const result = runPlansCheck(planPath, "--strict");
        assert.equal(result.status, 0, result.stdout + result.stderr);
      } finally {
        rmSync(temporaryRoot, { recursive: true, force: true });
      }
    });
  }

  const staleSummaryCases = [
    {
      state: "active",
      body: withTimingSummary(
        withActiveTimingReceipt(
          canonicalMilestoneBody({ status: "in-progress" }),
        ),
        "active",
        0,
      ),
    },
    {
      state: "paused",
      body: withTimingSummary(
        withPausedTimingReceipt(
          canonicalMilestoneBody({ status: "in-progress" }),
        ),
        "paused",
        60,
      ),
    },
    {
      state: "incomplete",
      body: withTimingSummary(
        withActiveTimingReceipt(
          canonicalMilestoneBody({ status: "in-progress" }),
        )
          .replace("**Receipt state:** active", "**Receipt state:** incomplete")
          .replace(
            "| _ | _ | open |",
            `| _ | _ | discarded ${receiptStamp(101)} |`,
          ),
        "incomplete",
        0,
      ),
    },
  ] as const;

  for (const testCase of staleSummaryCases) {
    it(`strict mode rejects a summary on ${testCase.state} timing receipts`, () => {
      const temporaryRoot = mkdtempSync(
        join(tmpdir(), `goat-flow-plan-${testCase.state}-summary-`),
      );
      const planPath = writeCheckFixture(temporaryRoot, testCase.body);

      try {
        const result = runPlansCheck(planPath, "--strict");
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assert.match(
          result.stdout,
          /timing receipt summary requires finalized state/u,
        );
      } finally {
        rmSync(temporaryRoot, { recursive: true, force: true });
      }
    });
  }

  /** Fixture purpose: writes duplicate authority so an active clock fails before Actual exists. */
  it("strict mode rejects parser warnings on an active receipt without a measured Actual", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-active-warning-"),
    );
    const active = withActiveTimingReceipt(
      canonicalMilestoneBody({ status: "in-progress" }),
    );
    const duplicateRow = `| M01-S01 | product | ${receiptStamp(100)} | _ | _ | open |`;
    const duplicatedSegment = active.replace(
      "## Scope",
      `${duplicateRow}\n\n## Scope`,
    );
    const planPath = writeCheckFixture(temporaryRoot, duplicatedSegment);

    try {
      const result = runPlansCheck(planPath, "--strict");
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stdout, /timing receipt segment ids must be unique/u);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  // Covers documentation an author pastes in: writes fenced metadata and examples that must not be scored.
  it("strict mode ignores fenced metadata and checklist examples", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-fenced-metadata-"),
    );
    const canonical = canonicalMilestoneBody();
    const body = canonical.replace(
      "# M01: Estimated milestone\n",
      [
        "# M01: Estimated milestone",
        "```markdown",
        "Status: complete",
        "Actual: ~2 min agent-time (1 product / 1 proof / 0 other)",
        "## Proof",
        "- [x] Example only. (est: 999 min proof)",
        "```",
      ].join("\n") + "\n",
    );
    const planPath = writeCheckFixture(temporaryRoot, body);

    try {
      const result = runPlansCheck(planPath, "--strict");
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.doesNotMatch(result.stdout, /multiple .* values supplied/u);
      assert.doesNotMatch(result.stdout, /checked proof items/u);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  // Covers a milestone recording two Actual lines: writes it and expects the ambiguous record rejected.
  it("strict mode rejects duplicate Actual fields", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-duplicate-actual-"),
    );
    const body = canonicalMilestoneBody({
      status: "complete",
      isTaskChecked: true,
      proofLines: ["- [x] Outcome is proven. [automated] (est: 1 min proof)"],
      includeActual: true,
    }).replace(
      /Actual: ~2 min agent-time \(1 product \/ 1 proof \/ 0 other\)/u,
      [
        "Actual: ~2 min agent-time (1 product / 1 proof / 0 other)",
        "Actual: ~3 min agent-time (2 product / 1 proof / 0 other)",
      ].join("\n"),
    );
    const planPath = writeCheckFixture(temporaryRoot, body);

    try {
      const result = runPlansCheck(planPath, "--strict");
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stdout, /multiple Actual values supplied/u);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  /**
   * Fixture purpose: contrasts a leading ownership marker with the same token embedded in prose.
   * Filesystem/process side effects: writes one temporary plan and spawns two completed CLI checks.
   */
  it("recognizes human ownership only from a leading proof marker", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-human-pending-"),
    );
    const planPath = writeCheckFixture(
      temporaryRoot,
      canonicalMilestoneBody({
        status: "human-verification-pending",
        isTaskChecked: true,
        proofLines: [
          "- [x] Outcome is proven. [automated] (est: 1 min proof)",
          "- [ ] [human] Approve completion. (est: 1 min proof)",
        ],
        includeActual: true,
      }),
    );

    try {
      const validResult = runPlansCheck(planPath, "--strict");
      assert.equal(validResult.status, 0, validResult.stderr);
      assert.doesNotMatch(validResult.stdout, /error:/u);

      writeCheckFixture(
        temporaryRoot,
        canonicalMilestoneBody({
          status: "human-verification-pending",
          isTaskChecked: true,
          proofLines: [
            "- [x] Outcome is proven. [automated] (est: 1 min proof)",
            "- [ ] Explain the literal [human] marker. [automated] (est: 1 min proof)",
          ],
          includeActual: true,
        }),
      );
      const invalidResult = runPlansCheck(planPath, "--strict");
      assert.equal(invalidResult.status, 1, invalidResult.stderr);
      assert.match(invalidResult.stdout, /executor proof item remains open/u);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  // Covers a plan where two milestones claim to be in progress: writes it and expects the second rejected.
  it("strict mode rejects more than one active milestone", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-multiple-active-"),
    );
    const planPath = writeCheckPlan(temporaryRoot, {
      "M01-one.md": canonicalMilestoneBody({
        title: "M01: One",
        status: "in-progress",
      }),
      "M02-two.md": canonicalMilestoneBody({
        title: "M02: Two",
        status: "testing-gate",
        dependsOn: "M01",
      }),
    });

    try {
      const result = runPlansCheck(planPath, "--strict");
      assert.equal(result.status, 1);
      assertSourceLabelledErrors(result.stdout);
      assert.match(result.stdout, /multiple active milestones/u);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("strict mode rejects a headline without a category split", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-check-"));
    const planPath = writeCheckFixture(
      temporaryRoot,
      estimatedMilestoneBody("Effort estimate: ~100 min agent-time", [
        "- [ ] Tiny edit (est: 1 min product)",
      ]),
    );

    try {
      const result = runPlansCheck(planPath, "--strict");

      assert.equal(result.status, 1);
      assert.match(
        result.stdout,
        /strict mode requires a product\/proof\/other split/u,
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("strict mode rejects category totals that exceed the counted work", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-check-"));
    const planPath = writeCheckFixture(
      temporaryRoot,
      estimatedMilestoneBody(
        "Effort estimate: ~100 min agent-time (100 product / 0 proof / 0 other)",
        ["- [ ] Tiny edit (est: 1 min product)"],
      ),
    );

    try {
      const result = runPlansCheck(planPath, "--strict");

      assert.equal(result.status, 1);
      assert.match(
        result.stdout,
        /product counted work \(1 min\) does not equal the split component \(100 min\)/u,
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  // Covers proof work left unestimated: writes bare testing tasks and expects strict mode to reject them.
  it("strict mode rejects unestimated testing and mid-proof work", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-check-"));
    const planPath = writeCheckFixture(
      temporaryRoot,
      estimatedMilestoneBody(
        "Effort estimate: ~10 min agent-time (7 product / 2 proof / 1 other)",
        ["- [ ] Build the thing (est: 7 min product)"],
        {
          planAdminOverhead: "1 min other",
          testingGateLines: ["- [ ] Run typecheck"],
          midProofLines: ["- [ ] Run a focused smoke check"],
        },
      ),
    );

    try {
      const result = runPlansCheck(planPath, "--strict");

      assert.equal(result.status, 1);
      assert.match(
        result.stdout,
        /testing gate item\(s\) missing an \(est: \.\.\.\) entry/u,
      );
      assert.match(
        result.stdout,
        /mid-proof item\(s\) missing an \(est: \.\.\.\) entry/u,
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  // Covers a milestone marked done with no measured Actual: writes it and expects the claim rejected.
  it("strict mode rejects a completed milestone without structured Actual", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-check-"));
    const planPath = writeCheckFixture(
      temporaryRoot,
      estimatedMilestoneBody(
        "Effort estimate: ~10 min agent-time (7 product / 2 proof / 1 other)",
        ["- [x] Build the thing (est: 7 min product)"],
        {
          status: "complete",
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
        /complete milestone requires a structured Actual/u,
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  // Covers finished-and-recorded work: writes a completed milestone with a structured Actual, expects a pass.
  it("strict mode accepts a completed milestone with structured Actual", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-check-"));
    const planPath = writeCheckFixture(
      temporaryRoot,
      estimatedMilestoneBody(
        "Effort estimate: ~10 min agent-time (7 product / 2 proof / 1 other)",
        ["- [x] Build the thing (est: 7 min product)"],
        {
          status: "complete",
          actualLine:
            "Actual: ~12 min agent-time (8 product / 3 proof / 1 other) - one extra focused check",
          planAdminOverhead: "1 min other",
          testingGateLines: ["- [x] Run typecheck (est: 2 min proof)"],
        },
      ),
    );

    try {
      const result = runPlansCheck(planPath, "--strict");

      assert.equal(result.status, 0, result.stderr);
      assert.match(
        result.stdout,
        /actual: retrospective ~12 min \(8 product \/ 3 proof \/ 1 other\) - one extra focused check/u,
      );
      assert.doesNotMatch(result.stdout, /error:/u);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  for (const actualLine of [
    "Actual: unavailable: timing was never started",
    "Actual: incomplete: receipt contains a discarded open span",
  ]) {
    // Covers milestones that decline to invent minutes: writes each honest no-number Actual and expects a pass.
    it(`strict mode accepts the honest no-number state in ${actualLine}`, () => {
      const temporaryRoot = mkdtempSync(
        join(tmpdir(), "goat-flow-plan-check-"),
      );
      const planPath = writeCheckFixture(
        temporaryRoot,
        estimatedMilestoneBody(
          "Effort estimate: ~10 min agent-time (7 product / 2 proof / 1 other)",
          ["- [x] Build the thing (est: 7 min product)"],
          {
            status: "complete",
            actualLine,
            planAdminOverhead: "1 min other",
            testingGateLines: ["- [x] Run typecheck (est: 2 min proof)"],
          },
        ),
      );

      try {
        const result = runPlansCheck(planPath, "--strict");

        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.doesNotMatch(result.stdout, /error:/u);
      } finally {
        rmSync(temporaryRoot, { recursive: true, force: true });
      }
    });
  }

  // Covers a measured claim with no receipt behind it: writes the plan and expects strict mode to reject it.
  it("strict mode rejects measured Actual without a finalized embedded receipt", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-check-"));
    const planPath = writeCheckFixture(
      temporaryRoot,
      estimatedMilestoneBody(
        "Effort estimate: ~10 min agent-time (7 product / 2 proof / 1 other)",
        ["- [x] Build the thing (est: 7 min product)"],
        {
          status: "complete",
          actualLine:
            "Actual: measured: ~2 min agent-time (1 product / 1 proof / 0 other) - receipt 120 recorded-unpaused seconds",
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
        /measured Actual requires a finalized embedded Timing Receipt/u,
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  /*
   * A receipt is evidence for a claim. Pre-CLI hand-written receipts sit beside
   * retrospective Actuals that never cite them, so failing the plan on their
   * shape would invalidate finished work over decoration nothing depends on.
   */
  const unclaimedReceiptMarkdown = [
    "## Timing Receipt",
    "",
    "| Segment | Category | Start UTC / epoch | End UTC / epoch | Seconds | Work |",
    "|---|---|---|---|---:|---|",
    "| M01-S01 | other | 2026-08-02T00:50:41Z / 1785631841 | 2026-08-02T00:51:07Z / 1785631867 | 26 | Setup |",
    "",
    "## Scope",
  ].join("\n");

  // Covers hand-written receipts predating plans time: writes one no Actual cites and expects advisory only.
  it("treats a malformed receipt as advisory when no Actual claims it", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-legacy-"));
    const planPath = writeCheckFixture(
      temporaryRoot,
      estimatedMilestoneBody(
        "Effort estimate: ~10 min agent-time (7 product / 2 proof / 1 other)",
        ["- [x] Build the thing (est: 7 min product)"],
        {
          status: "complete",
          actualLine:
            "Actual: ~4 min agent-time (1 product / 1 proof / 2 other) - rough retrospective guess; timing was not instrumented",
          planAdminOverhead: "1 min other",
          testingGateLines: ["- [x] Run typecheck (est: 2 min proof)"],
        },
      ).replace("## Scope", unclaimedReceiptMarkdown),
    );

    try {
      const result = runPlansCheck(planPath, "--strict");
      assert.equal(result.status, 0, result.stdout + result.stderr);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  // Covers the same malformed receipt once an Actual cites it: writes it and expects a hard rejection.
  it("still rejects a malformed receipt a measured Actual claims", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-claim-"));
    const planPath = writeCheckFixture(
      temporaryRoot,
      estimatedMilestoneBody(
        "Effort estimate: ~10 min agent-time (7 product / 2 proof / 1 other)",
        ["- [x] Build the thing (est: 7 min product)"],
        {
          status: "complete",
          actualLine:
            "Actual: measured: ~4 min agent-time (1 product / 1 proof / 2 other) - receipt 26 recorded-unpaused seconds",
          planAdminOverhead: "1 min other",
          testingGateLines: ["- [x] Run typecheck (est: 2 min proof)"],
        },
      ).replace("## Scope", unclaimedReceiptMarkdown),
    );

    try {
      const result = runPlansCheck(planPath, "--strict");
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stdout, /timing receipt/u);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  // Covers the reconcile step behind a measured Actual: writes receipt seconds and minutes that must agree.
  it("strict mode reconciles measured Actual with receipt seconds and allocation", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-check-"));
    const matchingBody = withFinalizedTimingReceipt(
      estimatedMilestoneBody(
        "Effort estimate: ~10 min agent-time (7 product / 2 proof / 1 other)",
        ["- [x] Build the thing (est: 7 min product)"],
        {
          status: "complete",
          actualLine:
            "Actual: measured: ~2 min agent-time (1 product / 1 proof / 0 other) - receipt 120 recorded-unpaused seconds",
          planAdminOverhead: "1 min other",
          testingGateLines: ["- [x] Run typecheck (est: 2 min proof)"],
        },
      ),
    );
    const planPath = writeCheckFixture(temporaryRoot, matchingBody);

    try {
      const matching = runPlansCheck(planPath, "--strict");
      assert.equal(matching.status, 0, matching.stdout + matching.stderr);

      writeFileSync(
        join(planPath, "M01-fixture.md"),
        matchingBody.replace(
          "receipt 120 recorded-unpaused seconds",
          "receipt 121 recorded-unpaused seconds",
        ),
        "utf-8",
      );
      const mismatched = runPlansCheck(planPath, "--strict");
      assert.equal(mismatched.status, 1);
      assert.match(
        mismatched.stdout,
        /measured Actual receipt says 121 seconds but Timing Receipt says 120/u,
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  /*
   * Covers a milestone that says not-started while its own receipt is running:
   * writes that plan fixture and expects strict mode to reject it. An open span
   * is stronger evidence that work started than an unchecked box, so trusting
   * checkbox state alone would let time already spent go unreported.
   */
  it("strict mode rejects any timing receipt on a not-started milestone", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-open-"));
    const planPath = writeCheckFixture(
      temporaryRoot,
      estimatedMilestoneBody(
        "Effort estimate: ~10 min agent-time (7 product / 2 proof / 1 other)",
        ["- [ ] Build the thing (est: 7 min product)"],
        {
          status: "not-started",
          planAdminOverhead: "1 min other",
          testingGateLines: ["- [ ] Run typecheck (est: 2 min proof)"],
        },
      ).replace(
        "## Scope",
        [
          "## Timing Receipt",
          "",
          "**Receipt state:** active",
          "",
          "| Segment | Category | Start UTC / epoch | End UTC / epoch | Seconds | State |",
          "|---|---|---|---|---:|---|",
          `| M01-S01 | product | ${receiptStamp(100)} | _ | _ | open |`,
          "",
          "## Scope",
        ].join("\n"),
      ),
    );

    try {
      const result = runPlansCheck(planPath, "--strict");
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assertSourceLabelledErrors(result.stdout);
      assert.match(
        result.stdout,
        /not-started milestone must not include a Timing Receipt/u,
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
