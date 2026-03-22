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
| Roadmaps | `docs/roadmaps/` | Prompt generator + scoring rubric (v0.3), cross-project learning (v0.4) |

## Data Flow

```
User reads docs/getting-started.md
  → Chooses agent (setup/setup-claude.md, setup/setup-gemini.md, or setup/setup-codex.md)
  → Pastes Phase 0/1a/1b/1c/2 prompts into their agent
  → Agent reads docs/system-spec.md (canonical reference)
  → Agent generates project-specific files (CLAUDE.md, hooks, skills, etc.)
```

## Key Constraints

- **CLI scanner and prompt generator** in `src/cli/` with 80-check rubric, fragment-based prompts, and multi-agent scoring. Dashboard planned for `src/dashboard/`.
- **docs/system-spec.md is canonical.** All other docs derive from or elaborate on it. Conflicts resolve in favour of the spec.
- **Cross-references are fragile.** 60+ markdown files with dense internal linking. File renames require repo-wide grep.
- **Real evidence only.** All examples, footguns, and anti-patterns must trace to real incidents with file:line references.

## Hot Path / Cold Path

Agent instruction files (CLAUDE.md, AGENTS.md, GEMINI.md) are the hot path -- loaded every turn, under 120 lines. `ai/instructions/` is the cold path -- domain-specific coding guidelines loaded on demand via `ai/README.md` router.

## Deliberate Trade-offs

- **Redundancy across docs** — The same concepts appear in multiple files (spec, layers, steps, rationale) for different audiences. This is intentional: each file serves a different reading path. The cost is maintenance burden on edits.
- **CLI validates the methodology** — The scanner (`src/cli/`) scores projects against the rubric, confirming the workflow produces measurable results. Dashboard and `goat-flow init` are planned next.
