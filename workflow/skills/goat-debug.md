# Prompt: Create /goat-debug Skill

Paste this into your coding agent to create the `/goat-debug` skill for your project.

---

## The Prompt

```
Create the /goat-debug skill for this project.

## When to Use

Use when diagnosing a bug or unexpected behavior — especially
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
5. How long before escalating? (default: 15 min or 10 turns — after that, present what you have even if incomplete)

Do NOT start investigating until the user has answered. If the user
says "it's broken, fix it", ask these questions first — blind
debugging is the failure mode this skill prevents.

The skill follows a strict 4-phase process:

Phase 1 - Investigate (no fixes):

RECURRENCE CHECK: Before investigating, search docs/footguns.md +
docs/lessons.md + agent-evals/ for the symptom or area. If a match
is found, present it first: "This area has a known issue: [footgun].
Is this the same problem?" Only proceed to fresh investigation after
the user confirms it's a new issue.

HYPOTHESIS TRACKING: Write 2-3 hypotheses before tracing. After
tracing, mark each as CONFIRMED, ELIMINATED, or UNRESOLVED with
evidence.

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
- Rank by severity: SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE
- Note uncertainty: "I believe X because Y, but haven't verified Z"
- Rate confidence:
  - High = reproduced with a test
  - Medium = traced with file:line evidence, not yet reproduced
  - Low = inferred from code reading

CAN'T REPRODUCE? If the bug cannot be reproduced: document what was
checked, conditions ruled out, and what information is still needed.
Don't guess — say what you know and what you don't.

HUMAN GATE: Present the diagnosis. Ask "Want me to (a) trace deeper
into a specific area, (b) check related code for cascading effects,
(c) propose a fix, or (d) check footguns for similar past issues?"
Do NOT proceed to Phase 3 until the user confirms.

Phase 3 - Propose fix (only after human reviews Phase 2):
- Propose a fix plan (not the fix itself)
- If the human disagrees, return to Phase 1
- If approved, ask: "Should I implement this fix, or do you want to?"

Phase 4 - Post-fix verification (only after human says fix is applied):
This phase activates ONLY when the human confirms a fix has been
applied. Do not enter this phase unprompted.
- Re-run the investigation trace from Phase 1
- Confirm the divergence point is resolved
- If resolved: confirm fix and note which hypothesis was correct
- If NOT resolved: report what changed and what didn't, then return to Phase 1

The skill MUST:
- Gather context before investigating (Step 0)
- Check for recurrence before fresh investigation (Phase 1)
- Read actual code before forming hypotheses (no fabrication)
- Provide file:line evidence for every finding
- Complete Phase 2 before entering Phase 3
- Stop and wait for human review between Phase 2 and Phase 3
- Only enter Phase 4 when the human says a fix was applied

The skill MUST NOT:
- Skip to fixing without completing the investigation
- Fabricate file paths or line numbers
- Apply fixes without human approval of the diagnosis
- Guess at root causes without reading the code
- Enter Phase 4 unprompted

VERIFICATION:
- Verify skill file exists at the correct path
- Verify Step 0 context gathering is present
- Verify 4-phase structure (investigate, report, propose fix, post-fix verification)
- Verify hard gate between Phase 2 and Phase 3
- Verify output format template is included

## Learning Loop

If this run uncovered a lesson or footgun, update the relevant doc
before closing:
- Behavioural mistake → docs/lessons.md
- Architectural trap with file:line evidence → docs/footguns.md

## Chains With

- goat-investigate — dig deeper into the root cause area
- goat-test — regression test after fix is applied

## Output

Structured diagnosis with symptom, hypotheses (confirmed/eliminated),
evidence chain (file:line references), severity, root cause, and
proposed fix — presented for human review before any changes.
```
