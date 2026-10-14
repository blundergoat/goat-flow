#!/usr/bin/env node
// Runs the goat-flow test suite a developer or CI job asks for, such as `npm test`, `npm run test:slow` or `npm run test:slow:ci -- --shard=2/5`.
// It collects every .test.ts file under test/, keeps the ones the chosen mode needs, and hands them to `node --test`, exiting with its result.
//
// What each mode, and the --shard flag, gives the developer:
// - fast (the default, behind `npm test` and preflight) skips the slow suite so ordinary local verification stays short.
// - coverage runs the same files as fast and adds Node's experimental coverage report.
// - slow runs costly integration, installer, dashboard and audit tests one at a time; they share repo state such as .goat-flow/dashboard-state.json.
// - --shard=<index>/<total> splits the chosen mode across separate CI machines; CI uses it to spread the slow suite over parallel jobs.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, sep } from "node:path";

// Only the first argument picks the mode, e.g. `node scripts/run-tests.mjs slow`; with none, the developer gets the fast suite.
// Other arguments except --shard are ignored, so `npm test -- <file>` still runs the whole fast suite and `slow --help` starts the slow suite.
const mode = process.argv[2] ?? "fast";

/**
 * Rewrite a discovered test path with `/` separators while the runner lists test files.
 * The slow-suite list and shard timings below use `/`, so a developer on Windows gets the same fast/slow split as Linux and CI.
 *
 * @param path - A path that may use the platform separator (`\` on Windows).
 * @returns The same path with every separator replaced by `/`.
 */
function toPosixPath(path) {
  return path.split(sep).join("/");
}

/**
 * Collect every runnable test file under test/; each run lists files here, after reading --shard and before the chosen mode filters the list.
 * Walking only test/ keeps stale checkout copies in .goat-flow/scratchpad/ or _temp/stryker-tmp/ out of `npm test`, and sorting keeps a stable order.
 *
 * @param dir - Folder to read, `test` under the current directory by default; started from a folder with no test/, the run throws ENOENT here.
 * @returns sorted POSIX-style test paths; an empty list makes the selected mode fail with a no-tests diagnostic
 */
function listTestFiles(dir = "test") {
  const files = [];
  // Discover nested tests as well as direct children so adding a test folder does not silently exclude it from verification.
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    // Subfolders are searched too; only regular files ending in .test.ts run, so helper and fixture files without that suffix never start as tests.
    if (entry.isDirectory()) {
      files.push(...listTestFiles(path));
    } else if (entry.isFile() && path.endsWith(".test.ts")) {
      files.push(toPosixPath(path));
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

/**
 * Decide whether a test belongs to the slow suite, which `npm run test:slow` and the sharded CI jobs run one file at a time.
 * Fast and coverage runs skip these costly integration, installer, dashboard and audit tests to keep local feedback short.
 *
 * @param path - Posix-style test file path to classify.
 * @returns `true` when the file belongs to the slow suite.
 */
function isSlowTest(path) {
  // A new costly test leaves the fast suite by being listed here or by matching a name pattern below.
  const exactPaths = [
    "test/integration/cli-manifest-drift.test.ts",
    "test/integration/main-guard.test.ts",
    "test/integration/audit-quality.test.ts",
    "test/integration/packaged-hook-install.test.ts",
    "test/integration/quality-constraint-isolation.test.ts",
    "test/integration/hook-effective-state.test.ts",
    "test/integration/deny-dangerous-policy.test.ts",
    "test/integration/deny-native-shells.test.ts",
    "test/integration/deny-dangerous-operands.test.ts",
    "test/integration/deny-git-graphql.test.ts",
    "test/integration/setup-quality-lifecycle.test.ts",
    "test/integration/review-validate-large-tree.test.ts",
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

// No mode selects these files, so `npm test` and the pull-request shards skip them; the weekly hook-reference-linux CI job runs each one by name.
// hook-parity-reference.test.ts replays the frozen Bash reference, which only a change to that reference or its parity harness can break.
const WEEKLY_ONLY_TESTS = ["test/integration/hook-parity-reference.test.ts"];

/**
 * Keep only the tests the developer's chosen mode runs, before any --shard split; files in WEEKLY_ONLY_TESTS are never kept.
 * An unknown mode writes the valid choices to stderr and exits with code 2 instead of running an unintended suite.
 *
 * @param allFiles - Every discovered test file (from {@link listTestFiles}).
 * @returns tests selected for this mode; an empty list produces the no-tests failure at launch
 */
function filesForMode(allFiles) {
  const modeCandidates = allFiles.filter(
    (path) => !WEEKLY_ONLY_TESTS.includes(path),
  );
  switch (mode) {
    // Fast and coverage select the same files; coverage only adds the coverage report when the tests launch.
    case "fast":
    case "coverage":
      return modeCandidates.filter((path) => !isSlowTest(path));
    case "slow":
      return modeCandidates.filter(isSlowTest);
    // A typo such as `slwo`, or a flag typed first such as `node scripts/run-tests.mjs --shard=1/5`, lands here.
    default:
      console.error(
        `Unknown test mode "${mode}". Expected fast, coverage, or slow.`,
      );
      process.exit(2);
  }
}

// Measured seconds per slow test file; --shard uses them so each CI machine gets a similar share of the slow suite.
//
// Refresh values from the slow CI jobs' TAP duration_ms, which run one file at a time; never copy fast-suite durations, which include CPU waiting.
// A file missing here counts as DEFAULT_FILE_SECONDS, so a developer's new test is still assigned to a shard and runs.
const SLOW_FILE_SECONDS = {
  "test/integration/setup-install-agent-matrix.test.ts": 170,
  "test/integration/setup-install-upgrade-1150.test.ts": 118,
  "test/integration/setup-install-shared-state.test.ts": 112,
  "test/integration/setup-install-decisions-readme.test.ts": 91,
  "test/integration/setup-install.test.ts": 91,
  "test/integration/setup-install-preview.test.ts": 78,
  "test/integration/setup-install-migrations.test.ts": 70,
  "test/integration/setup-install-upgrade-summary.test.ts": 57,
  "test/integration/setup-install-permission-convergence.test.ts": 54,
  "test/integration/setup-install-force-authority.test.ts": 54,
  "test/integration/setup-install-codex-config-migration.test.ts": 53,
  "test/integration/setup-install-write-set.test.ts": 46,
  "test/integration/audit-drift-checkdrift-installer-round-trip-fixture.test.ts": 38,
  "test/integration/setup-install-deny-reconciliation.test.ts": 36,
  "test/integration/deny-native-shells.test.ts": 30,
  "test/integration/dashboard-audit-api.test.ts": 29,
  "test/integration/setup-install-atomic-staging.test.ts": 26,
  "test/integration/setup-install-safety-regressions.test.ts": 25,
  "test/integration/setup-install-preflight.test.ts": 24,
  "test/integration/deny-dangerous-policy.test.ts": 23,
  "test/integration/dashboard-server-dashboard-api-quality.test.ts": 20,
  "test/integration/deny-git-graphql.test.ts": 14,
  "test/integration/setup-quality-lifecycle.test.ts": 13,
  "test/integration/deny-dangerous-operands.test.ts": 11,
  "test/integration/dashboard-server-dashboard-api-setup.test.ts": 10,
  "test/integration/hook-effective-state.test.ts": 9,
  "test/integration/quality-constraint-isolation.test.ts": 9,
  "test/integration/packaged-hook-install.test.ts": 8,
  "test/integration/audit-quality.test.ts": 7,
  "test/integration/setup-install-renamed-playbooks.test.ts": 6,
};

/** Cost assumed for a file with no measurement: roughly one process start plus a short suite. */
const DEFAULT_FILE_SECONDS = 5;

/**
 * Read the developer's or CI job's --shard=<index>/<total> choice, e.g. `npm run test:slow:ci -- --shard=2/5`, numbered from 1 like the CI matrix.
 *
 * An invalid choice writes a diagnostic to stderr and exits with code 2 instead of widening the requested run to the whole suite.
 *
 * @returns `{ index, total }` for a valid request, or `null` when no shard was requested and this machine runs the mode's whole selection.
 */
function parseShard() {
  const flag = process.argv.find((argument) => argument.startsWith("--shard="));
  // A developer who omits --shard runs the mode's complete selection on this machine.
  if (!flag) return null;
  // Require whole integers: parseInt alone would turn a mistyped shard such as 1x/5 or 1.5/5 into a different request.
  // A value that does not match leaves index and total as NaN; the check below rejects it with exit 2 before either number is used.
  const match = /^(\d+)\/(\d+)$/u.exec(flag.slice("--shard=".length));
  const index = match ? Number.parseInt(match[1], 10) : Number.NaN;
  const total = match ? Number.parseInt(match[2], 10) : Number.NaN;
  // A malformed or out-of-range shard such as 0/5 or 6/5 stops with exit 2, so a typo never runs a different share and reports it as passed.
  if (match === null || total < 1 || index < 1 || index > total) {
    console.error(
      `Invalid --shard value "${flag}". Expected --shard=<index>/<total> with 1 <= index <= total.`,
    );
    process.exit(2);
  }
  return { index, total };
}

/**
 * Pick this CI machine's share of the selected tests for --shard; each file goes to exactly one shard, so together the shards run every file.
 * Assigns the longest measured tests first, writes a one-line summary to stderr, and returns this shard's files in their original stable order.
 *
 * @param allFiles - the mode's full file selection, in deterministic sorted order.
 * @param shard - the requested `{ index, total }` split.
 * @returns this shard's files in stable order; an empty shard fails at launch rather than claiming test coverage
 */
function filesForShard(allFiles, shard) {
  // Each shard starts empty; its seconds total estimates how long that CI machine will spend on its files.
  const shardWorkloads = Array.from({ length: shard.total }, () => ({
    seconds: 0,
    files: new Set(),
  }));
  // Longest tests are placed first so shorter ones fill the gaps; an unmeasured file counts as DEFAULT_FILE_SECONDS so the totals stay comparable.
  const byCostDescending = [...allFiles].sort(
    (left, right) =>
      (SLOW_FILE_SECONDS[right] ?? DEFAULT_FILE_SECONDS) -
      (SLOW_FILE_SECONDS[left] ?? DEFAULT_FILE_SECONDS),
  );
  // Give the next costly test to the least-loaded shard so developers spend less time waiting for one final CI machine.
  for (const file of byCostDescending) {
    const leastLoadedShard = shardWorkloads.reduce((lightest, workload) =>
      workload.seconds < lightest.seconds ? workload : lightest,
    );
    leastLoadedShard.files.add(file);
    leastLoadedShard.seconds += SLOW_FILE_SECONDS[file] ?? DEFAULT_FILE_SECONDS;
  }
  // Shard numbers start at 1, so `--shard=2/5` takes the second workload.
  const requestedShard = shardWorkloads[shard.index - 1];
  // The terminal or CI log shows a line such as `slow shard 2/5: <n> file(s), ~<seconds>s of measured work` before the tests start.
  console.error(
    `${mode} shard ${shard.index}/${shard.total}: ${requestedShard.files.size} file(s), ~${requestedShard.seconds}s of measured work`,
  );
  return allFiles.filter((file) => requestedShard.files.has(file));
}

// Check --shard before the mode: a bad shard value is reported first, which the shard-grammar probes in preflight-progress.test.ts rely on.
const shard = parseShard();
const modeTestFiles = filesForMode(listTestFiles());
// No --shard runs the mode's whole selection on this machine; with one, only this shard's assigned files run.
const testFilesToRun = shard
  ? filesForShard(modeTestFiles, shard)
  : modeTestFiles;
// Nothing to run cannot verify the developer's change, so exit 1 instead of reporting success.
// For example, a --shard total larger than the number of files the mode selected leaves some shards empty.
if (testFilesToRun.length === 0) {
  console.error(`No ${mode} test files found.`);
  process.exit(1);
}

// The developer sees TAP output from `node --import tsx --test`; slow runs one file at a time, fast and coverage up to eight at once.
//
// Keep the concurrency expression verbatim, duplicate "8" included: test/integration/preflight-progress.test.ts matches its exact text.
// Keep the CLI `--import tsx` preload: on Node 20, the supported minimum, the programmatic runner failed .ts files with ERR_UNKNOWN_FILE_EXTENSION.
const testRunnerArguments = [
  "--import",
  "tsx",
  "--test",
  "--test-reporter=tap",
  "--test-concurrency",
  mode === "slow" ? "1" : mode === "fast" ? "8" : "8",
];
// Coverage mode records the actual Node runtime so developers can reproduce a version-specific reporter failure.
if (mode === "coverage") {
  console.error(
    `Coverage runtime: Node ${process.version} (${process.execPath})`,
  );
  testRunnerArguments.push("--experimental-test-coverage");
}
// Pass explicit file paths, never folders: `node --test test/unit/` tries to import test/unit/index.json and fails with ERR_MODULE_NOT_FOUND.
testRunnerArguments.push(...testFilesToRun);

// Run the tests in a child Node process whose output streams straight to the developer's terminal or CI log.
const testRunResult = spawnSync(process.execPath, testRunnerArguments, {
  env: process.env,
  stdio: "inherit",
});

// The test process never started, e.g. the operating system refused to spawn another Node process, so no result exists: show why and exit 1.
if (testRunResult.error) {
  console.error(testRunResult.error);
  process.exit(1);
}
// The test process was stopped part-way, e.g. someone ran `kill <pid>` on it, so verification is incomplete even if some tests passed: exit 1.
if (testRunResult.signal) {
  console.error(`Test runner terminated by signal ${testRunResult.signal}.`);
  process.exit(1);
}
// The developer's command or CI step passes or fails with the test process's own exit status; a missing status counts as failure, never a clean run.
process.exit(testRunResult.status ?? 1);
