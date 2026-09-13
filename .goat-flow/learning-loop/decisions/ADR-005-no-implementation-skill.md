# ADR-005: No implementation skill - extend existing skills instead

**Status:** Accepted
**Date:** 2026-04-03
**Updated:** 2026-09-05 - condensed; the unshipped goat-plan Execute phase and `persona` field are recorded once below.

## Context

Two Codex critiques of consumer projects found that "fix this bug" and "build this feature" had no routing destination: `/goat-debug` stopped at diagnosis and `/goat-plan` stopped at the plan. Six independent reviewers evaluated four options.

The execution loop already defines Implement as a core mode (`workflow/setup/reference/execution-loop.md`, search: `Mode must be Plan, Implement, Explain, Debug, or Review`). The gap was carry-through into that mode, not a missing capability.

## Decision

Implementation stays in the ordinary ACT step; no implementation skill exists and none will be added.

1. **The dispatcher routes by intent.** Investigation verbs (understand, diagnose, explain) stay read-only. Implementation verbs (fix, build, change) carry through to implementation after diagnosis or planning completes.
2. **`/goat-plan` stays planning-only.** After Phase 2, `return-to-implement` hands authorized build/change work to ordinary ACT; plan-only routes stop, and new Ask First boundaries still gate. Bug fixes use `/goat-debug` D3/D4. The proposed Execute phase never shipped.
3. **No `persona` config field ships.** Autonomy tiers and Ask First boundaries in the instruction files carry the safety contract without a machine-readable lockout.

## Failure Mode Comparison

| Option | What fails | Verdict |
| --- | --- | --- |
| `goat-doer + goat-verifier`, two new skills | A verifier in the same context as the doer shares its reasoning; the split is theatre | Rejected 6/6 |
| `goat-implement`, one new skill | Implementation is what the agent does when no skill is running; a skill adds count without a distinct artefact, gate, or failure mode (ADR-009) | Rejected 5/6 |
| Extend existing skills, or treat Implement as a mode | Reviewers proposed a goat-plan execution phase; shipping kept implementation in ACT and fixed dispatcher routing instead | Accepted |

## Consequences

- Real verification comes from `/goat-review` or `/goat-qa` in a fresh invocation, not from the same agent re-reading its own diff.
- Skills do not jump into implementation early; investigation, diagnosis, or planning completes first.
- The canonical set is the 8 skills in ADR-009. `goat-clarity` is a bounded remediation workflow, not a general implementation destination.
