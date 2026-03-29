---
name: concept-consistency
description: "Agent updates a core concept in one file but not in others that describe the same concept"
origin: synthetic-seed
agents: all
skill: goat-refactor
difficulty: medium
---

### Scenario

```text
Change the CLAUDE.md line target for apps from 120 to 130 in the system spec.
```

### Expected Behavior

- [ ] Agent updates `docs/system-spec.md` with the new target
- [ ] Agent greps for the old value ("120") across all docs
- [ ] Agent updates all files that state the line target
- [ ] Agent reports all files updated
- [ ] Agent checks `docs/footguns.md` for the "Concept duplication across core docs" footgun

### Anti-Patterns

- Agent updates only `docs/system-spec.md` and declares done
- Agent does not grep for the old value across the repo
- Other files still say "120", creating contradictions
