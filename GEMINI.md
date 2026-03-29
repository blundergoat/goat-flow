# GEMINI.md - v1.0.0 (2026-03-29)

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

**VERIFY** - MUST run `shellcheck` on .sh changes. MUST check cross-references after renames. If working from a plan/milestone file, MUST tick `- [x]` on each task as it's completed — not at the end.
- Level 1 (isolated): note, continue. Level 2 (cross-doc, broken refs, evidence): MUST full stop, wait for human
- Two corrections on same approach = MUST rewind
- Recovery: missing context → read first. Out-of-scope → name boundary, redirect. Conflicting sources → flag, ask.

**LOG** - MUST update when tripped (DoD gate #4), SHOULD after routine sessions. If VERIFY caught a failure in your code, or you corrected course: lessons.md entry required before DoD. After human correction: MUST log immediately. Propagate footguns to local CLAUDE.md.

| File | When to update |
|------|---------------|
| `docs/lessons.md` | Behavioural mistake (agent did something wrong) |
| `docs/footguns.md` | Cross-doc architectural trap (with file:line evidence) |
| `docs/decisions/` | Significant technical decision with context/rationale |

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
