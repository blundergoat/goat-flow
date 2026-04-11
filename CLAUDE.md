# CLAUDE.md - v1.1.0 (2026-04-06)
Documentation framework for AI coding agent workflows. Markdown docs + Bash scripts + TypeScript CLI scanner.
## Essential Commands

```bash
shellcheck scripts/maintenance/*.sh      # Lint shell scripts
bash -n scripts/maintenance/*.sh          # Syntax-check scripts
bash scripts/preflight-checks.sh         # Full preflight gate
bash scripts/validate-goat-flow-setup.sh         # Validate GOAT Flow structure
```
## Execution Loop: READ → SCOPE → ACT → VERIFY

**READ** - MUST read relevant files before changes. Never fabricate codebase facts. Cross-doc: MUST read all files describing the same concept.
```
BAD:  "The spec says 100 lines for apps" (guessed without reading)
GOOD: Read workflow/setup/reference/execution-loop.md:3 → "Target: under 120 lines. Hard limit: 150."
```

**SCOPE** - Three signals before acting: (1) Intent: question → answer it, directive → act on it. (2) Complexity + budgets (below). (3) Mode: Plan / Implement / Explain / Debug / Review. MUST declare before acting: files allowed to change, non-goals, max blast radius. Expanding beyond scope = stop and re-scope with human.

| Complexity | Read budget | Turn budget |
|------------|-------------|-------------|
| Hotfix | 2 reads | 3 turns |
| Standard Feature | 4 reads | 10 turns |
| System Change | 6 reads | 20 turns |
| Infrastructure | 8 reads | 25 turns |

Over budget = re-classify before continuing.

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

If VERIFY caught a failure or you corrected course, update the learning loop before DoD:
- Lessons: `.goat-flow/lessons/` category bucket files (e.g. `verification.md`, `agent-behavior.md`). Add `## Lesson: <name>` entry with `**Created:** YYYY-MM-DD` then content.
- Footguns: `.goat-flow/footguns/` category bucket files (e.g. `hooks.md`, `scanner.md`). Add `## Footgun: <name>` entry with `**Status:** active | **Created:** YYYY-MM-DD | **Evidence:** ACTUAL_MEASURED` then content with file:line evidence.

| File | When to update |
|------|---------------|
| `.goat-flow/lessons/` | Behavioural mistake (agent did something wrong) |
| `.goat-flow/footguns/` | Cross-doc architectural trap (with file:line evidence) |
| `.goat-flow/decisions/` | Significant technical decision with context/rationale |
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
- `workflow/setup/` prompt changes (affects what users generate)
- `workflow/skills/` template changes (affects user skill creation)
- `.goat-flow/architecture.md` (core architecture doc)
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
- MUST use real incidents, never hypothetical. `.goat-flow/architecture.md` is canonical source of truth
- Sub-agents: ONE objective, structured return (paths, evidence, confidence, next step), 5-call budget. Blocked → one question with recommended default.

## Working Memory
If working from a plan/milestone file, tick `- [x]` on each completed task immediately - not at the end. `/compact` after 15+ turns → split → `/clear` between unrelated tasks.

## Router Table

| Resource | Path |
|----------|------|
| Architecture | `.goat-flow/architecture.md` |
| CLI scanner/prompt code | `src/cli/` |
| Scripts | `scripts/` |
| Skills | `.claude/skills/` |
| Footguns, lessons | `.goat-flow/footguns/`, `.goat-flow/lessons/` |
| Decisions | `.goat-flow/decisions/` |
| Config | `.goat-flow/config.yaml` |
| Session logs, workspace | `.goat-flow/logs/sessions/`, `.goat-flow/tasks/` |
