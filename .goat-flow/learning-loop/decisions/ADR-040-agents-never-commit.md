# ADR-040: Agents never commit repository changes

**Status:** Accepted
**Date:** 2026-07-12

## Context

Goat-flow already blocks all agent `git push` operations under ADR-025. The installed deny hook at `.goat-flow/hooks/deny-dangerous/patterns-writes.sh` (search: `git commit is not allowed`) and Claude settings at `.claude/settings.json` (search: `Bash(*git commit*)`) also categorically block `git commit`, but the shared instruction files said `Commit unless asked`. That wording implied a direct request could authorize the agent to commit even though enforcement had no approval path.

The project owner resolved the ambiguity on 2026-07-12: coding agents must never run `git commit` and must never run `git push`. The user performs both operations manually after reviewing the working tree. `docs/coding-standards/git-commit.md` remains useful for humans and for agents drafting a suggested message, but it defines message format only and grants no execution authority.

## Decision

Coding agents must never execute `git commit` in this project. A direct user request to commit does not create an exception; the agent must leave the working tree uncommitted and hand the commit step back to the user.

ADR-025 continues to govern `git push`: agents never push any branch or ref. Together, these decisions reserve repository-history creation and remote publication for the user.

Agents may still inspect status and diffs, prepare working-tree changes within their approved scope, and draft a conventional commit message for the user. This ADR does not make staging or other local Git operations permissible when a separate instruction or hook prohibits them.

## Failure Mode Comparison

| Option | What fails | Why rejected or accepted |
| --- | --- | --- |
| Allow commits after a direct request | Instruction prose and categorical enforcement disagree; the agent can mutate repository history when the owner expects a review handoff | Rejected |
| Block commits mechanically but leave permission wording ambiguous | Users and agents cannot tell whether the hook or instruction is stale | Rejected |
| Never allow agents to commit; the user commits manually | Adds one manual step but leaves repository history under direct human control and aligns prose with enforcement | Accepted |

## Consequences

- `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, and the setup reference must state the unconditional commit and push prohibition.
- The existing categorical commit and push hook behavior remains correct and must not gain an agent approval bypass.
- Commit-message guidance remains canonical under ADR-031, but is descriptive formatting guidance rather than permission to execute a commit.
- Contract tests should fail if `Commit unless asked` or equivalent conditional permission returns to shipped instruction guidance.

## Reversibility

This is reversible only through a new ADR that defines a reliable per-command approval mechanism and updates instruction, enforcement, and regression-test surfaces together. Reverting instruction wording alone is not a valid rollback because it recreates the original contradiction.
