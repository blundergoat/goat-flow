---
name: goat-debug
description: "Diagnose a bug with evidence before proposing fixes"
---
# GOAT Debug

Diagnosis-first debugging. Investigate before fixing. The agent MUST NOT propose fixes until the human reviews the diagnosis.

---

## Step 0 — Gather Context

Ask the user before investigating:

1. **What's the symptom?** (error message, unexpected behaviour, test failure)
2. **How do you reproduce it?** (steps, command, or "it happens intermittently")
3. **When did it start?** (after a specific change, always been there, or unknown)
4. **What have you already tried?** (so the agent doesn't repeat dead ends)

Do NOT start investigating until the user has answered. If the user says "it's broken, fix it", ask these questions first — blind debugging is the failure mode this skill prevents.

---

## Phase 1 — Investigate (no fixes)

**If you want to "just try something" before tracing the code path, STOP.** That impulse is the failure mode this skill prevents.

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
- Note uncertainty: "I believe X because Y, but haven't verified Z"
- Rate confidence: High / Medium / Low

**HUMAN GATE:** Present the diagnosis. Ask: "Does this match what you're seeing? Should I investigate deeper, or does this diagnosis look right?"

Do NOT proceed to Phase 3 until the user confirms.

---

## Phase 3 — Propose fix (only after human approves Phase 2)

- Propose a fix plan (not the fix itself — this is still Plan mode)
- If the human disagrees with the diagnosis, return to Phase 1
- If the human approves, ask: "Should I implement this fix, or do you want to do it?"

---

## Constraints

- MUST gather context before investigating (Step 0)
- MUST read actual files before forming hypotheses
- MUST provide file:line evidence for every finding
- MUST complete Phase 2 before entering Phase 3
- MUST stop and wait for human review between Phase 2 and Phase 3
- MUST NOT skip to fixing without completing investigation
- MUST NOT fabricate file paths or line numbers
- MUST NOT apply fixes without human approval of diagnosis

## Output Format

```
## Investigation: [description]

### Root Cause
[One sentence with file:line reference]

### Evidence Trail
1. [file:line] - [what this shows and why it matters]
2. [file:line] - [how the issue propagates]
3. [file:line] - [where the symptom appears]

### Affected Files
- [file] - [how it's affected]

### Confidence
[High/Medium/Low] - [what's verified vs hypothesised]

### Proposed Fix (pending human review)
[Fix plan — only after human approves diagnosis]
```
