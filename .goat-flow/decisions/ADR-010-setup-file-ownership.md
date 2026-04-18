# ADR-010: Setup file ownership - what setup can and cannot touch

**Status:** Accepted
**Date:** 2026-04-06

## Context

goat-flow v1.0.0 setups caused damage to existing projects. The worst case: ambient-scribe's AGENTS.md (447 lines of real repo guidance) was replaced with a 104-line goat-flow mirror. The setup agent treated the instruction file as something goat-flow "owned" and could rewrite freely.

Users also don't typically want all 3 agents set up at once. A Claude setup that rewrites AGENTS.md or GEMINI.md disrupts workflows the user hasn't asked to change.

## Decision

**Setup only creates/edits files in `.goat-flow/`.** Everything else in the project is hands-off.

**Existing instruction files (CLAUDE.md, AGENTS.md, GEMINI.md):**
- Do NOT delete domain content from the existing file.
- Reorganise in-place: extract domain knowledge to `.goat-flow/architecture.md` and `.goat-flow/glossary.md`, keep behavioral rules in the instruction file, add missing goat-flow sections.
- The user's original domain knowledge is preserved in `.goat-flow/`, not destroyed.
- Never create "original-*" backup copies - reorganise instead. Git history preserves the original.

**All other project files** (`.github/instructions/`, `docs/`, `src/`, config files, scripts, etc.):
- Never edit, never delete.
- Reference them from the instruction file's Router Table and `.goat-flow/patterns.md`.

**Exception for upgrades:** Older goat-flow versions (v0.9) have files outside `.goat-flow/` (e.g., `docs/footguns.md`, `tasks/`). These can be migrated during an upgrade -- moved, not deleted without migration.

**Single-agent scoping:** Setup for one agent only touches that agent's files.
- Claude setup: CLAUDE.md, `.claude/`, and shared `.goat-flow/`. Does NOT touch AGENTS.md, GEMINI.md, `.agents/`, `.gemini/`, or their skills.
- Codex setup: AGENTS.md, `.agents/`, `.codex/`, and shared folders. Does NOT touch CLAUDE.md or `.claude/`.
- Users scan and fix each agent setup separately.

## Consequences

- Setup agents reorganise existing instruction files in-place (extract domain knowledge to `.goat-flow/`, keep behavioral rules, add goat-flow sections)
- Scanner anti-pattern check (AP-duplicate-surfaces) catches setups that create parallel surfaces
- compose-setup.ts must detect which agent is being set up and scope file operations accordingly
- Users running setup for a second agent later will find `.goat-flow/` already populated - setup should merge, not overwrite
