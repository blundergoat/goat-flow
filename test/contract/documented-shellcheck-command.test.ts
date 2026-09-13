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
const SHELL_SYNTAX_HELPER = "scripts/maintenance/check-shell-syntax.sh";

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
    const helper = readFileSync(
      resolve(PROJECT_ROOT, SHELL_SYNTAX_HELPER),
      "utf8",
    );
    assert.ok(helper.includes(WORKFLOW_INSTALLER));
    // Syntax coverage now belongs to the executable shared by every publisher.
    for (const surface of DOCUMENTING_SURFACES) {
      const content = readFileSync(resolve(PROJECT_ROOT, surface), "utf8");
      assert.ok(
        publishedShellcheckCommand(surface).includes(WORKFLOW_INSTALLER),
        `${surface}: shellcheck omits ${WORKFLOW_INSTALLER}`,
      );
      assert.ok(content.includes(`\nbash ${SHELL_SYNTAX_HELPER}\n`), surface);
      assert.doesNotMatch(content, /^bash -n .+\.sh\s+.+\.sh/mu, surface);
    }

    // Automated checks must retain the same installer coverage promised in agent instructions.
    for (const surface of AUTOMATED_SHELL_VALIDATION_OWNERS) {
      const content = readFileSync(resolve(PROJECT_ROOT, surface), "utf8");
      assert.ok(
        content.includes(WORKFLOW_INSTALLER),
        `${surface}: shell lint omits ${WORKFLOW_INSTALLER}`,
      );
      assert.ok(content.includes(`bash ${SHELL_SYNTAX_HELPER}`), surface);
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
