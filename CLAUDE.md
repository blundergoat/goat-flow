# CLAUDE.md - v1.0 (2026-03-20)

Documentation framework for AI coding agent workflows. Markdown docs + Bash maintenance scripts.

## Essential Commands

```bash
shellcheck scripts/maintenance/*.sh      # Lint shell scripts
bash -n scripts/maintenance/*.sh          # Syntax-check scripts
bash scripts/preflight-checks.sh         # Full preflight gate
bash scripts/context-validate.sh         # Validate GOAT Flow structure
```

## Execution Loop: READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG

**READ** - MUST read relevant files before changes. Never fabricate codebase facts. Cross-doc: MUST read all files describing the same concept.
```
BAD:  "The spec says 100 lines for apps" (guessed without reading)
GOOD: Read docs/system-spec.md:104 → "Target 120 lines. Hard limit 150."
```

**CLASSIFY** - Three signals before acting: (1) Intent: question → answer it, directive → act on it. (2) Complexity + budgets (below). (3) Mode: Plan / Implement / Explain / Debug / Review.

| Complexity | Read budget | Turn budget |
|------------|-------------|-------------|
| Hotfix | 2 reads | 3 turns |
| Standard Feature | 4 reads | 10 turns |
| System Change | 6 reads | 20 turns |
| Infrastructure | 8 reads | 25 turns |

Over budget = re-classify before continuing.

**SCOPE** - MUST declare before acting: files allowed to change, non-goals, max blast radius. Expanding beyond scope = stop and re-scope with human.

**ACT** - MUST declare: `State: [MODE] | Goal: [one line] | Exit: [condition]`

| Mode | Behaviour |
|------|-----------|
| Plan | Produce artefact only. No file edits. Exit on LGTM |
| Implement | Edit in 2-3 turns. 4th read without writing = stop |
| Explain | Walkthrough only. No changes unless asked |
| Debug | Diagnosis with file:line first. Fixes after human reviews |
| Review | Investigate first. Never blindly apply suggestions |

```
BAD:  Created abstract template system (one format exists)
GOOD: Inline format. Extract when second format needed
```

**VERIFY** - MUST run `shellcheck` on .sh changes. MUST check cross-references after renames.
- Level 1 (isolated): note, continue. Level 2 (cross-doc, broken refs, evidence): MUST full stop, wait for human
- Two corrections on same approach = MUST rewind
- Recovery: missing context → read first. Out-of-scope → name boundary, redirect. Conflicting sources → flag, ask.

**LOG** - MUST update when tripped (DoD gate #4), SHOULD after routine sessions. If VERIFY caught a failure in your code, or you corrected course: lessons.md entry required before DoD. After human correction: MUST log immediately. Propagate footguns to local CLAUDE.md.

| File | When to update |
|------|---------------|
| `docs/lessons.md` | Behavioural mistake (agent did something wrong) |
| `docs/footguns.md` | Cross-doc architectural trap (with file:line evidence) |
| `docs/confusion-log.md` | Structural navigation difficulty |
| `docs/decisions/` | Significant technical decision with context/rationale |

## Autonomy Tiers

**Always:** Read any file, lint scripts, edit within assigned scope, append to log files

**Ask First** (MUST complete before proceeding):
- [ ] Boundary touched: [name]
- [ ] Related code read: [yes/no]
- [ ] Footgun entry checked: [relevant entry, or "none"]
- [ ] Local instruction checked: [local CLAUDE.md / .github/instructions/ / none]
- [ ] Rollback command: [exact command]

Boundaries:
- `docs/system-spec.md` changes (canonical spec, referenced everywhere)
- `docs/system/five-layers.md`, `docs/system/six-steps.md` (core architecture docs)
- `setup/` prompt changes (affects what users generate)
- `workflow/skills/` template changes (affects user skill creation)
- `docs/reference/design-rationale.md` (evidence citations, source attributions)
- Adding, removing, or renaming any file (breaks cross-references)
- Changes spanning 3+ documentation files

**Never:** Delete docs without replacement. Modify .env/secrets. Push to main. Force push. Commit unless asked. Invent hypothetical examples

## Definition of Done

MUST confirm ALL: (1) shellcheck passes on changed .sh files (2) no broken cross-references introduced (3) no unapproved boundary changes (4) logs updated if tripped (5) working notes current (6) grep old pattern after renames

## Hard Rules

- MUST maintain cross-file consistency: same concept, same description everywhere
- MUST preserve file:line evidence format in footguns and examples
- MUST use real incidents, never hypothetical. docs/system-spec.md is canonical source of truth

Sub-agents: ONE objective, structured return (paths, evidence, confidence, next step), 5-call budget. When blocked: one question with recommended default.
## Working Memory

5+ turn tasks → `tasks/todo.md`. Incomplete work → `tasks/handoff.md`. `/compact` after 15+ turns → split → `/clear` between unrelated tasks.

## Router Table

| Resource | Path |
|----------|------|
| System spec (canonical) | `docs/system-spec.md` |
| 5-layer architecture | `docs/system/five-layers.md` |
| 6-step execution loop | `docs/system/six-steps.md` |
| Reference docs | `docs/reference/` |
| Setup prompts | `setup/` |
| Skill/playbook templates | `workflow/` |
| Footguns | `docs/footguns.md` |
| Lessons | `docs/lessons.md` |
| Confusion log | `docs/confusion-log.md` |
| Architecture | `docs/architecture.md` |
| Decisions | `docs/decisions/` |
| Maintenance scripts | `scripts/maintenance/` |
| Skills | `.claude/skills/goat-*/` |
| Agent evals | `agent-evals/` |
| Codex runtime | `AGENTS.md` |
| Handoff template | `tasks/handoff-template.md` |
