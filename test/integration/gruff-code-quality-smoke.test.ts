import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const HOOK = join(PROJECT_ROOT, "workflow", "hooks", "gruff-code-quality.sh");
const disposables: string[] = [];

after(() => {
  for (const dir of disposables) rmSync(dir, { recursive: true, force: true });
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "goat-flow-gruff-hook-"));
  disposables.push(root);
  return root;
}

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

function git(root: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf-8",
    env: { ...process.env, PATH: "/usr/bin:/bin" },
  });
  assert.equal(result.status, 0, result.stderr);
}

function initGit(root: string): void {
  git(root, ["init", "--quiet"]);
}

function escapeRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function runHook(
  root: string,
  payload: unknown,
  pathPrefix: string,
): ReturnType<typeof spawnSync> {
  return spawnSync("bash", [HOOK], {
    cwd: root,
    input: JSON.stringify(payload),
    encoding: "utf-8",
    env: { ...process.env, PATH: pathPrefix },
  });
}

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

describe("gruff-code-quality hook", () => {
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
      /For triage: consult \.goat-flow\/skill-playbooks\/gruff-code-quality\.md/,
    );
  });

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
      /For triage: consult \.goat-flow\/skill-playbooks\/gruff-code-quality\.md/,
    );
  });

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

  it("selects the gruff binary from the edited file extension", () => {
    const root = makeRoot();
    writeMockGruffBinary(root, "vendor/bin", "gruff-php", "php.rule");
    writeMockGruffBinary(root, "node_modules/.bin", "gruff-ts", "ts.rule");
    writeMockGruffBinary(
      root,
      "strands_agents/.venv/bin",
      "gruff-py",
      "py.rule",
    );
    writeFileSync(join(root, ".gruff-php.yaml"), "rules: {}\n");
    writeFileSync(join(root, ".gruff-ts.yaml"), "rules: {}\n");
    writeFileSync(join(root, ".gruff-py.yaml"), "rules: {}\n");
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, "assets"), { recursive: true });
    mkdirSync(join(root, "strands_agents"), { recursive: true });
    writeFileSync(join(root, "src", "example.php"), "<?php\n");
    writeFileSync(join(root, "assets", "example.ts"), "const value = 1;\n");
    writeFileSync(join(root, "strands_agents", "example.py"), "value = 1\n");

    const cases = [
      { file: "src/example.php", expectedRule: "php.rule" },
      { file: "assets/example.ts", expectedRule: "ts.rule" },
      { file: "strands_agents/example.py", expectedRule: "py.rule" },
    ];

    for (const { file, expectedRule } of cases) {
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
    }
  });

  it("exits silently for fail-soft skip cases", () => {
    const root = makeRoot();
    writeMockGruff(root);
    writeFileSync(join(root, ".gruff-ts.yaml"), "rules: {}\n");
    const cases = [
      { tool_name: "Read", tool_input: { file_path: "src/example.ts" } },
      { tool_name: "Edit", tool_input: { file_path: "README.md" } },
      { tool_name: "Edit", tool_input: { file_path: "node_modules/x.ts" } },
      { tool_name: "Edit", tool_input: { file_path: "../outside.ts" } },
    ];

    for (const payload of cases) {
      const result = runHook(root, payload, "/usr/bin:/bin");
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, "");
    }
  });

  it("exits silently when binary or project config is missing", () => {
    const root = makeRoot();
    const noBinary = runHook(
      root,
      { tool_name: "Edit", tool_input: { file_path: "src/example.ts" } },
      "/usr/bin:/bin",
    );
    assert.equal(noBinary.status, 0, noBinary.stderr);
    assert.equal(noBinary.stdout, "");

    writeMockGruff(root);
    const noConfig = runHook(
      root,
      { tool_name: "Edit", tool_input: { file_path: "src/example.ts" } },
      "/usr/bin:/bin",
    );
    assert.equal(noConfig.status, 0, noConfig.stderr);
    assert.equal(noConfig.stdout, "");
  });
});
