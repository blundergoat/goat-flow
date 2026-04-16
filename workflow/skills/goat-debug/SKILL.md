---
name: goat-debug
description: "Diagnosis-first debugging with hypothesis tracking and recurrence checks. Includes investigate mode for deep codebase exploration."
goat-flow-skill-version: "1.1.0"
---
# /goat-debug

## Shared Conventions

Read `.goat-flow/skill-preamble.md` for shared conventions.
On full-depth, also read `.goat-flow/skill-conventions.md`.

## When to Use

Use when diagnosing a bug or understanding unfamiliar code. For onboarding, use investigate mode.
- Bug/symptom --> **Diagnose mode**. Exploring, no bug --> **Investigate mode**.

**If you want to "just try something" before tracing the code path, STOP.** That is the failure mode this skill exists to prevent.

**NOT this skill:** Reviewing → /goat-review. Test plans → /goat-test. Planning milestones → /goat-plan. Feature briefs → dispatcher Planning Route.

## Step 0 - Choose Depth

If depth is pre-decided, proceed. Otherwise confirm quick vs full, or auto-detect from available input.
If vague, ask about: goal, symptom/error message, area involved.

**Quick path:** diagnose and report; **full path:** run D1–D4.
**Footgun check:** Read `.goat-flow/footguns/` and `.goat-flow/lessons/` for the target area. Surface matches.


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
Run D3 verification, check regressions, and grep for old patterns after renames.

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

## Constraints

- MUST write hypotheses AFTER initial read of the primary file
- MUST include at least 2 hypothesis categories
- MUST NOT propose fixes until human reviews diagnosis (D2 to D3 gate)
- MUST declare scope before deep reading (investigate mode)
- MUST tag evidence as OBSERVED or INFERRED
- MUST include "What I Didn't Read" in every investigation report
- MUST check recurrence against footguns + lessons
- Universal constraints from skill-preamble.md apply.
- MUST verify fix doesn't violate architecture constraints

## Output Format

```markdown
## TL;DR       <!-- 1 sentence: root cause + confidence -->
## Hypotheses  <!-- table: #, Hypothesis, Category, Status, Evidence (file:line) -->
## Root Cause  <!-- Confidence + Location (file:line) + Description -->
## Reproduction Steps  <!-- numbered, with Expected vs Actual -->
## Fix Plan    <!-- only if human approved D3 -->
```
