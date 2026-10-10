---
category: verification
last_reviewed: 2026-10-10
---

**Scope:** General verification discipline - what counts as proof, reading before claiming, and checking the thing you actually changed. Siblings own the narrower surfaces: [verification-outcomes.md](verification-outcomes.md) for interpreting execution and semantic outcomes, [verification-validators.md](verification-validators.md) for getting a checker right, [verification-scanners.md](verification-scanners.md) for proving a guard guards, [verification-testing.md](verification-testing.md) for what a test must establish, [verification-preflight.md](verification-preflight.md) and [verification-formatting.md](verification-formatting.md) for repo-wide gates, [verification-gruff.md](verification-gruff.md) for the analyzer, [verification-environment.md](verification-environment.md) for whether the build, tree, or sandbox you measured is the one your claim is about, [milestone-accounting.md](milestone-accounting.md) for plan arithmetic, [milestone-timing.md](milestone-timing.md) for timing receipts, and [skill-trial-evidence.md](skill-trial-evidence.md) for skill-trial baselines and scoring.

## Lesson: A plan's named defect is a claim to verify, not a finding to implement

**Status:** active | **Created:** 2026-08-30 | **Evidence:** OBSERVED
**Severity:** CORRECTNESS
**Decision changed:** Reproduce a planned defect against live code before building the fix or the abstraction it implies, even when the milestone, a critique, and a runtime spot-check all assert it.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 3 | **Latest occurrence:** 2026-10-02

**Prevention:** Treat every defect a plan names as a RED to reproduce first. When the claim is about which of two inputs a component uses, read the caller that supplies them before designing anything, because parameter names do not carry the contract. If the RED passes against unchanged code, stop and record a refutation rather than adjusting the test until it fails; keep the passing case as a control and re-derive the real defect from the same evidence.

**What happened:** The 1.17.0 work planned a fix for `handleQualityRequest` resolving audit, prior-report, and event ownership against the wrong project for target-owned quality modes. The milestone asserted it, an accepted critique listed it, and a failing integration test plus a `qualityModeOwningProjectPath` helper were written on that basis. Reading the caller then showed the dashboard client already resolves mode ownership and sends the owning project as `path`, so the route was correct and the helper re-resolved an already-resolved value.

**Root cause:** The request parameters are named `path` and `target`, which read as controller and selected target. That reading came from the names rather than from the client that populates them, and the plan's wording reinforced it.

**Evidence:** The replacement control case passed against unchanged route code, and a real defect surfaced from the same reading: `ctx.validatedPath` substitutes the server default for an empty value, so a request sending no target still rendered one. Anchors: `src/dashboard/dashboard-setup-quality.ts` (search: `function dashboardQualityReportProjectPath`), `src/cli/server/dashboard-quality-routes.ts` (search: `const requestedTarget`), `test/integration/dashboard-server-dashboard-api-quality.test.ts` (search: `names a selected target only when the request sent one`).

**Recurrence 2026-08-30 (delegated runner):** A cross-harness runner closed its assessment by reporting that the shipped `quality save` heredoc is unusable because the command parser rejects any heredoc containing an object-literal opener as expansion obfuscation, and supplied a reproduction. All three checks disagreed: the reproduction ran clean, a search for that diagnostic across both hook trees returned nothing, and the hook admits exactly that form. The runner hit a real failure and misattributed its cause; recording it unverified would have entered a phantom contract defect into a release gate's evidence. Anchor: `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `large_quality_save_heredoc_is_bounded_data`).

**Recurrence 2026-10-02 (Stop result boundaries):** Reviewing Stop recovery, the agent initially treated empty final provider output as a missing managed-child envelope. A current-runtime check returned `childEnvelopeState=valid`, `providerStdoutBytes=0` and `emptyChildEnvelopeState=invalid`: these are different boundaries. Clarify acceptance wording instead of adding an empty-child success exception. Evidence: `workflow/hooks/hook-provider-adapters.mjs` (search: `decodeHookResultOutput`, `adaptCleanResult`) and `workflow/hooks/post-turn-safety.sh` (search: `emit_post_turn_hook_result`).

---

## Lesson: Read a validator's pattern before reshaping text to satisfy it

**Status:** active | **Created:** 2026-08-18
**Severity:** INTEGRATION
**Decision changed:** On a validator rejection, open the assertion and read its pattern before editing the input a second time.
**Trigger phase:** READ
**Caught at:** VERIFY

**Prevention:** When a validator rejects text that appears to satisfy its message, grep the emitting message in source and read the pattern before the next edit; error copy describes intent, not grammar, and only the pattern is authoritative. Where a caveat is worth keeping, put it in adjacent prose the validator does not parse rather than bending the pinned field.

**What happened:** `plans check --strict` rejected an `Actual:` line with `measured Actual reason must name receipt <seconds> recorded-unpaused seconds`. The line already contained that exact phrase, so the trailing clause was assumed to need reordering; the rerun failed identically. Reading the rule showed `src/cli/plans-check.ts` (search: `recorded-unpaused seconds`) anchors the reason with a whole-string regex, so the reason must be that string and nothing else. Two edits and two runs were spent on a guess the source answered in one read. The caveat moved into the milestone's Timing Receipt section.

**Root cause:** The message named a required substring and "must name" was read as "must contain", although an anchored regex is the likelier reading for a machine-parsed field and the file was one grep away.

**Recurrence 2026-09-17:** Clearing the recovery block retained `Status reason` on `not-started`; strict validation rejected the ordinary state.
Move recovery context to prose and reserve that field for exceptional states. Evidence: `src/cli/plans-check.ts` (search: `collectStatusReasonErrors`).

**Recurrence 2026-09-17 (packaged tests):** Adding "reviewed" to an existing upgrade test title broke its cited learning-loop anchor.
The original title still described the behavior, so it was restored; the helper comment now explains replacement consent.
Before renaming a test, search its full title across code and learning entries. Evidence: `test/integration/packaged-hook-install.test.ts`
(search: `syncs a 1.15.0 install through the archived CLI bin`) and `.goat-flow/learning-loop/footguns/hook-installation.md`
(search: `syncs a 1.15.0 install through the archived CLI bin`).


**Recurrence 2026-09-17 (review receipt):** The draft used `uncommitted=yes` for an explicit-path authority; validation requires `n/a` for that selector.
Read the source-owned labels before assembling a receipt, and describe live dirty bytes in adjacent prose.
Evidence: `src/cli/review-validate-authority.ts` (search: `reviewScopeLabels`).

---

## Lesson: I edited a dead code path because I assumed one implementation

**Status:** active | **Created:** 2026-08-05
**Severity:** CORRECTNESS
**Decision changed:** Before changing behaviour in a script with capability detection, prove which branch actually executes for the installed tool.
**Trigger phase:** READ
**Caught at:** ACT

**Prevention:** When a script branches on capability detection, run the detection first and confirm which branch is taken before editing; here `gruff-ts hook --capabilities` answers it in one command. A behaviour change that produces no observable difference is evidence of a dead edit rather than a stubborn bug, so re-check the branch before stacking more changes on top. Evidence anchors: `.goat-flow/hooks/gruff-code-quality.sh` (search: `supports_native_changed_regions`), `.goat-flow/hooks/gruff-code-quality.sh` (search: `process_file_contract`).

**What happened:** Fixing the gruff hook's file-scope blind spot, the `--changed-scope` flag changed in `run_gruff_json` and the behaviour did not move. The hook has two paths, a legacy `analyse` path and a contract path selected when the analyzer advertises `gruff.hook.v1`; gruff-ts 0.4.0 advertises it, so `process_file_contract` runs and the edit was in code that never executes.

**Root cause:** One plausible implementation was matched to the symptom and edited without checking whether it was the live branch, and the file was long enough that the second path sat past where reading stopped.

**Recurrence 2026-09-17:** Running the workflow entrypoint still loaded the installed parser, so unchanged self-test counts did not exercise source edits.
A later mirror write overlapped a running corpus and invalidated that run. Finish mirror updates before starting proof, then freeze bytes until it exits.
The alias fixture also expected attached `-Cpath` to execute, but Git's read-only config probe rejected it with exit 129; keep only valid command forms.
A first integration-test placement crossed Gruff's file-size threshold; the regressions moved to the existing central corpus.
Evidence: `workflow/hooks/deny-dangerous.sh` (search: `GOAT_HOOK_LIB_DIR`) and
`workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `selected repository commit alias`).

**Recurrence 2026-10-04:** A patched module copy run from this checkout loaded the installed module; a working fix read as ruled out. `workflow/hooks/deny-dangerous.sh` (search: `GOAT_HOOK_LIB_DIR`).

---

## Lesson: Header-only edits leave bodies contradicting the new scope

**Status:** active | **Created:** 2026-05-16
**Severity:** INTEGRATION
**Incident count:** 5 | **Latest occurrence:** 2026-08-26

**Prevention:** After adding or changing a milestone, re-read the whole file rather than the header: grep old-scope keywords, check the filename, compare every named field with its live schema, resolve shared write paths into dependency headers, and require every command to be literal or to name the task that creates it. A reforecast updates basis, range, headline split, and per-item estimates together before strict validation. After rewriting ISSUE bands, count nonblank lines against the format authority. Do not begin a supplemental heading with a canonical or legacy section alias, because the export parser matches heading prefixes. Re-verify time-sensitive platform premises against current primary documentation and the installed version. Run structural validation after the final prose addition and before timing finalization; it proves shape and arithmetic, not semantic executability. Evidence anchors: `.goat-flow/skill-docs/skill-conventions.md` (search: `Task Tracking`), `src/cli/plans-check.ts` (search: `must equal the Effort estimate total`), `src/cli/quality/schema-types.ts` (search: `QUALITY_EVIDENCE_METHODS`), `workflow/skills/reference/skill-preamble.md` (search: `Report-Only Skill Contract`), `.agents/skills/goat-plan/references/issue-format.md` (search: `60 nonblank lines`), `src/cli/plans-export.ts` (search: `section.heading.startsWith`). External platform evidence: [Claude Code hooks reference](https://code.claude.com/docs/en/hooks) (search: `Hooks in skills and agents`).

**What happened:** Status and dependency headers were updated across several milestone files and the affected task was reframed, but body sections, deferred items, field names, and one filename still contradicted the new scope. Review caught doc-only milestones still requiring code helpers, stale dependencies, an old `confidence` field, and an abandoned filename.

**Root cause:** The header was treated as the scope change, although in planning docs a status, dependency, or framing change ripples through Scope Discipline, Tasks, Exit Criteria, Testing Gate, Deferred, filenames, and schema field names.

**Recurrence 2026-08-07:** A usage-insights plan set passed strict validation while a cold-start reread found contradictions the validator cannot see: a nonexistent quality `proof_class` field, a placeholder response mode with an under-scoped live sync command, two milestones racing on the same instruction files, and an assumption that persistent markers were needed after current Claude documentation added skill-scoped hook cleanup.
**Recurrence 2026-08-09:** The revised roadmap passed strict validation with zero exporter warnings, but a path-and-anchor audit found a task naming `runConfiguredHookCommandSmoke`, which does not exist in the deny-runtime source; the plan now uses the live anchor. The first lesson draft then failed learning-loop validation for citing the gitignored roadmap as durable evidence. `src/cli/audit/check-agent-deny-runtime.ts` (search: `verifyConfiguredHookRuntime`).
**Recurrence 2026-08-16:** Reforecasting the task moved its calibrated centre from 45 to 47 minutes in the basis and range while leaving the estimate and checklist totals at 45; strict validation rejected the two conflicting centres before product work began.
**Recurrence 2026-08-26:** During the 1.17.0 reconciliation, the first correction updated dependency and authority statements but left body text saying a corrected contract still pinned the wrong candidate, approval was pending, and rollback restored an absent critique log. The same pass rederived the ISSUE bands correctly but measured 63 nonblank lines against the 60-line target; a snapshot diff and exact counter caught both before delivery. The final closeout then used a `## Proof closure` heading, which the export parser treats as a second canonical Proof section, and strict validation reported conflicting proof representations until it became `## Closure evidence`. The plan is gitignored local evidence.

---

## Lesson: Defensive session rechecks can conflict with TypeScript narrowing

**Status:** active | **Created:** 2026-05-09

**Prevention:** Capture stable session resources after the initial guard, as in `const pty = this.session.pty`, and keep a synchronous write loop free of repeated status predicates. Evidence anchors: `src/cli/server/terminal.ts` (search: `class InitialPromptDelivery`), `src/cli/server/terminal.ts` (search: `chunkTerminalInput`).

**What happened:** Chunking dashboard terminal initial-prompt writes, the first `npm run typecheck` failed with `TS2367` because the loop checked `session.status === "terminated"` after an earlier guard had narrowed the status to active or starting. The intent was a defensive recheck, but the loop was synchronous and no local mutation could make that branch true.

**Root cause:** A defensive runtime status check was treated as free inside a narrowed synchronous scope, and TypeScript correctly rejected a comparison that could not happen there.

---

## Lesson: "Double check" means read the files, not re-run the tests

**Status:** active | **Created:** 2026-03-22
**Severity:** INTEGRATION
**Decision changed:** A double-check includes strict artifact validation and a source-diff read after focused tests.
**Trigger phase:** VERIFY
**Incident count:** 3 | **Latest occurrence:** 2026-08-23

**Prevention:** A double-check includes the pipeline, removed-pattern searches, strict artifact validation, and a source-diff read of representative changed files; tests alone do not establish content accuracy.

**What happened:** The user asked to double check several times, and each time the response re-ran typecheck, tests, and the scan. It never caught the stale shape references, documentation inconsistencies, or content-quality issues that three external agents found immediately by reading the files.

**Root cause:** Verification was read as running the pipeline rather than reading what changed, and tests only cover what they test.

**Recurrence 2026-08-03:** Focused review-validator tests reported 48 passes, then a scoped-diff read found that `\S.+` required two characters where the declared compact-field contract required only non-empty text; the work returned to in-progress, changed the quantifier to `\S.*`, and reran the focused suite before the gate. `src/cli/review-validate-common.ts` (search: `COMPACT_CLEAN_REVIEW_FIELDS`), `test/unit/review-validate.test.ts` (search: `rejects empty, undefended, or repeated compact disclosures`).
**Recurrence 2026-08-23:** Focused tests, typecheck, formatting, and Gruff were green after a comment and naming pass, but rereading goat-clarity's scope rules found that `zeroHit` belonged to an exported interface, so the general low-risk naming approval did not satisfy the skill's identifier-specific second gate; the rename was reverted before closeout. `.agents/skills/goat-clarity/SKILL.md` (search: `Scope v2 needs second approval`), `src/cli/prompt/learning-loop-context.ts` (search: `export interface LearningLoopContextSelection`).

---

## Lesson: Agent doesn't tick milestone checkboxes (recurrence x4, unresolved)

**Status:** active | **Created:** 2026-03-31
**Severity:** INTEGRATION
**Incident count:** 4 | **Latest occurrence:** 2026-04-07
**Recurrences:** (2026-03-31), (2026-04-04), (2026-04-05), (2026-04-07)

**Prevention:** Treat checkbox state as part of each task's write transaction: update the active milestone immediately after the task result and before starting another task. Do not reintroduce a Stop-hook reminder without a new decision that satisfies ADR-037's rejection list.

**What happens:** The agent completes milestone tasks and ticks zero checkboxes, and the user discovers it during review. The instruction exists in three places and is ignored every time.

**Root cause:** When parallelizing work or context-switching to user messages, ticking as you go competes with doing the next thing and loses; completion is tracked mentally and never written to the file.

**Why stronger rules haven't worked:** Each recurrence added a stronger rule, from tick immediately, to make it the first action, to do it before anything else. All failed because documentation-level enforcement does not work here: the forcing function competes with whatever the agent wants to do next.

**Why it stays open:** Mechanical enforcement was tried and withdrawn, so do not re-propose it blind. `.goat-flow/learning-loop/decisions/ADR-037-separate-post-turn-safety-from-validation.md` (search: `shipped and reverted`), (search: `That path is a tombstone`) records the Claude-only `plan-checkbox-guard.sh` Stop hook shipped in v1.12.0 and removed in v1.12.1: the reminder cost default Stop surface, dashboard hook list, installer and config schema, manifest, and audit fixtures, while non-Claude Stop delivery stayed unverified and stale registrations could keep invoking a deleted script. That ADR also rejects swapping in an immediate replacement, which risks rebuilding the same plan-state heuristics under a new name. The gap is real, but any new proposal must start from that rejection list and show what it does differently.

---

## Lesson: Focused installer migration tests must isolate the owning block

**Status:** active | **Created:** 2026-08-26
**Severity:** INTEGRATION
**Decision changed:** For a focused installer migration test, execute the smallest production-owned block or helper that contains the migration; reserve the full installer round trip for its end-to-end gate.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Bind the focused fixture to semantic anchors around the production block, run that exact block with only the primitives it needs, and assert both final filesystem state and operation order. Do not copy the migration sequence into the test, and keep the full installer run as separate repository proof because it covers unrelated stages. Evidence anchors: `workflow/install-goat-flow.sh` (search: `retired_writing_playbook`), `test/integration/setup-install-migrations.test.ts` (search: `preserves retired writing playbooks when installing replacements`), `test/integration/setup-install.helpers.ts` (search: `runInstallerWithEnvironment`).

**Evidence note:** The current test checks public preview, then executes the production playbook block in isolation. Full installer runs remain separate proof.

**What happened:** The first renamed-playbook migration test invoked the complete shell installer. On a Windows host the helper reached both replacement copies and both retired-file removals, then hit its 30-second process limit during later skill installation, so the test received `status: null` before its assertions and teardown reported `EPERM` for the contended temporary directory. The corrected fixture executes the installer's real standalone-playbook block with a minimal copy primitive and completed in about two seconds with one passing test.

**Root cause:** A local replacement-before-pruning contract was coupled to every downstream installer stage, and the larger process added runtime and platform failure modes that fail before the test can read migration evidence it has already produced.

**Recurrence 2026-09-13:** The preservation fix replaced the isolated fixture with a full installer run. Self-review caught the return to this documented timeout trap; the focused test now keeps preview and exact-content assertions without executing later installer stages. Restoring the block also crossed Gruff's file-size limit, so repeated fixture setup and assertions were consolidated in place. Evidence: `test/integration/setup-install-migrations.test.ts` (search: `preserves retired writing playbooks when installing replacements`).

---

## Lesson: Moving a learning-loop entry breaks inbound anchors that `stats --check` never inspects

**Status:** active | **Created:** 2026-08-30
**Decision changed:** After moving an entry between buckets, run `goat-flow audit --check-content` as well as `stats --check`; only the content lint resolves citations that point into the moved entry from outside its bucket.
**Trigger phase:** VERIFY
**Caught at:** VERIFY

**Prevention:** Treat a bucket split as a rename with unknown inbound callers. Before regenerating, grep the moved entry titles across committed content rather than filtering to the lessons tree, which misses ADRs, playbooks, and instruction files. After regenerating, run both gates: `stats --check` proves the buckets and generated indexes are internally consistent, and the content audit proves outside documents still resolve their cited anchors. Editing an ADR body also stales `.goat-flow/learning-loop/decisions/INDEX.md`, so regenerate after the citation repair rather than before it.

**What happened:** Splitting four entries out of this bucket into `.goat-flow/learning-loop/lessons/verification-environment.md` moved the anchor for the parallel-sessions entry. The bucket README's own post-split instruction named only `goat-flow index` and `stats --check`, and both ran clean. The break surfaced two steps later in preflight as a cold-path lint warning, because an ADR cited the entry by its old bucket path, and repairing that ADR staled `.goat-flow/learning-loop/decisions/INDEX.md` until it was regenerated a second time.

**Evidence:** `.goat-flow/learning-loop/decisions/ADR-048-concurrent-session-detection.md` (search: `Parallel sessions need concurrency-safe file patterns`) is the inbound citation that broke; `src/cli/audit/check-content-quality.ts` (search: `stale-semantic-anchor`) is the rule that caught it; `.goat-flow/learning-loop/lessons/README.md` (search: `Bucket Size`) is the post-split instruction, since corrected to name both gates.

---

## Lesson: A shipped default was recommended from one plan's history before every plan was pooled

**Status:** active | **Created:** 2026-09-20
**Severity:** CORRECTNESS
**Decision changed:** Before recommending a default, threshold or setting, measure it on every case it will govern, not on the sample already open, and state the sample's reach beside the number.
**Trigger phase:** READ
**Caught at:** VERIFY
**Incident count:** 3 | **Latest occurrence:** 2026-09-20

**Prevention:** Name the population a recommendation will govern before fitting anything. A shipped default governs every project, so pool every measured sample the tool can report and check the candidate there first. When the open data covers one plan, one repository or one run, say so in the same sentence as the number, and treat agreement with that sample as a hypothesis. Check a proposed setting on the cases it is meant to help before advising it; until then it is a question, not advice.

**What happened:** Asked on 2026-09-19 what the cold-start forecast rates should become, the agent fitted 0.5-1.25-5 to the one plan it had been analysing. That plan is the fastest in the repository: measured on 2026-09-20 its median is 0.88 minutes per work unit against 2.41 pooled. The maintainer then relayed that users find the estimate good and the range too wide, which a halved likely contradicts. Pooled on 2026-09-20, only 35 of 133 measured samples finish under the proposed likely, and actual totals run 2.54 times its summed likely. The recommendation was withdrawn and the likely stayed at 2.5.

**Recurrence 2026-09-20:** The same session advised setting a plan's own forecast range to the 5th-95th percentiles at once, before checking it on the fast-plan forecasts the advice was meant to help. Its own saved replay already showed the same 11 of 18 outcomes inside at a greater width. The advice was withdrawn the same day, when the replay was read again.

**Recurrence 2026-09-20 (plan premise):** A proof item for the new `unit growth:` line assumed the plan under work held no growth data, and the first implementation trusted only `contextual-v1` records. Neither had been checked on the plan's own milestones. The first real run showed a finished milestone with eight saved records under the default method and 18 registered added units. `src/cli/plans-forecast-context.ts` (search: `even when the method remains legacy`) states the rule that one read would have found.

**Evidence:** `.goat-flow/learning-loop/decisions/ADR-067-narrow-the-cold-start-forecast-range.md` (search: `fitted to the fastest plan`) records the rejected rates and the pooled figures. `src/cli/config/config-vocabulary.ts` (search: `DEFAULT_FORECAST_BAND_QUANTILES`) owns the percentile pair the second piece of advice would have changed. The replay and the plan files that record both withdrawals are local working state and are not cited as evidence.
