# ADR-056: Separate scout and implementation sub-agent budgets

**Status:** Accepted
**Date:** 2026-08-23
**Updated:** 2026-08-29 - the two-tier budget landed across all six contract surfaces and the contract assertion.

## Context

Before this rollout, every editable instruction and convention surface stated one five-call sub-agent
budget, so a read-only lookup and an authorized edit-and-verify task had the same ceiling. Six
documentation surfaces plus one contract test pinned that universal wording.

The universal ceiling is too small for the repository's required implementation loop. Related source
reading, a scoped edit, focused verification, a bounded clarity pass, typecheck, and the relevant suite can
each require separate tool invocations. `AGENTS.md` defines that loop (search:
`## Execution Loop: READ → SCOPE → ACT → VERIFY`) and its post-source clarity obligation (search:
`run goat-clarity once before exit`).

Two neighbouring decisions bound the problem. ADR-005 keeps implementation in the ordinary ACT step, so
delegating one authorized ACT task creates no implementation skill. ADR-042 exempts native sub-agents
from the cross-harness Ask First boundary, where "unrestricted" means no extra approval gate rather than
unbounded work. Goat-critique's five-call critique ceiling and three-call cross-examination ceiling are
specialist scout contracts that stay fixed.

Evidence anchors:

- `AGENTS.md` (search: `Scouts get 5 tool calls`) - the always-loaded two-tier contract
- `.goat-flow/learning-loop/decisions/ADR-005-no-implementation-skill.md` (search: `# ADR-005`)
- `.goat-flow/learning-loop/decisions/ADR-042-cross-harness-invocation-ask-first.md` (search: `# ADR-042`)
- `test/contract/skill-hardening-skills-2.test.ts` (search: `Scouts get 5 tool calls; implementation gets 5 plus`) - the assertion that pins the implementation-budget sentence

## Decision

Adopt two tiers instead of one universal budget, accepted by the user on 2026-08-23.

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

The rollout landed on 2026-08-29 as single-line replacements in the six documentation surfaces:
`AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`,
`.goat-flow/skill-docs/skill-conventions.md`, `workflow/skills/reference/skill-conventions.md`, and
`workflow/setup/reference/execution-loop.md`. The assertion in
`test/contract/skill-hardening-skills-2.test.ts` pins the accepted implementation sentence. Goat-plan may
reuse that sizing rule in its dispatchability guidance, but that guidance is separate from this rollout.

## Rejected alternatives

- **Keep one five-call budget for every sub-agent.** No rollout cost, smallest delegation unit, but ordinary implementation stays undispatchable and the universal line keeps hiding the scout/implementer difference.
- **Host-declared caps with no numeric default.** Accommodates differing runtimes, but removes the portable default, makes plan artifacts insufficient to derive a budget, lets hosts silently choose permissive caps, and leaves task dispatchability non-self-describing.
