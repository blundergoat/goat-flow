# deny-dangerous

`deny-dangerous` is the shared name goat-flow uses for its dangerous-command guardrails.
The exact mechanism depends on the agent runtime.

## Surfaces

| Surface | Path | Used by | Role |
|---------|------|---------|------|
| Shared hook template | `workflow/hooks/deny-dangerous.sh` | Claude, Codex, Gemini | Runtime shell hook that blocks dangerous Bash tool calls before execution |
| Local validation helper | `scripts/deny-dangerous.sh` | Repo maintenance | Checks whether a command string would be allowed or blocked; does not intercept runtime execution |

## Agent mapping

| Agent | Runtime mechanism | Primary location |
|-------|-------------------|------------------|
| Claude Code | `PreToolUse` shell hook plus settings deny patterns | `.claude/hooks/deny-dangerous.sh`, `.claude/settings.json` |
| Gemini CLI | `BeforeTool` shell hook plus `.geminiignore` and settings deny patterns | `.gemini/hooks/deny-dangerous.sh`, `.geminiignore`, `.gemini/settings.json` |
| Codex | `PreToolUse` shell hook (registered in hooks.json) | `.codex/hooks/deny-dangerous.sh`, `.codex/hooks.json` |

## What it blocks

The shipped template is intended to block or prompt on the common high-risk command classes:

- unscoped `rm -rf`
- direct push to protected branches
- force push
- `chmod 777`
- pipe-to-shell and pipe-to-interpreter patterns like `curl | bash`
- `.env` modification
- `git --no-verify`
- `git reset --hard`
- `git clean -f`
- destructive database commands
- access to secret paths such as `.env`, `.ssh`, `.aws`, `credentials`, `secrets`, `.pem`, `.key`, `.pfx`, `.gnupg`

## Important distinction

These files are command guards, not general ignore files.

- Claude sensitive-file exclusion is primarily `permissions.deny` in `.claude/settings.json`.
- Gemini sensitive-file exclusion is primarily `.geminiignore`, with settings and hooks as defense in depth.
- Codex has no separate ignore file in this repo; the deny hook in `.codex/hooks/deny-dangerous.sh` is the primary guard.

## Verification

Runtime and local verification are different:

- `bash workflow/hooks/deny-dangerous.sh --self-test`
  Verifies the shared hook template.
- `bash scripts/deny-dangerous.sh --self-test`
  Verifies the repo-local helper.
- `bash scripts/deny-dangerous.sh --check "git push origin main"`
  Shows whether the local helper would allow or block a specific command string.

## Limitations

The guardrails are intentionally simple and pattern-based.

- They match literal command strings, not full shell semantics.
- They do not reliably catch variable indirection, aliases, or encoded commands.
- Codex PreToolUse is WIP and "doesn't intercept all shell calls yet" per the Codex docs.
- `goat-flow audit` validates static setup and registration; it does not prove a hook executed successfully at runtime.

## Source of truth

If this doc drifts, prefer the live templates and agent setup docs:

- `workflow/hooks/deny-dangerous.sh`
- `workflow/hooks/README.md`
- `workflow/setup/agents/claude.md`
- `workflow/setup/agents/gemini.md`
- `workflow/setup/agents/codex.md`
