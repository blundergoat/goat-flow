---
name: goat-debug
description: "Diagnosis-first debugging with hypothesis tracking, recurrence checks, and evidence-based fix planning."
goat-flow-skill-version: "0.7.0"
---
# /goat-debug

## Shared Conventions

- **Severity:** SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE
- **Evidence:** Every finding needs `file:line`. Tag as OBSERVED (verified) or INFERRED (state what's missing). MUST NOT fabricate.
- **Gates:** BLOCKING GATE = must stop for human. CHECKPOINT = report status, continue unless interrupted.
- **Adaptive Step 0:** If context already provided, confirm it — don't re-ask. Only hard-block with zero context.
- **Stuck:** 3 reads with no signal → present what you have, ask to redirect.
- **Learning Loop:** Behavioural mistake → `docs/lessons.md`. Architectural trap → `docs/footguns.md`.
- **Closing:** Commit or note working artifacts. Check learning loop. Suggest next skill.

## When to Use

Use when diagnosing a bug or unexpected behavior — especially when the root
cause is unclear or spans multiple components.

Purpose: diagnosis-first debugging. The agent gathers context, then investigates
and produces a diagnosis with evidence BEFORE proposing any fix.

**If you want to "just try something" before tracing the code path, STOP.**
That's the failure mode this skill exists to prevent.

**NOT this skill:**
- Exploring unfamiliar code without a bug → /goat-investigate
- Reviewing changes for quality → /goat-review
- Generating test instructions → /goat-test
- Performance profiling or unclear requirements → general reasoning

## Step 0 — Gather Context

<!-- ADAPT: Replace illustrative questions (3, 4) with your project's common debug targets -->

**Structural questions (always ask or confirm):**
1. What's the symptom? (error message, unexpected behaviour, test failure)
2. How urgent? Default: 10 turns. After that, present what you have even if incomplete.

**Illustrative questions (adapt):**
3. <!-- ADAPT: "Which area? (e.g., auth flow, database queries, API endpoints, build pipeline)" -->
4. What have you already tried? (so I don't repeat dead ends)

**Auto-detect:** Read the error message or test output if provided inline.
If the user said `/goat-debug the test in auth.test.ts fails with TypeError`,
confirm: "Symptom: TypeError in auth.test.ts. I'll start with that file. Correct?"

## Phase 1 — Investigate (no fixes)

**RECURRENCE CHECK:** Before investigating, search `docs/footguns.md` +
`docs/lessons.md` + `agent-evals/` for the symptom, file path, or module name.
Search strategy: (a) exact file path, (b) error message keywords, (c) component name.

If a match is found, present it first: "This area has a known issue: [footgun].
Is this the same problem?" Only proceed to fresh investigation after the user
confirms it's a new issue.

**HYPOTHESIS TRACKING:** After reading Step 0 context but BEFORE tracing code,
write 2-3 hypotheses. Hypotheses MUST span at least 2 categories:
- Data (wrong input, missing field, encoding)
- Logic (off-by-one, wrong condition, fence-post error)
- Timing (race condition, async ordering, timeout)
- Environment (config, dependency version, platform difference)
- Configuration (wrong setting, missing env var, stale cache)

Include at least one boundary/counting hypothesis if the bug involves loops,
indices, arrays, or pagination.

After tracing, mark each: CONFIRMED / ELIMINATED / UNRESOLVED with evidence.

*Example:*
| 1 | Token expiry uses `<` instead of `<=` | Logic | CONFIRMED | `auth.ts:47` |
| 2 | Session store timing out under load | Timing | ELIMINATED | `config/redis.ts:12` shows 30s TTL, not related |

**CAN'T REPRODUCE?** If you can't reproduce after 5 file reads:
1. Log what you checked and what you expected to find
2. Suggest logging additions at suspected locations
3. Ask the user for more reproduction context

Generate multiple hypotheses internally before committing to a trace path.

## Phase 2 — Diagnosis

Present findings using the Output Format template below:
- Root cause with **confidence level**: HIGH (reproduced) / MEDIUM (traced to cause) / LOW (inferred from patterns)
- Hypothesis table with status
- Reproduction steps: "1, 2, 3 → expected: [X], actual: [Y]"

**Confidence floor:** Do not advance to Phase 3 if ALL findings are LOW confidence.
Return to Phase 1 for deeper investigation, or present partial findings and ask
the user whether to proceed or dig deeper.

**BLOCKING GATE:** Present diagnosis. Offer:
(a) investigate deeper — I'm not confident yet
(b) propose a fix plan
(c) this matches a known issue — close
(d) something else

This gate is the core value of the skill. Skipping diagnosis is how 3-hour
debugging sessions start.

## Phase 3 — Fix Plan

Only if human approved. Propose a fix plan (not the fix itself):
- **What changes:** specific files and functions
- **Blast radius:** what else could break
- **Architecture check:** verify fix doesn't violate constraints in `docs/architecture.md`
- **Verification:** how to confirm the fix worked (specific test or command)

<!-- ADAPT: Add your project's specific verification commands -->

"Should I implement this fix?"

If yes → implement. Then auto-transition to Phase 4 (skip redundant "confirm fix applied" when the agent did the work).

## Phase 4 — Post-Fix Verification

If a fix was applied (by agent or human):
1. Run the specific verification from Phase 3
2. Check for regressions in related areas
3. Grep for the old pattern if anything was renamed

**Two-corrections rule:** If you've been corrected twice on the same approach,
stop and rewind. Present what you've tried and ask the human for a different angle.

**CHECKPOINT:** "Fix verified: [pass/fail]. Regressions: [none/found]. Learning loop: [entry needed/none]."

## Common Failure Modes

1. **"Just try something"** — agent patches without understanding. Phase 1 prevents this.
2. **Single-track hypothesis** — 3 variations of the same theory. The 2-category rule prevents this.
3. **Premature fix** — agent proposes a fix with LOW confidence. The confidence floor prevents this.

## Constraints

<!-- FIXED: Do not adapt these -->
- MUST write hypotheses BEFORE tracing code paths (after reading Step 0 context)
- MUST include at least 2 hypothesis categories
- MUST NOT propose fixes until human reviews diagnosis (Phase 2→3 gate)
- MUST NOT fabricate file paths or function names
- MUST check recurrence against footguns + lessons before fresh investigation
- MUST verify fix doesn't violate architecture constraints

## Output Format

```markdown
## TL;DR
<!-- 1 sentence: root cause + confidence level -->

## Hypotheses
| # | Hypothesis | Category | Status | Evidence |
|---|-----------|----------|--------|----------|
| 1 | [description] | data/logic/timing/env/config | CONFIRMED/ELIMINATED/UNRESOLVED | `file:line` |

## Root Cause
**Confidence:** HIGH (reproduced) | MEDIUM (traced) | LOW (inferred)
**Location:** `file:line`
**Description:** [what's wrong and why]

## Reproduction Steps
1. [step]
2. Expected: [X] — Actual: [Y]

## Fix Plan
<!-- Only if human approved Phase 3 -->
- What changes: [description]
- Blast radius: [what else could break]
- Verification: [how to confirm the fix worked]
```

## Chains With

- /goat-test — bug fixed, need verification plan
- /goat-investigate — root cause unclear, need deeper exploration
- /goat-review — fix ready, needs review before merge

**Handoff shape:** `{bug_description, root_cause, confidence, fix_applied, files_changed}`
