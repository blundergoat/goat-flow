# Copilot Instructions - GOAT Flow

Documentation framework for AI coding agent workflows. Markdown docs + TypeScript CLI auditor.

## Essential Commands

```bash
npm run build          # Compile TypeScript
npm test               # Run all tests
npm run typecheck      # Type-check without emitting
shellcheck scripts/*.sh scripts/maintenance/*.sh
bash scripts/preflight-checks.sh
```

## Execution Loop: READ → SCOPE → ACT → VERIFY

**READ** - MUST read relevant files before changes. Never fabricate codebase facts. Cross-doc: MUST read all files describing the same concept.

**SCOPE** - Three signals before acting: (1) Intent: question → answer it, directive → act on it. (2) Complexity + budgets. (3) Mode: Plan / Implement / Explain / Debug / Review. MUST declare before acting: files allowed to change, non-goals, max blast radius.

**ACT** - MUST declare: `State: [MODE] | Goal: [one line] | Exit: [condition]`

**VERIFY** - Run shellcheck on .sh changes. Check cross-references after renames. Two corrections on same approach = rewind. If VERIFY catches a failure, update `.goat-flow/lessons/` (behavioral mistakes) or `.goat-flow/footguns/` (architectural traps).

## Autonomy Tiers

**Always:** Read any file, lint scripts, edit within assigned scope.

**Ask First:** Changes to .goat-flow/architecture.md, workflow/setup/ prompts, workflow/skills/ templates, changes spanning 3+ files.

**Never:** Delete docs without replacement. Modify .env/secrets. Push to main. Force push.

## Definition of Done

MUST confirm ALL: (1) shellcheck passes (2) no broken cross-references (3) no unapproved boundary changes (4) logs updated if tripped (5) grep old pattern after renames.

## Working Memory

If working from a plan/milestone file, tick `- [x]` on each completed task immediately - not at the end.

## Sub-Agent Objectives

ONE objective, structured return, 5-call budget.

## Communication When Blocked

One question with recommended default.

## Router Table

| Resource | Path |
|----------|------|
| Architecture | `.goat-flow/architecture.md` |
| Skills | `.github/skills/`, `.claude/skills/` |
| Footguns, lessons | `.goat-flow/footguns/`, `.goat-flow/lessons/` |
| Decisions | `.goat-flow/decisions/` |
| Config | `.goat-flow/config.yaml` |
| Session logs, workspace | `.goat-flow/logs/sessions/`, `.goat-flow/tasks/` |
