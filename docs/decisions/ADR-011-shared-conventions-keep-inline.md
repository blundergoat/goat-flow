# ADR-011: Shared Conventions -- Keep Inline

**Date:** 2026-03-28
**Status:** Accepted

## Context

The Shared Conventions block (12 lines) is duplicated across all 8 skill templates per project, totaling 96 lines of identical content. When conventions change, all 8 files need updating — the same drift problem the framework warns about elsewhere.

Cross-project feedback recommends extracting to a shared reference file to eliminate duplication. However, `workflow/skills/README.md:3` states that every skill is self-contained with no external references required. This is a core design principle: skills must work when loaded individually by an agent without requiring a secondary file to be present in the context window.

The tension is real — duplication invites drift, but extraction breaks self-containment.

## Decision

Keep shared conventions inline in each skill template. Self-contained skills are a core design principle that outweighs the duplication cost.

To manage drift without breaking self-containment:
- The canonical source for shared conventions is `workflow/skills/reference/shared-preamble.md` — update there first
- Propagate changes from the canonical source to all 8 skill templates in `workflow/skills/`
- M03.2 drift check compares each skill's conventions block against the canonical source and flags divergence
- Skill template updates must touch all 8 files as a single change

## Consequences

- M03.2 drift check becomes critical infrastructure — it is the only mechanism preventing silent divergence
- 96-line duplication across 8 skills is accepted as the cost of self-containment
- Skill template updates are inherently 8-file changes; contributors must update all templates together
- The canonical source (`workflow/skills/reference/shared-preamble.md`) is never loaded by agents in target projects — it exists only as a reference for the goat-flow framework itself
- No extraction, no includes, no preprocessing — skills remain plain markdown files
