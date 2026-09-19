---
category: verification-testing-process
last_reviewed: 2026-09-19
---

**Scope:** Process-lifecycle tests - timeout deadlines independent of child close, observable readiness before termination signals, and delegated multi-turn runs that must keep recoverable session state. What a test must establish in general is [verification-testing.md](verification-testing.md); building fixtures is [test-fixtures.md](test-fixtures.md).

## Lesson: Timeout completion needs a deadline independent of child close

**Status:** active | **Created:** 2026-07-12
**Decision changed:** Treat a timeout response as incomplete proof until the host-facing call also returns within its wall-clock bound.
**Trigger phase:** VERIFY
**Incident count:** 2 | **Latest occurrence:** 2026-08-09
**Merged:** 2026-09-15 - moved here from `.goat-flow/learning-loop/lessons/verification-testing.md` when that bucket was split along the process-lifecycle seam to recover its headroom.

**Prevention:** Test timeout runners with a confirmed-started descendant that retains an inherited output handle. Assert the marker, response mode, timeout message, and wall-clock bound; a kill signal or timeout message alone does not prove the user regains control. Evidence anchors: `scripts/preflight-command-runner.mjs` (search: `cleanup deadline reached after process-group escalation`), `workflow/hooks/run-with-bash.mjs` (search: `function stopHookProcessTree`).

**What happened:** The seven-skill pressure matrix reproduced a preflight runner that exceeded its hard timeout after process-group escalation: a detached test helper escaped the group, inherited stdout and stderr, and held those pipes open, so Node delayed the child's `close` event after the direct process exited. The runner now uses a one-shot cleanup deadline and closes its local capture streams; the hook launcher starts a detached POSIX process group, uses Windows tree termination on native Windows, stops the tree at the deadline, and delivers one timeout result without waiting for a late close.

**Root cause:** Both timeout paths treated direct-child termination as completion, and the hook launcher killed Bash without bounding the process tree it had started.

**Recurrence 2026-08-09:** A preflight run reported `bounds gruff hooks with a timeout-specific response` as transient because its full-suite retry passed. Running the named test directly reproduced the failure in 2.02 seconds: the launcher emitted the expected timeout message and status but missed its 1.5-second return bound, and a fixture that wrote a marker after starting the background child reproduced the wait. `workflow/hooks/run-with-bash.mjs` (search: `function stopHookProcessTree`), `test/unit/hook-launcher.test.ts` (search: `returns promptly after a started hook descendant exceeds its deadline`).

---

## Lesson: Real-timer terminal smoke tests need isolated verification

**Status:** active | **Created:** 2026-05-30
**Decision changed:** Process-lifecycle tests wait for an observable ready state before sending termination signals; elapsed time alone is never readiness.
**Trigger phase:** VERIFY
**Incident count:** 5 | **Latest occurrence:** 2026-09-19
**Merged:** 2026-09-05 - moved here from `.goat-flow/learning-loop/lessons/browser-evidence.md`, which owns proving browser-visible behaviour; every incident here is process readiness in the preflight runner, and the sibling entry above owns the completion bound for the same runner.
**Merged:** 2026-09-15 - moved here from `.goat-flow/learning-loop/lessons/verification-testing.md` when that bucket was split along the process-lifecycle seam to recover its headroom.

**Prevention:** Isolate real-timer smoke tests from heavy suites. For process lifecycle tests, synchronize on an observable ready state through a channel whose contract is live at that point; do not sleep for an assumed startup window or wait on output that is documented to flush only at close. Reproduce failures on the CI-supported Node runtime before treating a newer local runtime as disproof. While `publish:check` or another suite containing these tests runs, start no other work until it exits. Evidence anchors: `test/smoke/dashboard-endpoints.test.ts` (search: `uses the fallback deadline when runner output keeps updating`), `test/integration/preflight-progress.test.ts` (search: `progressReadyFile`), `scripts/preflight-command-runner.mjs` (search: `capturedOutputChunks`).

**What happened:** During `docs.missing-internal-function-doc` cleanup, a combined focused command that grouped the dashboard smoke test with heavier unit suites failed `uses the fallback deadline when runner output keeps updating`: `spawned.writes` was still `[]` at the 5600ms assertion. The touched code was comment-only. Rerunning `node --import tsx --test test/smoke/dashboard-endpoints.test.ts` immediately afterward passed with `# pass 15` / `# fail 0`; the two edited unit files also passed in isolated runs.

**Recurrence 2026-07-17:** PR #56 CI run `29530759253` failed `cleans the child process group before returning a parent termination` after 255ms. The test sent SIGTERM 200ms after launching an intermediate Node runner, before its nested fixture emitted either PID marker. My first correction tried to wait for those markers on the runner's stdout, but the production runner intentionally buffers child output until close; exact Node 20 verification then failed `124 !== 143`. The corrected fixture uses an out-of-band readiness file created only after both processes exist.

**Recurrence 2026-08-05:** PR #57 CI run `30947991560` failed `shows retry progress before close while keeping child output captured` because the test compared two-decimal elapsed labels and required each displayed interval to be at least 0.03 seconds. CPU contention reproduced the failure even though progress remained bounded and visible. The correction makes the child remain alive until the fixture observes the first progress event through an out-of-band readiness file; it asserts the lifecycle contract without treating rounded display cadence as scheduler evidence.

**Recurrence 2026-08-06:** PR #57 pull-request run `31097377526` failed `returns after escalation when an escaped descendant retains the capture pipe` because its 100 ms timeout fired before the Node fixture wrote the detached child's PID. The push run for the same commit passed. The corrected fixture signals parent cleanup only after an out-of-band ready file proves the escaped child exists, while the production deadline remains unchanged.

**Recurrence 2026-09-19:** A local `publish:check` release run failed the same escaped-pipe test: `runner returned after 2063ms instead of its bounded cleanup window`, against a 2,000 ms bound. The fast suite stopped the gate, so the slow suite never ran. The agent had started four `hooks verify` runs alongside it, and they overlapped the fast suite. Run alone, the test passed in 1,149 ms. A rerun with nothing else running passed the fast suite, 3010 of 3015 with 5 skipped. The runner defect in the entry above was not the cause.

**Root cause:** Real-timer tests treated scheduler time as proof that an asynchronous process or terminal had reached the state their assertions required. Heavy concurrent work can delay that state independently of the timer, and buffered output cannot serve as a live readiness signal.

---

## Lesson: Delegated pressure runs need persistent recovery state

**Status:** active | **Created:** 2026-07-12
**Merged:** 2026-09-15 - moved here from `.goat-flow/learning-loop/lessons/verification-testing.md` when that bucket was split along the process-lifecycle seam to recover its headroom.

**Prevention:** Use persistent native sessions for delegated or multi-turn pressure tests; keep ephemeral sessions for single-turn probes. Record the thread ID early and prove a recovery path before treating a long run as the sole release evidence.

**What happened:** A long `goat-critique` run launched with `codex exec --ephemeral` persisted Phase 1-4 evidence, was interrupted before synthesis, and `codex exec resume` then failed with `no rollout found`, so the attempt stayed UNVERIFIED and had to be repeated.

**Root cause:** The runner contract optimized for session cleanup although delegated critique is expensive and its completion evidence spans multiple agent results plus a meta-audit.
