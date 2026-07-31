---
category: cleanup-layering
last_reviewed: 2026-08-01
---

## Footgun: Resource cleanup at one layer leaves the consumer loop running at the next layer

**Status:** active | **Created:** 2026-05-25 | **Evidence:** EXTERNAL_REFERENCE

**Symptoms:** A long-lived resource (container, sandbox, process, session, lock) has its own TTL or cleanup mechanism. When that mechanism fires, the resource is gone — but the consumer that was using it does not know. The consumer's loop keeps running, keeps issuing operations against the now-dead resource, each operation fails fast, but the failures themselves still cost time and money. The bug is shaped like "things only break when timeouts hit" and is invisible in tests that never exercise the timeout.

**Why it happens:** Cleanup mechanisms are local to one layer (the orchestrator that spawned the resource, the kernel reaping a `--rm` container, the gc finalizer). They do not propagate upward to the consumer's loop. The consumer assumes its resource is alive as long as the loop is running — but in reality, the resource is on a separate clock.

**Evidence (external — mini-swe-agent):**
- PR #832 (merged 2026-05-20, `klieret`). PR body (verbatim): "When container_timeout expires and Docker removes the container (--rm), the agent keeps issuing commands and burning API calls. Add a `wall_time_limit_seconds` config option that cleanly stops the agent via TimeExceeded before the container can die."
- Fix in external mini-swe-agent path src/minisweagent/agents/default.py (search: `wall_time_limit_seconds`) — agent gains a SEPARATE wall-clock ceiling that raises `TimeExceeded` BEFORE the docker container's `container_timeout` can fire. Two ceilings, not one.
- Tests in external mini-swe-agent path tests/agents/test_default.py (search: `test_wall_time_limit_enforcement`) — explicit fixture with `wall_time_limit_seconds: 1` + `sleep 2` to prove the ceiling fires.

**Goat-flow applicability — MEDIUM today, HIGH future:** Goat-flow does not orchestrate containers, but it has several long-lived resource surfaces where the same shape applies:
- **Dashboard terminal sessions**: `src/cli/server/terminal.ts` (search: `interface TerminalSession`) — a spawned PTY has an OS-level lifecycle (process exit, signal, OOM), while the WebSocket clients consuming it have their own. If the PTY dies but the WS is still receiving "send input" messages, those messages either silently noop or error per send. Today the loop checks `session.status` defensively; the broader principle here would be ensuring the WS receiver propagates a single "session dead" event eagerly rather than letting consumers discover via per-write failures.
- **Audit batch runs**: `src/cli/audit/audit.ts` (search: `runAuditBatch`) — currently in-memory return value, no long-running resource. But any future resumable/scheduled audit batch over many projects will have the same shape: a parent timeout, per-instance container/sandbox cleanup, and a parent loop that must not keep iterating after the per-instance resource has been reaped.
- **Future scheduled remote agents** (per `schedule` skill / cron-style automation): the remote runner has its own TTL; the local poller must not keep polling a runner whose schedule has expired.

**Prevention:**
1. **Two-ceilings rule.** For any orchestrated resource with its own TTL, the consumer's loop must have its own, SHORTER ceiling. Resource cleanup protects the system; loop ceiling protects the consumer. Both are required.
2. **Test the timeout path explicitly.** Resource-timeout behaviour is the kind of thing nobody writes a test for unless prompted. Every resource ceiling needs a test that exercises the consumer's behaviour when the ceiling fires.
3. **Document both ceilings together.** When introducing or tuning a resource TTL (`container_timeout`, `session_idle_timeout`, scheduled-run TTL), the matching consumer-loop ceiling must be named in the same commit. A grep for the resource TTL config field must surface the consumer ceiling.
4. **Codify in an ADR** (see [ADR-029-two-ceiling-runaway-protection.md](../decisions/ADR-029-two-ceiling-runaway-protection.md)) — this principle is durable and will be tempted away by future "simplify by removing the inner ceiling" refactors.

---

## Footgun: Session-scoped cleanup over a project-scoped resource deletes a sibling's live state

**Status:** active | **Created:** 2026-08-01 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Two concurrent sessions on one project silently lose work. One session ends normally and the other's in-flight file vanishes before it is processed - no error, no receipt, and the waiting agent polls for a result that never arrives. The same cause produces a second symptom: one input yields two outputs, because both sessions processed the file before either deleted it.

**Why it happens:** The handle is per session, but the resource it cleans is per project. `startQualityDraftCapture` (ADR-044) gave every dashboard reporting session its own poller, while `ensureQualityDraftStagingDirectory` derives the watched directory from the project root - so N sessions on one project shared one directory with N owners. `dispose()` then swept *every* draft in that directory, and each poller's `busy` flag guarded only its own loop, leaving the whole `await persistQualityReportText` window open for a double persist. The milestone wrote "watch the staging path per reporting session", which reads like ownership but was unimplementable: the agent chooses the draft nonce, so nothing in the filename binds a draft to a session.

**Evidence:** Reproduced 2026-08-01 by running the new cases against the pre-fix module: `test/unit/quality-draft-capture.test.ts` (search: `keeps a sibling session's draft`) failed, and (search: `persists a draft once when two sessions hold the same root`) produced two persisted reports from one draft. Both were raised as P1/P2 by Codex review on PR #57. Fixed by reference-counting one poller per resolved project root in `src/cli/server/quality-draft-capture.ts` (search: `rootCaptures`) so only the last release sweeps.

**Prevention:** Before giving a session, request, or connection its own cleanup handle, name the resource that handle deletes. When the resource key is coarser than the handle's scope (project vs session, directory vs file, table vs row), either bind ownership into the resource itself (an owner id in the filename or row) or reference-count one owner per resource key. A `dispose()` that deletes by *pattern* rather than by *ownership* is the tell, and a doc claiming per-session ownership is not evidence that the code can tell sessions apart.
