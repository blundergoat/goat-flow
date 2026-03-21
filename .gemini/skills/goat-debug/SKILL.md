---
description: "Diagnose a bug with evidence before proposing fixes"
---
# /goat-debug

Diagnosis-first root cause analysis.

## When to Use

When a bug is reported, a test fails, or behavior is unexpected.

## Process

1. **Reproduction:** Confirm the failure with a test case or script.
2. **Trace:** Trace the code path from input to error.
3. **Evidence:** Gather file:line evidence for the root cause.
4. **Diagnosis:** State the root cause clearly before proposing a fix.

## Constraints

- MUST NOT "just try something" without a trace.
- MUST reproduce the issue before fixing.
- MUST provide file:line evidence for the diagnosis.

## Output Format

```
## Debug Diagnosis: [Issue]

### Reproduction
- [Command/Test used to reproduce]
- [Observed vs Expected]

### Trace & Evidence
- [file:line] - [description of findings]

### Root Cause
[One-sentence diagnosis]
```
