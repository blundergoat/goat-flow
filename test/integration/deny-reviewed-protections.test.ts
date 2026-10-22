/** Regression coverage for reviewed Node protections and their ordinary-command controls. */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { copyHookTree, hookSelection } from "../helpers/hook-entrypoint.js";
import { checkInstalledPolicy } from "../helpers/check-installed-policy.js";

const envDirectoryFiles = [
  {
    path: "review-env/.git/config",
    content:
      "[core]\nrepositoryformatversion = 0\n[alias]\npub = push\nsafe = status\n",
  },
  { path: "review-env/.git/HEAD", content: "ref: refs/heads/main\n" },
  { path: "review-env/.git/objects/.keep", content: "" },
  { path: "review-env/.git/refs/.keep", content: "" },
] as const;

const cases = [
  {
    id: "comment-apostrophe-rm",
    gap: 11,
    command: "# Let's clean up\nrm -rf ~\necho done",
    expected: [2, 0],
  },
  {
    id: "comment-apostrophe-push",
    gap: 11,
    command: "echo hi # it's\ngit push --force origin main",
    expected: [0, 2],
  },
  {
    id: "comment-substitution-rm",
    gap: 11,
    command: "echo hi # $( ignored\nrm -rf ~",
    expected: [2, 0],
  },
  {
    id: "comment-quote-push",
    gap: 11,
    command: '# " ignored\ngit push origin main',
    expected: [0, 2],
  },
  {
    id: "substituted-subcommand",
    gap: 17,
    command: "git $(echo push) origin main",
    expected: [2, 2],
  },
  {
    id: "variable-subcommand",
    gap: 17,
    command: "cmd=push; git $cmd origin main",
    expected: [2, 2],
  },
  {
    id: "default-expansion",
    gap: 17,
    command: "git ${X:-push} origin main",
    expected: [2, 2],
  },
  {
    id: "assigned-git-executable",
    gap: 17,
    command: "g=git; $g push origin main",
    expected: [2, 2],
  },
  {
    id: "assigned-git-path",
    gap: 17,
    command: 'g=/usr/bin/git; "$g" push origin main',
    expected: [2, 2],
  },
  {
    id: "xargs-git-subcommand",
    gap: 17,
    command: "echo push | xargs git",
    expected: [2, 2],
  },
  {
    id: "literal-hash",
    gap: 0,
    command: "echo 'a#b'",
    expected: [0, 0],
  },
  {
    id: "quoted-comment",
    gap: 0,
    command: 'echo "it\'s # not a comment"',
    expected: [0, 0],
  },
  {
    id: "parameter-length",
    gap: 0,
    command: "var=abc; echo ${#var} $#",
    expected: [0, 0],
  },
  {
    id: "heredoc-comment",
    gap: 0,
    command: "cat <<'EOF'\n# it's inert\nEOF",
    expected: [0, 0],
  },
  {
    id: "git-log-format",
    gap: 0,
    command: 'git log --format="$fmt"',
    expected: [0, 0],
  },
  {
    id: "git-dynamic-directory",
    gap: 0,
    command: 'git -C "$dir" status',
    expected: [0, 0],
  },
  {
    id: "other-dynamic-executable",
    gap: 0,
    command: '"$DOCKER" push image',
    expected: [0, 0],
  },
  {
    id: "literal-dollar-subcommand",
    gap: 0,
    command: "git '$cmd'",
    expected: [0, 0],
  },
  {
    id: "escaped-dollar-subcommand",
    gap: 0,
    command: "git \\$cmd",
    expected: [0, 0],
  },
  {
    id: "reassigned-executable",
    gap: 0,
    command: "g=git; g=echo; $g push",
    expected: [0, 0],
  },
  {
    id: "ansi-escaped-quote-rm",
    gap: 12,
    command: "echo $'\\'' ; rm -rf ~ #'",
    expected: [2, 0],
  },
  {
    id: "ansi-executable-push",
    gap: 12,
    command: "$'git' push --force origin main",
    expected: [0, 2],
  },
  {
    id: "ansi-numeric-executable-rm",
    gap: 12,
    command: "$'\\162\\155' -rf ~",
    expected: [2, 0],
  },
  {
    id: "case-arm-rm",
    gap: 13,
    command: "case x in x) rm -rf ~;; esac",
    expected: [2, 0],
  },
  {
    id: "case-arm-push",
    gap: 13,
    command: "case x in x) git push origin main;; esac",
    expected: [0, 2],
  },
  {
    id: "arithmetic-reparse-rm",
    gap: 14,
    command: "echo $((rm -rf ~) )",
    expected: [2, 0],
  },
  {
    id: "arithmetic-reparse-push",
    gap: 14,
    command: "echo $((git push origin main) )",
    expected: [0, 2],
  },
  {
    id: "function-subshell-rm",
    gap: 15,
    command: "f() ( rm -rf ~ ); f",
    expected: [2, 0],
  },
  {
    id: "function-subshell-push",
    gap: 15,
    command: "f() ( git push origin main ); f",
    expected: [0, 2],
  },
  {
    id: "ansi-tab-data",
    gap: 0,
    command: "echo $'a\\tb'",
    expected: [0, 0],
  },
  {
    id: "ansi-quote-data",
    gap: 0,
    command: "echo $'it\\'s inert'",
    expected: [0, 0],
  },
  {
    id: "ansi-inside-double-quotes",
    gap: 0,
    command: "echo \"$'git'\"",
    expected: [0, 0],
  },
  {
    id: "case-arm-data",
    gap: 0,
    command: "case x in x) echo ok;; esac",
    expected: [0, 0],
  },
  {
    id: "ordinary-arithmetic",
    gap: 0,
    command: "echo $((1+2))",
    expected: [0, 0],
  },
  {
    id: "function-subshell-data",
    gap: 0,
    command: "f() ( echo ok ); f",
    expected: [0, 0],
  },
  {
    id: "sudo-role-rm",
    gap: 16,
    command: "sudo -r role rm -rf ~",
    expected: [2, 0],
  },
  {
    id: "sudo-type-push",
    gap: 16,
    command: "sudo -t type git push origin main",
    expected: [0, 2],
  },
  {
    id: "sudo-host-rm",
    gap: 16,
    command: "sudo -h remote rm -rf ~",
    expected: [2, 0],
  },
  {
    id: "sudo-unknown-option",
    gap: 16,
    command: "sudo --unknown value rm -rf ~",
    expected: [2, 2],
  },
  {
    id: "bash-shopt-rm",
    gap: 18,
    command: "bash -O globstar -c 'rm -rf ~'",
    expected: [2, 0],
  },
  {
    id: "bash-shopt-disable-push",
    gap: 18,
    command: "bash +O globstar -c 'git push origin main'",
    expected: [0, 2],
  },
  {
    id: "bash-rcfile-rm",
    gap: 18,
    command: "bash --rcfile x -c 'rm -rf ~'",
    expected: [2, 0],
  },
  {
    id: "bash-init-file-push",
    gap: 18,
    command: "bash --init-file x -c 'git push origin main'",
    expected: [0, 2],
  },
  {
    id: "env-directory-editor",
    gap: 21,
    command: "env -C /tmp GIT_EDITOR='rm -rf ~' git commit",
    expected: [2, 2],
  },
  {
    id: "env-long-directory-pager",
    gap: 21,
    command: "env --chdir /tmp GIT_PAGER='rm -rf ~' git log",
    expected: [2, 0],
  },
  {
    id: "send-email",
    gap: 19,
    command: "git send-email x.patch",
    expected: [0, 2],
  },
  {
    id: "failed-alias-lookup",
    gap: 20,
    command: "git pub",
    expected: [2, 2],
    environment: {
      GIT_CONFIG_COUNT: "-1",
    },
  },
  {
    id: "read-only-alias",
    gap: 0,
    command: "git safe",
    expected: [0, 0],
    environment: {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "alias.safe",
      GIT_CONFIG_VALUE_0: "status",
    },
  },
  {
    id: "publication-alias",
    gap: 0,
    command: "git pub",
    expected: [0, 2],
    environment: {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "alias.pub",
      GIT_CONFIG_VALUE_0: "push",
    },
  },
  {
    id: "missing-alias",
    gap: 0,
    command: "git pub",
    expected: [0, 0],
  },
  {
    id: "sudo-read",
    gap: 0,
    command: "sudo -u root ls",
    expected: [0, 0],
  },
  {
    id: "sudo-host-read",
    gap: 0,
    command: "sudo -h remote ls",
    expected: [0, 0],
  },
  {
    id: "bash-option-read",
    gap: 0,
    command: "bash -o pipefail -c 'echo ok'",
    expected: [0, 0],
  },
  {
    id: "env-directory-read",
    gap: 0,
    command: "env -C /tmp ls",
    expected: [0, 0],
  },
  {
    id: "format-patch-read",
    gap: 0,
    command: "git format-patch -1",
    expected: [0, 0],
  },
  {
    id: "later-case-arm-rm",
    gap: 13,
    command: "case x in nope) echo safe;; x) rm -rf ~;; esac",
    expected: [2, 0],
  },
  {
    id: "later-case-arm-push",
    gap: 13,
    command: "case x in nope) echo safe;; x) git push origin main;; esac",
    expected: [0, 2],
  },
  {
    id: "attached-quoted-sudo-rm",
    gap: 16,
    command: "sudo -p'hello world' rm -rf ~",
    expected: [2, 0],
  },
  {
    id: "later-case-arm-read",
    gap: 0,
    command: "case x in nope) echo safe;; x) echo ok;; esac",
    expected: [0, 0],
  },
  {
    id: "attached-quoted-sudo-read",
    gap: 0,
    command: "sudo -p'hello world' echo ok",
    expected: [0, 0],
  },
  {
    id: "quoted-paren-executable",
    gap: 0,
    command: "'name)literal' --help",
    expected: [0, 0],
  },
  {
    id: "escaped-space-rm",
    gap: 11,
    command: "echo foo\\ #literal; rm -rf ~",
    expected: [2, 0],
  },
  {
    id: "escaped-space-push",
    gap: 11,
    command: "echo foo\\ #literal; git push origin main",
    expected: [0, 2],
  },
  {
    id: "escaped-space-control",
    gap: 0,
    command: "echo foo\\ #literal; git status",
    expected: [0, 0],
  },
  {
    id: "real-comment-control",
    gap: 11,
    command: "echo ok # rm -rf ~; git push origin main",
    expected: [0, 0],
  },
  {
    id: "wrapped-assigned-command",
    gap: 17,
    command: "g=git; command $g push origin main",
    expected: [2, 2],
  },
  {
    id: "wrapped-assigned-env",
    gap: 17,
    command: "g=git; env $g push origin main",
    expected: [2, 2],
  },
  {
    id: "wrapped-assigned-sudo",
    gap: 17,
    command: "g=git; sudo $g push origin main",
    expected: [2, 2],
  },
  {
    id: "declared-assigned-git",
    gap: 17,
    command: "export g=git; $g push origin main",
    expected: [2, 2],
  },
  {
    id: "redirected-assigned-git",
    gap: 17,
    command: "g=git; >out $g push origin main",
    expected: [2, 2],
  },
  {
    id: "block-assigned-git",
    gap: 17,
    command: "{ g=git; }; $g push origin main",
    expected: [2, 2],
  },
  {
    id: "subshell-assigned-git",
    gap: 17,
    command: "g=git; ( $g push origin main )",
    expected: [2, 2],
  },
  {
    id: "declared-assigned-control",
    gap: 0,
    command: "export g=echo; command $g push origin main",
    expected: [0, 0],
  },
  {
    id: "quoted-assigned-control",
    gap: 0,
    command: "g=git; '$g' push origin main",
    expected: [0, 0],
  },
  {
    id: "xargs-path-git",
    gap: 17,
    command: "echo push | xargs /usr/bin/git",
    expected: [2, 2],
  },
  {
    id: "xargs-quoted-git",
    gap: 17,
    command: 'echo push | xargs "git"',
    expected: [2, 2],
  },
  {
    id: "xargs-git-global",
    gap: 17,
    command: "echo push | xargs git --no-pager",
    expected: [2, 2],
  },
  {
    id: "xargs-git-directory",
    gap: 17,
    command: "echo push | xargs git -C .",
    expected: [2, 2],
  },
  {
    id: "xargs-git-read",
    gap: 0,
    command: "echo HEAD | xargs git --no-pager log",
    expected: [0, 0],
  },
  {
    id: "xargs-git-version",
    gap: 0,
    command: "echo push | xargs git --version",
    expected: [0, 0],
  },
  {
    id: "case-quoted-subject",
    gap: 13,
    command: "case ')' in ')') git push origin main;; esac",
    expected: [0, 2],
  },
  {
    id: "case-optional-opener",
    gap: 13,
    command: "case x in nope) echo ok;; (x) rm -rf ~;; esac",
    expected: [2, 0],
  },
  {
    id: "case-newline-opener",
    gap: 13,
    command: "case x in\n(x) git push origin main;; esac",
    expected: [0, 2],
  },
  {
    id: "case-spaced-alternatives",
    gap: 13,
    command: "case b in nope) echo ok;; a | b) rm -rf ~;; esac",
    expected: [2, 0],
  },
  {
    id: "case-quoted-read",
    gap: 0,
    command: "case ')' in ')') git status;; esac",
    expected: [0, 0],
  },
  {
    id: "case-spaced-read",
    gap: 0,
    command: "case b in\n(a | b) echo ok;; esac",
    expected: [0, 0],
  },
  {
    id: "ordinary-subshell-control",
    gap: 0,
    command: "( echo ok )",
    expected: [0, 0],
  },
  {
    id: "split-env-pager",
    gap: 21,
    command: "env -S \"-i GIT_PAGER='rm -rf ~' git log\"",
    expected: [2, 0],
  },
  {
    id: "split-env-editor",
    gap: 21,
    command: "env --split-string=\"-i GIT_EDITOR='rm -rf ~' git commit\"",
    expected: [2, 2],
  },
  {
    id: "split-env-read",
    gap: 0,
    command: "env -S \"-i GIT_PAGER='cat' git log\"",
    expected: [0, 0],
  },
  {
    id: "bash-plus-rm",
    gap: 18,
    command: "bash +x -c 'rm -rf ~'",
    expected: [2, 0],
  },
  {
    id: "sh-plus-push",
    gap: 18,
    command: "sh +e -c 'git push origin main'",
    expected: [0, 2],
  },
  {
    id: "bash-plus-read",
    gap: 0,
    command: "bash +x -c 'echo ok'",
    expected: [0, 0],
  },
  {
    id: "shell-end-options-control",
    gap: 18,
    command: "bash -- -c 'git push origin main'",
    expected: [0, 0],
  },
  {
    id: "ansi-control-nul-git",
    gap: 12,
    command: "$'git\\c@ignored' push origin main",
    expected: [0, 2],
  },
  {
    id: "ansi-control-nul-rm",
    gap: 12,
    command: "$'rm\\c@ignored' -rf ~",
    expected: [2, 0],
  },
  {
    id: "ansi-control-read",
    gap: 0,
    command: "echo $'a\\cAb'",
    expected: [0, 0],
  },
  {
    id: "nice-assigned-git",
    gap: 17,
    command: 'g=git; nice -n 5 "$g" push origin main',
    expected: [2, 2],
  },
  {
    id: "exec-assigned-git",
    gap: 17,
    command: 'g=git; exec "$g" push origin main',
    expected: [2, 2],
  },
  {
    id: "nice-literal-variable",
    gap: 0,
    command: "g=git; nice -n 5 '$g' push origin main",
    expected: [0, 0],
  },
  {
    id: "nice-escaped-variable",
    gap: 0,
    command: "g=git; nice -n 5 \\$g push origin main",
    expected: [0, 0],
  },
  {
    id: "variable-as-data",
    gap: 0,
    command: 'g=git; echo "$g" push origin main',
    expected: [0, 0],
  },
  {
    id: "case-half-spaced-alternatives",
    gap: 13,
    command: "case b in a| b) git push origin main;; esac",
    expected: [0, 2],
  },
  {
    id: "nested-exported-git",
    gap: 17,
    command: "export g=git; bash -c '$g push origin main'",
    expected: [2, 2],
  },
  {
    id: "pipeline-assigned-git",
    gap: 17,
    command: "g=git; echo x | $g push origin main",
    expected: [2, 2],
  },
  {
    id: "forwarded-assigned-git",
    gap: 17,
    command: 'g=git; bash -c \'"$@"\' _ "$g" push origin main',
    expected: [2, 2],
  },
  {
    id: "nested-reassigned-control",
    gap: 0,
    command: "export g=git; bash -c 'g=echo; $g push origin main'",
    expected: [0, 0],
  },
  {
    id: "nested-reassignment-is-local",
    gap: 17,
    command: "g=git; bash -c 'g=echo; echo done'; $g push origin main",
    expected: [2, 2],
  },
  {
    id: "subshell-assignment-is-local",
    gap: 0,
    command: "g=echo; (g=git; echo ok); $g push origin main",
    expected: [0, 0],
  },
  {
    id: "subshell-reassignment-restored",
    gap: 17,
    command: "g=git; (g=echo; echo ok); $g push origin main",
    expected: [2, 2],
  },
  {
    id: "ansi-shell-leading-expansion-git",
    gap: 12,
    command: "bash -c $'$IFS git push origin main'",
    expected: [2, 2],
  },
  {
    id: "ansi-shell-leading-expansion-rm",
    gap: 12,
    command: "bash -c $'$IFS rm -rf ~'",
    expected: [2, 2],
  },
  {
    id: "ansi-shell-data-control",
    gap: 0,
    command: "bash -c $'echo \"$g\"'",
    expected: [0, 0],
  },
  {
    id: "forwarded-literal-variable",
    gap: 0,
    command: "g=git; bash -c '\"$@\"' _ '$g' push origin main",
    expected: [0, 0],
  },
  {
    id: "forwarded-quoted-data",
    gap: 0,
    command: "bash -c '\"$@\"' _ echo 'git push; rm -rf ~'",
    expected: [0, 0],
  },
  {
    id: "env-cwd-short-alias",
    gap: 21,
    command: "env -C review-env git pub",
    expected: [0, 2],
    files: envDirectoryFiles,
  },
  {
    id: "env-cwd-long-alias",
    gap: 21,
    command: "env --chdir review-env git pub",
    expected: [0, 2],
    files: envDirectoryFiles,
  },
  {
    id: "env-cwd-attached-alias",
    gap: 21,
    command: "env --chdir='review-env' git pub",
    expected: [0, 2],
    files: envDirectoryFiles,
  },
  {
    id: "env-cwd-split-alias",
    gap: 21,
    command: 'env -S "-C review-env git pub"',
    expected: [0, 2],
    files: envDirectoryFiles,
  },
  {
    id: "env-cwd-nested-alias",
    gap: 21,
    command: "env -C review-env env --chdir=. git pub",
    expected: [0, 2],
    files: envDirectoryFiles,
  },
  {
    id: "env-cwd-read-alias",
    gap: 0,
    command: "env -C review-env git safe",
    expected: [0, 0],
    files: envDirectoryFiles,
  },
  {
    id: "env-cwd-does-not-leak",
    gap: 0,
    command: "env -C review-env git status; git pub",
    expected: [0, 0],
    files: envDirectoryFiles,
  },
  {
    id: "env-cwd-git-directory-alias",
    gap: 21,
    command: "env -C review-env git -C . pub",
    expected: [0, 2],
    files: envDirectoryFiles,
  },
  {
    id: "env-cwd-pipeline-read",
    gap: 0,
    command: "env -C review-env git safe | cat",
    expected: [0, 0],
    files: envDirectoryFiles,
  },
  {
    id: "env-cwd-shell-alias",
    gap: 21,
    command: "env -C review-env bash -c 'git pub'",
    expected: [0, 2],
    files: envDirectoryFiles,
  },
] as const;

describe(
  "reviewed Node policy protections",
  { skip: hookSelection() !== "candidate" },
  () => {
    const project = mkdtempSync(join(tmpdir(), "goat-reviewed-policy-"));
    const hooks = join(project, ".goat-flow/hooks");
    mkdirSync(hooks, { recursive: true });
    copyHookTree(hooks);
    const gitConfig = join(project, "global.gitconfig");
    writeFileSync(gitConfig, "");
    after(() => rmSync(project, { recursive: true, force: true }));
    for (const fixture of cases) {
      for (const [index, policy] of (
        ["deny-dangerous", "deny-git-mutations"] as const
      ).entries()) {
        it(`${policy}: ${fixture.id}`, () => {
          if ("files" in fixture) {
            for (const file of fixture.files) {
              const destination = join(project, file.path);
              mkdirSync(dirname(destination), { recursive: true });
              writeFileSync(destination, file.content);
            }
          }
          const result = checkInstalledPolicy(
            join(hooks, `${policy}.sh`),
            project,
            fixture.command,
            {
              ...process.env,
              GIT_CONFIG_GLOBAL: gitConfig,
              GIT_CONFIG_NOSYSTEM: "1",
              ...("environment" in fixture ? fixture.environment : {}),
            },
          );
          assert.equal(result.status, fixture.expected[index], result.stderr);
          assert.equal(result.stdout, "");
          assert.doesNotMatch(result.stderr, /Policy hook unavailable/u);
          if (fixture.expected[index] === 2)
            assert.match(result.stderr, /BLOCKED: Policy/u);
          else assert.equal(result.stderr, "");
        });
      }
    }
  },
);
