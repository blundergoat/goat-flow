# Prompt: Create ai/instructions/git-commit.md

Load this file when committing code or creating pull requests.

---

## The Prompt

Write `ai/instructions/git-commit.md`:

```
# Git Commit Instructions

## Commit Message Format

```
<type>: <what changed and why>
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`

Good examples:
```
feat: add rate limiting to /api/v1/upload endpoint
fix: prevent duplicate webhook delivery on retry
refactor: extract email validation into shared util
test: add integration tests for payment flow
docs: update API authentication guide for v2 tokens
chore: bump Go to 1.22, update dependencies
ci: add PostgreSQL service to GitHub Actions test job
```

Bad examples:
```
update code          # too vague
fix bug              # which bug?
WIP                  # don't commit work in progress
feat: Add Rate Limiting To Upload Endpoint  # not a title, use lowercase
```

Keep the first line under 72 characters. If you need more detail, add a blank line then a body paragraph.

## Branch Naming

```
<type>/<short-description>
```

Examples:
```
feat/rate-limit-upload
fix/duplicate-webhook
refactor/extract-email-validation
```

Use lowercase, hyphens between words. No issue numbers in branch names.

## PR Workflow

1. Create branch from `main`
2. Push commits (squash related changes before review)
3. Open PR as **draft** if still in progress
4. Fill in PR description (see below)
5. Request review when CI passes
6. Address review comments as new commits (don't force-push during review)
7. Squash merge to `main` after approval

## PR Description Template

```markdown
## What

[One sentence: what this PR does.]

## Why

[One sentence: why this change is needed.]

## How

[2-3 bullet points on the approach taken.]

## Testing

- [ ] Unit tests added/updated
- [ ] Manual testing done locally
- [ ] CI passes
```

## Rules

- Never commit `.env`, credentials, or API keys
- Never force-push to `main`
- Run tests locally before pushing: `npm test && go test ./...`
- One logical change per commit — don't mix refactoring with features
```

Adjust the test commands, branch conventions, and merge strategy to match this project.
