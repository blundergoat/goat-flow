---
category: docs-and-crossrefs
---

## Footgun: Concept duplication across core docs

**Status:** active | **Created:** 2026-03-18 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A user reads conflicting descriptions of the same concept in different files. An agent follows a rule from one file that contradicts another.

**Why it happens:** The execution loop, autonomy tiers, anti-pattern table, and other core concepts were historically described in `docs/system-spec.md`, `docs/five-layers.md`, `docs/getting-started.md`, and `docs/design-rationale.md` (all retired in v1.1.0). Updating one without updating the others created drift. The same risk applies to their replacements.

**Evidence:**
- `docs/system-spec.md` → execution loop definition (file retired in v1.1.0, see `workflow/setup/reference/execution-loop.md`)
- `docs/system-spec.md` → execution loop definition, detailed version (file retired in v1.1.0, see `workflow/setup/reference/execution-loop.md`)
- `docs/getting-started.md` → execution loop summary (file retired in v1.1.0, see `workflow/setup/`)
- `docs/design-rationale.md` → execution loop rationale with repeated content (file retired in v1.1.0, see `workflow/setup/01-system-overview.md`)

**Prevention:** When editing a core concept, grep for the concept name across all docs and update every occurrence. `workflow/setup/reference/execution-loop.md` is the canonical source for the execution loop; `workflow/setup/01-system-overview.md` for design intent.

---

## Footgun: Cross-reference fragility across docs

**Status:** active | **Created:** 2026-03-18 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A renamed or moved file breaks links in multiple documents. Users following getting-started.md hit dead references.

**Why it happens:** Documentation files reference each other by relative path. The project has 60+ markdown files with dense cross-referencing. Renaming one file can break references in 5-10 others.

**Evidence:**
- `docs/getting-started.md` → referenced stale paths to old workflow directory (file retired in v1.1.0, see `workflow/setup/`)
- `docs/five-layers.md` → referenced `FIVE_LAYER_SYSTEM.md` (old filename) (file retired in v1.1.0, see `workflow/setup/01-system-overview.md`)
- `.goat-flow/glossary.md:19` → still pointed at removed `workflow/setup/09-customise-to-project.md` after the M13 Phase 3 setup-step renumber
- `.goat-flow/decisions/ADR-009-evidence-lifecycle-convention.md:18` → still pointed at removed `workflow/setup/09-customise-to-project.md` after the same renumber
- `.goat-flow/decisions/ADR-033-sbao-mob-core-features.md:18` → still referenced removed `05-install-skills.md` after the setup flow moved the install step to `workflow/setup/03-install-skills.md`

**Prevention:** After any file rename or move, grep the entire repo for the old path. Use `grep -r "old-filename" --include="*.md"` before declaring done. This is DoD gate #6.

---

## Footgun: Stale references from old project structure

**Status:** active | **Created:** 2026-03-18 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Settings, paths, or documentation reference `ai-workflow-framework` (the old project name) instead of `goat-flow`.

**Why it happens:** The project was renamed from `ai-workflow-framework` to `goat-flow`. Not all references were updated.

**Evidence:**
- `.claude/settings.local.json` → contained absolute paths referencing the old project name (file is gitignored, not tracked)

**Prevention:** After any project-level rename, run `grep -r "old-name" --include="*.md" --include="*.json"` across the entire repo.

---

## Footgun: Line target inconsistency for project shapes (RESOLVED)

**Status:** resolved | **Created:** 2026-03-18 | **Evidence:** ACTUAL_MEASURED

**Prevention:** Line target is 120 for all shapes, stated in `.goat-flow/decisions/ADR-029-instruction-budget-constraint.md` (`docs/system-spec.md` retired in v1.1.0). If this number appears differently in any other file, the ADR is canonical.

## Footgun: Skill template paths use framework-local paths instead of project-local paths

**Status:** active | **Created:** 2026-04-11 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Installed skills reference `workflow/templates/*.md` which only exists in the goat-flow repo, not in projects where skills are installed. The dispatcher's Planning Route hits dead ends. Security and test skills can't find their extracted mode templates.

**Why it happens:** When content is extracted from skills to `workflow/templates/` in the goat-flow repo, the skill file references use the framework-local path (`workflow/templates/`) instead of the project-local path (`.goat-flow/templates/`). Skills are installed verbatim, so the framework path ships to every project.

**Evidence:**
- `workflow/skills/goat.md:71,74` — referenced `workflow/templates/feature-brief.md` and `workflow/templates/mob-elaboration.md`
- `workflow/skills/goat-security.md:71` — referenced `workflow/templates/compliance-checklist.md`
- `workflow/skills/goat-test.md:108,145` — referenced `workflow/templates/flow-diagram-guide.md`
- R9 critiques: 6/7 projects flagged broken template references as a top finding

**Prevention:** After ANY content extraction to `workflow/templates/`, grep all skill files for `workflow/templates/` and replace with `.goat-flow/templates/`. The rule: skill files must only reference paths that exist on the PROJECT, not paths that exist in the goat-flow REPO.
