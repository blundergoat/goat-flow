---
name: goat-review
description: "Review changes with structured severity levels"
---
# GOAT Review

## When to Use
Use when reviewing changes before they ship.

Structured review of changes with RFC 2119 severity levels. The agent reviews independently — it investigates the code, doesn't blindly apply external suggestions.

---

## Step 0 — Gather Context

Ask the user before reviewing:

1. **What should I review?** (PR, recent commits, specific files, or "everything since last milestone")
2. **Any specific concerns?** (performance, security, a tricky area)
3. **Is this responding to external feedback?** (Copilot review, another agent's review, team comments)

If reviewing external feedback, ask the user to paste or point to it.

Do NOT start reviewing until the user has answered. A review without scope is a waste of time.

---

## Phase 1 — Scope

Identify what changed:
- Read the diff or list of changed files
- Understand the intent: what was this change trying to do?
- Identify the blast radius: what else could be affected?

Tell the user: "I'll be reviewing [N] files. The changes appear to be about [intent]. I'll also check [related areas] for blast radius."

---

## Phase 2 — Review

Read changed files in **full context** (not just the diff):
- Check correctness — does the code do what it's supposed to?
- Check cross-reference integrity — did renames break anything?
- Check test coverage — are the changes tested?
- Check for edge cases the author might have missed
- Check consistency with existing patterns
- Check autonomy tier violations — did the change cross a boundary without Ask First?
- Cross-reference with `docs/footguns.md` for known landmines
- Check that Definition of Done gates are met

If reviewing external suggestions: investigate each one independently. Do NOT blindly agree.

---

## Phase 3 — Report

Present findings with RFC 2119 severity:

**MUST fix (blocking):** Issues that must be resolved before merge. Security bugs, data loss risk, broken functionality.

**SHOULD fix (recommended):** Issues that are worth fixing but don't block merge. Code quality, minor edge cases, inconsistencies.

**MAY improve (optional):** Nice-to-haves. Style, minor refactors, documentation gaps.

**What's good:** Specific positive observations. Not filler — real things done well.

For each finding: file:line evidence + why it matters.

Present your findings. Then ask: "Want me to elaborate on any of these, or should we proceed to fixing the MUST items?"

Do NOT auto-advance. Let the human drill into specific findings, challenge severity levels, or redirect focus.

---

## Constraints

- MUST gather context before reviewing (Step 0)
- MUST review changes in full context, not just the diff
- MUST provide file:line evidence for every finding
- MUST use RFC 2119 severity: MUST / SHOULD / MAY
- MUST separate blocking (MUST) from non-blocking (SHOULD/MAY)
- MUST check the Definition of Done gates
- MUST NOT apply fixes directly (review only, not implementation)
- MUST NOT blindly agree with external review suggestions — investigate each independently

## Output Format

```
## Code Review: [change description]

### Changes Reviewed
- [file] - [what changed and why]

### Blocking Issues (MUST fix before merge)
- **[title]** - [file:line] - [what's wrong and why it matters]

### Recommended Changes (SHOULD fix)
- **[title]** - [file:line] - [suggestion with reasoning]

### Optional Improvements (MAY improve)
- **[title]** - [file:line] - [nice-to-have with reasoning]

### What's Good
- [positive observation]

### Definition of Done
- [ ] Preflight passes
- [ ] No broken cross-references
- [ ] No unapproved boundary changes
- [ ] Learning loop updated (if applicable)
- [ ] Post-rename grep clean (if applicable)
```
