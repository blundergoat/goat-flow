# Architecture - GOAT Flow

## What It Is

A documentation framework that provides structured AI coding agent workflows. Primarily a methodology and set of templates that users copy into their projects and run via setup prompts. The CLI auditor (`src/cli/`) validates implementations against the audit checks.

## Major Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Setup prompts | `workflow/setup/` | Agent-specific setup instructions, upgrade guides |
| Setup steps | `workflow/setup/0*.md` | Six numbered setup steps (system overview, instruction file, skills, architecture + code map, customise, final verification) |
| Skill templates | `workflow/skills/` | Reference prompts for the 7 goat-flow skill templates (6 functional + 1 dispatcher) |
| Hook scripts | `workflow/hooks/` | Copyable hook scripts (deny-dangerous.sh) + per-agent config templates |
| Evaluation templates | `workflow/evaluation/` | Footguns/lessons templates |
| Docs | `docs/` | CLI usage, dashboard guide |
| CLI auditor | `src/cli/` | 16 build checks (12 setup scope + 4 agent scope) + 16 AI harness installation checks (5 concerns), audit-driven setup prompts, multi-agent support |
| Dashboard | `src/cli/server/dashboard.ts` (server), `src/dashboard/` (HTML + views) | HTML dashboard with views for critique, help, home, projects, settings, wizard, workspace |
| Maintenance scripts | `scripts/maintenance/` | Repo hygiene: git cleanup, secret scanning, Zone.Identifier removal |

## Data Flow

```
User runs `npx goat-flow setup .` or reads workflow/setup/
  -> Chooses agent (workflow/setup/agents/claude.md, workflow/setup/agents/codex.md, workflow/setup/agents/gemini.md)
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
  prompt/             # Prompt generation (compose-setup.ts, compose-critique.ts)
  audit/              # Build checks, quality checks, render.ts (output formatters: text, json, markdown)
  server/             # Dashboard server (dashboard.ts, terminal.ts, types.ts)

src/dashboard/
  index.html          # Dashboard entry point
  preset-prompts.ts    # Preset configurations
  views/              # Page views (critique, help, home, projects, settings, wizard, workspace)
```

## Key Constraints

- **Setup shared templates are canonical.** `workflow/setup/reference/execution-loop.md` defines the execution loop; `workflow/setup/01-system-overview.md` defines the layer architecture and design intent. ADRs in `.goat-flow/decisions/` capture specific design decisions.
- **Cross-references are fragile.** 60+ markdown files with dense internal linking. File renames require repo-wide grep.
- **Real evidence only.** All examples, footguns, and anti-patterns must trace to real incidents with file:line references.

## Hot Path / Cold Path

Agent instruction files (CLAUDE.md, AGENTS.md, GEMINI.md) are the hot path -- loaded every turn, under 120 lines. Skills and learning-loop files are cold path -- loaded on demand when skills or agent workflows reference them.

## Deliberate Trade-offs

- **Redundancy across docs** - The same concepts appear in multiple files (spec, layers, steps, rationale) for different audiences. This is intentional: each file serves a different reading path. The cost is maintenance burden on edits.
- **CLI validates the methodology** - The auditor (`src/cli/`) runs audit checks against projects, confirming the workflow produces measurable results. The dashboard (`goat-flow dashboard .`) serves an HTML interface for audit results and guided setup.
