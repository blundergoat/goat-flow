# GEMINI.md - v1.0 (2026-03-20)

Documentation framework for AI coding agent workflows. Markdown docs + Bash maintenance scripts.

## Essential Commands

```bash
shellcheck scripts/maintenance/*.sh      # Lint shell scripts
bash -n scripts/maintenance/*.sh          # Syntax-check scripts
bash scripts/preflight-checks.sh         # Full preflight gate
bash scripts/context-validate.sh         # Validate GOAT Flow structure
```

## Truth Order

1. User's explicit instruction (this session)
2. Instruction file (GEMINI.md)
3. Shared setup templates (setup/shared/)
4. System spec (docs/system-spec.md)
5. Skills / playbooks (on-demand context)

## Execution Loop: READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG

**READ** - MUST read relevant files first. Never fabricate. Cross-doc: read all files for same concept.
```
BAD:  "The spec says 100 lines for apps" (guessed without reading)
GOOD: Read docs/system-spec.md:104 -> "Target 120 lines. Hard limit 150."
```

**CLASSIFY** - MUST declare three signals before acting:
1. Intent: question (answer it) vs directive (act on it)
2. Complexity: Hotfix (2 reads / 3 turns), Standard (4 / 10), System (6 / 20), Infra (8 / 25)
3. Mode: Plan / Implement / Explain / Debug / Review

**SCOPE** - MUST declare: files allowed to change, non-goals, max blast radius. Expanding = STOP and re-scope.

**ACT** - MUST declare: `State: [MODE] | Goal: [one line] | Exit: [condition]`.
Mode-transition rule: "Switching to [NEW STATE] because [reason]."
Debug: No fixes until human reviews diagnosis with file:line evidence.
Anti-BDUF: Extract interface ONLY when second provider needed.

**VERIFY** - Run tests after each code change. Stop-the-line: isolated (note); cross-boundary/security (FULL STOP). Revert-and-rescope: git revert + rescope after 2 failed attempts. If working from a plan/milestone: tick `- [x]` on each task as completed — not at the end.
Recovery: (a) missing context -> read X; (b) out-of-scope -> re-scope; (c) conflict -> ask.

**LOG** - MUST update when tripped (DoD gate #4). Mechanical trigger: required if VERIFY caught your code failure or you corrected course mid-task. Human correction: MUST log lesson immediately.
Reference all 3: docs/lessons.md, docs/footguns.md, docs/decisions/.

## Autonomy Tiers

**Always:** Read any file, lint scripts, edit within assigned scope, append to log files.

**Ask First** (MUST complete before proceeding):
- [ ] Boundary touched: [name]
- [ ] Related code read: [yes/no]
- [ ] Footgun entry checked: [relevant entry, or "none"]
- [ ] Local instruction checked: [local GEMINI.md / .github/instructions/ / none]
- [ ] Rollback command: [exact command]

Boundaries: `docs/system-spec.md`, `docs/system/`, `setup/`, `workflow/skills/`, `docs/reference/design-rationale.md`, renaming/moving files, 3+ doc file changes.

**Never:** Delete docs without replacement. Modify secrets/.env. Push to main. Change security config. Overwrite existing files without checking destination (`ls` before `mv`/`cp`/Write; use `mv -n`)

## Definition of Done

MUST confirm ALL: (1) shellcheck passes (2) no broken cross-refs (3) no unapproved boundary changes (4) logs updated if tripped (5) working notes current (6) grep old pattern after renames.

Sub-agents: ONE objective, structured return, 5-call budget. When blocked: one question + default.

## Hard Rules

- Severity: SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE
- MUST maintain cross-file consistency: same concept, same description everywhere
- MUST preserve file:line evidence format in footguns and examples
- MUST use real incidents, never hypothetical. docs/system-spec.md is canonical source of truth

## Working Memory

5+ turns -> `tasks/todo.md`. Handoff -> `tasks/handoff.md` (read if exists).
Context health: compact at 60% util. Noise pruning before compacting. `/clear` between unrelated tasks.

## Router Table

| Target | Path |
|--------|------|
| **Skills** | `.agents/skills/goat-{security,debug,audit,investigate,review,plan,test}` |
| **Playbooks** | `workflow/playbooks/` |
| **Learning** | `docs/{lessons,footguns}.md`, `docs/decisions/` |
| **Architecture** | `docs/architecture.md` |
| **Handoff** | `tasks/handoff-template.md` |
| **Evals** | `agent-evals/` |
| **Other Agents** | `CLAUDE.md`, `AGENTS.md` |
