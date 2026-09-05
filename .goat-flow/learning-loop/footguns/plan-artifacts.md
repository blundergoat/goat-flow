---
category: plan-artifacts
last_reviewed: 2026-09-05
---

**Scope:** The grammar and validation of plan, milestone, and review artifacts: evidence fields, proof gates, machine-parsed dependency links, effort accounting, and when a validator runs relative to persistence. CLI process behaviour and output streams live in [cli.md](cli.md).

## Footgun: Prose after the last checklist row silently strips that row's estimate

**Status:** active | **Created:** 2026-08-15 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Keep machine-parsed checklist sections contiguous, leave `(est: ...)` as each row's final token, and put explanatory prose and tables under their own headings outside the checklist.
**Trigger phase:** SCOPE
**Caught at:** VERIFY
**Incident count:** 6 | **Latest occurrence:** 2026-08-30

**Prevention:** Keep a checklist section to its rows, with `(est: ...)` as the final token of every estimated row, and never append completion evidence after that suffix. Caveats, inventories, and tables go under a dedicated heading outside the parsed checklist; gate evidence goes under `## Mid-implementation evidence`. This applies to every section `readChecklistItems` parses: tasks, proof, and mid-proof. Run `plans check --strict` immediately after editing checklist sections; three errors together with unchanged estimates point at absorbed content, not arithmetic.

**Symptoms:** `plans check --strict` fails on a milestone whose checklist was only ticked, with three errors at once: `proof counted work (N min) does not equal the split component`, `N testing gate item(s) missing an (est: ...) entry`, and `forecast basis declares N agent work units but the plan contains N-1`. The named item visibly still carries its `(est: ...)`.

**Why it happens:** `src/cli/plans-export.ts` (search: `Headings also end an item so nested Testing Gate labels do not swallow its trailing estimate`) runs each item from its checkbox to the next checkbox or heading, so prose after the last row is absorbed into that row's body. `src/cli/plans-effort.ts` (search: `TASK_ESTIMATE_PATTERN`) anchors the estimate regex to the end of the body, so the appended prose pushes `(est: ...)` off the anchor and one insertion yields three errors that never name prose as the cause. A heading terminates an item, which is why prose under the next `##` is safe.

**Incident ledger:** each case exited 0 before the insertion and 1 after, and moving the unchanged text under its own heading restored exit 0.
- **2026-08-15 (M01):** a one-paragraph caveat under `## Proof` after C4; proof work dropped from 8 to 6 minutes.
- **Recurrence 2026-08-16 (M07):** a caller-inventory table between task rows; product work 19 to 12, eight forecast units against seven parsed.
- **Recurrence 2026-08-18 (M54):** an ADR-classification paragraph after the final Tasks checkbox; product work 19 to 17, 14 of 15 units.
- **Recurrence 2026-08-23 (M15):** one indented evidence bullet after each completed P1/C1-C3 row; zero proof minutes, four gates without estimates, 8 of 12 units.
- **Recurrence 2026-08-27 (M41):** a `Satisfied on ...` sentence after `(est: 2 min proof)`; moving it before the suffix restored the row.
- **Recurrence 2026-08-30 (M37):** two checkpoint paragraphs after the sole mid-proof row; proof work 5 to 3, 11 of 12 units.

---

## Footgun: Strict validation of a new evidence artifact retroactively fails finished plans

**Status:** active | **Created:** 2026-08-02 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Gate an evidence artifact's shape on whether something claims authority from it, not on its mere presence.
**Trigger phase:** SCOPE
**Caught at:** VERIFY
**Incident count:** 5 | **Latest occurrence:** 2026-08-09

**Prevention:**
1. Before shipping validation for a new artifact, run the checker across every existing plan directory, not only the one the feature was built in.
2. Make the artifact's shape fatal only when a claim or live workflow depends on it: `src/cli/plans-check.ts` (search: `const receiptIsActive`) gates receipt warnings on a `measured` Actual or an active clock, while malformed unclaimed historical receipts stay advisory. Keep the claimed path failing twice over, shape plus reconciliation, so relaxing the unclaimed case cannot weaken it.
3. Once a receipt is live or claimed, reject every table-shaped row that does not match the canonical width and allocate new identifiers after the highest canonical suffix, not the row count: `test/unit/plans-time.test.ts` (search: `rejects timing table rows with extra cells`) and (search: `allocates a new segment after the highest existing suffix`).
4. When adding a parser warning, inspect every consumer that classifies warning text and verify the public command across each receipt state. Keep receipt diagnostics under the stable `timing receipt` prefix until routing uses structured codes, and promote inherently invalid authority such as a non-final summary independently of the live-or-claimed exception: `test/unit/plans-check-lifecycle.test.ts` (search: `const staleSummaryCases`).

**Symptoms:** A milestone that passed strict validation for weeks fails after an unrelated release with five `timing receipt ... inconsistent` errors, although its Actual is `retrospective` and cites no receipt. Later variants: a seven-cell timing row was silently skipped and a receipt holding `S01` plus `S03` allocated `S03` again; a receipt-summary diagnostic was ignored because it lacked the `timing receipt` prefix; paused and incomplete receipts still exited 0 because general warnings become fatal only for a live clock or claimed Actual.

**Why it happens:** `src/cli/plans-time-receipt.ts` (search: `export function parseTimingReceiptMarkdown`) requires a `State` column and a `**Receipt state:**` header that hand-written receipts predate. `src/cli/plans-check.ts` (search: `function isValidationWarning`) routes receipt diagnostics by `warning.startsWith("timing receipt")`, so message text is part of the contract, and it once promoted every matching warning regardless of whether any Actual cited the receipt. `readTimingDataColumns` treated a wrong-width table row as prose, and `nextSegmentId` derived identity from `segments.length`.

**Recurrence 2026-08-09:** A hand-finalized receipt closed every segment but omitted `Recorded seconds` and `Allocated minutes`, so strict checking rejected the measured Actual. Use the canonical finalize transition or include the complete summary: `src/cli/plans-time-receipt.ts` (search: `finalized timing receipt requires a summary`) and `src/cli/plans-check.ts` (search: `measured Actual requires a finalized embedded Timing Receipt`).

---

## Footgun: Markdown proof gates can promote hidden examples into authority

**Status:** active | **Created:** 2026-08-03 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Validate structural evidence against rendered Markdown semantics and exact documented field values, then pair every exclusion fixture with a visible-content control.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 11 | **Latest occurrence:** 2026-08-31

**Prevention:**
1. Pair every Markdown exclusion change with two regressions: hidden headings and fields stay hidden, and visible structure immediately after the construct keeps its offset. Cover complete custom tags that open CommonMark type-7 blocks and a control proving they do not interrupt a paragraph.
2. Treat comment markers inside balanced inline-code spans and backslash-escaped openers as visible code while masking real comments. Carry delimiter state across lines, including a line that closes one span and opens another, and test odd and even backslash parity: `test/unit/plans-export.test.ts` (search: `keeps backslash-escaped HTML comment openers visible`) and (search: `tracks a new multiline code span after closing one on the same line`).
3. Compare indentation relative to the active list marker before classifying an indented leaf block: `test/unit/plans-export.test.ts` (search: `preserves visible list continuations while masking nested list code`).
4. Match compact proof receipts to their canonical documented values, enforce every safety invariant in both full and compact shapes, and parse numeric size claims: require `chunking=accepted` above 20 files or 3,000 changed lines, bind the size unit to the Scope snapshot, and bind each file count to the opened-file coverage denominator.
5. Re-run both the shared masker tests and the consuming proof-gate tests: `test/unit/plans-export.test.ts` (search: `masks type-7 custom-tag blocks without hiding later visible structure`) and `test/unit/review-validate.test.ts` (search: `rejects structural review evidence inside a type-7 HTML block`).

**Symptoms:** A review report with every required field inside a raw `<pre>` block passed validation. A balanced inline-code span containing `<!--`, then a visible `\<!--`, entered comment state and hid later fields; a continuation line that closed one code span and opened another lost state; a complete `<x-review>` tag opened a type-7 block whose hidden fields stayed authoritative; four source spaces after a blank line under `- context` were read as top-level indented code and suppressed a visible `TODO`. The compact Review Integrity grammar accepted `risk-depth-declined` while returning `isRiskDepthDeclined: false`.

**Why it happens:** `src/cli/rendered-markdown.ts` (search: `export function maskNonRenderedMarkdown`) is a source-aligned masker, not a full Markdown parser, so every omitted exclusion form can grant hidden examples authority or suppress visible evidence. `src/cli/review-validate-common.ts` (search: `const COMPACT_INTEGRITY`) accepted any non-empty degradation text although the documented compact form permits only `no degradation flags`, and the first chunking repair checked that a terminal state was named without parsing the Size claim.

**Recurrences 2026-08-31, four in one session:** the compact clean-review grammar accepted a 21-file, 4,000-line Scope with no chunking state (`compact oversized report: PASS`), fixed by requiring the Scope line to end in `chunking=no|none|accepted`: `src/cli/review-validate-common.ts` (search: "COMPACT_CLEAN_REVIEW_FIELDS") and `test/unit/review-validate.test.ts` (search: "requires a terminal chunking state in compact clean reviews"). A full report at 21 files and 4,001 lines still passed with `chunking=none` because Size was arbitrary text; both counts are now parsed: `src/cli/review-validate-common.ts` (search: "reviewScopeExceedsChunkLimit") and `test/unit/review-validate.test.ts` (search: "requires accepted chunking when completed scope size exceeds either limit"). A worktree report could relabel 4,001 changed lines as clusters and zero the count; units are now bound to the Scope source: `src/cli/review-validate-integrity.ts` (search: "validateFullSizeUnit") and `test/unit/review-validate.test.ts` (search: "binds full-report size units to diff or area scope"). Size and opened-file coverage were independent, so two scoped files beside `1/1` or `2/1` coverage passed; each file count now binds to the coverage denominator: `src/cli/review-validate-integrity.ts` (search: "validateFullSizeFileCount") and `test/unit/review-validate.test.ts` (search: "binds opened-file coverage to the declared review size").

---

## Footgun: Re-homing a milestone breaks the machine-parsed `Depends on` field

**Status:** active | **Created:** 2026-08-07 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Cross-train dependency pointers go in a separate `**Dependency note:**` line, never in `**Depends on:**`.
**Trigger phase:** SCOPE
**Caught at:** VERIFY

**Prevention:** Keep `**Depends on:**` machine-parseable, `none` or local `Mnn` ids only, with the moved-from path, rationale, and cross-train ordering on a following `**Dependency note:**` line. After a move, re-run `plans check --strict` on the destination and every source train; a train already failing for unrelated reasons needs an error-count comparison, not a pass/fail read. Leave a pull-forward note at the top of the source `ISSUE.md` or `README.md` so surviving bare `Mnn` labels still resolve. Adding an effort estimate to an older Archetype-format milestone also obliges per-task and per-gate `(est: ...)` entries that sum to the declared split.

**Symptoms:** Moving a milestone between plan directories and repointing the trains that referenced it makes `plans check <dir> --strict` exit 1 with `dependencies must be \`none\` or comma-separated local milestone IDs`. Measured 2026-08-07 while pulling `1.21.0/M05` and `1.30.0/M09` into `1.16.0`: 1.21.0 was strict-clean beforehand and its only failures were the two edited dependency lines.

**Why it happens:** `src/cli/plans-check-structure.ts` (search: `function readDependencies`) accepts only `none` or `/^M\d+(?:\s*,\s*M\d+)*$/` because the field feeds cycle detection. A path, a parenthetical, or `and shipped ...` fails the regex and the milestone contributes no edges. Two adjacent gates fire from the same edit: declaring `**Effort estimate:**` on an older-format milestone requires reconciled `(est: ...)` entries, and a `## Scope ...` heading beside `## Scope Discipline` trips `conflicting scope representations`.

---

## Footgun: A partial reforecast fails strict validation, and integer estimates cannot express sub-minute unit rates

**Status:** active | **Created:** 2026-08-19 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Reforecast every estimate line together, and when the local likely rate implies fewer minutes than there are work units, keep the planning-time basis and record the local figure in prose.
**Trigger phase:** SCOPE
**Caught at:** VERIFY
**Incident count:** 8 | **Latest occurrence:** 2026-08-28

**Prevention:** Treat a reforecast as one atomic edit to basis, range, headline, split, and every `(est: ...)` entry, then run strict validation before starting the timing receipt. Preserve planning-time estimates when the likely rate implies fewer minutes than positive integer work items can express. Derive bounds with floor, nearest, and ceiling, and never rescale an in-progress or completed milestone to newer calibration data.

**Symptoms:** `plans check --strict` printed the advisory `reforecast required: ... use 0.61-0.93-1.04 min/unit before implementation`. Updating only `**Forecast basis:**` and `**Forecast range:**`, as a handoff note suggested, flipped the plan to exit 1 with `forecast range likely (8 min) must equal the Effort estimate total (22 min)`. Measured 2026-08-19 on `.goat-flow/plans/1.16.0-golive` M04 (9 units) and M05 (8 units).

**Why it happens:** `src/cli/plans-check-summary.ts` (search: `renderRequiredReforecasts`) advises the new rates, but `src/cli/plans-effort.ts` (search: `forecast basis derives`) requires the range to derive from the basis, `src/cli/plans-check.ts` (search: `must equal the Effort estimate total`) requires the headline to equal the range's likely value, and the headline is the sum of integer-only `(est: n min category)` entries in `src/cli/plans-effort.ts` (search: `TASK_ESTIMATE_PATTERN`). With a likely rate under 1 min/unit, N positive integer items cannot sum below N minutes, so the strict shape is unsatisfiable. `.claude/skills/goat-plan/references/milestone-examples.md` (search: `Reforecast all estimates`) already says "all".

**Incident ledger:**
- **Recurrence 2026-08-23 (M10):** a descriptive basis omitted the canonical semicolon-delimited shape; `forecast basis is not parseable` until rewritten per `src/cli/plans-effort.ts` (search: `FORECAST_BASIS_PATTERN`).
- **Recurrence 2026-08-23 (M11, M13):** headline and product split rose to 21/15 while product tasks totaled 14; one minute was assigned to a task in M11 and to plan/admin overhead in M13.
- **Recurrence 2026-08-23 (M21):** the basis omitted `source:` and product tasks exceeded the split by one minute.
- **Recurrence 2026-08-24 (M24):** intuitive rounding gave a low bound of 5 where the validator floors `6 x 0.80` to 4; `src/cli/plans-effort.ts` (search: `deriveForecastRangeFromBasis`) owns the rounding.
- **Recurrence 2026-08-26 (M55):** the basis declared 14 units for 16 counted items with a mismatched high bound; `src/cli/plans-effort.ts` (search: `forecast basis declares`) owns the unit check.
- **Recurrence 2026-08-28 (M57):** activation moved the derived likely value to 36 minutes while `Effort estimate` stayed at 34, failing `src/cli/plans-check.ts` (search: `must equal the Effort estimate total`).

---

## Footgun: An approved scope can name a file whose size budget cannot accept one more line

**Status:** active | **Created:** 2026-08-30 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Measure every file a milestone names as the owner of added cases against its configured size gate during planning, and record the headroom, before that scope is approved alongside a no-new-files constraint.
**Trigger phase:** SCOPE
**Caught at:** VERIFY

**Prevention:** When a Scope names an existing file as the owner of new cases, measure it against each configured size gate before approving the plan and write the headroom into the milestone; zero or unknown headroom means the plan authorises a split up front or names a different owner. Measure by writing the base blob to a disposable ignored path and bisecting appended substantive lines, because raw line count is not the gate's metric. Plan the split to land clearly under the gate, not just below it, and never resolve the conflict by suppressing or retuning the rule.

**Symptoms:** A milestone implements exactly what its Scope names, and the required post-edit analyzer run reports a new error-severity size finding on that same file. Both constraints are approved and cannot both hold, so implementation stops for a human gate after the work exists.

**Why it happens:** `.gruff-ts.yaml` (search: `size.file-length`) sets `threshold: 1000` at `severity: error` over substantive lines, and a compliant file returns no finding and therefore no headroom reading, so planning has no signal short of measuring.

**Evidence:** Measured 2026-08-30 at `cd676a8e069c72e4515eec0ce5c87d221e8b1a5c` during 1.17.0 M74: `test/unit/quality-report-contract.test.ts` was 1,140 raw lines with no finding, and bisection showed one appended substantive line trips the rule. M74 named that file as owner of three RED cases beside "No new source or test file", so the user approved splitting into `test/unit/quality-report-contract-audit.test.ts` (search: `quality report contract: audit evidence`). A second trip the same day: repairing a fixture the split exposed cost 14 substantive lines and put the file back to 1,014; `src/cli/prompt/compose-quality-common.ts` (search: `appendHookCoverageSummary`).

---

## Footgun: Release boundary approval goes stale when HEAD moves at the human gate

**Status:** active | **Created:** 2026-08-30 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Re-establish HEAD, status, destination contents, and the exact scripted write set after every release boundary wait; obtain fresh approval when any candidate input or path membership changed.
**Trigger phase:** SCOPE
**Caught at:** ACT

**Prevention:** Treat release boundary approval as bound to the recorded commit and candidate inventory, not as a lease over later repository state. On resume, compare HEAD and status with the approved receipt, re-read every manual destination, and rerun the bump preview from the new commit. Preserve work that now satisfies a task; if candidate bytes or write-set membership changed, present the replacement baseline and wait for approval before writing.

**Symptoms:** A release bump with a clean, approved path list resumes against different bytes. Applying the prepared manual patch conflicts with content the user already committed, and a previously previewed bulk writer would attribute its results to the wrong candidate.

**Why it happens:** The human gate and the repository are independent state machines. The user may commit in-scope work while the milestone is paused, but the milestone's recorded HEAD, starting dirty paths, release ledger, and bump preview do not advance with it.

**Evidence:** The user committed the prepared changelog and review fixes during the release boundary wait. Revalidation found replacement HEAD `406eddd0e8ce0de19c385b61520d512b5530037a`, and the planned changelog edit no longer applied because `CHANGELOG.md` (search: `## v1.17.0`) already carried the section. A fresh isolated bump preview at that HEAD still produced the approved 164-path set, so the user reapproved the replacement baseline before `scripts/bump-version.sh` (search: `# Updated files:`) ran.

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

## Footgun: goat-review report grammar fails only at validate time, after the ledger is already persisted

**Status:** resolved | **Created:** 2026-08-11 | **Resolved:** 2026-08-31 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Validate transient ledger records and the pending report in one count-bound envelope before redaction; final validation remains mandatory after persistence.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 7 | **Latest occurrence:** 2026-08-31

**Resolved by:** `goat-flow review validate-ledger` checks transient records, `goat-flow review validate-draft` binds those exact records to a pending complete report before persistence, and final `goat-flow review validate` proves the stored report and ledger together. The workflow keeps the ledger transient through optional Pass 3 and routes the envelope through `workflow/skills/goat-review/references/examples.md` (search: "Pre-persistence Proof Envelope"). Anchors: `src/cli/review-validate.ts` (search: "validateReviewDraftEnvelope") and `src/cli/review-validate-ledger.ts` (search: "validateRefutationLedgerText").

**Original symptoms:** `goat-flow review validate` exited 1 on a finished review whose content was correct: a ledger record failed the one-line grammar, the `Verdicts:` counts disagreed with the findings list, and a scope-snapshot value was rejected despite naming every field. All three surfaced at the final Proof Gate, after the ledger had been written through the redactor.

**Why it happened:** The record grammar in `src/cli/review-validate-common.ts` (search: "REFUTATION_LEDGER_RECORD") splits on `|`, so `curl|bash` in a suspicion creates extra fields exactly when the grammar is most needed. Every ledger line is a record, so a title line fails as record 1, and `Verdicts: <c>/<a>/<r>/<u>` is cross-checked against visible findings, so counting a suspicion that never became a finding contradicts the report.

**Incident ledger:**
- **2026-08-11 (PR #58):** `review validate: FAIL (3 violations)`, two `V5/integrity-format` and one `V8/refutation-ledger`. Rewriting `curl|bash` as `curl-into-bash`, dropping the title line, reconciling `Verdicts: 5/0/13/0`, and replacing a bare filename anchor (which fails `V1/anchor-unresolved` against the declared head OID) with a repository-relative path produced PASS.
- **Recurrence 2026-08-27:** `Evidence: 13 OBSERVED / 0 INFERRED` counted refutations and pointers while one finding carried a tag; `src/cli/review-validate-sections.ts` (search: "validateIntegrityCounts").
- **Recurrence 2026-08-29:** an area-audit report was redacted before validation and failed on a tagless finding and two inflated totals; `src/cli/review-validate-anchors.ts` (search: "finding is missing Evidence").
- **Recurrence 2026-08-31:** the pre-persistence validator accepted `curl|bash` because `\S` consumed the pipe; fields are now pipe-free, pinned by `test/unit/review-validate-verdict.test.ts` (search: "rejects reserved pipe delimiters inside ledger fields").
- **Recurrence 2026-08-31:** Pass 2 persisted the ledger while optional Pass 3 could still send leads back; the Proof Gate now follows Pass 3 per `workflow/skills/goat-review/SKILL.md` (search: "Do not redact in Pass 2") and (search: "After optional Pass 3").
- **Recurrence 2026-08-31:** separate commands let `validate-ledger` pass two records while `validate-draft` passed a report claiming one; the draft gate now consumes the pending report, a reserved marker, and the exact records together: `src/cli/review-validate.ts` (search: "validateDraftLedgerEnvelope") and `test/unit/review-validate-verdict.test.ts` (search: "validates ledger grammar and a complete report draft before persistence").
- **Recurrence 2026-08-31:** the envelope declared an intended ledger path before draft validation and replaced it afterwards on the unavailable-redactor branch, so the validated draft differed from the fallback; the sequence now declares the path or the persist-skipped fields first: `workflow/skills/goat-review/references/examples.md` (search: "otherwise declare the documented persist-skipped fields now").

**Prevention retained:** Write pipeline examples in ledger records as prose or a fenced form and reserve `|` for the separator. Start the ledger at the first record. Keep `Verdicts:` equal to the visible findings and record unconverted suspicions in automated-review provenance. Use repository-relative anchors. Run `validate-ledger`, then `validate-draft` with `Review validator: pending`, and only after both pass redact to the intended path and run the final `validate`.

## Footgun: Structured Actual cannot represent uninstrumented time

**Status:** resolved | **Created:** 2026-08-02 | **Evidence:** OBSERVED
**Decision changed:** Instrument timing before work; if timing is missing, declare the honest state instead of manufacturing precision.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Original symptoms:** A completed or `human-verification-pending` milestone had to carry a numeric Actual total and split even when no clock was started; `_`, `unknown`, or an explanation without a number failed strict validation, inviting agents to turn estimates into a precise-looking Actual. `src/cli/plans-check.ts` (search: `function collectActualErrors`) made numeric Actual mandatory and `src/cli/plans-effort.ts` (search: `ACTUAL_PATTERN`) accepted only numeric minutes.

**Resolved by:** `src/cli/plans-effort.ts` (search: `ACTUAL_UNKNOWN_STATE_PATTERN`) parses four Actual states: `measured`, `retrospective`, `unavailable`, `incomplete`. `src/cli/plans-time.ts` (search: `export function applyPlanTimeTransition`) system-stamps spans into a `## Timing Receipt`, `measured` requires a finalized consistent receipt, and untagged legacy numerics classify as `retrospective`. Verified 2026-08-02: a `complete` milestone with `Actual: unavailable: no clock was started for this milestone` passes `plans check --strict`.

**Safe handling now:** `goat-flow plans time start <milestone-file> --category <product|proof|other>` before work, `stop` before every human wait, `stop --finalize` at the gate. Let the receipt supply raw seconds, declare `unavailable:` or `incomplete:` with a reason when prospective timing was missed, and treat estimate accuracy and Actual accuracy as separate claims.
