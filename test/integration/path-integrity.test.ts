/**
 * Integration tests for scripts/check-path-integrity.sh.
 * Creates minimal temp projects to verify the script catches dead paths.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const SCRIPT = join(PROJECT_ROOT, "scripts", "check-path-integrity.sh");

function runScript(projectRoot: string): { ok: boolean; output: string } {
  const r = spawnSync("bash", [SCRIPT, projectRoot], {
    encoding: "utf-8",
    timeout: 10000,
  });
  const output = (r.stderr ?? "") + (r.stdout ?? "");
  return { ok: r.status === 0, output };
}

function makeTempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "gf-path-test-"));
  // Minimal .goat-flow with config
  mkdirSync(join(dir, ".goat-flow"), { recursive: true });
  writeFileSync(
    join(dir, ".goat-flow", "config.yaml"),
    "version: 1.1.0\nfootguns:\n  path: .goat-flow/footguns/\nlessons:\n  path: .goat-flow/lessons/\ndecisions:\n  path: .goat-flow/decisions/\ntasks:\n  path: .goat-flow/tasks/\nlogs:\n  path: .goat-flow/logs/\n",
  );
  mkdirSync(join(dir, ".goat-flow", "footguns"), { recursive: true });
  mkdirSync(join(dir, ".goat-flow", "lessons"), { recursive: true });
  mkdirSync(join(dir, ".goat-flow", "decisions"), { recursive: true });
  mkdirSync(join(dir, ".goat-flow", "tasks"), { recursive: true });
  mkdirSync(join(dir, ".goat-flow", "logs"), { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Router table with dead path is caught
// ---------------------------------------------------------------------------
describe("path-integrity script: router table", () => {
  it("fails when router table references nonexistent path", () => {
    const dir = makeTempProject();
    try {
      // Create a CLAUDE.md with a router table containing a dead path.
      // Must end with \n so bash's `while read -r line` processes the last row.
      writeFileSync(
        join(dir, "CLAUDE.md"),
        [
          "# CLAUDE.md",
          "## Router Table",
          "| Resource | Path |",
          "|----------|------|",
          "| Architecture | `.goat-flow/architecture.md` |",
          "| Nonexistent | `src/does-not-exist/` |",
          "",
        ].join("\n"),
      );
      // architecture.md exists, src/does-not-exist/ does not
      writeFileSync(join(dir, ".goat-flow", "architecture.md"), "# Arch");

      const result = runScript(dir);
      assert.equal(result.ok, false, "Should fail on dead router path");
      assert.ok(
        result.output.includes("does not exist"),
        `Should mention dead path: ${result.output}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("passes when all router table paths exist", () => {
    const dir = makeTempProject();
    try {
      mkdirSync(join(dir, "src", "cli"), { recursive: true });
      writeFileSync(
        join(dir, "CLAUDE.md"),
        [
          "# CLAUDE.md",
          "## Router Table",
          "| Resource | Path |",
          "|----------|------|",
          "| Architecture | `.goat-flow/architecture.md` |",
          "| CLI | `src/cli/` |",
          "",
        ].join("\n"),
      );
      writeFileSync(join(dir, ".goat-flow", "architecture.md"), "# Arch");

      const result = runScript(dir);
      assert.equal(
        result.ok,
        true,
        `Should pass when all paths exist: ${result.output}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
