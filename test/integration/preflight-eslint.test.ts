/**
 * Protect the lint verdict a maintainer sees when running preflight.
 *
 * A real missing ESLint configuration reproduces startup failure before any lint diagnostic rows exist.
 * The production verdict block must fail that run while preserving clean, warning-only, and ordinary error outcomes.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "../..");

/**
 * Check the production preflight verdict; this helper spawns Bash using a captured ESLint result.
 * Use to prove a developer sees a failed preflight when ESLint cannot start, without running unrelated repository gates.
 *
 * @param exitCode - actual ESLint process status; zero includes warning-only runs
 * @param output - captured stdout and stderr; empty output must not turn a non-zero exit into success
 * @returns the Bash process result, whose status and stdout expose preflight's actual verdict
 */
function runPreflightLintClassifier(exitCode: number, output: string) {
  const source = readFileSync(
    resolve(repositoryRoot, "scripts/preflight-checks.sh"),
    "utf8",
  );
  const classifierStart = source.indexOf(
    "        # Count only diagnostic rows",
  );
  const classifierEnd = source.indexOf(
    '    else\n        skip "ESLint (not configured)"',
    classifierStart,
  );
  assert.ok(
    classifierStart >= 0 && classifierEnd > classifierStart,
    "production ESLint classifier must be located",
  );
  return spawnSync(
    "bash",
    [
      "-c",
      `
lint_output=$(cat)
lint_exit=$1
lint_targets=(src/cli src/dashboard)
warnings=0
failures=0
pass(){ printf 'PASS %s\n' "$*"; }
warn(){ printf 'WARN %s\n' "$*"; }
fail(){ failures=$((failures + 1)); printf 'FAIL %s\n' "$*"; }
details_pipe(){ cat; }
${source.slice(classifierStart, classifierEnd)}
exit "$failures"
`,
      "preflight-eslint-fixture",
      String(exitCode),
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      input: output,
    },
  );
}

describe("preflight ESLint verdict", () => {
  it("fails on a real missing-config error even without lint diagnostic rows", () => {
    const lint = spawnSync(
      process.execPath,
      [
        "node_modules/eslint/bin/eslint.js",
        "--config",
        "test/fixtures/absent-preflight-eslint-config.mjs",
        "src/cli",
      ],
      { cwd: repositoryRoot, encoding: "utf8" },
    );
    assert.equal(lint.status, 2, lint.stdout + lint.stderr);
    assert.match(lint.stdout + lint.stderr, /ENOENT/u);
    const result = runPreflightLintClassifier(
      lint.status,
      lint.stdout + lint.stderr,
    );
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /FAIL ESLint execution failed \(exit 2\)/u);
    assert.match(result.stdout, /ENOENT/u);
    assert.doesNotMatch(result.stdout, /PASS ESLint/u);
  });

  it("preserves successful, warning-only, and ordinary error verdicts", () => {
    // The fatal-startup fix must preserve existing clean, warning-only, and ordinary error outcomes.
    for (const [exit, output, status, message] of [
      [0, "", 0, "PASS ESLint"],
      [0, "  1:1  warning  Forbidden non-null assertion\n", 0, "WARN ESLint"],
      [1, "  1:1  error  Unexpected floating promise\n", 1, "FAIL ESLint"],
    ] as const) {
      const result = runPreflightLintClassifier(exit, output);
      assert.equal(result.status, status, result.stdout + result.stderr);
      assert.ok(result.stdout.includes(message), result.stdout);
    }
  });
});
