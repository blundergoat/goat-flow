# /goat-debug

Diagnosis-first debugging. Investigate before fixing.

## When to Use

When a bug, broken cross-reference, or inconsistency needs diagnosis — especially when the root cause is unclear or spans multiple files.

## Process

### Phase 1 — Investigate (no fixes)
- Read the actual files involved, tracing references end-to-end
- Identify the failure point with file:line evidence
- Check related files for cascading effects
- Document the chain: trigger → propagation → symptom

### Phase 2 — Report findings
- Write diagnosis with file:line evidence for every claim
- State the root cause (not just the symptom)
- List all affected files
- Note uncertainty: "I believe X because Y, but haven't verified Z"

### Phase 3 — Propose fix (only after human reviews Phase 2)
- Wait for human to review the diagnosis
- Only then propose a fix plan
- If human disagrees, return to Phase 1

**If you want to "just try something" before tracing the code path, STOP.** That impulse is the failure mode this skill prevents.

## Constraints

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
