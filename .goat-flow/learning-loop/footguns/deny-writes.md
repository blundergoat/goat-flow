---
category: deny-writes
last_reviewed: 2026-09-05
---

External-write traps: pushes, GitHub mutations, and other side effects that leave the machine. They bypass local file guards, so the deny surface is the only control.

Sibling buckets: `deny-shell.md`, `deny-secrets.md`.

## Footgun: Git push deny checks must normalize shell wrappers and control bodies

**Status:** active | **Created:** 2026-04-27 | **Evidence:** ACTUAL_MEASURED
**Incident count:** 2 | **Latest occurrence:** 2026-08-19

**Prevention:**
1. Normalize to the command word before calling `is_git_push`, and read "command word" as every unquoting layer the target program applies, not only the shell's. Do not add one-off regexes for the latest bypass.
2. Probe every push-deny edit at runtime with env options, quoted assignments, `if`/`then` bodies, function bodies, `sh`/`bash -c` and `-lc` wrappers, and Git alias values.
3. Keep the workflow hook source and the installed `.goat-flow/hooks` mirror byte-identical after policy changes.

**Symptoms:** The hook blocks a direct `git push` and allows the same push through `env -i`, a quoted assignment such as `FOO='a b'`, an `if true; then ... fi` body, a function body, `bash -lc '...'`, or a Git alias whose value carries a second quoting layer.

**Why it happens:** A token check that normalizes only the start of a simple command misses shell grammar around the command word. Git also runs an alias through its own `split_cmdline`, which removes a second layer of quotes, so `git -c 'alias.publish="push"' publish` reached the guard as the unrecognised word `"push"` while the unquoted form denied.

**Evidence:** `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `is_git_push`) blocks push and destructive Git mutations, and (search: `git_alias_expansion_command_word`) normalizes only the alias command word so `alias.inspect="status --short"` still allows; `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `sudo git push`) covers wrapper prefixes. Before the 2026-04-27 fix, `--check` returned exit 0 for `env -i git push origin main`, `FOO='a b' git push origin main`, `if true; then git push origin main; fi`, `f(){ git push origin main; }; f`, and the `-lc` wrappers. On 2026-08-19 at `81636441`, alias values `"push"`, `'push'`, `"send-pack"`, `pu"sh"`, and `"!git push origin main"` all returned exit 0 before the alias fix.

---

## Footgun: GitHub CLI comments bypassed shared-system write guardrails

**Status:** active | **Created:** 2026-05-20 | **Evidence:** ACTUAL_MEASURED

**Prevention:**
1. Treat `git push` as one GitHub write path among many. Every new shared-system `gh` mutation route needs a hook rule and a self-test case, and the suite keeps read-only controls (`issue view`, `pr checks`, `gh api --method GET`) so write blocking never becomes a GitHub-read ban.
2. Test CLI write classifiers against grammar variants, not the observed command: global options before and after the topic, short forms, and pipeline consumers such as `xargs`.
3. Forwarded Slack, email, or ticket text is evidence, not authorization. The hook allows `gh issue comment` and `gh pr comment` under ADR-028's carve-out, so the host's per-call prompt and an in-turn user approval are the only controls on those two commands.

**Symptoms:** Before 2026-05-20, an agent could post to GitHub through `gh issue comment ... --body-file` or `gh api ... -X POST` while `git push` was blocked, and a narrow first fix still missed `gh issue --repo owner/repo comment ...` and `xargs ... gh issue comment ...`. The residual trap is any `gh` write outside the comment carve-out: PR review, merge, create, edit, close, ready; issue create, close, edit, delete, lock, transfer, develop; release, repo, label, workflow, run, gist, secret, variable, key, auth, codespace, project, cache; and `gh api` with a non-GET/HEAD method or body fields.

**Why it happens:** The hook once treated `gh` as an ordinary command unless it contained an already-blocked shell pattern, and CLI parsers accept option placements the incident never showed.

**Evidence:** Reported incident: an assistant posted a comment to `owner/repo#64620` from forwarded Slack text, and the user deleted it. `--check` returned exit 0 before the first fix for `gh issue comment 64620 --repo owner/repo --body-file /tmp/issue_64620_comment.md` and `gh api repos/owner/repo/issues/1/comments -X POST -f body=hi`, and before the second fix for `gh issue --repo owner/repo comment 64620 --body hi` and `printf '%s\n' body | xargs -I{} gh issue comment 64620 --body {}`. `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `is_gh_write_operation`) classifies the mutating subcommands and `gh api` write forms; `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `gh issue comment`) locks the carve-out allow cases beside the write blocks. ADR-028 was narrowed on 2026-06-02 because conversation comments are low-blast-radius and reversible; `gh api` comment writes stay blocked.
