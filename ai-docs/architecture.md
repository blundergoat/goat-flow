# Architecture - GOAT Flow

## What It Is

A documentation framework that provides structured AI coding agent workflows. Primarily a methodology and set of templates that users copy into their projects and run via setup prompts. The CLI scanner (`src/cli/`) validates implementations against the rubric.

## Major Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Core docs | `docs/` | System spec, architecture descriptions, design rationale, examples |
| Setup prompts | `workflow/setup/` | Agent-specific setup instructions for Claude Code, Gemini CLI, Codex, or Copilot |
| Shared setup | `workflow/setup/shared/` | Cross-agent setup fragments (execution loop, docs seed, Phase 2) |
| Skill templates | `workflow/skills/` | Reference prompts for the 6 goat-flow skill templates |
| Playbook templates | `workflow/playbooks/` | Planning (feature brief, SBAO) and testing methodology |
| Evaluation templates | `workflow/evaluation/` | Agent evals, CI validation, footguns/lessons templates |
| Runtime templates | `workflow/runtime/` | Layer 1 setup, enforcement patterns, architecture scaffolding |
| CLI scanner | `src/cli/` | 112 scanner checks + 19 anti-patterns (19 hidden), fragment-based prompts, multi-agent scoring |
| Dashboard | `src/cli/server/dashboard.ts` (server), `src/dashboard/` (HTML + views) | HTML dashboard with views for home, scanner, settings, wizard, workspace |
| Maintenance scripts | `scripts/maintenance/` | Repo hygiene: git cleanup, secret scanning, Zone.Identifier removal |

## Data Flow

```
User reads docs/getting-started.md
  -> Chooses agent (setup-claude.md, setup-gemini.md, setup-codex.md, or setup-copilot.md)
  -> Pastes Phase 0/1a/1b/1c/2 prompts into their agent
  -> Agent reads docs/system-spec.md (canonical reference)
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
  scanner/            # Check evaluators (evaluate-check.ts, scan.ts, custom/)
  rubric/             # Check definitions (foundation.ts, standard/, full.ts, anti-patterns.ts, registry.ts, version.ts)
  scoring/            # Score computation (calculate.ts, recommendations.ts)
  prompt/             # Prompt generation (compose-setup.ts, template-filler.ts, registry.ts, fragments/)
  render/             # Output formatters (text.ts, html.ts, json.ts, markdown.ts, guide.ts, shared.ts)
  evals/              # Agent eval parser (loader.ts, parser.ts, types.ts)
  server/             # Dashboard server (dashboard.ts, terminal.ts, types.ts)
  telemetry/          # Scan logging (scan-logger.ts)

src/dashboard/
  index.html          # Dashboard entry point
  presets.js           # Preset configurations
  views/              # Page views (home, scanner, settings, wizard, workspace)
```

## Key Constraints

- **docs/system-spec.md is canonical.** All other docs derive from or elaborate on it. Conflicts resolve in favour of the spec.
- **Cross-references are fragile.** 60+ markdown files with dense internal linking. File renames require repo-wide grep.
- **Real evidence only.** All examples, footguns, and anti-patterns must trace to real incidents with file:line references.

## Hot Path / Cold Path

Agent instruction files (CLAUDE.md, AGENTS.md, GEMINI.md) are the hot path -- loaded every turn, under 120 lines. `ai-docs/coding-standards/` is the cold path -- domain-specific coding guidelines loaded on demand via `ai-docs/README.md` router.

## Deliberate Trade-offs

- **Redundancy across docs** - The same concepts appear in multiple files (spec, layers, steps, rationale) for different audiences. This is intentional: each file serves a different reading path. The cost is maintenance burden on edits.
- **CLI validates the methodology** - The scanner (`src/cli/`) scores projects against the rubric, confirming the workflow produces measurable results. The dashboard (`goat-flow dashboard .`) serves an HTML interface for scan results and guided setup.
