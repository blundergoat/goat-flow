# CLAUDE.md - v1.0 (2026-03-20)

Documentation framework for AI coding agent workflows. Markdown docs + Bash maintenance scripts.

## Essential Commands

```bash
shellcheck scripts/maintenance/*.sh      # Lint shell scripts
bash -n scripts/maintenance/*.sh          # Syntax-check scripts
```

## Execution Loop: READ → CLASSIFY → ACT → VERIFY → LOG

**READ** - MUST read relevant files before changes. Never fabricate codebase facts. Cross-doc: MUST read all files describing the same concept.
```
BAD:  "The spec says 100 lines for apps" (guessed without reading)
GOOD: Read docs/system-spec.md:104 → "Target 100 (libraries) to 120 (apps)"
```

**CLASSIFY** - MUST declare complexity (Hotfix / Standard Feature / System Change / Infrastructure) and mode (Plan/Implement/Explain/Debug/Review) before acting. Question = answer it; directive = act on it. MUST NOT infer implementation from a question.

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

**VERIFY** - MUST run `shellcheck` on changed .sh files. MUST check cross-references after renaming/moving files.
- Level 1 (isolated): note, continue
- Level 2 (cross-doc inconsistency, broken refs, evidence corruption): MUST full stop, file:line diagnosis, wait for human
- Two corrections on same approach = MUST rewind

**LOG** - SHOULD update the appropriate learning loop file. Footguns mapped to specific directories: propagate one-line summary to local CLAUDE.md.

| File | When to update |
|------|---------------|
| `docs/lessons.md` | Behavioural mistake (agent did something wrong) |
| `docs/footguns.md` | Cross-doc architectural trap (with file:line evidence) |
| `docs/confusion-log.md` | Structural navigation difficulty |

## Autonomy Tiers

**Always:** Read any file, lint scripts, edit within assigned scope, append to log files

**Ask First** (MUST: name boundary, confirm related files read, check footguns, state rollback command):
- `docs/system-spec.md` changes (canonical spec, referenced everywhere)
- `docs/five-layers.md`, `docs/five-steps.md` (core architecture docs)
- `setup/` prompt changes (affects what users generate)
- `workflow/skills/` template changes (affects user skill creation)
- `docs/design-rationale.md` (evidence citations, source attributions)
- Adding, removing, or renaming any file (breaks cross-references)
- Changes spanning 3+ documentation files

**Never:** Delete docs without replacement. Modify .env/secrets. Push to main. Force push. Commit unless asked. Invent hypothetical examples (all must trace to real incidents)

## Definition of Done

MUST confirm ALL: (1) shellcheck passes on changed .sh files (2) no broken cross-references introduced (3) no unapproved boundary changes (4) logs updated if tripped (5) working notes current (6) grep old pattern after renames

## Hard Rules

- MUST maintain cross-file consistency: same concept, same description everywhere
- MUST preserve file:line evidence format in footguns and examples
- MUST use real incidents for all examples, never hypothetical
- MUST keep docs/system-spec.md as canonical source of truth

Sub-agents: ONE focused objective, structured return (paths, evidence, confidence, next step), 5-call budget.
When blocked: ask one question with recommended default.

## Working Memory

SHOULD use `tasks/todo.md` for 5+ turn tasks. SHOULD write `tasks/handoff.md` before ending incomplete work. `/compact` after 15+ turns → split if two compactions → `/clear` between unrelated tasks.

## Router Table

| Resource | Path |
|----------|------|
| System spec (canonical) | `docs/system-spec.md` |
| 5-layer architecture | `docs/five-layers.md` |
| 5-step execution loop | `docs/five-steps.md` |
| Design rationale | `docs/design-rationale.md` |
| Getting started | `docs/getting-started.md` |
| Real examples | `docs/examples.md` |
| Setup - Claude Code | `setup/setup-claude.md` |
| Setup - Codex | `setup/setup-codex.md` |
| Skill templates | `workflow/skills/` |
| Playbooks | `workflow/playbooks/` |
| Evaluation templates | `workflow/evaluation/` |
| Footguns | `docs/footguns.md` |
| Lessons | `docs/lessons.md` |
| Architecture | `docs/architecture.md` |
| Maintenance scripts | `scripts/maintenance/` |
| Preflight skill | `.claude/skills/goat-preflight/` |
| Debug skill | `.claude/skills/goat-debug/` |
| Audit skill | `.claude/skills/goat-audit/` |
| Research skill | `.claude/skills/goat-research/` |
| Review skill | `.claude/skills/goat-review/` |
| Agent evals | `agent-evals/` |
| Handoff template | `tasks/handoff-template.md` |
