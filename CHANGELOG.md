# Changelog

All notable changes to GOAT Flow will be documented in this file.

---

## v0.3.0 - 2026-03-21

Multi-agent alignment release. Fix Gemini CLI hook configuration, make shared docs agent-neutral, complete Codex 7-playbook parity, add file-overwrite protection.

### Gemini CLI Fixes

- Fixed hook event names in `.gemini/settings.json`: `PreToolUse` → `BeforeTool`, `Stop` → `AfterAgent`
- Fixed hook script comments referencing Claude-specific terminology
- Fixed `setup/setup-gemini.md` Phase 0 + Phase 1c: correct event names, `policy` → `permissions`
- Added Gemini CLI hook event reference block to Phase 1c instructions
- Added SCOPE constraints to every phase in `setup/setup-gemini.md` to prevent shared doc overwrites

### Agent-Neutral Shared Docs

- Reverted Gemini's overwrites of 6 shared docs that replaced Claude Code references with Gemini-specific ones
- `docs/system-spec.md`: hook table uses concept names (pre-tool/post-tool/post-turn) with agent mapping table
- `docs/system/five-layers.md`: restored Claude Code to skills table, multi-agent enforcement paths
- `docs/system/six-steps.md`: both Claude Code and Gemini CLI hook examples listed
- `docs/reference/design-rationale.md`: agent-neutral diagram and dual-agent hook section headers
- `workflow/runtime/enforcement.md`: reverted to Claude Code template + header warning against global replacement

### Codex Skills Migration

- Migrated Codex skills from `docs/codex-playbooks/` to `.agents/skills/goat-*/SKILL.md` (Codex CLI runtime discovery)
- Deleted `docs/codex-playbooks/` — single source of truth is now `.agents/skills/`
- Created `goat-plan` and `goat-test` skills (full parity with Claude's 7 skills)
- Renamed `goat-research` → `goat-investigate` with strengthened constraints and output template
- Strengthened `goat-debug`, `goat-audit`, `goat-review` with missing constraints from Claude equivalents
- Added YAML frontmatter (name + description) to all 7 Codex skill files
- Updated `AGENTS.md` router table to point to `.agents/skills/`
- Updated `scripts/context-validate.sh`: validates 7 skills at `.agents/skills/`, checks frontmatter, accepts `agent-evals/`
- Updated `setup/setup-codex.md`: instructs creation of `.agents/skills/` with frontmatter, references `workflow/skills/` templates
- Updated all "5 skills" references to "7 skills" across system-spec, five-layers, design-rationale, cross-agent-comparison
- Updated all `docs/codex-playbooks/` references to `.agents/skills/` in live docs (setup/README, skills.md, five-layers, execution-loop, workflow templates, agent evals)

### File Overwrite Protection

- Added `mv -n` enforcement to deny-dangerous hooks (both `.claude/` and `.gemini/`)
- Added "overwrite existing files without checking destination" to Never tier in CLAUDE.md, GEMINI.md, AGENTS.md
- Added to `docs/system-spec.md` Never list and `setup/shared/execution-loop.md` template
- Added to `workflow/runtime/enforcement.md` deny-dangerous block list

### Skill Descriptions

- Added YAML frontmatter descriptions to all 21 skill files (7 Claude + 7 Gemini + 7 Codex)
- Fixed stale `goat-research` heading in `.gemini/skills/goat-investigate/SKILL.md`

### Incident Logging

- `docs/footguns.md`: 3 new entries (agent-rewrite, vocabulary mismatch, mv overwrite)
- `docs/lessons.md`: 2 new entries (broad setup rewrites shared docs, mv overwrites without checking)
- `docs/architecture.md`: added Gemini CLI to agent list and setup flow

---

## v0.2.0 - 2026-03-21

GOAT Flow implemented and iterated across 7 projects (rampart, sus-form-detector, devgoat-bash-scripts, ambient-scribe, blundergoat-platform, goat-flow itself, the-summit-chatroom). Multi-agent support (Claude Code + Codex + Gemini CLI). Instructions refined through 11 diagnostic rounds with closed-loop feedback.

### Self-Implementation

- Implemented GOAT Flow Phases 1a-2 on the goat-flow project itself
- CLAUDE.md (120 lines), AGENTS.md (108 lines), GEMINI.md (84 lines), 7 skills per agent, codex playbooks, hooks, settings, CI workflow
- docs/footguns.md (5 footguns with file:line evidence), docs/lessons.md (2 entries)
- 3 agent evals, 5 codex evals with Origin labels (2 Codex-mechanics)
- scripts/deny-dangerous.sh, scripts/context-validate.sh, scripts/preflight-checks.sh

### Execution Loop

- SCOPE promoted from paragraph to 6th step: READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG
- Complexity budgets: Hotfix (2/3), Standard (4/10), System (6/20), Infra (8/25) — over budget = re-classify
- Debug gate: "No fixes until human reviews diagnosis" — explicit in shared template and all agent setup files
- LOG mechanical trigger: VERIFY failure or course correction → lessons.md entry required before DoD
- LOG human correction trigger: MUST log immediately after human correction
- LOG footgun propagation: propagate to local instruction docs
- Mode-transition rule: "Switching to [NEW STATE] because [reason]" — now in shared template

### Ask First

- Explicit 5-item micro-checklist inlined in shared template (was "include micro-checklist" with no specifics)
- Items: boundary touched, related code read, footgun checked, local instruction checked, rollback command
- Item 4 agent-neutral: local CLAUDE.md / .github/instructions/ / none

### Enforcement

- deny-dangerous covers Edit/Write tool calls, not just Bash
- Read deny patterns for Claude/Gemini Code (settings.json)
- Content-preserving write guard (>80% reduction) in Phase 1c
- All verification sections → hard gates ("Do NOT proceed until all gates pass")
- Verification uses scripts/preflight-checks.sh with fallback to stack commands

### Codex Support

- setup-codex.md: explicit MUST-include block (state declaration, mode-transition, Debug gate, all LOG triggers, footgun propagation, dual-agent coordination, 5-item Ask First)
- Codex evals require 1-2 Codex-mechanics evals + Origin: real-incident | synthetic-seed labels
- Dual-agent repos must reference Claude assets and align shared semantics (loop, budgets, LOG triggers, Ask First shape, DoD gates)
- Human checklist expanded: ACT checks, LOG checks, Ask First format, DoD alignment, Codex-mechanics eval check, AGENTS-vs-CLAUDE semantic diff
- Router says "skill directories (Claude/Gemini) or playbook files (Codex)"
- Phase 2 eval dedup: check other agent's evals before creating duplicates

### Documentation

- Renamed docs/five-steps.md → docs/system/six-steps.md (6-step loop with SCOPE)
- Moved docs/five-layers.md → docs/system/five-layers.md
- Moved 4 reference docs to docs/reference/
- Rewrote docs/README.md for current structure
- Added rampart as 7th implementation with bug-to-loop retrospective (6 real bugs mapped to loop steps)
- Added SCOPE rationale and complexity budgets rationale to design-rationale.md
- docs/footguns.md: spec contradiction footgun, line target inconsistency resolved
- docs/lessons.md: 2 entries (first-source-wins, line-pressure cuts)
- setup-audit-prompt.md: diagnose prompt for auditing existing implementations
- Unified line target to 120 for all project shapes (dropped 100/120 split)
- Gemini CLI setup guide (setup-gemini.md)
- docs-seed.md: seed lessons from evals, merge guidance for architecture.md, dual-agent ownership-split, footgun evidence format clarified

### Instruction Fixes (from diagnostic rounds)

- system-spec.md: fixed 5-step/6-step contradiction, promoted SCOPE, added budgets, marked (f)-(i) MUST-include
- setup-codex.md: fixed context prompt (was 5-step), added RECORD→LOG reinforcement, eval dedup, Codex-mechanics eval requirement
- setup-claude.md + setup-gemini.md: added "Do NOT skip (f)-(i)" to Prompt A, PRE-CHECK for dual-agent state, Prompt B domain vs behavioral test
- Phase 2 changed from "after a while" to "implement immediately"
- All stale path references fixed (five-steps.md, five-layers.md, old doc paths, old skill names)

### Repo Cleanup

- Merged codex-evals/ into agent-evals/ (single shared directory, evals declare Agents: all | codex | claude)
- Deleted _draft/ (8 pre-restructure v1.5 source files — content extracted into current docs)
- Deleted roadmaps/draft/ (5 SBAO planning docs — output merged into roadmaps)
- Merged roadmaps/PLAN.md + roadmaps/RUBRIC.md into docs/roadmaps/TODO_improvements_v0.3.md
- Moved roadmaps/ to docs/roadmaps/
- Moved docs/README.md to root README.md (was 3-line stub, now full navigation)
- Renamed setup/setup-audit-prompt.md → setup/setup-prompt-audit.md
- Created setup/setup-prompt-fix.md (fix prompt for existing implementations)
- Absolute paths in prompt files → [goat-flow repo]/... for portability

### Handoff & Working Memory

- tasks/handoff-template.md: added purpose section, when-to-create/read guidance, date field, files-changed field
- tasks/.gitignore: ignores todo.md and handoff.md (template committed, filled copies not)
- execution-loop.md: Working Memory now references handoff template by name, requires gitignore
- docs-seed.md: handoff template description expanded, tasks/.gitignore added as item 5

### Additional Fixes

- CLAUDE.md: added scripts/preflight-checks.sh and scripts/context-validate.sh to Essential Commands
- settings.json: added Read deny patterns (.env*, secrets, .pem, .key)
- Agent evals: added Origin + Agents labels to all 8 evals
- five-layers.md: agent evals table unified (was codex-evals/ for Codex, now agent-evals/ for all)
- Root README.md: full navigation with setup guides, system design, learning loop, reference docs

### Skills (7 total, renamed + 2 new)

- Renamed /goat-research → /goat-investigate (the skill investigates codebases, not "researches")
- Added /goat-plan: 4-phase planning workflow (brief → elaboration → SBAO → milestones) with Triangular Tension Pass (SKEPTIC → ANALYST → STRATEGIST) for System/Infra complexity
- Added /goat-test: 3-track testing instructions (automated, AI verification, human testing) based on doer-verifier principle
- Created docs/system/skills.md: summary table, when-to-use guide, decision table, design rationale, skill justification test
- goat-investigate: added source quality levels (PRIMARY / INFERRED / DOCUMENTED / ASSUMED)
- goat-review: explicit depth requirement ("read actual source code, find real bugs with file:line evidence")
- Fixed broken markdown links in planning playbooks (old numbered filenames)

### System Improvements (from goat-system analysis)

Seven improvements adopted from the goat-system project's architecture:

1. **Data honesty labeling** — footgun evidence must be labeled ACTUAL_MEASURED / DESIGN_TARGET / HYPOTHETICAL_EXAMPLE (docs-seed.md)
2. **Truth order / precedence** — explicit priority when sources conflict: user > CLAUDE.md > execution-loop > system-spec > skills (execution-loop.md)
3. **Recovery protocols** — first-class section in VERIFY: 2-3 common failure patterns with fixes (execution-loop.md)
4. **Triangular Tension Pass** — SKEPTIC → ANALYST → STRATEGIST sequential challenge for /goat-plan Phase 3 (goat-plan.md)
5. **Source quality levels** — PRIMARY / INFERRED / DOCUMENTED / ASSUMED for /goat-investigate findings (goat-investigate.md)
6. **Signal-based CLASSIFY** — three explicit signals (intent, complexity, mode) before acting (execution-loop.md)
7. **Decisions as 4th learning loop file** — docs/decisions/ for significant technical decisions with context/rationale (execution-loop.md LOG)

### Gemini CLI Support

- GEMINI.md (84 lines) with full v0.2 spec: 6-step loop, 3-signal CLASSIFY, truth order, recovery protocols, 4 LOG files, context health
- 7 Gemini skills (.gemini/skills/goat-*) including goat-plan and goat-test
- .gemini/settings.json with Read deny patterns
- .gemini/hooks/ (deny-dangerous.sh, stop-lint.sh)
- .geminiignore for secret protection
- CI validation updated to check GEMINI.md and .gemini/settings.json

### Context Rot Defense (from Comprehensive Agent Engineering Guide analysis)

- docs/system/six-steps.md: expanded Context Health with 3 rot mechanisms (lost-in-the-middle, attention dilution, distractor interference), 40-60% rule, instruction centrifugation, 5 defenses table
- execution-loop.md Working Memory: compact at 60% utilization, noise pruning, fresh context between tasks
- goat-investigate skill: noise awareness ("are search results adding signal or distractors?")

### Instruction Quality

- Setup prompts now read execution-loop.md FIRST (authoritative template), system-spec.md for background. Explicit "if they conflict, execution-loop.md wins"
- docs-seed.md: audit config files (.json, .yaml, .sh) for stale names/paths as footguns
- setup-prompt-audit.md + setup-prompt-fix.md: now agent-agnostic (Claude, Codex, Gemini)
- Gemini diagnostic confirmed "first-read bias" — agents follow whichever source they read first

### Based on

- 7 real project implementations across App, Library, and Collection shapes
- 11+ diagnostic rounds (Claude + Codex + Gemini) with closed-loop instruction fixes
- 60+ gaps fixed across 6 projects, all instruction files rebuilt to current spec
- Key findings: agents follow first source read, compress MUST to SHOULD under line pressure, lessons.md stays empty without mechanical triggers, context rot degrades quality superlinearly, instruction centrifugation fades rules after ~50 turns

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
