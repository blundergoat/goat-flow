# Changelog

---

## v0.7.0 - Unreleased

Reference-based setup prompts, scanner accuracy fixes, CLI simplification. Setup output drops from ~860 to ~90 lines. Rubric: v0.7.0, 92 checks + 12 anti-patterns.

### Reference-Based Setup Prompt
- Setup generates ~90-line prompts with template path tables instead of ~860 lines of inline skeletons
- Agent-branched tables (Claude/Codex/Gemini), language-to-coding-standards mapper, `--agent all` with interactive picker
- Skill quality requirements block in Phase 1b, `GOAT_FLOW_INLINE_SETUP=1` rollback, `setup/` + `workflow/` in npm tarball

### Scanner Accuracy (rubric v0.7.0)
- 3.3.4 sync: Jaccard word-intersection ≥0.85 (was length-ratio ≥0.6), matches bold format
- 2.3.2 lessons.md: strips HTML comments, requires 20+ chars of real content after H3
- AP11: fires when EITHER lessons OR footguns is empty (was AND)
- Check 2.2.7 removed — ask-first-guard hooks removed from all agents (ADR-006)

### Template Quality
- enforcement.md: jq parsing guidance, sed fallback, command chaining, read-deny patterns
- docs-seed.md: concrete `git log`/`grep -rn` commands for seeding real incidents
- execution-loop.md: "logs updated if tripped" DoD gate added

### Removed
- `fix` and `audit` CLI commands (deprecated in v0.6.0, now exit 2 with migration message)
- ask-first-guard.sh hooks and scanner check 2.2.7 — see ADR-006

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
- Audited projects drop from 100% to 92-99% — scanner now catches real quality gaps

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
- Prompt/doc drift fixed: "7→10 skills", permission profiles removed

---

## v0.5.0 - 2026-03-22

All 7 skills rewritten with conversational structure and failure-mode prevention. Scanner: 84 checks. All 3 agents score A 100%.

### Skills (full rewrite)
- Replaced goat-preflight with goat-security (ADR-004): threat-model-driven, OWASP-aware
- All 7 skills: conversational choices at every phase, "Chains with" footer, severity scale
- Key upgrades: goat-debug recurrence detection, goat-plan kill criteria, goat-test Track 0, goat-review diff-aware mode
- YAML `name:` frontmatter + `## When to Use` on all skill files

### Scanner (84 checks)
- Skill quality threshold unified at 0.8 (human gates 0.5→0.8, conversational 0.3→0.8)
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
- `ai/instructions/` vendor-neutral coding guidelines with `ai/README.md` router
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
- Renamed goat-research → goat-investigate, created goat-plan and goat-test

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
- 6-step loop: READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG
- Complexity budgets: Hotfix (2/3), Standard (4/10), System (6/20), Infra (8/25)
- Debug gate: no fixes until human reviews diagnosis
- LOG triggers: VERIFY failure → lessons.md, human correction → log immediately

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
- 3-layer enforcement: permissions deny → hooks → instruction rules
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
