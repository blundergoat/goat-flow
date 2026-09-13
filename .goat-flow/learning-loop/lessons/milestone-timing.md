---
category: milestone-timing
last_reviewed: 2026-09-13
---

**Scope:** Milestone timing receipts - prospective measurement, category changes, activation and finalization. Plan state, estimates and release accounting are in [milestone-accounting.md](milestone-accounting.md).

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

**Recurrences 2026-08-10, 2026-08-17, 2026-08-24, 2026-08-30 (span open across a yield):** Four milestones left a span open while control was elsewhere, and each had to be discarded rather than corrected by subtracting an inferred idle duration. A hook-coverage receipt stayed open overnight across approval pauses. M39 stayed open across a human approval wait. M22 stayed open across an inactive gap until a normal stop counted 30,762 seconds, where restoring the last pre-stop state and using `--discard-open` preserved the valid 933. M74 stayed open across three backgrounded verification runs, so about twenty minutes of suite and preflight wall-clock shared one span with reading and reconciliation, and the same flag preserved 3,038 seconds. A human gate, an inactive gap, and a backgrounded command are all yields: stop before yielding. `src/cli/plans-time.ts` (search: `receipt contains a discarded open span`).
**Recurrences 2026-08-23 and 2026-08-28 (finalized before the gates):** M07 finalized a 465-second receipt before strict validation and learning-loop closeout, and strict validation then rejected an added proof row twice. M58 finalized a 2,529-second receipt before the plan-wide check found it and M37 simultaneously active. Both receipts exclude the correction and index work that followed, so both label Actual incomplete. `src/cli/plans-check-structure.ts` (search: `multiple active milestones`).
**Recurrence 2026-08-10 (file path):** `plans time stop` was given a display identifier instead of the milestone-file path and rejected it. `src/cli/plans-time.ts` (search: `requires an M*.md milestone file`).
**Recurrence 2026-08-17 (grammar):** Abandoned M40's Actual read `unavailable - timing was never started`; strict validation rejected the separator until the canonical `unavailable: timing was never started` form. `test/unit/plans-effort.test.ts` (search: `unavailable: timing was never started`), `test/unit/plans-export-parsing.test.ts` (search: `rejects Start with`).

---

## Lesson: A running receipt makes a wrong category split look measured

**Status:** active | **Created:** 2026-08-02 | **Evidence:** OBSERVED
**Decision changed:** Switch category at each work boundary; correct timestamps cannot make an inaccurate category split measured evidence.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 5 | **Latest occurrence:** 2026-09-07

**Prevention:** On entering evaluation, tests, lint or typecheck, stop the implementation span and start `--category proof`; switch again for implementation or bookkeeping. Before finalizing, compare segment boundaries with the recorded actions. If a category split is wrong and cannot be recovered honestly, preserve timestamps and elapsed totals, disclose the limitation and use `Actual: unavailable`. Never invent a retrospective split to keep a sample eligible. Excluding an invalid sample protects calibration; a structurally valid receipt cannot prove its category reflects the work.

**What happened:** Effort-estimation-timing M02 left a product span open through implementation and verification. Its finalized record reported 1112 product / 99 proof seconds within a correct 1354-second total. Strict validation accepted the internally consistent categories, although much of the product span contained proof.

**Root cause:** The timer stamps the selected category; it cannot infer what work occurred inside the span.

**Recurrences 2026-08-04, 2026-08-09, 2026-08-14:** The quality-findings milestone left tests, hook corpora, benchmarks and contracts under product; its split was excluded from calibration. M03 covered debug evaluations and proof until challenged after 1,604 seconds. Code-quality-upstream M03 mixed edits and verification without recoverable boundaries, so its span was discarded and Actual marked incomplete. The discarded-span path is in `src/cli/plans-time.ts` (search: `receipt contains a discarded open span`).

**Recurrence 2026-09-07:** M29, M32 and M33 recorded 999, 342 and 94 seconds entirely as product despite verification. Their corrected records preserve elapsed totals and timestamps but exclude unavailable category allocations from measured calibration.

**Evidence:** `src/cli/plans-time.ts` (search: `export function applyPlanTimeTransition`) owns category transitions; `src/cli/plans-check.ts` (search: `function collectMeasuredActualErrors`) checks receipt arithmetic; `src/cli/plans-check-summary.ts` (search: `function readCalibrationSample`) excludes non-measured Actuals. Missing timers are covered by `.goat-flow/learning-loop/lessons/milestone-timing.md` (search: `## Lesson: Actual time must come from prospective active-time segments`).

---

## Lesson: Activate a milestone before starting its timing receipt

**Status:** active | **Created:** 2026-08-14
**Decision changed:** Activate before timing starts, stop before an inactive handoff, never move a pending or terminal milestone backward only to time acceptance administration, and remove the active receipt schema before resetting to `not-started`.
**Trigger phase:** ACT
**Incident count:** 11 | **Latest occurrence:** 2026-09-06

**Prevention:** Change the milestone to `in-progress` or `testing-gate` before checking implementation work or starting the first timing segment, using only the canonical lifecycle vocabulary (`active` is not a status). Confirm exactly one rendered `Status` field, then start the category and inspect the returned open segment; if start is rejected, correct the state and retry prospectively, never backfilling the missed interval. Stop and inspect the open span before changing status to `human-verification-pending`, `blocked`, `abandoned`, or `complete`; once pending, leave later acceptance administration unmeasured. When resetting to `not-started`, reopen every task and proof, preserve closed-segment evidence under Reset history, and remove the active Timing Receipt section. Evidence anchors: `src/cli/plans-time.ts` (search: `Timing Start requires exactly one rendered Status field`) rejects missing, competing, empty, or inactive states; `src/cli/plans-check.ts` (search: `not-started milestone must not include a Timing Receipt`) enforces a clean receipt after reset.

**What happened:** Starting code-quality-upstream M04, `plans time start` ran while the rendered `Status` was still `not-started`; the CLI refused with `Timing Start requires exactly one rendered Status field set to in-progress or testing-gate`, and the retry after the status change succeeded.

**Root cause:** Receipt creation was treated as the transition that made a milestone active, and lifecycle text as though it also normalized timing state; the CLI models them separately.

**Recurrences 2026-08-21, 2026-08-23 (M11), 2026-08-24 (M22), 2026-08-24 (M26):** The same order error, timer before status, on four later activations; each time the guard opened no receipt and the prospective retry after `in-progress` succeeded with no interval backfilled. `src/cli/plans-time.ts` (search: `Timing Start requires exactly one rendered Status field`).
**Recurrence 2026-08-23 (inactive transition):** M08 moved from `in-progress` to `blocked` while its product span stayed open; strict validation rejected the inactive milestone with an active receipt until the span was stopped, leaving a paused 466-second receipt.
**Recurrence 2026-08-24 (reset):** Resetting `windows-native-hooks` M01 to `not-started` while preserving its paused receipt failed `not-started milestone must not include a Timing Receipt`; moving the closed S01 row to Reset history and reopening the checked task passed without erasing measured effort.
**Recurrence 2026-09-03 (M13 activation):** The unsupported status `active` was written first, then M13's frozen-contract task was checked while the milestone still read `not-started`. `src/cli/plans-check.ts` (search: `const VALID_STATUSES`), `src/cli/plans-check.ts` (search: `not-started milestone has checked implementation tasks`).
**Recurrence 2026-09-04 (go-live M15 activation):** Timing started while a go-live milestone was still `not-started`, and later a reopen attempt for release-candidate acceptance after `human-verification-pending` was refused by the same guard; the accepted lifecycle update stays unmeasured instead of moving status backward.

**Recurrence 2026-09-06 (go-live M23 proposal label):** A narrative `Status:` label created a second rendered lifecycle field. Timing start refused the file until the narrative used `Proposal state:`. Keep reserved field names out of handoff prose; the forty-second gap stayed unmeasured. `src/cli/plans-time.ts` (search: `Timing Start requires exactly one rendered Status field`) retains the refusal.

---

## Lesson: Finalized timing receipts require their parsed summaries

**Status:** active | **Created:** 2026-08-14 | **Evidence:** OBSERVED
**Decision changed:** Finalize milestone timing through the plans-time command; when repairing a receipt manually, reconcile both summary lines before claiming measured Actual.
**Trigger phase:** VERIFY
**Incident count:** 2 | **Latest occurrence:** 2026-09-08
**Merged:** 2026-09-05 - moved here from `.goat-flow/learning-loop/lessons/verification.md`; timing receipts sit with the three sibling entries above rather than in general verification discipline.

**Prevention:** Use `plans time stop <milestone> --finalize` for normal closure. For manual recovery, restore both summaries, derive the largest-remainder split, then validate the terminal status. Unknown Actual uses `unavailable: reason` or `incomplete: reason`, never the CLI display dash. Evidence anchors: `docs/cli.md` (search: `plans time stop .goat-flow/plans/<active>/M01-example.md --finalize`), `src/cli/plans-time-receipt.ts` (search: `Compare rounded total, category sum, and largest-remainder allocation`), `src/cli/plans-check.ts` (search: `measured Actual requires a finalized embedded Timing Receipt`).

**What happened:** A milestone's segment table, receipt state, and measured Actual were finalized by hand, but the first strict completion check rejected them because the receipt omitted the `Recorded seconds` and `Allocated minutes` lines, leaving the parser no summary object to validate the Actual claim against. After those lines were added, the next check rejected a manually rounded category split that did not follow the canonical largest-remainder allocation.

**Root cause:** The visible segment arithmetic was treated as the whole embedded receipt and category minutes were rounded by intuition, although the strict checker requires both canonical parsed summaries and its deterministic allocation.

**Recurrence 2026-09-08:** M35 used the display dash in an unavailable Actual; strict parsing failed until the colon was restored. Source grammar: `src/cli/plans-effort.ts` (search: `ACTUAL_UNKNOWN_STATE_PATTERN`).

---
