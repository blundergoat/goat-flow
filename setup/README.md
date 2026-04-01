# Setup - Install GOAT Flow

Pick your agent and follow the setup guide.

| Agent | Guide | What it creates |
|-------|-------|----------------|
| **Claude Code** | [setup-claude.md](setup-claude.md) | CLAUDE.md, .claude/hooks/, .claude/skills/, .claude/settings.json |
| **Gemini CLI** | [setup-gemini.md](setup-gemini.md) | GEMINI.md, .gemini/hooks/, .agents/skills/, .gemini/settings.json |
| **Codex** | [setup-codex.md](setup-codex.md) | AGENTS.md, .agents/skills/, .codex/rules/, scripts/ |
| **Copilot** | [setup-copilot.md](setup-copilot.md) | .github/copilot-instructions.md, .github/instructions/ |

All agents share: docs/footguns/, ai/lessons/, docs/architecture.md, .goat-flow/tasks/handoff-template.md, ai/coding-standards/

## Before you start

1. Read [shared/guidelines-audit.md](shared/guidelines-audit.md) if you have an existing guidelines file
2. `git stash` or `git commit` your current state
3. Know your stack: languages, build/test/lint/format commands

## Phases

| Phase | What it does | Required? |
|-------|-------------|-----------|
| Phase 0 | Bootstrap - minimal instruction file + deny hook | Optional (skip if doing Phase 1) |
| Phase 1a | Foundation - instruction file + docs seed files + local context | Yes |
| Phase 1b | Skills - 6 goat-flow skills | Yes |
| Phase 1c | Enforcement - hooks, deny list, CI, ignore files | Yes (each agent has its own add-ons) |
| Phase 2 | Evaluation - evals, RFC 2119 pass, CI | Yes - implement immediately after Phase 1 |
| Phase 3 | Verify - run scanner, fix checks/anti-patterns, verify tests pass | Yes |

## Shared content

Files in [shared/](shared/) are referenced by the setup guides:

- **guidelines-audit.md** - pre-setup ownership audit
- **execution-loop.md** - instruction file sections (same for every agent)
- **docs-seed.md** - learning loop and architecture files
- **phase-0.md** - bootstrap phase (minimal instruction file + deny hook)
- **phase-1.md** - foundation phase (instruction file + docs + local context)
- **phase-2.md** - evaluation layer (evals, RFC 2119, CI)
- **phase-3.md** - verification phase (scanner, anti-patterns, tests)
