/**
 * Shared fixture helpers for exercising the installer exactly as users run it.
 * Use these helpers when a test needs disposable projects, CLI processes, or
 * deterministic Git history without touching the developer's real workspace.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { getHookSpec } from "../../src/cli/server/hooks-registry.js";

export const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
export const disposables: string[] = [];
export const gitAvailable =
  spawnSync("git", ["--version"], {
    encoding: "utf-8",
  }).status === 0;
const postTurnSafetyHookSpec = getHookSpec("post-turn-safety");
assert.ok(
  postTurnSafetyHookSpec?.timeoutSec,
  "post-turn-safety must define the runner timeout used by installer tests",
);
/** Registry-owned Stop timeout the standalone installer must give users. */
export const POST_TURN_SAFETY_TIMEOUT_SECONDS =
  postTurnSafetyHookSpec.timeoutSec;

after(() => {
  for (const dir of disposables) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Create an isolated temp target project for installer side-effect assertions and register it
 * for teardown, so each test installs into a clean directory removed in the `after` hook.
 *
 * @returns the absolute path of the new temp project directory
 */
export function makeTempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "goat-flow-setup-install-"));
  disposables.push(root);
  return root;
}

/**
 * Run the shell installer (install-goat-flow.sh) synchronously against a target project, exactly
 * as users invoke setup --apply, so tests assert on the real script's exit and output. Spawns a
 * bash subprocess; the script itself writes scaffolding into root.
 *
 * @param root - target project directory passed as the installer's first argument
 * @param extraArgs - additional installer flags appended after the target (e.g. --dry-run)
 * @returns the spawnSync result (status, stdout, stderr) for the installer process
 */
export function runInstaller(root: string, ...extraArgs: string[]) {
  return runInstallerWithEnvironment(root, {}, ...extraArgs);
}

/**
 * Returns the Stop safety timeout a Claude user receives; undefined means no registration exists.
 * @param targetProjectPath - Non-empty installed project root; empty has no settings file to inspect.
 * @returns Configured seconds, or undefined when the user has no managed Stop command.
 */
export function readClaudePostTurnSafetyTimeout(
  targetProjectPath: string,
): number | undefined {
  const claudeSettings = JSON.parse(
    readFileSync(join(targetProjectPath, ".claude", "settings.json"), "utf-8"),
  ) as {
    hooks?: {
      Stop?: Array<{
        hooks?: Array<{ command?: string; timeout?: number }>;
      }>;
    };
  };
  const stopEventGroups = claudeSettings.hooks?.Stop ?? [];

  // Each group may contain a user hook or the managed Stop safety command.
  for (const stopEventGroup of stopEventGroups) {
    const commandEntries = stopEventGroup.hooks ?? [];
    // A matching command is the registration Claude will run after the user's turn.
    for (const commandEntry of commandEntries) {
      // Missing command text means this entry cannot be the managed safety hook.
      if (commandEntry.command?.includes("post-turn-safety.sh")) {
        return commandEntry.timeout;
      }
    }
  }
  return undefined;
}

/**
 * Run the shell installer with controlled environment overrides for failure-path fixtures.
 * Use when a user-visible installer outcome depends on a command or signal boundary.
 *
 * @param root - target project directory; an empty path is rejected by the installer
 * @param environmentOverrides - child-only values; an empty object preserves the caller environment
 * @param extraArgs - installer flags; an empty list runs the installer's normal validation path
 * @returns process evidence; null status means the operating system terminated the installer
 */
export function runInstallerWithEnvironment(
  root: string,
  environmentOverrides: NodeJS.ProcessEnv,
  ...extraArgs: string[]
) {
  return spawnSync(
    "bash",
    [
      join(PROJECT_ROOT, "workflow", "install-goat-flow.sh"),
      root,
      ...extraArgs,
    ],
    {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
      env: { ...process.env, ...environmentOverrides },
      timeout: 30000,
    },
  );
}

/**
 * Run the TypeScript CLI installer path (`cli.ts install`) synchronously via tsx against a temp
 * project, so tests cover the CLI entrypoint as well as the shell installer. Spawns a node
 * subprocess; the install command writes scaffolding into root.
 *
 * @param root - target project directory passed as the install command's argument
 * @param extraArgs - additional install flags appended after the target (e.g. --agents codex)
 * @returns the spawnSync result (status, stdout, stderr) for the CLI process
 */
export function runCliInstaller(root: string, ...extraArgs: string[]) {
  return spawnSync(
    "node",
    [
      "--import",
      "tsx",
      join(PROJECT_ROOT, "src", "cli", "cli.ts"),
      "install",
      root,
      ...extraArgs,
    ],
    {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
      timeout: 30000,
    },
  );
}

/**
 * Run git synchronously in a fixture repo with deterministic author/committer metadata, so
 * commit-dependent tests are reproducible. Spawns a git subprocess and asserts a zero exit,
 * reporting git's stderr on failure.
 *
 * @param root - working directory of the fixture repo the git command runs in
 * @param args - git argument vector (e.g. ["add", "history.txt"]) passed verbatim
 */
export function git(root: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf-8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "GOAT Test",
      GIT_AUTHOR_EMAIL: "goat@example.test",
      GIT_COMMITTER_NAME: "GOAT Test",
      GIT_COMMITTER_EMAIL: "goat@example.test",
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

/**
 * Append a line to the fixture's history.txt and commit it under the deterministic test identity,
 * building the commit history that upgrade-path tests replay. Writes the file and spawns git.
 *
 * @param root - working directory of the fixture repo to write and commit into
 * @param subject - the history line content and the commit message subject
 */
export function addCommit(root: string, subject: string): void {
  writeFileSync(join(root, "history.txt"), `${subject}\n`, { flag: "a" });
  git(root, ["add", "history.txt"]);
  git(root, ["commit", "-m", subject]);
}

export {
  after,
  describe,
  it,
  assert,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  tmpdir,
  join,
  resolve,
  spawnSync,
};
