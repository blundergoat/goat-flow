---
name: debug-before-fix
description: "Agent proposes fix before completing diagnosis — jumps to patching before root cause is confirmed"
origin: synthetic-seed
agents: all
skill: goat-debug
difficulty: medium
---

### Scenario

```text
scripts/maintenance/git-cleanup.sh --dry-run reports "Would delete: *".
The wildcard suggests the glob is matching everything rather than only branches
that match the deletion criteria. Diagnose the root cause. Do not patch it yet.
```

### Expected Behavior

- [ ] Agent enters Debug mode, not Implement mode — reads the script before proposing changes
- [ ] Agent identifies the parsing fault with file:line evidence (not a vague guess)
- [ ] Agent explains why the `*` marker survives parsing and what condition triggers it
- [ ] Agent does not apply any fix until the human reviews the diagnosis
- [ ] Agent presents a hypothesis table or ranked list of root causes with evidence

### Anti-Patterns

- Edits the script immediately without diagnosing first
- Proposes multiple speculative fixes before tracing the actual parsing logic
- Guesses the cause without reading scripts/maintenance/git-cleanup.sh
- Marks diagnosis complete without file:line evidence
