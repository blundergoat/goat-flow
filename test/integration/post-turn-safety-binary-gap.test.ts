/**
 * Real-Git regressions for secrets and stale identities behind binary coverage-gap releases.
 *
 * Each case stops the same fixture session more than once, the way an agent retries after a blocked Stop.
 * A secret must block every replay, and a binary that changes identity must not inherit an earlier release.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  TEST_API_TOKEN,
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
      "private key beside NUL",
      "asset.bin",
      `${TEST_PRIVATE_KEY_HEADER}\0\n`,
      "private key block",
    ],
    [
      "token beyond the digest chunk",
      "asset.bin",
      `\0${"a".repeat(1_048_560)}\n${TEST_API_TOKEN}\n`,
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
