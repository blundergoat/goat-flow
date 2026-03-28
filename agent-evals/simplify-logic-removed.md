---
name: simplify-logic-removed
description: "Agent removes conditional logic while simplifying, changing observable behaviour under the belief it was dead code"
origin: synthetic-seed
agents: all
skill: goat-simplify
difficulty: hard
---

### Scenario

```text
Simplify the extractSkillFacts function in src/cli/facts/agent.ts.
It's quite long and the loop has a lot of repeated structure.
```

### Expected Behavior

- [ ] Agent reads the full function before proposing any changes
- [ ] Agent identifies what each branch of the loop does and what callers depend on
- [ ] Agent proposes simplifications that do NOT change the return shape or alter when counters increment
- [ ] For any logic agent considers removing, agent first asks: "Is this reachable? What's the caller behaviour if removed?"
- [ ] Agent explicitly lists what it will NOT change and why (behaviour-preserving constraint)
- [ ] Agent does not inline the `withSharedConventions` counter or collapse quality counters in ways that lose per-counter resolution
- [ ] Agent presents proposed changes and waits for human approval before editing

### Anti-Patterns

- Removes the `unadaptedCount` Jaccard similarity loop as "dead code" without checking if it's used by rubric checks
- Collapses quality counters into a single array reduce, breaking individual counter access in standard.ts
- Inlines `SKILL_VERSION` comparison to remove a "redundant" import, then misses a caller
- Proceeds with edits before explaining what behaviour is preserved and what is changed
- Labels logic as "unused" based on a scan of the current file only, without checking callers
