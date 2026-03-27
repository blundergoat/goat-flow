# Setup — Codex

Set up or improve GOAT Flow for a project using Codex (OpenAI).

**Before you start:** Read [shared/guidelines-audit.md](shared/guidelines-audit.md) and do the audit if applicable.

---

## Codex specifics

These are the Codex-specific file paths and configurations. The shared
phases reference "the instruction file" and "the skills directory" — for
Codex, these are:

- **Instruction file:** `AGENTS.md`
- **Config file:** `.codex/config.toml` (no settings.json)
- **Skills directory:** `.agents/skills/`
- **Hooks:** `.codex/hooks/` + `scripts/` (no PreToolUse — use execpolicy)
- **Execpolicy:** `.codex/rules/deny-dangerous.star` (Starlark)

### Codex mechanics to respect

- AGENTS.md is the root instruction file (not CLAUDE.md)
- Skills use YAML frontmatter with `name` and `description` fields
- Codex discovers skills via `/skills` or `$skill-name` at runtime
- Hook events: `SessionStart`, `UserPromptSubmit`, `Stop`, `AfterToolUse`, `AfterAgent`
- No PreToolUse blocker — use execpolicy rules for command blocking
- `apply_patch` for edits (not Edit/Write tool)
- No `/compact`, no `/clear` — context is per-task
- No `.claude/` directory structure, no settings.json, no profiles

### Dual-agent repos

If this project already has Claude Code files (`.claude/`, `CLAUDE.md`),
leave them untouched. Create Codex equivalents alongside them. AGENTS.md
MUST reference CLAUDE.md in its router table and align shared semantics
(loop, budgets, LOG triggers, Ask First checklist).

---

## Phase 1a-c — Foundation

Read and implement [shared/phase-1.md](shared/phase-1.md).

**Codex adaptation notes for Phase 1a:**
- AGENTS.md target: under 135 lines (Codex files run larger because
  enforcement can't be offloaded to hooks)
- MUST include state declaration in ACT and mode-transition rule
- LOG MUST have: mechanical trigger, human correction trigger, footgun
  propagation, dual-agent coordination (if applicable)
- Ask First MUST use the explicit 5-item micro-checklist

After completing the shared Phase 1 instructions, implement these
Codex-specific enforcement items:

### Codex Enforcement (Phase 1 add-ons)

```
HOOKS + EXECPOLICY:
1. .codex/config.toml with hook registration:
   - [hooks.stop] → scripts/stop-lint.sh (lint after every turn)
   - [hooks.after_tool_use] → .codex/hooks/after-tool-use.sh
   - [hooks.session_start] → .codex/hooks/session-start.sh

2. .codex/rules/deny-dangerous.star (Starlark execpolicy):
   - Block: rm -rf (unscoped), git push main/master, force push,
     chmod 777, pipe-to-shell, .env modifications, --no-verify
   - Prompt: git commit, git push (non-main), sudo, scoped rm -rf
   - Allow: everything else

   Note: Codex has NO PreToolUse equivalent. Execpolicy blocks shell
   commands only. File writes and agent spawns cannot be pre-blocked.

3. Verification scripts in scripts/:
   - scripts/preflight-checks.sh — build, lint, test for the stack
   - scripts/context-validate.sh — instruction file line count, router
     references resolve, skill files exist
   - scripts/deny-dangerous.sh — policy documentation + verification
     with --self-test flag. This is NOT runtime blocking — it's a
     policy doc and verification script.

VERIFICATION:
- GATE: .codex/config.toml exists with hook registrations.
- GATE: .codex/rules/deny-dangerous.star exists with forbidden patterns.
- GATE: scripts/deny-dangerous.sh --self-test passes.
- GATE: Hook scripts are executable.
```

---

## Phase 2 — Evals & Hygiene

Read and implement [shared/phase-2.md](shared/phase-2.md).

**Codex-specific evals:** Include at least 1-2 evals that test Codex-specific
mechanics (declare `Agents: codex`):
- deny-dangerous is policy not runtime blocking
- No slash commands (use .agents/skills/)
- No /compact or /clear
- Preserve Claude files in dual-agent repos
- AGENTS.md / CLAUDE.md alignment drift

---

## Phase 3 — Verify & Quality Control

Read and implement [shared/phase-3.md](shared/phase-3.md).

Run the scanner for Codex:
```
goat-flow scan . --agent codex
```

**Definition of Done: 100% score with zero anti-pattern deductions.**

---

## After Codex Runs — Human Checklist

- [ ] AGENTS.md has 6-step loop, autonomy tiers, DoD, router table
- [ ] ACT has state declaration AND mode-transition rule
- [ ] LOG has mechanical trigger, human correction trigger, footgun propagation
- [ ] Ask First has explicit 5-item micro-checklist
- [ ] All 10 goat-* skills in .agents/skills/ with YAML frontmatter
- [ ] scripts/deny-dangerous.sh --self-test passes
- [ ] Router table references all resolve to real files
- [ ] If dual-agent: no Claude Code files were modified or removed

---

## What This Intentionally Does Not Include

| Claude Code Feature | Why Codex Skips It |
|--------------------|--------------------|
| PreToolUse hooks | Codex uses execpolicy for shell commands. No pre-execution gate for file writes. |
| Permission profiles | No native profile support. Document roles in AGENTS.md if needed. |
| Local CLAUDE.md files | Codex doesn't auto-load per-directory. Use .github/instructions/ with applyTo. |
| Permissions deny list | Codex uses Starlark execpolicy rules with allow/prompt/forbidden decisions. |
