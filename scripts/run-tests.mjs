#!/usr/bin/env node
// Runs the test mode a maintainer selects: fast, coverage, slow, or performance.
//
// Fast runs omit slow and performance suites; --shard=<index>/<total> distributes a mode across separate CI machines.
// Slow tests run one at a time because they share repository state such as .goat-flow/dashboard-state.json.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, sep } from "node:path";

// With no mode argument, a maintainer gets the fast suite used for ordinary local verification.
const mode = process.argv[2] ?? "fast";

/**
 * Normalize discovered paths so maintainers select the same test suites on Windows and POSIX.
 *
 * @param path - A path that may use the platform separator (`\` on Windows).
 * @returns The same path with every separator replaced by `/`.
 */
function toPosixPath(path) {
  return path.split(sep).join("/");
}

/**
 * Find available tests before applying the maintainer's selected mode, with a stable order across directory scans.
 *
 * @param dir - Directory to walk; defaults to the repo's `test` root.
 * @returns sorted POSIX-style test paths; an empty list makes the selected mode fail with a no-tests diagnostic
 */
function listTestFiles(dir = "test") {
  const files = [];
  // Discover nested tests as well as direct children so adding a test folder does not silently exclude it from verification.
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    // Search subfolders recursively; only regular .test.ts files become runnable choices for the maintainer.
    if (entry.isDirectory()) {
      files.push(...listTestFiles(path));
    } else if (entry.isFile() && path.endsWith(".test.ts")) {
      files.push(toPosixPath(path));
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

/**
 * Select costly integration, installer, dashboard, and audit tests for the maintainer's separate slow run.
 * Excluding these from fast mode keeps local feedback short; slow mode runs them one at a time.
 *
 * @param path - Posix-style test file path to classify.
 * @returns `true` when the file belongs to the slow suite.
 */
function isSlowTest(path) {
  const exactPaths = [
    "test/integration/cli-manifest-drift.test.ts",
    "test/integration/main-guard.test.ts",
    "test/integration/audit-quality.test.ts",
    "test/integration/packaged-hook-install.test.ts",
    "test/integration/quality-constraint-isolation.test.ts",
    "test/integration/hook-effective-state.test.ts",
    "test/integration/setup-quality-lifecycle.test.ts",
    "test/unit/audit-harness/check-evidence-before-claims.test.ts",
  ];
  const patterns = [
    /^test\/integration\/audit-drift[^/]*\.test\.ts$/u,
    /^test\/integration\/dashboard[^/]*\.test\.ts$/u,
    /^test\/integration\/setup-install[^/]*\.test\.ts$/u,
    /^test\/unit\/dashboard-terminal-launch\/[^/]*\.test\.ts$/u,
  ];
  return (
    exactPaths.includes(path) || patterns.some((pattern) => pattern.test(path))
  );
}

/**
 * Identify benchmarks a maintainer must request through performance mode and its GOAT_FLOW_PERF_TESTS environment gate.
 *
 * @param path - Posix-style test file path to classify.
 * @returns `true` when the file is a performance test.
 */
function isPerformanceTest(path) {
  return /^test\/performance\/[^/]*\.test\.ts$/u.test(path);
}

/**
 * Select the tests requested by the maintainer's CLI mode before any shard split.
 * An unknown mode exits with code 2 and lists valid choices instead of running an unintended suite.
 *
 * @param allFiles - Every discovered test file (from {@link listTestFiles}).
 * @returns tests selected for this mode; an empty list produces the no-tests failure at launch
 */
function filesForMode(allFiles) {
  switch (mode) {
    case "fast":
    case "coverage":
      return allFiles.filter(
        (path) => !isSlowTest(path) && !isPerformanceTest(path),
      );
    case "slow":
      return allFiles.filter(isSlowTest);
    case "performance":
      return allFiles.filter(isPerformanceTest);
    default:
      console.error(
        `Unknown test mode "${mode}". Expected fast, coverage, slow, or performance.`,
      );
      process.exit(2);
  }
}

// Measured CI durations balance the slow suite across machines; refresh them from TAP duration_ms values when shard timings drift.
//
// A new file uses DEFAULT_FILE_SECONDS until measured, so missing timing data never excludes a maintainer's new test.
const SLOW_FILE_SECONDS = {
  "test/integration/setup-install-agent-matrix.test.ts": 120,
  "test/integration/audit-drift-checkdrift-installer-round-trip-fixture.test.ts": 97,
  "test/integration/setup-install-write-set.test.ts": 86,
  "test/integration/setup-install-migrations.test.ts": 78,
  "test/integration/setup-install.test.ts": 61,
  "test/integration/setup-install-preview.test.ts": 53,
  "test/integration/setup-install-force-authority.test.ts": 45,
  "test/integration/setup-install-codex-config-migration.test.ts": 35,
  "test/integration/setup-install-upgrade-1150.test.ts": 33,
  "test/integration/setup-install-atomic-staging.test.ts": 22,
  "test/integration/dashboard-audit-api.test.ts": 14,
  "test/integration/dashboard-server-dashboard-api-setup.test.ts": 10,
  "test/integration/dashboard-server-dashboard-api-quality.test.ts": 10,
};

/** Cost assumed for a file with no measurement: roughly one process start plus a short suite. */
const DEFAULT_FILE_SECONDS = 5;

/**
 * Read the maintainer's --shard=<index>/<total> choice, using the same 1-based numbering as the CI matrix and logs.
 *
 * An invalid choice writes a diagnostic to stderr and exits with code 2 instead of widening the requested run to the whole suite.
 *
 * @returns `{ index, total }` for a valid request, or `null` when no shard was requested.
 */
function parseShard() {
  const flag = process.argv.find((argument) => argument.startsWith("--shard="));
  // A maintainer who omits --shard runs the mode's complete selection on this machine.
  if (!flag) return null;
  // Require whole integers: parseInt alone would turn a mistyped shard such as 1x/5 or 1.5/5 into a different request.
  const match = /^(\d+)\/(\d+)$/u.exec(flag.slice("--shard=".length));
  const index = match ? Number.parseInt(match[1], 10) : Number.NaN;
  const total = match ? Number.parseInt(match[2], 10) : Number.NaN;
  // A malformed or nonexistent shard is a command error, never permission to claim an unrequested test run passed.
  if (match === null || total < 1 || index < 1 || index > total) {
    console.error(
      `Invalid --shard value "${flag}". Expected --shard=<index>/<total> with 1 <= index <= total.`,
    );
    process.exit(2);
  }
  return { index, total };
}

/**
 * Balance the maintainer's selected tests across CI shards, assigning each file once and preserving the complete selection across machines.
 * Starts with the longest measured tests, then returns this shard's files in their original stable order.
 *
 * @param allFiles - the mode's full file selection, in deterministic sorted order.
 * @param shard - the requested `{ index, total }` split.
 * @returns this shard's files in stable order; an empty shard fails at launch rather than claiming test coverage
 */
function filesForShard(allFiles, shard) {
  const buckets = Array.from({ length: shard.total }, () => ({
    seconds: 0,
    files: new Set(),
  }));
  const byCostDescending = [...allFiles].sort(
    (left, right) =>
      (SLOW_FILE_SECONDS[right] ?? DEFAULT_FILE_SECONDS) -
      (SLOW_FILE_SECONDS[left] ?? DEFAULT_FILE_SECONDS),
  );
  // Give the next costly test to the least-loaded shard so maintainers spend less time waiting for one final CI machine.
  for (const file of byCostDescending) {
    const cheapest = buckets.reduce((best, bucket) =>
      bucket.seconds < best.seconds ? bucket : best,
    );
    cheapest.files.add(file);
    cheapest.seconds += SLOW_FILE_SECONDS[file] ?? DEFAULT_FILE_SECONDS;
  }
  const selected = buckets[shard.index - 1];
  console.error(
    `${mode} shard ${shard.index}/${shard.total}: ${selected.files.size} file(s), ~${selected.seconds}s of measured work`,
  );
  return allFiles.filter((file) => selected.files.has(file));
}

const shard = parseShard();
const modeTestFiles = filesForMode(listTestFiles());
// No shard means the full mode; a requested shard runs only its assigned files.
const testFilesToRun = shard
  ? filesForShard(modeTestFiles, shard)
  : modeTestFiles;
// An empty selection cannot verify the maintainer's change, so report it instead of claiming a successful run.
if (testFilesToRun.length === 0) {
  console.error(`No ${mode} test files found.`);
  process.exit(1);
}

// Explicit performance mode enables benchmarks that ordinary verification leaves gated off.
if (mode === "performance") {
  process.env.GOAT_FLOW_PERF_TESTS = "1";
}

const testRunnerArguments = [
  "--import",
  "tsx",
  "--test",
  "--test-concurrency",
  mode === "slow" ? "1" : mode === "fast" ? "8" : "8",
];
// Coverage mode records the actual Node runtime so maintainers can reproduce a version-specific reporter failure.
if (mode === "coverage") {
  console.error(
    `Coverage runtime: Node ${process.version} (${process.execPath})`,
  );
  testRunnerArguments.push("--experimental-test-coverage");
}
testRunnerArguments.push(...testFilesToRun);

const testRunResult = spawnSync(process.execPath, testRunnerArguments, {
  env: process.env,
  stdio: "inherit",
});

// A launch failure means no trustworthy test result exists; show the underlying error and fail the maintainer's command.
if (testRunResult.error) {
  console.error(testRunResult.error);
  process.exit(1);
}
// A killed or interrupted runner leaves verification incomplete even if some assertions already passed.
if (testRunResult.signal) {
  console.error(`Test runner terminated by signal ${testRunResult.signal}.`);
  process.exit(1);
}
// Preserve the test process's exit status; no status means verification failed, not a clean run.
process.exit(testRunResult.status ?? 1);
