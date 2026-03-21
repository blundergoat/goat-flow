# Prompt: Create /goat-debug Skill

Paste this into your coding agent to create the `/goat-debug` skill for your project.

---

## The Prompt

```
Create the /goat-debug skill for this project.

When to use: when a bug or test failure needs diagnosis, especially
when the root cause is unclear or spans multiple components.

Purpose: diagnosis-first debugging. The agent gathers context, then
investigates and produces a diagnosis with evidence BEFORE proposing
any fix. This prevents the common failure mode of jumping straight
to fixing without understanding the root cause.

Write the skill file to: .claude/skills/goat-debug/SKILL.md
(For Codex/Gemini: .agents/skills/goat-debug/SKILL.md)

## Step 0 - Gather Context

Before investigating, the skill MUST ask the user:
1. What's the symptom? (error message, unexpected behaviour, test failure)
2. How do you reproduce it? (steps, command, or "it happens intermittently")
3. When did it start? (after a specific change, always been there, or unknown)
4. What have you already tried? (so the agent doesn't repeat dead ends)

Do NOT start investigating until the user has answered. If the user
says "it's broken, fix it", ask these questions first — blind
debugging is the failure mode this skill prevents.

The skill follows a strict 3-phase process:

Phase 1 - Investigate (no fixes):
- Read the actual code paths involved, tracing end-to-end
- Identify the failure point with file:line evidence
- Check related files for cross-boundary effects
- Document the chain: trigger → propagation → symptom
- Check docs/footguns.md — has this area bitten someone before?

"If you want to 'just try something' before tracing the code path,
STOP. That impulse is the failure mode this skill prevents."

Phase 2 - Report findings:
- Present diagnosis with file:line evidence for every claim
- State the root cause (not just the symptom)
- List affected files and components
- Note uncertainty: "I believe X because Y, but haven't verified Z"
- Rate confidence: High / Medium / Low

HUMAN GATE: Present the diagnosis. Ask "Does this match what you're
seeing? Should I investigate deeper, or does this look right?"
Do NOT proceed to Phase 3 until the user confirms.

Phase 3 - Propose fix (only after human reviews Phase 2):
- Propose a fix plan (not the fix itself)
- If the human disagrees, return to Phase 1
- If approved, ask: "Should I implement this fix, or do you want to?"

The skill MUST:
- Gather context before investigating (Step 0)
- Read actual code before forming hypotheses (no fabrication)
- Provide file:line evidence for every finding
- Complete Phase 2 before entering Phase 3
- Stop and wait for human review between Phase 2 and Phase 3

The skill MUST NOT:
- Skip to fixing without completing the investigation
- Fabricate file paths or line numbers
- Apply fixes without human approval of the diagnosis
- Guess at root causes without reading the code

VERIFICATION:
- Verify skill file exists at the correct path
- Verify Step 0 context gathering is present
- Verify 3-phase structure (investigate, report, propose fix)
- Verify hard gate between Phase 2 and Phase 3
- Verify output format template is included
```
