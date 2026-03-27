# Setup — Gemini CLI

Set up or improve GOAT Flow for a project using Gemini CLI.

**SCOPE CONSTRAINT:** Gemini CLI setup creates/modifies files under `.gemini/`,
`.agents/skills/`, and `GEMINI.md`. Do NOT modify existing files in `.claude/`
or any shared documentation that other agents depend on.

**Before you start:** Read [shared/guidelines-audit.md](shared/guidelines-audit.md) and do the audit if applicable.

---

## Gemini CLI specifics

These are the Gemini CLI-specific file paths and configurations. The shared
phases reference "the instruction file" and "the skills directory" — for
Gemini CLI, these are:

- **Instruction file:** `GEMINI.md`
- **Settings file:** `.gemini/settings.json`
- **Skills directory:** `.agents/skills/`
- **Hooks directory:** `.gemini/hooks/`

---

## Phase 1a-c — Foundation

Read and implement [shared/phase-1.md](shared/phase-1.md).

After completing Phase 1a, 1b, and 1c from the shared instructions, implement
these Gemini CLI-specific enforcement items:

### Gemini CLI Enforcement (Phase 1 add-ons)

```
GEMINI CLI HOOK EVENTS (use these exact names in settings.json):
  BeforeTool     — runs before a tool executes (guards, blockers)
  AfterTool      — runs after a tool executes (formatting, logging)
  AfterAgent     — runs after every agent turn (linting, stop-the-line)
  SessionEnd     — runs when the session ends (cleanup)
Do NOT use Claude Code event names (PreToolUse, PostToolUse, Stop).

PRE-EXISTING HOOKS:
If hooks already exist in .gemini/settings.json, migrate them to
external scripts under .gemini/hooks/ before adding new hooks.

HOOKS & POLICY:
1. .gemini/settings.json - Permissions deny list:
   "permissions": {
     "deny": ["Bash(*git commit*)", "Bash(*git push*)"]
   }

   BeforeTool hook: .gemini/hooks/deny-dangerous.sh
   - For Bash: block rm -rf, git push main, git push --force, chmod 777,
     pipe-to-shell, --no-verify
   - Exit 0 for everything else

   AfterAgent hook: .gemini/hooks/stop-lint.sh
   - Stack-adaptive (check git diff for file types)
   - MUST exit 0 even on errors (non-zero causes infinite loops)

   AfterTool hook: .gemini/hooks/format-file.sh
   - Format by file extension. Skip if no formatter configured.

   ALL paths MUST use: bash "$(git rev-parse --show-toplevel)/..."

2. Read deny patterns for secrets in .gemini/settings.json:
   "Read(.env*)", "Read(**/secrets/**)", "Read(**/*.pem)", "Read(**/*.key)"

3. Create .geminiignore with secret patterns:
   .env*, **/secrets/, **/*.pem, **/*.key, **/credentials*, **/.git/

VERIFICATION:
- GATE: Verify settings.json is valid JSON.
- GATE: Verify deny-dangerous.sh blocks expected commands.
- GATE: Verify stop-lint.sh exits 0 even on errors.
- GATE: Run bash -n on each .sh file to verify syntax.
```

---

## Phase 2 — Evals & Hygiene

Read and implement [shared/phase-2.md](shared/phase-2.md).

---

## Phase 3 — Verify & Quality Control

Read and implement [shared/phase-3.md](shared/phase-3.md).

Run the scanner for Gemini CLI:
```
goat-flow scan . --agent gemini
```

**Definition of Done: 100% score with zero anti-pattern deductions.**
