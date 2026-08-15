---
category: test-snapshots
last_reviewed: 2026-08-15
---

**Scope:** Keeping asserted values true - snapshot files and tables, metadata contracts beyond the typed shape, which field a check should assert, and the suite/runner selection that decides whether a fixture runs at all. Building the fixtures themselves is [test-fixtures.md](test-fixtures.md).

## Lesson: CI must use package test scripts after suite splits

**Status:** active | **Created:** 2026-06-01

**What happened:** PR #45 split the audit-drift and dashboard integration tests into standalone files and updated `package.json` so fast tests exclude stateful dashboard suites while `test:slow` runs them serially. The GitHub Actions `Test` step still invoked the raw `node --import tsx --test --test-reporter=spec test/*/*.test.ts` glob, so CI bypassed the split-suite contract and failed on `test/integration/audit-drift.test.ts` with `ReferenceError: describe is not defined`. A local raw-glob rerun also exposed dashboard state cross-contamination in `dashboard /api/projects`.

**Root cause:** I updated the npm test scripts as the canonical suite entry points but did not update CI to call them, leaving Actions on an older invocation shape that no longer matched the test layout.

**Prevention:** After splitting, renaming, or serialising test files, compare `.github/workflows/ci.yml` against `package.json` test scripts before trusting local runs. CI should call the package script that encodes exclusions/concurrency instead of duplicating a raw test glob. Evidence anchors: `.github/workflows/ci.yml` (search: `npm run test:full`), `CHANGELOG.md` (search: `CI uses the split test contract`), `package.json` (search: `"test:slow": "npm run build && node scripts/run-tests.mjs slow"`), `test/integration/audit-drift.helpers.ts` (search: `export {`), `test/integration/dashboard-server.helpers.ts` (search: `DASHBOARD_STATE_PATH`).

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

## Lesson: Snapshot-table updates must verify the snapshot files, not infer from live state

**Status:** active | **Created:** 2026-05-02

**What happened:** While updating the preset catalog contract after intentionally removing built-in prompts, I added v1.3.1, v1.3.2, and v1.4.0 to the snapshot-claim test expectations. I inferred the v1.3.2 harness count from current live state and set it to 17, but the frozen `workflow/manifest-snapshots/v1.3.2.json` file records 16 harness checks. The focused snapshot test failed until I reread the snapshot file and corrected the expectation and README table.

**Root cause:** I mixed live manifest facts with frozen release-snapshot facts. Snapshot tests are supposed to preserve historical release state, so current repo counts are the wrong source unless the current release snapshot itself is being updated.

**Prevention:** Before editing snapshot-claim expectations or `workflow/manifest-snapshots/README.md`, read the matching versioned snapshot JSON files and copy their `snapshot_facts` values. Only update the current release snapshot after confirming the catalog/check change is intentionally part of that release. Evidence anchors: `src/cli/audit/check-snapshot-claims.ts` (search: `loadSnapshotFacts`), `workflow/manifest-snapshots/v1.3.2.json` (search: `"checks_harness": 16`), `workflow/manifest-snapshots/v1.4.0.json` (search: `"presets_count": 26`).

---

## Lesson: Audit check tests should assert the public failure field

**Status:** active | **Created:** 2026-05-06
**Decision changed:** Assert each public result field according to its declared role before matching prose.
**Trigger phase:** VERIFY
**Incident count:** 3 | **Latest occurrence:** 2026-07-16

**What happened:** While tightening the execution-loop smoke check, the first focused `test/unit/audit-command.test.ts` run failed because the new regression asserted that `CheckResult.failure.message` would contain the raw finding text `inside the section`. The implementation was already failing the check correctly; `failure.message` exposed the public recommendation text (`Add READ, SCOPE, ACT, VERIFY steps under the "Execution Loop" heading...`) instead.

**Root cause:** I wrote the test against an internal diagnostic phrase rather than the audit result field users and dashboard consumers actually receive.

**Prevention:** For harness-audit regressions, assert the serialized/public `CheckResult` contract first: `status`, `displayStatus`, `impact`, `failure.message`, and `howToFix` when relevant. Only assert raw finding phrasing if that phrasing is intentionally part of the public contract. Evidence anchors: `src/cli/audit/harness-scoring.ts` (search: `Convert a harness check`), `src/cli/audit/harness/check-context.ts` (search: `missing step words inside the section`).

**Recurrence (2026-07-13):** The M07 ownership test matched a detailed validator finding against `ManifestValidationError.message`, but the public summary intentionally contains only the finding count. The validator was correct; the assertion now inspects `ManifestValidationError.findings`, matching existing manifest tests. Evidence anchor: `test/unit/manifest-file-ownership.test.ts` (search: `rejects ownership records without a usable source or generator`).

**Recurrence (2026-07-16):** The PR #56 recovery regression correctly received separate `recommendations` and `howToFix` arrays from `HarnessCheckResult`, but the first assertion looked for recommendation text in `howToFix`. The runtime fix was correct; the focused run reported `pass 161`, `fail 1` until the assertion was aligned with the public field contract. Evidence anchors: `src/cli/audit/harness/helpers.ts` (search: `Build a failing harness-check result with recommendations`), `test/integration/audit-quality.test.ts` (search: `reports an unreadable session-log listing without aborting the audit`).

---

## Lesson: Fixture-heavy tests need a higher setup-bloat threshold

**Status:** resolved | **Created:** 2026-05-30 | **Resolved:** 2026-08-02

**What happened:** During the M00 gruff cleanup, `test-quality.setup-bloat` reported 158 advisory findings at the default 12-line threshold. The top offenders were not opaque unit tests; they were harness, dashboard, quality-history, and terminal tests that build temp projects, fake servers, injected browser globals, or serialized audit payloads before the assertion.

**Root cause:** The default threshold is tuned for small unit tests. goat-flow has many contract tests where visible fixture construction is part of the evidence. Extracting all of that setup into generic helpers would hide the behavioural contract the test is meant to preserve.

**Resolution:** Gruff 0.4.0 no longer exposes `test-quality.setup-bloat`; `gruff-ts list-rules test-quality.setup-bloat` reports an unknown rule. Do not recreate its stale config block merely to preserve historical evidence.

**Prevention:** Keep fixture construction visible when it explains the behavioural contract. If a current rule reports excessive setup, assess each test against that rule's live options; extract reusable builders only when they clarify the SUT call and assertion.

---

## Lesson: Aggregate metadata counts can mask invalid individual entries

**Status:** active | **Created:** 2026-07-17
**Decision changed:** Schema-health and evidence gates validate every parsed value and required relation independently before aggregating counts or declaring presence.
**Trigger phase:** VERIFY
**Incident count:** 3
**Latest occurrence:** 2026-07-17

**What happened:** Evidence-label health compared a bucket-wide label count with its entry count. A two-entry fixture with two labels in the first entry and none in the second reported `labelCount: 2` and `hasEvidenceLabels: true`; the same matcher also accepted lowercase `observed` even though every template defines uppercase canonical labels. The first per-entry correction still collapsed two declarations in one section to one valid boolean, so the regression expectation had to tighten from one accepted entry to zero before the parser enforced mutual exclusivity. A final live-repo probe then found the strict matcher recognized only 91 of 107 labels because `**Evidence:**` also introduces narrative evidence blocks; the parser had to distinguish taxonomy metadata from prose. When the corrected fact was wired into `stats --check`, the first diagnostic used the aggregator's reserved `; ` separator and split one actionable error into two findings until the message changed to a colon.

**Root cause:** `countFootgunLabels` counted regex matches across the complete bucket and `hasEvidenceLabels` accepted `labelCount >= entryCount`. The aggregate could not preserve which section owned each match, the global case-insensitive flag weakened the documented enum, and one undifferentiated Markdown regex treated evidence-body headings as evidence-type declarations.

**Recurrence 2026-07-17:** The first `skill new --red-log` gate counted any three comma-separated tokens as pressures, accepted `fail` inside `did not fail`, accepted `- none` as a verbatim rationalisation, and searched later GREEN sections for fields missing from RED. In the same review, the shipped-scenario contract checked only that an illustrative label existed, so moving it below `## Assumption Tracking` still satisfied the test. The focused suite and full preflight both passed before adversarial probes reproduced the two semantic bypasses. Evidence anchors: `src/cli/skill-author-red-log.ts` (search: `documentedPressureCount`) now validates the isolated RED section; `test/integration/skill-author.test.ts` (search: `rejects RED receipts whose fields describe success instead of failure`) locks the near-miss; `test/contract/skill-hardening-shared-3.test.ts` (search: `scenario label must immediately precede the assumption block`) locks the required ordering relation.

**Recurrence 2026-07-17 (quality recheck):** A follow-up RED-log probe used every canonical token only inside explicit negations: `no time pressure`, `failed? no`, and `none observed because it complied`. The gate still accepted the receipt and wrote a discoverable skill because each field validator recognized tokens without validating the field's asserted meaning. The first literal fix blocked that receipt, but an immediate boundary probe reproduced the same bypass with label-prefixed absence claims: `time: no pressure`, `failed: false`, and `No rationalisation occurred`. The pressure validator now rejects a directly negated detail after a canonical label, the outcome validator rejects directly negated failure classifications, and the rationalisation validator rejects prose that explicitly reports absence. Evidence anchors: `src/cli/skill-author.ts` (search: `startsWithNegatedAssertion` and `isAbsentRationalisation`), `test/integration/skill-author.test.ts` (search: `rejects negated RED evidence that includes canonical tokens` and `rejects alternate absence claims after canonical RED labels`), and the paired acceptance control (search: `accepts positive pressure details and a substantive no-prefixed rationalisation`).

**Prevention:** Split structured Markdown into entries first, classify only frontmatter, Status-line, typed, or label-shaped standalone declarations, validate each value against its documented vocabulary, validate ordering and ownership relations explicitly, reduce each entry to at most one valid schema result, then aggregate. Pair empty-input fixtures with semantic near-misses: duplicate or unknown values, negated pressure and failure claims, explicit absence presented as evidence, placeholders presented as evidence, fields in the wrong section, labels on the wrong side of a boundary, and non-file paths. Keep the existing negative fixtures for duplicate-masks-missing, multiple labels in one value, legacy labels, wrong casing, a canonical label followed by narrative `**Evidence:**` content, and the blocking `stats --check` result. Diagnostic text must not contain the aggregator's `; ` delimiter. Evidence anchors: `src/cli/facts/shared/learning-loop.ts` (search: `getEvidenceLabelDiagnostic`) separates taxonomy metadata from prose and emits the bucket error; `src/cli/stats/stats.ts` (search: `evidence-label`) maps it to a stable rule; `test/integration/stats-command.test.ts` (search: `exactly one canonical evidence label`) locks parsing and enforcement.

---

## Lesson: Node test filters must precede explicit test paths

**Status:** active | **Created:** 2026-08-01

**Decision changed:** Put Node test-runner filters before explicit test paths and verify the reported test count proves isolation.

**Trigger phase:** VERIFY

**What happened:** The M03 anchor command placed `--test-name-pattern` after the TypeScript test path. The Node/tsx runner executed all 110 contracts instead of the one anchor contract, so expected interim mirror failures obscured the intended proof. Moving the filter before the path produced exactly one passing test and the zero-miss diagnostic.

**Evidence:** `test/contract/skill-hardening-review-2.test.ts` (search: `goat-review internal anchors resolve to named current targets`) - this is the intended isolated contract; its diagnostic reports checked, exempted, and missed anchors.

**Prevention:** Use `node --import tsx --test --test-name-pattern="<pattern>" <test-path>` and require both the named subtest and expected `# tests` count before treating the run as focused proof.
