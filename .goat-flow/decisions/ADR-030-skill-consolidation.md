# ADR-030: Skill consolidation - 9 skills to 5 + dispatcher

**Status:** Partially superseded (goat-sbao extracted as 6th functional skill in v1.1.0)
**Date:** 2026-04-06

## Context

Extracted from `docs/system-spec.md` (being retired in v1.1.0) to preserve design history.

Early versions had 8-10 skills. Each skill consumes instruction budget when loaded and creates maintenance burden. The question: which skills earn their file?

## Decision

A skill must have at least one of: a **distinct artefact**, a **hard workflow gate**, a **special failure mode**, or a **repeatable structured output**.

**Active skills (5 + dispatcher):**

| Skill | Justification |
|-------|--------------|
| `/goat-security` | Distinct artefact + hard gate |
| `/goat-debug` | Special failure mode + hard gate + investigate/onboard mode |
| `/goat-review` | Repeatable structured output + audit/simplify/instruction modes |
| `/goat-plan` | Distinct artefact + hard gate + refactor planning mode |
| `/goat-test` | Distinct artefact + hard gate |
| `/goat` (dispatcher) | Routes natural language to the right skill. 35-trigger table + 11 disambiguation rules too large for instruction file budget (ADR-029). |

**Merged or removed skills:**

| Former Skill | Now Lives | Why |
|-------------|-----------|-----|
| `/annotation-cycle` | Mob elaboration playbook | Planning refinement - no distinct artefact |
| `/sbao-synthesis` | SBAO planning playbook | Template, not a workflow with gates |
| `/review-triage` | ACT step review branch | Normal review behaviour, not a distinct mode |
| `/goat-audit` | `/goat-review` (Audit Mode) | Merged - negative verification + fabrication self-check |
| `/goat-reflect` | `/goat-review` (Instruction Review Mode) | Merged - friction signals + staleness audit |
| `/goat-onboard` | `/goat-debug` (Onboard Mode) | Merged - stack detection + instruction drafting |
| `/goat-investigate` | `/goat-debug` (Investigate Mode) | Merged - deep codebase investigation |
| `/goat-simplify` | `/goat-review` (Simplify Mode) | Merged - readability without behaviour change |
| `/goat-refactor` | `/goat-plan` (Refactor Planning Mode) | Merged - cross-file refactoring with blast radius |
| `/goat-context` | Removed | Session resumption handled by agent built-in context |
| `/revert-rescope` | VERIFY/stop-the-line paragraph | Tactic, not a workflow |

There is no implementation skill (see ADR-019). Implementation is what the agent does natively. Skills govern everything around it.

## Consequences

- Canonical skill count: 7 (6 specialized + 1 dispatcher). Originally 5+1; goat-sbao was later extracted as a standalone critique skill (see ADR-033).
- Fewer skills = less maintenance, less drift, less context consumed
- Each surviving skill has clear justification and distinct output
- New skills must pass the justification test before being added
