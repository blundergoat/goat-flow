#!/usr/bin/env node
// Test runner dispatch: selects the test files for a mode (fast | coverage |
// slow | performance) and runs them under `node --import tsx --test`. Keeps the
// slow/perf suites out of the default `fast` run so local iteration stays quick.
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
 * Predicate for the slow suite: integration/dashboard/audit-drift tests and a
 * few known-heavy units that are excluded from the default `fast` run and run
 * single-concurrency in `slow` mode.
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
    /^test\/integration\/dashboard[^/]*\.test\.ts$/u.test(path) ||
    path === "test/integration/quality-constraint-isolation.test.ts" ||
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

const files = filesForMode(listTestFiles());
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
  mode === "slow" ? "1" : "8",
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
