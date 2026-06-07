# ADR-025: Block all git push from agents

**Status:** Accepted
**Date:** 2026-04-26

## Context

The prior monolithic deny hook previously blocked only pushes to protected branches (main, master, production, deploy) and force pushes. Feature-branch pushes were allowed. This was based on the assumption that agents should be able to push to feature branches as part of a PR workflow.

The settings.json deny patterns were inconsistent: the fourth-runtime settings had `Bash(*git push*)` (block all), while `.claude/settings.json` had `Bash(*git push*--force*)` (block force only). The workflow template (`workflow/hooks/agent-config/claude.json`) had the correct blanket pattern, but the installed copy had drifted.

## Decision

Block **all** git push commands from agents, at both the settings layer and the hook layer. Pushing is exclusively the user's action. Agents should never push to any branch, including feature branches.

## Rationale

- Pushing affects shared remote state and is visible to collaborators immediately.
- An accidental push to the wrong branch or remote is hard to reverse cleanly.
- The user can push with one command after reviewing what the agent changed.
- The hook and settings should enforce the same policy - the blanket block is simpler and removes the token-classification complexity of the old protected-branch iteration.

## Consequences

- `patterns-writes.sh` now blocks any `git push` command with a single pattern match.
- The old `is_protected_push_token()` helper and force-push checks (old checks 4-6) are removed as redundant.
- All settings.json deny lists must use `Bash(*git push*)`, not `Bash(*git push*--force*)`.
- Self-test cases updated: feature-branch pushes, bare `git push`, and `git push -u` all expect exit 2.
- Instruction file Never lists should be updated to say "Push" instead of "Push to main. Force push." (separate change, Ask First boundary).
