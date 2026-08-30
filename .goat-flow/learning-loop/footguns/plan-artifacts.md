---
category: plan-artifacts
last_reviewed: 2026-08-30
---

**Scope:** The grammar and validation of plan, milestone, and review artifacts - evidence fields, proof gates, machine-parsed dependency links, effort accounting, and when a validator runs relative to persistence. CLI process behaviour and output streams live in [cli.md](cli.md).

## Footgun: Prose after the last checklist row silently strips that row's estimate

**Status:** active | **Created:** 2026-08-15 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Keep machine-parsed checklist sections contiguous, leave `(est: ...)` as each row's final token, and put explanatory prose and tables under their own headings outside the checklist.
**Trigger phase:** SCOPE
**Caught at:** VERIFY
**Incident count:** 5 | **Latest occurrence:** 2026-08-27

**Symptoms:** `plans check --strict` starts failing on a milestone whose checklist was only ticked, with three errors at once: `proof counted work (N min) does not equal the split component`, `N testing gate item(s) missing an (est: ...) entry`, and `forecast basis declares N agent work units but the plan contains N-1`. The arithmetic looks corrupted even though no estimate was edited, and the named item visibly still carries its `(est: ...)`.

**Evidence:** Closing 1.16.0 M01 on 2026-08-15 added a one-paragraph caveat under `## Proof`, after C4, to record that C4's last command had not run clean. `plans check --strict` had exited 0 immediately before, and exited 1 straight after with the three errors above; counted proof work dropped from 8 to 6 minutes. Moving the same sentences into `## Mid-implementation evidence` restored exit 0 with no other change.

**Recurrence 2026-08-16:** Inserting a caller-inventory table between M07 task rows made the remaining task list non-contiguous. Strict validation reported product work dropping from 19 to 12 minutes, one missing estimate, and a forecast basis of eight units against seven parsed units. Moving the unchanged table under a dedicated Context heading restored exit 0. The same item-body boundary in `src/cli/plans-export.ts` (search: `Headings also end an item so nested Testing Gate labels do not swallow its trailing estimate`) governs both prose and tables.

**Recurrence 2026-08-18:** Closing M54 put an ADR-classification result paragraph immediately after the final Tasks checkbox. Strict validation dropped parsed product work from 19 to 17 minutes, reported one missing estimate, and saw only 14 of the forecast's 15 work units. Moving the unchanged result under its own heading restored the final task boundary, its two-minute estimate, and the fifteenth unit. Evidence anchors: `src/cli/plans-export.ts` (search: `Headings also end an item`) and `src/cli/plans-effort.ts` (search: `TASK_ESTIMATE_PATTERN`).

**Recurrence 2026-08-23:** M15 put one indented evidence bullet after every completed P1/C1-C3 row. Strict validation then counted zero proof minutes, reported all four gates as missing estimates, and saw only 8 of 12 forecast work units even though every checklist row still ended in `(est: ...)`. Moving those notes unchanged under `## Verification evidence` restored the checklist boundaries.

**Recurrence 2026-08-27:** While closing M41's MP1 gate, appending a `Satisfied on ...` sentence after the row's `(est: 2 min proof)` suffix made strict validation report the same three-error cluster: proof work fell by two minutes, one mid-proof estimate disappeared, and the forecast lost one work unit. Moving the sentence before the unchanged estimate suffix restored the parsed row. The tracked parser owner is `src/cli/plans-effort.ts` (search: `TASK_ESTIMATE_PATTERN`).

**Why it happens:** An item's body is not one line. `src/cli/plans-export.ts` (search: `Headings also end an item so nested Testing Gate labels do not swallow its trailing estimate`) runs each item from its checkbox to the next checkbox or the next heading, so a paragraph after the last row is absorbed into that row's body. The estimate is then read by `src/cli/plans-effort.ts` (search: `TASK_ESTIMATE_PATTERN`), whose regex is anchored to the end of the body text - the appended prose pushes `(est: ...)` away from that anchor and the item reads as unestimated. One insertion therefore produces three errors, and none of them names prose as the cause. A heading terminates an item, which is why prose under the *next* `##` heading is safe.

**Prevention:** Keep a checklist section to its rows and keep `(est: ...)` as the final token of every estimated row. Do not append completion evidence after that suffix. Caveats, inventories, and tables belong under a dedicated heading outside the parsed checklist; gate evidence belongs under `## Mid-implementation evidence`. This applies to any section `readChecklistItems` parses - tasks, proof, and mid-proof - not to Proof alone. Run `plans check --strict` immediately after editing a milestone's checklist sections; three errors together with unchanged estimates point at absorbed content rather than at arithmetic.

---

## Footgun: Strict validation of a new evidence artifact retroactively fails finished plans

**Status:** active | **Created:** 2026-08-02 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Gate an evidence artifact's shape on whether something claims authority from it, not on its mere presence.
**Trigger phase:** SCOPE
**Caught at:** VERIFY
**Incident count:** 5 | **Latest occurrence:** 2026-08-09

**Symptoms:** A milestone that passed strict validation for weeks starts failing after an unrelated release. The errors name an artifact the milestone does not depend on - here, five `timing receipt ... inconsistent` errors on a completed milestone whose Actual is `retrospective` and cites no receipt at all. Separately, a seven-cell timing row was silently skipped and a receipt containing `S01` plus `S03` allocated `S03` again because the writer used row count as identity authority. In a later change, the receipt parser correctly diagnosed a summary on an active receipt, but strict checking first exited 0 because the new message did not begin with the classifier's `timing receipt` prefix. After that prefix was corrected, paused and incomplete receipts still exited 0 because general receipt warnings become fatal only for a live clock or claimed Actual. Each failure surfaced late because parser behavior was not verified through every policy-owning consumer state.

**Recurrence (2026-08-09):** A hand-finalized receipt closed every segment and changed its state but omitted `Recorded seconds` and `Allocated minutes`. Strict checking rejected the measured Actual because the state label alone cannot prove its totals. Use the canonical finalize transition or include its complete summary shape. Evidence anchors: `src/cli/plans-time-receipt.ts` (search: `finalized timing receipt requires a summary`) and `src/cli/plans-check.ts` (search: `measured Actual requires a finalized embedded Timing Receipt`).

**Why it happens:** `src/cli/plans-time-receipt.ts` (search: `export function parseTimingReceiptMarkdown`) defines a receipt grammar requiring a `State` column and a `**Receipt state:**` header. Hand-written receipts predating the CLI used a free-text `Work` column instead. `src/cli/plans-check.ts` (search: `function isValidationWarning`) classifies receipt diagnostics with `warning.startsWith("timing receipt")`; message text is therefore part of the routing contract, not presentation alone. That classifier previously promoted every matching warning to a strict error regardless of whether any Actual cited the receipt. On the live workflow path, `readTimingDataColumns` treated a table-shaped wrong-width row as unrelated prose, and `nextSegmentId` derived identity from `segments.length` instead of the highest canonical suffix.

**Safe handling now:**
1. Before shipping validation for a new artifact, run the checker across *every* existing plan directory, not just the one the feature was built in.
2. Make the artifact's shape fatal only when a claim or live workflow depends on it - `src/cli/plans-check.ts` (search: `const receiptIsActive`) gates receipt warnings on a `measured` Actual or an active clock, while malformed unclaimed historical receipts stay advisory.
3. Keep the claimed path failing twice over: shape validation plus reconciliation, so relaxing the unclaimed case cannot weaken the claimed one.
4. Treat "this artifact is decorative here" as a first-class state rather than forcing migration of finished work.
5. Once a receipt is live or claimed, reject every table-shaped row that does not match the canonical width and allocate new identifiers after the highest canonical suffix, not after the row count. Regression anchors: `test/unit/plans-time.test.ts` (search: `rejects timing table rows with extra cells`) and (search: `allocates a new segment after the highest existing suffix`).
6. When adding a parser warning, inspect every consumer that classifies warning text and verify the public command path across each relevant receipt state. Keep receipt diagnostics under the stable `timing receipt` prefix until routing uses structured codes, and promote inherently invalid authority such as a non-final summary independently of the live-or-claimed compatibility exception. Regression anchor: `test/unit/plans-check-lifecycle.test.ts` (search: `const staleSummaryCases`).

---

## Footgun: Markdown proof gates can promote hidden examples into authority

**Status:** active | **Created:** 2026-08-03 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Validate structural evidence against rendered Markdown semantics and exact documented field values, then pair every exclusion fixture with a visible-content control.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 7 | **Latest occurrence:** 2026-08-07

**Symptoms:** A review report containing every required field inside a raw `<pre>` block passed validation. A balanced inline-code span containing the literal `<!--` token, and later a visible backslash-escaped `\<!--` opener, entered comment state and hid subsequent fields. The first multiline fix still lost state when one continuation line closed a code span and opened another, so a comment marker on the following line hid the rest of the report. A complete custom tag such as `<x-review>` also opened a blank-terminated raw HTML block under CommonMark type 7, but the masker left its hidden fields authoritative. Four source spaces after a blank line under `- context` were later mistaken for top-level indented code, suppressing a visible `TODO` list continuation. Separately, the compact Review Integrity grammar accepted `risk-depth-declined` in its degradation slot while returning `isRiskDepthDeclined: false`, so a degraded review could claim a stronger conclusion and verdict.

**Why it happens:** `src/cli/rendered-markdown.ts` (search: `export function maskNonRenderedMarkdown`) is a source-aligned Markdown masker rather than a complete Markdown parser; every omitted exclusion form can accidentally grant hidden examples structural authority or suppress visible evidence. `src/cli/review-validate-common.ts` (search: `const COMPACT_INTEGRITY`) compounded that risk by accepting any non-empty degradation text even though the documented compact form permits only `no degradation flags`.

**Safe handling now:**
1. Add paired regressions for every Markdown exclusion change: hidden headings and fields must stay hidden, while visible structure immediately after the construct must retain its original offset. Include complete custom tags that open CommonMark type-7 blocks and a control proving they do not interrupt a paragraph.
2. Treat comment markers inside balanced inline-code spans and backslash-escaped openers as visible code, but keep real comments masked. Carry delimiter state across source lines, including a continuation line that closes one span and opens another. Test odd and even backslash parity so the exception cannot swallow comments. Evidence anchors: `test/unit/plans-export.test.ts` (search: `keeps backslash-escaped HTML comment openers visible`) and (search: `tracks a new multiline code span after closing one on the same line`).
3. Compare indentation relative to the active list marker before classifying an indented leaf block. Pair the four-space visible continuation with a six-space nested-code control. Evidence anchor: `test/unit/plans-export.test.ts` (search: `preserves visible list continuations while masking nested list code`).
4. Match compact proof receipts to their canonical documented values. Do not accept arbitrary text and then hardcode the corresponding semantic state.
5. Re-run both the shared masker tests and the consuming proof-gate tests. Evidence anchors: `test/unit/plans-export.test.ts` (search: `masks type-7 custom-tag blocks without hiding later visible structure`) and `test/unit/review-validate.test.ts` (search: `rejects structural review evidence inside a type-7 HTML block`).

---

## Footgun: goat-review report grammar fails only at validate time, after the ledger is already persisted

**Status:** active | **Created:** 2026-08-11 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Draft the Review Integrity block and refutation ledger against the validator's field grammar before redacting them to disk, because a rejected ledger has to be rewritten, re-redacted, and re-persisted under a new random path.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 3 | **Latest occurrence:** 2026-08-29

**Symptoms:** `goat-flow review validate` exits 1 on a finished review whose content is correct. Three rules produced it in one session: a refutation ledger record was rejected for not matching the one-line grammar, the `Verdicts:` counts were rejected as inconsistent with the findings list, and a scope-snapshot value was rejected despite naming every required field.

**Why it happens:** The ledger record grammar in `src/cli/review-validate-common.ts` splits on `|`, so any suspicion or evidence text containing a literal pipe creates extra fields and fails the record. Reviewing shell code is exactly when a reviewer writes `curl|bash` or `curl|tar` into a record, so the collision is most likely on the material the grammar is most needed for. Two adjacent rules compound it. Every ledger line is parsed as a record, so a human-readable title line above the records fails as record 1. The `Verdicts: <c>/<a>/<r>/<u>` line is cross-checked against the visible findings, so counting a suspicion that stayed unresolved without becoming a finding makes the integrity block contradict the report. All three surface only at the final Proof Gate, after the ledger has been written through the redactor.

**Evidence:** Measured 2026-08-11 while reviewing PR #58. First run: `review validate: FAIL (3 violations)` covering `V5/integrity-format` twice and `V8/refutation-ledger` once. Rewriting pipe-bearing prose as `curl-into-bash`, dropping the ledger title line, reconciling `Verdicts: 5/0/13/0` with five findings, and replacing a bare filename anchor with its repository-relative path produced `review validate: PASS`. The bare-filename anchor also failed as `V1/anchor-unresolved` because anchors are resolved against the declared head OID. The ledger grammar is defined in `src/cli/review-validate-common.ts` (search: "REFUTATION_LEDGER_RECORD").

**Recurrence 2026-08-27:** A staged merge review counted ten refutations and two pre-existing pointers in `Evidence: 13 OBSERVED / 0 INFERRED`, although only one visible finding carried an evidence tag. `goat-flow review validate` exited 1 with `V5/integrity-format`; changing the line to `1 OBSERVED / 0 INFERRED` produced `review validate: PASS`. The refutation ledger had already been persisted, reproducing the ordering trap even though its own grammar was valid. Evidence anchor: `src/cli/review-validate-sections.ts` (search: "validateIntegrityCounts").

**Recurrence 2026-08-29:** An area-audit report was redacted to disk before validation. Its first validation found one finding without evidence and proof tags, an evidence total that counted a refutation, and a verdict total that counted a suspicion without a visible finding. A fresh redacted report added the tags, reconciled both totals to visible findings, and produced `review validate: PASS`. Evidence anchors: `src/cli/review-validate-anchors.ts` (search: "finding is missing Evidence") and `src/cli/review-validate-sections.ts` (search: "validateIntegrityCounts").

**Prevention:**
1. Write pipeline examples in ledger records as prose (`curl into bash`) or a fenced form the grammar does not split. Reserve `|` for the field separator.
2. Start the ledger file at the first record. Put provenance in the report's Review Integrity line, which already names the ledger path.
3. Keep `Verdicts:` consistent with the findings list: confirmed, adjusted, and unresolved together must equal the visible findings. Record a suspicion that was neither confirmed nor turned into a finding in the automated-review provenance line instead.
4. Use repository-relative paths in every anchor. A bare filename cannot be read from the declared head OID even when it is unambiguous in the working tree.
5. Run the validator against a draft before persisting durable artifacts, so a grammar failure costs an edit rather than a redact-and-repersist cycle.

---

## Footgun: Re-homing a milestone breaks the machine-parsed `Depends on` field

**Status:** active | **Created:** 2026-08-07 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Cross-train dependency pointers go in a separate `**Dependency note:**` line, never in `**Depends on:**`.
**Trigger phase:** SCOPE
**Caught at:** VERIFY

**Symptoms:** Moving a milestone between plan directories and repointing the trains that referenced it makes `plans check <dir> --strict` exit 1 with `dependencies must be \`none\` or comma-separated local milestone IDs`. Measured 2026-08-07 while pulling `1.21.0/M05` and `1.30.0/M09` into `1.16.0`: 1.21.0 was strict-clean beforehand and the only two failures were the two dependency lines just edited. The natural edit - replacing `M05` with the moved file's path, or appending a parenthetical explaining the move - is exactly what breaks it.

**Why it happens:** `src/cli/plans-check-structure.ts` (search: `function readDependencies`) accepts only the literal `none` or `/^M\d+(?:\s*,\s*M\d+)*$/`. It is a dependency-graph input, not prose - cycle detection walks it. Anything human-readable in that field, including a path, a parenthetical rationale, or `and shipped ...`, fails the regex and the milestone contributes no edges to the graph. Two adjacent gates fire from the same edit: declaring `**Effort estimate:**` on an older-format milestone obliges an `(est: ...)` entry on every task and testing-gate item that reconciles to the split, and adding a `## Scope ...` heading beside an existing `## Scope Discipline` trips `conflicting scope representations`.

**Safe handling now:**
1. Keep `**Depends on:**` machine-parseable (`none` or local `Mnn` IDs only). Put the moved-from path, rationale, and cross-train ordering in a following `**Dependency note:**` line.
2. Re-run `plans check --strict` on the destination *and* every source train after a move. A source train that was clean is the regression signal; a train already failing for unrelated reasons (1.30.0 lacks effort estimates throughout) needs an error-count comparison, not a pass/fail read.
3. Leave a pull-forward note at the top of the source `ISSUE.md`/`README.md` - the established convention - so surviving bare `Mnn` labels in that train still resolve.
4. Adding an effort estimate to an older Archetype-format milestone is not a one-line edit; budget for per-task and per-testing-gate `(est: ...)` entries that sum to the declared split.

---

## Footgun: A partial reforecast fails strict validation, and integer estimates cannot express sub-minute unit rates

**Status:** active | **Created:** 2026-08-19 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Reforecast every estimate line together, and when the local likely rate implies fewer minutes than there are work units, keep the planning-time basis and record the local figure in prose.
**Trigger phase:** SCOPE
**Caught at:** VERIFY
**Incident count:** 8 | **Latest occurrence:** 2026-08-28

**Prevention:** Treat a reforecast as one atomic edit to basis, range, headline, split, and every `(est: ...)` entry, then run strict validation before starting the timing receipt. Preserve planning-time estimates when the likely rate implies fewer minutes than positive integer work items can express. Derive bounds with floor/nearest/ceiling, and never rescale an in-progress or completed milestone to newer calibration data.

**Symptoms:** `plans check --strict` printed `reforecast required: ... use 0.61-0.93-1.04 min/unit before implementation` (advisory, exit 0). Updating only `**Forecast basis:**` and `**Forecast range:**` to those rates - a handoff note said to update "the Forecast basis/range lines" - flipped the plan to exit 1: `forecast range likely (8 min) must equal the Effort estimate total (22 min)`. Measured 2026-08-19 on `.goat-flow/plans/1.16.0-golive` M04 (9 units) and M05 (8 units).

**Root-cause summary:** The validator ties one forecast across canonical grammar, derived rounding, the headline and category split, and every positive integer work-item estimate. Editing only part of that graph makes the artifact internally contradictory.

**Incident ledger:**

- **Recurrence 2026-08-23 (M10 grammar):** A descriptive basis omitted the canonical semicolon-delimited shape; strict validation reported `forecast basis is not parseable`. Rewriting all forecast fields with `src/cli/plans-effort.ts` (search: `FORECAST_BASIS_PATTERN`) restored exit 0.
- **Recurrence 2026-08-23 (M11 split):** The headline and product split rose to 21/15 while product tasks still totaled 14; strict validation reported the counted-work mismatch. Assigning the missing minute to the fixed-evaluation task reconciled the pre-work forecast.
- **Recurrence 2026-08-23 (M13 split):** The headline and product split rose to 21/15 while product tasks still totaled 14. Keeping task totals intact and changing plan/admin overhead from 2 to 3 reconciled the forecast before implementation.
- **Recurrence 2026-08-23 (M21 grammar and split):** The basis omitted `source:` and product tasks exceeded the split by one minute. Restoring canonical grammar and changing the clean-fixture task from 3 to 2 preserved the pre-work 22-minute forecast.
- **Recurrence 2026-08-24 (M24 rounding):** Intuitive rounding produced a low bound of 5 where the validator floors `6 x 0.80` to 4. Using `src/cli/plans-effort.ts` (search: `deriveForecastRangeFromBasis`) restored exit 0.
- **Recurrence 2026-08-26 (M55 units and range):** The basis declared 14 units for 16 counted items and a mismatched high bound. Declaring 16 units and deriving `12-122` at likely 42 reconciled the headline, split, and item estimates; `src/cli/plans-effort.ts` (search: `forecast basis declares`) owns the unit check.
- **Recurrence 2026-08-28 (M57 headline):** Activation changed the derived likely value and range to 36 minutes but left `Effort estimate` at 34. Strict validation exited 1 with `forecast range likely (36 min) must equal the Effort estimate total (34 min)`; updating headline, split, and item estimates together restored exit 0 before implementation. Evidence anchor: `src/cli/plans-check.ts` (search: `must equal the Effort estimate total`).

**Why it happens:** `src/cli/plans-check-summary.ts` (search: `renderRequiredReforecasts`) advises the new rates, but `src/cli/plans-effort.ts` (search: `forecast basis derives`) requires the range to be derived from the basis, `src/cli/plans-check.ts` (search: `must equal the Effort estimate total`) requires the `**Effort estimate:**` headline to equal the range's likely, and that headline is the sum of the per-item `(est: n min category)` entries whose grammar is integer-only (`plans-effort.ts`, search: `TASK_ESTIMATE_PATTERN`). With a likely rate under 1 min/unit, round(units × rate) is below the unit count and N positive integer items cannot sum to fewer than N minutes, so the strict shape is unsatisfiable rather than merely tedious. `.claude/skills/goat-plan/references/milestone-examples.md` (search: `Reforecast all estimates`) already says "all"; the partial edit ignored it.

---

## Footgun: An approved scope can name a file whose size budget cannot accept one more line

**Status:** active | **Created:** 2026-08-30 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Measure every file a milestone names as the owner of added cases against its configured size gate during planning, and record the headroom, before that scope is approved alongside a no-new-files constraint.
**Trigger phase:** SCOPE
**Caught at:** VERIFY

**Prevention:** When a Scope names an existing file as the owner of new cases, measure that file against each configured size gate before approving the plan and write the headroom into the milestone. Zero or unknown headroom means the plan must authorise a split up front or name a different owner. Measure by writing the base blob to a disposable ignored path and bisecting appended substantive lines; raw line count is not the metric the gate uses. Do not discover the conflict after the code is written, and never resolve it by suppressing or retuning the rule.

**Symptoms:** A milestone implements exactly what its Scope names, then the required post-edit analyzer run reports a new error-severity size finding on that same named file. Both constraints are approved and cannot both be satisfied, so implementation stops for a human gate after the work already exists.

**Why it happens:** Size gates count substantive lines, not raw lines, so a file can sit precisely on its threshold while looking well short of it. `.gruff-ts.yaml` (search: `size.file-length`) configures `threshold: 1000` at `severity: error`, and the rule reports the measured figure only once it fires - a compliant file returns no finding and therefore no headroom reading. Planning that names an owner file has no signal short of measuring it.

**Evidence:** Measured 2026-08-30 at `cd676a8e069c72e4515eec0ce5c87d221e8b1a5c` while implementing 1.17.0 M74. `test/unit/quality-report-contract.test.ts` was 1,140 raw lines and reported no finding; the HEAD blob written to a disposable ignored path and bisected showed a single appended substantive line trips the rule, placing the file at exactly 1,000 substantive lines. M74's Scope named that file as the owner of three new RED cases while also stating "No new source or test file", so the milestone stopped and the user approved splitting the file into `test/unit/quality-report-contract-audit.test.ts`. Anchors: `.gruff-ts.yaml` (search: `size.file-length`) and `test/unit/quality-report-contract-audit.test.ts` (search: `quality report contract: audit evidence`).

**Recurrence 2026-08-30 (same milestone, second trip):** After the first split, removing two dead type-level guards from the production helper exposed
that the same file's audit fixture omitted a required field. Repairing the fixture cost 14 substantive lines and put the file back to 1,014. A file
resolved to exactly its threshold has no margin for the follow-on edits its own fix requires, so plan a split to land clearly under the gate rather
than just below it. Evidence anchor: `src/cli/prompt/compose-quality-common.ts` (search: `appendHookCoverageSummary`).

---

## Resolved Entries

## Footgun: Structured Actual cannot represent uninstrumented time

**Status:** resolved | **Created:** 2026-08-02 | **Evidence:** OBSERVED
**Decision changed:** Instrument timing before work; if timing is missing, declare the honest state instead of manufacturing precision.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Symptoms:** A completed or `human-verification-pending` milestone had to contain a numeric Actual total and product/proof/other split even when no clock was started. `_`, `unknown`, or an explanation without a number failed strict validation. An agent under completion pressure could therefore turn task estimates into a precise-looking Actual value with no elapsed-time evidence.

**Why it happened:** `src/cli/plans-check.ts` (search: `function collectActualErrors`) made numeric Actual mandatory at the human gate. `src/cli/plans-effort.ts` (search: `ACTUAL_PATTERN`) accepted only numeric minutes and an optional numeric split, with no measurement-provenance or unknown state.

**Resolved by:** `src/cli/plans-effort.ts` (search: `ACTUAL_UNKNOWN_STATE_PATTERN`) now parses four Actual states - `measured`, `retrospective`, `unavailable`, `incomplete`. `src/cli/plans-time.ts` (search: `export function applyPlanTimeTransition`) system-stamps UTC/epoch spans into a `## Timing Receipt` inside the milestone, and `measured` requires a finalized internally consistent receipt. Untagged legacy numerics classify as `retrospective` rather than silently becoming measured. Verified 2026-08-02: a `complete` milestone carrying `Actual: unavailable: no clock was started for this milestone` passes `plans check --strict` at exit 0.

**Safe handling now:**
1. `goat-flow plans time start <milestone-file> --category <product|proof|other>` before work; `stop` before every human wait; `stop --finalize` at the gate.
2. Let the receipt supply raw seconds; the rounded structured Actual is derived, never hand-written.
3. If prospective timing was missed, declare `unavailable:` or `incomplete:` with a reason - never back-calculate from planned estimates.
4. Treat estimate accuracy and Actual accuracy as separate claims.
