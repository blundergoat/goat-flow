---
name: goat-debug
description: "Use when diagnosing a bug, unexpected behaviour, or system failure that needs structured investigation."
goat-flow-skill-version: "1.9.0"
---
# /goat-debug

## Shared Conventions

Read `.goat-flow/skill-reference/skill-preamble.md` for shared conventions.
On full-depth, also read `.goat-flow/skill-reference/skill-conventions.md`.

## When to Use

Use when diagnosing a bug or understanding unfamiliar code. For onboarding, use investigate mode.
- Bug/symptom --> **Diagnose mode**. Exploring, no bug --> **Investigate mode**.

**If you want to "just try something" before tracing the code path, STOP.** That is the failure mode this skill exists to prevent.

| Excuse | Reality |
|--------|---------|
| "The user already diagnosed it, hypotheses are ceremony" | A confidently stated cause is data, not diagnosis. Trace it or eliminate it before acting. |
| "Prod is on fire, D1 is a luxury" | Untraced fixes at 2am are how you get a 3-fix abort at 4am. D1 is the shortest path to a working fix. |
| "Type/config mismatch is a really clean story" | Clean stories that don't mechanically match the symptom (e.g. value-dependent failure from a value-blind cause) are wrong stories. |
| "The specific number in the bug report is probably just phrasing" | Treat every specific number, threshold, or boundary in a bug report as a clue, not rhetoric. |
| "Reading the footgun during an incident looks like second-guessing" | Reading the footgun IS doing your job. Not reading it is what looks bad at post-mortem. |
| "Adding the field is zero-risk - worst case we try the next thing" | This is how you enter the 3-fix abort loop. Hypothesis before code, always. |

**NOT this skill:** Reviewing → /goat-review. Test plans → /goat-qa. Planning milestones → /goat-plan. Feature briefs → dispatcher Route Map.

## Step 0 - Choose Depth

If depth is pre-decided, proceed. Otherwise confirm quick vs full, or auto-detect from available input.
If vague, ask about: goal, symptom/error message, area involved.

**Quick path:** diagnose and report; **full path:** run D1–D1.5–D2–D3–D4.
**Footgun check:** Use the preamble's grep-first learning-loop retrieval on `.goat-flow/footguns/` and `.goat-flow/lessons/` for the target area. Surface matches or an explicit retrieval miss; do not broad-load either bucket.

**Browser evidence detection:** Does the request reference a URL, local HTML page, localhost route, screenshot, UI element, visual rendering issue, browser DevTools output, or browser console/network symptom? If yes, read `.goat-flow/skill-playbooks/browser-use.md` for browser evidence tools. Check with `command -v browser-use || command -v browser-use-python`. If not installed, offer to install it (`pip install browser-use` or `scripts/install-browser-tools.sh`) and wait for the user's response - never install it without approval or silently fall back. If the user declines or installation fails, use the manual fallback in the reference.


## Diagnose Mode

### D1 - Investigate (no fixes)

After reading the primary file, declare a scope snapshot: symptom boundary (what is failing), affected components (files/modules/services involved), and read estimate (how many files you expect to read). This scopes the investigation before hypotheses anchor it.

Write 2-3 hypotheses spanning at least 2 of: Data, Logic, Timing, Environment, Configuration. If the bug involves loops, indices, or pagination, include a boundary/counting hypothesis. After tracing, mark each: CONFIRMED / ELIMINATED / UNRESOLVED with `file + semantic anchor` evidence.

**Multi-component failures** (CI → build → deploy, request → middleware → handler → DB, etc.): instrument each boundary before proposing any fix. For each component boundary, log what data enters and what exits, run once to gather evidence showing WHERE the chain breaks, THEN investigate the specific failing component. Do not guess the failing layer.

**UI-visible bugs:** After writing hypotheses, use browser evidence to confirm or eliminate UI-related hypotheses. Follow the workflow in `.goat-flow/skill-playbooks/browser-use.md`. Browser output is OBSERVED; interpretations remain INFERRED until mapped to `file + semantic anchor`.

**Can't reproduce after 5 file reads?** Log what you checked, suggest logging additions, ask for more context.

### D1.5 - Minimise

**Goal:** Reduce the failing input/scenario to the smallest reproducible case.

**Procedure:**
1. Identify variables in the reproduction (input data, config, environment, sequence of actions)
2. Binary-search each variable while preserving the failure
3. Stop when removing any single variable masks the symptom

**Output:** Minimal failing case (literal command, input, or steps), removed variables list (proves they don't matter), updated hypothesis set (categories ruled out by minimisation).

**Optional bisect path:** If the failure is a regression from a known-good ref, run `git bisect` with the repro as predicate - binary search across commits instead of inputs.

**Hypothesis ranking:** After minimisation, rank surviving hypotheses by cost and likelihood:

| Likelihood \ Cost | LOW cost | MEDIUM cost | HIGH cost |
|---|---|---|---|
| **HIGH** likelihood | 1st | 2nd | 3rd |
| **MEDIUM** likelihood | 2nd | 3rd | 4th |
| **LOW** likelihood | 3rd | 4th | Skip |

Test cheap-and-likely first. Skip expensive-and-unlikely until cheap options are eliminated.

### D2 - Diagnosis

Present: root cause + confidence (HIGH = reproduced, MEDIUM = traced, LOW = inferred) + hypothesis table + reproduction steps. **Confidence floor:** All LOW --> return to D1 or present partial findings.

**Root cause validation before claiming HIGH confidence.** For each candidate root cause, run a causation / necessity / sufficiency check:
- **Causation** - does the proposed cause mechanically produce the observed symptom? Trace the path with `file + semantic anchor`.
- **Necessity** - without this cause, does the symptom still occur? If yes, the cause is insufficient or incomplete.
- **Sufficiency** - is this cause alone enough, or are there co-factors? Name them.

For high-stakes diagnoses, run a 5-Whys chain. Every "because" MUST cite `file + semantic anchor` or a reproduction step, not just prose.

**BLOCKING GATE:** Present diagnosis, then pause. Human decides: dig deeper, propose fix, or stop. If confidence is MEDIUM or LOW with multiple competing hypotheses, consider `/goat-critique` on the hypothesis set before choosing a fix direction.

### D3 - Fix Plan (only if human approved)

What changes (files + functions), blast radius, architecture check (`.goat-flow/architecture.md`), verification method. "Should I implement?" If yes --> implement, then D4.

### D4 - Post-Fix Verification
Rerun the **original reproduction** from D2 - a code change is not a fix until the symptom is gone. Then run D3 verification, check adjacent regressions, and grep for old patterns after renames.

**3-fix abort rule:** If three independent fixes have failed to resolve the symptom, STOP and reconsider whether the architecture or the root-cause hypothesis is wrong. Do not attempt a fourth patch without first re-entering D1 with a fresh hypothesis set.

**UI bugs:** Rerun the original browser reproduction post-fix. Capture screenshot/state showing the symptom is gone. Follow `.goat-flow/skill-playbooks/browser-use.md`.

**Proof Gate:** Apply the Proof Gate from `skill-preamble.md` to the "fixed" claim - rerun the original repro, cite the literal output, and downgrade to **UNVERIFIED** if the session cannot execute the proof.

## Debug Integrity

Every diagnose-mode report ends with this section. It tells the reader how much of the investigation is grounded.

- **Files read:** count
- **Hypotheses tested:** count (CONFIRMED + ELIMINATED + UNRESOLVED)
- **Categories covered:** which of Data/Logic/Timing/Environment/Configuration were tested
- **Reproduction attempted:** yes / no / partial
- **Confidence basis:** N OBSERVED / M INFERRED
- **Footgun retrieval:** hit (cite entry) / miss / skip
- **What I Didn't Check:** files, paths, or components deliberately skipped with one-line reason each

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
- MUST run D1.5 minimisation before presenting D2 diagnosis unless reproduction is already minimal
- MUST include Debug Integrity section in every diagnose-mode report

## Output Format

Diagnose and investigate modes produce different artifacts. Use the block that matches the mode you actually ran.

### Diagnose mode (D1–D1.5–D2–D3–D4)

```markdown
## TL;DR       <!-- 1 sentence: root cause + confidence -->
## Hypotheses  <!-- table: #, Hypothesis, Category, Status, Evidence (file + semantic anchor) -->
## Minimal Failing Case  <!-- from D1.5: minimal input, removed variables, hypothesis ranking -->
## Root Cause  <!-- Confidence + Location (file + semantic anchor) + Description -->
## Reproduction Steps  <!-- numbered, with Expected vs Actual -->
## Fix Plan    <!-- only if human approved D3 -->
## UI Evidence  <!-- optional: only when browser evidence was captured -->
## Debug Integrity
- Files read: [N]
- Hypotheses tested: [N] (CONFIRMED: [n] / ELIMINATED: [n] / UNRESOLVED: [n])
- Categories covered: [list]
- Reproduction attempted: [yes/no/partial]
- Confidence basis: [N] OBSERVED / [M] INFERRED
- Footgun retrieval: [hit/miss/skip]
- What I Didn't Check: [files/paths skipped + reason]
```

### Investigate mode (I1–I3)

```markdown
## TL;DR  <!-- 1 sentence: what this area does + top signal found -->
## Scope
- **In scope:** [files / dirs]
- **Out of scope:** [what was deliberately skipped]
- **Read estimate vs actual:** [N planned / M actually read]
## Reading  <!-- one row per file read -->
| File | Role | Connections | Evidence |
| --- | --- | --- | --- |
| `file + semantic anchor` | [role] | [what calls / is called by this] | OBSERVED/INFERRED |
## Current vs Expected State  <!-- where the code matches and diverges from the mental model -->
## What I Didn't Read  <!-- every skipped file plus one-line reason -->
## Open Questions  <!-- genuine unknowns to resolve next -->
```
