# Prompt: Diagnose GOAT Flow Implementation

Paste into any AI coding agent (Claude Code, Codex, or Gemini CLI) in any project with an existing GOAT Flow implementation to understand what went wrong and get suggestions for improving the goat-flow instructions.

---

## The Prompt

```
Read these files in this project:
- CLAUDE.md (if exists)
- AGENTS.md (if exists)
- GEMINI.md (if exists)
- docs/footguns.md
- docs/lessons.md
- agent-evals/ (all files — single shared directory for all agents)
- docs/guidelines-ownership-split.md (if exists)
- .github/instructions/ (list what exists)

Then read the GOAT Flow instructions that were used to create them:
- [goat-flow repo]/setup/setup-claude.md (if CLAUDE.md exists)
- [goat-flow repo]/setup/setup-codex.md (if AGENTS.md exists)
- [goat-flow repo]/setup/setup-gemini.md (if GEMINI.md exists)
- [goat-flow repo]/setup/shared/execution-loop.md
- [goat-flow repo]/setup/shared/docs-seed.md
- [goat-flow repo]/setup/shared/phase-2.md
- [goat-flow repo]/setup/shared/guidelines-audit.md

Answer these questions:

1. WHICH GAPS WERE CAUSED BY INSTRUCTIONS vs AGENT ERROR?
   For each gap that exists in the implementation, determine: was
   the setup instruction clear about this requirement, or was it
   vague or missing? Cite the specific line in the setup docs.

2. WHAT WENT WRONG DURING SETUP?
   For each gap: did the agent skip it, misunderstand it, or was it
   not in the instructions? Be honest — distinguish instruction
   failures from agent failures.

3. WHAT REAL BUGS HIT THIS PROJECT THAT GOAT FLOW CAUGHT OR
   SHOULD HAVE CAUGHT?
   Review agent-evals/, docs/footguns.md, and
   docs/lessons.md. For each real incident, map it:

   | Bug | Loop Step | Would SCOPE have helped? |
   |-----|-----------|-------------------------|

4. GUIDELINES AUDIT
   If this project has .github/instructions/ files or a shared
   guidelines file alongside the instruction file:
   - Was the ownership split clean? Any overlap remaining?
   - Did anything that should be in the instruction file (workflow)
     stay in guidelines (engineering practices), or vice versa?
   - Does docs/guidelines-ownership-split.md exist and accurately
     document what was moved?

5. MULTI-AGENT COORDINATION (skip if single-agent)
   If multiple instruction files exist (CLAUDE.md, AGENTS.md, GEMINI.md):
   - Do they use the same terminology (LOG vs RECORD)?
   - Do they have the same loop steps (SCOPE in all)?
   - Do they classify complexity the same way (budgets vs labels)?
   - Any evidence of coordination issues (duplicate entries,
     conflicting evals, one agent overwriting the other)?

6. WHY IS LESSONS.MD EMPTY? (skip if it has entries)
   This project has footguns and agent evals — bugs happened. But
   if lessons.md has no entries, why? Is it because:
   a) Footguns captured everything (lessons are redundant)
   b) The agent never triggers LOG for behavioural mistakes
   c) LOG says SHOULD not MUST, so it gets skipped
   d) Something else
   What would need to change for lessons to get logged?

7. WHAT SHOULD CHANGE IN THE GOAT FLOW INSTRUCTIONS?
   Based on your answers, suggest specific changes. Format:
   - File: [path]
   - Current: [what it says now]
   - Problem: [why it led to the gap]
   - Suggested: [what it should say instead]

Do NOT fix anything — just analyse and report.
```
