---
name: goat-test
description: "3-phase test plan generation with automated commands, AI verification prompts, and human testing checklists. Doer-verifier principle."
goat-flow-skill-version: "1.0.0"
---
# /goat-test

## Shared Conventions

- **Severity:** SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE
- **Evidence:** Every finding needs `file:line`. Tag as OBSERVED (verified) or INFERRED (state what's missing). MUST NOT fabricate.
- **Gates:** BLOCKING GATE = must stop for human. CHECKPOINT = report status, continue unless interrupted.
- **Adaptive Step 0:** If context already provided, confirm it — don't re-ask. Bare invocation with no arguments = zero context = ask structural questions and WAIT. Auto-detect pre-fills — it does not replace confirmation.
- **Stuck:** 3 reads with no signal → present what you have, ask to redirect.
- **Flush:** 10+ tool calls without a gate/checkpoint → write 3-sentence status to `tasks/scratchpad.md`, ask to continue/compact/redirect.
- **Learning Loop:** Behavioural mistake → `docs/lessons.md`. Architectural trap → `docs/footguns.md`.
- **Closing:** If incomplete → write `tasks/handoff.md`. Check learning loop. Suggest next skill. If `tasks/logs/` exists → write session summary.

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

**Pattern read:** Before generating test instructions, read 1-2 existing test files in the affected area. Match the project's assertion style, selector patterns, and fixture conventions exactly. Generate tests that look like the ones already there — not textbook examples.

**Before proceeding:** present what you know (what changed, risk level, test stack) and what you still need. Wait for the user to confirm before entering Phase 0.

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

**Phase 1 executor:** The coding agent runs these commands. Phase 2 and 3 are
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

**If Phase 2 will be skipped:** Note it explicitly in "What ISN'T Tested":
"AI verification not performed — [reason]. Coverage relies on automated tests
(Phase 1) and human testing (Phase 3) only. Cross-model blind spots are NOT covered."
<!-- ADAPT: If your agent supports sub-agents, offer to run Phase 2 prompts
as sub-agent tasks instead of requiring a separate session. -->

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

1. **Generic Phase 2 prompts** — verifier gets "[CHANGES]" instead of actual file list. The self-contained requirement prevents this.
2. **Phase 3 is trivially obvious** — "click the button" instead of testing what automation can't. Focus human testing on judgment calls.
3. **Full 3-phase for a 1-line fix** — the quick path prevents this.

## Constraints

<!-- FIXED: Do not adapt these -->
- The coding agent MUST NOT verify its own work (doer-verifier principle)
- MUST fill ALL bracketed values in Phase 2 prompts — no [PLACEHOLDER] in output
- MUST list what ISN'T tested
- MUST note which tests use mocks and what they can't catch
- MUST NOT fabricate file paths or function names

## Output Format

```markdown
## TL;DR
<!-- What changed, what's tested, what isn't -->

## Phase 0: Change Manifest
| File | Component | Change Type | Risk | Verification Ratio |
|------|-----------|-------------|------|-------------------|

## Phase 1: Automated Tests
<!-- ADAPT: your project's test commands -->
```bash
# Commands for the coding agent to run
```

### Integration Gaps
<!-- Risk areas NOT covered by automated tests -->

## Phase 2: AI Verification
<!-- Self-contained prompts for a SEPARATE agent -->

### Failure Signatures
| If this breaks... | You'll see... |
|-------------------|---------------|

## Phase 3: Human Testing
| What to test | Where | What "good" looks like | What to look for |
|-------------|-------|----------------------|-----------------|

## What ISN'T Tested
<!-- Explicit gaps in coverage -->
```

Phase 1 commands should be CI-pasteable (include a YAML snippet alongside human-readable commands).

## Chains With

- /goat-debug — test reveals a failure → diagnosis needed
- /goat-plan — test verifies milestone criteria
- /goat-review — test results inform review decisions

**Handoff shape:** `{change_manifest, test_commands, coverage_gaps, failure_signatures}`
