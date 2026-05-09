# Architecture - GOAT Flow

## What It Is

A documentation framework that provides structured AI coding agent workflows. Primarily a methodology and set of templates that users copy into their projects and run via setup prompts. The CLI auditor (`src/cli/`) validates implementations against the audit checks.

## Major Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Setup prompts | `workflow/setup/` | Agent-specific setup instructions, upgrade guides |
| Setup steps | `workflow/setup/0*.md` | Six numbered setup steps (system overview, instruction file, skills, architecture + code map, customise, final verification) |
| Skill templates | `workflow/skills/` | Reference prompts for the 7 goat-flow skill templates (6 functional + 1 dispatcher) |
| Hook scripts | `workflow/hooks/` | Copyable hook scripts (`deny-dangerous.sh` + self-test sibling) + per-agent config templates |
| Evaluation templates | `workflow/evaluation/` | Footguns/lessons templates |
| Docs | `docs/` | CLI usage, dashboard guide |
| CLI auditor | `src/cli/` | 18 build checks (14 setup scope + 4 agent scope) + 16 AI harness installation checks (5 concerns), audit-driven setup prompts, quality prompt/history/diff surfaces, multi-agent support |
| Dashboard | `src/cli/server/` (server modules), `src/dashboard/` (HTML + views) | HTML dashboard with views for about, home, projects, prompts, quality, settings, setup, skills, workspace; `dashboard.ts` owns bootstrap/dispatch/live reload, `dashboard-routes.ts` owns non-terminal HTTP handlers, and `dashboard-terminal.ts` owns terminal HTTP/WebSocket wiring |
| Maintenance scripts | `scripts/maintenance/` | Repo hygiene: git cleanup, secret scanning, Zone.Identifier removal |

## Data Flow

```
User runs `npx goat-flow setup .` or reads workflow/setup/
  -> Chooses agent (workflow/setup/agents/claude.md, workflow/setup/agents/codex.md, workflow/setup/agents/gemini.md, workflow/setup/agents/copilot.md)
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
  config/             # Configuration (reader.ts, types.ts)
  detect/             # Agent and stack detection (agents.ts, project-stack.ts)
  facts/              # Fact extraction (orchestrator.ts, fs.ts, agent/, shared/)
  prompt/             # Prompt generation (compose-setup.ts, compose-quality.ts)
  quality/            # Quality report schema, positional ids, history, and diff
  audit/              # Build checks, quality checks, render.ts (output formatters: text, json, markdown)
  server/             # Dashboard server modules:
                     #   dashboard.ts (bootstrap, dispatch, live reload)
                     #   dashboard-routes.ts (non-terminal HTTP handlers)
                     #   dashboard-terminal.ts (terminal HTTP/WebSocket wiring)
                     #   dashboard-assets.ts (HTML shell + bundled asset loading)
                     #   setup-detect.ts (setup-detection payload helpers)
                     #   terminal.ts, types.ts
  agents/             # Manifest-backed agent registry (M12)
  manifest/           # Single-source-of-truth manifest loader (M06a)
  stats/              # Learning-loop health report (goat-flow stats)

src/dashboard/
  index.html          # Dashboard entry point
  preset-prompts.json  # Preset configurations
  views/              # Page views (about, home, projects, prompts, quality, settings, setup, skills, workspace)
```

## Key Constraints

- **Setup shared templates are canonical.** `workflow/setup/reference/execution-loop.md` defines the execution loop; `workflow/setup/01-system-overview.md` defines the layer architecture and design intent. ADRs in `.goat-flow/decisions/` capture specific design decisions.
- **Cross-references are fragile.** 60+ markdown files with dense internal linking. File renames require repo-wide grep.
- **Real evidence only.** All examples, footguns, and anti-patterns must trace to real incidents with file-path + semantic-anchor references (per ADR-024).

## Hot Path / Cold Path

Agent instruction files (CLAUDE.md, AGENTS.md, GEMINI.md, .github/copilot-instructions.md) are the hot path -- loaded every turn, with a target of about 125 lines and a hard limit of 150. Skills and learning-loop files are cold path -- loaded on demand when skills or agent workflows reference them.

## Persistence Tiers

`.goat-flow/` mixes committed project knowledge with local session state. Reviewers should expect both.

| Tier | Paths | Committed? | Purpose |
|------|-------|-----------|---------|
| **Committed knowledge** | `architecture.md`, `code-map.md`, `glossary.md`, `patterns/**`, `config.yaml`, `decisions/`, `footguns/**`, `lessons/**`, the meta references at `.goat-flow/skill-reference/skill-preamble.md`, `.goat-flow/skill-reference/skill-conventions.md`, and the standalone playbooks at `.goat-flow/skill-playbooks/browser-use.md`, `.goat-flow/skill-playbooks/page-capture.md`, `.goat-flow/skill-playbooks/skill-quality-testing.md` (index) plus the topical files `.goat-flow/skill-playbooks/skill-quality-testing/tdd-iteration.md`, `.goat-flow/skill-playbooks/skill-quality-testing/adversarial-framing.md`, and `.goat-flow/skill-playbooks/skill-quality-testing/deployment.md` (per ADR-023) | Yes | Durable project record. Source of truth across sessions. |
| **Local session state** | `tasks/**`, `scratchpad/**`, `.goat-flow/logs/sessions/*.md`, `.goat-flow/dashboard-state.json` | No (gitignored by design; only anchor files such as `README.md`, `.gitignore`, and `.gitkeep` are committed) | Personal WIP: milestone files, plan subdirs, throwaway notes, session continuity logs, and dashboard runtime state. Coordinates a single work session - not project history. |
| **Local report history** | `.goat-flow/logs/quality/*.json`, `.goat-flow/logs/quality/*.md`, `.goat-flow/logs/critiques/*.md` | No (gitignored by design; only the directory README is committed) | Saved agent quality reports, captured prose, and critique snapshots from goat-critique runs. Feeds `goat-flow quality history`, `goat-flow quality diff`, and prior same-agent prompt context. |

**Not a persistence gap.** If a `tasks/`, `scratchpad/`, or `.goat-flow/logs/sessions/` artifact deserves to survive the session, promote its durable content into the committed tier: lesson → `lessons/`, trap → `footguns/`, decision → `decisions/`. Session logs themselves are checkout-local continuity artifacts.

## Deliberate Trade-offs

- **Redundancy across docs** - The same concepts appear in multiple files (spec, layers, steps, rationale) for different audiences. This is intentional: each file serves a different reading path. The cost is maintenance burden on edits.
- **CLI validates the methodology** - The auditor (`src/cli/`) runs audit checks against projects, confirming the workflow produces measurable results. The dashboard (`goat-flow dashboard .`) serves an HTML interface for audit results and guided setup.
