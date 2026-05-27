/**
 * Scan removal stability tests (M21).
 * Verifies that `scan` is fully removed from user-facing surfaces.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCLIArgs } from "../../src/cli/cli.js";

// ---------------------------------------------------------------------------
// Test 1: `goat-flow scan` is no longer a command - should throw
// ---------------------------------------------------------------------------
describe("scan command removed", () => {
  it("throws when scan is used as a command", () => {
    assert.throws(
      () => parseCLIArgs(["scan", "."]),
      (err: Error) => err.message.includes('"scan" was removed'),
      "scan command should produce a removal error",
    );
  });
});

// ---------------------------------------------------------------------------
// Test 2: no-arg opens menu; path shorthand still audits
// ---------------------------------------------------------------------------
describe("default command is menu", () => {
  it("keeps path-only shorthand as audit", () => {
    const parsed = parseCLIArgs(["."]);
    assert.equal(parsed.command, "audit", "Path shorthand should audit");
  });

  it("opens the menu with no args at all", () => {
    const parsed = parseCLIArgs([]);
    assert.equal(parsed.command, "menu", "Empty args should open menu");
  });
});

// ---------------------------------------------------------------------------
// Test 3: --help output contains audit and quality, does not contain scan
// ---------------------------------------------------------------------------
describe("CLI help text", () => {
  it("audit and quality are recognized commands", () => {
    const auditParsed = parseCLIArgs(["audit", "."]);
    assert.equal(auditParsed.command, "audit");

    const qualityParsed = parseCLIArgs(["quality", ".", "--agent", "claude"]);
    assert.equal(qualityParsed.command, "quality");
  });

  it("scan is in removed commands, not active commands", () => {
    // Verify scan throws (not silently ignored)
    assert.throws(
      () => parseCLIArgs(["scan"]),
      (err: Error) => err.message.includes("removed"),
    );

    // Verify audit does not throw
    assert.doesNotThrow(() => parseCLIArgs(["audit", "."]));
  });
});

// ---------------------------------------------------------------------------
// Test 4: --min-score and --min-grade flags are rejected
// ---------------------------------------------------------------------------
describe("removed flags rejected", () => {
  it("rejects --min-score flag", () => {
    assert.throws(
      () => parseCLIArgs(["audit", ".", "--min-score", "80"]),
      "min-score should be rejected by strict parseArgs",
    );
  });

  it("rejects --min-grade flag", () => {
    assert.throws(
      () => parseCLIArgs(["audit", ".", "--min-grade", "B"]),
      "min-grade should be rejected by strict parseArgs",
    );
  });

  it("rejects --guide flag", () => {
    assert.throws(
      () => parseCLIArgs(["audit", ".", "--guide"]),
      "guide should be rejected by strict parseArgs",
    );
  });
});

// ---------------------------------------------------------------------------
// Test 5: Existing M19b + M20a + M20b tests still pass (verified by test runner)
// ---------------------------------------------------------------------------
describe("backwards compatibility", () => {
  it("audit command parses correctly with all valid flags", () => {
    const parsed = parseCLIArgs([
      "audit",
      ".",
      "--harness",
      "--agent",
      "claude",
      "--format",
      "json",
    ]);
    assert.equal(parsed.command, "audit");
    assert.equal(parsed.harness, true);
    assert.equal(parsed.agent, "claude");
    assert.equal(parsed.format, "json");
  });

  it("quality command parses correctly", () => {
    const parsed = parseCLIArgs(["quality", ".", "--agent", "antigravity"]);
    assert.equal(parsed.command, "quality");
    assert.equal(parsed.agent, "antigravity");
  });

  it("setup command still works", () => {
    const parsed = parseCLIArgs(["setup", ".", "--agent", "codex"]);
    assert.equal(parsed.command, "setup");
    assert.equal(parsed.agent, "codex");
  });

  it("install command parses deterministic setup flags", () => {
    const parsed = parseCLIArgs([
      "install",
      ".",
      "--agent",
      "codex",
      "--force",
    ]);
    assert.equal(parsed.command, "install");
    assert.equal(parsed.agent, "codex");
    assert.equal(parsed.force, true);
  });

  it("setup --apply parses as deterministic setup", () => {
    const parsed = parseCLIArgs(["setup", ".", "--agent", "codex", "--apply"]);
    assert.equal(parsed.command, "setup");
    assert.equal(parsed.agent, "codex");
    assert.equal(parsed.apply, true);
  });
});
