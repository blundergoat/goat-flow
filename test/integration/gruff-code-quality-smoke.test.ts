/**
 * Integration smoke tests for the gruff-code-quality hook's changed-line filtering
 * behavior on the legacy analyse path: payload/git range resolution, extension
 * routing, binary discovery limits, fail-soft skips, and config diagnostics.
 * gruff.hook.v1 contract rendering lives in gruff-code-quality-contract.test.ts;
 * shared fixtures live in gruff-code-quality-smoke.helpers.ts.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  assertExtensionRoutesToExpectedGruff,
  assertFailSoftSkipPayloadsSilent,
  cleanupHookTestDirs,
  git,
  initGit,
  makeRoot,
  readArgumentInvocations,
  readInvocations,
  resolveTool,
  runHook,
  writeJsonConfigErrorMockGruffPy,
  writeMockGruff,
  writeMockGruffBinary,
  writeNativeChangedRegionGruffPy,
  writeSchemaErrorMockGruff,
} from "./gruff-code-quality-smoke.helpers.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const GRUFF_HOOK_COPIES = [
  {
    label: "workflow",
    path: join(PROJECT_ROOT, "workflow", "hooks", "gruff-code-quality.sh"),
  },
  {
    label: "installed",
    path: join(PROJECT_ROOT, ".goat-flow", "hooks", "gruff-code-quality.sh"),
  },
] as const;

after(cleanupHookTestDirs);

/** Return true when a candidate jq binary exists and can be executed. */
function isExecutableFile(path: string): boolean {
  if (!existsSync(path)) return false;
  const result = spawnSync(path, ["--version"], { encoding: "utf-8" });
  return result.status === 0;
}

/** Locate the optional jq 1.6 binary used by the compatibility regression leg. */
function resolveJq16Binary(): { path: string | null; skipReason: string } {
  const fromEnv = process.env.GOAT_FLOW_JQ16_BIN;
  if (fromEnv !== undefined && fromEnv.trim() !== "") {
    if (!isExecutableFile(fromEnv)) {
      throw new Error(
        `GOAT_FLOW_JQ16_BIN is set but is not executable: ${fromEnv}`,
      );
    }
    return { path: fromEnv, skipReason: "" };
  }

  for (const candidate of ["/tmp/jq16/jq", "/tmp/jq16/jq-linux64"]) {
    if (isExecutableFile(candidate)) {
      return { path: candidate, skipReason: "" };
    }
  }

  return {
    path: null,
    skipReason:
      "jq 1.6 binary not found; set GOAT_FLOW_JQ16_BIN or download jq-1.6 to /tmp/jq16/jq",
  };
}

/** Run one hook copy's smoke self-test under a controlled PATH. */
function runHookSelfTest(
  hookPath: string,
  pathPrefix: string,
): ReturnType<typeof spawnSync> {
  return spawnSync("bash", [hookPath, "--self-test=smoke"], {
    cwd: makeRoot(),
    encoding: "utf-8",
    env: { ...process.env, PATH: pathPrefix },
  });
}

/** Assert one gruff hook self-test succeeds and prints the expected marker. */
function assertSelfTestOk(
  label: string,
  result: ReturnType<typeof spawnSync>,
): void {
  assert.equal(
    result.status,
    0,
    `${label} self-test failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.match(result.stdout, /gruff-code-quality self-test: ok/u);
}

describe("gruff-code-quality hook", () => {
  it("passes the smoke self-test for both hook copies with system jq", () => {
    for (const hook of GRUFF_HOOK_COPIES) {
      assertSelfTestOk(
        hook.label,
        runHookSelfTest(hook.path, process.env.PATH ?? "/usr/bin:/bin"),
      );
    }
  });

  const jq16 = resolveJq16Binary();
  it(
    "passes the smoke self-test for both hook copies with pinned jq 1.6",
    jq16.path === null ? { skip: jq16.skipReason } : {},
    () => {
      assert.ok(jq16.path, jq16.skipReason);
      const version = spawnSync(jq16.path, ["--version"], {
        encoding: "utf-8",
      });
      assert.equal(version.stdout.trim(), "jq-1.6");

      const pinnedBin = makeRoot();
      symlinkSync(jq16.path, join(pinnedBin, "jq"));
      const pathPrefix = `${pinnedBin}:${process.env.PATH ?? "/usr/bin:/bin"}`;

      for (const hook of GRUFF_HOOK_COPIES) {
        assertSelfTestOk(hook.label, runHookSelfTest(hook.path, pathPrefix));
      }
    },
  );

  // Fixture purpose: writes temp source/git state to cover changed-line filtering and the triage footer.
  it("prints changed-line findings, suppressed count, and footer", () => {
    const root = makeRoot();
    initGit(root);
    writeMockGruff(root);
    writeFileSync(join(root, ".gruff-ts.yaml"), "rules: {}\n");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(
      join(root, "src", "example.ts"),
      "const existingDebt = true;\nconst unchanged = 1;\nconst touched = 'before';\n",
    );
    git(root, ["add", "src/example.ts"]);
    writeFileSync(
      join(root, "src", "example.ts"),
      "const existingDebt = true;\nconst unchanged = 1;\nconst touched = 'after';\n",
    );

    const result = runHook(
      root,
      { tool_name: "Edit", tool_input: { file_path: "src/example.ts" } },
      "/usr/bin:/bin",
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /\[warning\] src\/example\.ts:3 changed\.rule - changed line finding/,
    );
    assert.doesNotMatch(result.stdout, /old\.rule/);
    assert.match(
      result.stdout,
      /gruff-code-quality: suppressed 1 pre-existing finding\(s\) outside changed lines/,
    );
    assert.match(
      result.stdout,
      /For triage: consult \.goat-flow\/skill-docs\/playbooks\/gruff-code-quality\.md/,
    );
  });

  // Fixture purpose: writes two dirty files to cover payload path precedence.
  it("runs only the named payload file when another supported file is dirty", () => {
    const root = makeRoot();
    initGit(root);
    writeMockGruff(root);
    writeFileSync(join(root, ".gruff-ts.yaml"), "rules: {}\n");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(
      join(root, "src", "example.ts"),
      "const existingDebt = true;\nconst unchanged = 1;\nconst touched = 'before';\n",
    );
    writeFileSync(
      join(root, "src", "other.ts"),
      "const otherDebt = true;\nconst otherUnchanged = 1;\nconst otherTouched = 'before';\n",
    );
    git(root, ["add", "src/example.ts", "src/other.ts"]);
    writeFileSync(
      join(root, "src", "example.ts"),
      "const existingDebt = true;\nconst unchanged = 1;\nconst touched = 'after';\n",
    );
    writeFileSync(
      join(root, "src", "other.ts"),
      "const otherDebt = true;\nconst otherUnchanged = 1;\nconst otherTouched = 'after';\n",
    );

    const result = runHook(
      root,
      { tool_name: "Edit", tool_input: { file_path: "src/example.ts" } },
      "/usr/bin:/bin",
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /\[warning\] src\/example\.ts:3 changed\.rule - changed line finding/,
    );
    assert.doesNotMatch(result.stdout, /src\/other\.ts/);
    assert.deepEqual(readInvocations(root), ["src/example.ts"]);
  });

  // Fixture purpose: writes/stages a dirty supported file to prove unsupported payload paths skip analysis.
  it("skips analysis when payload paths are unsupported even though supported files are dirty", () => {
    const root = makeRoot();
    initGit(root);
    writeMockGruff(root);
    writeFileSync(join(root, ".gruff-ts.yaml"), "rules: {}\n");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(
      join(root, "src", "fallback.ts"),
      "const existingDebt = true;\nconst unchanged = 1;\nconst touched = 'before';\n",
    );
    git(root, ["add", "src/fallback.ts"]);
    writeFileSync(
      join(root, "src", "fallback.ts"),
      "const existingDebt = true;\nconst unchanged = 1;\nconst touched = 'after';\n",
    );

    const result = runHook(
      root,
      { tool_name: "Edit", tool_input: { file_path: "package.json" } },
      "/usr/bin:/bin",
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.deepEqual(readInvocations(root), []);
  });

  it("treats new Write files as fully changed", () => {
    const root = makeRoot();
    initGit(root);
    writeMockGruff(root);
    writeFileSync(join(root, ".gruff-ts.yaml"), "rules: {}\n");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "new-file.ts"), "one\ntwo\n");

    const result = runHook(
      root,
      { tool_name: "Write", tool_input: { file_path: "src/new-file.ts" } },
      "/usr/bin:/bin",
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /\[warning\] src\/new-file\.ts:2 new\.rule - new file finding/,
    );
    assert.doesNotMatch(result.stdout, /suppressed/);
    assert.match(
      result.stdout,
      /For triage: consult \.goat-flow\/skill-docs\/playbooks\/gruff-code-quality\.md/,
    );
  });

  // Fixture purpose: writes fallback source to cover Antigravity payloads without file paths.
  it("runs for Antigravity file-tool payloads without a file path", () => {
    const root = makeRoot();
    initGit(root);
    writeMockGruff(root);
    writeFileSync(join(root, ".gruff-ts.yaml"), "rules: {}\n");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(
      join(root, "src", "example.ts"),
      "const existingDebt = true;\nconst unchanged = 1;\nconst touched = 'before';\n",
    );
    git(root, ["add", "src/example.ts"]);
    writeFileSync(
      join(root, "src", "example.ts"),
      "const existingDebt = true;\nconst unchanged = 1;\nconst touched = 'after';\n",
    );

    const result = runHook(
      root,
      {
        hookEventName: "PostToolUse",
        toolCall: { name: "replace_file_content", args: {} },
      },
      "/usr/bin:/bin",
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /\[warning\] src\/example\.ts:3 changed\.rule - changed line finding/,
    );
    assert.doesNotMatch(result.stdout, /old\.rule/);
  });

  // Fixture purpose: mutates staged git hunks to cover pathless fallback filtering.
  it("uses staged hunks for pathless fallback files", () => {
    const root = makeRoot();
    initGit(root);
    writeMockGruff(root);
    writeFileSync(join(root, ".gruff-ts.yaml"), "rules: {}\n");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(
      join(root, "src", "example.ts"),
      "const existingDebt = true;\nconst unchanged = 1;\nconst touched = 'before';\n",
    );
    git(root, ["add", "src/example.ts"]);
    writeFileSync(
      join(root, "src", "example.ts"),
      "const existingDebt = true;\nconst unchanged = 1;\nconst touched = 'after';\n",
    );
    git(root, ["add", "src/example.ts"]);

    const result = runHook(
      root,
      {
        hookEventName: "PostToolUse",
        toolCall: { name: "replace_file_content", args: {} },
      },
      "/usr/bin:/bin",
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /\[warning\] src\/example\.ts:3 changed\.rule - changed line finding/,
    );
    assert.doesNotMatch(result.stdout, /no changed lines detected/);
  });

  // Fixture purpose: writes unchanged git state to cover the no-range fallback branch.
  it("does not print whole-file findings when no changed range is available", () => {
    const root = makeRoot();
    initGit(root);
    writeMockGruff(root);
    writeFileSync(join(root, ".gruff-ts.yaml"), "rules: {}\n");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(
      join(root, "src", "example.ts"),
      "const existingDebt = true;\nconst unchanged = 1;\nconst touched = 'before';\n",
    );
    git(root, ["add", "src/example.ts"]);

    const result = runHook(
      root,
      { tool_name: "Edit", tool_input: { file_path: "src/example.ts" } },
      "/usr/bin:/bin",
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.match(
      result.stderr,
      /gruff-code-quality: no changed lines detected for src\/example\.ts; skipping gruff output/,
    );
  });

  // Fixture writes two gruff binaries because extension routing must select PHP when TS is also available.
  it("selects the gruff binary from the edited file extension", () => {
    const root = makeRoot();
    // Fixture installs multiple language binaries so extension routing proves it
    // chooses gruff-php for .php even when gruff-ts is also available.
    writeMockGruffBinary(root, "vendor/bin", "gruff-php", "php.rule");
    writeMockGruffBinary(root, "node_modules/.bin", "gruff-ts", "ts.rule");
    writeMockGruffBinary(root, ".venv/bin", "gruff-py", "py.rule");
    writeFileSync(join(root, ".gruff-php.yaml"), "rules: {}\n");
    writeFileSync(join(root, ".gruff-ts.yaml"), "rules: {}\n");
    writeFileSync(join(root, ".gruff-py.yaml"), "rules: {}\n");
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, "assets"), { recursive: true });
    mkdirSync(join(root, "strands_agents"), { recursive: true });
    writeFileSync(join(root, "src", "example.php"), "<?php\n");
    writeFileSync(join(root, "assets", "example.ts"), "const value = 1;\n");
    writeFileSync(join(root, "strands_agents", "example.py"), "value = 1\n");

    assertExtensionRoutesToExpectedGruff(root, [
      { file: "src/example.php", expectedRule: "php.rule" },
      { file: "assets/example.ts", expectedRule: "ts.rule" },
      { file: "strands_agents/example.py", expectedRule: "py.rule" },
    ]);
  });

  // Fixture purpose: writes a Python fixture to cover gruff-py's changed-region contract.
  it("uses gruff-py native changed-region filtering when available", () => {
    const root = makeRoot();
    writeNativeChangedRegionGruffPy(root);
    writeFileSync(join(root, ".gruff-py.yaml"), "rules: {}\n");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(
      join(root, "src", "sample.py"),
      '"""Module."""\nimport subprocess\n\n\ndef changed():\n    command = "ls"\n    subprocess.run(command, shell=True)\n    return 1\n    # touched by agent\n',
    );

    const result = runHook(
      root,
      {
        tool_name: "Edit",
        tool_input: {
          file_path: "src/sample.py",
          changed_ranges: [{ startLine: 9, endLine: 9 }],
        },
      },
      "/usr/bin:/bin",
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /\[error\] src\/sample\.py:8 security\.shell-injection - symbol-scoped finding/,
    );
    assert.match(
      result.stdout,
      /gruff-code-quality: suppressed 2 pre-existing finding\(s\) outside changed lines/,
    );
    assert.match(
      result.stdout,
      /For triage: consult \.goat-flow\/skill-docs\/playbooks\/gruff-code-quality\.md/,
    );
    assert.deepEqual(readArgumentInvocations(root), [
      "analyse --format json --fail-on none --no-baseline --changed-ranges 9-9 --changed-scope symbol src/sample.py",
    ]);
  });

  // Fixture purpose: writes two planted binaries because both removed paths must stay unsearched.
  it("does not discover binaries from the removed glob or build-output paths", () => {
    const root = makeRoot();
    // Security (ADR-032): a name-matched binary planted only on a removed path -
    // the `*/.venv/bin` glob or the `target/debug` build-output dir - must not be
    // discovered or executed. This is the inverse of the extension-routing test
    // above: same Edit + changed-range-at-line-3 scenario, but the binary lives
    // only on a removed path, so a surfaced finding (or any invocation) would
    // mean it was wrongly run. Silence + an empty invocation log proves the path
    // is no longer searched. Pre-change, this binary was discovered and executed.
    writeMockGruffBinary(root, "nested/.venv/bin", "gruff-ts", "glob.rule");
    writeMockGruffBinary(root, "target/debug", "gruff-py", "debug.rule");
    writeFileSync(join(root, ".gruff-ts.yaml"), "rules: {}\n");
    writeFileSync(join(root, ".gruff-py.yaml"), "rules: {}\n");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "example.ts"), "a\nb\nc\n");
    writeFileSync(join(root, "src", "example.py"), "a\nb\nc\n");

    const tsResult = runHook(
      root,
      {
        tool_name: "Edit",
        tool_input: {
          file_path: "src/example.ts",
          changed_ranges: [{ startLine: 3, endLine: 3 }],
        },
      },
      "/usr/bin:/bin",
    );
    assert.equal(tsResult.status, 0, tsResult.stderr);
    assert.equal(tsResult.stdout, "", "expected silence for src/example.ts");
    assert.match(
      tsResult.stderr,
      /present but gruff-(ts|py) not found on search paths/,
    );

    const pyResult = runHook(
      root,
      {
        tool_name: "Edit",
        tool_input: {
          file_path: "src/example.py",
          changed_ranges: [{ startLine: 3, endLine: 3 }],
        },
      },
      "/usr/bin:/bin",
    );
    assert.equal(pyResult.status, 0, pyResult.stderr);
    assert.equal(pyResult.stdout, "", "expected silence for src/example.py");
    assert.match(
      pyResult.stderr,
      /present but gruff-(ts|py) not found on search paths/,
    );

    assert.deepEqual(readInvocations(root), []);
  });

  // Fixture purpose: writes an override binary to cover non-standard monorepo analyzer paths.
  it("uses an explicit env override for a non-standard monorepo gruff binary", () => {
    const root = makeRoot();
    const overrideBinDir = writeMockGruffBinary(
      root,
      "strands_agents/.venv/bin",
      "gruff-py",
      "override.rule",
    );
    writeFileSync(join(root, ".gruff-py.yaml"), "rules: {}\n");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "sample.py"), "a\nb\nc\n");

    const result = runHook(
      root,
      {
        tool_name: "Edit",
        tool_input: {
          file_path: "src/sample.py",
          changed_ranges: [{ startLine: 3, endLine: 3 }],
        },
      },
      "/usr/bin:/bin",
      { GRUFF_PY_BIN: join(overrideBinDir, "gruff-py") },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /\[warning\] src\/sample\.py:3 override\.rule - changed line finding/,
    );
    assert.deepEqual(readInvocations(root), ["src/sample.py"]);
  });

  it("exits silently for fail-soft skip cases", () => {
    const root = makeRoot();
    writeMockGruff(root);
    writeFileSync(join(root, ".gruff-ts.yaml"), "rules: {}\n");
    assertFailSoftSkipPayloadsSilent(root, [
      { tool_name: "Read", tool_input: { file_path: "src/example.ts" } },
      { tool_name: "Edit", tool_input: { file_path: "README.md" } },
      { tool_name: "Edit", tool_input: { file_path: "node_modules/x.ts" } },
      { tool_name: "Edit", tool_input: { file_path: "../outside.ts" } },
    ]);
  });

  it("exits silently when project config is missing and diagnoses configured languages without a binary", () => {
    const root = makeRoot();
    const noBinary = runHook(
      root,
      { tool_name: "Edit", tool_input: { file_path: "src/example.ts" } },
      "/usr/bin:/bin",
    );
    assert.equal(noBinary.status, 0, noBinary.stderr);
    assert.equal(noBinary.stdout, "");

    writeFileSync(join(root, ".gruff-ts.yaml"), "rules: {}\n");
    const configButNoBinary = runHook(
      root,
      { tool_name: "Edit", tool_input: { file_path: "src/example.ts" } },
      "/usr/bin:/bin",
    );
    assert.equal(configButNoBinary.status, 0, configButNoBinary.stdout);
    assert.match(
      configButNoBinary.stderr,
      /gruff-code-quality: \.gruff-ts\.yaml present but gruff-ts not found on search paths/,
    );
    assert.match(configButNoBinary.stderr, /GRUFF_TS_BIN/);
    rmSync(join(root, ".gruff-ts.yaml"));

    writeMockGruff(root);
    const noConfig = runHook(
      root,
      { tool_name: "Edit", tool_input: { file_path: "src/example.ts" } },
      "/usr/bin:/bin",
    );
    assert.equal(noConfig.status, 0, noConfig.stderr);
    assert.equal(noConfig.stdout, "");
  });

  // Fixture purpose: writes a PATH sandbox to cover fail-soft behavior when jq is absent.
  it("fails soft when jq is unavailable", () => {
    const root = makeRoot();
    const gruffBinDir = writeMockGruff(root);
    const noJqBin = join(root, "no-jq-bin");
    mkdirSync(noJqBin, { recursive: true });
    symlinkSync(resolveTool("bash"), join(noJqBin, "bash"));
    symlinkSync(resolveTool("cat"), join(noJqBin, "cat"));
    symlinkSync(resolveTool("awk"), join(noJqBin, "awk"));
    writeFileSync(join(root, ".gruff-ts.yaml"), "rules: {}\n");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "example.ts"), "one\ntwo\nthree\n");

    const result = runHook(
      root,
      { tool_name: "Edit", tool_input: { file_path: "src/example.ts" } },
      `${gruffBinDir}:${noJqBin}`,
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.match(
      result.stderr,
      /gruff-code-quality: jq unavailable; changed-line filtering skipped/,
    );
  });

  it("fails soft when a supported payload path does not exist", () => {
    const root = makeRoot();
    initGit(root);
    writeMockGruff(root);
    writeFileSync(join(root, ".gruff-ts.yaml"), "rules: {}\n");

    const result = runHook(
      root,
      { tool_name: "Edit", tool_input: { file_path: "src/missing.ts" } },
      "/usr/bin:/bin",
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.match(
      result.stderr,
      /gruff-code-quality: no changed lines detected for src\/missing\.ts; skipping gruff output/,
    );
  });

  // Fixture purpose: writes invalid gruff config to cover reported schema rejection output.
  it("relays gruff config-schema rejection with an actionable message", () => {
    const root = makeRoot();
    initGit(root);
    writeSchemaErrorMockGruff(root);
    // Config without schemaVersion: real gruff rejects it and exits non-zero.
    writeFileSync(
      join(root, ".gruff-ts.yaml"),
      "paths:\n  ignore:\n    - 'dist/**'\n",
    );
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(
      join(root, "src", "example.ts"),
      "const existingDebt = true;\nconst unchanged = 1;\nconst touched = 'before';\n",
    );
    git(root, ["add", "src/example.ts"]);
    writeFileSync(
      join(root, "src", "example.ts"),
      "const existingDebt = true;\nconst unchanged = 1;\nconst touched = 'after';\n",
    );

    const result = runHook(
      root,
      { tool_name: "Edit", tool_input: { file_path: "src/example.ts" } },
      "/usr/bin:/bin",
    );

    assert.equal(result.status, 0, result.stderr);
    // The agent sees gruff's real cause and fix on stdout, not the generic note.
    assert.match(result.stdout, /schemaVersion/);
    assert.match(result.stdout, /gruff-ts init --force/);
    assert.match(result.stdout, /\.gruff-ts\.yaml/);
    assert.doesNotMatch(result.stdout, /produced non-JSON output/);
  });

  // Fixture purpose: writes legacy JSON diagnostics to cover config errors without findings.
  it("surfaces legacy JSON config diagnostics with empty findings", () => {
    const root = makeRoot();
    writeJsonConfigErrorMockGruffPy(root);
    writeFileSync(join(root, ".gruff-py.yaml"), "rules: {}\n");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "sample.py"), "a\nb\nc\n");

    const result = runHook(
      root,
      {
        tool_name: "Edit",
        tool_input: {
          file_path: "src/sample.py",
          changed_ranges: [{ startLine: 3, endLine: 3 }],
        },
      },
      "/usr/bin:/bin",
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /gruff-code-quality: gruff-py could not analyse src\/sample\.py - Unknown threshold size\.file-length/,
    );
    assert.doesNotMatch(result.stdout, /0 on changed lines/);
  });
});
