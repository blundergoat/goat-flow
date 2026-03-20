# Prompt: Fix GOAT Flow Implementation

Paste into Claude Code in any project with an existing GOAT Flow implementation to update it to the current spec.

---

## The Prompt

```
Read CLAUDE.md and AGENTS.md (if exists).

Read the CURRENT GOAT Flow spec:
- [goat-flow repo]/setup/shared/execution-loop.md
- [goat-flow repo]/docs/system-spec.md

Fix every gap in CLAUDE.md against the current spec. Check ALL of these:

EXECUTION LOOP:
- Loop MUST be 6 steps: READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG
- CLASSIFY MUST have budgets: Hotfix (2/3), Standard (4/10), System (6/20), Infra (8/25)
- ACT MUST have state declaration: "State: [MODE] | Goal: [one line] | Exit: [condition]"
- ACT MUST have mode-transition rule: "Switching to [NEW STATE] because [reason]"
- ACT Debug mode MUST say: "No fixes until human reviews diagnosis"
- LOG MUST say "MUST update when tripped (DoD gate #4), SHOULD after routine sessions"
- LOG MUST have mechanical trigger: "If VERIFY caught a failure in code you wrote, or
  you corrected course, lessons.md entry required before DoD satisfied"
- LOG MUST have human correction trigger: "After human correction, MUST log immediately"
- LOG MUST have footgun propagation rule (propagate to local CLAUDE.md)
- LOG MUST reference all 3 files: lessons.md, footguns.md, confusion-log.md
- LOG MUST have dual-agent coordination (if AGENTS.md exists): "Read shared files
  before appending"

ASK FIRST:
- MUST have explicit 5-item micro-checklist (not compressed prose):
  1. Boundary touched: [name]
  2. Related code read: [yes/no]
  3. Footgun entry checked: [relevant entry, or "none"]
  4. Local instruction checked: [local CLAUDE.md / .github/instructions/<file> / none]
  5. Rollback command: [exact command]

SECTIONS:
- (f) Sub-Agent Objectives and (g) Communication When Blocked MUST exist
- Router MUST include all 7 skill directories, learning loop files, architecture,
  handoff template, agent evals
- Dual-agent: router MUST include AGENTS.md

ENFORCEMENT:
- settings.json MUST have Read deny patterns:
  "Read(.env*)", "Read(**/secrets/**)", "Read(**/*.pem)", "Read(**/*.key)"
  Add them if missing.

AGENT EVALS:
- Each eval file MUST declare Origin: real-incident | synthetic-seed
  Add labels if missing.

CONSTRAINTS:
- CLAUDE.md MUST stay at or under 120 lines — compress if needed
- If you must weaken a MUST to meet the line target, the target is wrong —
  raise it, don't weaken the rule
- Do NOT change Ask First boundaries, DoD gates, or Essential Commands
- Do NOT modify AGENTS.md or any Codex files
- After editing, count CLAUDE.md lines and report total
- Report what you fixed and what was already compliant
```
