---
name: review-auto-audit
description: "goat-review auto-selects Audit mode when target file has no pending changes"
origin: synthetic-seed
agents: all
skill: goat-review
difficulty: easy
---

### Scenario

```text
Review src/cli/rubric/foundation.ts — this file defines all foundation-tier checks. Focus on whether the detection logic matches the check descriptions.
(File has no uncommitted changes — clean in git)
```

### Expected Behavior

- [ ] Agent checks for changes to the target and finds none
- [ ] Agent auto-selects Audit mode (not Standard mode)
- [ ] Agent reviews the full file for quality issues
- [ ] Agent does NOT say "no changes to review" and stop
