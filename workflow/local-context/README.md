# Prompt: Create ai/README.md

Create the cold-path router file that tells agents which instruction files to load.

---

## The Prompt

Write `ai/README.md`:

```
# Project Coding Guidelines

Read `instructions/base.md` first for every task.

Then load additional files based on the work:

| Task | Load |
|------|------|
| Frontend work | `instructions/frontend.md` |
| Backend work | `instructions/backend.md` |
| Code review | `instructions/code-review.md` |
| Committing code | `instructions/git-commit.md` |
| Security-sensitive work | `instructions/security.md` |
| Writing tests | `instructions/testing.md` |

Precedence (highest first):
1. security.md (always applies if touching auth/secrets/validation)
2. code-review.md (for review tasks only)
3. domain file (frontend/backend)
4. base.md (always loaded)

Only load files that exist. Skip rows for files not yet created.
```

Remove rows from the table for domain files that don't apply to this project.
