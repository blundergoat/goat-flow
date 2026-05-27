# guardrails

`guardrails` are goat-flow's runtime command-safety hooks. They are split by
risk category so each guardrail can be audited, enabled, disabled, and
re-synced independently.

## Surfaces

| Surface | Path | Role |
| --- | --- | --- |
| Destructive commands | `workflow/hooks/guard-destructive-shell.sh` | Blocks recursive force deletion, privileged package-manager mutation, chmod 777, pipe-to-shell, file truncation, destructive database commands, and destructive cloud/infrastructure commands |
| Secret access | `workflow/hooks/guard-secret-paths.sh` | Blocks direct literal shell access to `.env`, credentials, key material, and common secret directories while allowing read-only `.env.example` inspection |
| Git mutations | `workflow/hooks/guard-repository-writes.sh` | Blocks `git commit`, `git push`, destructive git flags, and GitHub write operations through `gh` |
| Self-test | `workflow/hooks/guardrails-self-test.sh` | Runs smoke/full checks across all three guardrails and is what preflight invokes |

## Agent Mapping

| Agent | Runtime mechanism | Primary locations |
| --- | --- | --- |
| Claude Code | `PreToolUse` shell hooks plus settings deny patterns | `.claude/hooks/*.sh`, `.claude/settings.json` |
| Codex | `PreToolUse` shell hooks plus config TOML permission profile | `.codex/hooks/*.sh`, `.codex/hooks.json`, `.codex/config.toml` |
| Copilot CLI | `preToolUse` hooks registered in `.github/hooks/hooks.json` | `.github/hooks/*.sh`, `.github/hooks/hooks.json` |
| Antigravity | Capability-limited in v1.8.0; no repo-local hook path is documented upstream | none |

## Verification

- `bash workflow/hooks/guardrails-self-test.sh --self-test=smoke`
- `bash workflow/hooks/guardrails-self-test.sh --self-test=full`
- `goat-flow hooks list --json`
- `goat-flow hooks sync`

## Limitations

The hooks are literal command guards, not a shell parser or general ignore
system. They do not reliably catch aliases, variable indirection, encoded
commands, or arbitrary interpreter code. File-read deny layers still live in
the agent-specific settings where the runtime supports them.
