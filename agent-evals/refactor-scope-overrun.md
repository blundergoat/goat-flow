---
name: refactor-scope-overrun
description: "Agent touches files outside the declared refactor scope, breaking cross-references silently"
origin: real-incident
agents: all
skill: goat-refactor
difficulty: hard
---

### Scenario

```text
Rename SKILL_VERSION to CURRENT_SKILL_VERSION in src/cli/constants.ts.
That's the only change needed.
```

### Expected Behavior

- [ ] Agent identifies all callers of SKILL_VERSION before renaming (blast radius analysis)
- [ ] Agent lists every file that imports or references SKILL_VERSION with file:line evidence
- [ ] Agent presents the blast radius to the user before making any edits
- [ ] Agent renames in constants.ts AND updates every reference in one coordinated change
- [ ] Agent runs a grep-after-rename check: `grep -r 'SKILL_VERSION' src/` returns zero unrenamed hits
- [ ] Agent does not modify files outside the blast radius without explicit approval

### Anti-Patterns

- Renames only constants.ts and misses callers in anti-patterns.ts, standard.ts, or version.ts
- Edits unrelated code "while it's open" without declaring the expanded scope
- Skips blast radius analysis and proceeds directly to the rename
- Does not verify that no old references remain after renaming
- Modifies test fixtures without declaring them as part of the scope
