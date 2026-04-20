# ADR-009: Skill consolidation and canonical-skill doctrine

**Status:** Accepted (updated 2026-04-18; absorbs the dispatcher-counting and 9→6 consolidation history previously split across ADR-016 and ADR-017)
**Date:** 2026-04-06

## Context

Extracted from `docs/system-spec.md` (being retired in v1.1.0) to preserve design history.

Early versions had 8-10 skills. Each skill consumed instruction budget when loaded and created maintenance burden. At the same time, rubric, facts, fragments, and docs were inconsistent about whether the dispatcher counted as a canonical skill at all.

Before the canonical-count question was settled, the framework first had to decide whether the dispatcher should exist at all. The original dispatcher build ADR concluded that keyword-first routing plus one-question disambiguation was cheaper than loading the wrong skill and bouncing through its "NOT this skill" block. That origin story now lives here because the durable question is not whether `/goat` was worth building once; it is whether routing deserves canonical skill status and how that status interacts with the consolidation doctrine.

Cross-project reviews from consumer projects made the usability pressure concrete:

- "9 skills is too many for initial setup" (multiple projects)
- "goat-debug and goat-investigate have 95% Step 0 overlap"
- "goat-simplify is a subset of goat-review"
- "goat-simplify has never been invoked" (no usage across any reviewer)

The enduring question is not the exact count at a moment in history. It is what earns a skill file, when the dispatcher counts as canonical, and when capabilities should merge into modes instead of becoming standalone skills.

## Decision

A skill must have at least one of:

- a **distinct artefact**
- a **hard workflow gate**
- a **special failure mode**
- a **repeatable structured output**

The dispatcher **does** count as canonical when it is shipped as a `SKILL.md` surface with its own constraints and failure modes. It is not a passive router.

### Consolidation history that now lives in this ADR

**Dispatcher counting (from ADR-016):**

- The dispatcher is canonical because it has its own failure modes (ambiguous intent, incorrect routing, missing override handling)
- It produces structured output (skill announcement and disambiguation)
- It has distinct constraints (must announce, must not load two skills, must present disambiguation)
- The original build rationale also remains part of the record: keyword-first intent mapping covers the easy cases, one clarification question handles the ambiguous boundary, and direct invocation remains available for power users

**9 → 6 consolidation (from ADR-017):**

| Removed | Merged Into | As |
|---------|-------------|-----|
| `goat-investigate` | `goat-debug` | Investigate mode + Onboard mode |
| `goat-simplify` | `goat-review` | Simplify mode |
| `goat-refactor` | `goat-plan` | Refactor planning mode |

`goat-security` expanded with Compliance and Dependency-audit modes during that consolidation pass.

### Current doctrine

The canonical skill set has continued to evolve after the 9→6 pass. The current rule is:

- keep only skills that pass the justification test above
- count the dispatcher when it is part of the installed canonical set
- prefer modes inside an existing skill when the difference is routing or emphasis, not artifact/gate/failure-mode/output

Current canonical skills are 7 total:

- `/goat`
- `/goat-debug`
- `/goat-review`
- `/goat-plan`
- `/goat-security`
- `/goat-qa`
- `/goat-critique`

There is no implementation skill (see ADR-005). Implementation is what the agent does natively. Skills govern everything around it.

## Consequences

- Skill-count debates now resolve through the justification test, not by ad hoc preference
- Dispatcher counting is no longer a separate open question; it follows from whether the dispatcher is a shipped canonical skill surface
- Fewer skills means less maintenance, less drift, and less context consumed
- Each surviving skill must justify its existence with a distinct artifact, gate, failure mode, or structured output
- New skills must pass the same test before being added
