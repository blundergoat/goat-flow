# ADR-028: Treat GitHub CLI as mostly read-only, except issue and pull request comments

**Status:** Accepted
**Date:** 2026-05-20
**Updated:** 2026-09-05 - condensed. The 2026-06-02 amendment narrowed the original all-writes block to allow the two comment subcommands.

## Context

ADR-025 blocked pushes because they mutate shared remote state, but it did not cover other GitHub write paths. On 2026-05-20 a coding agent posted an issue comment after treating forwarded Slack text as authorization; the command was `gh issue comment 64620 --repo owner/repo --body-file /tmp/issue_64620_comment.md`, and local probes showed `gh api repos/owner/repo/issues/1/comments -X POST -f body=hi` also passed the then-monolithic hook. The incident is recorded in `.goat-flow/learning-loop/footguns/deny-writes.md` (search: `GitHub CLI comments bypassed shared-system write guardrails`).

The first response blocked all GitHub CLI writes. It was narrowed on 2026-06-02 because issue and pull-request conversation comments are low-blast-radius, reversible writes that approve nothing, merge nothing, release nothing, and change no configuration.

## Decision

Agents may use `gh` read-only plus `gh issue comment` and `gh pr comment`; every other `gh` write path is blocked by default.

- Read-only discovery is allowed: `gh issue view`, `gh issue list`, `gh pr view`, `gh pr diff`, `gh pr checks`, `gh search`, `gh repo view`, and explicit `gh api --method GET` or `HEAD` calls.
- The comment exception does not turn forwarded Slack, email, or ticket text into authorization. Comment writes need direct user intent in the current session or an explicit local approval mechanism.
- The hook (`workflow/hooks/deny-dangerous/patterns-writes.sh`, search: `is_gh_write_operation`) blocks PR reviews, merges, create/edit/close/reopen/ready/update-branch, issue create/close/reopen/edit/delete/lock/unlock/pin/unpin/transfer/develop, releases, workflow runs and reruns/cancels/deletes, repo edits, labels, gists, secrets, variables, keys, auth changes, extensions, codespaces, project mutations, cache deletion, and `gh api` write methods or body-field default POST forms. The comments endpoint through `gh api ... -X POST -f body=...` stays blocked even though the named subcommands are allowed.
- A downstream project that wants broader agent-authored writes makes that an explicit local override with its own approval mechanism.

## Failure Mode Comparison

| Option | What fails | Verdict |
| --- | --- | --- |
| Allow all `gh` and rely on instructions | Forwarded text gets mistaken for authorization and posted to a shared system; the incident showed prose alone was insufficient | Rejected |
| Block all `gh` | Review, debug, QA, and CI investigation lose PR, issue, and check evidence | Rejected |
| Read-only including comments | Explicitly requested low-risk conversation updates become impossible, and the rule hides the real authorization mistake instead of naming it | Rejected |
| Read-only plus the two comment subcommands | Other legitimate writes need the user to run the command or install a local override | Accepted |

## Consequences

- `patterns-writes.sh` classifies GitHub CLI writes separately from pushes while preserving the comment carve-out; self-tests cover blocked writes, allowed reads, and allowed comments (`workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh`, search: `gh issue comment body-file allowed`).
- Documentation describes GitHub CLI as mostly read-only with a comment exception, not simply read-only.
- New `gh` subcommands that mutate remote state join the write classifier and self-test corpus unless a new ADR creates another exception.

## Reversibility

Reversible as a local project policy, not as the shared default, and only with a documented stronger approval flow plus replacement tests. Revisit if the runtimes provide an auditable per-command approval primitive that distinguishes direct user approval from forwarded text. To revert the comment carve-out, restore `issue:comment` and `pr:comment` to the `is_gh_write_operation` case statement and flip the matching `expect_allow` self-test lines back to `expect_block`; the `gh api` comments-endpoint corpus stays.
