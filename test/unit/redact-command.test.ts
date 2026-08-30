/**
 * Verifies the pre-write redaction path used for durable local artifacts.
 * Users invoke the CLI before saving session, review, quality, or export text;
 * these tests prove representative fake secrets disappear while useful paths,
 * commands, and issue links remain readable.
 */
import { afterEach, describe, it } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire, syncBuiltinESMExports } from "node:module";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseCLIArgs } from "../../src/cli/cli-parser.js";
import { CLIError } from "../../src/cli/cli-error.js";
import { handleRedactCommand } from "../../src/cli/redact-command.js";
import { scrubDurableText } from "../../src/cli/evidence/redaction.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const CLI_PATH = join(PROJECT_ROOT, "src", "cli", "cli.ts");
const require = createRequire(import.meta.url);
const runtimeFs = require("node:fs") as typeof import("node:fs");
const originalCloseSync = runtimeFs.closeSync;
const originalFsyncSync = runtimeFs.fsyncSync;
const originalFtruncateSync = runtimeFs.ftruncateSync;
const originalReadFileSync = runtimeFs.readFileSync;
const BARE_SECRET_NAMES = [
  "API_KEY",
  "AUTH",
  "COOKIE",
  "PASSWORD",
  "PASSWD",
  "PRIVATE_KEY",
  "SECRET",
  "TOKEN",
] as const;

type RejectedAllocationCleanupFault = "close" | "flush" | "truncate";

/** Restore built-in bindings after each in-process filesystem fault fixture. */
function restoreRuntimeFs(): void {
  runtimeFs.closeSync = originalCloseSync;
  runtimeFs.fsyncSync = originalFsyncSync;
  runtimeFs.ftruncateSync = originalFtruncateSync;
  runtimeFs.readFileSync = originalReadFileSync;
  syncBuiltinESMExports();
}

/**
 * Force the initial flush and one selected cleanup operation to fail in-process.
 * Error behavior: the injected built-in throws EIO only at the named fixture stages.
 */
function injectRejectedAllocationCleanupFault(
  fault: RejectedAllocationCleanupFault,
): void {
  let fsyncCalls = 0;
  runtimeFs.readFileSync = ((...args: unknown[]) => {
    if (args[0] === 0) return "Authorization: Bearer fixture-secret\n";
    return Reflect.apply(originalReadFileSync, runtimeFs, args);
  }) as typeof runtimeFs.readFileSync;
  runtimeFs.fsyncSync = ((descriptor: number) => {
    fsyncCalls += 1;
    if (fsyncCalls === 1 || fault === "flush") {
      throw Object.assign(new Error("fixture fsync failure"), { code: "EIO" });
    }
    originalFsyncSync(descriptor);
  }) as typeof runtimeFs.fsyncSync;
  if (fault === "truncate") {
    runtimeFs.ftruncateSync = (() => {
      throw Object.assign(new Error("fixture truncate failure"), {
        code: "EIO",
      });
    }) as typeof runtimeFs.ftruncateSync;
  }
  if (fault === "close") {
    runtimeFs.closeSync = ((descriptor: number) => {
      originalCloseSync(descriptor);
      throw Object.assign(new Error("fixture close failure"), { code: "EIO" });
    }) as typeof runtimeFs.closeSync;
  }
  syncBuiltinESMExports();
}

/**
 * Run the public redactor against one temporary project and destination.
 *
 * Side effects: spawns the CLI, which may create the requested fixture output.
 */
function runRedact(
  projectPath: string,
  outputPath: string,
  input = "Authorization: Bearer fixture-secret\n",
) {
  return spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      CLI_PATH,
      "redact",
      projectPath,
      "--output",
      outputPath,
    ],
    {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
      input,
    },
  );
}

/**
 * Create a directory symlink or skip only when Windows forbids the fixture.
 *
 * Error behavior: throws unexpected filesystem errors; an EPERM skips the fixture.
 */
function symlinkDirectoryOrSkip(
  testContext: TestContext,
  target: string,
  link: string,
): boolean {
  try {
    symlinkSync(target, link, "dir");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    testContext.skip("host blocks unprivileged directory symlinks");
    return false;
  }
}

/** Build fake credential shapes at runtime so tracked fixtures never contain usable-looking values. */
function buildFakeSecrets(): {
  github: string;
  npm: string;
  openAi: string;
  privateKey: string;
} {
  const privateKeyLabel = ["PRIVATE", "KEY"].join(" ");
  return {
    github: ["ghp", "a".repeat(36)].join("_"),
    npm: ["npm", "b".repeat(36)].join("_"),
    openAi: ["sk", `proj-${"c".repeat(32)}`].join("-"),
    privateKey: [
      `-----BEGIN ${privateKeyLabel}-----`,
      "fake-key-material-for-redaction-tests",
      `-----END ${privateKeyLabel}-----`,
    ].join("\n"),
  };
}

describe("durable artifact redaction", () => {
  afterEach(restoreRuntimeFs);

  // A copied continuation note must replace each supported secret class before reaching disk.
  it("replaces representative fake secrets with evidence-shaped placeholders", () => {
    const fakeSecrets = buildFakeSecrets();
    const rawText = [
      `Authorization: Bearer ${fakeSecrets.openAi}`,
      `Cookie: session=${fakeSecrets.github}`,
      `API_TOKEN=${fakeSecrets.github}`,
      `"password": "${fakeSecrets.openAi}"`,
      `curl --token ${fakeSecrets.npm}`,
      `https://example.test/callback?token=${fakeSecrets.github}&next=1`,
      `Standalone token: ${fakeSecrets.github}`,
      fakeSecrets.privateKey,
    ].join("\n");

    const scrubbed = scrubDurableText(rawText);

    assert.doesNotMatch(scrubbed, new RegExp(fakeSecrets.github, "u"));
    assert.doesNotMatch(scrubbed, new RegExp(fakeSecrets.npm, "u"));
    assert.doesNotMatch(scrubbed, new RegExp(fakeSecrets.openAi, "u"));
    assert.doesNotMatch(scrubbed, /fake-key-material/u);
    assert.match(scrubbed, /\[REDACTED:authorization\]/u);
    assert.match(scrubbed, /\[REDACTED:cookie\]/u);
    assert.match(scrubbed, /\[REDACTED:env-value\]/u);
    assert.match(scrubbed, /\[REDACTED:field\]/u);
    assert.match(scrubbed, /\[REDACTED:argument\]/u);
    assert.match(scrubbed, /\[REDACTED:url-value\]/u);
    assert.match(scrubbed, /\[REDACTED:token\]/u);
    assert.match(scrubbed, /\[REDACTED:private-key\]/u);
  });

  // Bare names are the most common `.env` spelling and must receive the same protection as prefixed names.
  for (const name of BARE_SECRET_NAMES) {
    it(`redacts the bare ${name} environment name`, () => {
      assert.equal(
        scrubDurableText(`${name}=fixture-value`),
        `${name}=[REDACTED:env-value]`,
      );
      assert.equal(
        scrubDurableText(`export ${name}="fixture-value" # retained comment`),
        `export ${name}=[REDACTED:env-value] # retained comment`,
      );
    });
  }

  it("does not consume benign near-matches of bare secret names", () => {
    const benignName = ["TOKEN", "COUNT"].join("_");
    const benignAssignment = `${benignName}=4`;
    assert.equal(scrubDurableText(benignAssignment), benignAssignment);
    assert.equal(
      scrubDurableText("API_TOKEN=fixture-value"),
      "API_TOKEN=[REDACTED:env-value]",
    );
  });

  // Compact JSON keeps secrets mid-line; fields must scrub without a line anchor.
  it("redacts fields inside compact JSON objects", () => {
    const scrubbed = scrubDurableText(
      '{"password":"hunter2","user":"me","auth":{"token":"opaque-value"}}',
    );

    assert.equal(
      scrubbed,
      '{"password":"[REDACTED:field]","user":"me","auth":{"token":"[REDACTED:field]"}}',
    );
  });

  // Unquoted object notation still scrubs when the value ends at a delimiter.
  it("redacts unquoted field values that end at a delimiter or line end", () => {
    assert.equal(
      scrubDurableText("{password: hunter2, user: me}"),
      '{password: "[REDACTED:field]", user: me}',
    );
    assert.equal(
      scrubDurableText("password: hunter2"),
      'password: "[REDACTED:field]"',
    );
  });

  // Keyword-led prose is guidance, not a credential assignment; it must survive.
  it("preserves prose lines that begin with a credential keyword", () => {
    const proseLine = "Token: use the CI-scoped one for deploys";

    assert.equal(scrubDurableText(proseLine), proseLine);
  });

  // Opaque flag values need redaction even when the option begins the input or a later line.
  it("redacts credential flags at input and line starts", () => {
    const scrubbed = scrubDurableText(
      "--token opaque-token\n--api-key='opaque-key'\n",
    );

    assert.equal(
      scrubbed,
      "--token [REDACTED:argument]\n--api-key=[REDACTED:argument]\n",
    );
    assert.doesNotMatch(scrubbed, /opaque-(?:token|key)/u);
  });

  // Paths and read-only commands remain useful so a resumed user can reproduce prior work.
  it("preserves benign paths, commands, issue URLs, and empty input", () => {
    const benignText = [
      "bash scripts/preflight-checks.sh",
      ".goat-flow/logs/sessions/2026-07-13-handoff.md",
      "gh issue view 42 --repo blundergoat/goat-flow",
      "https://github.com/blundergoat/goat-flow/issues/42",
    ].join("\n");

    assert.equal(scrubDurableText(benignText), benignText);
    assert.equal(scrubDurableText(""), "");
  });

  // The parser must expose a real command instead of treating `redact` as an audit path.
  it("parses redact as a first-class CLI command", () => {
    const parsed = parseCLIArgs(["redact", PROJECT_ROOT]);

    assert.equal(parsed.command, "redact");
    assert.equal(parsed.projectPath, PROJECT_ROOT);
  });

  /**
   * Fixture purpose: cover the real CLI scanner path from stdin to `--output`.
   * Filesystem/process side effects: spawn the CLI, write one temp file, then delete it.
   */
  it("writes only scrubbed stdin to an explicit output file", () => {
    const temporaryProject = mkdtempSync(join(tmpdir(), "goat-flow-redact-"));
    const outputPath = join(
      temporaryProject,
      ".goat-flow",
      "logs",
      "sessions",
      "handoff.md",
    );
    const fakeSecrets = buildFakeSecrets();

    try {
      // This mirrors a user piping a handoff draft into an explicit gitignored output path.
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          CLI_PATH,
          "redact",
          temporaryProject,
          "--output",
          outputPath,
        ],
        {
          cwd: PROJECT_ROOT,
          encoding: "utf-8",
          input: `Authorization: Bearer ${fakeSecrets.openAi}\n`,
        },
      );

      assert.equal(result.status, 0, result.stderr);
      const persistedText = readFileSync(outputPath, "utf-8");
      assert.equal(
        persistedText,
        "Authorization: Bearer [REDACTED:authorization]\n",
      );
      assert.doesNotMatch(persistedText, new RegExp(fakeSecrets.openAi, "u"));
      assert.ok(
        process.platform === "win32" ||
          (statSync(outputPath).mode & 0o077) === 0,
        "POSIX output must not grant group or other permissions",
      );
    } finally {
      rmSync(temporaryProject, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite an existing durable artifact", () => {
    const temporaryProject = mkdtempSync(join(tmpdir(), "goat-flow-redact-"));
    const outputPath = join(
      temporaryProject,
      ".goat-flow",
      "logs",
      "sessions",
      "handoff.md",
    );
    mkdirSync(join(outputPath, ".."), { recursive: true });
    writeFileSync(outputPath, "existing receipt\n", "utf-8");

    try {
      const result = runRedact(temporaryProject, outputPath);

      assert.equal(result.status, 2);
      assert.match(result.stderr, /already exists|create-only/iu);
      assert.equal(readFileSync(outputPath, "utf-8"), "existing receipt\n");
    } finally {
      rmSync(temporaryProject, { recursive: true, force: true });
    }
  });

  // Fixture purpose: each fallible cleanup stage fails after a rejected write; all paths stay in one disposable project.
  for (const fault of ["truncate", "flush", "close"] as const) {
    it(`removes its rejected create-only output when cleanup ${fault} fails`, () => {
      const temporaryProject = mkdtempSync(join(tmpdir(), "goat-flow-redact-"));
      const outputPath = join(
        temporaryProject,
        ".goat-flow",
        "logs",
        "sessions",
        "rejected.md",
      );
      const options = parseCLIArgs([
        "redact",
        temporaryProject,
        "--output",
        outputPath,
      ]);
      injectRejectedAllocationCleanupFault(fault);

      try {
        assert.throws(
          () => handleRedactCommand(options),
          (error: unknown) =>
            error instanceof CLIError &&
            /could not discard a rejected output allocation/u.test(
              error.message,
            ),
        );
        assert.equal(existsSync(outputPath), false);
      } finally {
        rmSync(temporaryProject, { recursive: true, force: true });
      }
    });
  }

  it("refuses an output path outside the selected project", () => {
    const temporaryProject = mkdtempSync(join(tmpdir(), "goat-flow-redact-"));
    const outsideDirectory = mkdtempSync(
      join(tmpdir(), "goat-flow-redact-outside-"),
    );
    const outputPath = join(outsideDirectory, "handoff.md");

    try {
      const result = runRedact(temporaryProject, outputPath);

      assert.equal(result.status, 2);
      assert.match(
        result.stderr,
        /inside the selected project|project-local/iu,
      );
      assert.equal(existsSync(outputPath), false);
    } finally {
      rmSync(temporaryProject, { recursive: true, force: true });
      rmSync(outsideDirectory, { recursive: true, force: true });
    }
  });

  /**
   * Fixture purpose: reproduce the former parent-symlink escape and prove the outside sentinel remains unchanged.
   * Filesystem/process side effects: create two temporary roots, spawn the CLI, then remove both roots.
   */
  it("refuses a symlinked parent without changing the outside file", (testContext) => {
    const temporaryProject = mkdtempSync(join(tmpdir(), "goat-flow-redact-"));
    const outsideDirectory = mkdtempSync(
      join(tmpdir(), "goat-flow-redact-outside-"),
    );
    const logsDirectory = join(temporaryProject, ".goat-flow", "logs");
    const redirectedDirectory = join(logsDirectory, "sessions");
    const outsideFile = join(outsideDirectory, "handoff.md");
    mkdirSync(logsDirectory, { recursive: true });
    writeFileSync(outsideFile, "outside sentinel\n", "utf-8");
    if (
      !symlinkDirectoryOrSkip(
        testContext,
        outsideDirectory,
        redirectedDirectory,
      )
    ) {
      rmSync(temporaryProject, { recursive: true, force: true });
      rmSync(outsideDirectory, { recursive: true, force: true });
      return;
    }

    try {
      const result = runRedact(
        temporaryProject,
        join(redirectedDirectory, "handoff.md"),
      );

      assert.equal(result.status, 2);
      assert.match(result.stderr, /real project-local directory|symlink/iu);
      assert.equal(readFileSync(outsideFile, "utf-8"), "outside sentinel\n");
    } finally {
      rmSync(temporaryProject, { recursive: true, force: true });
      rmSync(outsideDirectory, { recursive: true, force: true });
    }
  });
});
