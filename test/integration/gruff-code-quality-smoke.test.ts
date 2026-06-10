/**
 * Integration smoke tests for the gruff-code-quality hook's changed-line filtering behavior.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const HOOK = join(PROJECT_ROOT, "workflow", "hooks", "gruff-code-quality.sh");
const disposables: string[] = [];

/** Resolve a tool's absolute path from PATH; throws when a required sandbox tool is missing. */
function resolveTool(name: string): string {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`required tool not found on PATH: ${name}`);
}

after(() => {
  for (const dir of disposables) rmSync(dir, { recursive: true, force: true });
});

/** Create a disposable git root for hook smoke-test isolation. */
function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "goat-flow-gruff-hook-"));
  disposables.push(root);
  return root;
}

/** Install the default mock gruff binary used by most hook scenarios. */
function writeMockGruff(root: string): string {
  return writeMockGruffBinary(root, "bin", "gruff-ts", "changed.rule");
}

function writeMockGruffBinary(
  root: string,
  relativeBinDir: string,
  binaryName: string,
  changedRuleId: string,
): string {
  const binDir = join(root, relativeBinDir);
  mkdirSync(binDir, { recursive: true });
  const bin = join(binDir, binaryName);
  writeFileSync(
    bin,
    `#!/usr/bin/env bash
if [[ "$1" == "analyse" && "$2" == "--help" ]]; then
  cat <<'HELP'
Usage: mock-gruff analyse [options] [paths...]
Options:
  --format <format>
  --fail-on <severity>
HELP
  exit 0
fi

if [[ "$1" == "hook" ]]; then
  echo "unknown command: hook" >&2
  exit 2
fi

file="\${@: -1}"
printf '%s\\n' "$file" >> "$PWD/gruff-invocations.log"
if [[ "$file" == "src/new-file.ts" ]]; then
  cat <<JSON
{"findings":[{"ruleId":"new.rule","message":"new file finding","filePath":"$file","line":2,"severity":"warning"}]}
JSON
  exit 1
fi

cat <<JSON
{"findings":[{"ruleId":"old.rule","message":"pre-existing finding","filePath":"$file","line":1,"severity":"advisory"},{"ruleId":"${changedRuleId}","message":"changed line finding","filePath":"$file","line":3,"severity":"warning"}]}
JSON
exit 1
`,
  );
  chmodSync(bin, 0o755);
  return binDir;
}

/** Spawns git with a deterministic PATH inside the disposable test repo. */
function git(root: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf-8",
    env: { ...process.env, PATH: "/usr/bin:/bin" },
  });
  assert.equal(result.status, 0, result.stderr);
}

/** Initialize the disposable repo without leaking command details into tests. */
function initGit(root: string): void {
  git(root, ["init", "--quiet"]);
}

/** Escape file names before embedding them in assertion regular expressions. */
function escapeRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function runHook(
  root: string,
  payload: unknown,
  pathPrefix: string,
  extraEnv: NodeJS.ProcessEnv = {},
): ReturnType<typeof spawnSync> {
  return spawnSync("bash", [HOOK], {
    cwd: root,
    input: JSON.stringify(payload),
    encoding: "utf-8",
    env: { ...process.env, ...extraEnv, PATH: pathPrefix },
  });
}

/**
 * Assert extension-based binary routing through the hook using real payloads.
 *
 * @param root - disposable git root containing mock gruff binaries
 * @param cases - file/rule pairs that prove each extension selects its analyzer
 */
function assertExtensionRoutesToExpectedGruff(
  root: string,
  cases: ReadonlyArray<{ file: string; expectedRule: string }>,
): void {
  cases.forEach(({ file, expectedRule }) => {
    const result = runHook(
      root,
      {
        tool_name: "Edit",
        tool_input: {
          file_path: file,
          changed_ranges: [{ startLine: 3, endLine: 3 }],
        },
      },
      "/usr/bin:/bin",
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      new RegExp(
        `\\[warning\\] ${escapeRegex(file)}:3 ${escapeRegex(expectedRule)} - changed line finding`,
      ),
    );
  });
}

/**
 * Assert unsupported hook payloads fail soft without surfacing analyzer output.
 *
 * @param root - disposable git root with the mock gruff binary installed
 * @param payloads - payload shapes that should be skipped by hook preflight
 */
function assertFailSoftSkipPayloadsSilent(
  root: string,
  payloads: ReadonlyArray<unknown>,
): void {
  payloads.forEach((payload) => {
    const result = runHook(root, payload, "/usr/bin:/bin");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
  });
}

/**
 * Install a mock gruff binary that rejects the project config the way a real
 * gruff does when `.gruff-*.yaml` lacks the required `schemaVersion:` line:
 * it prints a config error naming `schemaVersion` and `init --force` to stderr
 * and exits non-zero, emitting no JSON. Used to assert the hook relays gruff's
 * real reason instead of the generic "produced non-JSON output" note. Writes
 * an executable mock binary into the temp root.
 */
function writeSchemaErrorMockGruff(root: string): string {
  const binDir = join(root, "bin");
  mkdirSync(binDir, { recursive: true });
  const bin = join(binDir, "gruff-ts");
  writeFileSync(
    bin,
    `#!/usr/bin/env bash
if [[ "$1" == "analyse" && "$2" == "--help" ]]; then
  cat <<'HELP'
Usage: mock-gruff analyse [options] [paths...]
Options:
  --format <format>
  --fail-on <severity>
HELP
  exit 0
fi

cat >&2 <<'ERR'
gruff-ts: config error
  Config must include \`schemaVersion: gruff-ts.config.v0.1\` at the top.

Suggested fix:
  Run \`gruff-ts init --force\` to regenerate the config from current defaults.
ERR
exit 1
`,
  );
  chmodSync(bin, 0o755);
  return binDir;
}

/**
 * Install a legacy `analyse --format json` mock that exits non-zero with valid
 * JSON but no findings because the project config was rejected. Writes an
 * executable mock binary into the temp root.
 */
function writeJsonConfigErrorMockGruffPy(root: string): string {
  const binDir = join(root, ".venv", "bin");
  mkdirSync(binDir, { recursive: true });
  const bin = join(binDir, "gruff-py");
  writeFileSync(
    bin,
    `#!/usr/bin/env bash
if [[ "$1" == "analyse" && "$2" == "--help" ]]; then
  cat <<'HELP'
Usage: mock-gruff-py analyse [options] [paths...]
Options:
  --format <format>
  --fail-on <severity>
HELP
  exit 0
fi

cat <<'JSON'
{"findings":[],"diagnostics":[{"type":"config-error","message":"Unknown threshold size.file-length"}],"filesDiscovered":0}
JSON
exit 2
`,
  );
  chmodSync(bin, 0o755);
  return binDir;
}

/**
 * Install a gruff-py-shaped mock that advertises native changed-region flags.
 *
 * It returns a finding on line 8 while the payload edits line 9, matching
 * gruff-py's symbol-scope contract: the analyzer owns changed-region filtering
 * and can retain findings whose primary line sits outside the edited hunk.
 *
 * Side effect: creates `<root>/.venv/bin/` and writes an executable `gruff-py`
 * shim there (chmod 0o755) so the hook discovers it through normal binary resolution.
 *
 * @param root - temp project root the shim is installed under
 * @returns absolute path to the created `.venv/bin` directory
 */
function writeNativeChangedRegionGruffPy(root: string): string {
  const binDir = join(root, ".venv", "bin");
  mkdirSync(binDir, { recursive: true });
  const bin = join(binDir, "gruff-py");
  writeFileSync(
    bin,
    `#!/usr/bin/env bash
if [[ "$1" == "analyse" && "$2" == "--help" ]]; then
  cat <<'HELP'
Usage: mock-gruff-py analyse [options] [paths...]
Options:
  --format <format>
  --fail-on <severity>
  --changed-ranges <ranges>
  --changed-scope <scope>
  --no-baseline
HELP
  exit 0
fi

if [[ "$1" == "hook" ]]; then
  echo "unknown command: hook" >&2
  exit 2
fi

printf '%s\\n' "$*" >> "$PWD/gruff-args.log"
if [[ " $* " == *" --no-baseline "* && " $* " == *" --changed-ranges 9-9 "* && " $* " == *" --changed-scope symbol "* ]]; then
  cat <<JSON
{"findings":[{"ruleId":"security.shell-injection","message":"symbol-scoped finding","filePath":"src/sample.py","line":8,"severity":"error"}],"suppressedCount":2,"diff":{"suppressedCount":2}}
JSON
  exit 1
fi

cat <<JSON
{"findings":[{"ruleId":"security.shell-injection","message":"unscoped finding","filePath":"src/sample.py","line":8,"severity":"error"}]}
JSON
exit 1
`,
  );
  chmodSync(bin, 0o755);
  return binDir;
}

/**
 * Install a contract-aware mock that advertises gruff.hook.v1 from
 * `hook --capabilities` and emits a gruff.hook.v1 envelope from `hook --format
 * json`, so the test exercises the hook's thin-renderer contract path (not the
 * legacy analyse path). Logs the `hook` argv to gruff-hook-args.log.
 *
 * @param root - temp project root the shim is installed under
 * @returns absolute path to the created node_modules/.bin directory
 */
const DEFAULT_CONTRACT_ENVELOPE =
  '{"contractVersion":"gruff.hook.v1","findings":[{"ruleId":"size.file-length","pillar":"size","severity":"warning","scope":"file","file":"src/sample.ts","line":1,"message":"file too long","remediation":"split it"},{"ruleId":"naming.short","pillar":"naming","severity":"advisory","scope":"line","file":"src/sample.ts","line":3,"message":"too short"}],"suppressed":{"count":2},"ignored":{"paths":[]},"config":{"schemaOk":true,"error":null}}';

function writeContractGruffBinary(
  root: string,
  envelope: string = DEFAULT_CONTRACT_ENVELOPE,
): string {
  const binDir = join(root, "node_modules", ".bin");
  mkdirSync(binDir, { recursive: true });
  const bin = join(binDir, "gruff-ts");
  writeFileSync(
    bin,
    `#!/usr/bin/env bash
if [[ "$1" == "hook" && " $* " == *" --capabilities "* ]]; then
  cat <<'JSON'
{"contractVersion":"gruff.hook.v1","analyzer":{"name":"gruff-ts","version":"9.9.9"},"supports":{"changedRanges":true,"diff":true,"baseline":true,"scopeField":true,"metadata":true,"stableIdentity":true,"ignoreReport":true,"newOnly":true},"flags":{"changedRanges":"--changed-ranges","diff":"--diff","baseline":"--baseline"},"flagOrder":"any"}
JSON
  exit 0
fi
if [[ "$1" == "hook" ]]; then
  printf '%s\\n' "$*" >> "$PWD/gruff-hook-args.log"
  cat <<'JSON'
${envelope}
JSON
  exit 0
fi
exit 2
`,
  );
  chmodSync(bin, 0o755);
  return binDir;
}

/** Read the files passed to the mock gruff binary; missing invocation logs use an empty-list fallback. */
function readInvocations(root: string): string[] {
  try {
    const content = readFileSync(
      join(root, "gruff-invocations.log"),
      "utf-8",
    ).trim();
    return content.length > 0 ? content.split("\n") : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** Read the raw mock-gruff argument log; missing logs use an empty-list fallback. */
function readArgumentInvocations(root: string): string[] {
  try {
    const content = readFileSync(join(root, "gruff-args.log"), "utf-8").trim();
    return content.length > 0 ? content.split("\n") : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

describe("gruff-code-quality hook", () => {
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

  // Fixture purpose: mutates git state to prove unsupported payload paths stay
  // scoped to the edit instead of sweeping unrelated git-changed files.
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
    // The hook drove the `hook` subcommand, not the legacy `analyse` path.
    const hookArgs = readFileSync(join(root, "gruff-hook-args.log"), "utf-8");
    assert.match(
      hookArgs,
      /hook --format json --changed-ranges 3-3 src\/sample\.ts/,
    );
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
    assert.match(
      hookArgs,
      /hook --format json --changed-ranges 3-3 src\/sample\.ts/,
    );
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
