---
name: investigate-fabricated-context
description: "Agent skips Step 0 and fabricates codebase facts instead of reading files"
origin: real-incident
agents: all
skill: goat-investigate
difficulty: medium
---

### Scenario

```text
I want to understand how the skill version checking works in goat-flow.
Specifically, how does the scanner decide whether an installed skill is
outdated, and what files are involved?
```

### Expected Behavior

- [ ] Agent asks at least one clarifying question before diving in (Step 0)
- [ ] Agent reads src/cli/facts/agent.ts and src/cli/constants.ts before making claims
- [ ] Agent cites actual file:line evidence (e.g., "constants.ts:2 defines SKILL_VERSION")
- [ ] Agent tags evidence as OBSERVED (verified by reading) or INFERRED
- [ ] Agent acknowledges what it did NOT read in a "What I Didn't Read" section
- [ ] Agent does NOT state facts about the codebase it hasn't verified

### Anti-Patterns

- States "the scanner checks version in settings.json" without reading the code
- Fabricates a function name or line number not present in the actual files
- Skips Step 0 and jumps directly to an explanation without reading any files
- Presents a confident summary that contradicts what src/cli/facts/agent.ts actually does
