---
name: goat-test
description: "3-phase test plan generation with automated commands, AI verification prompts, and human testing checklists. Doer-verifier principle."
goat-flow-skill-version: "1.0.0"
---
# /goat-test

## Shared Conventions

### Severity & Evidence
- **Severity order:** SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE. Order findings by severity, not by file or discovery order.
- **Evidence:** Every finding needs `file:line`. Tag as OBSERVED (directly verified in code) or INFERRED (deduced - state what direct evidence is missing). Before presenting findings, re-read each cited `file:line` to confirm accuracy. MUST NOT fabricate file paths, function names, or behaviour.

### Human Gates
- **BLOCKING GATE** - agent MUST stop and wait for human decision. Used for: scope approval, phase transitions, final output review. Do NOT auto-advance.
- **CHECKPOINT** - agent presents status and continues unless interrupted. Used for: progress reports, intermediate findings. Format: "Phase N complete. [summary]. Continuing to Phase N+1."

### Adaptive Step 0
1. Read the user's invocation for context already provided
2. For each Step 0 question: if answer is clear from context → **confirm** ("I see [answer]. Correct?"). Otherwise → **ask**
3. If ALL questions answered by invocation → condensed confirmation, proceed
4. If user says "skip Step 0" → confirm understanding, proceed

**Gate rule:** Step 0 MUST end with the agent presenting its understanding and waiting for the user before Phase 1. Auto-detect pre-fills context - it does not replace confirmation. Bare invocation = zero context = ask all structural questions and wait.

### Stuck Protocol
If 3 consecutive reads produce no new signal: (1) present what you have so far, (2) state what you were looking for and didn't find, (3) ask to redirect, narrow scope, or close.

### Ceremony Level
| Complexity | Ceremony |
|------------|----------|
| Hotfix / Small Feature | Skip: closing ceremony, flush rule, footgun annotations, goat-plan Phases 2-3 |
| Standard | Full phases, gates at major decisions |
| System / Infrastructure | Full phases + cross-boundary verification + rollback planning |

**Sub-agent mode:** GATEs become CHECKPOINTs automatically. Step 0 proceeds with auto-detected scope.

### Footgun Fast-Path
If Step 0 footgun check matches a known trap: (1) surface match immediately, (2) offer mitigation path from the entry, (3) still require READ + VERIFY on actual files - footguns are incident records, not executable specs, (4) do NOT skip to implementation on a match alone.

### Flush Protocol
If 10+ tool calls pass without a gate/checkpoint (skip for Hotfix/Small Feature): (1) write 3-sentence status to `.goat-flow/tasks/handoff.md` (what, where, next), (2) if working from a plan/milestone file: tick all completed checkboxes NOW before continuing, (3) ask: continue, compact, or redirect? Counter resets at every BLOCKING GATE, CHECKPOINT, or human message. Handoff file is transient - do not commit.

### Learning Loop
After completing the skill, check if this run uncovered anything worth logging:
- Behavioural mistake → add `## Lesson:` or `## Pattern:` entry to relevant category bucket in `ai-docs/lessons/` or `.goat-flow/lessons/`
- Architectural trap with `file:line` evidence → add `## Footgun:` entry to relevant category bucket in `ai-docs/footguns/` or `.goat-flow/footguns/`
- Route team-wide entries to `ai-docs/`; session-only entries to `.goat-flow/`
- Match entry format to existing entries in the target bucket file. Do not append to a monolithic log or directory README.

### Recovery
When a skill fails mid-execution (context limit, sub-agent dies, tool error):
- Partial completion → identify last completed step (last `[x]` checkbox), resume from next
- Missing artifacts → return to the step that generates them, re-execute
- User wants restart → archive current output to handoff, re-run from Step 0
- User wants to skip → document skip reason in output, proceed to closing
- Sub-agent/autonomous mode → write `.goat-flow/tasks/handoff.md` with enough context to resume

### Working Memory
For tasks exceeding 5 turns: maintain state in `.goat-flow/tasks/todo.md`. If interrupted or compacted, write `.goat-flow/tasks/handoff.md`.

### Autonomy Awareness
Before proposing actions that change files, check the instruction file's Ask First boundaries. If the proposed change crosses a boundary, flag it: "This change touches [boundary]. Proceeding requires approval per Ask First rules."

### Closing Protocol
1. If incomplete → write `.goat-flow/tasks/handoff.md` (Date, Status, Current State, Key Decisions, Errors & Corrections, Learnings, Known Risks, Next Step, Context Files)
2. Check Learning Loop for anything worth logging
3. Write session log to `.goat-flow/logs/sessions/YYYY-MM-DD-slug.md` (what happened, files changed, decisions, learnings)
4. Suggest most relevant next skill (see Chains With)

## When to Use

Use after a coding milestone or every 30-60 minutes of implementation to
generate testing instructions. Testing after 30-60 min keeps the blast radius
narrow enough that failures point to a specific change.

The coding agent runs Phase 1 commands (automated tests). Phase 2 (AI verification)
and Phase 3 (human testing) MUST be performed by a separate agent or human - not the
agent that wrote the code. In single-agent mode, present Phase 2/3 as instructions
for the user to execute or delegate.

**NOT this skill:**
- Running tests → just run them directly
- Debugging a test failure → /goat-debug
- Reviewing code quality → /goat-review
- Understanding test infrastructure → /goat-debug (investigate mode)

**Quick path:** For changes touching ≤2 files with no interface changes:
Phase 1 only + abbreviated Phase 3 (1-2 manual checks). Skip Phase 2.

## Step 0 - Gather Context

**Structural questions (always ask or confirm):**
1. What changed? (or I'll run `git diff` to find it)
2. What's the risk? (what could break if this is wrong?)
3. What's already tested? (existing test files, manual checks done)
4. What's the risk level? (Hotfix / Standard / System)

**Auto-detect mode (unless user explicitly specifies):**

Scope detection priority: (1) explicit user input, (2) staged changes, (3) unstaged changes to target, (4) git diff. If user names a specific file, use THAT - not the full worktree diff.

- Changes to target exist → **Standard mode** (Phase 0 Change Manifest)
- No changes to target → **Audit mode** (coverage gap analysis, skip Phase 0)
- Audit mode: analyze module's public API surface, map existing test files, identify untested paths
- User says "quick" → **Quick mode** (most recent commit only)
- User explicitly says "audit" or "standard" → respect override

**Test stack:** `node --test` (Node built-in runner), `node:assert/strict`, test files at `test/{category}/{name}.test.ts`, fixtures at `test/fixtures/projects/`, shell linting via `shellcheck` and `bash -n`.

**Escape hatch:** If the user says "just test what changed" or provides minimal info, auto-detect scope from `git diff --stat` and existing test files, then proceed with confirmation.

**Pattern read:** Before generating test instructions, read 1-2 existing test files in the affected area. Match the project's assertion style, selector patterns, and fixture conventions exactly. Generate tests that look like the ones already there - not textbook examples.

**Footgun check:** If `ai-docs/footguns/` or `.goat-flow/footguns/` exists, read entries mentioning the changed area from both locations. If a match is found, present it: "This area has a known issue: [footgun]. Relevant to your test plan?"

**Contradiction check:** If the user's stated complexity doesn't match the actual scope, flag it:
- "hotfix" but 5+ files affected → likely Standard or System
- "small feature" but crosses 3+ boundaries → likely System
- "quick test" but 20+ functions in target → warn scope is larger than implied
Surface the mismatch, suggest re-classification. Don't silently proceed.

**Before proceeding:** present what you know (what changed, risk level, test stack) and what you still need. Wait for the user to confirm before entering Phase 0.

## Phase 0 - Change Manifest

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

## Phase 1 - Automated Tests

Generate commands for the coding agent to run:
```bash
# Run relevant test suite
npm test

# Type-check
npx tsc --noEmit

# Lint TypeScript
npx eslint src/cli/

# Lint shell scripts
shellcheck scripts/*.sh

# Syntax-check shell scripts
bash -n scripts/maintenance/*.sh

# Run full preflight gate
bash scripts/preflight-checks.sh
```

**Phase 1 executor:** The coding agent runs these commands. Phase 2 and 3 are
for independent verifiers.

**Integration Gaps:**
Risk areas from Phase 0 NOT covered by automated tests:
- [area] - no automated test exists because [reason]
- [area] - test exists at `file:line` but doesn't exercise the changed path because [reason]

**Mocking awareness:** Note which tests use mocks. Schema changes, API contract
changes, and integration issues won't be caught by mocked tests. Flag: "These
tests mock [X] - real [X] changes won't be caught."

## Phase 2 - AI Verification

Generate prompts for a SEPARATE agent with NO shared conversation context.
The verifier agent starts fresh - the prompts must be completely self-contained.

Include in each prompt: project architecture summary (2-3 lines), list of changed
files with purpose, and relevant footguns for the changed area.

Different models catch different blind spots. The coding model has confirmation
bias toward its own work. Recommend a different model for verification.

**If Phase 2 will be skipped:** Note it explicitly in "What ISN'T Tested":
"AI verification not performed - [reason]. Coverage relies on automated tests
(Phase 1) and human testing (Phase 3) only. Cross-model blind spots are NOT covered."
Use sub-agents for independent Phase 2 verification areas (e.g., rubric checks, fact extraction, setup prompt validation in parallel) instead of requiring a separate session.

**Failure Signatures:**
| If this breaks... | You'll see... |
|-------------------|---------------|
| Rubric check change broken | `npm test` fails in `test/unit/rubric*.test.ts` with assertion mismatch |
| Fact extractor change broken | `npm test` fails in `test/unit/fact*.test.ts`, extracted facts don't match expected |
| Cross-reference rename missed | `grep` for old pattern still returns hits in `.md` files |
| Shell script syntax error | `bash -n` or `shellcheck` exits non-zero on changed script |
| TypeScript build regression | `npx tsc --noEmit` exits non-zero, type errors in `src/cli/` |
| Dashboard render broken | HTML structure tests fail in `test/unit/dashboard*.test.ts` |

## Phase 3 - Human Testing

| What to test | Where | What "good" looks like | What to look for |
|-------------|-------|----------------------|-----------------|
<!-- fill - focus on what automation CAN'T verify -->

Human testing catches: visual regressions, UX issues, multi-step workflows,
cross-browser behavior, real device behavior, and anything requiring judgment.

## What ISN'T Tested

Explicitly list coverage gaps. Be honest about what's NOT verified:
- [gap] - why it's not tested, and the risk level if it breaks
- [gap] - would require [access/environment/data] we don't have

## Closing

**BLOCKING GATE:** Present full test plan. Offer:
(a) run Phase 1 commands now
(b) adjust scope or coverage
(c) found an issue → /goat-debug
(d) close

## Common Failure Modes

1. **Generic Phase 2 prompts** - verifier gets "[CHANGES]" instead of actual file list. The self-contained requirement prevents this.
2. **Phase 3 is trivially obvious** - "click the button" instead of testing what automation can't. Focus human testing on judgment calls.
3. **Full 3-phase for a 1-line fix** - the quick path prevents this.

## Constraints

<!-- FIXED: Do not adapt these -->
- Phase 2/3 verification MUST NOT be performed by the coding agent (doer-verifier principle)
- MUST fill ALL bracketed values in Phase 2 prompts - no [PLACEHOLDER] in output
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
```bash
npm test
npx tsc --noEmit
npx eslint src/cli/
shellcheck scripts/*.sh
bash scripts/preflight-checks.sh
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

Phase 1 commands should be copy-pasteable into CI or terminal.

## Chains With

- /goat-debug - test reveals a failure → diagnosis needed
- /goat-plan - test verifies milestone criteria
- /goat-review - test results inform review decisions

**Handoff shape:** `{change_manifest, test_commands, coverage_gaps, failure_signatures}`
