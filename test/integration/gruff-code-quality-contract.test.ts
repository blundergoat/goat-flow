/**
 * Integration tests for the gruff-code-quality hook's gruff.hook.v1 contract path:
 * capability-advertised analyzers drive `hook --format json` (never legacy analyse),
 * and the thin renderer relays findings, suppression counts, config errors (B8),
 * and ignore verdicts (B7) across the envelope variations the five ports emit.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  cleanupHookTestDirs,
  git,
  initGit,
  makeRoot,
  runHook,
  writeContractGruffBinary,
} from "./gruff-code-quality-smoke.helpers.js";

after(cleanupHookTestDirs);

describe("gruff-code-quality hook (gruff.hook.v1 contract)", () => {
  // Fixture purpose: writes a hook-envelope mock to cover finding and suppression rendering.
  it("renders gruff.hook.v1 output when the analyzer advertises the contract", () => {
    const root = makeRoot();
    writeContractGruffBinary(root);
    writeFileSync(join(root, ".gruff-ts.yaml"), "rules: {}\n");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "sample.ts"), "a\nb\nc\nd\n");

    const result = runHook(
      root,
      {
        tool_name: "Edit",
        tool_input: {
          file_path: "src/sample.ts",
          changed_ranges: [{ startLine: 3, endLine: 3 }],
        },
      },
      "/usr/bin:/bin",
    );

    assert.equal(result.status, 0, result.stderr);
    // file-scope finding renders WITHOUT a :line (location semantics); line-scope keeps its line.
    assert.match(
      result.stdout,
      /\[warning\] src\/sample\.ts size\.file-length - file too long/,
    );
    assert.match(
      result.stdout,
      /\[advisory\] src\/sample\.ts:3 naming\.short - too short/,
    );
    // The analyzer-owned suppression count is surfaced, not re-derived by the hook.
    assert.match(
      result.stdout,
      /suppressed 2 finding\(s\) outside the changed scope/,
    );
    assert.match(
      result.stdout,
      /For triage: consult \.goat-flow\/skill-docs\/playbooks\/gruff-code-quality\.md/,
    );
    // The hook drove the `hook` subcommand, not the legacy `analyse` path. Ranges are not
    // passed: the hook asks for the whole file and selects scopes itself, because
    // --changed-ranges makes the analyzer drop every file-scope finding (size, missing
    // overview, import cycle) and those would then never reach the agent.
    const hookArgs = readFileSync(join(root, "gruff-hook-args.log"), "utf-8");
    assert.match(hookArgs, /hook --format json src\/sample\.ts/);
    assert.doesNotMatch(hookArgs, /--changed-ranges/);
  });

  // Fixture purpose: mutates a committed file to cover the regression where --diff hid edited lines.
  it("does not append --diff to the contract call (single-pass new-only would hide changed-line findings)", () => {
    const root = makeRoot();
    initGit(root);
    writeContractGruffBinary(root);
    writeFileSync(join(root, ".gruff-ts.yaml"), "rules: {}\n");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "sample.ts"), "a\nb\nc\nd\n");
    git(root, ["add", "src/sample.ts", ".gruff-ts.yaml"]);
    git(root, [
      "-c",
      "user.email=t@test",
      "-c",
      "user.name=Test",
      "commit",
      "-m",
      "baseline",
      "--quiet",
    ]);
    writeFileSync(join(root, "src", "sample.ts"), "a\nb\nc\nd\ne\n");

    const result = runHook(
      root,
      {
        tool_name: "Edit",
        tool_input: {
          file_path: "src/sample.ts",
          changed_ranges: [{ startLine: 3, endLine: 3 }],
        },
      },
      "/usr/bin:/bin",
    );

    assert.equal(result.status, 0, result.stderr);
    const hookArgs = readFileSync(join(root, "gruff-hook-args.log"), "utf-8");
    assert.match(hookArgs, /hook --format json src\/sample\.ts/);
    // Single-pass --diff applies new-only to line/symbol too, suppressing
    // pre-existing findings on edited lines (confirmed across all five
    // analyzers). Re-enabling new-only file/project surfacing needs the
    // scope-specific combined mode tracked in M02, not a bare --diff append.
    assert.doesNotMatch(hookArgs, /--diff/);
  });

  // Fixture purpose: writes a B8 envelope mock to cover schemaOk:false config-error reports.
  it("relays a gruff.hook.v1 config error (B8) instead of swallowing schemaOk:false", () => {
    const root = makeRoot();
    writeContractGruffBinary(
      root,
      '{"contractVersion":"gruff.hook.v1","findings":[],"suppressed":{"count":0},"ignored":{"paths":[]},"config":{"schemaOk":false,"error":"missing schemaVersion; run gruff-ts init --force"}}',
    );
    writeFileSync(join(root, ".gruff-ts.yaml"), "rules: {}\n");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "sample.ts"), "a\nb\nc\nd\n");

    const result = runHook(
      root,
      {
        tool_name: "Edit",
        tool_input: {
          file_path: "src/sample.ts",
          changed_ranges: [{ startLine: 3, endLine: 3 }],
        },
      },
      "/usr/bin:/bin",
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /could not analyse src\/sample\.ts - missing schemaVersion; run gruff-ts init --force/,
    );
  });

  // Fixture purpose: writes a B7 envelope mock to cover ignored-file reports for the edited path.
  it("relays a gruff.hook.v1 ignore verdict (B7) for the edited file", () => {
    const root = makeRoot();
    writeContractGruffBinary(
      root,
      '{"contractVersion":"gruff.hook.v1","findings":[],"suppressed":{"count":0},"ignored":{"paths":[{"path":"src/sample.ts","source":"config","pattern":"src/**"}]},"config":{"schemaOk":true,"error":null}}',
    );
    writeFileSync(join(root, ".gruff-ts.yaml"), "rules: {}\n");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "sample.ts"), "a\nb\nc\nd\n");

    const result = runHook(
      root,
      {
        tool_name: "Edit",
        tool_input: {
          file_path: "src/sample.ts",
          changed_ranges: [{ startLine: 3, endLine: 3 }],
        },
      },
      "/usr/bin:/bin",
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /skipped gruff-ts src\/sample\.ts - ignored by config src\/\*\*; out of scope/,
    );
  });

  // Cross-analyzer hardening: the five gruff ports (Go/Rust/TS/PHP/Py) may emit
  // subtly different gruff.hook.v1 envelopes. The hook's contract reader matches
  // the legacy reader's tolerance so any conforming port renders identically.
  it("renders a gruff.hook.v1 finding that reports its location under `path` instead of `file`", () => {
    const root = makeRoot();
    writeContractGruffBinary(
      root,
      '{"contractVersion":"gruff.hook.v1","findings":[{"ruleId":"naming.short","severity":"advisory","scope":"line","path":"src/sample.ts","line":3,"message":"too short"}],"suppressed":{"count":0},"ignored":{"paths":[]},"config":{"schemaOk":true,"error":null}}',
    );
    writeFileSync(join(root, ".gruff-ts.yaml"), "rules: {}\n");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "sample.ts"), "a\nb\nc\nd\n");

    const result = runHook(
      root,
      {
        tool_name: "Edit",
        tool_input: {
          file_path: "src/sample.ts",
          changed_ranges: [{ startLine: 3, endLine: 3 }],
        },
      },
      "/usr/bin:/bin",
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /\[advisory\] src\/sample\.ts:3 naming\.short - too short/,
    );
  });

  // Fixture purpose: writes a config-error envelope mock to cover omitted optional findings.
  it("relays a gruff.hook.v1 config error even when the envelope omits the findings array", () => {
    const root = makeRoot();
    writeContractGruffBinary(
      root,
      '{"contractVersion":"gruff.hook.v1","config":{"schemaOk":false,"error":"missing schemaVersion; run gruff-ts init --force"}}',
    );
    writeFileSync(join(root, ".gruff-ts.yaml"), "rules: {}\n");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "sample.ts"), "a\nb\nc\nd\n");

    const result = runHook(
      root,
      {
        tool_name: "Edit",
        tool_input: {
          file_path: "src/sample.ts",
          changed_ranges: [{ startLine: 3, endLine: 3 }],
        },
      },
      "/usr/bin:/bin",
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /could not analyse src\/sample\.ts - missing schemaVersion; run gruff-ts init --force/,
    );
  });

  // Fixture purpose: writes an ignored-file envelope to cover analyzer-emitted ./ path prefixes.
  it("relays a gruff.hook.v1 ignore verdict when the analyzer echoes a ./-prefixed path", () => {
    const root = makeRoot();
    writeContractGruffBinary(
      root,
      '{"contractVersion":"gruff.hook.v1","findings":[],"suppressed":{"count":0},"ignored":{"paths":[{"path":"./src/sample.ts","source":"config","pattern":"src/**"}]},"config":{"schemaOk":true,"error":null}}',
    );
    writeFileSync(join(root, ".gruff-ts.yaml"), "rules: {}\n");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "sample.ts"), "a\nb\nc\nd\n");

    const result = runHook(
      root,
      {
        tool_name: "Edit",
        tool_input: {
          file_path: "src/sample.ts",
          changed_ranges: [{ startLine: 3, endLine: 3 }],
        },
      },
      "/usr/bin:/bin",
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /skipped gruff-ts src\/sample\.ts - ignored by config src\/\*\*; out of scope/,
    );
  });
});
