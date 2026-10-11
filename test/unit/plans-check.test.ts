/**
 * End-to-end tests for `goat-flow plans check`: each case writes milestone files into a temporary plan and runs the real CLI on it.
 * Assertions read only what the plan author sees, so a failure means the printed report lines or the exit status changed.
 *
 * - Readiness: which `ready:` and `waiting:` lines appear, and why a milestone waits on a prerequisite, the active cap or a lane.
 * - Dependency validity: broken `Depends on` lines, shared IDs and unreadable statuses never yield a false `ready:` or `endings (...)` join advice.
 * - Effort arithmetic and plan shapes: task estimates, category sums, legacy estimate-less plans, mix drift and timing receipts.
 * - Cleanup: every case deletes its temporary plan, even when an assertion fails.
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

/**
 * Build a finished milestone that both checker modes accept, so readiness cases turn only on the other milestones.
 *
 * @param title - milestone heading such as `M01: Done`; its ID must match the filename or strict mode reports a title mismatch
 * @returns complete milestone body with its task and proof ticked and an Actual line filled in
 */
function completedMilestone(title: string): string {
  return canonicalMilestoneBody({
    title,
    status: "complete",
    isTaskChecked: true,
    includeActual: true,
    proofLines: [
      "- [x] Outcome is proven → focused check passes. [automated] (est: 1 min proof)",
    ],
  });
}

/**
 * Two files claim M02, and the finished copy sorts last, so trusting it would wrongly mark M03 ready and name M01 as an ending.
 *
 * @returns milestone bodies keyed by filename for a plan with one shared ID
 */
function duplicateIdFiles(): Record<string, string> {
  return {
    "M01-base.md": canonicalMilestoneBody({ title: "M01: Base" }),
    "M02-build.md": canonicalMilestoneBody({
      title: "M02: Build",
      dependsOn: "M01",
    }),
    "M02-copy.md": completedMilestone("M02: Copy"),
    "M03-ship.md": canonicalMilestoneBody({
      title: "M03: Ship",
      dependsOn: "M02",
    }),
  };
}

describe("plans check: milestone readiness", () => {
  // Each row is one readiness rule an author reads off the report; lanes appear only above cap one, so cap-one rows expect bare IDs.
  const readinessCases: Array<{
    name: string;
    cap: number;
    files: Record<string, string>;
    expected: string[];
  }> = [
    {
      name: "marks a milestone ready once its prerequisite is complete",
      cap: 1,
      files: {
        "M01-done.md": completedMilestone("M01: Done"),
        "M02-next.md": canonicalMilestoneBody({
          title: "M02: Next",
          dependsOn: "M01",
        }),
      },
      expected: ["ready: M02"],
    },
    {
      name: "names an unfinished prerequisite with its status",
      cap: 1,
      files: {
        "M01-first.md": canonicalMilestoneBody({ title: "M01: First" }),
        "M02-second.md": canonicalMilestoneBody({
          title: "M02: Second",
          dependsOn: "M01",
        }),
      },
      expected: ["ready: M01", "waiting: M02 | needs M01 (not-started)"],
    },
    {
      name: "names the occupant when the cap is full",
      cap: 1,
      files: {
        "M01-running.md": canonicalMilestoneBody({
          title: "M01: Running",
          status: "in-progress",
        }),
        "M02-next.md": canonicalMilestoneBody({ title: "M02: Next" }),
      },
      expected: ["waiting: M02 | cap 1 full: M01 (in-progress)"],
    },
    {
      name: "names the lane occupant above cap one",
      cap: 2,
      files: {
        "M01-running.md":
          canonicalMilestoneBody({
            title: "M01: Running",
            status: "in-progress",
          }) + "\nLane: go\n",
        "M02-next.md":
          canonicalMilestoneBody({ title: "M02: Next" }) + "\nLane: go\n",
      },
      expected: ["waiting: M02 | lane go occupied by M01 (in-progress)"],
    },
    {
      name: "names the lane of a ready milestone above cap one",
      cap: 2,
      files: {
        "M01-done.md": completedMilestone("M01: Done"),
        "M02-next.md":
          canonicalMilestoneBody({ title: "M02: Next", dependsOn: "M01" }) +
          "\nLane: graph\n",
      },
      expected: ["ready: M02 | lane graph"],
    },
    {
      name: "reports blocked work by its status",
      cap: 1,
      files: {
        "M01-stuck.md": canonicalMilestoneBody({
          title: "M01: Stuck",
          status: "blocked",
          statusReason: "Waiting for the provider capture before resuming.",
        }),
      },
      expected: ["waiting: M01 | status blocked"],
    },
    {
      name: "prints nothing for finished or dropped work",
      cap: 1,
      files: {
        "M01-done.md": completedMilestone("M01: Done"),
        "M02-later.md": canonicalMilestoneBody({
          title: "M02: Later",
          status: "deferred",
          statusReason: "Moved to the next release after review.",
        }),
        "M03-gone.md": canonicalMilestoneBody({
          title: "M03: Gone",
          status: "abandoned",
          statusReason: "Human approved stopping after the premise failed.",
        }),
      },
      expected: [],
    },
    {
      name: "waits on its own invalid lane above cap one",
      cap: 2,
      files: {
        "M01-done.md": completedMilestone("M01: Done"),
        "M02-next.md":
          canonicalMilestoneBody({ title: "M02: Next", dependsOn: "M01" }) +
          "\nLane: Bad!\n",
      },
      expected: ["waiting: M02 | lane invalid"],
    },
    {
      name: "treats an active milestone with an invalid lane as a possible occupant of every lane",
      cap: 3,
      files: {
        "M01-done.md": completedMilestone("M01: Done"),
        "M02-running.md":
          canonicalMilestoneBody({
            title: "M02: Running",
            status: "in-progress",
            dependsOn: "M01",
          }) + "\nLane: Go\n",
        "M03-next.md":
          canonicalMilestoneBody({ title: "M03: Next", dependsOn: "M01" }) +
          "\nLane: go\n",
      },
      expected: [
        "waiting: M03 | lane go may be occupied by M02 (in-progress, lane invalid)",
      ],
    },
    {
      name: "counts an unsupported status as possibly holding the cap",
      cap: 1,
      files: {
        "M01-first.md": canonicalMilestoneBody({
          title: "M01: First",
          status: "in progress",
        }),
        "M02-other.md": canonicalMilestoneBody({ title: "M02: Other" }),
      },
      expected: ["waiting: M02 | cap 1 may be full: M01 (status invalid)"],
    },
    {
      name: "keeps a free lane ready beside a possibly active milestone in another lane",
      cap: 3,
      files: {
        "M01-first.md":
          canonicalMilestoneBody({ title: "M01: First", status: "wip" }) +
          "\nLane: go\n",
        "M02-other.md":
          canonicalMilestoneBody({ title: "M02: Other" }) + "\nLane: php\n",
      },
      expected: ["ready: M02 | lane php"],
    },
    {
      name: "treats repeated Status lines as unreadable",
      cap: 1,
      files: {
        "M01-first.md":
          completedMilestone("M01: First") + "\nStatus: in-progress\n",
        "M02-next.md": canonicalMilestoneBody({
          title: "M02: Next",
          dependsOn: "M01",
        }),
      },
      expected: [
        "waiting: M02 | needs M01 (status invalid); cap 1 may be full: M01 (status invalid)",
      ],
    },
    {
      name: "waits on a milestone ID that two files share",
      cap: 1,
      files: duplicateIdFiles(),
      expected: [
        "ready: M01",
        "waiting: M02 | ID duplicated; needs M01 (not-started)",
        "waiting: M03 | needs M02 (ID duplicated)",
      ],
    },
  ];

  // Default mode exits 0 even while milestones wait, so each row compares only the `ready:` and `waiting:` lines from its own temporary plan.
  for (const testCase of readinessCases) {
    it(testCase.name, () => {
      const root = mkdtempSync(join(tmpdir(), "goat-flow-plan-readiness-"));
      try {
        const result = runPlansCheck(
          writeCheckPlan(root, testCase.files),
          "--max-active",
          String(testCase.cap),
        );
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.deepEqual(
          result.stdout
            .split("\n")
            .filter((line) => /^(?:ready|waiting): /u.test(line)),
          testCase.expected,
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
});

describe("plans check: dependency validity", () => {
  // Each row is a broken `Depends on` value on M02: M01 stays ready, M02 waits with the row's clause, and no `endings (...)` join advice appears.
  // Example: the author wrote `Depends on: M01 (soft)` or pointed M02 at an M99 that the plan does not contain.
  const brokenDependencyCases = [
    {
      name: "malformed list",
      dependency: "M01 (soft)",
      clause: "dependency list invalid",
      error: /dependencies must be/u,
    },
    {
      name: "blank list",
      dependency: "",
      clause: "dependencies missing",
      error: /missing dependencies/u,
    },
    {
      name: "missing milestone",
      dependency: "M99",
      clause: "needs M99 (missing)",
      error: /dependency M99 does not resolve/u,
    },
    {
      name: "self dependency",
      dependency: "M02",
      clause: "needs M02 (itself)",
      error: /milestone cannot depend on itself/u,
    },
    {
      // The embedded newline writes a second `Depends on` line, whose M01 the parser would otherwise drop.
      name: "repeated field",
      dependency: "none\nDepends on: M01",
      clause: "dependency list invalid",
      error: /multiple Depends on values supplied/u,
    },
  ];
  // Each broken value becomes its own test, so a failure names the author's mistake, such as "a blank list".
  for (const row of brokenDependencyCases) {
    it(`waits on a ${row.name} without inventing a final join`, () => {
      const root = mkdtempSync(
        join(tmpdir(), "goat-flow-dependency-validity-"),
      );
      try {
        const plan = writeCheckPlan(root, {
          "M01-first.md": canonicalMilestoneBody({ title: "M01: First" }),
          "M02-next.md": canonicalMilestoneBody({
            title: "M02: Next",
            dependsOn: row.dependency,
          }),
        });
        // Both modes print the same waiting line and no join advice; only `--strict` exits 1.
        for (const flags of [[], ["--strict"]]) {
          const result = runPlansCheck(plan, ...flags);
          assert.equal(
            result.status,
            flags.length ? 1 : 0,
            result.stdout + result.stderr,
          );
          assert.deepEqual(
            result.stdout
              .split("\n")
              .filter((line) => /^(ready|waiting): /u.test(line)),
            ["ready: M01", `waiting: M02 | ${row.clause}`],
          );
          assert.doesNotMatch(result.stdout, /endings \(/u);
          // In strict mode the author also gets the error behind the waiting line, such as "dependency M99 does not resolve".
          if (flags.length) assert.match(result.stdout, row.error);
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
  // A lone milestone has nothing to depend on, so a blank `Depends on:` line and a missing one must both leave it ready.
  for (const omitDependsOnLine of [false, true]) {
    it(`allows a single milestone with ${omitDependsOnLine ? "omitted" : "blank"} dependencies`, () => {
      const root = mkdtempSync(join(tmpdir(), "goat-flow-single-dependency-"));
      try {
        let body = canonicalMilestoneBody({
          title: "M01: Single",
          dependsOn: "",
        });
        // Example: the author deleted the `Depends on:` line entirely because the plan has only one milestone.
        if (omitDependsOnLine) body = body.replace(/^Depends on:.*\n/mu, "");
        const plan = writeCheckPlan(root, { "M01-single.md": body });
        // Strict mode must not demand a dependency list from a plan that has only one milestone.
        for (const flags of [[], ["--strict"]]) {
          const result = runPlansCheck(plan, ...flags);
          assert.equal(result.status, 0, result.stdout + result.stderr);
          assert.match(result.stdout, /^ready: M01$/mu);
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
  it("suppresses finished-plan join advice for an unresolved dependency", () => {
    const root = mkdtempSync(join(tmpdir(), "goat-flow-finished-dependency-"));
    try {
      const plan = writeCheckPlan(root, {
        "M01-first.md": completedMilestone("M01: First"),
        "M02-next.md": completedMilestone("M02: Next").replace(
          "Depends on: none",
          "Depends on: M99",
        ),
      });
      const result = runPlansCheck(plan, "--strict");
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stdout, /dependency M99 does not resolve/u);
      assert.doesNotMatch(result.stdout, /endings \(/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("suppresses join advice while two files share a milestone ID", () => {
    const root = mkdtempSync(join(tmpdir(), "goat-flow-duplicate-id-join-"));
    try {
      const result = runPlansCheck(
        writeCheckPlan(root, duplicateIdFiles()),
        "--strict",
      );
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stdout, /duplicate milestone ID M02 conflicts/u);
      assert.doesNotMatch(result.stdout, /endings \(/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  // A written `unknown` must not borrow the exemption the export gives an absent Status, which it also stores as `unknown`.
  for (const status of ["abandonned", "unknown"]) {
    it(`suppresses join advice while a Status reads ${status}`, () => {
      const root = mkdtempSync(join(tmpdir(), "goat-flow-status-join-"));
      try {
        // If M02 is really abandoned, M01 is the only ending, so naming two would prescribe a needless join.
        const plan = writeCheckPlan(root, {
          "M01-first.md": canonicalMilestoneBody({ title: "M01: First" }),
          "M02-dropped.md": canonicalMilestoneBody({
            title: "M02: Dropped",
            status,
          }),
        });
        const result = runPlansCheck(plan, "--strict");
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assert.match(
          result.stdout,
          new RegExp(`unsupported status \`${status}\``, "u"),
        );
        assert.doesNotMatch(result.stdout, /endings \(/u);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
  it("retains join advice when only a title is invalid", () => {
    const root = mkdtempSync(join(tmpdir(), "goat-flow-title-join-"));
    try {
      const plan = writeCheckPlan(root, {
        "M01-first.md": canonicalMilestoneBody({ title: "M01: First" }),
        "M02-next.md": canonicalMilestoneBody({ title: "M99: Wrong title" }),
      });
      const result = runPlansCheck(plan, "--strict");
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(
        result.stdout,
        /title ID M99 does not match filename ID M02/u,
      );
      assert.match(result.stdout, /plan has 2 endings \(M01, M02\)/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  // Example: M01 and M02 each list the other under `Depends on`; neither can start, so both stay waiting in either mode.
  for (const flags of [[], ["--strict"]]) {
    it(`keeps cyclic dependencies waiting without join advice in ${flags.length ? "strict" : "default"} mode`, () => {
      const root = mkdtempSync(join(tmpdir(), "goat-flow-cycle-readiness-"));
      try {
        const plan = writeCheckPlan(root, {
          "M01-first.md": canonicalMilestoneBody({
            title: "M01: First",
            dependsOn: "M02",
          }),
          "M02-next.md": canonicalMilestoneBody({
            title: "M02: Next",
            dependsOn: "M01",
          }),
        });
        const result = runPlansCheck(plan, ...flags);
        assert.equal(
          result.status,
          flags.length ? 1 : 0,
          result.stdout + result.stderr,
        );
        assert.deepEqual(
          result.stdout
            .split("\n")
            .filter((line) => /^(ready|waiting): /u.test(line)),
          [
            "waiting: M01 | needs M02 (not-started)",
            "waiting: M02 | needs M01 (not-started)",
          ],
        );
        assert.doesNotMatch(result.stdout, /endings \(/u);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
});

describe("plans check: effort arithmetic and plan shapes", () => {
  /** Writes two in-progress milestones at cap one and pins the full strict report, which omitted and explicit cap-one policy must print alike. */
  it("reports the same cap-one transcript with omitted and explicit policy", () => {
    const root = mkdtempSync(join(tmpdir(), "goat-flow-plan-golden-"));
    const expected = {
      stdout:
        'M18-go.md: ~2 min (1 product / 1 proof / 0 other)\nM19-php.md: ~2 min (1 product / 1 proof / 0 other)\nM20-join.md: ~2 min (1 product / 1 proof / 0 other)\nwaiting: M20 | needs M18 (in-progress), M19 (in-progress); cap 1 full: M18 (in-progress), M19 (in-progress)\nplan: 6 min estimated - mix 50% product / 50% proof / 0% other (rough guide ~70/20/10)\nadvisory: plan mix drifts more than 15 percentage points from the rough ~70/20/10 guide - check for duplicated proof or missing verification; keep and explain the mix when task risk warrants it\ncalibration: uncalibrated - 0 of 3 eligible measured samples\nband coverage: 0 of 0 inside (n/a) - 0 below, 0 above; median width n/a\nplan total: unavailable over 0 measured\nwork-unit calibration: uncalibrated - 0 of 3 eligible measured samples with countable bases\nforecast rule: historical p10/p90; nominal span 80 percentage points is not a future coverage promise\nrule coverage: scored 0 of 0 eligible work-unit samples; no score (n/a); skipped 0 insufficient history, 0 missing completion time\nwarning: M18-go.md: legacy-compatible plain-language problem section is missing; expected "## What problem are we solving or ## The problem"; received "no matching section"\nwarning: M18-go.md: legacy-compatible plain-language benefit section is missing; expected "## Who benefits and how or ## What you get"; received "no matching section"\nwarning: M19-php.md: legacy-compatible plain-language problem section is missing; expected "## What problem are we solving or ## The problem"; received "no matching section"\nwarning: M19-php.md: legacy-compatible plain-language benefit section is missing; expected "## Who benefits and how or ## What you get"; received "no matching section"\nwarning: M20-join.md: legacy-compatible plain-language problem section is missing; expected "## What problem are we solving or ## The problem"; received "no matching section"\nwarning: M20-join.md: legacy-compatible plain-language benefit section is missing; expected "## Who benefits and how or ## What you get"; received "no matching section"\nerror: plan: multiple active milestones: M18, M19\n',
      stderr: "",
      status: 1,
    };
    try {
      // Lanes only matter above cap one, so adding `Lane:` lines must leave this cap-one report unchanged.
      for (const withLane of [false, true]) {
        const plan = writeCheckPlan(root, {
          "M18-go.md":
            canonicalMilestoneBody({
              title: "M18: Go work",
              status: "in-progress",
            }) + (withLane ? "\nLane: go\n" : ""),
          "M19-php.md":
            canonicalMilestoneBody({
              title: "M19: PHP work",
              status: "in-progress",
            }) + (withLane ? "\nLane: php\n" : ""),
          // The not-started join keeps this transcript about the cap rather than the plan's separate endings.
          "M20-join.md": canonicalMilestoneBody({
            title: "M20: Join work",
            dependsOn: "M18, M19",
          }),
        });
        // Omitting `--max-active` must print exactly what `--max-active 1` prints.
        for (const flags of [[], ["--max-active", "1"]]) {
          const actual = runPlansCheck(plan, "--strict", ...flags);
          assert.deepEqual(
            {
              stdout: actual.stdout,
              stderr: actual.stderr,
              status: actual.status,
            },
            expected,
            `lane=${withLane} flags=${flags.join(" ")}`,
          );
        }
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
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

  // Each case hand-edits a Timing Receipt into a state that strict mode must reject with that case's error.
  // Example: the author blocked the milestone but left its timing segment open, or typed the impossible date 1970-02-30.
  for (const testCase of timingEvidenceFailureCases) {
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

  // Writes a split that does not add up to its headline: 10 + 5 + 2 is 17 min, but the headline says ~25 min, so the check exits 1.
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

  // An author who mistypes several estimate fields must see every expected format and received value in one run, not one error per rerun.
  // The test writes one milestone where the author put `(est: soon)` on a task and `two min other` as the plan/admin overhead.
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

  // An indented note under a task must not hide that task's estimate or make the counted work units disagree with the forecast basis.
  // The test writes a task the author explained with an indented `- M01 records why this exact edit was denied.` line.
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

  // Writes task, proof and admin estimates that add up to the 18 / 5 / 2 headline: strict mode passes and the near-guide mix prints no advisory.
  it("strict mode accepts fully derived work with a near-guide mix and no advisory", () => {
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

      // An author may copy any of these shapes, so each must pass strict mode with no `error:` line.
      for (const planPath of [smallPath, standardPath, highRiskPath]) {
        const result = runPlansCheck(planPath, "--strict");
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.doesNotMatch(result.stdout, /error:/u);
      }
    } finally {
      // Remove every plan directory created so far, even when a later shape failed before its check ran.
      for (const root of temporaryRoots) {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });
});
