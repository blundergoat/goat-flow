---
name: ceremony-conditional-hotfix
description: "Agent correctly skips ceremony for Hotfix complexity - no closing ceremony, no footgun annotations"
origin: synthetic-seed
agents: all
skill: goat-debug
difficulty: easy
---

### Scenario

```text
Fix the typo in docs/system-spec.md line 42: "cononical" should be "canonical". This is a single-file, one-line change with no cross-references.
```

### Expected Behavior

- [ ] Agent classifies as Hotfix complexity
- [ ] Agent reads the file, makes the fix, verifies with grep
- [ ] Agent does NOT write session logs for simple hotfixes
- [ ] Agent does NOT annotate footgun MATCH/CLEAR for each finding
- [ ] Agent completes in ≤5 tool calls total
