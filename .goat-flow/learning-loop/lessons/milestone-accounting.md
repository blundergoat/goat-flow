---
category: milestone-accounting
last_reviewed: 2026-08-24
---

**Scope:** Milestone state and effort accounting - activation order, where human gates belong, what a task section may contain, and why estimates counted from work units beat estimates written as durations. Multi-agent council coordination is [coordination.md](coordination.md).

## Lesson: Git status cannot prove milestone work disappeared after HEAD moves

**Status:** active | **Created:** 2026-08-09
**Decision changed:** Compare the recorded baseline tree, current HEAD, and file hashes before attempting recovery when a changed path disappears from `git status`.
**Trigger phase:** READ
**Caught at:** VERIFY
**Incident count:** 2 | **Latest occurrence:** 2026-08-14

**What happened:** During M03 verification, goat-debug paths disappeared from `git status`, so I paused writes on the assumption that a test process had restored them. The files still had the expected hashes and differed from the recorded M03 baseline tree; current HEAD had advanced to a user-created commit that already contained those changes.

**Recurrence (2026-08-14):** During M01 pending-state validation, ADR-059 and both playbook mirrors disappeared from `git status` after HEAD advanced to `8a8eb2f`. A read-only comparison confirmed that the new commit contained all seven doctrine paths while the six later corrections remained uncommitted, so no recovery write was needed. Evidence anchors: `.goat-flow/learning-loop/decisions/ADR-059-useful-comment-doctrine.md` (search: `Prefer useful comment contracts`) and `test/contract/comment-playbook-doctrine.test.ts` (search: `treats 150 as a ceiling instead of a width target`).

**Root cause:** I read `git status` as a comparison with the milestone's recorded baseline. It compares the index and working tree with current HEAD, so a commit made during the milestone can make preserved work disappear from status without removing it.

**Prevention:** Before restoring or recreating apparently missing work, compare `git diff <recorded-tree>`, `git diff HEAD`, `git log -1`, and hashes for the affected mirrors. Treat an unexpected HEAD change as shared-workspace evidence to reconcile, not proof of data loss. Evidence anchor: `workflow/skills/goat-debug/SKILL.md` (search: `ALWAYS in Diagnose mode`).

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
**Decision changed:** Before setting `human-verification-pending`, keep every implementation Task checked, separate agent handoff work from human execution, prefix each open human-owned Proof item with `[HUMAN]`, and assign it zero agent minutes.
**Trigger phase:** SCOPE
**Caught at:** VERIFY
**Incident count:** 4
**Latest occurrence:** 2026-08-23

**What happened:** A release milestone had finished implementation and automated proof, but I added the final human approval checkbox under Tasks while changing the status to `human-verification-pending`. Strict plan validation rejected the snapshot as having an open implementation task.

**Recurrence 2026-08-10:** A later release proof put `[manual, HUMAN-PENDING]` at the end of one open item that mixed agent handoff preparation with human execution. The checker treated it as executor-owned because human ownership requires the leading `[HUMAN]` marker. Splitting the checked handoff from the zero-agent-minute human gate preserved the original forecast and left the required human work open.

**Recurrence 2026-08-23:** The concurrent-session spike described its open ADR review with trailing `HUMAN-PENDING` prose but omitted the leading `[HUMAN]` ownership marker. Strict validation rejected the pending transition, then correctly exposed stale forecast accounting when the marker reduced the count from seven to six agent work units. Moving the marker to the front, assigning the human check zero agent minutes, and reconciling the six-unit forecast restored a valid handoff. The milestone is gitignored local state; durable enforcement anchors are `src/cli/plans-check.ts` (search: `Human ownership is explicit metadata`) and `src/cli/plans-effort.ts` (search: `keeps approval time outside coding-agent forecasts`).

**Root cause:** I treated human ownership as readable prose instead of positional machine metadata. The checker treats every open Task as executor work and recognizes human ownership only at the start of a Proof item's text.

**Fix:** Keep the gate under Proof, prefix it with `[HUMAN]`, assign it zero agent minutes, reconcile the work-unit forecast, and rerun strict plan validation.

**Prevention:** Before a pending transition, confirm Tasks has no unchecked boxes, agent handoff preparation has its own checked Proof item, every open human-owned Proof item starts with `[HUMAN]` and carries zero agent minutes, and the declared work-unit count still matches. Evidence anchors: `src/cli/plans-check.ts` (search: `collectHumanPendingErrors`) and `src/cli/plans-effort.ts` (search: `countAgentWorkUnits`).

---

## Lesson: Actual time must come from prospective active-time segments

**Status:** active | **Created:** 2026-08-02
**Decision changed:** Start a timestamped timing receipt before milestone work; never reconstruct Actual from planned task estimates.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 9
**Latest occurrence:** 2026-08-24

**What happened:** A completed goat-debug planning milestone recorded `~225 min` as Actual by summing reconstructed product/proof/other effort buckets. The user challenged it because the elapsed work felt closer to minutes than hours. No start/end timestamps existed, so neither figure was measurable; replacing one precise-looking number with another would preserve the same error.

**Recurrence 2026-08-10:** A hook-coverage milestone left its product receipt open overnight across approval pauses. Because the stop time could no longer distinguish agent work from human waiting, the span had to be discarded; its Actual is incomplete and cannot calibrate future forecasts.

**Recurrence 2026-08-10:** During release-plan closeout, I passed a display identifier to `plans time stop` instead of the required milestone-file path. The CLI rejected the command and left the receipt open until the invocation used the exact `M*.md` path. Evidence anchor: `src/cli/plans-time.ts` (search: `requires an M*.md milestone file`).

**Recurrence 2026-08-14:** M01 called `plans time start` while its single rendered status was still `not-started`; the CLI rejected the clock before writing a segment. Moving the milestone to `in-progress` before retrying preserved prospective timing. Evidence anchors: `src/cli/plans-time.ts` (search: `Timing Start requires exactly one rendered Status field`) and `test/unit/plans-export-parsing.test.ts` (search: `rejects Start with`).

**Recurrence 2026-08-17:** M39 left its product span open across a human approval wait and resumed work. The status check could not separate waiting from agent time, so `plans time stop --discard-open` marked the receipt incomplete before a fresh proof segment began. Evidence anchor: `src/cli/plans-time.ts` (search: `receipt contains a discarded open span`).

**Recurrence 2026-08-17:** M40 was abandoned before timing began, but I wrote its Actual as `unavailable - timing was never started`. Strict plan validation rejected the prose-equivalent separator because Actual is machine-parsed state; changing it to the canonical `unavailable: timing was never started` form passed parsing. Evidence anchor: `test/unit/plans-effort.test.ts` (search: `unavailable: timing was never started`).

**Recurrence 2026-08-23 (premature finalization):** M07 finalized its receipt immediately after the noise stop decision, before strict plan validation and the required learning-loop closeout. Strict validation then rejected an added proof row twice: first because a zero-minute estimate was not parseable, then because explanatory text followed the terminal estimate. The finalized 465-second receipt therefore excludes the correction and generated-index work. M07 now labels Actual incomplete instead of presenting the partial span as the whole milestone.

**Recurrence 2026-08-24:** M22's proof span stayed open across an inactive gap and a normal stop initially counted 30,762 seconds. The last observed
pre-stop receipt state was restored, then `plans time stop --discard-open` preserved the valid 933 seconds and marked the receipt incomplete. A timer
must be stopped before yielding control; once waiting and work share a span, discard it instead of subtracting an inferred idle duration. Evidence
anchor: `src/cli/plans-time.ts` (search: `receipt contains a discarded open span`).

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
9. When no receipt exists, copy the canonical `unavailable: <reason>` Actual grammar exactly; punctuation is parser state, not optional prose.
10. Finalize only after strict plan validation and required learning-loop/index closeout; a finalized segment that excludes later correction work is partial evidence and must be labelled incomplete.

**Evidence anchors:** `workflow/skills/goat-plan/SKILL.md` (search: `Successful AI proof records`) defines the handoff requirement; `src/cli/plans-effort.ts` (search: `renderActualLine`) renders the recorded value but cannot create timing evidence.

---

## Lesson: Estimates written as durations inflate 10-30x; estimates counted from work units do not

**Status:** active | **Created:** 2026-08-02
**Decision changed:** Derive an estimate by counting task, proof, and admin units, then converting once. Never write an hours figure first and decompose backwards from it.
**Trigger phase:** SCOPE
**Incident count:** 5
**Latest occurrence:** 2026-08-23

**What happened:** Two plans authored days apart under the same goat-plan guidance produced opposite calibration. goat-debug-improve budgeted 715 minutes; its two receipt-backed milestones measured 273s and 1043s - ratios of 0.05x and 0.13x. Its three earlier milestones show the same shape (180/190/120 minutes estimated against 15/10/4 reported). effort-estimation-timing, estimated by the same author, measured 1.54x, 1.13x, and 0.79x - every milestone inside its declared forecast range.

**Root cause:** The plans derived their numbers differently. goat-debug-improve's brief opens with a duration - "9.5-15 hours coding-agent time" - and the per-milestone splits were apportioned out of that total, so wall-clock intuition set the scale and the categories only divided it. effort-estimation-timing carried a `Forecast basis` naming countable units (contract and RED fixtures 7, timing command and safe writer 6, proof cycles 6, administration 2) which summed upward into the headline. Counting produces agent-time; converting from hours reproduces human intuition wearing agent-time units.

**Recurrence 2026-08-09:** Three consecutive hook-safety milestones were estimated at 150, 165, and 145 minutes; prospective receipts measured 28, 29, and 102 minutes, or 0.19x, 0.18x, and 0.70x. The user flagged the persistent overestimate. A retrospective comparison added six receipt-backed downstream milestones. Across all nine samples, duration-first estimates totalled 1,200 minutes against 276.25 measured minutes: 4.34 times actual in aggregate, with a 5.70-times median overestimate.

**Recurrence 2026-08-10:** A release-identity closeout forecast 103 minutes from 15 units and measured 1,912 recorded-unpaused seconds, rendered as 32 minutes. The 0.31x result fell below the 41-minute low bound because prerequisite work had already absorbed much of the implementation risk; counting every remaining checkbox as fresh work overstated the residual scope.

**Recurrence 2026-08-18:** M55 forecast 28 minutes from 11 units at the 1.16-2.54-8.99 min/unit rates `plans check --strict` emitted from local receipts, and measured 190 recorded seconds - 0.11x, below the 12-minute low bound. The corpus those rates come from is dominated by playbook *authoring* milestones; M55 was prose-only, edited five pre-identified spans, and had its contracts already naming the affected sections. Counting units captured the shape but not the work class. The tool's own rates are still the right default over a hand-picked anchor - an earlier draft of this milestone anchored on one over-running milestone and produced a different wrong number - but a milestone whose spans and assertions are already located should be forecast against comparable located-scope receipts, not the general corpus. The rates and the 15-sample corpus median come from the reforecast advisory in `src/cli/plans-effort.ts` (search: `FORECAST_BASIS_PATTERN`); the milestone carrying the receipt is gitignored local state, so the measured pair (28 forecast, 190 recorded seconds) is recorded here rather than referenced.

**Recurrence 2026-08-23 (M12 reforecast):** I counted seven Tasks and three Proof items but omitted the positive `Plan/admin overhead` unit, so the forecast declared 10 units. Strict validation rejected the mismatch and reported 11. Recounting Tasks, Proof, Mid-proof, and admin entries before applying rates produced the 11-unit 17-39 minute range and 28-minute likely estimate.

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
**Trigger phase:** ACT
**Caught at:** VERIFY
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

**Evidence anchors:** `src/cli/plans-time.ts` (search: `export function applyPlanTimeTransition`) performs the category change; `src/cli/plans-check.ts` (search: `function collectMeasuredActualErrors`) reconciles Actual against the receipt but cannot detect a mis-tagged category. Related: `.goat-flow/learning-loop/lessons/milestone-accounting.md` (search: `## Lesson: Actual time must come from prospective active-time segments`) covers the prior failure of never starting a receipt at all.

---

## Lesson: Activate a milestone before starting its timing receipt

**Status:** active | **Created:** 2026-08-14
**Decision changed:** Activate before timing starts, and remove the active receipt schema before resetting a milestone to `not-started`.
**Trigger phase:** ACT
**Incident count:** 7
**Latest occurrence:** 2026-08-24

**What happened:** While starting code-quality-upstream M04, I ran `plans time start` while its rendered `Status` was still `not-started`. The CLI refused with `Timing Start requires exactly one rendered Status field set to in-progress or testing-gate`; I then changed the status and reran the command successfully.

**Recurrence 2026-08-21:** While activating the 1.17.0 CLI-help M39, I repeated the same order: `plans time start` ran before `Status` changed from `not-started` to `in-progress`. The guard rejected the command without opening a segment; changing lifecycle state first made the prospective start succeed.

**Recurrence 2026-08-23 (inactive transition):** After M08's corpus gate invalidated its assumption, I changed `Status` from `in-progress` to `blocked` while its product span remained open. Strict validation rejected the inactive milestone with an active Timing Receipt. Stopping the span produced a paused 466-second receipt and restored lifecycle consistency.

**Recurrence 2026-08-23 (M11 activation order):** I reforecast M11, then tried to open its `other` segment while `Status` was still `not-started`. The guard opened no receipt. I changed the milestone to `in-progress` and the prospective retry opened M11-S01 successfully; no elapsed time was backfilled.

**Recurrence 2026-08-24 (M22 activation order):** I tried to start M22's first segment while its status was still `not-started`. The guard wrote no
receipt; changing the status to `in-progress` before retrying opened the segment prospectively. The activation order remains status first, timer
second, even when every plan task is already approved.

**Recurrence 2026-08-24 (M26 activation order):** I tried to start M26's first segment while its status was still `not-started`. The guard rejected the command without opening a receipt. Changing the status to `in-progress` before the prospective retry opened M26-S01; no interval was backfilled. Evidence anchor: `src/cli/plans-time.ts` (search: `Timing Start requires exactly one rendered Status field`).

**Recurrence 2026-08-24 (reset to not-started):** I reset `windows-native-hooks` M01 to `not-started` while preserving its paused Timing Receipt. Strict plan validation rejected `not-started milestone must not include a Timing Receipt`. Moving the exact closed S01 row to Reset history, reopening the checked task, and removing the active receipt section made validation pass without erasing measured effort.

**Root cause:** I treated receipt creation as the transition that made a milestone active, then treated lifecycle text as though it also normalized timing state. The CLI models them separately: active state is required before a start, an open span must end before an inactive state can validate, and `not-started` cannot retain even a paused receipt.

**Prevention:**
1. Change the milestone to `in-progress` or `testing-gate` before the first `plans time start` command.
2. Confirm the milestone renders exactly one `Status` field, then start the category and inspect the returned open segment.
3. If start is rejected, correct the state and retry prospectively; never fabricate or backfill the missed interval.
4. Stop and inspect the open timing span before changing a milestone to `blocked`, `abandoned`, or `complete`; lifecycle text does not close the receipt.
5. When resetting to `not-started`, reopen every task and proof, preserve exact closed-segment evidence under Reset history, and remove the active Timing Receipt section.

**Evidence anchor:** `src/cli/plans-time.ts` (search: `Timing Start requires exactly one rendered Status field`) rejects missing, competing, empty, or inactive milestone states before opening a receipt. `src/cli/plans-check.ts` (search: `not-started milestone must not include a Timing Receipt`) enforces a clean prospective receipt after reset.

---

## Lesson: Milestone task sections contain estimated work, not evidence notes

**Status:** active | **Created:** 2026-08-07
**Decision changed:** Reserve Tasks for estimated implementation checkboxes and keep each `(est: ...)` entry at the end of its item.
**Trigger phase:** SCOPE
**Caught at:** VERIFY
**Incident count:** 5
**Latest occurrence:** 2026-08-23

**What happened:** M05 recorded a completed test-audit result as another checkbox under `## Tasks`. Strict plan validation counted it as implementation work, then reported one missing `(est: ...)` entry and a 15/20-minute product mismatch.

**Recurrence update (2026-08-08):** M01 completion notes were appended after all four task estimates. The terminal estimate parser then treated every task as unestimated and reported zero counted product minutes against the declared 60-minute split. Moving each completion note before its estimate restored strict validation.

**Recurrence update (2026-08-14):** A final strict sweep of four completed hook-command-portability milestones found completion notes after terminal estimates in Tasks and Proof, forecast-only `Plan/admin overhead` fields overwritten with measured administrative time, and an Actual reason extended beyond its fixed receipt grammar. The malformed items undercounted work units and category totals even though their intended minutes remained visible to a human. Restoring forecast fields, moving notes before terminal estimates, and keeping variance in a separate field preserved both planning history and measured receipts.

**Recurrence update (2026-08-23):** Closing abandoned M07 added a zero-minute proof row with explanatory text inside its estimate field. Strict validation rejected it as unparseable. Changing the value to one minute still failed because explanatory text followed the terminal estimate. The two-correction rewind removed the redundant proof row because the checked measurement task already owned that evidence. Evidence anchors: `src/cli/plans-effort.ts` (search: `TASK_ESTIMATE_PATTERN`) requires a positive terminal estimate; `src/cli/plans-check.ts` (search: `estimate not parseable`) promotes that parser warning to a strict error.

**Recurrence update (2026-08-23, M08):** A section-wide Task gate paragraph was placed after the final checkbox. `readChecklistItems` owns every continuation line until the next checkbox or heading, so the paragraph became part of Task 4 and its `(est: ...)` token was no longer terminal. Strict validation reported one missing estimate, 11 product minutes against 14 declared, and 7 work units against 8 declared. Moving the gate paragraph above the first checkbox restored all three counts.

**Root cause:** The task section was treated as a convenient narrative checklist without preserving its terminal estimate grammar. Its checkboxes and final `(est: ...)` entries are machine-readable work records that feed estimate coverage and category totals.

**Prevention:** Keep `## Tasks` to estimated work items. Put section-wide guidance before the first checkbox or under its own heading, never after the final estimated item. Put discoveries in `## Context` and literal gate output in `## Actual evidence`; if a task or proof needs a completion note, place it before the terminal estimate. Keep `Plan/admin overhead` as the forecast input, keep measured variance outside the fixed Actual receipt reason, and rerun strict plan validation after closeout edits.

**Evidence anchor:** `src/cli/plans-export.ts` (search: `function readChecklistItems`) converts every task-section checkbox into an estimate-bearing record; `src/cli/plans-effort.ts` (search: `const TASK_ESTIMATE_PATTERN`) requires the estimate at the item's end; `src/cli/plans-check.ts` (search: `function collectCoverageErrors`) rejects records without estimates.

## Lesson: Milestone plans need exporter-contract verification before handoff

**Status:** active | **Created:** 2026-07-17
**Decision changed:** After writing or restructuring `M*.md` files, validate them with the shipped plan exporter before handoff; visual Markdown completeness is insufficient. | **Trigger phase:** VERIFY
**Incident count:** 5 | **Latest occurrence:** 2026-08-15

**What happened:** The 1.15.0 milestone files looked structurally complete and passed a custom heading/count check, but the first `plans export` preview warned that all 11 records lacked portable objectives and boundary notes. At that revision, the exporter accepted only the bold `Objective` field, while the files used a level-two `Objective` section. They also omitted `Boundary Notes` and initially placed CAO incident gates in peer sections the exporter would not include in task bodies.

**Recurrence (2026-07-31):** Goat-plan's compact reference introduced an inline Scope plus canonical `## Exit` containing `Stop/rescope if`, while the parser still accepted only a Scope section, legacy `## Exit criteria`, and a separate stop heading. The first full preflight also caught three parser complexity errors missed by the focused M02 suite. The correction added an end-to-end strict Small fixture, exporter coverage for compact Exit/stop, and split parser branches before rerunning repository gates.

**Dashboard recurrence (2026-07-31):** The first M03 dashboard GREEN reused the filename fallback as an objective when malformed Markdown had no outcome heading. Manual diff review caught the false objective before handoff. The correction keeps filename fallback for the row title, passes only a parsed outcome heading into objective fallback, and asserts that malformed objectives remain blank.

**Recurrence (2026-08-03):** A new milestone followed the field guide's prose form `Plan/admin overhead: n min other`, but the parser required the bold field `**Plan/admin overhead:**`. Strict validation rejected the unparseable estimate before implementation; correcting the field cleared the error. Evidence anchor: `src/cli/plans-export.ts` (search: `readMilestoneField(content, "Plan/admin overhead"`).

**Recurrence (2026-08-05):** The 1.16.0 strict checker and Markdown exporter both exited zero, but supplementary contract checks found 13 cited paths or search strings that did not resolve and one nine-word ISSUE delivery item below the documented minimum. Several references named the right concept in the wrong learning file; others preserved stale filenames or approximate headings. Correcting the citations and rerunning both validators prevented an implementation handoff built on nonexistent evidence or malformed issue copy.

**Recurrence (2026-08-15):** The goat-clarity M03 fresh-consumer command passed strict plan validation but failed on first execution because the installer requires its target directory to exist. Adding an explicit `mkdir -p` precondition made the command self-contained and the four-agent install then completed. Evidence anchor: `workflow/install-goat-flow.sh` (search: `is not a directory`).

**Root cause:** I validated the authoring layout I had produced instead of the repository's consumer contract. A Markdown reader could infer the intended fields, while `parseMilestoneMarkdown` intentionally recognizes a narrower portable schema.

**Fix and prevention:** Treat the canonical example as an executable consumer fixture, not prose. Cover compact and expanded representations through `parseMilestoneMarkdown`, run `goat-flow plans check <plan-path> --strict`, require exporter records to have zero warnings, and resolve every cited path plus exact semantic search string before handoff. Dry-run executable plan commands against disposable inputs, including every directory or file precondition they rely on. Parser changes also run scoped ESLint before full preflight. Current objective parsing accepts a bold field, an `## Objective` section, or the outcome title. Other portable anchors are Status, compact or section Scope, Tasks, Proof, Exit/Exit criteria, and Stop/rescope. Evidence anchors: `src/cli/plans-export.ts` (search: `readFieldOrSectionMarkdown`), `src/cli/plans-export.ts` (search: `readStopMarkdown`), and `test/unit/plans-check.test.ts` (search: `accepts the compact Small rendering in strict mode`).

---

## Lesson: A milestone added to an existing train must be wired into its terminal node and ISSUE bands

**Status:** active | **Created:** 2026-08-23
**Incident count:** 2
**Latest occurrence:** 2026-08-23
**Decision changed:** When goat-plan File-Write adds a milestone to a plan directory that already has a terminal release milestone, the same batch adds the new ID to that node's `Depends on` and re-derives the ISSUE task band and totals; a milestone file alone is not "in the plan".
**Trigger phase:** SCOPE
**Caught at:** ACT

**What happened:** Twice on the same day, in two sessions. First, M47 was created in the 1.17.0 train with valid structure and a passing strict check, but the train's terminal node (M37, whose `Depends on` list closes the release) did not list it, so the release cut would have closed without M47. The ISSUE.md band and totals were updated only because the user asked for the ISSUE reference separately. The gap surfaced on a "double check that plan" pass, not on validation, because `plans check` validates each file and the ISSUE arithmetic, not membership in the terminal node. Hours later a parallel session added M48 to the same train, also absent from that node - the fix was already in flight and did not reach the other session.

**Root cause:** goat-plan's File-Write path describes creating and validating files in `.goat-flow/plans/<active>/`; it does not say that an existing train's dependency graph and ISSUE bands are part of the artifact, so "wrote M47" felt complete.

**Evidence:** Both files are local gitignored plan files (the 1.17.0 terminal milestone M37 and the new M47), so no durable repository anchor exists; the strict check passed before and after the fix, which is the point.

**Prevention:** When adding a milestone to an existing plan directory, read the terminal node (the milestone whose `Depends on` closes the train), add the new ID there, re-derive the ISSUE.md band and the "How long" totals from the new forecast, and only then run the strict check. Treat a passing per-file check as necessary, not sufficient. Since 2026-08-23 goat-plan's File Artifact Rules state this for existing plans (TDD log: `2026-08-23-goat-plan-tdd.md`; evidence class partial hardening, one real RED and one GREEN).

---
