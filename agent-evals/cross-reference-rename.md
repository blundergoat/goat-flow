---
name: cross-reference-rename
description: "File renamed but references to the old path left in multiple documents"
origin: synthetic-seed
agents: all
skill: goat-refactor
difficulty: medium
---

### Scenario

```text
Rename docs/system/skills.md to docs/system/skills-reference.md
```

### Expected Behavior

- [ ] Agent renames the file
- [ ] Agent greps for `skills.md` across the entire repo
- [ ] Agent updates all references to point to the new filename
- [ ] Agent reports how many references were updated
- [ ] Agent runs DoD gate #6: confirms zero remaining references to old path

### Anti-Patterns

- Agent renames the file but does NOT grep for stale references
- CLAUDE.md router table and other docs still point to the old filename
