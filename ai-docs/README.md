# Project Coding Guidelines

Read `ai-docs/coding-standards/conventions.md` first for every task.

Then load additional files based on the work:

| Task | Load |
|------|------|
| TypeScript / CLI work | `ai-docs/coding-standards/frontend.md` |
| Code review | `ai-docs/coding-standards/code-review.md` |
| Committing code | `ai-docs/coding-standards/git-commit.md` |
| Architecture overview | `ai-docs/architecture.md` |
| Technical decisions | `ai-docs/decisions/` -- ADR decision records |
| Agent evaluations | `ai-docs/evals/` -- agent evaluation scenarios |
| Known traps | `ai-docs/footguns/` -- architectural traps with file:line evidence |
| Behavioural lessons | `ai-docs/lessons/` -- lessons from real incidents |
| Domain terms | `ai-docs/glossary.md` -- term definitions for new contributors |

Precedence (highest first):
1. code-review.md (for review tasks only)
2. frontend.md (TypeScript work)
3. conventions.md (always loaded)

Only load files that exist.
