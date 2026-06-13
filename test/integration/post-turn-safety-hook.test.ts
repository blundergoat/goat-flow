/**
 * Integration tests for the universal post-turn safety hook.
 *
 * The hook must work in an arbitrary Git repository with no project-specific
 * toolchain configuration. These tests execute the shipped Bash script against
 * temporary repos instead of mocking the scanner.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const HOOK_PATH = resolve(PROJECT_ROOT, "workflow/hooks/post-turn-safety.sh");
const TEST_AWS_ACCESS_KEY = `AKIA${"1234567890ABCDEF"}`;
const TEST_PRIVATE_KEY_HEADER = ["-----BEGIN", "OPENSSH PRIVATE KEY-----"].join(
  " ",
);

function withTempRepo(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "goat-flow-post-turn-safety-"));
  try {
    runGit(root, ["init", "-q"]);
    writeFile(root, "README.md", "# fixture\n");
    commitAll(root, "initial");
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeFile(root: string, path: string, content: string | Buffer): void {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function runGit(root: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(
    result.status,
    0,
    `git ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result.stdout.trim();
}

function commitAll(root: string, message: string): void {
  runGit(root, ["add", "."]);
  runGit(root, [
    "-c",
    "user.name=goat-flow-test",
    "-c",
    "user.email=goat-flow-test@example.invalid",
    "commit",
    "-m",
    message,
  ]);
}

function runHook(root: string): ReturnType<typeof spawnSync> {
  return spawnSync("bash", [HOOK_PATH], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function assertHookAllows(root: string): void {
  const result = runHook(root);
  assert.equal(
    result.status,
    0,
    `hook should allow fixture\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
}

function assertHookBlocks(
  root: string,
  expectedPattern: RegExp,
): ReturnType<typeof spawnSync> {
  const result = runHook(root);
  assert.equal(
    result.status,
    2,
    `hook should block fixture\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.match(result.stderr, expectedPattern);
  assert.doesNotMatch(result.stderr, /validation/u);
  return result;
}

describe("post-turn-safety hook", () => {
  it("blocks high-confidence secrets in untracked text files", () => {
    withTempRepo((root) => {
      writeFile(root, ".env", `AWS_ACCESS_KEY_ID=${TEST_AWS_ACCESS_KEY}\n`);

      assertHookBlocks(root, /AWS access key/u);
    });
  });

  it("blocks private key blocks in tracked diffs", () => {
    withTempRepo((root) => {
      writeFile(root, "keys.txt", "safe\n");
      commitAll(root, "add key placeholder");
      writeFile(root, "keys.txt", `${TEST_PRIVATE_KEY_HEADER}\nabc\n`);

      assertHookBlocks(root, /private key block/u);
    });
  });

  it("blocks merge conflict markers in changed text", () => {
    withTempRepo((root) => {
      writeFile(root, "src/conflict.txt", "<<<<<<< HEAD\nleft\n=======\n");

      assertHookBlocks(root, /merge conflict marker/u);
    });
  });

  it("allows safe placeholders in env examples", () => {
    withTempRepo((root) => {
      writeFile(root, ".env.example", "API_KEY=your_api_key_here\n");

      assertHookAllows(root);
    });
  });

  it("detects new hazards added to files that were already dirty", () => {
    withTempRepo((root) => {
      writeFile(root, "settings.env", "API_KEY=your_api_key_here\n");
      const firstPass = runHook(root);
      assert.equal(firstPass.status, 0, firstPass.stderr);
      writeFile(
        root,
        "settings.env",
        `API_KEY=your_api_key_here\nAWS_ACCESS_KEY_ID=${TEST_AWS_ACCESS_KEY}\n`,
      );

      assertHookBlocks(root, /AWS access key/u);
    });
  });

  it("does not block unchanged committed content", () => {
    withTempRepo((root) => {
      writeFile(
        root,
        "legacy.env",
        `AWS_ACCESS_KEY_ID=${TEST_AWS_ACCESS_KEY}\n`,
      );
      commitAll(root, "legacy committed content");

      assertHookAllows(root);
    });
  });

  it("skips binary content and oversized files", () => {
    withTempRepo((root) => {
      writeFile(
        root,
        "binary.dat",
        Buffer.from([0, 1, 2, ...Buffer.from(TEST_AWS_ACCESS_KEY)]),
      );
      writeFile(
        root,
        "large.txt",
        `${"a".repeat(1024 * 1024 + 1)}\n${TEST_AWS_ACCESS_KEY}\n`,
      );

      assertHookAllows(root);
    });
  });

  it("allows rename and delete-only changes without content findings", () => {
    withTempRepo((root) => {
      writeFile(root, "old.txt", "safe\n");
      writeFile(root, "delete-me.txt", "safe\n");
      commitAll(root, "add files");
      runGit(root, ["mv", "old.txt", "new.txt"]);
      rmSync(join(root, "delete-me.txt"));

      assertHookAllows(root);
    });
  });

  it("the installed mirror matches the workflow hook source", () => {
    assert.equal(
      readFileSync(
        resolve(PROJECT_ROOT, ".goat-flow/hooks/post-turn-safety.sh"),
        "utf8",
      ),
      readFileSync(HOOK_PATH, "utf8"),
    );
  });
});
