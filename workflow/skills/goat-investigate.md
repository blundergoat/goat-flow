# Prompt: Create /goat-investigate Skill

Paste this into your coding agent to create the `/goat-investigate` skill for your project.

---

## The Prompt

```
Create the /goat-investigate skill for this project.

## When to Use

Use when investigating a codebase area to understand how it works —
exploring an unfamiliar subsystem, understanding before refactoring,
mapping dependencies, or onboarding to a new domain.

Purpose: deep codebase investigation producing a structured research
document. The agent gathers context, confirms scope with the user,
reads in progressive layers, and reports findings before any planning
or implementation begins.

Write the skill file to: .claude/skills/goat-investigate/SKILL.md
(For Codex/Gemini: .agents/skills/goat-investigate/SKILL.md)

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
- Read budget: estimated number of files to read before pausing

Ask the user: "Does this scope look right, or should I include/exclude
anything?" Wait for confirmation before reading.

## Phase 2 - Read

### Progressive Depth

Read in layers: entry points first, then critical path, then
supporting files. Do NOT read everything at once.

1. Entry points — main interfaces, exports, config files
2. Critical path — the core logic the user asked about
3. Supporting files — helpers, utilities, tests, adjacent modules

After reaching the read budget, pause: "I've read [N] files.
Want me to go deeper or present what I have?"

### Systematic Reading

- Follow imports, dependencies, and cross-references
- Note data flow paths and ownership boundaries
- Note anything surprising or undocumented
- Noise awareness: drop irrelevant search results rather than
  accumulating them (semantic noise is worse than no results)

## Phase 3 - Document

### TL;DR (start here)

Start with a 3-sentence summary. The human should understand
the key finding within 10 seconds.

### Full Report

Present findings structured as:
- Overview (2-3 sentence summary)
- Components (table: component, location, purpose)
- Data Flow (how information moves, with file:line references)
- Boundaries Touched (what's a boundary and why)
- Risks / Gotchas (minimum 3, with file:line evidence)
- Findings (what we learned, with evidence — tagged as below)
- Open Questions (what couldn't be determined and why)
- What I Didn't Read (files in scope but not read, and why)
- Recommendation (what to do next — pending human review)

### Evidence Quality Tags

Tag each finding:
- OBSERVED — directly verified in code with file:line evidence
- INFERRED — deduced from patterns, documentation, or naming
  conventions; not directly verified

### Current vs Expected State

For each significant finding, capture both sides:
- Current state: what exists in the code right now
- Expected state: what should exist, or what the user expected

### Severity Scale

Prioritize findings: SECURITY > CORRECTNESS > INTEGRATION >
PERFORMANCE > STYLE

Every claim backed by file:line reference.
Flag unknowns: "I couldn't determine X because Y."

## Phase 4 - Gate

HUMAN GATE: Present your findings (TL;DR first). Then ask:
"Want me to (a) go deeper on a specific component, (b) check a
boundary I missed, (c) map a different area entirely, or (d) close
the investigation?"

Do NOT proceed to planning or implementation. Wait for the human to
confirm understanding is correct. Human may redirect.

### Link to Next Action

After the human is satisfied, recommend the next step:
- goat-plan — this area needs planning work
- goat-debug — found a bug during investigation
- close — question answered, no further action needed

The skill MUST:
- Gather context before investigating (Step 0)
- Confirm scope with the user before reading (Phase 1)
- Read in progressive depth: entry points, critical path, supporting files
- Complete the read phase before writing findings
- Provide file:line evidence for every claim
- Tag findings as OBSERVED or INFERRED
- Include "What I Didn't Read" section
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
- Verify progressive depth reading (Phase 2)
- Verify TL;DR output format (Phase 3)
- Verify hard gate with conversational choices (Phase 4)
- Verify output format template is included
- Verify Learning Loop section is present
- Verify Chains With section is present

## Output

TL;DR (3 sentences), then structured research document with:
Components table, Data Flow, Boundaries, Risks/Gotchas (3+),
Findings (tagged OBSERVED/INFERRED with current/expected state),
Open Questions, What I Didn't Read, Recommendation. All claims
backed by file:line references.

## Learning Loop

If this run uncovered a lesson or footgun, update the relevant
doc before closing:
- Behavioural mistake -> docs/lessons.md
- Architectural trap with file:line evidence -> docs/footguns.md

## Chains With

- goat-plan — investigated area needs planning work
- goat-debug — found a bug during investigation
```
