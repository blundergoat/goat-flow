# Prompt: Create tasks/handoff-template.md

Paste this into your coding agent to create the session handoff template. Used when a coding session ends mid-task and another session (or another agent) needs to pick up where it left off.

---

## The Prompt

```
Create tasks/handoff-template.md for this project.

This is a session handoff template - used when work stops mid-task
and needs to be resumed later (by the same agent in a new session,
a different agent, or a human). The template is copied for each
handoff. The original stays as a reusable template.

Create with this structure:

# Session Handoff

## Status
<!-- In Progress / Blocked / Complete -->

## Current State
<!-- What was being worked on. Be specific:
     - Which files were modified
     - Which tests pass/fail
     - What's committed vs uncommitted
     - Where in the plan/task list work stopped -->

## Key Decisions Made
<!-- Decisions made during this session that affect future work.
     Include reasoning so the next session doesn't re-debate them.
     - [decision]: [reasoning] -->

## Known Risks
<!-- Anything the next session should watch out for.
     - [risk]: [mitigation or workaround] -->

## Next Step
<!-- The SINGLE most important thing the next session should do first.
     Be specific enough that someone with no context can start:
     "Run the test suite, fix the auth test failure in
     tests/auth.test.ts:47, then continue with task #3 in the plan." -->

## Context Files to Read
<!-- List the files the next session should read before starting:
     - [file path]: [why it matters]
     - docs/footguns.md: check for new entries from this session
     - tasks/todo.md: current task progress -->

USAGE:
When ending a session mid-task, the agent should:
1. Copy this template to tasks/handoff.md (or tasks/handoff-YYYY-MM-DD.md)
2. Fill in all sections with specifics from the current session
3. Commit the handoff file

The next session starts by reading the handoff file before doing
anything else.

VERIFICATION:
- Verify tasks/handoff-template.md exists
- Verify it has all 6 sections (Status, Current State, Key Decisions,
  Known Risks, Next Step, Context Files)
- Verify the usage instructions explain the copy-and-fill workflow
```
