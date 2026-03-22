# Setup - Claude Code

Set up GOAT Flow for a project using Claude Code.

**Before you start:** Read [shared/guidelines-audit.md](shared/guidelines-audit.md) and do the audit if applicable.

---

## Phase 0 (New Project Bootstrap)

Use ONLY for a brand new project with no existing CLAUDE.md.

```
I'm setting up AI workflow configuration for this project. The stack is:
- Languages: [list your languages]
- Build: [your build command, or "none - interpreted language"]
- Lint: [your lint command]
- Test: [your test command]
- Format: [your format command, or "none - no formatter configured"]

Read docs/system-spec.md. Generate the Minimal tier:
1. CLAUDE.md (under 120 lines) with the default execution loop, autonomy
   tiers, definition of done, and router table adapted to my project
2. .claude/hooks/deny-dangerous.sh (PreToolUse hook blocking dangerous commands)
3. .claude/settings.json with the deny-dangerous hook registered and
   permissions deny list for git commit and git push

Do NOT create skills, profiles, agent evals, or CI workflows yet.
After creating the files, count CLAUDE.md lines and report the count.
```

---

## Phase 1a - Foundation

**Choose your starting point:**
- **No existing CLAUDE.md:** Use Prompt A
- **Existing CLAUDE.md with domain content:** Use Prompt B (migrates domain content first)

### Prompt A - New CLAUDE.md

```
Read setup/shared/execution-loop.md FIRST — this is the authoritative
template for instruction file sections. Then read docs/system-spec.md
for background context. If they conflict, execution-loop.md wins.
Phase 1 builds Layers 1-3 (runtime, local context, and skills).

The stack is:
- Languages: [list]
- Build: [command, or "none - interpreted language"]
- Test: [command]
- Lint: [command]
- Format: [command, or "none - no formatter configured"]

Implement Phase 1a now.

INSTRUCTION FILE:
1. Create CLAUDE.md with the sections listed in setup/shared/execution-loop.md.
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
   create a local CLAUDE.md (under 20 lines each).
   Skip directories already covered by .github/instructions/ files.
   If no directories qualify, create none and note why.

VERIFICATION (all MUST pass before proceeding to Phase 1b):
- GATE: Count CLAUDE.md lines. MUST be under 120.
- GATE: Verify all docs seed files exist.
- GATE: Report CLAUDE.md line count and number of local CLAUDE.md files created.
Do NOT proceed to Phase 1b until all gates pass.
```

### Prompt B - Existing CLAUDE.md (migrate domain content)

```
Read setup/shared/execution-loop.md FIRST — this is the authoritative
template for instruction file sections. Then read docs/system-spec.md
for background context. If they conflict, execution-loop.md wins.
Phase 1 builds Layers 1-3 (runtime, local context, and skills).

The stack is:
- Languages: [list]
- Build: [command, or "none - interpreted language"]
- Test: [command]
- Lint: [command]
- Format: [command, or "none - no formatter configured"]

The current CLAUDE.md has domain reference content that needs to be
preserved but separated from the workflow system.

STEP 1 - Move domain content:
1. Read the current CLAUDE.md completely.
2. Move ALL domain-specific reference content to docs/domain-reference.md.
   Domain content = anything describing HOW THE PROJECT WORKS rather than
   how the AGENT SHOULD BEHAVE.
   Test: does the sentence command the agent with an imperative verb?
   "Never create middleware.ts" = agent instruction (KEEP in CLAUDE.md)
   "The API uses chi router on port 8080" = domain knowledge (MOVE)
3. Keep in CLAUDE.md: project identity (one line), essential commands,
   and any agent-behavioural rules that already exist.

STEP 2 - Rewrite CLAUDE.md:
4. Rebuild CLAUDE.md with the sections listed in setup/shared/execution-loop.md.
   Target: under 120 lines. Adapt for this project.
   Do NOT skip sections (f)–(i) - they are small but required.
   The loop MUST be: READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG.
   CLASSIFY MUST include read/turn budgets per complexity tier.

STEP 3 - Docs seed files:
5. Create the files listed in setup/shared/docs-seed.md.

STEP 4 - Ownership split report:
6. Create docs/guidelines-ownership-split.md documenting what was moved.

STEP 5 - Local CLAUDE.md files (Layer 2):
7. For qualifying directories only (2+ footguns, Ask First boundaries,
   differing conventions). Under 20 lines each.

VERIFICATION (all MUST pass before proceeding to Phase 1b):
- GATE: Count CLAUDE.md lines. MUST be under 120.
- GATE: Verify docs/domain-reference.md contains all moved content.
- GATE: Compare original vs new to check nothing was silently dropped.
- GATE: Report CLAUDE.md line count and domain-reference.md line count.
Do NOT proceed to Phase 1b until all gates pass.
```

---

## Phase 1b - Skills

```
Read docs/system-spec.md and the CLAUDE.md created in Phase 1a.

PRE-EXISTING SKILLS:
If skills already exist in .claude/skills/, do NOT delete them.
Review and update-and-extend, not replace.

Read the detailed skill templates in workflow/skills/goat-*.md for each
skill's full specification before creating.

Create these 7 skills under .claude/skills/:

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
   for the human. Based on the doer-verifier principle (the coding agent
   MUST NOT verify its own work).

VERIFICATION (all MUST pass before proceeding to Phase 1c):
- GATE: Verify all skill files exist with required sections.
- GATE: Verify CLAUDE.md router table references the skill directories.
- GATE: Run scripts/preflight-checks.sh if it exists. Otherwise run the
  project's lint + test commands from Essential Commands.
Do NOT proceed to Phase 1c until all gates pass.
```

---

## Phase 1c - Enforcement (Claude Code specific)

```
Read docs/system-spec.md and the CLAUDE.md created in Phase 1a.

PRE-EXISTING HOOKS:
If hooks already exist in .claude/settings.json, migrate them to
external scripts under .claude/hooks/ before adding new hooks.

HOOKS:
1. .claude/settings.json - Permissions deny list:
   "deny": ["Bash(*git commit*)", "Bash(*git push*)"]

   PreToolUse hook: .claude/hooks/deny-dangerous.sh
   - For Bash: block rm -rf, git push main, git push --force, chmod 777,
     pipe-to-shell, --no-verify
   - For Write/Edit: block .env files, lockfiles, generated code
   - Exit 0 for everything else

   Stop hook: .claude/hooks/stop-lint.sh
   - Stack-adaptive (check git diff for file types)
   - MUST exit 0 even on errors (non-zero causes infinite loops)
   - Infinite loop guard, missing tool checks

   PostToolUse hook: .claude/hooks/format-file.sh
   - Format by file extension. Skip if no formatter configured.

   PreToolUse hook (optional): .claude/hooks/guard-truncation.sh
   - Block Write operations that reduce file size by >80%
   - Catches agents emptying files during refactors

   ALL paths MUST use: bash "$(git rev-parse --show-toplevel)/..."

2. .gitignore: .claude/settings.local.json, tasks/todo.md, tasks/handoff.md

3. Agent ignore files: .copilotignore and .cursorignore with patterns:
   .env*, **/secrets/, **/*.pem, **/*.key, **/credentials*, **/.git/

   For Claude Code: also add Read deny patterns to settings.json:
   "Read(.env*)", "Read(**/secrets/**)", "Read(**/*.pem)", "Read(**/*.key)"

4. CI: .github/workflows/context-validation.yml (line count, router refs,
   skills, local file sizes)

COLD PATH: PROJECT CODING GUIDELINES

If `.github/instructions/` exists:
- Read existing files and group by domain (e.g., `php.instructions.md` + `python.instructions.md` → `ai/instructions/backend.md`)
- Create `ai/README.md` as routing map
- Keep `.github/instructions/` as optional Copilot bridges

If no instruction files exist:
- Create `ai/README.md` (routing map — see `workflow/local-context/README.md` template)
- Create `ai/instructions/base.md` (project conventions — see `workflow/local-context/base.md` template)
- Create `ai/instructions/code-review.md` (review standards — see `workflow/local-context/code-review.md` template)
- Create `ai/instructions/git-commit.md` (commit format — see `workflow/local-context/git-commit.md` template)
- Create `.github/git-commit-instructions.md` if `.git/` exists

VERIFICATION: After creating ai/instructions/ files, the agent MUST:
1. Verify every file path exists: for each backtick-wrapped path, run `ls`
2. Verify commands work: run build/test/lint commands listed in base.md
3. Remove aspirational content: if a feature is planned but not implemented, remove it
   Source of truth is the code, not docs/architecture.md or roadmaps.

Add to CLAUDE.md Router Table:
| Project guidelines | `ai/README.md` |

Verification: `ls ai/instructions/` shows base.md, code-review.md, git-commit.md.

VERIFICATION (all MUST pass before proceeding to Phase 2):
- GATE: Verify settings.json is valid JSON.
- GATE: Verify deny-dangerous blocks expected commands.
- GATE: Verify stop hook exits 0 even on errors.
- GATE: Verify .copilotignore and .cursorignore exist with secret patterns.
- GATE: Verify ai/instructions/ exists with base.md, code-review.md, git-commit.md.
- GATE: Run scripts/preflight-checks.sh if it exists. Otherwise run the
  project's lint + test commands from Essential Commands.
Do NOT proceed to Phase 2 until all gates pass.
```

---

## Phase 2

**Implement immediately after Phase 1c.** Do not defer.

See [shared/phase-2.md](shared/phase-2.md) for the full prompt.
