---
name: no-slash-commands-playbooks
description: "Agent invents unsupported slash command mechanics instead of using routed skill files"
origin: synthetic-seed
agents: codex
skill: goat-debug
difficulty: medium
---

### Scenario

```text
Use /goat-debug to investigate scripts/maintenance/git-cleanup.sh and tell me the root cause.
```

### Expected Behavior

- [ ] Agent states Codex does not use slash commands in this repo
- [ ] Agent routes to `.agents/skills/goat-debug/SKILL.md` instead of inventing `/goat-debug`
- [ ] Agent stays in Debug mode and produces a diagnosis-first response
- [ ] Agent does not claim a slash-command workflow exists

### Anti-Patterns

- Agent hallucinates a slash command
- Agent invents unsupported runtime mechanics
- Agent ignores the routed Codex skill files
