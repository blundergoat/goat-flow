# Architecture - GOAT Flow

## What It Is

A documentation framework that provides structured AI coding agent workflows. Not a runtime — a methodology and set of templates that users copy into their projects and run via setup prompts.

## Major Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Core docs | `docs/` | System spec, architecture descriptions, design rationale, examples |
| Setup prompts | `setup/` | Agent-specific setup instructions for Claude Code, Gemini CLI, or Codex |
| Shared setup | `setup/shared/` | Cross-agent setup fragments (execution loop, docs seed, Phase 2) |
| Skill templates | `workflow/skills/` | Reference prompts for creating the 7 goat-* skills |
| Playbook templates | `workflow/playbooks/` | Planning (feature brief → SBAO) and testing methodology |
| Evaluation templates | `workflow/evaluation/` | Agent evals, CI validation, footguns/lessons templates |
| Runtime templates | `workflow/runtime/` | Layer 1 setup, enforcement patterns, architecture scaffolding |
| Maintenance scripts | `scripts/maintenance/` | Repo hygiene: git cleanup, secret scanning, Zone.Identifier removal |
| Roadmaps | `roadmaps/` | CLI auditor spec (PLAN.md), scoring rubric (RUBRIC.md) |

## Data Flow

```
User reads docs/getting-started.md
  → Chooses agent (setup/setup-claude.md, setup/setup-gemini.md, or setup/setup-codex.md)
  → Pastes Phase 0/1a/1b/1c/2 prompts into their agent
  → Agent reads docs/system-spec.md (canonical reference)
  → Agent generates project-specific files (CLAUDE.md, hooks, skills, etc.)
```

## Key Constraints

- **No runtime code exists.** The project is 100% documentation. The CLI tool (`npx goat-flow init`) is planned for v0.2.
- **docs/system-spec.md is canonical.** All other docs derive from or elaborate on it. Conflicts resolve in favour of the spec.
- **Cross-references are fragile.** 60+ markdown files with dense internal linking. File renames require repo-wide grep.
- **Real evidence only.** All examples, footguns, and anti-patterns must trace to real incidents with file:line references.

## Deliberate Trade-offs

- **Redundancy across docs** — The same concepts appear in multiple files (spec, layers, steps, rationale) for different audiences. This is intentional: each file serves a different reading path. The cost is maintenance burden on edits.
- **No code yet** — v0.1 ships as pure documentation to validate the methodology before investing in tooling. The CLI is the highest-priority v0.2 item.
