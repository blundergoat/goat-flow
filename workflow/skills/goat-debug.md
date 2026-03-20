# Prompt: Create /goat-debug Skill

Paste this into your coding agent to create the `/goat-debug` skill for your project.

---

## The Prompt

```
Create the /goat-debug skill for this project.

When to use: when a bug or test failure needs diagnosis, especially
when the root cause is unclear or spans multiple components.

Purpose: diagnosis-first debugging. The agent investigates a bug or test
failure and produces a diagnosis with evidence BEFORE proposing any fix.
This prevents the common failure mode of the agent jumping straight to
fixing without understanding the root cause.

Write the skill file to: .claude/skills/goat-debug/SKILL.md
(For Codex: docs/codex-playbooks/goat-debug.md)

The skill follows a strict 3-phase process:

Phase 1 - Investigate (no fixes):
- Read the actual code paths involved, tracing end-to-end
- Identify the failure point with file:line evidence
- Check related files for cross-boundary effects
- Document the chain: trigger → propagation → symptom

Phase 2 - Report findings:
- Write diagnosis with file:line evidence for every claim
- State the root cause (not just the symptom)
- List affected files and components
- Note any uncertainty: "I believe X because Y, but haven't verified Z"

Phase 3 - Propose fix (only after human reviews Phase 2):
- Wait for human to review the diagnosis
- Only then propose a fix plan
- If the human disagrees with the diagnosis, return to Phase 1

The skill MUST:
- Read actual code before forming hypotheses (no fabrication)
- Provide file:line evidence for every finding
- Complete Phase 2 before entering Phase 3
- Stop and wait for human review between Phase 2 and Phase 3

The skill MUST NOT:
- Skip to fixing without completing the investigation
- Fabricate file paths or line numbers
- Apply fixes without human approval of the diagnosis
- Guess at root causes without reading the code

Output format:
## Investigation: [bug/failure description]

### Root Cause
[One sentence with file:line reference]

### Evidence Trail
1. [file:line] - [what this code does and why it matters]
2. [file:line] - [how the failure propagates]
3. [file:line] - [where the symptom appears]

### Affected Components
- [component] - [how it's affected]

### Confidence
[High/Medium/Low] - [what's verified vs what's hypothesised]

### Proposed Fix (pending human review)
[Fix plan - only populated after human approves the diagnosis]

VERIFICATION:
- Verify skill file exists at the correct path
- Verify 3-phase structure (investigate, report, propose fix)
- Verify hard gate between Phase 2 and Phase 3
- Verify output format template is included
```
