# ADR-035: Generated learning-loop indexes for cold-agent discoverability

**Status:** Accepted
**Date:** 2026-06-10

## Context

The 1.8.0 drift cleanup left the learning-loop buckets structurally sound but did not solve discoverability. Agents still had to guess the right grep terms before they could find existing footguns, lessons, patterns, or ADRs.

Two active lessons name the failure mode: `.goat-flow/learning-loop/lessons/agent-behavior.md` (search: "Retrieval terms must name the concrete failure class") and `.goat-flow/learning-loop/lessons/agent-behavior.md` (search: "Recurring terminal bugs must start with learning-loop retrieval"). The `skill-preamble.md` retrieval guidance told agents to grep, but skipped or poorly-aimed retrieval was silent.

The 1.9.0 prototype (archived at `.goat-flow/plans/_archived/1.9.0/M01-learning-loop-index-prototype.md`) measured 310 active entries across the four buckets and scored 5/5 on a cold-agent routing test using one-line index rows. At generation time (2026-06-10) the generated indexes carry 354 rows: 78 footguns, 212 lessons, 29 patterns, and 35 ADRs. A unified always-loaded index would be far too large; the footguns index alone is ~80 lines.

## Decision

Generated per-bucket `INDEX.md` files for `.goat-flow/learning-loop/{footguns,lessons,patterns,decisions}/`, produced by the `goat-flow index` CLI command (`src/cli/learning-loop-index/`) and committed to version control.

One unified row schema applies to all four buckets (user ruling 2026-06-10), replacing the three previously distinct hand-maintained shapes:

```markdown
- [Title](bucket-file.md) (search: "<entry heading line>") - short hook
```

Hooks are extracted mechanically (first sentence after `**Symptoms:**` / `**What happened:**` / `**Context:**`; for ADRs the verbatim `**Status:**` plus `**Date:**` plus the first `## Decision` sentence) - never hand-curated. Decisions rows carry status verbatim so retrieval does not follow superseded decisions blind. The `(search: "...")` anchor is the entry's heading line, grep-friendly per ADR-024 rather than line numbers or renderer-specific heading slugs.

Generated output contains nothing clock-derived (no timestamps, no `last_reviewed`): `goat-flow stats --check` re-runs the generator in memory and compares content (`index-fresh`), so any time-dependence would read as permanent staleness. A stale index is a blocking `index-stale` finding; a never-generated index is an advisory `index-missing` warning so fresh installs do not false-fail.

The load model is mandatory Step 0 read, not always-loaded instruction content: `skill-preamble.md` Learning-Loop Retrieval directs every skill's Step 0 to read the relevant INDEX.md before grepping individual entries (landed with 1.11.0 M05/M06; M06 adds the required `Relevant prior learnings:` emission so skipped retrieval becomes visible).

## Failure Mode Comparison

| Option | What fails | Decision |
| --- | --- | --- |
| Keep grep-only doctrine | Agents must guess terms and can silently miss known entries. | Rejected. The failure is already documented in active lessons. |
| Single unified always-loaded index | 350+ active entry lines before headers; grows with every learning-loop entry. | Rejected for context cost. |
| Per-bucket always-loaded indexes | Footguns alone is ~80 lines; lessons is 212 entry lines. | Rejected for hot-path context cost. |
| Per-bucket generated indexes read during Step 0 | Costs an explicit read during skill intake and requires freshness tooling. | Accepted. |
| Hand-maintained indexes | Counts and rows drift from bucket content; the lessons index carried a manual "update its count and date here" rule that depended on discipline. | Rejected; replaced by deterministic generation plus the `index-fresh` check. |

## Reversibility

Two-way door. Remove the generated `INDEX.md` files, the `index` command, the `index-fresh` check, and the Step 0 reference; the source learning-loop entries remain unchanged and continue to work with grep.

Revisit if the generator cannot stay deterministic, if `index-fresh` becomes flaky (false-fresh or false-stale on identical content), or if M06 pressure-testing shows agents can satisfy `Relevant prior learnings:` without actually consulting the indexes.
