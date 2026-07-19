---
category: redaction
last_reviewed: 2026-07-13
---

## Lesson: Ordered redaction rules must preserve earlier placeholders

**Status:** active | **Created:** 2026-07-13

**What happened:** The first durable-text scrubber replaced a cookie value, then a later generic structured-field rule consumed that placeholder and mislabeled benign prose such as `Standalone token:`.

**Evidence:** `src/cli/evidence/redaction.ts` (search: `DURABLE_TEXT_REDACTION_RULES`) - narrowing structured fields to exact line-start keys kept earlier replacements stable; `test/unit/redact-command.test.ts` (search: `evidence-shaped placeholders`) proves each fake credential class keeps the intended marker.

**Prevention:** Treat replacement markers as protected output. After every ordered-rule change, test exact placeholder classes and benign prose as well as secret removal.

## Lesson: Pre-write examples must not start from an unredacted disk file

**Status:** active | **Created:** 2026-07-13

**What happened:** M08 correctly scrubbed stdin before its output write, but the first docs demonstrated `< draft.md`, implying the raw candidate already existed on disk.

**Evidence:** `.goat-flow/logs/sessions/README.md` (search: `Run the scrubber first`) - the corrected flow starts the command, accepts pasted stdin, and writes only the scrubbed result; `src/cli/redact-command.ts` (search: `readFileSync(0`) confirms stdin is read before the shared output sink.

**Prevention:** A pre-write redaction example must accept interactive stdin or another non-persistent source. Never demonstrate it by redirecting from a raw draft file.

## Lesson: Durable exports must redact metadata as well as body fields

**Status:** active | **Created:** 2026-07-13

**What happened:** The first milestone-export scrubber cleaned titles and section bodies but returned the source filename unchanged, so a token-shaped filename remained visible in JSON preview output.

**Evidence:** `src/cli/plans-export.ts` (search: `sourceFile: scrubDurableText`) now scrubs the filename with every other exported field; `test/unit/plans-export.test.ts` (search: `prints redacted JSON preview`) reproduces the metadata leak and proves the preview removes it without writing files.

**Prevention:** Inventory every serialized field, including filenames, identifiers, labels, and warning text. Add a secret-shaped value outside the main body to every durable-export redaction test.
