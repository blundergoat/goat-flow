# GOAT Research

## When to Use

Use before planning or implementation in an unfamiliar area, when tracing a cross-doc concept, or when mapping dependencies before a refactor.

## Process

1. Define the question, scope, and explicit non-goals.
2. Read every file in scope and follow references, imports, and generated outputs.
3. Capture ownership boundaries and request flow.
4. Record at least 3 risks or gotchas with file:line evidence.
5. Stop after presenting the research summary.

Hard gate: no planning or implementation until the human reviews the research output.

## Output

```md
## Research: [topic]

### Files Involved
- [path] - [why it matters]

### Request Flow
1. [file:line] - [step in the flow]
2. [file:line] - [next step]

### Boundaries Touched
- [boundary] - [why it matters]

### Risks / Gotchas
1. [file:line] - [risk]
2. [file:line] - [risk]
3. [file:line] - [risk]

### Open Questions
- [unknown and why]

### Recommendation
Pending human review
```
