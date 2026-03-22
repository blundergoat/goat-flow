# Prompt: Create /goat-test Skill

Paste this into your coding agent to create the `/goat-test` skill for your project.

---

## When to Use

After a coding milestone or every 30-60 minutes of agent work. Generates testing instructions for three parallel verification tracks based on the doer-verifier principle: the coding agent MUST NOT verify its own work.

---

## The Prompt

```
Create the /goat-test skill for this project.

## When to Use

Use when generating testing instructions for changes.

Purpose: generate testing instructions after a coding milestone or
session. The coding agent is the doer — testing uses independent
verifiers. This skill gathers context then produces instructions for
all three tracks.

Read workflow/playbooks/testing/testing-workflow.md for the full
testing methodology.

Write the skill file to: .claude/skills/goat-test/SKILL.md
(For Codex/Gemini: .agents/skills/goat-test/SKILL.md)

## Step 0 - Gather Context

Before generating anything, the skill MUST ask the user:
1. What changed? (describe the changes, or "check git diff")
2. Which milestone/task? (so Track 2 prompts reference the right scope)
3. Any areas of concern? (known fragile areas, edge cases)
4. What's the project's test stack? (test command, lint, E2E setup)

Do NOT generate a testing plan until the user has answered. If the
user says "just test everything", still ask what changed — generic
testing plans are the failure mode this skill prevents.

## Track 0 - What Changed

Summarize the changes being tested: files modified, components
affected, risk areas. This gives context before generating test
instructions.

- List every file modified with a one-line summary of the change
- Identify which components or modules are affected
- Flag risk areas: new dependencies, changed interfaces,
  security-sensitive code
- Note the verification ratio based on the autonomy tier of
  the changes

This section is the foundation — Tracks 1-3 all reference it.

## Track 1 - Automated Tests (for the agent to run)

Generate the exact commands to run, in order:
1. Preflight checks (scripts/preflight-checks.sh or stack equivalent)
2. Unit + integration tests (project's test command)
3. E2E tests (if the project has them)

For each command, state what it validates, what a failure means,
and whether it's blocking (MUST pass) or informational (SHOULD pass).

## What ISN'T Tested?

After generating Track 1, list areas the automated tests do not
cover and why:
- Not testable with current infrastructure
- Out of scope for this milestone
- Requires production data or environment
- Requires manual interaction (covered in Track 3)
- No existing test coverage for this area (flag as tech debt)

This prevents false confidence from a green test suite that misses
critical paths.

## Track 2 - AI Verification (prompts for a SEPARATE agent)

Generate two prompts to paste into a FRESH agent session (not this one).
Fill in ALL bracketed values from the user's answers — no unfilled
placeholders.

Reference specific Track 1 test failures in Track 2 prompts.
Example: "Track 1 found a race condition in auth.ts — verify this
is resolved in your manual testing."

2a. Functional verification prompt:
"Test [PROJECT] as an end user. The developer changed [CHANGES].
Focus on [AREAS]. Report anything broken, unexpected, or unclear.
Do not modify any code or files."

2b. Code review prompt:
"Review the code changes since [LAST MILESTONE]. Focus on [AREAS].
Look for regressions, security issues, logic gaps, or architectural
concerns. Do not make any code changes — review only."

Ask the user which model should run Track 2. Recommend a different
model than the coding agent for cross-model verification.

Verdict protocol — Express each AI verification result as:
- MUST — blocking: test fails without this
- SHOULD — important: flag if missing
- MAY — nice to have: note but don't block

## Track 3 - Human Testing (manual steps for the developer)

Generate numbered steps tailored to what actually changed. For each:
- What to test (specific action, not vague)
- Where to test it (browser, terminal, specific URL/page)
- What "good" looks like (expected result)
- What to look for (visual issues, UX, edge cases)

If UI changes: "Compare the screen to the previous version. Note
any visual regressions — shifted layouts, missing elements, font
or color changes, broken responsive behavior."

Mark each item as critical (must check) or nice-to-verify.

Focus on what automated tests and AI can't easily verify:
visual issues, UX flow, "this technically works but isn't what I wanted."

## HUMAN GATE

Present all three tracks. Then ask:

"Want me to (a) adjust Track 1 automated test focus, (b) refine
Track 2 AI verification prompts, (c) add Track 3 manual test items,
(d) finalize test plan?"

Do NOT auto-advance. Let the human review the test plan, drop
unnecessary items, or add edge cases before execution.

## Verification Ratio

Scale effort to the autonomy tier of the changes:
- Never / Ask First changes: 1:1 (thorough verification)
- Always changes: 1:3 (lighter verification)

Tell the user which ratio applies.

## Severity Scale

Rank test failures by priority when reporting results:

SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE

Address higher-severity failures first. A SECURITY failure blocks
the milestone regardless of how many other tests pass.

The skill MUST:
- Gather context before generating (Step 0)
- Generate all three tracks every time
- Fill in project-specific details — no unfilled [PLACEHOLDERS]
- Reference docs/footguns.md for known landmines in the changed areas

The skill MUST NOT:
- Run the tests itself (it generates instructions, not executes them)
- Verify its own work (that's the whole point of the doer-verifier split)
- Skip Track 3 (human testing catches what automation misses)
- Use generic test prompts that don't reference actual changes

VERIFICATION:
- Verify skill file exists at the correct path
- Verify Step 0 context gathering is present
- Verify all three tracks are present
- Verify Track 2 prompts are filled in with actual changes
- Verify Track 3 has project-specific manual checks

## Closing Gate

If issues found: route to goat-debug for investigation. Re-run
affected tracks after fixes.

If no issues: milestone testing gate passed. Update task status
and proceed.

## Learning Loop

If this run uncovered a lesson or footgun, update the relevant
doc before closing:
- Behavioural mistake → docs/lessons.md
- Architectural trap with file:line evidence → docs/footguns.md

## Chains With

- goat-debug — investigate test failures
- goat-plan — test plan verifies milestone acceptance criteria

## Output

Three verification tracks (automated tests, AI review prompts, human
testing checklist) plus a Milestone Gate Checklist.
```
