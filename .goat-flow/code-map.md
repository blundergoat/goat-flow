# Code Map

Quick orientation for agents working on the goat-flow codebase.

## src/cli/ -- TypeScript CLI auditor and dashboard

```
cli.ts                     # Entry point: command parser (audit, setup, dashboard, quality, events, stats)
classify-state.ts          # Project adoption classifier (bare/partial/v0.9/outdated/current/error)
constants.ts               # SKILL_NAMES, AUDIT_VERSION
index.ts                   # Programmatic library entry: re-exports stable audit/prompt/config/utility APIs
paths.ts                   # Package-root path resolution; works from source and packaged builds
types.ts                   # Shared types: AgentId, ReadonlyFS, CLIOptions, core interfaces

agents/
  registry.ts              # Manifest-backed agent registry (M12); typed runtime facade for agent metadata

audit/
  audit.ts                 # Public audit command: build checks + optional harness completeness (--harness)
  check-goat-flow.ts       # 15 setup build checks (gate CI pass/fail)
  check-agent-setup.ts     # 4 agent build checks (gate CI pass/fail)
  check-drift.ts           # Template-vs-installed skill drift detection (M04)
  check-content-quality.ts # Cold-path content quality lint (vague terms, generic instructions)
  check-factual-claims.ts  # Cold-path factual-claim extraction (skill/check counts, broken refs)
  check-snapshot-claims.ts # Snapshot-claim lint for CHANGELOG / release-frozen docs (M06b)
  provenance-types.ts      # Evidence-provenance schema for audit checks (M05)
  harness/                 # 17 checks grouped by concern (6 advisory, 9 integrity, 2 metric) across 5 files + helpers + index
  render.ts                # Output formatters (text, json, markdown)
  types.ts                 # Audit-specific types (AuditReport, CheckResult, AuditFailure)

config/
  reader.ts                # Loads and validates .goat-flow/config.yaml
  types.ts                 # GoatFlowConfig, LoadedConfig interfaces

evidence/
  envelope.ts              # EvidenceEnvelope schema, validation, JSONL append, and tail reader
  redaction.ts             # Hash/length redaction helpers for sensitive event payloads

detect/
  agents.ts                # Agent detection from installed artefacts
  project-stack.ts         # Language/framework stack detection

facts/                     # Fact extractors -- gather project state for audit checks
  orchestrator.ts          # Runs all extractors, builds ProjectFacts
  fs.ts                    # Filesystem adapter for testing
  agent/                   # Agent-specific facts (hooks, instruction file, routing, skills)
  shared/                  # Shared facts (CI, learning loop, local instructions)

manifest/
  manifest.ts              # Single-source-of-truth manifest loader (M06a); validates static facts against code reality
  types.ts                 # Manifest schema types

prompt/
  compose-setup.ts         # Generates audit-driven setup prompts for agents
  compose-quality.ts       # Generates quality-assessment prompts for agents (prompt mode only)

quality/
  candidacy.ts             # Scores installed artifacts as skill-quality candidates
  schema.ts                # Strict quality-report parser for agent-written JSON reports
  quality-config.ts        # Per-project skill-quality rubric overrides
  skill-quality.ts         # Deterministic skill/reference quality scoring engine
  ids.ts                   # Positional finding-id generation (`type:file-slug:line-or-_`)
  history.ts               # Loads agent-written reports, renders history, and derives diffs

server/
  dashboard.ts             # HTTP server bootstrap, route dispatch, live reload, shutdown
  dashboard-routes.ts      # Non-terminal dashboard HTTP handlers and response shaping
  dashboard-terminal.ts    # Terminal HTTP routes, WebSocket upgrades, startup/shutdown wiring
  dashboard-assets.ts      # Dashboard HTML shell assembly and bundled asset loaders
  decoders.ts              # Runtime-boundary input validation (request params, query strings)
  setup-detect.ts          # Setup-detection payload helpers for dashboard routes
  terminal.ts              # PTY-backed terminal session manager (xterm.js backend)

stats/
  stats.ts                 # Learning-loop health report (goat-flow stats); consumes SharedFacts pipeline
  render.ts                # Stats command output rendering
```

## src/dashboard/ -- Dashboard frontend

```
app.ts                     # Client-side application entry point and view routing
dashboard-custom-prompts.ts # Custom prompt management UI logic
dashboard-projects.ts      # Project selection and multi-project UI
dashboard-prompts.ts       # Prompt display and interaction handlers
dashboard-readers.ts       # Client-side data fetching from dashboard HTTP API
dashboard-setup-quality.ts # Setup and quality assessment view logic
dashboard-terminal.ts      # xterm.js terminal client integration
globals.d.ts               # Global type declarations for the frontend bundle
index.html                 # Dashboard HTML entry point
preset-prompts.json        # Built-in prompt templates for quality and setup modes
styles.css                 # Dashboard stylesheet
views/                     # HTML view templates (about, coming-soon, home, projects, prompts, quality, settings, setup, skills, tasks, workspace)
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
  agents/                  # Agent-specific config (claude.md, codex.md, gemini.md, copilot.md)
  reference/               # execution-loop.md, coding guidelines, security refs

skills/
  goat/SKILL.md            # Dispatcher skill template
  goat-debug/SKILL.md      # Debug + investigate skill template
  goat-plan/SKILL.md       # Milestone planning skill template
  goat-review/SKILL.md     # Code review + audit skill template
  goat-critique/SKILL.md   # Multi-perspective critique skill template
  goat-security/SKILL.md   # Security assessment skill template
  goat-qa/SKILL.md         # Testing gap analysis skill template
  reference/               # Meta-reference templates: skill-preamble.md, skill-conventions.md
  playbooks/               # Standalone playbook templates: browser-use.md, page-capture.md, skill-quality-testing.md + topical skill-quality-testing/*

hooks/                     # Hook templates (deny-dangerous.sh + self-test sibling, etc.)
evaluation/                # Quality-assessment prompt templates
```

## scripts/ -- Shell scripts

```
build-dashboard-assets.mjs # Copy dashboard HTML/CSS/views + vendor xterm assets from node_modules into dist/dashboard/
bump-version.sh            # Bump package version across package.json, config.yaml, and skill templates
check-markdown-links.sh    # Verify relative markdown links resolve across docs
check-instruction-parity.mjs # Verify instruction files share the required contract
check-package-readme-links.mjs # Verify README-relative links resolve inside npm pack output
check-path-integrity.sh    # Cross-reference path-integrity checks between docs and code
check-versions.mjs         # Verify workflow/skills templates match package.json version
dependency-install.sh      # Wrapper: npm install with guards
dependency-update.sh       # Wrapper: upgrade dependencies
deny-dangerous.sh          # Hook: blocks destructive commands (copied to agent hook dirs)
deny-dangerous.self-test.sh # Self-test corpus sourced by deny-dangerous.sh --self-test
deploy-landing.sh          # Deploy landing page to hosting
install-browser-tools.sh   # Install browser-use and Playwright for page capture
npm-publish.sh             # Wrapper: npm publish sanity checks
mutation-test.sh           # Opt-in StrykerJS mutation-testing helper with target menu
preflight-checks.sh        # Pre-commit/CI gate: lint, typecheck, cross-ref checks
prettier-check.sh          # Wrapper: prettier --check (lint)
prettier.sh                # Wrapper: prettier --write (format)
profile-dashboard-audit.mjs # Benchmark/profiling helper for dashboard audit fresh/cache paths
run-cli.sh                 # Wrapper: run the local CLI via node
setup-initial.sh           # First-time project scaffolding
start-dev.sh               # Wrapper: start dashboard in dev mode
warn-node-pty.mjs          # npm postinstall guard: warn if node-pty is missing (skips in CI)
maintenance/               # Git cleanup, secret scanning, Zone.Identifier removal
```

## docs/ -- Documentation

```
audit-and-quality.md       # User-facing audit vs quality command model and report lifecycle
audit-checks.md            # Deterministic audit check inventory and scope breakdown
cli.md                     # CLI command reference, flags, and examples
dashboard.md               # Dashboard views, terminal behavior, and HTTP API reference
deny-dangerous.md          # Deny hook behavior, installation notes, and troubleshooting
skill-authoring.md         # `goat-flow skill new` / `quality candidacy` / dashboard Evaluate workflow
skill-quality-config.md    # Project overrides for the skill-quality rubric in `.goat-flow/config.yaml`
skills.md                  # User-facing goat-* skill overview and routing guide

harness-audit.md           # AI harness audit command/reference material
harness-engineering.md     # Five harness concerns and evaluation model
harness-quality.md         # AI harness quality assessment guidance

coding-standards/          # Project coding conventions used as reference material
  code-review.md           # Review expectations and finding standards
  conventions.md           # General repo conventions and command expectations
  frontend.md              # TypeScript/frontend conventions
  git-commit.md            # Commit message conventions

assets/                    # Documentation images such as dashboard-preview.png
site/                      # Standalone landing pages and OG images deployed by `scripts/deploy-landing.sh`
```

## .goat-flow/ -- Framework state (mostly gitignored)

```
architecture.md            # Canonical architecture
code-map.md                # This file
glossary.md                # Domain terms
patterns/                  # Proven approaches worth reusing (categorised bucket files)

config.yaml                # Project config (version, skills, optional calibration)

skill-reference/           # Shared skill doctrine (committed, install-copied from workflow/skills/reference/)
  skill-preamble.md        # Loaded by every goat-* skill invocation
  skill-conventions.md     # Loaded by full-depth skill invocations

skill-playbooks/           # Standalone tool/capability playbooks (committed, copied from workflow/skills/playbooks/)
  browser-use.md           # Browser evidence capture and availability checks
  page-capture.md          # Playwright page-capture usage tiers and installation checks
  skill-quality-testing.md # Index for the authoring methodology (points at topical files below)
  skill-quality-testing/   # Topical authoring files loaded on demand per ADR-023
    tdd-iteration.md       # TDD loop, pressure types, scenarios, bulletproofing, persuasion
    adversarial-framing.md # Review-class patterns: cynical-reviewer role, parallel reviewers, finding schema
    deployment.md          # Skip-testing rationalisations, deployment checklist, STOP rule

decisions/                 # ADRs (committed)
footguns/                  # Architectural traps with semantic-anchor evidence (committed)
lessons/                   # Behavioural mistake records (committed)

tasks/                     # Milestone files and plan subdirs (gitignored local state; anchors only are committed)
logs/sessions/             # Session logs (gitignored)
logs/quality/              # Saved quality reports + prose companions (gitignored; README committed)
logs/events/               # Evidence-envelope event JSONL (gitignored; README committed)
logs/critiques/            # `/goat-critique` run snapshots (gitignored; README committed)
logs/security/             # `/goat-security` assessment history (gitignored; README committed)
logs/uploads/              # Per-session terminal upload-image staging (gitignored; runtime-only)
scratchpad/                # Ephemeral working notes (gitignored)
```
