---
category: docs-and-crossrefs
---

## Footgun: Cross-reference fragility across docs

**Status:** active | **Created:** 2026-03-18 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A renamed or moved file breaks links in multiple documents. Users following getting-started.md hit dead references.

**Why it happens:** Documentation files reference each other by relative path. The project has 60+ markdown files with dense cross-referencing. Renaming one file can break references in 5-10 others.

**Evidence:**
- `docs/getting-started.md` → referenced stale paths to old workflow directory (file retired in v1.1.0, see `workflow/setup/`)
- `docs/five-layers.md` → referenced `FIVE_LAYER_SYSTEM.md` (old filename) (file retired in v1.1.0, see `workflow/setup/01-system-overview.md`)

~~**Evidence (historical — resolved):**~~
- ~~`.goat-flow/glossary.md:19` → still pointed at removed `workflow/setup/09-customise-to-project.md` after the M13 Phase 3 setup-step renumber~~ (resolved: now points to `workflow/setup/05-customise-to-project.md`)
- ~~`.goat-flow/decisions/ADR-009-evidence-lifecycle-convention.md:18` → still pointed at removed `workflow/setup/09-customise-to-project.md` after the same renumber~~ (resolved: now points to `workflow/setup/05-customise-to-project.md`)
- ~~`.goat-flow/decisions/ADR-033-sbao-mob-core-features.md:18` → still referenced removed `05-install-skills.md` after the setup flow moved the install step to `workflow/setup/03-install-skills.md`~~ (resolved: now points to `workflow/setup/03-install-skills.md`)

**Prevention:** After any file rename or move, grep the entire repo for the old path. Use `grep -r "old-filename" --include="*.md"` before declaring done. This is DoD gate #6.

---

## Resolved Entries (additional)

- **Stale references from old project structure** (resolved 2026-04-15) — `ai-workflow-framework` no longer appears anywhere in the repo (verified by `rg "ai-workflow-framework"`). Original evidence was in `.claude/settings.local.json` (gitignored, not tracked).

---

## Footgun: Preflight validates doc totals but not sub-breakdowns

**Status:** active | **Created:** 2026-04-14 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A doc claim like "16 build checks (12 setup + 4 harness)" passes the preflight because the total (16) is correct, even though the breakdown (12+4) could be wrong. The sub-breakdown can be changed to any pair that sums to 16 and no automated check catches it.

**Why it happens:** `scripts/preflight-checks.sh` Doc/Code Drift section greps for `${build_count} build` in `.goat-flow/architecture.md` — a total-only check. There is no extraction or validation of the `(N scope + M scope)` parenthetical. This means the most useful part of the claim (the breakdown) is the least validated.

**Evidence:**
- `scripts/preflight-checks.sh:346` — `grep -q "${build_count} build" .goat-flow/architecture.md` validates total only
- `.goat-flow/architecture.md:18` — was changed from "7+9" to "12+4" on 2026-04-14. Preflight passed because the total (16) was still correct. Current verified breakdown is 12 setup + 4 agent (via `SETUP_CHECKS.length` and `AGENT_CHECKS.length`).

**Prevention:** Add sub-breakdown validation: extract the `(N setup + M agent)` claim and validate N and M against `SETUP_CHECKS.length` and `AGENT_CHECKS.length`.

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

- **Concept duplication across core docs** (resolved 2026-04-14) — Retired 4 conflicting doc files in v1.1.0; `workflow/setup/reference/execution-loop.md` is now the single authoritative source.
- **Product surface count drift across code, docs, config, and tests** (resolved 2026-04-14) — Fixed 14 inconsistencies where skill counts diverged across README, docs, config, templates, and tests after goat-sbao extraction.
- **Skill template paths use framework-local paths instead of project-local paths** (resolved 2026-04-12) — Changed skill template references from `workflow/templates/` to `.goat-flow/templates/` so paths resolve on consumer projects.
- **Refactor cleanup doesn't reach bash script conditional guards** (resolved 2026-04-13) — Removed dead `[[ -f src/cli/rubric/version.ts ]]` guard that silently skipped 74 lines of version-consistency checks.
- **Partial feature removal leaves type and detection artifacts** (resolved 2026-04-14) — Removed Copilot from type unions, UI name mappers, terminal runner maps, and SKILL_ROOTS after agent removal.
- **Line target inconsistency for project shapes** (resolved 2026-03-18) — Line target canonicalized to 120 for all shapes in ADR-029.
- **CONTRIBUTING.md directs contributors to the wrong subsystem** (resolved 2026-04-13) — Rewritten to describe build checks in `check-goat-flow.ts` + `check-agent-setup.ts` and quality checks in `src/cli/audit/harness/`.
