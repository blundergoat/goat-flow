# Git Commit Conventions

Canonical repo commit instructions live in `.github/git-commit-instructions.md`
because this project has a `.github/` directory. Keep this file as a docs
mirror only.

## Commit Message Format

```
<summary of what changed and why>
```

Conventional commit format: `type(scope): description`. Use lowercase. Examples from recent git log:
- `refactor(ci): enhance CI workflow with format checks and audit validation`
- `feat(dashboard): improve projects page UX`
- `refactor(architecture): update documentation for clarity and consistency`

Multi-line body when the commit spans multiple areas. Separate summary from body with a blank line.

## Before Committing

1. `npm run typecheck` -- must pass
2. `npm test` -- must pass
3. `shellcheck scripts/maintenance/*.sh` -- must pass if .sh files changed
4. `bash scripts/preflight-checks.sh` -- full gate (runs all of the above plus version consistency, ADR enforcement)

## Branch Workflow

- `main` -- stable releases. Never push directly.
- `dev` -- active development branch. PRs go here.
- Feature branches off `dev` when working on isolated changes.

## What Not to Commit

- `dist/` (build output, gitignored)
- `node_modules/` (gitignored)
- `.claude/settings.local.json` (user-specific, gitignored)
- `.claude/projects/`, `.claude/worktrees/` (session data, gitignored)
- Files containing secrets or credentials

## Version Bumps

When bumping the version, update `package.json` `"version"` field. Package version is read from `package.json` at runtime (single source of truth).

AUDIT_VERSION derives from `package.json` automatically - no manual bump needed for check changes.
