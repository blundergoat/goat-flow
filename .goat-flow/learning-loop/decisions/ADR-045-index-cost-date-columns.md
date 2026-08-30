# ADR-045: Content-derived cost and date columns for learning-loop indexes

**Status:** Accepted
**Date:** 2026-08-23
**Updated:** 2026-08-31 - Step 0 now bounds matching-row output, so raw aggregate-index bytes remain telemetry rather than a retrieval-cost warning.
**Ticket/Context:** `.goat-flow/plans/1.17.0/M05-index-cost-and-date-columns.md`

## Context

[ADR-033](ADR-033-goat-flow-directory-restructure.md) makes each generated learning-loop index a deterministic, index-first retrieval surface. Its original row schema gives an agent a title, source, search anchor, and short hook, but no indication of how much text the entry contains. Dates are available only for decision rows; agents must open other source entries to learn whether a declared date exists.

The claude-mem usage documentation describes a progressive-disclosure design whose first layer shows titles with token-cost estimates before details are fetched on demand: <https://github.com/thedotmack/claude-mem/blob/main/docs/public/usage/getting-started.mdx#understanding-progressive-disclosure>. That is external design context, not evidence that goat-flow's approximation matches a model tokenizer.

## Decision

Extend ADR-033's generated row schema with a fixed suffix:

```markdown
- [Title](bucket-file.md) (search: "<entry heading line>") - short hook (YYYY-MM-DD; ~NNN tok)
```

The token estimate is always present. It divides the entry section's UTF-8 byte length by four and rounds the result to the nearest ten tokens. It is a stable reading-cost comparison, not an exact model-token count.

The date is present only when the source entry declares one. Footguns, lessons, and patterns use their `Created` metadata. Decision records use the existing `decisionIndexDate` rule: `Date` normally and `Superseded` for a superseded status. A missing date produces a token-only suffix such as `(~120 tok)`; generation never substitutes the current time, file modification time, or another inferred date.

Decision-row hooks retain the verbatim status and first Decision sentence. Their date moves into the common suffix so it is not rendered twice. Entry ordering, search anchors, hook extraction, and active/resolved filtering do not change.

Footgun and lesson rows use a declared `**Decision changed:**` value as their one hook, prefixed with `Decision:`. They keep the existing incident or
context hook when that field is absent. Pattern and decision hooks do not use this optional field.

The complete labelled hook remains within 100 characters. Long guidance first ends at a word boundary with an ellipsis. The shortened text is then
checked for an open Markdown code span and backs up before its opening delimiter when needed. The rule is derived only from entry text.

Step 0 searches the generated indexes instead of loading one wholesale. Search output is capped at 13 rows across the four buckets; the thirteenth row is a breadth signal, so the agent refines its terms before inspection and reads at most 12 matching rows. This makes context cost depend on the bounded result set rather than aggregate file bytes.

Index `sizeBytes` remains visible stats telemetry. `stats --check` does not warn solely on aggregate index size: active entries have no lossless shrink lever under ADR-033's one-index-per-bucket layout, and raw size no longer predicts the bounded context read.

## Failure Mode Comparison

| Option | What fails | Why rejected or accepted |
| --- | --- | --- |
| Keep the original rows | Agents cannot compare reading cost before opening sources, and most declared dates remain hidden. | Rejected because it weakens index-first retrieval. |
| Add generation time or filesystem modification time | An unchanged source can produce different output, so `stats --check` reports permanent staleness. | Rejected by ADR-033's determinism contract. |
| Run an exact model tokenizer | The index gains a model-specific dependency and presents precision that does not transfer across runtimes. | Rejected for a routing heuristic. |
| Derive both fields from entry text | Repeated generation is stable, missing dates stay honest, and every row exposes comparable reading cost. | Accepted. |
| Append guidance | Rows repeat summaries; measured growth was 4,323 footgun bytes and 8,815 lesson bytes. | Rejected after the corpus measurement. |
| Replace the hook | Rows expose the future action within the existing 100-character budget. | Accepted. |
| Warn when aggregate index bytes exceed a fixed threshold | The warning prescribes retiring still-active evidence even though bounded search prevents a whole-file context read. | Rejected because raw size is telemetry, not retrieval cost. |
| Cap search output and refine broad terms | Aggregate indexes remain deterministic and complete while Step 0 context stays bounded. | Accepted. |

## Consequences

All four committed `INDEX.md` files gain the suffix and must be regenerated together. Editing an entry section can change its displayed estimate and therefore makes its index stale until regeneration. Undated entries remain valid and visibly omit the date.

The 2026-08-24 regeneration replaced hooks in place and increased the footguns index by 174 bytes and the lessons index by 490 bytes. Pattern rows
were byte-identical; the decisions index changed only because this ADR's reading-cost estimate changed.

The suffix increases each matching row's size, but only bounded search output reaches Step 0 context. Stats continues to expose aggregate bytes for diagnosis without turning size alone into remediation debt. Revisit the cap if measured matching-row output makes index-first retrieval impractical.

## Reversibility

This is a two-way door. A later change can remove or replace the suffix, update the parser and formatter contract, and regenerate all four indexes in one change. Revisit the estimate if measured retrieval cost, index growth, or model-token comparisons show that the byte-derived bands mislead agents.
