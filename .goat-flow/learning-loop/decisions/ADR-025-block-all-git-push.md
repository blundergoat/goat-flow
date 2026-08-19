# ADR-025: Agents never commit or push

**Status:** Accepted
**Date:** 2026-04-26
**Updated:** 2026-08-15 - absorbed ADR-040 (agents never commit). Both reserve repository-history creation for the user and are enforced by the same hook and settings surfaces; splitting them let instruction prose drift from enforcement on one half while the other stayed correct.

## Context

The prior monolithic deny hook blocked only pushes to protected branches (main, master, production, deploy) and force pushes. Feature-branch pushes were allowed, on the assumption that agents should push as part of a PR workflow.

The settings.json deny patterns were inconsistent: the fourth-runtime settings had `Bash(*git push*)` (block all), while `.claude/settings.json` had `Bash(*git push*--force*)` (block force only). The workflow template (`workflow/hooks/agent-config/claude.json`) had the correct blanket pattern, but the installed copy had drifted.

Commit authority carried the same shape of contradiction. The installed deny hook at `.goat-flow/hooks/deny-dangerous/patterns-writes.sh` (search: `git commit is not allowed`) and Claude settings at `.claude/settings.json` (search: `Bash(*git commit*)`) categorically blocked `git commit`, but the shared instruction files said `Commit unless asked` - wording that implied a direct request could authorize a commit when enforcement had no approval path. The project owner resolved the ambiguity on 2026-07-12: agents never commit and never push, and the user performs both manually after reviewing the working tree.

## Decision

Block **all** git push commands from agents, at both the settings layer and the hook layer. Pushing is exclusively the user's action. Agents should never push to any branch, including feature branches.

Coding agents must never execute `git commit`. A direct user request to commit does not create an exception; the agent leaves the working tree uncommitted and hands the commit step back to the user.

Agents may still inspect status and diffs, prepare working-tree changes within their approved scope, and draft a conventional commit message for the user. This does not make staging or other local Git operations permissible when a separate instruction or hook prohibits them. Commit-message guidance (ADR-051) defines message format only and grants no execution authority.

## Rationale

- Pushing affects shared remote state and is visible to collaborators immediately.
- An accidental push to the wrong branch or remote is hard to reverse cleanly.
- The user can push with one command after reviewing what the agent changed.
- The hook and settings should enforce the same policy - the blanket block is simpler and removes the token-classification complexity of the old protected-branch iteration.
- Instruction prose and categorical enforcement must agree. When they disagree, neither users nor agents can tell which one is stale.

## Failure Mode Comparison

| Option | What fails | Why rejected or accepted |
| --- | --- | --- |
| Allow pushes to feature branches only | Requires token classification the hook kept getting wrong, and installed settings had already drifted from the template | Rejected |
| Allow commits after a direct request | Instruction prose and categorical enforcement disagree; the agent can mutate repository history when the owner expects a review handoff | Rejected |
| Block commits mechanically but leave permission wording ambiguous | Users and agents cannot tell whether the hook or instruction is stale | Rejected |
| Block both categorically; the user commits and pushes manually | Adds one manual step but leaves repository history and remote state under direct human control, and aligns prose with enforcement | Accepted |

## Consequences

- `patterns-writes.sh` blocks any `git push` command with a single pattern match.
- The old `is_protected_push_token()` helper and force-push checks (old checks 4-6) are removed as redundant.
- All settings.json deny lists must use `Bash(*git push*)`, not `Bash(*git push*--force*)`.
- Self-test cases cover feature-branch pushes, bare `git push`, and `git push -u`, all expecting exit 2.
- `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, and the setup reference must state the unconditional commit and push prohibition. Instruction Never lists say "Push", not "Push to main. Force push."
- The existing categorical commit and push hook behavior must not gain an agent approval bypass.
- Contract tests should fail if `Commit unless asked` or equivalent conditional permission returns to shipped instruction guidance.

## Reversibility

Reversible only through a new ADR that defines a reliable per-command approval mechanism and updates instruction, enforcement, and regression-test surfaces together. Reverting instruction wording alone is not a valid rollback, because it recreates the original prose-versus-enforcement contradiction.
