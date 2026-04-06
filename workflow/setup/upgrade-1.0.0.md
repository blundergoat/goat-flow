# Upgrade v1.0.0 → Current

Read `shared/system-overview.md` first if you haven't already.

These projects have the goat-flow structure but need template updates for v1.1.0.

---

## Step 1 — Confirm v1.0 state

You're in the right place if the project has:
- `.goat-flow/config.yaml` with `version: "1.0.0"` (or any version < 1.1.0)
- Current skill names (goat-debug, goat-plan, goat-review, goat-security, goat-test)
- Inlined shared conventions (~150 lines) in each skill file

If the project has old skill names (goat-audit, goat-investigate, etc.), use `upgrade-0.9.x.md` instead.
If the project has no goat-flow at all, use the fresh setup (`setup-claude.md` etc.).

---

## Step 2 — Skills

- Update all 5 skill templates to current version (check `goat-flow-skill-version` tag in frontmatter)
- Replace inlined shared conventions (~150 lines) with the 7-line fallback referencing `.goat-flow/skill-conventions.md`
- Install `.goat-flow/skill-conventions.md` from `workflow/skills/reference/shared-preamble.md`
- Install or update the `/goat` dispatcher from `workflow/skills/goat.md`

---

## Step 3 — Remove deprecated artifacts

- Delete `.goat-flow/tasks/handoff-template.md` if it exists
- Delete `tasks/handoff.md`, `tasks/todo.md` if they exist. If they have content, preserve in `.goat-flow/logs/sessions/` first.
- Remove `todo.md` and `handoff.md` entries from `.goat-flow/tasks/.gitignore`
- Remove handoff/todo references from instruction file Working Memory section
- Remove Handoff row from instruction file Router Table

---

## Step 4 — Instruction file updates

- Update version header to current (e.g., `# CLAUDE.md - v1.1.0 (YYYY-MM-DD)`)
- Replace enforcement language with advisory language
- Update Working Memory section: milestone checkboxes replace todo.md/handoff.md
- Update Router Table: remove Handoff entry, update canonical doc references (`ai-docs/architecture.md` replaces `docs/system-spec.md`)
- Update examples to reference current paths (e.g., `workflow/setup/shared/execution-loop.md` not `docs/system-spec.md`)

---

## Step 5 — Hooks and settings

- Update hooks to current templates from `workflow/hooks/`
- If hooks have project-specific customizations, merge — don't overwrite
- If `.github/instructions/` exists and `ai-docs/coding-standards/conventions.md` doesn't: create the pointer file

---

## Step 6 — Config

- Update `.goat-flow/config.yaml` version to current
- Verify all paths in config resolve to real directories

---

## What to never touch during upgrade

- Footgun entries (ai-docs/footguns/) — this is the project's memory
- Lesson entries (ai-docs/lessons/) — same
- Eval scenarios (ai-docs/evals/) — regression tests for agent behavior
- Architecture docs (ai-docs/architecture.md) — describes the project, not goat-flow
- Other agents' files (single-agent scoping)
- `.github/instructions/` content — reference, don't duplicate

---

## Post-upgrade verification

1. Run `scripts/context-validate.sh` if it exists
2. Run `goat-flow scan . --agent {agent}` — target 100%
3. Verify project build/test/lint still passes
4. Review git diff — every change should be intentional
