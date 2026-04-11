# ADR-028: Extract shared skill conventions to .goat-flow/skill-conventions.md

**Status:** Accepted (supersedes ADR-023, which superseded ADR-011)
**Date:** 2026-04-06

## Context

ADR-011 (2026-03-28) chose to keep shared conventions inline in each skill template for self-containment. At 12 lines per skill, the duplication cost was acceptable. ADR-023 (2026-04-04) expanded the inline block from 12 to 62 lines, preserving the self-containment principle while closing content gaps (recovery, working memory, autonomy awareness, closing protocol).

By v1.1.0, the shared conventions had grown to 152 lines. With 5 functional skills across 3 agent directories (`.claude/skills/`, `.agents/skills/`, `.github/skills/`), this meant 2,280 lines of duplicated content. The M03.2 drift check - the only mechanism preventing divergence - could not keep pace with the maintenance burden. The duplication surface was now actively causing the drift it was designed to prevent.

## Decision

Extract shared conventions from inline in each skill to a single file: `.goat-flow/skill-conventions.md`. Setup copies this from `workflow/skills/reference/skill-conventions.md`.

Each skill retains a 7-line inline fallback so skills degrade gracefully (not catastrophically) if the file is missing:

```
## Shared Conventions
Read `.goat-flow/skill-conventions.md` for full shared conventions.
If unavailable, use these essentials:
- Severity: SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE
- Evidence: every finding MUST include file:line, tag OBSERVED vs INFERRED
- Learning loop: check .goat-flow/lessons/ and .goat-flow/footguns/ after completion
- Gates: BLOCKING GATE = stop and wait. CHECKPOINT = continue unless interrupted.
- Task tracking: tick checkboxes immediately when completed, not at the end.
```

## Consequences

- Skills are no longer fully self-contained - they require one external file read at invocation
- The inline fallback preserves the self-containment principle in spirit: skills still function (degraded) without the file
- Updates to shared conventions are 1 file edit instead of 15
- The drift surface drops from 2,280 lines to ~35 lines (7-line fallback × 5 skills)
- Scanner gains a check for `.goat-flow/skill-conventions.md` existence
- `upgrade-0.9.x.md` and `upgrade-1.0.0.md` must include skill-conventions.md as an upgrade surface
