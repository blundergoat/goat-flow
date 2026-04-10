# Architecture - GOAT Flow

## What It Is

A documentation framework that provides structured AI coding agent workflows. Primarily a methodology and set of templates that users copy into their projects and run via setup prompts. The CLI scanner (`src/cli/`) validates implementations against the rubric.

## Major Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Setup prompts | `workflow/setup/` | Agent-specific setup instructions, upgrade guides, project-structure.json |
| Setup steps | `workflow/setup/0*.md` | Six numbered setup steps (system overview, instruction file, skills, architecture + code map, customise, final verification) |
| Skill templates | `workflow/skills/` | Reference prompts for the 6 goat-flow skill templates |
| Hook scripts | `workflow/hooks/` | Copyable hook scripts (deny-dangerous.sh, stop-lint.sh) + per-agent config templates |
| Playbook templates | `workflow/playbooks/` | Planning (feature brief, SBAO) and testing methodology |
| Evaluation templates | `workflow/evaluation/` | Footguns/lessons templates |
| Reference library | `workflow/reference/security/` | Security reference material used later for project-specific guidance |
| Docs | `docs/` | CLI usage, dashboard guide |
| CLI scanner | `src/cli/` | 79 scanner checks + 12 anti-patterns, fragment-based prompts, multi-agent scoring |
| Dashboard | `src/cli/server/dashboard.ts` (server), `src/dashboard/` (HTML + views) | HTML dashboard with views for home, scanner, settings, wizard, workspace |
| Maintenance scripts | `scripts/maintenance/` | Repo hygiene: git cleanup, secret scanning, Zone.Identifier removal |

## Data Flow

```
User runs `npx goat-flow setup .` or reads workflow/setup/
  -> Chooses agent (agents/claude.md, agents/codex.md, agents/gemini.md, or agents/copilot.md)
  -> Follows numbered setup steps (01-06) via their agent config
  -> Agent reads workflow/setup/ (01-system-overview.md, 02-instruction-file.md, execution-loop.md)
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
  server/             # Dashboard server (dashboard.ts, terminal.ts, types.ts)
  telemetry/          # Scan logging (scan-logger.ts)

src/dashboard/
  index.html          # Dashboard entry point
  presets.js           # Preset configurations
  views/              # Page views (home, scanner, settings, wizard, workspace)
```

## Key Constraints

- **Setup shared templates are canonical.** `workflow/setup/reference/execution-loop.md` defines the execution loop; `workflow/setup/01-system-overview.md` defines the layer architecture and design intent. ADRs in `.goat-flow/decisions/` capture specific design decisions.
- **Cross-references are fragile.** 60+ markdown files with dense internal linking. File renames require repo-wide grep.
- **Real evidence only.** All examples, footguns, and anti-patterns must trace to real incidents with file:line references.

## Hot Path / Cold Path

Agent instruction files (CLAUDE.md, AGENTS.md, GEMINI.md) are the hot path -- loaded every turn, under 120 lines. Optional local instruction files such as `.goat-flow/coding-standards/` are cold path -- loaded later on demand when a project chooses to add them.

## Deliberate Trade-offs

- **Redundancy across docs** - The same concepts appear in multiple files (spec, layers, steps, rationale) for different audiences. This is intentional: each file serves a different reading path. The cost is maintenance burden on edits.
- **CLI validates the methodology** - The scanner (`src/cli/`) scores projects against the rubric, confirming the workflow produces measurable results. The dashboard (`goat-flow dashboard .`) serves an HTML interface for scan results and guided setup.
