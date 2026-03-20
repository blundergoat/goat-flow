# Changelog

All notable changes to GOAT Flow will be documented in this file.

---

## v0.2.0 - 2026-03-21

Codex implementation for goat-flow + Codex instruction improvements from 6 project diagnostics.

### Codex Implementation (goat-flow)

- AGENTS.md (108 lines) with 6-step loop, budgets, all LOG triggers, 5-item Ask First checklist
- 5 codex playbooks (goat-preflight, goat-debug, goat-audit, goat-research, goat-review)
- 5 codex evals with Origin labels (2 Codex-mechanics: no-slash-commands, preserve-claude-assets)
- scripts/deny-dangerous.sh, scripts/context-validate.sh, scripts/preflight-checks.sh
- CI context-validation.yml updated with Codex workflow validation

### Codex Instruction Improvements (from 6 project diagnostics)

Ran Codex diagnostic prompt against all 6 projects. Key improvements:

- setup-codex.md: explicit MUST-include block for state declaration, mode-transition rule, Debug gate ("human reviews" not "diagnosis exists"), all LOG triggers, footgun propagation, dual-agent coordination, 5-item Ask First checklist
- setup-codex.md: Codex evals now require 1-2 Codex-mechanics evals + Origin labels
- setup-codex.md: dual-agent repos must reference Claude assets and align shared semantics
- setup-codex.md: human checklist expanded with ACT checks, LOG checks, Ask First format, DoD alignment, Codex-mechanics eval check
- execution-loop.md: Ask First micro-checklist now inlines all 5 items (was "include micro-checklist" with no specifics)
- execution-loop.md: router says "skill directories (Claude/Gemini) or playbook files (Codex)"
- execution-loop.md: Debug gate now explicit in shared template ("No fixes until human reviews diagnosis")
- phase-2.md: Codex evals must target Codex-specific mechanics, each declares Origin
- All verification gates updated to use scripts/preflight-checks.sh with fallback to stack commands

### Based on

- 6 Codex diagnostics confirming instructions materially improved
- All 6 AGENTS.md files rebuilt to current spec with zero remaining gaps
- Key win: RECORD→LOG fix held 6/6, Ask First checklist expansion worked first pass

---

## v0.1.1 - 2026-03-20

Post-release improvements from implementing GOAT Flow on 5 real projects (rampart, sus-form-detector, devgoat-bash-scripts, ambient-scribe, blundergoat-platform) and running the diagnose prompt against each.

### Self-Implementation

- Implemented GOAT Flow Phases 1a-2 on the goat-flow project itself
- CLAUDE.md (110 lines), 5 skills, 2 hooks, settings.json, CI workflow
- docs/footguns.md (5 footguns with file:line evidence), docs/lessons.md (2 entries)
- 3 agent evals, .copilotignore, .cursorignore, tasks/handoff-template.md, docs/architecture.md

### Instruction Fixes (from rampart audit)

- execution-loop.md: added SCOPE as explicit step, complexity read/turn budgets, LOG as MUST-when-tripped, router table minimum entries
- Phase 2 changed from "after a while" to "implement immediately" across all setup files
- setup-claude.md, setup-codex.md, setup-gemini.md: "Do not defer" added to Phase 2

### Instruction Fixes (from sus-form-detector diagnosis)

- system-spec.md: fixed loop contradiction (was still showing old 5-step loop in 2 places)
- system-spec.md: promoted SCOPE from paragraph inside CLASSIFY to its own ### section
- system-spec.md: added read/turn budgets to CLASSIFY, marked (f)-(i) as MUST-include in cut priority
- setup-claude.md + setup-gemini.md: added "Do NOT skip sections (f)-(i)" to Prompt A (was only in Prompt B)
- setup-claude.md: added .copilotignore/.cursorignore to Phase 1c verification checklist
- docs-seed.md: clarified footgun evidence format (file paths with line numbers, bare paths don't count)
- docs-seed.md: resolved confusion-log.md tension ("create on first use" but "ALWAYS reference in LOG and router")

### Documentation Updates

- docs/reference/examples.md: added rampart as 7th implementation, added bug-to-loop retrospective (6 real bugs mapped to execution loop steps)
- docs/reference/design-rationale.md: added SCOPE rationale and complexity budgets rationale with rampart incident evidence
- docs/system/five-layers.md: multi-agent support table, sub-agent strategy
- docs/system/six-steps.md: auto-triggering skills section
- docs/reference/cross-agent-comparison.md: multi-model verification
- setup/setup-gemini.md: new Gemini CLI setup guide
- Moved reference docs to docs/reference/ (competitive-landscape, cross-agent-comparison, design-rationale, examples)
- docs/footguns.md: added spec contradiction footgun, updated all paths
- docs/lessons.md: 2 entries (agents follow first source read, agents cut small sections under line pressure)

### Doc Restructure

- Renamed docs/five-steps.md → docs/system/six-steps.md (reflects 6-step loop with SCOPE)
- Moved docs/five-layers.md → docs/system/five-layers.md
- Moved 4 reference docs to docs/reference/ (design-rationale, examples, cross-agent-comparison, competitive-landscape)
- Rewrote docs/README.md to match current directory structure
- Fixed 17+ stale path references across CLAUDE.md, getting-started.md, system-spec.md, footguns.md, agent-evals/, CHANGELOG.md
- Updated six-steps.md: title, loop diagram, "Why Six Steps" section with SCOPE rationale
- Updated five-layers.md: folder structure diagram shows current docs/ + workflow/ split

### Instruction Improvements (from 5 project diagnostics)

Consolidated findings from running diagnose prompt against rampart, sus-form-detector, devgoat-bash-scripts, ambient-scribe, blundergoat-platform:

- execution-loop.md: mechanical LOG trigger (VERIFY failure → lessons.md entry required), human correction trigger (MUST log immediately), mode-transition rule in ACT, dual-agent router cross-references, "don't weaken MUST to meet target"
- setup-claude.md + setup-gemini.md: PRE-CHECK for dual-agent state and existing scripts, Prompt B domain vs behavioral test with imperative verb examples, content-preserving write guard in Phase 1c, Read deny patterns for Claude/Gemini, deny-dangerous covers Edit/Write not just Bash, all verification sections → hard gates ("Do NOT proceed until pass")
- docs-seed.md: seed lessons.md from evals, merge guidance for pre-existing architecture.md, dual-agent ownership-split documents both files
- phase-2.md: eval dedup checks other agent's directory first
- Unified line target to 120 for all project shapes (dropped 100/120 split)
- setup-audit-prompt.md: diagnose prompt for auditing existing implementations

### Based on

- 7 real project implementations (added rampart)
- 5 project diagnostics with bug-to-loop-step mapping
- Key findings: agents compress away MUST content to meet line targets, lessons.md stays empty without mechanical triggers, dual-agent AGENTS.md consistently drifts (RECORD/LOG, missing SCOPE, no budgets), verification sections treated as optional unless marked as gates

---

## v0.1.0 - 2026-03-20

First public release. Complete workflow system with docs, prompts, and reference material.

### System

- 5-layer architecture: Runtime, Local Context, Skills, Playbooks, Evaluation
- 6-step execution loop: READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG
- 3-layer enforcement gradient: permissions deny → hooks → instruction rules
- Autonomy tiers (Always / Ask First / Never) with micro-checklist
- Definition of Done (6 gates)
- Doer-verifier testing with risk-scaled ratios (1:1 for Ask First, 1:3 for Always)
- Create-on-first-use for confusion-log, permission profiles, ADRs
- Graduation gate: experiment (Phase 0) → maintained project (full system)

### Execution Loop (v0.1 additions from external review)

- SCOPE declaration between CLASSIFY and ACT
- Absence verification principle (generalised from rename-only to all replacements)
- Re-classification protocol (RE-CLASSIFY state instead of hard stop)
- Complexity-scaled read budgets (2/4/6/8) and turn budgets (3/10/20/25)
- Context pathologies: Poisoning, Distraction, Confusion, Clash
- Progress-aware budgets (over budget + no uncertainty reduction = stop)

### Enforcement

- Agent ignore files (.copilotignore, .cursorignore, Read deny patterns)
- Content-preserving write guard (block >80% file size reduction)
- Lockfile + generated code + migrations added to Never tier
- Anti-pattern weights recalibrated: AP1 -3, AP4 -5, AP5 -5, AP6 -5
- New anti-patterns: AP10 (incident without entry, -2), AP11 (dead artifacts, -2)
- CI pending review flags (AI-GENERATED: UNVERIFIED) with enforcement
- Layer 2 staleness + contradiction detection in CI

### Skills (7 total, goat-* prefix)

- /goat-preflight - mechanical build verification
- /goat-debug - diagnosis-first debugging
- /goat-audit - 4-pass codebase review with fabrication self-check
- /goat-research - deep investigation with human gate
- /goat-review - structured code review with RFC 2119 severity
- /goat-plan - 4-phase planning workflow (brief → elaboration → SBAO → milestones)

### Playbooks

- Planning: feature brief, mob elaboration, SBAO ranking, milestone planning
- Testing: doer-verifier workflow with 3 parallel tracks, verifier prompt templates

### Evaluation

- Agent evals from real incidents
- CI context validation (8 checks)
- Learning loop: footguns (with file:line + timestamps), lessons, confusion-log, handoff

### Governance

- Model-version gated quarterly shrink (run evals before removing rules)
- Shrink based on tooling improvements + rules never triggered in 90+ days
- Model version transition guidance

### Documentation

- docs/system/five-layers.md - architecture overview
- docs/system/six-steps.md - execution loop deep dive
- docs/getting-started.md - onboarding with troubleshooting recipes
- docs/system-spec.md - full technical specification
- docs/reference/design-rationale.md - why behind every decision
- docs/reference/cross-agent-comparison.md - Claude Code vs Codex analysis
- docs/reference/competitive-landscape.md - 12 competitor systems compared
- docs/reference/examples.md - real implementation data from 7 projects + example artifacts

### Based on

- 3 independent AI reviews (Gemini 88/100, ChatGPT 87/100, Claude 81/100)
- Cross-referenced against Bruniaux 6 Pillars, BMad Method, and 21 other systems
- 7 real project implementations (1 fully public, 4 private, 2 in progress)
