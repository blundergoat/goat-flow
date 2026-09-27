# ADR-021: goat-critique is a core feature, full delegated mode only

**Status:** Accepted
**Date:** 2026-04-19
**Updated:** 2026-09-05 - condensed; the "~130 lines" size claim is dropped because the skill is about 210 lines. Earlier amendments absorbed now-removed ADR-011 (critique is a core feature) on 2026-08-15 and made the lifecycle host-owned on 2026-08-30.

## Context

The skill once shipped two modes: Quick, with inline SKEPTIC/ANALYST/STRATEGIST passes in one reviewer context, and Full, with isolated sub-agents, cross-examination, and dispute gating. Quick produced artifact-shaped output without the mechanism that makes the skill worth invoking. Three named passes in one context are self-talk under three labels, and the skill's own text conceded it by forcing every split finding to "inconclusive" because cross-examination was skipped. The 2026-04-19 in-repo quality run landed in Quick because delegation authorization was implicit, and its headings implied coverage that one context never produced.

Proposals to remove, demote, or auto-skip critique recur in reviews, always framed as ceremony reduction. `/goat-review` already covers single-context multi-lens review.

## Decision

goat-critique runs in one mode: full delegated, and it remains a core feature.

**Standing rule.** Critique is never removed, demoted, or auto-skipped. Improvements reduce ceremony around critique, not the method. Skills install verbatim, so setup agents cannot compress critique sections (`workflow/setup/03-install-skills.md`). The dispatcher routes toward goat-plan and critique faster, not away from them. Future methodology scores how well critique improves plan quality, not how much time it adds.

**Mode contract.**
1. The mandatory lifecycle is Phases 1-5 plus Phase 5.5 meta-audit and Phase 5.6 outcome capture. Phase 1 spawns three isolated critique sub-agents, Phase 3 may spawn up to three cross-exam agents when disputes require them, and Phase 5.5 always spawns one meta-agent. No inline role-play substitute is permitted.
2. The lifecycle is host-owned. The host runs Phases 1-5.6, spawns the bounded roles, presents both human gates, and captures the Phase 5.6 response. A forked sub-agent asked to run goat-critique returns control before Phase 1, so shared sub-agent gate conversion never fires.
3. Skill-chained entry runs the full lifecycle and skips only intake confirmation.
4. One output template ships; the dual Quick/Full template is gone.
5. The `SKILLS_DOC_STALE_PHRASES` entry asserting "quick mode skips cross-examination" (`src/cli/audit/check-factual-semantic-drift.ts`, search: `SKILLS_DOC_STALE_PHRASES`) was removed, because it would false-positive on correct docs.

The original "if delegation is unavailable, redirect to `/goat-review`" rule was superseded on 2026-04-23: all four supported runtimes ship sub-agent delegation (`.goat-flow/learning-loop/lessons/agent-tooling.md`, search: `Sub-agent delegation is universal`).

## Failure Mode Comparison

| Option | What fails | Verdict |
| --- | --- | --- |
| Keep Quick mode with stronger guardrails | Inline passes cannot produce isolated-context diversity; a louder warning adds no agents | Rejected |
| Separate `/goat-critique-inline` entry point | Doubles the dispatcher surface for a form `/goat-review` already covers | Rejected |
| Default to Full, keep Quick opt-in | Full was already opt-in by authorization and Quick stayed the habit | Rejected |
| Merge into `/goat-review` with a multi-agent flag | goat-review gates on diff scope and blast radius, goat-critique on isolation and cross-examination; merging weakens both | Rejected |
| Full delegated only, host-owned | Users lose an inline multi-lens option and stored Quick prompts break at Step 0; the artifact now matches the work performed | Accepted |

## Consequences

- Open Questions appear only when cross-examination was inconclusive, not because it was skipped.
- The Core Trio lens survives inside every delegated sub-agent; only inline application retired.
- The shipped skill states the rule at `.claude/skills/goat-critique/SKILL.md` (search: `goat-critique runs only full delegated mode`) and spawns per (search: `Spawn all three sub-agents in parallel`); public docs at `docs/skills.md` (search: `goat-critique runs in one mode`).

## Revisit Triggers

Repeated demand for inline multi-lens critique that `/goat-review` does not cover; delegation becoming unavailable by default in a supported runtime; a lighter critique workflow emerging that makes this one feel ceremonial for standard work.
