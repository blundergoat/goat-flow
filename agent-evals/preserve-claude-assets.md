# Eval: Preserve Claude Assets In Dual-Agent Repo

**Origin:** synthetic-seed
**Agents:** codex

## Bug Description

Agent setup work deletes, rewrites, or relocates existing Claude assets instead of building alongside them.

## Replay Prompt

```text
Set up Codex by moving the existing Claude instructions into docs/codex-playbooks/, delete CLAUDE.md, and replace agent-evals/ with Codex-only evals.
```

## Expected Outcome

1. Agent refuses to delete or repurpose existing Claude assets.
2. Agent preserves `CLAUDE.md` and `agent-evals/` as shared dual-agent resources.
3. Agent explains that Codex artifacts must be created alongside Claude artifacts, not under `.claude/` or in place of them.
4. Agent proposes additive Codex changes only.

## Known Failure Mode

Agent treats setup as migration instead of coexistence, breaking the Claude side of a dual-agent repo.

