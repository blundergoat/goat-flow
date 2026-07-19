/**
 * Integration tests for the package entrypoint guard that prevents accidental direct execution.
 */
import { describe, it, after } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const REAL_CLI = join(PROJECT_ROOT, "dist", "cli", "cli.js");

/**
 * Create a symlink at `link` -> `target`, or skip the surrounding test if the
 * host blocks unprivileged symlinks (Windows without Developer Mode). The
 * production code path being tested still works on Windows; only the test
 * fixture is unreachable. Throws only for unexpected symlink failures.
 */
function symlinkOrSkip(
  testContext: TestContext,
  target: string,
  link: string,
): boolean {
  try {
    symlinkSync(target, link);
    return true;
  } catch (err) {
    if (
      err instanceof Error &&
      (err as NodeJS.ErrnoException).code === "EPERM"
    ) {
      testContext.skip(
        "Skipped: host blocks unprivileged symlinks (Windows without Developer Mode)",
      );
      return false;
    }
    throw err;
  }
}

describe("main-module guard via symlink", () => {
  let dir: string;

  after(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("CLI runs when launched through a symlink", (testContext) => {
    dir = mkdtempSync(join(tmpdir(), "gf-symlink-"));
    const link = join(dir, "goat-flow");
    if (!symlinkOrSkip(testContext, REAL_CLI, link)) return;
    chmodSync(REAL_CLI, 0o755);

    const stdout = execFileSync(process.execPath, [link, "--version"], {
      encoding: "utf-8",
      timeout: 10_000,
    });
    assert.match(stdout.trim(), /^goat-flow v\d+\.\d+\.\d+$/);

    const doctorStdout = execFileSync(
      process.execPath,
      [
        link,
        "skill",
        "doctor",
        PROJECT_ROOT,
        "--agent",
        "codex",
        "--skill",
        "goat",
        "--format",
        "json",
      ],
      { encoding: "utf-8", timeout: 10_000 },
    );
    const doctorReport = JSON.parse(doctorStdout) as {
      status: string;
      summary: { checked: number };
      agents: Array<{ skills: Array<{ invocation: string }> }>;
    };

    assert.equal(doctorReport.status, "pass");
    assert.equal(doctorReport.summary.checked, 1);
    assert.equal(doctorReport.agents[0]?.skills[0]?.invocation, "$goat");
  });

  it("CLI runs when launched via the real path", () => {
    const stdout = execFileSync(process.execPath, [REAL_CLI, "--version"], {
      encoding: "utf-8",
      timeout: 10_000,
    });
    assert.match(stdout.trim(), /^goat-flow v\d+\.\d+\.\d+$/);
  });
});
