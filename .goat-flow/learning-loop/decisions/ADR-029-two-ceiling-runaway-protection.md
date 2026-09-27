# ADR-029: Two-ceiling runaway protection for orchestrated long-lived resources

**Status:** Accepted
**Date:** 2026-05-25
**Author(s):** Matt Hansen
**Ticket/Context:** Derived from mini-swe-agent PR #832 during the 2026-05-25 comparative-analysis pass; related footgun `.goat-flow/learning-loop/footguns/cleanup-layering.md`.
**Updated:** 2026-09-05 - condensed; the dead `class TerminalSession` anchor is replaced with the current PTY exit handler.

## Context

A long-lived resource managed at one layer (a container, a PTY session, a scheduled remote agent, a batch worker) has its own cleanup: a TTL, a `--rm` flag, kernel reaping on process death. That protects the system. The consumer that operates against the resource (the agent loop, the WebSocket reader, the poller) has no native awareness that the resource was reaped, so it keeps issuing operations until something else stops it. One ceiling looks sufficient until the consumer outlives the resource, and then each operation silently no-ops, fails, or burns a finite budget.

The instigating evidence is mini-swe-agent PR #832 (2026-05-20). A Docker run with `container_timeout: 2h` had its container reaped at two hours while the agent loop kept issuing `docker exec`; each call failed cheaply at the Docker layer but still incurred an LM API charge first. The fix added `wall_time_limit_seconds` as a separate ceiling inside the agent loop that raises `TimeExceeded` before the container can die.

goat-flow does not orchestrate containers, but the same shape applies to dashboard PTY sessions (`src/cli/server/terminal.ts`, search: `pty.onExit`), to any future resumable audit batch (`src/cli/audit/audit.ts`, search: `runAuditBatch`), and to any future scheduled remote agent with a local poller.

## Decision

Any consumer of an orchestrated long-lived resource carries its own ceiling, set strictly shorter than the resource's TTL; both ceilings are required.

- The **resource ceiling** (`container_timeout`, `session_idle_timeout`, a run TTL) guarantees the resource is released even if the orchestrator misbehaves.
- The **consumer ceiling** (`wall_time_limit_seconds`, `max_iterations`, `max_polls`) guarantees the consumer stops issuing operations, and stops spending API budget, quota, or queue slots, before the resource can disappear.
- The consumer ceiling fires first, with enough gap to wind down cleanly: write final state, emit a structured exit, return through normal control flow.
- Introducing or tuning a resource TTL names the matching consumer ceiling in the same commit, so a grep for the TTL field returns both.

## Failure Mode Comparison

| Option | What fails | Verdict |
| --- | --- | --- |
| Resource ceiling only | The consumer keeps operating after the reap and burns budget per failure; the PR #832 incident | Rejected |
| Consumer ceiling only | A consumer crash before its ceiling leaks the resource | Rejected |
| Two ceilings, resource first | Same as resource-only; the consumer ceiling is load-bearing only if it fires first | Rejected |
| Two ceilings, consumer first | Clean wind-down inside the consumer's own exit semantics; the resource is still reaped if the consumer crashes | Accepted |

## Consequences

- Every new orchestrated resource ships with both ceilings and a test in which the consumer ceiling fires first.
- The dashboard PTY layer emits one `exit` event when the PTY ends (`src/cli/server/terminal.ts`, search: `pty.onExit`), so consumers learn of a dead session from a signal rather than from per-write failures.
- A refactor that "simplifies by removing the inner ceiling" is the failure this record exists to resist.

## Reversibility

Two-way at the per-surface layer: a consumer ceiling can be tuned or replaced per surface. One-way at the principle layer: goat-flow does not ship orchestrated long-lived resources with a single ceiling. Revisit if a runtime primitive gives consumers reliable, low-latency notification of a reap; none of the supported runners offers one today.
