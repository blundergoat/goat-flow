# Prompt: Create docs/confusion-log.md

Paste this into your coding agent to create the confusion log.

---

## The Prompt

```
Create docs/confusion-log.md for this project.

This file records where the agent (or human) got confused by the
codebase structure — areas that are hard to navigate, have unclear
ownership, or have surprising behaviour. Unlike footguns (architectural
landmines) and lessons (behavioural mistakes), confusion entries signal
areas that need better documentation or structural refactoring.

Create with this format header:

# Confusion Log

## Entries
<!-- Format: YYYY-MM-DD | Area | What was confusing | Resolution -->

## Structural Improvements
<!-- When 3+ entries point to the same area, document the structural
     improvement needed here. This section feeds into refactoring
     decisions. -->

The file starts EMPTY. Do NOT invent entries. Entries are added when
real confusion occurs during coding sessions. Example of a real entry:

2026-03-18 | auth | Unclear which module owns session validation.
SessionManager in src/auth/ creates sessions, but SessionValidator
in src/middleware/ validates them. No docs explain the split. |
Resolution: Added comment to SessionValidator explaining the
ownership boundary.

WHEN TO ADD ENTRIES:
- Agent asks "which module handles X?" and the answer isn't obvious
- Agent reads 3+ files trying to understand a flow
- Agent modifies the wrong file because ownership was unclear
- Human has to explain a non-obvious structural decision

VERIFICATION:
- Verify docs/confusion-log.md exists
- Verify it has Entries and Structural Improvements sections
- Verify it contains NO fabricated entries
```
