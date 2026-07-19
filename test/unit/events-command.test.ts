/**
 * Unit tests for the evidence-events CLI command parser.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { parseCLIArgs } from "../../src/cli/cli.js";

describe("events command parsing", () => {
  for (const [flag, field] of [
    ["--help", "showHelp"],
    ["--version", "showVersion"],
  ] as const) {
    it(`accepts events ${flag} without the tail subcommand`, () => {
      const parsed = parseCLIArgs(["events", flag]);
      assert.equal(parsed.command, "events");
      assert.equal(parsed[field], true);
    });
  }

  it("parses events tail with a project path and limit", () => {
    const requestedLimit = 5;
    const parsed = parseCLIArgs([
      "events",
      "tail",
      ".",
      "--limit",
      String(requestedLimit),
      "--format",
      "json",
    ]);

    assert.equal(parsed.command, "events");
    assert.equal(parsed.eventsSubcommand, "tail");
    assert.equal(parsed.projectPath, resolve("."));
    assert.equal(parsed.eventsLimit, requestedLimit);
    assert.equal(parsed.format, "json");
  });

  it("rejects --limit outside the events command", () => {
    assert.throws(
      () => parseCLIArgs(["audit", ".", "--limit", "5"]),
      /--limit is only valid for the events command/i,
    );
  });

  it("rejects unknown events subcommands", () => {
    assert.throws(
      () => parseCLIArgs(["events", "watch", "."]),
      /requires subcommand "tail"/i,
    );
  });
});
