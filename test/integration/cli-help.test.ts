/**
 * Prove the terminal help users see for global and top-level command requests.
 *
 * Use these process tests when routing or help metadata changes.
 * They spawn the real CLI so exit status, output, and dispatch avoidance stay covered together.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const cliEntryPath = join(repositoryRoot, "src", "cli", "cli.ts");
const activeHelpCommands = [
  "setup",
  "install",
  "audit",
  "quality",
  "status",
  "dashboard",
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
] as const;

/**
 * Spawn the real CLI to exercise the same help route a terminal user reaches.
 *
 * Use in process-level assertions; the child process isolates exit and output behavior.
 * Side effect: starts a child process that executes the TypeScript CLI.
 *
 * @param commandArguments - arguments entered after `goat-flow`; empty follows the no-command menu route
 * @returns captured child-process status, stdout, and stderr
 */
function runHelpCommand(commandArguments: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", cliEntryPath, ...commandArguments],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
    },
  );
}

describe("root CLI help", () => {
  // An empty path means this suite has not created the user-like project used to detect accidental writes.
  let bareProjectDirectory = "";

  before(() => {
    bareProjectDirectory = mkdtempSync(join(tmpdir(), "goat-cli-help-"));
  });

  after(() => {
    // A populated path means the suite created temporary user state that now needs cleanup.
    if (bareProjectDirectory)
      rmSync(bareProjectDirectory, { recursive: true, force: true });
  });

  it("renders concise navigation and returns before project dispatch", () => {
    const requestedOutputPath = join(bareProjectDirectory, "audit-output.json");
    const rootHelpProcess = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        cliEntryPath,
        "--help",
        "--output",
        requestedOutputPath,
      ],
      { cwd: repositoryRoot, encoding: "utf8" },
    );

    assert.equal(
      rootHelpProcess.status,
      0,
      `stderr: ${rootHelpProcess.stderr}`,
    );
    assert.equal(rootHelpProcess.stderr, "");
    assert.equal(
      existsSync(requestedOutputPath),
      false,
      "help must return before audit writes its requested output",
    );

    const helpLines = rootHelpProcess.stdout.trimEnd().split(/\r?\n/u);
    assert.ok(
      helpLines.length <= 40,
      `root help grew to ${helpLines.length} lines`,
    );
    assert.match(
      rootHelpProcess.stdout,
      /^goat-flow - AI coding-agent harness$/mu,
    );
    assert.match(rootHelpProcess.stdout, /^Usage:$/mu);
    assert.match(rootHelpProcess.stdout, /^Common workflows:$/mu);
    assert.match(rootHelpProcess.stdout, /^Advanced commands:$/mu);
    assert.match(rootHelpProcess.stdout, /^Global flags:$/mu);
    assert.match(rootHelpProcess.stdout, /^Examples:$/mu);

    // Every common workflow stays directly discoverable from the user's first help screen.
    for (const helpCommand of [
      "dashboard",
      "audit",
      "install",
      "setup",
      "status",
      "quality",
    ]) {
      assert.match(
        rootHelpProcess.stdout,
        new RegExp(`^  ${helpCommand}\\s`, "mu"),
        `common workflow missing: ${helpCommand}`,
      );
    }

    // Every advanced workflow stays searchable without turning the first help screen into a long reference manual.
    for (const helpCommand of [
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
        rootHelpProcess.stdout,
        new RegExp(`\\b${helpCommand}\\b`, "u"),
        `advanced command missing: ${helpCommand}`,
      );
    }

    assert.doesNotMatch(
      rootHelpProcess.stdout,
      /^\s+info(?:\s|$)/mu,
      "the removed info token must stay hidden",
    );
    assert.match(
      rootHelpProcess.stdout,
      /Run 'goat-flow <command> --help' for command-specific options and examples\./u,
    );
  });

  it("shows exactly four executable examples", () => {
    const rootHelpProcess = runHelpCommand(["--help"]);

    assert.equal(
      rootHelpProcess.status,
      0,
      `stderr: ${rootHelpProcess.stderr}`,
    );
    // Missing `Examples:` output leaves this value empty, so the exact assertion below reports a broken user-facing section.
    const exampleCommands = rootHelpProcess.stdout
      .split("Examples:\n")[1]
      ?.split("\n\n", 1)[0]
      ?.split(/\r?\n/u)
      .filter((line) => line.startsWith("  goat-flow "));
    assert.deepEqual(exampleCommands, [
      "  goat-flow dashboard .",
      "  goat-flow audit . --harness",
      "  goat-flow install . --agent codex --dry-run",
      "  goat-flow quality . --agent codex",
    ]);
  });
});

describe("contextual CLI help", () => {
  // Give every command its own test name so a failed topic identifies the exact workflow the user requested.
  for (const helpCommand of activeHelpCommands) {
    it(`renders dedicated ${helpCommand} help`, () => {
      const commandHelpProcess = runHelpCommand([helpCommand, "--help"]);

      assert.equal(
        commandHelpProcess.status,
        0,
        `${helpCommand}: ${commandHelpProcess.stderr}`,
      );
      assert.match(
        commandHelpProcess.stdout,
        new RegExp(`^goat-flow ${helpCommand}$`, "mu"),
      );
      assert.match(commandHelpProcess.stdout, /^Usage:$/mu);
      assert.match(commandHelpProcess.stdout, /^Examples:$/mu);
      assert.match(
        commandHelpProcess.stdout,
        /^Full reference: docs\/cli\.md$/mu,
      );
      assert.doesNotMatch(commandHelpProcess.stdout, /^Common workflows:$/mu);
    });
  }

  it("shows audit guidance without dispatch or unrelated hook flags", () => {
    const auditHelpProcess = runHelpCommand([
      "audit",
      "/definitely/missing/goat-flow-project",
      "--help",
    ]);

    assert.equal(
      auditHelpProcess.status,
      0,
      `stderr: ${auditHelpProcess.stderr}`,
    );
    assert.match(
      auditHelpProcess.stdout,
      /^  goat-flow audit \[path\] \[flags\]$/mu,
    );
    assert.match(auditHelpProcess.stdout, /^  --harness\s+/mu);
    assert.match(auditHelpProcess.stdout, /^  --check-drift\s+/mu);
    assert.doesNotMatch(auditHelpProcess.stdout, /--scenario/u);
    assert.equal(auditHelpProcess.stderr, "");
  });

  it("summarizes hooks subcommands without leaking audit-only flags", () => {
    const hooksHelpProcess = runHelpCommand(["hooks", "--help"]);

    assert.equal(
      hooksHelpProcess.status,
      0,
      `stderr: ${hooksHelpProcess.stderr}`,
    );
    assert.match(hooksHelpProcess.stdout, /^Subcommands:$/mu);
    assert.match(hooksHelpProcess.stdout, /^  list\s+/mu);
    assert.match(hooksHelpProcess.stdout, /^  enable\s+/mu);
    assert.match(hooksHelpProcess.stdout, /^  disable\s+/mu);
    assert.match(hooksHelpProcess.stdout, /^  sync\s+/mu);
    assert.match(hooksHelpProcess.stdout, /^  verify\s+/mu);
    assert.match(hooksHelpProcess.stdout, /^  --scenario <name>\s+/mu);
    assert.doesNotMatch(hooksHelpProcess.stdout, /--harness/u);
  });
});
