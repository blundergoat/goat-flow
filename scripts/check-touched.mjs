#!/usr/bin/env node
/**
 * Fast, read-only feedback on working-tree content, including staged changes.
 * Run from this repository with `npm run check:touched`; owning tests and
 * preflight remain required. Staged bytes are not independently certified.
 *
 * Changed-path trigger table (deletions and both rename endpoints count):
 * Prettier: existing .ts/.js/.html under src, .ts under test, .mjs under scripts.
 * ESLint: existing .ts under src/cli or src/dashboard; tests are excluded.
 * Typecheck: .ts under src, tsconfig{,.dashboard}.json, package.json, dependency
 *   locks or npm-shrinkwrap.json; runs both complete TypeScript projects.
 * Gruff: .ts under src; the existing whole-repository accepted-debt ratchet.
 * Guidance contracts (including word budgets) and stats --check: workflow/skills,
 *   workflow/setup, .goat-flow/skill-docs, .goat-flow/learning-loop, installed
 *   .{agents,claude}/skills and .github/skills, plus the three live instructions.
 * Unicode: changed regular UTF-8 text, excluding ignored local workspaces,
 *   build/dependency output, generated indexes/locks/vendor files and binaries.
 *   Reject U+061C, U+200B, U+200E/F, U+2028-202E, U+2060, U+2066-2069 and
 *   interior U+FEFF. Leading BOM, visible Unicode, emoji and U+200C/D stay valid.
 *   Intentional controls must use source escapes or String.fromCodePoint;
 *   this command has no autofix or literal-character allowlist.
 *
 * Every check prints PASS, FAIL or SKIP with elapsed seconds; any FAIL exits 1.
 */
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import {
  delimiter,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const INVISIBLE =
  /[\u061c\u200b\u200e\u200f\u2028-\u202e\u2060\u2066-\u2069\ufeff]/u;
const UNSAFE_OUTPUT =
  /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200b\u200e\u200f\u2028-\u202e\u2060\u2066-\u2069\ufeff]/gu;
const MAX_DIAGNOSTICS = 20;
const TYPE_INPUTS = new Set([
  "tsconfig.json",
  "tsconfig.dashboard.json",
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "npm-shrinkwrap.json",
]);
const INSTRUCTIONS = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  ".github/copilot-instructions.md",
]);
const GUIDANCE = [
  "workflow/skills/",
  "workflow/setup/",
  ".goat-flow/skill-docs/",
  ".goat-flow/learning-loop/",
  ".agents/skills/",
  ".claude/skills/",
  ".github/skills/",
];

/** Keep command-controlled text printable, including in tool failure output. */
function printable(text) {
  return String(text).replace(
    UNSAFE_OUTPUT,
    (character) =>
      `\\u${character.codePointAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** Accept EPERM metadata only when the child actually exited without a signal. */
function processCompleted(result) {
  return (
    typeof result.status === "number" &&
    result.signal === null &&
    (!result.error || result.error.code === "EPERM")
  );
}

/** Run Git with private captures; throw on capture or command failure before accepting raw bytes. */
function gitOutput(root, args) {
  const result = captureCommand(root, ["git", ...args]);
  if (processCompleted(result) && result.status === 0) return result.stdout;
  const reason = processCompleted(result)
    ? `exit ${result.status}: ${result.stderr.toString("utf8").trim()}`
    : (result.error?.message ?? result.signal ?? "launch failed");
  throw new Error(`Git ${args[0]} failed: ${reason}`);
}

/**
 * Parse Git's NUL records without splitting whitespace inside a filename.
 *
 * @param output - Git name-status text with a trailing NUL, or empty for no changes.
 * @throws When a malformed record prevents a complete changed-path inventory.
 */
export function parseNameStatus(output) {
  const words = output.split("\0");
  if (words.pop() !== "")
    throw new Error("Git change inventory is not NUL-terminated");
  const changes = [];
  for (let index = 0; index < words.length;) {
    const status = words[index++];
    if (!/^[A-Z][0-9]*$/u.test(status))
      throw new Error("Invalid Git change status");
    const count = /^[RC]/u.test(status) ? 2 : 1;
    const paths = words.slice(index, index + count);
    if (paths.length !== count || paths.some((path) => !path)) {
      throw new Error("Incomplete Git change record");
    }
    changes.push({ status, paths });
    index += count;
  }
  return changes;
}

/**
 * Run read-only Git queries against HEAD, retaining statuses and rename endpoints.
 * Untracked files use status ?. Malformed records, Git and UTF-8 decoding errors throw.
 *
 * @param root - Git working-tree root used as the child processes' working directory.
 */
export function collectChangedPaths(root) {
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const changes = parseNameStatus(
    decoder.decode(
      gitOutput(root, ["diff", "--name-status", "-z", "-M", "HEAD", "--"]),
    ),
  );
  const untracked = decoder.decode(
    gitOutput(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
  );
  if (untracked !== "" && !untracked.endsWith("\0"))
    throw new Error("Git untracked inventory is not NUL-terminated");
  const untrackedPaths =
    untracked === "" ? [] : untracked.slice(0, -1).split("\0");
  if (untrackedPaths.some((path) => !path))
    throw new Error("Git untracked inventory contains an empty path");
  for (const path of untrackedPaths) {
    changes.push({ status: "?", paths: [path] });
  }
  return changes;
}

/** Missing paths still trigger project checks, but cannot be file arguments. */
function isRegularFile(root, path) {
  try {
    return lstatSync(join(root, path)).isFile();
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
}

/** Match the repository's format:check globs, not every Prettier-supported file. */
function isFormattedPath(path) {
  return /^(?:src\/.*\.(?:ts|js|html)|test\/.*\.ts|scripts\/.*\.mjs)$/u.test(
    path,
  );
}

/** Keep generated artifacts and ignored scratch out of the Unicode policy. */
function excludesUnicode(path) {
  return (
    /^(?:dist|out|coverage|node_modules|_temp|inbox)\//u.test(path) ||
    /^\.goat-flow\/(?:scratchpad|plans|logs|state)\//u.test(path) ||
    /^(?:workflow|\.goat-flow)\/hooks\/vendor\//u.test(path) ||
    path === "workflow/hooks/agent-config/managed-hook-desired-state.json" ||
    /^\.goat-flow\/learning-loop\/[^/]+\/INDEX\.md$/u.test(path) ||
    /(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|npm-shrinkwrap\.json)$/u.test(
      path,
    )
  );
}

/**
 * Select project checks from all changed paths; content lists contain only live files.
 *
 * @param root - Working-tree root used to check which paths still exist as regular files.
 * @param changes - Git status/path records, including deleted paths and both rename endpoints.
 */
export function selectChecks(root, changes) {
  const paths = [...new Set(changes.flatMap((change) => change.paths))].sort();
  const files = paths.filter((path) => isRegularFile(root, path));
  const hasSourceChanges = paths.some((path) => /^src\/.*\.ts$/u.test(path));
  const hasGuidanceChanges = paths.some(
    (path) =>
      INSTRUCTIONS.has(path) ||
      GUIDANCE.some((prefix) => path.startsWith(prefix)),
  );
  return {
    paths,
    prettier: files.filter(isFormattedPath),
    eslint: files.filter((path) =>
      /^src\/(?:cli|dashboard)\/.*\.ts$/u.test(path),
    ),
    typecheck: hasSourceChanges || paths.some((path) => TYPE_INPUTS.has(path)),
    gruff: hasSourceChanges,
    guidance: hasGuidanceChanges,
    unicode: files.filter((path) => !excludesUnicode(path)),
  };
}

/**
 * Scan bytes without rewriting them; code-point positions locate controls for repair.
 * Invalid UTF-8, NUL-bearing binaries and generated headers are excluded from the count.
 *
 * @param root - Working-tree root containing the selected text candidates.
 * @param paths - Existing regular files relative to root; callers filter deleted paths first.
 * @throws When a selected file cannot be read; unreadable text must not receive a pass.
 */
export function scanUnicodeFiles(root, paths) {
  const diagnostics = [];
  let count = 0;
  let scanned = 0;
  for (const path of paths) {
    const bytes = readFileSync(join(root, path));
    // NUL and invalid UTF-8 identify binary content, not malformed source text.
    if (bytes.includes(0)) continue;
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        bytes,
      );
    } catch {
      continue;
    }
    // Machine-emitted artifacts name their generator in the opening comment.
    if (
      /^(?:#![^\n]*\n)?\s*(?:\/\*|\/\/|#|<!--)\s*(?:@generated\b|Generated by\b)/u.test(
        text,
      )
    )
      continue;
    scanned++;
    let line = 1;
    let column = 1;
    let offset = 0;
    for (const character of text) {
      if (
        INVISIBLE.test(character) &&
        !(offset === 0 && character === "\ufeff")
      ) {
        count++;
        if (diagnostics.length < MAX_DIAGNOSTICS) {
          diagnostics.push({
            path,
            line,
            column,
            codePoint: `U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`,
          });
        }
      }
      if (character === "\n") {
        line++;
        column = 1;
      } else {
        column++;
      }
      offset += character.length;
    }
  }
  return { diagnostics, count, scanned };
}

/** Use installed Node entrypoints so filenames never pass through a shell. */
function packageCommand(root, name, args) {
  const require = createRequire(join(root, "package.json"));
  const manifestPath = require.resolve(`${name}/package.json`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const entry =
    typeof manifest.bin === "string" ? manifest.bin : manifest.bin[name];
  return [process.execPath, join(dirname(manifestPath), entry), ...args];
}

/** Windows npm shims need their Node entrypoint when shell execution is disabled. */
function typecheckCommand() {
  if (process.platform !== "win32") return ["npm", "run", "typecheck"];
  const candidates = [
    process.env.npm_execpath,
    ...[
      dirname(process.execPath),
      ...(process.env.PATH ?? "").split(delimiter),
    ].map((directory) => join(directory, "node_modules/npm/bin/npm-cli.js")),
  ];
  const entry = candidates.find((path) => path && existsSync(path));
  if (!entry)
    throw new Error(
      "Installed npm-cli.js not found; run npm run check:touched from Git Bash",
    );
  return [process.execPath, entry, "run", "typecheck"];
}

/** Include the word-budget owner once as part of the complete contract suite. */
function contractCommand(root) {
  const tests = readdirSync(join(root, "test/contract"), { recursive: true })
    .filter((path) => path.endsWith(".test.ts"))
    .sort()
    .map((path) => join("test/contract", path));
  if (!tests.length) throw new Error("No guidance contract tests found");
  return [
    process.execPath,
    "--import",
    "tsx",
    "--test",
    "--test-reporter=tap",
    ...tests,
  ];
}

/**
 * Capture tool output in private temporary files because managed pipes can lose child output.
 * Keep those files outside the working tree and remove them even when the tool or read fails.
 * Return raw bytes for strict Git filename decoding; each stream is limited to 32 MiB after exit.
 */
function captureCommand(root, argv) {
  const temporaryRoot = realpathSync(tmpdir());
  const relativeTemporaryRoot = relative(realpathSync(root), temporaryRoot);
  if (
    relativeTemporaryRoot === "" ||
    (!isAbsolute(relativeTemporaryRoot) &&
      relativeTemporaryRoot !== ".." &&
      !relativeTemporaryRoot.startsWith(`..${sep}`))
  ) {
    throw new Error(
      "Temporary output directory must be outside the repository",
    );
  }
  const outputRoot = mkdtempSync(join(temporaryRoot, "goat-touched-command-"));
  const descriptors = [];
  try {
    for (const name of ["stdout", "stderr"]) {
      descriptors.push(openSync(join(outputRoot, name), "wx+", 0o600));
    }
    const result = spawnSync(argv[0], argv.slice(1), {
      cwd: root,
      shell: false,
      stdio: ["ignore", ...descriptors],
    });
    if (
      descriptors.some(
        (descriptor) => fstatSync(descriptor).size > 32 * 1024 * 1024,
      )
    ) {
      throw new Error("Tool output exceeded the 32 MiB capture limit");
    }
    return {
      ...result,
      stdout: readFileSync(join(outputRoot, "stdout")),
      stderr: readFileSync(join(outputRoot, "stderr")),
    };
  } finally {
    for (const descriptor of descriptors) closeSync(descriptor);
    rmSync(outputRoot, { recursive: true, force: true });
  }
}

/** Failed tools retain bounded diagnostics; successful tools need just their row. */
function runCommand(root, argv) {
  const result = captureCommand(root, argv);
  const completed = processCompleted(result);
  const passed = completed && result.status === 0;
  const output = [
    result.stdout,
    result.stderr,
    completed ? null : result.error?.message,
  ]
    .filter(Boolean)
    .join("\n");
  if (!passed) {
    const lines = printable(output).trim().split("\n");
    const selected =
      lines.length > 60
        ? [
            ...lines.slice(0, 30),
            "... output truncated ...",
            ...lines.slice(-30),
          ]
        : lines;
    for (const line of selected) console.log(`  ${line.slice(0, 500)}`);
    console.log(`  Exit: ${result.status ?? result.signal ?? "launch failed"}`);
    console.log(
      `  Re-run: ${printable(argv.map((arg) => JSON.stringify(arg)).join(" "))}`,
    );
  }
  return passed;
}

/** Report code points without printing the invisible characters themselves. */
function runUnicodeCheck(root, paths) {
  const result = scanUnicodeFiles(root, paths);
  for (const item of result.diagnostics) {
    console.log(
      `  ${printable(JSON.stringify(item.path))}:${item.line}:${item.column}: ${item.codePoint}`,
    );
  }
  if (result.count > result.diagnostics.length)
    console.log(
      `  ${result.count - result.diagnostics.length} more control(s) omitted`,
    );
  return {
    status: result.count ? "FAIL" : result.scanned ? "PASS" : "SKIP",
    detail: `${result.scanned} changed text file(s); ${result.count} invisible control(s)`,
  };
}

/** Run all applicable checks even after failure, reporting their actual scope. */
function runTouchedChecks(root) {
  const started = performance.now();
  const selected = selectChecks(root, collectChangedPaths(root));
  console.log(
    `Working-tree content: ${selected.paths.length} changed path(s), including deletions and rename endpoints.`,
  );
  const checks = [
    [
      "Prettier",
      selected.prettier.length,
      `${selected.prettier.length} existing changed file(s)`,
      () =>
        packageCommand(root, "prettier", [
          "--check",
          "--",
          ...selected.prettier.map((path) => `./${path}`),
        ]),
    ],
    [
      "ESLint",
      selected.eslint.length,
      `${selected.eslint.length} existing changed source file(s)`,
      () =>
        packageCommand(root, "eslint", [
          "--",
          ...selected.eslint.map((path) => `./${path}`),
        ]),
    ],
    [
      "Typecheck",
      selected.typecheck,
      "both complete TypeScript projects",
      () => typecheckCommand(),
    ],
    [
      "Gruff ratchet",
      selected.gruff,
      "whole repository; accepted warning debt",
      () => [process.execPath, "scripts/check-gruff-warning-ratchet.mjs"],
    ],
    [
      "Guidance contracts",
      selected.guidance,
      "full contract suite, including word budgets",
      () => contractCommand(root),
    ],
    [
      "Stats",
      selected.guidance,
      "repository learning-loop metadata and indexes",
      () => [
        process.execPath,
        "--import",
        "tsx",
        "src/cli/cli.ts",
        "stats",
        "--check",
      ],
    ],
    [
      "Unicode",
      selected.unicode.length,
      "changed UTF-8 text; generated/binary content excluded",
      null,
    ],
  ];
  let failures = 0;
  for (const [name, enabled, scope, command] of checks) {
    const checkStarted = performance.now();
    let status = "SKIP";
    let detail = enabled ? scope : "no applicable changed paths";
    if (enabled) {
      try {
        if (command) {
          status = runCommand(root, command()) ? "PASS" : "FAIL";
        } else {
          ({ status, detail } = runUnicodeCheck(root, selected.unicode));
        }
      } catch (error) {
        status = "FAIL";
        console.log(`  ${printable(error.message)}`);
      }
    }
    if (status === "FAIL") failures++;
    console.log(
      `${status} ${name} (${((performance.now() - checkStarted) / 1000).toFixed(2)}s) - ${detail}`,
    );
  }
  console.log(
    `${failures ? "FAIL" : "PASS"} Total (${((performance.now() - started) / 1000).toFixed(2)}s) - ${failures} failed check(s); owning tests and preflight still required.`,
  );
  return failures ? 1 : 0;
}

/** Reject unsupported options before running checks; help states the byte scope. */
function main() {
  if (process.argv.length === 3 && ["--help", "-h"].includes(process.argv[2])) {
    console.log(
      "Usage: npm run check:touched [-- --help]\nChecks working-tree bytes for staged, unstaged and untracked changes against HEAD.\nDeletions and both rename paths select checks; content tools use existing regular files.\nRead-only: no autofix. This does not replace preflight or owning test suites.",
    );
    return 0;
  }
  try {
    if (process.argv.length > 2)
      throw new Error("Unsupported arguments; use --help");
    const root = gitOutput(process.cwd(), ["rev-parse", "--show-toplevel"])
      .toString("utf8")
      .replace(/\r?\n$/u, "");
    return runTouchedChecks(root);
  } catch (error) {
    console.error(`FAIL Change selection - ${printable(error.message)}`);
    return 1;
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  process.exitCode = main();
}
