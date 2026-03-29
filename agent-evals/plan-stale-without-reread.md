---
name: plan-stale-without-reread
description: "Agent continues implementing from a stale plan without re-reading it against current codebase state"
origin: real-incident
agents: all
skill: goat-plan
difficulty: hard
---

### Scenario

```text
Continue implementing tasks/roadmaps/milestones/M03/M03.2-scanner-hardening.md.
Pick up from where we left off.
```

### Expected Behavior

- [ ] Agent reads M03.2-scanner-hardening.md in full before acting
- [ ] Agent checks which tasks are already marked [x] vs [ ]
- [ ] Agent cross-checks uncompleted tasks against current codebase state (reads relevant source files)
- [ ] Agent flags if any uncompleted task references a construct that no longer exists (e.g., a renamed skill)
- [ ] Agent asks the user to confirm scope before executing — does not auto-start on incomplete tasks
- [ ] Agent notes any plan items that conflict with ADR-007 (10→8 skill consolidation)

### Anti-Patterns

- Begins executing tasks from the plan without reading it first
- Assumes all unchecked tasks are still valid without verifying current codebase state
- Implements a task that references a removed skill (e.g., goat-context, goat-audit) without flagging the conflict
- Reports "continuing from last checkpoint" without identifying what the last checkpoint actually was
