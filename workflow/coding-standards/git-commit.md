# Prompt: Create git commit instructions

> **Purpose:** Git commit messages, branch naming, PR workflow
> **Generates:** `ai/instructions/git-commit.md` + `.github/git-commit-instructions.md`
> **Use when:** Setting up commit/PR conventions for the project
> **Repo inspection:** Yes — reads git log for existing commit style, branch naming, PR templates
> **Follow-on refs:** `copilot-bridge.md` if project uses GitHub Copilot

**Dual output:** The `ai/instructions/` version is the full reference. The `.github/` version includes key rules inline because some tools (Copilot, Codex) may not follow file references.

---

## The Prompt

### ai/instructions/git-commit.md (full version)

Write `ai/instructions/git-commit.md`:

````
# Git Commit Instructions

## Commit Message Format

Check `git log --oneline -20` first. If the project already uses a commit format
(Conventional Commits, Angular, ticket prefixes, plain prose), follow that format.
If no convention exists, use this default:

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

Adapt to this project's actual workflow. Check for existing PR templates (`.github/PULL_REQUEST_TEMPLATE.md`)
and merge strategy (`git log --merges -5` to see if the project squash-merges, rebase-merges, or merge-commits).

Default if no convention exists:

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
- One logical change per commit -- don't mix refactoring with features
````

Adjust the test commands, branch conventions, and merge strategy to match this project.

---

### .github/git-commit-instructions.md (bridge version)

Also write `.github/git-commit-instructions.md`:

````
# Commit Message Instructions

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
````

Adjust the commit types and examples to match this project's conventions.
