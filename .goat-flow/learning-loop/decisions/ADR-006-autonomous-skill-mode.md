# ADR-006: Autonomous skill mode via complexity-conditional ceremony

**Status:** Accepted
**Date:** 2026-04-03
**Updated:** 2026-09-05 - condensed; the 2026-07-18 contract reconciliation and the 2026-08-04 and 2026-09-04 anchor refreshes are folded in.

## Context

Every tester across five Codex critiques bypassed BLOCKING GATEs, and skills stalled in batch and sub-agent contexts. The original fix let Hotfix and Small Feature work skip closing ceremony and goat-plan Phases 2-3. That conflicted with the shared preamble (`.goat-flow/skill-docs/skill-preamble.md`, search: `an invoked skill runs its full protocol`) and with the compact-but-complete path in `workflow/skills/goat-plan/SKILL.md` (search: `Mode 3: Small File-Write`). Two concerns had been combined: choosing a workflow before invocation, and preserving gates after selection.

## Decision

Complexity chooses the workflow before invocation; once a skill is invoked, its required phases and gates are binding.

1. **Complexity controls pre-invocation routing and artifact size.** Hotfix work normally uses the no-skill execution loop; Small Feature planning uses compact milestones; Standard and above use full milestones and broader verification.
2. **Selected protocols remain binding.** Once a skill is invoked, complexity MUST NOT skip that skill's required phases or verification gates. A smaller mode compresses output only where the skill defines that mode.
3. **Sub-agent gate conversion remains accepted.** When a skill runs as a sub-agent, most BLOCKING GATEs become CHECKPOINTs and Step 0 auto-detects scope. Safety-critical gates named by the shared conventions stay blocking.

There is no `--autonomous` flag. Complexity and execution context choose an admitted path; neither is permission to bypass that path's safety contract.

## Superseded Portion

The original rule told Hotfix and Small Feature work to skip closing ceremony and goat-plan Phases 2-3. That portion is no longer binding.

## Consequences

- Ceremony level guides routing; it does not weaken an invoked skill.
- Small File-Write keeps concise artifacts while retaining milestone verification gates.
- Sub-agent execution does not stall on ordinary interaction gates; safety-critical human decisions remain explicit.
- Contract coverage: `test/contract/skill-hardening-shared-1.test.ts` (search: `records the current ceremony contract in ADR-006`).
