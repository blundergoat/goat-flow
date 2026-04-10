---
name: goat-test
description: "Test plan generation with DDT philosophy: code first, verify, then decide if automated tests add value. Doer-verifier principle."
goat-flow-skill-version: "1.1.0"
---
# /goat-test

## Shared Conventions

Read `.goat-flow/skill-conventions.md` for full shared conventions.
If unavailable, use these essentials:
- Severity: SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE
- Evidence: every finding MUST include file:line, tag OBSERVED vs INFERRED
- Learning loop: check .goat-flow/lessons/ and .goat-flow/footguns/ after completion
- Gates: BLOCKING GATE = stop and wait. CHECKPOINT = continue unless interrupted.
- Task tracking: tick checkboxes immediately when completed, not at the end.

## When to Use

DDT philosophy: code first, verify manually, then decide if automated tests add value. Use when tests genuinely help: complex business logic, cross-service integration, or locking in a bug fix. Don't generate test plans as ceremony.

Use after a coding milestone or every 30-60 minutes of implementation.

**NOT this skill:** Running tests --> just run them. Debugging failures --> /goat-debug. Code quality --> /goat-review.

## Step 0 - Choose Depth

> "Testing [X] -- quick test commands + gaps, or the full 3-phase plan?"

- If user says "quick", "full", or "audit", confirm and continue.
- If arriving from the dispatcher with depth already chosen, skip the depth question.
- If vague, ask one follow-up covering: what changed, what to verify, risk if it breaks.
- If minimal info, auto-detect from `git diff --stat` and existing test files, confirm.

**Read existing tests first:** Before generating anything, read 1-2 existing test files in the affected area. Match the project's assertion style, fixture conventions, and patterns.

**Footgun check:** Read `.goat-flow/footguns/` for entries mentioning the changed area. Surface matches.

**Auto-detect mode:** Changes exist --> Standard. No changes --> Audit (gap analysis). User says "quick" --> Quick.

---

## Quick Path

Produce directly, no extra gating:
1. **Test commands** -- copy-pasteable commands for the changed area
2. **Coverage gaps** -- what isn't tested and the risk level
3. **Manual checks** -- 1-2 things to verify by hand

---

## Full Path

Read `.goat-flow/playbooks/testing/testing-workflow.md` for the complete 3-phase procedure.

**Phase 1 - Automated Tests** (coding agent runs these): test commands (copy-pasteable), integration gaps with reasons, mocking awareness (what mocks hide).

**Phase 2 - AI Verification** (separate agent, fresh context): self-contained prompts including project context, changed files, footguns. Recommend a different model. If skipped, note in "What ISN'T Tested".

**Phase 3 - Human Testing** (what automation can't verify): visual regressions, UX, multi-step workflows, judgment calls. Use table: What to test | Where | What "good" looks like | What to look for.

**What ISN'T Tested:** Explicitly list gaps -- what, why, risk level.

**BLOCKING GATE:** Present the full plan, then pause. Human decides: run Phase 1, adjust scope, switch to /goat-debug, or close.

---

## Constraints

<!-- FIXED: Do not adapt these -->
- Phase 2/3 verification MUST NOT be performed by the coding agent (doer-verifier principle)
- MUST fill ALL bracketed values in Phase 2 prompts -- no [PLACEHOLDER] in output
- MUST list what ISN'T tested
- MUST note which tests use mocks and what they can't catch
- MUST NOT fabricate file paths or function names

## Output Format

```markdown
## TL;DR         <!-- What changed, what's tested, what isn't -->
## Phase 1: Automated Tests
<!-- bash commands (copy-pasteable) + Integration Gaps -->
## Phase 2: AI Verification
<!-- Self-contained prompts for a SEPARATE agent -->
## Phase 3: Human Testing
<!-- Table: What to test | Where | What "good" looks like | What to look for -->
## What ISN'T Tested
<!-- Explicit gaps -->
```

## Chains With

- /goat-debug - test reveals a failure, diagnosis needed
- /goat-plan - test verifies milestone criteria
- /goat-review - test results inform review decisions

**Handoff shape:** `{change_manifest, test_commands, coverage_gaps}`
