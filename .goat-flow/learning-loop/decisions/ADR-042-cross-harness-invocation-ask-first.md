# ADR-042: Cross-harness invocation is Ask First; native sub-agents stay unrestricted

**Status:** Accepted
**Date:** 2026-07-26

## Decision

Launching any agent-harness CLI as a subprocess to run a prompt or task (`claude -p`,
`codex exec`, `agy`, `copilot`) is an Ask First boundary in all three goat-flow instruction
files (`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`). This includes the current
harness's own CLI: a `claude -p` subprocess spawned from a Claude Code session is gated. The
exemption is the harness's native sub-agent mechanism (Claude Code's Task tool and
`.claude/agents/`, skill-delegated sub-agents on every runtime), which stays unrestricted under
the existing sub-agent rules (one objective, structured return, 5-call budget).

For this boundary the Ask First declaration replaces the rollback-command item with: target
harness, prompt subject, why a second model rather than more reading. A sent prompt cannot be
rolled back.

Availability probes are not invocations: `command -v codex`, `claude --version`, and similar
diagnostics are not gated.

Enforcement is prose-only. No `.claude/settings.json` permission entry and no deny-dangerous
patterns ship with this decision.

## Context

This is not a terms-of-service concern: `claude -p` is the official Anthropic harness running
under the user's own credentials on the user's machine, and a parent process does not change
that. The concern is process.

Cross-harness consultation is the user's job. The council pattern
(`.goat-flow/learning-loop/patterns/multi-agent.md`, search: `Multi-agent critique - how to run
it effectively`) works because the human chooses the models, keeps reviews independent, and
runs the synthesis - that pattern records "the synthesis step is where reliability comes from"
and that ~15-20% of claims per review fail verification. The coordination lessons
(`.goat-flow/learning-loop/lessons/coordination.md`, search: `goat-flow correction loop runs at
higher precision than council input`) document the same in practice. An agent that silently
folds another model's answer into its own output skips model choice, synthesis, and
verification, and leaves no record of which model said what. Secondary concern: the prompt and
response cross a vendor boundary without the user deciding that they should.

Native sub-agent delegation is different in kind: same harness, same session record, already
governed by the sub-agent rules in every instruction file, and universal across the four
supported runtimes (`.goat-flow/learning-loop/lessons/agent-tooling.md`, search: `Sub-agent
delegation is universal`).

Precedent class: ADR-025 (agents never commit or push) and ADR-028 (GitHub CLI mostly
read-only) both constrain agent execution authority through the instruction
files. Both pair prose with mechanical enforcement because they protect shared or
irreversible state, and ADR-028 followed an observed prose failure. This boundary protects
process integrity, has no observed incident, and therefore starts prose-only.

## Failure Mode Comparison

| Option | What fails | Why rejected or accepted |
| --- | --- | --- |
| Prose-only Ask First boundary in the three instruction files | An agent can still bypass prose it never reads or rationalises past | Accepted. Matches the house pattern: mechanical gates are reserved for destructive/shared-state actions (ADR-025) or observed prose failures (ADR-028). The realistic failure mode here is not knowing the norm, and the rule sits in the auto-read file at the decision point |
| `.claude/settings.json` ask/deny entry for harness CLIs | Covers one of four harnesses; prefix patterns miss `bash -c` wrappers and path-qualified binaries; implies the other three runtimes are ungated | Rejected - asymmetric pseudo-enforcement with maintenance cost on every roster change |
| deny-dangerous hook patterns for the four CLIs | Nothing at bypass time, but requires pattern + self-test + per-agent parity machinery (the ADR-028/ADR-052 surface) for a boundary with no observed violation | Rejected for now - disproportionate pre-incident; named below as the escalation path |

## Reversibility

Two-way door. Revisit triggers:

- First observed silent cross-harness launch: add deny-dangerous patterns and self-test
  coverage for the four CLIs, following the ADR-028 escalation shape (prose rule stays; the
  hook makes it categorical).
- Agent roster change (ADR-020 governs the canonical `AgentId` tuple): update the CLI example
  list in the three instruction files and in this ADR.

Rollback is removing the two identical sentences from the three instruction files and marking
this ADR superseded; nothing mechanical depends on it.

## Consequences

- The three instruction files carry byte-identical wording for the boundary and the
  declaration variant; parity is checkable with `git grep -F`.
- The council pattern remains user-orchestrated; an agent that believes a second model would
  help must ask, naming target harness, prompt subject, and why a second model rather than
  more reading.
- Native sub-agent delegation is explicitly out of this boundary's scope; proposals to
  restrict it need their own decision record.
