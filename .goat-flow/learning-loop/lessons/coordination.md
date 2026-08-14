---
category: coordination
last_reviewed: 2026-08-14
---

## Lesson: Git status cannot prove milestone work disappeared after HEAD moves

**Status:** active | **Created:** 2026-08-09
**Decision changed:** Compare the recorded baseline tree, current HEAD, and file hashes before attempting recovery when a changed path disappears from `git status`.
**Trigger phase:** VERIFY
**Incident count:** 2 | **Latest occurrence:** 2026-08-14

**What happened:** During M03 verification, goat-debug paths disappeared from `git status`, so I paused writes on the assumption that a test process had restored them. The files still had the expected hashes and differed from the recorded M03 baseline tree; current HEAD had advanced to a user-created commit that already contained those changes.

**Recurrence (2026-08-14):** During M01 pending-state validation, ADR-059 and both playbook mirrors disappeared from `git status` after HEAD advanced to `8a8eb2f`. A read-only comparison confirmed that the new commit contained all seven doctrine paths while the six later corrections remained uncommitted, so no recovery write was needed. Evidence anchors: `.goat-flow/learning-loop/decisions/ADR-059-useful-comment-doctrine.md` (search: `Prefer useful comment contracts`) and `test/contract/comment-playbook-doctrine.test.ts` (search: `treats 150 as a ceiling instead of a width target`).

**Root cause:** I read `git status` as a comparison with the milestone's recorded baseline. It compares the index and working tree with current HEAD, so a commit made during the milestone can make preserved work disappear from status without removing it.

**Prevention:** Before restoring or recreating apparently missing work, compare `git diff <recorded-tree>`, `git diff HEAD`, `git log -1`, and hashes for the affected mirrors. Treat an unexpected HEAD change as shared-workspace evidence to reconcile, not proof of data loss. Evidence anchor: `workflow/skills/goat-debug/SKILL.md` (search: `ALWAYS in Diagnose mode`).

---

## Lesson: Test cross-contamination via global env vars / module-level state silently flaps in parallel CI

**Status:** active | **Created:** 2026-05-25
**Decision changed:** Test platform-specific admission through injected discovery results, not shared process globals.
**Trigger phase:** VERIFY
**Incident count:** 2
**Latest occurrence:** 2026-08-06

**What happened (external — mini-swe-agent PR #755, merged 2026-02-19, plus the conftest fixture pattern):** Tests modifying global state via env vars contaminated each other when CI ran in parallel. Mini's fix in the upstream mini-swe-agent repo at tests/conftest.py (search: `GLOBAL_MODEL_STATS`) wraps tests that touch `GLOBAL_MODEL_STATS` (a module-level singleton) with a threading lock + reset before AND after each test. PR #755 specifically — "Fix tests because of env var overwrite" — addressed tests setting `MSWEA_DOCKER_EXECUTABLE`, `MSWEA_SILENT_STARTUP`, etc. leaking into siblings that depended on those vars being unset. The flakiness was rank-ordering-dependent and invisible until a CI run reordered the affected pair.

**Recurrence update (2026-08-06):** A Windows dry-run regression test temporarily rewrote `process.platform` and `PATH`, then skipped itself on native Windows. Gruff flagged both global-state mutation and conditional skipping. Replacing it with a pure adapter from `buildInstallerInvocation` to `managedSetupPreviewForInstallerLaunch` kept the production branch directly testable without changing shared process state.

**Root cause:** Globals are shared across the test process. Pytest's per-test isolation does not extend to module-level state. Without explicit teardown, any test that writes a global leaks to every subsequent test in the same process. Parallel test runners that share a process surface this faster.

**Goat-flow applicability:** vitest isolates per-file but not per-test for module-level state. Exposed surfaces: `process.env` mutations in CLI-option tests, singletons in `src/cli/server/` (WebSocket server, session managers, project registry), module-level caches in audit / quality (`let cached: X | undefined` at module scope).

**Prevention:**
1. Audit `src/` for module-level mutable state. For every test that touches one, add a fixture/beforeEach that resets it (mini's `reset_global_stats` is the model — threading lock + reset before AND after).
2. For env var-driven behavior, prefer explicit dependency injection in tests (`runWithEnv({ KEY: "value" }, () => { ... })`) over `process.env.KEY = "value"`. Injection auto-cleans; direct mutation does not.
3. When a test starts flapping rank-order-dependent, the root cause is almost always global state contamination — fix at the global, not at the test.

---

## Lesson: Phase 0 normalisation catches council false findings before they create work

**Created:** 2026-05-01
**What happened:** A five-council synthesis (Claude x2, ChatGPT, Gemini, Codex) produced findings for the v1.4 programme. Phase 0 normalisation verified every factual claim before acting. Two corrections surfaced:
1. OP-5 claimed installed skills were at v1.3.1 and the review plan needed rebasing. Verification showed all six skills at v1.3.2 across all four parity surfaces. The review plan's baseline was correct. ~1 weekend of recomputation work avoided.
2. OP-7 claimed word budgets were a programme-wide crisis. Verification showed only goat-critique is at the wall (3 words slack). goat-plan has 79 words of room. The other four skills have 277-1191 words of slack.
**Evidence:** The v1.4 programme notes (search: `Finding investigated and rejected: OP-5`) document both corrections with `wc -w` and `grep` output from the verification session.
**Prevention:** Always run Phase 0 normalisation on council synthesis findings before acting on them. Verify version claims with `grep goat-flow-skill-version`, word counts with `wc -w`, and parity with `cmp`. Council findings are inputs to verify, not evidence to trust.

## Lesson: AI council version-baseline claims are an axis where reviewers hallucinate

**Created:** 2026-05-01
**What happened:** The council synthesis stated "installed skills are v1.3.1" across multiple findings (CC-2, OP-5). All five council members either produced or passed through this claim without verification. The actual version was v1.3.2 - a one-increment error that would have cascaded into unnecessary score recomputation across the review plan.
**Prevention:** When a council pass produces version-number claims, Phase 0 must verify them against the actual codebase. Version numbers are cheap to check (`grep goat-flow-skill-version`) and expensive to get wrong (downstream score computations, rebase work). Add "version baseline verification" as a standing Phase 0 checklist item for future council synthesis passes.

## Lesson: goat-flow correction loop runs at higher precision than council input

**Created:** 2026-05-01
**What happened:** Across Phase 0 and Phase 1 of the v1.4 programme, the framework's structured intake filtered three corrections from council input: one false finding (OP-5), one over-stated finding (OP-7), and one guardrail-consistency question (critique score gap) that the programme document itself surfaced. The correction rate (~3 findings corrected out of ~19) suggests the council pass produces useful but noisy input, and the Phase 0 verification step is load-bearing infrastructure, not ceremony.
**Prevention:** If this pattern holds across Phase 2 per-plan updates, promote Phase 0 verification from "v1.4 programme requirement" to "standing requirement for any council-derived improvement work." The cost of Phase 0 (~1 weekend) is small relative to the rework it prevents.

## Lesson: CF coordination cardinality forecast was directionally correct but per-skill bucket was larger than expected

**Created:** 2026-05-01
**What happened:** Council synthesis estimated CF item Phase C split at ~6 preamble / ~10 shared-vocab / ~6 per-skill. Actual tagging of goat-plan's 19 CF items landed at 3 preamble / 5 shared-vocab / 11 per-skill. Plan-specific items (template rules, milestone formats, output checklists) don't generalise because they're tied to plan's specific output structure. The "single coordination pass replaces 22 patches" framing was directionally right but optimistic on volume - more work happens inside individual plan ships than as a coordinated batch.
**Prevention:** When forecasting CF coordination, frame as "3 categories of work" rather than "3 batches that ship together." Per-skill items will dominate unless the CF source is genuinely cross-skill (e.g. evidence labelling, proof vocabulary).

## Lesson: Phase 2 per-plan execution averaged better than forecast when programme document resolved ambiguity upfront

**Created:** 2026-05-01
**What happened:** Across 5 Phase 2 per-plan sessions, forecasts predicted a total of ~4 open questions requiring decisions. Actual: 2 (both from critique, the most complex plan). Debug, plan, qa, and review all ran with zero open questions. The programme document (Phase 1) resolved most interpretation work before sessions started, converting per-plan updates into mechanical execution.
**Prevention:** Validates the "programme document before per-plan work" sequencing. For future council-derived improvement work, always produce the coordinating programme document first and gate on it before touching individual plans. The cost is one extra phase; the payoff is per-plan sessions that run without interpretation stalls. Calibration: when a programme document precedes per-artifact updates, forecast at 50% of the interpretation challenges initially identified (Phase 2 averaged 0.33 questions/plan vs forecast 1.0).

## Lesson: Phase 3 verification catches state drift invisible to plan-level reasoning

**Created:** 2026-05-01
**What happened:** Phase 3 verification ran `wc -w` and `git show` against live repo state and found two issues that five council passes and three Phase 2 sessions missed: (1) goat-critique SKILL.md was at 2532 words (32 over ADR-023's 2500 cap), caused by 15 commits made to main between Phase 0 and Phase 3 - not by this audit's work. (2) goat-review's internal version naming (v1.4.0/v1.5.0/v1.6.0) collided with the programme's atomic version sync (all skills bump to v1.4.0 at Phase A). Both required decisions and corrections to the programme document.
**Evidence:** The v1.4 programme notes (search: `Corrected post-Phase 3 verification`) document the word-count correction. Version naming convention documented in Section 2.1.
**Prevention:** Future programme-style improvement work should always end with a verification phase that reads live repo state, not just the artifacts produced. Plan-level reasoning operates on stated numbers; verification operates on measured numbers. The two diverge when the repo changes underneath the audit.

## Lesson: Verification phases must cross-reference between artifacts, not just check each internally

**Created:** 2026-05-01
**What happened:** Phase 3 verification checked word counts, parity, rubric citations, npm test - all internal to individual files. It did not cross-reference programme document claims against plan content. Result: four residual inconsistencies survived Phase 3 and were caught by editorial review instead. Specifics: (1) qa score missing from programme cumulative table, (2) critique target "~95+" in programme vs 91 in plan, (3) OP-10/OP-12 Appendix A statuses stale, (4) review plan still used v1.4.0/v1.5.0/v1.6.0 labels that programme claimed were renamed to M1/M2/M3.
**Prevention:** Add "programme document claims match per-plan deliverables" as a verification check in future cycles. Cross-document consistency is the gap between internal-file verification and audit completeness.

## Lesson: Phase totals must be derivable from phase breakdowns

**Status:** active | **Created:** 2026-05-01
**Decision changed:** Run the plan arithmetic gate immediately after writing estimates, then independently derive every ISSUE-level roll-up from the validated milestone headlines.
**Trigger phase:** VERIFY
**Incident count:** 5
**Latest occurrence:** 2026-08-10

**What happened:** Programme headline stated ~33 weekends (council's estimate). Phase breakdowns summed to ~26. The gap was unexplained - some combination of CF items, overhead, and double-counted shared infrastructure. The headline lost legitimacy when the math didn't add up.

**Recurrence 2026-08-04:** The quality-findings milestone declared 70 minutes as 45 product / 20 proof / 5 other, but its proof tasks summed to 28 minutes. `plans check` rejected the artifact with the category-overrun diagnostic; the estimate was corrected to 78 minutes before implementation continued. Evidence anchor: `src/cli/plans-check.ts` (search: `task estimates`).

**Recurrence 2026-08-07:** Strict plan validation confirmed every milestone's internal arithmetic, but I manually transcribed the M06-M12 sum as 13.25 hours. The validated headlines totalled 815 minutes, or about 13.6 hours. A separate cross-artifact arithmetic pass caught the mismatch before delivery.

**Recurrence 2026-08-09:** Expanding M03 for a runtime-hook repair added 20 product minutes and 20 proof minutes, but I initially left its headline split at 140 product / 110 proof. Strict validation reported counted totals of 160 / 130; the live estimate was corrected while the original 260-minute baseline stayed explicit in Forecast calibration. Evidence anchor: `src/cli/plans-check.ts` (search: `counted work`).

**Recurrence 2026-08-10:** A release plan used 15 work units and a 12.42-minute high rate, then manually recorded the high bound as 186 minutes. The deterministic ceiling was 187, so strict validation blocked closeout until the displayed range matched the formula. Evidence anchor: `src/cli/plans-effort.ts` (search: `forecast basis derives`).

**Prevention:** Programme documents should show effort accounting explicitly and derive each roll-up from the milestone headlines after strict validation. If two totals intentionally differ, name the accounting difference; do not transcribe a mental sum into the summary.

---

## Lesson: Activate prerequisites before the numerically next milestone

**Status:** active | **Created:** 2026-07-13
**Incident count:** 2
**Latest occurrence:** 2026-07-31

**What happened:** After M05 approval, M06 was marked in progress before its dependency header was read. A later parent-plan run also started final evidence while four semantic prerequisites remained unfinished, then initially amended `Depends on` with explanatory prose that strict validation rejected.

**Root cause:** Execution order was inferred from milestone position or incomplete prose instead of a complete, parseable dependency contract.

**Evidence:** Both incidents occurred in local gitignored milestone files, so no durable repository anchor exists. In each case, dependency validation exposed the ordering defect before dependent implementation continued.

**Prevention:** Before changing milestone status, read every declared prerequisite and run plan validation. Keep `Depends on` machine-only (`none` or comma-separated local IDs); put rationale in narrative fields.

---

## Lesson: Final human gates belong in Proof, not implementation Tasks

**Status:** active | **Created:** 2026-08-01
**Decision changed:** Before setting `human-verification-pending`, keep every implementation Task checked, separate agent handoff work from human execution, and prefix each open human-owned Proof item with `[HUMAN]`.
**Trigger phase:** VERIFY
**Incident count:** 2
**Latest occurrence:** 2026-08-10

**What happened:** A release milestone had finished implementation and automated proof, but I added the final human approval checkbox under Tasks while changing the status to `human-verification-pending`. Strict plan validation rejected the snapshot as having an open implementation task.

**Recurrence 2026-08-10:** A later release proof put `[manual, HUMAN-PENDING]` at the end of one open item that mixed agent handoff preparation with human execution. The checker treated it as executor-owned because human ownership requires the leading `[HUMAN]` marker. Splitting the checked handoff from the zero-agent-minute human gate preserved the original forecast and left the required human work open.

**Root cause:** I treated human ownership as readable prose instead of positional machine metadata. The checker treats every open Task as executor work and recognizes human ownership only at the start of a Proof item's text.

**Fix:** Keep the gate under Proof, prefix it with `[HUMAN]`, and rerun strict plan validation.

**Prevention:** Before a pending transition, confirm Tasks has no unchecked boxes, agent handoff preparation has its own checked Proof item, and every open human-owned Proof item starts with `[HUMAN]`. Evidence anchor: `src/cli/plans-check.ts` (search: `collectHumanPendingErrors`).

---

## Lesson: Actual time must come from prospective active-time segments

**Status:** active | **Created:** 2026-08-02
**Decision changed:** Start a timestamped timing receipt before milestone work; never reconstruct Actual from planned task estimates.
**Trigger phase:** VERIFY
**Incident count:** 5
**Latest occurrence:** 2026-08-14

**What happened:** A completed goat-debug planning milestone recorded `~225 min` as Actual by summing reconstructed product/proof/other effort buckets. The user challenged it because the elapsed work felt closer to minutes than hours. No start/end timestamps existed, so neither figure was measurable; replacing one precise-looking number with another would preserve the same error.

**Recurrence 2026-08-10:** A hook-coverage milestone left its product receipt open overnight across approval pauses. Because the stop time could no longer distinguish agent work from human waiting, the span had to be discarded; its Actual is incomplete and cannot calibrate future forecasts.

**Recurrence 2026-08-10:** During release-plan closeout, I passed a display identifier to `plans time stop` instead of the required milestone-file path. The CLI rejected the command and left the receipt open until the invocation used the exact `M*.md` path. Evidence anchor: `src/cli/plans-time.ts` (search: `requires an M*.md milestone file`).

**Recurrence 2026-08-14:** M01 called `plans time start` while its single rendered status was still `not-started`; the CLI rejected the clock before writing a segment. Moving the milestone to `in-progress` before retrying preserved prospective timing. Evidence anchors: `src/cli/plans-time.ts` (search: `Timing Start requires exactly one rendered Status field`) and `test/unit/plans-export-parsing.test.ts` (search: `rejects Start with`).

**Root cause:** Planned effort, active wall-clock time, aggregate multi-agent effort, command duration, and human waiting were treated as one quantity. Task estimates were available, so they were mistakenly reused as observations.

**Prevention:**
1. Before the first action, record UTC and epoch seconds for an active segment tagged `product`, `proof`, or `other`.
2. Close the segment before a human gate, interruption, or unrelated task; open a new segment only when work resumes.
3. Preserve raw seconds in the milestone and round once when rendering structured Actual. The category split must come from those segments, not task weights.
4. Report wall-clock and aggregate subagent time separately. Parallel agent effort must never be added and presented as elapsed time.
5. If timing was not started prospectively, label Actual as a low-confidence retrospective estimate. Never call it measured or derive it from the plan.
6. Calibrate future estimates only after at least three comparable measured milestones. Use the median `actual / estimate` ratio plus a low/likely/high range; one fast milestone is evidence, not a universal multiplier.
7. Pass the exact milestone-file path to timing commands; a display identifier is not a file locator.
8. Set exactly one rendered milestone status to `in-progress` or `testing-gate` before `plans time start`; the lifecycle transition precedes clock opening.

**Evidence anchors:** `workflow/skills/goat-plan/SKILL.md` (search: `Successful AI proof records`) defines the handoff requirement; `src/cli/plans-effort.ts` (search: `renderActualLine`) renders the recorded value but cannot create timing evidence.

---

## Lesson: Estimates written as durations inflate 10-30x; estimates counted from work units do not

**Status:** active | **Created:** 2026-08-02
**Decision changed:** Derive an estimate by counting task, proof, and admin units, then converting once. Never write an hours figure first and decompose backwards from it.
**Trigger phase:** SCOPE
**Incident count:** 3
**Latest occurrence:** 2026-08-10

**What happened:** Two plans authored days apart under the same goat-plan guidance produced opposite calibration. goat-debug-improve budgeted 715 minutes; its two receipt-backed milestones measured 273s and 1043s - ratios of 0.05x and 0.13x. Its three earlier milestones show the same shape (180/190/120 minutes estimated against 15/10/4 reported). effort-estimation-timing, estimated by the same author, measured 1.54x, 1.13x, and 0.79x - every milestone inside its declared forecast range.

**Root cause:** The plans derived their numbers differently. goat-debug-improve's brief opens with a duration - "9.5-15 hours coding-agent time" - and the per-milestone splits were apportioned out of that total, so wall-clock intuition set the scale and the categories only divided it. effort-estimation-timing carried a `Forecast basis` naming countable units (contract and RED fixtures 7, timing command and safe writer 6, proof cycles 6, administration 2) which summed upward into the headline. Counting produces agent-time; converting from hours reproduces human intuition wearing agent-time units.

**Recurrence 2026-08-09:** Three consecutive hook-safety milestones were estimated at 150, 165, and 145 minutes; prospective receipts measured 28, 29, and 102 minutes, or 0.19x, 0.18x, and 0.70x. The user flagged the persistent overestimate. A retrospective comparison added six receipt-backed downstream milestones. Across all nine samples, duration-first estimates totalled 1,200 minutes against 276.25 measured minutes: 4.34 times actual in aggregate, with a 5.70-times median overestimate.

**Recurrence 2026-08-10:** A release-identity closeout forecast 103 minutes from 15 units and measured 1,912 recorded-unpaused seconds, rendered as 32 minutes. The 0.31x result fell below the 41-minute low bound because prerequisite work had already absorbed much of the implementation risk; counting every remaining checkbox as fresh work overstated the residual scope.

**Method comparison:** The nine milestones contained 99 positive agent-owned Task, Proof, Mid-proof, and admin units. Applying a cold `0.5-2.5-10 min/unit` prior produced a 247.5-minute likely total, 10.4% below the measured total, and all nine outcomes landed inside their derived low/high bands. Leave-one-out local rates covered seven of nine outcomes with 36.5% median absolute percentage error. This is a retrospective backtest, not proof that the next forecast will land; its value is showing that countable inputs materially outperform a duration chosen first.

**Prevention:**
1. Count positive agent-owned Task, Proof, Mid-proof, and admin entries before writing any minute figure. Exclude `[HUMAN]` and zero-minute items. The headline is the result, never the input.
2. Treat any estimate expressed first as hours as unvalidated. Decomposing a duration into product/proof/other does not convert it into agent-time.
3. Record `<units> agent work units; <low>-<likely>-<high> min/unit low-likely-high; source: <evidence>` in `Forecast basis:`. Derive low by flooring (minimum one), likely by rounding, and high by ceiling.
4. Do not carry an inflated plan's estimates into calibration. Untagged retrospective Actuals are excluded for exactly this reason.
5. Below three matching completed, measured bases, use the conservative cold-start prior. At three or more, use the observed low, median, and high minutes per unit reported by `plans check`.
6. Recount and reforecast before implementation whenever scope changes or the CLI prints `reforecast required`; preserve the original estimate for calibration.
7. Derive an ISSUE delivery band by summing milestone forecasts. Never feed a plan-wide duration down into milestone estimates.
8. At activation after prerequisite handoff, classify each unit as fresh, inherited complete, or reconciliation-only. Forecast the residual agent work and preserve the cold estimate separately instead of charging completed prerequisite risk twice.

**Evidence anchors:** `src/cli/plans-effort.ts` (search: `export function countAgentWorkUnits`) owns the unit definition and deterministic range math; `src/cli/plans-check-summary.ts` (search: `function renderRequiredReforecasts`) turns three matching receipt-backed bases into a visible next action; `workflow/skills/goat-plan/SKILL.md` (search: `Effort estimate (agent-time)`) makes that action block implementation. The raw cross-project receipts remain local plan state; the aggregate comparison above is the durable derived record.

---

## Lesson: A running receipt makes a wrong category split look measured

**Status:** active | **Created:** 2026-08-02
**Decision changed:** Switch the receipt category at the work boundary, not at the milestone boundary; a stale category is a silent data error, not a rounding detail.
**Trigger phase:** VERIFY
**Incident count:** 4
**Latest occurrence:** 2026-08-14

**What happened:** Effort-estimation-timing M02 opened a `product` span and left it open across implementation, a full test-suite run, lint, format, and unused-export checks. The finalized receipt reported 1112 product / 99 proof seconds. The total (1354s) was correct and system-stamped, but the split was badly wrong - most of that "product" time was proof. Nothing flagged it: the receipt was open, finalized cleanly, reconciled against the Actual, and passed strict validation, because the CLI can only stamp the category it was given.

**Recurrence 2026-08-04:** The quality-findings milestone left its first `product` span open through focused content tests, both 327-case hook corpora, the interleaved benchmark, and skill contract runs. The category switched only for final repository verification. The receipt total remains prospective, but its product/proof split is knowingly inaccurate and must be disclosed rather than used for calibration.

**Recurrence 2026-08-09:** M03 left its first `product` span open across goat-debug RED confirmation, delegated pressure runs, and the deployment test matrix, then into goat-critique RED. The mistake was caught after 1,604 seconds when the user challenged forecast quality; the receipt switched to `proof` immediately. Total elapsed time remains prospective, but the first segment's category is knowingly mixed and cannot calibrate product-versus-proof rates.

**Recurrence 2026-08-14:** Code-quality-upstream M03 left one `product` span open across product edits, three fresh evaluator runs, formatting recovery, full-suite diagnosis, portability-proof correction, and final repository gates. The mistake was caught before the human gate. Because no prospective category boundaries survived, the open span was discarded and `Actual` was recorded as incomplete instead of publishing the entire mixed session as measured product time. Evidence anchor: `src/cli/plans-time.ts` (search: `receipt contains a discarded open span`).

**Root cause:** Starting a receipt feels like the whole discipline, so category maintenance gets treated as optional bookkeeping. A single long span is also the path of least resistance - `stop` then `start` is two commands, while doing nothing is zero. The resulting split carries the full authority of a `measured` Actual while being no better than a guess.

**Prevention:**
1. Switch category when the *kind* of work changes, not when the milestone changes: entering a proof cycle, returning to implementation, or starting plan bookkeeping each warrant `stop` then `start --category <new>`.
2. Treat "I am about to run the test suite / lint / typecheck" as a category-switch trigger; that is proof time by definition.
3. Before finalizing, read the segment list and ask whether the shape matches the session. One 1000-second span across a mixed session is the smell.
4. If the split is known-wrong at the gate, disclose it in the human-verification report rather than presenting the receipt's authority for a number it did not really measure.
5. Prefer under-claiming: the total is the trustworthy part of a mis-tagged receipt, so say so explicitly.

**Evidence anchors:** `src/cli/plans-time.ts` (search: `export function applyPlanTimeTransition`) performs the category change; `src/cli/plans-check.ts` (search: `function collectMeasuredActualErrors`) reconciles Actual against the receipt but cannot detect a mis-tagged category. Related: `.goat-flow/learning-loop/lessons/coordination.md` (search: `## Lesson: Actual time must come from prospective active-time segments`) covers the prior failure of never starting a receipt at all.

---

## Lesson: Activate a milestone before starting its timing receipt

**Status:** active | **Created:** 2026-08-14
**Decision changed:** Set exactly one active milestone status before starting its first timing segment; lifecycle state precedes measurement.
**Trigger phase:** ACT
**Incident count:** 1
**Latest occurrence:** 2026-08-14

**What happened:** While starting code-quality-upstream M04, I ran `plans time start` while its rendered `Status` was still `not-started`. The CLI refused with `Timing Start requires exactly one rendered Status field set to in-progress or testing-gate`; I then changed the status and reran the command successfully.

**Root cause:** I treated receipt creation as the transition that made the milestone active. The CLI instead treats active lifecycle state as a precondition for opening a clock, so my operation order was inverted.

**Prevention:**
1. Change the milestone to `in-progress` or `testing-gate` before the first `plans time start` command.
2. Confirm the milestone renders exactly one `Status` field, then start the category and inspect the returned open segment.
3. If start is rejected, correct the state and retry prospectively; never fabricate or backfill the missed interval.

**Evidence anchor:** `src/cli/plans-time.ts` (search: `Timing Start requires exactly one rendered Status field`) rejects missing, competing, empty, or inactive milestone states before opening a receipt.

---

## Lesson: Milestone task sections contain estimated work, not evidence notes

**Status:** active | **Created:** 2026-08-07
**Decision changed:** Reserve Tasks for estimated implementation checkboxes and keep each `(est: ...)` entry at the end of its item.
**Trigger phase:** VERIFY
**Incident count:** 2
**Latest occurrence:** 2026-08-08

**What happened:** M05 recorded a completed test-audit result as another checkbox under `## Tasks`. Strict plan validation counted it as implementation work, then reported one missing `(est: ...)` entry and a 15/20-minute product mismatch.

**Recurrence update (2026-08-08):** M01 completion notes were appended after all four task estimates. The terminal estimate parser then treated every task as unestimated and reported zero counted product minutes against the declared 60-minute split. Moving each completion note before its estimate restored strict validation.

**Root cause:** The task section was treated as a convenient narrative checklist without preserving its terminal estimate grammar. Its checkboxes and final `(est: ...)` entries are machine-readable work records that feed estimate coverage and category totals.

**Prevention:** Keep `## Tasks` to estimated work items. Put discoveries in `## Context` and literal gate output in `## Actual evidence`; if a task needs a completion note, place it before the terminal estimate and rerun strict plan validation.

**Evidence anchor:** `src/cli/plans-export.ts` (search: `function readChecklistItems`) converts every task-section checkbox into an estimate-bearing record; `src/cli/plans-effort.ts` (search: `const TASK_ESTIMATE_PATTERN`) requires the estimate at the item's end; `src/cli/plans-check.ts` (search: `function collectCoverageErrors`) rejects records without estimates.
