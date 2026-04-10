# Skill Conventions

Read this file on **full-depth** invocations only. The essential preamble
in `skill-preamble.md` is always loaded first.

---

## Learning Loop — Entry Formats

Bucket conventions (examples — actual bucket names are project-specific):
- Lessons: category files like `verification.md`, `workflow.md`, `coordination.md`
- Footguns: category files like `runtime.md`, `integration.md`, `data-stores.md`

Do not append to a monolithic log or directory README. Route entries to `.goat-flow/lessons/`, `.goat-flow/patterns.md`, or `.goat-flow/footguns/`.

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
**hallucination-risk:** high
**Symptoms:** [what breaks]
**Why it happens:** [root cause]
**Evidence:** `file:line` - [what was found]
**Prevention:** [rule to prevent recurrence]
```

```markdown
# Successful Patterns

## Pattern: [Name]
**Context:** [when this approach works]
**Approach:** [what to do]
```

The `hallucination-risk` field is optional. Use it when an area is easy to misread from names alone, such as generated code, environment-specific config, or external API contracts.

## Adaptive Step 0

Before Step 0:

- If `.goat-flow/config.yaml` defines `toolchain`, prefer those commands over guessed defaults
- If `.goat-flow/config.yaml` defines `ask_first`, use it as structured boundary context alongside the instruction file
- Read the 2-3 most recent files in `.goat-flow/logs/sessions/` when the task overlaps recent work
- If a recent session log already covers the same area, prefer building on that context instead of re-deriving it

Then continue with the normal Step 0 flow:

Skills that gather context before acting follow this pattern:

1. Read the user's invocation for context already provided
2. For each Step 0 question: if the answer is already clear from context → **confirm**: "I see [answer]. Correct?" Otherwise → **ask**
3. If ALL questions are answered by the invocation → present a condensed confirmation and proceed
4. If the user says "skip Step 0" or provides a detailed brief → confirm understanding and proceed

**The gate rule:** Step 0 MUST end with the agent presenting its understanding and waiting for the user before proceeding to Phase 1. Auto-detect pre-fills context - it does not replace human confirmation. Bare invocation with no arguments = zero context = ask all structural questions and wait.

**Dispatcher invocation:** When a skill is invoked via `/goat`, Step 0 is the single entry gate. The dispatcher already announced the skill — Step 0 goes straight to its questions without re-announcing. There is no double-gate: one announcement from the dispatcher, one gate (Step 0) in the skill.

Never hard-block when context is already available. The goal is to start moving, not to interrogate.

## Contradiction Check

If the user's stated complexity doesn't match the actual scope, flag it:
- "hotfix" but 5+ files affected → likely Standard or System
- "small feature" but crosses 3+ boundaries → likely System
- "quick test" but 20+ functions in target → warn scope is larger than implied

Surface the mismatch, suggest re-classification. Don't silently proceed.

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
3. If the entry carries `hallucination-risk: high`, re-read the live file/config before trusting names or inferred behavior
4. Still require READ and VERIFY on the actual target files - footguns are incident records, not executable specs
5. Do NOT skip straight to implementation based on a footgun match alone

## Task Tracking

When working from a plan or milestone file:
- Tick each task `- [x]` immediately when completed — not at the end of a batch, not when you remember, not in the closing protocol
- The checkbox is the single source of truth for progress
- If interrupted, compacted, or crashed, the checkboxes are how the next session knows where to resume
- If you completed a task 3 steps ago and forgot to tick it — go tick it NOW before continuing

On `/compact` with no active milestone file: write a session log to `.goat-flow/logs/sessions/` summarizing current state. Milestone files are the primary continuity mechanism; session logs are the fallback.

Use `.goat-flow/logs/sessions/` for session summaries. Compact at ~60% context.

Sub-agents: one objective, structured return, 5-call budget.

When blocked: ask one question with a recommended default.

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
4. Suggest the most relevant next skill if applicable
