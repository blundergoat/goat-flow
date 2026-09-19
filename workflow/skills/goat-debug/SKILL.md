---
name: goat-debug
description: "Use when diagnosing a bug, unexpected behaviour, system failure, or unfamiliar code that needs structured investigation."
goat-flow-skill-version: "1.17.0"
---
# /goat-debug

## Shared Conventions

Read `.goat-flow/skill-docs/skill-preamble.md` for shared conventions.
On full-depth, also read `.goat-flow/skill-docs/skill-conventions.md`.

## When to Use

Use when diagnosing a bug or understanding unfamiliar code. For onboarding, use investigate mode.
- Bug/symptom --> **Diagnose mode**. Exploring, no bug --> **Investigate mode**. Already-applied fix --> Step 0 verification.

**If you want to "just try something" before tracing the code path, STOP.** That is the failure mode this skill exists to prevent.

| Excuse | Reality |
|--------|---------|
| "The user already diagnosed it, hypotheses are ceremony" | A confidently stated cause is data, not diagnosis. Trace it or eliminate it before acting. |
| "Prod is on fire, D1 is a luxury" | Untraced fixes at 2am are how you get a 3-fix abort at 4am. D1 is the shortest path to a working fix. |
| "Type/config mismatch is a really clean story" | Clean stories that don't mechanically match the symptom (e.g. value-dependent failure from a value-blind cause) are wrong stories. |
| "The specific number in the bug report is probably just phrasing" | Treat every specific number, threshold, or boundary in a bug report as a clue, not rhetoric. |
| "Reading the footgun during an incident looks like second-guessing" | Reading the footgun IS doing your job. Not reading it is what looks bad at post-mortem. |
| "Adding the field is zero-risk - worst case we try the next thing" | This is how you enter the 3-fix abort loop. Hypothesis before code, always. |

## Boundary Commands

- **NEVER:** Turn diagnosis into review, test planning, milestone planning, or an ungated fix.
- **ALWAYS in Diagnose mode:** Trace the live path, test competing hypothesis categories, and state the reproduction and evidence limits.
- **DEFER TO:** `/goat-review` for quality, `/goat-qa` for test plans, `/goat-plan` for milestones, and the dispatcher for feature briefs.

## Step 0 - Choose Depth

**Already-applied change: existing-fix verification.** Identify change, environment/state, original failing steps, expected result, earlier evidence, and execution authority; historical proof is context. Go directly to D4 without D2/D3, hypotheses, minimisation, or causal confidence. Use the reference's verification report; diagnosis-only obligations apply only if diagnosis runs.

**New diagnosis:** Valid explicit depth wins within governing policy. Otherwise Full risk/scope triggers override Quick defaults:
- **Quick:** isolated 1-2 files, diagnosis only, or supplied reproduction; bounded primary-path investigation and compact report.
- **Full:** cross-component, no reproduction, CI/prod/user-visible impact, or possible fix; trace implicated component boundaries and relevant runtime/configuration context. If uncertain, choose Full.
If vague, ask about: goal, symptom/error message, area involved, and what was already tried with its outcome; prior attempts enter D1 as evidence to trace, not as eliminated hypotheses.

**Both diagnosis depths:** D1 + applicable D1.5 + D2; read primary file, test 2 hypothesis categories, attempt reproduction or state gap. Before D2, run D1.5 or state `reproduction already minimal`, `reduction not applicable`, or `unsafe to reduce` with literal input/command and reason. Quick never enters D3 or D4 directly.

**Full is gated, not linear:** run D1 through D2, then stop, investigate deeper, or request a fix plan. Full diagnosis-only may stop at D2. If a Quick diagnosis leads to a fix request, promote to Full at the D2 gate; do not skip either approval. D3 planning follows the first approval; implementation requires the separate D3 approval; D4 follows implementation only.
**Footgun check:** Use the preamble's learning-loop retrieval on `.goat-flow/learning-loop/footguns/` and `.goat-flow/learning-loop/lessons/` for the target area. Surface matches or an explicit retrieval miss; do not broad-load either bucket.

**Browser evidence detection:** URL, local page, screenshot, rendering, or browser console/network symptoms require `.goat-flow/skill-docs/playbooks/browser-use.md`; it owns availability, installation approval, and manual fallback.

Read `references/diagnostic-techniques.md` only for ranking-matrix detail, mutation classification, reduction-method selection, causal-distinction detail, worked diagnosis, or existing-fix reporting.

## Diagnose Mode

### D1 - Investigate (no fixes)

After reading the primary file (the first relevant file at the entry or failure boundary, not a file named by chance), declare a scope snapshot: symptom boundary (what is failing), affected components (files/modules/services involved), read estimate, and decision-relevant source/runtime/configuration state as the baseline. Drift is material when it touches an affected component or the reproduction; record it without persisting secrets or raw sensitive values.

Write 2-3 hypotheses spanning at least 2 of: Data, Logic, Timing, Environment, Configuration. If the bug involves loops, indices, or pagination, include a boundary/counting hypothesis.

**Hypothesis ranking:** Before expensive tracing, reduction, or experiments, rank the hypotheses by likelihood and cost; re-rank whenever evidence changes.


Test cheap-and-likely first; skip expensive-and-unlikely until cheap options are eliminated. When survivors remain, run the cheapest authorized distinguishing check, or cite deterministic proof that entails the symptom; one intervention per hypothesis is never required.

After tracing, mark each: CONFIRMED / ADJUSTED / ELIMINATED / UNRESOLVED with `file + semantic anchor` evidence.

**Multi-component failures:** Record each boundary's input, output, and broken invariant; investigate the failing component. New instrumentation follows diagnostic-experiment authority below.

**UI-visible bugs:** After hypotheses, apply the browser playbook. Browser output is OBSERVED; interpretations remain INFERRED until mapped to `file + semantic anchor`.

**Diagnostic-experiment authority:** Read-only observation may proceed within repository rules, as may execution against disposable state the investigation itself created; disclose target-controlled execution (running code or configuration the target project supplies) when local policy requires it. Any experiment affecting existing source, configuration, local state, network, production, or sensitive data follows the repository's stricter approval boundary. Before a mutation, state the target, expected signal, affected state, rollback, and a cleanup marker; then wait for explicit current-session approval. Track approved mutations separately from the proposed fix. Incomplete cleanup blocks a fixed claim, and user-owned diagnostics are never removed without permission.

If repeated reads or experiments produce no new decision signal, checkpoint: state what was checked, which hypotheses remain, and the next distinguishing evidence needed.

### D1.5 - Minimise

**Goal:** Reduce the failing case without removing the property required for the symptom. Before reducing, preserve the original steps, input, expected result, and context beside the reduced case.

**Procedure:**
1. Identify variables in the reproduction (input data, config, environment, sequence of actions)
2. Choose a method that fits the failure shape; use `references/diagnostic-techniques.md` when simple deletion is unsafe or misleading
3. Preserve the load-bearing order, interaction, workload, environment, or timing condition while reducing unrelated factors

**Output:** Reduced case and method, or a supported minimal/not-applicable/unsafe disposition; literal command/input/steps; tested removals; updated hypothesis set. A removed factor is irrelevant only under the same decision-relevant context.

**Optional bisect path (state-mutating):** Bisect is never required for a reporting-only diagnosis. In reporting-only or no-write mode, describe the option but do not run it. Otherwise require a clean worktree, validate known-good and known-bad refs plus a deterministic, non-destructive predicate at both endpoints, disclose the commands and rollback, then wait for explicit current-session approval. Urgency, an outage, or broad permission to diagnose does not override these gates. A dirty worktree stops this path; an isolated worktree is a separately approved option, not an automatic workaround. After approval, run only the diagnostic predicate. Run `git bisect reset` on success, error, cancellation, or interruption while that approval still holds. A governing freeze leaves state unchanged and outranks this cleanup: report the pending reset and wait for explicit cleanup authority, because resumption alone does not release it.

After minimisation, re-rank survivors before D2; consult the reference's ranking matrix if needed.

### D2 - Diagnosis

Present: root cause + confidence + hypothesis table + reproduction steps. **Confidence floor:** All LOW --> return to D1 or present partial findings.

Symptom reproduction is not root-cause proof. HIGH requires a traced mechanism plus a distinguishing counterfactual or intervention, or deterministic proof that entails the symptom. MEDIUM means the mechanism is traced but distinguishing proof is unavailable or unsafe; name the missing proof. LOW is plausible but has a load-bearing inferred link. Keep root-cause confidence separate from the preamble's proof class.

**Root cause validation before claiming HIGH confidence.** For each candidate root cause, run a causation / necessity / sufficiency check:
- **Causation** - does the proposed cause mechanically produce the observed symptom? Trace the path with `file + semantic anchor`.
- **Necessity** - without this cause, does the symptom still occur? If yes, the cause is not necessary under the compared conditions; look for an alternative sufficient cause, hold relevant cofactors constant, and assess sufficiency separately.
- **Sufficiency** - is this cause alone enough, or are there co-factors? Name them.

For high-stakes diagnoses (production availability, persistent-data loss, or a security boundary at risk), run a 5-Whys chain. Every "because" MUST cite `file + semantic anchor` or a reproduction step, not just prose; the chain ends where cited evidence ends, and a missing link is reported as the gap, never invented to reach five.

**BLOCKING GATE:** Present diagnosis, then pause. Human decides: dig deeper, propose fix, or stop. If confidence is MEDIUM or LOW with multiple competing hypotheses, consider `/goat-critique` on the hypothesis set before choosing a fix direction.

### D3 - Fix Plan (only if human approved)

Approval to write D3 authorizes planning only, not implementation. State what changes (files + functions), blast radius, architecture check (`.goat-flow/architecture.md`), diagnostic cleanup, rollback, and verification method.

**BLOCKING GATE:** Present the fix plan, then pause. Implement only after explicit approval.

### D4 - Post-Fix Verification (approved implementation or existing fix)
First complete approved diagnostic cleanup, confirm each marker, retain user-owned diagnostics, and confirm the intended source/configuration state. Rerun the **original, unminimized reproduction** from D2 or existing-fix intake: a minimised case proves less. Run applicable D3 verification, adjacent checks at the changed causal boundary, and old-pattern searches after renames. Do not close while any approved diagnostic mutation from D1 remains uncleaned.

Missing or unsafe original proof: UNVERIFIED; human-owned: HUMAN-PENDING with owner. Remaining symptom: return to D1; no new patch authority. Passing verification does not prove root cause.

**3-fix abort rule:** If three independent fixes have failed to resolve the symptom, STOP and reconsider whether the architecture or the root-cause hypothesis is wrong. Do not attempt a fourth patch without first re-entering D1 with a fresh hypothesis set.

**UI bugs:** Rerun the original browser reproduction post-fix. Capture screenshot/state showing the symptom is gone. Follow `.goat-flow/skill-docs/playbooks/browser-use.md`.

**Proof Gate:** Apply the Proof Gate from `skill-preamble.md` to the "fixed" claim - rerun the original repro, cite the literal output, and downgrade to **UNVERIFIED** if the session cannot execute the proof.

## Debug Integrity

Every diagnose-mode report ends with this section. It tells the reader how much of the investigation is grounded.

- **Files read:** count
- **Hypotheses assessed:** count (CONFIRMED + ADJUSTED + ELIMINATED + UNRESOLVED); UNRESOLVED means insufficient distinguishing evidence, including untested hypotheses and tested but inconclusive hypotheses
- **Checks executed:** count of hypothesis checks actually performed (reads, runs, or experiments), never inferred from the hypothesis total
- **Categories covered:** which of Data/Logic/Timing/Environment/Configuration were assessed
- **Reproduction attempted:** yes / no / partial
- **Evidence states:** OBSERVED (literal result) / INFERRED (reasoned link) / UNVERIFIED (not executed) / HUMAN-PENDING: each human-owned check with its owner or role
- **Proof class:** `RUNTIME | CONTRACT-GREP | STATIC | NOT-REPRODUCED` (per `skill-preamble.md` Proof Classification)
- **Diagnostic mutations:** none / approved and tracked / cleanup incomplete
- **Footgun retrieval:** hit (cite entry) / miss
- **What I Didn't Check:** files, paths, or components deliberately skipped with one-line reason each

## Investigate Mode

Investigate mode does not require reproduction, bug hypotheses, minimisation, or causal proof.

### I1 - Scope

Declare: **In scope** [files/dirs], **Out of scope** [what we skip], **Read estimate** [N files, pause at 3x].

**CHECKPOINT:** "I'll investigate [scope] reading up to [N] files. Adjust?" When the goal and scope are explicit, continue to I2 without waiting. Pause only when the goal or boundary is ambiguous, or before exceeding the declared 3x read limit.

### I2 - Read (Progressive Depth)

Read in layers: (1) entry points, (2) critical path, (3) supporting files.
For each file log: role, connections, evidence tag (OBSERVED / INFERRED).

### I3 - Report

Required: **What I Didn't Read** (skipped files + reasons), **Current vs Expected State**, **Evidence tags** (OBSERVED/INFERRED).

**BLOCKING GATE:** Present report, pause. Human decides: go deeper, switch to diagnose, or close.

## Constraints

- Diagnose mode MUST write hypotheses AFTER initial read of the primary file
- Diagnose mode MUST include at least 2 hypothesis categories
- MUST NOT propose fixes until human reviews diagnosis (D2 to D3 gate)
- MUST declare scope before deep reading (investigate mode)
- MUST tag diagnose evidence as OBSERVED, INFERRED, UNVERIFIED, or HUMAN-PENDING
- MUST include "What I Didn't Read" in every investigation report
- Universal constraints from skill-preamble.md apply.
- MUST verify fix doesn't violate architecture constraints
- Diagnose mode MUST run D1.5 reduction before D2 or evidence a minimal, not-applicable, or unsafe disposition
- MUST NOT run `git bisect` in reporting-only or no-write mode, or without explicit approval, a clean worktree, validated refs and predicate, and a reset plan
- MUST include Debug Integrity section in every diagnose-mode report

## Output Format

Existing-fix verification uses the reference report; otherwise use the applicable block.

### Diagnose mode (through the current gate)

Keep Quick output compact. Omit D3, D4, UI, and diagnostic-mutation fields when they are not applicable.

```markdown
## TL;DR       <!-- root cause + confidence -->
## Hypotheses  <!-- #, hypothesis, category, status, file + semantic anchor -->
## Minimal Failing Case  <!-- D1.5 case/method or disposition; limits -->
## Root Cause  <!-- confidence; file + semantic anchor; description -->
## Reproduction Steps  <!-- Expected vs Actual -->
## Fix Plan    <!-- only if human approved D3 -->
## Verification  <!-- after D4 -->
## UI Evidence  <!-- if captured -->
## Debug Integrity
- Files read: [N]
- Hypotheses assessed: [N] (CONFIRMED: [n] / ADJUSTED: [n] / ELIMINATED: [n] / UNRESOLVED: [n])
- Checks executed: [N]
- Categories covered: [list]
- Reproduction attempted: [yes/no/partial]
- Evidence states: OBSERVED=[n] / INFERRED=[n] / UNVERIFIED=[n] / HUMAN-PENDING=[n]: [check - owner]
- Proof class: [RUNTIME/CONTRACT-GREP/STATIC/NOT-REPRODUCED]
- Diagnostic mutations: [none/approved and tracked/cleanup incomplete]
- Footgun retrieval: [hit/miss]
- What I Didn't Check: [files/paths skipped + reason]
```

### Investigate mode (I1–I3)

```markdown
## TL;DR  <!-- purpose + top signal -->
## Scope
- **In scope:** [files / dirs]
- **Out of scope:** [what was deliberately skipped]
- **Read estimate vs actual:** [N planned / M actually read]
## Reading  <!-- one row per file read -->
| File | Role | Connections | Evidence |
| --- | --- | --- | --- |
| `file + semantic anchor` | [role] | [what calls / is called by this] | OBSERVED/INFERRED |
## Current vs Expected State
## What I Didn't Read  <!-- skipped files + reasons -->
## Open Questions
```
