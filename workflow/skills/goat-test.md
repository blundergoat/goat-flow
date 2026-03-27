---
name: goat-test
description: "3-phase test plan generation with automated commands, AI verification prompts, and human testing checklists. Doer-verifier principle."
goat-flow-skill-version: "0.7.0"
---
# /goat-test

> Follows [shared-preamble.md](shared-preamble.md) for severity scale, evidence standard, gates, and learning loop.
> Uses the [Test Plan](output-skeletons.md#test-plan) output skeleton.

## When to Use

Use after a coding milestone or every 30-60 minutes of implementation to
generate testing instructions. Testing after 30-60 min keeps the blast radius
narrow enough that failures point to a specific change.

The coding agent MUST NOT verify its own work. This skill generates instructions
for verification — it does not run tests itself.

**NOT this skill:**
- Running tests → just run them directly
- Debugging a test failure → /goat-debug
- Reviewing code quality → /goat-review
- Understanding test infrastructure → /goat-investigate

**Quick path:** For changes touching ≤2 files with no interface changes:
Phase 1 only + abbreviated Phase 3 (1-2 manual checks). Skip Phase 2.

## Step 0 — Gather Context

**Structural questions (always ask or confirm):**
1. What changed? (feature, fix, refactor — auto-detect from `git diff --stat`)
2. What's the risk level? (Hotfix / Standard / System)

**Auto-detect:** Read `git diff --stat` and present: "[N] files changed in [areas].
<!-- ADAPT: "Test stack: [detected from package.json/Makefile/etc.]" -->
Correct?"

## Phase 0 — Change Manifest

Summarize what changed using a structured table:

| File | Component | Change Type | Risk | Verification Ratio |
|------|-----------|-------------|------|-------------------|
<!-- fill from git diff -->

**Verification ratio** by autonomy tier:
- Never/Ask First changes → 1:1 (every changed behavior gets a check)
- Always changes → 1:3 (critical paths only)

State the ratio at the top of the output.

**Spec compliance:** If `requirements-{feature}.md` or acceptance criteria exist,
cross-reference the change manifest. Flag gaps: "Acceptance criterion [X] has no
corresponding change."

## Phase 1 — Automated Tests

Generate commands for the coding agent to run:
<!-- ADAPT: Replace with your project's test commands -->
```bash
# Run relevant test suite
<!-- ADAPT: your test command targeting changed areas -->

# Run full preflight if available
<!-- ADAPT: your preflight command -->
```

**Track 1 executor:** The coding agent runs these commands. Phase 2 and 3 are
for independent verifiers.

**Integration Gaps:**
Risk areas from Phase 0 NOT covered by automated tests:
- [area] — no automated test exists because [reason]
- [area] — test exists at `file:line` but doesn't exercise the changed path because [reason]

**Mocking awareness:** Note which tests use mocks. Schema changes, API contract
changes, and integration issues won't be caught by mocked tests. Flag: "These
tests mock [X] — real [X] changes won't be caught."

## Phase 2 — AI Verification

Generate prompts for a SEPARATE agent with NO shared conversation context.
The verifier agent starts fresh — the prompts must be completely self-contained.

Include in each prompt: project architecture summary (2-3 lines), list of changed
files with purpose, and relevant footguns for the changed area.

Different models catch different blind spots. The coding model has confirmation
bias toward its own work. Recommend a different model for verification.

**Failure Signatures:**
| If this breaks... | You'll see... |
|-------------------|---------------|
<!-- ADAPT: fill with project-specific failure patterns -->
| Auth change broken | 401 responses on `/api/user` |
| Migration failed | Missing columns in `users` table |
| Build regression | `npm run build` exits non-zero |

## Phase 3 — Human Testing

| What to test | Where | What "good" looks like | What to look for |
|-------------|-------|----------------------|-----------------|
<!-- fill — focus on what automation CAN'T verify -->

Human testing catches: visual regressions, UX issues, multi-step workflows,
cross-browser behavior, real device behavior, and anything requiring judgment.

## What ISN'T Tested

Explicitly list coverage gaps. Be honest about what's NOT verified:
- [gap] — why it's not tested, and the risk level if it breaks
- [gap] — would require [access/environment/data] we don't have

## Closing

**BLOCKING GATE:** Present full test plan. Offer:
(a) run Phase 1 commands now
(b) adjust scope or coverage
(c) found an issue → /goat-debug
(d) close

## Common Failure Modes

1. **Generic Track 2 prompts** — verifier gets "[CHANGES]" instead of actual file list. The self-contained requirement prevents this.
2. **Track 3 is trivially obvious** — "click the button" instead of testing what automation can't. Focus human testing on judgment calls.
3. **Full 3-phase for a 1-line fix** — the quick path prevents this.

## Constraints

<!-- FIXED: Do not adapt these -->
- The coding agent MUST NOT verify its own work (doer-verifier principle)
- MUST fill ALL bracketed values in Track 2 prompts — no [PLACEHOLDER] in output
- MUST list what ISN'T tested
- MUST note which tests use mocks and what they can't catch
- MUST NOT fabricate file paths or function names

## Output Format

Use the Test Plan skeleton from `output-skeletons.md`.
Phase 1 commands should be CI-pasteable (include a YAML snippet alongside human-readable commands).

## Chains With

- /goat-debug — test reveals a failure → diagnosis needed
- /goat-plan — test verifies milestone criteria
- /goat-review — test results inform review decisions

**Handoff shape:** `{change_manifest, test_commands, coverage_gaps, failure_signatures}`
