# Instruction File Sections

These sections go in every project's root instruction file (CLAUDE.md, AGENTS.md, or equivalent). They are the same regardless of which agent you use.

Target: under 120 lines for all project shapes. Hard limit: 150. Use BAD/GOOD examples not prose.

---

## Required Sections

```
a) Version header (v1.0 - YYYY-MM-DD)

b) Default Execution Loop: READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG
   - READ: read relevant files first, never fabricate codebase facts
     (include BAD/GOOD example)
   - CLASSIFY: three signals before acting:
     1. Intent: question (answer it) vs directive (act on it)
     2. Complexity with read/turn budgets:
        Hotfix (2 reads / 3 turns), Standard (4 / 10),
        System Change (6 / 20), Infrastructure (8 / 25)
     3. Mode: Plan / Implement / Explain / Debug / Review
   - SCOPE: declare before acting — files allowed to change, non-goals,
     max blast radius. Expanding beyond scope = stop and re-scope
   - ACT: behaviour per mode as a table. State declaration rule.
     Mode-transition rule: "Switching to [NEW STATE] because [reason]."
     Debug mode: "No fixes until human reviews diagnosis."
     Anti-planning-loop rule. Anti-BDUF guard with BAD/GOOD example
   - VERIFY: continuous test loop. Stop-the-line with two-level
     escalation. Revert-and-rescope tactic.
     Recovery protocols: include 2-3 common failure patterns with fixes
     (e.g., missing context → read X first, out-of-scope → name boundary
     and redirect, conflicting instructions → flag and ask)
   - LOG: MUST update when tripped (DoD gate #4). Reference all four
     learning loop files:
     docs/lessons.md (behavioural mistakes),
     docs/footguns.md (architectural traps with file:line evidence),
     docs/confusion-log.md (structural navigation difficulty),
     docs/decisions/ (significant technical decisions with context/rationale).
     When-to-use table. Footgun propagation rule.
     Context-based loading rules.
     Mechanical trigger: if VERIFY caught a failure in code you wrote
     this session, or you corrected course mid-task, a lessons.md
     entry is required before DoD can be satisfied.
     After human correction of agent behaviour, MUST log the lesson
     immediately — do not wait for next session.
     Dual-agent projects: learning loop files are shared. Read the
     current file before appending to avoid duplicating entries.

c) Autonomy Tiers: Always / Ask First / Never
   - Never tier MUST include: overwrite existing files without checking
     destination (ls before mv/cp/Write; use mv -n). Data destruction
     from blind overwrites is unrecoverable for untracked files.
   - Adapt Ask First boundaries for THIS project's specific risks
   - Include micro-checklist for Ask First items. MUST include:
     1. Boundary touched: [name it]
     2. Related code read: [yes/no]
     3. Footgun entry checked: [relevant entry, or "none"]
     4. Local instruction checked: [local CLAUDE.md / .github/instructions/ / none]
     5. Rollback command: [exact command]

d) Definition of Done: 6 gates

e) Working Memory: Working Notes for 5+ turn tasks, context escalation
   ladder, session handoff protocol. Incomplete work → copy
   tasks/handoff-template.md to tasks/handoff.md and fill in.
   Next session MUST read tasks/handoff.md if it exists.
   Multi-task sessions: re-read CLAUDE.md constraints before starting.
   Context health: compact at 60% utilization (not 90%). Remove
   failed attempts and superseded reasoning before compacting (noise
   pruning). Use /clear between unrelated tasks for fresh context.
   tasks/todo.md and tasks/handoff.md MUST be gitignored.

f) Sub-Agent Objectives: one focused objective, structured return,
   5-call budget

g) Communication When Blocked: one question with recommended default

h) Router table: MUST include at minimum:
     - All 7 skill directories (Claude/Gemini/Codex: .claude/skills/, .gemini/skills/, .agents/skills/)
     - Learning loop files (footguns, lessons, confusion-log)
     - Architecture doc, handoff template, agent evals
     - Any playbooks, profiles, or domain docs relevant to project
     Dual-agent projects: router MUST include the other agent's
     instruction file (AGENTS.md or CLAUDE.md).
     (Unrouted files are invisible to the agent — 160x usage uplift
     for referenced tools)

i) Essential commands

If over line target, apply cut priority from the system spec.
If you must weaken a MUST to meet the line target, the target is
wrong — raise it, don't weaken the rule.
Do NOT skip sections (f)–(i) - they are small but required.

When sources conflict, this precedence applies:
1. User's explicit instruction (this session)
2. CLAUDE.md / AGENTS.md (always-loaded instruction file)
3. setup/shared/execution-loop.md (shared template)
4. docs/system-spec.md (canonical reference)
5. Skills / playbooks (on-demand context)
```
