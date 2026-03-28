# Shared Skill Preamble

All goat-* skills follow these shared conventions. Skills inline these
sections rather than referencing this file at runtime. This document is the
canonical source — update here first, then propagate to skill templates.

---

## Severity Scale

SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE

Order findings by severity, not by file or discovery order.

## Evidence Standard

- Every finding MUST include `file:line` evidence
- MUST NOT fabricate file paths, function names, or behaviour
- Before presenting findings, re-read each cited `file:line` to confirm accuracy
- Tag evidence quality where applicable: **OBSERVED** (directly verified in code) vs **INFERRED** (deduced but not directly confirmed — state what direct evidence is missing)

## Learning Loop

After completing the skill, check if this run uncovered anything worth logging:
- Behavioural mistake (agent did something wrong) → `docs/lessons.md`
- Architectural trap with `file:line` evidence → `docs/footguns.md`

Use the standard entry format:
```markdown
### [Title]
**What happened:** [description]
**Evidence:** `file:line` — [what was found]
**Prevention:** [rule to prevent recurrence]
**created_at:** YYYY-MM-DD
```

## Human Gates

- **BLOCKING GATE** — agent MUST stop and wait for human decision before proceeding. Used for: scope approval, phase transitions where direction changes, final output review.
- **CHECKPOINT** — agent presents status and continues unless the human interrupts. Used for: progress reports between passes, intermediate findings. Format: "Phase N complete. [summary]. Continuing to Phase N+1."

Do NOT auto-advance past any BLOCKING GATE. CHECKPOINTs auto-advance by default.

## Adaptive Step 0

Skills that gather context before acting follow this pattern:

1. Read the user's invocation for context already provided
2. For each Step 0 question: if the answer is already clear from context → **confirm**: "I see [answer]. Correct?" Otherwise → **ask**
3. If ALL questions are answered by the invocation → present a condensed confirmation and proceed
4. If the user says "skip Step 0" or provides a detailed brief → confirm understanding and proceed

Never hard-block when context is already available. The goal is to start moving, not to interrogate.

## Stuck Protocol

If 3 consecutive file reads produce no new signal relevant to the current question:
1. Present what you have so far
2. State what you were looking for and didn't find
3. Ask the human to redirect, narrow scope, or close

## Working Memory

For tasks exceeding 5 turns within this skill:
- Maintain state in `tasks/todo.md`
- If interrupted or compacted, write `tasks/handoff.md`

## Autonomy Awareness

Before proposing actions that change files, check the instruction file's Ask First
boundaries. If the proposed change crosses an Ask First boundary, flag it:
"This change touches [boundary]. Proceeding requires approval per Ask First rules."

## Closing Protocol

When the skill completes:
1. Check if any working artifacts (draft docs, research notes, requirement files) should be committed or noted in `tasks/handoff.md`
2. Check the Learning Loop (above) for anything worth logging
3. Suggest the most relevant next skill if applicable (see Chains With in each skill)
