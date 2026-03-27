---
name: goat-debug
description: "Diagnose a bug with evidence before proposing fixes"
goat-flow-skill-version: "0.7.0"
---
# /goat-debug

Diagnosis-first debugging. Investigate before fixing. The agent MUST NOT propose fixes until the human reviews the diagnosis.

## When to Use

Use when diagnosing a bug or unexpected behavior — especially when the root cause is unclear or spans multiple components.

---

## Step 0 — Gather Context

Ask the user before investigating:

1. **What's the symptom?** (error message, unexpected behaviour, test failure)
2. **How do you reproduce it?** (steps, command, or "it happens intermittently")
3. **When did it start?** (after a specific change, always been there, or unknown)
4. **What have you already tried?** (so the agent doesn't repeat dead ends)
5. **How long before escalating?** (default: 15 min or 10 turns — after that, present what you have even if incomplete)

Do NOT start investigating until the user has answered. If the user says "it's broken, fix it", ask these questions first — blind debugging is the failure mode this skill prevents.

---

## Phase 1 — Investigate (no fixes)

**If you want to "just try something" before tracing the code path, STOP.** That impulse is the failure mode this skill prevents.

### Recurrence Check

Before investigating, search `docs/footguns.md` + `docs/lessons.md` + `agent-evals/` for the symptom or area. If a match is found, present it first: "This area has a known issue: [footgun]. Is this the same problem?" Only proceed to fresh investigation after the user confirms it's a new issue.

### Hypothesis Tracking

Write 2-3 hypotheses before tracing. After tracing, mark each as CONFIRMED, ELIMINATED, or UNRESOLVED with evidence.

### Investigation Steps

- Read the actual files involved, tracing references end-to-end
- Identify the failure point with file:line evidence
- Check related files for cascading effects
- Document the chain: trigger → propagation → symptom
- Check `docs/footguns.md` — has this area bitten someone before?

---

## Phase 2 — Report findings

Present the diagnosis to the user. For every claim, provide file:line evidence.

- State the root cause (not just the symptom)
- List all affected files
- Rank by severity: SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE
- Note uncertainty: "I believe X because Y, but haven't verified Z"
- Rate confidence:
  - **High** = reproduced with a test
  - **Medium** = traced with file:line evidence, not yet reproduced
  - **Low** = inferred from code reading

### Can't Reproduce?

If the bug cannot be reproduced: document what was checked, conditions ruled out, and what information is still needed. Don't guess — say what you know and what you don't.

**HUMAN GATE:** Present your findings. Then ask: "Want me to (a) trace deeper into a specific area, (b) check related code for cascading effects, (c) propose a fix, or (d) check footguns for similar past issues?"

Do NOT auto-advance to Phase 3. Let the human challenge the diagnosis, ask about alternatives, or redirect the investigation.

---

## Phase 3 — Propose fix (only after human approves Phase 2)

- Propose a fix plan (not the fix itself — this is still Plan mode)
- If the human disagrees with the diagnosis, return to Phase 1
- If the human approves, ask: "Should I implement this fix, or do you want to do it?"

---

## Phase 4 — Post-Fix Verification (only after human says fix is applied)

This phase activates ONLY when the human confirms a fix has been applied. Do not enter this phase unprompted.

- Re-run the investigation trace from Phase 1
- Confirm the divergence point is resolved
- If resolved: confirm fix and note which hypothesis was correct
- If NOT resolved: report what changed and what didn't, then return to Phase 1

---

## Constraints

- MUST gather context before investigating (Step 0)
- MUST check for recurrence before fresh investigation (Phase 1)
- MUST read actual files before forming hypotheses
- MUST provide file:line evidence for every finding
- MUST complete Phase 2 before entering Phase 3
- MUST stop and wait for human review between Phase 2 and Phase 3
- MUST NOT skip to fixing without completing investigation
- MUST NOT fabricate file paths or line numbers
- MUST NOT apply fixes without human approval of diagnosis
- MUST NOT enter Phase 4 unless the human says a fix was applied

## Output Format

```
## Investigation: [description]

### Hypotheses
1. [hypothesis] — [CONFIRMED/ELIMINATED/UNRESOLVED] — [evidence]

### Root Cause
[One sentence with file:line reference]

### Evidence Trail
1. [file:line] - [what this shows and why it matters]
2. [file:line] - [how the issue propagates]
3. [file:line] - [where the symptom appears]

### Affected Files
- [file] - [how it's affected]

### Severity
[SECURITY/CORRECTNESS/INTEGRATION/PERFORMANCE/STYLE]

### Confidence
[High/Medium/Low] - [what's verified vs hypothesised]

### Proposed Fix (pending human review)
[Fix plan — only after human approves diagnosis]
```

## Learning Loop

If this run uncovered a lesson or footgun, update the relevant doc before closing:
- Behavioural mistake → `docs/lessons.md`
- Architectural trap with file:line evidence → `docs/footguns.md`

## Chains With

- goat-investigate — dig deeper into the root cause area
- goat-test — regression test after fix is applied
