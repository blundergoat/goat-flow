/**
 * Prove the terminal help users see for global and top-level command requests.
 *
 * Use these tests when routing or help metadata changes.
 * Most render help in-process through the CLI's own help routing; one still spawns the real CLI so exit status, output, and dispatch avoidance
 * stay covered together.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parseCLIArgs, renderInformationalRequest } from "../../src/cli/cli.js";

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
  "claims",
  "menu",
  "stats",
  "recall",
  "learn",
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
function runHelpProcess(commandArguments: string[]) {
  // Private files preserve child output when managed pipes return empty captures.
  const captureDirectory = mkdtempSync(join(tmpdir(), "goat-cli-help-output-"));
  const stdoutPath = join(captureDirectory, "stdout");
  const stderrPath = join(captureDirectory, "stderr");
  const descriptors: number[] = [];
  try {
    for (const path of [stdoutPath, stderrPath]) {
      descriptors.push(openSync(path, "wx", 0o600));
    }
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", cliEntryPath, ...commandArguments],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        stdio: ["ignore", ...descriptors],
      },
    );
    const stdout = readFileSync(stdoutPath, "utf8");
    const stderr = readFileSync(stderrPath, "utf8");
    assert.equal(result.status, 0, stderr || result.error?.message);
    assert.equal(result.signal, null);
    // Completed EPERM metadata is acceptable only after the exit checks above.
    assert.ok(
      !result.error ||
        ("code" in result.error && result.error.code === "EPERM"),
      result.error?.message,
    );
    return { ...result, stdout, stderr };
  } finally {
    for (const descriptor of descriptors) closeSync(descriptor);
    rmSync(captureDirectory, { recursive: true, force: true });
  }
}

/**
 * Render the help a terminal user would see for these arguments, in-process, through the same routing the real CLI uses.
 *
 * @param commandArguments - arguments entered after `goat-flow`, such as `["audit", "--help"]`
 * @returns status 0 and the printed help, shaped like the real-process capture
 * @throws when the arguments are not a help or version request, because only the real CLI may dispatch a command
 */
function runHelpCommand(commandArguments: string[]) {
  const rendered = renderInformationalRequest(
    commandArguments,
    parseCLIArgs(commandArguments),
  );
  // A request without --help or --version would run a real command, which these tests must never do.
  if (rendered === null)
    throw new Error(`not a help request: ${commandArguments.join(" ")}`);
  return { status: 0, stdout: `${rendered}\n`, stderr: "" };
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
    const rootHelpProcess = runHelpProcess([
      "--help",
      "--output",
      requestedOutputPath,
    ]);

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
      "claims",
      "menu",
      "stats",
      "recall",
      "learn",
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
    const rootHelp = runHelpCommand(["--help"]);

    assert.equal(rootHelp.status, 0, `stderr: ${rootHelp.stderr}`);
    // Missing `Examples:` output leaves this value empty, so the exact assertion below reports a broken user-facing section.
    const exampleCommands = rootHelp.stdout
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
      const commandHelp = runHelpCommand([helpCommand, "--help"]);

      assert.equal(
        commandHelp.status,
        0,
        `${helpCommand}: ${commandHelp.stderr}`,
      );
      assert.match(
        commandHelp.stdout,
        new RegExp(`^goat-flow ${helpCommand}$`, "mu"),
      );
      assert.match(commandHelp.stdout, /^Usage:$/mu);
      assert.match(commandHelp.stdout, /^Examples:$/mu);
      assert.match(commandHelp.stdout, /^Full reference: docs\/cli\.md$/mu);
      assert.doesNotMatch(commandHelp.stdout, /^Common workflows:$/mu);
    });
  }

  it("shows audit guidance without dispatch or unrelated hook flags", () => {
    const auditHelp = runHelpCommand([
      "audit",
      "/definitely/missing/goat-flow-project",
      "--help",
    ]);

    assert.equal(auditHelp.status, 0, `stderr: ${auditHelp.stderr}`);
    assert.match(auditHelp.stdout, /^  goat-flow audit \[path\] \[flags\]$/mu);
    assert.match(auditHelp.stdout, /^  --harness\s+/mu);
    assert.match(auditHelp.stdout, /^  --check-drift\s+/mu);
    assert.doesNotMatch(auditHelp.stdout, /--scenario/u);
    assert.equal(auditHelp.stderr, "");
  });

  it("summarizes hooks subcommands without leaking audit-only flags", () => {
    const hooksHelp = runHelpCommand(["hooks", "--help"]);

    assert.equal(hooksHelp.status, 0, `stderr: ${hooksHelp.stderr}`);
    assert.match(hooksHelp.stdout, /^Subcommands:$/mu);
    assert.match(hooksHelp.stdout, /^  list\s+/mu);
    assert.match(hooksHelp.stdout, /^  enable\s+/mu);
    assert.match(hooksHelp.stdout, /^  disable\s+/mu);
    assert.match(hooksHelp.stdout, /^  sync\s+/mu);
    assert.match(hooksHelp.stdout, /^  verify\s+/mu);
    assert.match(hooksHelp.stdout, /^  --scenario <name>\s+/mu);
    assert.doesNotMatch(hooksHelp.stdout, /--harness/u);
  });

  it("shows the two-step claim recovery boundary", () => {
    const claimsHelp = runHelpCommand(["claims", "--help"]);

    assert.equal(claimsHelp.status, 0, claimsHelp.stderr);
    assert.match(claimsHelp.stdout, /^Subcommands:$/mu);
    assert.match(claimsHelp.stdout, /^  inspect\s+/mu);
    assert.match(claimsHelp.stdout, /^  recover\s+/mu);
    assert.match(claimsHelp.stdout, /^  --target <path>\s+/mu);
    assert.match(claimsHelp.stdout, /^  --marker-sha256 <hash>\s+/mu);
    assert.match(claimsHelp.stdout, /^  --confirm-abandoned\s+/mu);
    assert.doesNotMatch(claimsHelp.stdout, /--force/u);
  });

  it("advertises narrow setup authority and learn output formats", () => {
    const setupHelp = runHelpCommand(["setup", "--help"]);
    const learnHelp = runHelpCommand(["learn", "--help"]);

    assert.equal(setupHelp.status, 0, setupHelp.stderr);
    assert.match(setupHelp.stdout, /^  --force-managed\s+/mu);
    assert.match(setupHelp.stdout, /^  --force-path <path>\s+/mu);
    assert.match(setupHelp.stdout, /^  --force-user-owned\s+/mu);
    assert.equal(learnHelp.status, 0, learnHelp.stderr);
    assert.match(learnHelp.stdout, /^  --format <type>\s+/mu);
  });

  it("explains managed-state migration and recovery from install help", () => {
    const installHelp = runHelpCommand(["install", "--help"]);

    assert.equal(installHelp.status, 0, installHelp.stderr);
    assert.match(installHelp.stdout, /^Managed state:$/mu);
    for (const expectedGuidance of [
      "Apply may update managed.json and every supported agent's cutover marker.",
      "After managed.json exists, legacy hashes are non-authoritative; ambiguous legacy history blocks every agent.",
      "Package, path-set, row-generation, target-byte, or cutover-marker drift makes a receipt stale.",
      "After verified bytes but a failed state write, repair .goat-flow/state/install/ and rerun the printed command.",
      "After cutover, workflow/install-goat-flow.sh refuses before mutation; use the public CLI.",
      "Force cannot repair install evidence, and ordinary install does not automatically prune it.",
    ]) {
      assert.ok(
        installHelp.stdout.includes(expectedGuidance),
        `install help must include: ${expectedGuidance}`,
      );
    }

    const cliReference = readFileSync(
      join(repositoryRoot, "docs", "cli.md"),
      "utf8",
    );
    for (const expectedReferenceGuidance of [
      ".goat-flow/state/install/managed.json` is the sole project-wide baseline",
      "every supported agent's `.goat-flow/state/install/<agent>.json` cutover marker",
      "equal or unrankable versions that disagree on a path hash, blocks every agent",
      "The previous baseline remains intact and no new confirmed receipt is published.",
      "it never prunes them by inference.",
    ]) {
      assert.ok(
        cliReference.includes(expectedReferenceGuidance),
        `docs/cli.md must include: ${expectedReferenceGuidance}`,
      );
    }
  });
});
