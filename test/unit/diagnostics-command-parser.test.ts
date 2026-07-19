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
  for (const [flag, field] of [
    ["--help", "showHelp"],
    ["--version", "showVersion"],
  ] as const) {
    it(`accepts diagnostics ${flag} without a diagnostics subcommand`, () => {
      const parsed = parseCLIArgs(["diagnostics", flag]);
      assert.equal(parsed.command, "diagnostics");
      assert.equal(parsed[field], true);
    });
  }

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

  // A support user can request one local bundle without entering another top-level command.
  it("parses diagnostics bundle with a project path", () => {
    const parsed = parseCLIArgs([
      "diagnostics",
      "bundle",
      ".",
      "--agent",
      "codex",
      "--format",
      "json",
    ]);

    assert.equal(parsed.command, "diagnostics");
    assert.equal(parsed.diagnosticsSubcommand, "bundle");
    assert.equal(parsed.projectPath, resolve("."));
    assert.equal(parsed.agent, "codex");
    assert.equal(parsed.format, "json");
  });

  // A project owner can request readiness before asking an agent to start work.
  it("parses diagnostics readiness with a project path", () => {
    const parsed = parseCLIArgs([
      "diagnostics",
      "readiness",
      ".",
      "--agent",
      "codex",
      "--format",
      "json",
    ]);

    assert.equal(parsed.command, "diagnostics");
    assert.equal(parsed.diagnosticsSubcommand, "readiness");
    assert.equal(parsed.projectPath, resolve("."));
    assert.equal(parsed.agent, "codex");
    assert.equal(parsed.format, "json");
  });

  // A reviewer can request one static agent/tool threat artifact from the shared diagnostics namespace.
  it("parses diagnostics threat-model with a project path", () => {
    const parsed = parseCLIArgs([
      "diagnostics",
      "threat-model",
      ".",
      "--agent",
      "codex",
      "--format",
      "json",
    ]);

    assert.equal(parsed.command, "diagnostics");
    assert.equal(parsed.diagnosticsSubcommand, "threat-model");
    assert.equal(parsed.projectPath, resolve("."));
    assert.equal(parsed.agent, "codex");
    assert.equal(parsed.format, "json");
  });

  // A missing readout name cannot tell users which diagnostics contract they requested.
  it("rejects a missing diagnostics subcommand", () => {
    assert.throws(
      () => parseCLIArgs(["diagnostics"]),
      /diagnostics requires subcommand "context", "readiness", "bundle", or "threat-model"/iu,
    );
  });

  // A misspelled future readout must not become an audit path by accident.
  it("rejects unsupported diagnostics subcommands", () => {
    assert.throws(
      () => parseCLIArgs(["diagnostics", "unknown", "."]),
      /diagnostics requires subcommand "context", "readiness", "bundle", or "threat-model"/iu,
    );
  });

  // Two target paths are ambiguous because one report can inspect only one selected project.
  it("rejects extra diagnostics paths", () => {
    assert.throws(
      () => parseCLIArgs(["diagnostics", "context", ".", "../other"]),
      /diagnostics context accepts at most one project path/iu,
    );
  });

  // Two support targets would make one bundle ambiguous for the maintainer reading it.
  it("rejects extra diagnostics bundle paths", () => {
    assert.throws(
      () => parseCLIArgs(["diagnostics", "bundle", ".", "../other"]),
      /diagnostics bundle accepts at most one project path/iu,
    );
  });

  // Two readiness targets would mix evidence from projects the user must repair separately.
  it("rejects extra diagnostics readiness paths", () => {
    assert.throws(
      () => parseCLIArgs(["diagnostics", "readiness", ".", "../other"]),
      /diagnostics readiness accepts at most one project path/iu,
    );
  });

  // Two targets would mix threat evidence from agent installations the reviewer must assess separately.
  it("rejects extra diagnostics threat-model paths", () => {
    assert.throws(
      () => parseCLIArgs(["diagnostics", "threat-model", ".", "../other"]),
      /diagnostics threat-model accepts at most one project path/iu,
    );
  });
});
