# ADR-010: Setup file ownership - what setup can and cannot touch

**Status:** Accepted
**Date:** 2026-04-06
**Updated:** 2026-08-08 - ADR-051 adds a Git-only commit-guidance seed and former-path migration. 2026-08-15 - absorbed ADR-003 (reference-based setup prompts). What setup may write and how its prompts obtain content are one contract: both exist to stop setup from generating a second, drifting copy of something the project or the package already owns.

## Context

goat-flow v1.0.0 setups caused damage to existing projects. The worst case: ambient-scribe's AGENTS.md (447 lines of real repo guidance) was replaced with a 104-line goat-flow mirror. The setup agent treated the instruction file as something goat-flow "owned" and could rewrite freely.

Users also don't typically want every supported agent set up at once. A Claude setup that rewrites AGENTS.md or Copilot instructions disrupts workflows the user hasn't asked to change.

Setup prompts had the mirror-image problem. They inlined skeleton content for each skill, so every prompt carried a copy of a template that the package also shipped. The copies drifted from their sources, and a template fix did not reach a project whose prompt had already been generated.

## Decision

**Setup only creates/edits files in `.goat-flow/`.** Everything else in the project is hands-off.

**Existing instruction files (CLAUDE.md, AGENTS.md, `.github/copilot-instructions.md`):**
- Do NOT delete domain content from the existing file.
- Reorganise in-place: extract domain knowledge to `.goat-flow/architecture.md` and `.goat-flow/glossary.md`, keep behavioral rules in the instruction file, add missing goat-flow sections.
- The user's original domain knowledge is preserved in `.goat-flow/`, not destroyed.
- Never create "original-*" backup copies - reorganise instead. Git history preserves the original.

**All other project files** (`.github/instructions/`, `docs/`, `src/`, config files, scripts, etc.):
- Never edit, never delete.
- Reference them from the instruction file's Router Table and `.goat-flow/learning-loop/patterns/`.

**Exception for upgrades:** Older goat-flow versions (v0.9) have files outside `.goat-flow/` (e.g., `docs/footguns.md`, `tasks/`). These can be migrated during an upgrade -- moved, not deleted without migration.

**Commit-guidance exception:** When a target contains `.git`, setup may copy `workflow/setup/reference/git-commit-message.md` to the preferred docs path if neither accepted guide exists. During upgrades it may migrate a former-only `docs/coding-standards/git-commit.md` after verifying the preferred destination is absent. Targets without `.git` and collisions remain untouched.

**Single-agent scoping:** Setup for one agent only touches that agent's files.
- Claude setup: CLAUDE.md, `.claude/`, and shared `.goat-flow/`. Does NOT touch AGENTS.md, `.agents/`, `.github/copilot-instructions.md`, `.github/`, or their skills.
- Codex setup: AGENTS.md, `.agents/`, `.codex/`, and shared folders. Does NOT touch CLAUDE.md or `.claude/`.
- Users scan and fix each agent setup separately.

### Prompts reference templates, never inline them

`goat-flow setup` generates prompts containing a template path table (skill name to its `workflow/skills/goat-<name>/SKILL.md` path) plus adaptation guidance. The agent reads each template from disk at setup time, so it gets the canonical current version and no inline copy exists to drift.

- A language-to-coding-standards mapper auto-selects the backend, frontend, and security templates from the detected stack.
- Setup takes one agent per run via `--agent <id>`, using the canonical agent set from ADR-020. The former `--agent all` tried to generate one prompt covering every agent and produced confused output.
- The inline fragment renderer and its `GOAT_FLOW_INLINE_SETUP` rollback env var were deleted in v0.10.0. There is no inline-generation path to fall back to.

## Consequences

- Setup agents reorganise existing instruction files in-place (extract domain knowledge to `.goat-flow/`, keep behavioral rules, add goat-flow sections)
- Scanner anti-pattern check (AP-duplicate-surfaces) catches setups that create parallel surfaces
- compose-setup.ts must detect which agent is being set up and scope file operations accordingly
- Users running setup for a second agent later will find `.goat-flow/` already populated - setup should merge, not overwrite
