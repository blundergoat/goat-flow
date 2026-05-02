# ADR-023: Reference-pack budget tiers split by load pattern

**Date:** 2026-04-20
**Status:** Accepted
**Milestone:** Quality-report follow-up (reports 1-4, persistent MAJOR finding across four runs)

## Context

`skill-quality-testing.md:416` pinned a single reference-pack budget:

> "Token budget met (dispatcher <500 words, functional skill <2500 words, reference pack <400 words per file)."

Actual shipped state in `.goat-flow/skill-reference/`:

| File | Words | Multiple over budget |
|------|-------|---------------------|
| `skill-conventions.md` | 977 | 2.4× |
| `skill-preamble.md` | 1181 | 2.95× |
| `skill-quality-testing.md` | 3893 | 9.7× |

All three violate the rule on disk. The violation surfaced as a MAJOR finding in four consecutive quality-review runs (2026-04-20 reports 0804, 0807, 0810, 0854) before being actioned.

**Why the single-budget model was wrong:** "Reference pack" conflates two distinct load patterns:

1. **Always-loaded shared content** - read on *every* invocation of the owning skills. `skill-preamble.md` is loaded by all 7 SKILL.md files; `skill-conventions.md` is loaded on full-depth invocations. Their size is effectively part of the skill-loading overhead.
2. **Progressive reference pack** - loaded on-demand from within a skill when that skill enters a specific mode (authoring, hardening, review-class work). `skill-quality-testing.md` is only read during skill authoring - not on every goat-* invocation.

A single 400-word cap is defensible for progressive packs (small, pick-one-of-many). It is unrealistic for always-loaded shared content that must carry enough context to be useful across all 7 skills.

## Decision

**Split the budget by load pattern:**

| Tier | Budget | Applies to |
|------|--------|-----------|
| Dispatcher skill | ≤555 words | `goat/SKILL.md` |
| Functional skill | <2500 words | `goat-debug/SKILL.md`, `goat-plan/SKILL.md`, `goat-qa/SKILL.md`, `goat-review/SKILL.md`, `goat-critique/SKILL.md`, `goat-security/SKILL.md` |
| Always-loaded shared content | <1500 words per file | `skill-preamble.md`, `skill-conventions.md` (loaded by every goat-* skill on invocation) |
| Progressive reference pack | <3000 words per file | Files under per-skill `references/` subdirs and `.goat-flow/skill-reference/<pack>/` subdirs (loaded only when a skill enters the mode that needs them) |

Under the new tiers:

- `skill-preamble.md` (1181w) ✅ within the 1500w always-loaded tier.
- `skill-conventions.md` (977w) ✅ within the 1500w always-loaded tier.
- `skill-quality-testing.md` (3893w) ❌ still above the 3000w progressive-pack cap. Split required.

**Split `skill-quality-testing.md` into a short index plus three topical files under `.goat-flow/skill-reference/skill-quality-testing/` (mirrored in the `workflow/skills/reference/skill-quality-testing/` template):**

| New file | Content | Loaded when |
|----------|---------|-------------|
| `tdd-iteration.md` | Iron law, TDD loop, pressure types, scenario design, rationalisation table, bulletproofing techniques, persuasion principles, meta-testing, dispatch protocol, iteration log shape, worked example, empirical grounding | Authoring a new discipline-enforcing skill, or hardening an existing one |
| `adversarial-framing.md` | Cynical-reviewer role prompt, zero-findings HALT pattern, parallel reviewer pattern, structured finding schema | Authoring or hardening a review-class skill (goat-review, goat-critique, goat-qa) |
| `deployment.md` | Skip-testing rationalisations, skill deployment checklist (RED/GREEN/REFACTOR phases, quality checks, deployment gates), STOP-before-next-skill rule | Finalising any skill before merge |

The existing `skill-quality-testing.md` file stays at its current path but becomes a short index (<400w) that names each topical file and when to load it. This preserves every existing cross-reference in the repo (skill-conventions.md, architecture.md, installers, drift checks, docs) while achieving the token-cost reduction: authors load only the topical file relevant to the skill type they are working on.

**The budget rule itself moves into `deployment.md`** (the topical file whose checklist it belongs to) and is updated to state the new four-tier model.

## Alternatives considered

1. **Single-tier rewrite: raise the budget to ≥4000w.** Rejected. Acknowledges the violation without differentiating load patterns, so the two always-loaded files pay token cost every invocation with no discipline applied. Also allows future authoring-reference drift upward without friction.

2. **Exempt the shared `skill-reference/` tier from any budget.** Rejected for the same reason - no discipline means the files can grow unboundedly, and the always-loaded files hit every skill run.

3. **Split without a budget rewrite (keep the 400w rule, create many small files).** Rejected. Produces one-paragraph files that fragment methodology across many hops, making authoring harder, not easier. The 400w cap was wrong for this class of content; raising it for the real load pattern is the honest fix.

4. **Keep the monolith, defer split to a future milestone.** Rejected. The violation has persisted across four quality-review runs with the same MAJOR severity. Each run consumes the full 3893 words of the file on every authoring task - the compounding cost outweighs the one-time split work.

## Consequences

- `skill-quality-testing.md` becomes a short index; three new topical files ship under `.goat-flow/skill-reference/skill-quality-testing/` (installed) and `workflow/skills/reference/skill-quality-testing/` (template).
- Drift-check plumbing grows: `scripts/preflight-checks.sh`, `src/cli/audit/check-drift.ts` `SHARED_FILES` array, `workflow/install-goat-flow.sh`, `workflow/manifest.json`, and the `test/integration/audit-drift.test.ts` + `test/integration/preamble-sync.test.ts` fixture lists each gain the three new pairs.
- `src/cli/audit/check-content-quality.ts` picks up the three new files so content-quality lint applies to the split content the same way it applied to the monolith.
- Agents consulting `skill-quality-testing.md` for authoring guidance now read a short index, then load only the topical file their skill type needs (often just one).
- The budget rule's new home is `deployment.md`. Cross-references that previously pointed at `skill-quality-testing.md` line 416 are forward-compatible because the file still exists (as the index) - but new cross-references should target `deployment.md` directly.
- Future split work: if any of the three topical files exceeds 3000w, it splits further under the same model. `tdd-iteration.md` is the one to watch - it already sits at ~2800w carrying the bulk of the methodology, and any future content additions should be evaluated for whether they belong in a new topical file instead.

**2026-05-02 amendment:** Dispatcher budget raised from <500 to ≤555. The dispatcher gained a structured Route Snapshot output contract, multi-intent decomposition protocol, GATHER checklist, and contract-test-mandated phrases (Proof Gate, "verification planning") that the original 500w budget didn't anticipate. The file was trimmed from 585w to 552w in the same pass - net reduction despite added features.
