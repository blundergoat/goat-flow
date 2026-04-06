# Copilot Instructions - GOAT Flow

Documentation framework for AI coding agent workflows. Markdown docs + TypeScript CLI scanner.

## Essential Commands

```bash
npm run build          # Compile TypeScript
npm test               # Run all tests
npm run typecheck      # Type-check without emitting
shellcheck scripts/*.sh scripts/maintenance/*.sh
bash scripts/preflight-checks.sh
```

## Execution Loop: READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG

The full step behavior is defined in `docs/system-spec.md`:
`READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG`.

**READ** - MUST read relevant files before changes. Never fabricate codebase facts.
**CLASSIFY** - Follow project complexity buckets and re-classify on drift (see `docs/system-spec.md`).
**SCOPE** - Declare files allowed to change, non-goals, max blast radius.
**ACT** - Declare mode (Plan/Implement/Debug) with goal and exit condition.
**VERIFY** - Run shellcheck on .sh changes. Check cross-references after renames. Two corrections on same approach = rewind.
**LOG** - Update `ai-docs/lessons/` (behavioral mistakes) or `ai-docs/footguns/` (architectural traps) when tripped.

## Autonomy Tiers

**Always:** Read any file, lint scripts, edit within assigned scope.

**Ask First:** Changes to docs/system-spec.md, workflow/setup/ prompts, workflow/skills/ templates, changes spanning 3+ files.

**Never:** Delete docs without replacement. Modify .env/secrets. Push to main. Force push.

## Definition of Done

MUST confirm ALL: (1) shellcheck passes (2) no broken cross-references (3) no unapproved boundary changes (4) logs updated if tripped (5) grep old pattern after renames.

## Working Memory

If working from a plan/milestone file, tick `- [x]` on each completed task immediately — not at the end.

## Sub-Agent Objectives

ONE objective, structured return, 5-call budget.

## Communication When Blocked

One question with recommended default.

## Router Table

| Resource | Path |
|----------|------|
| System spec | `docs/system-spec.md` |
| Project guidelines | `ai-docs/README.md` |
| Skills | `.github/skills/`, `.claude/skills/` |
| Footguns | `ai-docs/footguns/`, `.goat-flow/footguns/` |
| Lessons | `ai-docs/lessons/`, `.goat-flow/lessons/` |
| Architecture | `ai-docs/architecture.md` |
| Decisions | `ai-docs/decisions/` |
| Evals | `ai-docs/evals/` |
| Coding standards | `ai-docs/coding-standards/` |
| Config | `.goat-flow/config.yaml` |
| Local workspace | `.goat-flow/tasks/`, `.goat-flow/logs/` |
