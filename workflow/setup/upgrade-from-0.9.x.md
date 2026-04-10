# Upgrade v0.9.x → v1.1.0

Read `01-system-overview.md` first if you haven't already.

## Before and after

**Before (v0.9.x):**
- Old skill names: goat-audit, goat-investigate, goat-onboard, goat-reflect, goat-resume, goat-context, goat-simplify, goat-refactor
- No `.goat-flow/config.yaml`
- Learning loop in `docs/footguns.md` and `docs/lessons.md` (flat files, not directories)
- No `.goat-flow/skill-conventions.md`

**After (v1.1.0):**
- 6 skills: goat, goat-debug, goat-plan, goat-review, goat-security, goat-test
- `.goat-flow/config.yaml` with version 1.1.0
- Learning loop in `.goat-flow/footguns/` and `.goat-flow/lessons/` (category bucket directories)
- `.goat-flow/skill-conventions.md` shared across all skills
- `.goat-flow/architecture.md` and `.goat-flow/glossary.md`

---

## Step 1 — Confirm v0.9 state

You're in the right place if the project has old skill names and no `.goat-flow/config.yaml`.

- If `.goat-flow/config.yaml` exists with a version → use `upgrade-from-1.0.x.md` instead
- If no goat-flow at all → use fresh setup (`agents/claude.md` etc.)

**Verification:** List detected old skill directories. Confirm no config.yaml.

---

## Step 2 — Delete old skills

Delete from ALL agent skill directories (`.claude/skills/`, `.agents/skills/`, `.github/skills/`):

**Delete these:** goat-audit, goat-investigate, goat-onboard, goat-reflect, goat-resume, goat-context, goat-simplify, goat-refactor

Also delete generic pre-goat skills if present: `audit/`, `review/`, `preflight/`

**Verification:** No old skill directories remain. `ls {skills-dir}` shows no goat-audit etc.

---

## Step 3 — Migrate learning loop content

These files contain real project memory. Migrate the content, don't discard it.

**Footguns:** If `docs/footguns.md` exists:
1. Read the content
2. Group entries by topic (e.g., hooks, setup, scanner)
3. Create `.goat-flow/footguns/` category bucket files with one `## Footgun: <name>` entry per trap
4. Format per `.goat-flow/skill-conventions.md` Learning Loop section
5. After verifying all entries migrated, delete `docs/footguns.md`

**Lessons:** If `docs/lessons.md` exists:
1. Same process → `.goat-flow/lessons/` category bucket files
2. Each entry: `## Lesson: <name>` with Created, What happened, Prevention
3. After verifying, delete `docs/lessons.md`

**Other migrations:**
- `agent-evals/` → delete entirely (evals system removed in v1.1.0)
- `docs/architecture.md` → move to `.goat-flow/architecture.md`
- `docs/decisions/` → move to `.goat-flow/decisions/`
- `docs/system-spec.md`, `docs/five-layers.md`, `docs/design-rationale.md` → delete (retired in v1.1.0)
- `tasks/handoff-template.md`, `tasks/handoff.md`, `tasks/todo.md` → if content exists, preserve in `.goat-flow/logs/sessions/`, then delete

**Parallel surfaces are an anti-pattern.** Do not leave old `docs/` files alongside new `.goat-flow/` equivalents.

**Verification:** `ls docs/footguns.md docs/lessons.md 2>&1` — "No such file". `.goat-flow/footguns/` and `.goat-flow/lessons/` exist with migrated content.

---

## Step 4 — Create goat-flow infrastructure

- Create `.goat-flow/config.yaml` with version 1.1.0
- Create `.goat-flow/skill-conventions.md` from `workflow/skills/reference/skill-conventions.md`
- Create `.goat-flow/glossary.md` with project-specific terms
- Create or enhance `.goat-flow/architecture.md`

**Verification:** `.goat-flow/config.yaml` exists. `skill-conventions.md` exists.

---

## Step 5 — Install current skills

Install the 6 current skills from `workflow/skills/goat-*.md` templates into the agent's skills directory. Each skill must have `goat-flow-skill-version: "1.1.0"` in frontmatter.

Check expected version: `workflow/skills/goat-debug.md` line 4.

**Verification:** All 6 skills present. All version tags match.

---

## Step 6 — Instruction file

Follow the numbered setup steps starting at `02-instruction-file.md`, then continue through `03-install-skills.md` to `06-final-verification.md`.

The agent config file (`agents/claude.md`, `agents/codex.md`, etc.) has agent-specific hooks and settings to wire after step 03.

**Verification:** Instruction file under 120 lines with all required sections.

---

## What to never touch

- Existing project source code, configs, scripts
- Other agents' files (single-agent scoping)
- `.github/instructions/` content — reference, don't duplicate
- Existing hooks with project-specific deny rules — merge, don't overwrite

---

## Post-upgrade verification

1. `goat-flow scan . --agent {agent}` — target 100%
2. Verify required goat-flow files and directories exist
3. Review git diff — every change should be intentional
4. Confirm no parallel surfaces exist

**Session log:** Append to `.goat-flow/logs/sessions/YYYY-MM-DD-upgrade.md`:
- **Step:** upgrade from v0.9.x
- **What was done:** (skills migrated, learning loop migrated, infrastructure created)
- **Self-critique:** (honest assessment)
