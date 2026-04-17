# Code Map

Quick orientation for agents working on the goat-flow codebase.

## src/cli/ -- TypeScript CLI auditor and dashboard

```
cli.ts                     # Entry point: command parser (audit, setup, dashboard, quality)
classify-state.ts          # Project adoption classifier (bare/partial/v0.9/v1.0/v1.1/error)
constants.ts               # SKILL_NAMES, AUDIT_VERSION
types.ts                   # Shared types: AgentId, ReadonlyFS, CLIOptions, core interfaces

config/
  reader.ts                # Loads and validates .goat-flow/config.yaml
  types.ts                 # GoatFlowConfig, LoadedConfig interfaces

facts/                     # Fact extractors -- gather project state for audit checks
  orchestrator.ts          # Runs all extractors, builds ProjectFacts
  fs.ts                    # Filesystem adapter for testing
  agent/                   # Agent-specific facts (hooks, instruction file, routing, skills)
  shared/                  # Shared facts (CI, learning loop, local instructions)

audit/
  audit.ts                 # Public audit command: build checks + optional harness completeness (--harness)
  check-goat-flow.ts       # 13 setup build checks (gate CI pass/fail)
  check-agent-setup.ts     # 4 agent build checks (gate CI pass/fail)
  harness/                 # 16 pass/fail completeness checks grouped by concern (5 files + helpers + index)
  render.ts                # Output formatters (text, json, markdown)
  types.ts                 # Audit-specific types (AuditReport, CheckResult, AuditFailure)

prompt/
  compose-setup.ts         # Generates audit-driven setup prompts for agents
  compose-quality.ts       # Generates quality-assessment prompts for agents

server/
  dashboard.ts             # HTTP server for dashboard + API
  terminal.ts              # WebSocket PTY sessions (xterm.js backend)
```

## workflow/ -- Setup templates, skills, and reference docs

```
setup/
  01-system-overview.md    # What goat-flow is, state check
  02-instruction-file.md   # How to write the instruction file
  03-install-skills.md     # Skill installation + cross-agent cleanup
  04-architecture-code-map.md  # Architecture doc and code map creation
  05-customise-to-project.md   # Learning loop, hooks, config
  06-final-verification.md # Post-setup verification and audit gate
  agents/                  # Agent-specific config (claude.md, codex.md, gemini.md)
  reference/               # execution-loop.md, coding guidelines, security refs

skills/
  goat/SKILL.md            # Dispatcher skill template
  goat-debug/SKILL.md      # Debug + investigate skill template
  goat-plan/SKILL.md       # Milestone planning skill template
  goat-review/SKILL.md     # Code review + audit skill template
  goat-critique/SKILL.md   # Multi-perspective critique skill template
  goat-security/SKILL.md   # Security assessment skill template
  goat-qa/SKILL.md         # Testing gap analysis skill template
  reference/               # skill-preamble.md, skill-conventions.md

hooks/                     # Hook templates (deny-dangerous.sh, etc.)
evaluation/                # Quality-assessment prompt templates
validate-goat-flow-setup.sh  # Validates .goat-flow/ structure (lives here, not in scripts/)
```

## scripts/ -- Shell scripts

```
preflight-checks.sh        # Pre-commit/CI gate: lint, typecheck, cross-ref checks
setup-initial.sh           # First-time project scaffolding
deny-dangerous.sh          # Hook: blocks destructive commands
maintenance/               # Git cleanup, secret scanning, formatting
```

## docs/ -- Documentation


## .goat-flow/ -- Framework state (mostly gitignored)

```
architecture.md            # Canonical architecture
code-map.md                # This file
glossary.md                # Domain terms
patterns.md                # Successful repeatable approaches

config.yaml                # Project config (version, agents, skills, line limits)
skill-preamble.md          # Loaded by every goat-* skill invocation
skill-conventions.md       # Loaded by full-depth skill invocations

decisions/                 # ADRs (committed)
footguns/                  # Architectural traps with file:line evidence (committed)
lessons/                   # Behavioural mistake records (committed)

tasks/                     # Milestone files (gitignored, local working state)
  .active                  # One-line marker naming the active plan subdir (see ADR-043)
  <version>/Mxx-*.md       # Active milestones live in the subdir named by .active
  _archived/               # Prior plans + research; not scanned by skills
logs/sessions/             # Session logs (gitignored)
scratchpad/                # Ephemeral working notes (gitignored)
```
