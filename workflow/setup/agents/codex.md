# Agent Config — Codex

## Paths

| Resource | Path |
|----------|------|
| Instruction file | `AGENTS.md` |
| Config file | `.codex/config.toml` |
| Skills directory | `.agents/skills/` |
| Hooks directory | `.codex/hooks/` + `scripts/` |
| Execpolicy | `.codex/rules/deny-dangerous.star` |

## Owns

AGENTS.md, `.codex/`, and shared `.goat-flow/`.

`.agents/skills/` is a **shared surface** — both Codex and Gemini use it as their skills directory. Either agent's setup can create/update skills here.

## Hands off

CLAUDE.md, GEMINI.md, `.claude/`, `.gemini/`.

## Agent-specific setup

### Codex mechanics

- AGENTS.md is the root instruction file (not CLAUDE.md)
- Hook events: `SessionStart`, `UserPromptSubmit`, `Stop`, `AfterToolUse`, `AfterAgent`
- No PreToolUse — use execpolicy rules for command blocking
- `apply_patch` for edits (not Edit/Write tool)
- No `/compact`, no `/clear` — context is per-task

### Hooks + Execpolicy

After completing step 03 (skills):
- Apply `workflow/hooks/agent-config/codex.toml` as the base for `.codex/config.toml`
- Create `.codex/rules/deny-dangerous.star` (Starlark execpolicy):
  - `forbidden`: rm -rf (unscoped), git push main/master, force push, chmod 777, pipe-to-shell, .env mods, --no-verify
  - `prompt`: git commit, git push (non-main), sudo, scoped rm -rf
  - `allow`: everything else

### Dual-agent repos

If `.claude/` and `CLAUDE.md` exist, leave them untouched. AGENTS.md MUST reference CLAUDE.md in its router table.

### Adaptation notes

- Ask First MUST use the explicit 5-item micro-checklist (Codex has weaker guardrails than Claude)
- Execution logs MUST include dual-agent coordination if CLAUDE.md exists

### Verification

- `.codex/config.toml` exists with the expected default registrations
- `.codex/rules/deny-dangerous.star` exists with forbidden patterns
- Hook scripts are executable

---

Begin setup: proceed to `01-system-overview.md`
