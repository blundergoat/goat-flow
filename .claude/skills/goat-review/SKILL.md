---
name: goat-review
description: "Review diffs and PRs with structured severity levels, diff-aware analysis, and footgun matching"
goat-flow-skill-version: "0.8.0"
---
# /goat-review

## When to Use

Use when reviewing a diff, PR, or specific set of changes before they ship.
goat-review = diff/PR review. For codebase-wide quality sweeps, use goat-audit instead.

Structured review of changes with RFC 2119 severity levels. The agent reviews independently — it investigates the code, doesn't blindly apply external suggestions.

---

## Step 0 — Gather Context

Ask the user before reviewing:

1. **What should I review?** (PR, recent commits, specific files, or "everything since last milestone")
2. **Any specific concerns?** (performance, security, a tricky area)
3. **Is this responding to external feedback?** (Copilot review, another agent's review, team comments)
4. **Riskiest change first, or full sweep?** (Lets the human direct the review toward what matters most.)

If reviewing external feedback, ask the user to paste or point to it.

Do NOT start reviewing until the user has answered. A review without scope is a waste of time.

If `ai/instructions/code-review.md` exists, load it and apply project-specific review standards alongside these defaults.

---

## Phase 0 — Spec Compliance (conditional)

If `requirements-{feature}.md` exists in the project root or `docs/requirements/`, check each acceptance criterion against the diff before starting code quality review. Report: **PASS** / **FAIL** / **NOT TESTED** for each criterion.

If no spec exists, skip this phase entirely.

---

## Phase 1 — Scope

Identify what changed:
- Read the diff or list of changed files
- Understand the intent: what was this change trying to do?
- Identify the blast radius: what else could be affected?

**Diff-aware mode:** Review the DIFF for issues. Read FULL FILES for context. Don't flag pre-existing issues that aren't part of this change. If something was already broken before this diff, note it separately as "pre-existing" but do not count it against this change.

Tell the user: "I'll be reviewing [N] files. The changes appear to be about [intent]. I'll also check [related areas] for blast radius."

---

## Phase 2 — Review

Read changed files in **full context** (not just the diff).

**Severity ranking order:** SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE. Review in that order.

- Check correctness — does the code do what it's supposed to?
- Check cross-reference integrity — did renames break anything?
- Check test coverage — are the changes tested?
- Check for edge cases the author might have missed
- Check consistency with existing patterns
- Check autonomy tier violations — did the change cross a boundary without Ask First?
- Cross-reference with `docs/footguns.md` for known landmines

**Pattern drift detection:** Flag when new code uses a different pattern than the rest of the codebase: "This file uses X, but the codebase convention is Y. Intentional?" Don't assume drift is wrong — ask.

**"What I'd break" analysis:** For each significant change, state what could break downstream: "If this auth change is wrong, it would affect: [list of consumers]."

**Footgun matching:** For each finding, check `docs/footguns.md` for matches. Output: `MATCH: footguns.md entry [name]` or `CLEAR: no known footguns in this area.`

**External review triage:** When reviewing external feedback (Copilot PR review, other tool output), categorize each finding:
- **AGREE** — real issue, explain why
- **DISAGREE** — false positive, explain why
- **INVESTIGATE** — needs more context before deciding

Do NOT blindly agree with external suggestions — investigate each independently.

---

## Phase 3 — Report

Present findings with RFC 2119 severity:

**MUST fix (blocking):** Issues that must be resolved before merge. Security bugs, data loss risk, broken functionality.

**SHOULD fix (recommended):** Issues that are worth fixing but don't block merge. Code quality, minor edge cases, inconsistencies.

**MAY improve (optional):** Nice-to-haves. Style, minor refactors, documentation gaps.

**What's good:** Specific positive observations. Not filler — real things done well.

For each finding: file:line evidence + why it matters + footgun match status.

**HUMAN GATE** — After presenting findings, ask: "Want me to (a) dig into the riskiest change, (b) check a specific file more deeply, (c) compare against spec requirements, (d) finalize the review verdict?"

Do NOT auto-advance. Let the human drill into specific findings, challenge severity levels, or redirect focus.

---

## Phase 4 — DoD Gate Check

Check each Definition of Done item and output pass/fail:

1. **Lint passes** — shellcheck on changed .sh files
2. **No broken cross-references** — all internal links resolve
3. **No unapproved boundary changes** — autonomy tiers respected
4. **Logs updated if tripped** — lessons.md / footguns.md entries added if needed
5. **Working notes current** — tasks/todo.md reflects actual state
6. **Post-rename grep clean** — no stale references to old paths/names

Output: **PASS** or **FAIL** for each gate, with file:line evidence for failures.

---

## Constraints

- MUST gather context before reviewing (Step 0)
- MUST review the DIFF for issues, read FULL FILES for context
- MUST NOT flag pre-existing issues as part of this change
- MUST provide file:line evidence for every finding
- MUST use RFC 2119 severity: MUST / SHOULD / MAY
- MUST rank: SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE
- MUST separate blocking (MUST) from non-blocking (SHOULD/MAY)
- MUST check `docs/footguns.md` for matches on each finding
- MUST state downstream impact for significant changes
- MUST check the Definition of Done gates
- MUST NOT apply fixes directly (review only, not implementation)
- MUST NOT blindly agree with external review suggestions — investigate each independently

## Output Format

```
## Code Review: [change description]

### Spec Compliance (if requirements file exists)
- [criterion] — PASS / FAIL / NOT TESTED

### Changes Reviewed
- [file] - [what changed and why]

### Blocking Issues (MUST fix before merge)
- **[title]** - [file:line] - [what's wrong and why it matters]
  Footgun: MATCH [entry name] / CLEAR
  Impact: [what breaks downstream if this is wrong]

### Recommended Changes (SHOULD fix)
- **[title]** - [file:line] - [suggestion with reasoning]
  Footgun: MATCH [entry name] / CLEAR

### Optional Improvements (MAY improve)
- **[title]** - [file:line] - [nice-to-have with reasoning]

### Pattern Drift
- [file] uses [pattern X], codebase convention is [pattern Y]. Intentional?

### External Review Triage (if applicable)
- [finding] — AGREE / DISAGREE / INVESTIGATE — [reasoning]

### What's Good
- [positive observation]

### Definition of Done
- [ ] Lint/shellcheck passes — PASS / FAIL
- [ ] No broken cross-references — PASS / FAIL
- [ ] No unapproved boundary changes — PASS / FAIL
- [ ] Logs updated if tripped — PASS / FAIL / N/A
- [ ] Working notes current — PASS / FAIL / N/A
- [ ] Post-rename grep clean — PASS / FAIL / N/A

### Verdict: ACCEPT / REQUEST CHANGES / BLOCK
```

## Learning Loop

If this review uncovered a lesson or footgun, update the relevant doc before closing:
- Behavioural mistake → `docs/lessons.md`
- Architectural trap with file:line evidence → `docs/footguns.md`

## Chains With

- goat-audit — codebase-wide sweeps (review is for diffs, audit is for repos)
- goat-debug — investigate bugs found during review
- goat-plan — review a plan before implementation begins
- goat-test — verify test coverage gaps found during review
