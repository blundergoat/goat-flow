# Prompt: Generate a Testing Plan for AI-Driven Changes

Paste this into your coding agent after a milestone or coding session. It generates a structured testing plan covering all three verification tracks (automated, AI, human) tailored to what actually changed.

---

## The Prompt

```
Read the testing workflow in workflow/testing/testing-workflow.md (or use the
process below if that file isn't available).

I've just completed a coding milestone. Here's the context:

**What changed:**
[Describe the changes, or say "check git diff" / "check the plan tasks I ticked off"]

**Project stack:**
- Test command: [e.g., npm test, composer test, cargo test]
- Lint command: [e.g., npm run lint, composer analyse]
- E2E tests: [yes/no, and how to run them]
- Format command: [e.g., npm run format, composer cs:fix]

**Project type:**
[web app / CLI tool / library / API / mobile app / other]

Generate a testing plan with these sections:

## Track 1 — Automated Tests
List every automated check to run, in order. Include:
- Preflight (lint, types, format)
- Unit/integration tests
- E2E tests (if applicable — quick suite first, full suite second)
- Any project-specific test scripts or scenarios
- List every test command and what it validates. Do not predict pass/fail outcomes -- that's for the verifier to determine.

## Track 2 — AI Verification
Write two ready-to-paste prompts:

### 2a. Functional Verification Prompt
A prompt for a SEPARATE fresh AI agent to test the system as a user would.
- Tailor it to what changed (if I changed auth, the verifier should test auth flows)
- Tell the verifier what NOT to do (don't run demo scripts, don't modify code)
- Tell the verifier what to report (broken behaviour, unexpected responses, edge cases)

### 2b. Code Review Prompt
A prompt for a SEPARATE fresh AI agent to review the code changes read-only.
- Tell it which files/areas changed
- Tell it what to look for (regressions, security, architectural issues, logic gaps)
- Tell it to NOT make any changes — review only

## Track 3 — Human Testing
List specific manual testing tasks for the developer, based on what changed:
- Step-by-step instructions (not vague — "click X, expect Y")
- Focus on things automated tests and AI can't catch (visual, UX, domain edge cases)
- Note which items are critical vs nice-to-verify
- If the project has a UI, include browser testing steps

## Milestone Gate Checklist
Generate a checklist specific to this milestone:
- [ ] Preflight passes
- [ ] Unit/integration tests pass
- [ ] [E2E tests pass — if applicable]
- [ ] AI functional verification: no issues found (or issues fixed and re-verified)
- [ ] AI code review: no blockers found (or blockers addressed)
- [ ] Human testing: all critical items pass
- [ ] [Any milestone-specific gates based on what changed]

Keep it concise. Don't explain the methodology — just produce the plan.
```

---

## Usage Notes

**When to use:** After every milestone or 30–60 minute coding session, before starting the next one.

**How to customise:** Fill in the bracketed sections with your project details. If you use this regularly, save a version with your stack pre-filled.

**The output:** A concrete, actionable testing plan with copy-paste prompts for verifier agents. Run all three tracks in parallel.

**After testing:** Collect findings from all tracks, feed them back to the coding agent, fix, then re-run the tracks on the fixed areas.
