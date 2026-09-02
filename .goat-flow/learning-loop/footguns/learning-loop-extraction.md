---
category: learning-loop-extraction
last_reviewed: 2026-09-02
---

**Scope:** How the CLI reads its own learning loop - entry counting, resolved-vs-active grammars, decision extraction, and stale-reference detection. Audit check semantics and deny-enforcement verification live in [auditor.md](auditor.md).

## Footgun: Learning-loop record counts have two grammars that disagree on resolved entries

**Status:** active | **Created:** 2026-06-10 | **Updated:** 2026-08-15 | **Evidence:** ACTUAL_MEASURED

**Prevention:**
1. Match the count source to the surface's concept: retrieval/index surfaces use `parseBucket` active counts; size/health surfaces use stats totals.
2. Never render counts from both grammars under the same bucket label on one surface; if both must appear, label them distinctly ("active entries" vs total records).

**Symptoms:** Two surfaces show different counts under the same bucket label. Measured 2026-06-10: the dashboard Home LEARNING LOOP pill said `94 footguns` while the Learning loop card's per-bucket bar said `footguns 78`. Both are correct - they use different counting grammars.

**Stays active after the 2026-08-15 label fix.** The two grammars are deliberate (Prevention 1) and both remain in the payload, so any new surface can re-collide them. What was fixed is the specific Home violation of Prevention 2: the pill now reads `N footgun records` / `N lesson records` against the card's `N active entries`, and `dashboard-reporting.ts` marks each field's grammar at the point it is set. The trap is the shape, not that one instance.

**Recurrence 2026-08-15:** Hit again outside the dashboard while reconciling this directory by hand - 129 `## Footgun:` headings against 105 `INDEX.md` rows. The gap was 23 resolved entries plus one `## Footgun:` template inside `README.md`, which is a heading but not an entry. Any tool counting headings must exclude the README and decide which grammar it means.

**Evidence:**
- `src/cli/server/dashboard-reporting.ts` (search: `footgunCount: stats.footguns.totalEntries`) - pill counts come from `buildStatsReport`, which counts every entry heading including `Status: resolved` footguns.
- Same file (search: `entryCount: parseBucket`) - the card's bars use `parseBucket` from `src/cli/learning-loop-index/parse-bucket.ts`, which returns active entries only (the INDEX.md grammar, "active-entry rows" per its doc comment).
- Measured gap: 94 total vs 78 active footguns (16 resolved); lessons matched at 212 because they have no resolved state, so the mismatch hides on buckets without resolved entries.
- First Learning loop card draft rendered both numbers on one card; fixed by deriving the card's status line from the same `entryCount` data as its bars (search: `learningLoopStatusDetail` in `src/dashboard/views/home.html`).

---

## Footgun: Regex-shaped search needles pass only while their file path is unresolvable

**Status:** active | **Created:** 2026-08-20 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Write `(search: ...)` needles as literal substrings copied from the target file; when completing a citation's path, treat its needle as unvalidated and re-run `stats --check` in the same change.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Copy needles verbatim from the cited file - never compose them as patterns. Read a long-green anchor whose path is a bare basename as unverified, not proven: the validator's skip list, not the needle, is what kept it green. When auditing buckets, treat bare-basename citations as candidates to complete, and expect completion to surface latent needle rot.

**Symptoms:** An anchor pairing a bare source basename with a pattern-shaped needle sits green in a bucket for months; then correcting the citation to a full repository path makes the same line fail `stats --check` as a stale ref - even though a regex reading of the needle matches the target file.

**Why it happens:** Two validator behaviours compose. `src/cli/facts/shared/reference-paths.ts` (search: `shorthand for a deeply nested file`) skips bare source basenames that do not exist at the repo root, so the citation is never checked at all; needle matching is literal substring comparison - `src/cli/facts/shared/learning-loop-common.ts` (search: `confirm the literal string still appears`) - so `.*` matches only a literal `.*`. A pattern-shaped needle therefore survives exactly as long as its path stays unresolvable; the moment someone "improves" the citation with a full path, validation starts and correctly rejects it. Measured 2026-08-20 in `footguns/auditor.md`: `stats --check` passed with the bare basename, failed with a `stale-ref` finding naming the pattern-shaped needle once the `src/cli/audit/` path was completed, and passed again after the needle became a literal copied from the source line.

---

## Footgun: Extractor diagnostics can encode valid empty state

**Status:** active | **Created:** 2026-07-12 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Diagnostic consumers must classify every documented state at their boundary; non-null diagnostic text is not an error flag.
**Trigger phase:** ACT

**Prevention:** Do not interpret a general-purpose diagnostic field as an error flag. Classify each documented diagnostic state at the consuming boundary, and keep a fresh-install fixture beside malformed-metadata coverage.

**Trap:** A shared diagnostic channel can carry malformed-metadata errors and valid status such as an empty first-run store. Any new consumer that treats every non-null diagnostic as failure can turn a valid fresh installation into a failed harness. The current Feedback Loop consumer classifies the known empty states; new diagnostics or consumers can reintroduce the conflation.

**Original incident:** On 2026-07-12, a fresh consumer with valid but empty footgun and lesson directories failed the Feedback Loop concern because the harness treated the valid messages `Footgun directory exists but contains 0 entries` and `Lesson directory exists but contains 0 entries` as errors.

**Evidence:**
- `src/cli/audit/harness/check-feedback-loop.ts` (search: `EMPTY_LEARNING_LOOP_DIAGNOSTICS`) distinguishes the two valid first-run messages from actionable format failures.
- `test/integration/audit-quality.test.ts` (search: `accepts extractor diagnostics that only report zero learning-loop entries`) pins the empty-install behavior without suppressing malformed-bucket diagnostics.
- `test/integration/setup-quality-lifecycle.test.ts` (search: `consumer setup to quality-report lifecycle`) proves a newly installed consumer reaches a passing selected-agent harness before any incident entries exist.

---

## Footgun: Bulk learning-loop rewrites can duplicate entries and hoist Prevention above the metadata block

**Status:** active | **Created:** 2026-09-02 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** A programmatic bucket rewrite proves itself with heading counts, a non-blank line multiset diff against HEAD, and a Status-first scan before `goat-flow index` runs; a green transform log and a passing order contract are not that proof.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 2 | **Latest occurrence:** 2026-09-02

**Prevention:**
1. When a rewriter splices entry text back into a bucket with `String.prototype.replace`, pass a replacer function such as `replace(before, () => after)`; a plain replacement string expands `$&`, `$'`, and a dollar sign followed by a backtick wherever entry prose contains them.
2. Before writing, compare every entry heading count and the sorted non-blank line multiset against `git show HEAD:<bucket>`; the only differences allowed are the relabels and insertions the rewrite declares.
3. Keep every documented metadata label in the production classifier consumed by index fallback and imported by the order contract. Leading labels are bucket-specific, while inline labels may follow a valid lead; cover optional fields such as `hallucination-risk`, `Merged`, and `Recurrences`. Split a metadata paragraph that has a body line glued to it before the rewrite runs, and scan afterwards for any entry whose first line after the heading is not `**Status:**` or `**Created:**`.

**Symptoms:** `stats --check` fails with `bucket-size` on a lesson bucket that was under budget before the rewrite; `goat-flow index` reports more lesson entries than the audit counted; entries open with `**Prevention:**` and carry their `**Status:**` line in the middle of the body; the Prevention-first contract reports the duplicated copies as non-compliant entries.

**Why it happens:** Two independent causes composed. The rewrite spliced each transformed entry back with `transformed.replace(before, after)`, and lesson prose about JavaScript regexes contains a backtick-quoted `$`, which `String.replace` reads as the "text before the match" pattern; `verification-validators.md` grew from 20,820 to 71,671 bytes with seven of its ten headings each appearing four times, and `agent-tooling.md` and `filesystem-io.md` gained duplicates. Separately, the metadata classifier in the order contract enumerated a fixed label set that omitted the documented optional `hallucination-risk` field and the `**Merged:**` audit-trail line, and some entries glued `**Symptoms:**` or `**What happened:**` to the metadata paragraph without a blank line, so those paragraphs read as body and the rewrite inserted Prevention above them in ten entries.

**Evidence:** Measured 2026-09-02 while completing the migration that commit `a13f92f9` started. `src/cli/learning-loop-index/parse-bucket.ts` (search: `firstLearningEntryBodyParagraph`) owns the shared classifier used by index fallback, and `test/contract/learning-loop-entry-order.test.ts` (search: `firstLearningEntryBodyParagraph`) imports the same classifier for the order contract. The first shared-classifier run failed on 1 of 296 lesson entries because inline `**Recurrences:**` metadata was not yet recognised; after adding that documented label, the focused suite passed 32 of 32 tests. `.goat-flow/learning-loop/footguns/auditor.md` (search: `Version checks that test inequality without direction prescribe a downgrade`) and `.goat-flow/learning-loop/lessons/coordination.md` (search: `Phase 0 normalisation catches council false findings`) were two of the hoisted entries; `.goat-flow/learning-loop/lessons/verification-validators.md` (search: `multiline heading regexes with`) holds the prose that triggered the duplication.

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

## Footgun: Decision meta files must be excluded from every decision extractor

**Status:** resolved | **Created:** 2026-06-04 | **Resolved:** 2026-06-05 | **Evidence:** ACTUAL_MEASURED

**Resolution:** `src/cli/facts/shared/decision-files.ts` (search: `isDecisionRecordMarkdown`) now owns the shared ADR/meta split; `src/cli/facts/shared/index.ts` (search: `filter(isDecisionRecordMarkdown)`) and `src/cli/facts/shared/learning-loop-entries.ts` (search: `isDecisionRecordMarkdown(sourceFilename(decisionFile.path))`) use it. `test/unit/learning-loop.test.ts` (search: `excludes the decisions INDEX from shared decision counts and prompt entries`) pins the inflated-count and prompt-entry regression.

**Original symptoms:** Adding a hand-maintained `.goat-flow/learning-loop/decisions/INDEX.md` could pass `stats --check` filename validation while shared decision facts and prompt learning-loop entries still counted or surfaced it as a real decision. The dashboard, harness, and prompt context then reported inflated decision counts or included a "Decisions Index" entry beside ADR records.

**Why it happened:** Decision validation, decision directory facts, and compact learning-loop entry extraction had separate filters. Updating only the stats validator's meta-file allowlist left `src/cli/facts/shared/index.ts` and the learning-loop entry helpers using the older "exclude README only" rule. In this checkout, `rg --files .goat-flow/learning-loop/decisions | rg '\.md$' | wc -l` returned 34, while `rg --files .goat-flow/learning-loop/decisions | rg '/ADR-[0-9]{3}-.*\.md$' | wc -l` returned 32 and `.goat-flow/learning-loop/decisions/INDEX.md` was present.

**Prevention:** Treat decision meta-file additions like a shared extractor contract change. Update the stats validator, shared decision facts, compact learning-loop entries, prompt filters, and tests in one patch; assert both the failing gate (`stats --check`) and the non-gating facts (`decisions.fileCount`, decision entry titles) so meta files cannot leak into user-facing counts.

---

## Footgun: Learning-loop stale-ref detection misses bare-path `Evidence anchors:` entries

**Status:** resolved | **Created:** 2026-06-01 | **Resolved:** 2026-06-03 | **Evidence:** ACTUAL_MEASURED

**Resolution:** `src/cli/facts/shared/learning-loop-common.ts` (search: `scanBareEvidenceAnchors`) now existence-checks non-glob bare backtick paths on `Evidence anchors:` lines, while leaving line refs and search anchors to their existing scanners. `test/unit/learning-loop.test.ts` (search: `flags bare Evidence anchors paths`) pins the stale-path regression.

**Original symptoms:** `goat-flow stats --check` existence-checked a learning-loop file reference in only three anchor shapes: `` `file:line` ``, `` `file` (search: `needle`) ``, and `(search: "needle")`. A bare backtick path with no line number and no `(search: ...)` suffix - the `Evidence anchors: \`path/to/file.ts\`` convention - was never checked. `Evidence anchors:` lines appeared in 15 learning-loop files as of 2026-06-01, so a whole class of anchors silently bypassed the integrity gate.

The miss kept `stats --check` green while `.goat-flow/learning-loop/lessons/gruff-cleanup.md` cited two deleted tests (`test/unit/audit-command/harness.test.ts`, `test/unit/dashboard-toast.test.ts`) and `.goat-flow/learning-loop/lessons/verification.md` cited a deleted task milestone under `.goat-flow/plans/1.8.0/`; a Codex quality run found them by hand, not the detector.

**Invariant:** Durable learning-loop evidence should use the sanctioned `(search: "needle")` form when content identity matters. Never anchor to `.goat-flow/plans/**` milestone files - they are gitignored WIP and get cleaned up.
