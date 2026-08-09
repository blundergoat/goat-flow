# Guardrails

Guardrails are goat-flow's runtime command-safety hooks. Each agent invokes the central `deny-dangerous.sh` dispatcher, backed by shared policy modules in `.goat-flow/hooks/deny-dangerous/`.

## Surfaces

| Surface | Path | Role |
| --- | --- | --- |
| Dispatcher | `workflow/hooks/deny-dangerous.sh` | Blocks recursive force deletion, privileged package-manager mutation, secret-path access, `git commit`, `git push`, destructive git flags, and GitHub write operations through `gh` |
| Policy store | `.goat-flow/hooks/deny-dangerous/` | Shared policy modules sourced by each installed dispatcher |
| Self-test | `.goat-flow/hooks/deny-dangerous/deny-dangerous-self-test.sh` | Runs smoke/full checks for the dispatcher and is what preflight invokes |

## Agent Mapping

| Agent | Runtime mechanism | Primary locations |
| --- | --- | --- |
| Claude Code | `PreToolUse` config entries invoking central hooks plus settings deny patterns | `.claude/settings.json`, `.goat-flow/hooks/` |
| Codex | `PreToolUse` config entries invoking central hooks plus config TOML permission profile | `.codex/hooks.json`, `.codex/config.toml`, `.goat-flow/hooks/` |
| Copilot CLI | `preToolUse` hooks registered in `.github/hooks/hooks.json` and invoking central hooks | `.github/hooks/hooks.json`, `.goat-flow/hooks/` |
| Antigravity | `PreToolUse` hooks registered in `.agents/hooks.json` and invoking central hooks | `.agents/hooks.json`, `.goat-flow/hooks/` |

## Verification

- `bash .goat-flow/hooks/deny-dangerous.sh --self-test=smoke`
- `bash .goat-flow/hooks/deny-dangerous.sh --self-test=full`
- `goat-flow hooks list --json`
- `goat-flow hooks sync`

## Limitations

The dispatcher is a defense-in-depth check for proposed command text. It exposes existing Git and GitHub write rules behind supported `xargs`, `find -exec`, `watch`, shell-c, and common GNU Parallel forms. It also blocks exact credential directories, protected curl file operands, and downloaded bytes passed to executable or unknown pipeline consumers. Known read-only download filters, local data passed to an explicit script file, and literal `vendor` or `target` cleanup remain available.

The hook does not interpret arbitrary shell state or replace runtime permissions. Variable-computed executable names, shell aliases the policy cannot resolve, arbitrary interpreter bodies, and unsupported wrapper grammar may remain outside classification. Keep provider deny lists, filesystem permissions, process sandboxing, and operating-system credentials as the hard boundary. Inspect and run an unclear command manually.
