---
category: test-fixtures
last_reviewed: 2026-08-10
---

**Scope:** Building and keeping fixtures true - collision branches, semantic operands, in-memory against disk-backed corpora, and fixtures that drift from the code they model. Runner behaviour is [test-execution-environment.md](test-execution-environment.md).

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

## Lesson: Isolated fixtures must create every dependency they assert

**Status:** active | **Created:** 2026-04-27
**Decision changed:** Before a focused run, enumerate and create every fixture-owned file, browser global, and source input the assertion reaches.
**Trigger phase:** VERIFY
**Incident count:** 10 | **Latest occurrence:** 2026-08-10

**What happened:** While adding ADR-024 enforcement to `stats --check`, the first integration test fixture used `package.json` with a line suffix to trigger an `invalid-line-ref` finding. The temp fixture repo did not contain `package.json`, so the checker correctly reported a stale ref instead and the test failed with "expected an invalid-line-ref finding."

**Root cause:** I reused a familiar root file path without checking the isolated fixture filesystem. The stats extractor validates refs against the temp repo, not the real goat-flow checkout.

**Recurrence 2026-08-01:** The first PR #57 terminal/dashboard batch failed three fixtures before exercising the product assertions: the ignored-root temp repo asserted `.goat-flow/plans/README.md` without creating it, the launch VM reached `window.__GOAT_FLOW_DEFAULT_PATH__` without injecting `window`, and a source-shape test searched `readDashboardAppSource()` even though that helper intentionally excludes `views/home.html`. The fixes created the asserted plan file, supplied the browser global, and read the owning HTML file directly. Evidence anchors: `test/unit/terminal-spawn.test.ts` (search: `grants build-directory writes only when Git proves they are ignored`), `test/unit/dashboard-terminal-launch/launch-flow-01.test.ts` (search: `__GOAT_FLOW_DEFAULT_PATH__`), and `test/unit/dashboard-terminal-launch/launch-flow-06.test.ts` (search: `launches Home setup and harness repair with workspace access`).

**Recurrence 2026-08-01 (full suite):** The focused launch suite was green, but `dashboard-home.test.ts` separately deep-compared the complete setup launch-options object and retained its old two-field fixture. The full suite correctly failed until that consumer required `accessMode: "workspace"`. Evidence anchor: `test/unit/dashboard-home.test.ts` (search: `Setup Claude Code via Claude Code`).

**Recurrence 2026-08-02:** M02 added an exact Git-ignore precondition to quality persistence. The real-path/symlink-alias fixture initialized Git only in its parent, so the nested project correctly failed the new precondition; giving the nested project its own repository and ignore rule restored the intended alias proof. The redirected-directory fixture then showed that checking ignore before inspecting existing path components masked the more specific symlink-containment decision, so both persistence helpers now complete their read-only component inspection before the ignore gate and create nothing until both pass. The first D4 report counter also over-escaped its digit regex and printed a false zero; inspecting the produced filename plus success receipt corrected the probe instead of reopening a working fix. Evidence anchors: `test/unit/quality-draft-capture.test.ts` (search: `shares one capture across real-path and symlink aliases`; search: `preserves a paused open writer until its completed report persists`), `test/unit/quality-subcommands.test.ts` (search: `refuses a redirected quality-report directory`), and `src/cli/quality/quality-command.ts` (search: `inspectedComponents`).

**Recurrence 2026-08-02 (plans time):** The first end-to-end timing fixture declared one minute of other work in its headline while its counted task, proof, and plan/admin entries contained zero other minutes. Timing finalization succeeded, but the live strict check correctly failed on the unrelated accounting mismatch before the event-deletion assertion could prove receipt authority. Aligning the fixture headline with its counted `1 product / 1 proof / 0 other` baseline restored the intended proof. Evidence anchor: `test/unit/plans-time.test.ts` (search: `function writeTimingFixture`).

**Recurrence 2026-08-07:** A dashboard-reader regression added a Codex session to prove report ownership without Claude draft capture, but the VM fixture registered only Claude. `readServerSessionInfo` correctly rejected the unknown runner before reading the owner, and optional chaining made the assertion resemble a missing-field bug. Registering Codex in both injected runner collections let the test reach the intended contract. Evidence anchor: `test/unit/dashboard-readers.test.ts` (search: `preserves report ownership with and without Claude draft capture`).

**Recurrence 2026-08-07 (plans time):** Replacing the timing test's inline milestone body with the shared canonical builder invalidated the editor-save substitution. The no-op replacement made the expected concurrent-edit error disappear. Anchoring the edit to text the shared builder emits and asserting that the replacement changed the fixture restored the intended proof. Evidence anchor: `test/unit/plans-time.test.ts` (search: `preserves an in-place user edit detected before atomic replacement`).

**Recurrence 2026-08-07 (quality history):** The first impossible-date streak fixture placed `2026-02-30` beside a June report. The existing 30-day cutoff already broke continuity, so the test passed without proving that an impossible date cannot bridge a streak. Moving the surrounding dates within 30 days made the pre-fix test fail on JavaScript's calendar normalization and isolated the new rule. Evidence anchor: `test/unit/quality-diff-delta-tag.test.ts` (search: `an invalid legacy date`).

**Recurrence 2026-08-09 (goat-plan contract):** The first RED asked the H2-only `readMarkdownSection` helper for an H3 artifact section, so it failed before reaching the write-target contradiction. Reading the complete installed skill produced the intended RED twice. Evidence: `test/contract/skill-hardening-plan-2.test.ts` (search: `writes the user-facing ISSUE artifact`).

**Recurrence 2026-08-10 (hook coverage):** A configured-hook drift fixture installed the optional Gruff script but omitted its registry-declared provider adapter, so the exact template check failed before reaching the intended config assertion. The same verification cycle found two direct audit-renderer fixtures without the required `hookCoverage` field; source typecheck did not inspect those test-only report objects, and the text renderers crashed. Adding the adapter to both fixture mirrors and completing both direct report shapes restored the intended proofs. Evidence anchors: `test/integration/audit-drift.helpers.ts` (search: `hook-provider-adapters.mjs`), `test/contract/command-phrases.test.ts` (search: `hookCoverage:`), `test/unit/audit-command/helpers.ts` (search: `This minimal fixture selects no agent surfaces`), and `src/cli/server/hooks-registry.ts` (search: `scriptFiles:`).

**Prevention:** Treat each fixture as an isolated runtime: list the files, globals, source graph, and baseline validator invariants the SUT or assertion will read, then create or satisfy them explicitly. Before asserting one strict-check behavior, run the fixture through the unchanged strict baseline and ensure unrelated errors are absent. Keep every non-target value inside its passing bounds. Assert that every text substitution changes its fixture before using the result as simulated user input. Never assume a real-checkout file exists in a temp repo, a browser global exists in a VM, or a helper's name implies it includes an adjacent template. When an exported report schema or a hook's `scriptFiles` contract grows, update direct report builders and both source/installed fixture mirrors before running consumer assertions. In temp-repo stats fixtures, cite a file the fixture creates; `.goat-flow/learning-loop/footguns/hooks.md` can carry both the bucket body and a self-reference. Evidence anchor: `test/integration/stats-command.test.ts` (search: `missing semantic anchor`).

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

## Lesson: Pressure scenarios must isolate the rule under test

**Status:** active | **Created:** 2026-07-12
**Decision changed:** Validate every pressure fact and evaluator restriction against the loaded contract before launch; non-target constraints must not decide the result.
**Trigger phase:** VERIFY
**Incident count:** 5 | **Latest occurrence:** 2026-08-10

**What happened:** The flagship skill-TDD scenario offered `Commit now` as the expected failing choice even though ADR-025 and every installed instruction file categorically forbid coding-agent commits. An agent could reject that option without following test-first discipline, so the scenario could overstate RED/GREEN evidence.

**Root cause:** The scenario varied both test ordering and repository-history authority. Its wrong answer was independently invalid under always-loaded policy.

**Fix:** The replacement uses an explicitly labelled illustrative security-depth scenario and holds file scope plus mirror duties constant; only test-first ordering differs. The shipped scenario defines input/output shape, never incident evidence; live runs must substitute current target-project facts. Evidence anchors: `workflow/skills/playbooks/skill-quality-testing/tdd-iteration.md` (search: `Illustrative four-pressure scenario`) and `test/contract/skill-hardening-shared-2.test.ts` (search: `isolated from repository-history policy`).

**Recurrence 2026-08-02:** The first goat-debug hardening wave used source-grounded lifecycle and probe decisions but added an unsupported “one-line patch” and transplanted “teammate is waiting” pressure from a different historical scenario. All three evaluators selected the safe option, and the host invalidated the entire wave rather than treating its rationales as RED evidence. The redacted receipt remains local current-run context, not durable evidence. Committed evidence anchor: `src/dashboard/preset-prompts.json` (search: `"id": "fix-bug"`) contains the real fix intent but no patch-size or waiting claim.

**Recurrence 2026-08-02 (same hardening run):** After correcting fact provenance, a hypothesis evaluator prompt explicitly requested “What would disconfirm each.” The evaluator returned good falsifiers, but the prompt had named the target field and therefore measured recitation rather than unaided technique use. The host excluded the run and rewound after the second scenario-method correction. This is the same isolation failure at a different layer: the fixture supplied the decision it claimed to test.

**Recurrence 2026-08-09:** A goat-debug GREEN evaluator chose the correct Investigate path, but the prompt's three-call cap and ban on other reads prevented the skill's mandatory learning-loop retrieval. The pass was discarded because that artificial conflict could decide the clarity result independently of the Diagnose-versus-Investigate rule. Evidence anchor: `workflow/skills/goat-debug/SKILL.md` (search: `Footgun check`).

**Recurrence 2026-08-10:** A live provider canary prohibited reads but named only the old and new values for four edits. The coding agent guessed four incompatible declarations, every patch failed, and the run exercised Stop without exercising PostToolUse. Supplying the exact editable declaration made the bounded canary valid. The durable consumer fixture now writes its complete registration and hook inputs explicitly. Evidence anchor: `test/integration/hook-consumer-canary.test.ts` (search: `writeObservedCodexFeedbackConfig`).

**Prevention:** Before using a pressure or application fixture, compare every option and prompt restriction with always-loaded instructions and accepted ADRs, attach a literal source anchor to every fact, and remove output fields that disclose the graded rule. Do not blend incidents, block mandatory reads, or ask the evaluator to recite the target technique. Keep non-target obligations equal so only the tested rule explains the result. When a canary prohibits reads, provide the exact editable source declaration or allow one bounded read; never require blind patch construction.

---

