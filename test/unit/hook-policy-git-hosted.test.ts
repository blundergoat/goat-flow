/** Verify native Git-hosted command discovery forwards each command Git would run, with its directory facts, to the evaluator. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  checkGitHostedCommands,
  inspectGitCommand,
  isGitPush,
  isGitCommit,
  isGitDestructive,
} from "../../workflow/hooks/deny-dangerous/git-command.mjs";
import { checkGitCommandEnvironment } from "../../workflow/hooks/policy-git.mjs";
import { normalizePolicyCommandCandidate } from "../../workflow/hooks/policy-syntax.mjs";

let home = "";
let repository = "";

before(() => {
  home = mkdtempSync(join(tmpdir(), "goat-hosted-home-"));
  repository = mkdtempSync(join(tmpdir(), "goat-hosted-repo-"));
  execFileSync("git", ["init", "--quiet", repository]);
  execFileSync("git", [
    "-C",
    repository,
    "config",
    "alias.wipe",
    "!rm -rf build",
  ]);
});

after(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(repository, { recursive: true, force: true });
});

/** Isolate saved-alias lookup from the developer's own Git configuration. */
function gitOptions() {
  return {
    directory: repository,
    deadlineAt: Date.now() + 10_000,
    homeDirectory: home,
    environment: { ...process.env, HOME: home, GIT_CONFIG_NOSYSTEM: "1" },
  };
}

/** Run the check with a recording evaluator that denies hosted commands naming `deny`. */
async function hosted(command: string, depth = 0) {
  const calls: string[] = [];
  const denial = await checkGitHostedCommands(
    command,
    depth,
    "destructive",
    gitOptions(),
    async (payload, nested, directory) => {
      const where = `${directory.directoryUnknown ? 1 : 0}${directory.hostedDirectoryUnknown ? 1 : 0}`;
      calls.push(`${payload}|${nested}|${where}`);
      return payload.includes("deny")
        ? { scope: "secret", reason: "nested" }
        : null;
    },
  );
  return { calls, denial };
}

describe("native Git-hosted commands", () => {
  it("forwards inline config, alias, bisect, submodule, difftool, grep, config and transport commands in reference order", async () => {
    for (const [command, calls] of [
      ["git -c core.pager='rm -rf x' log", ["rm -rf x|1|11"]],
      [
        "git -c alias.cleanup='!rm -rf build' cleanup now",
        ["rm -rf build now |1|00"],
      ],
      [
        "git -c alias.st=status st -s",
        ["git -c alias.st=status status -s |1|00"],
      ],
      ["git wipe now", ["rm -rf build now |1|00"]],
      ["git bisect run make test", ["make test |1|11"]],
      ["git bisect run ./check.sh", ["./check.sh|1|11"]],
      [
        "git submodule --quiet foreach --recursive 'git clean -fdx'",
        ["git clean -fdx|1|11"],
      ],
      ["git difftool -x 'rm -rf .' HEAD", ["rm -rf .|1|11"]],
      ["git grep -Ovim needle", ["vim ./__goat_git_grep_match__|1|11"]],
      ["git config core.pager 'less -R'", ["less -R|1|11"]],
      ["git fetch --upload-pack='rm -rf /' origin", ["rm -rf /|1|11"]],
      ["git clone ext::ssh-wrapper repo", ["ssh-wrapper|1|11"]],
    ] as const)
      assert.deepEqual(
        await hosted(command),
        { calls: [...calls], denial: null },
        command,
      );
  });

  it("leaves queries, data option values and non-Git commands uninspected", async () => {
    for (const command of [
      "git config --get core.pager",
      "git clone -b ext::not-a-command url",
      "git ls-remote --get-url ext::helper",
      "git status",
      "echo git -c core.pager=less log",
    ])
      assert.deepEqual(
        await hosted(command),
        { calls: [], denial: null },
        command,
      );
  });

  it("returns nested denials with their own scope and refuses what it cannot inspect with its own scope", async () => {
    assert.deepEqual(await hosted("git -c core.pager=deny log"), {
      calls: ["deny|1|11"],
      denial: { scope: "secret", reason: "nested" },
    });
    for (const [command, depth, reason] of [
      ["git clone 'ext::sh -c touch% /tmp/x' dir", 0, /escaped spaces/],
      ["git -c core.pager=less log", 8, /nesting exceeds inspection depth/],
      [
        "git --config-env=core.editor=EDITOR commit",
        0,
        /config-env may supply a command through core\.editor/,
      ],
      ["git -C '$root' wipe", 0, /dynamic directory change/],
    ] as const) {
      const result = await hosted(command, depth);
      assert.deepEqual(result.calls, [], command);
      assert.equal(result.denial?.scope, "destructive", command);
      assert.match(result.denial?.reason ?? "", reason, command);
    }
  });

  it("prepares env -S Git words so push is recognized and status is not", async () => {
    for (const [command, push] of [
      [`env -S '"git" push'`, true],
      [`env -S '"git" status'`, false],
    ] as const) {
      const normalized = normalizePolicyCommandCandidate(command) ?? "";
      const inspection = await inspectGitCommand(normalized, gitOptions());
      assert.equal(inspection.kind, "git", command);
      if (inspection.kind !== "git") throw new Error(command);
      assert.deepEqual(
        [
          isGitPush(inspection.context),
          isGitCommit(inspection.context),
          isGitDestructive(inspection.context),
        ],
        [push, false, false],
        command,
      );
    }
  });
});

/** Run the environment check with a recording evaluator that denies values naming `deny`. */
async function environment(raw: string, verb: string, depth = 0) {
  const calls: string[] = [];
  const denial = await checkGitCommandEnvironment(
    raw,
    verb,
    depth,
    async (payload, nested) => {
      calls.push(`${payload}|${nested}`);
      return payload.includes("deny")
        ? { scope: "secret", reason: "nested" }
        : null;
    },
  );
  return { calls, denial };
}

describe("native Git command environment", () => {
  it("forwards command-hosting prefix assignments of a Git command, including after env options", async () => {
    for (const [raw, verb, calls] of [
      ["GIT_SSH_COMMAND='ssh -i key' git fetch", "git", ["ssh -i key|1"]],
      [
        "env -u HOME GIT_EDITOR=vim EDITOR='rm -rf x' git commit",
        "git",
        ["vim|1", "rm -rf x|1"],
      ],
      ["env -- PAGER=less git log", "git", ["less|1"]],
      ["EDITOR=vim git-commit -m x", "git-commit", ["vim|1"]],
      ["GIT_PAGER= git log", "git", []],
      ["git log GIT_PAGER=less", "git", []],
      ["FOO=1 git log", "git", []],
    ] as const)
      assert.deepEqual(
        await environment(raw, verb),
        { calls: [...calls], denial: null },
        raw,
      );
  });

  it("forwards exported declarations only, and keeps the first nested denial", async () => {
    for (const [raw, verb, calls] of [
      ["export GIT_SSH_COMMAND='ssh -v'", "export", ["ssh -v|1"]],
      ["declare -x EDITOR=nano", "declare", ["nano|1"]],
      ["typeset -gx VISUAL=code", "typeset", ["code|1"]],
      ["declare EDITOR=nano", "declare", []],
      ["local -r EDITOR=nano", "local", []],
      ["echo GIT_PAGER=less", "echo", []],
    ] as const)
      assert.deepEqual(
        await environment(raw, verb),
        { calls: [...calls], denial: null },
        raw,
      );
    assert.deepEqual(
      await environment("PAGER=deny GIT_PAGER=later git log", "git", 2),
      { calls: ["deny|3"], denial: { scope: "secret", reason: "nested" } },
    );
  });
});
