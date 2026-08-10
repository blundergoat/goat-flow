/**
 * Integration tests for the complete Gruff feedback path users rely on after edits.
 * Capability-aware analyzers produce explicit outcomes, Git selects attributable scope,
 * package-local configs select monorepo targets, and migrated results stay bounded for
 * provider adaptation. Legacy rendering remains covered while registration is gated by
 * separate live-provider evidence.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  CLEAN_GRUFF_CONTRACT_ENVELOPE,
  cleanupHookTestDirs,
  git,
  initGit,
  makeEditedGruffContractProject,
  makeRoot,
  readMigratedGruffResult,
  runHook,
  runMigratedHook,
  sampleGruffEditPayload,
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
    // pre-existing findings on edited lines. A future combined mode must keep
    // file/project visibility without hiding debt on the lines the user edited.
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

  // Users can reach patch handling through a native tool or a shell-wrapped apply_patch call.
  it("selects only files named by direct and command-content apply_patch payloads", () => {
    const patchText = [
      "*** Begin Patch",
      "*** Update File: src/sample.ts",
      "@@ -2,1 +2,1 @@",
      "-b",
      "+changed",
      "*** End Patch",
    ].join("\n");
    const payloads = [
      { tool_name: "apply_patch", tool_input: { patch: patchText } },
      {
        tool_name: "Bash",
        tool_input: { command: `apply_patch <<'PATCH'\n${patchText}\nPATCH` },
      },
    ];

    // Both user paths must analyze the patch target without falling back to unrelated dirty files.
    for (const payload of payloads) {
      const projectRoot = makeEditedGruffContractProject(
        CLEAN_GRUFF_CONTRACT_ENVELOPE,
      );
      mkdirSync(join(projectRoot, "other"), { recursive: true });
      writeFileSync(join(projectRoot, "other", "dirty.ts"), "dirty\n");
      const result = readMigratedGruffResult(
        runMigratedHook(projectRoot, payload, "/usr/bin:/bin"),
      );

      assert.equal(result.outcome, "pass");
      assert.equal(
        readFileSync(join(projectRoot, "gruff-hook-args.log"), "utf8"),
        "hook --format json src/sample.ts\n",
      );
    }
  });

  // The nearest package config is the explicit analyzer target a monorepo edit belongs to.
  it("runs a package-local analyzer from its nearest monorepo config root", () => {
    const projectRoot = makeRoot();
    const packageRoot = join(projectRoot, "app");
    writeContractGruffBinary(packageRoot, CLEAN_GRUFF_CONTRACT_ENVELOPE);
    writeFileSync(join(packageRoot, ".gruff-ts.yaml"), "rules: {}\n");
    mkdirSync(join(packageRoot, "src"), { recursive: true });
    writeFileSync(join(packageRoot, "src", "sample.ts"), "a\nb\nc\n");

    const result = readMigratedGruffResult(
      runMigratedHook(
        projectRoot,
        {
          tool_name: "Edit",
          tool_input: {
            file_path: "app/src/sample.ts",
            changed_ranges: [{ startLine: 3, endLine: 3 }],
          },
        },
        "/usr/bin:/bin",
      ),
    );

    assert.equal(result.outcome, "pass");
    assert.equal(
      readFileSync(join(packageRoot, "gruff-hook-args.log"), "utf8"),
      "hook --format json src/sample.ts\n",
    );
  });

  // Fixture purpose: proves helper bypass; Side effects: writes Git history, attributes, helpers, and an edit.
  it("derives Git ranges without invoking external diff or textconv helpers", () => {
    const projectRoot = makeEditedGruffContractProject(
      CLEAN_GRUFF_CONTRACT_ENVELOPE,
    );
    initGit(projectRoot);
    const helperMarkerPath = join(projectRoot, "external-helper-ran");
    const helperScriptPath = join(projectRoot, "external-helper.sh");
    writeFileSync(
      helperScriptPath,
      `#!/usr/bin/env bash\nprintf 'ran\\n' > '${helperMarkerPath}'\ncat "$1"\n`,
    );
    chmodSync(helperScriptPath, 0o755);
    writeFileSync(join(projectRoot, ".gitattributes"), "*.ts diff=fixture\n");
    git(projectRoot, ["config", "diff.external", helperScriptPath]);
    git(projectRoot, ["config", "diff.fixture.textconv", helperScriptPath]);
    git(projectRoot, [
      "add",
      ".gitattributes",
      ".gruff-ts.yaml",
      "src/sample.ts",
    ]);
    git(projectRoot, [
      "-c",
      "user.email=t@test",
      "-c",
      "user.name=Test",
      "commit",
      "-m",
      "baseline",
      "--quiet",
    ]);
    writeFileSync(join(projectRoot, "src", "sample.ts"), "a\nb\nchanged\nd\n");

    const result = readMigratedGruffResult(
      runMigratedHook(
        projectRoot,
        {
          tool_name: "Edit",
          tool_input: { file_path: "src/sample.ts" },
        },
        "/usr/bin:/bin",
      ),
    );

    assert.equal(result.outcome, "pass");
    assert.equal(existsSync(helperMarkerPath), false);
  });

  // A failed Git query means edit attribution is incomplete, never a clean analyzer result.
  it("reports Git diff failure and deletion-only scope explicitly", () => {
    const failedGitProjectRoot = makeEditedGruffContractProject(
      CLEAN_GRUFF_CONTRACT_ENVELOPE,
    );
    initGit(failedGitProjectRoot);
    git(failedGitProjectRoot, ["add", ".gruff-ts.yaml", "src/sample.ts"]);
    const failingGitBin = join(failedGitProjectRoot, "failing-git-bin");
    mkdirSync(failingGitBin);
    writeFileSync(
      join(failingGitBin, "git"),
      '#!/usr/bin/env bash\n# The user may have a failing Git hook or corrupt index while Gruff resolves scope.\nif [[ "$1" == "-C" && "$3" == "diff" ]]; then\n  printf "fixture git diff failed\\n" >&2\n  exit 7\nfi\nexec /usr/bin/git "$@"\n',
    );
    chmodSync(join(failingGitBin, "git"), 0o755);
    writeFileSync(
      join(failedGitProjectRoot, "src", "sample.ts"),
      "a\nb\nchanged\nd\n",
    );
    const failedGitResult = readMigratedGruffResult(
      runMigratedHook(
        failedGitProjectRoot,
        { tool_name: "Edit", tool_input: { file_path: "src/sample.ts" } },
        `${failingGitBin}:/usr/bin:/bin`,
      ),
    );
    assert.equal(failedGitResult.outcome, "incomplete");
    assert.equal(failedGitResult.reasonCode, "coverage-incomplete");
    assert.equal(
      (failedGitResult.findings as Array<{ code: string }>)[0]?.code,
      "git-scope-failed",
    );

    const deletionProjectRoot = makeEditedGruffContractProject(
      CLEAN_GRUFF_CONTRACT_ENVELOPE,
    );
    initGit(deletionProjectRoot);
    git(deletionProjectRoot, ["add", ".gruff-ts.yaml", "src/sample.ts"]);
    git(deletionProjectRoot, [
      "-c",
      "user.email=t@test",
      "-c",
      "user.name=Test",
      "commit",
      "-m",
      "baseline",
      "--quiet",
    ]);
    rmSync(join(deletionProjectRoot, "src", "sample.ts"));
    const deletionResult = readMigratedGruffResult(
      runMigratedHook(
        deletionProjectRoot,
        {
          tool_name: "apply_patch",
          tool_input: {
            patch:
              "*** Begin Patch\n*** Delete File: src/sample.ts\n*** End Patch",
          },
        },
        "/usr/bin:/bin",
      ),
    );
    assert.equal(deletionResult.outcome, "advisory");
    assert.equal(
      (deletionResult.findings as Array<{ code: string }>)[0]?.code,
      "analysis-not-applicable",
    );
  });

  // Rename-only and binary edits have no trustworthy positive source hunk to attribute.
  it("classifies rename-only and binary Git changes as not applicable", () => {
    const renameProjectRoot = makeEditedGruffContractProject(
      CLEAN_GRUFF_CONTRACT_ENVELOPE,
    );
    initGit(renameProjectRoot);
    git(renameProjectRoot, ["add", ".gruff-ts.yaml", "src/sample.ts"]);
    git(renameProjectRoot, [
      "-c",
      "user.email=t@test",
      "-c",
      "user.name=Test",
      "commit",
      "-m",
      "baseline",
      "--quiet",
    ]);
    git(renameProjectRoot, ["mv", "src/sample.ts", "src/renamed.ts"]);
    const renameResult = readMigratedGruffResult(
      runMigratedHook(
        renameProjectRoot,
        { tool_name: "Edit", tool_input: { file_path: "src/renamed.ts" } },
        "/usr/bin:/bin",
      ),
    );
    assert.equal(renameResult.outcome, "advisory");
    assert.equal(
      (renameResult.findings as Array<{ code: string }>)[0]?.code,
      "analysis-not-applicable",
    );

    const binaryProjectRoot = makeEditedGruffContractProject(
      CLEAN_GRUFF_CONTRACT_ENVELOPE,
    );
    initGit(binaryProjectRoot);
    git(binaryProjectRoot, ["add", ".gruff-ts.yaml", "src/sample.ts"]);
    git(binaryProjectRoot, [
      "-c",
      "user.email=t@test",
      "-c",
      "user.name=Test",
      "commit",
      "-m",
      "baseline",
      "--quiet",
    ]);
    writeFileSync(
      join(binaryProjectRoot, "src", "sample.ts"),
      Buffer.from([0, 1, 2, 3]),
    );
    const binaryResult = readMigratedGruffResult(
      runMigratedHook(
        binaryProjectRoot,
        { tool_name: "Edit", tool_input: { file_path: "src/sample.ts" } },
        "/usr/bin:/bin",
      ),
    );
    assert.equal(binaryResult.outcome, "advisory");
    assert.equal(
      (binaryResult.findings as Array<{ code: string }>)[0]?.code,
      "analysis-not-applicable",
    );
  });

  // Health is session-scoped and written only after one schema-valid analyzer exchange.
  it("deduplicates verified health while re-announcing malformed and reused session state", () => {
    const failedProjectRoot = makeEditedGruffContractProject("", {
      exitStatus: 7,
      standardError: "dependency crashed",
    });
    const failedResult = runMigratedHook(
      failedProjectRoot,
      sampleGruffEditPayload("failed-session"),
      "/usr/bin:/bin",
    );
    assert.equal(readMigratedGruffResult(failedResult).outcome, "unavailable");
    assert.doesNotMatch(failedResult.stderr, /verified analyzer exchange/u);
    assert.equal(
      existsSync(join(failedProjectRoot, ".goat-flow", "logs", "events")),
      false,
    );

    const projectRoot = makeEditedGruffContractProject(
      CLEAN_GRUFF_CONTRACT_ENVELOPE,
    );
    const firstResult = runMigratedHook(
      projectRoot,
      sampleGruffEditPayload("same-session"),
      "/usr/bin:/bin",
      { GRUFF_CODE_QUALITY_HEALTH_DAY: "2026-08-09" },
    );
    readMigratedGruffResult(firstResult);
    assert.match(firstResult.stderr, /verified analyzer exchange/u);
    const markerDirectoryPath = join(
      projectRoot,
      ".goat-flow",
      "logs",
      "events",
    );
    const firstMarkerNames = readdirSync(markerDirectoryPath).filter(
      (entryName) => entryName.startsWith(".gruff-hook-health."),
    );
    assert.equal(firstMarkerNames.length, 1);

    const repeatedResult = runMigratedHook(
      projectRoot,
      sampleGruffEditPayload("same-session"),
      "/usr/bin:/bin",
      { GRUFF_CODE_QUALITY_HEALTH_DAY: "2026-08-09" },
    );
    readMigratedGruffResult(repeatedResult);
    assert.doesNotMatch(repeatedResult.stderr, /verified analyzer exchange/u);

    writeFileSync(
      join(markerDirectoryPath, firstMarkerNames[0]),
      "malformed\n",
    );
    const malformedResult = runMigratedHook(
      projectRoot,
      sampleGruffEditPayload("same-session"),
      "/usr/bin:/bin",
      { GRUFF_CODE_QUALITY_HEALTH_DAY: "2026-08-09" },
    );
    readMigratedGruffResult(malformedResult);
    assert.match(malformedResult.stderr, /verified analyzer exchange/u);

    const reusedSessionResult = runMigratedHook(
      projectRoot,
      sampleGruffEditPayload("same-session"),
      "/usr/bin:/bin",
      { GRUFF_CODE_QUALITY_HEALTH_DAY: "2026-08-10" },
    );
    readMigratedGruffResult(reusedSessionResult);
    assert.match(reusedSessionResult.stderr, /verified analyzer exchange/u);
  });
});
