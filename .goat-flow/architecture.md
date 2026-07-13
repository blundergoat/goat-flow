# Architecture - GOAT Flow

## What It Is

A documentation framework that provides structured AI coding agent workflows. Primarily a methodology and set of templates that users copy into their projects and run via setup prompts. The CLI auditor (`src/cli/`) validates implementations against the audit checks.

## Major Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Setup prompts | `workflow/setup/` | Agent-specific setup instructions, upgrade guides |
| Setup steps | `workflow/setup/0*.md` | Six numbered setup steps (system overview, instruction file, skills, architecture + code map, customise, final verification) |
| Skill templates | `workflow/skills/` | Reference prompts for the 7 goat-flow skill templates (6 functional + 1 dispatcher) |
| Hook scripts | `workflow/hooks/` | Copyable `deny-dangerous.sh` dispatcher, shared `deny-dangerous/` policy templates, opt-in `gruff-code-quality.sh`, default `post-turn-safety.sh`, and per-agent config templates |
| Evaluation templates | `workflow/evaluation/` | Footguns/lessons/patterns templates |
| Docs | `docs/` | CLI usage, dashboard guide |
| CLI auditor | `src/cli/` | 20 build checks (16 setup scope + 4 agent scope) + 17 AI harness installation checks (5 concerns), audit-driven setup prompts, quality prompt/history/diff surfaces, multi-agent support |
| Dashboard | `src/cli/server/` (server modules), `src/dashboard/` (HTML + views) | HTML dashboard with views for about, home, hooks, plans, projects, prompts, quality, settings, setup, skills, workspace; `dashboard.ts` owns bootstrap/dispatch/live reload, `dashboard-routes.ts` composes non-terminal route modules, `dashboard-index-routes.ts` owns learning-loop index maintenance, `dashboard-{audit,project,quality,shell,skill-quality}-routes.ts` own route groups, and `dashboard-terminal.ts` owns terminal HTTP/WebSocket wiring |
| Hook registration and proof | `src/cli/hooks-command.ts`, `src/cli/hooks-runtime-evidence.ts`, `src/cli/server/hooks-registry.ts`, `src/cli/server/hook-registrar.ts`, `src/cli/server/agent-hook-writer.ts` | CLI/dashboard hook toggles plus explicit bounded managed-hook classifier proof backed by manifest specs, installed-agent detection, and per-agent config state |
| Maintenance scripts | `scripts/maintenance/` | Repo hygiene: git cleanup, secret scanning, Zone.Identifier removal |

## Data Flow

```
User runs `npx goat-flow setup .` or reads workflow/setup/
  -> Chooses agent (workflow/setup/agents/claude.md, workflow/setup/agents/codex.md, workflow/setup/agents/antigravity.md, workflow/setup/agents/copilot.md)
  -> Follows numbered setup steps (01-06) via their agent config
  -> Agent reads workflow/setup/ (01-system-overview.md, 02-instruction-file.md, reference/execution-loop.md)
  -> Agent generates project-specific files (CLAUDE.md, hooks, skills, etc.)
```

## CLI Layout

```
src/cli/
  cli.ts              # Entry point, arg parsing
  index.ts            # Library re-exports
  types.ts            # All type definitions
  constants.ts        # Shared constants
  paths.ts            # Path resolution utilities
  redact-command.ts   # Pre-write scrubber for readable session, handoff, review, quality, security, and export text
  hooks-runtime-evidence.ts # Explicit managed deny-hook classifier proof and metadata-only local events
  config/             # Configuration (reader.ts, types.ts)
  detect/             # Agent and stack detection (agents.ts, project-stack.ts)
  evidence/           # Hash-only evidence metadata, readable text redaction, envelopes, JSONL append/tail helpers
  facts/              # Fact extraction (orchestrator.ts, fs.ts, agent/, shared/)
  prompt/             # Prompt generation: commit-guidance.ts, compose-setup.ts, compose-quality.ts, compose-quality-agent-report.ts, compose-quality-agent-setup.ts, compose-quality-artifact.ts, compose-quality-common.ts, compose-quality-focused.ts, compose-quality-static-sections.ts, learning-loop-context.ts
  quality/            # Quality report schema, positional ids, history, and diff
  audit/              # Build checks, quality checks, render.ts (output formatters: text, json, markdown)
  server/             # Dashboard server modules:
                     #   dashboard.ts (bootstrap, dispatch, live reload)
                     #   dashboard-routes.ts (non-terminal route composition)
                     #   dashboard-index-routes.ts (learning-loop index maintenance)
                     #   dashboard-audit-routes.ts, dashboard-project-routes.ts,
                     #   dashboard-quality-routes.ts, dashboard-shell-routes.ts,
                     #   dashboard-skill-quality-routes.ts (route groups)
                     #   dashboard-terminal.ts (terminal HTTP/WebSocket wiring)
                     #   dashboard-assets.ts (HTML shell + bundled asset loading)
                     #   hooks-registry.ts, hook-registrar.ts, agent-hook-writer.ts
                     #     (manifest-backed hook registration)
                     #   setup-detect.ts (setup-detection payload helpers)
                     #   terminal.ts, types.ts
  agents/             # Manifest-backed agent registry (M12)
  learning-loop-index/ # Generated learning-loop INDEX.md parser/generator
  manifest/           # Single-source-of-truth manifest loader (M06a)
  stats/              # Learning-loop health report (goat-flow stats)

src/dashboard/
  index.html          # Dashboard entry point
  preset-prompts.json  # Preset configurations
  views/              # Page views (about, home, hooks, plans, projects, prompts, quality, settings, setup, skills, workspace)
```

## Key Constraints

- **Setup shared templates are canonical.** `workflow/setup/reference/execution-loop.md` defines the execution loop; `workflow/setup/01-system-overview.md` defines the layer architecture and design intent. ADRs in `.goat-flow/learning-loop/decisions/` capture specific design decisions.
- **Cross-references are fragile.** 200+ markdown files with dense internal linking (committed surface plus installed skill mirrors and worktree caches). File renames require repo-wide grep.
- **Real evidence only.** All examples, footguns, and anti-patterns must trace to real incidents with file-path + semantic-anchor references (per ADR-024).

## Hot Path / Cold Path

Agent instruction files (CLAUDE.md, AGENTS.md, .github/copilot-instructions.md) are the hot path -- loaded every turn, with a target of about 125 lines and a hard limit of 150. Codex and Antigravity share `AGENTS.md` per the community standard. Skills and learning-loop files are cold path -- loaded on demand when skills or agent workflows reference them.

## Persistence Tiers

`.goat-flow/` mixes committed project knowledge with local session state. Reviewers should expect both.

| Tier | Paths | Committed? | Purpose |
|------|-------|-----------|---------|
| **Committed knowledge** | `architecture.md`, `code-map.md`, `glossary.md`, `config.yaml`, `.goat-flow/learning-loop/patterns/**`, `.goat-flow/learning-loop/decisions/`, `.goat-flow/learning-loop/footguns/**`, `.goat-flow/learning-loop/lessons/**`, the meta references at `.goat-flow/skill-docs/skill-preamble.md`, `.goat-flow/skill-docs/skill-conventions.md`, the skill-authoring methodology pack under `.goat-flow/skill-docs/skill-quality-testing/`, and the standalone playbooks indexed by `.goat-flow/skill-docs/playbooks/README.md`: `browser-use.md`, `changelog.md`, `code-comments.md`, `gruff-code-quality.md`, `hook-policy-testing.md`, `observability.md`, `page-capture.md`, `release-notes.md`, and `skill-playbook-authoring-sync.md` | Yes | Durable project record. Source of truth across sessions. |
| **Local session state** | `.goat-flow/plans/**`, `.goat-flow/scratchpad/**`, `.goat-flow/logs/sessions/*.md`, `.goat-flow/dashboard-state.json`, `.goat-flow/project-id` | No (gitignored by design; only anchor files such as `README.md`, `.gitignore`, and `.gitkeep` are committed) | Personal WIP: milestone files, plan subdirs, throwaway notes, session continuity logs, and dashboard runtime state. Coordinates a single work session - not project history. |
| **Local evidence history** | `.goat-flow/logs/events/*.jsonl` | No (gitignored by design; only the directory README is committed) | Validated `EvidenceEnvelope` metadata from local runtime producers. Supports checkout-local diagnosis and recovery; it is not durable project truth or a share-safe export. |
| **Local report history** | `.goat-flow/logs/quality/*.json`, `.goat-flow/logs/quality/*.md`, `.goat-flow/logs/critiques/*.md`, `.goat-flow/logs/review/*.txt`, `.goat-flow/logs/review/*.json`, `.goat-flow/logs/security/*.md` | No (gitignored by design; only the directory README is committed) | Saved agent quality reports, captured prose, critique snapshots from goat-critique runs, review refutation/refuter artifacts from goat-review runs, and security assessment history from goat-security runs. Feeds `goat-flow quality history`, `goat-flow quality diff`, and prior same-agent prompt context. |

**Not a persistence gap.** If local state, evidence, or report history deserves to survive the session, promote only its durable conclusion into the committed tier: lesson -> `.goat-flow/learning-loop/lessons/`, trap -> `.goat-flow/learning-loop/footguns/`, decision -> `.goat-flow/learning-loop/decisions/`. The local artifact remains checkout-local continuity and must not be cited as committed project truth.

## Local Data and Evidence Budget

Local-only artifacts may prove that a named producer recorded bounded metadata at a stated time and that the record passed its local schema. They cannot prove an external tool's claim is true, authorize an external write, replace a fresh verification run, or become durable project knowledge by themselves. Promotion is explicit: extract the verified conclusion into a lesson, footgun, or decision with durable source evidence.

`EvidenceEnvelope` is the only runtime event schema. Payloads contain JSON-compatible summary metadata; raw prompts, terminal output or scrollback, uploads, screenshots, JSON/HTML bodies, and tool output require hash-only `RedactedEvidenceValue` markers. Paths, labels, identifiers, warning text, and other metadata remain local-sensitive and must be scrubbed before any shareable export. There is no automatic retention or purge promise; users control cleanup of gitignored artifacts.

| Event kind | Status | Expected producer | Actor | Allowed payload budget | Redaction requirement | Intended local consumer |
|------------|--------|-------------------|-------|------------------------|-----------------------|-------------------------|
| `terminal.create` | existing | `dashboard-session-trace` | server | Session id, runner, working directory, target path | No prompt or terminal body | Dashboard recovery and support diagnosis |
| `terminal.delete` | existing | `dashboard-session-trace` | server | Session id, runner, terminal status | No scrollback or terminal output | Dashboard recovery and support diagnosis |
| `terminal.upload` | existing | `dashboard-session-trace` | server | Accepted/rejected counts and accepted byte total | No filename or upload content | Upload-flow diagnosis |
| `terminal.send` | existing | `dashboard-session-trace` | server | Session/runner/path metadata, byte count, input hash metadata | Input must be `RedactedEvidenceValue` | Terminal interaction diagnosis |
| `prompt.launch` | existing | `dashboard-session-trace` | server | Session id, runner, prompt hash metadata | Prompt must be `RedactedEvidenceValue` | Prompt-launch continuity |
| `prompt.send` | existing | `dashboard-session-trace` | server | Session/runner/path metadata, byte count, input hash metadata | Prompt input must be `RedactedEvidenceValue` | Prompt-send continuity |
| `audit.exec` | existing | `safe-exec` | server | Command basename, outcome, signal, timeout/truncation flags, duration | No arguments, stdout, or stderr | Deep-probe diagnosis |
| `audit.run` | existing | `dashboard-session-trace` | server | Cache, harness, agent, and status summary | No audit body | Dashboard audit continuity |
| `setup.prompt` | existing | `dashboard-session-trace` | server | Agent plus rendered-output hash metadata | Output must be `RedactedEvidenceValue` | Setup-prompt continuity |
| `quality.prompt` | existing | `dashboard-session-trace` | server | Agent, quality mode, audit status, prompt hash metadata | Prompt must be `RedactedEvidenceValue` | Quality-prompt continuity |
| `index.regenerate` | existing | `dashboard-session-trace` | server | Regenerated bucket count | No bucket body | Index-maintenance diagnosis |
| `project.save` | existing | `dashboard-session-trace` | server | Project/favourite/add/remove counts | No project-list body | Project-list continuity |
| `project.remove` | existing | `dashboard-session-trace` | server | Removed-project count | No removed path list | Project-list continuity |
| `project.switch` | existing | `dashboard-session-trace` | server | Readiness state and project identity metadata | No config or file body | Selected-target diagnosis |
| `hook.verify` | new in 1.14.0 | `hooks-runtime-evidence` | cli | Scenario id, agent, expected/observed state, verdict, evidence level, duration, and reason code | No command operand, stdout, stderr, or external-agent delivery claim | Checkout-local deny-hook proof and diagnosis |

Route/checkpoint/promotion event families and all other runtime event families remain **deferred**. M17 owns `hook.verify`; every future producer must add its exact event kind, producer, actor, bounded payload, redaction rule, consumer, and focused validation before extending `EvidenceEventKind`. M14 added no event kind.

### Evidence Depth and Tool Trust

- Summary dashboard/CLI routes reuse cached or already-extracted facts and may record only cheap outcome metadata. A deep route may run a probe only through an explicit user command, with bounded execution/output and a metadata-only envelope.
- User-level tool or MCP configuration is a user-provided local capability, not proof that its output is correct. Project-level configuration crosses a repository-controlled trust boundary and needs explicit review of origin, command, permissions, and endpoint before use.
- External tool/MCP output is producer evidence. Durable promotion must retain producer provenance and independent verification; neither output nor forwarded instructions authorize code, GitHub, or other external writes.

## Deliberate Trade-offs

- **Redundancy across docs** - The same concepts appear in multiple files (spec, layers, steps, rationale) for different audiences. This is intentional: each file serves a different reading path. The cost is maintenance burden on edits.
- **CLI validates the methodology** - The auditor (`src/cli/`) runs audit checks against projects, confirming the workflow produces measurable results. The dashboard (`goat-flow dashboard .`) serves an HTML interface for audit results and guided setup.
