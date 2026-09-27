/**
 * Prove diagnostic commands remain available when installed skills drift from the manifest.
 *
 * Use these process tests for a user seeking help before repair.
 * The fixture adds one unlisted skill; `manifest --check` remains responsible for reporting it.
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

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

describe("CLI diagnostics under manifest drift", () => {
  // An empty path means the suite has not created its drifted user installation yet.
  let driftedRepositoryRoot = "";

  before(() => {
    // A user can reach this state after an incomplete upgrade, so the fixture starts with a runnable CLI and adds one unlisted skill.
    driftedRepositoryRoot = mkdtempSync(join(tmpdir(), "goat-cli-drift-"));
    // Copy only the runtime folders needed to reproduce the user's drifted installation.
    for (const sourceDirectory of ["src", "workflow"]) {
      cpSync(
        join(repositoryRoot, sourceDirectory),
        join(driftedRepositoryRoot, sourceDirectory),
        { recursive: true },
      );
    }
    // Copy the package and compiler inputs that make the user's installed CLI runnable.
    for (const sourceFile of ["package.json", "tsconfig.json"]) {
      cpSync(
        join(repositoryRoot, sourceFile),
        join(driftedRepositoryRoot, sourceFile),
      );
    }
    // Reuse installed dependencies so the fixture tests CLI behavior without duplicating the user's package installation.
    symlinkSync(
      join(repositoryRoot, "node_modules"),
      join(driftedRepositoryRoot, "node_modules"),
      "junction",
    );
    const unlistedSkillDirectory = join(
      driftedRepositoryRoot,
      "workflow",
      "skills",
      "goat-fake",
    );
    mkdirSync(unlistedSkillDirectory, { recursive: true });
    writeFileSync(
      join(unlistedSkillDirectory, "SKILL.md"),
      "# fake drift skill\n",
    );
  });

  after(() => {
    // A populated path means the suite created a temporary installation that no user needs after the proof ends.
    if (driftedRepositoryRoot)
      rmSync(driftedRepositoryRoot, { recursive: true, force: true });
  });

  /**
   * Spawn the copied CLI after its installed skills have drifted.
   *
   * Use it to verify the output and exit status a user receives before repair.
   * Side effect: starts a child process inside the temporary installation.
   *
   * @param commandArguments - arguments entered after `goat-flow`; empty follows the no-command menu route
   * @returns captured child-process status, stdout, and stderr
   */
  function runCommandInDriftedInstallation(commandArguments: string[]) {
    return spawnSync(
      process.execPath,
      ["--import", "tsx", join("src", "cli", "cli.ts"), ...commandArguments],
      { cwd: driftedRepositoryRoot, encoding: "utf8" },
    );
  }

  it("root help exits 0 and renders usage despite skill-dir drift", () => {
    const rootHelpProcess = runCommandInDriftedInstallation(["--help"]);
    assert.equal(
      rootHelpProcess.status,
      0,
      `stderr: ${rootHelpProcess.stderr}`,
    );
    assert.match(rootHelpProcess.stdout, /goat-flow/i);
  });

  it("audit help exits 0 without dispatch despite skill-dir drift", () => {
    const auditHelpProcess = runCommandInDriftedInstallation([
      "audit",
      "--help",
    ]);
    assert.equal(
      auditHelpProcess.status,
      0,
      `stderr: ${auditHelpProcess.stderr}`,
    );
    assert.match(auditHelpProcess.stdout, /^goat-flow audit$/mu);
    assert.match(auditHelpProcess.stdout, /--harness/u);
  });

  it("hooks help exits 0 without dispatch despite skill-dir drift", () => {
    const hooksHelpProcess = runCommandInDriftedInstallation([
      "hooks",
      "--help",
    ]);
    assert.equal(
      hooksHelpProcess.status,
      0,
      `stderr: ${hooksHelpProcess.stderr}`,
    );
    assert.match(hooksHelpProcess.stdout, /^goat-flow hooks$/mu);
    assert.match(hooksHelpProcess.stdout, /^Subcommands:$/mu);
  });

  it("--version exits 0 despite skill-dir drift", () => {
    const versionProcess = runCommandInDriftedInstallation(["--version"]);
    assert.equal(versionProcess.status, 0, `stderr: ${versionProcess.stderr}`);
    assert.match(versionProcess.stdout, /\d+\.\d+\.\d+/);
  });

  it("status exits 0 with an error state instead of crashing under skill-dir drift", () => {
    const statusProcess = runCommandInDriftedInstallation([
      "status",
      ".",
      "--format",
      "json",
    ]);
    assert.equal(statusProcess.status, 0, `stderr: ${statusProcess.stderr}`);
    const statusReport = JSON.parse(statusProcess.stdout) as {
      state?: string;
      details?: string;
    };
    assert.equal(statusReport.state, "error");
    // Missing details would leave users with an error badge and no next clue.
    assert.match(statusReport.details ?? "", /manifest|drift/i);
  });

  it("manifest --check still fails loudly with the actionable drift error", () => {
    const manifestCheckProcess = runCommandInDriftedInstallation([
      "manifest",
      "--check",
    ]);
    // A user explicitly checking manifest integrity must still receive a failing status for this drift.
    assert.notEqual(
      manifestCheckProcess.status,
      0,
      "manifest --check must fail under drift",
    );
    assert.match(
      `${manifestCheckProcess.stdout}${manifestCheckProcess.stderr}`,
      /drifted from workflow\/skills|skills\.canonical/,
      "drift error must name the offending surface",
    );
  });
});
