# ADR-006: Autonomous skill mode via complexity-conditional ceremony

**Status:** Accepted
**Date:** 2026-04-03
**Updated:** 2026-07-18 - reconciled the original phase-skipping rule with the current ceremony and goat-plan contracts.

## Context

Every tester across 5 Codex critiques bypassed BLOCKING GATEs. Skills were unusable in batch/sub-agent contexts because gates stalled the process. Later hardening separated two concerns that the original decision combined: choosing an appropriate workflow before invocation, and preserving required gates after a workflow is selected.

## Decision

Two mechanisms, not a bypass flag:

1. **Complexity controls pre-invocation routing and artifact size.** Hotfix work normally uses the no-skill execution loop; Small Feature planning uses compact milestones; Standard+ planning uses full milestones and broader verification.

2. **Selected protocols remain binding.** Once a skill is invoked, complexity MUST NOT skip that skill's required phases or verification gates. A smaller mode may compress output only where the skill explicitly defines that mode.

3. **Sub-agent gate conversion remains accepted.** When invoked as a sub-agent, most BLOCKING GATEs become CHECKPOINTs and Step 0 auto-detects scope. Safety-critical gates named by shared conventions remain blocking.

No `--autonomous` flag. Complexity and execution context choose an admitted path; neither is permission to bypass that path's safety contract.

## Superseded Portion

The original rule told Hotfix and Small Feature work to skip closing ceremony and goat-plan Phases 2-3. That portion is no longer binding. It conflicted with `.goat-flow/skill-docs/skill-preamble.md` (search: `Once a skill is explicitly invoked`) and the compact-but-complete Small File-Write path in `workflow/skills/goat-plan/SKILL.md` (search: `Mode 3: Small File-Write`).

## Consequences

- Ceremony level guides routing before invocation; it does not weaken an invoked skill.
- Small File-Write keeps concise artifacts while retaining milestone verification gates.
- Sub-agent execution does not stall on ordinary interaction gates, but safety-critical human decisions remain explicit.
- Contract coverage lives in `test/contract/skill-hardening-contracts.test.ts` (search: `records the current ceremony contract in ADR-006`).
