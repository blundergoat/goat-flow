# Setup - Install GOAT Flow

Pick your agent and follow the setup guide.

| Agent | Guide | What it creates |
|-------|-------|----------------|
| **Claude Code** | [setup-claude.md](setup-claude.md) | CLAUDE.md, .claude/hooks/, .claude/skills/, .claude/settings.json |
| **Gemini CLI** | [setup-gemini.md](setup-gemini.md) | GEMINI.md, .gemini/hooks/, .gemini/skills/, .gemini/settings.json |
| **Codex** | [setup-codex.md](setup-codex.md) | AGENTS.md, .agents/skills/, scripts/ |

Both agents share: docs/footguns.md, docs/lessons.md, docs/architecture.md, tasks/handoff-template.md, .github/instructions/

## Before you start

1. Read [shared/guidelines-audit.md](shared/guidelines-audit.md) if you have an existing guidelines file
2. `git stash` or `git commit` your current state
3. Know your stack: build, test, lint, format commands
4. Know your project shape: App, Library, or Script Collection

## Phases

| Phase | What it does | Required? |
|-------|-------------|-----------|
| Phase 0 | Bootstrap - minimal instruction file + deny hook | Optional (skip if doing Phase 1) |
| Phase 1a | Foundation - instruction file + docs seed files + local context | Yes |
| Phase 1b | Skills - 7 goat-* skills | Yes |
| Phase 1c | Enforcement - hooks, deny list, CI, ignore files | Yes (Claude Code specific) |
| Phase 2 | Evaluation - evals, RFC 2119 pass, profiles, CI | Yes - implement immediately after Phase 1 |

## Shared content

Files in [shared/](shared/) are referenced by the setup guides:

- **guidelines-audit.md** - pre-setup ownership audit
- **execution-loop.md** - instruction file sections (same for every agent)
- **docs-seed.md** - learning loop and architecture files
- **phase-2.md** - evaluation layer (evals, RFC 2119, profiles, CI)
