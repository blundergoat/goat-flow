# ADR-024: Flush protocol checkbox enforcement

**Status:** Superseded by ADR-028
**Date:** 2026-04-04
**Context:** The same checkbox-ticking failure occurred twice in 4 days (M1 on 2026-03-31, M29 on 2026-04-04). In both cases the agent completed all tasks, ran verification, marked the milestone done, and ticked zero checkboxes. The CLAUDE.md VERIFY rule ("MUST tick `- [x]` on each task as it's completed - not at the end") was known and ignored because parallel agent orchestration displaced the tracking step. Behavioral reminders are insufficient - the failure recurred despite a documented lesson.

## Options evaluated

- **Option A: Flush protocol extension** - Add checkpoint verification to the existing flush protocol (fires at 10+ tool calls). One-line change to shared conventions. Forces checkbox ticking at regular intervals during execution.
- **Option B: Hook-based enforcement** - PostToolUse hook that detects active milestone files and injects a reminder. Rejected: hooks live in uncommitted `.claude/` config that gets deleted, not a durable fix.
- **Option C: Scanner rubric check** - Compare git-changed files against milestone checkboxes in CI. Rejected: catches false positives on planned features, templates, and docs that mention files but haven't changed them yet. After-the-fact detection, not prevention.

## Decision

**Option A.** Extend the flush protocol to include checkpoint verification.

The flush protocol already fires at 10+ tool calls without a gate/checkpoint. Adding step (2) - "if working from a plan/milestone file: tick all completed checkboxes NOW before continuing" - makes checkbox ticking a structural part of the execution loop rather than a behavioral expectation.

## Change

Shared conventions flush protocol line changed from:
```
(1) write 3-sentence status, (2) ask: continue, compact, or redirect?
```
To:
```
(1) write 3-sentence status, (2) if working from a plan/milestone file: tick all completed checkboxes NOW before continuing, (3) ask: continue, compact, or redirect?
```

Applied to: all 5 skill templates, all 15 installed copies (3-way), canonical preamble.

## Consequences

- Checkbox ticking becomes part of the flush protocol, not a separate behavioral rule
- Maximum gap between work completion and checkbox ticking is ~10 tool calls
- No new infrastructure needed - leverages existing flush mechanism
- Does not prevent the first 10-call gap, but prevents the "entire milestone with zero ticks" failure mode
- The flush protocol now has 3 steps instead of 2, adding ~15 words to each skill's shared conventions
