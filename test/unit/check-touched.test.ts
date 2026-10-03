/**
 * Protects `npm run check:touched`, the contributor's fast check of changed working-tree files.
 *
 * Real Git worktrees prove which checks each changed, deleted or renamed path selects, and that no check rewrites a file.
 * Unicode cases cover rejected invisible controls, valid joining characters and bounded diagnostics.
 */
import assert from "node:assert/strict";
import childProcess, {
  spawnSync,
  type SpawnSyncReturns,
} from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { createHash } from "node:crypto";
import {
  existsSync,
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { it, type TestContext } from "node:test";
import {
  collectChangedPaths,
  parseNameStatus,
  scanUnicodeFiles,
  selectChecks,
} from "../../scripts/check-touched.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const script = join(repo, "scripts/check-touched.mjs");

/** Create a private temporary filesystem folder that the test removes when it finishes. */
function directory(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "goat-check-touched-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

/** Writes one fixture file, creating its parent folders first. */
function put(root: string, path: string, bytes: string | Buffer): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), bytes);
}

/** Keep completed EPERM metadata separate from a failed launch or interrupted child. */
function assertCompleted(result: SpawnSyncReturns<string>): void {
  assert.notEqual(result.status, null, result.error?.message);
  assert.equal(result.signal, null);
  assert.ok(
    !result.error || ("code" in result.error && result.error.code === "EPERM"),
    result.error?.message,
  );
}

/** Spawns Git in the fixture and returns its stdout; an incomplete or failed run fails the test. */
function git(root: string, ...args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  assertCompleted(result);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

/**
 * Writes a disposable clone and dependency link, with its own Git exclusion and index.
 * Test cleanup removes only this temporary tree; the real checkout stays untouched.
 */
function checkout(t: TestContext): string {
  const root = directory(t);
  git(repo, "clone", "--shared", "--quiet", repo, root);
  // A dependency symlink is not matched by Git's directory-only ignore rule.
  const exclude = join(root, ".git/info/exclude");
  writeFileSync(exclude, readFileSync(exclude, "utf8") + "\n/node_modules\n");
  symlinkSync(
    join(repo, "node_modules"),
    join(root, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  return root;
}

/** Spawns the CLI and captures its actual bytes outside the fixture; managed stdout pipes can return empty output. */
function runCheckTouched(
  root: string,
  args: string[] = [],
  environment = process.env,
) {
  const outputRoot = mkdtempSync(join(tmpdir(), "goat-touched-output-"));
  const stdoutPath = join(outputRoot, "stdout");
  const stderrPath = join(outputRoot, "stderr");
  const descriptors: number[] = [];
  try {
    descriptors.push(openSync(stdoutPath, "wx", 0o600));
    descriptors.push(openSync(stderrPath, "wx", 0o600));
    const result = spawnSync(process.execPath, [script, ...args], {
      cwd: root,
      env: environment,
      encoding: "utf8",
      stdio: ["pipe", descriptors[0], descriptors[1]],
      timeout: 120_000,
    });
    assertCompleted(result);
    return {
      status: result.status,
      output:
        readFileSync(stdoutPath, "utf8") + readFileSync(stderrPath, "utf8"),
    };
  } finally {
    for (const descriptor of descriptors) closeSync(descriptor);
    rmSync(outputRoot, { recursive: true, force: true });
  }
}

/** Include deleted paths and all untracked fixture bytes in the no-write proof, in a stable sorted order. */
function snapshot(root: string) {
  return git(
    root,
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
  )
    .split("\0")
    .filter(Boolean)
    .sort()
    .map((path) => [
      path,
      existsSync(join(root, path))
        ? createHash("sha256")
            .update(readFileSync(join(root, path)))
            .digest("hex")
        : null,
    ]);
}

it("parses NUL records, preserving both rename/copy paths and filename whitespace", () => {
  assert.deepEqual(
    parseNameStatus(
      "R100\0src/old name.ts\0notes/new\nname.txt\0C095\0one\0two\0D\0gone\0",
    ),
    [
      { status: "R100", paths: ["src/old name.ts", "notes/new\nname.txt"] },
      { status: "C095", paths: ["one", "two"] },
      { status: "D", paths: ["gone"] },
    ],
  );
  assert.deepEqual(parseNameStatus(""), []);
});

it("rejects incomplete change inventories instead of reporting a clean tree", () => {
  for (const text of [
    "D\0gone",
    "R100\0old\0",
    "M\0\0",
    "unexpected\0path\0",
  ]) {
    assert.throws(() => parseNameStatus(text));
  }
});

// Each case pairs an exit status, signal and error code with whether the inventory must accept it; the mocked Git writes its captures.
it("accepts completed Git output with EPERM metadata while rejecting failed or incomplete processes", (t) => {
  const cases = [
    { status: 0, signal: null, code: undefined, accepted: true },
    { status: 0, signal: null, code: "EPERM", accepted: true },
    { status: 1, signal: null, code: "EPERM", accepted: false },
    { status: null, signal: null, code: "EPERM", accepted: false },
    { status: 0, signal: "SIGTERM", code: "EPERM", accepted: false },
    { status: 0, signal: null, code: "ENOBUFS", accepted: false },
    { status: 0, signal: null, code: "ETIMEDOUT", accepted: false },
    { status: null, signal: null, code: "ENOENT", accepted: false },
  ];
  try {
    for (const scenario of cases) {
      t.mock.method(childProcess, "spawnSync", (_command, args, options) => {
        writeFileSync(
          options.stdio[1],
          args[0] === "diff" ? "M\0README.md\0" : "",
        );
        writeFileSync(
          options.stdio[2],
          scenario.status === 1 ? "Git read failed" : "",
        );
        return {
          status: scenario.status,
          signal: scenario.signal,
          error: scenario.code
            ? Object.assign(new Error(scenario.code), { code: scenario.code })
            : undefined,
          stdout: Buffer.from(args[0] === "diff" ? "M\0README.md\0" : ""),
          stderr: Buffer.from(scenario.status === 1 ? "Git read failed" : ""),
        };
      });
      syncBuiltinESMExports();
      if (scenario.accepted) {
        assert.deepEqual(
          collectChangedPaths(repo),
          [{ status: "M", paths: ["README.md"] }],
          `accepted scenario ${JSON.stringify(scenario)}`,
        );
      } else {
        assert.throws(
          () => collectChangedPaths(repo),
          /Git diff failed/,
          `rejected scenario ${JSON.stringify(scenario)}`,
        );
      }
      t.mock.restoreAll();
    }
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

it("preserves real Git inventory when completed EPERM results lose pipe output", (t) => {
  const root = checkout(t);
  put(
    root,
    "README.md",
    readFileSync(join(root, "README.md"), "utf8") + "\nInventory regression.\n",
  );
  put(root, "untracked note.txt", "untracked\n");
  const expected = collectChangedPaths(root);
  assert.equal(expected.length, 2);
  const realSpawn = childProcess.spawnSync;
  t.mock.method(childProcess, "spawnSync", (command, args, options) => {
    const result = realSpawn(command, args, options);
    assert.equal(result.status, 0, result.error?.message);
    return {
      ...result,
      error: Object.assign(new Error("completed transport fault"), {
        code: "EPERM",
      }),
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
    };
  });
  syncBuiltinESMExports();
  try {
    assert.deepEqual(collectChangedPaths(root), expected);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

// The mocked Git writes a partial, empty-path or non-UTF-8 untracked listing; collection must throw instead of returning a short inventory.
it("rejects incomplete or non-UTF-8 untracked inventories", (t) => {
  try {
    for (const output of [
      Buffer.from("partial"),
      Buffer.from("one\0\0"),
      Buffer.from([0xff, 0]),
    ]) {
      t.mock.method(childProcess, "spawnSync", (_command, args, options) => {
        writeFileSync(
          options.stdio[1],
          args[0] === "ls-files" ? output : Buffer.alloc(0),
        );
        return { status: 0, signal: null };
      });
      syncBuiltinESMExports();
      assert.throws(() => collectChangedPaths(repo));
      t.mock.restoreAll();
    }
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

it("collects staged renames/deletions, unstaged edits and untracked paths from real Git", (t) => {
  const root = checkout(t);
  renameSync(
    join(root, "src/cli/constants.ts"),
    join(root, "renamed constants.txt"),
  );
  unlinkSync(join(root, "tsconfig.dashboard.json"));
  git(
    root,
    "add",
    "--",
    "src/cli/constants.ts",
    "renamed constants.txt",
    "tsconfig.dashboard.json",
  );
  put(
    root,
    "README.md",
    readFileSync(join(root, "README.md"), "utf8") + "\nWorking tree edit.\n",
  );
  const unusual = "notes with spaces.txt";
  put(root, unusual, "untracked\n");
  const changes = collectChangedPaths(root);
  assert.ok(
    changes.some(
      (change) =>
        change.status === "R100" &&
        change.paths.join("|") === "src/cli/constants.ts|renamed constants.txt",
    ),
  );
  assert.ok(
    changes.some(
      (change) =>
        change.status === "D" && change.paths[0] === "tsconfig.dashboard.json",
    ),
  );
  assert.ok(
    changes.some(
      (change) => change.status === "M" && change.paths[0] === "README.md",
    ),
  );
  assert.ok(
    changes.some(
      (change) => change.status === "?" && change.paths[0] === unusual,
    ),
  );
  assert.equal(selectChecks(root, changes).typecheck, true);
});

it("keeps source, configuration and guidance triggers for deletions and renames away", (t) => {
  const root = directory(t);
  const cases = [
    ["src/cli/gone.ts", true, true, false],
    ["src/dashboard/gone.ts", true, true, false],
    ["tsconfig.json", true, false, false],
    ["tsconfig.dashboard.json", true, false, false],
    ["package.json", true, false, false],
    ["package-lock.json", true, false, false],
    ["AGENTS.md", false, false, true],
    ["CLAUDE.md", false, false, true],
    [".github/copilot-instructions.md", false, false, true],
    ["workflow/skills/gone/SKILL.md", false, false, true],
    ["workflow/setup/gone.md", false, false, true],
    ["workflow/evaluation/footguns.md", false, false, true],
    [".goat-flow/skill-docs/gone.md", false, false, true],
    [".goat-flow/learning-loop/lessons/gone.md", false, false, true],
    [".agents/skills/gone/SKILL.md", false, false, true],
    [".claude/skills/gone/SKILL.md", false, false, true],
    [".github/skills/gone/SKILL.md", false, false, true],
  ] as const;
  put(root, "moved.txt", "remaining content\n");
  for (const [path, typecheck, gruff, guidance] of cases) {
    for (const status of ["D", "R100"]) {
      const selected = selectChecks(root, [
        { status, paths: status === "D" ? [path] : [path, "moved.txt"] },
      ]);
      assert.deepEqual(
        [selected.typecheck, selected.gruff, selected.guidance],
        [typecheck, gruff, guidance],
        `${status} ${path}`,
      );
      assert.deepEqual(selected.prettier, []);
      assert.deepEqual(selected.eslint, []);
      assert.deepEqual(selected.unicode, status === "D" ? [] : ["moved.txt"]);
    }
  }
});

it("admits only existing files in each tool's owned paths and deduplicates rename endpoints", (t) => {
  const root = directory(t);
  const paths = [
    "src/cli/live.ts",
    "src/dashboard/live.ts",
    "src/asset.html",
    "test/live.test.ts",
    "scripts/live.mjs",
    "README.md",
    "src/gone.ts",
  ];
  for (const path of paths.slice(0, -1)) put(root, path, "text\n");
  const selected = selectChecks(root, [
    ...paths.map((path) => ({ status: "M", paths: [path] })),
    { status: "R100", paths: ["src/gone.ts", "src/cli/live.ts"] },
  ]);
  assert.equal(selected.paths.length, paths.length);
  assert.deepEqual(selected.prettier, [
    "scripts/live.mjs",
    "src/asset.html",
    "src/cli/live.ts",
    "src/dashboard/live.ts",
    "test/live.test.ts",
  ]);
  assert.deepEqual(selected.eslint, [
    "src/cli/live.ts",
    "src/dashboard/live.ts",
  ]);
  assert.equal(selected.unicode.includes("src/gone.ts"), false);
  const testOnly = selectChecks(root, [
    { status: "M", paths: ["test/live.test.ts"] },
  ]);
  assert.deepEqual(
    [testOnly.typecheck, testOnly.gruff, testOnly.guidance, testOnly.eslint],
    [false, false, false, []],
  );
});

it("excludes generated indexes, lockfiles, vendor and scratch bytes from Unicode scans", (t) => {
  const root = directory(t);
  const paths = [
    "dist/output.js",
    "node_modules/pkg/a.js",
    ".goat-flow/plans/note.md",
    ".goat-flow/learning-loop/lessons/INDEX.md",
    "package-lock.json",
    "workflow/hooks/vendor/parser.js",
    "workflow/hooks/agent-config/managed-hook-desired-state.json",
  ];
  for (const path of paths) put(root, path, String.fromCodePoint(0x202e));
  const selected = selectChecks(
    root,
    paths.map((path) => ({ status: "M", paths: [path] })),
  );
  assert.deepEqual(selected.unicode, []);
  assert.equal(selected.typecheck, true);
  assert.equal(selected.guidance, true);
});

it("detects every forbidden literal code point and reports Unicode positions", (t) => {
  const root = directory(t);
  const points = [
    0x061c, 0x200b, 0x200e, 0x200f, 0x2028, 0x2029, 0x202a, 0x202b, 0x202c,
    0x202d, 0x202e, 0x2060, 0x2066, 0x2067, 0x2068, 0x2069, 0xfeff,
  ];
  const bytes = Buffer.from(
    "😀\n" +
      points.map((point) => "x" + String.fromCodePoint(point)).join("\n"),
  );
  put(root, "controls.txt", bytes);
  const result = scanUnicodeFiles(root, ["controls.txt"]);
  assert.equal(result.count, points.length);
  assert.deepEqual(
    result.diagnostics.map((item) => [item.line, item.column, item.codePoint]),
    points.map((point, index) => [
      index + 2,
      2,
      `U+${point.toString(16).toUpperCase().padStart(4, "0")}`,
    ]),
  );
  assert.deepEqual(readFileSync(join(root, "controls.txt")), bytes);
});

it("preserves leading BOM, legitimate joining characters, emoji and escaped text", (t) => {
  const root = directory(t);
  const text =
    String.fromCodePoint(0xfeff) +
    "café 日本語 😀" +
    String.fromCodePoint(0x200c, 0x200d) +
    String.raw`\u202e \u{2028} \u200b`;
  put(root, "valid.txt", text);
  assert.deepEqual(scanUnicodeFiles(root, ["valid.txt"]), {
    count: 0,
    scanned: 1,
    diagnostics: [],
  });
  assert.equal(readFileSync(join(root, "valid.txt"), "utf8"), text);
});

it("skips binary and generated bytes while bounding diagnostics without hiding the count", (t) => {
  const root = directory(t);
  put(root, "nul.bin", Buffer.from([0, 0xe2, 0x80, 0xae]));
  put(root, "invalid.bin", Buffer.from([0xff, 0xfe]));
  put(
    root,
    "generated.js",
    "// @generated by tool\n" + String.fromCodePoint(0x202e),
  );
  put(root, "many.txt", String.fromCodePoint(0x202e).repeat(25));
  const result = scanUnicodeFiles(root, [
    "nul.bin",
    "invalid.bin",
    "generated.js",
    "many.txt",
  ]);
  assert.equal(result.scanned, 1);
  assert.equal(result.count, 25);
  assert.equal(result.diagnostics.length, 20);
});

it("reports seven SKIP rows and a successful total for a clean checkout", (t) => {
  const root = checkout(t);
  const result = runCheckTouched(root);
  assert.equal(result.status, 0, result.output);
  assert.equal(result.output.match(/^SKIP /gm)?.length, 7);
  assert.match(result.output, /^PASS Total \(\d+\.\d+s\)/m);
});

it("checks working-tree bytes even when staged bytes differ", (t) => {
  const root = checkout(t);
  const original = readFileSync(join(root, "README.md"), "utf8");
  put(root, "README.md", original + String.fromCodePoint(0x202e));
  git(root, "add", "--", "README.md");
  put(root, "README.md", original + "\nVisible working-tree edit.\n");
  const before = snapshot(root);
  const result = runCheckTouched(root);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /^PASS Unicode /m);
  assert.deepEqual(snapshot(root), before);
  assert.ok(
    git(root, "show", ":README.md").endsWith(String.fromCodePoint(0x202e)),
  );
});

it("fails on Unicode controls with printable filenames and leaves every fixture byte unchanged", (t) => {
  const root = checkout(t);
  // Newlines are legal Git paths on POSIX; Windows still exercises spaces, bidi and C1 controls.
  const path = `notes ${String.fromCodePoint(0x202e, 0x85, 0x9b, 0x9d)}${process.platform === "win32" ? "" : "\n"}.md`;
  put(root, path, "😀" + String.fromCodePoint(0x2028));
  const before = snapshot(root);
  const result = runCheckTouched(root);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /:1:2: U\+2028/);
  assert.match(result.output, /\\u202e/);
  assert.match(result.output, /\\u0085\\u009b\\u009d/);
  assert.doesNotMatch(result.output, /[\u0080-\u009f]/u);
  assert.equal(result.output.includes(String.fromCodePoint(0x202e)), false);
  assert.equal(result.output.includes(String.fromCodePoint(0x2028)), false);
  assert.match(result.output, /^FAIL Unicode /m);
  assert.match(result.output, /^FAIL Total /m);
  assert.deepEqual(snapshot(root), before);
});

it("catches a real formatting slip, continues later checks and never autofixes", (t) => {
  const root = checkout(t);
  put(root, "test/touched-format-slip.test.ts", "const example={value:1}\n");
  const before = snapshot(root);
  const result = runCheckTouched(root);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /^FAIL Prettier /m);
  assert.match(result.output, /^PASS Unicode /m);
  assert.equal(result.output.match(/^(?:PASS|FAIL|SKIP) /gm)?.length, 8);
  assert.deepEqual(snapshot(root), before);
});

it("refuses temporary tool output inside the repository without changing its files", (t) => {
  const root = checkout(t);
  put(root, "test/touched-temp.test.ts", "export {};\n");
  const before = snapshot(root);
  const result = runCheckTouched(root, [], {
    ...process.env,
    TMPDIR: root,
    TEMP: root,
    TMP: root,
  });
  assert.equal(result.status, 1, result.output);
  assert.match(
    result.output,
    /Temporary output directory must be outside the repository/,
  );
  assert.match(result.output, /^FAIL Change selection /m);
  assert.doesNotMatch(result.output, /^PASS Total /m);
  assert.deepEqual(snapshot(root), before);
});

it("typechecks a real deletion-only imported module and exposes its broken imports", (t) => {
  const root = checkout(t);
  unlinkSync(join(root, "src/cli/constants.ts"));
  const before = snapshot(root);
  const result = runCheckTouched(root);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /^FAIL Typecheck /m);
  assert.match(result.output, /TS2307.*constants/);
  assert.match(result.output, /^SKIP Prettier /m);
  assert.match(result.output, /^SKIP ESLint /m);
  assert.match(result.output, /^SKIP Unicode /m);
  assert.match(result.output, /^(?:PASS|FAIL) Gruff ratchet /m);
  assert.deepEqual(snapshot(root), before);
});

it("rejects unknown arguments and documents working-tree scope without launching checks", (t) => {
  const root = directory(t);
  const help = runCheckTouched(root, ["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.output, /working-tree bytes/);
  assert.match(help.output, /does not replace preflight or owning test suites/);
  const invalid = runCheckTouched(root, ["--fix"]);
  assert.equal(invalid.status, 1);
  assert.match(invalid.output, /Unsupported arguments/);
});
