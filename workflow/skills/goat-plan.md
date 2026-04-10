---
name: goat-plan
description: "Planning with SBAO multi-perspective critique and Mob Elaboration. Quick plans, full plans with milestones, and refactor planning."
goat-flow-skill-version: "1.1.0"
---
# /goat-plan

## Shared Conventions

Read `.goat-flow/skill-conventions.md` for full shared conventions.
If unavailable, use these essentials:
- Severity: SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE
- Evidence: every finding MUST include file:line, tag OBSERVED vs INFERRED
- Learning loop: check .goat-flow/lessons/ and .goat-flow/footguns/ after completion
- Gates: BLOCKING GATE = stop and wait. CHECKPOINT = continue unless interrupted.
- Task tracking: tick checkboxes immediately when completed, not at the end.

## When to Use

Use before non-trivial implementation or cross-file restructuring.

**Mode routing:**
- Designing something new → **Plan mode**
- Restructuring existing code → **Refactor planning mode** — read `.goat-flow/playbooks/planning/refactor-planning.md`

**NOT this skill:**
- Diagnosing a bug → /goat-debug
- Reviewing an existing change → /goat-review
- Generating test instructions → /goat-test

## Step 0 — Choose Depth

> "Planning [X] — do you want a quick plan, or the full plan with Mob questions and SBAO critique?"

- If the user already says "quick", "full", "Mob", or "SBAO", confirm and keep moving.
- If the request is vague, ask one natural follow-up covering: what problem, what scope, how big (Hotfix / Small Feature / Standard / System / Infrastructure).
- If the user names a rename, extract, move, or interface change → switch to **Refactor Planning Mode** (read the refactor playbook).
- If arriving from the dispatcher with depth already chosen, skip the depth question.

**Before proceeding:** check `.goat-flow/footguns/` for the target area. Check `.goat-flow/tasks/` for existing plans. Surface kill criteria early: "What would make us abandon this entirely?"

## Quick Plan

Gather the problem, scope, riskiest part, constraints, and kill criteria in one short exchange. Produce a compressed brief and milestones. Keep moving unless the user interrupts. Do NOT run Mob or SBAO on the quick path.

## Full Plan

**Phase 1 — Feature Brief:**
Walk through each section one at a time (do NOT dump all at once):
1. Problem — what's wrong or missing
2. Proposed solution — high-level approach
3. Risks / kill criteria — what could go wrong
4. Rollback plan — how to undo
5. Scope — in/out
6. Dependencies — blocks / blocked by
7. Success criteria — measurable outcomes
8. Open questions

After approval, ask: "Want to run Mob Elaboration, SBAO critique, or go straight to milestones?"

**Phase 2 — Mob Elaboration:**
Read `.goat-flow/playbooks/planning/mob-elaboration.md` and follow the procedure. Generate 3-5 sharp questions about the brief. Do NOT answer your own questions — wait for the user.

**Phase 3 — SBAO Critique:**
Read `.goat-flow/playbooks/planning/sbao-ranking.md` and follow the procedure. Launch 3 sub-agents (2 core-trio + 1 fresh-context). Rank improvements, summarise agreement/disagreement, present for human approval. SBAO MUST use Agent tool calls, not inline role-play.

**Phase 4 — Milestones:**
Read `.goat-flow/playbooks/planning/milestone-planning.md` for milestone archetypes. Structure implementation as milestones with deliverables, exit criteria, kill criteria, and dependencies. Re-read the next milestone after completing each one.

## Constraints

- MUST walk through brief sections one at a time, not dump all at once
- MUST NOT answer your own Mob Elaboration questions
- MUST surface kill criteria in Phase 1, not defer to Phase 4
- SBAO MUST use Agent tool calls, not inline role-play
- MUST re-read next milestone after completing each one
- MUST NOT fabricate file paths or function names
- Refactor mode: MUST read both sides of every interface, grep old names after EVERY rename, change one layer at a time

## Output Format

```markdown
# Feature Brief: [name]
## Problem
## Proposed Solution
## Risks & Kill Criteria
## Rollback Plan
## Scope
- **In:** [list]
- **Out:** [list]
## Dependencies
## Success Criteria
## Open Questions
```

## Chains With

- /goat-debug — need to understand code before planning → investigate mode
- /goat-test — milestones/refactor needs verification plan
- /goat-review — plan or refactor result needs review before merge
