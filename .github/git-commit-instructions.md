# Git Commit Instructions

## Commit Message Format

Use conventional commit format: `type(scope): description`. Keep the summary
lowercase and describe what changed and why.

Examples from recent git log:
- `refactor(ci): enhance CI workflow with format checks and audit validation`
- `feat(dashboard): improve projects page UX`
- `refactor(architecture): update documentation for clarity and consistency`

Use a multi-line body when the commit spans multiple areas. Separate the summary
from the body with a blank line.

## Before Committing

1. `npm run typecheck` must pass.
2. `npm test` must pass.
3. `shellcheck scripts/maintenance/*.sh` must pass if `.sh` files changed.
4. `bash scripts/preflight-checks.sh` must pass.

## Branch Workflow

- `main` is for stable releases. Never push directly.
- `dev` is the active development branch. PRs go here.
- Feature branches should branch from `dev` for isolated changes.

## What Not To Commit

- `dist/`
- `node_modules/`
- `.claude/settings.local.json`
- `.claude/projects/`
- `.claude/worktrees/`
- Files containing secrets or credentials

## Version Bumps

When bumping the version, update `package.json` `"version"`. `AUDIT_VERSION`
derives from `package.json` automatically.
