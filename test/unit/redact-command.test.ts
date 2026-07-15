/**
 * Verifies the pre-write redaction path used for durable local artifacts.
 * Users invoke the CLI before saving session, review, quality, or export text;
 * these tests prove representative fake secrets disappear while useful paths,
 * commands, and issue links remain readable.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseCLIArgs } from "../../src/cli/cli-parser.js";
import {
  redactEvidenceText,
  scrubDurableText,
} from "../../src/cli/evidence/redaction.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const CLI_PATH = join(PROJECT_ROOT, "src", "cli", "cli.ts");

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
  // Users need one central scrubber without changing the existing hash-only evidence API.
  it("exports a readable scrubber beside hash-only evidence redaction", () => {
    const scrubbed = scrubDurableText("no secret text");
    const hashed = redactEvidenceText("prompt", "secret");

    assert.equal(scrubbed, "no secret text");
    assert.equal(hashed.kind, "redacted");
    assert.match(hashed.sha256, /^[a-f0-9]{64}$/u);
  });

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
    } finally {
      rmSync(temporaryProject, { recursive: true, force: true });
    }
  });
});
