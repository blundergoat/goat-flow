# /goat-research

Deep investigation of unfamiliar areas or domains.

## When to Use

Before starting any task that involves unfamiliar codebases, complex request flows, or cross-boundary changes.

## Process

1. **Scope:** Define what's being researched and why.
2. **Read:** Systematic deep read of the scoped area.
3. **Trace:** Follow the request flow or data flow through the system.
4. **Identify:** Call out risks, gotchas, and dependencies.

## Minimum Template

- **Files Involved:** List all files read with 1-sentence summaries.
- **Request Flow:** Step-by-step trace of how the data/request travels.
- **Boundaries Touched:** Which module/layer boundaries are crossed.
- **Risks/Gotchas:** Minimum 3 entries with file:line evidence.

## Constraints

- MUST NOT start planning until the research is complete.
- MUST NOT propose fixes during the research phase.
- MUST use file:line evidence for every gotcha.

## Output Format

```
## Research Results: [Title]

### Summary
[1-2 sentences]

### Files Read
- [file:line] - [description]

### Request Flow
1. [step]
2. [step]

### Boundaries & Risks
- **Boundary:** [name]
- **Risk:** [file:line] - [description]
```
