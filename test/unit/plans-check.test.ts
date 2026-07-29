/**
 * Verifies `plans check` effort-arithmetic reporting end-to-end via the real CLI.
 * Errors fire only on inconsistent arithmetic in estimate-carrying milestones;
 * mix drift stays advisory and estimate-less legacy plans pass with an info line.
 */
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const CLI_PATH = join(PROJECT_ROOT, "src", "cli", "cli.ts");

/** Spawn the real CLI so parser, dispatch, and report rendering stay integrated. */
function runPlansCheck(...args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", CLI_PATH, "plans", "check", ...args],
    { cwd: PROJECT_ROOT, encoding: "utf-8" },
  );
}

/**
 * Write one milestone fixture into a fresh plan directory under the temp root.
 *
 * @param temporaryRoot - per-test temp directory the caller removes afterwards
 * @param body - milestone Markdown
 * @returns the plan directory path to pass to `plans check`
 */
function writeCheckFixture(temporaryRoot: string, body: string): string {
  const planPath = join(temporaryRoot, "plan");
  mkdirSync(planPath, { recursive: true });
  writeFileSync(join(planPath, "M01-fixture.md"), body, "utf-8");
  return planPath;
}

interface EstimatedMilestoneOptions {
  status?: string;
  actualLine?: string;
  planAdminOverhead?: string;
  testingGateLines?: string[];
  midProofLines?: string[];
}

/**
 * Build an estimate-carrying milestone in the worked-example shape.
 *
 * @param effortLine - the full `Effort estimate:` line to embed
 * @param taskLines - task checkbox lines for the `## Tasks` section
 * @param options - optional status and non-task estimate-bearing work
 * @returns milestone Markdown
 */
function estimatedMilestoneBody(
  effortLine: string,
  taskLines: string[],
  options: EstimatedMilestoneOptions = {},
): string {
  return [
    "# M01: Estimated milestone",
    `Status: ${options.status ?? "not-started"}`,
    effortLine,
    ...(options.actualLine ? [options.actualLine] : []),
    ...(options.planAdminOverhead
      ? [`Plan/admin overhead: ${options.planAdminOverhead}`]
      : []),
    "",
    "## Tasks",
    "",
    ...taskLines,
    "",
    ...(options.testingGateLines
      ? ["## Testing Gate", "", ...options.testingGateLines, ""]
      : []),
    ...(options.midProofLines
      ? ["## Mid-implementation proof", "", ...options.midProofLines, ""]
      : []),
  ].join("\n");
}

describe("plans check", () => {
  // The worked-example arithmetic (18 + 5 + 2 = 25) passes without advisories.
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

  // A split that cannot reproduce its own headline is exactly the unauditable
  // aggregate this command exists to catch.
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

  // Declaring an effort line creates the per-task obligation.
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

  // Optional local workflow state is never scored: estimate-less plans pass.
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

  // Drift from 70/20/10 informs without failing - the target is a prior, not a gate.
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
        /actual: ~12 min \(8 product \/ 3 proof \/ 1 other\) - one extra focused check/u,
      );
      assert.doesNotMatch(result.stdout, /error:/u);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

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

  // Write-oriented flags have no meaning for a read-only report.
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
