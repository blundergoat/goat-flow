---
category: verification-gruff
last_reviewed: 2026-08-29
---

**Scope:** The Gruff analyzer specifically - comment rules, doc-comment complexity, binary discovery, and baseline handling. Other repo-wide gates live in [verification-preflight.md](verification-preflight.md).

## Lesson: Gruff comment fixes must satisfy both humans and the analyzer

**Status:** active | **Created:** 2026-05-25
**Incident count:** 13 | **Latest occurrence:** 2026-08-28
**Decision changed:** Treat a human-readable comment, boolean, compact test, or typed contract as unfinished until targeted and repository-wide analyzers accept the exact source shape.
**Trigger phase:** ACT
**Caught at:** VERIFY

**What happened:** During gruff docs cleanup, comments in `src/cli/server/decoders.ts` made sense to a maintainer but still failed `docs.magic-threshold-without-rationale`, `docs.missing-error-behavior-doc`, and `docs.missing-why-for-complex-code`. In the same cleanup, renaming dashboard terminal paste metadata passed focused tests but left stale ambient and VM-test helper shapes caught by `npm run typecheck`.

**Recurrence (2026-08-09):** A hook-result cap had a plain-English rationale directly above it, but gruff-ts 0.4.0 still reported `docs.magic-threshold-without-rationale`. The same scan found eight boolean state fields without intent prefixes and one assertion loop. Using the rule's recognized same-line `Cap:` form, renaming the facts to `is...` and `has...`, and replacing the loop with explicit outcome assertions reduced the targeted result from 10 advisories to zero. Evidence anchors: `src/cli/hook-contracts.ts` (search: `Cap: matches both shipped hook limits`) and `test/unit/hook-result-contract.test.ts` (search: `assertHookOutcomeRemainsValid`).

**Second recurrence (2026-08-09):** Focused tests, TypeScript, and gruff-ts passed, but full preflight still rejected two contract functions above ESLint's complexity limit and eight exported component types without external fixture use. Splitting the user-facing support chain into named provider, install, and observed-state checks, then typing the fixtures with each public component contract, cleared both repository gates. Evidence anchors: `src/cli/hook-contracts.ts` (search: `classifyProviderEvidenceState`) and `test/integration/hook-provider-contracts.test.ts` (search: `DELIVERED_RESPONSE_CHANNELS`).

**Third recurrence (2026-08-09):** The first runtime-adapter scan found eight documentation-shape advisories after all 16 focused contract tests passed: two threshold comments were not in the analyzer's recognized same-line form, two functions omitted explicit error or invariant wording, and three large provider fixture clusters lacked nearby purpose comments. Adding concise contract wording at each exact source shape cleared the findings without changing behavior. Evidence anchors: `workflow/hooks/hook-provider-adapters.mjs` (search: `Error behavior: returns one bounded invalid reason`) and `test/unit/hook-provider-adapters.test.ts` (search: `Fixture covers feedback-bearing host shapes`).

**Fourth recurrence (2026-08-09):** The broader launcher and registry scan found fourteen issues after focused behavior passed: two files crossed the length threshold, public contracts lacked invariant wording, and fixture comments could not express purpose and side effects as separate adjacent comments. Moving launch decoding and result preparation into the provider adapter kept the runtime files below 750 lines, splitting the registry assertions reduced fixture complexity, and one concise fixture comment now carries both required meanings. The remaining three launcher process-execution findings matched the then-current Gruff 0.4 warning baseline; Gruff 0.5 later reclassified that argv-only shape as advisory. Evidence anchors: `workflow/hooks/hook-provider-adapters.mjs` (search: `prepareProviderHookResultDelivery`), `workflow/hooks/run-with-bash.mjs` (search: `function runHookProcessUntilDeadline`), `test/unit/hook-launcher.test.ts` (search: `Fixture purpose: prove direct output parity`), and `.gruff-ts.yaml` (search: `security.process-exec:`).

**Fifth recurrence (2026-08-09):** A follow-up launcher refactor stopped at exactly 750 lines according to `wc`, but gruff-ts counted 751 and still emitted `size.file-length`. Removing one non-semantic blank line created a one-line buffer and returned the scan to only the three tracked process-execution warnings. Evidence anchor: `workflow/hooks/hook-launch-runtime.mjs` (search: `hookProcess.once("error"`).

**Sixth recurrence (2026-08-09):** Typed delivery assertions grew a registrar fixture to 752 lines, and only full preflight caught the new file-length warning. Remove optional separators in touched long files, then run targeted Gruff before preflight. Evidence: `test/integration/hook-effective-state.test.ts` (search: `keeps deterministic delivery evidence below live support`).

**Seventh recurrence (2026-08-10):** Formatting a Gruff contract test exposed five fixture-purpose and test-loop advisories. Moving looped assertions into named cases cleared that cluster, but separate adjacent purpose and side-effect or invariant comments produced six follow-up advisories because only the nearest source shape carried each contract. Combining both meanings in one concise comment reduced the working-tree scan to zero findings. Evidence anchors: `test/integration/hook-provider-contracts.test.ts` (search: `Fixture purpose: creates an edit and runs Gruff`) and `test/integration/gruff-code-quality-contract.test.ts` (search: `Fixture purpose: proves helper bypass`).

**Eighth recurrence (2026-08-16):** Upgrading Gruff from 0.4.0 to 0.5.0 changed the warning rule set while one error-severity file-length finding caused the ratchet to stop before comparing warning debt. Removing that error exposed 120 unmatched warnings and 27 stale accepted identities. After clearing the three warnings in the active M03 launcher, the first approved 117-entry manifest was pretty-printed past the same 1,000-line error threshold and blocked itself. Recording one reviewed entry per JSON line preserved every identity, occurrence, and rationale in 125 lines. Run the ratchet immediately after an analyzer/config upgrade, even while errors exist, and measure the reviewed manifest as part of its own scan. That reviewed manifest was later removed in favour of clearing the warnings outright, so the accepted-debt contract now lives only in code. Evidence anchors: `package.json` (search: `@blundergoat/gruff-ts`), `scripts/check-gruff-warning-ratchet.mjs` (search: `splitFindingsBySeverity`), and `scripts/gruff-warning-ratchet-checks.mjs` (search: `collectAcceptedEntriesByIdentity`).

**Ninth recurrence (2026-08-17):** A new `renderPriorReportContext` docblock described the function's stable behaviour twice, but `docs.missing-invariant-doc` remained because neither version used a marker the installed rule recognizes. Reading `context-doc-rules.ts` after the second failed rewrite showed the accepted whole-word vocabulary; naming the behavior a `contract` cleared the advisory without changing meaning. Evidence anchors: `src/cli/prompt/compose-quality-common.ts` (search: `continuity contract`) and `node_modules/@blundergoat/gruff-ts/src/context-doc-rules.ts` (search: `hasInvariantMarker`).

**Tenth recurrence (2026-08-18):** The Gruff ratchet repair explained the numeric coverage policy as a "floor", but the live hook still reported `docs.magic-threshold-without-rationale` because that clear synonym was outside the installed rule's marker vocabulary. Reading the rule before a second rewrite showed that "threshold" was accepted; changing that one noun cleared the targeted scan without weakening the rationale. Evidence anchors: `scripts/gruff-warning-ratchet-checks.mjs` (search: `Coverage threshold retained`) and `package.json` (search: `@blundergoat/gruff-ts`).

**Eleventh recurrence (2026-08-18):** Resolving a committed `git stash pop` conflict left `npm run build` and `npm run typecheck` green while `node scripts/check-gruff-warning-ratchet.mjs` failed. Merging the feature's migration and archive branches into `dashboardLoadSavedDashboardState` put it at cyclomatic 21 and cognitive 23 against the configured threshold of 15, and the repo keeps no accepted-debt manifest, so any warning counts as a regression. Neither side of the conflict would have passed alone: the feature branch's own if-chain scored higher than the merged form. Extracting the server read and the row assembly into two named helpers returned the scan to zero warnings without changing behaviour. Evidence anchors: `src/dashboard/dashboard-projects.ts` (search: `dashboardReadSavedServerState`), `src/dashboard/dashboard-projects.ts` (search: `dashboardBuildProjectRows`), and `.gruff-ts.yaml` (search: `complexity.cognitive:`).

**Twelfth recurrence (2026-08-28):** M41 Task 9's first cohesive status implementation ignored the already-read "Hold the file-length line continuously, not in a cleanup pass" pattern and expanded `src/cli/managed-setup-preview.ts` to 1,224 substantive lines, above Gruff's 1,000-line error threshold. The correction extracted the status collector to `src/cli/managed-install-evidence.ts` before CLI wiring or verification. Evidence anchors: `src/cli/managed-setup-preview.ts` (search: `selectedManagedReceiptProblems`) and `src/cli/managed-install-evidence.ts` (search: `buildManagedInstallEvidenceReport`).

**Root cause:** I treated human-readable comments, compact boolean names, a local rename, and focused contract checks as complete before checking analyzer vocabulary, branch budgets, public type use, test structure, and parallel type surfaces.

**Prevention:** For gruff-driven comment work, read `code-comments.md`, patch one file or cohesive cluster, then rerun `npx gruff-ts analyse <path>`. If a clear comment remains flagged, inspect the installed rule before changing its wording or placement again. Keep at least a one-line buffer below file-length limits instead of relying on a separate line counter at the exact boundary. Keep internal boolean state in `is...`/`has...` grammar and give each small outcome set direct assertions instead of a test-level loop. For a new typed contract, run focused tests, `npm run typecheck`, ESLint, and Knip before the full preflight; split long decision chains by the user-facing gates they explain, and consume public component types in contract fixtures. If a rename replaces a comment, grep the old identifier. After resolving a merge or stash conflict, run the ratchet even when build and typecheck pass: combining two branches can cross a complexity threshold that neither side crossed on its own. Evidence anchors: `src/cli/server/decoders.ts` (search: `Swallows parse errors into the shared decoder failure shape`), `src/cli/server/decoders.ts` (search: `This stays explicit because`), `src/dashboard/globals.d.ts` (search: `shouldDelaySubmit`), `.goat-flow/learning-loop/patterns/workflow.md` (search: `Gruff docs cleanup is a tight analyzer loop`).

## Lesson: Gruff hook compatibility probes need real configs and wrapper PATH

**Status:** active | **Created:** 2026-05-28

**What happened:** While verifying `workflow/hooks/gruff-code-quality.sh` against `/home/devgoat/projects/gruff-workspace/gruff-go`, `gruff-php`, `gruff-py`, and `gruff-rs`, the first hook-shaped probes failed or produced no output for reasons unrelated to JSON compatibility. Placeholder `.gruff-*.yaml` files such as `rules: {}` were invalid or too incomplete for several analyzers, and the Rust probe replaced `PATH` with only gruff binary directories plus `/usr/bin:/bin`, hiding `cargo` from `gruff-rs/bin/gruff-rs`.

**Root cause:** I treated sibling gruff CLIs as interchangeable binaries but skipped two runtime surfaces that are part of the hook contract: schema-bearing project config files and wrapper-script dependencies inherited from the caller's normal `PATH`.

**Prevention:** When testing `gruff-code-quality.sh` against sibling gruff implementations, copy or reference each project's real `.gruff-*.yaml`, preserve the normal `PATH` while prefixing local gruff binaries, and run both checks: direct `analyse --format json` schema probes and hook-shaped probes with changed ranges. Evidence anchors: `workflow/hooks/gruff-code-quality.sh` (search: `discover_binary`), `test/integration/gruff-code-quality-smoke.test.ts` (search: `changed line finding`).

## Lesson: Gruff doc comments can expose hidden complexity warnings

**Status:** active | **Created:** 2026-05-30
**Incident count:** 4 | **Latest occurrence:** 2026-08-28

**What happened:** Adding a maintainer comment to `src/dashboard/app.ts` `_uploadTerminalImages` cleared a docs finding but exposed new `complexity.npath` and `design.god-function` warnings. The helper extraction then passed TypeScript but failed preflight ESLint on an unnecessary assertion.

**Recurrence update (2026-08-17):** M47 added truthful exported-function documentation to the hook registrar, so Gruff correctly stopped reporting that accepted warning while the reviewed-warning manifest still claimed it existed. The same preflight run found an 11-branch audit helper after focused behavior and TypeScript checks had passed. Removing only the stale manifest row and moving agent-ID validation into the baseline helper cleared the two gates without weakening analyzer policy. Evidence anchors: `scripts/gruff-warning-ratchet-checks.mjs` (search: `stale accepted debt`), `src/cli/server/hook-registrar.ts` (search: `Apply one enabled choice after proving`), and `src/cli/audit/check-drift-hooks.ts` (search: `function managedBaselineRows`).

**Recurrence 2026-08-28:** M41 Task 7 retired that baseline helper after migrating the primary hook loop, but the optional registry comparison still called it. The first focused run threw `ReferenceError: managedBaselineHashes is not defined`; the later stats check also found this lesson's evidence anchor still named the removed helper. Before deleting a helper, search its exact symbol across the complete edited file and durable evidence, not only the primary caller. Evidence anchors: `src/cli/audit/check-drift-hooks.ts` (search: `function managedBaselineRows`) and `src/cli/audit/check-drift-hooks.ts` (search: `function compareRegistryHookScripts`).

**Root cause:** I checked only the targeted docs rule and assumed a comment-only patch could not change broader warning or lint counts.

**Prevention:** After a large gruff docs batch, run `npx gruff-ts analyse --format json --fail-on none` and compare warning count, then run the lint/preflight gate for any helper extraction. When a documented function clears reviewed warning debt, remove that exact identity from the accepted-warning manifest in the same change. Do not remove a useful comment just to hide a surfaced warning. Evidence anchors: `src/dashboard/app.ts` (search: `encodeTerminalUploadFiles`), `src/dashboard/app.ts` (search: `showTerminalUploadResult`).

## Lesson: docs.missing-internal-function-doc must not be silenced; baseline the residue

**Status:** active | **Created:** 2026-05-29

**What happened:** Gruff-ts reported 337 `docs.missing-internal-function-doc` findings across 73 files. Adding boilerplate JSDoc to every short helper would satisfy the rule but violate the repo's "rewrite/rename before comment" doctrine.

**Root cause:** Two correct rules collide: gruff rules must not be disabled, but comments must only explain non-obvious WHY. This rule had no tuning options, leaving only fix, rename, or baseline.

**Prevention:** Triage `docs.missing-internal-function-doc` with the gruff-code-quality playbook. Treat each missing-doc finding as a candidate: add a comment when project or language canon requires it, when the symbol is a public/exported API, or when a file/module/class boundary has a non-obvious contract. Otherwise classify the deliberate no-doc convention, rename when that removes ambiguity, or baseline the residue with rationale. Revisit when gruff-ts gains threshold/name-match tuning. Evidence anchors: `.goat-flow/skill-docs/playbooks/gruff-code-quality.md` (search: `when the symbol is a public/exported API`), `scripts/preflight-checks.sh` (search: `Gruff Policy`).

## Lesson: Keep the binary path returned by the gruff availability check

**Status:** active | **Created:** 2026-08-03 | **Incident count:** 2 | **Latest occurrence:** 2026-08-09

**Decision changed:** Run later gruff commands through the exact `$found` path instead of guessing a global install location.

**Trigger phase:** READ
**Caught at:** VERIFY

**What happened:** The required availability check found the repo-local `node_modules/.bin/gruff-ts`, but the first analysis command discarded that result and invoked `$HOME/.local/bin/gruff-ts`. Bash reported `No such file or directory`, while the following `jq` stage returned zero and made the failed probe easy to misread as analyzer output.

**Recurrence (2026-08-09):** The same path guess recurred after discovery had already found `node_modules/.bin/gruff-ts`. Reusing the discovered path ran gruff-ts 0.4.0 and preserved its three advisory findings.

**Root cause:** I verified that a gruff binary existed but treated discovery as a boolean instead of preserving the executable path for the verification command. I also omitted pipeline failure propagation on a command whose analyzer output was piped through `jq`.

**Prevention:** Keep and reuse `$found` for the complete gruff loop, and enable `pipefail` whenever analyzer output is filtered. Confirm the analyzer emitted a JSON object before interpreting counts. Evidence anchor: `.goat-flow/skill-docs/playbooks/gruff-code-quality.md` (search: `## Availability Check`).

## Lesson: Gruff-driven direct imports must preserve facade proof

**Status:** active | **Created:** 2026-05-31

**What happened:** During `test-quality` cleanup, gruff's nearby-test requirement pushed several tests from public facade imports to implementation-module imports. The first full `npm test` rerun then failed the installer round-trip preflight because Knip found `8 unused exports/types`, including facade re-exports such as `createAuditFactsView`, `scoreAllArtifacts`, and `normalizeAgentVersionOutput`. The same verification pass caught an order-sensitive dashboard tasks assertion: `/api/tasks` returned `Milestone-malformed.md` before `Milestone-side-menu-navigation.md`, so the test failed with `# fail 1` even though both milestone records were present.

**Root cause:** I treated "direct implementation import for gruff" and "facade import for Knip/API stability" as mutually exclusive, and one endpoint test asserted incidental filesystem ordering instead of selecting the record that carried the behavior under test.

**Recurrence 2026-05-31:** Deleting 25 low-quality tests produced the same shape from the other direction: `npx knip` flagged production exports that only deleted tests imported, `npm run typecheck` caught the route inventory left behind for the deleted route-classification test, and the installer round-trip preflight caught hidden `.goat-flow` anchors that still cited deleted test paths.

**Prevention:** When direct imports are needed to prove a nearby implementation module, keep stable facade exports exercised with explicit alignment assertions in existing nearby tests. For endpoint arrays that do not declare a sort contract, select records by semantic identifier before asserting fields. Evidence anchors: `src/cli/audit/audit.ts` (search: `createAuditFactsView`), `src/cli/quality/skill-quality.ts` (search: `scoreAllArtifacts`), `test/integration/dashboard-tasks-api.test.ts` (search: `milestoneByFilename`).

---

## Lesson: Gruff side-effect comments must name the side effect

**Status:** active | **Created:** 2026-05-30
**Incident count:** 4 | **Latest occurrence:** 2026-08-29

**What happened:** During the M00 gruff docs continuation, the first internal-helper comment batch cleared `docs.missing-internal-function-doc` but reduced the full snapshot by only 175 findings because gruff then reported `docs.missing-side-effect-doc` on helpers that write fixture files or spawn tools. Retuning those comments to explicitly say `Writes` or `Spawns` moved the full snapshot to `summary error=0 warning=121 advisory=598 total=719` and both doc clusters to zero.

**Recurrence update (2026-08-06):** The Windows discovery comment described its purpose and fallback but did not explicitly name the `where.exe` process side effect. Adding that concrete process action cleared the three targeted side-effect findings.

**Recurrence 2026-08-27:** A new audit helper said it “launches one bounded child process,” but Gruff still reported `docs.missing-side-effect-doc`. Naming the contract explicitly as `Side effect: spawns one bounded child process` cleared the finding without adding compensating prose. Evidence anchor: `src/cli/audit/check-agent-deny-runtime.ts` (search: `Side effect: spawns one bounded child process`).

**Recurrence 2026-08-29:** During M68's comment pass, changing a fixture helper's side-effect sentence from `writes` to `creates` introduced `docs.missing-side-effect-doc` even though the new sentence still described the file operation to a maintainer. Restoring the explicit filesystem verb returned the five-path before/after identity comparison to zero introduced findings. Evidence anchor: `test/integration/setup-install.test.ts` (search: `Side effect: writes and marks one analyzer fixture executable`).

**Root cause:** I wrote purpose comments for side-effecting helpers but did not include analyzer-recognised side-effect language. For gruff-ts docs rules, a human-useful purpose sentence is not enough when the helper mutates filesystem state or runs a subprocess.

**Prevention:** For helpers that write files, mutate fixtures, or run subprocesses, include the side effect in plain maintainer language (`Write`, `Run`, `Spawn`, `filesystem`) instead of a generic purpose sentence. After large docs batches, check the full rule delta, not only the original docs cluster. Evidence anchors: `test/integration/audit-drift.helpers.ts` (search: `Write canonical skill stubs`), `test/integration/setup-install.helpers.ts` (search: `Run the shell installer`), `CHANGELOG.md` (search: `gruff-ts cleanup follow-up`).

---

## Lesson: A source comment can be a cited learning-loop anchor, so rewording it breaks the audit

**Status:** active | **Created:** 2026-08-18
**Decision changed:** Before rewording an existing comment during a docs pass, grep the learning loop for that exact string; a cited comment is a durable artifact, not free text.
**Trigger phase:** READ
**Caught at:** VERIFY

**What happened:** Clearing `docs.missing-side-effect-doc` across the repo, I rewrote `test/integration/audit-drift.helpers.ts` from "Write canonical skill stubs" to "Writes canonical skill stubs" so the comment carried the rule's exact vocabulary. Gruff went clean, typecheck passed, and the targeted rerun showed the finding removed. The full `npm test` run then failed one case in `test/unit/support-bundle.test.ts` ("emits clean JSON through the CLI", expected exit 0, got 1), because `goat-flow diagnostics bundle` embeds the harness audit, whose `feedback-loop-active` check calls `stats --check`, which found `verification-gruff.md` citing the old wording as a `(search: ...)` anchor. One letter in a test-helper comment turned a green docs pass into a failing CLI contract three layers away.

**Root cause:** I treated comment prose as local text. The learning loop cites source comments as evidence anchors, so the comment is a cross-file contract and the audit enforces it.

**Prevention:** When a docs pass rewords an existing comment, keep the cited substring intact and add the analyzer vocabulary in a second sentence rather than editing the first. Run `stats --check` (or the harness audit) after any batch that rewrites existing comments, not only the targeted Gruff rerun. Evidence anchors: `test/integration/audit-drift.helpers.ts` (search: `Write canonical skill stubs`), `.goat-flow/learning-loop/lessons/verification-gruff.md` (search: `Gruff side-effect comments must name the side effect`).

---

## Lesson: Probe an analyzer rule's real trigger before fixing findings against your model of it

**Status:** active | **Created:** 2026-08-29
**Decision changed:** Before editing source to clear an analyzer finding, build a two-case isolated probe - one that should fire and one that should not - and confirm the rule behaves as you believe. Read the finding's own wording as a hypothesis, never as the mechanism.
**Trigger phase:** VERIFY
**Caught at:** VERIFY

**What happened:** Triaging 18 `test-quality.loop-in-test` findings, I read the rule description ("loops whose assertions do not identify the failing item") and classified each finding by hand: 13 whose assertions already interpolated the loop variable were called false positives, 5 with missing or incomplete messages were called real. I edited those 5 to add identifying messages across `test/contract/test-selection-playbook-doctrine.test.ts`, `test/unit/dashboard-hooks-view.test.ts`, `test/unit/manifest.test.ts`, `test/unit/playbook-contract.test.ts`, and `test/integration/setup-install-agent-matrix.test.ts`. The rerun still reported 18 - not one cleared. An isolated probe then showed the real trigger: the rule only reads the message when the assertion call sits on a single line, so every prettier-wrapped assertion looks message-less regardless of content. A second probe found a related miss - a message built from a loop-derived local is not credited either.

**Root cause:** I inferred the mechanism from the finding's prose and my own idea of what the rule ought to check, then spent five edits on that model. The prose described the rule's intent; the implementation keyed on line shape. Hand-classifying 18 findings produced a confident split that measurement contradicted.

**Prevention:** For any rule whose findings you intend to fix in bulk, first write a probe file holding one compliant and one non-compliant case, run the analyzer on it, and confirm both directions before touching real source. Two probes cost under a minute and would have redirected all five edits. Keep edits that stand on their own merits when the probe invalidates the model - the added assertion messages are still correct diagnosability improvements - but report that the finding count did not move and say why. Evidence anchors: `.goat-flow/learning-loop/lessons/verification-gruff.md` (search: `Probe an analyzer rule's real trigger`), `test/unit/playbook-contract.test.ts` (search: `incomplete scope, missing`).
