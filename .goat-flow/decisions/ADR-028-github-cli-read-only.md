# ADR-028: Treat GitHub CLI as read-only for agents

**Status:** Implemented
**Date:** 2026-05-20

## Context

ADR-025 blocked all `git push` commands because pushes mutate shared remote state. That did not cover other GitHub write paths.

On 2026-05-20, a coding agent posted a GitHub issue comment after interpreting forwarded Slack text as authorization. The reported successful command was `gh issue comment 64620 --repo owner/repo --body-file /tmp/issue_64620_comment.md`. Before the fix, local probes also showed `gh api repos/owner/repo/issues/1/comments -X POST -f body=hi` returned exit 0 through the then-current monolithic deny hook.

The incident is captured as a hooks footgun at `.goat-flow/footguns/hooks.md` (search: `GitHub CLI comments bypassed shared-system write guardrails`). The hook implementation now has `workflow/hooks/hook-lib/patterns-writes.sh` (search: `is_gh_write_operation`) and regression coverage in `workflow/hooks/hook-lib/deny-dangerous-self-test.sh` (search: `gh issue comment body-file blocked`).

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
