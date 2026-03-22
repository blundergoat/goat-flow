# Git Commit Instructions

<!-- Source: ai/instructions/git-commit.md — keep in sync -->

## Commit Message Format

```
<action> <scope>: <description>

<body — what and why, not how>
```

**Good:**
```
Add local instruction scanner checks (2.6.1-2.6.6)
Fix line count off-by-one in facts/agent.ts
Remove confusion-log from workflow (ADR-003)
Update setup guides with cold path creation
```

**Bad:**
```
update stuff
fixes
WIP
minor changes
```

## Rules

- Imperative mood: "Add" not "Added" or "Adds"
- First line under 72 characters
- Reference ADRs when making architectural decisions
- Reference milestone numbers when completing planned work
- Don't commit `.env`, `settings.local.json`, or `node_modules/`

## Branch Naming

```
feature/<description>     # New functionality
fix/<description>         # Bug fix
docs/<description>        # Documentation only
refactor/<description>    # Code change that doesn't fix a bug or add a feature
```

## PR Workflow

1. Create branch from `dev`
2. Make changes, run `scripts/preflight-checks.sh`
3. Push to remote, create PR against `dev`
4. PR description: summary + what changed + how to test
5. Merge after review (squash preferred for clean history)
