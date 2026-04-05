# AGENTS.md - v1.0.0 (2026-04-05)
GOAT Flow documentation framework. Markdown docs + Bash validation scripts. This Codex layer supplements the existing Claude Code workflow; leave `CLAUDE.md` and `.claude/` untouched unless a task explicitly targets them.
## Essential Commands
```bash
bash scripts/preflight-checks.sh
bash scripts/context-validate.sh
bash scripts/deny-dangerous.sh --self-test
bash -n scripts/*.sh scripts/maintenance/*.sh
shellcheck scripts/*.sh scripts/maintenance/*.sh
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

**VERIFY** - MUST run `shellcheck` on .sh changes. MUST check cross-references after renames. If working from a plan/milestone file, MUST tick `- [x]` on each task as it's completed - not at the end.
- Level 1 (isolated): note, continue. Level 2 (cross-doc, broken refs, evidence): MUST full stop, wait for human
- Two corrections on same approach = MUST rewind
- Recovery: missing context → read first. Out-of-scope → name boundary, redirect. Conflicting sources → flag, ask.

**LOG** - MUST update when tripped (DoD gate #4), SHOULD after routine sessions. If VERIFY caught a failure or you corrected course: add an entry before DoD. After human correction: log immediately. Use **category bucket files** - NOT one file per incident, NOT a monolithic log.
- Lessons: `ai-docs/lessons/` category bucket files (e.g. `verification.md`, `agent-behavior.md`). Add `## Lesson: <name>` entry with `**Created:** YYYY-MM-DD` then content.
- Footguns: `ai-docs/footguns/` category bucket files (e.g. `hooks.md`, `scanner.md`). Add `## Footgun: <name>` entry with `**Status:** active | **Created:** YYYY-MM-DD | **Evidence:** ACTUAL_MEASURED` then content with file:line evidence.
- Local variants: `.goat-flow/lessons/` and `.goat-flow/footguns/` use same category bucket format.

| File | When to update |
|------|---------------|
| `ai-docs/lessons/` or `.goat-flow/lessons/` | Behavioural mistake (agent did something wrong) |
| `ai-docs/footguns/` or `.goat-flow/footguns/` | Cross-doc architectural trap (with file:line evidence) |
| `ai-docs/decisions/` | Significant technical decision with context/rationale |
| `.goat-flow/logs/sessions/` | End of every significant session - `YYYY-MM-DD-slug.md` summary |
## Autonomy Tiers
**Always:** Read any file, run validation scripts, edit within declared scope, add Codex artifacts, update shared learning-loop files with evidence.
**Ask First**
1. Boundary touched: [name]
2. Related code read: [yes/no]
3. Footgun entry checked: [relevant entry, or "none"]
4. Local instruction checked: [.github/instructions/<file> / CLAUDE.md / none]
5. Rollback command: [exact command]
- `docs/system-spec.md`, `docs/five-layers.md`, or `CLAUDE.md`
- `workflow/setup/` or `workflow/skills/` template changes affecting generated output
- `.github/workflows/` changes
- Adding, removing, or renaming files
- Changes spanning 3+ docs/scripts
- Edits to `.claude/` or other Claude-specific runtime files
**Never:** Delete docs without replacement, invent incidents or evidence, edit secrets, commit or push unless asked, run destructive git commands, claim verification passed without running it. Overwrite existing files without checking destination (`ls` before `mv`/`cp`/Write; use `mv -n`).
## Definition of Done
MUST confirm all 6 gates:
1. `bash scripts/preflight-checks.sh` passes
2. `bash scripts/context-validate.sh` passes
3. No unapproved boundary changes
4. Learning-loop files updated if tripped
5. Current state recorded before stopping incomplete work
6. Grep old pattern/path after rename, move, or terminology change
## Working Memory
For 5+ turn tasks, keep short working notes in `.goat-flow/tasks/todo.md` or the task thread. Use `.goat-flow/tasks/handoff-template.md` before ending incomplete work, then save the filled handoff to `.goat-flow/tasks/handoff.md`. If context drifts or two approaches fail, restate scope and start fresh.
Sub-agents: ONE objective, structured return (paths, evidence, confidence, next step), 5-call budget. Blocked → one question with recommended default.
## Router Table
| Resource | Path |
|----------|------|
| System spec | `docs/system-spec.md` |
| System docs | `docs/five-layers.md` |
| Architecture | `ai-docs/architecture.md` |
| Scripts | `scripts/` |
<!-- goat-flow:router:start -->
| Skills | `.agents/skills/` |
| Project guidelines | `ai-docs/README.md` |
| Footguns | `ai-docs/footguns/`, `.goat-flow/footguns/` |
| Lessons | `ai-docs/lessons/`, `.goat-flow/lessons/` |
| Decisions | `ai-docs/decisions/` |
| Evals | `ai-docs/evals/` |
| Coding standards | `ai-docs/coding-standards/` |
| Config | `.goat-flow/config.yaml` |
| Session logs | `.goat-flow/logs/sessions/` |
| Local workspace | `.goat-flow/tasks/`, `.goat-flow/logs/` |
| Handoff | `.goat-flow/tasks/handoff-template.md` |
<!-- goat-flow:router:end -->

## Hard Rules

- Severity: SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE
- MUST maintain cross-file consistency: same concept, same description everywhere
- MUST preserve file:line evidence format in footguns and examples
- MUST use real incidents, never hypothetical. docs/system-spec.md is canonical source of truth
