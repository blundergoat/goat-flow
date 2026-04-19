/**
 * Unit tests for quality CLI subcommand parsing.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
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

  it("rejects --all on non-quality commands", () => {
    assert.throws(
      () => parseCLIArgs(["audit", ".", "--all"]),
      /only valid for the quality command/i,
    );
  });
});
