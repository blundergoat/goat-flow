---
category: redaction
last_reviewed: 2026-10-29
---

**Scope:** Scrubbing secrets out of durable text - ordered rule interaction, redacting before the first write to a durable path, and metadata fields the body scrubber misses. Fixtures that must not embed real secret shapes are [hook-testing.md](hook-testing.md).
## Lesson: Ordered redaction rules must preserve earlier placeholders

**Status:** active | **Created:** 2026-07-13

**Prevention:** Treat replacement markers as protected output. After every ordered-rule change, test exact placeholder classes and benign prose as well as secret removal.

**What happened:** The first durable-text scrubber replaced a cookie value, then a later generic structured-field rule consumed that placeholder and mislabeled benign prose such as `Standalone token:`.

**Evidence:** `src/cli/evidence/redaction.ts` (search: `DURABLE_TEXT_REDACTION_RULES`) - narrowing structured fields to exact line-start keys kept earlier replacements stable; `test/unit/redact-command.test.ts` (search: `evidence-shaped placeholders`) proves each fake credential class keeps the intended marker.

## Lesson: Pre-write examples must not start from an unredacted disk file

**Status:** active | **Created:** 2026-07-13
**Severity:** SECURITY
**Decision changed:** Version-check the redactor before writing any durable plan, decision, learning, or session text, send it the draft from memory, and let its output create the destination.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 6
**Latest occurrence:** 2026-10-29

**Prevention:** Send every draft to the version-matched redactor on stdin from memory, never from a raw file on disk, including a temporary or scratch file, and never demonstrate the `< draft.md` redirect in an example. A durable destination may receive only redactor output. Recovery is the only exception: if raw text reaches any path first, stop before indexing, redact that file once to a temporary file, compare bytes, and replace the destination only from the redacted result.

**What happened:** The change correctly scrubbed stdin before its output write, but the first docs demonstrated `< draft.md`, implying the raw candidate already existed on disk.

**Root cause:** Either raw text reached a path before the scrubber ran, at the durable path, in a temporary draft or in documentation that taught that shape, or shell-guard friction blocked the supported stdin route and invited a workaround.

**Evidence:** `.goat-flow/logs/sessions/README.md` (search: `Run the scrubber first`) documents the supported interactive flow; `src/cli/redact-command.ts` (search: `readFileSync(0`) reads stdin before the shared output sink.

**Incident ledger:**

**Recurrence 2026-08-01:** A redactor command combined its destination check with a large Markdown heredoc, so the deny hook counted table separators as shell segments and blocked it. Checking the absent destination separately, then streaming the content to a sole `goat-flow redact --output <path>` process, kept both pre-write redaction and the shell guard.

**Recurrence 2026-08-14:** ADR-059 reached its durable path before the version-matched redactor ran. The correction redacted it with goat-flow v1.15.1 and byte-compared it with the destination before indexing; later corrections patched a temporary redacted copy and redacted that copy again by file redirection after the hook rejected a pipe-to-interpreter form. `.goat-flow/learning-loop/decisions/ADR-059-useful-comment-doctrine.md` (search: `## Decision`); `src/cli/redact-command.ts` (search: `readFileSync(0`).

**Recurrence 2026-08-24:** During the standalone local-hook-policy re-home, 17 plan and decision files reached their durable paths before the goat-plan redaction gate. Each was run through goat-flow v1.16.0 to a temporary destination and byte-compared with the written file; every comparison matched.

**Recurrence 2026-09-12:** Evidence capture was blocked by an oversized inline command, an interpreter wrapper and a pipe. Direct foreground redactor stdin succeeded without a raw disk draft or policy change. Suppress temporary server-auth startup output before recording validation. Validation also rejected a checkout-local plan as a durable citation. `src/cli/redact-command.ts` (search: `handleRedactCommand`).

**Recurrence 2026-10-29:** A plan progress-log draft was saved to a session scratch file and piped from it into the redactor. Only redactor output reached the durable file and the redactor changed nothing, but the raw draft stayed on disk until it was deleted; later entries went to the redactor from memory. `.goat-flow/skill-docs/skill-preamble.md` (search: `Plan-summary exception`) governs that write; `.goat-flow/skill-docs/skill-preamble.md` (search: `Redact before disk, not after`) states the general rule.

## Lesson: Durable exports must redact metadata as well as body fields

**Status:** active | **Created:** 2026-07-13 | **Evidence:** ACTUAL_MEASURED
**Severity:** SECURITY
**Incident count:** 4 | **Latest occurrence:** 2026-09-18

**Prevention:** Inventory every serialized field, including filenames, identifiers, labels, and warning text. Add a secret-shaped value outside the main body to every durable-export redaction test.

**What happened:** The first milestone-export scrubber cleaned titles and section bodies but returned the source filename unchanged, so a token-shaped filename remained visible in JSON preview output.

**Evidence:** `src/cli/plans-export-output.ts` (search: `sourceFile: scrubDurableText`) now scrubs the filename with every other exported field; `test/unit/plans-export-writes.test.ts` (search: `prints redacted JSON preview`) reproduces the metadata leak and proves the preview removes it without writing files.

**Recurrence 2026-09-16:** Text redaction of a serialized forecast case containing historical Markdown produced invalid JSON. Whole-history registration also recursively embedded the study and exceeded the serializer limit. Freeze only the registration fields consumed by the replay, exclude the target from its inputs, and validate sanitized JSON plus frozen hashes before publishing. Preserve failed output as diagnostics; never publish it as a valid registration. Evidence: src/cli/evidence/redaction.ts (search: DURABLE_TEXT_REDACTION_RULES) performs ordered text replacement, while src/cli/plans-forecast-history.ts (search: registrationEntries) reads schemaVersion and forecasts. Sanitize readable fields before serialization where the contract permits; do not silently change frozen source bytes to force a match.

**Recurrence 2026-09-16:** I redacted and published a whole forecast registry before parsing the result, corrupting quoted text in three previously frozen Markdown sources.
The original files still matched their saved hashes, allowing exact restoration without changing issued forecasts.
Validate sanitized additions before merging them; preserve already frozen records byte-for-byte and replay the final candidate before publication.
The existing evidence owners above apply: the text redactor does not preserve JSON string escaping, while forecast history depends on exact saved records.

**Recurrence 2026-09-18:** The change reused a whole-document redaction helper despite the earlier warning above. The resulting registry failed JSON parsing and altered the same three frozen input bodies. Their original files still matched every saved hash; exact restoration recovered all 3,764 origin/input checks and the pilot replay. Read this entry before registration work, sanitize new narrative fields before serialization, and validate the assembled JSON and frozen hashes before replacing the registry. The code owners above still apply; no forecast value, timestamp or protocol field changed.
