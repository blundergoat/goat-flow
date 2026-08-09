/**
 * Shared fixture builders for the `plans check` CLI suites.
 * Every case here works the same way: write a milestone the way an author would, run the real
 * CLI against it, and assert on the exact lines the author would read. These builders own the
 * milestone grammar - estimate lines, timing receipts, canonical sections - so a test states
 * only what it varies and the reader is not re-parsing boilerplate to find the point.
 *
 * Receipt builders exist in finalized, paused, and active variants because the checker treats
 * each state differently: a live clock creates obligations a historical note does not.
 */
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
export const CLI_PATH = join(PROJECT_ROOT, "src", "cli", "cli.ts");

/** Spawns the real CLI so parser, dispatch, and report rendering stay integrated.
 *
 * @param args - CLI arguments exactly as an author would type them after `plans`
 * @returns the finished process with stdout/stderr strings, so a test asserts on the
 *   same text the author reads; the CLI never runs interactively here
 */
export function runPlansCheck(...args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", CLI_PATH, "plans", "check", ...args],
    { cwd: PROJECT_ROOT, encoding: "utf-8" },
  );
}

/** Require every failure to identify one milestone or the whole plan.
 *
 * @param stdout - the CLI output under test; every error line must name its source
 *   milestone file, because an unlabelled error strands the author with no file to open
 */
export function assertSourceLabelledErrors(stdout: string): void {
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
export function writeCheckFixture(temporaryRoot: string, body: string): string {
  const planPath = join(temporaryRoot, "plan");
  mkdirSync(planPath, { recursive: true });
  writeFileSync(join(planPath, "M01-fixture.md"), body, "utf-8");
  return planPath;
}

/** Write several milestones when a validation case needs plan-level relationships.
 *
 * @param temporaryRoot - disposable directory owning this fixture plan
 * @param files - milestone bodies keyed by filename; an empty map writes a plan directory
 *   with nothing in it, which the checker must treat as empty rather than crash on
 * @returns the plan directory path to pass to the CLI
 */
export function writeCheckPlan(
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
  forecastBasisLine?: string;
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
export function estimatedMilestoneBody(
  effortLine: string,
  taskLines: string[],
  options: EstimatedMilestoneOptions = {},
): string {
  return [
    `# ${options.title ?? "M01: Estimated milestone"}`,
    `Status: ${options.status ?? "not-started"}`,
    `Depends on: ${options.dependsOn ?? "none"}`,
    effortLine,
    ...(options.forecastBasisLine ? [options.forecastBasisLine] : []),
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

/** Build the smallest canonical strict fixture while allowing lifecycle variants.
 *
 * @param options - deviations from the canonical shape; omitted fields keep the fully
 *   valid default so a test states only what it breaks
 * @returns complete milestone Markdown in the canonical strict-mode shape
 */
export function canonicalMilestoneBody(
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

/** Insert one finalized receipt before the first body section.
 *
 * @param body - milestone Markdown to append the receipt to
 * @param totalSeconds - measured total the receipt reports; defaults to a plausible value
 * @returns the milestone with a finalized receipt, the state a measured Actual may cite
 */
export function withFinalizedTimingReceipt(
  body: string,
  totalSeconds = 120,
): string {
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

/** Add one paused receipt showing that the milestone has already recorded work.
 *
 * @param body - milestone Markdown to append the receipt to
 * @returns the milestone with a paused receipt: clock stopped, work not yet finalized
 */
export function withPausedTimingReceipt(body: string): string {
  return body.replace(
    "## Scope",
    [
      "## Timing Receipt",
      "",
      "**Receipt state:** paused",
      "",
      "| Segment | Category | Start UTC / epoch | End UTC / epoch | Seconds | State |",
      "|---|---|---|---|---:|---|",
      `| M01-S01 | product | ${receiptStamp(100)} | ${receiptStamp(160)} | 60 | closed |`,
      "",
      "## Scope",
    ].join("\n"),
  );
}

/** Add one active receipt showing that the user still has a running clock.
 *
 * @param body - milestone Markdown to append the receipt to
 * @returns the milestone with a live receipt, which makes receipt-shape warnings fatal
 */
export function withActiveTimingReceipt(body: string): string {
  return body.replace(
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
  );
}

/** Add a derived summary to a non-final receipt for stale-authority fixtures.
 *
 * @param body - milestone Markdown to append the summary to
 * @param productSeconds - seconds the summary claims for product work
 * @param state - receipt state the summary sits beside; a non-final state is what makes the
 *   claimed total stale authority
 * @returns the milestone with a summary line claiming a final total
 */
export function withTimingSummary(
  body: string,
  state: "active" | "paused" | "incomplete",
  productSeconds: number,
): string {
  const productMinutes = Math.round(productSeconds / 60);
  return body.replace(
    `**Receipt state:** ${state}`,
    [
      `**Receipt state:** ${state}`,
      `**Recorded seconds:** ${productSeconds} total (${productSeconds} product / 0 proof / 0 other)`,
      `**Allocated minutes:** ${productMinutes} total (${productMinutes} product / 0 proof / 0 other)`,
    ].join("\n"),
  );
}

/** Render the UTC stamp a receipt segment carries beside its epoch second.
 *
 * @param epochSeconds - moment to render, in seconds since the epoch
 * @returns the ISO timestamp form the receipt grammar expects
 */
export function receiptStamp(epochSeconds: number): string {
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
export function withProductReceipt(
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
export function eligibleSampleBody(
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

/**
 * Build one completed sample whose measured receipt can teach later plans minutes per work unit.
 *
 * @param productSeconds - recorded agent seconds; zero means a completed instant fixture
 * @param milestoneId - visible milestone ID used by the title and receipt; empty produces an invalid fixture
 * @returns a complete three-unit milestone with a structured forecast basis and finalized receipt
 */
export function eligibleWorkUnitSampleBody(
  productSeconds: number,
  milestoneId = "M01",
): string {
  const measuredMinutes = Math.round(productSeconds / 60);
  return withProductReceipt(
    estimatedMilestoneBody(
      "Effort estimate: ~9 min agent-time (3 product / 3 proof / 3 other)",
      ["- [x] Build the thing (est: 3 min product)"],
      {
        title: `${milestoneId}: Work-unit sample`,
        status: "complete",
        actualLine: `Actual: measured: ~${measuredMinutes} min agent-time (${measuredMinutes} product / 0 proof / 0 other) - receipt ${productSeconds} recorded-unpaused seconds`,
        forecastBasisLine:
          "Forecast basis: 3 agent work units; 0.5-3-10 min/unit low-likely-high; source: recorded planning basis",
        forecastRangeLine:
          "Forecast range: 1-30 agent-time minutes on one recorded-unpaused milestone timeline; likely 9; derived from the recorded planning basis",
        planAdminOverhead: "3 min other",
        testingGateLines: ["- [x] Run typecheck (est: 3 min proof)"],
      },
    ),
    productSeconds,
    milestoneId,
  );
}
