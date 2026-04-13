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

## Footgun: Product surface count drift across code, docs, config, and tests

**Status:** mostly resolved (12/14 fixed, 2 remaining) | **Created:** 2026-04-11 | **Updated:** 2026-04-13 | **Evidence:** OBSERVED

**Symptoms:** The repo describes different skill counts in different places. Code says 7, config says 6, README says "Six", docs say "Five+dispatcher", tests say 5 or 6. External critics independently flagged this as a trust problem - the system sells coherence but can't maintain it internally.

**Why it happens:** When a new skill is added (goat-sbao was extracted from goat-plan), the skill template file and constants.ts get updated, but secondary surfaces don't. These secondary surfaces have no automated check linking them to the canonical SKILL_NAMES constant.

**Evidence (14 bugs found 2026-04-11, status updated 2026-04-12):**
- ~~`src/cli/prompt/template-refs.ts:108` - SKILL_TEMPLATES has 6 entries, missing goat-sbao~~ FIXED: now has 7
- ~~`src/cli/prompt/fragments/foundation.ts:23,60,237` - hardcodes `v1.0` in a v1.1.0 release~~ FIXED
- ~~`.goat-flow/config.yaml:12` - skills.install lists 6 skills, goat-sbao absent~~ FIXED: now lists 7
- ~~`.goat-flow/config.yaml:40` - references `scripts/context-validate.sh`~~ FIXED: config no longer references this
- ~~`src/cli/config/reader.ts:20-35` - KNOWN_TOP_LEVEL_KEYS missing `known-gaps` and `skill-overrides`~~ FIXED
- ~~`README.md:89` - "Six structured workflows"~~ FIXED: now says "Seven"
- ~~`README.md:91` - overclaims post-turn hooks; `workflow/hooks/README.md:29` contradicts~~ FIXED: README now accurately describes deny-dangerous.sh only
- ~~`docs/skills.md.md:1` - "Five focused capabilities", diagram omits goat-sbao~~ FIXED: now says "Seven"
- ~~`workflow/setup/04-architecture-code-map.md:38` - "Skills do NOT read templates at runtime"~~ FIXED
- ~~`src/cli/prompt/fragments/standard.ts:617` - still creates `.goat-flow/coding-standards/`~~ FIXED: line 617 is now learning-loop code, not coding-standards creation
- `src/cli/classify-state.ts:133-145` - marks "healthy" from config version + skills + instruction + preamble — DESIGN CHOICE (shallow but intentional)
- ~~rubric/full.ts:129 - check named "Skill conventions" but checks skill-preamble.md~~ FIXED: file restructured to standard/promoted.ts
- ~~`workflow/skills/goat-plan.md:115,175` - inline mode contradicts "MUST write" constraint~~ FIXED: inline is for Hotfix/Small Feature only; Standard+ requires files. No contradiction.
- ~~`src/cli/facts/shared/learning-loop.ts:112` - `listMarkdownEntries()` only handles directories, not flat files~~ FIXED
- ~~`test/unit/evaluate-check.test.ts` - skill count updated to 7~~ FIXED
- ~~`.goat-flow/architecture.md:27,55` - stale paths~~ FIXED: paths now current

**Root cause:** No automated check validates that the canonical SKILL_NAMES is reflected consistently across README, docs, config, template-refs, test fixtures, and setup fragments. Each surface drifts silently.

**Prevention:**
1. Add a contract test: SKILL_NAMES.length must match README, docs/skills.md, SKILL_TEMPLATES, and config.yaml skills.install
2. After adding/removing any skill, grep for the old count: `grep -rn "Six\|six\|5 focused\|6 skills\|All 6" --include="*.md" --include="*.ts"`
3. `scripts/preflight-checks.sh` should verify SKILL_NAMES count across all surfaces

---

## Footgun: CONTRIBUTING.md directs contributors to the wrong subsystem (RESOLVED)

**Status:** resolved | **Created:** 2026-04-13 | **Resolved:** 2026-04-13 | **Evidence:** ACTUAL_MEASURED

CONTRIBUTING.md was rewritten. The "How to Add a New Audit Check" section (line 52) now correctly describes both systems: build checks in `src/cli/audit/build-checks.ts` (16 checks, CI gate) and quality checks in `src/cli/audit/quality-checks.ts` (27 checks, advisory). No reference to `src/cli/rubric/` remains. `src/cli/rubric/` was removed in v1.1.0.

---

## Footgun: Skill template paths use framework-local paths instead of project-local paths

**Status:** resolved | **Created:** 2026-04-11 | **Resolved:** 2026-04-12 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Installed skills reference `workflow/templates/*.md` which only exists in the goat-flow repo, not in projects where skills are installed. The dispatcher's Planning Route hits dead ends. Security and test skills can't find their extracted mode templates.

**Why it happens:** When content is extracted from skills to `workflow/templates/` in the goat-flow repo, the skill file references use the framework-local path (`workflow/templates/`) instead of the project-local path (`.goat-flow/templates/`). Skills are installed verbatim, so the framework path ships to every project.

**Evidence:**
- ~~`workflow/skills/goat.md:25,26` - referenced `workflow/templates/`~~ FIXED: now uses `.goat-flow/templates/`
- ~~`workflow/skills/goat-security.md:71` - referenced `workflow/templates/compliance-checklist.md`~~ FIXED: now uses `.goat-flow/templates/`
- ~~`workflow/skills/goat-test.md:108,145` - referenced `workflow/templates/flow-diagram-guide.md`~~ FIXED: now uses `.goat-flow/templates/`
- R9 critiques: 6/7 projects flagged broken template references as a top finding

**Prevention:** After ANY content extraction to `workflow/templates/`, grep all skill files for `workflow/templates/` and replace with `.goat-flow/templates/`. The rule: skill files must only reference paths that exist on the PROJECT, not paths that exist in the goat-flow REPO.

---

## Footgun: Refactor cleanup doesn't reach bash script conditional guards

**Status:** active | **Created:** 2026-04-13 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** `preflight-checks.sh` shows `⊘ Version check (missing package.json or version.ts) (skipped)` on every run. 74 lines of validation — config.yaml version, CHANGELOG version, instruction file header version, rubric change detection — never execute. No error is thrown. The preflight passes and reports "18 checks" while silently skipping an entire section.

**Why it happens:** `preflight-checks.sh:148` gates the entire version-consistency section on `[[ -f src/cli/rubric/version.ts ]]`. That file was deleted in the M27 scanner removal. The bash `if ... else skip; fi` pattern silently converts a deleted-file guard into a permanent skip. TypeScript refactors are caught by the compiler; bash conditional guards referencing deleted files are not caught by anything.

**Evidence:**
- `scripts/preflight-checks.sh:148` — `if [[ -f package.json ]] && [[ -f src/cli/rubric/version.ts ]]; then`
- `scripts/preflight-checks.sh:148-221` — 74 lines inside the dead block: config version check, CHANGELOG version, instruction file headers, rubric change detection
- `scripts/preflight-checks.sh:220` — skip message: "missing package.json or version.ts" (implies `version.ts` is the problem, but `package.json` obviously exists)
- `scripts/preflight-checks.sh:159, .github/workflows/ci.yml:62` — both have stale error message "RUBRIC_VERSION not found in version.ts"

**Pattern:** Refactor cleanup has three predictable failure surfaces that get missed:
1. **Bash conditional guards** — `if [[ -f deleted-file ]]; then ... else skip; fi` silently become permanent skips
2. **Developer documentation** — `docs/coding-standards/`, CONTRIBUTING.md sections describing deleted architecture
3. **Error message strings** — CI `echo "::error::..."` and bash `fail "..."` messages that name deleted files

**Prevention:** After any file deletion as part of a refactor:
1. `grep -rn "deleted-filename" scripts/ .github/` — finds bash guards and CI error messages
2. `grep -rn "deleted-filename" docs/ CONTRIBUTING.md` — finds developer doc references  
3. For bash scripts specifically: look for `[[ -f path ]]` guards where `path` is the deleted file — these become silent skips, not errors

---

## Footgun: Partial feature removal leaves type and detection artifacts

**Status:** active | **Created:** 2026-04-13 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Copilot was removed as a supported agent but artifacts remain in five places. The `.github/skills` detection path in classify-state.ts and dashboard.ts is the dangerous one: a project with `.github/skills/goat-debug/SKILL.md` gets partial-state credit for a skill "installed" for an agent that doesn't exist in the audit system. State detection reports "partial" based on a path no supported agent ever populates.

**Why it happens:** Feature removal typically targets the primary implementation surface (audit checks, VALID_RUNNERS, agent profiles). Downstream artifacts — type unions, UI name mappers, terminal runner maps, skill-root arrays — are secondary surfaces that don't break at runtime and are easy to miss in a removal PR.

**Evidence:**
- `src/cli/server/types.ts:21` — `Runner = "claude" | "codex" | "gemini" | "copilot"` (type drift)
- `src/dashboard/views/home.html:396` — `copilot: 'Copilot'` in agent name mapper (UI dead branch)
- `src/cli/server/terminal.ts:39` — `copilot: "copilot"` in runner spawn map
- `src/cli/classify-state.ts:38` — `.github/skills` in SKILL_ROOTS (correctness bug: inflates skill detection)
- `src/cli/server/dashboard.ts:614` — `.github/skills` in per-agent skill root check (same bug, second location)
- All five confirmed by grep 2026-04-13; no supported agent profile uses `.github/skills`

**Prevention:** When removing a feature/agent from the audit system, grep for the feature name across all file types: `grep -rn "copilot\|github/skills" src/ --include="*.ts" --include="*.html"`. Type unions, UI name mappers, and skill-root arrays are specifically easy to miss. Checklist for agent removal:
- [ ] Remove from `Runner` type
- [ ] Remove from `VALID_RUNNERS`
- [ ] Remove from terminal runner map
- [ ] Remove from SKILL_ROOTS in classify-state.ts
- [ ] Remove from skill root arrays in dashboard.ts
- [ ] Remove from UI name mappers
