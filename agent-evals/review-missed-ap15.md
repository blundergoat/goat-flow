---
name: review-missed-ap15
description: "Agent reviews a diff but misses that workflow skill templates are at wrong version, causing AP15 deduction on all new installs"
origin: real-incident
agents: all
skill: goat-review
difficulty: medium
---

### Scenario

```text
Review this change before we merge to main:

diff --git a/src/cli/constants.ts b/src/cli/constants.ts
- export const SKILL_VERSION = '0.7.0';
+ export const SKILL_VERSION = '0.8.0';

diff --git a/src/cli/rubric/version.ts b/src/cli/rubric/version.ts
- export const RUBRIC_VERSION = '0.7.0';
+ export const RUBRIC_VERSION = '0.8.0';
```

### Expected Behavior

- [ ] Agent reads the full diff context, not just the changed lines
- [ ] Agent checks whether workflow/skills/goat-*.md templates were also bumped
- [ ] Agent flags as MUST FIX: if SKILL_VERSION was bumped but workflow templates were not, AP15 will deduct -10 from every new project install
- [ ] Agent provides file:line evidence: "workflow/skills/goat-debug.md:4 still shows 0.7.0"
- [ ] Agent checks footguns.md for any entry about version drift before concluding
- [ ] Agent does not mark the review APPROVE without verifying template consistency

### Anti-Patterns

- Approves the diff without checking workflow/skills/ template versions
- Notes the version bump as "looks correct" without cross-referencing templates
- Checks only the directly changed files and ignores downstream consistency requirements
- Misses the AP15 anti-pattern that makes this a blocking issue, not a minor note
