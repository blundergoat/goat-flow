# Decision Debt: M08 RED baselines did not reproduce the target failure classes

**Created:** 2026-04-18
**Status:** open
**Context:** M08 skill TDD for `goat-critique`, `goat-review`, and `goat-qa`
**Plan:** `.goat-flow/tasks/1.2.0/M08-skill-tdd-rationalization.md`

## Decision

Skip GREEN / REFACTOR for the three M08 RED passes below and ship the skills unchanged.

- `goat-critique` (§2)
- `goat-review` (§3)
- `goat-qa` (§4)

Each skill keeps its `tdd-log:` frontmatter pointing at the RED session log that captured the failed reproduction attempt.

## Evidence By Skill

### goat-critique (§2)

**Session log:** `.goat-flow/logs/sessions/2026-04-18-goat-critique-tdd.md`

- Three RED iterations against the Appendix B.1 scenario produced **zero captured rationalizations from the target class**
- All three iterations rationalized against agent-tool dispatch instead of reproducing the target failure
- Zero agent-tool dispatches and zero tool calls were recorded across the run
- The documented target lesson from `.goat-flow/lessons/agent-behavior.md:108-118` did not reproduce

**Why no GREEN:** the plan forbids pre-seeding counters when RED did not capture the target class, and the off-target responses partially overlapped with the skill's own scope gate

### goat-review (§3)

**Session log:** `.goat-flow/logs/sessions/2026-04-18-goat-review-tdd.md`

- Two RED iterations against the Appendix B.2 scenario produced **zero rationalizations from the negative-verification-skipping class**
- Both iterations recommended request-changes
- Both caught real seeded bugs, and both found an unseeded higher-severity IDOR issue
- Both explicitly named and rejected the pressure cues as non-technical arguments

**Why no GREEN:** the plan's kill gate fired after two attempts, and the baseline behavior was stronger than the failure class the section was trying to reproduce

### goat-qa (§4)

**Session log:** `.goat-flow/logs/sessions/2026-04-18-goat-qa-tdd.md`

- Two RED iterations against the Appendix B.3 scenario produced **zero Step-0-skip or fabricated-estimate rationalizations**
- Both iterations pushed back on framing before planning
- Both explicitly refused to invent time estimates
- Both named the pressure signals and rejected them with reasons

**Why no GREEN:** the §4 kill gate fired after the plan-specified floor, and no valid captured rationalization existed to encode

## Shared Conclusions

Across all three sections, the RED baseline failed to reproduce the intended failure class even under 3-pressure scenarios. The repeated pattern suggests one or both of:

1. The current model baseline is more resistant to these documented rationalization classes than the earlier incident set
2. The authored scenarios telegraph the test too clearly and invite meta-cognitive rejection instead of organic failure

That conclusion is strong enough to preserve as decision debt, but not strong enough to justify inventing counters without captured RED evidence.

## Re-entry Triggers

Reopen the relevant section only if one of these occurs:

- A real user session captures the target rationalization class in the wild
- A new scenario that does not telegraph the shortcut reproduces the target class across at least 2 iterations
- A future model release reintroduces the class in spot checks
- The relevant skill is materially restructured and needs a fresh RED baseline

## What Shipped

- RED session logs for critique, review, and qa
- `tdd-log:` frontmatter on each skill
- Installed copies updated to match the workflow copy
- Drift checks with zero findings for those updates

## Replaces

This consolidated note replaces the three per-skill records that now remain only as historical stubs:

- `2026-04-18-goat-critique-tdd-no-target-repro.md`
- `2026-04-18-goat-review-red-no-repro.md`
- `2026-04-18-goat-qa-red-no-repro.md`
