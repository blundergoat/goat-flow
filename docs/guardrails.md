# Guardrails

Guardrails are goat-flow's runtime command-safety hooks. Each agent registers `deny-dangerous.sh` and `deny-git-mutations.sh` separately. Both use the parser and policy modules in `.goat-flow/hooks/deny-dangerous/`.

## Surfaces

| Surface | Path | Role |
| --- | --- | --- |
| Dangerous policy | `workflow/hooks/deny-dangerous.sh` | Blocks recursive force deletion, privileged package-manager mutation, secret-path access, and GitHub write operations through `gh` |
| Native Git policy | `workflow/hooks/deny-git-mutations.sh` | Blocks `git commit`, publication including `git push`, and destructive history or cleanup operations |
| Policy store | `.goat-flow/hooks/deny-dangerous/` | Shared `guard-runtime.sh` parser and response implementation plus three policy modules |
| Self-test | `.goat-flow/hooks/deny-dangerous/deny-dangerous-self-test.sh` | Routes smoke/full cases to each owning policy; preflight invokes both entrypoints |

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
- `bash .goat-flow/hooks/deny-git-mutations.sh --self-test=smoke`
- `bash .goat-flow/hooks/deny-git-mutations.sh --self-test=full`
- `goat-flow hooks list --json`
- After trusting the selected checkout: `goat-flow hooks verify . --agent <id> --scenario all --trusted-target`

Both policies default on. Upgrades preserve an explicit Git-hook choice or inherit the previous dangerous-hook choice once; later toggles are independent. Shared-file repairs can stale both proof records. `hooks sync` repairs installation, and each policy's verification group supplies fresh proof. Agents still never commit or push, regardless of toggle state.

## Limitations

The shared parser is a defense-in-depth check for proposed command text. It applies the existing Git and GitHub write rules to commands wrapped in supported `xargs`, `find -exec`, `watch`, shell-c, and common GNU Parallel forms. It also blocks exact credential directories, protected curl file operands, and downloaded bytes passed to executable or unknown pipeline consumers. Known read-only download filters, local data passed to an explicit script file, and literal `vendor` or `target` cleanup remain available.

The hooks do not interpret arbitrary shell state or replace runtime permissions. Variable-computed executable names, shell aliases the policy cannot resolve, arbitrary interpreter bodies, and unsupported wrapper grammar may remain outside classification. Keep provider deny lists, filesystem permissions, process sandboxing, and operating-system credentials as the hard boundary. Inspect and run an unclear command manually.
