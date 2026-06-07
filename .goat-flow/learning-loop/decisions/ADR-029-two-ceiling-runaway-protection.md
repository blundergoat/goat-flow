# ADR-029: Two-ceiling runaway protection for orchestrated long-lived resources

**Status:** Accepted
**Date:** 2026-05-25
**Author(s):** Matt Hansen
**Ticket/Context:** Derived from mini-swe-agent PR #832 evidence during comparative-analysis pass on 2026-05-25; cross-references [.goat-flow/learning-loop/footguns/cleanup-layering.md](../footguns/cleanup-layering.md).

## Context

A long-lived resource managed at one layer (Docker container, PTY session, scheduled remote agent, batch worker) has its own cleanup mechanism — a TTL flag, a `--rm` instruction, a kernel-reap on process death, a cron expiration. That mechanism protects the *system*: it guarantees the resource is released even if the orchestrator misbehaves.

But the *consumer* that uses the resource — the agent loop, the WebSocket reader, the polling client — has no native awareness of when the resource was reaped. The consumer's loop keeps issuing operations against the now-dead resource until something else stops it (process exit, user Ctrl-C, eventual error cascade).

The trap is shaped: **a single cleanup ceiling appears sufficient until the consumer accidentally outlives the resource.** When that happens, the consumer's operations either silently noop, fail per-operation, or worst-case keep burning a finite budget (API costs, rate-limit quota, queue slots).

The instigating evidence is mini-swe-agent PR #832 (2026-05-20): a Docker agent run with `container_timeout: 2h` had its container reaped at the 2-hour mark, but the agent's main loop kept issuing `docker exec` commands. Each call failed cheaply at the docker layer, but each call still incurred an LM API charge before the failure was visible. The fix added `wall_time_limit_seconds` as a SEPARATE ceiling enforced inside the agent loop, raising `TimeExceeded` *before* the container's `container_timeout` could fire. PR body: "Add a `wall_time_limit_seconds` config option that cleanly stops the agent via TimeExceeded before the container can die."

Goat-flow does not orchestrate containers today, but the same shape applies to several existing and proposed surfaces:
- **Dashboard PTY sessions** (`src/cli/server/terminal.ts` search: `class TerminalSession`) — PTY has OS-level lifecycle; WS clients consume it on their own clock.
- **Future audit batch with resumability** (extension of `src/cli/audit/audit.ts` search: `runAuditBatch`) — parent timeout vs per-instance container cleanup vs per-instance worker loop.
- **Future scheduled remote agents** (per `schedule` skill) — remote runner TTL vs local poller cadence.

## Decision

For any orchestrated long-lived resource that has its own TTL or cleanup mechanism, the consumer that operates *against* that resource must have its own ceiling, set strictly shorter than the resource's TTL. Both ceilings are required; neither alone is sufficient.

- The **resource ceiling** (e.g. `container_timeout`, `session_idle_timeout`, scheduled-run TTL) protects the system from the orchestrator misbehaving. It guarantees the resource is released.
- The **consumer ceiling** (e.g. `wall_time_limit_seconds`, `max_iterations`, `max_polls`) protects the consumer's bounded resources — API budget, rate-limit quota, output budget, queue slots, cost. It guarantees the consumer stops issuing operations before the resource it depends on can disappear.

The consumer ceiling must fire **before** the resource ceiling. The gap should be large enough that the consumer can wind down cleanly (write any final state, emit a structured exit, return through normal control flow).

When introducing or tuning a resource TTL, the matching consumer-loop ceiling must be named in the same commit. A grep for the resource TTL configuration field must return the consumer ceiling alongside it.

## Failure Mode Comparison

| Option | What fails | Why rejected or accepted |
| --- | --- | --- |
| Single ceiling at the resource layer | Consumer keeps issuing operations after the resource is reaped; finite budgets (API cost, quota, queue depth) get burned per-failure until something else stops the consumer. mini's PR #832 incident is the direct example. | Rejected. The verifiable trap that motivated this ADR. |
| Single ceiling at the consumer layer | Consumer stops issuing operations on time, but the underlying resource is not guaranteed to be released — if the consumer crashes mid-loop before its ceiling fires, the resource leaks. Mini's `container_timeout: 2h` exists for exactly this reason. | Rejected. Loses the system-protection property of the resource ceiling. |
| Two ceilings, consumer fires first | Consumer winds down cleanly inside its own loop's exit semantics; resource is still guaranteed to be reaped even if the consumer crashes. | **Accepted.** Both protections compose. |
| Two ceilings, resource fires first | Same as single-ceiling-at-resource: consumer keeps issuing operations after reap. The ordering matters; the consumer ceiling is load-bearing only if it actually fires first. | Rejected. Reverses the property the consumer ceiling is meant to provide. |

## Consequences

- Every new orchestrated long-lived resource added to goat-flow (PTY session, batch worker, scheduled runner, future container support) must ship with both ceilings, and the test suite must include a scenario that exercises the consumer ceiling firing first.
- Existing surfaces should be audited:
  - Dashboard PTY sessions in `src/cli/server/terminal.ts` — verify the WS receiver eagerly propagates a single "session dead" event rather than letting consumers discover via per-write failures (per-write defensive `session.status` checks exist but are not a substitute for an active dead-resource signal).
  - Any future audit-batch resumability work (per the related-improvement-ideas backlog) must declare both a per-instance resource ceiling and a parent-loop consumer ceiling.
- The principle is durable enough to survive future refactors that may be tempted to "simplify by removing the inner ceiling." This ADR exists so that temptation is resisted.

## Reversibility

This is a two-way door at the consumer-ceiling layer (adding/removing/tuning the consumer's wall-time/iteration ceiling is reversible per surface), and a one-way commitment at the principle layer (we will not ship orchestrated long-lived resources with only one ceiling). Revisit if a new agent-runtime primitive emerges that gives the consumer reliable, low-latency notification of resource reap from the orchestrator — in that case, the active notification could substitute for the proactive consumer ceiling. No such primitive exists today across the supported agent runners.
