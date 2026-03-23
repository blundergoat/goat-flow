# Changelog

---

## v0.7.0 - 2026-03-23

CLI quality overhaul (M2.10). Zero ESLint warnings, dead code cleanup, 6 god function splits, anti-pattern fixes, prompt/doc drift resolved. 90-check rubric with confidence-weighted scoring. All agents A 100%.

### TypeScript Quality
- Split 6 god functions to ≤15 cyclomatic complexity: extractAgentFacts (84→15), detectStack (54→15), main (25→15), extractSharedFacts (25→15), parseCLIArgs (18→15), composeFix (17→15)
- ESLint strict-type-checked: 0 errors, 0 warnings (was 30 warnings)
- Knip: 0 unused exports (was 11)
- Replaced all 15 non-null assertions with type guards
- Single-source skill list in `constants.ts` (was 4 separate lists)
- CLIError class replaces 8 `process.exit()` calls
- `eval/runner.ts` uses ReadonlyFS (was bypassing with raw `node:fs`)
- Exhaustive switches + tightened string params to unions

### Anti-Patterns
- AP3 implemented: detects DoD heading duplication (not word mention)
- AP7 implemented: checks per-directory local files only (excludes `ai/instructions/` cold-path)
- AP9 verified working (settings.local.json gitignore check)

### Scanner (90 checks)
- Check 2.6.7 split into frontend (2.6.7a) + backend (2.6.7b) with correct recommendation keys
- Eval facts validate ALL files (was first-3 sample)
- Confidence labels calibrated: 4 skill quality checks downgraded high→medium (honest heuristic labeling)
- Registry duplicate ID guard at module load

### Prompt/Doc Drift Fixed
- "7 skills" → "10 skills" across all prompts and docs
- "permission profiles" removed from setup prompts
- Copilot scanner support clarified as "not yet"
- .env write protection claims fixed (Bash tool only)

### CI/Security
- GitHub Actions SHA-pinned
- Preflight: CHANGELOG version check added, knip is now breaking error
- Deny hook limitations documented honestly (not a sandbox)
- Security templates reconciled (env vars + framework stores)

---

## v0.6.0 - 2026-03-23

Expanded to 10 skills, 47 coding standards templates, eval runner, TypeScript quality hardening, and multi-agent infrastructure (Codex, Copilot).

### Skills (10 total)
- Added goat-onboard (codebase mapping + ai/instructions/ generation), goat-reflect (session friction → instruction file edits), goat-resume (session state reconstruction)
- All 10 skills deployed to .claude/skills/, .agents/skills/, .github/skills/
- Skill quality checks 2.1.12–2.1.19: Step 0 context gathering, human gates, MUST/MUST NOT constraints, phased process, conversational interaction, chaining, structured choices, output format

### Scanner & Rubric
- Rebalanced weights: grep-after-rename 1→2 pts, git push 1→2 pts, git commit 2→1 pt
- Demoted existence-only checks: architecture.md 2→1 pt, evals directory 2→1 pt
- Removed dead checks: permission profiles (3.3.1–3), guidelines ownership (3.4.1–4), domain-reference (2.5.3)
- Added deny hook security audit: blocking logic, jq JSON parsing, command chaining bypass, rm -rf, force push, chmod 777, read-deny sensitive paths
- Added instruction file quality: concrete examples (1.1.5), CLASSIFY budgets (1.2.2a)
- Added CI PR trigger (3.2.5), eval skill coverage (3.1.6)
- Implemented confidence-weighted scoring (medium/low checks contribute 50%)

### Coding Standards Library (49 templates)
- `workflow/coding-standards/` with backend (13 stacks), frontend (14 frameworks), security (12 topics), plus conventions, code-review, testing, git-commit
- Backend: Go, Rust, TypeScript/Node, Python (Django, FastAPI, vanilla), PHP (Laravel, Symfony, vanilla), Java Spring, Ruby Rails, C# .NET, Bash
- Frontend: React, Vue, Angular, Svelte, React Native, SwiftUI, Kotlin/Compose, Flutter, Blade, Twig, Jinja, ERB, Blazor
- Security: web-common, SQL injection, API auth, secrets, file upload, infrastructure, supply chain + 6 framework-specific

### Eval System
- New `src/cli/eval/` module: YAML frontmatter parser, eval loader, skill/agent/difficulty summarizer
- `goat-flow eval` command with text and JSON output
- agent-evals/FORMAT.md specification

### TypeScript Quality Hardening
- Added eslint.config.mjs: strictTypeChecked, complexity (max 15), no-floating-promises, consistent-type-imports
- Tightened tsconfig.json: noUncheckedIndexedAccess, noUnusedLocals, noUnusedParameters, noImplicitOverride, verbatimModuleSyntax, target ES2023
- Added JSDoc comments to all 35 src/cli/ files
- Replaced `!x` with `x === false` (project preference), `== null` for null checks
- Added eslint, typescript-eslint, knip as devDependencies
- M2.10 plan: dead code cleanup, ESLint warnings, anti-pattern implementation, complexity reduction, version management, self-documenting names

### Multi-Agent Infrastructure
- Added .codex/ directory: config.toml, hooks (after-tool-use, session-start), deny-dangerous.star
- Added .github/actions/goat-flow-scan/ composite action + workflow
- Added .github/PULL_REQUEST_TEMPLATE.md
- Improved deny hooks across all agents: jq-based JSON parsing, command chaining detection, expanded block patterns
- Added CODEOWNERS, CONTRIBUTING.md, SECURITY.md

### Cold Path
- Replaced ai/instructions/base.md with conventions.md (project-specific)
- Added ai/instructions/frontend.md
- Consolidated workflow/local-context/ into workflow/coding-standards/
- Updated ai/instructions/code-review.md

### Docs
- Added ADR-005 spec artifacts, docs/examples/ (typescript-cli, multi-agent-setup)
- Added M2.9 competitive additions roadmap, M2.10 CLI improvements plan
- Updated system-spec, five-layers, skills reference, getting-started

---

## v0.5.0 - 2026-03-22

Skill system upgrade. Replaced goat-preflight with goat-security. All 7 skills rewritten with failure-mode prevention, conversational structure, and cross-cutting patterns. Scanner expanded to 84 checks. All 3 agents score A 100%.

### Skills
- Replaced goat-preflight with goat-security (ADR-004): 4-phase threat-model-driven, OWASP-aware, framework-specific verification
- All 7 skills rewritten with: conversational choices (a/b/c/d) at every phase, "Chains with" footer, learning loop integration, severity scale
- goat-debug: recurrence detection, calibrated confidence, hypothesis tracking, time budget, Phase 4 post-fix verification
- goat-audit: Pass 0 scope declaration, negative verification, scope creep detector, pattern rollup
- goat-plan: risk-prioritized questions, kill criteria, milestone dependency mapping, SBAO fallback with worked example
- goat-test: Track 0 "What Changed", Track 2 adapts to Track 1, MUST/SHOULD/MAY verdict, coverage gaps, closing gate
- goat-review: conditional spec compliance phase, diff-aware mode, pattern drift detection, external review triage, DoD gate check
- goat-investigate: progressive depth with read budget, summary-first output, "What I didn't read", evidence quality tags
- `## When to Use` + YAML `name:` frontmatter added to all .claude/skills/ and .agents/skills/

### Scanner (84 checks)
- New checks 2.1.14 (skill chaining ≥80%) and 2.1.15 (structured choices ≥80%)
- `SKILL_QUALITY_THRESHOLD = 0.8` constant for all 7 quality checks
- Human gates threshold raised 0.5 → 0.8, conversational 0.3 → 0.8
- Fixed compaction hook detection for nested Claude Code settings format
- Fixed non-null assertions in evaluators.ts
- Compaction hooks registered in .claude/settings.json and .gemini/settings.json

### Infrastructure
- `scripts/stop-lint.sh` for Codex post-turn verification
- `scripts/preflight-checks.sh` rewritten with colour-coded output, section grouping, check counts
- `.github/instructions/git-commit.instructions.md` Copilot bridge file
- Severity scale added to CLAUDE.md, AGENTS.md, GEMINI.md
- `.copilotignore` and `.cursorignore` aligned with `.geminiignore`
- CLAUDE.md compressed to 119 lines
- VERIFY step: "tick checkboxes as completed, not at the end"

### Fixes
- Copilot PR review: Array.isArray guard, fillTemplate comment, fragment counts, lint command fragment, preflight set-e/fail aggregation
- `docs/architecture.md` stale "no runtime code" fixed
- Monorepo depth documented, compaction hook field corrected


---

## v0.4.0 - 2026-03-22

CLI scanner + prompt generator, local context system, 80-check rubric, multi-agent audit fixes across 6 projects. All projects score A (93-98%).

### CLI Scanner & Prompt Generator
- 80-check rubric across 3 tiers + 9 anti-pattern deductions
- `scan`, `fix`, `setup`, `audit` CLI commands with `--agent` filter and `--min-score` CI gate
- 90 prompt fragments with variable substitution, `create`/`fix` tagging
- Monorepo stack detection, markdown link router extraction, `(lines N-M)` evidence format
- 78 tests across 20 suites

### Local Context (Cold Path)
- `ai/instructions/` as vendor-neutral project coding guidelines (conventions.md, code-review.md, git-commit.md)
- `ai/README.md` as cold-path router with precedence order
- `.github/copilot-instructions.md` + `.github/instructions/` bridge files for Copilot
- `setup/setup-copilot.md` as fourth agent setup guide
- 11 workflow templates in `workflow/local-context/`
- Migration guide with real project examples

### Scanner Quality Checks (9 new)
- Skill quality: Step 0, human gates, constraints, phased process, conversational pattern
- Hook quality: deny has blocking logic, post-turn has validation, compaction hook registered
- Ask First paths resolve on disk

### Multi-Agent Audit Fixes
- Fixed phantom paths, stale class names, wrong ADR references across all 6 projects
- Fixed scanner bugs: line count off-by-one, Ask First detection, hasRouter logic, LOG section scope

### Removals
- Removed `ProjectShape` / `--shape` flag — all projects score identically
- Removed `confusion-log.md` from entire workflow
- Removed `[APP / LIBRARY / SCRIPT COLLECTION]` from all setup/workflow/docs

### Other
- All skills made conversational (12 files updated)
- Restructured `cli/` → root: `src/cli/` + `src/dashboard/`
- Preflight: removed-pattern enforcement, TypeScript quality checks, version consistency, compaction hook
- Verification gates in setup templates: "verify against actual code, not documentation"
- 8 new `docs/lessons.md` entries
- `scripts/run-cli.sh` interactive menu + test-all gate
- 5 new scripts: run-cli, setup-initial, start-dev, dependency-install, dependency-update

---

## v0.3.0 - 2026-03-21

Multi-agent alignment release. First public release under MIT license.

### Tri-Agent Support
- Claude Code, Gemini CLI, Codex with unified `.agents/skills/` architecture
- 7 skills with YAML frontmatter across both `.claude/skills/` and `.agents/skills/`
- Gemini CLI: GEMINI.md (84 lines), `.gemini/settings.json`, `.gemini/hooks/`, `.geminiignore`
- Renamed `goat-research` → `goat-investigate`, created `goat-plan` and `goat-test`

### Agent-Neutral Docs
- Reverted Gemini overwrites of 6 shared docs
- Hook table uses concept names with agent mapping table
- Enforcement template labeled as Claude Code reference (not shared)

### File Overwrite Protection
- `mv -n` enforcement in deny hooks
- "Overwrite without checking" added to Never tier across all agent files

### Public Release
- MIT LICENSE, README rewrite
- Removed private project details from reference docs
- Unified version strings, fixed stale paths and router bugs

### CI & Validation
- Context-validation.yml checks all 3 router tables and both skill directories
- Portable grep in context-validate.sh
- `tasks/.gitignore` blanket ignore with allowlist

### Incidents
- 3 new footguns (agent-rewrite, vocabulary mismatch, mv overwrite)
- 2 new lessons (broad setup rewrites shared docs, mv overwrites without checking)

---

## v0.2.0 - 2026-03-21

Workflow implemented across 7 projects. Multi-agent support. 11 diagnostic rounds with closed-loop feedback.

### Execution Loop
- SCOPE promoted to 6th step: READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG
- Complexity budgets: Hotfix (2/3), Standard (4/10), System (6/20), Infra (8/25)
- Debug gate: "No fixes until human reviews diagnosis"
- LOG triggers: VERIFY failure → lessons.md required, human correction → log immediately
- Mode-transition rule: "Switching to [NEW STATE] because [reason]"

### Skills (7 total)
- Renamed /goat-research → /goat-investigate with source quality levels
- Added /goat-plan: 4-phase planning with Triangular Tension Pass (SKEPTIC/ANALYST/STRATEGIST)
- Added /goat-test: 3-track doer-verifier (automated, AI verification, human testing)
- goat-review: explicit depth requirement ("read actual source code, find real bugs with file:line")

### Ask First & Enforcement
- 5-item micro-checklist: boundary, related code, footgun, local instruction, rollback
- deny-dangerous covers Edit/Write tool calls, not just Bash
- Content-preserving write guard (>80% reduction blocked)
- All verification sections → hard gates

### Multi-Agent
- Codex support: setup-codex.md, eval requirements, dual-agent coordination
- Gemini CLI: GEMINI.md, 7 skills, settings, hooks, .geminiignore
- Truth order: user > CLAUDE.md > execution-loop > system-spec > skills
- Context rot defense: 40-60% utilization rule, noise pruning

### System Improvements
- Data honesty labeling (ACTUAL_MEASURED / DESIGN_TARGET / HYPOTHETICAL_EXAMPLE)
- Recovery protocols in VERIFY
- Signal-based CLASSIFY (intent, complexity, mode)
- Decisions as 4th learning loop file (docs/decisions/)

### Repo Cleanup
- Merged codex-evals/ into agent-evals/
- Deleted _draft/ and roadmaps/draft/
- Restructured docs: system/, reference/, roadmaps/
- Handoff template with gitignored working copies

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
