# Changelog

## Unreleased

Skill-compliance trio (drift detection, content linting, manifest), skill renames, audit subsystem expansion, goat-review hardening, and shared proof-gate. 130 files changed (33 added, 1 deleted, 11 renamed), 8 new test files, 4 new decision records, and a renamed critique-core record. Milestones M01-M07 shipped from the 1.2.0 plan; M08-M17 in progress.

- **Skill Renames (M07)** - `goat-sbao` → `goat-critique` and `goat-test` → `goat-qa`. Mechanical rename only — behaviour, step structure, routing semantics, and the critique-as-core-feature stance were preserved. Old names recorded in `workflow/manifest.json:stale_names` for orphan detection.
- **CLI: critique → quality** - `goat-flow critique` → `goat-flow quality`. Dashboard view, `/api/critique` → `/api/quality`, prompt title, `compose-critique.ts` → `compose-quality.ts`, `critique.html` → `quality.html`, `docs/audit-and-critique.md` → `docs/audit-and-quality.md`, `harness-critique-quality.md` → `harness-quality.md`. Pairs cleanly with `audit`: audit answers "is it installed?", quality answers "is it any good?".
- **Harness Check Type Tagging (M01)** - 16 harness checks split into `integrity`/`advisory`/`metric` types. Score reflects integrity + unacknowledged advisory only; maturity surfaced as counts, not failures. New `harness.acknowledge: [check-id]` config opts out deliberate skips. Resolves halaxy-cypress field report where stale architecture.md path (drift) and missing compaction hook (best practice) were framed identically as "failing concerns".
- **Hallucination Red-Flags (M02)** - Five red-flag rules added to CLAUDE.md VERIFY phase: tests-pass evidence requirement, completion claim files-list requirement, fix verification reproduction steps, no-hedged-claims rule, check-passed verbatim-output requirement. Counter-rationalization patterns inline.
- **Active-Plan Marker (M03)** - `.goat-flow/tasks/.active` marker file tells `/goat` and `/goat-plan` which `tasks/<version>/` directory is live, so agents stop starting work in `_archived/` clutter (~400 files). Skill files (`goat`, `goat-plan`) updated to consult the marker.
- **Skill Drift Detection (M04)** - New `goat-flow audit --check-drift` compares installed `.claude/skills/`, `.agents/skills/`, and `.gemini/skills/` against `workflow/skills/` templates. Reports diverged, missing, and orphan skills. Backs M07 rename rollout and gates M08 propagation.
- **Cold-Path Content Linting (M05)** - New `goat-flow audit --check-content` lints `docs/`, `.goat-flow/`, ADRs, footgun and lesson entries for vague instructions, missing provenance frontmatter, and factual drift. Owns the provenance schema (`src/cli/audit/provenance-types.ts`) that M11 will back-fill onto existing audit checks.
- **Single Source of Truth Manifest (M06)** - New `goat-flow manifest` command (validate, list, show) plus `src/cli/manifest/{manifest.ts,types.ts,consumers.md}`. Extends `workflow/manifest.json` to host duplicated facts (skill list, audit check counts, version pins) consumed by setup prompts, audit, dashboard, and docs. Snapshot at `workflow/manifest-snapshots/v1.1.0.json` for diff-based drift detection.
- **Snapshot + Factual Claim Checks** - New `check-snapshot-claims.ts` and `check-factual-claims.ts` validate doc claims (skill counts, version strings, audit check counts) against the manifest. Integrated into `audit --check-content` output.
- **goat-review Hardening** - Two-pass reading protocol (skim then deep-dive). Severity (BLOCK/WARN/NOTE) and action (FIX/INVESTIGATE/ACCEPT) tags on every finding. Spec-drift detection lane. New "Review Integrity" self-check section. Edge-case scanning categories expanded. Skill description rewritten.
- **Proof-Gate** - Shared verification gate consumed by `goat-debug`, `goat-qa`, `goat-review`, `goat-security`. Forces named evidence (file:line, exit codes, output transcripts) before declaring work done. Skill patches applied across all four.
- **Audit Counts Sync** - Hot-path docs (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `README.md`, `docs/`) aligned to 13 setup checks + 4 per-agent checks = 17. Preflight B.8a3 added as downstream drift guard. `goat-plan` SKILL.md re-synced. AGENTS.md DoD and hook paths re-aligned.
- **Dashboard Home Cards** - Home view rewritten (`src/dashboard/views/home.html`, ~286 lines) for human-friendly AI harness presentation. Preset prompts and dashboard `globals.d.ts` updated.
- **Documentation** - `README.md` and `CLAUDE.md` switched to `npx goat-flow` invocations and added type-checking step. New `.goat-flow/tasks/README.md` and `.goat-flow/scratchpad/README.md` clarify the local-only WIP convention. Per-directory `.gitignore` files updated.
- **Decision Records** - Added records for the active-plan marker, human-friendly AI harness home cards, no standalone `goat-verify`, and the skill rename cleanup. The critique-core record was renamed from `sbao-mob-core-features` to `critique-mob-core-features` and updated to match the M07 rename. Existing skill-doctrine records were touched up for terminology consistency.
- **Skill Files** - 7 canonical skills synced across `.claude/skills/`, `.agents/skills/`, and `workflow/skills/`: `goat`, `goat-critique` (was goat-sbao), `goat-debug`, `goat-plan`, `goat-qa` (was goat-test), `goat-review`, `goat-security`. `skill-preamble.md` updated.
- **Tests** - 8 new test files: `audit-drift.test.ts`, `verification-boundaries.test.ts`, `check-content-quality.test.ts`, `check-drift.test.ts`, `check-factual-claims.test.ts`, `check-snapshot-claims.test.ts`, `manifest.test.ts`, `provenance-types.test.ts`. `critique-command.test.ts` renamed to `quality-command.test.ts`. `preamble-sync.test.ts`, `audit-command.test.ts`, `provenance-types.test.ts` expanded. ~1,900 net test lines added.
- **Lessons + Footguns** - Updates to `.goat-flow/lessons/{verification,agent-behavior,design-decisions}.md`, `.goat-flow/footguns/skills.md`, and `.goat-flow/glossary.md` (6 previously-undefined terms added: CSO, rationalization table, harness, concern, integrity/advisory/metric, rubber-stamp).
- **In Progress (1.2.0 plan, not yet shipped)** - M08 (skill TDD + rationalization tables, 0/46), M09 (structured learning loop, 2/15), M10 (progressive-disclosure retrieval, 0/27), M11 (back-fill provenance on existing audit checks, 0/39), M12 (multi-agent support matrix, 0/34), M13 (quality persistence + score trend, 0/64), M14 (skill-reference plumbing, 0/27), M15 (goat-security core, 4/195), M16 (harness constraint registration, 0/19), M17 (upstream spec-drift sentinel, 0/22). Tracked in `.goat-flow/tasks/1.2.0/`.

## v1.1.0 - 2026-04-17

Scanner/rubric system removed. Replaced by deterministic audit with 16 build checks (12 project setup + 4 per-agent) and 16 advisory harness checks across 5 concerns. Deterministic install script. Dashboard overhaul with dynamic recommended actions. 528 files changed.
- 
- **Critique Fixes** - Dual-critique synthesis resolved 10 findings. Fixed architecture.md build check count (17→16). Removed stop-lint.sh from core (project-specific concern, will revisit in a later version). Resolved 3 stale footgun entries (advisory hooks, swallows failures, dispatcher verb gap). Removed dead goat-review "code-review instruction file" reference. Reworded goat-test "multi-model" to actionable "cross-agent verification". Added analyse/evaluate/critique verbs to dispatcher disambiguation table. Improved critique prompt with 7 refinements: no-mutation warning, audit PASS caveat, severity definitions, scoped tool guidance, footgun currency checks, numeric claim verification, skill testing clarification.
- **Audit System** - Replaced scanner/rubric engine (79 checks + 12 anti-patterns, point-based scoring) with audit system. 12 project-wide setup checks (config, directories, required files) are agent-agnostic. 4 per-agent checks (instruction file, skills, settings, deny-dangerous hook) run independently per agent. Advisory harness scoring (`--harness`) grades 5 concerns with 16 checks total: context, constraints, verification, recovery, feedback loop. Audit became the sole evaluation engine.
- **Install Script** - `workflow/install-goat-flow.sh` handles all mechanical file copying: 7 skill templates, hooks, settings, templates, reference files, config scaffold. Deterministic, agent-aware (`--agent claude|codex|gemini`), idempotent. A separate migration script existed during v1.1.0 and was later removed as unused.
- **Setup Prompts** - Stripped stack/toolchain info, signal-driven tasks, stale artifact cleanup, multi-agent consistency directives. Setup prompt now: run install script → follow numbered setup steps → verify with audit. Upgrade prompt (v0.9/v1.0) structured as numbered steps with scripts first.
- **Dashboard** - Dynamic recommended actions panel: setup failing → fix wizard + fix agent buttons; harness checks failing → fix harness buttons; quality < 100% → fix harness buttons with per-concern recommendations; healthy → review/test/security presets. Per-agent harness score cards with grade, concern bars, and expandable recommendations. Projects page sorts alphabetically, clicks navigate to home view.
- **Config Agent Filtering** - Auditor respects `config.yaml` agents list. Project setup checks are agent-agnostic. Per-agent checks only run for agents with instruction files present. Config always lists all three agents (claude, codex, gemini) - setup is per-agent, not project-locked.
- **CLI Renames** - `--quality` → `--harness`. `quality-checks.ts` → `harness-checks.ts`. `build-checks.ts` → `agent-setup-checks.ts`. Dashboard label "AI Harness Checks" → "Agent Setup Checks".
- **Critique** - `goat-flow critique . --agent claude` generates agent-driven review prompts from audit data. Separate from audit (subjective vs deterministic).
- **Security** - `execSync` → `execFileSync` in hook syntax validator (shell injection fix). Host header validation on all dashboard API routes.
- **Skills** - 7 canonical skills (goat, goat-debug, goat-plan, goat-review, goat-sbao, goat-security, goat-test). Quick/full depth modes. Conversational structure with Step 0 adaptive gate. Skills installed verbatim from templates - project-specific context comes from instruction file and `.goat-flow/` docs.
- **Setup Flow** - 6 numbered steps (system overview → instruction file → install skills → architecture/code-map → customise → verification). Agent-specific configs in `workflow/setup/agents/`. Upgrade paths for v0.9 and v1.0 projects.
- **Hooks** - `deny-dangerous.sh` supports stdin and argv input, `--self-test` flag, blocks `rm -rf`, force push, `--no-verify`, `chmod 777`, pipe-to-interpreter patterns. Post-turn lint hook removed from core - project-specific concern (see `workflow/hooks/README.md`).
- **Templates** - 5 project templates (feature-brief, mob-elaboration, compliance-checklist, flow-diagram-guide, requirements-template) remain in `workflow/templates/` as reference material. Removed from core install (no longer copied to `.goat-flow/templates/`).
- **Tests** - 51 tests across unit, integration, and contract suites. Config filtering, scope coverage, quality concern coverage, cross-agent consistency.


## v1.0.0 - 2026-04-05

Version bump from v0.10.0 for semver compatibility (`^0.9.x` won't resolve to `0.10.0`).

- **CLI** - Removed `--no-open` flag and auto-open browser logic from dashboard. Removed `spawn` import. Dashboard always prints URL, user opens manually.
- **Dependencies** - `ws` moved from optionalDependencies to dependencies (required for dashboard WebSocket). `node-pty` stays optional.
- **Keywords** - Added `ai-agent`, `claude-code`, `copilot`, `dashboard`, `llm`, `scanner` to package.json for npm discoverability.

## v0.10.0 - 2026-04-05

SBAO Phase 3, dashboard redesign, rubric priority grading, security hardening, copilot support, 48-file CLI refactor. 115 checks + 20 anti-patterns. 1,166 tests.

- **Dashboard Redesign** - Neutral zinc palette (#1a1a1e/#111114/#27272a), CSS extracted to `styles.css`, JS extracted to `app.js` (index.html 89 lines). Dark/light themes with `gf-*` design token classes. Live reload dev mode (`npm run dev`).
- **Home Page** - Action-driven: dynamic "What to do next" cards (issues → fix/details/workspace, passing → code review/test/security with play icons). Scanner-style 4-column agent cards with color-coded tier bars (green >80%, orange 50-80%, red <50%). Agents table with per-agent terminal launch. Welcome state for unconfigured projects.
- **Scanner** - Single-page with inline detail expansion (no separate detail page). Hover states via CSS classes. Severity badges themed for light mode.
- **Workspace** - Prompt preview on sidebar click (right panel shows prompt text + Launch button). Run state tracking (amber running, green pass). Category-colored filter pills. Round outline play/send buttons.
- **Setup** - Left column card (title + agents + detected config), right prompt card with dark code background. "Formatter" label. Page heading.
- **Config** - Two-row layout (path picker + role selector). userRole toggle (click to select, click again to deselect). Local-only (not in committed config). "Open Setup Wizard" button when config.yaml missing.
- **Header** - Centered nav, goat emoji, green project name. "Terminal:" agent selector with disabled state during session. Green dot on Workspace nav when terminal running.
- **Copilot** - Agent detection, terminal sessions, Runner type, RUNNER_BINARIES. Dashboard showed a dimmed card when not scanned. This experiment was later removed.
- **Security** - Host header validation on all API routes (DNS rebinding). Write/Edit deny for 12 sensitive file patterns. Terminal resize validation (`clampDim`). Session map cleanup on kill.
- **persona→userRole** - Renamed across config reader, types, facts, rubric, prompts, tests, fixtures. Added `tester` to schema.
- **SBAO** - goat-plan Phase 3 rewritten as multi-agent critique: 2 core trio + 1 fresh-context (never split perspectives). Bold reminder in skill file. SBAO routing in dispatcher.
- **Presets** - all 19 rewritten to `/goat [plain language]`. Guided forms removed.
- **Rubric** - priority field (required/recommended/optional) on all checks. Grade: A=all req+rec, B=all req+80% rec, C=all req. Full tier bonus-only. 24 checks hidden. `telemetry` in KNOWN_TOP_LEVEL_KEYS.
- **Scanner** - hook honesty, router validation, severity-grouped output. GOAT_FLOW_INLINE_SETUP dead code removed.
- **CLI** - 48 files refactored, 45→0 complexity violations. `setup/`→`workflow/setup/`, `ai/`→`.goat-flow/`. Server logging (errors, host blocks, dev request log).
- **Learning Loop** - category bucket files. Alpine.js `:style` footgun documented. SBAO agent structure lesson (3 recurrences). Checkbox discipline lesson (3 recurrences).
- **Tests** - 275→1,166. Terminal idle timeout updated for session deletion. Tautological/dead assertions fixed. deny-dangerous.sh hardened (long-form flags, pipe-to-interpreter).
- **Structure** - `docs/skills/` with Mermaid diagrams, `.goat-flow/glossary.md`, preflight with decimal timing. Footer: "Built by BlunderGOAT · v0.10.0".

## v0.9.4 - 2026-04-02

Scanner honesty, config file, directory restructure, embedded terminal, dashboard UX. Driven by 6 cross-project reviews + real-project testing. 275 tests.

- **Scanner** - stop faking Codex enforcement facts, remove harmful AP2, fix goat-goat derivation bug, new AP20/AP21, `.env` Edit/Write deny check, devDeps-only JS detection
- **Config** - `.goat-flow/config.yaml` with `js-yaml`, directory-based footguns/lessons (YAML frontmatter entries), committed vs local split, migration scripts
- **Restructure** - `docs/lessons/`→`.goat-flow/lessons/`, `docs/decisions/`→`.goat-flow/decisions/`, `agent-evals/`→`.goat-flow/evals/`, `ai/instructions/`→`.goat-flow/coding-standards/`, `tasks/`→`.goat-flow/tasks/` (gitignored)
- **Skills** - all 5 check footguns in Step 0, dispatcher enriched with modes/chaining, version sync to 0.9.4
- **Setup** - stale skill cleanup (8 old names), router rewrite, static CI template, format hook wires into settings.json
- **Terminal** - `node-pty` + `ws` as optionalDeps, `TerminalManager` with multi-runner (claude/codex/gemini), REST API (create/list/delete/health), WebSocket streaming, idle timeout, Origin check. xterm.js lazy-loaded from CDN, Launch button on preset cards, Setup Launcher panel (pick agent + runner), session indicator, Ctrl+Shift+D exit
- **Dashboard** - dark mode toggle fixed, copy feedback on cards, Escape collapses checks, agent switch preserves tab, Reset filters, brighter focus rings, anti-patterns hidden during search. Deep Critique preset added (6-phase system review)
- **Tests** - 239→275 (+36). New: eval parser/loader, serve-dashboard API, terminal server

## v0.9.3 - 2026-03-30

Skill consolidation, scanner improvements, enforcement hardening. Driven by cross-project reviews from halaxy-cypress (66), blundergoat-platform (74), healthkit (68). 101 checks + 17 anti-patterns. 216 tests.

- **Skills (9→6)** - goat-investigate/simplify/refactor merged into goat-debug/review/plan as modes. goat-security expanded with compliance + dependency audit. Dispatcher added as 6th canonical skill. All synced across 3 agent dirs. 1,790→1,067 lines.
- **Scanner** - AP deductions in default output. AP18 (ADAPT comments), AP19 (absolute paths in hooks). Fabrication detection validates file:line ranges. CI patterns hardened to invocation matching.
- **Enforcement** - `.env` Edit/Write deny. Format hook skips agent config dirs. guard-write-size.sh template. `--dangerously-skip-permissions` bypass documented.
- **Setup** - Migration fragments include router + CI sync. Python subdirectory detection fix. Ask First short/full forms. Dispatcher disambiguation + target-aware routing.

## v0.9.2 - 2026-03-30

Post-publish fixes. README restructured as dashboard-first. npm package description updated. Dashboard removed auto-open browser. Setup prompt "9 skills" wording fixed.

## v0.9.1 - 2026-03-30

Dashboard, full coding-standards wiring, skill conversation enforcement, npm publish. 103 checks + 16 anti-patterns. 191 tests.

- **Dashboard** - `goat-flow dashboard` local server with live scanning, 4 tabs, dark mode, ARIA accessibility. Alpine.js + Tailwind CSS v4 via CDN. `--format html/markdown` for reports.
- **Coding Standards** - All 57 templates routed (was 25). Framework detection: Laravel, Symfony, Django, FastAPI, Rails, Spring, Express, Cypress. 21 new fragment map entries.
- **Skills** - All 9 synced across 3 agent dirs (27 files). Step 0 adaptive gate. 100% conversational compliance (was 80%). Restored audit/onboard/hypothesis features.
- **Scanner** - Removed 2.2.5g (package mutation deny). Dispatcher counted for evaluation diversity. XSS fix, CORS wildcard removed.
- **npm** - Published as `@blundergoat/goat-flow`. 197 files, 300KB packed. Source maps excluded. `--output` flag.

## v0.9.0 - 2026-03-29

Dispatcher skill, coding-standards refresh, scanner hardening, telemetry, signal-aware setup. 104 checks + 16 anti-patterns. 167 tests.

- **Coding Standards** - Backend: Go/DRF/Rust/Spring/.NET/TS Node. Frontend: 9-framework routing. Security: llm-security, phi-compliance, 5 framework-specific. DevOps: terraform, packer.
- **Scanner** - Dispatcher + Shared Conventions checks. AP16 deprecated skills (-5), AP17 dangling refs (-3). Signal follow-through (LLM, PHI, formatter). Eval frontmatter enforcement.
- **Setup** - `mapSignalsToTemplates()` auto-routes phi/llm templates. `renderSignals()` produces tasks. `scan-logger.ts` per-agent JSONL.
- **Skills** - Dispatcher + Shared Conventions across all dirs. Preflight: headers, skills, templates, dual-agent consistency. Format hook (prettier), deny hooks (package + cloud).

## v0.8.0 - 2026-03-28

Skill model cleanup (10→8), setup prompt fix, documentation alignment, rubric scoring cleanup. 97 checks + 15 anti-patterns. 138 tests.

- **Rubric** - Advisory checks converted to scored. Zero-point checks removed. Empty decisions dir moved to AP16. Handoff template requires all 5 sections.
- **Skills (10→8)** - goat-reflect/audit→goat-review, goat-onboard→goat-debug, goat-context removed. goat-investigate/simplify/refactor merged as modes. Deprecated dirs deleted. This was later subsumed by the 9→6 consolidation.
- **Setup** - Fragment map fix (add-skill-* no longer resolve to goat-debug). `--agent all` removed. Language mapper expanded to 10 languages.
- **Docs** - 21 stale "10 skills" refs fixed across README, docs/, setup/, src/cli/. CI template fixed to canonical 8 skills. Setup prompts remained reference-based.
- **Tests** - 96→138. Full-pass fixture updated. 9-project audit: all score A (96-100%).

## v0.7.0 - 2026-03-26

Reference-based setup prompts, scanner accuracy, CLI simplification. Setup output ~860→~90 lines. 92 checks + 12 anti-patterns.

- **Setup** - ~90-line prompts with template path tables. Agent-branched tables, language mapper, `GOAT_FLOW_INLINE_SETUP=1` rollback.
- **Scanner** - 3.3.4 sync Jaccard ≥0.85. Lessons strips HTML comments. AP11 fires on EITHER empty. Check 2.2.7 removed with the ask-first-guard rollback.
- **Templates** - enforcement.md jq/sed guidance. docs-seed.md concrete commands. execution-loop.md DoD gate.
- **Removed** - `fix`/`audit` CLI commands. ask-first-guard hooks. 77→96 tests.

## v0.6.0 - 2026-03-24

10 skills, 49 coding standards, eval runner, multi-agent infra, CLI quality overhaul. 94 checks + 12 anti-patterns.

- **Scanner** - 4 new checks, 3 new APs. Confidence-weighted scoring. Deny hook security audit. Projects drop from 100% to 92-99%.
- **Skills** - 10 skills (+goat-onboard/reflect/resume). 49 coding standards (backend 13, frontend 14, security 12). Eval runner with YAML frontmatter.
- **CLI** - 0 ESLint warnings, 0 knip exports. 6 god functions split. JSDoc on all 35 files. Strict tsconfig.
- **Infra** - .codex/ dir, composite GitHub Action. Deny hooks hardened. CODEOWNERS, CONTRIBUTING, SECURITY added.

## v0.5.0 - 2026-03-22

All 7 skills rewritten with conversational structure. 84 checks. All 3 agents score A 100%.

- **Skills** - goat-preflight→goat-security. Conversational choices at every phase. goat-debug recurrence, goat-plan kill criteria, goat-test Track 0, goat-review diff-aware.
- **Scanner** - Quality threshold unified at 0.8. New: skill chaining (2.1.14), structured choices (2.1.15).
- **Infra** - Preflight rewritten. CLAUDE.md compressed to 119 lines. Copilot bridge file.

## v0.4.0 - 2026-03-22

CLI scanner + prompt generator, local context system. 80 checks. All 6 projects score A (93-98%).

- **Scanner** - 80-check rubric (3 tiers + 9 APs), 90 prompt fragments. `scan`/`fix`/`setup`/`audit` commands. `--min-score` CI gate. 78 tests.
- **Local Context** - `.goat-flow/coding-standards/` with router. Copilot bridge files. 11 workflow templates. Migration guide.
- **Fixes** - 9 new quality checks. Phantom paths, stale refs fixed across 6 projects. ProjectShape/confusion-log removed.

## v0.3.0 - 2026-03-21

Multi-agent alignment. First public release under MIT license.

- **Tri-Agent** - Claude Code, Gemini CLI, Codex with unified `.agents/skills/`. 7 skills with YAML frontmatter. goat-research→goat-debug, created goat-plan/goat-test.
- **Safety** - Reverted Gemini overwrites. `mv -n` enforcement. Overwrite protection in Never tier.
- **Public** - MIT LICENSE, README rewrite. CI validates router tables + skill dirs. 3 footguns, 2 lessons logged.

## v0.2.0 - 2026-03-21

Workflow deployed across 7 projects. Multi-agent support. 11 diagnostic rounds.

- **Loop** - 6-step: READ→CLASSIFY→SCOPE→ACT→VERIFY→LOG. Complexity budgets. Debug gate. LOG triggers on VERIFY failure + human correction.
- **Skills (7)** - goat-plan (triangular tension), goat-test (3-track doer-verifier). goat-review depth requirement.
- **Enforcement** - 5-item Ask First checklist. deny-dangerous covers Edit/Write. Content-preserving write guard (>80% blocked).
- **Multi-Agent** - Codex + Gemini CLI. Truth order defined. Data honesty labels. Context rot defense (40-60%).

---

## v0.1.0 - 2026-03-20

First release. Complete workflow system.

- **System** - 5-layer architecture. 6-step execution loop with SCOPE. 3-layer enforcement (permissions→hooks→rules). Autonomy tiers. DoD (6 gates). Doer-verifier testing.
- **Skills (6)** - preflight, debug, audit, research, review, plan. Planning playbooks (feature brief, mob elaboration, SBAO, implementation checklists). Testing playbooks (doer-verifier, 3 tracks).
- **Docs** - system-spec, five-layers, six-steps, getting-started, design-rationale. Cross-agent comparison. CI context validation.
