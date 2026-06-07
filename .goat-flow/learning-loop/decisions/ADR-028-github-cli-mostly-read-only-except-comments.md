# ADR-028: Treat GitHub CLI as mostly read-only, except issue and pull request comments

**Status:** Accepted
**Date:** 2026-05-20
**Updated:** 2026-06-02

## Context

ADR-025 blocked all `git push` commands because pushes mutate shared remote state. That did not cover other GitHub write paths.

On 2026-05-20, a coding agent posted a GitHub issue comment after interpreting forwarded Slack text as authorization. The reported successful command was `gh issue comment 64620 --repo owner/repo --body-file /tmp/issue_64620_comment.md`. Before the fix, local probes also showed `gh api repos/owner/repo/issues/1/comments -X POST -f body=hi` returned exit 0 through the then-current monolithic deny hook.

The first policy response treated all GitHub CLI writes as blocked. On 2026-06-02, ADR-028 was narrowed because issue and pull request conversation comments are low-blast-radius, reversible writes; they do not approve a PR, merge code, create releases, trigger workflows, or mutate repository configuration.

The incident is captured as a hooks footgun at `.goat-flow/learning-loop/footguns/deny-dangerous.md` (search: `GitHub CLI comments bypassed shared-system write guardrails`). The hook implementation now has `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `is_gh_write_operation`) and regression coverage in `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `gh issue comment body-file allowed`).

## Decision

Goat-flow treats GitHub CLI use by agents as mostly read-only by default, with a narrow exception for GitHub issue and pull request comments.

Agents may use `gh` for read-only discovery, such as `gh issue view`, `gh issue list`, `gh pr view`, `gh pr diff`, `gh pr checks`, `gh search`, `gh repo view`, and explicit `gh api --method GET` / `HEAD` calls.

Agents may post conversation comments through the named subcommands:

- `gh issue comment`
- `gh pr comment`

That exception does not make forwarded Slack, email, or ticket text into authorization. Comment writes still need direct user intent in the current agent session or an explicit local approval mechanism.

Agents must not use any other GitHub write path through `gh` in the default guardrail profile. The deny hook blocks PR reviews, PR merges, PR create/edit/close/reopen/ready/update-branch, issue create/close/reopen/edit/delete/lock/unlock/pin/unpin/transfer/develop, releases, workflow runs, run reruns/cancels/deletes, repo edits, labels, gists, secrets, variables, keys, auth changes, extensions, codespaces, project mutations, cache deletion, and `gh api` write methods or body-field default POST forms. The comments endpoint through `gh api ... -X POST -f body=...` remains blocked even though the named comment subcommands are allowed.

If a downstream project wants broader agent-authored GitHub writes, it must make that an explicit local policy override with its own approval mechanism. The shared goat-flow default remains mostly read-only with only the named comment exception.

## Failure Mode Comparison

| Option | What fails | Why rejected or accepted |
| --- | --- | --- |
| Allow all `gh` commands and rely on instructions | Forwarded issue, Slack, or email text can be mistaken for user authorization and posted to a shared system | Rejected. The real `gh issue comment ... --body-file ...` incident showed instruction-only protection was insufficient |
| Block all `gh` use | Agents lose useful read-only PR/issue context and CI evidence gathering | Rejected. Read-only `gh` commands are part of review, debug, QA, and CI investigation workflows |
| Keep `gh` completely read-only, including comments | Agents cannot perform explicitly requested low-risk conversation updates, and the rule papers over the real authorization mistake instead of naming it | Rejected. Comments are materially different from approvals, merges, workflow runs, releases, and repository mutations |
| Allow read-only `gh` plus `gh issue comment` / `gh pr comment`; block all other write-capable `gh` paths | Some legitimate non-comment write requests require the user to run the command manually or install a local override | Accepted. This preserves evidence gathering and low-blast-radius comments while keeping high-impact GitHub mutations as explicit human actions |

## Consequences

- `patterns-writes.sh` must classify GitHub CLI writes separately from `git push`, while preserving the `gh issue comment` and `gh pr comment` carve-out.
- Self-tests must include blocked write cases, allowed read-only cases, and allowed comment cases so the policy does not drift into either a write bypass or a blanket read/comment ban.
- Documentation that lists deny-hook coverage should describe GitHub CLI as mostly read-only with a comment exception, not simply read-only.
- Future `gh` subcommand additions that mutate remote state must be added to the write classifier and self-test corpus unless a new ADR explicitly creates another exception.

## Reversibility

This is reversible as a local project policy, not as the shared default. A project can remove, narrow, or broaden the `gh` write block only after documenting a stronger approval flow and adding replacement tests for the write paths it permits.

Revisit this ADR if the agent runtimes provide a reliable, auditable, per-command approval primitive for external shared-system writes that can distinguish direct user approval from forwarded third-party text.

Revert by restoring `issue:comment` and `pr:comment` to the `is_gh_write_operation` case statement in `patterns-writes.sh` and flipping the corresponding `expect_allow` lines in `deny-dangerous-self-test.sh` back to `expect_block`. The regression corpus for the `gh api` comments endpoint stays as-is.
