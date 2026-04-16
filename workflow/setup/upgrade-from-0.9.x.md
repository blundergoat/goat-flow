# Upgrade v0.9.x → v1.1.0

Read `01-system-overview.md` first if you haven't already.

## Before and after

**Before (v0.9.x):**
- Old skill names: goat-audit, goat-investigate, goat-onboard, goat-reflect, goat-resume, goat-context, goat-simplify, goat-refactor, goat-preflight, goat-research
- No `.goat-flow/config.yaml`
- Learning loop in `docs/footguns.md` and `docs/lessons.md` (flat files, not directories)
- No `.goat-flow/skill-preamble.md`

**After (v1.1.0):**
- 7 skills: goat, goat-debug, goat-plan, goat-review, goat-sbao, goat-security, goat-test
- `.goat-flow/config.yaml` with version 1.1.0
- Learning loop in `.goat-flow/footguns/` and `.goat-flow/lessons/` (category bucket directories)
- `.goat-flow/skill-preamble.md` shared across all skills
- `.goat-flow/architecture.md` and `.goat-flow/glossary.md`

---

## Step 0 - Run the automated migration script

Before doing anything manually, run the migration script. It handles most of the mechanical work:

```bash
# Dry-run first (safe, shows what would change):
bash /path/to/goat-flow/workflow/install-migrate-to-1.1.sh /path/to/project

# If the dry-run looks right, execute:
bash /path/to/goat-flow/workflow/install-migrate-to-1.1.sh /path/to/project --execute
```

The script migrates docs/ surfaces to .goat-flow/, deletes stale skills, removes legacy task files, and backs up everything to `.goat-flow/_migrated-from-0.9/`. After running it, continue with Step 1 below to verify and finish the setup.

---

## Step 1 - Confirm v0.9 state

You're in the right place if the project has old skill names and no `.goat-flow/config.yaml`.

- If `.goat-flow/config.yaml` exists with a version → use `upgrade-from-1.0.x.md` instead
- If no goat-flow at all → use fresh setup (`agents/claude.md` etc.)
- If you already ran the migration script (Step 0), verify the output and proceed to the fresh setup flow (`02-instruction-file.md`)

**Verification:** List detected old skill directories. Confirm no config.yaml. If the migration script ran, check `.goat-flow/_migrated-from-0.9/` for backups.

---

## Step 2 - Delete old skills (skip if migration script already ran)

Delete from ALL agent skill directories (`.claude/skills/`, `.agents/skills/`):

**Delete these:** goat-audit, goat-investigate, goat-onboard, goat-reflect, goat-resume, goat-context, goat-simplify, goat-refactor, goat-preflight, goat-research

**Verification:** No old skill directories remain. `ls {skills-dir}` shows no goat-audit etc.

---

## Step 3 - Migrate learning loop content

These files contain real project memory. Migrate the content, don't discard it.

**Footguns:** If `docs/footguns.md` exists:
1. Read the content
2. Group entries by topic (e.g., hooks, setup, auditor)
3. Create `.goat-flow/footguns/` category bucket files with one `## Footgun: <name>` entry per trap
4. Format per `.goat-flow/skill-preamble.md` Learning Loop section
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

**Verification:** `ls docs/footguns.md docs/lessons.md 2>&1` - "No such file". `.goat-flow/footguns/` and `.goat-flow/lessons/` exist with migrated content.

---

## Step 4 - Create goat-flow infrastructure

- Create `.goat-flow/config.yaml` with the current goat-flow version (run `goat-flow --version` to check)
- Create `.goat-flow/skill-preamble.md` from `workflow/skills/reference/skill-preamble.md`
- Create `.goat-flow/glossary.md` with project-specific terms
- Create or enhance `.goat-flow/architecture.md`

**Verification:** `.goat-flow/config.yaml` exists. `skill-preamble.md` exists.

---

## Step 5 - Install current skills

Install the 7 current skills from `workflow/skills/` templates into the agent's skills directory. Each skill must have `goat-flow-skill-version:` in frontmatter matching the current goat-flow version (run `goat-flow --version` to check).

Check expected version: `workflow/skills/goat-debug/SKILL.md` line 4.

**Verification:** All 7 skills present. All version tags match.

---

## Step 6 - Instruction file

Follow the numbered setup steps starting at `02-instruction-file.md`, then continue through `03-install-skills.md` to `06-final-verification.md`.

The agent config file (`agents/claude.md`, `agents/codex.md`, etc.) has agent-specific hooks and settings to wire after step 03.

**Verification:** Instruction file under 120 lines with all required sections.

---

## What to never touch

- Existing project source code, configs, scripts
- Other agents' files (single-agent scoping)
- `.github/instructions/` content - reference, don't duplicate
- Existing hooks with project-specific deny rules - merge, don't overwrite

---

## Post-upgrade verification

1. `goat-flow audit . --agent {agent}` - must pass
2. Verify required goat-flow files and directories exist
3. Review git diff - every change should be intentional
4. Confirm no parallel surfaces exist

**Session log:** Append to `.goat-flow/logs/sessions/YYYY-MM-DD-upgrade.md`:
- **Step:** upgrade from v0.9.x
- **What was done:** (skills migrated, learning loop migrated, infrastructure created)
- **Self-critique:** (honest assessment)
