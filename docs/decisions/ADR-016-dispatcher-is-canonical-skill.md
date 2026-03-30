# ADR-016: Dispatcher (goat) is a canonical skill

**Status:** Accepted
**Date:** 2026-03-30
**Context:** Rubric, facts, fragments, and docs inconsistently counted the goat dispatcher as either included (9 skills) or excluded (8 skills) from the canonical skill set.

## Decision

The goat dispatcher is the 9th canonical skill. It is included in:
- `CANONICAL_SKILLS` set (eval diversity counting)
- `TOTAL_SKILLS` constant (rubric threshold)
- All rubric messages, fragment instructions, and anti-pattern recommendations

## Rationale

The dispatcher is not a passive router. It:
1. Has its own failure modes (ambiguous intent, incorrect routing, missing override handling)
2. Has 3 dedicated evals testing these failure modes
3. Has structured output (skill announcement, disambiguation choices)
4. Has constraints (MUST announce, MUST NOT load two skills, MUST present disambiguation)
5. Is installed as a SKILL.md file alongside the other 8

Excluding it from canonical counting created a 8-vs-9 inconsistency across 15+ files in the scanner, fragments, and docs. Every time "8 canonical skills" appeared, someone had to mentally add "plus the dispatcher" — or didn't, and the count was wrong.

## Consequences

- `TOTAL_SKILLS` in `full.ts` changed from 8 to 9
- `CANONICAL_SKILLS` in `shared.ts` now includes `'goat'`
- Eval diversity check (3.1.6) requires coverage of all 9 skills for full points
- All "8 canonical" references in rubric messages, fragments, and anti-patterns updated to 9

**Amendment (v0.9.3):** Further consolidated from 9 to 6 skills. The dispatcher remains canonical. goat-investigate, goat-simplify, and goat-refactor merged as modes into goat-debug, goat-review, and goat-plan respectively.
