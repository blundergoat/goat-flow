# Prompt: Create /goat-resume Skill

Paste this into your coding agent to create the `/goat-resume` skill for your project.

---

## The Prompt

```
Create the /goat-resume skill for this project.

## When to Use

At the start of a new session when continuing previous work. Also
useful after context compaction in long sessions.

Purpose: session continuation. The agent reconstructs working state
from available context and proposes the next action for human
approval. The compaction hook restores raw state; this skill
INTERPRETS that state and recommends direction.

Write the skill file to: .claude/skills/goat-resume/SKILL.md
(For Codex/Gemini: .agents/skills/goat-resume/SKILL.md)

There is no Step 0 — this skill IS the context gathering.
Jump straight to phases.

The skill follows a strict 4-phase process:

Phase 1 - Reconstruct State:
Gather all available session context:
1. Handoff notes — Read tasks/handoff.md (if exists)
2. Task list — Read tasks/todo.md (if exists)
3. Recent history — git log --oneline -20
4. Uncommitted changes — git diff --name-only (staged and unstaged)
5. Stashed work — git stash list

If none of these sources exist or produce output:
"No prior session context found. What are you working on?"

Phase 2 - Load Context:
Orient to the current working area:
- Read the current milestone file if one exists in
  docs/roadmaps/milestones/
- Read docs/footguns.md for active traps in the working area
- Read CLAUDE.md/AGENTS.md router table to orient

Phase 3 - Assess Status:
For each in-progress item from Phase 1:
- What's done — completed work, committed changes
- What's blocked — dependencies, open questions, failing tests
- What's next — logical next step based on the task state

Identify:
- Modified files and their purpose
- Whether changes look complete or partial
- Any risks: uncommitted changes, stashed work, broken tests

Phase 4 - Recommend Next Action:
Present the reconstructed state and recommendation:
"Here's where we left off: [task]. Modified files: [list].
Status: [complete/partial/blocked]. I recommend working on
[next step] because [reason]."

HUMAN GATE: "Want to (a) proceed with my recommendation,
(b) re-scope to different work, (c) see more detail on a
specific area, (d) check something I missed?"
Do NOT start working until the human confirms direction.

The skill MUST:
- Read all available context sources before recommending
- Present recommendation for human approval
- Handle "no context found" gracefully
- Wait for human to confirm direction before proceeding

The skill MUST NOT:
- Start working without human confirming direction
- Fabricate prior context
- Skip context sources that exist
- Assume what the prior session was about without evidence

VERIFICATION:
- Verify skill file exists at the correct path
- Verify no Step 0 (this skill IS the context gathering)
- Verify 4-phase structure (reconstruct, load, assess, recommend)
- Verify hard gate in Phase 4 (human confirms before work begins)
- Verify output format template is included
- Verify graceful handling of "no context found"

## Severity Scale

Risks flagged during resume use the standard ranking:
SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE

## Learning Loop

If resume reveals a lesson or footgun (e.g., missing handoff notes
caused context loss), update the relevant doc:
- Behavioural mistake → docs/lessons.md
- Architectural trap with file:line evidence → docs/footguns.md

## Chains With

- any skill — resume proposes which skill to use next
- goat-plan — resume into planning work

## Output

Structured session resume with last session task, modified files
with status, current status, blockers, recommendation for next
step, and open questions — presented for human review before any
work begins.
```
