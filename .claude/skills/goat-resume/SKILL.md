---
name: goat-resume
description: "Reconstruct session state and propose next action after a break"
---
# /goat-resume

Session continuation skill. Reconstructs working state from available context and proposes the next action for human approval. The compaction hook restores raw state; this skill INTERPRETS that state and recommends direction.

## When to Use

At the start of a new session when continuing previous work. Also useful after context compaction in long sessions.

---

## Phase 1 — Reconstruct State

Gather all available session context:

1. **Handoff notes** — Read `tasks/handoff.md` (if exists)
2. **Task list** — Read `tasks/todo.md` (if exists)
3. **Recent history** — `git log --oneline -20`
4. **Uncommitted changes** — `git diff --name-only` (staged and unstaged)
5. **Stashed work** — `git stash list`

If none of these sources exist or produce output: "No prior session context found. What are you working on?"

---

## Phase 2 — Load Context

Orient to the current working area:

- Read the current milestone file if one exists in `docs/roadmaps/milestones/`
- Read `docs/footguns.md` for active traps in the working area
- Read CLAUDE.md/AGENTS.md router table to orient

---

## Phase 3 — Assess Status

For each in-progress item from Phase 1:

- **What's done** — completed work, committed changes
- **What's blocked** — dependencies, open questions, failing tests
- **What's next** — logical next step based on the task state

Identify:
- Modified files and their purpose
- Whether changes look complete or partial
- Any risks: uncommitted changes, stashed work, broken tests

---

## Phase 4 — Recommend Next Action

Present the reconstructed state and recommendation:

"Here's where we left off: [task]. Modified files: [list]. Status: [complete/partial/blocked]. I recommend working on [next step] because [reason]."

**HUMAN GATE:** "Want to (a) proceed with my recommendation, (b) re-scope to different work, (c) see more detail on a specific area, (d) check something I missed?"

Do NOT auto-advance. Present findings then let the human dig deeper, ask follow-up questions about specific areas, or redirect before proceeding.

---

## Constraints

- MUST read all available context sources before recommending
- MUST present recommendation for human approval
- MUST handle "no context found" gracefully
- MUST NOT start working without human confirming direction
- MUST NOT fabricate prior context

## Output Format

```
## Session Resume

### Last Session
[task description from handoff/todo/git history]

### Modified Files
- [file] — [status: committed/uncommitted/stashed]

### Current Status
[complete/partial/blocked]

### Blocked By
[if applicable — dependency, open question, failing test]

### Recommendation
[next step + reason]

### Open Questions
[anything unclear from the prior session context]
```

## Severity Scale

Risks flagged during resume use the standard ranking:
SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE

## Learning Loop

If resume reveals a lesson or footgun (e.g., missing handoff notes caused context loss), update the relevant doc:
- Behavioural mistake → `docs/lessons.md`
- Architectural trap with file:line evidence → `docs/footguns.md`

## Chains With

- any skill — resume proposes which skill to use next
- goat-plan — resume into planning work
