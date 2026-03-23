---
name: goat-investigate
description: "Investigate a codebase area and report findings"
---
# /goat-investigate

## When to Use

Use when investigating a codebase area to understand how it works — exploring an unfamiliar subsystem, understanding before refactoring, mapping dependencies, or onboarding to a new domain. Produces a structured research document. No planning until human reviews.

---

## Step 0 — Gather Context

Ask the user before investigating:

1. **What are we investigating?** (subsystem, feature area, dependency, domain concept)
2. **Why?** (planning a change, understanding before refactoring, onboarding, debugging)
3. **What do you already know?** (so the agent doesn't waste time on known things)
4. **Any specific questions?** (or "just map it out")

Do NOT start reading until the user has answered. An investigation without a clear question produces noise, not signal.

---

## Phase 1 — Scope

Based on the user's answers, define and present:
- **Question:** what we're investigating (one clear sentence)
- **In scope:** specific files/directories to read
- **Out of scope:** what we're NOT looking at
- **Read budget:** estimated number of files to read before pausing

Ask the user: "Does this scope look right, or should I include/exclude anything?"

Wait for confirmation before reading.

---

## Phase 2 — Read

### Progressive Depth

Read in layers: entry points first, then critical path, then supporting files. Do NOT read everything at once.

1. **Entry points** — main interfaces, exports, config files
2. **Critical path** — the core logic the user asked about
3. **Supporting files** — helpers, utilities, tests, adjacent modules

After reaching the read budget, pause: "I've read [N] files. Want me to go deeper or present what I have?"

### Systematic Reading

- Follow cross-references, imports, and internal links
- Note data flow paths and ownership boundaries
- Note anything surprising or undocumented
- **Noise awareness:** drop irrelevant results rather than accumulating them in context

---

## Phase 3 — Document

### TL;DR (start here)

Start with a 3-sentence summary. The human should understand the key finding within 10 seconds.

### Full Report

Present findings structured as:
- **Overview** (2-3 sentence summary)
- **Components** (table: component, location, purpose)
- **Data Flow** (how information moves, with file:line references)
- **Boundaries Touched** (what's a boundary and why)
- **Risks / Gotchas** (minimum 3, with file:line evidence)
- **Findings** (what we learned, with evidence — tag each as below)
- **Open Questions** (what couldn't be determined and why)
- **What I Didn't Read** (files in scope but not read, and why)
- **Recommendation** (what to do next — pending human review)

### Evidence Quality Tags

Tag each finding:
- **OBSERVED** — directly verified in code with file:line evidence
- **INFERRED** — deduced from patterns, documentation, or naming conventions; not directly verified

### Current vs Expected State

For each significant finding, capture both sides:
- **Current state:** what exists in the code right now
- **Expected state:** what should exist, or what the user expected

### Severity Scale

Prioritize findings: **SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE**

Every claim backed by file:line reference. Flag unknowns explicitly: "I couldn't determine X because Y."

---

## Phase 4 — Gate

**HUMAN GATE:** Present your findings (TL;DR first). Then ask:

"Want me to (a) go deeper on a specific component, (b) check a boundary I missed, (c) map a different area entirely, or (d) close the investigation?"

Do NOT auto-advance to planning or implementation. Let the human drill into specific findings, challenge conclusions, or redirect: "also look at X" or "that's wrong because Y."

### Link to Next Action

After the human is satisfied, recommend the next step:
- **goat-plan** — this area needs planning work
- **goat-debug** — found a bug during investigation
- **close** — question answered, no further action needed

---

## Constraints

- MUST gather context before investigating (Step 0)
- MUST confirm scope with user before reading (Phase 1)
- MUST read in progressive depth: entry points, critical path, then supporting files
- MUST complete reading before writing findings
- MUST provide file:line evidence for every claim
- MUST tag findings as OBSERVED or INFERRED
- MUST include "What I Didn't Read" section
- MUST stop after presenting findings — no planning until human reviews
- MUST flag uncertainties and unknowns explicitly
- MUST NOT skip to planning before research is reviewed
- MUST NOT fabricate file paths, content, or behaviour
- MUST NOT produce vague summaries without file:line specifics

---

## Output Format

```
## TL;DR
[3 sentences max. Key finding, main implication, confidence level.]

## Investigation: [description]

### Components
| Component | Location | Purpose |
|-----------|----------|---------|
| [name] | [file:line] | [what it does] |

### Data Flow
1. [file:line] — [how data enters]
2. [file:line] — [how data transforms]
3. [file:line] — [how data exits]

### Boundaries Touched
- [boundary] — [why it matters]

### Risks / Gotchas
1. [OBSERVED/INFERRED] [file:line] — [risk description]
   Current state: [what exists]
   Expected state: [what should exist]

### Findings
1. [OBSERVED/INFERRED] [file:line] — [finding]
   Current state: [what exists]
   Expected state: [what should exist]

### Open Questions
- [question] — [why it couldn't be determined]

### What I Didn't Read
- [file/directory] — [reason: too many, lower priority, needs additional context]

### Recommendation
Based on this investigation, I recommend: [goat-plan / goat-debug / close] because [reason].
```

---

## Learning Loop

If this investigation uncovered a lesson or footgun, update the relevant doc before closing:
- Behavioural mistake → `docs/lessons.md`
- Architectural trap with file:line evidence → `docs/footguns.md`

---

## Chains With

- **goat-plan** — investigated area needs planning work
- **goat-debug** — found a bug during investigation
