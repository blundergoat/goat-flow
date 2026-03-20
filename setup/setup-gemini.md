# Setup - Gemini CLI

Set up GOAT Flow for a project using Gemini CLI.

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
2. .gemini/hooks/deny-dangerous.sh (PreToolUse hook blocking dangerous commands)
3. .gemini/settings.json with the deny-dangerous hook registered and
   policy rules to deny git commit and git push

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
Read docs/system-spec.md. This is the GOAT Flow system spec.
Phase 1 builds Layers 1-3 (runtime, local context, and skills).

This project is a [APP / LIBRARY / SCRIPT COLLECTION]. The stack is:
- Languages: [list]
- Build: [command, or "none - interpreted language"]
- Test: [command]
- Lint: [command]
- Format: [command, or "none - no formatter configured"]

Implement Phase 1a now.

INSTRUCTION FILE:
1. Create GEMINI.md with the sections listed in setup/shared/execution-loop.md.
   Target: under [120 for apps / 100 for libraries] lines.
   Adapt all examples and Ask First boundaries for THIS project.
   Do NOT skip sections (f)–(i) - they are small but required.

DOCS SEED FILES:
2. Create the files listed in setup/shared/docs-seed.md.

LOCAL INSTRUCTION FILES (Layer 2):
3. Read docs/footguns.md and the codebase structure. For directories with
   2+ footgun entries, Ask First boundaries, or differing conventions:
   create a local GEMINI.md (under 20 lines each).
   Skip directories already covered by .github/instructions/ files.
   If no directories qualify, create none and note why.

VERIFICATION:
- Count GEMINI.md lines. MUST be under target.
- Verify all docs seed files exist.
- Report GEMINI.md line count and number of local GEMINI.md files created.
```

### Prompt B - Existing GEMINI.md (migrate domain content)

```
Read docs/system-spec.md. This is the GOAT Flow system spec.
Phase 1 builds Layers 1-3 (runtime, local context, and skills).

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
3. Keep in GEMINI.md: project identity (one line), essential commands,
   and any agent-behavioural rules that already exist.

STEP 2 - Rewrite GEMINI.md:
4. Rebuild GEMINI.md with the sections listed in setup/shared/execution-loop.md.
   Target: under [120/100] lines. Adapt for this project.
   Do NOT skip sections (f)–(i) - they are small but required.

STEP 3 - Docs seed files:
5. Create the files listed in setup/shared/docs-seed.md.

STEP 4 - Ownership split report:
6. Create docs/guidelines-ownership-split.md documenting what was moved.

STEP 5 - Local GEMINI.md files (Layer 2):
7. For qualifying directories only (2+ footguns, Ask First boundaries,
   differing conventions). Under 20 lines each.

VERIFICATION:
- Count GEMINI.md lines. MUST be under target.
- Verify docs/domain-reference.md contains all moved content.
- Compare original vs new to check nothing was silently dropped.
- Report GEMINI.md line count and domain-reference.md line count.
```

---

## Phase 1b - Skills

```
Read docs/system-spec.md and the GEMINI.md created in Phase 1a.

PRE-EXISTING SKILLS:
If skills already exist in .gemini/skills/, do NOT delete them.
Review and update-and-extend, not replace.

Create these 5 skills under .gemini/skills/:

1. goat-preflight/SKILL.md - RFC 2119 constraints. MUST run build/lint.
   SHOULD run formatter, full test suite. MAY skip formatter when debugging.
2. goat-research/SKILL.md - Minimum template: Files Involved, Request Flow,
   Boundaries Touched, Risks/Gotchas (min 3 with file:line evidence).
   Hard gate: no planning until human reviews.
3. goat-debug/SKILL.md - Diagnosis-first. "If you want to 'just try
   something' before tracing the code path, STOP."
4. goat-audit/SKILL.md - 4-pass: Discovery → Verification → Prioritisation →
   Self-Check. Pass 4 fabrication gate. MUST NOT propose fixes.
5. goat-review/SKILL.md - Structured review with RFC 2119 constraints.

VERIFICATION:
- Verify all skill files exist with required sections.
- Verify GEMINI.md router table references the skill directories.
- Run preflight checks.
```

---

## Phase 1c - Enforcement (Gemini CLI specific)

```
Read docs/system-spec.md and the GEMINI.md created in Phase 1a.

PRE-EXISTING HOOKS:
If hooks already exist in .gemini/settings.json, migrate them to
external scripts under .gemini/hooks/ before adding new hooks.

HOOKS & POLICY:
1. .gemini/settings.json - Policy rules:
   "policy": {
     "deny": ["Bash(*git commit*)", "Bash(*git push*)"]
   }

   PreToolUse hook: .gemini/hooks/deny-dangerous.sh
   - Block: rm -rf, git push main, git push --force, chmod 777,
     pipe-to-shell, .env modifications, --no-verify,
     lockfile modifications, generated code modifications
   - Exit 0 for everything else

   Stop hook: .gemini/hooks/stop-lint.sh
   - Stack-adaptive (check git diff for file types)
   - MUST exit 0 even on errors (non-zero causes infinite loops)
   - Infinite loop guard, missing tool checks

   PostToolUse hook: .gemini/hooks/format-file.sh
   - Format by file extension. Skip if no formatter configured.

   ALL paths MUST use: bash "$(git rev-parse --show-toplevel)/..."

2. .gitignore: .gemini/settings.local.json, tasks/todo.md, tasks/handoff.md

3. Agent ignore files: .geminiignore, .copilotignore and .cursorignore with patterns:
   .env*, **/secrets/, **/*.pem, **/*.key, **/credentials*, **/.git/

4. CI: .github/workflows/context-validation.yml (line count, router refs,
   skills, local file sizes)

VERIFICATION:
- Verify settings.json is valid JSON.
- Verify deny-dangerous blocks expected commands.
- Verify stop hook exits 0 even on errors.
- Run preflight checks.
```

---

## Phase 2

**Implement immediately after Phase 1c.** Do not defer.

See [shared/phase-2.md](shared/phase-2.md) for the full prompt.
