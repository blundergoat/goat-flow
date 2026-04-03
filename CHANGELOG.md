# Changelog

---

## v0.10.0 - 2026-04-03

Category bucket learning loop, scanner honesty, session logs, 48-file CLI refactor, execution-loop dedup. Rubric v0.10.0: 112 checks + 19 anti-patterns. 314 tests.

### Install & Packaging
- added `pnpm.onlyBuiltDependencies` for `node-pty` so pnpm installs can build the embedded terminal without manual manifest edits
- README rewritten (177→121 lines): install matrix (npm/pnpm/yarn/global), troubleshooting section, simplified getting started
- tightened pnpm `node-pty` guidance and Node runtime notes for dashboard/CLI usage

### CLI Refactor
- refactored 48 source files for complexity reduction, type safety, and module boundaries
- extracted route handlers (serve-dashboard.ts), per-field validators (config/reader.ts), per-signal detectors (detect/stack.ts), per-skill-attribute extractors (facts/agent.ts)
- 45 cyclomatic complexity violations → 0

### Scanner & Rubric
- refactored high-complexity rubric and scanner paths to clear preflight complexity failures
- hook honesty checks now verify settings/config registration, registered-path existence, real post-turn validation commands, swallowed-failure wrappers, post-tool event schema, agent-config skips, and deny coverage for pipe-to-shell patterns
- `ai/README.md` router validation now checks referenced paths, so broken local-instruction routers fail `2.6.2` instead of scoring 100%
- local-instruction honesty now fails duplicate instruction surfaces when `ai/coding-standards/` and `.github/instructions/` coexist
- router completeness now enforces the canonical skills root (not `goat-*/`), plus explicit `.goat-flow/config.yaml` and `.goat-flow/tasks/handoff-template.md` entries
- duplicate learning-loop surfaces now fail both a positive canonical-surface check and anti-pattern `AP22`, while preserving the intended committed/local split
- new check `2.3.7`: verifies instruction file references session logs (`.goat-flow/logs/sessions/`)
- replaced fixed read/turn budgets with 5-tier complexity model (Hotfix/Small Feature/Standard/System/Infrastructure) and 3x-estimate re-classification trigger; rubric check `1.2.2a` updated to validate new format
- text and markdown scan output now group failures by severity, show fail/partial/pass summaries, and surface "Top N to fix first" diagnostic priorities
- CI validation heuristics now inspect actual workflow `run:` commands instead of keyword presence

### Test Infrastructure
- added rubric regression fixture corpus: `passing-minimal` (100%), `passing-full` (100%), `failing-known` (expected failures for 2.2.3, 2.6.2), plus targeted regressions for hook honesty, duplicate surfaces, router completeness, and local-instruction duplication
- new `test/fixtures/project-fixtures.test.ts` and `test/helpers/fixture-scanner.ts` for fixture-based rubric regression testing
- added `test/helpers/hook-runner.ts` and `test/hooks/format-file.test.ts` for real hook-behavior coverage
- 314 tests

### Dashboard & CLI UX
- added first-run browser auto-open for `goat-flow dashboard` with persistent opt-out via `--no-open`
- terminal tab now shows explanation when node-pty missing (was hidden); CLI prints warning at startup
- fix Ctrl+V paste in terminal (reads clipboard text, not raw \x16); Ctrl+C copies selection
- fix preset Launch button to respect runner dropdown selection
- added project identity: dynamic tab title, color accent stripe, project name in sidebar
- added cursor:pointer on all interactive elements; ResizeObserver for terminal column-width fix
- added targeted testing preset for risk-based QA plans from GitHub issues
- added "Open Terminal" button on setup instructions page

### Execution Loop & Templates
- made `docs/system-spec.md` canonical for the execution loop and reduced duplicate loop docs to compatibility pointers
- removed dead session-logging ritual from all skill closing protocols (proven never written by own lesson)
- fixed template contradictions: skill count ("5 skills + dispatcher"), log paths, monolithic vs per-entry format
- synced setup shared templates and workflow docs to canonical loop wording
- added no-duplicate-file rule to CLAUDE.md Hard Rules and coding standards

### Learning Loop
- migrated from per-incident files to category bucket files (ADR-021): 20 footgun files → 5 buckets, 31 lesson files → 5 buckets
- format: `## Footgun: <name>` / `## Lesson: <name>` entries inside category files (e.g., `hooks.md`, `verification.md`)
- fixed scanner evidence label detection to match new inline `**Evidence:** ACTUAL_MEASURED` format
- scanner now enforces canonical learning-loop surfaces and validates footgun line bounds instead of rewarding stale or duplicate artifact layouts
- updated LOG instructions in all 3 instruction files, 20 skill files, workflow templates, and setup templates

### Session Logs & Handoff
- added session log path (`.goat-flow/logs/sessions/`) to all instruction files, skill closing protocols, and setup templates
- new rubric check `2.3.7`: validates instruction file references session logs
- improved handoff template: added Errors & Corrections, Learnings, and Context Files sections; now tracked in git
- router table now includes the shared handoff-template path so incomplete-work handoffs are discoverable from the canonical index
- added ADR-019 (no-implementation-skill), ADR-021 (category bucket learning loop)
- new 2026-04-03 lessons/footguns covering critique handling, doer-verifier theater, scanner reliability traps, setup duplication

## v0.9.4 - 2026-04-02

Scanner honesty, config file, directory restructure, embedded terminal, dashboard UX. Driven by 6 cross-project reviews + real-project testing. 275 tests.

### Scanner
- stop faking Codex enforcement facts, remove harmful AP2, fix goat-goat derivation bug, new AP20/AP21, `.env` Edit/Write deny check, devDeps-only JS detection

### Config
- `.goat-flow/config.yaml` with `js-yaml`, directory-based footguns/lessons (YAML frontmatter entries), committed vs local split, migration scripts

### Restructure
- `docs/lessons/` -> `ai/lessons/`, `docs/decisions/` -> `ai/decisions/`, `agent-evals/` -> `ai/evals/`, `ai/instructions/` -> `ai/coding-standards/`, `tasks/` -> `.goat-flow/tasks/` (gitignored)

### Skills
- all 5 check footguns in Step 0, dispatcher enriched with modes/chaining, version sync to 0.9.4

### Setup
- stale skill cleanup (8 old names), router rewrite, static CI template, format hook wires into settings.json

### Terminal Backend
- `node-pty` + `ws` as optionalDeps, `TerminalManager` with multi-runner (claude/codex/gemini), REST API (create/list/delete/health), WebSocket streaming, idle timeout, Origin check

### Terminal Launcher
- xterm.js lazy-loaded from CDN, Launch button on preset cards, Setup Launcher panel (pick agent + runner), Terminal nav button with session indicator, Ctrl+Shift+D exit

### Dashboard UX
- dark mode toggle fixed, copy feedback on cards, Escape collapses checks, agent switch preserves tab, Reset filters, brighter focus rings, anti-patterns hidden during search

### Deep Critique Preset
- added (audit category) - 6-phase system review prompt

### Tests
- 239 -> 275 (+36). New: eval parser/loader, serve-dashboard API, terminal server


---

## v0.9.3 - 2026-03-30

Skill consolidation, scanner improvements, enforcement hardening. Driven by cross-project reviews from halaxy-cypress (66), blundergoat-platform (74), healthkit (68). Rubric v0.9.3: 101 checks + 17 anti-patterns. 216 tests.

### Skills (9 -> 6)
- goat-investigate merged into goat-debug (investigate/onboard modes)
- goat-simplify merged into goat-review (simplify mode)
- goat-refactor merged into goat-plan (refactor planning mode)
- goat-security expanded with compliance and dependency audit modes
- goat dispatcher added to SKILL_NAMES as 6th canonical skill
- All 6 skills synced identically across .claude/, .agents/, .github/. 1,790 -> 1,067 lines.

### Scanner
- Format diagnostics when footguns/lessons have content but 0 entries parse
- AP deductions shown in default text output, not just verbose mode
- Eval coverage gap lists missing skill names instead of just count
- CI check patterns hardened from keyword presence to invocation matching
- AP18: unanswered ADAPT comments in skills. AP19: hardcoded absolute paths in hooks
- Fabrication detection: file:line refs validated for line-number range

### Enforcement
- `Edit(**/.env*)` and `Write(**/.env*)` deny alongside existing `Read(**/.env*)`
- Format hook skips agent config dirs by default
- guard-write-size.sh: complete script template with registration JSON
- `--dangerously-skip-permissions` bypass vectors documented
- stop-lint.sh: performance tuning guidance for heavy linters

### Setup & Dispatcher
- Migration fragments include router table + CI sync after skill changes
- Python stack detection: subdirectory-only Python no longer overrides root commands
- Ask First checklist: short form (2 questions) or full form (5 items)
- Dispatcher: analysis verb disambiguation, target-aware routing, post-dispatch chaining

---

## v0.9.2 - 2026-03-30

Post-publish fixes. README restructured as dashboard-first. npm package description updated.

- README: Install + Dashboard sections lead, setup instructions near top, CLI consolidated into reference block
- Dashboard: removed auto-open browser (just prints URL), removed unused `exec` import
- Setup prompt: Phase 1b wording fixed - "9 skills (8 goat-* + /goat dispatcher)" instead of "9 goat-*"
- package.json description updated to mention dashboard

---

## v0.9.1 - 2026-03-30

Dashboard, full coding-standards wiring, skill conversation enforcement, npm publish. Rubric v0.9.1: 103 checks + 16 anti-patterns. 191 tests.

### Dashboard
- `goat-flow dashboard` - local server with live scanning, 4 tabs (Overview, Checks, Compare, Fixes)
- `--format html` for standalone HTML reports, `--format markdown` for PR comments
- Dark mode, responsive mobile, keyboard navigation, ARIA accessibility
- Dashboard source at `src/dashboard/`, Alpine.js + Tailwind CSS v4 via CDN

### Coding Standards - Full Wiring
- All 57 templates routed by CLI (was 25). New: `backend/python.md`, `devops/packer.md`
- Framework detection: Laravel, Symfony, Django, FastAPI, Rails, Spring, Express, Cypress
- Stack detectors fleshed out: Ruby (Gemfile), Java (pom.xml/build.gradle), C# (.csproj/.sln)
- 9 security framework templates, 6 security topics, 2 devops templates auto-routed by signals
- 21 new fragment map entries for targeted-fix mode

### Skills
- All 9 skills (8 goat-* + dispatcher) synced from canonical templates across 3 agent dirs (27 files)
- Step 0 adaptive gate on every skill - agents must confirm context before entering Phase 1
- Scanner requires 100% conversational compliance (was 80%), structural detection replaces keyword matching
- Restored missing features: goat-review audit mode, goat-debug onboard mode, goat-debug hypothesis rules

### Scanner
- Removed check 2.2.5g (package mutation deny) - agents should install packages freely
- Dispatcher is 9th canonical skill for eval diversity counting (ADR-016)
- XSS fix in HTML injection, CORS wildcard removed, agent param validation added

### npm Publish
- Published as `@blundergoat/goat-flow`. 197 files, 300KB packed
- Source maps excluded, `--output <file>` flag, 7 npm scripts added

---

## v0.9.0 - 2026-03-29

Dispatcher skill, coding-standards refresh, scanner hardening, telemetry, signal-aware setup. Rubric v0.9.0: 104 checks + 16 anti-patterns. 167 tests.

### Coding Standards (Phases 1-8)
- Backend: go.md interface fix, DRF split, Rust/Spring/.NET/TS Node detection; frontend: 9-framework routing, version gates
- Security: new `llm-security.md`, `phi-compliance.md`, `framework-specific/go.md`, `framework-specific/symfony.md`; expanded web-common/api-auth/supply-chain/infrastructure/file-upload
- DevOps: new `devops/` with `terraform.md`, `packer.md`; `code-review.md` Learning Loop Cross-Check

### Scanner
- Checks 2.1.20-21: dispatcher skill + Shared Conventions block
- AP16: deprecated skills (-5); AP17: dangling skill refs (-3)
- 2.2.5g-h: package mutation + cloud-destructive deny blocking
- 2.7.1-3: signal follow-through (LLM, PHI hot path, formatter gaps)
- 3.1.7: eval frontmatter enforcement; 3.3.4: loop consistency promoted to standard (3 pts)
- 3.1.6: eval coverage rebalanced (2 pts, partial at 4/8); 3.1.3 reduced to 1 pt

### Signal-Aware Setup & Telemetry
- `mapSignalsToTemplates()` auto-routes `phi-compliance.md` + `llm-security.md` on signal detection
- `renderSignals()` produces actionable tasks; formatter gap detection checks hook content
- `scan-logger.ts` auto-appends per-agent JSONL; skills/loop reference telemetry

### Skills, Hooks & Version Consistency
- Dispatcher skill + Shared Conventions across all agent dirs; 9 skill-specific evals (YAML frontmatter)
- Preflight: instruction headers, installed skills, workflow templates, dual-agent loop consistency
- `.claude/hooks/format-file.sh` (prettier); deny hooks: package + cloud blocks

---

## v0.8.0 - 2026-03-28

Skill model cleanup (10->8 enforced), setup prompt bug fix, documentation alignment, rubric scoring cleanup. Rubric v0.8.0: 97 checks + 15 anti-patterns. 138 tests.

### Rubric Scoring Cleanup
- Converted previously advisory checks into scored checks where the detector is reliable: footgun evidence labels, lesson path validity, router completeness for learning loop/architecture/evals, eval Agents labels, handoff template required sections, and eval skill diversity
- Removed zero-point checks that were too heuristic or too weak to score safely: skill Step 0 adaptation, Ask First boundary/router overlap, AI ignore files, and cold-path line budget
- Moved empty `docs/decisions/` from a zero-point rubric check to anti-pattern `AP16` with a small deduction, so misleading empty ADR scaffolding now affects score
- Tightened `3.3.1a` to require all five handoff template sections before awarding the point
- Total check count remains 97 after the cleanup; anti-pattern count increases to 15

### Skill Consolidation (10->8) - ADR-007
- goat-reflect/audit merged into goat-review (Instruction Review + Audit modes), goat-onboard merged into goat-debug (Onboard mode), goat-context removed
- goat-investigate merged into goat-debug (Investigate mode), goat-simplify merged into goat-review (Simplify mode), goat-refactor merged into goat-plan (Refactor Planning mode)
- Deprecated skill dirs deleted from .claude/, .agents/, .github/ - all three now have identical 8-skill parity
- `goat-flow-skill-version: "0.7.0"` frontmatter on all installed skills; DEPRECATED_SKILL_NAMES constant provides scanner migration grace period

### Setup Prompt Fix
- Skill-quality recommendation keys (add-skill-step0, add-skill-human-gates, etc.) were all resolving to "Adapt from goat-debug.md" - FRAGMENT_TEMPLATE_MAP pointed them at goat-debug as an example reference
- renderShortFix now skips template paths for `add-skill-*` and `create-all-skills` keys, renders actual instruction text instead
- `--agent all` removed (exit 2 with per-agent message)
- Language mapper expanded to 10 languages (+Java, Ruby, C#)

### Documentation Alignment
- 21 stale "10 skills" references fixed across README.md, docs/ (getting-started, architecture, five-layers, cross-agent-comparison, examples), setup/ (README, phase-1, execution-loop, setup-codex), src/cli/ (standard.ts, compose-setup.ts, full.ts)
- docs/system-spec.md deprecated skill descriptions (goat-reflect, goat-onboard, goat-resume) updated; goat-investigate/goat-simplify/goat-refactor merged into modes
- docs/system/five-layers.md skill table trimmed from 10 to 8 rows; workflow/README.md skill list updated
- CHANGELOG.md and README.md scanner counts corrected (92->97 checks, 12->14 anti-patterns)
- Rubric comment at standard.ts:18 corrected (19 pts/10 existence -> 17 pts/8 existence)

### CI Template Fix
- `full.ts:126` shell for-loop was generating CI YAML checking deprecated skills (audit, reflect, onboard, resume)
- Fixed to check the canonical 8: security, debug, investigate, review, plan, test, refactor, simplify

### Tests
- scan-fixtures.test.ts full-pass fixture updated from 9 deprecated skills (included audit, context) to canonical 8
- 138 tests pass (was 96)

### ADRs
- ADR-007: skill consolidation 10->8 - justification test, merge mapping, consequences
- ADR-008: reference-based setup prompts - why inline skeletons failed (template drift, agent copy-paste, context waste)

### Cross-Project Audit (9 projects)
- All 9 projects score A (96-100%) after v0.8.0 changes
- Setup files regenerated with fixed CLI for all projects
- Per-project review prompts generated in tasks/cli-setup-claude/

---

## v0.7.0 - 2026-03-26

Reference-based setup prompts, scanner accuracy fixes, CLI simplification. Setup output drops from ~860 to ~90 lines. Rubric v0.7.0: 92 checks + 12 anti-patterns.

### Reference-Based Setup Prompt
- Setup generates ~90-line prompts with template path tables instead of ~860 lines of inline skeletons
- Agent-branched tables (Claude/Codex/Gemini), language-to-coding-standards mapper, `--agent all` with interactive picker
- Skill quality requirements block in Phase 1b, `GOAT_FLOW_INLINE_SETUP=1` rollback, `setup/` + `workflow/` in npm tarball

### Scanner Accuracy (rubric v0.7.0)
- 3.3.4 sync: Jaccard word-intersection ≥0.85 (was length-ratio ≥0.6), matches bold format
- 2.3.2 lessons.md: strips HTML comments, requires 20+ chars of real content after H3
- AP11: fires when EITHER lessons OR footguns is empty (was AND)
- Check 2.2.7 removed - ask-first-guard hooks removed from all agents (ADR-006)

### Template Quality
- enforcement.md: jq parsing guidance, sed fallback, command chaining, read-deny patterns
- docs-seed.md: concrete `git log`/`grep -rn` commands for seeding real incidents
- execution-loop.md: "logs updated if tripped" DoD gate added

### Removed
- `fix` and `audit` CLI commands (deprecated in v0.6.0, now exit 2 with migration message)
- ask-first-guard.sh hooks and scanner check 2.2.7 - see ADR-006

### Other
- GitHub Actions: goat-flow-scan.yml permissions, setup-node version bump
- AGENTS.md trimmed to 113 lines, execution loops synced verbatim across all 3 agents
- New: src/cli/paths.ts, src/cli/prompt/template-refs.ts; 96 tests (was 77)

---

## v0.6.0 - 2026-03-24

10 skills, 49 coding standards templates, eval runner, multi-agent infra, CLI quality overhaul. Rubric: 94 checks + 12 anti-patterns (v0.8.0).

### Scanner (94 checks, hardened via 5-project audit)
- 4 new checks: Ask First enforcement (2.2.7), lessons depth (2.3.2a), footgun file refs (2.3.5), cross-agent loop consistency (3.3.4)
- 3 new anti-patterns: AP10 settings.local bloat, AP11 empty learning loop, AP12 stale footgun refs
- Confidence-weighted scoring (medium/low checks at 50%), rebalanced weights, removed dead checks
- Deny hook security audit: blocking logic, jq parsing, command chaining, rm-rf, force push, chmod 777
- Audited projects drop from 100% to 92-99% - scanner now catches real quality gaps

### Skills & Coding Standards
- 10 skills (+goat-onboard, goat-reflect, goat-resume), deployed to all 3 agent dirs
- 49 coding standards templates: backend (13), frontend (14), security (12), plus shared
- Eval runner: `goat-flow eval` with YAML frontmatter parser, text/JSON output

### TypeScript & CLI Quality
- 0 ESLint warnings, 0 knip unused exports, 0 non-null assertions
- 6 god functions split to ≤15 cyclomatic complexity, CLIError replaces process.exit()
- JSDoc on all 35 src/cli/ files, strict tsconfig (noUncheckedIndexedAccess, ES2023)

### Multi-Agent & CI
- .codex/ directory, .github/actions/goat-flow-scan/ composite action
- Deny hooks hardened across all agents, GitHub Actions SHA-pinned
- CODEOWNERS, CONTRIBUTING.md, SECURITY.md added
- Prompt/doc drift fixed: "7->10 skills", permission profiles removed

---

## v0.5.0 - 2026-03-22

All 7 skills rewritten with conversational structure and failure-mode prevention. Scanner: 84 checks. All 3 agents score A 100%.

### Skills (full rewrite)
- Replaced goat-preflight with goat-security (ADR-004): threat-model-driven, OWASP-aware
- All 7 skills: conversational choices at every phase, "Chains with" footer, severity scale
- Key upgrades: goat-debug recurrence detection, goat-plan kill criteria, goat-test Track 0, goat-review diff-aware mode
- YAML `name:` frontmatter + `## When to Use` on all skill files

### Scanner (84 checks)
- Skill quality threshold unified at 0.8 (human gates 0.5->0.8, conversational 0.3->0.8)
- New checks: skill chaining (2.1.14), structured choices (2.1.15)
- Fixed compaction hook detection, non-null assertions

### Infrastructure
- Preflight rewritten with colour output, section grouping, check counts
- Severity scale added to all 3 instruction files, CLAUDE.md compressed to 119 lines
- Copilot bridge file, ignore files aligned across agents

---

## v0.4.0 - 2026-03-22

CLI scanner + prompt generator, local context system, 80-check rubric. All 6 audited projects score A (93-98%).

### CLI Scanner & Prompt Generator
- 80-check rubric (3 tiers + 9 anti-patterns), 90 prompt fragments with variable substitution
- `scan`, `fix`, `setup`, `audit` commands with `--agent` filter and `--min-score` CI gate
- Monorepo stack detection, markdown link router extraction, 78 tests across 20 suites

### Local Context (Cold Path)
- `ai/coding-standards/` vendor-neutral coding guidelines with `ai/README.md` router
- Copilot bridge files (`.github/copilot-instructions.md`, `.github/instructions/`)
- 11 workflow templates, migration guide with real project examples

### Scanner & Audit Fixes
- 9 new quality checks: skill quality (Step 0, human gates, constraints), hook quality, Ask First path resolution
- Fixed phantom paths, stale refs, scanner bugs across 6 projects
- Removed dead abstractions: ProjectShape, confusion-log.md, shape-based labels

### Other
- Restructured to `src/cli/`, interactive `run-cli.sh` menu, 5 new maintenance scripts

---

## v0.3.0 - 2026-03-21

Multi-agent alignment release. First public release under MIT license.

### Tri-Agent Support
- Claude Code, Gemini CLI, Codex with unified `.agents/skills/` architecture
- 7 skills with YAML frontmatter, Gemini CLI fully configured (GEMINI.md, settings, hooks)
- Renamed goat-research -> goat-debug (investigate mode), created goat-plan and goat-test

### Agent-Neutral Docs & Safety
- Reverted Gemini overwrites of 6 shared docs, hook table uses concept names
- `mv -n` enforcement in deny hooks, overwrite protection in Never tier

### Public Release
- MIT LICENSE, README rewrite, removed private project details
- CI validates all 3 router tables and both skill directories

### Incidents
- 3 new footguns (agent-rewrite, vocabulary mismatch, mv overwrite)
- 2 new lessons (broad setup rewrites shared docs, mv overwrites without checking)

---

## v0.2.0 - 2026-03-21

Workflow deployed across 7 projects. Multi-agent support. 11 diagnostic rounds.

### Execution Loop
- 6-step loop: READ -> CLASSIFY -> SCOPE -> ACT -> VERIFY -> LOG
- Complexity budgets: Hotfix (2/3), Standard (4/10), System (6/20), Infra (8/25)
- Debug gate: no fixes until human reviews diagnosis
- LOG triggers: VERIFY failure -> lessons.md, human correction -> log immediately

### Skills (7 total)
- Added goat-plan (triangular tension pass), goat-test (3-track doer-verifier)
- goat-review: explicit depth requirement with file:line evidence

### Enforcement
- 5-item Ask First micro-checklist, deny-dangerous covers Edit/Write (not just Bash)
- Content-preserving write guard (>80% reduction blocked)

### Multi-Agent
- Codex + Gemini CLI support with setup guides, skills, hooks, ignore files
- Truth order: user > instruction file > execution-loop > system-spec > skills
- Data honesty labels, context rot defense (40-60% utilization rule)

### Repo Cleanup
- Merged codex-evals/ into agent-evals/, deleted drafts, restructured docs/

---

## v0.1.0 - 2026-03-20

First release. Complete workflow system.

### System
- 5-layer architecture: Runtime, Local Context, Skills, Playbooks, Evaluation
- 6-step execution loop with SCOPE, complexity budgets, re-classification protocol
- 3-layer enforcement: permissions deny -> hooks -> instruction rules
- Autonomy tiers (Always / Ask First / Never) with micro-checklist
- Definition of Done (6 gates)
- Doer-verifier testing with risk-scaled ratios

### Enforcement
- Agent ignore files, content-preserving write guard
- Lockfile + generated code + migrations in Never tier
- Anti-patterns: AP1-AP11 with calibrated weights
- CI pending review flags (AI-GENERATED: UNVERIFIED)

### Skills (6 total)
- preflight, debug, audit, research, review, plan
- Planning playbooks: feature brief, mob elaboration, SBAO ranking, milestone planning
- Testing playbooks: doer-verifier workflow with 3 parallel tracks

### Documentation
- system-spec, five-layers, six-steps, getting-started, design-rationale
- Cross-agent comparison, competitive landscape, implementation examples
- Agent evals from real incidents, CI context validation
