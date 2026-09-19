---
category: learning-loop-extraction
last_reviewed: 2026-09-05
---

**Scope:** How the CLI reads its own learning loop: entry counting, resolved-versus-active grammars, decision extraction, and stale-reference detection. Audit check semantics and deny-enforcement verification live in [auditor.md](auditor.md).

## Footgun: Learning-loop record counts have two grammars that disagree on resolved entries

**Status:** active | **Created:** 2026-06-10 | **Updated:** 2026-08-15 | **Evidence:** ACTUAL_MEASURED
**Incident count:** 2 | **Latest occurrence:** 2026-08-15

**Prevention:** Match the count source to the surface's concept: retrieval and index surfaces use `parseBucket` active counts; size and health surfaces use stats totals. Never render counts from both grammars under one bucket label on one surface; when both must appear, label them distinctly ("active entries" versus total records). Any tool that counts headings excludes the `## Footgun:` template in `README.md` and decides which grammar it means.

**Symptoms:** Two surfaces show different counts under the same label. On 2026-06-10 the dashboard Home pill said `94 footguns` while the Learning loop card's bar said `footguns 78`, and both were correct. On 2026-08-15 a hand reconciliation counted 129 `## Footgun:` headings against 105 INDEX rows, the gap being 23 resolved entries plus the README template.

**Why it happens:** The two grammars are deliberate and both stay in the payload, so any new surface can re-collide them. The 2026-08-15 fix relabelled the Home pill to `N footgun records` against the card's `N active entries` and marks each field's grammar where it is set; the trap is the shape, not that one instance.

**Evidence:** `src/cli/server/dashboard-reporting.ts` (search: `footgunCount: stats.footguns.totalEntries`) counts every heading including resolved footguns, while the same file (search: `entryCount: parseBucket`) uses `parseBucket` from `src/cli/learning-loop-index/parse-bucket.ts`, which returns active entries only. Lessons matched at 212 in the 2026-06-10 measurement because they have no resolved state, so the mismatch hides on buckets without resolved entries. `src/dashboard/views/home.html` (search: `learningLoopStatusDetail`) derives the card's status line from the same `entryCount` data as its bars.

---

## Footgun: Regex-shaped search needles pass only while their file path is unresolvable

**Status:** active | **Created:** 2026-08-20 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Write `(search: ...)` needles as literal substrings copied from the target file; when completing a citation's path, treat its needle as unvalidated and re-run `stats --check` in the same change.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Copy needles verbatim from the cited file, never as patterns. Read a long-green anchor whose path is a bare basename as unverified: the validator's skip list, not the needle, kept it green. When auditing buckets, treat bare-basename citations as candidates to complete, and expect completion to surface latent needle rot.

**Symptoms:** An anchor pairing a bare source basename with a pattern-shaped needle sits green for months, then correcting the citation to a full repository path makes the same line fail `stats --check` as a stale ref although a regex reading of the needle matches the file.

**Why it happens:** `src/cli/facts/shared/reference-paths.ts` (search: `shorthand for a deeply nested file`) skips bare source basenames that do not exist at the repo root, so the citation is never checked, and needle matching is literal substring comparison at `src/cli/facts/shared/learning-loop-common.ts` (search: `confirm the literal string still appears`), so `.*` matches only a literal `.*`. Measured 2026-08-20 in `footguns/auditor.md`: `stats --check` passed with the bare basename, failed with `stale-ref` once the `src/cli/audit/` path was completed, and passed again after the needle became a literal copied from the source line.

---

## Footgun: Extractor diagnostics can encode valid empty state

**Status:** active | **Created:** 2026-07-12 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Diagnostic consumers must classify every documented state at their boundary; non-null diagnostic text is not an error flag.
**Trigger phase:** ACT

**Prevention:** Do not interpret a general-purpose diagnostic field as an error flag. Classify each documented diagnostic state at the consuming boundary, and keep a fresh-install fixture beside malformed-metadata coverage.

**Symptoms:** On 2026-07-12 a fresh consumer with valid but empty footgun and lesson directories failed the Feedback Loop concern because the harness treated `Footgun directory exists but contains 0 entries` and `Lesson directory exists but contains 0 entries` as errors.

**Why it happens:** One diagnostic channel carries malformed-metadata errors and valid status such as an empty first-run store, so any consumer that treats every non-null diagnostic as failure turns a valid fresh install into a failed harness.

**Evidence:** `src/cli/audit/harness/check-feedback-loop.ts` (search: `EMPTY_LEARNING_LOOP_DIAGNOSTICS`) distinguishes the two valid first-run messages; `test/integration/audit-quality.test.ts` (search: `accepts extractor diagnostics that only report zero learning-loop entries`) pins the empty-install case without suppressing malformed-bucket diagnostics; `test/integration/setup-quality-lifecycle.test.ts` (search: `consumer setup to quality-report lifecycle`) proves a new consumer reaches a passing harness before any incident entry exists.

---

## Footgun: Bulk learning-loop rewrites can duplicate entries and hoist Prevention above the metadata block

**Status:** active | **Created:** 2026-09-02 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** A programmatic bucket rewrite proves itself with heading counts, a non-blank line multiset diff against HEAD, and a Status-first scan before `goat-flow index` runs; a green transform log and a passing order contract are not that proof.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 2 | **Latest occurrence:** 2026-09-02

**Prevention:**
1. When a rewriter splices entry text back with `String.prototype.replace`, pass a replacer function such as `replace(before, () => after)`; a plain replacement string expands `$&`, `$'`, and a dollar sign followed by a backtick wherever entry prose contains them.
2. Before writing, compare every entry heading count and the sorted non-blank line multiset against `git show HEAD:<bucket>`; the only allowed differences are the relabels and insertions the rewrite declares.
3. Keep every documented metadata label in the production classifier consumed by index fallback and imported by the order contract, including optional fields such as `hallucination-risk`, `Merged`, and `Recurrences`. Split a metadata paragraph that has a body line glued to it before the rewrite runs, and scan afterwards for any entry whose first line after the heading is not `**Status:**` or `**Created:**`.

**Symptoms:** `stats --check` fails with `bucket-size` on a lesson bucket that was under budget before the rewrite, `goat-flow index` reports more entries than the audit counted, entries open with `**Prevention:**` and carry `**Status:**` mid-body, and the Prevention-first contract reports the duplicates as non-compliant.

**Why it happens:** Two causes composed. The rewrite spliced each entry back with `transformed.replace(before, after)`, and lesson prose about JavaScript regexes contains a backtick-quoted `$` that `String.replace` reads as the "text before the match" pattern, so `verification-validators.md` grew from 20,820 to 71,671 bytes with seven of ten headings appearing four times. Separately, the order contract's metadata classifier enumerated a fixed label set that omitted `hallucination-risk` and `**Merged:**`, and some entries glued `**Symptoms:**` or `**What happened:**` to the metadata paragraph, so those paragraphs read as body and Prevention was inserted above them in ten entries.

**Evidence:** Measured 2026-09-02 while completing the migration commit `a13f92f9` started. `src/cli/learning-loop-index/parse-bucket.ts` (search: `firstLearningEntryBodyParagraph`) owns the shared classifier, and `test/contract/learning-loop-entry-order.test.ts` (search: `firstLearningEntryBodyParagraph`) imports it; the first shared run failed 1 of 296 lesson entries until inline `**Recurrences:**` was recognised, after which the focused suite passed 32 of 32. `.goat-flow/learning-loop/footguns/auditor.md` (search: `Version checks that test inequality without direction prescribe a downgrade`) and `.goat-flow/learning-loop/lessons/coordination.md` (search: `Phase 0 normalisation catches council false findings`) were two hoisted entries; `.goat-flow/learning-loop/lessons/verification-validators.md` (search: `multiline heading regexes with`) holds the prose that triggered the duplication.

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

## Footgun: Decision meta files must be excluded from every decision extractor

**Status:** resolved | **Created:** 2026-06-04 | **Resolved:** 2026-06-05 | **Evidence:** ACTUAL_MEASURED

**Resolution:** `src/cli/facts/shared/decision-files.ts` (search: `isDecisionRecordMarkdown`) owns the ADR/meta split, used by `src/cli/facts/shared/index.ts` (search: `filter(isDecisionRecordMarkdown)`) and `src/cli/facts/shared/learning-loop-entries.ts` (search: `isDecisionRecordMarkdown(sourceFilename(decisionFile.path))`); `test/unit/learning-loop.test.ts` (search: `excludes the decisions INDEX from shared decision counts and prompt entries`) pins the regression.

**Original symptoms:** A hand-maintained `decisions/INDEX.md` passed `stats --check` filename validation while shared decision facts and prompt entries still counted it as a real decision, inflating dashboard, harness, and prompt counts and surfacing a "Decisions Index" entry beside ADRs, because the validator, directory facts, and entry extraction each had their own filter.

**Prevention retained:** Treat a decision meta-file addition as a shared extractor contract change: update the stats validator, shared decision facts, compact entries, prompt filters, and tests in one patch, asserting both the failing gate and the non-gating facts.

---

## Footgun: Learning-loop stale-ref detection misses bare-path `Evidence anchors:` entries

**Status:** resolved | **Created:** 2026-06-01 | **Resolved:** 2026-06-03 | **Evidence:** ACTUAL_MEASURED

**Resolution:** `src/cli/facts/shared/learning-loop-common.ts` (search: `scanBareEvidenceAnchors`) existence-checks non-glob bare backtick paths on `Evidence anchors:` lines; `test/unit/learning-loop.test.ts` (search: `flags bare Evidence anchors paths`) pins the regression.

**Original symptoms:** `stats --check` existence-checked only `` `file:line` ``, `` `file` (search: `needle`) ``, and `(search: "needle")`, so the `Evidence anchors:` convention used in 15 files as of 2026-06-01 bypassed the gate while lessons cited two deleted tests and a deleted milestone; a Codex quality run found them by hand.

**Invariant:** Durable learning-loop evidence uses the `(search: "needle")` form when content identity matters, and never anchors to `.goat-flow/plans/**` milestone files, which are gitignored WIP.
