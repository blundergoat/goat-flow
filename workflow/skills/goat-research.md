# Prompt: Create /goat-research Skill

Paste this into your coding agent to create the `/goat-research` skill for your project.

---

## The Prompt

```
Create the /goat-research skill for this project.

Purpose: deep codebase investigation producing a structured research
document. The agent reads thoroughly and reports findings before any
planning or implementation begins. The hard gate is that no planning
happens until the human reviews the research output.

Write the skill file to: .claude/skills/goat-research/SKILL.md
(For Codex: docs/codex-playbooks/goat-research.md)

When to use: exploring an unfamiliar area of the codebase, investigating
a new domain, understanding how a system works before changing it,
or mapping dependencies before a refactor.

The skill follows this process:

1. Scope - Define what's being researched and why:
   - What question are we answering?
   - What files/directories are in scope?
   - What's explicitly out of scope?

2. Read - Systematic deep read of the scoped area:
   - Read every file in scope, not just the obvious ones
   - Follow imports, dependencies, and cross-references
   - Note data flow paths and ownership boundaries
   - Note anything surprising or undocumented

3. Document - Write findings to a research document:
   - Structure: Overview → Components → Data Flow → Findings → Questions
   - Every claim backed by file:line reference
   - Flag unknowns explicitly: "I couldn't determine X because Y"
   - Note cross-boundary dependencies and coupling points

4. Gate - Stop and wait for human review:
   - Present the research document
   - Do NOT proceed to planning or implementation
   - Wait for human to confirm understanding is correct
   - Human may redirect: "also look at X" or "that's wrong because Y"

The skill MUST:
- Complete the read phase before writing findings
- Provide file:line evidence for every claim
- Stop after presenting findings - no planning until human reviews
- Flag uncertainties and unknowns explicitly

The skill MUST NOT:
- Skip to planning or implementation before research is reviewed
- Fabricate file paths, function names, or behaviour
- Assume how code works without reading it
- Produce vague summaries without file:line specifics

Output format:
## Research: [topic]

### Scope
- Question: [what we're investigating]
- In scope: [files/directories]
- Out of scope: [what we're not looking at]

### Overview
[2-3 sentence summary of the area]

### Components
| Component | Location | Purpose |
|-----------|----------|---------|
| [name] | [file:line] | [what it does] |

### Data Flow
[How data moves through the components, with file:line references]

### Findings
1. [finding with file:line evidence]
2. [finding with file:line evidence]

### Open Questions
- [thing I couldn't determine and why]

### Recommendation
[What to do next - pending human review]

VERIFICATION:
- Verify skill file exists at the correct path
- Verify hard gate (no planning until human reviews)
- Verify output format template is included
- Verify scope/overview/components/findings/questions sections
```
