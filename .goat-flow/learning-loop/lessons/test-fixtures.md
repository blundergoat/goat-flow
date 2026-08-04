---
category: test-fixtures
last_reviewed: 2026-08-02
---

## Lesson: Command-wrapper fixtures must inspect semantic operands after safety flags

**Status:** active | **Created:** 2026-07-14
**Decision changed:** Failure-injection wrappers now scan the complete argument vector for the semantic path instead of assuming a fixed position.
**Trigger phase:** VERIFY
**Incident count:** 1 | **Latest occurrence:** 2026-07-14

**What happened:** M28's migration-failure fixture wrapped `mv` and matched the legacy source only at argument one. The hardened installer invoked `mv -n -- <source> <destination>`, so the wrapper delegated to the real command, installation exited 0, and the focused suite reported one failure even though the migration helper was behaving correctly.

**Root cause:** The fixture encoded the old command shape instead of the behavior under test. Safety flags and the option terminator shifted the source operand without changing its meaning.

**Prevention:** Command-wrapper fixtures must scan all arguments, or parse options when operand order matters, and match a unique semantic path. Keep the failure assertion alongside source/destination byte assertions so a wrapper that never activates cannot pass silently. Evidence anchor: `test/integration/setup-install-atomic-staging.test.ts` (search: `Migration helpers add safety flags`).

---

## Lesson: Migration-output fixtures must match the collision branch

**Status:** active | **Created:** 2026-06-07

**What happened:** While adding the M04 installer migration fixtures, the first `setup-install.test.ts` run failed because the legacy skill-doc test expected a whole-directory move message. The fixture deliberately pre-created `.goat-flow/skill-docs/playbooks/`, so the installer correctly used its per-entry no-overwrite branch and printed file-level moves instead.

**Root cause:** I asserted the clean-destination output shape even though the fixture setup was exercising the destination-exists branch.

**Prevention:** For migration fixtures, align assertions with the branch under test: clean destination should assert whole-directory moves; collision fixtures should assert per-entry moves and `target exists, left old entry in place`. Evidence anchor: `test/integration/setup-install-migrations.test.ts` (search: `migrates legacy skill docs without overwriting target collisions`).

---

## Lesson: CI must use package test scripts after suite splits

**Status:** active | **Created:** 2026-06-01

**What happened:** PR #45 split the audit-drift and dashboard integration tests into standalone files and updated `package.json` so fast tests exclude stateful dashboard suites while `test:slow` runs them serially. The GitHub Actions `Test` step still invoked the raw `node --import tsx --test --test-reporter=spec test/*/*.test.ts` glob, so CI bypassed the split-suite contract and failed on `test/integration/audit-drift.test.ts` with `ReferenceError: describe is not defined`. A local raw-glob rerun also exposed dashboard state cross-contamination in `dashboard /api/projects`.

**Root cause:** I updated the npm test scripts as the canonical suite entry points but did not update CI to call them, leaving Actions on an older invocation shape that no longer matched the test layout.

**Prevention:** After splitting, renaming, or serialising test files, compare `.github/workflows/ci.yml` against `package.json` test scripts before trusting local runs. CI should call the package script that encodes exclusions/concurrency instead of duplicating a raw test glob. Evidence anchors: `.github/workflows/ci.yml` (search: `npm run test:full`), `CHANGELOG.md` (search: `CI uses the split test contract`), `package.json` (search: `"test:slow": "npm run build && node scripts/run-tests.mjs slow"`), `test/integration/audit-drift.helpers.ts` (search: `export {`), `test/integration/dashboard-server.helpers.ts` (search: `DASHBOARD_STATE_PATH`).

---

## Lesson: Workflow parser refactors need both fixture coverage and typecheck

**Status:** active | **Created:** 2026-04-03
**Incident count:** 8
**Latest occurrence:** 2026-08-03

**What happened:** While tightening CI-validation checks, the first pass on the workflow `run:` parser read the wrong regex capture group and then used a router heuristic that only matched commands containing the word `router`. The focused regression suite and `tsc` both failed before the broader test run finished.
**Root cause:** Changed parsing and heuristics together without first validating the extracted command shape. The new regression covered the shell pattern, but the implementation still assumed the old capture layout and overfit to existing workflow wording.
**Recurrence 2026-08-01:** Before implementing the goat-review output validator, the producer survey found that the systemic template and shipped examples disagreed on R-IDs, `Harm:`, Evidence/Proof, and the retired overlap tag. Independent Verify RED then found that the nominally valid fixture contradicted its Top 5 threshold, provenance totals, refuter state, and Spec Drift status; correcting it changed the verdict count and exposed a stale negative-fixture mutation. After behavioral tests and typecheck went green, whole-file ESLint and gruff still caught shared-parser complexity and file-length headroom, so review positional parsing moved to a bounded helper and validator checks split in place. Evidence anchors: `test/contract/skill-hardening-review-2.test.ts` (search: `keeps goat-review finding examples on the validator-ready grammar`), `test/unit/review-validate.test.ts` (search: `Verdicts: 4/0/0/0`), `src/cli/review-command-parser.ts` (search: `buildReviewCLIFields`).
**Recurrence 2026-08-01 (state-authority M04):** The seeded V2 fixture used a broad first-occurrence replacement for `R-001`, so it changed the earlier integrity prose instead of the finding definition. The first combined lint then measured `validateConditionalSections` at complexity 12. A literal finding-prefix mutation and two narrow section-shape helpers restored the intended proof. The plan-wide anchor sweep next treated an unlabeled `path`/`literal` output placeholder as a live repository citation; changing it to `<target-project>/path` restored the explicit placeholder boundary and produced `live misses=0`. Evidence anchors: `test/unit/review-validate-verdict.test.ts` (search: `structuralValidationCases`), `src/cli/review-validate-sections.ts` (search: `warnTopFiveShape`), `test/contract/skill-hardening-review-2.test.ts` (search: `placeholder anchors exempted`).
**Recurrence 2026-08-01 (PR #57 hardening):** A compiler correction used an under-specified patch context shared by adjacent estimate and Actual parsers, so `!match` landed in the estimate parser where only `estimateMatch` exists. Re-reading both complete functions and patching their distinct variable anchors fixed the correction; the next typecheck exited zero. Evidence anchor: `src/cli/plans-effort.ts` (search: `estimateText.match(EFFORT_ESTIMATE_PATTERN)`).
**Recurrence 2026-08-01 (PR #57 preflight):** Focused behavior tests, typecheck, and the full package suite were green before repository preflight reported seven complexity-limit failures in newly hardened plan and review parsers. Splitting lifecycle, numeric-field, fence-state, and exact-ledger checks into named helpers preserved the tested contract while bringing each decision surface under the repository lint limit. That refactor removed an older evidence anchor in this entry; `stats --check` caught the stale reference before closeout, and the anchor moved to the surviving semantic parse call. Evidence anchors: `src/cli/plans-check.ts` (search: `collectNotStartedSnapshotErrors`), `src/cli/plans-effort.ts` (search: `readEffortNumbers`), `src/cli/rendered-markdown.ts` (search: `isFencedLine`), `src/cli/review-validate-ledger.ts` (search: `readDeclaredLedgerLines`).
**Recurrence 2026-08-02 (plans time export cleanup):** Removing unconsumed M01 module exports made Knip green but left the now-internal Actual-state alias unreferenced. Fresh typecheck and ESLint failed while the behavior regressions remained green; deleting the dead alias restored all three gates. Evidence anchor: `src/cli/plans-effort.ts` (search: `export interface PlanEffortNumericActual`).
**Recurrence 2026-08-03 (review heading aliases):** Refactoring the Top-5 validator to receive one resolved alias section left its missing-section warning reading the removed `lines` parameter. The first focused GREEN run failed 39/40 at that branch; passing the Findings heading location explicitly restored the same suite to 40/40. Immediate whole-file ESLint then measured both the compact-integrity and verdict readers at complexity 11; removing the redundant branch and extracting the full-verdict reader restored lint without suppression. Evidence anchors: `src/cli/review-validate-sections.ts` (search: `function warnTopFiveShape`), `src/cli/review-validate-verdict.ts` (search: `function readFullShipVerdictClaim`).
**Recurrence 2026-08-03 (indented Markdown masking):** The focused validator suite proved that four-space examples stayed hidden, but the first full package run failed `plans export` because the shared masker also hid an indented `(est: ...)` continuation inside a visible checklist item. Indented code cannot interrupt visible prose; carrying whether the prior rendered line was blank preserved wrapped task metadata while keeping standalone examples masked. Evidence anchors: `src/cli/rendered-markdown.ts` (search: `previousRenderedLineWasBlank`), `test/unit/plans-export-parsing.test.ts` (search: `parses est entries at the end of wrapped multi-line tasks`).
**Decision changed:** Before a prose parser, enumerate every shipped producer shape, validate the nominally valid fixture's relationships, and lock one grammar with focused fixtures. Negative mutations target a unique semantic substring; shipped path examples label placeholders explicitly. At first behavioral GREEN, check whole-file complexity and headroom before adding branches.
**Fix:** For parser refactors, verify in this order: (1) print/exercise extracted intermediate values and fixture relationships, (2) run the focused regression suite, (3) run `npx tsc --noEmit`, (4) run whole-file ESLint and complexity/size analysis, then (5) run the full test suite. Heuristics should match behavior patterns like `grep ... | while read ... [ ! -e ]`, not just keywords in step names.

---

## Lesson: Builder defaults do not protect direct verifier callers

**Status:** active | **Created:** 2026-07-13

**Decision changed:** Default migration-light fields at every exported consumer boundary, then run the full package suite to find callers outside focused fixtures.

**Trigger phase:** VERIFY

**Incident count:** 1

**Latest occurrence:** 2026-07-13

**What happened:** M13 defaulted missing learning-loop entries in `buildStatsReport`, and focused stats tests passed. The full `npm test` run found three `TypeError: learningLoopEntries is not iterable` failures because `test/unit/index-fresh.test.ts` calls exported `checkStats` with a legacy report object that bypasses the builder.

**Root cause:** The compatibility fallback lived only in the preferred construction path, not the exported verifier that also consumes report-shaped objects at runtime. Source typecheck did not inspect the TypeScript test caller.

**Prevention:** When adding migration-light report fields, search for every exported consumer and default absent collections at those boundaries. Run focused tests plus the package suite. Evidence anchors: `src/cli/stats/stats.ts` (search: `Older direct callers may omit entry facts`), `test/unit/index-fresh.test.ts` (search: `reportWith(indexes)`).

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

## Lesson: Isolated fixtures must create every dependency they assert

**Status:** active | **Created:** 2026-04-27
**Decision changed:** Before a focused run, enumerate and create every fixture-owned file, browser global, and source input the assertion reaches.
**Trigger phase:** VERIFY
**Incident count:** 4 | **Latest occurrence:** 2026-08-02

**What happened:** While adding ADR-024 enforcement to `stats --check`, the first integration test fixture used `package.json` with a line suffix to trigger an `invalid-line-ref` finding. The temp fixture repo did not contain `package.json`, so the checker correctly reported a stale ref instead and the test failed with "expected an invalid-line-ref finding."

**Root cause:** I reused a familiar root file path without checking the isolated fixture filesystem. The stats extractor validates refs against the temp repo, not the real goat-flow checkout.

**Recurrence 2026-08-01:** The first PR #57 terminal/dashboard batch failed three fixtures before exercising the product assertions: the ignored-root temp repo asserted `.goat-flow/plans/README.md` without creating it, the launch VM reached `window.__GOAT_FLOW_DEFAULT_PATH__` without injecting `window`, and a source-shape test searched `readDashboardAppSource()` even though that helper intentionally excludes `views/home.html`. The fixes created the asserted plan file, supplied the browser global, and read the owning HTML file directly. Evidence anchors: `test/unit/terminal-spawn.test.ts` (search: `grants build-directory writes only when Git proves they are ignored`), `test/unit/dashboard-terminal-launch/launch-flow-01.test.ts` (search: `__GOAT_FLOW_DEFAULT_PATH__`), and `test/unit/dashboard-terminal-launch/launch-flow-06.test.ts` (search: `launches Home setup and harness repair with workspace access`).

**Recurrence 2026-08-01 (full suite):** The focused launch suite was green, but `dashboard-home.test.ts` separately deep-compared the complete setup launch-options object and retained its old two-field fixture. The full suite correctly failed until that consumer required `accessMode: "workspace"`. Evidence anchor: `test/unit/dashboard-home.test.ts` (search: `Setup Claude Code via Claude Code`).

**Recurrence 2026-08-02:** M02 added an exact Git-ignore precondition to quality persistence. The real-path/symlink-alias fixture initialized Git only in its parent, so the nested project correctly failed the new precondition; giving the nested project its own repository and ignore rule restored the intended alias proof. The redirected-directory fixture then showed that checking ignore before inspecting existing path components masked the more specific symlink-containment decision, so both persistence helpers now complete their read-only component inspection before the ignore gate and create nothing until both pass. The first D4 report counter also over-escaped its digit regex and printed a false zero; inspecting the produced filename plus success receipt corrected the probe instead of reopening a working fix. Evidence anchors: `test/unit/quality-draft-capture.test.ts` (search: `shares one capture across real-path and symlink aliases`; search: `preserves a paused open writer until its completed report persists`), `test/unit/quality-subcommands.test.ts` (search: `refuses a redirected quality-report directory`), and `src/cli/quality/quality-command.ts` (search: `inspectedComponents`).

**Recurrence 2026-08-02 (plans time):** The first end-to-end timing fixture declared one minute of other work in its headline while its counted task, proof, and plan/admin entries contained zero other minutes. Timing finalization succeeded, but the live strict check correctly failed on the unrelated accounting mismatch before the event-deletion assertion could prove receipt authority. Aligning the fixture headline with its counted `1 product / 1 proof / 0 other` baseline restored the intended proof. Evidence anchor: `test/unit/plans-time.test.ts` (search: `function writeTimingFixture`).

**Prevention:** Treat each fixture as an isolated runtime: list the files, globals, source graph, and baseline validator invariants the SUT or assertion will read, then create or satisfy them explicitly. Before asserting one strict-check behavior, run the fixture through the unchanged strict baseline and ensure unrelated errors are absent. Never assume a real-checkout file exists in a temp repo, a browser global exists in a VM, or a helper's name implies it includes an adjacent template. In temp-repo stats fixtures, cite a file the fixture creates; `.goat-flow/learning-loop/footguns/hooks.md` can carry both the bucket body and a self-reference. Evidence anchor: `test/integration/stats-command.test.ts` (search: `missing semantic anchor`).

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

## Lesson: Current-version fixtures must derive from package metadata

**Status:** active | **Created:** 2026-07-16
**Decision changed:** Healthy current-version fixtures now interpolate the package-derived audit version instead of pinning a release literal.
**Trigger phase:** VERIFY
**Incident count:** 1 | **Latest occurrence:** 2026-07-16

**What happened:** After goat-flow was bumped from 1.13.1 to 1.14.0, the full test suite failed two skill-doctor cases. Their shared healthy fixture still emitted goat-flow-skill-version 1.13.1, so the runtime correctly classified the fixture as warn rather than pass.

**Root cause:** The fixture represented the current installed version but hard-coded the previous release number. The version sweep covered runtime and release surfaces without checking this semantic test fixture.

**Prevention:** Fixtures that mean current must import package-derived version metadata; literals are reserved for tests that intentionally model old or mismatched installs. After a release bump, search the test tree for the prior version before running the full suite. Evidence anchors: test/unit/skill-doctor.test.ts (search: skillMarkdown), src/cli/constants.ts (search: export const AUDIT_VERSION).

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

## Lesson: Pressure scenarios must isolate the rule under test

**Status:** active | **Created:** 2026-07-12
**Decision changed:** Validate the provenance of every pressure fact before launching an evaluator; a source-grounded target decision does not make transplanted urgency or simplicity facts valid.
**Trigger phase:** VERIFY
**Incident count:** 3 | **Latest occurrence:** 2026-08-02

**What happened:** The flagship skill-TDD scenario offered `Commit now` as the expected failing choice even though ADR-040 and every installed instruction file categorically forbid coding-agent commits. An agent could reject that option without following test-first discipline, so the scenario could overstate RED/GREEN evidence.

**Root cause:** The scenario varied both test ordering and repository-history authority. Its wrong answer was independently invalid under always-loaded policy.

**Fix:** The replacement uses an explicitly labelled illustrative security-depth scenario and holds file scope plus mirror duties constant; only test-first ordering differs. The shipped scenario defines input/output shape, never incident evidence; live runs must substitute current target-project facts. Evidence anchors: `workflow/skills/playbooks/skill-quality-testing/tdd-iteration.md` (search: `Illustrative four-pressure scenario`) and `test/contract/skill-hardening-shared-2.test.ts` (search: `isolated from repository-history policy`).

**Recurrence 2026-08-02:** The first goat-debug hardening wave used source-grounded lifecycle and probe decisions but added an unsupported “one-line patch” and transplanted “teammate is waiting” pressure from a different historical scenario. All three evaluators selected the safe option, and the host invalidated the entire wave rather than treating its rationales as RED evidence. The redacted receipt remains local current-run context, not durable evidence. Committed evidence anchor: `src/dashboard/preset-prompts.json` (search: `"id": "fix-bug"`) contains the real fix intent but no patch-size or waiting claim.

**Recurrence 2026-08-02 (same hardening run):** After correcting fact provenance, a hypothesis evaluator prompt explicitly requested “What would disconfirm each.” The evaluator returned good falsifiers, but the prompt had named the target field and therefore measured recitation rather than unaided technique use. The host excluded the run and rewound after the second scenario-method correction. This is the same isolation failure at a different layer: the fixture supplied the decision it claimed to test.

**Prevention:** Before using a pressure or application fixture, compare every option with always-loaded instructions and accepted ADRs, attach a literal source anchor to every fact, and remove output fields that disclose the graded rule. Do not blend facts from separate incidents or ask the evaluator to recite the target technique. Keep all non-target obligations equal so only the rule under test explains the result.

**Current-run record:** `.goat-flow/logs/sessions/2026-08-01-goat-review-tdd.md` preserves the M06 pressure and seeded-corpus receipts for this checkout. It is gitignored session evidence, not a durable repository anchor.

---

## Lesson: Node test filters must precede explicit test paths

**Status:** active | **Created:** 2026-08-01

**Decision changed:** Put Node test-runner filters before explicit test paths and verify the reported test count proves isolation.

**Trigger phase:** VERIFY

**What happened:** The M03 anchor command placed `--test-name-pattern` after the TypeScript test path. The Node/tsx runner executed all 110 contracts instead of the one anchor contract, so expected interim mirror failures obscured the intended proof. Moving the filter before the path produced exactly one passing test and the zero-miss diagnostic.

**Evidence:** `test/contract/skill-hardening-review-2.test.ts` (search: `goat-review internal anchors resolve to named current targets`) - this is the intended isolated contract; its diagnostic reports checked, exempted, and missed anchors.

**Prevention:** Use `node --import tsx --test --test-name-pattern="<pattern>" <test-path>` and require both the named subtest and expected `# tests` count before treating the run as focused proof.
