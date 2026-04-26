# workflow/hooks/

Copyable hook scripts and agent-config templates for the GOAT Flow enforcement layer.

## Hook Scripts

| Script | Event | Required? | Purpose |
|--------|-------|-----------|---------|
| `deny-dangerous.sh` | PreToolUse | Required | Blocks rm -rf, all git push (ADR-025), chmod 777, pipe-to-shell, .env edits, --no-verify |

## Agent Event Name Mapping

| Purpose | Claude Code | Gemini CLI | Codex CLI |
|---------|-------------|------------|-----------|
| Block before tool runs | PreToolUse | BeforeTool | PreToolUse in `.codex/hooks.json` (shell only) |
| Permission deny list | `.claude/settings.json` deny patterns | `.gemini/settings.json` deny patterns | Hook logic in `.codex/hooks.json` (no separate file deny surface) |
| Config format | JSON | JSON | TOML + JSON |

## Setup

1. Copy the required hook script to your agent's hooks directory: `deny-dangerous.sh`.
2. Copy the matching agent-config template(s) for your runtime:
   - Claude: `agent-config/claude.json` -> `.claude/settings.json`
   - Gemini: `agent-config/gemini.json` -> `.gemini/settings.json`
   - Codex: `agent-config/codex.toml` -> `.codex/config.toml` and `agent-config/codex-hooks.json` -> `.codex/hooks.json`
3. goat-flow core ships only the deny hook. Post-turn validation hooks are a project-specific concern - see the note below.

All hook paths use `$(git rev-parse --show-toplevel)` so they work regardless of the agent's working directory.

## Post-Turn Linting (project-specific, not shipped)

goat-flow does not ship a post-turn lint hook. Every project has different linters, configs, and performance constraints. If you want post-turn validation, write a project-specific script for the Claude `Stop` or Gemini `AfterAgent` event and register it in that agent's settings file. Codex currently has no goat-flow-supported post-turn hook event.
