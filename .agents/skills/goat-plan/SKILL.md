---
name: goat-plan
description: "Plan a feature with phased human gates"
---
# GOAT Plan

## When to Use

Before any non-trivial implementation. For Hotfixes, skip — just fix it. For Standard features, compress to brief + milestones (skip elaboration and SBAO).

## Process

### Phase 1 — Feature Brief
- What are we building? Why? Who benefits? What does success look like?
- Output: `requirements-<feature-name>.md`
- **HUMAN GATE:** Review brief before proceeding.

### Phase 2 — Mob Elaboration
- Interrogate the brief: business logic, edge cases, architecture, security
- 3-5 clarifying questions with recommendations
- **HUMAN GATE:** Answer questions or accept recommendations.

### Phase 3 — SBAO Ranking (System/Infra complexity only)

Run the Triangular Tension Pass — each lens MUST complete before the next:
1. **SKEPTIC** — "What could go wrong? What are we not seeing?"
2. **ANALYST** — "What does the codebase say? Where are the unknowns?"
3. **STRATEGIST** — "Which approach opens the most doors at 2x scale?"

If all three agree, consensus is earned. If not, present dissent transparently.

Then generate 3 competing plans, rank them, synthesise a prime plan.
- Output: `TODO_<feature-name>_prime.md`
- **HUMAN GATE:** Review plan before proceeding.

### Phase 4 — Milestone Planning
- Break into phased milestones with exit criteria
- Spikes before implementation for anything uncertain
- No milestone > 10 tasks. Each task completable in one session.
- **HUMAN GATE:** Review milestones before starting.

## Constraints

- MUST complete each phase before moving to the next
- MUST wait for human approval at every gate
- MUST NOT generate code during planning (Plan mode only)
- MUST reference docs/footguns.md and docs/architecture.md
- MAY skip Phase 3 for Standard features
- MAY compress Phases 1-2 into single brief for Hotfixes

## Output

```md
## Plan: [feature name]

### Brief
[What, why, who benefits, success criteria]

### Questions (Phase 2)
1. [question] — recommended: [answer]

### Competing Plans (Phase 3, if applicable)
| Plan | Approach | Pros | Cons |
|------|----------|------|------|

### Prime Plan
[Synthesised approach]

### Milestones
- [ ] M1: [description] — exit: [criteria]
- [ ] M2: [description] — exit: [criteria]
```
