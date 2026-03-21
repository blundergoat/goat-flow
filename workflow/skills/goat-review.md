# Prompt: Create /goat-review Skill

Paste this into your coding agent to create the `/goat-review` skill for your project.

---

## The Prompt

```
Create the /goat-review skill for this project.

Purpose: structured review of code changes with RFC 2119 severity levels
and respect for the project's autonomy tiers. The agent gathers context,
then reviews independently — it investigates the code, doesn't blindly
apply external suggestions.

Write the skill file to: .claude/skills/goat-review/SKILL.md
(For Codex/Gemini: .agents/skills/goat-review/SKILL.md)

When to use: before merging significant changes, after receiving an
external PR review, or when the developer wants a second opinion
on a change set.

## Step 0 - Gather Context

Before reviewing, the skill MUST ask the user:
1. What should I review? (PR, recent commits, specific files, or
   "everything since last milestone")
2. Any specific concerns? (performance, security, a tricky area)
3. Is this responding to external feedback? (Copilot review, another
   agent's review, team comments — if so, paste or point to it)

Do NOT start reviewing until the user has answered. A review without
scope is a waste of time.

## Phase 1 - Scope

Identify what changed:
- Read the diff or list of changed files
- Understand the intent: what was this change trying to do?
- Identify the blast radius: what else could be affected?

Tell the user: "I'll be reviewing [N] files. The changes appear to be
about [intent]. I'll also check [related areas] for blast radius."

## Phase 2 - Review

Read changed files in FULL CONTEXT (not just the diff):
- Check correctness — does the code do what it's supposed to?
- Check cross-reference integrity — did renames break anything?
- Check test coverage — are the changes tested?
- Check for edge cases the author might have missed
- Check consistency with existing patterns
- Check autonomy tier violations
- Cross-reference with docs/footguns.md for known landmines
- Check that Definition of Done gates are met

If reviewing external suggestions: investigate each one independently.
Do NOT blindly agree or apply.

## Phase 3 - Report

Present findings with RFC 2119 severity:
- MUST fix (blocking): security bugs, data loss, broken functionality
- SHOULD fix (recommended): code quality, minor edge cases
- MAY improve (optional): style, minor refactors, docs
- What's good: specific positive observations (not filler)

For each finding: file:line evidence + why it matters.

Ask the user: "Any of these you want me to elaborate on, or should
we proceed to fixing the MUST items?"

The skill MUST:
- Gather context before reviewing (Step 0)
- Read changed files in full context, not just the diff
- Provide file:line evidence for every finding
- Use RFC 2119 severity (MUST/SHOULD/MAY)
- Separate blocking issues (MUST) from non-blocking (SHOULD/MAY)
- Respect the project's autonomy tiers when assessing changes

The skill MUST NOT:
- Apply fixes directly (this is a review, not an implementation)
- Blindly agree with external review suggestions
- Report findings without reading the actual code

VERIFICATION:
- Verify skill file exists at the correct path
- Verify Step 0 context gathering is present
- Verify RFC 2119 severity levels (MUST/SHOULD/MAY)
- Verify DoD checklist is included
```
