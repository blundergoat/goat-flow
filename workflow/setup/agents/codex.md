# Agent Config - Codex

## Paths

| Resource | Path |
|----------|------|
| Instruction file | `AGENTS.md` |
| Config file | `.codex/config.toml` |
| Hooks config | `.codex/hooks.json` |
| Skills directory | `.agents/skills/` |
| Hooks directory | `.codex/hooks/` |

## Owns

AGENTS.md, `.codex/`, and shared `.goat-flow/`.

`.agents/skills/` is a **shared surface** - both Codex and Gemini use it as their skills directory. Either agent's setup can create/update skills here.

## Hands off

CLAUDE.md, GEMINI.md, `.claude/`, `.gemini/`.

## Agent-specific setup

### Codex mechanics

- AGENTS.md is the root instruction file (not CLAUDE.md)
- Hook events: `PreToolUse`, `Stop`, `UserPromptSubmit`, `SessionStart`, `AfterToolUse`, `AfterAgent`
- Hooks configured in `.codex/hooks.json` (not config.toml)
- PreToolUse is WIP - "doesn't intercept all shell calls yet" per Codex docs
- `apply_patch` for edits (not Edit/Write tool)
- No `/compact`, no `/clear` - context is per-task

### Hooks

After completing step 03 (skills):
- Apply `workflow/hooks/agent-config/codex.toml` as the base for `.codex/config.toml` (enables hooks feature)
- Apply `workflow/hooks/agent-config/codex-hooks.json` as `.codex/hooks.json` (registers PreToolUse deny hook)
- goat-flow core does not ship a Codex Stop hook template; add Stop hooks in `.codex/hooks.json` only for project-specific validation
- `deny-dangerous.sh` is installed to `.codex/hooks/` by the install script (same shared template as Claude/Gemini)

### Dual-agent repos

If `.claude/` and `CLAUDE.md` exist, leave them untouched. AGENTS.md MUST reference CLAUDE.md in its router table.

### Adaptation notes

- Ask First MUST use the explicit 5-item micro-checklist (Codex has weaker guardrails than Claude)
- Execution logs MUST include dual-agent coordination if CLAUDE.md exists

### Verification

- `.codex/config.toml` exists with `[features] codex_hooks = true`
- `.codex/hooks.json` exists with PreToolUse hook registered
- `.codex/hooks/deny-dangerous.sh` exists and is executable
- Hook scripts pass `bash -n`

---

Begin setup: proceed to `01-system-overview.md`
