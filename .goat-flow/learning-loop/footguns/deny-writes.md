---
category: deny-writes
last_reviewed: 2026-08-01
---

External-write traps: pushes, comments, and other side effects that leave the machine. These bypass local file guards entirely, so the deny surface is the only control.

Sibling buckets: `deny-shell.md`, `deny-secrets.md`.

## Footgun: Git push deny checks must normalize shell wrappers and control bodies

**Status:** active | **Created:** 2026-04-27 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A deny hook can appear to block `git push` while allowing valid shell forms that execute a push through environment wrappers, quoted assignments, `if`/`then` bodies, function bodies, or login-command wrappers such as `bash -lc 'git push ...'`.

**Why it happens:** A token check that only normalizes the start of a simple command misses shell grammar around the command word: `env -i git push ...` (env option after `env`), `FOO='a b' git push ...` (whitespace in an assignment value), `if true; then git push ...; fi` (segment starts with `then`), `f(){ git push ...; }; f` (segment starts with a function declaration).

**Evidence:**
- `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `is_git_push`) - current split hook blocks git push and destructive git mutations; `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `sudo git push`) - self-test coverage for wrapper-prefixed git push.
- Before the fix, `bash workflow/hooks/deny-dangerous/patterns-writes.sh --check <cmd>` returned exit 0 for: `'env -i git push origin main'`, `"FOO='a b' git push origin main"`, `'if true; then git push origin main; fi'`, `'f(){ git push origin main; }; f'`; and before the `-lc` fix: `"bash -lc 'git push origin main'"`, `"sh -lc 'git push origin main'"`.

**Prevention:**
1. Probe every `git push` deny edit at runtime for env options, quoted assignments, shell control keywords, function bodies, and `sh`/`bash -c` plus `-lc` wrappers, not only direct push and pipe/semicolon chains.
2. Keep the workflow hook source and installed `.goat-flow/hooks` mirror byte-identical after policy changes.
3. Prefer normalizing to the shell command word before calling `is_git_push`; don't add one-off regexes for the latest bypass only.

**Recurrence (2026-08-19):** The same class reappeared one layer down, in the alias *value* rather than the command line. `split_shell_words_into` removes the operand's outer shell quoting, but Git runs an alias through its own `split_cmdline`, which removes a second layer. So `git -c 'alias.publish="push"' publish` reached the guard as the unrecognised command word `"push"` and returned allow, while the visibly equivalent `git -c 'alias.publish=push' publish` denied. Measured at `81636441`: `"push"`, `'push'`, `"send-pack"`, `"push" origin main`, `pu"sh"`, and `"!git push origin main"` all returned exit 0. Fixed by normalizing only the alias command word in `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `git_alias_expansion_command_word`); benign `alias.inspect="status --short"` still allows. Prevention rule 3 above holds, but "the shell command word" must be read as *every* unquoting layer the target program applies, not just the one the shell performs.

---

## Footgun: GitHub CLI comments bypassed shared-system write guardrails

**Status:** active | **Created:** 2026-05-20 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A model can post to GitHub through `gh issue comment ... --body-file ...` even when `git push` is blocked and the hook catches heredoc command substitution: the guardrail stops the risky shape (`$(cat <<EOF ...)`) but allows the same write through a temporary body file. A narrow first fix still missed valid `gh` grammar variants: inherited flags after the topic (`gh issue --repo owner/repo comment ...`) and `xargs ... gh issue comment ...` pipeline consumers.

**Why it happens:** The deny hook historically treated `gh` as an ordinary command unless it contained an already-blocked shell pattern. GitHub issue comments, PR reviews, releases, workflow runs, secrets/variables, and `gh api` POST/PATCH/PUT/DELETE calls mutate shared systems without `git push`, so push-only protection is incomplete. CLI parsers also accept option placement and wrapper forms not obvious from the incident.

**Evidence:**
- Reported incident: an assistant posted a GitHub issue comment to `owner/repo#64620` from forwarded Slack text; the user deleted it and reported the command (see the first probe below).
- Runtime probes (`bash workflow/hooks/deny-dangerous/patterns-writes.sh --check ...`) returned exit 0 before the first fix for `"gh issue comment 64620 --repo owner/repo --body-file /tmp/issue_64620_comment.md"` and `"gh api repos/owner/repo/issues/1/comments -X POST -f body=hi"`; before the second fix for `"gh issue --repo owner/repo comment 64620 --body hi"` and `"printf '%s\n' body | xargs -I{} gh issue comment 64620 --body {}"`.
- `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `is_gh_write_operation`) - classifies known GitHub-mutating `gh` subcommands and `gh api` write/default-body POST forms; `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `gh issue comment`) - locks the current `gh issue comment` path plus read-only allow cases.

**Prevention:**
1. Treat `git push` as only one GitHub write path. Give every new shared-system GitHub mutation route both a hook rule and a self-test case.
2. For CLI write classifiers, test grammar variants, not only the observed command: global/inherited options before and after the topic, short option forms, pipeline consumers such as `xargs`, and read-only controls.
3. Keep explicit read-only `gh` cases in the self-test (`issue view`, `pr checks`, `gh api --method GET`) so write blocking doesn't become a blanket GitHub-read ban.
4. Forwarded Slack/email/ticket text is evidence, not authorization. The hook blocks mechanical `gh` writes; agents still need an in-turn user approval rule before any shared-system write path outside Bash.

**Amendment (2026-06-02):** ADR-028 narrowed - `gh issue comment` and `gh pr comment` are now allowed; all other `gh` writes stay blocked (PR review/merge/create/edit/close/ready, issue create/close/edit/delete/lock/transfer/develop, release/repo/label/workflow/run/gist/secret/variable/key/auth/codespace/project/cache, and `gh api` non-GET/HEAD or body-field forms). The carve-out reopens the 2026-05-20 incident command; the residual control is the host's per-call permission prompt. `gh api` writes stay blocked, so the comments endpoint via `gh api repos/.../issues/N/comments -X POST -f body=...` still trips the hook. See ADR-028 Amendment. Rule (4) stands: forwarded text is not authorization.

---
