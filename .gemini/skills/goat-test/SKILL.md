---
description: "Generate testing instructions across three verification tracks"
---
# /goat-test

Generate testing instructions for three parallel verification tracks. The coding agent MUST NOT verify its own work.

## When to Use

After a coding milestone or every 30-60 minutes of agent work. Produces instructions — does NOT execute tests.

## Process

### Track 1 — Automated (agent runs these)
Generate exact commands in order:
1. `bash scripts/preflight-checks.sh` (or stack equivalent)
2. Project test command
3. E2E tests (if applicable)

List what each validates and what failure means.

### Track 2 — AI Verification (prompts for a SEPARATE agent)
Generate two pre-filled prompts to paste into a fresh session:

**2a. Functional:** "Test [PROJECT] as an end user. The developer changed [CHANGES]. Focus on [AREAS]. Report anything broken. Do not modify code."

**2b. Code review:** "Review changes since [MILESTONE]. Look for regressions, security issues, logic gaps. Do not make changes — review only."

Fill in [PROJECT], [CHANGES], [AREAS], [MILESTONE] from actual session work. Recommend cross-model verification (different model than coding agent).

### Track 3 — Human Testing (manual checklist)
Generate numbered steps the developer follows:
- What to test in browser/terminal/UI
- What to look for (visual, UX, edge cases)
- Domain-specific checks only the human would know
- What "good" looks like for each item

### Verification Ratio
- Never / Ask First changes: 1:1 (thorough)
- Always changes: 1:3 (lighter)

## Constraints

- MUST generate all three tracks every time
- MUST fill in project-specific details (not generic templates)
- MUST NOT run tests itself (generates instructions only)
- MUST NOT verify its own work (doer-verifier principle)
- MUST reference docs/footguns.md for known landmines in changed areas
