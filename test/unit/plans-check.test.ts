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

/** Spawns the real CLI so parser, dispatch, and report rendering stay integrated. */
function runPlansCheck(...args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", CLI_PATH, "plans", "check", ...args],
    { cwd: PROJECT_ROOT, encoding: "utf-8" },
  );
}

/** Require every failure to identify one milestone or the whole plan. */
function assertSourceLabelledErrors(stdout: string): void {
  const errorLines = stdout
    .split("\n")
    .filter((line) => line.startsWith("error: "));
  assert.ok(errorLines.length > 0, stdout);
  for (const line of errorLines) {
    assert.match(line, /^error: (?:M.+\.md|plan):/u);
  }
}

/**
 * Writes one milestone fixture into a fresh plan directory under the temp root.
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

/** Write several milestones when a validation case needs plan-level relationships. */
function writeCheckPlan(
  temporaryRoot: string,
  files: Record<string, string>,
): string {
  const planPath = join(temporaryRoot, "plan");
  mkdirSync(planPath, { recursive: true });
  for (const [filename, body] of Object.entries(files)) {
    writeFileSync(join(planPath, filename), body, "utf-8");
  }
  return planPath;
}

/** Optional fields varied by estimate-accounting milestone fixtures. */
interface EstimatedMilestoneOptions {
  title?: string;
  status?: string;
  dependsOn?: string;
  actualLine?: string;
  planAdminOverhead?: string;
  proofHeading?: string;
  testingGateLines?: string[];
  midProofLines?: string[];
  forecastRangeLine?: string;
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
    `# ${options.title ?? "M01: Estimated milestone"}`,
    `Status: ${options.status ?? "not-started"}`,
    `Depends on: ${options.dependsOn ?? "none"}`,
    effortLine,
    ...(options.forecastRangeLine ? [options.forecastRangeLine] : []),
    ...(options.actualLine ? [options.actualLine] : []),
    ...(options.planAdminOverhead
      ? [`Plan/admin overhead: ${options.planAdminOverhead}`]
      : []),
    "",
    "## Scope",
    "",
    "Deliver the estimated outcome.",
    "",
    "## Tasks",
    "",
    ...taskLines,
    "",
    ...(options.testingGateLines
      ? [
          `## ${options.proofHeading ?? "Testing Gate"}`,
          "",
          ...options.testingGateLines,
          "",
        ]
      : []),
    ...(options.midProofLines
      ? ["## Mid-implementation proof", "", ...options.midProofLines, ""]
      : []),
    "## Exit criteria",
    "",
    "The estimated outcome is delivered.",
    "",
    "## Stop / rescope",
    "",
    "Stop if the declared scope changes.",
    "",
  ].join("\n");
}

/** Lifecycle fields varied by the smallest canonical strict-plan fixture. */
interface CanonicalMilestoneOptions {
  title?: string;
  status?: string;
  dependsOn?: string;
  includeDependencies?: boolean;
  isTaskChecked?: boolean;
  proofHeading?: "Proof" | "Testing Gate";
  proofLines?: string[];
  includeActual?: boolean;
}

/** Build the smallest canonical strict fixture while allowing lifecycle variants. */
function canonicalMilestoneBody(
  options: CanonicalMilestoneOptions = {},
): string {
  const taskMarker = options.isTaskChecked ? "x" : " ";
  const proofLines = options.proofLines ?? [
    "- [ ] Outcome is proven → focused check passes. [automated] (est: 1 min proof)",
  ];
  const totalMinutes = 1 + proofLines.length;
  const body = estimatedMilestoneBody(
    `Effort estimate: ~${totalMinutes} min agent-time (1 product / ${proofLines.length} proof / 0 other)`,
    [
      `- [${taskMarker}] Deliver the outcome; done when proof passes. (est: 1 min product)`,
    ],
    {
      title: options.title,
      status: options.status,
      dependsOn: options.dependsOn,
      actualLine: options.includeActual
        ? `Actual: ~${totalMinutes} min agent-time (1 product / ${proofLines.length} proof / 0 other)`
        : undefined,
      planAdminOverhead: "0 min other",
      proofHeading: options.proofHeading ?? "Testing Gate",
      testingGateLines: proofLines,
    },
  );
  return options.includeDependencies === false
    ? body.replace(/^Depends on:.*\n/mu, "")
    : body;
}

/** Insert one finalized receipt before the first body section. */
function withFinalizedTimingReceipt(body: string, totalSeconds = 120): string {
  return body.replace(
    "## Scope",
    [
      "## Timing Receipt",
      "",
      "**Receipt state:** finalized",
      `**Recorded seconds:** ${totalSeconds} total (61 product / 59 proof / 0 other)`,
      "**Allocated minutes:** 2 total (1 product / 1 proof / 0 other)",
      "",
      "| Segment | Category | Start UTC / epoch | End UTC / epoch | Seconds | State |",
      "|---|---|---|---|---:|---|",
      "| M01-S01 | product | 1970-01-01T00:01:40Z / 100 | 1970-01-01T00:02:41Z / 161 | 61 | closed |",
      "| M01-S02 | proof | 1970-01-01T00:03:20Z / 200 | 1970-01-01T00:04:19Z / 259 | 59 | closed |",
      "",
      "## Scope",
    ].join("\n"),
  );
}

/** Render the UTC stamp a receipt segment carries beside its epoch second. */
function receiptStamp(epochSeconds: number): string {
  return `${new Date(epochSeconds * 1000).toISOString().replace(/\.\d{3}Z$/u, "Z")} / ${epochSeconds}`;
}

/**
 * Insert a finalized single-product-segment receipt worth an exact minute count.
 *
 * Calibration ratios divide raw seconds by estimated minutes, so fixtures need
 * receipts whose seconds are chosen rather than inherited from a shared default.
 *
 * @param body - milestone Markdown containing a `## Scope` heading
 * @param productSeconds - whole recorded-unpaused seconds, all in the product category
 * @param milestoneId - milestone ID the segment rows are named after, such as `M02`
 * @returns the milestone Markdown with a receipt above its scope section
 */
function withProductReceipt(
  body: string,
  productSeconds: number,
  milestoneId = "M01",
): string {
  const minutes = Math.round(productSeconds / 60);
  return body.replace(
    "## Scope",
    [
      "## Timing Receipt",
      "",
      "**Receipt state:** finalized",
      `**Recorded seconds:** ${productSeconds} total (${productSeconds} product / 0 proof / 0 other)`,
      `**Allocated minutes:** ${minutes} total (${minutes} product / 0 proof / 0 other)`,
      "",
      "| Segment | Category | Start UTC / epoch | End UTC / epoch | Seconds | State |",
      "|---|---|---|---|---:|---|",
      `| ${milestoneId}-S01 | product | ${receiptStamp(100)} | ${receiptStamp(100 + productSeconds)} | ${productSeconds} | closed |`,
      "",
      "## Scope",
    ].join("\n"),
  );
}

/**
 * Build one calibration-eligible milestone: complete, measured, receipt-backed.
 *
 * @param productSeconds - recorded-unpaused seconds the receipt and Actual both declare
 * @param milestoneId - milestone ID shared by the title, filename, and receipt rows
 * @param status - lifecycle status; only `complete` is calibration-eligible
 * @returns milestone Markdown estimating 10 minutes against the supplied Actual
 */
function eligibleSampleBody(
  productSeconds: number,
  milestoneId = "M01",
  status = "complete",
): string {
  const minutes = Math.round(productSeconds / 60);
  return withProductReceipt(
    estimatedMilestoneBody(
      "Effort estimate: ~10 min agent-time (7 product / 2 proof / 1 other)",
      ["- [x] Build the thing (est: 7 min product)"],
      {
        title: `${milestoneId}: Measured milestone`,
        status,
        actualLine: `Actual: measured: ~${minutes} min agent-time (${minutes} product / 0 proof / 0 other) - receipt ${productSeconds} recorded-unpaused seconds`,
        planAdminOverhead: "1 min other",
        testingGateLines: ["- [x] Run typecheck (est: 2 min proof)"],
      },
    ),
    productSeconds,
    milestoneId,
  );
}

describe("plans check", () => {
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

  it("strict mode rejects an absent deterministic core", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-core-"));
    const planPath = writeCheckFixture(
      temporaryRoot,
      [
        "# M01: Missing core",
        "",
        "**Effort estimate:** ~0 min agent-time (0 product / 0 proof / 0 other)",
        "**Plan/admin overhead:** 0 min other",
        "",
      ].join("\n"),
    );

    try {
      const result = runPlansCheck(planPath, "--strict");

      assert.equal(result.status, 1);
      assertSourceLabelledErrors(result.stdout);
      for (const field of [
        "status",
        "scope",
        "tasks",
        "proof",
        "exit",
        "stop",
      ]) {
        assert.match(result.stdout, new RegExp(`missing ${field}`, "u"));
      }
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("strict mode rejects conflicting canonical and legacy aliases", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-aliases-"),
    );
    const planPath = writeCheckFixture(
      temporaryRoot,
      [
        canonicalMilestoneBody({ proofHeading: "Proof" }),
        "**Objective:** First outcome",
        "",
        "## Objective",
        "Different outcome",
        "",
        "## Testing Gate",
        "- [ ] Legacy duplicate proof. (est: 1 min proof)",
        "",
        "## Kill criteria",
        "Legacy duplicate stop.",
        "",
        "## Scope Discipline",
        "Duplicate scope.",
        "",
        "## Tasks",
        "- [ ] Duplicate task. (est: 1 min product)",
        "",
        "## Exit Criteria",
        "Duplicate exit.",
        "",
      ].join("\n"),
    );

    try {
      const result = runPlansCheck(planPath, "--strict");

      assert.equal(result.status, 1);
      assertSourceLabelledErrors(result.stdout);
      assert.match(result.stdout, /conflicting objective representations/u);
      assert.match(result.stdout, /conflicting proof representations/u);
      assert.match(result.stdout, /conflicting stop representations/u);
      assert.match(result.stdout, /conflicting scope representations/u);
      assert.match(result.stdout, /conflicting task representations/u);
      assert.match(result.stdout, /conflicting exit criteria representations/u);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("strict mode rejects duplicate and mismatched milestone IDs", () => {
    const duplicateRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-duplicate-id-"),
    );
    const mismatchRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-title-id-"),
    );
    const longMismatchRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-long-title-id-"),
    );
    try {
      const duplicatePath = writeCheckPlan(duplicateRoot, {
        "M01-one.md": canonicalMilestoneBody({ title: "M01: One" }),
        "M1-two.md": canonicalMilestoneBody({ title: "M1: Two" }),
      });
      const mismatchPath = writeCheckPlan(mismatchRoot, {
        "M02-wrong.md": canonicalMilestoneBody({ title: "M03: Wrong ID" }),
      });
      const longMismatchPath = writeCheckPlan(longMismatchRoot, {
        "M01-wrong.md": canonicalMilestoneBody({
          title: "Milestone 99: Wrong ID",
        }),
      });

      const duplicate = runPlansCheck(duplicatePath, "--strict");
      const mismatch = runPlansCheck(mismatchPath, "--strict");
      const longMismatch = runPlansCheck(longMismatchPath, "--strict");

      assert.equal(duplicate.status, 1);
      assertSourceLabelledErrors(duplicate.stdout);
      assert.match(duplicate.stdout, /duplicate milestone ID/u);
      assert.equal(mismatch.status, 1);
      assertSourceLabelledErrors(mismatch.stdout);
      assert.match(
        mismatch.stdout,
        /title ID M03 does not match filename ID M02/u,
      );
      assert.equal(longMismatch.status, 1);
      assertSourceLabelledErrors(longMismatch.stdout);
      assert.match(
        longMismatch.stdout,
        /title ID M99 does not match filename ID M01/u,
      );
    } finally {
      rmSync(duplicateRoot, { recursive: true, force: true });
      rmSync(mismatchRoot, { recursive: true, force: true });
      rmSync(longMismatchRoot, { recursive: true, force: true });
    }
  });

  it("strict mode rejects lowercase filenames and missing IDs in multi-milestone titles", () => {
    const lowercaseRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-lowercase-id-"),
    );
    const missingTitleRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-missing-title-id-"),
    );
    try {
      const lowercasePath = writeCheckPlan(lowercaseRoot, {
        "m01-lowercase.md": canonicalMilestoneBody({ title: "M01: One" }),
      });
      const missingTitlePath = writeCheckPlan(missingTitleRoot, {
        "M01-one.md": canonicalMilestoneBody({ title: "Deliver one" }),
        "M02-two.md": canonicalMilestoneBody({
          title: "Deliver two",
          dependsOn: "M01",
        }),
      });

      const lowercase = runPlansCheck(lowercasePath, "--strict");
      const missingTitle = runPlansCheck(missingTitlePath, "--strict");

      assert.equal(lowercase.status, 1, lowercase.stdout + lowercase.stderr);
      assert.match(
        lowercase.stdout,
        /filename must begin with an uppercase M/u,
      );
      assert.equal(
        missingTitle.status,
        1,
        missingTitle.stdout + missingTitle.stderr,
      );
      assert.match(
        missingTitle.stdout,
        /multi-milestone title must begin with its milestone ID/u,
      );
    } finally {
      rmSync(lowercaseRoot, { recursive: true, force: true });
      rmSync(missingTitleRoot, { recursive: true, force: true });
    }
  });

  it("strict mode accepts the supported long-form milestone title ID", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-long-title-match-"),
    );
    try {
      const planPath = writeCheckPlan(temporaryRoot, {
        "M01-one.md": canonicalMilestoneBody({
          title: "Milestone 01: One",
        }),
      });

      const result = runPlansCheck(planPath, "--strict");

      assert.equal(result.status, 0, result.stdout || result.stderr);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  const dependencyFailureCases: Array<{
    name: string;
    files: Record<string, string>;
    expected: RegExp;
  }> = [
    {
      name: "malformed",
      files: {
        "M01-one.md": canonicalMilestoneBody({ title: "M01: One" }),
        "M02-two.md": canonicalMilestoneBody({
          title: "M02: Two",
          dependsOn: "M01 (soft)",
        }),
      },
      expected:
        /dependencies must be `none` or comma-separated local milestone IDs/u,
    },
    {
      name: "unresolved",
      files: {
        "M01-one.md": canonicalMilestoneBody({ title: "M01: One" }),
        "M02-two.md": canonicalMilestoneBody({
          title: "M02: Two",
          dependsOn: "M09",
        }),
      },
      expected: /dependency M09 does not resolve/u,
    },
    {
      name: "self",
      files: {
        "M01-one.md": canonicalMilestoneBody({
          title: "M01: One",
          dependsOn: "M01",
        }),
      },
      expected: /cannot depend on itself/u,
    },
    {
      name: "cycle",
      files: {
        "M01-one.md": canonicalMilestoneBody({
          title: "M01: One",
          dependsOn: "M02",
        }),
        "M02-two.md": canonicalMilestoneBody({
          title: "M02: Two",
          dependsOn: "M01",
        }),
      },
      expected: /dependency cycle/u,
    },
    {
      name: "state",
      files: {
        "M01-one.md": canonicalMilestoneBody({ title: "M01: One" }),
        "M02-two.md": canonicalMilestoneBody({
          title: "M02: Two",
          status: "in-progress",
          dependsOn: "M01",
        }),
      },
      expected:
        /active or complete milestone requires dependency M01 to be complete/u,
    },
  ];

  // Separate cases show the exact dependency failure in TAP output.
  for (const testCase of dependencyFailureCases) {
    it(`strict mode rejects ${testCase.name} dependency state`, () => {
      const temporaryRoot = mkdtempSync(
        join(tmpdir(), `goat-flow-plan-dependency-${testCase.name}-`),
      );
      try {
        const planPath = writeCheckPlan(temporaryRoot, testCase.files);
        const result = runPlansCheck(planPath, "--strict");
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assertSourceLabelledErrors(result.stdout);
        assert.match(result.stdout, testCase.expected);
      } finally {
        rmSync(temporaryRoot, { recursive: true, force: true });
      }
    });
  }

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
      name: "invalid-status",
      body: canonicalMilestoneBody({ status: "planned" }),
      expected: /unsupported status `planned`/u,
    },
  ];

  // Separate cases show the exact lifecycle failure in TAP output.
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

  it("strict mode allows only human-owned proof to remain open at the pending gate", () => {
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
      const result = runPlansCheck(planPath, "--strict");
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.doesNotMatch(result.stdout, /error:/u);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

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

  // An optional band is only meaningful if it shares the headline's unit and centre.
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

  for (const testCase of forecastRangeFailureCases) {
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

  // Fewer than three samples cannot support a correction factor, so say so instead of guessing one.
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

  // The three Actual shapes goat-debug-improve actually carries must all stay out of calibration.
  it("excludes prose-measured, retrospective, and empty legacy Actuals from calibration", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-legacy-"));
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

  // Human ratification is the eligibility signal; measured data alone is not enough.
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

  // Ratios divide raw receipt seconds by estimated minutes so rounding never compounds.
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
