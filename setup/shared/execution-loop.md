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
   - CLASSIFY: complexity and mode table. Include question vs directive
     disambiguation. Complexity tiers MUST include read and turn budgets:
     Hotfix (2 reads / 3 turns), Standard (4 / 10),
     System Change (6 / 20), Infrastructure (8 / 25)
   - SCOPE: declare before acting — files allowed to change, non-goals,
     max blast radius. Expanding beyond scope = stop and re-scope
   - ACT: behaviour per mode as a table. State declaration rule.
     Mode-transition rule: "Switching to [NEW STATE] because [reason]."
     Debug mode: "No fixes until human reviews diagnosis."
     Anti-planning-loop rule. Anti-BDUF guard with BAD/GOOD example
   - VERIFY: continuous test loop. Stop-the-line with two-level
     escalation. Revert-and-rescope tactic
   - LOG: MUST update when tripped (DoD gate #4). Reference all three
     files: docs/lessons.md, docs/footguns.md, docs/confusion-log.md
     with when-to-use table. Footgun propagation rule.
     Context-based loading rules.
     Mechanical trigger: if VERIFY caught a failure in code you wrote
     this session, or you corrected course mid-task, a lessons.md
     entry is required before DoD can be satisfied.
     After human correction of agent behaviour, MUST log the lesson
     immediately — do not wait for next session.
     Dual-agent projects: learning loop files are shared. Read the
     current file before appending to avoid duplicating entries.

c) Autonomy Tiers: Always / Ask First / Never
   - Adapt Ask First boundaries for THIS project's specific risks
   - Include micro-checklist for Ask First items. MUST include:
     1. Boundary touched: [name it]
     2. Related code read: [yes/no]
     3. Footgun entry checked: [relevant entry, or "none"]
     4. Local instruction checked: [local CLAUDE.md / .github/instructions/ / none]
     5. Rollback command: [exact command]

d) Definition of Done: 6 gates

e) Working Memory: Working Notes for 5+ turn tasks, context escalation
   ladder, session handoff protocol

f) Sub-Agent Objectives: one focused objective, structured return,
   5-call budget

g) Communication When Blocked: one question with recommended default

h) Router table: MUST include at minimum:
     - All 5 skill directories (Claude/Gemini) or playbook files (Codex)
     - Learning loop files (footguns, lessons, confusion-log)
     - Architecture doc, handoff template, agent evals
     - Any playbooks, profiles, or domain docs relevant to project
     Dual-agent projects: router MUST include the other agent's
     instruction file (AGENTS.md or CLAUDE.md) and eval directory.
     (Unrouted files are invisible to the agent — 160x usage uplift
     for referenced tools)

i) Essential commands

If over line target, apply cut priority from the system spec.
If you must weaken a MUST to meet the line target, the target is
wrong — raise it, don't weaken the rule.
Do NOT skip sections (f)–(i) - they are small but required.
```
