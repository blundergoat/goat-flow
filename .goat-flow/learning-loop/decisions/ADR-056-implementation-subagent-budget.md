# ADR-056: Separate scout and implementation sub-agent budgets

**Status:** Accepted
**Date:** 2026-08-23
**Updated:** 2026-09-05 - condensed; the goat-clarity anchor was corrected to a literal that resolves. The 2026-08-29 amendment recorded the rollout across all six surfaces.

## Context

Every instruction and convention surface stated one five-call sub-agent budget, so a read-only lookup and an authorized edit-and-verify task had the same ceiling. That ceiling is too small for the repository's implementation loop: related source reading, a scoped edit, focused verification, a bounded clarity pass, typecheck, and the relevant suite can each need separate tool invocations. `AGENTS.md` defines the loop (search: `## Execution Loop: READ → SCOPE → ACT → VERIFY`) and its clarity obligation (search: `once before exit on the explicit folder/file paths`).

ADR-005 keeps implementation in ordinary ACT, so delegating one authorized ACT task creates no implementation skill. ADR-042 exempts native sub-agents from the cross-harness boundary, where "unrestricted" means no extra approval gate, not unbounded work. Goat-critique's five-call critique ceiling and three-call cross-examination ceiling are specialist scout contracts that stay fixed.

## Decision

Sub-agents have two budgets: scouts keep five tool calls, and implementation sub-agents get `min(20, 5 + task estimate in minutes)`.

| Tier | Budget |
| --- | --- |
| Scout: read-only lookup, review, critique, or evidence gathering | 5 tool calls, unchanged |
| Implementation sub-agent: a delegated objective explicitly authorized to edit within one task's named scope | `min(20, 5 + task estimate in minutes)` tool calls |

The five-call base covers discovery and reporting; estimated minutes add implementation room. The cap is a ceiling, not a spending target or a duration model.

- **Tool call:** one tool invocation by the child agent. The final structured return and host-to-child messages do not count.
- **Task estimate:** the positive minutes in the task's `(est: <minutes> min <category>)` entry.
- **Unavailable count:** when a runtime cannot expose child tool-call counts, the host passes the cap in the objective and records usage as unavailable; it must not claim measured compliance.

Ownership is unchanged: a delegated return is product evidence, while the host runs the milestone's Commands-table proof and owns checkbox completion.

## Failure Mode Comparison

| Option | What fails | Verdict |
| --- | --- | --- |
| One five-call budget for every sub-agent | Ordinary implementation stays undispatchable, and the universal line hides the scout/implementer difference | Rejected |
| Host-declared caps with no numeric default | Plan artifacts cannot derive a budget, hosts can silently choose permissive caps, and dispatchability is not self-describing | Rejected |
| Two tiers with a 20-call ceiling | Work above the ceiling must be split or stay host-owned; a task with no estimate gets one first | Accepted by the user on 2026-08-23 |

## Consequences

- The cap derives from notation goat-plan already requires. The formula is a policy limit, not a calibrated calls-per-minute ratio, and measured data can change the base or ceiling without reopening the two-tier decision.
- Rolled out 2026-08-29 as single-line replacements in `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, `.goat-flow/skill-docs/skill-conventions.md`, `workflow/skills/reference/skill-conventions.md`, and `workflow/setup/reference/execution-loop.md`, pinned by `test/contract/skill-hardening-skills-2.test.ts` (search: `Scouts get 5 tool calls; implementation gets 5 plus`).
- ADR-042 points at this tier for native sub-agents; goat-critique's specialist ceilings and every installed goat-critique mirror stay byte-identical.
