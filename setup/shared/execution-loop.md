# Instruction File Sections

These sections go in every project's root instruction file (CLAUDE.md, AGENTS.md, or equivalent). They are the same regardless of which agent you use.

Target: under 120 lines for apps, 100 for libraries/collections. Use BAD/GOOD examples not prose.

---

## Required Sections

```
a) Version header (v1.0 - YYYY-MM-DD)

b) Default Execution Loop: READ → CLASSIFY → ACT → VERIFY → LOG
   - READ: read relevant files first, never fabricate codebase facts
     (include BAD/GOOD example)
   - CLASSIFY: complexity and mode table. Include question vs directive
     disambiguation
   - ACT: behaviour per mode as a table. State declaration rule.
     Anti-planning-loop rule. Anti-BDUF guard with BAD/GOOD example
   - VERIFY: continuous test loop. Stop-the-line with two-level
     escalation. Revert-and-rescope tactic
   - LOG: docs/lessons.md, docs/footguns.md, and docs/confusion-log.md
     with when-to-use table. Footgun propagation rule.
     Context-based loading rules

c) Autonomy Tiers: Always / Ask First / Never
   - Adapt Ask First boundaries for THIS project's specific risks
   - Include micro-checklist for Ask First items

d) Definition of Done: 6 gates

e) Working Memory: Working Notes for 5+ turn tasks, context escalation
   ladder, session handoff protocol

f) Sub-Agent Objectives: one focused objective, structured return,
   5-call budget

g) Communication When Blocked: one question with recommended default

h) Router table: pointers to skills, docs, playbooks, profiles

i) Essential commands

If over line target, apply cut priority from the system spec.
Do NOT skip sections (f)–(i) - they are small but required.
```
