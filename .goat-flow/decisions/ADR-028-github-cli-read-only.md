# ADR-028: Treat GitHub CLI as read-only for agents

**Status:** Amended (2026-06-02) - see Amendment below
**Date:** 2026-05-20

## Context

ADR-025 blocked all `git push` commands because pushes mutate shared remote state. That did not cover other GitHub write paths.

On 2026-05-20, a coding agent posted a GitHub issue comment after interpreting forwarded Slack text as authorization. The reported successful command was `gh issue comment 64620 --repo owner/repo --body-file /tmp/issue_64620_comment.md`. Before the fix, local probes also showed `gh api repos/owner/repo/issues/1/comments -X POST -f body=hi` returned exit 0 through the then-current monolithic deny hook.

The incident is captured as a hooks footgun at `.goat-flow/footguns/hooks.md` (search: `GitHub CLI comments bypassed shared-system write guardrails`). The hook implementation now has `workflow/hooks/hook-lib/patterns-writes.sh` (search: `is_gh_write_operation`) and regression coverage in `workflow/hooks/hook-lib/deny-dangerous-self-test.sh` (search: `gh issue comment body-file allowed`).

## Decision

Goat-flow treats GitHub CLI use by agents as read-only by default.

Agents may use `gh` for read-only discovery, such as `gh issue view`, `gh issue list`, `gh pr view`, `gh pr diff`, `gh pr checks`, `gh search`, `gh repo view`, and explicit `gh api --method GET` / `HEAD` calls.

Agents must not write to GitHub through `gh` in the default guardrail profile. The deny hook blocks issue/PR comments and mutations, releases, workflow runs, repo edits, labels, gists, secrets, variables, keys, auth changes, extensions, codespaces, project mutations, cache deletion, and `gh api` write methods or body-field default POST forms.

If a downstream project wants agent-authored GitHub writes, it must make that an explicit local policy override with its own approval mechanism. The shared goat-flow default remains read-only.

## Failure Mode Comparison

| Option | What fails | Why rejected or accepted |
| --- | --- | --- |
| Allow all `gh` commands and rely on instructions | Forwarded issue, Slack, or email text can be mistaken for user authorization and posted to a shared system | Rejected. The real `gh issue comment ... --body-file ...` incident showed instruction-only protection was insufficient |
| Block all `gh` use | Agents lose useful read-only PR/issue context and CI evidence gathering | Rejected. Read-only `gh` commands are part of review, debug, QA, and CI investigation workflows |
| Allow read-only `gh`; block write-capable `gh` | Some legitimate write requests require the user to run the command manually or install a local override | Accepted. This preserves evidence gathering while making shared-system writes an explicit human action |

## Consequences

- `patterns-writes.sh` must classify GitHub CLI writes separately from `git push`.
- Self-tests must include both blocked write cases and allowed read-only cases so the policy does not drift into either a write bypass or a blanket read ban.
- Documentation that lists deny-hook coverage should mention GitHub writes via `gh`, not only `git push`.
- Future `gh` subcommand additions that mutate remote state must be added to the write classifier and self-test corpus.

## Reversibility

This is reversible as a local project policy, not as the shared default. A project can remove or narrow the `gh` write block only after documenting a stronger approval flow and adding replacement tests for the write paths it permits.

Revisit this ADR if the agent runtimes provide a reliable, auditable, per-command approval primitive for external shared-system writes that can distinguish direct user approval from forwarded third-party text.

## Amendment (2026-06-02): Carve-out for `gh issue comment` and `gh pr comment`

The "Allow all `gh` commands" alternative remains rejected. The hook continues to block PR review/merge/close, issue create/close/edit/delete/lock/transfer, release writes, repo mutations, label writes, workflow runs, gist/secret/variable/key/auth/codespace/project mutations, cache deletion, and `gh api` non-GET/HEAD methods or body-field forms.

Two named subcommands are now allowed through `is_gh_write_operation`:

- `gh issue comment`
- `gh pr comment`

### Why narrow the policy now

The original incident command shape (`gh issue comment 64620 --repo owner/repo --body-file /tmp/issue_64620_comment.md`) is reopened by this amendment. The reasoning:

- The 2026-05-20 incident root cause was an agent treating forwarded Slack text as user authorization, not the existence of the `gh comment` surface. A blanket block on comment subcommands papers over that misjudgment by removing the tool; it does not teach the agent to refuse forwarded-authorization patterns.
- Comments are the lowest-blast-radius `gh` write: reversible (delete/edit), no code shipped, no branch protection bypassed, no CI triggered. This is materially different from `gh pr merge`, `gh pr review --approve`, `gh release create`, or `gh workflow run`, all of which remain blocked.
- The original ADR conflated "comments" with "writes" — but `gh pr review` (formal review that can satisfy branch protection) and `gh pr merge` (ships code) are a different threat model than a conversation comment.

### Compensating controls

- The hook still blocks the `gh api` write path, so an agent cannot reach the comments endpoint through `gh api ... -X POST -f body=...` even though `gh issue comment` is allowed. Asymmetric on purpose: the named subcommand surface is auditable and obvious in a transcript; arbitrary `api` writes are not.
- Comment writes still go through the host runtime's per-call permission prompt. The original ADR characterised this as insufficient on its own; it remains insufficient on its own. The carve-out is acceptable only because (a) the comment surface is low-stakes and reversible and (b) the prompt is the second line of defence, not the only one.
- All other `gh` write paths remain hook-blocked and require the user to run them manually.

### What stays blocked

`gh pr review`, `gh pr merge`, `gh pr create`, `gh pr edit`, `gh pr close/reopen/ready/update-branch`, `gh issue create`, `gh issue close/reopen/edit/delete/lock/unlock/pin/unpin/transfer/develop`, all release/repo/label/workflow/run/gist/secret/variable/ssh-key/gpg-key/auth/codespace/extension/project/cache write subcommands, and `gh api` POST/PUT/PATCH/DELETE or body-field-bearing calls.

### Reversibility of the amendment

Revert by restoring `issue:comment` and `pr:comment` to the `is_gh_write_operation` case statement in `patterns-writes.sh` and flipping the corresponding `expect_allow` lines in `deny-dangerous-self-test.sh` back to `expect_block`. The regression corpus for the `gh api` comments endpoint stays as-is.
