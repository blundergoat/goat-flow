---
category: verification-gruff
last_reviewed: 2026-09-05
---

**Scope:** The Gruff analyzer specifically - comment rules, doc-comment complexity, binary discovery, and baseline handling. Other repo-wide gates live in [verification-preflight.md](verification-preflight.md); size-gate crossings caused by added text live in [verification-testing.md](verification-testing.md).

## Lesson: Gruff comment fixes must satisfy both humans and the analyzer

**Status:** active | **Created:** 2026-05-25
**Decision changed:** Treat a human-readable comment, boolean name, or compact test as unfinished until the targeted analyzer accepts the exact source shape; read the installed rule before a second rewrite.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 7 | **Latest occurrence:** 2026-08-18
**Merged:** 2026-09-05 - one static-gate recurrence (2026-08-09) moved to `.goat-flow/learning-loop/lessons/verification-formatting.md`, three size-gate recurrences (2026-08-09 x2, 2026-08-28) moved to `.goat-flow/learning-loop/lessons/verification-testing.md`, and two ratchet recurrences (2026-08-16, 2026-08-18) moved to the hidden-complexity lesson below; this entry keeps the analyzer-vocabulary incidents.

**Prevention:** For Gruff-driven comment work, read `.goat-flow/skill-docs/playbooks/code-comments.md`, patch one file or cohesive cluster, then rerun `npx gruff-ts analyse <path>`. If a clear comment stays flagged, open the installed rule in `node_modules/@blundergoat/gruff-ts/src/context-doc-rules.ts` before changing wording or placement again; the rules match whole-word markers and same-line forms, not meaning. Keep internal boolean state in `is...`/`has...` grammar, give each small outcome set direct assertions instead of a test-level loop, and let one concise fixture comment carry purpose and side effect together when the rule reads only the nearest source shape. If a rename replaces a comment, grep the old identifier. Evidence anchors: `src/cli/server/decoders.ts` (search: `Swallows parse errors into the shared decoder failure shape`), `src/cli/server/decoders.ts` (search: `This stays explicit because`), `src/dashboard/globals.d.ts` (search: `shouldDelaySubmit`), `.goat-flow/learning-loop/patterns/workflow.md` (search: `Gruff docs cleanup is a tight analyzer loop`).

**What happened:** Comments in `src/cli/server/decoders.ts` read correctly to a maintainer but still failed `docs.magic-threshold-without-rationale`, `docs.missing-error-behavior-doc`, and `docs.missing-why-for-complex-code`. In the same cleanup, renaming dashboard terminal paste metadata passed focused tests but left stale ambient and VM-test helper shapes that `npm run typecheck` caught.

**Root cause:** Human-readable comments, compact boolean names, and a local rename were treated as complete before checking analyzer vocabulary, test structure, and parallel type surfaces.

**Recurrence 2026-08-09:** A hook-result cap had a plain-English rationale directly above it, but gruff-ts 0.4.0 still reported `docs.magic-threshold-without-rationale`; the same scan found eight boolean fields without intent prefixes and one assertion loop. The rule's same-line `Cap:` form, `is...`/`has...` names, and explicit outcome assertions took the targeted result from 10 advisories to zero. `src/cli/hook-contracts.ts` (search: `Cap: matches both shipped hook limits`), `test/unit/hook-result-contract.test.ts` (search: `assertHookOutcomeRemainsValid`).
**Recurrence 2026-08-09 (runtime adapter):** Eight documentation-shape advisories survived 16 passing contract tests: two threshold comments outside the recognized same-line form, two functions without explicit error or invariant wording, and three provider fixture clusters without nearby purpose comments. `workflow/hooks/hook-provider-adapters.mjs` (search: `Error behavior: returns one bounded invalid reason`), `test/unit/hook-provider-adapters.test.ts` (search: `Fixture covers feedback-bearing host shapes`).
**Recurrence 2026-08-09 (launcher and registry):** Fourteen issues after focused behaviour passed: two files over the length threshold, public contracts without invariant wording, and fixture comments that could not express purpose and side effect as separate adjacent comments. Moving launch decoding into the provider adapter kept the runtime files below 750 lines, and one concise fixture comment now carries both meanings; the three remaining process-execution findings matched the Gruff 0.4 warning baseline that Gruff 0.5 later reclassified as advisory. `workflow/hooks/hook-provider-adapters.mjs` (search: `prepareProviderHookResultDelivery`), `workflow/hooks/run-with-bash.mjs` (search: `function runHookProcessUntilDeadline`), `test/unit/hook-launcher.test.ts` (search: `Fixture purpose: prove direct output parity`), `.gruff-ts.yaml` (search: `security.process-exec:`).
**Recurrence 2026-08-10:** Formatting a Gruff contract test exposed five fixture-purpose and test-loop advisories; named cases cleared the loops, but separate adjacent purpose and side-effect comments produced six follow-up advisories until one concise comment carried both. `test/integration/hook-provider-contracts.test.ts` (search: `Fixture purpose: creates an edit and runs Gruff`), `test/integration/gruff-code-quality-contract.test.ts` (search: `Fixture purpose: proves helper bypass`).
**Recurrence 2026-08-17:** A `renderPriorReportContext` docblock described the stable behaviour twice, but `docs.missing-invariant-doc` stayed until the wording used the marker `contract`. `src/cli/prompt/compose-quality-common.ts` (search: `continuity contract`), `node_modules/@blundergoat/gruff-ts/src/context-doc-rules.ts` (search: `hasInvariantMarker`).
**Recurrence 2026-08-18:** A ratchet comment explained a numeric policy as a "floor", but `docs.magic-threshold-without-rationale` stayed because that synonym is outside the marker vocabulary; "threshold" cleared it. `scripts/gruff-warning-ratchet-checks.mjs` (search: `Coverage threshold retained`), `package.json` (search: `@blundergoat/gruff-ts`).

## Lesson: Gruff hook compatibility probes need real configs and wrapper PATH

**Status:** active | **Created:** 2026-05-28

**Prevention:** When testing `gruff-code-quality.sh` against sibling Gruff implementations, copy or reference each project's real `.gruff-*.yaml`, keep the normal `PATH` while prefixing local Gruff binaries, and run both direct `analyse --format json` schema probes and hook-shaped probes with changed ranges. Evidence anchors: `workflow/hooks/gruff-code-quality.sh` (search: `discover_binary`), `test/integration/gruff-code-quality-smoke.test.ts` (search: `changed line finding`).

**What happened:** Hook-shaped probes against `/home/devgoat/projects/gruff-workspace/gruff-go`, `gruff-php`, `gruff-py`, and `gruff-rs` failed or printed nothing for reasons unrelated to JSON compatibility: placeholder `.gruff-*.yaml` files such as `rules: {}` were invalid for several analyzers, and the Rust probe replaced `PATH` with only Gruff directories plus `/usr/bin:/bin`, hiding `cargo` from `gruff-rs/bin/gruff-rs`.

**Root cause:** Sibling Gruff CLIs were treated as interchangeable binaries, skipping two runtime surfaces the hook contract includes: schema-bearing project config files and wrapper-script dependencies inherited from the caller's `PATH`.

## Lesson: Gruff doc comments can expose hidden complexity warnings

**Status:** active | **Created:** 2026-05-30
**Decision changed:** After any docs batch, analyzer upgrade, or conflict resolution, run the full-scan warning count and the ratchet before the lint gate, even while build and typecheck are green.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 6 | **Latest occurrence:** 2026-08-28
**Merged:** 2026-09-05 - absorbed the 2026-08-16 upgrade and 2026-08-18 merge-conflict recurrences from the comment-fixes lesson above; all describe warning debt surfacing outside the targeted docs rule.

**Prevention:** After a large Gruff docs batch, run `npx gruff-ts analyse --format json --fail-on none` and compare the warning count, then run the lint and preflight gate for any helper extraction. Run `node scripts/check-gruff-warning-ratchet.mjs` immediately after an analyzer or config upgrade and after resolving a merge or stash conflict; combining two branches can cross a complexity threshold neither side crossed alone. When a documented function clears reviewed warning debt, remove that identity from the accepted-warning record in the same change. Do not remove a useful comment to hide a surfaced warning. Evidence anchors: `src/dashboard/app.ts` (search: `encodeTerminalUploadFiles`), `src/dashboard/app.ts` (search: `showTerminalUploadResult`).

**What happened:** A maintainer comment on `_uploadTerminalImages` in `src/dashboard/app.ts` cleared a docs finding but exposed new `complexity.npath` and `design.god-function` warnings; the helper extraction then passed TypeScript but failed preflight ESLint on an unnecessary assertion.

**Root cause:** Only the targeted docs rule was checked, on the assumption that a comment-only patch could not change broader warning or lint counts.

**Recurrence 2026-08-16:** Upgrading Gruff from 0.4.0 to 0.5.0 changed the warning rule set while one error-severity file-length finding stopped the ratchet before it compared warning debt. Removing that error exposed 120 unmatched warnings and 27 stale accepted identities; the first approved 117-entry manifest was pretty-printed past the 1,000-line error threshold and blocked itself until each reviewed entry sat on one JSON line. That manifest was later removed in favour of clearing the warnings, so accepted debt now lives only in code. `package.json` (search: `@blundergoat/gruff-ts`), `scripts/check-gruff-warning-ratchet.mjs` (search: `splitFindingsBySeverity`), `scripts/gruff-warning-ratchet-checks.mjs` (search: `collectAcceptedEntriesByIdentity`).
**Recurrence 2026-08-17:** M47's truthful exported-function documentation made Gruff stop reporting an accepted warning while the reviewed manifest still claimed it, and the same preflight found an 11-branch audit helper; removing the stale row and moving agent-ID validation into the baseline helper cleared both. `scripts/gruff-warning-ratchet-checks.mjs` (search: `stale accepted debt`), `src/cli/server/hook-registrar.ts` (search: `Apply one enabled choice after proving`), `src/cli/audit/check-drift-hooks.ts` (search: `function managedBaselineRows`).
**Recurrence 2026-08-18:** Resolving a committed `git stash pop` conflict left build and typecheck green while the ratchet failed: the merged `dashboardLoadSavedDashboardState` scored cyclomatic 21 and cognitive 23 against the configured 15, and with no accepted-debt manifest any warning is a regression. Extracting the server read and row assembly returned the scan to zero warnings. `src/dashboard/dashboard-projects.ts` (search: `dashboardReadSavedServerState`), `src/dashboard/dashboard-projects.ts` (search: `dashboardBuildProjectRows`), `.gruff-ts.yaml` (search: `complexity.cognitive:`).
**Recurrence 2026-08-28:** M41 Task 7 retired that baseline helper after migrating the primary hook loop, but the optional registry comparison still called it; the first focused run threw `ReferenceError: managedBaselineHashes is not defined`, and `stats --check` found this lesson's anchor still naming the removed helper. Search a helper's exact symbol across the whole edited file and durable evidence before deleting it. `src/cli/audit/check-drift-hooks.ts` (search: `function managedBaselineRows`), `src/cli/audit/check-drift-hooks.ts` (search: `function compareRegistryHookScripts`).

## Lesson: docs.missing-internal-function-doc must not be silenced; baseline the residue

**Status:** active | **Created:** 2026-05-29

**Prevention:** Triage `docs.missing-internal-function-doc` with the gruff-code-quality playbook: add a comment when project or language canon requires it, when the symbol is a public or exported API, or when a file, module, or class boundary has a non-obvious contract; otherwise rename when that removes the ambiguity, or leave the advisory standing under the documented no-doc convention. Never disable the rule; preflight's `Gruff Policy` gate enforces no disabled rules and the warning-debt ratchet, and advisories do not gate. Evidence anchors: `.goat-flow/skill-docs/playbooks/gruff-code-quality.md` (search: `when the symbol is a public/exported API`), `scripts/preflight-checks.sh` (search: `Gruff Policy`).

**What happened:** Gruff reported 337 `docs.missing-internal-function-doc` findings across 73 files. Boilerplate JSDoc on every short helper would satisfy the rule but violate the repo's rewrite-or-rename-before-comment doctrine.

**Root cause:** Two correct rules collide: Gruff rules must not be disabled, and comments must only explain non-obvious WHY. The rule had no tuning options, leaving fix, rename, or accept.

## Lesson: Keep the binary path returned by the gruff availability check

**Status:** active | **Created:** 2026-08-03
**Decision changed:** Run later Gruff commands through the exact `$found` path instead of guessing a global install location.
**Trigger phase:** READ
**Caught at:** VERIFY
**Incident count:** 2 | **Latest occurrence:** 2026-08-09

**Prevention:** Reuse `$found` for the complete Gruff loop, enable `pipefail` whenever analyzer output is filtered, and confirm the analyzer emitted a JSON object before interpreting counts. Evidence anchor: `.goat-flow/skill-docs/playbooks/gruff-code-quality.md` (search: `## Availability Check`).

**What happened:** The availability check found the repo-local `node_modules/.bin/gruff-ts`, but the first analysis command invoked `$HOME/.local/bin/gruff-ts` instead; Bash reported `No such file or directory`, and the following `jq` stage returned zero, which read like analyzer output.

**Root cause:** Discovery was treated as a boolean instead of preserving the executable path, and the piped command had no failure propagation.

**Recurrence 2026-08-09:** The same path guess recurred after discovery had already found `node_modules/.bin/gruff-ts`; reusing the discovered path ran gruff-ts 0.4.0 and preserved its three advisory findings.

## Lesson: Gruff-driven direct imports must preserve facade proof

**Status:** active | **Created:** 2026-05-31
**Incident count:** 2 | **Latest occurrence:** 2026-05-31

**Prevention:** When direct imports are needed to prove a nearby implementation module, keep the stable facade exports exercised with explicit alignment assertions in existing nearby tests. For endpoint arrays without a sort contract, select records by semantic identifier before asserting fields. Evidence anchors: `src/cli/audit/audit.ts` (search: `createAuditFactsView`), `src/cli/quality/skill-quality.ts` (search: `scoreAllArtifacts`), `test/integration/dashboard-tasks-api.test.ts` (search: `milestoneByFilename`).

**What happened:** Gruff's nearby-test requirement pushed several tests from facade imports to implementation-module imports, and the next full `npm test` failed the installer round-trip preflight because Knip found `8 unused exports/types`, including `createAuditFactsView`, `scoreAllArtifacts`, and `normalizeAgentVersionOutput`. The same pass caught an order-sensitive tasks assertion: `/api/tasks` returned `Milestone-malformed.md` before `Milestone-side-menu-navigation.md`, so the test failed with `# fail 1` although both records were present.

**Root cause:** Direct implementation imports for Gruff and facade imports for Knip and API stability were treated as mutually exclusive, and one endpoint test asserted incidental filesystem order instead of selecting the record under test.

**Recurrence 2026-05-31:** Deleting 25 low-quality tests produced the same shape from the other direction: `npx knip` flagged production exports only the deleted tests had imported, `npm run typecheck` caught the route inventory left behind for a deleted route-classification test, and the round-trip preflight caught hidden `.goat-flow` anchors that still cited deleted test paths.

---

## Lesson: Gruff side-effect comments must name the side effect

**Status:** active | **Created:** 2026-05-30
**Incident count:** 4 | **Latest occurrence:** 2026-08-29

**Prevention:** For helpers that write files, mutate fixtures, or run subprocesses, name the side effect in plain maintainer language (`Write`, `Run`, `Spawn`, `filesystem`) instead of a generic purpose sentence, and do not swap that verb for a synonym later. After a large docs batch, check the full rule delta, not only the original docs cluster. Evidence anchors: `test/integration/audit-drift.helpers.ts` (search: `Write canonical skill stubs`), `test/integration/setup-install.helpers.ts` (search: `Run the shell installer`), `CHANGELOG.md` (search: `gruff-ts cleanup follow-up`).

**What happened:** The first internal-helper comment batch cleared `docs.missing-internal-function-doc` but reduced the full snapshot by only 175 findings, because Gruff then reported `docs.missing-side-effect-doc` on helpers that write fixture files or spawn tools. Saying `Writes` or `Spawns` explicitly moved the snapshot to `summary error=0 warning=121 advisory=598 total=719` and both doc clusters to zero.

**Root cause:** Purpose comments on side-effecting helpers lacked the analyzer-recognised side-effect language; a human-useful sentence is not enough when the helper mutates filesystem state or runs a subprocess.

**Recurrence 2026-08-06:** The Windows discovery comment described its purpose and fallback but not the `where.exe` process side effect; naming that action cleared three findings.
**Recurrence 2026-08-27:** A new audit helper said it "launches one bounded child process", but Gruff still reported `docs.missing-side-effect-doc` until the contract read `Side effect: spawns one bounded child process`. `src/cli/audit/check-agent-deny-runtime.ts` (search: `function spawnConfiguredHookProbe`).
**Recurrence 2026-08-29:** Changing a fixture helper's sentence from `writes` to `creates` introduced `docs.missing-side-effect-doc` although the sentence still described the file operation; restoring the filesystem verb returned the five-path identity comparison to zero introduced findings. `test/integration/setup-install.test.ts` (search: `Side effect: writes and marks one analyzer fixture executable`).

---

## Lesson: A source comment can be a cited learning-loop anchor, so rewording it breaks the audit

**Status:** active | **Created:** 2026-08-18
**Decision changed:** Before rewording an existing comment during a docs pass, grep the learning loop for that exact string; a cited comment is a durable artifact, not free text.
**Trigger phase:** READ
**Caught at:** VERIFY

**Prevention:** When a docs pass rewords an existing comment, keep the cited substring intact and add the analyzer vocabulary in a second sentence. Run `stats --check` or the harness audit after any batch that rewrites existing comments, not only the targeted Gruff rerun. Evidence anchors: `test/integration/audit-drift.helpers.ts` (search: `Write canonical skill stubs`), `.goat-flow/learning-loop/lessons/verification-gruff.md` (search: `Gruff side-effect comments must name the side effect`).

**What happened:** Rewriting "Write canonical skill stubs" to "Writes canonical skill stubs" in `test/integration/audit-drift.helpers.ts` cleared `docs.missing-side-effect-doc`, passed typecheck, and then failed `test/unit/support-bundle.test.ts` ("emits clean JSON through the CLI", expected exit 0, got 1): the diagnostics bundle embeds the harness audit, whose `feedback-loop-active` check runs `stats --check`, which found this bucket citing the old wording as a search anchor. One letter in a test-helper comment failed a CLI contract three layers away.

**Root cause:** Comment prose was treated as local text; the learning loop cites source comments as evidence anchors, so a cited comment is a cross-file contract the audit enforces.

---

## Lesson: Probe an analyzer rule's real trigger before fixing findings against your model of it

**Status:** active | **Created:** 2026-08-29
**Decision changed:** Before editing source to clear an analyzer finding, build a two-case isolated probe - one that should fire and one that should not - and confirm the rule behaves as believed; read the finding's wording as a hypothesis, never as the mechanism.
**Trigger phase:** VERIFY
**Caught at:** VERIFY

**Prevention:** For any rule whose findings you intend to fix in bulk, first write a probe file with one compliant and one non-compliant case, run the analyzer on it, and confirm both directions before touching real source. Keep edits that stand on their own merits when the probe invalidates the model, but report that the finding count did not move and why. Evidence anchor: `test/unit/playbook-contract.test.ts` (search: `incomplete scope, missing`).

**What happened:** Eighteen `test-quality.loop-in-test` findings were classified by hand from the rule description ("loops whose assertions do not identify the failing item"): 13 with interpolated loop variables were called false positives and 5 with missing messages were edited across `test/contract/test-selection-playbook-doctrine.test.ts`, `test/unit/dashboard-hooks-view.test.ts`, `test/unit/manifest.test.ts`, `test/unit/playbook-contract.test.ts`, and `test/integration/setup-install-agent-matrix.test.ts`. The rerun still reported 18. An isolated probe showed the real trigger: the rule reads the message only when the assertion call sits on one line, so every Prettier-wrapped assertion looks message-less, and a message built from a loop-derived local is not credited either.

**Root cause:** The mechanism was inferred from the finding's prose and a model of what the rule ought to check; the implementation keyed on line shape, and five edits were spent on that model before a two-probe measurement contradicted it.
