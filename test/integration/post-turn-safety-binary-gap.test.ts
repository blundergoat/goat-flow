/**
 * Real-Git regressions for secrets and stale identities behind binary coverage-gap releases.
 *
 * Each case stops the same fixture session more than once, the way an agent retries after a blocked Stop.
 * A secret must block every replay, and a binary that changes identity must not inherit an earlier release.
 */
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  TEST_API_TOKEN,
  TEST_GITHUB_TOKEN,
  TEST_PRIVATE_KEY_HEADER,
  buildStopPayload,
  commitAll,
  runGit,
  runHook,
  withScannerFileFault,
  withTempRepo,
  writeFile,
} from "./post-turn-safety-hook.helpers.js";

// A minimal GLB header: its NUL bytes make Git and the scanner treat the file as binary.
const BINARY_GLB_HEADER = Buffer.from([103, 108, 84, 70, 2, 0, 0, 0]);

/**
 * Run one Stop for the shared fixture session, as if the agent ended its turn.
 *
 * @param root - fixture repository the agent worked in
 * @param isReplay - true means the provider is retrying after the previous Stop blocked
 * @param env - extra hook environment; empty runs the default scanner
 * @returns hook process result; status 2 means the turn stays blocked
 */
function runStop(
  root: string,
  isReplay: boolean,
  env: Record<string, string> = {},
) {
  return runHook(root, env, buildStopPayload("binary-secret", isReplay));
}

/**
 * List the replay records the scanner saved to allow a later release.
 *
 * @param root - fixture repository whose scratchpad holds the records
 * @returns record file names; empty means no release is armed
 */
function replayRecords(root: string) {
  const directory = join(root, ".goat-flow/scratchpad");
  // No scratchpad yet means the scanner never armed a release.
  return existsSync(directory)
    ? readdirSync(directory).filter((name) =>
        name.startsWith("post-turn-safety-reentry-v1-"),
      )
    : [];
}

describe("binary coverage gaps cannot release secrets", () => {
  // Each row is a file an agent might leave behind that Git calls binary but still holds a detectable secret.
  for (const [name, path, content, blockedFinding] of [
    [
      "NUL beside a token",
      "settings.env",
      `API_KEY=${TEST_API_TOKEN}\0\n`,
      "API token",
    ],
    [
      "NUL beyond the binary probe",
      "settings.env",
      `API_KEY=${TEST_API_TOKEN}\n${"a".repeat(40_000)}\0`,
      "API token",
    ],
    [
      "source token beside NUL",
      "src/app.ts",
      `const key = "${TEST_API_TOKEN}";\0\n`,
      "API token",
    ],
    [
      "private key with key data beside NUL",
      "asset.bin",
      `${TEST_PRIVATE_KEY_HEADER}\n${"b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAAB".repeat(2)}\n\0`,
      "private key block",
    ],
    [
      "token beyond the digest chunk",
      "asset.bin",
      `\0${"a".repeat(1_048_560)}\n${TEST_API_TOKEN}\n`,
      "API token",
    ],
    [
      "label far before a token glued to a word character",
      "asset.bin",
      `\0API_KEY=${"a".repeat(3 * 1_048_576)}Z${TEST_API_TOKEN}\n`,
      "API token",
    ],
    [
      "placeholder token before a real one",
      "asset.bin",
      `\0sk-${"x".repeat(40)} ${TEST_API_TOKEN}\n`,
      "API token",
    ],
    [
      "UTF-16LE token",
      "notes.bin",
      Buffer.from(`API_KEY=${TEST_API_TOKEN}\n`, "utf16le"),
      "API token",
    ],
    [
      "UTF-16BE token",
      "notes.bin",
      Buffer.from(`\0API_KEY=${TEST_API_TOKEN}\n`, "utf16le").swap16(),
      "API token",
    ],
  ] as const) {
    it(`blocks ${name} on every Stop`, () => {
      withTempRepo((root) => {
        writeFile(root, path, content);
        // The first Stop and both retries must block; a release would show up on a retry.
        for (const isReplay of [false, true, true]) {
          const result = runStop(root, isReplay);
          assert.equal(result.status, 2, result.stderr);
          assert.match(
            String(result.stderr),
            new RegExp(`blocked ${blockedFinding}`, "u"),
          );
          assert.doesNotMatch(String(result.stderr), /ending repeated Stop/u);
        }
        assert.deepEqual(replayRecords(root), []);
      });
    });
  }

  // The worktree copy looks binary, but the staged copy the user would commit holds the token.
  for (const baseline of ["attribute", "binary-head"] as const) {
    it(`blocks staged text hidden by ${baseline} and a binary worktree`, () => {
      withTempRepo((root) => {
        // A `-diff` attribute makes Git report even a text file as binary.
        if (baseline === "attribute")
          writeFile(root, ".gitattributes", "settings.env -diff\n");
        // The committed baseline is either a real binary or harmless text that the attribute makes Git treat as binary.
        writeFile(
          root,
          "settings.env",
          baseline === "binary-head" ? BINARY_GLB_HEADER : "MODE=local\n",
        );
        commitAll(root, "add binary admission baseline");
        writeFile(root, "settings.env", `API_KEY=${TEST_API_TOKEN}\n`);
        runGit(root, ["add", "settings.env"]);
        writeFile(
          root,
          "settings.env",
          Buffer.concat([BINARY_GLB_HEADER, Buffer.from([1])]),
        );
        // Every retry must still block, because the staged copy is what a commit would publish.
        for (const isReplay of [false, true, true]) {
          const result = runStop(root, isReplay);
          assert.equal(result.status, 2, result.stderr);
          assert.match(String(result.stderr), /blocked API token/u);
        }
        assert.deepEqual(replayRecords(root), []);
      });
    });
  }

  it("clears an old record when a forced-binary text view has no binary identity", () => {
    withTempRepo((root) => {
      writeFile(root, ".gitattributes", "settings.env -diff\n");
      writeFile(root, "settings.env", "MODE=baseline\n");
      commitAll(root, "add forced binary baseline");
      writeFile(root, "settings.env", BINARY_GLB_HEADER);
      assert.equal(runStop(root, false).status, 2);
      assert.equal(replayRecords(root).length, 1);

      // The agent turns the file back into text: Git still calls it binary, but it has no NUL byte to identify it.
      writeFile(root, "settings.env", "MODE=changed\n");
      const unavailable = runStop(root, true);
      assert.equal(unavailable.status, 2, unavailable.stderr);
      assert.match(
        String(unavailable.stderr),
        /binary coverage-gap identity unavailable/u,
      );
      assert.doesNotMatch(
        String(unavailable.stderr),
        /repeated-Stop state unavailable/u,
      );
      assert.deepEqual(replayRecords(root), []);

      // A real binary again has to block once on its own before the unchanged retry may release it.
      writeFile(root, "settings.env", BINARY_GLB_HEADER);
      assert.equal(runStop(root, true).status, 2);
      assert.equal(runStop(root, true).status, 0);
    });
  });

  // Each fault changes the file while it is read but keeps its bytes and size, so only the file identity reveals it.
  for (const operation of [
    "replace-during-digest",
    "touch-during-digest",
  ] as const) {
    it(`rejects ${operation} even when the size and bytes stay unchanged`, () => {
      withTempRepo((root) => {
        writeFile(root, "settings.env", BINARY_GLB_HEADER);
        assert.equal(runStop(root, false).status, 2);
        withScannerFileFault(operation, (environment) => {
          const result = runStop(root, true, environment);
          assert.equal(result.status, 2, result.stderr);
          assert.match(
            String(result.stderr),
            /binary coverage-gap identity unavailable/u,
          );
          assert.deepEqual(replayRecords(root), []);
        });
      });
    });
  }
});

/**
 * Build a binary just over the scanner's old 256 MiB Git output cap: a NUL byte, then one long run with no line break.
 *
 * @param tail - text after the run; empty means the asset holds no secret
 * @returns asset bytes larger than 256 MiB
 */
function largeBinary(tail: string): Buffer {
  return Buffer.concat([
    BINARY_GLB_HEADER,
    Buffer.alloc(257 * 1_048_576, 0x61),
    Buffer.from(tail),
  ]);
}

describe("large binary gaps are scanned, not stuck", () => {
  it("releases a clean staged binary over 256 MiB after one block", () => {
    withTempRepo((root) => {
      // The user staged a large asset, such as an exported 3D scene, with nothing secret inside.
      writeFile(root, "scene.glb", largeBinary(""));
      runGit(root, ["add", "scene.glb"]);
      assert.equal(runStop(root, false).status, 2);
      // An unchanged retry may end the turn, because both copies were fully scanned.
      const retry = runStop(root, true);
      assert.equal(retry.status, 0, retry.stderr);
    });
  });

  it("blocks a token at the end of a staged binary over 256 MiB on every Stop", () => {
    withTempRepo((root) => {
      writeFile(root, "scene.glb", largeBinary(`\n${TEST_API_TOKEN}\n`));
      runGit(root, ["add", "scene.glb"]);
      // The worktree copy is clean, so only a full scan of the staged copy can find the token.
      writeFile(root, "scene.glb", largeBinary(""));
      // The first Stop and both retries must block, because a commit would publish the staged token.
      for (const isReplay of [false, true, true]) {
        const result = runStop(root, isReplay);
        assert.equal(result.status, 2, result.stderr);
        assert.match(String(result.stderr), /blocked API token/u);
      }
      assert.deepEqual(replayRecords(root), []);
    });
  });

  it("releases a program that only contains key-header text", () => {
    withTempRepo((root) => {
      // Like ssh or a TLS library: the header string sits in a string table, followed by text and an uppercase hex constant, not key data.
      writeFile(
        root,
        "ssh-tool",
        `\0${TEST_PRIVATE_KEY_HEADER}\0usage: ssh-tool [options] destination\0${"9292758453063D803DD603D5E777D788".repeat(2)}\n`,
      );
      const first = runStop(root, false);
      assert.equal(first.status, 2, first.stderr);
      assert.doesNotMatch(String(first.stderr), /blocked private key block/u);
      // Header text alone is not key material, so the unchanged retry may end the turn.
      assert.equal(runStop(root, true).status, 0);
    });
  });

  it("does not read every other byte of plain binary text as a token", () => {
    withTempRepo((root) => {
      // Like a library symbol table: ASCII with no NUL beside each character, whose every other byte spells a token shape.
      const interleaved = Array.from(
        TEST_GITHUB_TOKEN,
        (character) => `${character}x`,
      ).join("");
      writeFile(root, "libexample.so", `\0${interleaved}\n`);
      const first = runStop(root, false);
      assert.equal(first.status, 2, first.stderr);
      assert.doesNotMatch(String(first.stderr), /blocked GitHub token/u);
      // Without a real finding, the unchanged retry may end the turn as for any clean binary.
      assert.equal(runStop(root, true).status, 0);
    });
  });

  it("checks a long run of label words quickly", () => {
    withTempRepo((root) => {
      // A run of repeated label words with no token once made the labelled-token pattern take minutes per window.
      writeFile(root, "labels.bin", `\0${"TOKEN".repeat(209_715)}\n`);
      const started = performance.now();
      const result = runStop(root, false);
      assert.equal(result.status, 2, result.stderr);
      assert.doesNotMatch(String(result.stderr), /budget/u);
      assert.ok(performance.now() - started < 15_000, "the Stop took too long");
    });
  });

  it("removes staged copies left behind by a killed earlier Stop", () => {
    withTempRepo((root) => {
      const scratch = mkdtempSync(join(tmpdir(), "goat-flow-staged-sweep-"));
      try {
        // An earlier hook was killed mid-scan (for example by a provider timeout), so its private copy stayed in the temp folder.
        const stale = join(scratch, "goat-flow-staged-blob-stale");
        mkdirSync(stale);
        writeFileSync(join(stale, "blob"), "stale staged copy\n");
        const hourAgo = new Date(Date.now() - 2 * 3_600_000);
        utimesSync(stale, hourAgo, hourAgo);
        writeFile(root, "scene.glb", BINARY_GLB_HEADER);
        runGit(root, ["add", "scene.glb"]);
        const environment = { TMPDIR: scratch, TMP: scratch, TEMP: scratch };
        assert.equal(runStop(root, false, environment).status, 2);
        assert.equal(existsSync(stale), false);
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    });
  });
});
