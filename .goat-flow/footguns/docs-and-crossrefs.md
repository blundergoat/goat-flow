---
category: docs-and-crossrefs
last_reviewed: 2026-04-27
---

## Footgun: Cross-reference fragility across docs

**Status:** active | **Created:** 2026-03-18 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A renamed or moved file breaks links in multiple documents. Dense pointer maps mean one stale path can mislead setup, glossary, or architecture readers at multiple entry points.

**Why it happens:** Documentation files reference each other by relative path. The project has 120+ markdown files with dense cross-referencing. Renaming one file can break references in 5-10 others.

**Evidence:**
- `.goat-flow/glossary.md` → the Canonical File column is a dense pointer map into workflow/setup, skill-reference, and skill files. A single rename can invalidate multiple glossary entries at once.
- `workflow/setup/01-system-overview.md` → `NEXT:` links and numbered-step references hard-link the setup flow across multiple files; renaming one step file breaks the flow.
- `.goat-flow/architecture.md` → component/location tables point readers at concrete paths across `src/`, `workflow/`, and `.goat-flow/`; stale paths here become wrong architecture guidance, not cosmetic drift.

~~**Evidence (historical - resolved):**~~
- ~~`.goat-flow/glossary.md` → still pointed at removed `workflow/setup/09-customise-to-project.md` after the M13 Phase 3 setup-step renumber~~ (resolved: now points to `workflow/setup/05-customise-to-project.md`)
- ~~historical evidence-lifecycle ADR entry → still pointed at removed `workflow/setup/09-customise-to-project.md` after the same renumber~~ (resolved before the ADR was later removed from the active set)
- ~~`.goat-flow/decisions/ADR-011-sbao-mob-core-features.md` → still referenced removed `05-install-skills.md` after the setup flow moved the install step to `workflow/setup/03-install-skills.md`~~ (resolved: now points to `workflow/setup/03-install-skills.md`)

**Prevention:** After any file rename or move, grep the entire repo for the old path. Use `grep -r "old-filename" --include="*.md"` before declaring done. This is DoD gate #6.

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
- ~~`.goat-flow/glossary.md` - Handoff entry says "See Task Tracking in `.goat-flow/skill-preamble.md`"~~ (resolved 2026-04-16: glossary now correctly points to `skill-conventions.md`; the reference was later moved to `.goat-flow/skill-reference/` as a subdir but that change is separate from this resolution)
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

**Impact:** The framework demands "real evidence only" and "MUST maintain cross-file consistency" while its own cold-path surfaces violate both rules. Agents consulting docs for orientation get wrong information. The audit's PASS stamp creates false confidence.

**Prevention:**
1. Add content-drift checks to preflight: compare doc check descriptions against exported check names from code
2. Extend path-integrity checks to cover code-map, glossary canonical-file paths, and convention claims
3. Consider auto-generating audit docs from check code to prevent drift permanently
4. Change Step 01 early-stop rule (`workflow/setup/01-system-overview.md` (search: `## State check`)) to require content-drift checks, not just structural audit pass

---

## Footgun: Hot-path agent instructions drift unevenly across agents

**Status:** active | **Created:** 2026-04-27 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** One agent receives weaker release or routing guidance than the others even though all four instruction files are supposed to express the same core contract.

**Why it happens:** Claude, Codex, Gemini, and Copilot use separate hot-path files with different compression levels. Cross-agent consistency checks cover a few structural sections, but not every command line or router-table detail.

**Evidence:** A 2026-04-27 quality-review pass found `.github/copilot-instructions.md` needed the same release command now present at `.github/copilot-instructions.md` (search: `npm run test:full`) because it still told Copilot to run only the slow suite while `CLAUDE.md`, `AGENTS.md`, and `GEMINI.md` used `npm run test:full`. The same pass found `AGENTS.md` and `GEMINI.md` Shared skill reference rows omitted the ADR-023 topical files now visible at `AGENTS.md` (search: `skill-quality-testing/tdd-iteration.md`) and `GEMINI.md` (search: `skill-quality-testing/tdd-iteration.md`).

**Prevention:** When changing Essential Commands or Router Table rows in one agent instruction file, grep all four hot-path files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.github/copilot-instructions.md`) for the same concept and update them together. Add preflight coverage when the row affects release validation or canonical reference discovery.

---

## Footgun: Filesystem-backed validation can miss untracked or ignored replacement files

**Status:** active | **Created:** 2026-04-19 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Local validation passes, but the next commit or CI run breaks because the replacement file exists only in the working tree. The repo appears fixed to the current operator while collaborators still receive the broken state.

**Why it happens:** Several goat-flow verification paths inspect the real filesystem, not the git index. `src/cli/manifest/manifest.ts` enumerates dashboard views with `readdirSync()`, and path-integrity/preflight treat a path as fixed once it exists on disk. That means an untracked replacement file can satisfy local checks. A second variant is worse: `.goat-flow/.gitignore` ignores almost everything by default, so a new repo-local file can look present locally while remaining impossible to commit.

**Evidence:**
- `src/cli/manifest/manifest.ts` (search: `readdirSync(dir)`) validates `facts.dashboard_views` against the working tree, not the index.
- `src/dashboard/index.html` (search: `views/setup.html`) can include a replacement view file even if that file is still untracked.
- `.goat-flow/.gitignore` (search: `*`) ignores new `.goat-flow/*` files unless they are explicitly whitelisted, which masked `.goat-flow/security-policy.md` during local verification.

**Prevention:**
1. After any add/rename/delete tied to setup, dashboard views, or repo-local policy files, run `git status --short` and confirm the replacement path is tracked.
2. Use `git ls-files --error-unmatch <path>` for any new canonical path that a fix depends on.
3. When introducing a new tracked file under `.goat-flow/`, update `.goat-flow/.gitignore` in the same change or the fix is local-only.

---

## Footgun: Prose examples for agent-specific paths drift from the manifest

**Status:** active | **Created:** 2026-04-21 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A doc lists an agent-specific path (`.gemini/skills/`, `.codex/skills/`, etc.) that does not match the manifest. The harness `doc-paths-resolve` check may or may not catch it depending on whether the wrong path happens to exist on disk. When the harness catches it, every agent card in the dashboard drops to 75% Context with the same finding; when it does not, the doc is silently wrong.

**Why it happens:** `workflow/manifest.json` is the canonical source for each agent's `skills_dir`, `hooks_dir`, `settings`, and `instruction_file`. Prose in docs hand-writes these paths as examples - often guessed from the agent name (`gemini` → `.gemini/skills/`) rather than looked up. Multiple agents sometimes share a directory (gemini and codex both use `.agents/skills/`), so name-based inference is wrong by default for those agents. The detection gap: `src/cli/audit/harness/check-context.ts` (search: `extractBacktickPaths`) only verifies that backtick-quoted paths resolve on disk. A plausible-but-wrong path that happens to exist (e.g. writing `.claude/skills/` in a gemini example) passes the audit while still misleading readers.

**Evidence:**
- `workflow/manifest.json` (search: `"skills_dir"`) - four entries, but only three distinct paths: `.claude/skills/`, `.agents/skills/` (shared by codex and gemini), `.github/skills/`. Name-based inference gives the wrong answer for gemini.
- `docs/audit-and-quality.md` (search: `satellite agents' skill dirs`) - previously named `.gemini/skills/` as an example of a satellite-agent skill dir. The path does not exist (and never did per the manifest); the harness caught it only because `.gemini/skills/` happens not to exist on disk.
- `src/cli/audit/harness/check-context.ts` (search: `extractBacktickPaths`) - existence-only check; an agent-wrong path that exists (e.g. `.claude/skills/` in a gemini example) would pass.

**Prevention:**
1. Before hand-writing an agent-specific path in prose, grep `workflow/manifest.json` for that agent's `skills_dir` / `hooks_dir` / `settings` / `instruction_file` entry and copy the exact value.
2. When listing satellite-agent directories as examples, enumerate the *distinct* paths from the manifest (today: `.claude/skills/`, `.agents/skills/`, `.github/skills/`) - do not invent per-agent subdirectories from agent names.
3. Consider extending `doc-paths-resolve` to validate agent-specific paths against manifest entries (existence-plus-correctness), not just filesystem existence, so agent-wrong paths that happen to resolve also get caught.

---

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

- **Concept duplication across core docs** (resolved 2026-04-14) - Retired 4 conflicting doc files in v1.1.0; `workflow/setup/reference/execution-loop.md` is now the single authoritative source.
- **Product surface count drift across code, docs, config, and tests** (resolved 2026-04-14) - Fixed 14 inconsistencies where skill counts diverged across README, docs, config, templates, and tests after goat-sbao extraction.
- **Skill template paths use framework-local paths instead of project-local paths** (resolved 2026-04-12) - Changed skill template references away from `workflow/templates/`. The interim landing path `.goat-flow/templates/` was later retired; today the shared references live at `.goat-flow/skill-reference/`.
- **Refactor cleanup doesn't reach bash script conditional guards** (resolved 2026-04-13) - Removed dead `[[ -f src/cli/rubric/version.ts ]]` guard that silently skipped 74 lines of version-consistency checks.
- **Partial feature removal leaves type and detection artifacts** (resolved 2026-04-14) - Removed Copilot from type unions, UI name mappers, terminal runner maps, and SKILL_ROOTS after agent removal.
- **Line target inconsistency for project shapes** (resolved 2026-03-18) - Line target canonicalized to 120 for all shapes in ADR-008.
- **CONTRIBUTING.md directs contributors to the wrong subsystem** (resolved 2026-04-13) - Rewritten to describe build checks in `check-goat-flow.ts` + `check-agent-setup.ts` and quality checks in `src/cli/audit/harness/`.
- **Stale references from old project structure** (resolved 2026-04-15) - `ai-workflow-framework` no longer appears anywhere in the repo (verified by `rg "ai-workflow-framework"`).
- **Preflight validates doc totals but not sub-breakdowns** (resolved 2026-04-17) - `scripts/preflight-checks.sh` (search: `B.8a2: Sub-breakdown validation`) now extracts `setup_count` and `agent_count` from the audit modules and validates the `(N setup + M agent)` breakdown claim in `.goat-flow/architecture.md`, not just the total. Verified by grep of preflight source.
- **Dashboard session-limit constants drift across server, UI, docs, and tests** (resolved 2026-04-19) - `src/cli/server/terminal.ts` (search: `MAX_SESSIONS`) exports the constant, `src/cli/server/dashboard-terminal.ts` (search: `MAX_SESSIONS`) imports it, `test/integration/dashboard-server.test.ts` (search: `data.maxSessions`) asserts the value, and `docs/dashboard.md` says "Maximum 10 concurrent sessions" - all four surfaces agree on 10. Pattern-class hygiene ("single exported constant reused in API payload, UI guards, and static copy") remains good practice for any future repo-wide cap; grep `maxSessions`, `serverSessions.length >=`, `Maximum of` before closing a similar change.
