# GOAT Investigate

## When to Use

Use before planning or implementation in an unfamiliar area, when tracing a cross-doc concept, mapping dependencies before a refactor, or investigating a domain.

## Process

1. **Scope:** Define what's being researched and why. List files/directories in scope. State what's explicitly out of scope.
2. **Read:** Read every file in scope, not just the obvious ones. Follow cross-references and internal links. Note data flow paths, ownership boundaries, and anything surprising or undocumented. Drop irrelevant results rather than accumulating noise.
3. **Document:** Structure as Overview → Components → Data Flow → Findings → Questions. Every claim backed by file:line reference. Flag unknowns: "I couldn't determine X because Y."
4. **Gate:** Present findings. Do NOT proceed to planning or implementation. Wait for human to confirm understanding is correct.

Hard gate: no planning or implementation until the human reviews the research output.

## Constraints

- MUST complete reading before writing findings
- MUST provide file:line evidence for every claim
- MUST stop after presenting findings — no planning until human reviews
- MUST flag uncertainties and unknowns explicitly
- MUST NOT skip to planning before research is reviewed
- MUST NOT fabricate file paths, content, or behaviour
- MUST NOT produce vague summaries without file:line specifics

## Output

```md
## Research: [topic]

### Scope
- Question: [what we're investigating]
- In scope: [files/directories]
- Out of scope: [what we're not looking at]

### Overview
[2-3 sentence summary]

### Components
| Component | Location | Purpose |
|-----------|----------|---------|
| [name] | [file:line] | [what it does] |

### Data Flow
[How information moves through the components, with file:line references]

### Boundaries Touched
- [boundary] - [file:line] - [why this is a boundary]

### Risks / Gotchas (minimum 3)
1. [file:line] - [risk]
2. [file:line] - [risk]
3. [file:line] - [risk]

### Findings
1. [finding with file:line evidence]
2. [finding with file:line evidence]

### Open Questions
- [unknown and why]

### Recommendation
Pending human review
```
