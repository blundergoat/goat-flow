# ADR-012: Canonical Skill Location -- Keep 3-Way Copy with Drift Check

**Date:** 2026-03-28
**Status:** Accepted

## Context

Target projects maintain identical skill files in three agent directories: `.claude/skills/`, `.agents/`, and `.github/instructions/`. This 3-way copy model guarantees that each agent runtime (Claude Code, Codex, Copilot) can find its skills in the expected location.

Drift between copies is a proven problem. The 10-to-8 skill consolidation (ADR-007) took 3 hours to reconcile across 3 directories in each project. Alternatives considered: symlinks (unreliable across platforms, especially Windows/WSL), a generation command (`goat-flow install-skills`, adds CLI dependency and complexity), or a single canonical directory (breaks agent runtime expectations).

## Decision

Keep the 3-way copy model. Formalize the current approach:

1. `workflow/skills/` in goat-flow is the canonical source for all skill templates
2. Agent directories (`.claude/skills/`, `.agents/`, `.github/instructions/`) in target projects are copies
3. M03.2 drift check compares agent directory copies against each other and flags divergence
4. The setup prompt handles initial copy during project onboarding
5. Manual sync remains the update path — no generation command

This is the current model, explicitly documented so future milestones do not treat it as an open question.

## Consequences

- No new CLI command needed — the framework remains documentation-only with no runtime tooling
- M03.2 drift check is the enforcement mechanism; without it, drift will recur
- Manual sync means skill updates require touching 3 directories per project; this is accepted
- The setup prompt must clearly document which directories to copy skills into
- Symlinks and generation are explicitly rejected — if revisited, a new ADR is required
