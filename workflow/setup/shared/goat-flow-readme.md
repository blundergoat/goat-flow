# .goat-flow/

Local goat-flow runtime directory. This directory is project-specific and not shared across agents.

## Directories

| Directory | Purpose |
|-----------|---------|
| `footguns/` | Local footgun entries — traps found during sessions that haven't been promoted to `ai-docs/footguns/` yet |
| `lessons/` | Local lesson entries — behavioral mistakes found during sessions that haven't been promoted to `ai-docs/lessons/` yet |
| `tasks/` | Milestone files, plans, and working notes for multi-turn tasks. Content accumulates through real work. |
| `logs/sessions/` | Session summaries written on `/compact`, at session end, or after significant work |

## Files

| File | Purpose |
|------|---------|
| `config.yaml` | Project configuration — version, agents, paths, scanner thresholds |
| `config.local.yaml` | Local overrides (userRole, personal preferences). Gitignored. |
| `skill-conventions.md` | Shared conventions loaded by all 6 goat-flow skills at invocation |
| `README.md` | This file |

## Local vs Committed

- `ai-docs/footguns/` and `ai-docs/lessons/` are committed — shared across the team
- `.goat-flow/footguns/` and `.goat-flow/lessons/` are local — session-scoped findings not yet promoted
- Promote local entries to `ai-docs/` when they're confirmed and useful beyond one session
