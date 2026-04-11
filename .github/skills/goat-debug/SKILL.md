---
name: goat-debug
description: "Diagnosis-first debugging with hypothesis tracking and recurrence checks. Includes investigate mode for deep codebase exploration."
goat-flow-skill-version: "1.1.0"
---
# /goat-debug

## Shared Conventions

Read `.goat-flow/skill-preamble.md` for shared conventions.
On full-depth, also read `.goat-flow/skill-conventions.md`.
If unavailable, use these essentials:
- Severity: SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE
- Evidence: every finding MUST include file or file:line, tag OBSERVED vs INFERRED
- Learning loop: check .goat-flow/lessons/ and .goat-flow/footguns/ after completion
- Gates: BLOCKING GATE = stop and wait. CHECKPOINT = continue unless interrupted.

## When to Use

Use when diagnosing a bug or understanding unfamiliar code. For onboarding, use investigate mode.
- Bug/symptom --> **Diagnose mode**. Exploring, no bug --> **Investigate mode**.

**If you want to "just try something" before tracing the code path, STOP.** That is the failure mode this skill exists to prevent.

**NOT this skill:** Reviewing → /goat-review. Test plans → /goat-test. Planning milestones → /goat-plan. Feature briefs → dispatcher Planning Route.

## Step 0 - Choose Depth

> "Debugging [X] -- quick diagnosis, or full investigation with hypothesis table?"

- If user says "quick" or "full", confirm and continue.
- If arriving from the dispatcher with depth already chosen, skip the depth question.
- If vague, ask one follow-up covering: goal, symptom/error, area involved.
- If minimal info, auto-detect from error output, `git diff`, or named files and confirm.

**Quick path:** Gather goal + symptom + area, diagnose, propose fix if wanted. No gates.
**Full path:** Confirm goal + symptom + area + mode. Run complete workflow below.
**Footgun check:** Read `.goat-flow/footguns/` and `.goat-flow/lessons/` for the target area. Surface matches.

---

## Diagnose Mode

### D1 - Investigate (no fixes)

After reading the primary file, write 2-3 hypotheses spanning at least 2 of: Data, Logic, Timing, Environment, Configuration. If the bug involves loops, indices, or pagination, include a boundary/counting hypothesis. After tracing, mark each: CONFIRMED / ELIMINATED / UNRESOLVED with `file:line` evidence.

**Can't reproduce after 5 file reads?** Log what you checked, suggest logging additions, ask for more context.

### D2 - Diagnosis

Present: root cause + confidence (HIGH = reproduced, MEDIUM = traced, LOW = inferred) + hypothesis table + reproduction steps. **Confidence floor:** All LOW --> return to D1 or present partial findings.

**BLOCKING GATE:** Present diagnosis, then pause. Human decides: dig deeper, propose fix, or stop. If confidence is MEDIUM or LOW with multiple competing hypotheses, consider `/goat-sbao` to critique the hypothesis set before choosing a fix direction.

### D3 - Fix Plan (only if human approved)

What changes (files + functions), blast radius, architecture check (`.goat-flow/architecture.md`), verification method. "Should I implement?" If yes --> implement, then D4.

### D4 - Post-Fix Verification

Run the verification from D3. Check for regressions. Grep for old patterns after renames. **Two-corrections rule:** Corrected twice on same approach --> stop, rewind, ask for a different angle.

---

## Investigate Mode

### I1 - Scope

Declare: **In scope** [files/dirs], **Out of scope** [what we skip], **Read estimate** [N files, pause at 3x].

**BLOCKING GATE:** "I'll investigate [scope] reading up to [N] files. Adjust?"

### I2 - Read (Progressive Depth)

Read in layers: (1) entry points, (2) critical path, (3) supporting files.
For each file log: role, connections, evidence tag (OBSERVED / INFERRED).

### I3 - Report

Required: **What I Didn't Read** (skipped files + reasons), **Current vs Expected State**, **Evidence tags** (OBSERVED/INFERRED).

**BLOCKING GATE:** Present report, pause. Human decides: go deeper, switch to diagnose, or close.

---

## Constraints

<!-- FIXED: Do not adapt these -->
- MUST write hypotheses AFTER initial read of the primary file
- MUST include at least 2 hypothesis categories
- MUST NOT propose fixes until human reviews diagnosis (D2 to D3 gate)
- MUST declare scope before deep reading (investigate mode)
- MUST tag evidence as OBSERVED or INFERRED
- MUST include "What I Didn't Read" in every investigation report
- MUST check recurrence against footguns + lessons
- Universal constraints from skill-preamble.md apply.
- MUST verify fix doesn't violate architecture constraints

## Quick Output Format

TL;DR (root cause + confidence) → fix if approved.

## Output Format

```markdown
## TL;DR       <!-- 1 sentence: root cause + confidence -->
## Hypotheses  <!-- table: #, Hypothesis, Category, Status, Evidence (file:line) -->
## Root Cause  <!-- Confidence + Location (file:line) + Description -->
## Reproduction Steps  <!-- numbered, with Expected vs Actual -->
## Fix Plan    <!-- only if human approved D3 -->
```
