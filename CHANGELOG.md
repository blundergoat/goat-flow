# Changelog

All notable changes to GOAT Flow will be documented in this file.

---

## v0.1.0 - 2026-03-20

First public release. Complete workflow system with docs, prompts, and reference material.

### System

- 5-layer architecture: Runtime, Local Context, Skills, Playbooks, Evaluation
- 5-step execution loop: READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG
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

- docs/five-layers.md - architecture overview
- docs/five-steps.md - execution loop deep dive
- docs/getting-started.md - onboarding with troubleshooting recipes
- docs/system-spec.md - full technical specification
- docs/design-rationale.md - why behind every decision
- docs/cross-agent-comparison.md - Claude Code vs Codex analysis
- docs/competitive-landscape.md - 12 competitor systems compared
- docs/examples.md - real implementation data from 6 projects + example artifacts

### Based on

- 3 independent AI reviews (Gemini 88/100, ChatGPT 87/100, Claude 81/100)
- Cross-referenced against Bruniaux 6 Pillars, BMad Method, and 21 other systems
- 6 real project implementations (1 fully public, 3 private, 2 in progress)
