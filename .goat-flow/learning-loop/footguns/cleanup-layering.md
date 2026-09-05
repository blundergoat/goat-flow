---
category: cleanup-layering
last_reviewed: 2026-09-05
---

## Footgun: Resource cleanup at one layer leaves the consumer loop running at the next layer

**Status:** active | **Created:** 2026-05-25 | **Evidence:** EXTERNAL_REFERENCE

**Prevention:**
1. Two ceilings: for any orchestrated resource with its own TTL, the consumer's loop has its own, shorter ceiling. Resource cleanup protects the system; the loop ceiling protects the consumer. ADR-029 records the rule so a later "simplify by removing the inner ceiling" refactor has to argue with it.
2. Every resource ceiling has a test that exercises the consumer when the ceiling fires.
3. When introducing or tuning a resource TTL, name the matching consumer-loop ceiling in the same commit, so a grep for the TTL field surfaces it.

**Symptoms:** A long-lived resource (container, sandbox, process, session, lock) is reaped by its own TTL, and the consumer that was using it keeps issuing operations against the dead resource. Each call fails fast but still costs time and money, and nothing breaks until a timeout actually fires.

**Why it happens:** Cleanup is local to one layer, the orchestrator or the kernel reaping a `--rm` container, and does not propagate to the consumer's loop, which assumes the resource lives as long as the loop does.

**Evidence:** External, mini-swe-agent PR #832 (merged 2026-05-20): "When container_timeout expires and Docker removes the container (--rm), the agent keeps issuing commands and burning API calls", fixed by a separate `wall_time_limit_seconds` ceiling that raises `TimeExceeded` before the container dies, tested with a one-second limit against `sleep 2`. Local surface: `src/cli/server/terminal.ts` (search: `interface TerminalSession`) pairs a PTY with its own OS lifecycle against WebSocket clients with theirs, and the loop checks `session.status` defensively per send rather than propagating one eager "session dead" event. `src/cli/audit/audit.ts` (search: `runAuditBatch`) is an in-memory batch with no long-lived resource today, so the rule applies there only if a batch ever gains per-instance sandboxes.

---

## Footgun: Session-scoped cleanup over a project-scoped resource deletes a sibling's live state

**Status:** active | **Created:** 2026-08-01 | **Evidence:** ACTUAL_MEASURED
**Incident count:** 2 | **Latest occurrence:** 2026-08-27

**Prevention:** Before giving a session, request, connection, or process its own cleanup handle, name the resource that handle deletes. When the resource key is coarser than the handle's scope (project versus process, directory versus file), bind ownership into a cross-process primitive such as an exclusive filesystem claim; an in-memory map or reference count is insufficient, and a `dispose()` that deletes by pattern rather than a verified owner token is the tell. Revalidate any pre-claim snapshot after ownership is acquired, treat a valid terminal receipt as another owner's immutable outcome, and scan stale ownership markers as well as source artifacts so a crash between deletion and receipt creation stays recoverable; crash recovery fails closed when the previous owner may have completed an irreversible write. Treat pathname bytes as claim content, not owner identity: keep the exclusive-create descriptor open for the whole ownership lifetime, bind the acquisition snapshot to that descriptor's identity, compare the release snapshot against it, and never accept same-byte recreation as the original marker. Make abandoned-claim recovery evidence one-shot, consumed before the first removal attempt, with fresh inspection required after `changed`, `missing`, or any failed removal.

**Symptoms:** Two concurrent sessions on one project silently lose work. One session ends normally and the other's in-flight draft vanishes before it is processed, with no error and no receipt, or one input yields two outputs because both sessions processed it before either deleted it.

**Why it happens:** `ensureQualityDraftStagingDirectory` derives the watched directory from the project root, so N dashboard processes share one directory while each module instance believes it owns it. A process-local `rootCaptures` map fixed siblings inside one server but could not serialize a second process; its `dispose()` swept every draft, each process's `busy` flag guarded only its own loop, and the agent-chosen draft nonce bound nothing to one server.

**Evidence:** Reproduced in-process on 2026-08-01 and across two synchronized Node processes on 2026-08-03: one staged draft produced two report files, and shutdown in one instance could delete state the other was watching. `src/cli/server/quality-draft-capture.ts` (search: `orphanedOwnership`) now takes an exclusive filesystem claim before reading or persisting, scans orphaned ownership without acquiring it, rejects stale claims with terminal receipts, and limits shutdown to `ownedClaims`. Regressions: `test/unit/quality-draft-capture.test.ts` (search: `persists one draft once across independent server processes`) and (search: `preserves a terminal receipt when a late claimant saw the old draft`); `test/unit/quality-draft-orphan-recovery.test.ts` (search: `rejects an orphaned stale claim when its draft is already gone`). **Recurrence 2026-08-27 (M41 reusable claim helper):** pathname bytes alone first looked sufficient. `src/cli/path-write-claim.ts` (search: `readOwnedClaimSnapshot`) retains the descriptor from exclusive creation, and the same file (search: `claimSnapshotMatchesDescriptor`) binds device, inode, metadata-change time, and size to `fstat()` before accepting ownership and (search: `RECOVERY_SNAPSHOTS.delete(evidence)`) consumes recovery evidence before the first removal. `test/unit/path-write-claim.test.ts` (search: `reports ownership-changed and leaves foreign marker state untouched`), (search: `refuses marker tampering before ownership confirmation`), and (search: `never expires or steals an old claim and permits explicit identity-bound recovery`) exercise POSIX unlink-and-recreate and Windows in-place mutation; the pending Windows runner result remains MP1 evidence, so the platform split is source-level, not runtime proof.
