# ADR-011: Multi-perspective critique (goat-critique) is a core feature, not optional ceremony

**Status:** Accepted (updated 2026-04-18; historical Mob Elaboration references removed after the 2026-04-15 amendment)
**Date:** 2026-04-10

## Context

Round 5 critiques across 7 projects consistently scored the critique skill (then named SBAO, now `goat-critique`) as "ceremony" and "too heavy for default use." Every critique recommended cutting, demoting, or auto-skipping it. The 3-sub-agent critique run also ranked ceremony reduction as the #1 priority.

However, the primary purpose of goat-flow is to make it easier for coding agents to plan and challenge plans with the critique skill. The execution loop, hooks, audit system, learning loop, and dispatcher are support infrastructure for that workflow.

The critique methodology was flawed: it evaluated critique as mandatory overhead on all tasks, when in reality it is user-prompted. The user chooses when to run it.

## Decision

1. **The critique skill is never removed, demoted, or auto-skipped.** It is a core product feature.
2. **Improvements reduce ceremony around critique**, not the critique method itself.
3. **Skills are installed verbatim** to prevent setup agents from compressing or removing critique sections during adaptation (`workflow/setup/03-install-skills.md`).
4. **The dispatcher should route users toward goat-plan and, when needed, the critique skill faster, not away from them.**
5. **Future critique methodology must evaluate critique as a feature, not as overhead.** Score "how well does critique improve plan quality" not "how much time critique adds."

## Rationale

- The critique skill produces genuine findings. The rubric audit in this session used 3 critique sub-agents and found double-penalizations (2.2.3/AP6, 2.2.1/AP5) that 4 prior critique rounds missed.
- Cutting the critique skill to improve S/N scores would optimize the metric while destroying the product.
- The "too heavy for small tasks" objection is already addressed by routing and user intent: critique is invoked when the user wants competing perspectives, not as universal mandatory overhead.

## Consequences

- M13 improvements must preserve fast routing into critique when the user explicitly wants competing perspectives.
- Critique prompts for later rounds should evaluate the critique skill as a feature, not penalize it as overhead.
- The "Hard rules" section in M13 codifies this permanently.
- Setup agents cannot compress or remove critique sections (verbatim install rule).
