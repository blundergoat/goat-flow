# Upgrade v1.0.0 → v1.1.0

Read `01-system-overview.md` first if you haven't already.

## Before and after

**Before (v1.0.0):**
- `.goat-flow/config.yaml` with version < 1.1.0
- Current skill names but older dispatcher / skill templates
- No `.goat-flow/skill-preamble.md`

**After (v1.1.0):**
- `.goat-flow/config.yaml` with version 1.1.0
- Skills installed verbatim from the current templates
- `.goat-flow/skill-preamble.md` shared across all skills
- Instruction file execution loop updated to 4 steps (`READ → SCOPE → ACT → VERIFY`)

---

## Step 1 - Confirm v1.0 state

You're in the right place if the project has `.goat-flow/config.yaml` with version < 1.1.0.

- If old skill names (goat-audit, goat-investigate, etc.) → use `upgrade-from-0.9.x.md` instead
- If no goat-flow at all → use fresh setup (`agents/claude.md` etc.)

**Verification:** `.goat-flow/config.yaml` exists with version < 1.1.0.

---

## Step 2 - Update shared goat-flow surfaces

- Install or update `.goat-flow/skill-preamble.md` from `workflow/skills/reference/skill-preamble.md`
- Ensure learning-loop content lives under `.goat-flow/footguns/`, `.goat-flow/lessons/`, and `.goat-flow/decisions/`
- Update `.goat-flow/architecture.md` and `.goat-flow/glossary.md` if the older setup left them thin or stale

**Verification:** shared goat-flow docs exist and point only at current `.goat-flow/` surfaces.

---

## Step 3 - Update skills

- Update all 7 skill templates to current version (check `goat-flow-skill-version` tag)
- Install all 7 skills verbatim from the current `workflow/skills/` templates
- Install `.goat-flow/skill-preamble.md` from `workflow/skills/reference/skill-preamble.md`

**Verification:** All 7 skills have `goat-flow-skill-version:` matching the current goat-flow version.

---

## Step 4 - Remove deprecated artifacts

- Delete `.goat-flow/tasks/handoff-template.md` if it exists
- Delete `tasks/handoff.md`, `tasks/todo.md` if they exist (preserve content in `.goat-flow/logs/sessions/` first)
- Remove handoff/todo references from instruction file

**Verification:** No handoff-template.md. No handoff/todo residue remains.

---

## Step 5 - Instruction file updates

Use the reorganise approach (not copy-and-replace):
1. Read the existing instruction file completely
2. Separate domain knowledge from agent instructions
3. Move domain knowledge → `.goat-flow/architecture.md` + `.goat-flow/glossary.md`
4. Keep behavioral rules in the instruction file
5. Add missing goat-flow sections (see `02-instruction-file.md`)
6. Update version header to v1.1.0
7. Update Router Table: all paths should reference current goat-flow surfaces
8. Update examples to reference current goat-flow surfaces (e.g., `.goat-flow/architecture.md`, `.goat-flow/footguns/`)

**Verification:** Instruction file under 120 lines. Domain content preserved in `.goat-flow/`.

---

## Step 6 - Hooks, settings, config

- Update hooks to current templates from `workflow/hooks/`
- If hooks have project-specific customizations, merge - don't overwrite
- Update `.goat-flow/config.yaml` version to the current goat-flow version
- Verify all paths in config resolve to real directories

**Verification:** Config version is 1.1.0. All paths resolve.

---

## What to never touch

- Footgun entries (`.goat-flow/footguns/`) - this is the project's memory
- Lesson entries (`.goat-flow/lessons/`) - same
- Architecture docs (`.goat-flow/architecture.md`) - describes the project, not goat-flow
- Other agents' files (single-agent scoping)
- `.github/instructions/` content - reference, don't duplicate
- Existing hooks with project-specific rules - merge, don't overwrite

---

## Post-upgrade verification

1. `goat-flow audit . --agent {agent}` - must pass
2. Verify required goat-flow files and directories exist
3. Review git diff - every change should be intentional
4. `grep -r "handoff-template\\|todo\\.md\\|handoff\\.md" .` - should return zero matches outside known historical notes

**Session log:** Append to `.goat-flow/logs/sessions/YYYY-MM-DD-upgrade.md`:
- **Step:** upgrade from v1.0.0
- **What was done:** (shared surfaces updated, skills updated, instruction file reorganised)
- **Self-critique:** (honest assessment)
