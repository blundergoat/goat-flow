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
const TEST_GITHUB_TOKEN = `ghp_${"abcdefghijklmnopqrsttestuvwxyzABCD"}`;
const TEST_SLACK_TOKEN = `xoxb-${"1234567890-1234567890-abcdef"}`;
const TEST_API_TOKEN = `sk-${"12345678901234567890123456789012"}`;
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

function withUnbornTempRepo(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "goat-flow-post-turn-safety-"));
  try {
    runGit(root, ["init", "-q"]);
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

  it("blocks real tokens on lines that also mention placeholder words", () => {
    withTempRepo((root) => {
      // The line contains "test", which previously short-circuited the whole
      // line past the raw token detectors and let the real token through.
      writeFile(root, "config.txt", `webhook_test = ${TEST_SLACK_TOKEN}\n`);

      assertHookBlocks(root, /Slack token/u);
    });
  });

  it("blocks API tokens when only the surrounding label is placeholder text", () => {
    withTempRepo((root) => {
      writeFile(root, "config.txt", `OPENAI test key ${TEST_API_TOKEN}\n`);

      assertHookBlocks(root, /API token/u);
    });
  });

  it("blocks bare sk-prefixed API tokens without a provider label", () => {
    withTempRepo((root) => {
      writeFile(root, "config.txt", `plain token ${TEST_API_TOKEN}\n`);

      assertHookBlocks(root, /API token/u);
    });
  });

  it("blocks exported credential assignments", () => {
    withTempRepo((root) => {
      writeFile(root, "env.txt", "export API_KEY=live-secret-value-12345\n");

      assertHookBlocks(root, /credential assignment \(API_KEY\)/u);
    });
  });

  it("blocks quoted credential assignments containing hash characters", () => {
    withTempRepo((root) => {
      writeFile(root, "env.txt", 'API_KEY="live-secret#value-12345"\n');

      assertHookBlocks(root, /credential assignment \(API_KEY\)/u);
    });
  });

  it("blocks lowercase credential assignment keys", () => {
    withTempRepo((root) => {
      writeFile(root, "env.txt", "api_key=live-secret-value-12345\n");

      assertHookBlocks(root, /credential assignment \(api_key\)/u);
    });
  });

  it("blocks token values with placeholder words embedded as ordinary characters", () => {
    withTempRepo((root) => {
      writeFile(root, "config.txt", `GITHUB_TOKEN=${TEST_GITHUB_TOKEN}\n`);

      assertHookBlocks(root, /GitHub token/u);
    });
  });

  it("allows documented example tokens whose value is a known placeholder", () => {
    withTempRepo((root) => {
      writeFile(
        root,
        "docs.md",
        [
          "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE",
          "SLACK_BOT_TOKEN=xoxb-test-1234567890-1234567890",
          "",
        ].join("\n"),
      );

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

  it("blocks staged-only secrets when the worktree copy is restored", () => {
    withTempRepo((root) => {
      writeFile(root, "settings.env", "API_KEY=your_api_key_here\n");
      commitAll(root, "add placeholder settings");
      writeFile(root, "settings.env", `API_KEY=${TEST_API_TOKEN}\n`);
      runGit(root, ["add", "settings.env"]);
      runGit(root, ["restore", "--worktree", "--source=HEAD", "settings.env"]);

      assertHookBlocks(root, /API token/u);
    });
  });

  it("blocks staged-only secrets before the first commit", () => {
    withUnbornTempRepo((root) => {
      writeFile(root, "config.env", `API_KEY=${TEST_API_TOKEN}\n`);
      runGit(root, ["add", "config.env"]);
      writeFile(root, "config.env", "API_KEY=your_api_key_here\n");

      assertHookBlocks(root, /API token/u);
    });
  });

  it("allows ignored env files that are not staged", () => {
    withTempRepo((root) => {
      writeFile(root, ".gitignore", ".env\n");
      commitAll(root, "ignore local env");
      writeFile(root, ".env", `AWS_ACCESS_KEY_ID=${TEST_AWS_ACCESS_KEY}\n`);

      assertHookAllows(root);
    });
  });

  it("blocks ignored env files once they are force-staged", () => {
    withTempRepo((root) => {
      writeFile(root, ".gitignore", ".env\n");
      commitAll(root, "ignore local env");
      writeFile(root, ".env", `AWS_ACCESS_KEY_ID=${TEST_AWS_ACCESS_KEY}\n`);
      runGit(root, ["add", "-f", ".env"]);

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
