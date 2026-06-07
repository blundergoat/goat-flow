#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, sep } from "node:path";

const mode = process.argv[2] ?? "fast";

function toPosixPath(path) {
  return path.split(sep).join("/");
}

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

function isSlowTest(path) {
  return (
    /^test\/integration\/audit-drift[^/]*\.test\.ts$/u.test(path) ||
    path === "test/integration/main-guard.test.ts" ||
    path === "test/integration/audit-quality.test.ts" ||
    /^test\/integration\/dashboard[^/]*\.test\.ts$/u.test(path) ||
    path === "test/integration/quality-constraint-isolation.test.ts" ||
    path === "test/unit/audit-harness/check-evidence-before-claims.test.ts" ||
    /^test\/unit\/dashboard-terminal-launch\/[^/]*\.test\.ts$/u.test(path)
  );
}

function isPerformanceTest(path) {
  return /^test\/performance\/[^/]*\.test\.ts$/u.test(path);
}

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
