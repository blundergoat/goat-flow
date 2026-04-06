# Upgrade — Bring an Existing Project to Current goat-flow

Read `shared/system-overview.md` first if you haven't already.

---

## Step 1 — Detect project state

Check these in order. The FIRST match determines the upgrade path.

| Check | State | Go to |
|-------|-------|-------|
| No `.goat-flow/` AND no `goat-*` skills anywhere | **Bare** | Not an upgrade — run fresh setup (`setup-claude.md` etc.) |
| No `.goat-flow/` BUT has old skill names (goat-audit, goat-investigate, goat-onboard, goat-reflect, goat-resume) | **v0.9** | Step 2a |
| `.goat-flow/config.yaml` exists, no `version` field or version < 1.1.0 | **v1.0** | Step 2b |
| No `.goat-flow/` AND no goat skills BUT has other AI instructions (.github/instructions/, AGENTS.md, docs/) | **Partial** | Step 2c |
| `.goat-flow/config.yaml` version matches current | **Current** | Run scanner, fix any issues |

---

## Step 2a — v0.9 → current

These projects have 10 old skills and learning loop content in `docs/` not `ai-docs/`.

### Skills
- Delete old skills: goat-audit, goat-investigate, goat-onboard, goat-reflect, goat-resume, goat-context, goat-simplify, goat-refactor
- Install current 5 + dispatcher from `workflow/skills/goat-*.md` templates
- Each skill gets the 7-line inline fallback referencing `.goat-flow/skill-conventions.md`

### Learning loop migration
- If `docs/footguns.md` exists: migrate entries to `ai-docs/footguns/setup.md` (preserve all content)
- If `docs/lessons.md` exists: migrate entries to `ai-docs/lessons/verification.md` (preserve all content)
- If `agent-evals/` exists: migrate to `ai-docs/evals/` (preserve all scenarios)
- If `docs/architecture.md` exists: keep in place or move to `ai-docs/architecture.md`
- Do NOT delete the source files until migration is verified

### Create goat-flow infrastructure
- Create `.goat-flow/config.yaml` with current version
- Copy `workflow/skills/reference/shared-preamble.md` → `.goat-flow/skill-conventions.md`
- Create `ai-docs/README.md` routing map
- Create `ai-docs/decisions/` with ADR template
- Install hooks from `workflow/hooks/`

### Handle legacy artifacts
- If `tasks/handoff.md` or `tasks/todo.md` exists with content: preserve in `.goat-flow/logs/sessions/` as migration artifact
- Do NOT create handoff-template.md or todo.md (removed in v1.1.0)

---

## Step 2b — v1.0 → current

These projects have the goat-flow structure but need template updates.

### Skills
- Update all 5 skill templates to current version (check `goat-flow-skill-version` tag)
- Replace inlined shared conventions (~150 lines) with 7-line fallback
- Install `.goat-flow/skill-conventions.md` from `workflow/skills/reference/shared-preamble.md`

### Remove deprecated artifacts
- Delete `.goat-flow/tasks/handoff-template.md` if exists
- Remove `todo.md` and `handoff.md` entries from `.goat-flow/tasks/.gitignore`
- If `.goat-flow/tasks/handoff.md` or `todo.md` has content: preserve in `.goat-flow/logs/sessions/` first
- Remove handoff/todo references from instruction file Working Memory section
- Remove Handoff row from instruction file Router Table

### Template fixes
- Update instruction file: replace enforcement language with advisory, update examples
- Update hooks to current templates from `workflow/hooks/`
- Update `.goat-flow/config.yaml` version to current

---

## Step 2c — Partial AI setup → current

These projects have AI instructions but no goat-flow. Example: `.github/instructions/` with 7 files, AGENTS.md, preflight-checks.sh.

### Audit existing surfaces
- List ALL existing AI instruction files (`.github/instructions/`, `docs/`, `ai/instructions/`, CLAUDE.md, AGENTS.md, GEMINI.md)
- These are the project's canonical standards — reference them, don't replace them

### Copy existing instruction file
- If CLAUDE.md/AGENTS.md/GEMINI.md exists: copy to `ai-docs/original-{filename}` for reference
- Create a new lean instruction file using `workflow/setup/shared/execution-loop.md` template

### Create goat-flow infrastructure
- Same as v0.9 Step 2a: .goat-flow/, ai-docs/, skills, hooks
- `ai-docs/coding-standards/` references existing `.github/instructions/` — does NOT duplicate them
- `ai-docs/README.md` routing map includes both ai-docs/ AND existing instruction file locations

### Single-agent scoping
- Only set up the agent you're running as. Don't modify other agents' files.

---

## What to never touch during upgrade

- Footgun entries (ai-docs/footguns/) — this is the project's memory
- Lesson entries (ai-docs/lessons/) — same
- Eval scenarios (ai-docs/evals/) — regression tests for agent behavior
- Architecture docs (ai-docs/architecture.md) — describes the project, not goat-flow
- Existing hooks with project-specific deny rules — merge, don't overwrite
- .claude/settings.json permission policies — additive only
- Other agents' files (single-agent scoping)

---

## Post-upgrade verification

1. Run `scripts/context-validate.sh` if it exists
2. Run `goat-flow scan . --agent {agent}` — target 100%
3. Verify project build/test/lint still passes
4. Review git diff — every change should be intentional
