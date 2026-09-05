---
category: redaction
last_reviewed: 2026-08-24
---

**Scope:** Scrubbing secrets out of durable text - ordered rule interaction, redacting before the first write to a durable path, and metadata fields the body scrubber misses. Fixtures that must not embed real secret shapes are [hook-testing.md](hook-testing.md).
## Lesson: Ordered redaction rules must preserve earlier placeholders

**Status:** active | **Created:** 2026-07-13

**Prevention:** Treat replacement markers as protected output. After every ordered-rule change, test exact placeholder classes and benign prose as well as secret removal.

**What happened:** The first durable-text scrubber replaced a cookie value, then a later generic structured-field rule consumed that placeholder and mislabeled benign prose such as `Standalone token:`.

**Evidence:** `src/cli/evidence/redaction.ts` (search: `DURABLE_TEXT_REDACTION_RULES`) - narrowing structured fields to exact line-start keys kept earlier replacements stable; `test/unit/redact-command.test.ts` (search: `evidence-shaped placeholders`) proves each fake credential class keeps the intended marker.

## Lesson: Pre-write examples must not start from an unredacted disk file

**Status:** active | **Created:** 2026-07-13
**Decision changed:** Version-check the redactor before writing any durable plan, decision, learning, or session text, and let its output create the destination.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 4
**Latest occurrence:** 2026-08-24

**Prevention:** A pre-write redaction example must accept interactive stdin or another non-persistent source, and must never be demonstrated by redirecting from a raw draft file. A durable destination may receive only version-matched redactor output: if a draft reaches that path first, stop before indexing, redact to a temporary file, compare bytes, and replace the destination only from the redacted result.

**What happened:** M08 correctly scrubbed stdin before its output write, but the first docs demonstrated `< draft.md`, implying the raw candidate already existed on disk.

**Evidence:** `.goat-flow/logs/sessions/README.md` (search: `Run the scrubber first`) - the corrected flow starts the command, accepts pasted stdin, and writes only the scrubbed result; `src/cli/redact-command.ts` (search: `readFileSync(0`) confirms stdin is read before the shared output sink.

**Recurrence (2026-08-01):** A required redactor command combined its destination check with a large Markdown heredoc, so the deny hook counted table separators as shell segments and blocked it before execution. Checking the absent destination separately, then streaming the same content to a sole `goat-flow redact --output <path>` process, preserved both pre-write redaction and the shell guard.

**Recurrence (2026-08-14):** ADR-059 reached its durable path before the version-matched redactor ran. Before indexing, the correction redacted the file with goat-flow v1.15.1 and byte-compared it with the destination; later learning-loop corrections patched a temporary redacted copy and ran the redactor again with file input redirection after the hook rejected a pipe-to-interpreter form. Evidence anchors: `.goat-flow/learning-loop/decisions/ADR-059-useful-comment-doctrine.md` (search: `## Decision`) and `src/cli/redact-command.ts` (search: `readFileSync(0`).

**Recurrence (2026-08-24):** During the standalone local-hook-policy re-home, 17 plan and decision files reached their durable paths before the goat-plan redaction gate. The correction ran each file through goat-flow v1.16.0 to a temporary destination and byte-compared it with the written file; every comparison matched.

## Lesson: Durable exports must redact metadata as well as body fields

**Status:** active | **Created:** 2026-07-13

**Prevention:** Inventory every serialized field, including filenames, identifiers, labels, and warning text. Add a secret-shaped value outside the main body to every durable-export redaction test.

**What happened:** The first milestone-export scrubber cleaned titles and section bodies but returned the source filename unchanged, so a token-shaped filename remained visible in JSON preview output.

**Evidence:** `src/cli/plans-export-output.ts` (search: `sourceFile: scrubDurableText`) now scrubs the filename with every other exported field; `test/unit/plans-export-writes.test.ts` (search: `prints redacted JSON preview`) reproduces the metadata leak and proves the preview removes it without writing files.
