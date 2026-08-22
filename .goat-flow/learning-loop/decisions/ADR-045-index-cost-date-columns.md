# ADR-045: Content-derived cost and date columns for learning-loop indexes

**Status:** Accepted
**Date:** 2026-08-23
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

## Failure Mode Comparison

| Option | What fails | Why rejected or accepted |
| --- | --- | --- |
| Keep the original rows | Agents cannot compare reading cost before opening sources, and most declared dates remain hidden. | Rejected because it weakens index-first retrieval. |
| Add generation time or filesystem modification time | An unchanged source can produce different output, so `stats --check` reports permanent staleness. | Rejected by ADR-033's determinism contract. |
| Run an exact model tokenizer | The index gains a model-specific dependency and presents precision that does not transfer across runtimes. | Rejected for a routing heuristic. |
| Derive both fields from entry text | Repeated generation is stable, missing dates stay honest, and every row exposes comparable reading cost. | Accepted. |

## Consequences

All four committed `INDEX.md` files gain the suffix and must be regenerated together. Editing an entry section can change its displayed estimate and therefore makes its index stale until regeneration. Undated entries remain valid and visibly omit the date.

The suffix increases the mandatory Step 0 index read size. The implementation must measure the generated indexes and revisit this decision if the added columns make index-first retrieval impractical.

## Reversibility

This is a two-way door. A later change can remove or replace the suffix, update the parser and formatter contract, and regenerate all four indexes in one change. Revisit the estimate if measured retrieval cost, index growth, or model-token comparisons show that the byte-derived bands mislead agents.
