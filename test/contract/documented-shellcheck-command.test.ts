/**
 * Executes the shell-lint command the instruction files tell agents to run, and requires it to pass.
 *
 * The enforced gates do not cover the same ground as the documented command. CI lints all four hook globs, but
 * preflight derives its hook scope from `manifest_eval hook-dirs`, which resolves to the single directory
 * `.goat-flow/hooks` and globs it non-recursively. A regression introduced in a `workflow/hooks/` mirror is therefore
 * invisible to preflight. This contract is the only gate that runs the documented command itself, so it is what keeps
 * the instruction files honest.
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

/** Instruction surfaces that publish the aggregate shell-lint command to agents. */
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
  return line?.trim() ?? "";
}

describe("documented shell-lint command", () => {
  it("is published identically on every instruction surface", () => {
    const published = DOCUMENTING_SURFACES.map((surface) => ({
      surface,
      command: publishedShellcheckCommand(surface),
    }));

    for (const { surface, command } of published) {
      assert.ok(command.length > 0, `${surface}: publishes no shellcheck line`);
    }
    const [first, ...rest] = published;
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
      for (const command of commandLines) {
        assert.ok(
          command.includes(WORKFLOW_INSTALLER),
          `${surface}: ${command.split(" ", 1)[0]} omits ${WORKFLOW_INSTALLER}`,
        );
      }
    }

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
