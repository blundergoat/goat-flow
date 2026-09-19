# ADR-042: Cross-harness invocation is Ask First; native sub-agents stay unrestricted

**Status:** Accepted
**Date:** 2026-07-26
**Updated:** 2026-09-05 - condensed; the sub-agent budget wording now points at ADR-056's two tiers.

## Decision

Launching any agent-harness CLI as a subprocess to run a prompt or task (`claude -p`, `codex exec`, `agy`, `copilot`) is an Ask First boundary in all three instruction files, including the current harness's own CLI.

- The Ask First declaration for this boundary replaces the rollback command with the target harness, the prompt subject, and why a second model rather than more reading. A sent prompt cannot be rolled back.
- Availability probes (`command -v codex`, `claude --version`) are not invocations and are not gated.
- The exemption is the harness's native sub-agent mechanism: Claude Code's Agent tool and `.claude/agents/`, and skill-delegated sub-agents on every runtime. Those stay under the existing sub-agent rules: one objective, a structured return, the 5-call scout budget, and the ADR-056 implementation tier.
- Enforcement is prose-only. No settings permission entry and no deny-dangerous pattern ships with this decision.

## Context

This is not a terms-of-service concern; `claude -p` is the official harness under the user's own credentials. The concern is process. Cross-harness consultation is the user's job. The council pattern (`.goat-flow/learning-loop/patterns/multi-agent.md`, search: `Multi-agent critique - how to run it effectively`) works because the human chooses the models, keeps reviews independent, and runs the synthesis; the pattern records that reliability comes from that step and that 15-20% of claims per review fail verification. The coordination lessons say the same in practice (`.goat-flow/learning-loop/lessons/coordination.md`, search: `goat-flow correction loop runs at higher precision than council input`). An agent that silently folds another model's answer into its own skips model choice, synthesis, and verification, leaves no record of which model said what, and moves the prompt across a vendor boundary without the user deciding.

Native delegation is different in kind: same harness, same session record, already governed by the sub-agent rules, and universal across the four runtimes (`.goat-flow/learning-loop/lessons/agent-tooling.md`, search: `Sub-agent delegation is universal`).

ADR-025 and ADR-028 pair prose with mechanical enforcement because they protect shared or irreversible state, and ADR-028 followed an observed prose failure. This boundary protects process integrity and has no observed incident, so it starts prose-only.

## Failure Mode Comparison

| Option | What fails | Verdict |
| --- | --- | --- |
| Prose-only Ask First in the three instruction files | An agent can rationalise past prose it never reads; the realistic failure is not knowing the norm, and the rule sits in the auto-read file | Accepted |
| Settings ask/deny entry for the harness CLIs | Covers one of four harnesses, misses `bash -c` wrappers and path-qualified binaries, and implies the other three are ungated | Rejected |
| deny-dangerous patterns for the four CLIs | Pattern, self-test, and per-agent parity machinery for a boundary with no observed violation | Rejected for now; this is the escalation path |

## Reversibility

Two-way. On the first observed silent cross-harness launch, add deny-dangerous patterns and self-tests for the four CLIs and keep the prose rule. On a roster change (ADR-020), update the CLI list in the three instruction files and here. Rollback is removing the identical sentences from the three files; parity is checkable with `git grep -F`, and nothing mechanical depends on them.
