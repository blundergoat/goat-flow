/**
 * Verifies prospective milestone timing from safe path resolution through
 * receipt persistence, final Actual derivation, and non-authoritative events.
 */
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { parseCLIArgs } from "../../src/cli/cli-parser.js";
import {
  allocateTimingMinutes,
  applyPlanTimeTransition,
} from "../../src/cli/plans-time.js";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "..", "..");
const CLI_PATH = join(REPOSITORY_ROOT, "src", "cli", "cli.ts");

/**
 * Writes one canonical milestone nested under a selected project's plan tree.
 * Use as the starting point for any timing test that needs a real milestone file on disk.
 *
 * @param temporaryRoot - throwaway directory the fixture writes into; the caller removes it
 * @returns paths to the written milestone, its plan directory, and the project root
 */
function writeTimingFixture(temporaryRoot: string): {
  milestonePath: string;
  planPath: string;
  projectRoot: string;
} {
  const projectRoot = join(temporaryRoot, "target");
  const planPath = join(
    projectRoot,
    ".goat-flow",
    "plans",
    "1.15.0",
    "timing-fixture",
  );
  const milestonePath = join(planPath, "M01-timing-fixture.md");
  mkdirSync(planPath, { recursive: true });
  writeFileSync(
    milestonePath,
    [
      "# M01: Timing fixture",
      "",
      "**Status:** human-verification-pending",
      "**Depends on:** none",
      "**Effort estimate:** ~2 min agent-time (1 product / 1 proof / 0 other)",
      "**Actual:** _",
      "**Plan/admin overhead:** 0 min other",
      "",
      "## Scope",
      "",
      "Record one milestone timeline.",
      "",
      "## Tasks",
      "",
      "- [x] Deliver the fixture. (est: 1 min product)",
      "",
      "## Proof",
      "",
      "- [x] C1: The fixture is proven. [automated] (est: 1 min proof)",
      "",
      "## Exit",
      "",
      "- Timing is finalized.",
      "- Stop/rescope if safe persistence fails.",
      "",
    ].join("\n"),
    "utf-8",
  );
  return { milestonePath, planPath, projectRoot };
}

/**
 * Spawns the real plans CLI so parser and dispatch coverage stays end-to-end.
 * Use instead of calling the handler directly when the test must prove command wiring too.
 *
 * @param args - argv after `plans`; empty means the bare command, which prints usage
 * @returns the finished process result, including stdout the user would have seen
 */
function runPlans(...args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", CLI_PATH, "plans", ...args],
    { cwd: REPOSITORY_ROOT, encoding: "utf-8" },
  );
}

/** Create a symlink, or skip only when the host forbids unprivileged links. */
function symlinkOrSkip(
  testContext: TestContext,
  target: string,
  link: string,
): boolean {
  try {
    symlinkSync(target, link, "dir");
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === "EPERM"
    ) {
      testContext.skip(
        "Skipped: host blocks unprivileged symlinks (Windows without Developer Mode)",
      );
      return false;
    }
    throw error;
  }
}

describe("plans time", () => {
  it("parses the three timing actions and rejects contradictory flags", () => {
    const milestonePath = resolve("M01-fixture.md");
    const start = parseCLIArgs([
      "plans",
      "time",
      "start",
      milestonePath,
      "--category",
      "proof",
    ]);
    const stop = parseCLIArgs([
      "plans",
      "time",
      "stop",
      milestonePath,
      "--finalize",
    ]);
    const status = parseCLIArgs(["plans", "time", "status", milestonePath]);

    assert.equal(start.plansSubcommand, "time");
    assert.equal(start.plansTimeAction, "start");
    assert.equal(start.plansTimeCategory, "proof");
    assert.equal(start.projectPath, milestonePath);
    assert.equal(stop.plansTimeAction, "stop");
    assert.equal(stop.plansTimeFinalize, true);
    assert.equal(status.plansTimeAction, "status");
    assert.throws(
      () =>
        parseCLIArgs([
          "plans",
          "time",
          "stop",
          milestonePath,
          "--finalize",
          "--discard-open",
        ]),
      /cannot be combined/u,
    );
    assert.throws(
      () => parseCLIArgs(["plans", "time", "start", milestonePath]),
      /requires --category/u,
    );
  });

  it("rounds the raw total once and allocates category ties deterministically", () => {
    assert.deepEqual(
      allocateTimingMinutes({ product: 61, proof: 59, other: 0 }),
      {
        totalMinutes: 2,
        split: { product: 1, proof: 1, other: 0 },
      },
    );
    assert.deepEqual(
      allocateTimingMinutes({ product: 30, proof: 30, other: 0 }),
      {
        totalMinutes: 1,
        split: { product: 1, proof: 0, other: 0 },
      },
    );
  });

  // Covers pause, category change, and finalization in one run: writes each transition into the milestone.
  it("records pause, category change, and finalization inside the milestone", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-time-"));
    const { milestonePath, planPath, projectRoot } =
      writeTimingFixture(temporaryRoot);

    try {
      applyPlanTimeTransition(
        milestonePath,
        { action: "start", category: "product" },
        100,
      );
      applyPlanTimeTransition(milestonePath, { action: "stop" }, 161);
      applyPlanTimeTransition(
        milestonePath,
        { action: "start", category: "proof" },
        200,
      );
      const finalized = applyPlanTimeTransition(
        milestonePath,
        { action: "stop", finalize: true },
        259,
      );
      const content = readFileSync(milestonePath, "utf-8");

      assert.equal(finalized.receipt.state, "finalized");
      assert.deepEqual(finalized.receipt.summary, {
        totalSeconds: 120,
        seconds: { product: 61, proof: 59, other: 0 },
        totalMinutes: 2,
        minutes: { product: 1, proof: 1, other: 0 },
      });
      assert.match(content, /\*\*Receipt state:\*\* finalized/u);
      assert.match(
        content,
        /\*\*Recorded seconds:\*\* 120 total \(61 product \/ 59 proof \/ 0 other\)/u,
      );
      assert.match(
        content,
        /\*\*Allocated minutes:\*\* 2 total \(1 product \/ 1 proof \/ 0 other\)/u,
      );
      assert.match(
        content,
        /\*\*Actual:\*\* measured: ~2 min agent-time \(1 product \/ 1 proof \/ 0 other\) - receipt 120 recorded-unpaused seconds/u,
      );
      assert.match(content, /\| M01-S01 \| product .* \| 61 \| closed \|/u);
      assert.match(content, /\| M01-S02 \| proof .* \| 59 \| closed \|/u);
      assert.equal(
        readFileSync(
          join(projectRoot, ".goat-flow", "logs", "events", "1970-01-01.jsonl"),
          "utf-8",
        )
          .trim()
          .split("\n").length,
        4,
      );

      rmSync(join(projectRoot, ".goat-flow", "logs", "events"), {
        recursive: true,
        force: true,
      });
      const check = runPlans("check", planPath, "--strict");
      assert.equal(check.status, 0, check.stdout + check.stderr);
      assert.doesNotMatch(check.stdout, /error:/u);

      const status = runPlans(
        "time",
        "status",
        milestonePath,
        "--format",
        "json",
      );
      assert.equal(status.status, 0, status.stderr);
      assert.equal(
        (JSON.parse(status.stdout) as { receipt: { state: string } }).receipt
          .state,
        "finalized",
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  // Covers an interrupted span: writes the discard and expects no invented end or duration.
  it("discards an interrupted span without inventing an end or duration", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-time-"));
    const { milestonePath } = writeTimingFixture(temporaryRoot);

    const startEpochSeconds = 100;
    const discardEpochSeconds = 500;

    try {
      applyPlanTimeTransition(
        milestonePath,
        { action: "start", category: "other" },
        startEpochSeconds,
      );
      const discarded = applyPlanTimeTransition(
        milestonePath,
        { action: "stop", discardOpen: true },
        discardEpochSeconds,
      );
      const content = readFileSync(milestonePath, "utf-8");

      assert.equal(discarded.receipt.state, "incomplete");
      assert.equal(discarded.receipt.segments[0]?.endEpochSeconds, null);
      assert.equal(discarded.receipt.segments[0]?.seconds, null);
      assert.equal(
        discarded.receipt.segments[0]?.discardedAtEpochSeconds,
        discardEpochSeconds,
      );
      assert.match(
        content,
        /\| _ \| _ \| discarded 1970-01-01T00:08:20Z \/ 500 \|/u,
      );
      assert.match(
        content,
        /\*\*Actual:\*\* incomplete: receipt contains a discarded open span/u,
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  // Covers reopening a finalized receipt when verification continues: writes the reopen transition.
  it("reopens a finalized receipt when verification continues", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-time-"));
    const { milestonePath } = writeTimingFixture(temporaryRoot);

    try {
      applyPlanTimeTransition(
        milestonePath,
        { action: "start", category: "product" },
        100,
      );
      applyPlanTimeTransition(
        milestonePath,
        { action: "stop", finalize: true },
        160,
      );
      const reopened = applyPlanTimeTransition(
        milestonePath,
        { action: "start", category: "proof" },
        200,
      );

      assert.equal(reopened.receipt.state, "active");
      assert.equal(reopened.receipt.summary, undefined);
      assert.equal(reopened.receipt.segments.length, 2);
      assert.match(readFileSync(milestonePath, "utf-8"), /\*\*Actual:\*\* _/u);

      const refinalized = applyPlanTimeTransition(
        milestonePath,
        { action: "stop", finalize: true },
        260,
      );
      assert.deepEqual(refinalized.receipt.summary, {
        totalSeconds: 120,
        seconds: { product: 60, proof: 60, other: 0 },
        totalMinutes: 2,
        minutes: { product: 1, proof: 1, other: 0 },
      });
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("rejects clock reversal and leaves the open span unchanged", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-time-"));
    const { milestonePath } = writeTimingFixture(temporaryRoot);

    try {
      applyPlanTimeTransition(
        milestonePath,
        { action: "start", category: "product" },
        100,
      );
      const before = readFileSync(milestonePath, "utf-8");
      assert.throws(
        () => applyPlanTimeTransition(milestonePath, { action: "stop" }, 99),
        /clock moved backwards/u,
      );
      assert.equal(readFileSync(milestonePath, "utf-8"), before);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  /*
   * Covers the intersection a stuck operator actually hits: writes a span the
   * clock reversed under, then discards it. The clock-reversal error tells the
   * operator to discard, so the discard has to work under the exact condition
   * that raises it. Testing reversal and discard on separate spans passes while
   * their intersection - the only path out - stays broken.
   */
  it("lets discard-open recover a span the clock reversed under", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-time-"));
    const { milestonePath } = writeTimingFixture(temporaryRoot);

    try {
      applyPlanTimeTransition(
        milestonePath,
        { action: "start", category: "product" },
        100,
      );

      const result = applyPlanTimeTransition(
        milestonePath,
        { action: "stop", discardOpen: true },
        99,
      );

      assert.equal(result.receipt.state, "incomplete");
      assert.equal(result.receipt.segments.length, 1);
      assert.equal(result.receipt.segments[0]?.state, "discarded");
      assert.equal(result.receipt.segments[0]?.seconds, null);
      assert.equal(result.receipt.segments[0]?.endEpochSeconds, null);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("keeps a successful receipt write when the diagnostic event path is blocked", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-time-"));
    const { milestonePath, projectRoot } = writeTimingFixture(temporaryRoot);
    writeFileSync(join(projectRoot, ".goat-flow", "logs"), "blocked", "utf-8");

    try {
      const result = applyPlanTimeTransition(
        milestonePath,
        { action: "start", category: "product" },
        100,
      );

      assert.equal(result.event.ok, false);
      assert.match(result.event.error ?? "", /project-local directory/u);
      assert.match(
        readFileSync(milestonePath, "utf-8"),
        /\*\*Receipt state:\*\* active/u,
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked plan parent", (testContext) => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-time-"));
    const projectRoot = join(temporaryRoot, "target");
    const outsideVersion = join(temporaryRoot, "outside", "1.15.0");
    const outsidePlan = join(outsideVersion, "timing-fixture");
    const milestonePath = join(outsidePlan, "M01-timing-fixture.md");
    mkdirSync(outsidePlan, { recursive: true });
    mkdirSync(join(projectRoot, ".goat-flow", "plans"), { recursive: true });
    writeFileSync(milestonePath, "# M01: Unsafe\n", "utf-8");
    const linkedVersion = join(projectRoot, ".goat-flow", "plans", "1.15.0");

    try {
      if (!symlinkOrSkip(testContext, outsideVersion, linkedVersion)) return;
      assert.throws(
        () =>
          applyPlanTimeTransition(
            join(linkedVersion, "timing-fixture", "M01-timing-fixture.md"),
            { action: "start", category: "product" },
            100,
          ),
        /symlink/u,
      );
      assert.equal(readFileSync(milestonePath, "utf-8"), "# M01: Unsafe\n");
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("rejects a hardlinked milestone destination", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-time-"));
    const { milestonePath } = writeTimingFixture(temporaryRoot);
    const secondLink = join(dirname(milestonePath), "M01-second-link.md");
    linkSync(milestonePath, secondLink);

    try {
      assert.throws(
        () =>
          applyPlanTimeTransition(
            milestonePath,
            { action: "start", category: "product" },
            100,
          ),
        /single-link regular file/u,
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
