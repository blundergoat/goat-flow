# Prompt: Create /goat-investigate Skill

Paste this into your coding agent to create the `/goat-investigate` skill for your project.

---

## The Prompt

```
Create the /goat-investigate skill for this project.

Purpose: deep codebase investigation producing a structured research
document. The agent gathers context, confirms scope with the user,
reads thoroughly, and reports findings before any planning or
implementation begins.

Write the skill file to: .claude/skills/goat-investigate/SKILL.md
(For Codex/Gemini: .agents/skills/goat-investigate/SKILL.md)

When to use: exploring an unfamiliar area of the codebase, investigating
a new domain, understanding how a system works before changing it,
or mapping dependencies before a refactor.

## Step 0 - Gather Context

Before investigating, the skill MUST ask the user:
1. What are we investigating? (subsystem, feature area, dependency, domain)
2. Why? (planning a change, understanding before refactoring, onboarding)
3. What do you already know? (so the agent doesn't waste time on known things)
4. Any specific questions? (or "just map it out")

Do NOT start reading until the user has answered. An investigation
without a clear question produces noise, not signal.

## Phase 1 - Scope

Based on the user's answers, define and present:
- Question: what we're investigating (one clear sentence)
- In scope: specific files/directories to read
- Out of scope: what we're NOT looking at

Ask the user: "Does this scope look right, or should I include/exclude
anything?" Wait for confirmation before reading.

## Phase 2 - Read

Systematic deep read of the scoped area:
- Read every file in scope, not just the obvious ones
- Follow imports, dependencies, and cross-references
- Noise awareness: drop irrelevant search results rather than
  accumulating them (semantic noise is worse than no results)
- Note data flow paths and ownership boundaries
- Note anything surprising or undocumented

## Phase 3 - Document

Present findings structured as:
- Overview (2-3 sentence summary)
- Components (table: component, location, purpose)
- Data Flow (how information moves, with file:line references)
- Boundaries Touched (what's a boundary and why)
- Risks / Gotchas (minimum 3, with file:line evidence)
- Findings (what we learned, with evidence)
- Open Questions (what couldn't be determined and why)
- Recommendation (what to do next — pending human review)

Every claim backed by file:line reference.
Flag unknowns: "I couldn't determine X because Y."

## Phase 4 - Gate

HUMAN GATE: Present the research document. Ask "Does this match your
understanding? Anything I should also look at?"
Do NOT proceed to planning or implementation. Wait for the human to
confirm understanding is correct. Human may redirect.

The skill MUST:
- Gather context before investigating (Step 0)
- Confirm scope with the user before reading (Phase 1)
- Complete the read phase before writing findings
- Provide file:line evidence for every claim
- Stop after presenting findings — no planning until human reviews
- Flag uncertainties and unknowns explicitly

The skill MUST NOT:
- Skip to planning or implementation before research is reviewed
- Fabricate file paths, function names, or behaviour
- Assume how code works without reading it
- Produce vague summaries without file:line specifics

VERIFICATION:
- Verify skill file exists at the correct path
- Verify Step 0 context gathering is present
- Verify scope confirmation step (Phase 1)
- Verify hard gate (no planning until human reviews)
- Verify output format template is included
```
