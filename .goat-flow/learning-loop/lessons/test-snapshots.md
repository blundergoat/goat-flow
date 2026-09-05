---
category: test-snapshots
last_reviewed: 2026-08-24
---

**Scope:** Keeping asserted values true - snapshot files and tables, metadata contracts beyond the typed shape, and which field a check should assert. Building the fixtures themselves is [test-fixtures.md](test-fixtures.md); choosing and invoking the runner is [test-execution-environment.md](test-execution-environment.md); getting a checker's own counting right is [verification-validators.md](verification-validators.md).

## Lesson: New blocking checks can break passing fixtures even when the scanner is correct

**Status:** historical | **Created:** 2026-04-03 | **Reason:** Scanner/rubric system removed per ADR-013

**Prevention:** When adding a new required check, audit both failure fixtures and passing baselines. For rubric changes, verify in this order: (1) focused regression, (2) disk-backed passing fixtures, (3) disk-backed failing fixtures, (4) full suite. If a positive fixture drops, update the fixture input first, not the expected score.

**What happened:** Added a new deny-hook check for pipe-to-shell blocking. The focused scanner regression passed, but the next full-suite run dropped both disk-backed `passing-minimal` and `passing-full` from `100` to `99`.
**Root cause:** The new rubric requirement was correct, but the "passing" fixture baseline still used settings-based deny rules that blocked `rm -rf`, force push, and `chmod 777` without also blocking `curl | bash` / `wget | sh`. Positive fixtures are just as sensitive to new honesty checks as failing fixtures.

---

## Lesson: Snapshot fixtures can carry metadata beyond the typed numeric contract

**Status:** active | **Created:** 2026-04-24

**Prevention:**
1. When adding repo-integration tests for parsed JSON fixtures, inspect the real file shape before using `deepEqual` on a narrowed TypeScript view.
2. For historical compatibility tests, verify the required semantic fields and tolerate additive metadata unless the test is explicitly enforcing exact wire format.

**What happened:** A backfill for missing v1.2.0–v1.2.4 manifest snapshots added a repo-integration test that `deepEqual`ed `loadSnapshotFacts()` output against numeric expectations. The first verification run failed because the historical `v1.1.0` snapshot already includes an extra `_note` key inside `snapshot_facts`, so the runtime payload was broader than the narrowed TypeScript interface used by the checker.

**Root cause:** I treated the snapshot loader as if it returned only the typed numeric fields, but the JSON contract in the repository also carries human-facing metadata that survives parsing.

**Fix:** Assert the numeric fields individually and allow extra metadata keys in historical snapshot fixtures.

---

## Lesson: Snapshot-table updates must verify the snapshot files, not infer from live state

**Status:** active | **Created:** 2026-05-02

**Prevention:** Before editing snapshot-claim expectations or `workflow/manifest-snapshots/README.md`, read the matching versioned snapshot JSON files and copy their `snapshot_facts` values. Only update the current release snapshot after confirming the catalog/check change is intentionally part of that release. Evidence anchors: `src/cli/audit/check-snapshot-claims.ts` (search: `loadSnapshotFacts`), `workflow/manifest-snapshots/v1.3.2.json` (search: `"checks_harness": 16`), `workflow/manifest-snapshots/v1.4.0.json` (search: `"presets_count": 26`).

**What happened:** While updating the preset catalog contract after intentionally removing built-in prompts, I added v1.3.1, v1.3.2, and v1.4.0 to the snapshot-claim test expectations. I inferred the v1.3.2 harness count from current live state and set it to 17, but the frozen `workflow/manifest-snapshots/v1.3.2.json` file records 16 harness checks. The focused snapshot test failed until I reread the snapshot file and corrected the expectation and README table.

**Root cause:** I mixed live manifest facts with frozen release-snapshot facts. Snapshot tests are supposed to preserve historical release state, so current repo counts are the wrong source unless the current release snapshot itself is being updated.

---

## Lesson: Audit check tests should assert the public failure field

**Status:** active | **Created:** 2026-05-06
**Decision changed:** Assert each public result field according to its declared role before matching prose.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 3 | **Latest occurrence:** 2026-07-16

**Prevention:** For harness-audit regressions, assert the serialized/public `CheckResult` contract first: `status`, `displayStatus`, `impact`, `failure.message`, and `howToFix` when relevant. Only assert raw finding phrasing if that phrasing is intentionally part of the public contract. Evidence anchors: `src/cli/audit/harness-scoring.ts` (search: `Convert a harness check`), `src/cli/audit/harness/check-context.ts` (search: `missing step words inside the section`).

**What happened:** While tightening the execution-loop smoke check, the first focused `test/unit/audit-command.test.ts` run failed because the new regression asserted that `CheckResult.failure.message` would contain the raw finding text `inside the section`. The implementation was already failing the check correctly; `failure.message` exposed the public recommendation text (`Add READ, SCOPE, ACT, VERIFY steps under the "Execution Loop" heading...`) instead.

**Root cause:** I wrote the test against an internal diagnostic phrase rather than the audit result field users and dashboard consumers actually receive.

**Recurrence (2026-07-13):** The M07 ownership test matched a detailed validator finding against `ManifestValidationError.message`, but the public summary intentionally contains only the finding count. The validator was correct; the assertion now inspects `ManifestValidationError.findings`, matching existing manifest tests. Evidence anchor: `test/unit/manifest-file-ownership.test.ts` (search: `rejects ownership records without a usable source or generator`).

**Recurrence (2026-07-16):** The PR #56 recovery regression correctly received separate `recommendations` and `howToFix` arrays from `HarnessCheckResult`, but the first assertion looked for recommendation text in `howToFix`. The runtime fix was correct; the focused run reported `pass 161`, `fail 1` until the assertion was aligned with the public field contract. Evidence anchors: `src/cli/audit/harness/helpers.ts` (search: `Build a failing harness-check result with recommendations`), `test/integration/audit-quality.test.ts` (search: `reports an unreadable session-log listing without aborting the audit`).

---

## Lesson: Fixture-heavy tests need a higher setup-bloat threshold

**Status:** resolved | **Created:** 2026-05-30 | **Resolved:** 2026-08-02

**What happened:** During the M00 gruff cleanup, `test-quality.setup-bloat` reported 158 advisory findings at the default 12-line threshold. The top offenders were not opaque unit tests; they were harness, dashboard, quality-history, and terminal tests that build temp projects, create fake servers, inject browser globals, or serialize audit payloads before the assertion.

**Root cause:** The default threshold is tuned for small unit tests. goat-flow has many contract tests where visible fixture construction is part of the evidence. Extracting all of that setup into generic helpers would hide the behavioural contract the test is meant to preserve.

**Resolution:** Gruff 0.4.0 no longer exposes `test-quality.setup-bloat`; `gruff-ts list-rules test-quality.setup-bloat` reports an unknown rule. Do not recreate its stale config block merely to preserve historical evidence.

**Prevention:** Keep fixture construction visible when it explains the behavioural contract. If a current rule reports excessive setup, assess each test against that rule's live options; extract reusable builders only when they clarify the SUT call and assertion.

---
