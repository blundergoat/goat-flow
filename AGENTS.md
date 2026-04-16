# AGENTS.md - v1.1.0 (2026-04-06)
GOAT Flow documentation framework. Markdown docs + Bash validation scripts. This Codex layer supplements the existing Claude Code workflow; leave `CLAUDE.md` and `.claude/` untouched unless a task explicitly targets them.
## Essential Commands
```bash
bash scripts/preflight-checks.sh
bash workflow/validate-goat-flow-setup.sh
bash scripts/deny-dangerous.sh --self-test  # Codex: verify deny patterns registered
bash -n workflow/validate-goat-flow-setup.sh scripts/*.sh scripts/maintenance/*.sh
shellcheck workflow/validate-goat-flow-setup.sh scripts/*.sh scripts/maintenance/*.sh
npm test                                    # Run test suite
```
## Truth Order

1. User's explicit instruction (this session)
2. Instruction file (AGENTS.md)
3. Architecture (.goat-flow/architecture.md)
4. Skills / templates (on-demand context)

## Execution Loop: READ → SCOPE → ACT → VERIFY

**READ** - MUST read relevant files before changes. Never fabricate codebase facts. Cross-doc: MUST read all files describing the same concept. Check `.goat-flow/footguns/` for the target area.
```
BAD:  "The CLI has 20 audit checks" (guessed without reading)
GOOD: Read src/cli/audit/check-goat-flow.ts → 12 setup checks, check-agent-setup.ts → 4 agent checks (16 total)
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

**VERIFY** - MUST run `shellcheck` on .sh changes. MUST check cross-references after renames. If working from a plan/milestone file, MUST tick `- [x]` on each task as it's completed - not at the end.
- Level 1 (isolated): note, continue. Level 2 (cross-doc, broken refs, evidence): MUST full stop, wait for human
- Two corrections on same approach = MUST rewind
- Recovery: missing context → read first. Out-of-scope → name boundary, redirect. Conflicting sources → flag, ask.

If VERIFY caught a failure or you corrected course, update the learning loop before DoD:
- Lessons: `.goat-flow/lessons/` category bucket files (e.g. `verification.md`, `agent-behavior.md`). Add `## Lesson: <name>` entry with `**Created:** YYYY-MM-DD` then content.
- Footguns: `.goat-flow/footguns/` category bucket files (e.g. `hooks.md`, `auditor.md`). Add `## Footgun: <name>` entry with `**Status:** active | **Created:** YYYY-MM-DD | **Evidence:** ACTUAL_MEASURED` then content with file:line evidence.

| File | When to update |
|------|---------------|
| `.goat-flow/lessons/` | Behavioural mistake (agent did something wrong) |
| `.goat-flow/footguns/` | Cross-doc architectural trap (with file:line evidence) |
| `.goat-flow/decisions/` | Significant technical decision with context/rationale |
| `.goat-flow/logs/sessions/` | End of every significant session - `YYYY-MM-DD-slug.md` summary |

## Autonomy Tiers

**Always:** Read any file, run validation scripts, edit within declared scope, add Codex artifacts, update shared learning-loop files with evidence.

**Ask First** (MUST complete before proceeding):
- [ ] Boundary touched: [name]
- [ ] Related code read: [yes/no]
- [ ] Footgun entry checked: [relevant entry, or "none"]
- [ ] Local instruction checked: [.github/instructions/ / AGENTS.md / none]
- [ ] Rollback command: [exact command]

Boundaries:
- `.goat-flow/architecture.md` or primary instruction file changes (this file - `AGENTS.md`)
- `workflow/setup/` or `workflow/skills/` template changes affecting generated output
- `.github/workflows/**` (CI changes alter validation and release behavior)
- `.claude/**`, `.codex/**`, `.gemini/**`, `.agents/**` (agent runtime files)
- Other instruction files (`CLAUDE.md`, `GEMINI.md`)
- Adding, removing, or renaming files
- Changes spanning 3+ docs/scripts

**Never:** Delete docs without replacement, invent incidents or evidence, edit secrets, commit or push unless asked, run destructive git commands, claim verification passed without running it. Overwrite existing files without checking destination (`ls` before `mv`/`cp`/Write; use `mv -n`).

## Definition of Done
MUST confirm ALL: (1) shellcheck passes on changed .sh files (2) no broken cross-references introduced (3) no unapproved boundary changes (4) logs updated if tripped (5) working notes current (6) grep old pattern after renames

## Working Memory
If working from a plan/milestone file, tick `- [x]` on each completed task immediately - not at the end. If context drifts or two approaches fail, restate scope and start fresh.
Sub-agents: ONE objective, structured return (paths, evidence, confidence, next step), 5-call budget. Blocked → one question with recommended default.

## Router Table
| Resource | Path |
|----------|------|
| Architecture | `.goat-flow/architecture.md` |
| CLI auditor/prompt code | `src/cli/` |
| Scripts | `scripts/` |
| Workflow source | `workflow/` (setup, skills, hooks, evaluation) |
| Skills | `.agents/skills/` (goat, goat-debug, goat-plan, goat-review, goat-sbao, goat-security, goat-test) |
| Footguns, lessons, patterns | `.goat-flow/footguns/`, `.goat-flow/lessons/`, `.goat-flow/patterns.md` |
| Decisions | `.goat-flow/decisions/` |
| Config | `.goat-flow/config.yaml` |
| Dashboard source | `src/dashboard/` |
| Documentation | `docs/` |
| Session logs, workspace | `.goat-flow/logs/sessions/`, `.goat-flow/tasks/` |
| Peer instructions | `CLAUDE.md`, `GEMINI.md` |

## Hard Rules
- If file exists, modify in-place. NEVER create `_modified`, `_new`, `_backup`, `_v2` variants.
- Severity: SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE
- MUST maintain cross-file consistency: same concept, same description everywhere
- MUST preserve file:line evidence format in footguns and examples
- MUST use real incidents, never hypothetical. `.goat-flow/architecture.md` is canonical source of truth
- Sub-agents: ONE objective, structured return (paths, evidence, confidence, next step), 5-call budget. Blocked → one question with recommended default.
