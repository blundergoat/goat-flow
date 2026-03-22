# Copilot Instructions — GOAT Flow

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

**READ** — MUST read relevant files before changes. Never fabricate codebase facts.

**CLASSIFY** — Assess complexity: Hotfix (2 reads, 3 turns), Standard (4 reads, 10 turns), System (6 reads, 20 turns).

**SCOPE** — Declare files allowed to change, non-goals, max blast radius.

**ACT** — Declare mode (Plan/Implement/Debug) with goal and exit condition.

**VERIFY** — Run shellcheck on .sh changes. Check cross-references after renames. Two corrections on same approach = rewind.

**LOG** — Update docs/lessons.md (behavioral mistakes) or docs/footguns.md (architectural traps) when tripped.

## Autonomy Tiers

**Always:** Read any file, lint scripts, edit within assigned scope.

**Ask First:** Changes to docs/system-spec.md, setup/ prompts, workflow/skills/ templates, changes spanning 3+ files.

**Never:** Delete docs without replacement. Modify .env/secrets. Push to main. Force push.

## Definition of Done

MUST confirm ALL: (1) shellcheck passes (2) no broken cross-references (3) no unapproved boundary changes (4) logs updated if tripped (5) grep old pattern after renames.

## Working Memory

5+ turn tasks → tasks/todo.md. Incomplete work → tasks/handoff.md.

## Sub-Agent Objectives

ONE objective, structured return, 5-call budget.

## Communication When Blocked

One question with recommended default.

## Router Table

| Resource | Path |
|----------|------|
| System spec | `docs/system-spec.md` |
| Project guidelines | `ai/README.md` |
| Skills | `.claude/skills/goat-*/` |
| Footguns | `docs/footguns.md` |
| Lessons | `docs/lessons.md` |
| Architecture | `docs/architecture.md` |
| Decisions | `docs/decisions/` |
