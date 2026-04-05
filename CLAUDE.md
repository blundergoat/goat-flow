# CLAUDE.md - v1.0.0 (2026-04-05)
Documentation framework for AI coding agent workflows. Markdown docs + Bash scripts + TypeScript CLI scanner.
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

**CLASSIFY** - Three signals before acting: (1) Intent: question → answer it, directive → act on it. (2) Complexity (below). (3) Mode: Plan / Implement / Explain / Debug / Review.

| Complexity | Guideline | Ceremony |
|------------|-----------|----------|
| Hotfix | 1-2 files. If you need more, re-classify. | Minimal - skip goat-plan Phases 2-3, skip closing ceremony |
| Small Feature | Compressed brief (Problem/Solution/Scope/Success all at once). | Light - skip mob elaboration and triangular tension |
| Standard | No fixed cap. If reads exceed 3x your initial estimate, re-classify. | Full phases, gates at major decisions |
| System Change | No fixed cap. Same re-classification trigger. | Full phases + cross-boundary verification |
| Infrastructure | No fixed cap. Same re-classification trigger. | Full phases + rollback planning + multi-agent coordination |

Exceeding your estimate doesn't mean you're wrong - it means the task is bigger than classified. Stop, re-scope, continue.

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

**VERIFY** - MUST run `shellcheck` on .sh changes. MUST check cross-references after renames. If working from a plan/milestone file, MUST tick `- [x]` on each task as it's completed - not at the end.
- Level 1 (isolated): note, continue. Level 2 (cross-doc, broken refs, evidence): MUST full stop, wait for human
- Two corrections on same approach = MUST rewind
- Recovery: missing context → read first. Out-of-scope → name boundary, redirect. Conflicting sources → flag, ask.

**LOG** - MUST update when tripped (DoD gate #4), SHOULD after routine sessions. If VERIFY caught a failure or you corrected course: add an entry before DoD. After human correction: log immediately. Use **category bucket files** - NOT one file per incident, NOT a monolithic log.
- Lessons: `ai-docs/lessons/` category bucket files (e.g. `verification.md`, `agent-behavior.md`). Add `## Lesson: <name>` entry with `**Created:** YYYY-MM-DD` then content. Create new category file only if no existing category fits.
- Footguns: `ai-docs/footguns/` category bucket files (e.g. `hooks.md`, `scanner.md`). Add `## Footgun: <name>` entry with `**Status:** active | **Created:** YYYY-MM-DD | **Evidence:** ACTUAL_MEASURED` then content with file:line evidence.
- Local variants: `.goat-flow/lessons/` and `.goat-flow/footguns/` use same category bucket format.

| File | When to update |
|------|---------------|
| `ai-docs/lessons/` | Behavioural mistake (agent did something wrong) |
| `ai-docs/footguns/` | Cross-doc architectural trap (with file:line evidence) |
| `ai-docs/decisions/` | Significant technical decision with context/rationale |
| `.goat-flow/logs/sessions/` | End of every significant session - `YYYY-MM-DD-slug.md` summary |

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
- `docs/five-layers.md` (core architecture doc)
- `workflow/setup/` prompt changes (affects what users generate)
- `workflow/skills/` template changes (affects user skill creation)
- `docs/design-rationale.md` (evidence citations, source attributions)
- Adding, removing, or renaming any file (breaks cross-references)
- Changes spanning 3+ documentation files

**Never:** Delete docs without replacement. Modify .env/secrets. Push to main. Force push. Commit unless asked. Invent hypothetical examples. Overwrite existing files without checking destination (`ls` before `mv`/`cp`/Write; use `mv -n`)

## Definition of Done

MUST confirm ALL: (1) shellcheck passes on changed .sh files (2) no broken cross-references introduced (3) no unapproved boundary changes (4) logs updated if tripped (5) working notes current (6) grep old pattern after renames

## Hard Rules
- If file exists, modify in-place. NEVER create `_modified`, `_new`, `_backup`, `_v2` variants.
- Severity: SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE
- MUST maintain cross-file consistency: same concept, same description everywhere
- MUST preserve file:line evidence format in footguns and examples
- MUST use real incidents, never hypothetical. docs/system-spec.md is canonical source of truth
- Sub-agents: ONE objective, structured return (paths, evidence, confidence, next step), 5-call budget. Blocked → one question with recommended default.

## Working Memory
5+ turn tasks → `.goat-flow/tasks/todo.md`. Incomplete work → `.goat-flow/tasks/handoff.md`. `/compact` after 15+ turns → split → `/clear` between unrelated tasks.

## Router Table

| Resource | Path |
|----------|------|
| System spec (canonical) | `docs/system-spec.md` |
| System docs, architecture | `docs/five-layers.md`, `ai-docs/architecture.md` |
| CLI scanner/prompt code | `src/cli/` |
| Scripts | `scripts/` |
<!-- goat-flow:router:start -->
| Skills | `.claude/skills/` |
| Project guidelines | `ai-docs/README.md` |
| Footguns, lessons | `ai-docs/footguns/`, `ai-docs/lessons/` (+ `.goat-flow/` local variants) |
| Decisions, evals | `ai-docs/decisions/`, `ai-docs/evals/` |
| Coding standards | `ai-docs/coding-standards/` |
| Config | `.goat-flow/config.yaml` |
| Session logs, workspace | `.goat-flow/logs/sessions/`, `.goat-flow/tasks/` |
| Handoff | `.goat-flow/tasks/handoff-template.md` |
<!-- goat-flow:router:end -->
