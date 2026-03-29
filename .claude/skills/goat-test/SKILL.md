---
name: goat-test
description: "Generate testing instructions across three verification tracks"
goat-flow-skill-version: "0.9.0"
---
# /goat-test

## Shared Conventions

- **Severity:** SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE
- **Evidence:** Every finding needs `file:line`. Tag as OBSERVED (verified) or INFERRED (state what's missing). MUST NOT fabricate.
- **Gates:** BLOCKING GATE = must stop for human. CHECKPOINT = report status, continue unless interrupted.
- **Adaptive Step 0:** If context already provided, confirm it — don't re-ask. Only hard-block with zero context.
- **Stuck:** 3 reads with no signal → present what you have, ask to redirect.
- **Learning Loop:** Behavioural mistake → `docs/lessons.md`. Architectural trap → `docs/footguns.md`.
- **Closing:** If incomplete → write `tasks/handoff.md`. Check learning loop. Suggest next skill. If `tasks/logs/` exists → write session summary.

## When to Use

After a coding milestone or every 30-60 minutes of agent work. Generates testing instructions for three parallel verification tracks based on the doer-verifier principle: the coding agent MUST NOT verify its own work.

Generate testing instructions for three parallel verification tracks. The coding agent MUST NOT verify its own work (doer-verifier principle).

Read `workflow/playbooks/testing/testing-workflow.md` for the full testing methodology.

---

## Step 0 — Gather Context

Ask the user before generating anything:

1. **What changed?** (describe the changes, or "check git diff")
2. **Which milestone/task?** (so Track 2 prompts reference the right scope)
3. **Any areas of concern?** (known fragile areas, edge cases the user is worried about)
4. **What's the project's test stack?** (test command, lint command, E2E setup — or "check the instruction file")

Do NOT generate a testing plan until the user has answered. If the user says "just test everything", still ask what changed — generic testing plans are the failure mode this skill prevents.

---

## Track 0 — What Changed

Summarize the changes being tested: files modified, components affected, risk areas. This gives context before generating test instructions.

- List every file modified with a one-line summary of the change
- Identify which components or modules are affected
- Flag risk areas: new dependencies, changed interfaces, security-sensitive code
- Note the verification ratio (see below) based on the autonomy tier of the changes

This section is the foundation — Tracks 1-3 all reference it.

---

## Track 1 — Automated (agent runs these)

Generate the exact commands to run, in order:

1. **Preflight:** `bash scripts/preflight-checks.sh` (or the project's equivalent)
2. **Unit/integration tests:** the project's test command
3. **E2E tests:** if the project has them — quick suite first, full suite second
4. **Scenario tests:** if applicable

For each command, state:
- What it validates
- What a failure means (which component is broken)
- Whether it's blocking (MUST pass) or informational (SHOULD pass)

---

## What ISN'T Tested?

After generating Track 1, list areas the automated tests do not cover and why:
- Not testable with current infrastructure
- Out of scope for this milestone
- Requires production data or environment
- Requires manual interaction (covered in Track 3)
- No existing test coverage for this area (flag as tech debt)

This prevents false confidence from a green test suite that misses critical paths.

---

## Track 2 — AI Verification (prompts for a SEPARATE agent)

Generate two ready-to-paste prompts. Fill in ALL bracketed values from the user's answers — no unfilled placeholders.

Reference specific Track 1 test failures in Track 2 prompts. Example: "Track 1 found a race condition in auth.ts — verify this is resolved in your manual testing."

**2a. Functional verification:**
```
Test [PROJECT_NAME] as an end user. The developer changed [SPECIFIC_CHANGES].
Focus on [AREAS_OF_CONCERN]. Report anything broken, unexpected, or unclear.
Do not modify any code or files. Do not follow existing test scripts —
explore independently.
```

**2b. Code review:**
```
Review the code changes since [MILESTONE/COMMIT]. Focus on [CHANGED_FILES_AND_AREAS].
Look for regressions, security issues, logic gaps, or architectural concerns.
Do not make any code changes — review only.
```

Ask the user: "Which model should run Track 2? Recommend a different model than the coding agent for cross-model verification." Suggest a specific alternative.

**Verdict protocol** — Express each AI verification result as:
- **MUST** — blocking: test fails without this
- **SHOULD** — important: flag if missing
- **MAY** — nice to have: note but don't block

---

## Track 3 — Human Testing (manual checklist)

Generate numbered steps tailored to what actually changed. For each step:
- What to test (specific action, not vague)
- Where to test it (browser, terminal, specific URL/page)
- What "good" looks like (expected result)
- What to look for (visual issues, UX problems, edge cases)

Focus on what automated tests and AI can't catch:
- Visual correctness
- UX flow ("this technically works but isn't what I wanted")
- Domain-specific edge cases only the human would know

If UI changes: "Compare the screen to the previous version. Note any visual regressions — shifted layouts, missing elements, font or color changes, broken responsive behavior."

Mark each item as **critical** (must check) or **nice-to-verify** (check if time allows).

---

## HUMAN GATE

Present all three tracks. Then ask:

> Want me to (a) adjust Track 1 automated test focus, (b) refine Track 2 AI verification prompts, (c) add Track 3 manual test items, (d) finalize test plan?

Do NOT auto-advance. Let the human review the test plan, drop unnecessary items, or add edge cases before execution.

---

## Verification Ratio

Scale effort to the autonomy tier of the changes:
- **Never / Ask First changes:** 1:1 (thorough — all three tracks, full depth)
- **Always changes:** 1:3 (lighter — automated tests + quick human check)

Tell the user which ratio applies based on what they described.

---

## Severity Scale

Rank test failures by priority when reporting results:

**SECURITY** > **CORRECTNESS** > **INTEGRATION** > **PERFORMANCE** > **STYLE**

Address higher-severity failures first. A SECURITY failure blocks the milestone regardless of how many other tests pass.

---

## Review & Fix

After all three tracks complete, generate a **Milestone Gate Checklist**:

```
- [ ] Preflight passes
- [ ] Unit/integration tests pass
- [ ] E2E tests pass (if applicable)
- [ ] AI functional verification: no issues found (or issues fixed and re-verified)
- [ ] AI code review: no blockers found (or blockers addressed)
- [ ] Human testing: all critical items pass
- [ ] [Any milestone-specific gates based on what changed]
```

Tell the user: "Collect findings from all three tracks. If fixes are needed, I can help create a fix plan — then re-run the tracks on the fixed areas."

---

## Closing Gate

- **Issues found:** route to goat-debug for investigation. Re-run affected tracks after fixes.
- **No issues:** milestone testing gate passed. Update task status and proceed.

---

## Learning Loop

If this run uncovered a lesson or footgun, update the relevant doc before closing:
- Behavioural mistake → `docs/lessons.md`
- Architectural trap with file:line evidence → `docs/footguns.md`

---

## Chains With

- **goat-debug** — investigate test failures
- **goat-plan** — test plan verifies milestone acceptance criteria

---

## Constraints

- MUST gather context before generating (Step 0)
- MUST generate all three tracks every time
- MUST generate a Milestone Gate Checklist
- MUST fill in project-specific details — no unfilled [PLACEHOLDERS]
- MUST reference `docs/footguns.md` for known landmines in changed areas
- MUST NOT run tests itself (generates instructions only)
- MUST NOT verify its own work (doer-verifier principle)
- MUST NOT produce generic templates — every item must reference actual changes

**Rule:** The coding agent should never run longer than the developer is willing to test. If you're not testing, the agent shouldn't be coding.

## Output

Three verification tracks (automated tests, AI review prompts, human testing checklist) plus a Milestone Gate Checklist. All items reference actual changes, not generic templates.
