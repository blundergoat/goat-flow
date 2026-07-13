/**
 * Protects the shared diagnostics command grammar users type in terminals and CI.
 * Use these tests when adding a diagnostics readout so unsupported names or extra
 * paths fail with usage guidance instead of silently falling back to audit.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";

import { parseCLIArgs } from "../../src/cli/cli-parser.js";

describe("diagnostics command parsing", () => {
  // A maintainer can select the static context readout and a target in one predictable order.
  it("parses diagnostics context with a project path", () => {
    const parsed = parseCLIArgs([
      "diagnostics",
      "context",
      ".",
      "--agent",
      "codex",
      "--format",
      "json",
    ]);

    assert.equal(parsed.command, "diagnostics");
    assert.equal(parsed.diagnosticsSubcommand, "context");
    assert.equal(parsed.projectPath, resolve("."));
    assert.equal(parsed.agent, "codex");
    assert.equal(parsed.format, "json");
  });

  // A missing readout name cannot tell users which diagnostics contract they requested.
  it("rejects a missing diagnostics subcommand", () => {
    assert.throws(
      () => parseCLIArgs(["diagnostics"]),
      /diagnostics requires subcommand "context"/iu,
    );
  });

  // A misspelled future readout must not become an audit path by accident.
  it("rejects unsupported diagnostics subcommands", () => {
    assert.throws(
      () => parseCLIArgs(["diagnostics", "bundle", "."]),
      /diagnostics requires subcommand "context"/iu,
    );
  });

  // Two target paths are ambiguous because one report can inspect only one selected project.
  it("rejects extra diagnostics paths", () => {
    assert.throws(
      () => parseCLIArgs(["diagnostics", "context", ".", "../other"]),
      /diagnostics context accepts at most one project path/iu,
    );
  });
});
