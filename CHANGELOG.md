# Changelog

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
