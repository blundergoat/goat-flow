# ADR-050: No separate goat-audit skill

**Status:** Accepted
**Date:** 2026-08-07
**Ticket/Context:** `.goat-flow/plans/1.16.0/ISSUE.md` (usage-insights review section); insight reports at `.goat-flow/scratchpad/claude-insights/` (local, gitignored)

## Context

Three Claude Code usage-insights reports (reviewed 2026-08-07, ~434 hours across this repo and two consumer projects) showed the user hand-writing a near-identical "rigorous read-only quality audit of my goat-flow setup" prompt in eight or more separate sessions. The initial improvement analysis and an external peer-agent review both surfaced the obvious response: a dedicated `/goat-audit` skill.

Verification against shipped source showed the capability already exists in two places:

- The composed `quality` prompt (`src/cli/prompt/compose-quality-static-sections.ts`, search: `Negative verification is mandatory`) already encodes the requested contract: read-only mode vocabulary, disproval required before any finding is reported, evidence anchors, a JSON report, and a "What You Did Not Verify" closing section.
- `/goat-review` full depth covers "area audit + DoD cross-checks", and its trigger list already claims the phrase "audit X".

A third owner of "audit" would compete with that routing on every invocation. Each shipped skill also carries the documented lock-step cost - four install mirrors, dispatcher routing, quality-prompt probes, docs, and the multi-surface sweep (`.goat-flow/learning-loop/footguns/docs-and-crossrefs.md`, search: `lock-step updates across 13+ surfaces`).

## Decision

Do not create a `/goat-audit` skill. Treat the measured problem as discoverability and output quality, not missing capability:

- 1.16.0 M08 makes the existing quality report carry a mechanically validated refutation ledger, so disproved candidates become visible instead of silently discarded.
- A 1.16.0 backlog item routes "audit my goat-flow setup" phrasing from `/goat` toward the composed quality prompt.

## Revisit Trigger

Re-open this decision only if ad-hoc audit prompts persist after both fixes land. That would be evidence the quality prompt's harness-quality shape (per-skill probes, setup scoring) is materially different from the audits actually being requested (general repo or doc-tree audits) - the bar a new skill must meet. Frequency of the word "audit" in requests does not by itself qualify.

## Failure Mode Comparison

| Option | What fails | Why rejected or accepted |
| --- | --- | --- |
| New `/goat-audit` skill now | "audit X" routing splits across three owners; permanent multi-surface maintenance for a need two surfaces already serve | Rejected |
| Do nothing | The user keeps re-typing the audit contract; refuted candidates stay invisible | Rejected |
| Ledger plus dispatcher routing | If the prompt-shape mismatch is real, discoverability alone will not stop the re-typing | Accepted; the revisit trigger names exactly that residual signal |

## Consequences

- Quality assessments gain the refutation ledger without a new invocation surface.
- The dispatcher, not a new skill, owns audit-phrasing discoverability.
- A future maintainer or quality assessor proposing an audit skill must check the revisit trigger first; proposing it without that evidence re-litigates a settled decision.

## Reversibility

Two-way door. Creating the skill later loses nothing done under this decision - the ledger and routing work stays useful either way.
