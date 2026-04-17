# ADR-033: Multi-perspective critique (goat-critique) and Mob Elaboration are core features, not optional ceremony

**Status:** Amended (2026-04-15) - Mob Elaboration removed; the critique skill remains core. Further amended (2026-04-18) - renamed from `goat-sbao` / "SBAO" to `goat-critique` per M07. All operational references are updated; historical prose retains "SBAO" where quoting the original name.
**Date:** 2026-04-10

## Context

Round 5 critiques across 7 projects consistently scored the critique skill (then named SBAO, "Sub-Agent Based Adversarial Opinion") and Mob Elaboration as "ceremony" and "too heavy for default use." Every critique recommended cutting, demoting, or auto-skipping them. The 3-sub-agent critique run also ranked ceremony reduction as the #1 priority.

However, the primary purpose of goat-flow is to make it easier for coding agents to plan with the critique skill and Mob Elaboration. These are the core features - the execution loop, hooks, scanner, learning loop, and dispatcher are support infrastructure for the planning workflow.

The critique methodology was flawed: it evaluated critique/Mob as mandatory overhead on all tasks, when in reality they are user-prompted (M10d made them opt-in, not complexity-gated). The user chooses when to run them.

## Decision

1. **The critique skill and Mob Elaboration are never removed, demoted, or auto-skipped.** They are the product.
2. **Improvements reduce ceremony AROUND critique/Mob** (lighter Step 0, fewer pre-gates), not ceremony OF critique/Mob.
3. **Skills are installed verbatim** to prevent setup agents from cutting critique/Mob sections during adaptation (`workflow/setup/03-install-skills.md` updated).
4. **The dispatcher should route users toward goat-plan and, when needed, the critique skill faster, not away from them.**
5. **Future critique methodology must evaluate critique/Mob as a feature, not as overhead.** Score "how well does the critique skill improve plan quality" not "how much time critique adds."

## Rationale

- The critique skill produces genuine findings. The rubric audit in this session used 3 critique sub-agents and found double-penalizations (2.2.3/AP6, 2.2.1/AP5) that 4 prior critique rounds missed.
- Mob Elaboration catches plan gaps before implementation. The user actively uses both features.
- Cutting the critique skill to improve S/N scores would optimize the metric while destroying the product.
- M10d already solved the "too heavy for small tasks" problem: critique/Mob are user-prompted, not auto-triggered. The user asks for them when they want them.

## Consequences

- M13 improvements (13a conversational rewrite) must preserve the Phase 1 → critique/Mob choice gate.
- Critique prompts for R6+ should evaluate the critique skill as a feature, not penalty it as overhead.
- The "Hard rules" section in M13 codifies this permanently.
- Setup agents cannot compress or remove critique/Mob sections (verbatim install rule).
