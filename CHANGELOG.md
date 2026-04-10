# Changelog

---

## v1.1.0 - 2026-04-06 (in progress)

Setup overhaul driven by 10 real-project reviews. Setup agents now understand design intent, not just the checklist.

**M01 — Foundation**
- `workflow/setup/shared/system-overview.md` — 58-line orientation doc read by setup agents first
- ADR-028 (extract skill conventions), ADR-029 (instruction budget constraint), ADR-030 (skill consolidation 9→5+dispatcher)
- ADR-031 (setup file ownership — never delete user code, single-agent scoping)
- compose-setup.ts: removed wrong scaling table, fixed enforcement→advisory language, added anti-duplication examples

**M02 — Skills & Scanner**
- Extracted 152-line shared conventions from 5 skills to `.goat-flow/skill-conventions.md` with 7-line inline fallback (ADR-028 supersedes ADR-023)
- Killed flush protocol, todo.md, handoff.md — milestone file checkboxes replace all three
- Scanner: removed handoff checks (3.3.1, 3.3.1a, 2.4.7), AP11 no longer penalises empty learning loop, added skill-conventions.md check, removed guidelines-ownership-split checks
- goat-plan: 10-bullet TL;DR summary confirmation step before milestone approval
- goat-test: DDT (Development Driven Testing) guidance in Step 0
- goat-review/goat-security: boundary notes clarifying ownership split

**M03a — Setup Restructure**
- Merged 7 shared setup files → 3 (phase-1.md, execution-loop.md + system-overview.md + coding-standards.md); phase-0.md was later removed
- Created `workflow/hooks/` with copyable scripts + per-agent config templates (claude.json, codex.toml, gemini.json)
- Rewrote 4 agent setup files: Claude 108→62, Codex 138→80, Gemini 98→46, Copilot 93→51 lines
- All agents now have human checklists, reference system-overview.md, use workflow/hooks/

**M03b — Doc Cleanup**
- Deleted ~3,000 lines: system-spec.md, design-rationale.md, five-layers.md, rubrics.md, getting-started.md, cross-agent-comparison.md, using-skills.md, docs/examples/, workflow/runtime/, workflow/templates/
- Updated 100+ cross-references across .goat-flow/, test fixtures, scanner code, instruction files
- All workflow/** files updated with v1.1.0 references

**M08 — Post-Critique Fixes** (driven by Codex implementing + critiquing v1.1.0 across 11 projects)
- Setup guard: state gate in all 4 agent setup files + system-overview + phase-1 prevents rogue rewrites on current projects
- compose-setup.ts: v0.9/v1.0 blocks return early — no more fall-through to fresh-install path that caused parallel surfaces on 5 projects
- Split `upgrade.md` into `upgrade-0.9.x.md` and `upgrade-1.0.0.md` with destructive migration instructions
- Created `workflow/setup/reference/project-structure.json` — single source of truth for expected file layout
- Scanner: removed CI Validation checks 3.2.1–3.2.5 (6pts, not AI workflow), fixed grep -P false positive (9/11 projects), fixed 2.6.1a pointer-file exemption (8/11 projects)
- Removed format-file.sh and guard-write-size.sh from goat-flow system — only deny-dangerous.sh and stop-lint.sh ship
- Skills: purged all stale v1.0 refs (todo.md, handoff.md, TODO_*_prime, flush), SBAO opt-in, compliance mode opt-in, fixed skill-conventions.md contradiction
- Reduced default .goat-flow/ scaffold (no domain-reference.md, always glossary.md)
- Dashboard: added /api/rubrics endpoint, light mode fix for setup page

---

## v1.0.0 - 2026-04-05

Version bump from v0.10.0 for semver compatibility (`^0.9.x` won't resolve to `0.10.0`).

**CLI** - Removed `--no-open` flag and auto-open browser logic from dashboard. Removed `spawn` import. Dashboard always prints URL, user opens manually.
**Dependencies** - `ws` moved from optionalDependencies to dependencies (required for dashboard WebSocket). `node-pty` stays optional.
**Keywords** - Added `ai-agent`, `claude-code`, `copilot`, `dashboard`, `llm`, `scanner` to package.json for npm discoverability.

---

## v0.10.0 - 2026-04-05

SBAO Phase 3, dashboard redesign, rubric priority grading, security hardening, copilot support, 48-file CLI refactor. 115 checks + 20 anti-patterns. 1,166 tests.

**Dashboard Redesign** - Neutral zinc palette (#1a1a1e/#111114/#27272a), CSS extracted to `styles.css`, JS extracted to `app.js` (index.html 89 lines). Dark/light themes with `gf-*` design token classes. Live reload dev mode (`npm run dev`).
**Home Page** - Action-driven: dynamic "What to do next" cards (issues → fix/details/workspace, passing → code review/test/security with play icons). Scanner-style 4-column agent cards with color-coded tier bars (green >80%, orange 50-80%, red <50%). Agents table with per-agent terminal launch. Welcome state for unconfigured projects.
**Scanner** - Single-page with inline detail expansion (no separate detail page). Hover states via CSS classes. Severity badges themed for light mode.
**Workspace** - Prompt preview on sidebar click (right panel shows prompt text + Launch button). Run state tracking (amber running, green pass). Category-colored filter pills. Round outline play/send buttons.
**Setup** - Left column card (title + agents + detected config), right prompt card with dark code background. "Formatter" label. Page heading.
**Config** - Two-row layout (path picker + role selector). userRole toggle (click to select, click again to deselect). Local-only (not in committed config). "Open Setup Wizard" button when config.yaml missing.
**Header** - Centered nav, goat emoji, green project name. "Terminal:" agent selector with disabled state during session. Green dot on Workspace nav when terminal running.
**Copilot** - Agent detection, terminal sessions, Runner type, RUNNER_BINARIES. Dashboard shows dimmed card when not scanned. ADR-025.
**Security** - Host header validation on all API routes (DNS rebinding). Write/Edit deny for 12 sensitive file patterns. Terminal resize validation (`clampDim`). Session map cleanup on kill.
**persona→userRole** - Renamed across config reader, types, facts, rubric, prompts, tests, fixtures. Added `tester` to schema.
**SBAO** - goat-plan Phase 3 rewritten as multi-agent critique: 2 core trio + 1 fresh-context (never split perspectives). Bold reminder in skill file. SBAO routing in dispatcher.
**Presets** - all 19 rewritten to `/goat [plain language]`. Guided forms removed.
**Rubric** - priority field (required/recommended/optional) on all checks. Grade: A=all req+rec, B=all req+80% rec, C=all req. Full tier bonus-only. 24 checks hidden. `telemetry` in KNOWN_TOP_LEVEL_KEYS.
**Scanner** - hook honesty, router validation, severity-grouped output. GOAT_FLOW_INLINE_SETUP dead code removed.
**CLI** - 48 files refactored, 45→0 complexity violations. `setup/`→`workflow/setup/`, `ai/`→`.goat-flow/`. Server logging (errors, host blocks, dev request log).
**Learning Loop** - category bucket files (ADR-021). Alpine.js `:style` footgun documented. SBAO agent structure lesson (3 recurrences). Checkbox discipline lesson (3 recurrences).
**Tests** - 275→1,166. Terminal idle timeout updated for session deletion. Tautological/dead assertions fixed. deny-dangerous.sh hardened (long-form flags, pipe-to-interpreter).
**Structure** - `docs/skills/` with Mermaid diagrams, `.goat-flow/glossary.md`, preflight with decimal timing. Footer: "Built by BlunderGOAT · v0.10.0".

## v0.9.4 - 2026-04-02

Scanner honesty, config file, directory restructure, embedded terminal, dashboard UX. Driven by 6 cross-project reviews + real-project testing. 275 tests.

**Scanner** - stop faking Codex enforcement facts, remove harmful AP2, fix goat-goat derivation bug, new AP20/AP21, `.env` Edit/Write deny check, devDeps-only JS detection
**Config** - `.goat-flow/config.yaml` with `js-yaml`, directory-based footguns/lessons (YAML frontmatter entries), committed vs local split, migration scripts
**Restructure** - `docs/lessons/`→`.goat-flow/lessons/`, `docs/decisions/`→`.goat-flow/decisions/`, `agent-evals/`→`.goat-flow/evals/`, `ai/instructions/`→`.goat-flow/coding-standards/`, `tasks/`→`.goat-flow/tasks/` (gitignored)
**Skills** - all 5 check footguns in Step 0, dispatcher enriched with modes/chaining, version sync to 0.9.4
**Setup** - stale skill cleanup (8 old names), router rewrite, static CI template, format hook wires into settings.json
**Terminal** - `node-pty` + `ws` as optionalDeps, `TerminalManager` with multi-runner (claude/codex/gemini), REST API (create/list/delete/health), WebSocket streaming, idle timeout, Origin check. xterm.js lazy-loaded from CDN, Launch button on preset cards, Setup Launcher panel (pick agent + runner), session indicator, Ctrl+Shift+D exit
**Dashboard** - dark mode toggle fixed, copy feedback on cards, Escape collapses checks, agent switch preserves tab, Reset filters, brighter focus rings, anti-patterns hidden during search. Deep Critique preset added (6-phase system review)
**Tests** - 239→275 (+36). New: eval parser/loader, serve-dashboard API, terminal server


---

## v0.9.3 - 2026-03-30

Skill consolidation, scanner improvements, enforcement hardening. Driven by cross-project reviews from halaxy-cypress (66), blundergoat-platform (74), healthkit (68). 101 checks + 17 anti-patterns. 216 tests.

**Skills (9→6)** - goat-investigate/simplify/refactor merged into goat-debug/review/plan as modes. goat-security expanded with compliance + dependency audit. Dispatcher added as 6th canonical skill. All synced across 3 agent dirs. 1,790→1,067 lines.
**Scanner** - AP deductions in default output. AP18 (ADAPT comments), AP19 (absolute paths in hooks). Fabrication detection validates file:line ranges. CI patterns hardened to invocation matching.
**Enforcement** - `.env` Edit/Write deny. Format hook skips agent config dirs. guard-write-size.sh template. `--dangerously-skip-permissions` bypass documented.
**Setup** - Migration fragments include router + CI sync. Python subdirectory detection fix. Ask First short/full forms. Dispatcher disambiguation + target-aware routing.

---

## v0.9.2 - 2026-03-30

Post-publish fixes. README restructured as dashboard-first. npm package description updated. Dashboard removed auto-open browser. Setup prompt "9 skills" wording fixed.

---

## v0.9.1 - 2026-03-30

Dashboard, full coding-standards wiring, skill conversation enforcement, npm publish. 103 checks + 16 anti-patterns. 191 tests.

**Dashboard** - `goat-flow dashboard` local server with live scanning, 4 tabs, dark mode, ARIA accessibility. Alpine.js + Tailwind CSS v4 via CDN. `--format html/markdown` for reports.
**Coding Standards** - All 57 templates routed (was 25). Framework detection: Laravel, Symfony, Django, FastAPI, Rails, Spring, Express, Cypress. 21 new fragment map entries.
**Skills** - All 9 synced across 3 agent dirs (27 files). Step 0 adaptive gate. 100% conversational compliance (was 80%). Restored audit/onboard/hypothesis features.
**Scanner** - Removed 2.2.5g (package mutation deny). Dispatcher counted for eval diversity (ADR-016). XSS fix, CORS wildcard removed.
**npm** - Published as `@blundergoat/goat-flow`. 197 files, 300KB packed. Source maps excluded. `--output` flag.

---

## v0.9.0 - 2026-03-29

Dispatcher skill, coding-standards refresh, scanner hardening, telemetry, signal-aware setup. 104 checks + 16 anti-patterns. 167 tests.

**Coding Standards** - Backend: Go/DRF/Rust/Spring/.NET/TS Node. Frontend: 9-framework routing. Security: llm-security, phi-compliance, 5 framework-specific. DevOps: terraform, packer.
**Scanner** - Dispatcher + Shared Conventions checks. AP16 deprecated skills (-5), AP17 dangling refs (-3). Signal follow-through (LLM, PHI, formatter). Eval frontmatter enforcement.
**Setup** - `mapSignalsToTemplates()` auto-routes phi/llm templates. `renderSignals()` produces tasks. `scan-logger.ts` per-agent JSONL.
**Skills** - Dispatcher + Shared Conventions across all dirs. Preflight: headers, skills, templates, dual-agent consistency. Format hook (prettier), deny hooks (package + cloud).

---

## v0.8.0 - 2026-03-28

Skill model cleanup (10→8), setup prompt fix, documentation alignment, rubric scoring cleanup. 97 checks + 15 anti-patterns. 138 tests.

**Rubric** - Advisory checks converted to scored. Zero-point checks removed. Empty decisions dir moved to AP16. Handoff template requires all 5 sections.
**Skills (10→8)** - goat-reflect/audit→goat-review, goat-onboard→goat-debug, goat-context removed. goat-investigate/simplify/refactor merged as modes. Deprecated dirs deleted. ADR-007.
**Setup** - Fragment map fix (add-skill-* no longer resolve to goat-debug). `--agent all` removed. Language mapper expanded to 10 languages.
**Docs** - 21 stale "10 skills" refs fixed across README, docs/, setup/, src/cli/. CI template fixed to canonical 8 skills. ADR-008 (reference-based setup).
**Tests** - 96→138. Full-pass fixture updated. 9-project audit: all score A (96-100%).

---

## v0.7.0 - 2026-03-26

Reference-based setup prompts, scanner accuracy, CLI simplification. Setup output ~860→~90 lines. 92 checks + 12 anti-patterns.

**Setup** - ~90-line prompts with template path tables. Agent-branched tables, language mapper, `GOAT_FLOW_INLINE_SETUP=1` rollback.
**Scanner** - 3.3.4 sync Jaccard ≥0.85. Lessons strips HTML comments. AP11 fires on EITHER empty. Check 2.2.7 removed (ADR-006).
**Templates** - enforcement.md jq/sed guidance. docs-seed.md concrete commands. execution-loop.md DoD gate.
**Removed** - `fix`/`audit` CLI commands. ask-first-guard hooks. 77→96 tests.

---

## v0.6.0 - 2026-03-24

10 skills, 49 coding standards, eval runner, multi-agent infra, CLI quality overhaul. 94 checks + 12 anti-patterns.

**Scanner** - 4 new checks, 3 new APs. Confidence-weighted scoring. Deny hook security audit. Projects drop from 100% to 92-99%.
**Skills** - 10 skills (+goat-onboard/reflect/resume). 49 coding standards (backend 13, frontend 14, security 12). Eval runner with YAML frontmatter.
**CLI** - 0 ESLint warnings, 0 knip exports. 6 god functions split. JSDoc on all 35 files. Strict tsconfig.
**Infra** - .codex/ dir, composite GitHub Action. Deny hooks hardened. CODEOWNERS, CONTRIBUTING, SECURITY added.

---

## v0.5.0 - 2026-03-22

All 7 skills rewritten with conversational structure. 84 checks. All 3 agents score A 100%.

**Skills** - goat-preflight→goat-security (ADR-004). Conversational choices at every phase. goat-debug recurrence, goat-plan kill criteria, goat-test Track 0, goat-review diff-aware.
**Scanner** - Quality threshold unified at 0.8. New: skill chaining (2.1.14), structured choices (2.1.15).
**Infra** - Preflight rewritten. CLAUDE.md compressed to 119 lines. Copilot bridge file.

---

## v0.4.0 - 2026-03-22

CLI scanner + prompt generator, local context system. 80 checks. All 6 projects score A (93-98%).

**Scanner** - 80-check rubric (3 tiers + 9 APs), 90 prompt fragments. `scan`/`fix`/`setup`/`audit` commands. `--min-score` CI gate. 78 tests.
**Local Context** - `.goat-flow/coding-standards/` with router. Copilot bridge files. 11 workflow templates. Migration guide.
**Fixes** - 9 new quality checks. Phantom paths, stale refs fixed across 6 projects. ProjectShape/confusion-log removed.

---

## v0.3.0 - 2026-03-21

Multi-agent alignment. First public release under MIT license.

**Tri-Agent** - Claude Code, Gemini CLI, Codex with unified `.agents/skills/`. 7 skills with YAML frontmatter. goat-research→goat-debug, created goat-plan/goat-test.
**Safety** - Reverted Gemini overwrites. `mv -n` enforcement. Overwrite protection in Never tier.
**Public** - MIT LICENSE, README rewrite. CI validates router tables + skill dirs. 3 footguns, 2 lessons logged.

---

## v0.2.0 - 2026-03-21

Workflow deployed across 7 projects. Multi-agent support. 11 diagnostic rounds.

**Loop** - 6-step: READ→CLASSIFY→SCOPE→ACT→VERIFY→LOG. Complexity budgets. Debug gate. LOG triggers on VERIFY failure + human correction.
**Skills (7)** - goat-plan (triangular tension), goat-test (3-track doer-verifier). goat-review depth requirement.
**Enforcement** - 5-item Ask First checklist. deny-dangerous covers Edit/Write. Content-preserving write guard (>80% blocked).
**Multi-Agent** - Codex + Gemini CLI. Truth order defined. Data honesty labels. Context rot defense (40-60%).

---

## v0.1.0 - 2026-03-20

First release. Complete workflow system.

**System** - 5-layer architecture. 6-step execution loop with SCOPE. 3-layer enforcement (permissions→hooks→rules). Autonomy tiers. DoD (6 gates). Doer-verifier testing.
**Skills (6)** - preflight, debug, audit, research, review, plan. Planning playbooks (feature brief, mob elaboration, SBAO, milestones). Testing playbooks (doer-verifier, 3 tracks).
**Docs** - system-spec, five-layers, six-steps, getting-started, design-rationale. Cross-agent comparison. CI context validation.
