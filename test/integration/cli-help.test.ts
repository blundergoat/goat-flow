/**
 * Public contract tests for concise root CLI help.
 *
 * These spawn the real TypeScript entry point so routing, output, and exit
 * behavior are proved together rather than only exercising the renderer.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const cliPath = join(repoRoot, "src", "cli", "cli.ts");

describe("root CLI help", () => {
  let bareProject = "";

  before(() => {
    bareProject = mkdtempSync(join(tmpdir(), "goat-cli-help-"));
  });

  after(() => {
    if (bareProject) rmSync(bareProject, { recursive: true, force: true });
  });

  it("renders concise navigation and returns before project dispatch", () => {
    const outputPath = join(bareProject, "audit-output.json");
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", cliPath, "--help", "--output", outputPath],
      { cwd: repoRoot, encoding: "utf8" },
    );

    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.equal(result.stderr, "");
    assert.equal(
      existsSync(outputPath),
      false,
      "help must return before audit writes its requested output",
    );

    const lines = result.stdout.trimEnd().split(/\r?\n/u);
    assert.ok(lines.length <= 40, `root help grew to ${lines.length} lines`);
    assert.match(result.stdout, /^goat-flow - AI coding-agent harness$/mu);
    assert.match(result.stdout, /^Usage:$/mu);
    assert.match(result.stdout, /^Common workflows:$/mu);
    assert.match(result.stdout, /^Advanced commands:$/mu);
    assert.match(result.stdout, /^Global flags:$/mu);
    assert.match(result.stdout, /^Examples:$/mu);

    for (const command of [
      "dashboard",
      "audit",
      "install",
      "setup",
      "status",
      "quality",
    ]) {
      assert.match(
        result.stdout,
        new RegExp(`^  ${command}\\s`, "mu"),
        `common workflow missing: ${command}`,
      );
    }

    for (const command of [
      "manifest",
      "events",
      "hooks",
      "menu",
      "stats",
      "diagnostics",
      "index",
      "redact",
      "review",
      "plans",
      "skill",
    ]) {
      assert.match(
        result.stdout,
        new RegExp(`\\b${command}\\b`, "u"),
        `advanced command missing: ${command}`,
      );
    }

    assert.doesNotMatch(
      result.stdout,
      /^\s+info(?:\s|$)/mu,
      "the removed info token must stay hidden",
    );
    assert.match(
      result.stdout,
      /Run 'goat-flow <command> --help' for command-specific options and examples\./u,
    );
  });

  it("shows exactly four executable examples", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", cliPath, "--help"],
      { cwd: repoRoot, encoding: "utf8" },
    );

    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    const examples = result.stdout
      .split("Examples:\n")[1]
      ?.split("\n\n", 1)[0]
      ?.split(/\r?\n/u)
      .filter((line) => line.startsWith("  goat-flow "));
    assert.deepEqual(examples, [
      "  goat-flow dashboard .",
      "  goat-flow audit . --harness",
      "  goat-flow install . --agent codex --dry-run",
      "  goat-flow quality . --agent codex",
    ]);
  });
});
