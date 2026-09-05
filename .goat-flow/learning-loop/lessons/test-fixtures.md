---
category: test-fixtures
last_reviewed: 2026-09-05
---

**Scope:** Building and keeping fixtures true - collision branches, semantic operands, in-memory against disk-backed corpora, and fixtures that drift from the code they model. Runner behaviour is [test-execution-environment.md](test-execution-environment.md).

## Lesson: Metadata fixtures must use the intended header section

**Status:** active | **Created:** 2026-09-05
**Decision changed:** Insert added metadata beside an existing header and assert that unrelated parsed fields stay unchanged.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Locate the fixture's metadata section before adding a field. Insert beside an existing header, then compare the complete exported record and rendered output with the original fixture plus only the intended field; a parser may recognise a header anywhere while also retaining its text in the surrounding section. Evidence anchors: `test/unit/plans-export-writes.test.ts` (search: `adds only declared Lane metadata to previews`), `test/unit/plans-export.helpers.ts` (search: `completeMilestoneBody`).

**What happened:** Two Lane preview tests appended the header after the final Stop section; the parser preserved the lane but also included its text in `stopMarkdown`, so the complete-record comparison failed. Inserting beside `Depends on` restored the intended shape, and the focused run on 2026-09-05 went from 129 passes and two failures to 131 passes with runtime parsing unchanged.

**Root cause:** The fixture placed metadata where the parser would also read it as section body.

---

## Lesson: A preservation fixture's "user content" must not be a clone of the managed row

**Status:** active | **Created:** 2026-08-15
**Decision changed:** Preservation fixtures plant content beside the managed block and derive its position from the provider's own config shape rather than from the managed row's neighbours.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 1 | **Latest occurrence:** 2026-08-15

**Prevention:** Plant preservation content that names no framework path. Choose its container from the provider's shape: a sibling row when the config exposes a shared `hooks` container, a sibling top-level block when it keys blocks by hook id. Assert against whichever shape was planted so one fixture covers every agent. A cross-agent preservation test that passes for some agents and fails for one is evidence about the fixture until the planted content is proven unowned. Evidence anchors: `test/integration/setup-install-write-set.test.ts` (search: `Rewrite every runnable field inside one cloned structure`), `test/integration/setup-install-write-set.test.ts` (search: `planted beside goat-flow's own block, never inside it`).

**What happened:** The 1.16.0 M01 round-trip fixture planted an "unrelated user hook row" by cloning the installed deny row, swapping its script name, and pushing it into the array holding the managed row. Claude, Codex, and Copilot preserved it; Antigravity deleted it, and the fixture read that as a preservation defect. The clone still invoked goat-flow's own launcher, and Antigravity keys each hook block by hook id, so the row landed inside the `deny-dangerous` block of `.agents/hooks.json`, which the registrar rewrites wholesale.

**Root cause:** Ownership was inferred from adjacency; position in a shared provider event array means something different from the same position inside a per-hook managed block, and a command naming the managed launcher is owned content wherever it sits.

---

## Lesson: Command-wrapper fixtures must inspect semantic operands after safety flags

**Status:** active | **Created:** 2026-07-14
**Decision changed:** Failure-injection wrappers scan the complete argument vector for the semantic path instead of assuming a fixed position.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 1 | **Latest occurrence:** 2026-07-14

**Prevention:** Command-wrapper fixtures scan all arguments, or parse options when operand order matters, and match a unique semantic path. Keep the failure assertion beside source and destination byte assertions so a wrapper that never activates cannot pass silently. Evidence anchor: `test/integration/setup-install-atomic-staging.test.ts` (search: `Migration helpers add safety flags`).

**What happened:** M28's migration-failure fixture wrapped `mv` and matched the legacy source only at argument one. The hardened installer invoked `mv -n -- <source> <destination>`, so the wrapper delegated to the real command, installation exited 0, and the suite reported one failure although the migration helper was correct.

**Root cause:** The fixture encoded the old command shape instead of the behaviour under test; safety flags and the option terminator shifted the operand without changing its meaning.

---

## Lesson: Migration-output fixtures must match the collision branch

**Status:** active | **Created:** 2026-06-07

**Prevention:** Align migration assertions with the branch under test: clean-destination fixtures assert whole-directory moves; collision fixtures assert per-entry moves and `target exists, left old entry in place`. Evidence anchor: `test/integration/setup-install-migrations.test.ts` (search: `migrates legacy skill docs without overwriting target collisions`).

**What happened:** The M04 legacy skill-doc test expected a whole-directory move message, but the fixture deliberately pre-created `.goat-flow/skill-docs/playbooks/`, so the installer correctly used its per-entry no-overwrite branch and printed file-level moves, failing the first `test/integration/setup-install.test.ts` run.

**Root cause:** The clean-destination output shape was asserted while the fixture exercised the destination-exists branch.

---

## Lesson: Workflow parser refactors need both fixture coverage and typecheck

**Status:** active | **Created:** 2026-04-03
**Decision changed:** Before a prose parser, enumerate every shipped producer shape, validate the nominally valid fixture's relationships, and lock one grammar with focused fixtures; negative mutations target a unique semantic substring; shipped path examples label placeholders explicitly and verifiers recognise the placeholder grammar rather than one literal token; at first behavioural GREEN, check whole-file complexity and headroom before adding branches.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 11 | **Latest occurrence:** 2026-08-23

**Prevention:** For parser refactors, verify in this order: (1) print or exercise extracted intermediate values and fixture relationships, (2) run the focused regression suite, (3) run `npx tsc --noEmit`, (4) run whole-file ESLint and complexity or size analysis, then (5) freeze writes and run the full suite; any later write invalidates that result. Match heuristics to behaviour patterns such as `grep ... | while read ... [ ! -e ]`, not keywords in step names. Grep the old diagnostic across tests and include the producer's own unit file in RED and GREEN proof whenever a parser message changes.

**What happened:** The first pass on the workflow `run:` parser read the wrong regex capture group and used a router heuristic that matched only commands containing the word `router`; the focused regression suite and `tsc` both failed before the broader run finished.

**Root cause:** Parsing and heuristics changed together without first validating the extracted command shape; the regression covered the shell pattern while the implementation kept the old capture layout and overfit existing workflow wording.

**Recurrence 2026-08-01:** The goat-review producer survey found the systemic template and shipped examples disagreeing on R-IDs, `Harm:`, Evidence/Proof, and the retired overlap tag; the nominally valid fixture contradicted its Top 5 threshold, provenance totals, refuter state, and Spec Drift status, and whole-file ESLint and Gruff caught shared-parser complexity after behaviour and typecheck were green. `test/contract/skill-hardening-review-2.test.ts` (search: `keeps goat-review finding examples on the validator-ready grammar`), `test/unit/review-validate.test.ts` (search: `Verdicts: 4/0/0/0`), `src/cli/review-command-parser.ts` (search: `buildReviewCLIFields`).
**Recurrence 2026-08-01 (state-authority M04):** A broad first-occurrence replacement for `R-001` changed the earlier integrity prose instead of the finding definition; the first combined lint measured `validateConditionalSections` at complexity 12; and the anchor sweep treated an unlabeled `path`/`literal` placeholder as a live citation until it became `<target-project>/path`, producing `live misses=0`. `test/unit/review-validate-verdict.test.ts` (search: `structuralValidationCases`), `src/cli/review-validate-sections.ts` (search: `warnTopFiveShape`), `test/contract/skill-hardening-review-2.test.ts` (search: `placeholder anchors exempted`).
**Recurrence 2026-08-01 (PR #57 hardening):** A compiler correction used an under-specified patch context shared by adjacent estimate and Actual parsers, so `!match` landed where only `estimateMatch` exists; re-reading both complete functions fixed it. `src/cli/plans-effort.ts` (search: `estimateText.match(EFFORT_ESTIMATE_PATTERN)`).
**Recurrence 2026-08-01 (PR #57 preflight):** Focused tests, typecheck, and the package suite were green before preflight reported seven complexity failures in the hardened plan and review parsers; splitting lifecycle, numeric-field, fence-state, and ledger checks into named helpers preserved the contract, and `stats --check` caught the anchor that refactor removed from this entry. `src/cli/plans-check.ts` (search: `collectNotStartedSnapshotErrors`), `src/cli/plans-effort.ts` (search: `readEffortNumbers`), `src/cli/rendered-markdown.ts` (search: `isFencedLine`), `src/cli/review-validate-ledger.ts` (search: `readDeclaredLedgerLines`).
**Recurrence 2026-08-02:** Removing unconsumed M01 exports made Knip green but left the now-internal Actual-state alias unreferenced; typecheck and ESLint failed until the dead alias was deleted. `src/cli/plans-effort.ts` (search: `export interface PlanEffortNumericActual`).
**Recurrence 2026-08-03 (heading aliases):** Refactoring the Top-5 validator to receive one resolved alias section left its missing-section warning reading the removed `lines` parameter, failing 39/40; passing the Findings heading location restored 40/40, and whole-file ESLint then measured two readers at complexity 11. `src/cli/review-validate-sections.ts` (search: `function warnTopFiveShape`), `src/cli/review-validate-verdict.ts` (search: `function readFullShipVerdictClaim`).
**Recurrence 2026-08-03 (indented masking):** The focused validator suite proved four-space examples stayed hidden, but the full package run failed `plans export` because the shared masker also hid an indented `(est: ...)` continuation inside a visible checklist item; carrying whether the prior rendered line was blank fixed it. `src/cli/rendered-markdown.ts` (search: `previousRenderedLineWasBlank`), `test/unit/plans-export-parsing.test.ts` (search: `parses est entries at the end of wrapped multi-line tasks`).
**Recurrence 2026-08-16 (review anchors):** Replacing `<target-project>/path` with a literal sample path made the anchor sweep treat it as live evidence; `<repo-relative-path>` still failed because the verifier exempted one historical token rather than the placeholder grammar. `test/contract/skill-hardening.helpers.ts` (search: `angle-bracket token`), `test/contract/skill-hardening-review-2.test.ts` (search: `documents validator-ready anchors`).
**Recurrence 2026-08-16 (verification authority):** A full fast-suite run was still active when the changed-file formatting gate found two fixtures; formatting them mid-run changed the suite's authority, so its result was discarded. `package.json` (search: `prettier --write`), `test/integration/gruff-code-quality-contract.test.ts` (search: `surfaces a symbol finding when its span overlaps`), `test/unit/review-validate-verdict.test.ts` (search: `accepts eight REFUTED ledger records`).
**Recurrence 2026-08-23 (plan warning contract):** M18's focused checker and export command passed 95 tests after parse warnings gained expected grammar and received values, but the fast suite failed four exact assertions in the shared effort parser's own unit suite. `src/cli/plans-effort.ts` (search: `formatActionableParseWarning`), `test/unit/plans-effort.test.ts` (search: `warns when a supplied forecast basis cannot be counted`).

---

## Lesson: Nested tests should import production helpers through the test facade

**Status:** active | **Created:** 2026-08-23
**Decision changed:** Deeply nested tests extend `test/src.ts` and use its shallow import instead of hand-counting parent traversals into `src/`.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 1 | **Latest occurrence:** 2026-08-23

**Prevention:** Before adding a production import to a nested test, inspect `test/src.ts`; extend that facade when the helper is intentionally test-visible and import through the existing `../../src.js` path. Validate that RED fails on the intended missing symbol or assertion, not module resolution. Evidence anchors: `test/src.ts` (search: `findSkillInventoryDrift`), `test/unit/audit-command/main.test.ts` (search: `warns only for stale explicit skill inventories`).

**What happened:** M21's first semantic-inventory RED imported two production modules with `../../src/...` from `test/unit/audit-command/`; Node resolved that under `test/src/` and failed with `ERR_MODULE_NOT_FOUND` before reaching the missing export. `../../../src/...` reached production code but Gruff flagged both deep relative imports; re-exporting through the facade produced the intended RED.

**Root cause:** The test bypassed the repository's facade and treated directory depth as part of the fixture contract, so the first failure measured path arithmetic rather than the missing behaviour.

---

## Lesson: Builder defaults do not protect direct verifier callers

**Status:** active | **Created:** 2026-07-13
**Decision changed:** Default migration-light fields at every exported consumer boundary, then run the full package suite to find callers outside focused fixtures.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 1 | **Latest occurrence:** 2026-07-13

**Prevention:** When adding migration-light report fields, search for every exported consumer and default absent collections at those boundaries; run focused tests plus the package suite. Evidence anchors: `src/cli/stats/stats.ts` (search: `Older direct callers may omit entry facts`), `test/unit/index-fresh.test.ts` (search: `reportWith(indexes)`).

**What happened:** M13 defaulted missing learning-loop entries in `buildStatsReport` and focused stats tests passed; the full `npm test` found three `TypeError: learningLoopEntries is not iterable` failures because `test/unit/index-fresh.test.ts` calls exported `checkStats` with a legacy report object that bypasses the builder.

**Root cause:** The compatibility fallback lived only in the preferred construction path, not in the exported verifier that also consumes report-shaped objects; source typecheck does not inspect the TypeScript test caller.

---

## Lesson: Rubric honesty changes need both in-memory and disk-backed fixture sync

**Status:** historical | **Created:** 2026-04-03 | **Reason:** Rubric/scanner system removed per ADR-013; specific check IDs no longer exist

**Prevention:** Whenever a check changes semantics, verify in this order: focused in-memory regression, disk-backed fixture corpus, full suite. Search the fixture tree for the check ID before treating the change as complete.

**What happened:** Tightening `2.2.2` so a registered stop hook passed only when it also ran real validation commands passed the new focused regression, but the disk-backed failing-known fixture still expected the old failure set and broke the next verification step.

**Root cause:** The rubric logic and in-memory corpus were updated first, while the disk-backed fixture JSON and its project-fixtures test (both since removed with the scanner) also encoded expected failing check IDs.

---

## Lesson: Isolated fixtures must create every dependency they assert

**Status:** active | **Created:** 2026-04-27
**Decision changed:** Before a focused run, enumerate and create every fixture-owned file, browser global, and source input the assertion reaches.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 17 | **Latest occurrence:** 2026-09-03

**Prevention:** Treat each fixture as an isolated runtime: list the files, globals, source graph, and baseline validator invariants the system under test or the assertion will read, then create or satisfy them explicitly. Before asserting one strict-check behaviour, run the fixture through the unchanged strict baseline so unrelated errors are absent, and keep every non-target value inside its passing bounds. Assert that every text substitution changed its fixture before using the result as simulated input. Never assume a real-checkout file exists in a temp repo, a browser global exists in a VM, or a helper's name implies it includes an adjacent template. For an invalid-state case, name and trigger the exact production predicate; arbitrary content is not invalid when the implementation treats its bytes as opaque. In temp-repo stats fixtures, cite a file the fixture creates; `.goat-flow/learning-loop/footguns/hooks.md` can carry both the bucket body and a self-reference. Evidence anchor: `test/integration/stats-command.test.ts` (search: `missing semantic anchor`).

**What happened:** The first ADR-024 enforcement test for `stats --check` used `package.json` with a line suffix to trigger an `invalid-line-ref` finding, but the temp fixture repo had no `package.json`, so the checker correctly reported a stale ref and the test failed with "expected an invalid-line-ref finding".

**Root cause:** A familiar root file path was reused without checking the isolated fixture filesystem; the stats extractor validates refs against the temp repo, not the real checkout.

**Recurrence 2026-08-01:** Three PR #57 fixtures failed before the product assertions: an ignored-root temp repo asserted `.goat-flow/plans/README.md` without creating it, the launch VM reached `window.__GOAT_FLOW_DEFAULT_PATH__` without injecting `window`, and a source-shape test searched `readDashboardAppSource()` although that helper excludes `views/home.html`. `test/unit/terminal-spawn.test.ts` (search: `grants build-directory writes only when Git proves they are ignored`), `test/unit/dashboard-terminal-launch/launch-flow-01.test.ts` (search: `__GOAT_FLOW_DEFAULT_PATH__`), `test/unit/dashboard-terminal-launch/launch-flow-06.test.ts` (search: `launches Home setup and harness repair with workspace access`).
**Recurrence 2026-08-01 (full suite):** `test/unit/dashboard-home.test.ts` (search: `Setup Claude Code via Claude Code`) deep-compared the complete setup launch-options object with its old two-field fixture and failed until it required `accessMode: "workspace"`.
**Recurrence 2026-08-02:** M02's exact Git-ignore precondition failed the real-path/symlink-alias fixture, which initialized Git only in the parent; the nested project needed its own repository and ignore rule, both persistence helpers now finish read-only component inspection before the ignore gate, and an over-escaped digit regex in the D4 counter printed a false zero. `test/unit/quality-draft-capture.test.ts` (search: `shares one capture across real-path and symlink aliases`), `test/unit/quality-draft-capture.test.ts` (search: `preserves a draft while its open writer is still changing it`), `test/unit/quality-subcommands.test.ts` (search: `refuses a redirected quality-report directory`), `src/cli/quality/quality-command.ts` (search: `inspectedComponents`).
**Recurrence 2026-08-02 (plans time):** The first timing fixture declared one minute of other work in its headline while its counted entries held zero, so the strict check failed on the accounting mismatch before the event-deletion assertion could run. `test/unit/plans-time.test.ts` (search: `function writeTimingFixture`).
**Recurrence 2026-08-07:** A dashboard-reader regression added a Codex session while the VM fixture registered only Claude; `readServerSessionInfo` rejected the unknown runner and optional chaining made it look like a missing-field bug. `test/unit/dashboard-readers.test.ts` (search: `preserves report ownership with and without Claude draft capture`).
**Recurrence 2026-08-07 (plans time):** Replacing the inline milestone body with the shared builder made the editor-save substitution a no-op, so the expected concurrent-edit error disappeared until the edit anchored to text the builder emits and the test asserted the replacement changed the fixture. `test/unit/plans-time.test.ts` (search: `preserves an in-place user edit detected before atomic replacement`).
**Recurrence 2026-08-07 (quality history):** An impossible-date streak fixture placed `2026-02-30` beside a June report, so the existing 30-day cutoff already broke continuity and the test passed without proving the rule; moving the dates within 30 days isolated it. `test/unit/quality-diff-delta-tag.test.ts` (search: `an invalid legacy date`).
**Recurrence 2026-08-09:** The first goat-plan RED asked the H2-only `readMarkdownSection` helper for an H3 section and failed before reaching the write-target contradiction. `test/contract/skill-hardening-plan-2.test.ts` (search: `writes the user-facing ISSUE artifact`).
**Recurrence 2026-08-10:** A configured-hook drift fixture installed the optional Gruff script without its registry-declared provider adapter, and two direct audit-renderer fixtures lacked the required `hookCoverage` field that source typecheck never sees. `test/integration/audit-drift.helpers.ts` (search: `hook-provider-adapters.mjs`), `test/contract/command-phrases.test.ts` (search: `hookCoverage:`), `test/unit/audit-command/helpers.ts` (search: `This minimal fixture selects no agent surfaces`), `src/cli/server/hooks-registry.ts` (search: `scriptFiles:`).
**Recurrence 2026-08-28 (managed-state helper):** PR #61's Linux slow shard failed nine force-authority cases because `recordStaleBaselineHashes` cast an agent's v1-cutover marker as legacy state with a `files` array; the helper now follows the marker to canonical `managed.json` and rebuilds rows through the production generation function. `test/integration/setup-install-force-authority.test.ts` (search: `describe("install force authority"`), `test/integration/setup-install.helpers.ts` (search: `recordStaleBaselineHashes`), `src/cli/managed-setup-state.ts` (search: `createManagedInstallStateRow`).
**Recurrence 2026-08-28 (configured hook timeout):** The Windows contract job timed out four exact Codex deny replays near the five-second direct-probe cap although the registered deny hook owns a longer deadline; configured replay now derives its timeout from the registry. `test/integration/hook-effective-state.test.ts` (search: `replays Codex deny scenarios through the Windows override`), `src/cli/hooks-runtime-evidence.ts` (search: `MANAGED_CONFIGURED_PROBE_TIMEOUT_MS`), `src/cli/server/hooks-registry.ts` (search: `id: "deny-dangerous"`).
**Recurrence 2026-08-28 (Markdown escaping):** A generated-index assertion counted source-literal backslashes instead of checking the rendered row; comparing the runtime title with the generated Markdown separated literal syntax from the escaping contract. `test/unit/learning-loop-index.test.ts` (search: `escapes Markdown delimiters in link labels without changing anchors`).
**Recurrence 2026-08-28 (one-shot failure injection):** A path-claim regression re-armed its readback failure after every `fsyncSync`, so the retry failed after the marker was removed; a one-shot flag limits the injected `EIO` to the initialization attempt. `test/unit/path-write-claim.test.ts` (search: `removes an unchanged marker after transient ownership readback failure`).
**Recurrence 2026-08-30:** A recall sanitization check rejected every C0 character in the rendered output, so the renderer's own newlines failed; restricting the assertion to controls forbidden inside dynamic fields proved the terminal boundary. `test/unit/learning-loop-recall.test.ts` (search: `escapes repository-controlled terminal sequences in text output`).
**Recurrence 2026-08-31:** The pre-release full suite found the lifecycle fixture still creating a non-Git consumer without the current Commit Messages section; audit rejected the missing post-turn scan root first, then the incomplete instruction contract. `test/integration/setup-quality-lifecycle.test.ts` (search: `The passing lifecycle needs Git's implicit post-turn scan root`), `test/integration/setup-quality-lifecycle.test.ts` (search: `## Commit Messages`), `test/integration/setup-install-nongit-hooks.test.ts` (search: `names the blocked post-turn registration and its fix`).
**Recurrence 2026-09-03:** A recovery test wrote arbitrary non-JSON bytes expecting rejection, but the helper treats any bounded regular-file bytes as opaque identity; writing 4,097 bytes crossed the 4,096-byte bound and exercised the structural-unsafe branch. `src/cli/path-write-claim.ts` (search: `const MAX_CLAIM_BYTES = 4096`), `test/integration/path-write-claim-recovery.test.ts` (search: `Oversized marker bytes violate`).

---

## Lesson: Current-version fixtures must derive from package metadata

**Status:** active | **Created:** 2026-07-16
**Decision changed:** Healthy current-version fixtures interpolate the package-derived audit version instead of pinning a release literal.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 1 | **Latest occurrence:** 2026-07-16

**Prevention:** Fixtures that mean "current" import package-derived version metadata; literals are reserved for tests that model old or mismatched installs. After a release bump, search the test tree for the prior version before running the full suite. Evidence anchors: `test/unit/skill-doctor.test.ts` (search: `skillMarkdown`), `src/cli/constants.ts` (search: `export const AUDIT_VERSION`).

**What happened:** After the bump from 1.13.1 to 1.14.0 the full suite failed two skill-doctor cases whose shared healthy fixture still emitted `goat-flow-skill-version 1.13.1`, so the runtime correctly classified it as warn rather than pass.

**Root cause:** The fixture represented the current installed version but hard-coded the previous release, and the version sweep covered runtime and release surfaces without this semantic fixture.

---

## Lesson: Pressure scenarios must isolate the rule under test

**Status:** active | **Created:** 2026-07-12
**Decision changed:** Validate every pressure fact and evaluator restriction against the loaded contract before launch; non-target constraints must not decide the result.
**Trigger phase:** SCOPE
**Caught at:** VERIFY
**Incident count:** 6 | **Latest occurrence:** 2026-08-16

**Prevention:** Before using a pressure or application fixture, compare every option and prompt restriction with always-loaded instructions and accepted ADRs, attach a literal source anchor to every fact, and remove output fields that disclose the graded rule. Do not blend incidents, block mandatory reads, or ask the evaluator to recite the target technique; keep non-target obligations equal so only the tested rule explains the result. Dry-run command guards with the producer's real global flags and working-directory form. When a canary prohibits reads, provide the exact editable source declaration or allow one bounded read. Evidence anchors: `workflow/skills/playbooks/skill-quality-testing/tdd-iteration.md` (search: `Illustrative four-pressure scenario`), `test/contract/skill-hardening-shared-2.test.ts` (search: `isolated from repository-history policy`).

**What happened:** The flagship skill-TDD scenario offered `Commit now` as the expected failing choice although ADR-025 and every installed instruction file forbid coding-agent commits, so an agent could reject that option without following test-first discipline. The replacement is an explicitly illustrative security-depth scenario that holds file scope and mirror duties constant; it defines input and output shape, never incident evidence.

**Root cause:** The scenario varied both test ordering and repository-history authority, so its wrong answer was independently invalid under always-loaded policy.

**Recurrence 2026-08-02:** The first goat-debug hardening wave added an unsupported "one-line patch" and a transplanted "teammate is waiting" pressure; all three evaluators chose the safe option and the host invalidated the wave. `src/dashboard/preset-prompts.json` (search: `"id": "fix-bug"`) holds the real fix intent with no patch-size or waiting claim.
**Recurrence 2026-08-02 (recitation):** A hypothesis evaluator prompt explicitly asked "What would disconfirm each", naming the target field and measuring recitation rather than unaided technique; the host excluded the run and rewound.
**Recurrence 2026-08-09:** A goat-debug GREEN evaluator chose the correct Investigate path, but the prompt's three-call cap and read ban prevented the skill's mandatory learning-loop retrieval, so the pass was discarded. `workflow/skills/goat-debug/SKILL.md` (search: `Footgun check`).
**Recurrence 2026-08-10:** A live provider canary prohibited reads but named only old and new values for four edits; the agent guessed four incompatible declarations and every patch failed, exercising Stop without PostToolUse. `test/integration/hook-consumer-canary.test.ts` (search: `writeObservedCodexFeedbackConfig`).
**Recurrence 2026-08-16:** A goat-clarity Copilot evaluator guard recognised read-only Git only when the subcommand came first; Copilot prefixed `--no-optional-locks` and `-C <worktree>`, so the guard misclassified the disposable clone as non-Git and the run was discarded. `workflow/skills/goat-clarity/SKILL.md` (search: `repository root resolved from the invocation working directory`).
