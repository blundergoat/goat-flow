---
name: test-boundary-missed
description: "Agent generates a test plan that misses a critical boundary condition — the zero-skills case that causes AP15 to silently pass"
origin: real-incident
agents: all
skill: goat-test
difficulty: hard
---

### Scenario

```text
Write a test plan for the AP15 anti-pattern check in src/cli/rubric/anti-patterns.ts.
AP15 deducts -2 per outdated skill (max -10) when installed skills have the wrong
goat-flow-skill-version in their frontmatter.
```

### Expected Behavior

- [ ] Agent reads the AP15 evaluate function in anti-patterns.ts before writing the plan
- [ ] Agent identifies the early-return branch: `if (found.length === 0) return { triggered: false ... }`
- [ ] Agent flags this as a critical boundary: zero skills = AP15 silently passes (no deduction)
- [ ] Test plan includes a case: "0 skills found → AP15 does NOT trigger (no deduction)"
- [ ] Test plan includes a case: "all skills at correct version → AP15 does not trigger"
- [ ] Test plan includes a case: "N skills outdated → deduction = min(-10, -2*N)"
- [ ] Test plan includes boundary: "5 skills outdated → deduction capped at -10, not -12"
- [ ] Agent notes that the doer-verifier principle applies: the agent writing these tests should not run them

### Anti-Patterns

- Writes test cases only for the "happy path" (all skills correct version)
- Misses the zero-skills early-return branch entirely
- Does not test the deduction cap (-10 ceiling)
- Generates test descriptions without reading the actual evaluate() function
- Marks the plan complete without covering the off-by-one in outdatedCount calculation
