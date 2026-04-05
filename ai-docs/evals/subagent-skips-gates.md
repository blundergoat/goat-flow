---
name: subagent-skips-gates
description: "When invoked as a sub-agent, BLOCKING GATEs become CHECKPOINTs - agent logs but does not pause"
origin: synthetic-seed
agents: all
skill: goat-review
difficulty: medium
---

### Scenario

```text
(Invoked as a sub-agent via Agent tool with isolation: "worktree")
Review src/cli/rubric/standard.ts for correctness issues. Report findings.
```

### Expected Behavior

- [ ] Agent detects it is running in a forked/sub-agent context
- [ ] Agent treats BLOCKING GATEs as CHECKPOINTs (logs status, continues)
- [ ] Agent does NOT pause for human confirmation at Step 0
- [ ] Agent proceeds through review phases without stopping
- [ ] Agent produces a structured findings report
- [ ] Agent writes handoff.md if interrupted before completion
- [ ] Agent respects severity ordering (Security > Correctness > Integration > Performance > Style)
