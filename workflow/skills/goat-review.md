# Prompt: Create /goat-review Skill

Paste this into your coding agent to create the `/goat-review` skill for your project.

---

## The Prompt

```
Create the /goat-review skill for this project.

## When to Use

Use when reviewing a diff, PR, or specific set of changes before they ship.
goat-review = diff/PR review. For codebase-wide quality sweeps, use goat-audit instead.

Purpose: structured review of code changes with RFC 2119 severity levels,
diff-aware analysis, and respect for the project's autonomy tiers. The agent
gathers context, reviews independently — it investigates the code, doesn't
blindly apply external suggestions.

Write the skill file to: .claude/skills/goat-review/SKILL.md
(For Codex/Gemini: .agents/skills/goat-review/SKILL.md)

When to use: before merging significant changes, after receiving an
external PR review, or when the developer wants a second opinion
on a change set.

## Step 0 — Gather Context

Before reviewing, the skill MUST ask the user:
1. What should I review? (PR, recent commits, specific files, or
   "everything since last milestone")
2. Any specific concerns? (performance, security, a tricky area)
3. Is this responding to external feedback? (Copilot review, another
   agent's review, team comments — if so, paste or point to it)
4. Riskiest change first, or full sweep? (This lets the human direct the
   review toward what matters most.)

Do NOT start reviewing until the user has answered. A review without
scope is a waste of time.

Scope clarification: goat-review is for diffs and PRs. If the user asks for
a codebase-wide sweep, redirect to goat-audit.

If `ai/instructions/code-review.md` exists, load it and apply project-specific
review standards alongside these defaults.

IMPORTANT: Reviews should be conversational, not one-shot. Present
findings, then let the human drill in: "Walk me through the riskiest
change." "What breaks if this runs concurrently?" "Is error handling
consistent?" Conversational reviews catch architectural problems.
One-shot reviews flag style nits and miss what matters.

## Phase 0 — Spec Compliance (conditional)

If `requirements-{feature}.md` exists in the project root or `docs/requirements/`,
check each acceptance criterion against the diff before starting code quality review.
Report: PASS / FAIL / NOT TESTED for each criterion.

If no spec exists, skip this phase entirely. This costs nothing now and
auto-activates when spec artifacts exist.

## Phase 1 — Scope

Identify what changed:
- Read the diff or list of changed files
- Understand the intent: what was this change trying to do?
- Identify the blast radius: what else could be affected?

Diff-aware mode: Review the DIFF for issues. Read FULL FILES for context.
Don't flag pre-existing issues that aren't part of this change. If something
was already broken before this diff, note it separately as "pre-existing"
but do not count it against this change.

Tell the user: "I'll be reviewing [N] files. The changes appear to be
about [intent]. I'll also check [related areas] for blast radius."

## Phase 2 — Review

Read changed files in FULL CONTEXT (not just the diff):

Rank findings by severity: SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE.
Review in that order.

- Check correctness — does the code do what it's supposed to?
- Check cross-reference integrity — did renames break anything?
- Check test coverage — are the changes tested?
- Check for edge cases the author might have missed
- Check consistency with existing patterns
- Check autonomy tier violations
- Cross-reference with docs/footguns.md for known landmines

Pattern drift detection: Flag when new code uses a different pattern than
the rest of the codebase. Example: "This file uses X, but the codebase
convention is Y. Intentional?" Don't assume drift is wrong — ask.

"What I'd break" analysis: For each significant change, state what could
break downstream. Example: "If this auth change is wrong, it would affect:
[list of consumers]." This makes risk concrete.

Footgun matching: For each finding, check `docs/footguns.md` for matches.
Output: "MATCH: footguns.md entry [name]" or "CLEAR: no known footguns
in this area."

If reviewing external suggestions (Copilot PR review, other tool output):
investigate each one independently. Categorize:
- AGREE — real issue, explain why
- DISAGREE — false positive, explain why
- INVESTIGATE — needs more context before deciding
Do NOT blindly agree or apply.

## Phase 3 — Report

Present findings with RFC 2119 severity:
- MUST fix (blocking): security bugs, data loss, broken functionality
- SHOULD fix (recommended): code quality, minor edge cases
- MAY improve (optional): style, minor refactors, docs
- What's good: specific positive observations (not filler)

For each finding: file:line evidence + why it matters + footgun match status.

HUMAN GATE — After presenting findings, ask:
"Want me to (a) dig into the riskiest change, (b) check a specific file
more deeply, (c) compare against spec requirements, (d) finalize the
review verdict?"

Do NOT auto-advance. Let the human drill into specific findings, challenge
severity levels, or redirect focus.

## Phase 4 — DoD Gate Check

Check each Definition of Done item and output pass/fail:
1. Lint/shellcheck passes on changed .sh files
2. No broken cross-references introduced
3. No unapproved boundary changes
4. Logs updated if tripped (lessons.md / footguns.md)
5. Working notes current
6. Grep old pattern after renames — no stale references remain

Output: PASS or FAIL for each gate, with file:line evidence for failures.

The skill MUST:
- Gather context before reviewing (Step 0)
- Review the DIFF for issues, read FULL FILES for context
- Don't flag pre-existing issues as part of this change
- Provide file:line evidence for every finding
- Use RFC 2119 severity (MUST/SHOULD/MAY)
- Rank: SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE
- Separate blocking issues (MUST) from non-blocking (SHOULD/MAY)
- Check footguns.md for matches on each finding
- State downstream impact for significant changes
- Respect the project's autonomy tiers when assessing changes
- Run DoD gate check before finalizing

The skill MUST NOT:
- Apply fixes directly (this is a review, not an implementation)
- Blindly agree with external review suggestions
- Report findings without reading the actual code
- Flag pre-existing issues as blocking for this change

VERIFICATION:
- Verify skill file exists at the correct path
- Verify Step 0 context gathering is present
- Verify RFC 2119 severity levels (MUST/SHOULD/MAY)
- Verify DoD checklist is included
- Verify footgun matching is present
- Verify severity ranking order is present

## Output

Structured review with findings by severity, evidence, footgun match
status, downstream impact analysis, and clear accept/request-changes/block
recommendation.

## Learning Loop

If this review uncovered a lesson or footgun, update the relevant doc before closing:
- Behavioural mistake → `docs/lessons.md`
- Architectural trap with file:line evidence → `docs/footguns.md`

## Chains With

- goat-audit — codebase-wide sweeps (review is for diffs, audit is for repos)
- goat-debug — investigate bugs found during review
- goat-plan — review a plan before implementation begins
- goat-test — verify test coverage gaps found during review
```
