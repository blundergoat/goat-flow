# Git Commit Conventions

## Commit Message Format

```
<summary of what changed and why>
```

Single-line summary. No prefix convention (no `feat:`, `fix:`, etc.). Describe the change concisely -- past commits use plain English:
- "Add CLI scanner (M1), prompt generator (M2), restructure cli/ to root"
- "Fix 12 scanner/prompt bugs, remove local context heuristic, add M2.6 plan"
- "Refactor preflight checks for improved output and structure"

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

When bumping the version, update both:
1. `package.json` `"version"` field
2. `src/cli/rubric/version.ts` `PACKAGE_VERSION` constant

Preflight checks enforce these stay in sync.
