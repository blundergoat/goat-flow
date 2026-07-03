/**
 * Regression tests for M03 (1.13.0): manifest drift must not brick the CLI's
 * diagnostic commands.
 *
 * The user story: someone's install grows a stray folder under
 * `workflow/skills/` (a half-finished upgrade, a hand-made experiment).
 * When they type `goat-flow --help` or `goat-flow --version` to orient
 * themselves, those commands MUST still answer - only commands that truly
 * need the canonical skill list (like `goat-flow manifest --check`) may
 * fail, and they must fail with the actionable drift message, not a stack
 * trace at import time.
 *
 * Mechanism under test: `constants.ts` exposes lazy `getSkillNames()` /
 * `getStaleSkillNames()` accessors and `classify-state.ts` derives agent
 * profiles lazily, so importing the CLI module graph performs no manifest
 * reads. These tests spawn the real CLI from a drifted temp copy of the
 * repo to prove that end to end.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

describe("CLI diagnostics under manifest drift", () => {
  let driftedRoot = "";

  before(() => {
    // Build a minimal runnable copy of the repo, then drift it by adding a
    // skill directory the manifest does not list.
    driftedRoot = mkdtempSync(join(tmpdir(), "goat-cli-drift-"));
    for (const dir of ["src", "workflow"]) {
      cpSync(join(repoRoot, dir), join(driftedRoot, dir), { recursive: true });
    }
    for (const file of ["package.json", "tsconfig.json"]) {
      cpSync(join(repoRoot, file), join(driftedRoot, file));
    }
    // Reuse the real node_modules so tsx and dependencies resolve.
    symlinkSync(
      join(repoRoot, "node_modules"),
      join(driftedRoot, "node_modules"),
      "junction",
    );
    const fakeSkillDir = join(driftedRoot, "workflow", "skills", "goat-fake");
    mkdirSync(fakeSkillDir, { recursive: true });
    writeFileSync(join(fakeSkillDir, "SKILL.md"), "# fake drift skill\n");
  });

  after(() => {
    // Temp copy only exists for this suite -> always clean it up.
    if (driftedRoot) rmSync(driftedRoot, { recursive: true, force: true });
  });

  /**
   * Spawn the drifted copy's CLI with the given args.
   *
   * @param args - CLI arguments, e.g. `["--help"]`
   * @returns spawnSync result with utf8 stdout/stderr
   */
  function runDriftedCli(args: string[]) {
    return spawnSync(
      process.execPath,
      ["--import", "tsx", join("src", "cli", "cli.ts"), ...args],
      { cwd: driftedRoot, encoding: "utf8" },
    );
  }

  it("--help exits 0 and renders usage despite skill-dir drift", () => {
    const res = runDriftedCli(["--help"]);
    assert.equal(res.status, 0, `stderr: ${res.stderr}`);
    assert.match(res.stdout, /goat-flow/i);
  });

  it("--version exits 0 despite skill-dir drift", () => {
    const res = runDriftedCli(["--version"]);
    assert.equal(res.status, 0, `stderr: ${res.stderr}`);
    assert.match(res.stdout, /\d+\.\d+\.\d+/);
  });

  it("manifest --check still fails loudly with the actionable drift error", () => {
    const res = runDriftedCli(["manifest", "--check"]);
    // The command that exists to catch drift must keep catching it.
    assert.notEqual(res.status, 0, "manifest --check must fail under drift");
    assert.match(
      `${res.stdout}${res.stderr}`,
      /drifted from workflow\/skills|skills\.canonical/,
      "drift error must name the offending surface",
    );
  });
});
