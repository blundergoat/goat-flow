# GOAT Debug

## When to Use

Use when a bug, failed validation, or broken reference needs diagnosis and the root cause is not yet proven.

## Process

1. Define the symptom, trigger, and expected behaviour.
2. Trace the actual path through docs, scripts, or templates with file:line evidence.
3. Follow cross-boundary dependencies: spec -> setup -> workflow -> generated artifact.
4. Write the chain `trigger -> propagation -> symptom`.
5. Stop after diagnosis and wait for human review before proposing a fix.

If you want to "just try something" before tracing the code path, STOP.

## Constraints

- MUST read actual files before forming hypotheses
- MUST provide file:line evidence for every finding
- MUST complete diagnosis before entering fix phase
- MUST stop and wait for human review between diagnosis and fix
- MUST NOT skip to fixing without completing investigation
- MUST NOT fabricate file paths or line numbers
- MUST NOT apply fixes without human approval of diagnosis

## Output

```md
## Investigation: [problem]

### Root Cause
[one sentence with file:line evidence]

### Evidence Trail
1. [file:line] - [what this proves]
2. [file:line] - [how the issue propagates]
3. [file:line] - [where the symptom appears]

### Affected Files
- [path] - [impact]

### Confidence
High / Medium / Low - [what is verified vs inferred]

### Fix Direction
Pending human review
```
