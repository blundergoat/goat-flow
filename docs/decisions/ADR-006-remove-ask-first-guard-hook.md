# ADR-006: Remove ask-first-guard.sh Hook

**Date:** 2026-03-25
**Status:** Accepted
**Deciders:** devgoat

## Context

Scanner check 2.2.7 ("Ask First has mechanical enforcement") was added in the dev branch as part of a batch of new checks (commit `b3b25c5`). The check awards 2 points if a PreToolUse hook exists that references Ask First boundary paths and exits with code 2 to block edits.

To achieve 100% on the scanner, an ask-first-guard.sh hook was created for all three agents (Claude, Codex, Gemini) in this project. The hook hardcoded boundary paths (`setup/`, `workflow/skills/`, `docs/system-spec.md`, etc.) and blocked Edit/Write operations to those paths.

The hook immediately started blocking normal development work on goat-flow itself. Every edit to `setup/` or `workflow/` — which is the primary activity in this repo — triggered the guard and required manual approval.

## Decision

**Remove the ask-first-guard.sh hook from the goat-flow project entirely.** Accept the 2.2.7 check failure for this project.

Keep:
- The Ask First POLICY in instruction files (autonomy tiers, micro-checklist) — agents should still pause on boundary files
- The setup templates that instruct agents to list project-specific Ask First boundaries in instruction files

## Rationale

1. **goat-flow is a framework, not a consumer project.** The primary workflow is editing `setup/`, `workflow/`, and `docs/system-spec.md`. These are the exact paths the hook blocks. A hook that blocks every normal edit is not enforcement — it's obstruction.

2. **The hook was created for the wrong reason.** It was added to chase a 100% scanner score, not because it solved a real problem. The check (2.2.7) was new — it didn't exist when the project was previously at 100%. Creating a hook to satisfy a new check without evaluating whether the check applies to this project was mechanical score-chasing.

3. **Ask First boundaries still exist as policy.** The CLAUDE.md/AGENTS.md/GEMINI.md instruction files list Ask First boundaries. Agents read these and (mostly) follow them. The policy layer works. The mechanical enforcement layer is the part that doesn't fit this repo.

4. **The hook concept is flawed.** Hardcoding boundary paths in a shell script creates maintenance burden — paths change, the hook doesn't update. The policy in the instruction file is sufficient. If mechanical enforcement is needed in the future, it should be a native agent runtime feature, not a brittle shell hook.

## Consequences

- Scanner check 2.2.7 removed from rubric entirely (not just skipped)
- The ask-first-guard.sh hook, the scanner check, the setup fragment, and the boundaries guide are all deleted
- Ask First POLICY remains: instruction files still list boundaries, agents still follow the micro-checklist
- No mechanical enforcement of Ask First boundaries — policy-only
