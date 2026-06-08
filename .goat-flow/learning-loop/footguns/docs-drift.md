---
category: docs-drift
last_reviewed: 2026-06-08
---

## Footgun: Cold-path docs drift while structural audit passes

**Status:** active | **Created:** 2026-04-15 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** The CLI audit reports PASS while cold-path documentation contains false claims, wrong check descriptions, dead paths, and glossary misdirections. Contributors reading docs instead of code form incorrect mental models of what the system does.

**Why it happens:** The audit validates structure (files exist, paths resolve, versions match). Partial content automation exists - `src/cli/audit/check-factual-claims.ts` catches count-claim drift across PROSE_TARGETS plus `docs/*.md`, and `src/cli/audit/check-content-quality.ts` lints vague terms and generic instructions on a fixed QUALITY_TARGETS list (instruction files, skill-reference, public docs, ADRs, workflow/setup templates). Coverage is incomplete: footgun/lesson content is only schema-enforced via `stats --check` (status field and `(search:...)` anchors), not fact-checked. Cold-path surfaces outside these target lists still drift manually as code changes.

**Evidence (verified by 8 independent critiques, 2026-04-15; recurrence confirmed by 4-critique cross-review, 2026-04-16):**

*Round 1 (2026-04-15, all resolved):*
- ~~`docs/audit-and-critique.md` - describes checks that no longer exist~~ (resolved 2026-04-15: check descriptions updated to match current code)
- ~~`docs/coding-standards/conventions.md` - claims "Zero runtime dependencies"~~ (resolved 2026-04-15: now says "Runtime dependencies: js-yaml, ws")
- ~~`docs/coding-standards/conventions.md` - claims `src/cli/prompt/types.ts` exists~~ (resolved 2026-04-15: reference removed)
- ~~`.goat-flow/glossary.md` - Handoff entry says "See Task Tracking in `.goat-flow/skill-preamble.md`"~~ (resolved 2026-04-16: glossary now correctly points to `skill-conventions.md`; the reference was later moved to `.goat-flow/skill-docs/` as a subdir but that change is separate from this resolution)
- ~~`.goat-flow/glossary.md` - Working Memory points to `skill-preamble.md`~~ (resolved 2026-04-16: glossary now correctly points to `skill-conventions.md`)
- ~~`.goat-flow/code-map.md` - listed a retired validator under `scripts/`~~ (resolved 2026-04-16: code-map moved that entry to `workflow/` with an explanatory note; the validator was later removed)
- ~~`src/cli/prompt/compose-critique.ts` - ships literal placeholder `<your-hooks-dir>`~~ (resolved 2026-04-16: placeholder removed)

*Round 2 (2026-04-16, all resolved - same pattern recurred after dashboard TS migration and skill directory restructure):*
- ~~`CONTRIBUTING.md` - claimed "8 build checks" and "18 advisory checks"; actual: 16 and 16~~ (resolved 2026-04-16)
- ~~`CONTRIBUTING.md` - referenced `app.js` and `preset-prompts.js` after .ts rename~~ (resolved 2026-04-16)
- ~~`.goat-flow/code-map.md` - claimed 15 harness checks; actual: 16~~ (resolved 2026-04-16)
- ~~`.goat-flow/code-map.md` - showed flat skill file structure after directory restructure~~ (resolved 2026-04-16)
- ~~`.goat-flow/architecture.md` - referenced `preset-prompts.js` after .ts rename~~ (resolved 2026-04-16)
- ~~`src/cli/cli.ts` - help text said 15 harness checks; actual: 16~~ (resolved 2026-04-16)
- ~~`workflow/setup/03-install-skills.md` - referenced old flat skill file names~~ (resolved 2026-04-16)
- ~~historical upgrade guide entry - referenced `goat-debug.md` instead of `goat-debug/SKILL.md`~~ (resolved 2026-04-16)

*Round 3 (2026-04-24, all resolved - surfaced by 3 independent Copilot quality reports):*
- ~~`docs/skills.md` - /goat-plan summary said "defaults to inline/read-only output" and "MUST NOT write milestone files unless the user explicitly asks"; the same file and the installed skill both say File-Write is the default at Standard+~~ (resolved 2026-04-24: summary rewritten to describe the 4-mode picker accurately)
- ~~`docs/harness-quality.md` + `docs/audit-and-quality.md` - claimed quality assessment "runs 7 skill invocations" on real code; `src/cli/prompt/compose-quality.ts` (search: `Option A`) prefers file analysis and only does live invocation "if context allows"~~ (resolved 2026-04-24: language updated to reflect file-analysis-preferred approach)
- ~~`.goat-flow/architecture.md` - hot-path listing named only CLAUDE.md, AGENTS.md, GEMINI.md; omitted `.github/copilot-instructions.md` which `workflow/setup/agents/copilot.md` (search: `standalone hot-path`) and `workflow/setup/01-system-overview.md` (search: `## What goat-flow is`) both treat as hot-path~~ (resolved 2026-04-24: copilot-instructions.md added to hot-path listing)

*Round 4 (2026-05-11, all resolved - surfaced by full documentation audit; same pattern recurred during the v1.6.0 release wave):*
- ~~`CONTRIBUTING.md` - claimed "17 checks grouped by 5 concerns" while `src/cli/audit/harness/check-*.ts` exports 16 distinct ids and every other doc surface (audit-checks.md, cli.md, audit-and-quality.md, harness-audit.md, glossary.md, architecture.md) said 16~~ (resolved 2026-05-11)
- ~~`CONTRIBUTING.md` - placed `skill-quality-testing.md` in `workflow/skills/reference/`; the v1.4.x reference/playbook split moved it to `workflow/skills/playbooks/` and it installs to `.goat-flow/skill-docs/playbooks/`~~ (resolved 2026-05-11)
- ~~`docs/cli.md` - missing `goat-flow skill new` and `goat-flow quality candidacy` (both shipped in v1.6.0 and documented in `docs/skill-authoring.md`)~~ (resolved 2026-05-11)
- ~~`docs/dashboard.md` - API endpoints table missing `/api/quality/evaluate` (canonical per v1.6.0), `/api/quality/analyse`, `/api/quality/history`, `/api/skill-quality/inventory`, `/api/skill-quality`, `/api/browse`, `POST /api/projects/list`, `POST /api/terminal/:id/upload-image`~~ (resolved 2026-05-11)
- ~~`.goat-flow/code-map.md` - docs/ listing missing `skill-authoring.md`, `skill-quality-config.md`, `site/`; `.goat-flow/` listing missing `logs/critiques/`, `logs/security/`, `logs/uploads/`~~ (resolved 2026-05-11)
- ~~`.goat-flow/architecture.md` - "Local report history" row missing `.goat-flow/logs/security/`~~ (resolved 2026-05-11)
- ~~`.goat-flow/glossary.md` - Hot Path entry omitted `.github/copilot-instructions.md` despite the same fix being applied to `architecture.md` in Round 3~~ (resolved 2026-05-11)
- ~~`CLAUDE.md` / `AGENTS.md` / `GEMINI.md` / `.github/copilot-instructions.md` - "Never" tier listed materially different forbidden actions across the four files; `scripts/check-instruction-parity.mjs` did not catch it because it validates section headings only~~ (resolved 2026-05-11: aligned to canonical CLAUDE.md/copilot wording; AGENTS.md and GEMINI.md updated)
- ~~All four instruction-file headers - dated `(2026-05-04)` against `v1.6.0`; CHANGELOG shows v1.6.0 shipped on 2026-05-10; `2026-05-04` was the date of v1.4.3~~ (resolved 2026-05-11)
- ~~`.goat-flow/learning-loop/decisions/ADR-025` / `ADR-026` / `ADR-027` - `**Status:** accepted` (lowercase) violated the README's documented status vocabulary `Proposed | Accepted | Implemented | Superseded`~~ (resolved 2026-05-11)
- ~~`README.md` - "Skills (seven `/goat-*` commands + dispatcher)" miscounted; there are 6 `/goat-*` skills plus the dispatcher = 7 total~~ (resolved 2026-05-11)
- ~~`.github/PULL_REQUEST_TEMPLATE.md` - test plan said `node dist/cli/cli.js audit .` while every other doc uses `npx goat-flow audit .`; `dist/` may not exist when contributors run the test plan~~ (resolved 2026-05-11)
- ~~`workflow/evaluation/README.md` - file table listed `footguns.md` and `lessons.md` only; directory also contains `patterns.md`~~ (resolved 2026-05-11)
- ~~`docs/dashboard.md`, `.goat-flow/skill-docs/skill-quality-testing/README.md`, `.goat-flow/skill-docs/skill-quality-testing/tdd-iteration.md`, `workflow/skills/reference/skill-preamble.md` (and the workflow source mirrors of the playbook files) - cited evidence under `.goat-flow/scratchpad/` (gitignored) or vaguely "the prime corpus", so readers cloning the repo could not follow the references; same surfaces also leaked third-party / competitor skill names (MySQL, Valyu, frontend-design) and a vendor env var (`VALYU_API_KEY`) into goat-flow's own committed docs~~ (resolved 2026-05-11: scratchpad-path citations replaced with in-repo references or guidance-only framing; competitor names removed and patterns rewritten provider-neutrally; new lesson added at `.goat-flow/learning-loop/lessons/agent-behavior.md` (search: `Agent cited gitignored content as evidence in committed docs`))
- ~~`docs/skill-quality-config.md` - used a bare skill-file basename in code formatting while explaining uploaded skill evaluation; path-integrity treated it as a repo-local path and failed `test/integration/audit-drift.test.ts` in PR #36~~ (resolved 2026-05-11: now uses prose at `docs/skill-quality-config.md` (search: `uploaded skill file can keep`))

**Impact:** The framework demands "real evidence only" and "MUST maintain cross-file consistency" while its own cold-path surfaces violate both rules. Agents consulting docs for orientation get wrong information. The audit's PASS stamp creates false confidence. Round 4 also surfaced two new failure modes worth promoting to a preflight check (see Prevention #5 and #6 below).

**Prevention:**
1. Add content-drift checks to preflight: compare doc check descriptions against exported check names from code
2. Extend path-integrity checks to cover code-map, glossary canonical-file paths, and convention claims
3. Consider auto-generating audit docs from check code to prevent drift permanently
4. Change Step 01 early-stop rule (`workflow/setup/01-system-overview.md` (search: `## State check`)) to require content-drift checks, not just structural audit pass
5. **Block citations of gitignored paths from committed files** - add a preflight grep for `\.goat-flow/(scratchpad|plans|logs/sessions|logs/quality|logs/critiques|logs/security|logs/uploads)/` inside `*.md` and `*.ts` files (excluding the gitignored trees themselves and the documented "where to write artifacts" instructions). The `instruction-file-skill-docs-pointer` audit check already understands which paths are gitignored; reuse that classification here.
6. **Block competitor / third-party skill names in goat-flow-owned committed surfaces** - maintain a small denylist (`Valyu`, `MySQL skill`, `prime corpus`, `frontend-design skill`, `writing-skills`, plus any future external skill references discovered) and grep `*.md` / `*.ts` outside `node_modules`, `.claude/worktrees`, `.goat-flow/scratchpad`, `.goat-flow/plans`, `.goat-flow/logs`. Generic patterns must be stated provider-neutrally (`<VENDOR>_API_KEY`, `a domain skill`, `a vendor-SDK skill`).
7. **Do not format illustrative basenames as path-like code spans** unless they resolve from the repo root. If a filename is an example rather than an actual path, write it in prose or include a valid parent directory.
8. **Instruction-header dates drift every release because `bump-version.sh` updates the version but not the date.** The Round 4 fix (2026-05-11) corrected the stale `(2026-05-04)` headers by hand, but it recurred at 1.10.1: `CLAUDE.md` / `AGENTS.md` / `.github/copilot-instructions.md` shipped `v1.10.1 (2026-05-20)` while the release date was 2026-06-08, because `scripts/bump-version.sh` (search: `update_file`) seds only the version string in the `# {FILE} - v{VERSION} ({DATE})` header. Fix the script to also set the `({DATE})` to the CHANGELOG's latest release date (or add a preflight check comparing each header date to it); until then, update the three header dates by hand as part of every release bump.
