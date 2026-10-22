/** Verify native Git write rules, recovery controls and command context against retained policy cases. */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  cobraBooleanFlagEnabled,
  isGitLfsWriteTarget,
  isGitPublicationTarget,
  normalizeGitAliasExpansion,
  isGitPublicationAliasConfig,
  gitArgumentsAreOneOf,
  gitFlagsWithin,
  gitArgumentsInclude,
  gitOptionPresent,
  isGitCommitTarget,
  isGitDestructiveTarget,
  gitPathspecsNameBulk,
  GitAliasState,
  recordGitAliasConfig,
  resetGitAliasFlags,
  isGitBuiltinWord,
} from "../../workflow/hooks/deny-dangerous/patterns-writes.mjs";
import {
  normalizeGitPushCandidate,
  normalizeGitPolicyCandidate,
  resolveGitInvokedAliasCommand,
  inspectGitCommand,
  isGitPush,
  isGitLfsLockMutation,
  isGitCommit,
  isGitDestructive,
  checkGitSegment,
} from "../../workflow/hooks/deny-dangerous/git-command.mjs";
import { splitPolicyShellWords } from "../../workflow/hooks/policy-words.mjs";

// Inputs and outcomes retained from the frozen policy self-test's LFS cases.
const lfsCases: ReadonlyArray<
  readonly [string, "publication" | "history" | "locks", boolean]
> = [
  ["lfs pre-push origin", "publication", true],
  ["lfs pre-push --dry-run --dry-run=false origin", "publication", true],
  ["lfs pre-push --help=false origin", "publication", true],
  ["lfs pre-push origin -- --dry-run", "publication", true],
  ["lfs pre-push --dry-run origin", "publication", false],
  ["lfs pre-push --dry-run=false -d=true origin", "publication", false],
  ["lfs pre-push --help", "publication", false],
  ["lfs lock assets/model.bin", "locks", true],
  ["lfs unlock --force assets/model.bin", "locks", true],
  ["lfs unlock --id --help", "locks", true],
  ["lfs lock -r --help assets/model.bin", "locks", true],
  ["lfs unlock -i --help", "locks", true],
  ["lfs lock --help=false assets/model.bin", "locks", true],
  ["lfs lock --help", "locks", false],
  ["lfs locks --verify", "locks", false],
  ["lfs ls-files", "publication", false],
  ["lfs push origin main", "publication", true],
  ["lfs push --dry-run --dry-run=false origin main", "publication", true],
  ["lfs push -d -d=false origin main", "publication", true],
  ["lfs push origin main -- --dry-run", "publication", true],
  ["lfs push origin main --help=false", "publication", true],
  ['lfs push origin "main --dry-run"', "publication", true],
  ["lfs push --dry-run origin main", "publication", false],
  ["lfs --dry-run push origin main", "publication", false],
  ["lfs push -ad origin main", "publication", false],
  ["lfs push --dry-run=false -d=true origin main", "publication", false],
  ["lfs push --help", "publication", false],
  ["lfs status", "publication", false],
  ["lfs fetch origin main", "publication", false],
  ["lfs migrate import --everything --include='*.bin'", "history", true],
  ["lfs migrate export --everything --include='*.bin'", "history", true],
  ["lfs migrate import --no-rewrite file.bin", "history", true],
  ["lfs migrate --include '*.bin' import --everything", "history", true],
  ["lfs migrate -yI info import --everything", "history", true],
  [
    'lfs migrate import --no-rewrite --message="text --help" file.bin',
    "history",
    true,
  ],
  ["lfs migrate import --no-rewrite -m --help file.bin", "history", true],
  ["lfs migrate import --help --help=false --everything", "history", true],
  ["lfs migrate info", "history", false],
  ["lfs migrate -I import info", "history", false],
  ["lfs migrate import --help", "history", false],
  ["lfs migrate export -h", "history", false],
];

describe("native repository write primitives", () => {
  it("retains Cobra flag ordering, value ownership and terminators", () => {
    for (const [command, expected] of [
      ["lfs push --dry-run --dry-run=false origin main", false],
      ["lfs push -d -d=false origin main", false],
      ["lfs push --dry-run=false -d=true origin main", true],
      ["lfs push -ad origin main", true],
      ["lfs push origin main -- --dry-run", false],
    ] as const) {
      assert.equal(
        cobraBooleanFlagEnabled(
          splitPolicyShellWords(command),
          "dry-run",
          "d",
          "--include --exclude --message --remote --id",
          "IXmri",
        ),
        expected,
        command,
      );
    }
    for (const [command, expected] of [
      ["lfs unlock --id --help", false],
      ["lfs lock -r --help assets/model.bin", false],
      ["lfs unlock -i --help", false],
      ["lfs lock --help=false assets/model.bin", false],
      ["lfs lock --help", true],
    ] as const) {
      assert.equal(
        cobraBooleanFlagEnabled(
          splitPolicyShellWords(command),
          "help",
          "h",
          "--include --exclude --message --remote --id",
          "IXmri",
        ),
        expected,
        command,
      );
    }
  });

  it("retains LFS publication, history and lock decisions with read-only controls", () => {
    for (const [command, kind, expected] of lfsCases) {
      const words = splitPolicyShellWords(command);
      assert.equal(isGitLfsWriteTarget(command, kind), expected, command);
      assert.equal(
        isGitLfsWriteTarget("", kind, { mode: "direct", commandWords: words }),
        expected,
        command,
      );
      assert.equal(
        isGitLfsWriteTarget("", kind, {
          mode: "alias",
          invokedAliasWords: words,
        }),
        expected,
        command,
      );
      assert.equal(
        isGitLfsWriteTarget(command, kind, { mode: "strict" }),
        false,
        command,
      );
    }
  });

  it("recognizes publication verbs and preserves LFS previews", () => {
    for (const command of [
      "push origin main",
      "send-pack origin main",
      "http-push origin main",
      "svn dcommit",
      "p4 submit",
      "subtree push",
      "!git push origin main",
    ])
      assert.equal(isGitPublicationTarget(command), true, command);
    for (const command of [
      "status",
      "log",
      "show",
      "lfs push --dry-run origin main",
    ])
      assert.equal(isGitPublicationTarget(command), false, command);
  });

  it("reveals Git alias quoting without treating other config as publication", () => {
    for (const [raw, normalized] of [
      ['"push"', "push"],
      ["'push'", "push"],
      ['"send-pack"', "send-pack"],
      ['"push" origin main', "push origin main"],
      ['pu"sh"', "push"],
      ['"!git push origin main"', "!git push origin main"],
    ] as const) {
      assert.equal(normalizeGitAliasExpansion(raw), normalized, raw);
      assert.equal(
        isGitPublicationAliasConfig(`alias.publish=${raw}`),
        true,
        raw,
      );
    }
    assert.equal(isGitPublicationAliasConfig('alias.publish="push\n"'), true);
    assert.equal(isGitPublicationAliasConfig("alias.inspect=status"), false);
    assert.equal(isGitPublicationAliasConfig("core.pager=push"), false);
  });

  it("keeps exact recovery arguments and checks flags after embedded newlines", () => {
    assert.equal(gitArgumentsAreOneOf("--abort", "--abort --quit"), true);
    assert.equal(
      gitArgumentsAreOneOf("--abort --quit", "--abort --quit"),
      false,
    );
    assert.equal(gitArgumentsAreOneOf("", "--abort --quit"), false);
    assert.equal(
      gitFlagsWithin("--no-ff --no-commit topic", "--no-ff --no-commit"),
      true,
    );
    assert.equal(
      gitFlagsWithin("--no-ff\n--commit topic", "--no-ff --no-commit"),
      false,
    );
    assert.equal(
      gitArgumentsInclude("--no-ff --no-commit topic", "--no-commit"),
      true,
    );
    assert.equal(
      gitArgumentsInclude("--no-ff --no-commit=off", "--no-commit"),
      false,
    );
  });
});

describe("Git option matching", () => {
  it("preserves prefix and bundle parsing without consuming quoted values as flags", () => {
    for (const [args, expected] of [
      ["-fq", true],
      ["--forc", true],
      ["-- --force", false],
      ["-bfix", false],
      ["--format=short", false],
    ] as const)
      assert.equal(
        gitOptionPresent(args, "f", "force", 1, "b"),
        expected,
        args,
      );
    assert.equal(
      gitOptionPresent("", "f", "force", 1, "e", "exclude", [
        "clean",
        "-e",
        "text --force",
        "safe",
      ]),
      false,
    );
    assert.equal(
      gitOptionPresent("", "f", "force", 1, "e", "exclude", [
        "clean",
        "--exc",
        "--force",
        "safe",
      ]),
      false,
    );
    assert.equal(
      gitOptionPresent("", "f", "force", 1, "e", "exclude", [
        "clean",
        "-e",
        "pattern",
        "--force",
      ]),
      true,
    );
  });
});

// Frozen Bash history decisions, including exemptions owned by the separate destructive policy.
const historyWriteCases: ReadonlyArray<readonly [string, boolean, boolean]> = [
  ["commit-tree HEAD^{tree} -m x", true, true],
  ["update-ref refs/heads/example HEAD", true, true],
  ["cherry-pick HEAD", true, true],
  ["revert HEAD", true, true],
  ["am change.patch", true, true],
  ["cherry-pick --no-commit HEAD", false, true],
  ["revert -n HEAD", false, true],
  ["am --abort", false, true],
  ["merge topic", true, true],
  ["rebase main", true, true],
  ["pull --no-rebase origin main", true, true],
  ["merge --abort", false, true],
  ["rebase --abort", false, true],
  ["subtree push --prefix=src origin main", true, true],
  ["subtree --prefix=src push origin main", true, true],
  ["subtree add --prefix=vendor origin main", true, true],
  ["subtree -h", false, true],
  ["notes add -m x HEAD", true, true],
  ["notes list", false, false],
  ["checkout -- src", false, false],
  ["notes $notes_mode", true, true],
  ["notes --ref=review add -m checked HEAD", true, true],
  ["notes --ref review add -m checked HEAD", true, true],
  ["notes --ref list add -m checked HEAD", true, true],
  ["notes prune --dry-run --no-dry-run", true, true],
  ["notes merge --abort --commit", true, true],
  ["notes", false, false],
  ["notes --ref review", false, false],
  ["notes --ref=review show HEAD", false, false],
  ["notes get-ref", false, false],
  ["notes --help", false, false],
  ["notes --ref review --help", false, false],
  ["notes --ref=review add -h", false, false],
  ["notes prune --dry-run --verbose", false, false],
  ["notes merge --abort", false, false],
  ["stash $notes_mode", true, true],
  ["stash", true, true],
  ["stash list", false, false],
  ["stash show -p", false, false],
  ["stash apply", false, false],
  ["stash push -h", false, false],
  ["commit -m x", true, true],
  ["reset --hard HEAD~1", false, false],
  ["reset --soft HEAD~3", true, true],
  ["reset HEAD~3 --", true, true],
  ["reset HEAD --", false, false],
  ["reset --mixed HEAD~1", true, true],
  ["reset HEAD", false, false],
  ["reset --mixed HEAD", false, false],
  ["reset -q HEAD", false, false],
  ["reset HEAD src/app.ts", false, false],
  ["reset HEAD~1 -- src/app.ts", false, false],
  ["branch -f main HEAD~3", true, true],
  ["branch -C previous main", true, true],
  ["branch --copy --force previous main", true, true],
  ["branch -c previous copy", false, false],
  ["branch -m previous renamed", false, false],
  ["symbolic-ref HEAD refs/heads/other", true, true],
  ["symbolic-ref refs/heads/main refs/heads/other", true, true],
  ["symbolic-ref --delete refs/heads/main", true, true],
  ["symbolic-ref HEAD", false, false],
  ["symbolic-ref --quiet --short HEAD", false, false],
  ["replace --graft HEAD HEAD~5", true, true],
  ["replace -l", false, false],
  ["replace --list --format=long", false, false],
  ["checkout -B main HEAD~2", true, true],
  ["switch -C main HEAD~2", true, true],
  ["fetch origin +main:main", true, true],
  [
    "fetch --refmap +refs/heads/main:refs/heads/probe-branch origin main",
    true,
    true,
  ],
  [
    "fetch --refm +refs/heads/main:refs/heads/probe-branch origin main",
    true,
    true,
  ],
  ["fetch --stdin origin", true, true],
  ["fetch --std origin", true, true],
  ["reset HEAD -- src/app.ts", false, false],
  ["branch --list", false, false],
  ["checkout -b feature", false, false],
  ["fetch origin main", false, false],
  ["fetch git@example.invalid:team/repo.git main", false, false],
  [
    "fetch --refmap +refs/heads/main:refs/remotes/origin/main git@example.invalid:team/repo.git main",
    false,
    false,
  ],
  ["fetch --depth 1 git@example.invalid:team/repo.git main", false, false],
  ["fetch --multiple origin git@example.invalid:team/repo.git", false, false],
  ["merge --no-commit topic", true, true],
  ["merge --no-ff --no-commit topic", false, true],
  ["merge --squash topic", false, true],
  ["merge --squash --no-squash topic", true, true],
  ["merge -m 'note --abort' topic", true, true],
  ["merge --continue", true, true],
  ["rebase --continue", true, true],
  ["rebase --show-current-patch", false, true],
  ["pull --ff-only origin main", true, true],
  ["pull --rebase origin main", true, true],
  ["cherry-pick -n --commit HEAD", true, true],
  ["am --show-current-patch=diff", false, true],
  ["filter-branch --force --index-filter true HEAD", true, true],
  ["filter-repo --path src", true, true],
  ["fast-import --force", true, true],
  ["merge -h", false, true],
  ["rebase --help", false, true],
  ["filter-branch --help", false, true],
  ["merge -h topic", true, true],
  ["worktree remove --force ../other", false, false],
  ["worktree add -B main ../other HEAD~3", true, true],
  ["worktree add -qBmain ../other HEAD~3", true, true],
  ["worktree list", false, false],
  ["worktree add -b new ../other HEAD", false, false],
  ["worktree add -bBmain ../other HEAD", false, false],
  ["worktree add --lock --reason 'branch -B' ../other HEAD", false, false],
  ["worktree add --lock --reason -B ../other HEAD", false, false],
  ["worktree add -h", false, false],
  ["checkout -- .", false, false],
  ["checkout -f main", false, false],
  ["switch --discard-changes main", false, false],
  ["checkout main", false, false],
  ["checkout -- src/app.ts", false, false],
  ["switch -c feature", false, false],
  ["stash drop", false, false],
  ["stash clear", false, false],
  ["stash pop", true, true],
  ["checkout -fq main", false, false],
  ["checkout --forc main", false, false],
  ["switch --discard main", false, false],
  ["checkout -bfix", false, false],
  ["switch --detach main", false, false],
  ["checkout -- '*'", false, false],
  ["checkout -- src/..", false, false],
  ["checkout --pathspec-from-f paths.txt", false, false],
  ['checkout -- "src/routes/[slug]/+page.svelte"', false, false],
  ["checkout .gitignore", false, false],
  ["stash drop -h", false, false],
  ['checkout -- "\\$(git ls-files -m)"', false, false],
  ["checkout \\$(git rev-parse --abbrev-ref HEAD@{-1})", false, false],
];

describe("native Git history rules", () => {
  it("preserves history writes and exact recovery exemptions for direct commands and strict aliases", () => {
    for (const [command, expected, strictExpected] of historyWriteCases) {
      assert.equal(isGitCommitTarget(command), expected, command);
      assert.equal(
        isGitCommitTarget(command, { mode: "strict" }),
        strictExpected,
        command,
      );
    }
  });
  it("retains original worktree argument boundaries", () => {
    for (const [command, expected] of historyWriteCases) {
      if (!command.startsWith("worktree ")) continue;
      assert.equal(
        isGitCommitTarget(command, {
          mode: "direct",
          commandWords: splitPolicyShellWords(command),
        }),
        expected,
        command,
      );
    }
  });
});

// Direct and original-argv results preserve the frozen clean/exclude distinction.
const destructiveCases: ReadonlyArray<readonly [string, boolean, boolean]> = [
  ["prune", true, true],
  ["gc --prune=now", true, true],
  ["prune --dry-run", false, false],
  ["gc -h", false, false],
  ["restore src", true, true],
  ["checkout -- src", true, true],
  ["stash $notes_mode", false, false],
  ["stash", false, false],
  ["stash list", false, false],
  ["stash show -p", false, false],
  ["stash apply", false, false],
  ["stash push -h", false, false],
  ["commit -m x", false, false],
  ["reset --hard HEAD~1", true, true],
  ["reset --soft HEAD~3", false, false],
  ["reset HEAD~3 --", false, false],
  ["reset HEAD --", false, false],
  ["reset --mixed HEAD~1", false, false],
  ["reset HEAD", false, false],
  ["reset --mixed HEAD", false, false],
  ["reset -q HEAD", false, false],
  ["reset HEAD src/app.ts", false, false],
  ["reset HEAD~1 -- src/app.ts", false, false],
  ["tag -d v1.0.0", true, true],
  ["tag -f v1.0.0 HEAD~3", true, true],
  ["tag -l", false, false],
  ["tag new-tag", false, false],
  ["submodule deinit -f --all", true, true],
  ["submodule update --force --recursive", true, true],
  ["submodule update --init --recursive", false, false],
  ["remote remove origin", true, true],
  ["remote -v remove origin", true, true],
  ["remote -v", false, false],
  ["submodule foreach 'git clean -fd'", false, false],
  ["submodule foreach 'git status --short'", false, false],
  ["checkout -B main HEAD~2", false, false],
  ["switch -C main HEAD~2", false, false],
  ["reset HEAD -- src/app.ts", false, false],
  ["checkout -b feature", false, false],
  ["clean -fd", true, true],
  ["clean --for -d", true, true],
  ["clean --forc", true, true],
  ["clean -d --fo -x", true, true],
  ["clean --f -d", true, true],
  ["clean -qdf", true, true],
  ["clean -dfq", true, true],
  ["clean -nf", true, true],
  ["clean -e --for --forc", true, true],
  ['clean --exclude "--for --fo" --f', true, true],
  ["clean -ndx", false, false],
  ["clean -- --force", false, false],
  ["clean -efolder", false, false],
  ["clean -qe --for", true, false],
  ["clean -e --for", true, false],
  ["clean --exclude --for", false, false],
  ["clean --ex=--for", false, false],
  ['clean --ex "--for --fo"', false, false],
  ["restore .", true, true],
  ["rm -rf .", true, true],
  ["checkout-index -a -f", true, true],
  ["read-tree -u --reset HEAD", true, true],
  ["worktree remove --force ../other", true, true],
  ["worktree add -B main ../other HEAD~3", false, false],
  ["worktree add -qBmain ../other HEAD~3", false, false],
  ["rm -n -rf .", false, false],
  ["rm --cached src/app.ts", false, false],
  ["checkout-index -n -a", false, false],
  ["worktree list", false, false],
  ["worktree add -b new ../other HEAD", false, false],
  ["worktree add -bBmain ../other HEAD", false, false],
  ["worktree add --lock --reason 'branch -B' ../other HEAD", false, false],
  ["worktree add --lock --reason -B ../other HEAD", false, false],
  ["worktree add -h", false, false],
  ["restore --source=HEAD -- :/", true, true],
  ["restore --staged --worktree .", true, true],
  ["restore --staged .", false, false],
  ["restore src/app.ts", false, false],
  ["checkout -- .", true, true],
  ["checkout -f main", true, true],
  ["switch --discard-changes main", true, true],
  ["checkout main", false, false],
  ["checkout -- src/app.ts", false, false],
  ["switch -c feature", false, false],
  ["stash drop", true, true],
  ["stash clear", true, true],
  ["stash pop", false, false],
  ["reflog expire --expire=now --all", true, true],
  ["reflog delete HEAD@{1}", true, true],
  ["reflog show", false, false],
  ["checkout -fq main", true, true],
  ["checkout --forc main", true, true],
  ["switch --discard main", true, true],
  ["restore -S -qW .", true, true],
  ["restore --staged --work .", true, true],
  ["checkout -bfix", false, false],
  ["switch --detach main", false, false],
  ["restore ':(top)'", false, false],
  ["restore '*'", true, true],
  ["restore ./.", true, true],
  ["restore .//", true, true],
  ["restore \\$'.'", false, false],
  ["checkout -- '*'", true, true],
  ["restore --pathspec-from-file=paths.txt", true, true],
  ["restore $PWD", true, true],
  ["restore --staged ':(top)'", false, false],
  ["restore src/..", true, true],
  ["checkout -- src/..", true, true],
  ["restore src/./cli/../..", true, true],
  ["restore $PWD/src/..", true, true],
  ["restore src/../README.md", false, false],
  ["restore --staged src/..", false, false],
  ["restore --pathspec-fr=paths.txt", true, true],
  ["checkout --pathspec-from-f paths.txt", true, true],
  ["restore --staged --pathspec-from-f=paths.txt", false, false],
  ["restore -- --pathspec-from-f=paths.txt", false, false],
  ['restore "app/[id]/page.tsx"', false, false],
  ['checkout -- "src/routes/[slug]/+page.svelte"', false, false],
  ["restore 'pages/[...slug].tsx'", false, false],
  ["restore ':(literal)app/[id]/page.tsx'", false, false],
  ["restore ':/src/app.ts'", false, false],
  ["restore ':(top)src/app.ts'", false, false],
  ["restore ':(icase)README.md'", false, false],
  ["restore ':!src'", false, false],
  ["restore ':/!src'", false, false],
  ["restore ':(exclude)src'", false, false],
  ["restore ':(glob)**/*.ts'", true, true],
  ["restore ':(attr:binary)'", false, false],
  ["restore 'src/*.ts'", true, true],
  ["restore ../README.md", false, false],
  ["checkout .gitignore", false, false],
  ["stash drop -h", false, false],
  ["reflog expire --help", false, false],
  ["restore \\$(git diff --name-only)", true, true],
  ['checkout -- "\\$(git ls-files -m)"', true, true],
  ['restore "\\$PWD"', false, false],
  ["checkout \\$(git rev-parse --abbrev-ref HEAD@{-1})", false, false],
  ["restore --source \\$(git merge-base main HEAD) src/a.ts", false, false],
];

const pathspecCases: ReadonlyArray<readonly [string, string, boolean]> = [
  ["restore", "src/app.ts", false],
  ["checkout", "src/app.ts", false],
  ["restore", "src", true],
  ["checkout", "src", true],
  ["restore", "app/[id]/page.tsx", false],
  ["checkout", "app/[id]/page.tsx", false],
  ["restore", ".", true],
  ["checkout", ".", true],
  ["restore", "..", true],
  ["checkout", "..", true],
  ["restore", "src/..", true],
  ["checkout", "src/..", true],
  ["restore", ":(literal)*", false],
  ["checkout", ":(literal)*", false],
  ["restore", ":(glob)*", true],
  ["checkout", ":(glob)*", true],
  ["restore", ":(top)src/app.ts", false],
  ["checkout", ":(top)src/app.ts", false],
  ["restore", ":!src/app.ts", true],
  ["checkout", ":!src/app.ts", true],
  ["restore", "$PWD/src", true],
  ["checkout", "$PWD/src", true],
  ["restore", "$HOME/src", true],
  ["checkout", "$HOME/src", true],
];

describe("native destructive rules and alias state", () => {
  it("preserves destructive decisions and original quoted option values", () => {
    const root = mkdtempSync(join(tmpdir(), "goat-writes-"));
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "app", "[id]"), { recursive: true });
    const context = {
      homeDirectory: root,
      commandDirectory: root,
      selectedDirectory: root,
    };
    try {
      for (const [command, expected, originalExpected] of destructiveCases) {
        assert.equal(
          isGitDestructiveTarget(command, undefined, context),
          expected,
          command,
        );
        assert.equal(
          isGitDestructiveTarget(
            command,
            splitPolicyShellWords(command),
            context,
          ),
          originalExpected,
          command,
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("preserves pathspec scope without treating dynamic route brackets as a glob", () => {
    const root = mkdtempSync(join(tmpdir(), "goat-pathspecs-"));
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "app", "[id]"), { recursive: true });
    const context = {
      homeDirectory: root,
      commandDirectory: root,
      selectedDirectory: root,
    };
    try {
      for (const [verb, args, expected] of pathspecCases)
        assert.equal(
          gitPathspecsNameBulk(verb, args, context),
          expected,
          `${verb} ${args}`,
        );
      const dynamic = {
        ...context,
        selectedDirectoryUnknown: true,
        unknownDirectory: false,
      };
      assert.equal(gitPathspecsNameBulk("restore", "file.ts", dynamic), true);
      assert.equal(dynamic.unknownDirectory, true);
      const pwd = {
        ...context,
        commandDirectoryUnknown: true,
        unknownDirectory: false,
      };
      assert.equal(gitPathspecsNameBulk("restore", "$PWD/file.ts", pwd), true);
      assert.equal(pwd.unknownDirectory, true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("retains guarded alias classes, raw expansions and reset isolation", () => {
    const state = new GitAliasState();
    recordGitAliasConfig('alias.Publish="push"', state);
    recordGitAliasConfig("alias.hard=reset --hard", state);
    recordGitAliasConfig("alias.inspect=status", state);
    recordGitAliasConfig("core.pager=push", state);
    assert.deepEqual(
      [state.push, state.commit, state.destructive],
      [true, false, true],
    );
    assert.equal(state.expansions.get("publish"), "push");
    assert.equal(state.rawExpansions.get("publish"), '"push"');
    assert.equal(state.expansions.has("pager"), false);
    assert.equal(isGitBuiltinWord("status"), true);
    assert.equal(isGitBuiltinWord("publish"), false);
    resetGitAliasFlags(state);
    assert.deepEqual(
      [state.push, state.commit, state.destructive],
      [false, false, false],
    );
    assert.equal(state.expansions.size, 0);
    assert.equal(state.rawExpansions.size, 0);
  });
});

const gitContextEnvironment = {
  ...process.env,
  GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

describe("Git invocation normalization", () => {
  it("uses the shared normalizer and exposes xargs payloads without hiding uncertainty", () => {
    assert.equal(
      normalizeGitPushCandidate("sudo -n git push origin main"),
      "git push origin main",
    );
    assert.equal(
      normalizeGitPolicyCandidate("xargs -0 -a paths git status"),
      "git status",
    );
    assert.equal(normalizeGitPolicyCandidate("git status\n"), "git status");
    assert.equal(
      normalizeGitPolicyCandidate("xargs --unknown flags git push"),
      null,
    );
  });
  it("appends visible alias arguments while retaining their original boundaries", () => {
    const aliases = new GitAliasState();
    recordGitAliasConfig("alias.Publish=lfs push --dry-run", aliases);
    assert.deepEqual(
      resolveGitInvokedAliasCommand(
        "Publish --dry-run=false main --help",
        ["Publish", "--dry-run=false", "main --help"],
        aliases,
      ),
      {
        command: "lfs push --dry-run --dry-run=false main --help",
        words: ["lfs", "push", "--dry-run", "--dry-run=false", "main --help"],
      },
    );
    assert.equal(
      resolveGitInvokedAliasCommand("missing", ["missing"], aliases),
      null,
    );
    assert.equal(
      resolveGitInvokedAliasCommand("bad.name", ["bad.name"], aliases),
      null,
    );
  });
});

describe("Git command context", () => {
  it("checks downstream pipeline writes and preserves human-owned worktree removal", async () => {
    const options = {
      directory: process.cwd(),
      deadlineAt: Date.now() + 5000,
      environment: gitContextEnvironment,
    };
    const context = { verb: "git", hasRedirect: false, hasPipe: false };
    assert.equal(await checkGitSegment("git status", options, context), null);
    assert.equal(
      await checkGitSegment("echo evidence | git push origin main", options, {
        ...context,
        hasPipe: true,
      }),
      "Git publication is not allowed. Ask the user to push manually.",
    );
    assert.equal(
      await checkGitSegment("git commit -m ready", options, context),
      "git commit is not allowed. Ask the user to commit manually.",
    );
    assert.equal(
      await checkGitSegment("git --unknown status", options, context),
      "Unrecognised Git global option: the hook cannot tell which Git command runs. Drop the option or ask the user to run the command manually.",
    );
    assert.equal(
      await checkGitSegment(
        "git worktree remove --force branch",
        options,
        context,
      ),
      "Git worktree removal is not allowed. Leave the worktree and its contents intact; ask the user to review and remove it manually.",
    );
    assert.equal(
      await checkGitSegment("git worktree list", options, context),
      null,
    );
  });
  it("preserves direct and inline-alias write decisions without confusing quoted option values", async () => {
    const rows: ReadonlyArray<readonly [string, readonly boolean[]]> = [
      ["git status", [false, false, false, false]],
      ["git push origin main", [true, false, false, false]],
      ['git commit -m "hello --help"', [false, false, true, false]],
      ["git reset --hard", [false, false, false, true]],
      ["git lfs push --dry-run origin", [false, false, false, false]],
      ["git lfs lock file", [false, true, false, false]],
      ["git lfs unlock --help", [false, false, false, false]],
      ["git -c alias.p=push status", [true, false, false, false]],
      ["git -c alias.a=stash a clear", [false, false, true, true]],
      ["git -c alias.a=fetch a origin main:main", [false, false, true, false]],
      [
        "git -c \"alias.cl=clean -e '--for --fo'\" cl",
        [false, false, false, false],
      ],
      [
        "git -c \"alias.cl=clean -e '--for --fo'\" cl -f",
        [false, false, false, true],
      ],
    ];
    for (const [command, expected] of rows) {
      const result = await inspectGitCommand(command, {
        directory: process.cwd(),
        deadlineAt: Date.now() + 5000,
        environment: gitContextEnvironment,
      });
      assert.equal(result.kind, "git", command);
      if (result.kind !== "git") throw new Error(command);
      assert.deepEqual(
        [
          isGitPush(result.context),
          isGitLfsLockMutation(result.context),
          isGitCommit(result.context),
          isGitDestructive(result.context),
        ],
        expected,
        command,
      );
    }
  });
  it("retains option order, command payloads and uncertainty for the policy owner", async () => {
    const options = {
      directory: process.cwd(),
      deadlineAt: Date.now() + 5000,
      environment: gitContextEnvironment,
    };
    const result = await inspectGitCommand(
      "git -C '$root' -C /literal -c credential.helper= -c 'core.pager=git push' --config-env=core.editor=EDITOR --unknown status",
      options,
    );
    assert.equal(result.kind, "git");
    if (result.kind !== "git") throw new Error("missing Git context");
    assert.equal(result.context.paths.selectedDirectory, "/literal");
    assert.equal(result.context.paths.selectedDirectoryUnknown, false);
    assert.deepEqual(result.context.inlineCommands, ["git push"]);
    assert.equal(result.context.unresolvedConfigEnvKey, "core.editor");
    assert.equal(result.context.unknownGlobalOption, "--unknown");
    assert.deepEqual(result.context.commandWords, ["status"]);
    assert.equal(
      (await inspectGitCommand("echo git push", options)).kind,
      "other",
    );
    const dynamic = await inspectGitCommand("git -C '$root' saved", options);
    assert.equal(dynamic.kind, "unresolved");
    if (dynamic.kind === "unresolved")
      assert.match(dynamic.reason, /dynamic directory change/);
    const expired = await inspectGitCommand("git saved", {
      ...options,
      deadlineAt: 0,
    });
    assert.equal(expired.kind, "unresolved");
    if (expired.kind === "unresolved") assert.match(expired.reason, /deadline/);
  });
  it("reads real repository aliases with visible arguments and leaves the repository unchanged", async () => {
    const directory = mkdtempSync(join(tmpdir(), "goat-saved-alias-"));
    try {
      execFileSync("git", ["init", "--quiet", directory]);
      execFileSync("git", ["-C", directory, "config", "alias.saved", "stash"]);
      const before = execFileSync(
        "git",
        ["-C", directory, "config", "--local", "--list"],
        { encoding: "utf8" },
      );
      const result = await inspectGitCommand("git saved clear", {
        directory,
        deadlineAt: Date.now() + 5000,
      });
      assert.equal(result.kind, "git");
      if (result.kind !== "git") throw new Error("missing saved alias context");
      assert.equal(result.context.aliases.rawExpansions.get("saved"), "stash");
      assert.equal(isGitDestructive(result.context), true);
      const absent = await inspectGitCommand("git absent", {
        directory,
        deadlineAt: Date.now() + 5000,
      });
      assert.equal(absent.kind, "git");
      if (absent.kind !== "git")
        throw new Error("missing absent alias context");
      assert.deepEqual(
        [
          isGitPush(absent.context),
          isGitCommit(absent.context),
          isGitDestructive(absent.context),
        ],
        [false, false, false],
      );
      assert.equal(
        execFileSync("git", ["-C", directory, "config", "--local", "--list"], {
          encoding: "utf8",
        }),
        before,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
