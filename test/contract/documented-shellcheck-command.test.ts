/**
 * Verify the shell-lint command agents receive in the repository instructions.
 *
 * The tests check identical commands, installer coverage, and the absence of excluded ShellCheck rules.
 * They execute the published command and fail if ShellCheck cannot be launched.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../..",
);

// Instruction surfaces that publish the aggregate shell-lint command to agents.
const DOCUMENTING_SURFACES = [
  "CLAUDE.md",
  "AGENTS.md",
  ".github/copilot-instructions.md",
] as const;

const AUTOMATED_SHELL_VALIDATION_OWNERS = [
  ".goat-flow/config.yaml",
  "scripts/preflight-checks.sh",
  ".github/workflows/ci.yml",
] as const;

const WORKFLOW_INSTALLER = "workflow/install-goat-flow.sh";

/**
 * Read the exact `shellcheck` line a surface publishes.
 *
 * @param surface - repository-relative instruction file
 * @returns the published command, trimmed; empty when the surface publishes none
 */
function publishedShellcheckCommand(surface: string): string {
  const content = readFileSync(resolve(PROJECT_ROOT, surface), "utf8");
  const line = content
    .split("\n")
    .find((candidate) => candidate.trimStart().startsWith("shellcheck "));
  // An absent published command becomes an empty result so the caller can name the incomplete instruction file.
  return line?.trim() ?? "";
}

describe("documented shell-lint command", () => {
  it("is published identically on every instruction surface", () => {
    const published = DOCUMENTING_SURFACES.map((surface) => ({
      surface,
      command: publishedShellcheckCommand(surface),
    }));

    // Every supported agent must receive a runnable shell-lint command in its own instructions.
    for (const { surface, command } of published) {
      assert.ok(command.length > 0, `${surface}: publishes no shellcheck line`);
    }
    const [first, ...rest] = published;
    // Compare each remaining instruction file with the first so agents receive the same validation scope.
    for (const other of rest) {
      assert.equal(
        other.command,
        first.command,
        `${other.surface} publishes a different shell-lint command than ${first.surface}`,
      );
    }
  });

  it("carries no exclusion, so the documented command is the strict one", () => {
    // An exclusion here would let the instruction files promise a check the agent never actually runs.
    assert.doesNotMatch(publishedShellcheckCommand("CLAUDE.md"), /--exclude/u);
  });

  it("keeps the workflow installer in every shell lint and syntax owner", () => {
    // Check the commands shown to each agent before comparing automated validation owners.
    for (const surface of DOCUMENTING_SURFACES) {
      const content = readFileSync(resolve(PROJECT_ROOT, surface), "utf8");
      const commandLines = content
        .split("\n")
        .filter((line) => /^(?:shellcheck|bash -n) /u.test(line));
      assert.equal(
        commandLines.length,
        2,
        `${surface}: expected two shell commands`,
      );
      // Both lint and syntax checks must cover the installer that users run during setup.
      for (const command of commandLines) {
        assert.ok(
          command.includes(WORKFLOW_INSTALLER),
          `${surface}: ${command.split(" ", 1)[0]} omits ${WORKFLOW_INSTALLER}`,
        );
      }
    }

    // Automated checks must retain the same installer coverage promised in agent instructions.
    for (const surface of AUTOMATED_SHELL_VALIDATION_OWNERS) {
      const content = readFileSync(resolve(PROJECT_ROOT, surface), "utf8");
      const occurrences = content.split(WORKFLOW_INSTALLER).length - 1;
      assert.ok(
        occurrences >= 2,
        `${surface}: expected ${WORKFLOW_INSTALLER} in both shell lint and syntax validation`,
      );
    }
  });

  it("exits zero when run exactly as published", () => {
    const command = publishedShellcheckCommand("CLAUDE.md");
    const probe = spawnSync("shellcheck", ["--version"], { encoding: "utf8" });
    // Treat a missing analyzer as inconclusive rather than passing: the claim is unproven, not satisfied.
    if (probe.error) {
      assert.fail(
        "shellcheck is not installed, so the documented command cannot be verified; install it (scripts/setup-initial.sh) and re-run",
      );
    }

    const result = spawnSync("bash", ["-c", command], {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
    });

    assert.equal(
      result.status,
      0,
      `the documented shell-lint command failed:\n${result.stdout}${result.stderr}`,
    );
  });
});
