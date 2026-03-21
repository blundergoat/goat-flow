# AGENTS.md - v1.0 (2026-03-21)
GOAT Flow documentation framework. Markdown docs + Bash validation scripts. This Codex layer supplements the existing Claude Code workflow; leave `CLAUDE.md` and `.claude/` untouched unless a task explicitly targets them.
## Essential Commands
```bash
bash scripts/preflight-checks.sh
bash scripts/context-validate.sh
bash scripts/deny-dangerous.sh --self-test
bash -n scripts/*.sh scripts/maintenance/*.sh
shellcheck scripts/*.sh scripts/maintenance/*.sh
```
## Execution Loop: READ -> CLASSIFY -> SCOPE -> ACT -> VERIFY -> LOG
**READ** - MUST read every file that defines the concept being changed before editing. In this repo, cross-doc consistency is part of correctness.
```text
BAD:  "The spec still says 5-step" (guessed from memory)
GOOD: Read docs/system-spec.md and docs/system/six-steps.md before editing loop language
```
**CLASSIFY** - MUST declare complexity + mode before acting. Question = answer it; directive = act on it. Mode: Plan / Implement / Explain / Debug / Review.
| Complexity | Read budget | Turn budget |
|------------|-------------|-------------|
| Hotfix | 2 reads | 3 turns |
| Standard Feature | 4 reads | 10 turns |
| System Change | 6 reads | 20 turns |
| Infrastructure | 8 reads | 25 turns |
Over budget = re-classify before continuing.
**SCOPE** - MUST declare before acting: files allowed to change, systems touched, non-goals, max blast radius. Expanding beyond scope = stop and re-scope with the human.
**ACT** - MUST declare: `State: [MODE] | Goal: [one line] | Exit: [condition]`
Mode transitions: `Switching to [NEW STATE] because [reason].`
| Mode | Behaviour |
|------|-----------|
| Plan | Produce artefact only. No repo edits. Exit on LGTM |
| Implement | Edit within scope. 4th read without writing = stop exploring |
| Explain | Walkthrough only. No changes unless asked |
| Debug | Diagnosis with file:line first. No fixes until human reviews diagnosis |
| Review | Investigate independently. Never rubber-stamp suggestions |
```text
BAD:  Added a new abstraction because it "might help later"
GOOD: Keep the current shape. Extract only when the second case exists
```
**VERIFY** - MUST run `bash scripts/preflight-checks.sh` after meaningful changes. MUST grep for old paths or terms after renames/moves.
- Level 1: isolated warning or missing optional tool -> note it, continue carefully
- Level 2: broken refs, spec drift, evidence corruption, or policy-script failure -> full stop with file:line diagnosis
- Two failed approaches on the same issue = stop, report, and wait
**LOG** - MUST update when tripped (DoD gate #4). Load `docs/footguns.md` before Ask First or cross-doc work; load `docs/confusion-log.md` when routing is unclear.
- If VERIFY caught a failure in code you wrote this session, or you corrected course mid-task, a `docs/lessons.md` entry is required before DoD is satisfied.
- After human correction, MUST log immediately. Propagate confirmed footguns to the nearest routed instruction doc. Dual-agent shared files: read shared files before appending.
| File | When to update |
|------|----------------|
| `docs/lessons.md` | Behavioural mistake by the agent |
| `docs/footguns.md` | Cross-doc or cross-tool landmine with file:line evidence |
| `docs/confusion-log.md` | Structural navigation confusion |
## Autonomy Tiers
**Always:** Read any file, run validation scripts, edit within declared scope, add Codex artifacts, update shared learning-loop files with evidence.
**Ask First**
1. Boundary touched: [name]
2. Related code read: [yes/no]
3. Footgun entry checked: [relevant entry, or "none"]
4. Local instruction checked: [.github/instructions/<file> / CLAUDE.md / none]
5. Rollback command: [exact command]
- `docs/system-spec.md`, `docs/system/`, or `CLAUDE.md`
- `setup/` or `workflow/` template changes affecting generated output
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
For 5+ turn tasks, keep short working notes in the task thread or a temporary scratch file. Use `tasks/handoff-template.md` before ending incomplete work. If context drifts or two approaches fail, restate scope and start fresh.
## Sub-Agent Objectives
One focused objective, disjoint file scope, structured return: paths changed, evidence found, confidence, next step. 5-call budget.
## Communication When Blocked
Ask one question with a recommended default and exact file boundary.
## Router Table
| Resource | Path |
|----------|------|
| System spec | `docs/system-spec.md` |
| 5-layer architecture | `docs/system/five-layers.md` |
| 6-step loop | `docs/system/six-steps.md` |
| Getting started | `docs/getting-started.md` |
| Design rationale | `docs/reference/design-rationale.md` |
| Examples | `docs/reference/examples.md` |
| Cross-agent comparison | `docs/reference/cross-agent-comparison.md` |
| Claude instructions | `CLAUDE.md` |
| Claude setup | `setup/setup-claude.md` |
| Codex setup | `setup/setup-codex.md` |
| Shared execution template | `setup/shared/execution-loop.md` |
| Preflight playbook | `docs/codex-playbooks/goat-preflight.md` |
| Debug playbook | `docs/codex-playbooks/goat-debug.md` |
| Audit playbook | `docs/codex-playbooks/goat-audit.md` |
| Investigate playbook | `docs/codex-playbooks/goat-investigate.md` |
| Review playbook | `docs/codex-playbooks/goat-review.md` |
| Plan playbook | `docs/codex-playbooks/goat-plan.md` |
| Test playbook | `docs/codex-playbooks/goat-test.md` |
| Footguns | `docs/footguns.md` |
| Lessons | `docs/lessons.md` |
| Confusion log | `docs/confusion-log.md` |
| Architecture | `docs/architecture.md` |
| Preflight script | `scripts/preflight-checks.sh` |
| Context validation | `scripts/context-validate.sh` |
| Deny policy | `scripts/deny-dangerous.sh` |
| Agent evals | `agent-evals/` |
| Handoff template | `tasks/handoff-template.md` |
