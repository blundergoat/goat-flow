# Prompt: Create .github/git-commit-instructions.md

This is the universal commit instructions file for any project with `.git/`. Some tools (GitHub Copilot, Codex) look for `.github/git-commit-instructions.md` to guide commit messages. This file includes key rules inline because those tools may not follow references to other files.

---

## The Prompt

Write `.github/git-commit-instructions.md`:

```
# Commit Message Instructions

Source of truth: `ai/instructions/git-commit.md` (read that file for full details).

## Format

```
<type>: <what changed and why>
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`

## Rules

- First line under 72 characters
- Lowercase after the type prefix
- Describe what AND why, not just what
- One logical change per commit
- Add blank line + body paragraph if the "why" needs more context

## Good Examples

```
feat: add rate limiting to /api/v1/upload endpoint
fix: prevent duplicate webhook delivery on retry
refactor: extract email validation into shared util
test: add integration tests for payment flow
docs: update API authentication guide for v2 tokens
chore: bump Go to 1.22, update dependencies
ci: add PostgreSQL service to GitHub Actions test job
```

## Bad Examples

```
update code          # too vague
fix bug              # which bug?
WIP                  # don't commit work in progress
Fixed stuff          # lowercase, be specific
```

## PR Descriptions

Include in every PR:
- **What**: one sentence on what changed
- **Why**: one sentence on why
- **How**: 2-3 bullets on the approach
- **Testing**: checklist of what was tested

## Never Commit

- `.env` files with real secrets
- API keys, tokens, passwords
- Large binary files
- Generated files (check `.gitignore`)
```

Adjust the commit types and examples to match this project's conventions.
