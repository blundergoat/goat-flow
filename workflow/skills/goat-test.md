# Prompt: Create /goat-test Skill

Paste this into your coding agent to create the `/goat-test` skill for your project.

---

## When to Use

After a coding milestone or every 30-60 minutes of agent work. Generates testing instructions for three parallel verification tracks based on the doer-verifier principle: the coding agent MUST NOT verify its own work.

---

## The Prompt

```
Create the /goat-test skill for this project.

Purpose: generate testing instructions after a coding milestone or
session. The coding agent is the doer — testing uses independent
verifiers. This skill produces instructions for all three tracks,
not the tests themselves.

Write the skill file to: .claude/skills/goat-test/SKILL.md
(For Codex: .agents/skills/goat-test/SKILL.md)

The skill produces testing instructions across three tracks:

## Track 1 - Automated Tests (for the agent to run)

Generate the exact commands to run, in order:
1. Preflight checks (scripts/preflight-checks.sh or stack equivalent)
2. Unit + integration tests (project's test command)
3. E2E tests (if the project has them)
4. Accuracy/scenario tests (if applicable)

List what each command validates and what a failure means.

## Track 2 - AI Verification (prompts for a SEPARATE agent)

Generate two prompts to paste into a FRESH agent session (not this one):

2a. Functional verification prompt:
"Test [PROJECT] as an end user. The developer changed [CHANGES].
Focus on [AREAS]. Report anything broken, unexpected, or unclear.
Do not modify any code or files."

2b. Code review prompt:
"Review the code changes since [LAST MILESTONE]. Focus on [AREAS].
Look for regressions, security issues, logic gaps, or architectural
concerns. Do not make any code changes — review only."

Fill in [PROJECT], [CHANGES], [AREAS], [LAST MILESTONE] based on
what was actually changed in this session.

Recommend cross-model verification: if the coding agent is Claude,
suggest Codex or Gemini for Track 2. Different models catch different
blind spots.

## Track 3 - Human Testing (manual steps for the developer)

Generate a numbered checklist the developer can follow manually:
- What to test in the browser/terminal/UI
- What to look for (visual correctness, UX flow, edge cases)
- Domain-specific checks only the human would know
- What "good" looks like for each item

Focus on what automated tests and AI can't easily verify:
visual issues, UX flow, "this technically works but isn't what I wanted."

## Verification Ratio

Scale effort to the autonomy tier of the changes:
- Never / Ask First changes: 1:1 (thorough verification)
- Always changes: 1:3 (lighter verification)

The skill MUST:
- Generate all three tracks every time
- Fill in project-specific details (commands, file paths, areas changed)
- Base Track 2 prompts on ACTUAL changes made, not generic templates
- Scale Track 3 depth to the risk level of the changes
- Reference docs/footguns.md for known landmines in the changed areas

The skill MUST NOT:
- Run the tests itself (it generates instructions, not executes them)
- Verify its own work (that's the whole point of the doer-verifier split)
- Skip Track 3 (human testing catches what automation misses)
- Use generic test prompts that don't reference actual changes

Output format:

  ## Testing Plan: [milestone/session description]

  ### Track 1 — Automated
  [exact commands to run, one per line]
  Expected: [what passing looks like]

  ### Track 2 — AI Verification
  Paste into a fresh [recommended model] session:

  2a. Functional:
  [filled-in prompt]

2b. Code review:
> [filled-in prompt]

### Track 3 — Human Testing
- [ ] [specific manual check]
- [ ] [specific manual check]
- [ ] [specific manual check]

### Verification Ratio
[1:1 or 1:3 based on autonomy tier of changes]

VERIFICATION:
- Verify skill file exists at the correct path
- Verify all three tracks are present
- Verify Track 2 prompts are filled in with actual changes
- Verify Track 3 has project-specific manual checks
```
