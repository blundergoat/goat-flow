/**
 * Protects the command-routing errors developers see before goat-flow starts project work.
 *
 * Use these tests when adding a top-level command or changing a shared flag's valid owners.
 * Retired scan syntax stays rejected while commandless help, menu, and explicit project paths remain stable.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCLIArgs } from "../../src/cli/cli.js";

/** Assert one commandless invocation fails before parser dispatch. */
function assertUnknownCommand(args: string[], token: string): void {
  assert.throws(
    () => parseCLIArgs(args),
    new RegExp(`Unknown command: "${token}"`, "u"),
  );
}

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
// Test 2: no-arg opens menu; every project action names its command
// ---------------------------------------------------------------------------
describe("default command is menu", () => {
  it("rejects a project path without a command", () => {
    assertUnknownCommand(["."], ".");
  });

  it("rejects an unknown command instead of auditing it as a path", () => {
    assertUnknownCommand(["upgrade"], "upgrade");
  });

  it("rejects an action flag without a command", () => {
    assertUnknownCommand(["--format", "json"], "--format");
  });

  it("opens the menu with no args", () => {
    assert.equal(parseCLIArgs([]).command, "menu");
  });

  it("opens the menu with the explicit menu command", () => {
    assert.equal(parseCLIArgs(["menu"]).command, "menu");
  });

  it("keeps global help flags command-free", () => {
    assert.equal(parseCLIArgs(["--help"]).showHelp, true);
    assert.equal(parseCLIArgs(["-h"]).showHelp, true);
  });

  it("keeps global version flags command-free", () => {
    assert.equal(parseCLIArgs(["--version"]).showVersion, true);
    assert.equal(parseCLIArgs(["-v"]).showVersion, true);
  });

  it("accepts an explicit audit project path", () => {
    const parsed = parseCLIArgs(["audit", "."]);
    assert.equal(parsed.command, "audit");
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
  it("rejects dry-run outside install, setup, and learn new", () => {
    assert.throws(
      () => parseCLIArgs(["audit", ".", "--dry-run"]),
      /--dry-run is only valid for install, setup, or learn new/u,
    );
  });
});

describe("claims command routing", () => {
  it("parses read-only inspection for one project-relative target", () => {
    const parsed = parseCLIArgs([
      "claims",
      "inspect",
      ".",
      "--target",
      ".goat-flow/learning-loop/lessons/INDEX.md",
      "--format",
      "json",
    ]);

    assert.equal(parsed.command, "claims");
    assert.equal(parsed.claimsSubcommand, "inspect");
    assert.equal(
      parsed.claimsTargetPath,
      ".goat-flow/learning-loop/lessons/INDEX.md",
    );
    assert.equal(parsed.claimsMarkerSha256, null);
    assert.equal(parsed.shouldConfirmAbandoned, false);
  });

  it("parses confirmed recovery with one exact marker digest", () => {
    const markerSha256 = "a".repeat(64);
    const parsed = parseCLIArgs([
      "claims",
      "recover",
      ".",
      "--target",
      "docs/cli.md",
      "--marker-sha256",
      markerSha256,
      "--confirm-abandoned",
    ]);

    assert.equal(parsed.claimsSubcommand, "recover");
    assert.equal(parsed.claimsTargetPath, "docs/cli.md");
    assert.equal(parsed.claimsMarkerSha256, markerSha256);
    assert.equal(parsed.shouldConfirmAbandoned, true);
  });

  it("requires target, exact lowercase SHA-256, and explicit confirmation", () => {
    assert.throws(
      () => parseCLIArgs(["claims", "inspect"]),
      /claims inspect requires --target <project-relative-path>/u,
    );
    assert.throws(
      () =>
        parseCLIArgs([
          "claims",
          "recover",
          "--target",
          "docs/cli.md",
          "--marker-sha256",
          "ABC",
          "--confirm-abandoned",
        ]),
      /--marker-sha256 must be exactly 64 lowercase hexadecimal characters/u,
    );
    assert.throws(
      () =>
        parseCLIArgs([
          "claims",
          "recover",
          "--target",
          "docs/cli.md",
          "--marker-sha256",
          "a".repeat(64),
        ]),
      /claims recover requires --confirm-abandoned/u,
    );
  });

  it("rejects recovery flags off-route and non-terminal output", () => {
    assert.throws(
      () => parseCLIArgs(["audit", ".", "--target", "docs/cli.md"]),
      /--target is only valid for claims/u,
    );
    assert.throws(
      () =>
        parseCLIArgs([
          "claims",
          "inspect",
          "--target",
          "docs/cli.md",
          "--marker-sha256",
          "a".repeat(64),
        ]),
      /--marker-sha256 is only valid for claims recover/u,
    );
    assert.throws(
      () =>
        parseCLIArgs([
          "claims",
          "inspect",
          "--target",
          "docs/cli.md",
          "--format",
          "markdown",
        ]),
      /claims supports only text or json output/u,
    );
    assert.throws(
      () =>
        parseCLIArgs([
          "claims",
          "inspect",
          "--target",
          "docs/cli.md",
          "--output",
          "claim.json",
        ]),
      /claims is terminal-only and does not support --output/u,
    );
  });

  it("rejects terminal control characters in displayed claim paths", () => {
    assert.throws(
      () =>
        parseCLIArgs([
          "claims",
          "inspect",
          "project\u001b[2J",
          "--target",
          "docs/cli.md",
        ]),
      /claims project path must not contain terminal control characters/u,
    );
    assert.throws(
      () =>
        parseCLIArgs([
          "claims",
          "inspect",
          "--target",
          "docs/cli.md\nspoofed output",
        ]),
      /claims target path must not contain terminal control characters/u,
    );
  });
});
