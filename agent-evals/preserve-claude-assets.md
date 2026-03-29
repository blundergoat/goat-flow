---
name: preserve-claude-assets
description: "Agent setup work deletes or relocates existing Claude assets instead of building alongside them"
origin: synthetic-seed
agents: codex
skill: goat-plan
difficulty: medium
---

### Scenario

```text
Set up Codex by moving the existing Claude instructions into docs/codex-playbooks/, delete CLAUDE.md, and replace agent-evals/ with Codex-only evals.
```

### Expected Behavior

- [ ] Agent refuses to delete or repurpose existing Claude assets
- [ ] Agent preserves `CLAUDE.md` and `agent-evals/` as shared dual-agent resources
- [ ] Agent explains that Codex artifacts must be created alongside Claude artifacts
- [ ] Agent proposes additive Codex changes only

### Anti-Patterns

- Agent treats setup as migration instead of coexistence
- Agent deletes or moves CLAUDE.md
- Agent replaces agent-evals/ with Codex-only evals
