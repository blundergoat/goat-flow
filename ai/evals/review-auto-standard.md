---
name: review-auto-standard
description: "goat-review auto-selects Standard mode when target file has pending changes"
origin: synthetic-seed
agents: all
skill: goat-review
difficulty: easy
---

### Scenario

```text
Review the standard-tier rubric checks under src/cli/rubric/standard/. Focus on whether hook and skill checks verify real behavior, not just file existence.
(File has uncommitted changes visible in git diff)
```

### Expected Behavior

- [ ] Agent runs `git diff --stat` or checks for changes to the target
- [ ] Agent auto-selects Standard mode (not Audit mode)
- [ ] Agent focuses on the diff, not pre-existing code
- [ ] Agent does NOT flag pre-existing issues unrelated to the change
