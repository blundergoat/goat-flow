# guardrails

`guardrails` are goat-flow's runtime command-safety hooks. The shipped safety
surface is one `deny-dangerous.sh` dispatcher per agent, backed by shared policy
modules in `.goat-flow/hook-lib/`.

## Surfaces

| Surface | Path | Role |
| --- | --- | --- |
| Dispatcher | `workflow/hooks/deny-dangerous.sh` | Blocks recursive force deletion, privileged package-manager mutation, secret-path access, `git commit`, `git push`, destructive git flags, and GitHub write operations through `gh` |
| Policy store | `.goat-flow/hook-lib/` | Shared policy modules sourced by each installed dispatcher |
| Self-test | `.goat-flow/hook-lib/deny-dangerous-self-test.sh` | Runs smoke/full checks for the dispatcher and is what preflight invokes |

## Agent Mapping

| Agent | Runtime mechanism | Primary locations |
| --- | --- | --- |
| Claude Code | `PreToolUse` shell hooks plus settings deny patterns | `.claude/hooks/*.sh`, `.claude/settings.json` |
| Codex | `PreToolUse` shell hooks plus config TOML permission profile | `.codex/hooks/*.sh`, `.codex/hooks.json`, `.codex/config.toml` |
| Copilot CLI | `preToolUse` hooks registered in `.github/hooks/hooks.json` | `.github/hooks/*.sh`, `.github/hooks/hooks.json` |
| Antigravity | `PreToolUse` hooks registered in `.agents/hooks.json` | `.agents/hooks/*.sh`, `.agents/hooks.json`, `.goat-flow/hook-lib/` |

## Verification

- `bash .goat-flow/hook-lib/deny-dangerous-self-test.sh --self-test=smoke`
- `bash .goat-flow/hook-lib/deny-dangerous-self-test.sh --self-test=full`
- `goat-flow hooks list --json`
- `goat-flow hooks sync`

## Limitations

The hooks are literal command guards, not a shell parser or general ignore
system. They do not reliably catch aliases, variable indirection, encoded
commands, or arbitrary interpreter code. File-read deny layers still live in
the agent-specific settings where the runtime supports them.
