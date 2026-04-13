# ADR-034: Expand quality checks from 15 to 26

**Date:** 2026-04-12
**Status:** Accepted

## Context

The harness article (`000-harness-article_v04.md`) promises the audit deterministically rates 5 harness concerns: Context, Constraints, Verification, Recovery, and Feedback Loop. Comparison with the actual quality checks revealed 6 gaps where the article claims the audit checks something it doesn't.

Key gaps: unregistered linters from package manifests, testing gates in milestone files, feedback loop recency, hook validation honesty, execution loop detection, and architecture staleness.

Additionally, 6 facts already gathered by the facts system (`postTurnHasValidation`, `postTurnSwallowsFailures`, `compactionHookExists`, `denyBlocksPipeToShell`, `staticAnalysis`, `instruction.sections`) were completely unused by quality checks.

## Decision

Add 11 new quality checks that close the gap between the article's claims and the audit's actual coverage. Use already-gathered facts where possible (8 of 11). Use inline `ctx.fs.readFile()` for the remaining 3, following the existing pattern used by `milestone-files` and `session-logs` checks.

All checks are fully deterministic - no LLM calls, no randomness, no network I/O. The only time-dependent check (`feedback-recency`) compares dates from file content against a 90-day window, which is deterministic for the same filesystem state on the same day.

## Alternatives considered

1. **Add checks to the facts extractors first, then use in quality checks** - Rejected. The 3 checks needing file reads can do them inline, same as existing checks. Adding facts extractors would mean touching more files for no benefit.

2. **Make feedback recency configurable** - Deferred. 90 days is generous. Can add config later if projects need different thresholds.

3. **Add checks to the rubric system instead** - Rejected. The rubric and quality checks are separate systems. Quality checks (`--harness`) score the 5 concerns and never block CI. The rubric scores individual check definitions. The new checks belong in quality because they measure concern-level effectiveness, not individual check compliance.
