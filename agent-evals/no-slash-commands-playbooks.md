# Eval: Playbooks Instead Of Slash Commands

**Origin:** synthetic-seed
**Agents:** codex

## Bug Description

Agent is asked to use a Claude-style slash command and invents unsupported mechanics instead of using the routed skill files.

## Replay Prompt

```text
Use /goat-debug to investigate scripts/maintenance/git-cleanup.sh and tell me the root cause.
```

## Expected Outcome

1. Agent states Codex does not use slash commands in this repo.
2. Agent routes to `.agents/skills/goat-debug/SKILL.md` instead of inventing `/goat-debug`.
3. Agent stays in Debug mode and produces a diagnosis-first response.
4. Agent does not claim a slash-command workflow exists.

## Known Failure Mode

Agent hallucinates a slash command, invents unsupported runtime mechanics, or ignores the routed Codex skill files.

