# Prompt: Create /goat-plan Skill

Paste this into your coding agent to create the `/goat-plan` skill - an agent-invocable planning workflow that guides through the full planning playbook sequence with human checkpoints.

---

## When to Use

Before any non-trivial implementation. Instead of manually pasting 4 separate planning prompts in sequence, invoke `/goat-plan` and the agent drives the process with human gates between each phase.

---

## The Prompt

```
Create the /goat-plan skill for this project.

Purpose: guide the developer through the full GOAT Flow planning
sequence - feature brief, mob elaboration, SBAO ranking, and milestone
planning - as a single agent-driven workflow with human checkpoints
between each phase.

Write the skill file to: .claude/skills/goat-plan/SKILL.md
(For Codex: docs/codex-playbooks/goat-plan.md)

The skill follows a 4-phase process with mandatory human gates:

## Phase 1 - Feature Brief

Ask the developer for:
- What are we building? (one sentence)
- Why? (the problem it solves)
- Who benefits? (primary users)
- What does success look like? (measurable signal)

Then generate a feature brief with:
- Lean hypothesis (We believe [X] for [users] will [outcome])
- Problem & outcome
- User stories (3-5, specific and testable)
- Technical considerations
- Scope (in/out)
- Risks and open questions

Output: `requirements-<feature-name>.md`

**HUMAN GATE:** Present the brief. Wait for approval before Phase 2.
"Review this feature brief. Approve, or tell me what to change."

## Phase 2 - Mob Elaboration

Read the approved feature brief. Then generate clarifying questions
from multiple perspectives:

- Architecture: system design, integration points, data flow
- Security: auth, data handling, attack surface
- UX: user flows, edge cases, error states
- Operations: deployment, monitoring, rollback
- Testing: test strategy, coverage gaps, failure modes

For each question:
- Present 2-3 options with trade-offs
- Include a recommendation with reasoning

Output: append elaboration to the requirements doc or create
`elaboration-<feature-name>.md`

**HUMAN GATE:** Present all questions with recommendations.
"Review these questions. Answer each, or accept the recommendations."

## Phase 3 - SBAO Ranking (if complexity warrants)

For System Change or Infrastructure complexity:
- Generate 3 competing implementation plans
- Rank them against criteria: risk, effort, maintainability, scope fit
- Synthesise a prime plan taking the best from each
- Document what was rejected and why

For Standard Feature complexity:
- Generate 1 plan with alternatives noted
- Skip the full ranking process

Output: `TODO_<feature-name>_prime.md`

**HUMAN GATE:** Present the prime plan.
"Review this plan. Approve, modify, or ask me to regenerate."

## Phase 4 - Milestone Planning

Read the approved plan. Break into phased milestones:

- Each milestone has: theme, tasks (checkboxes), exit criteria
- M1 is always the highest-risk work (spike-first principle)
- Later milestones get less detail (avoid premature specification)
- Include assumptions (validated vs assumed) and risks per milestone

Rules:
- Spikes before implementation for anything uncertain
- No milestone should have more than 10 tasks
- Each task should be completable in one agent session
- Exit criteria must be testable, not subjective

Output: update `TODO_<feature-name>_prime.md` with milestone breakdown

**HUMAN GATE:** Present the milestone plan.
"Review this milestone plan. Approve, or tell me what to adjust."

## Completion

After all 4 phases are approved:
- Summarise: feature brief → elaboration → plan → milestones
- List all open questions that still need answers
- Recommend which milestone to start with
- Ask: "Ready to start M1, or do you want to review anything first?"

The skill MUST:
- Complete each phase before moving to the next
- Wait for human approval at every gate (do not auto-proceed)
- Adapt the level of detail to the CLASSIFY complexity tier
- Reference the project's existing docs/footguns.md and
  docs/architecture.md when making technical recommendations
- Keep plans specific to THIS project's stack, not generic

The skill MUST NOT:
- Skip any phase without human permission
- Auto-approve its own output at any gate
- Generate code during planning (this is Plan mode only)
- Proceed past a human gate without explicit approval

The skill MAY:
- Skip Phase 3 (SBAO) for Hotfix or Standard Feature complexity
- Compress Phases 1-2 into a single brief for Hotfix complexity
- Reference existing requirements docs if the project has them

VERIFICATION:
- Verify skill file exists at the correct path
- Verify all 4 phases are documented with human gates
- Verify the skill references the planning playbooks in
  workflow/playbooks/planning/
- Verify output file naming convention is documented
```
