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
import { AUDIT_VERSION } from "../../src/cli/constants.js";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "..", "..");
const SCRIPT = join(REPOSITORY_ROOT, "scripts", "check-path-integrity.sh");

/** Spawns the path-integrity script against an isolated project fixture. */
function runScript(projectRoot: string): { passed: boolean; output: string } {
  const result = spawnSync("bash", [SCRIPT, projectRoot], {
    encoding: "utf-8",
    timeout: 10000,
  });
  const output = (result.stderr ?? "") + (result.stdout ?? "");
  return { passed: result.status === 0, output };
}

/** Writes the minimum goat-flow filesystem layout required by path-integrity checks. */
function makeTempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "gf-path-test-"));
  // Minimal .goat-flow with config
  mkdirSync(join(dir, ".goat-flow"), { recursive: true });
  writeFileSync(
    join(dir, ".goat-flow", "config.yaml"),
    `version: ${AUDIT_VERSION}\nfootguns:\n  path: .goat-flow/learning-loop/footguns/\nlessons:\n  path: .goat-flow/learning-loop/lessons/\ndecisions:\n  path: .goat-flow/learning-loop/decisions/\nplans:\n  path: .goat-flow/plans/\nlogs:\n  path: .goat-flow/logs/\n`,
  );
  mkdirSync(join(dir, ".goat-flow", "learning-loop", "footguns"), {
    recursive: true,
  });
  mkdirSync(join(dir, ".goat-flow", "learning-loop", "lessons"), {
    recursive: true,
  });
  mkdirSync(join(dir, ".goat-flow", "learning-loop", "decisions"), {
    recursive: true,
  });
  mkdirSync(join(dir, ".goat-flow", "plans"), { recursive: true });
  mkdirSync(join(dir, ".goat-flow", "logs"), { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Router table with dead path is caught
// ---------------------------------------------------------------------------
describe("path-integrity script: router table", () => {
  // Fixture purpose: writes a dead router path to cover missing-path reports.
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
      assert.equal(result.passed, false, "Should fail on dead router path");
      assert.ok(
        result.output.includes("does not exist"),
        `Should mention dead path: ${result.output}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Fixture purpose: writes matching router paths to cover the valid case.
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
        result.passed,
        true,
        `Should pass when all paths exist: ${result.output}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Copilot surfaces and nested skill references are covered
// ---------------------------------------------------------------------------
describe("path-integrity script: copilot surfaces", () => {
  // Fixture purpose: writes a Copilot router table to cover dead path diagnostics.
  it("fails when .github/copilot-instructions.md router paths are dead", () => {
    const dir = makeTempProject();
    try {
      mkdirSync(join(dir, ".github"), { recursive: true });
      writeFileSync(
        join(dir, ".github", "copilot-instructions.md"),
        [
          "# Copilot CLI - Repo Guidance",
          "## Router Table",
          "| Resource | Path |",
          "|----------|------|",
          "| Missing | `.goat-flow/missing.md` |",
          "",
        ].join("\n"),
      );

      const result = runScript(dir);
      assert.equal(
        result.passed,
        false,
        "Should fail on dead Copilot router path",
      );
      assert.ok(
        result.output.includes(
          ".github/copilot-instructions.md router table: path does not exist: .goat-flow/missing.md",
        ),
        `Should mention dead Copilot router path: ${result.output}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Fixture purpose: writes nested skill references to cover missing .goat-flow paths.
  it("fails when .github skill references point at missing .goat-flow paths", () => {
    const dir = makeTempProject();
    try {
      mkdirSync(join(dir, ".github", "skills", "goat-security", "references"), {
        recursive: true,
      });
      writeFileSync(
        join(dir, ".github", "skills", "goat-security", "SKILL.md"),
        "# goat-security\n",
      );
      writeFileSync(
        join(
          dir,
          ".github",
          "skills",
          "goat-security",
          "references",
          "project-policy-template.md",
        ),
        "Read `.goat-flow/security-policy.md` before ranking findings.\n",
      );

      const result = runScript(dir);
      assert.equal(
        result.passed,
        false,
        "Should fail on missing nested skill path",
      );
      assert.ok(
        result.output.includes(
          "Installed skill references missing path: .goat-flow/security-policy.md",
        ),
        `Should mention missing nested skill path: ${result.output}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
