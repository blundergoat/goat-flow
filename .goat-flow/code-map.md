# Code Map

Every path below exists at the repo root of the **goat-flow** Node/TypeScript project. Dependency/build/local outputs (`node_modules/`, `dist/`, `_temp/`, agent worktrees, and runtime logs) are summarized rather than expanded.

## src/cli/ -- TypeScript CLI auditor and dashboard

```text
src/cli/                         = Node CLI, audit engine, dashboard server, prompt builders
├── cli.ts                       = command parser for audit, setup, dashboard, quality, events, stats, hooks
├── index.ts                     = programmatic library entry and public re-exports
├── constants.ts                 = AUDIT_VERSION, SKILL_NAMES, and shared constants
├── paths.ts                     = package-root path resolution for source and packaged installs
├── types.ts                     = shared types for agents, facts, config, audit, and filesystem adapters
├── classify-state.ts            = project adoption-state classifier
├── hooks-command.ts             = CLI entry for `goat-flow hooks enable|disable|sync|list`
│
├── agents/                      = manifest-backed agent registry
│   └── registry.ts              = typed runtime facade for agent metadata
│
├── audit/                       = deterministic setup/agent/harness checks and output rendering
│   ├── audit.ts                 = public audit command orchestration
│   ├── check-goat-flow.ts       = setup-scope build checks
│   ├── check-agent-setup.ts     = agent-scope build checks
│   ├── check-drift.ts           = template-vs-installed skill/reference drift detection
│   ├── check-content-quality.ts = cold-path content-quality lint
│   ├── check-factual-claims.ts  = factual-claim extraction and drift checks
│   ├── check-snapshot-claims.ts = release-frozen snapshot-claim lint
│   ├── provenance-types.ts      = evidence-provenance schema for audit checks
│   ├── render.ts                = text/json/markdown audit renderers
│   ├── types.ts                 = audit report/check/failure types
│   └── harness/                 = 17 advisory/integrity/metric checks across the 5 harness concerns
│
├── config/                      = `.goat-flow/config.yaml` loading and validation
│   ├── reader.ts                = config reader, defaults, schema warnings
│   └── types.ts                 = GoatFlowConfig and LoadedConfig interfaces
│
├── detect/                      = installed-agent and project-stack detection
├── evidence/                    = evidence envelopes, redaction, JSONL append/tail helpers
├── facts/                       = filesystem-backed facts used by audit, stats, and prompts
│   ├── orchestrator.ts          = runs fact extractors and assembles ProjectFacts
│   ├── fs.ts                    = real/test filesystem adapter
│   ├── agent/                   = hook, instruction, routing, skill, and settings facts
│   └── shared/                  = CI, learning-loop, decisions, local-instruction facts
│
├── manifest/                    = workflow manifest loader and schema types
├── prompt/                      = setup, quality, artifact, commit, and learning-loop prompt composition
├── quality/                     = skill/reference quality scoring, report validation, history, diffs
├── server/                      = dashboard HTTP/WebSocket server and route modules
│   ├── dashboard.ts             = server bootstrap, route dispatch, live reload, shutdown
│   ├── dashboard-routes.ts      = non-terminal route composition
│   ├── dashboard-*-routes.ts    = audit, project, quality, shell, and skill-quality route groups
│   ├── dashboard-terminal.ts    = terminal HTTP routes and WebSocket upgrades
│   ├── terminal.ts              = PTY-backed terminal session manager
│   ├── hooks-registry.ts        = manifest-backed hook specs and compatibility metadata
│   ├── hook-registrar.ts        = applies hook enabled/disabled state to installed agent surfaces
│   └── agent-hook-writer.ts     = writes per-agent hook config entries and launcher commands
│
├── stats/                       = learning-loop health report and renderer
└── telemetry/                   = telemetry/event plumbing
```

## src/dashboard/ -- Dashboard frontend

```text
src/dashboard/                   = browser dashboard frontend bundled into dist/dashboard
├── index.html                   = dashboard HTML shell source
├── app.ts                       = client-side app entry and view routing
├── styles.css                   = dashboard stylesheet
├── preset-prompts.json          = built-in setup and quality prompt presets
├── globals.d.ts                 = frontend global type declarations
├── dashboard-custom-prompts.ts  = custom prompt management UI
├── dashboard-projects.ts        = project selection and multi-project UI
├── dashboard-prompts.ts         = prompt display and interaction handlers
├── dashboard-readers.ts         = client-side HTTP data readers
├── dashboard-setup-quality.ts   = setup and quality assessment UI logic
├── dashboard-terminal.ts        = xterm.js terminal client integration
└── views/                       = HTML view templates (about, coming-soon, home, hooks, plans, projects, prompts, quality, settings, setup, skills, workspace)
    ├── about.html               = about view
    ├── coming-soon.html         = placeholder view
    ├── home.html                = dashboard home
    ├── hooks.html               = hook state/toggle UI
    ├── plans.html               = local plan/task view
    ├── projects.html            = project picker
    ├── prompts.html             = prompt library
    ├── quality.html             = quality history/analysis UI
    ├── settings.html            = settings view
    ├── setup.html               = setup/audit view
    ├── skills.html              = skill inventory/evaluation view
    └── workspace.html           = terminal workspace shell view
```

## workflow/ -- Setup templates, skills, and reference docs

```text
workflow/                        = packaged template source copied into target projects
├── manifest.json                = expected installed files, dirs, agents, hooks, skills, stale names
├── install-goat-flow.sh         = installer, upgrade, migration, and pruning logic
├── manifest-snapshots/          = historical manifest snapshots for upgrade/drift tests
│
├── setup/                       = six-step setup prompt sequence
│   ├── 01-system-overview.md    = goat-flow overview and state check
│   ├── 02-instruction-file.md   = instruction-file generation guidance
│   ├── 03-install-skills.md     = skill install and stale-skill cleanup guidance
│   ├── 04-architecture-code-map.md = architecture/code-map creation guidance
│   ├── 05-customise-to-project.md = project-specific config, learning loop, hooks
│   ├── 06-final-verification.md = final audit/preflight verification gate
│   ├── agents/                  = claude, codex, antigravity, copilot setup docs
│   └── reference/               = execution loop, README/gitignore seeds, supporting refs
│
├── skills/                      = goat-* skill templates and shared skill docs
│   ├── goat/SKILL.md            = dispatcher skill template
│   ├── goat-debug/SKILL.md      = debugging and investigation skill template
│   ├── goat-plan/SKILL.md       = milestone planning skill template
│   ├── goat-review/SKILL.md     = code review and audit skill template
│   ├── goat-critique/SKILL.md   = multi-perspective critique skill template
│   ├── goat-security/SKILL.md   = security assessment skill template
│   ├── goat-qa/SKILL.md         = testing-gap analysis skill template
│   ├── reference/               = skill-preamble.md and skill-conventions.md templates
│   └── playbooks/               = browser-use, changelog, code-comments, gruff-code-quality, observability, page-capture, release-notes, skill-quality-testing
│
├── hooks/                       = hook templates and agent hook config templates
│   ├── deny-dangerous.sh        = canonical deny-dangerous dispatcher template
│   ├── gruff-code-quality.sh    = canonical gruff code-quality hook template
│   ├── deny-dangerous/          = deny-dangerous policy modules and self-test templates
│   └── agent-config/            = claude, codex, antigravity, copilot hook config templates
│
└── evaluation/                  = quality-assessment prompt templates
```

## scripts/ -- Shell scripts

```text
scripts/                         = development, release, test, and maintenance scripts
├── preflight-checks.sh          = canonical pre-commit/CI-style verification gate
├── run-tests.mjs                = Node test runner used by npm test scripts
├── build-dashboard-assets.mjs   = copies dashboard assets/views/vendor files into dist
├── bump-version.sh              = version sync across package/config/skills/docs
├── check-instruction-parity.mjs = instruction-file section/order parity
├── check-markdown-links.sh      = markdown link resolver
├── check-package-readme-links.mjs = npm-pack README link check
├── check-path-integrity.sh      = docs/code path-reference integrity checks
├── check-versions.mjs           = package/workflow skill version sync
├── dependency-install.sh        = guarded npm install wrapper
├── dependency-update.sh         = guarded dependency update wrapper
├── deploy-landing.sh            = docs/site deployment helper
├── install-browser-tools.sh     = browser-use and Playwright install helper
├── mutation-test.sh             = opt-in Stryker mutation-testing helper
├── npm-publish.sh               = npm publish sanity wrapper
├── prettier.sh                  = formatting wrapper
├── prettier-check.sh            = formatting check wrapper
├── profile-dashboard-audit.mjs  = dashboard audit cache/fresh profiling helper
├── run-cli.sh                   = local CLI wrapper
├── setup-initial.sh             = initial repo scaffolding helper
├── start-dev.sh                 = local dashboard dev wrapper
├── warn-node-pty.mjs            = postinstall node-pty warning helper
├── installers/                  = installer-related helper scripts
└── maintenance/                 = cleanup, secret scanning, Zone.Identifier removal
```

## docs/ -- Documentation

```text
docs/                            = user and maintainer documentation
├── cli.md                       = CLI command reference
├── dashboard.md                 = dashboard views, terminal behavior, HTTP APIs
├── skills.md                    = goat-* skill overview and routing guide
├── guardrails.md                = deny/gruff hook behavior and verification
├── audit-and-quality.md         = audit vs quality model and report lifecycle
├── audit-checks.md              = deterministic audit check inventory
├── harness-audit.md             = harness audit reference
├── harness-engineering.md       = five-concern harness engineering model
├── harness-quality.md           = harness quality assessment guidance
├── skill-authoring.md           = skill creation/evaluation workflow
├── skill-quality-config.md      = project overrides for skill-quality scoring
├── coding-standards/            = code review, conventions, frontend, git commit docs
│   ├── code-review.md           = review expectations and finding standards
│   ├── conventions.md           = general repo conventions and command expectations
│   ├── frontend.md              = TypeScript/frontend conventions
│   └── git-commit.md            = commit message conventions
├── assets/                      = documentation images
└── site/                        = standalone landing pages and OG assets
```

## .goat-flow/ -- Framework state (mostly gitignored)

```text
.goat-flow/                      = goat-flow's installed framework state for this repo
├── config.yaml                  = goat-flow config: version, skill install list, hook toggles, telemetry
├── architecture.md              = canonical architecture and persistence tiers
├── code-map.md                  = this file
├── glossary.md                  = project terms and canonical surfaces
├── learning-loop/               = durable project knowledge
│   ├── decisions/               = ADRs and decision indexes
│   ├── footguns/                = architectural traps with semantic-anchor evidence
│   ├── lessons/                 = behavioural mistake records and prevention rules
│   └── patterns/                = successful reusable approaches
├── hooks/                       = committed central hook dispatchers and policy store
│   ├── deny-dangerous.sh        = central deny-dangerous dispatcher used by all agents
│   ├── gruff-code-quality.sh    = central gruff quality dispatcher used by all agents
│   └── deny-dangerous/          = policy modules and self-test
├── skill-docs/                  = installed shared skill doctrine and playbooks
│   ├── README.md                = index for shared skill doctrine and playbooks
│   ├── skill-preamble.md        = shared proof/evidence/routing doctrine loaded by goat-* skills
│   ├── skill-conventions.md     = full-depth task tracking, learning-loop, recovery conventions
│   ├── skill-quality-testing/   = skill-authoring methodology pack
│   │   ├── README.md            = short index for skill-authoring methodology
│   │   ├── adversarial-framing.md = review-class skill pressure patterns
│   │   ├── deployment.md        = deployment checklist and skip-testing rationalisations
│   │   └── tdd-iteration.md     = TDD loop and iteration discipline
│   └── playbooks/               = installed standalone tool/capability playbooks
│       ├── README.md            = playbook index
│       ├── browser-use.md       = browser evidence capture and availability checks
│       ├── changelog.md         = CHANGELOG.md discipline
│       ├── code-comments.md     = inline comments, docstrings, TODO/FIXME/HACK rules
│       ├── gruff-code-quality.md = gruff analyzer triage/fix/verification loop
│       ├── observability.md     = logs, metrics, spans, and sensitive-data instrumentation rules
│       ├── page-capture.md      = Playwright/browser page-capture usage tiers
│       └── release-notes.md     = per-release narrative surfaces derived from changelog
├── logs/                        = local session, quality, events, critique, review, security, upload history
├── plans/                       = local milestone/plan files; gitignored except anchors
└── scratchpad/                  = local ephemeral working notes
```
