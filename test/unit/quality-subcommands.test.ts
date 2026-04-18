/**
 * Unit tests for quality CLI subcommand parsing.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { parseCLIArgs } from "../../src/cli/cli.js";

describe("quality subcommand parsing", () => {
  it("parses capture mode and resolves bare output files under the project root", () => {
    const parsed = parseCLIArgs([
      "quality",
      "capture",
      "--from-file",
      "response.md",
      "--output",
      "report.json",
    ]);

    assert.equal(parsed.command, "quality");
    assert.equal(parsed.qualitySubcommand, "capture");
    assert.equal(parsed.fromFile, "response.md");
    assert.equal(parsed.projectPath, resolve("."));
    assert.equal(parsed.output, resolve(".goat-flow", "report.json"));
  });

  it("parses history mode with --all", () => {
    const parsed = parseCLIArgs([
      "quality",
      "history",
      "--agent",
      "claude",
      "--all",
    ]);
    assert.equal(parsed.qualitySubcommand, "history");
    assert.equal(parsed.all, true);
    assert.equal(parsed.agent, "claude");
  });

  it("parses diff mode with an explicit report pair", () => {
    const parsed = parseCLIArgs([
      "quality",
      "diff",
      "2026-04-01-claude:2026-04-15-claude",
      "--agent",
      "claude",
    ]);
    assert.equal(parsed.qualitySubcommand, "diff");
    assert.equal(parsed.qualityDiffPair, "2026-04-01-claude:2026-04-15-claude");
  });

  it("rejects quality-only flags on non-quality commands", () => {
    assert.throws(
      () => parseCLIArgs(["audit", ".", "--from-file", "response.md"]),
      /only valid for the quality command/i,
    );
  });
});
