# /goat-investigate

Deep investigation producing a structured investigation document. No planning until human reviews.

## When to Use

Exploring an unfamiliar area of the repo, understanding how a subsystem works before changing it, mapping dependencies before a refactor, or investigating a domain for the competitive landscape.

## Process

### 1. Scope
- Define what's being researched and why
- List files/directories in scope
- State what's explicitly out of scope

### 2. Read
- Read every file in scope, not just the obvious ones
- Follow cross-references and internal links
- Note data flow paths and ownership boundaries
- Note anything surprising or undocumented
- Noise awareness: are search results adding signal or distractors?
  Drop irrelevant results rather than accumulating them in context

### 3. Document
- Structure: Overview → Components → Data Flow → Findings → Questions
- Every claim backed by file:line reference
- Flag unknowns: "I couldn't determine X because Y"
- Note cross-file dependencies and coupling points

### 4. Gate — Stop and wait for human review
- Present findings
- Do NOT proceed to planning or implementation
- Wait for human to confirm understanding is correct
- Human may redirect: "also look at X" or "that's wrong because Y"

## Constraints

- MUST complete reading before writing findings
- MUST provide file:line evidence for every claim
- MUST stop after presenting findings — no planning until human reviews
- MUST flag uncertainties and unknowns explicitly
- MUST NOT skip to planning before research is reviewed
- MUST NOT fabricate file paths, content, or behaviour
- MUST NOT produce vague summaries without file:line specifics

## Output Format

```
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

### Risks / Gotchas (minimum 3, with file:line evidence)
1. [risk with file:line evidence]
2. [risk with file:line evidence]
3. [risk with file:line evidence]

### Findings
1. [finding with file:line evidence]
2. [finding with file:line evidence]

### Open Questions
- [thing I couldn't determine and why]

### Recommendation
[What to do next — pending human review]
```
