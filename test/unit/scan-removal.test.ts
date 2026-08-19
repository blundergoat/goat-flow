/**
 * Scan removal stability tests.
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

describe("managed preview flags", () => {
  it("rejects dry-run outside install and setup", () => {
    assert.throws(
      () => parseCLIArgs(["audit", ".", "--dry-run"]),
      /--dry-run is only valid for install or setup/u,
    );
  });
});
