---
category: test-fixtures
last_reviewed: 2026-05-26
---

## Lesson: Workflow parser refactors need both fixture coverage and typecheck

**Status:** active | **Created:** 2026-04-03

**What happened:** While tightening CI-validation checks, the first pass on the workflow `run:` parser read the wrong regex capture group and then used a router heuristic that only matched commands containing the word `router`. The focused regression suite and `tsc` both failed before the broader test run finished.
**Root cause:** Changed parsing and heuristics together without first validating the extracted command shape. The new regression covered the shell pattern, but the implementation still assumed the old capture layout and overfit to existing workflow wording.
**Fix:** For parser refactors, verify in this order: (1) print/exercise the extracted intermediate values, (2) run the focused regression suite, (3) run `npx tsc --noEmit`, then (4) run the full test suite. Heuristics should match behavior patterns like `grep ... | while read ... [ ! -e ]`, not just keywords in step names.

---

## Lesson: Rubric honesty changes need both in-memory and disk-backed fixture sync

**Status:** historical | **Created:** 2026-04-03 | **Reason:** Rubric/scanner system removed per ADR-013; specific check IDs no longer exist

**What happened:** Tightened `2.2.2` so a registered stop hook only passes when it also runs real validation commands. The new focused regression passed immediately, but the disk-backed `failing-known` fixture still expected the old failure set and broke on the next verification step.
**Root cause:** Updated the rubric logic and the in-memory regression corpus first, but forgot that `test/fixtures/projects/failing-known/fixture.json` and `test/fixtures/project-fixtures.test.ts` also encode expected failing check IDs. Scanner honesty work touches more than one fixture layer.
**Fix:** Whenever a rubric check changes semantics, verify in this order: (1) focused in-memory regression, (2) disk-backed fixture corpus, (3) full suite. Search for the check ID in `test/fixtures/` before treating the change as complete.

---

## Lesson: New blocking checks can break passing fixtures even when the scanner is correct

**Status:** historical | **Created:** 2026-04-03 | **Reason:** Scanner/rubric system removed per ADR-013

**What happened:** Added a new deny-hook check for pipe-to-shell blocking. The focused scanner regression passed, but the next full-suite run dropped both disk-backed `passing-minimal` and `passing-full` from `100` to `99`.
**Root cause:** The new rubric requirement was correct, but the "passing" fixture baseline still used settings-based deny rules that blocked `rm -rf`, force push, and `chmod 777` without also blocking `curl | bash` / `wget | sh`. Positive fixtures are just as sensitive to new honesty checks as failing fixtures.
**Fix:** When adding a new required check, audit both failure fixtures and passing baselines. For rubric changes, verify in this order: (1) focused regression, (2) disk-backed passing fixtures, (3) disk-backed failing fixtures, (4) full suite. If a positive fixture drops, update the fixture input first, not the expected score.

---

## Lesson: Snapshot fixtures can carry metadata beyond the typed numeric contract

**Status:** active | **Created:** 2026-04-24

**What happened:** A backfill for missing v1.2.0–v1.2.4 manifest snapshots added a repo-integration test that `deepEqual`ed `loadSnapshotFacts()` output against numeric expectations. The first verification run failed because the historical `v1.1.0` snapshot already includes an extra `_note` key inside `snapshot_facts`, so the runtime payload was broader than the narrowed TypeScript interface used by the checker.

**Root cause:** I treated the snapshot loader as if it returned only the typed numeric fields, but the JSON contract in the repository also carries human-facing metadata that survives parsing.

**Fix:** Assert the numeric fields individually and allow extra metadata keys in historical snapshot fixtures.

**Prevention:**
1. When adding repo-integration tests for parsed JSON fixtures, inspect the real file shape before using `deepEqual` on a narrowed TypeScript view.
2. For historical compatibility tests, verify the required semantic fields and tolerate additive metadata unless the test is explicitly enforcing exact wire format.

---

## Lesson: Stats fixtures need real files for line-reference assertions

**Status:** active | **Created:** 2026-04-27

**What happened:** While adding ADR-024 enforcement to `stats --check`, the first integration test fixture used `package.json` with a line suffix to trigger an `invalid-line-ref` finding. The temp fixture repo did not contain `package.json`, so the checker correctly reported a stale ref instead and the test failed with "expected an invalid-line-ref finding."

**Root cause:** I reused a familiar root file path without checking the isolated fixture filesystem. The stats extractor validates refs against the temp repo, not the real goat-flow checkout.

**Prevention:** In temp-repo stats fixtures, cite a file the fixture creates when asserting line-reference behavior. For this path, `.goat-flow/footguns/hooks.md` is created by the fixture and can carry both the bucket body and a self-reference. Evidence anchor: `test/integration/stats-command.test.ts` (search: `missing semantic anchor`).

---

## Lesson: Snapshot-table updates must verify the snapshot files, not infer from live state

**Status:** active | **Created:** 2026-05-02

**What happened:** While updating the preset catalog contract after intentionally removing built-in prompts, I added v1.3.1, v1.3.2, and v1.4.0 to the snapshot-claim test expectations. I inferred the v1.3.2 harness count from current live state and set it to 17, but the frozen `workflow/manifest-snapshots/v1.3.2.json` file records 16 harness checks. The focused snapshot test failed until I reread the snapshot file and corrected the expectation and README table.

**Root cause:** I mixed live manifest facts with frozen release-snapshot facts. Snapshot tests are supposed to preserve historical release state, so current repo counts are the wrong source unless the current release snapshot itself is being updated.

**Prevention:** Before editing `EXPECTED_RELEASE_SNAPSHOTS` or `workflow/manifest-snapshots/README.md`, read the matching versioned snapshot JSON files and copy their `snapshot_facts` values. Only update the current release snapshot after confirming the catalog/check change is intentionally part of that release. Evidence anchors: `test/unit/check-snapshot-claims.test.ts` (search: `EXPECTED_RELEASE_SNAPSHOTS`), `workflow/manifest-snapshots/v1.3.2.json` (search: `"checks_harness": 16`), `workflow/manifest-snapshots/v1.4.0.json` (search: `"presets_count": 26`).

---

## Lesson: Audit check tests should assert the public failure field

**Status:** active | **Created:** 2026-05-06

**What happened:** While tightening the execution-loop smoke check, the first focused `test/unit/audit-command.test.ts` run failed because the new regression asserted that `CheckResult.failure.message` would contain the raw finding text `inside the section`. The implementation was already failing the check correctly; `failure.message` exposed the public recommendation text (`Add READ, SCOPE, ACT, VERIFY steps under the "Execution Loop" heading...`) instead.

**Root cause:** I wrote the test against an internal diagnostic phrase rather than the audit result field users and dashboard consumers actually receive.

**Prevention:** For harness-audit regressions, assert the serialized/public `CheckResult` contract first: `status`, `displayStatus`, `impact`, `failure.message`, and `howToFix` when relevant. Only assert raw finding phrasing if that phrasing is intentionally part of the public contract. Evidence anchors: `src/cli/audit/audit.ts` (search: `Convert a harness check`), `test/unit/audit-command.test.ts` (search: `execution loop smoke check only accepts step words inside the section`).
