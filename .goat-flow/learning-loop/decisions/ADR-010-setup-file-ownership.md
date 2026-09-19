# ADR-010: Setup file ownership - what setup can and cannot touch

**Status:** Accepted
**Date:** 2026-04-06
**Updated:** 2026-09-05 - condensed; scoping now names the ADR-020 roster instead of two agents, and a stale reference to the removed scanner is gone. Earlier amendments added the ADR-051 commit-guidance seed (2026-08-08) and absorbed now-removed ADR-003 on reference-based prompts (2026-08-15).

## Context

v1.0.0 setups damaged existing projects. The worst case replaced a consumer's 447-line `AGENTS.md` with a 104-line goat-flow mirror because the setup agent treated the instruction file as goat-flow property. Users also did not want every agent configured at once: a Claude setup that rewrote `AGENTS.md` disrupted a Codex workflow nobody asked to change.

Setup prompts had the mirror-image problem. They inlined a copy of each skill template, so generated prompts drifted from the package and a template fix never reached a project whose prompt already existed.

## Decision

Setup writes only `.goat-flow/` and the selected agent's manifest-declared surfaces; every other project file is hands-off.

**Existing instruction files** (`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`): never delete domain content. Reorganise in place: extract domain knowledge to `.goat-flow/architecture.md` and `.goat-flow/glossary.md`, keep behavioural rules in the file, add the missing goat-flow sections. Never create `original-*` backups; Git history preserves the original.

**All other files** (`.github/instructions/`, `docs/`, `src/`, config, scripts): never edit or delete. Reference them from the Router Table and `.goat-flow/learning-loop/patterns/`.

**Two exceptions.** Upgrades may migrate pre-1.0 files that lived outside `.goat-flow/`, moved rather than deleted. When the target contains `.git`, setup may seed or migrate the commit-guidance doc under the ADR-051 rules.

**Single-agent scoping.** `--agent <id>` selects one agent from the ADR-020 roster per run. Setup touches that agent's instruction file, skills directory, and hook config plus shared `.goat-flow/`, and nothing belonging to another agent. Users run and review each agent separately. A second agent's setup finds `.goat-flow/` already populated and merges rather than overwrites.

**Prompts reference templates.** Generated prompts carry a table of template paths (`workflow/skills/goat-<name>/SKILL.md`) plus adaptation guidance; the agent reads each template from disk at setup time, so no inline copy exists to drift. A language-to-coding-standards mapper selects the backend, frontend, and security templates from the detected stack. The inline renderer and its `GOAT_FLOW_INLINE_SETUP` fallback were deleted in v0.10.0.

## Consequences

- Setup agents reorganise instruction files in place instead of replacing them.
- `src/cli/prompt/compose-setup.ts` scopes file operations to the selected agent.
- Setup for a second agent merges into an existing `.goat-flow/`.
