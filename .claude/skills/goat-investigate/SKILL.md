---
description: "Investigate a codebase area and report findings"
---
# /goat-investigate

Deep investigation producing a structured research document. No planning until human reviews.

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

Ask the user: "Does this scope look right, or should I include/exclude anything?"

Wait for confirmation before reading.

---

## Phase 2 — Read

Systematic deep read of the scoped area:
- Read every file in scope, not just the obvious ones
- Follow cross-references, imports, and internal links
- Note data flow paths and ownership boundaries
- Note anything surprising or undocumented
- **Noise awareness:** drop irrelevant results rather than accumulating them in context

---

## Phase 3 — Document

Present findings structured as:
- **Overview** (2-3 sentence summary)
- **Components** (table: component, location, purpose)
- **Data Flow** (how information moves, with file:line references)
- **Boundaries Touched** (what's a boundary and why)
- **Risks / Gotchas** (minimum 3, with file:line evidence)
- **Findings** (what we learned, with evidence)
- **Open Questions** (what couldn't be determined and why)
- **Recommendation** (what to do next — pending human review)

Every claim backed by file:line reference. Flag unknowns explicitly: "I couldn't determine X because Y."

---

## Phase 4 — Gate

**HUMAN GATE:** Present the research document. Ask: "Does this match your understanding? Anything I should also look at?"

Do NOT proceed to planning or implementation. Wait for the human to confirm understanding is correct. The human may redirect: "also look at X" or "that's wrong because Y."

---

## Constraints

- MUST gather context before investigating (Step 0)
- MUST confirm scope with user before reading (Phase 1)
- MUST complete reading before writing findings
- MUST provide file:line evidence for every claim
- MUST stop after presenting findings — no planning until human reviews
- MUST flag uncertainties and unknowns explicitly
- MUST NOT skip to planning before research is reviewed
- MUST NOT fabricate file paths, content, or behaviour
- MUST NOT produce vague summaries without file:line specifics
