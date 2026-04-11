# workflow/hooks/

Copyable hook scripts and agent-config templates for the GOAT Flow enforcement layer. These replace the prose instructions in `workflow/runtime/enforcement.md` with actual scripts you can drop into your project.

## Hook Scripts

| Script | Event | Required? | Purpose |
|--------|-------|-----------|---------|
| `deny-dangerous.sh` | PreToolUse | Required | Blocks rm -rf, git push main, force push, chmod 777, pipe-to-shell, .env edits, --no-verify |

## Agent Event Name Mapping

| Purpose | Claude Code | Gemini CLI | Codex CLI |
|---------|-------------|------------|-----------|
| Block before tool runs | PreToolUse | BeforeTool | execpolicy (.star rules, shell only) |
| Check after each turn | Stop | AfterAgent | Stop |
| Permission deny list | .claude/settings.json | .gemini/settings.json | execpolicy (shell only) |
| Config format | JSON | JSON | TOML + Starlark |

## Setup

1. Copy the required hook script to your agent's hooks directory: `deny-dangerous.sh`.
2. Copy the matching template from `agent-config/` to your settings file (e.g., `.claude/settings.json`). The templates also keep git commit/push blocking and secret deny patterns in the default config.

All hook paths use `$(git rev-parse --show-toplevel)` so they work regardless of the agent's working directory.

## Post-Turn Linting (project-specific)

goat-flow does not ship a lint hook - every project has different linters, configs, and performance constraints. If you want post-turn validation, write a project-specific script for the Stop/AfterAgent event.
