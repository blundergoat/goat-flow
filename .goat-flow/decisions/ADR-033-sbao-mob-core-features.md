# ADR-033: SBAO and Mob Elaboration are core features, not optional ceremony

**Status:** Amended (2026-04-15) - Mob Elaboration removed; SBAO remains core. The concept was incoherent across 5+ surfaces (glossary said "replaced by SBAO," ADR said "core feature," dispatcher never defined it). SBAO subsumes the multi-perspective critique that Mob Elaboration was supposed to provide. The Planning Route handles brief intake without a separate elaboration phase.
**Date:** 2026-04-10

## Context

Round 5 critiques across 7 projects consistently scored SBAO (Sub-Agent Based Adversarial Opinion) and Mob Elaboration as "ceremony" and "too heavy for default use." Every critique recommended cutting, demoting, or auto-skipping them. The SBAO plan critique (3 sub-agents) also ranked ceremony reduction as the #1 priority.

However, the primary purpose of goat-flow is to make it easier for coding agents to plan with SBAO and Mob Elaboration. These are the core features - the execution loop, hooks, scanner, learning loop, and dispatcher are support infrastructure for the planning workflow.

The critique methodology was flawed: it evaluated SBAO/Mob as mandatory overhead on all tasks, when in reality they are user-prompted (M10d made them opt-in, not complexity-gated). The user chooses when to run them.

## Decision

1. **SBAO and Mob Elaboration are never removed, demoted, or auto-skipped.** They are the product.
2. **Improvements reduce ceremony AROUND SBAO/Mob** (lighter Step 0, fewer pre-gates), not ceremony OF SBAO/Mob.
3. **Skills are installed verbatim** to prevent setup agents from cutting SBAO/Mob sections during adaptation (`workflow/setup/03-install-skills.md` updated).
4. **The dispatcher should route users TO goat-plan's SBAO/Mob faster**, not away from them.
5. **Future critique methodology must evaluate SBAO/Mob as a feature**, not as overhead. Score "how well does SBAO improve plan quality" not "how much time does SBAO add."

## Rationale

- SBAO produces genuine findings. The rubric audit in this session used 3 SBAO sub-agents and found double-penalizations (2.2.3/AP6, 2.2.1/AP5) that 4 prior critique rounds missed.
- Mob Elaboration catches plan gaps before implementation. The user actively uses both features.
- Cutting SBAO to improve S/N scores would optimize the metric while destroying the product.
- M10d already solved the "too heavy for small tasks" problem: SBAO/Mob are user-prompted, not auto-triggered. The user asks for them when they want them.

## Consequences

- M13 improvements (13a conversational rewrite) must preserve the Phase 1 → SBAO/Mob choice gate.
- Critique prompts for R6+ should evaluate SBAO as a feature, not penalty it as overhead.
- The "Hard rules" section in M13 codifies this permanently.
- Setup agents cannot compress or remove SBAO/Mob sections (verbatim install rule).
