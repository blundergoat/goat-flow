# Shared Skill Preamble

All goat-* skills follow these shared conventions. Skills inline these
sections rather than referencing this file at runtime. This document is the
canonical source - update here first, then propagate to skill templates.

---

## Severity Scale

SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE

Order findings by severity, not by file or discovery order.

## Evidence Standard

- Every finding MUST include `file:line` evidence
- MUST NOT fabricate file paths, function names, or behaviour
- Before presenting findings, re-read each cited `file:line` to confirm accuracy
- Tag evidence quality where applicable: **OBSERVED** (directly verified in code) vs **INFERRED** (deduced but not directly confirmed - state what direct evidence is missing)

## Learning Loop

After completing the skill, check if this run uncovered anything worth logging:
- Behavioural mistake (agent did something wrong) → add a `## Lesson:` or `## Pattern:` entry to the relevant category bucket in `ai-docs/lessons/` or `.goat-flow/lessons/`
- Architectural trap with `file:line` evidence → add a `## Footgun:` entry to the relevant category bucket in `ai-docs/footguns/` or `.goat-flow/footguns/`

Do not append to a monolithic log or directory README. Route team-wide entries to `ai-docs/lessons/` or `ai-docs/footguns/`; route machine/session-only entries to `.goat-flow/lessons/` or `.goat-flow/footguns/`.
Bucket conventions:
- Lessons: `verification.md`, `workflow.md`, `coordination.md`
- Footguns: `hooks.md`, `setup.md`, `scanner.md`

Use the standard entry formats:
```markdown
<!-- Lesson bucket -->
---
category: verification
---

## Lesson: [Title]
**Created:** YYYY-MM-DD
**What happened:** [description]
**Evidence:** `file:line` - [what was found]
**Prevention:** [rule to prevent recurrence]
```

```markdown
<!-- Footgun bucket -->
---
category: hooks
---

## Footgun: [Title]
**Status:** active
**Created:** YYYY-MM-DD
**Evidence type:** ACTUAL_MEASURED
**Symptoms:** [what breaks]
**Why it happens:** [root cause]
**Evidence:** `file:line` - [what was found]
**Prevention:** [rule to prevent recurrence]
```

## Human Gates

- **BLOCKING GATE** - agent MUST stop and wait for human decision before proceeding. Used for: scope approval, phase transitions where direction changes, final output review.
- **CHECKPOINT** - agent presents status and continues unless the human interrupts. Used for: progress reports between passes, intermediate findings. Format: "Phase N complete. [summary]. Continuing to Phase N+1."

Do NOT auto-advance past any BLOCKING GATE. CHECKPOINTs auto-advance by default.

## Adaptive Step 0

Skills that gather context before acting follow this pattern:

1. Read the user's invocation for context already provided
2. For each Step 0 question: if the answer is already clear from context → **confirm**: "I see [answer]. Correct?" Otherwise → **ask**
3. If ALL questions are answered by the invocation → present a condensed confirmation and proceed
4. If the user says "skip Step 0" or provides a detailed brief → confirm understanding and proceed

**The gate rule:** Step 0 MUST end with the agent presenting its understanding and waiting for the user before proceeding to Phase 1. Auto-detect pre-fills context - it does not replace human confirmation. Bare invocation with no arguments = zero context = ask all structural questions and wait.

Never hard-block when context is already available. The goal is to start moving, not to interrogate.

## Stuck Protocol

If 3 consecutive file reads produce no new signal relevant to the current question:
1. Present what you have so far
2. State what you were looking for and didn't find
3. Ask the human to redirect, narrow scope, or close

## Ceremony Level

Adapt ceremony to complexity. Do NOT run full ceremony on simple tasks.

| Complexity | Ceremony |
|------------|----------|
| Hotfix / Small Feature | Skip: closing ceremony, footgun MATCH/CLEAR annotations. Skip goat-plan Phases 2-3. |
| Standard | Full phases, gates at major decisions. |
| System / Infrastructure | Full phases + cross-boundary verification + rollback planning. |

**Sub-agent mode:** When invoked as a sub-agent (forked context), BLOCKING GATEs automatically become CHECKPOINTs (logged, not paused). Step 0 proceeds with auto-detected scope.

## Footgun Fast-Path

If Step 0's footgun check produces a direct match with a documented trap:
1. Surface the match immediately: "This matches known footgun X."
2. Offer the standard mitigation path from the footgun entry
3. Still require READ and VERIFY on the actual target files - footguns are incident records, not executable specs
4. Do NOT skip straight to implementation based on a footgun match alone

## Task Tracking

When working from a plan or milestone file in `.goat-flow/tasks/`:
- Tick each task `- [x]` immediately when completed — not at the end of a batch, not when you remember, not in the closing protocol
- The checkbox is the single source of truth for progress
- If interrupted, compacted, or crashed, the checkboxes are how the next session knows where to resume
- If you completed a task 3 steps ago and forgot to tick it — go tick it NOW before continuing

On `/compact` with no active milestone file: write a session log to `.goat-flow/logs/sessions/` summarizing current state. Milestone files are the primary continuity mechanism; session logs are the fallback.

## Recovery

When a skill fails mid-execution (context limit, sub-agent dies, tool error):

| Situation | Action |
|-----------|--------|
| Partial completion | Identify last completed step (last `[x]` checkbox in milestone file), resume from next |
| Missing artifacts | Return to the step that generates them, re-execute |
| User wants restart | Re-run from Step 0 |
| User wants to skip | Document skip reason in output, proceed to closing |

## Autonomy Awareness

Before proposing actions that change files, check the instruction file's Ask First
boundaries. If the proposed change crosses an Ask First boundary, flag it:
"This change touches [boundary]. Proceeding requires approval per Ask First rules."

## Closing Protocol

When the skill completes:
1. Verify all checkboxes in any active milestone/plan file are current
2. Check the Learning Loop (above) for anything worth logging
3. Write session log to `.goat-flow/logs/sessions/YYYY-MM-DD-slug.md` (what happened, files changed, decisions, learnings)
4. Suggest the most relevant next skill if applicable (see Chains With in each skill)
