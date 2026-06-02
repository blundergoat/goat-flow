/**
 * Unit tests for quality CLI subcommand parsing.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { classifyProjectState } from "../../src/cli/classify-state.js";
import {
  MULTI_AGENT_SYNC_BANNER,
  validAgentFlags,
  validAgentList,
  validAgents,
} from "../../src/cli/cli-agent-options.js";
import { CLIError } from "../../src/cli/cli-error.js";
import { dispatchCommand } from "../../src/cli/cli-handlers.js";
import { writeOutput } from "../../src/cli/cli-output.js";
import { parseCLIArgs } from "../../src/cli/cli-parser.js";
import {
  COMMANDS,
  HOOK_SUBCOMMANDS,
  REMOVED_COMMANDS,
  VALID_FORMATS,
} from "../../src/cli/cli-types.js";
import type { ParsedCLI } from "../../src/cli/cli-types.js";
import { handleHooksCommand } from "../../src/cli/hooks-command.js";

const CLI_USAGE_EXIT_CODE = 2;

/**
 * Capture stdout emitted by the shared CLI output writer.
 *
 * @param rendered - command output body to write
 * @returns the exact text written to stdout
 */
function captureStdoutWrite(rendered: string): string {
  let captured = "";
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    captured += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  try {
    writeOutput({ output: null } as ParsedCLI, rendered);
  } finally {
    process.stdout.write = originalWrite;
  }
  return captured;
}

describe("quality subcommand parsing", () => {
  it("keeps CLI support modules aligned with parser-visible command vocabulary", () => {
    assert.equal(validAgents().includes("claude"), true);
    assert.match(validAgentList(), /claude/);
    assert.match(validAgentFlags(), /--agent claude/);
    assert.match(MULTI_AGENT_SYNC_BANNER.join("\n"), /Multi-agent sync/);
    assert.equal(
      new CLIError("usage", CLI_USAGE_EXIT_CODE).exitCode,
      CLI_USAGE_EXIT_CODE,
    );
    assert.equal(typeof dispatchCommand, "function");
    assert.equal(typeof handleHooksCommand, "function");
    assert.equal(COMMANDS.includes("quality"), true);
    assert.equal(HOOK_SUBCOMMANDS.has("sync"), true);
    assert.equal(VALID_FORMATS.includes("json"), true);
    assert.match(REMOVED_COMMANDS.check, /audit --check-drift/);
    assert.match(REMOVED_COMMANDS.critique, /\bquality\b/);
    assert.match(REMOVED_COMMANDS.fix, /\b(?:audit|quality)\b/);
    assert.match(REMOVED_COMMANDS.eval, /\bquality candidacy\b/);
    assert.doesNotMatch(REMOVED_COMMANDS.eval, /quality evaluate/);
    assert.equal(captureStdoutWrite("payload"), "payload\n");
    assert.equal(
      classifyProjectState({ exists: () => false, readFile: () => null }).state,
      "bare",
    );
  });

  it("rejects the removed capture subcommand with a migration hint", () => {
    assert.throws(
      () => parseCLIArgs(["quality", "capture"]),
      /quality capture.+removed/i,
    );
  });

  it("parses history mode with --all", () => {
    const parsed = parseCLIArgs([
      "quality",
      "history",
      "--agent",
      "claude",
      "--mode",
      "skills",
      "--all",
    ]);
    assert.equal(parsed.qualitySubcommand, "history");
    assert.equal(parsed.includeAll, true);
    assert.equal(parsed.agent, "claude");
    assert.equal(parsed.qualityMode, "skills");
  });

  it("parses diff mode with an explicit report pair", () => {
    const parsed = parseCLIArgs([
      "quality",
      "diff",
      "2026-04-01-0900-claude-aaaaa:2026-04-15-1000-claude-bbbbb",
      "--agent",
      "claude",
    ]);
    assert.equal(parsed.qualitySubcommand, "diff");
    assert.equal(
      parsed.qualityDiffPair,
      "2026-04-01-0900-claude-aaaaa:2026-04-15-1000-claude-bbbbb",
    );
  });

  it("parses prompt mode for mode-specific quality prompts", () => {
    const parsed = parseCLIArgs([
      "quality",
      ".",
      "--agent",
      "claude",
      "--mode",
      "skills",
    ]);
    assert.equal(parsed.qualitySubcommand, "prompt");
    assert.equal(parsed.qualityMode, "skills");
  });

  it("rejects --all on non-quality commands", () => {
    assert.throws(
      () => parseCLIArgs(["audit", ".", "--all"]),
      /only valid for the quality command/i,
    );
  });
});

describe("skill subcommand parsing", () => {
  it("keeps projectPath at cwd instead of treating 'new' as a path", () => {
    const parsed = parseCLIArgs([
      "skill",
      "new",
      "I want a workflow for deploy checks",
      "--name",
      "deploy-checks",
      "--yes",
    ]);
    assert.equal(parsed.command, "skill");
    assert.equal(parsed.skillSubcommand, "new");
    assert.equal(parsed.projectPath, resolve("."));
    assert.equal(
      parsed.skillDescription,
      "I want a workflow for deploy checks",
    );
  });

  it("parses an explicit project path after skill new", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "goat-flow-skill-cli-"));
    try {
      const parsed = parseCLIArgs([
        "skill",
        "new",
        projectRoot,
        "I want a workflow for deploy checks",
      ]);
      assert.equal(parsed.command, "skill");
      assert.equal(parsed.skillSubcommand, "new");
      assert.equal(parsed.projectPath, projectRoot);
      assert.equal(
        parsed.skillDescription,
        "I want a workflow for deploy checks",
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("parses an explicit project path before skill new", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "goat-flow-skill-cli-"));
    try {
      const parsed = parseCLIArgs([
        "skill",
        projectRoot,
        "new",
        "I want a workflow for deploy checks",
      ]);
      assert.equal(parsed.command, "skill");
      assert.equal(parsed.skillSubcommand, "new");
      assert.equal(parsed.projectPath, projectRoot);
      assert.equal(
        parsed.skillDescription,
        "I want a workflow for deploy checks",
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

describe("quality candidacy draft naming", () => {
  it("uses the platform path basename instead of POSIX-only splitting", () => {
    const qualityCommandSource = readFileSync(
      resolve(
        import.meta.dirname,
        "..",
        "..",
        "src",
        "cli",
        "quality",
        "quality-command.ts",
      ),
      "utf-8",
    );
    assert.match(qualityCommandSource, /basename\(path\)\.replace/);
    assert.doesNotMatch(qualityCommandSource, /path\.split\("\/"\)/);
  });
});
