---
category: milestone-accounting
last_reviewed: 2026-09-05
---

**Scope:** Milestone state and effort accounting - activation order, where human gates belong, what a task section may contain, and why estimates counted from work units beat estimates written as durations. Multi-agent council coordination is [coordination.md](coordination.md).

## Lesson: Git status cannot prove milestone work disappeared after HEAD moves

**Status:** active | **Created:** 2026-08-09
**Decision changed:** Compare the recorded baseline tree, current HEAD, and file hashes before attempting recovery when a changed path disappears from `git status`.
**Trigger phase:** READ
**Caught at:** VERIFY
**Incident count:** 2 | **Latest occurrence:** 2026-08-14

**Prevention:** Before restoring or recreating apparently missing work, compare `git diff <recorded-tree>`, `git diff HEAD`, `git log -1`, and hashes for the affected mirrors. Treat an unexpected HEAD change as shared-workspace evidence to reconcile, not proof of data loss. Evidence anchor: `workflow/skills/goat-debug/SKILL.md` (search: `ALWAYS in Diagnose mode`).

**What happened:** During M03 verification, goat-debug paths disappeared from `git status` and writes were paused on the assumption that a test process had restored them; the files still had the expected hashes, differed from the recorded baseline tree, and HEAD had advanced to a user-created commit that already contained them.

**Root cause:** `git status` compares the index and working tree with current HEAD, not with the milestone's recorded baseline, so a commit made during the milestone hides preserved work without removing it.

**Recurrence 2026-08-14:** ADR-059 and both playbook mirrors disappeared from `git status` after HEAD advanced to `8a8eb2f`; a read-only comparison showed the commit contained all seven doctrine paths while six later corrections stayed uncommitted. `.goat-flow/learning-loop/decisions/ADR-059-useful-comment-doctrine.md` (search: `Prefer useful comment contracts`), `test/contract/comment-playbook-doctrine.test.ts` (search: `treats 150 as a ceiling instead of a width target`).

---

## Lesson: Activate prerequisites before the numerically next milestone

**Status:** active | **Created:** 2026-07-13
**Incident count:** 4 | **Latest occurrence:** 2026-09-03

**Prevention:** Before changing milestone status or deriving proof, read every declared prerequisite and named evidence owner. Recompute mutable counts at the named revision and current worktree; never use a historical endpoint as the live expectation. Run plan validation. Keep `Depends on` machine-only (`none` or comma-separated local IDs) and put rationale in narrative fields.

**What happened:** After M05 approval, M06 was marked in progress before its dependency header was read; a later parent-plan run started final evidence while four semantic prerequisites were unfinished, then amended `Depends on` with explanatory prose that strict validation rejected. Those lifecycle incidents live only in gitignored plans.

**Root cause:** Execution order or proof state came from milestone position, incomplete prose, or a historical summary instead of the dependency and its owning evidence.

**Recurrence 2026-08-28:** M37's timing receipt was paused for the PR #61 follow-up while its status stayed `in-progress`, so strict validation reported two active milestones when M58 reached `human-verification-pending`; marking M37 `blocked` with a current-state reason made the hold machine-readable. `src/cli/plans-check-structure.ts` (search: `multiple active milestones`).
**Recurrence 2026-09-03:** Closing the final lesson lane reused M08's 121-footgun baseline without reopening its evidence; the live index returned 123 because the bulk-rewrite correction added row 122 and the inherited-`SECONDS` incident added row 123. `.goat-flow/learning-loop/footguns/learning-loop-extraction.md` (search: `Bulk learning-loop rewrites can duplicate entries`), `.goat-flow/learning-loop/footguns/hooks.md` (search: `Bash SECONDS can inherit a parent offset`).

---

## Lesson: Final human gates belong in Proof, not implementation Tasks

**Status:** active | **Created:** 2026-08-01
**Decision changed:** Before setting `human-verification-pending`, keep every implementation Task checked, separate agent handoff work from human execution, prefix each open human-owned Proof item with `[HUMAN]`, and assign it zero agent minutes.
**Trigger phase:** SCOPE
**Caught at:** VERIFY
**Incident count:** 5 | **Latest occurrence:** 2026-09-04

**Prevention:** Before a pending transition, require no open Tasks, keep agent handoff as checked Proof, put each zero-minute open `[HUMAN]` item under Proof, reconcile work units, and rerun strict validation. Evidence anchors: `src/cli/plans-check.ts` (search: `collectHumanPendingErrors`), `src/cli/plans-effort.ts` (search: `countAgentWorkUnits`).

**What happened:** A finished release milestone put final human approval under Tasks, and strict pending validation rejected the open implementation item.

**Root cause:** Human ownership is positional metadata: every open Task is executor work, and Proof recognises human ownership only from a leading `[HUMAN]`.

**Recurrence 2026-08-10:** A release proof used trailing `[manual, HUMAN-PENDING]` and mixed handoff preparation with human execution; splitting checked handoff from a leading zero-minute `[HUMAN]` gate preserved the forecast.
**Recurrence 2026-08-23:** An ADR review used trailing `HUMAN-PENDING`; moving `[HUMAN]` to the front and reconciling six agent units restored the handoff. `src/cli/plans-check.ts` (search: `Human ownership is explicit metadata`), `src/cli/plans-effort.ts` (search: `keeps approval time outside coding-agent forecasts`).
**Recurrence 2026-09-04:** M15 left its zero-minute candidate decision under Tasks; moving the leading `[HUMAN]` item to Proof restored strict pending validation. `src/cli/plans-check.ts` (search: `human-verification-pending milestone has open implementation tasks`).

---

## Lesson: Actual time must come from prospective active-time segments

**Status:** active | **Created:** 2026-08-02
**Decision changed:** Start a timestamped timing receipt before milestone work; never reconstruct Actual from planned task estimates.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 11 | **Latest occurrence:** 2026-08-30

**Prevention:**
1. Before the first action, record UTC and epoch seconds for an active segment tagged `product`, `proof`, or `other`; close it before a human gate, interruption, backgrounded command, or unrelated task, and open a new one when work resumes.
2. Preserve raw seconds in the milestone and round once when rendering Actual; the category split comes from segments, not task weights.
3. Report wall-clock and aggregate sub-agent time separately; never add parallel agent effort and present it as elapsed time.
4. If timing was not started prospectively, label Actual a low-confidence retrospective estimate; never call it measured or derive it from the plan.
5. Calibrate only after at least three comparable measured milestones, using the median `actual / estimate` ratio plus a low/likely/high range.
6. Pass the exact milestone-file path to timing commands, set exactly one rendered status to `in-progress` or `testing-gate` before `plans time start`, and copy the canonical `unavailable: <reason>` Actual grammar exactly when no receipt exists.
7. Finalize only after strict plan validation and the required learning-loop and index closeout; a finalized segment that excludes later correction work is partial evidence and must be labelled incomplete.

Evidence anchors: `workflow/skills/goat-plan/SKILL.md` (search: `Successful AI proof records`) defines the handoff requirement; `src/cli/plans-effort.ts` (search: `renderActualLine`) renders the recorded value but cannot create timing evidence.

**What happened:** A completed goat-debug planning milestone recorded `~225 min` as Actual by summing reconstructed product, proof, and other buckets; the user challenged it because the work felt closer to minutes than hours, and with no timestamps neither figure was measurable.

**Root cause:** Planned effort, active wall-clock time, aggregate multi-agent effort, command duration, and human waiting were treated as one quantity, and task estimates were reused as observations.

**Recurrence 2026-08-10:** A hook-coverage milestone left its product receipt open overnight across approval pauses; the span could not separate agent work from waiting and was discarded, so its Actual is incomplete.
**Recurrence 2026-08-10 (file path):** `plans time stop` was given a display identifier instead of the milestone-file path and rejected it. `src/cli/plans-time.ts` (search: `requires an M*.md milestone file`).
**Recurrence 2026-08-14:** M01 called `plans time start` while its rendered status was still `not-started`; the CLI rejected the clock before writing a segment. `src/cli/plans-time.ts` (search: `Timing Start requires exactly one rendered Status field`), `test/unit/plans-export-parsing.test.ts` (search: `rejects Start with`).
**Recurrence 2026-08-17:** M39 left its product span open across a human approval wait; `plans time stop --discard-open` marked the receipt incomplete before a fresh proof segment began. `src/cli/plans-time.ts` (search: `receipt contains a discarded open span`).
**Recurrence 2026-08-17 (grammar):** Abandoned M40's Actual read `unavailable - timing was never started`; strict validation rejected the separator until the canonical `unavailable: timing was never started` form. `test/unit/plans-effort.test.ts` (search: `unavailable: timing was never started`).
**Recurrence 2026-08-23 (premature finalization):** M07 finalized its 465-second receipt before strict validation and learning-loop closeout; strict validation then rejected an added proof row twice, so the receipt excludes the correction and generated-index work and Actual is labelled incomplete.
**Recurrence 2026-08-24:** M22's proof span stayed open across an inactive gap and a normal stop counted 30,762 seconds; restoring the last pre-stop state and using `--discard-open` preserved the valid 933 seconds. Stop the timer before yielding control; once waiting and work share a span, discard it rather than subtracting an inferred idle duration.
**Recurrence 2026-08-28:** M58 finalized a 2,529-second receipt before the plan-wide strict check found M37 and M58 simultaneously active, so the correction, learning update, and regenerated index fell outside the receipt. `src/cli/plans-check-structure.ts` (search: `multiple active milestones`).
**Recurrence 2026-08-30:** M74's proof segment stayed open across three backgrounded verification runs; about twenty minutes of `test:full` and preflight wall-clock shared one span with reading and reconciliation, and `--discard-open` preserved the valid 3,038 seconds. A backgrounded command is a yield.

---

## Lesson: Estimates written as durations inflate several-fold; estimates counted from work units do not

**Status:** active | **Created:** 2026-08-02
**Decision changed:** Derive an estimate by counting task, proof, and admin units, then converting once; never write an hours figure first and decompose backwards from it.
**Trigger phase:** SCOPE
**Incident count:** 5 | **Latest occurrence:** 2026-08-23
**Merged:** 2026-09-05 - renamed from "Estimates written as durations inflate 10-30x; estimates counted from work units do not"; the measured overestimate in the body is 4.34 times in aggregate and 5.70 times at the median, with single milestones between 5 and 20 times.

**Prevention:**
1. Count positive agent-owned Task, Proof, Mid-proof, and admin entries before writing any minute figure; exclude `[HUMAN]` and zero-minute items. The headline is the result, never the input.
2. Treat any estimate expressed first as hours as unvalidated; decomposing a duration into categories does not convert it into agent-time.
3. Record `<units> agent work units; <low>-<likely>-<high> min/unit low-likely-high; source: <evidence>` in `Forecast basis:`; derive low by flooring (minimum one), likely by rounding, high by ceiling.
4. Below three matching completed measured bases, use the conservative cold-start prior; at three or more, use the observed low, median, and high minutes per unit reported by `plans check`. Do not carry an inflated plan's estimates into calibration.
5. Recount and reforecast before implementation whenever scope changes or the CLI prints `reforecast required`, preserving the original estimate. Derive an ISSUE delivery band by summing milestone forecasts, never the reverse.
6. At activation after prerequisite handoff, classify each unit as fresh, inherited complete, or reconciliation-only; forecast the residual agent work and keep the cold estimate separately.

Evidence anchors: `src/cli/plans-effort.ts` (search: `export function countAgentWorkUnits`) owns the unit definition and range math; `src/cli/plans-check-summary.ts` (search: `function renderRequiredReforecasts`) turns three receipt-backed bases into a visible next action; `workflow/skills/goat-plan/SKILL.md` (search: `Effort estimate (agent-time)`) makes that action block implementation.

**What happened:** Two plans authored days apart under the same guidance calibrated in opposite directions. goat-debug-improve budgeted 715 minutes; its two receipt-backed milestones measured 273s and 1043s (0.05x and 0.13x), and its three earlier milestones show the same shape (180/190/120 minutes estimated against 15/10/4 reported). effort-estimation-timing measured 1.54x, 1.13x, and 0.79x, every milestone inside its declared range.

**Root cause:** goat-debug-improve's brief opened with a duration, "9.5-15 hours coding-agent time", and apportioned per-milestone splits from that total, so wall-clock intuition set the scale; effort-estimation-timing carried a `Forecast basis` naming countable units (contract and RED fixtures 7, timing command and safe writer 6, proof cycles 6, administration 2) that summed upward. Counting produces agent-time; converting from hours reproduces human intuition in agent-time units.

**Recurrence 2026-08-09:** Three hook-safety milestones estimated at 150, 165, and 145 minutes measured 28, 29, and 102 (0.19x, 0.18x, 0.70x); across nine receipt-backed samples, duration-first estimates totalled 1,200 minutes against 276.25 measured, 4.34 times actual in aggregate with a 5.70-times median overestimate.
**Recurrence 2026-08-10:** A release-identity closeout forecast 103 minutes from 15 units and measured 1,912 recorded-unpaused seconds (32 minutes, 0.31x), below the 41-minute low bound because prerequisite work had already absorbed the implementation risk.
**Recurrence 2026-08-18:** M55 forecast 28 minutes from 11 units at the 1.16-2.54-8.99 min/unit rates `plans check --strict` emitted and measured 190 seconds (0.11x), below the 12-minute low bound; the corpus behind those rates is dominated by playbook-authoring milestones, while M55 was prose-only with pre-located spans. The tool's rates stay the default over a hand-picked anchor, but a located-scope milestone should be forecast against comparable located-scope receipts. `src/cli/plans-effort.ts` (search: `FORECAST_BASIS_PATTERN`).
**Recurrence 2026-08-23 (M12 reforecast):** Seven Tasks and three Proof items were counted but the positive `Plan/admin overhead` unit was omitted, so the forecast declared 10 units; strict validation reported 11, producing the 17-39 minute range and 28-minute likely estimate.

**Method comparison:** The nine milestones contained 99 positive agent-owned units. A cold `0.5-2.5-10 min/unit` prior produced a 247.5-minute likely total, 10.4 percent below the measured total, with all nine outcomes inside their derived bands; leave-one-out local rates covered seven of nine with 36.5 percent median absolute percentage error. This is a retrospective backtest, not proof that the next forecast will land. The raw cross-project receipts remain local plan state; this aggregate is the durable record.

---

## Lesson: Phase totals must be derivable from phase breakdowns

**Status:** active | **Created:** 2026-05-01
**Decision changed:** Run the plan arithmetic gate immediately after writing estimates, then independently derive every ISSUE-level roll-up from the validated milestone headlines.
**Trigger phase:** SCOPE
**Caught at:** VERIFY
**Incident count:** 8 | **Latest occurrence:** 2026-08-26
**Merged:** 2026-09-05 - moved here from `.goat-flow/learning-loop/lessons/coordination.md`; every recurrence is plan and ISSUE arithmetic, which this bucket owns.

**Prevention:** Show effort accounting explicitly and derive each roll-up from the milestone headlines after strict validation, never by transcribing a mental sum. If two totals intentionally differ, name the accounting difference. Recompute a plan-wide total by exact sum over every milestone file rather than adjusting a stale prior total, because strict validation's milestone inventory excludes `ISSUE.md` and cannot catch that drift. Evidence anchors: `src/cli/plans-check.ts` (search: `task estimates`), `src/cli/plans-effort.ts` (search: `forecast basis derives`), `src/cli/plans-export.ts` (search: `function listMilestoneFiles`).

**What happened:** A programme headline stated about 33 weekends from the council's estimate while the phase breakdowns summed to about 26, and the gap was never explained: some combination of cross-file items, overhead, and double-counted shared infrastructure. The headline lost legitimacy once the arithmetic did not add up.

**Root cause:** A roll-up was written as an independent claim rather than derived from the parts it summarises, so nothing forced the two to agree.

**Recurrence 2026-08-04:** The quality-findings milestone declared 70 minutes as 45 product, 20 proof, and 5 other, while its proof tasks summed to 28; `plans check` rejected it with the category-overrun diagnostic and the estimate was corrected to 78 before implementation continued.
**Recurrence 2026-08-07:** Strict validation confirmed every milestone's internal arithmetic, but the M06 to M12 sum was transcribed as 13.25 hours against validated headlines totalling 815 minutes, about 13.6 hours; a separate cross-artifact pass caught it before delivery.
**Recurrence 2026-08-09:** Expanding M03 for a runtime-hook repair added 20 product and 20 proof minutes while the headline split stayed at 140 and 110; strict validation reported counted totals of 160 and 130, and the live estimate was corrected with the original 260-minute baseline kept explicit in Forecast calibration. `src/cli/plans-check.ts` (search: `counted work`).
**Recurrence 2026-08-10:** A release plan used 15 work units and a 12.42-minute high rate, then recorded the high bound as 186 minutes; the deterministic ceiling was 187, and strict validation blocked closeout until the displayed range matched the formula.
**Recurrence 2026-08-14:** Reforecasting three downstream milestones rounded bounds to the nearest integer instead of applying the floor and ceiling rule; strict validation derived `16-42`, `12-32`, and `15-39` against a plan displaying `17-41`, `13-32`, and `15-38`, and the ISSUE roll-up needed recomputation from `45-111` to `43-113`.
**Recurrence 2026-08-17:** M39 multiplied 10 work units by a 1.16-minute low rate but transcribed the range floor as 12; strict validation derived 11 and rejected the plan until both the milestone and the roll-up used `11-72`.
**Recurrence 2026-08-26:** After two milestones were trimmed, the 1.17.0 ISSUE headline was adjusted by subtracting only those deltas from a stale prior total; a fresh exact sum over all 53 milestone files measured `557-2,997` likely `1,368`, not `537-3,331` likely `1,338`. Strict validation still passed because its inventory excludes `ISSUE.md`.

---

## Lesson: A running receipt makes a wrong category split look measured

**Status:** active | **Created:** 2026-08-02
**Decision changed:** Switch the receipt category at the work boundary, not at the milestone boundary; a stale category is a silent data error, not a rounding detail.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 4 | **Latest occurrence:** 2026-08-14

**Prevention:** Switch category when the kind of work changes: entering a proof cycle, returning to implementation, or starting plan bookkeeping each warrant `stop` then `start --category <new>`, and "about to run the test suite, lint, or typecheck" is a proof trigger by definition. Before finalizing, read the segment list; one 1000-second span across a mixed session is the smell. If the split is known-wrong at the gate, disclose it in the human-verification report and treat only the total as trustworthy. Evidence anchors: `src/cli/plans-time.ts` (search: `export function applyPlanTimeTransition`) performs the category change; `src/cli/plans-check.ts` (search: `function collectMeasuredActualErrors`) reconciles Actual against the receipt but cannot detect a mis-tagged category. Related: `.goat-flow/learning-loop/lessons/milestone-accounting.md` (search: `## Lesson: Actual time must come from prospective active-time segments`) covers never starting a receipt at all.

**What happened:** Effort-estimation-timing M02 opened a `product` span and left it open across implementation, a full test run, lint, format, and unused-export checks. The finalized receipt reported 1112 product / 99 proof seconds; the 1354-second total was correct and system-stamped, but most of that "product" time was proof, and the receipt finalized, reconciled, and passed strict validation because the CLI can only stamp the category it was given.

**Root cause:** Starting a receipt feels like the whole discipline, so category maintenance is treated as optional bookkeeping; `stop` then `start` is two commands while doing nothing is zero, and the resulting split carries the authority of a `measured` Actual while being a guess.

**Recurrence 2026-08-04:** The quality-findings milestone left its first `product` span open through focused content tests, both 327-case hook corpora, the interleaved benchmark, and skill contract runs; the split is knowingly inaccurate and excluded from calibration.
**Recurrence 2026-08-09:** M03 left its first `product` span open across goat-debug RED confirmation, delegated pressure runs, and the deployment test matrix, then into goat-critique RED; caught after 1,604 seconds when the user challenged forecast quality.
**Recurrence 2026-08-14:** Code-quality-upstream M03 left one `product` span open across product edits, three evaluator runs, formatting recovery, full-suite diagnosis, and final gates; with no prospective boundaries the span was discarded and Actual recorded as incomplete. `src/cli/plans-time.ts` (search: `receipt contains a discarded open span`).

---

## Lesson: Activate a milestone before starting its timing receipt

**Status:** active | **Created:** 2026-08-14
**Decision changed:** Activate before timing starts, stop before an inactive handoff, never move a pending or terminal milestone backward only to time acceptance administration, and remove the active receipt schema before resetting to `not-started`.
**Trigger phase:** ACT
**Incident count:** 10 | **Latest occurrence:** 2026-09-04

**Prevention:** Change the milestone to `in-progress` or `testing-gate` before checking implementation work or starting the first timing segment, using only the canonical lifecycle vocabulary (`active` is not a status). Confirm exactly one rendered `Status` field, then start the category and inspect the returned open segment; if start is rejected, correct the state and retry prospectively, never backfilling the missed interval. Stop and inspect the open span before changing status to `human-verification-pending`, `blocked`, `abandoned`, or `complete`; once pending, leave later acceptance administration unmeasured. When resetting to `not-started`, reopen every task and proof, preserve closed-segment evidence under Reset history, and remove the active Timing Receipt section. Evidence anchors: `src/cli/plans-time.ts` (search: `Timing Start requires exactly one rendered Status field`) rejects missing, competing, empty, or inactive states; `src/cli/plans-check.ts` (search: `not-started milestone must not include a Timing Receipt`) enforces a clean receipt after reset.

**What happened:** Starting code-quality-upstream M04, `plans time start` ran while the rendered `Status` was still `not-started`; the CLI refused with `Timing Start requires exactly one rendered Status field set to in-progress or testing-gate`, and the retry after the status change succeeded.

**Root cause:** Receipt creation was treated as the transition that made a milestone active, and lifecycle text as though it also normalized timing state; the CLI models them separately.

**Recurrences 2026-08-21, 2026-08-23 (M11), 2026-08-24 (M22), 2026-08-24 (M26):** The same order error, timer before status, on four later activations; each time the guard opened no receipt and the prospective retry after `in-progress` succeeded with no interval backfilled. `src/cli/plans-time.ts` (search: `Timing Start requires exactly one rendered Status field`).
**Recurrence 2026-08-23 (inactive transition):** M08 moved from `in-progress` to `blocked` while its product span stayed open; strict validation rejected the inactive milestone with an active receipt until the span was stopped, leaving a paused 466-second receipt.
**Recurrence 2026-08-24 (reset):** Resetting `windows-native-hooks` M01 to `not-started` while preserving its paused receipt failed `not-started milestone must not include a Timing Receipt`; moving the closed S01 row to Reset history and reopening the checked task passed without erasing measured effort.
**Recurrence 2026-09-03 (M13 activation):** The unsupported status `active` was written first, then M13's frozen-contract task was checked while the milestone still read `not-started`. `src/cli/plans-check.ts` (search: `const VALID_STATUSES`), `src/cli/plans-check.ts` (search: `not-started milestone has checked implementation tasks`).
**Recurrence 2026-09-04 (go-live M15 activation):** Timing started while a go-live milestone was still `not-started`, and later a reopen attempt for release-candidate acceptance after `human-verification-pending` was refused by the same guard; the accepted lifecycle update stays unmeasured instead of moving status backward.

---

## Lesson: Milestone task sections contain estimated work, not evidence notes

**Status:** active | **Created:** 2026-08-07
**Decision changed:** Reserve Tasks for estimated implementation checkboxes and keep each `(est: ...)` entry at the end of its item.
**Trigger phase:** SCOPE
**Caught at:** VERIFY
**Incident count:** 5 | **Latest occurrence:** 2026-08-23

**Prevention:** Keep `## Tasks` to estimated work items. Put section-wide guidance before the first checkbox or under its own heading, never after the final estimated item; put discoveries in `## Context` and literal gate output in `## Actual evidence`; place a completion note before the terminal estimate. Keep `Plan/admin overhead` as the forecast input, keep measured variance outside the fixed Actual receipt reason, and rerun strict validation after closeout edits. Evidence anchors: `src/cli/plans-export.ts` (search: `function readChecklistItems`) converts every task checkbox into an estimate-bearing record; `src/cli/plans-effort.ts` (search: `const TASK_ESTIMATE_PATTERN`) requires the estimate at the item's end; `src/cli/plans-check.ts` (search: `function collectCoverageErrors`) rejects records without estimates.

**What happened:** M05 recorded a completed test-audit result as another checkbox under `## Tasks`; strict validation counted it as implementation work and reported one missing `(est: ...)` entry and a 15/20-minute product mismatch.

**Root cause:** The task section was treated as a narrative checklist, but its checkboxes and terminal `(est: ...)` entries are machine-readable work records feeding estimate coverage and category totals.

**Recurrence 2026-08-08:** M01 completion notes were appended after all four task estimates, so the terminal-estimate parser treated every task as unestimated and reported zero counted product minutes against the declared 60.
**Recurrence 2026-08-14:** A strict sweep of four completed hook-command-portability milestones found completion notes after terminal estimates, forecast-only `Plan/admin overhead` fields overwritten with measured time, and an Actual reason extended beyond its fixed grammar; the malformed items undercounted units and totals although the minutes stayed visible to a human.
**Recurrence 2026-08-23:** Closing abandoned M07 added a zero-minute proof row with explanatory text inside its estimate field; strict validation rejected it as unparseable, one minute still failed because text followed the terminal estimate, and the two-correction rewind removed the redundant row. `src/cli/plans-effort.ts` (search: `TASK_ESTIMATE_PATTERN`), `src/cli/plans-check.ts` (search: `estimate not parseable`).
**Recurrence 2026-08-23 (M08):** A section-wide gate paragraph placed after the final checkbox became part of Task 4, so its `(est: ...)` token was no longer terminal and strict validation reported one missing estimate, 11 product minutes against 14, and 7 work units against 8; moving the paragraph above the first checkbox restored all three counts.

## Lesson: Milestone plans need exporter-contract verification before handoff

**Status:** active | **Created:** 2026-07-17
**Decision changed:** After writing or restructuring `M*.md` files, validate them with the shipped plan exporter before handoff; visual Markdown completeness is insufficient.
**Trigger phase:** VERIFY
**Incident count:** 10 | **Latest occurrence:** 2026-09-05

**Prevention:** Treat the canonical example as an executable consumer fixture. Cover compact and expanded representations through `parseMilestoneMarkdown`, run `goat-flow plans check <plan-directory> --strict`, require exporter records with zero warnings, and resolve every cited path plus exact search string before handoff. Dry-run executable plan commands against disposable inputs, including every directory or file precondition they rely on. Current objective parsing accepts a bold field, an `## Objective` section, or the outcome title; other portable anchors are Status, compact or section Scope, Tasks, Proof, Exit or Exit criteria, and Stop/rescope at H2 or as the compact `- Stop/rescope if ...` line inside Exit. Evidence anchors: `src/cli/plans-export.ts` (search: `readFieldOrSectionMarkdown`), `src/cli/plans-export.ts` (search: `readStopMarkdown`), `test/unit/plans-check.test.ts` (search: `accepts the compact Small rendering in strict mode`).

**What happened:** The 1.15.0 milestone files looked complete and passed a custom heading check, but the first `plans export` preview warned that all 11 records lacked portable objectives and boundary notes: the exporter then accepted only the bold `Objective` field while the files used a level-two section, omitted `Boundary Notes`, and placed CAO incident gates in peer sections the exporter would not include in task bodies.

**Root cause:** The authoring layout was validated instead of the repository's executable consumer contract; a Markdown reader can infer fields that `parseMilestoneMarkdown`, downstream renderers, or plan commands reject.

**Recurrence 2026-07-31:** Compact Scope and Exit forms were absent from the parser, focused tests missed three complexity errors, and the dashboard reused a filename as a malformed objective; expanded coverage keeps the filename only as a row title.
**Recurrence 2026-08-03:** Prose-form `Plan/admin overhead` did not satisfy the required bold field. `src/cli/plans-export.ts` (search: `readMilestoneField(content, "Plan/admin overhead"`).
**Recurrence 2026-08-05:** Strict checking and export exited zero, but supplementary checks found 13 unresolved citations and one nine-word ISSUE item.
**Recurrence 2026-08-15:** A fresh-consumer command omitted the installer's required target directory; `mkdir -p` made it executable. `workflow/install-goat-flow.sh` (search: `is not a directory`).
**Recurrence 2026-08-25:** A draft nested Stop/rescope at H3, then an ad hoc trim broke Forecast range grammar; rewinding to the exact Standard template fixed both.
**Recurrence 2026-09-02:** Reconciliation produced a 220-character problem statement naming `M08`; strict validation rejected both defects, and one 90-character public sentence passed. `src/cli/plans-check-structure.ts` (search: `collectPlainLanguageSectionFindings`).
**Recurrence 2026-09-03:** `plans check` was given the milestone file during M13 closeout; the loader called `readdirSync` on it and returned `ENOTDIR`, and the version directory `.goat-flow/plans/1.17.0-go-live` passed. `src/cli/plans-export.ts` (search: `function listMilestoneFiles`).
**Recurrence 2026-09-05 (ACTUAL_MEASURED):** Duplicate Proof headings and linked ISSUE bands broke author checks. `src/cli/plans-export.ts` (search: `addRepresentationConflict`), `workflow/skills/goat-plan/references/issue-format.md` (search: `## Tasks`).

---

## Lesson: A milestone added to an existing train must be wired into its terminal node and ISSUE bands

**Status:** active | **Created:** 2026-08-23
**Decision changed:** When goat-plan File-Write adds a milestone to a plan directory that already has a terminal release milestone, the same batch adds the new ID to that node's `Depends on` and re-derives the ISSUE task band and totals; a milestone file alone is not "in the plan".
**Trigger phase:** SCOPE
**Caught at:** ACT
**Incident count:** 3 | **Latest occurrence:** 2026-08-25

**Prevention:** When adding a milestone to an existing plan directory, read the terminal node, add the new ID, traverse the graph to re-derive direct and closure counts, then re-derive the ISSUE.md band and "How long" totals before strict validation; a passing per-file check is necessary, not sufficient. Since 2026-08-23 goat-plan's File Artifact Rules state this for existing plans (TDD log `2026-08-23-goat-plan-tdd.md`; partial hardening, one real RED and one GREEN).

**What happened:** M47 was created in the 1.17.0 train with valid structure and a passing strict check, but the terminal node M37, whose `Depends on` closes the release, did not list it; the ISSUE.md band and totals changed only because the user asked separately, and the gap surfaced on a "double check that plan" pass because `plans check` validates each file and the ISSUE arithmetic, not membership in the terminal node. Hours later a parallel session added M48 to the same train, also absent from that node. Both files are gitignored plan files, so no durable anchor exists; the strict check passed before and after the fix.

**Root cause:** goat-plan's File-Write path described creating and validating files in `.goat-flow/plans/<active>/` without saying that an existing train's dependency graph and ISSUE bands are part of the artifact, so "wrote M47" felt complete.

**Recurrence 2026-08-25:** M55 correctly replaced M54 as M37's terminal dependency and updated ISSUE bands, but the dependency note reused stale counts; independent traversal found 28 direct terminals and a 51-milestone closure, not 27 and 50.
