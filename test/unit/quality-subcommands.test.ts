/**
 * Unit tests for quality CLI subcommand parsing.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseCLIArgs } from "../../src/cli/cli.js";

describe("quality subcommand parsing", () => {
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
    assert.equal(parsed.all, true);
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
    const cliSource = readFileSync(
      resolve(import.meta.dirname, "..", "..", "src", "cli", "cli.ts"),
      "utf-8",
    );
    assert.match(cliSource, /basename\(path\)\.replace/);
    assert.doesNotMatch(cliSource, /path\.split\("\/"\)/);
  });
});
