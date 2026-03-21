# Setup - Gemini CLI

Set up GOAT Flow for a project using Gemini CLI.

**SCOPE CONSTRAINT:** Gemini CLI setup ONLY creates/modifies files under `.gemini/` and `GEMINI.md`. Do NOT modify files in `docs/`, `workflow/`, `setup/`, `.claude/`, or any shared documentation. Shared docs are already agent-neutral — changing them to Gemini-specific breaks the project for other agents.

**Before you start:** Read [shared/guidelines-audit.md](shared/guidelines-audit.md) and do the audit if applicable.

---

## Phase 0 (New Project Bootstrap)

Use ONLY for a brand new project with no existing GEMINI.md.

```
I'm setting up AI workflow configuration for this project. The stack is:
- Languages: [list your languages]
- Build: [your build command, or "none - interpreted language"]
- Lint: [your lint command]
- Test: [your test command]
- Format: [your format command, or "none - no formatter configured"]

Read docs/system-spec.md. Generate the Minimal tier:
1. GEMINI.md (under 120 lines) with the default execution loop, autonomy
   tiers, definition of done, and router table adapted to my project
2. .gemini/hooks/deny-dangerous.sh (BeforeTool hook blocking dangerous commands)
3. .gemini/settings.json with the deny-dangerous hook registered under
   the "BeforeTool" event (NOT "PreToolUse") and permissions deny list
   for git commit and git push

SCOPE: Only create files under .gemini/ and GEMINI.md. Do NOT modify
any existing files in docs/, workflow/, setup/, or .claude/.

Do NOT create skills, profiles, agent evals, or CI workflows yet.
After creating the files, count GEMINI.md lines and report the count.
```

---

## Phase 1a - Foundation

**Choose your starting point:**
- **No existing GEMINI.md:** Use Prompt A
- **Existing GEMINI.md with domain content:** Use Prompt B (migrates domain content first)

### Prompt A - New GEMINI.md

```
Read setup/shared/execution-loop.md FIRST — this is the authoritative
template for instruction file sections. Then read docs/system-spec.md
for background context. If they conflict, execution-loop.md wins.
Phase 1 builds Layers 1-3 (runtime, local context, and skills).

SCOPE: Only create/modify GEMINI.md, local GEMINI.md files, .gemini/*,
and docs/ seed files listed below. Do NOT modify existing docs/ files,
workflow/, setup/, or .claude/.

This project is a [APP / LIBRARY / SCRIPT COLLECTION]. The stack is:
- Languages: [list]
- Build: [command, or "none - interpreted language"]
- Test: [command]
- Lint: [command]
- Format: [command, or "none - no formatter configured"]

Implement Phase 1a now.

INSTRUCTION FILE:
1. Create GEMINI.md with the sections listed in setup/shared/execution-loop.md.
   Target: under 120 lines.
   Adapt all examples and Ask First boundaries for THIS project.
   Do NOT skip sections (f)–(i) - they are small but required.
   The loop MUST be: READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG.
   CLASSIFY MUST include read/turn budgets per complexity tier.

PRE-CHECK: If AGENTS.md exists, this is a dual-agent project. Include
   dual-agent coordination rules in LOG. Router table MUST reference
   AGENTS.md if it exists. Check scripts/ for existing
   preflight or validation scripts — use them instead of writing new ones.

DOCS SEED FILES:
2. Create the files listed in setup/shared/docs-seed.md.

LOCAL INSTRUCTION FILES (Layer 2):
3. Read docs/footguns.md and the codebase structure. For directories with
   2+ footgun entries, Ask First boundaries, or differing conventions:
   create a local GEMINI.md (under 20 lines each).
   Skip directories already covered by .github/instructions/ files.
   If no directories qualify, create none and note why.

VERIFICATION (all MUST pass before proceeding to Phase 1b):
- GATE: Count GEMINI.md lines. MUST be under 120.
- GATE: Verify all docs seed files exist.
- GATE: Report GEMINI.md line count and number of local GEMINI.md files created.
Do NOT proceed to Phase 1b until all gates pass.
```

### Prompt B - Existing GEMINI.md (migrate domain content)

```
Read setup/shared/execution-loop.md FIRST — this is the authoritative
template for instruction file sections. Then read docs/system-spec.md
for background context. If they conflict, execution-loop.md wins.
Phase 1 builds Layers 1-3 (runtime, local context, and skills).

SCOPE: Only create/modify GEMINI.md, local GEMINI.md files, .gemini/*,
and docs/ seed files listed below. Do NOT modify existing docs/ files,
workflow/, setup/, or .claude/.

This project is a [APP / LIBRARY / SCRIPT COLLECTION]. The stack is:
- Languages: [list]
- Build: [command, or "none - interpreted language"]
- Test: [command]
- Lint: [command]
- Format: [command, or "none - no formatter configured"]

The current GEMINI.md has domain reference content that needs to be
preserved but separated from the workflow system.

STEP 1 - Move domain content:
1. Read the current GEMINI.md completely.
2. Move ALL domain-specific reference content to docs/domain-reference.md.
   Domain content = anything describing HOW THE PROJECT WORKS rather than
   how the AGENT SHOULD BEHAVE.
   Test: does the sentence command the agent with an imperative verb?
   "Never create middleware.ts" = agent instruction (KEEP in GEMINI.md)
   "The API uses chi router on port 8080" = domain knowledge (MOVE)
3. Keep in GEMINI.md: project identity (one line), essential commands,
   and any agent-behavioural rules that already exist.

STEP 2 - Rewrite GEMINI.md:
4. Rebuild GEMINI.md with the sections listed in setup/shared/execution-loop.md.
   Target: under 120 lines. Adapt for this project.
   Do NOT skip sections (f)–(i) - they are small but required.
   The loop MUST be: READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG.
   CLASSIFY MUST include read/turn budgets per complexity tier.

STEP 3 - Docs seed files:
5. Create the files listed in setup/shared/docs-seed.md.

STEP 4 - Ownership split report:
6. Create docs/guidelines-ownership-split.md documenting what was moved.

STEP 5 - Local GEMINI.md files (Layer 2):
7. For qualifying directories only (2+ footguns, Ask First boundaries,
   differing conventions). Under 20 lines each.

VERIFICATION (all MUST pass before proceeding to Phase 1b):
- GATE: Count GEMINI.md lines. MUST be under 120.
- GATE: Verify docs/domain-reference.md contains all moved content.
- GATE: Compare original vs new to check nothing was silently dropped.
- GATE: Report GEMINI.md line count and domain-reference.md line count.
Do NOT proceed to Phase 1b until all gates pass.
```

---

## Phase 1b - Skills

```
Read docs/system-spec.md and the GEMINI.md created in Phase 1a.

SCOPE: Only create/modify files under .gemini/skills/. Do NOT modify
docs/, workflow/, or any shared documentation.

PRE-EXISTING SKILLS:
If skills already exist in .gemini/skills/, do NOT delete them.
Review and update-and-extend, not replace.

Create these 7 skills under .gemini/skills/:

1. goat-preflight/SKILL.md - RFC 2119 constraints. MUST run build/lint.
   SHOULD run formatter, full test suite. MAY skip formatter when debugging.
2. goat-investigate/SKILL.md - Minimum template: Files Involved, Request Flow,
   Boundaries Touched, Risks/Gotchas (min 3 with file:line evidence).
   Hard gate: no planning until human reviews.
3. goat-debug/SKILL.md - Diagnosis-first. "If you want to 'just try
   something' before tracing the code path, STOP."
4. goat-audit/SKILL.md - 4-pass: Discovery → Verification → Prioritisation →
   Self-Check. Pass 4 fabrication gate. MUST NOT propose fixes.
5. goat-review/SKILL.md - Structured review with RFC 2119 constraints.
6. goat-plan/SKILL.md - 4-phase planning workflow (feature brief → mob
   elaboration → SBAO ranking → milestones). Human gate between each phase.
   Skip SBAO for Standard features. Compress to single brief for Hotfixes.
7. goat-test/SKILL.md - Generate testing instructions after a milestone or
   coding session. Produces: automated test commands for the agent to run,
   AI verification prompts for a separate agent, and manual testing steps
   for the human. Based on the doer-verifier principle.

VERIFICATION (all MUST pass before proceeding to Phase 1c):
- GATE: Verify all skill files exist with required sections.
- GATE: Verify GEMINI.md router table references the skill directories.
- GATE: Run scripts/preflight-checks.sh if it exists. Otherwise run the
  project's lint + test commands from Essential Commands.
Do NOT proceed to Phase 1c until all gates pass.
```

---

## Phase 1c - Enforcement (Gemini CLI specific)

```
Read docs/system-spec.md and the GEMINI.md created in Phase 1a.

SCOPE: Only create/modify files under .gemini/. Do NOT modify docs/,
workflow/runtime/enforcement.md, setup/, .claude/, or any shared docs.

GEMINI CLI HOOK EVENTS (use these exact names in settings.json):
  BeforeTool     — runs before a tool executes (guards, blockers)
  AfterTool      — runs after a tool executes (formatting, logging)
  AfterAgent     — runs after every agent turn (linting, stop-the-line)
  SessionEnd     — runs when the session ends or is cleared (cleanup)
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
   - For Write/Edit: block .env files, lockfiles, generated code
   - Exit 0 for everything else

   AfterAgent hook: .gemini/hooks/stop-lint.sh
   - Stack-adaptive (check git diff for file types)
   - MUST exit 0 even on errors (non-zero causes infinite loops)
   - Infinite loop guard, missing tool checks

   AfterTool hook: .gemini/hooks/format-file.sh
   - Format by file extension. Skip if no formatter configured.

   BeforeTool hook (optional): .gemini/hooks/guard-truncation.sh
   - Block Write operations that reduce file size by >80%
   - Catches agents emptying files during refactors

   ALL paths MUST use: bash "$(git rev-parse --show-toplevel)/..."

2. .gitignore: .gemini/settings.local.json, tasks/todo.md, tasks/handoff.md

3. Agent ignore files: .geminiignore, .copilotignore and .cursorignore with patterns:
   .env*, **/secrets/, **/*.pem, **/*.key, **/credentials*, **/.git/

4. CI: .github/workflows/context-validation.yml (line count, router refs,
   skills, local file sizes)

VERIFICATION (all MUST pass before proceeding to Phase 2):
- GATE: Verify settings.json is valid JSON.
- GATE: Verify deny-dangerous blocks expected commands.
- GATE: Verify stop hook exits 0 even on errors.
- GATE: Verify agent ignore files exist with secret patterns.
- GATE: Run scripts/preflight-checks.sh if it exists. Otherwise run the
  project's lint + test commands from Essential Commands.
Do NOT proceed to Phase 2 until all gates pass.
```

---

## Phase 2

**Implement immediately after Phase 1c.** Do not defer.

See [shared/phase-2.md](shared/phase-2.md) for the full prompt.
