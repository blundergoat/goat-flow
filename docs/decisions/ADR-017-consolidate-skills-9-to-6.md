# ADR-017: Consolidate skills from 9 to 6

**Status:** Accepted
**Date:** 2026-03-30
**Supersedes:** ADR-007 (10→8 consolidation), partially supersedes ADR-016 (dispatcher counting)

## Context

Cross-project reviews from 3 consumer projects (halaxy-cypress 66/100, blundergoat-platform 74/100, healthkit 68/100) consistently flagged skill count as a usability problem:
- "9 skills is too many for initial setup" (2/3 projects)
- "goat-debug and goat-investigate have 95% Step 0 overlap" (halaxy-cypress)
- "goat-simplify is a subset of goat-review" (healthkit)
- "goat-simplify has never been invoked" (all 3 projects — 0 usage across all reviewers)

Two projects wanted to merge goat-simplify but disagreed on the target (refactor vs review), suggesting the skill's identity was unclear rather than that a specific merge was obvious.

## Decision

Merge 3 skills as modes into their natural hosts. Expand goat-security. No new skills.

| Removed | Merged Into | As |
|---------|-------------|-----|
| goat-investigate | goat-debug | Investigate mode (Phases I1-I3) + Onboard mode (O1-O2) |
| goat-simplify | goat-review | Simplify mode (Phases S1-S4) |
| goat-refactor | goat-plan | Refactor planning mode (Phases R1-R3) |

goat-security expanded with 2 new modes: Compliance (HIPAA/GDPR/PHI) and Dependency audit (CVE scanning).

**Canonical skill set (v0.9.3):** goat (dispatcher), goat-debug, goat-review, goat-plan, goat-security, goat-test — 6 total.

## Rationale

**goat-investigate → goat-debug:** Both are "read and understand" skills. Debug starts with a symptom, investigate starts with a question. Step 0 branches on whether the user has a bug. Phase 1 behavior differs (hypothesis tracking vs progressive depth reading) but that's a mode difference, not a skill difference.

**goat-simplify → goat-review:** Readability assessment is already in goat-review's severity scan under "Style." The only differentiator was the "must not change behavior" constraint — that's a one-line mode qualifier, not a separate skill. healthkit reviewer: "readability assessment is already in goat-review."

**goat-refactor → goat-plan:** Refactor's value is the planning discipline (blast radius analysis, both-sides-first reading, execution sequence, absence checks) — not the execution itself. The actual file edits happen in the normal ACT step. goat-plan's refactor mode produces the plan; the execution loop handles the rest.

**No goat-implement or goat-migrate:** Both were requested by reviewers but adding skills after consolidating from 9→6 goes the wrong direction. The execution loop + goat-plan cover implementation and migration workflows.

**No deprecated infrastructure:** No DEPRECATED_SKILL_NAMES, no AP16, no migration detection for old skills. No one else is using this project — just delete the old skills. Consumer projects with old skills installed will see them as unknown directories, not flagged anti-patterns.

## Consequences

- Total skill lines: 1,790 → 1,067 (40% reduction)
- Dispatcher intent table shorter with Mode column for clarity
- Mode routing happens at Step 0 inside the skill, not at dispatch time
- Each host skill's "NOT this skill" section is simpler
- Scanner: SKILL_NAMES has 6 entries, TOTAL_SKILLS = 6, eval coverage threshold lowered to >= 3
- All 3 agent dirs (.claude/, .agents/, .github/) must be kept in sync (ADR-012 still applies)
- Footgun evidence format changed: file paths only, line numbers optional (they rot)
