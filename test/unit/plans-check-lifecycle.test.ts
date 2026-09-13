/**
 * How the checker ties milestone claims to evidence: lifecycle snapshots, active-slot limits, and receipt-backed Actuals.
 * Every case runs the real CLI against written milestones, so failures match the guidance users see while moving a plan between workflow states.
 * Temporary plans isolate each lifecycle transition and are removed after the assertion.
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
  /**
   * Fixture purpose: Lane metadata preserves inactive lifecycle states and report bytes.
   * Process/filesystem side effects: runs the CLI against temporary plans and removes them afterward.
   */
  it("preserves inactive lifecycle behavior with declared Lane metadata", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-lane-lifecycle-"),
    );
    try {
      const files: Record<string, string> = {};
      const statuses = [
        "complete",
        "not-started",
        "blocked",
        "abandoned",
        "superseded",
        "deferred",
      ];
      for (const [index, status] of statuses.entries()) {
        const isComplete = status === "complete";
        files[`M0${index + 1}-fixture.md`] = canonicalMilestoneBody({
          title: `M0${index + 1}: Lifecycle fixture`,
          status,
          statusReason: ["complete", "not-started"].includes(status)
            ? undefined
            : "Human assigned the remaining work to M01.",
          isTaskChecked: isComplete,
          includeActual: isComplete,
          proofLines: [
            `- [${isComplete ? "x" : " "}] Outcome is proven. [automated] (est: 1 min proof)`,
          ],
        });
      }
      const baseline = runPlansCheck(
        writeCheckPlan(join(temporaryRoot, "base"), files),
        "--strict",
      );
      const withLanes = Object.fromEntries(
        Object.entries(files).map(([name, body]) => [
          name,
          `${body}\nLane: php\n`,
        ]),
      );
      const result = runPlansCheck(
        writeCheckPlan(join(temporaryRoot, "lane"), withLanes),
        "--strict",
      );
      assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(result.stdout, baseline.stdout);
      assert.equal(result.stderr, baseline.stderr);
      const parallel = runPlansCheck(
        writeCheckPlan(join(temporaryRoot, "lane"), withLanes),
        "--strict",
        "--max-active",
        "2",
      );
      assert.equal(parallel.status, 0, parallel.stdout + parallel.stderr);
      assert.match(parallel.stdout, /plan: 0 active milestones \(cap 2\)/u);
      assert.doesNotMatch(parallel.stdout, /^active:/mu);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  /** All execution and review states consume slots, including pending human verification. */
  it("counts in-progress, testing-gate, and human-verification-pending across lanes", () => {
    const root = mkdtempSync(join(tmpdir(), "goat-flow-plan-active-states-"));
    try {
      const files: Record<string, string> = {};
      for (const [index, status] of [
        "in-progress",
        "testing-gate",
        "human-verification-pending",
      ].entries()) {
        const id = `M0${index + 1}`;
        const pending = status === "human-verification-pending";
        files[`${id}-fixture.md`] =
          canonicalMilestoneBody({
            title: `${id}: Active state`,
            status,
            isTaskChecked: status !== "in-progress",
            includeActual: pending,
            proofLines: [
              `- [${pending ? "x" : " "}] Outcome is proven. [automated] (est: 1 min proof)`,
            ],
          }) + `\nLane: lane-${index}\n`;
      }
      const plan = writeCheckPlan(root, files);
      const allowed = runPlansCheck(plan, "--strict", "--max-active", "3");
      assert.equal(allowed.status, 0, allowed.stdout + allowed.stderr);
      assert.match(allowed.stdout, /plan: 3 active milestones \(cap 3\)/u);
      const capped = runPlansCheck(plan, "--strict", "--max-active", "2");
      assert.equal(capped.status, 1);
      assert.deepEqual(
        capped.stdout.split("\n").filter((line) => line.startsWith("error:")),
        ["error: plan: active milestone cap 2 exceeded: M01, M02, M03"],
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

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
        canonicalMilestoneBody({
          status: "blocked",
          statusReason: "Waiting for the provider capture before resuming.",
        }),
      ),
      expected: /blocked milestone must not have an active Timing Receipt/u,
    },
    {
      name: "abandoned-active-receipt",
      body: withActiveTimingReceipt(
        canonicalMilestoneBody({
          status: "abandoned",
          statusReason: "Human approved stopping after the premise failed.",
        }),
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

  for (const status of ["blocked", "abandoned", "deferred"] as const) {
    /** Fixture purpose: compare the missing exceptional field with the canonical authoring shape. */
    it(`strict mode requires one canonical status reason while ${status}`, () => {
      const temporaryRoot = mkdtempSync(
        join(tmpdir(), `goat-flow-plan-${status}-reason-`),
      );
      try {
        const missingPath = writeCheckFixture(
          join(temporaryRoot, "missing"),
          canonicalMilestoneBody({ status }),
        );
        const validPath = writeCheckFixture(
          join(temporaryRoot, "valid"),
          canonicalMilestoneBody({
            status,
            statusReason:
              status === "blocked"
                ? "Waiting for callback evidence before resuming."
                : "Human approved stopping after the premise failed.",
          }),
        );

        const missing = runPlansCheck(missingPath, "--strict");
        const valid = runPlansCheck(validPath, "--strict");
        assert.equal(missing.status, 1, missing.stdout + missing.stderr);
        assert.match(
          missing.stdout,
          new RegExp(`${status} milestone requires Status reason`, "u"),
        );
        assert.equal(valid.status, 0, valid.stdout + valid.stderr);
      } finally {
        rmSync(temporaryRoot, { recursive: true, force: true });
      }
    });
  }

  /**
   * Fixture purpose: preserve a historical abandoned snapshot in default mode while refusing it as current authoring.
   * Process/filesystem side effects: spawns two CLI checks and writes one temporary milestone.
   */
  it("warns on legacy Abandoned fallback and rejects it in strict mode", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-legacy-abandoned-"),
    );
    try {
      const planPath = writeCheckFixture(
        temporaryRoot,
        canonicalMilestoneBody({
          status: "abandoned",
          abandonedReason: "Human approved stopping after the premise failed.",
        }),
      );

      const compatible = runPlansCheck(planPath);
      const strict = runPlansCheck(planPath, "--strict");
      assert.equal(compatible.status, 0, compatible.stdout + compatible.stderr);
      assert.equal(strict.status, 1, strict.stdout + strict.stderr);
      assert.match(
        strict.stdout,
        /legacy Abandoned field supplied; use Status reason/u,
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  const invalidReasonCases = [
    {
      name: "blank exceptional reason",
      body: canonicalMilestoneBody({ status: "blocked", statusReason: "" }),
      expected: /blank Status reason supplied/u,
    },
    {
      name: "duplicate canonical reasons",
      body: canonicalMilestoneBody({
        status: "blocked",
        statusReason: "First reason.",
      }).replace(
        "Status reason: First reason.",
        "Status reason: First reason.\nStatus reason: Second reason.",
      ),
      expected: /multiple Status reason values supplied/u,
    },
    {
      name: "competing canonical and legacy reasons",
      body: canonicalMilestoneBody({
        status: "abandoned",
        statusReason: "Canonical decision.",
        abandonedReason: "Legacy decision.",
      }),
      expected: /conflicting status reason representations/u,
    },
    {
      name: "stale reason after work resumes",
      body: canonicalMilestoneBody({
        status: "in-progress",
        statusReason: "This field belongs only to exceptional states.",
      }),
      expected: /in-progress milestone must not include Status reason/u,
    },
  ] as const;

  for (const testCase of invalidReasonCases) {
    /** Fixture purpose: each malformed authority fails at its exact current-plan boundary. */
    it(`strict mode rejects ${testCase.name}`, () => {
      const temporaryRoot = mkdtempSync(
        join(tmpdir(), "goat-flow-plan-invalid-reason-"),
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

  /** Fixture purpose: a milestone awaiting the user's decision still owns the active slot, so another implementation cannot begin beside it.
   * Filesystem/process side effects: writes a two-milestone plan, runs the CLI once, and removes the fixture. */
  it("keeps human verification in the one-active-milestone rule", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-human-active-"),
    );
    const planPath = writeCheckPlan(temporaryRoot, {
      "M01-review.md": canonicalMilestoneBody({
        title: "M01: Await user review",
        status: "human-verification-pending",
        isTaskChecked: true,
        proofLines: [
          "- [x] Outcome is proven. [automated] (est: 1 min proof)",
          "- [ ] [human] Approve completion. (est: 1 min proof)",
        ],
        includeActual: true,
      }),
      "M02-next.md": canonicalMilestoneBody({
        title: "M02: Start the next outcome",
        status: "in-progress",
        dependsOn: "none",
      }),
    });

    try {
      const result = runPlansCheck(planPath, "--strict");

      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stdout, /multiple active milestones: M01, M02/u);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  /** Fixture purpose: a spent milestone must point readers at the live work that carries its remainder.
   * Filesystem/process side effects: writes three two-milestone plans, runs the CLI once each, and removes the fixtures. */
  it("strict mode requires a superseded milestone to name a resolvable successor", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-superseded-"),
    );
    try {
      const successorCases = [
        {
          name: "missing-id",
          reason: "Carried elsewhere after the lock was spent.",
          expected:
            /superseded milestone must name its successor milestone in Status reason/u,
        },
        {
          name: "unresolved",
          reason: "Superseded by M09, which carries the remainder.",
          expected: /superseded successor M09 does not resolve in this plan/u,
        },
      ];
      for (const successorCase of successorCases) {
        const planPath = writeCheckPlan(
          join(temporaryRoot, successorCase.name),
          {
            "M01-spent.md": canonicalMilestoneBody({
              title: "M01: Spent",
              status: "superseded",
              statusReason: successorCase.reason,
            }),
            "M02-carrier.md": canonicalMilestoneBody({
              title: "M02: Carrier",
              dependsOn: "none",
            }),
          },
        );
        const result = runPlansCheck(planPath, "--strict");
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assertSourceLabelledErrors(result.stdout);
        assert.match(result.stdout, successorCase.expected);
      }

      const validPath = writeCheckPlan(join(temporaryRoot, "valid"), {
        "M01-spent.md": withPausedTimingReceipt(
          canonicalMilestoneBody({
            title: "M01: Spent",
            status: "superseded",
            statusReason:
              "Superseded by M02, which carries the remainder under a fresh lock.",
          }),
        ),
        "M02-carrier.md": canonicalMilestoneBody({
          title: "M02: Carrier",
          dependsOn: "none",
        }),
      });
      const valid = runPlansCheck(validPath, "--strict");
      assert.equal(valid.status, 0, valid.stdout + valid.stderr);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  /** Fixture purpose: terminal milestones keep their rows but leave the plan total the author steers by.
   * Filesystem/process side effects: writes one three-milestone plan, runs the CLI once, and removes the fixture. */
  it("reports superseded and deferred estimates on an excluded line instead of the plan total", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-excluded-total-"),
    );
    const planPath = writeCheckPlan(temporaryRoot, {
      "M01-spent.md": canonicalMilestoneBody({
        title: "M01: Spent",
        status: "superseded",
        statusReason: "Superseded by M03, which carries the remainder.",
      }),
      "M02-later.md": canonicalMilestoneBody({
        title: "M02: Later",
        status: "deferred",
        statusReason:
          "Deferred to the next release by scope; disposition recorded in the backlog.",
      }),
      "M03-live.md": canonicalMilestoneBody({
        title: "M03: Live",
        dependsOn: "none",
      }),
    });
    try {
      const result = runPlansCheck(planPath, "--strict");
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /^plan: 2 min estimated/mu);
      assert.match(
        result.stdout,
        /^excluded: 4 min in 2 superseded or deferred milestones - M01-spent\.md superseded 2, M02-later\.md deferred 2$/mu,
      );
      assert.match(
        result.stdout,
        /^M01-spent\.md: ~2 min \(1 product \/ 1 proof \/ 0 other\) \| superseded - excluded from the plan total$/mu,
      );
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
