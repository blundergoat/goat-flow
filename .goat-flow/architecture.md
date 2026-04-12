# Architecture - GOAT Flow

## What It Is

A documentation framework that provides structured AI coding agent workflows. Primarily a methodology and set of templates that users copy into their projects and run via setup prompts. The CLI auditor (`src/cli/`) validates implementations against the rubric.

## Major Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Setup prompts | `workflow/setup/` | Agent-specific setup instructions, upgrade guides, project-structure.json |
| Setup steps | `workflow/setup/0*.md` | Six numbered setup steps (system overview, instruction file, skills, architecture + code map, customise, final verification) |
| Skill templates | `workflow/skills/` | Reference prompts for the 7 goat-flow skill templates (6 functional + 1 dispatcher) |
| Hook scripts | `workflow/hooks/` | Copyable hook scripts (deny-dangerous.sh) + per-agent config templates |
| Templates | `workflow/templates/` | Standalone prompt templates for planning (feature brief, milestones, SBAO) and refactoring |
| Evaluation templates | `workflow/evaluation/` | Footguns/lessons templates |
| Reference library | `workflow/reference/security/` | Security reference material used later for project-specific guidance |
| Docs | `docs/` | CLI usage, dashboard guide |
| CLI auditor | `src/cli/` | 79 rubric checks + 12 anti-patterns (internal scoring), 15 build + 15 quality checks (public audit), fragment-based prompts, multi-agent support |
| Dashboard | `src/cli/server/dashboard.ts` (server), `src/dashboard/` (HTML + views) | HTML dashboard with views for audit, critique, help, home, projects, rubrics, settings, wizard, workspace |
| Maintenance scripts | `scripts/maintenance/` | Repo hygiene: git cleanup, secret scanning, Zone.Identifier removal |

## Data Flow

```
User runs `npx goat-flow setup .` or reads workflow/setup/
  -> Chooses agent (workflow/setup/agents/claude.md, workflow/setup/agents/codex.md, workflow/setup/agents/gemini.md)
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
  scanner/            # Internal scoring engine (evaluate-check.ts, scan.ts)
  rubric/             # Check definitions (foundation.ts, standard/, anti-patterns.ts, registry.ts, version.ts)
  scoring/            # Score computation (calculate.ts, recommendations.ts)
  prompt/             # Prompt generation (compose-setup.ts, template-filler.ts, registry.ts, fragments/)
  render/             # Output formatters (text.ts, html.ts, json.ts, markdown.ts, guide.ts, shared.ts)
  server/             # Dashboard server (dashboard.ts, terminal.ts, types.ts)
  telemetry/          # Audit logging

src/dashboard/
  index.html          # Dashboard entry point
  preset-prompts.js    # Preset configurations
  views/              # Page views (audit, critique, help, home, projects, rubrics, settings, wizard, workspace)
```

## Key Constraints

- **Setup shared templates are canonical.** `workflow/setup/reference/execution-loop.md` defines the execution loop; `workflow/setup/01-system-overview.md` defines the layer architecture and design intent. ADRs in `.goat-flow/decisions/` capture specific design decisions.
- **Cross-references are fragile.** 60+ markdown files with dense internal linking. File renames require repo-wide grep.
- **Real evidence only.** All examples, footguns, and anti-patterns must trace to real incidents with file:line references.

## Hot Path / Cold Path

Agent instruction files (CLAUDE.md, AGENTS.md, GEMINI.md) are the hot path -- loaded every turn, under 120 lines. Optional local instruction files (`.github/instructions/`) are cold path -- loaded later on demand when a project chooses to add them.

## Deliberate Trade-offs

- **Redundancy across docs** - The same concepts appear in multiple files (spec, layers, steps, rationale) for different audiences. This is intentional: each file serves a different reading path. The cost is maintenance burden on edits.
- **CLI validates the methodology** - The auditor (`src/cli/`) scores projects against the rubric, confirming the workflow produces measurable results. The dashboard (`goat-flow dashboard .`) serves an HTML interface for audit results and guided setup.
