# ADR-056: Separate scout and implementation sub-agent budgets

**Status:** Accepted
**Date:** 2026-08-23

## Context

Every editable instruction and convention surface states one five-call sub-agent budget, so a read-only
lookup and an authorized edit-and-verify task are given the same ceiling. Six documentation surfaces plus
one contract test currently pin that universal wording.

The universal ceiling is too small for real implementation work. M18's completed parser change required
source reading, editing, focused RED, implementation, formatting correction, clarity correction, focused
GREEN, typecheck, and the fast suite; five tool calls could not carry that cycle. Evidence:
`.goat-flow/plans/1.17.0/M18-plans-check-strict-self-describing.md` (search: `## Tasks`).

Two neighbouring decisions bound the problem. ADR-005 keeps implementation in the ordinary ACT step, so
delegating one authorized ACT task creates no implementation skill. ADR-042 exempts native sub-agents
from the cross-harness Ask First boundary, where "unrestricted" means no extra approval gate rather than
unbounded work. Goat-critique's five-call critique ceiling and three-call cross-examination ceiling are
specialist scout contracts that stay fixed.

Evidence anchors:

- `.goat-flow/plans/1.17.0/ADR-056-draft-implementation-subagent-budget.md` (search: `## Decision matrix`) - the plan-local option analysis, decision matrix, and recorded human verdict
- `.goat-flow/learning-loop/decisions/ADR-005-no-implementation-skill.md` (search: `# ADR-005`)
- `.goat-flow/learning-loop/decisions/ADR-042-cross-harness-invocation-ask-first.md` (search: `# ADR-042`)
- `test/contract/skill-hardening-skills-2.test.ts` (search: `one objective, structured return, 5-call budget`) - the contract assertion that pins the current wording

## Decision

Adopt two tiers instead of one universal budget (draft Option B, accepted by the user on 2026-08-23).

| Tier | Budget |
|---|---|
| Scout - read-only lookup, review, critique, or evidence gathering | 5 tool calls, unchanged |
| Implementation sub-agent - a delegated objective explicitly authorized to edit within one task's named scope | `min(20, 5 + task estimate in minutes)` tool calls |

The five-call base covers the discovery and reporting a scout already gets; estimated minutes add
implementation room. The cap is a ceiling, not a spending target, and is not a duration model.

Supporting definitions:

- **Tool call:** one tool invocation made by the child agent. The final structured return and host-to-child messages do not count.
- **Task estimate:** the positive minutes in the task's `(est: <minutes> min <category>)` entry.
- **Unavailable count:** when a runtime cannot expose child tool-call counts, the host passes the cap in the objective and records usage as unavailable. It must not claim measured compliance.

Ownership is unchanged: a delegated return is product evidence, while the host still runs the milestone's
Commands-table proof and owns checkbox completion.

## Consequences

- Ordinary edit-and-verify work becomes dispatchable without splitting it into coordination-heavy fragments, and the cap derives from notation goat-plan already requires.
- The 20-call ceiling stops task estimates from becoming open-ended delegation authority. Work above it must be split before delegation or stay host-owned.
- A task with no estimate gets one before implementation delegation, or stays host-owned.
- The formula is a policy limit, not an empirically calibrated calls-per-minute ratio. Later measured call data can change the base or ceiling without reopening the two-tier decision.
- ADR-042, `.goat-flow/learning-loop/lessons/agent-evidence-claims.md`, goat-critique's specialist ceilings, and every installed goat-critique mirror stay byte-identical.

## Rollout

This record is promotion-only; no consumer wording has changed yet. 1.18.0 M13 owns applying the exact
single-line replacements to the six documentation surfaces (`AGENTS.md`, `CLAUDE.md`,
`.github/copilot-instructions.md`, `.goat-flow/skill-docs/skill-conventions.md`,
`workflow/skills/reference/skill-conventions.md`, `workflow/setup/reference/execution-loop.md`) and the
one contract-test assertion in `test/contract/skill-hardening-skills-2.test.ts`. 1.18.0 M14 copies the
accepted sizing sentence into goat-plan's Standard+ dispatchability guidance. The verbatim before/after
text for each surface lives in the draft's Option B section.

Until that rollout lands, the shipped surfaces still state the universal five-call budget; this ADR is the
authority for what they will say, not a claim about their current bytes.

## Rejected alternatives

- **Keep one five-call budget for every sub-agent.** No rollout cost, smallest delegation unit, but ordinary implementation stays undispatchable and the universal line keeps hiding the scout/implementer difference.
- **Host-declared caps with no numeric default.** Accommodates differing runtimes, but removes the portable default, makes plan artifacts insufficient to derive a budget, lets hosts silently choose permissive caps, and leaves task dispatchability non-self-describing.
