#!/usr/bin/env node
// Test runner dispatch: selects the test files for a mode (fast | coverage |
// slow | performance) and runs them under `node --import tsx --test`. Keeps the
// slow/perf suites out of the default `fast` run so local iteration stays quick.
//
// `--shard=<index>/<total>` splits the selected files across that many runners so CI can spend wall-clock on parallel machines instead of
// one long serial job. Sharding is a cross-machine split: every shard keeps its own single-concurrency process, so slow tests that share
// repository-root state (`.goat-flow/dashboard-state.json`) still never run beside each other on the same checkout.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, sep } from "node:path";

const mode = process.argv[2] ?? "fast";

/**
 * Normalise an OS-native path to forward slashes so the mode predicates below
 * can match with portable `test/...` regexes on Windows as well as POSIX.
 *
 * @param path - A path that may use the platform separator (`\` on Windows).
 * @returns The same path with every separator replaced by `/`.
 */
function toPosixPath(path) {
  return path.split(sep).join("/");
}

/**
 * Recursively collect every `*.test.ts` file under a directory, returned as
 * sorted posix paths so runs are deterministic across platforms.
 *
 * @param dir - Directory to walk; defaults to the repo's `test` root.
 * @returns Sorted array of posix-style test file paths.
 */
function listTestFiles(dir = "test") {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTestFiles(path));
    } else if (entry.isFile() && path.endsWith(".test.ts")) {
      files.push(toPosixPath(path));
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

/**
 * Predicate for the slow suite: integration/dashboard/audit-drift tests,
 * subprocess-heavy installer tests, and a few known-heavy units that are
 * excluded from the default `fast` run and run single-concurrency in `slow` mode.
 *
 * @param path - Posix-style test file path to classify.
 * @returns `true` when the file belongs to the slow suite.
 */
function isSlowTest(path) {
  return (
    /^test\/integration\/audit-drift[^/]*\.test\.ts$/u.test(path) ||
    path === "test/integration/cli-manifest-drift.test.ts" ||
    path === "test/integration/main-guard.test.ts" ||
    path === "test/integration/audit-quality.test.ts" ||
    path === "test/integration/packaged-hook-install.test.ts" ||
    /^test\/integration\/dashboard[^/]*\.test\.ts$/u.test(path) ||
    path === "test/integration/quality-constraint-isolation.test.ts" ||
    path === "test/integration/hook-effective-state.test.ts" ||
    path === "test/integration/setup-quality-lifecycle.test.ts" ||
    /^test\/integration\/setup-install[^/]*\.test\.ts$/u.test(path) ||
    path === "test/unit/audit-harness/check-evidence-before-claims.test.ts" ||
    /^test\/unit\/dashboard-terminal-launch\/[^/]*\.test\.ts$/u.test(path)
  );
}

/**
 * Predicate for the performance suite (`test/performance/*.test.ts`), which only
 * runs in `performance` mode behind the `GOAT_FLOW_PERF_TESTS` env gate.
 *
 * @param path - Posix-style test file path to classify.
 * @returns `true` when the file is a performance test.
 */
function isPerformanceTest(path) {
  return /^test\/performance\/[^/]*\.test\.ts$/u.test(path);
}

/**
 * Select which test files run for the active CLI `mode`. Exits the process with
 * code 2 on an unknown mode rather than silently running nothing.
 *
 * @param allFiles - Every discovered test file (from {@link listTestFiles}).
 * @returns The subset of `allFiles` to run for the current mode.
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

// Measured seconds per file from the last green CI slow run, used only to balance shards. A file missing here is not skipped - it takes
// DEFAULT_FILE_SECONDS, so a new test lands in some shard and only makes that shard slightly slower. Refresh from a CI run's TAP
// `duration_ms` lines when the split visibly drifts.
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
 * Read the `--shard=<index>/<total>` argument. The index is 1-based so it reads the same way in a workflow matrix as it does in a log line.
 *
 * Exits the process with code 2 on a malformed or out-of-range value rather than silently running every file, because a shard that quietly
 * widens to the whole suite would report a pass that the split never actually proved.
 *
 * @returns `{ index, total }` for a valid request, or `null` when no shard was requested.
 */
function parseShard() {
  const flag = process.argv.find((argument) => argument.startsWith("--shard="));
  if (!flag) return null;
  const [index, total] = flag
    .slice("--shard=".length)
    .split("/")
    .map((part) => Number.parseInt(part, 10));
  if (
    !Number.isInteger(index) ||
    !Number.isInteger(total) ||
    total < 1 ||
    index < 1 ||
    index > total
  ) {
    console.error(
      `Invalid --shard value "${flag}". Expected --shard=<index>/<total> with 1 <= index <= total.`,
    );
    process.exit(2);
  }
  return { index, total };
}

/**
 * Split files across shards by measured cost, longest first into whichever shard is currently cheapest. Every file lands in exactly one
 * shard, so the union of all shards is always the complete selection.
 *
 * @param allFiles - the mode's full file selection, in deterministic sorted order.
 * @param shard - the requested `{ index, total }` split.
 * @returns the files this shard owns, restored to the original sorted order.
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
const selectedFiles = filesForMode(listTestFiles());
const files = shard ? filesForShard(selectedFiles, shard) : selectedFiles;
if (files.length === 0) {
  console.error(`No ${mode} test files found.`);
  process.exit(1);
}

if (mode === "performance") {
  process.env.GOAT_FLOW_PERF_TESTS = "1";
}

const args = [
  "--import",
  "tsx",
  "--test",
  "--test-concurrency",
  mode === "slow" ? "1" : mode === "fast" ? "8" : "8",
];
if (mode === "coverage") {
  args.push("--experimental-test-coverage");
}
args.push(...files);

const result = spawnSync(process.execPath, args, {
  env: process.env,
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
if (result.signal) {
  console.error(`Test runner terminated by signal ${result.signal}.`);
  process.exit(1);
}
process.exit(result.status ?? 1);
