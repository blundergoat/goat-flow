# CLAUDE.md - v1.0.0 (2026-04-05)
GOAT Flow test fixture.

## Essential Commands
```bash
npm test
bash scripts/preflight-checks.sh
bash scripts/context-validate.sh
```

## Execution Loop: READ -> CLASSIFY -> SCOPE -> ACT -> VERIFY -> LOG

**READ** - MUST read relevant files before changes. Never fabricate codebase facts.

**CLASSIFY** - Three signals before acting: intent, complexity tiers, mode. Re-classify when work exceeds 3x estimate.
- Hotfix
- Small Feature
- Standard
- System
- Infrastructure

**SCOPE** - MUST declare before acting: files allowed to change, non-goals, max blast radius.

**ACT** - MUST declare: `State: [MODE] | Goal: [one line] | Exit: [condition]`
- Plan
- Implement
- Debug
- Review

```
BAD: guessed the spec without reading docs/system-spec.md:1
GOOD: read docs/system-spec.md:1 before changing prompts
```

```
BAD: changed workflow/skills/goat-debug.md without updating router refs
GOOD: grep old paths after every rename
```

**VERIFY** - MUST run shellcheck on `.sh` changes. MUST check cross-references after renames. Two corrections on one approach = stop.

**LOG** - MUST update when tripped. Behavioural mistakes go in `ai-docs/lessons/`. Architectural traps go in `ai-docs/footguns/`. Session summaries go in `.goat-flow/logs/sessions/`.

## Autonomy Tiers

**Always:** Read files, run validation, edit within scope.

**Ask First**
1. Boundary touched: [name]
2. Related code read: [yes/no]
3. Footgun entry checked: [entry or none]
4. Local instruction checked: [`ai-docs/README.md`, `docs/system-spec.md`, `workflow/skills/README.md`]
5. Rollback command: [exact command]

Boundaries:
- `docs/system-spec.md`
- `workflow/skills/README.md`
- `workflow/setup/shared/execution-loop.md`
- `.github/workflows/context-validation.yml`

**Never:** Delete docs without replacement, edit secrets, push to main, force push, overwrite files without checking.

## Definition of Done
1. bash scripts/preflight-checks.sh passes
2. bash scripts/context-validate.sh passes
3. No unapproved boundary changes
4. logs updated if tripped
5. handoff notes current
6. rg old pattern after rename

## Router Table
| Resource | Path |
|----------|------|
| System spec | `docs/system-spec.md` |
| Skills | `.claude/skills/` |
| Footguns | `ai-docs/footguns/`, `.goat-flow/footguns/` |
| Lessons | `ai-docs/lessons/`, `.goat-flow/lessons/` |
| Decisions | `ai-docs/decisions/` |
| Evals | `ai-docs/evals/` |
| Coding standards | `ai-docs/coding-standards/` |
| Config | `.goat-flow/config.yaml` |
| Local workspace | `.goat-flow/tasks/`, `.goat-flow/logs/` |
| Handoff | `.goat-flow/tasks/handoff-template.md` |
| Architecture | `ai-docs/architecture.md` |
