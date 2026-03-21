---
description: "Review changes with structured severity levels"
---
# /goat-review

Structured review of changes with RFC 2119 severity levels.

## When to Use

Before merging significant changes, after external PR feedback, or when a second opinion is needed on a change set.

## Process

### 1. Scope
- Read the diff or list of changed files
- Understand the intent: what was this change trying to do?
- Identify blast radius: what else could be affected?

### 2. Review
- Read changed files in full context (not just the diff)
- Check for: correctness, cross-reference integrity, consistency with existing patterns, evidence quality, autonomy tier violations
- Cross-reference with `docs/footguns.md` for known landmines
- Check that Definition of Done gates are met

### 3. Report
- Severity using RFC 2119: MUST fix / SHOULD fix / MAY improve
- Every finding backed by file:line evidence
- Separate blocking issues from suggestions
- Note what's good (not just what's wrong)

### 4. External reviews
- When reviewing external suggestions, investigate each independently
- Do NOT blindly agree or apply external suggestions
- State agreement, disagreement, or "needs investigation" for each

## Constraints

- MUST read changed files in full context, not just the diff
- MUST provide file:line evidence for every finding
- MUST use RFC 2119 severity (MUST/SHOULD/MAY)
- MUST separate blocking (MUST) from non-blocking (SHOULD/MAY)
- MUST NOT apply fixes directly (review only, not implementation)
- MUST NOT blindly agree with external review suggestions

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
- [ ] Shell scripts pass shellcheck
- [ ] No broken cross-references
- [ ] No unapproved boundary changes
- [ ] Learning loop updated (if applicable)
- [ ] Post-rename grep clean (if applicable)
```
