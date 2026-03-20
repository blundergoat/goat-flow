# Prompt: Create /goat-review Skill

Paste this into your coding agent to create the `/goat-review` skill for your project.

---

## The Prompt

```
Create the /goat-review skill for this project.

Purpose: structured review of code changes with RFC 2119 severity levels
and respect for the project's autonomy tiers. The agent reviews
independently - it investigates the code, doesn't blindly apply
external suggestions.

Write the skill file to: .claude/skills/goat-review/SKILL.md
(For Codex: docs/codex-playbooks/goat-review.md)

The goat- prefix ensures this skill name does not conflict with
built-in agent commands or other user-defined skills.

When to use: before merging significant changes, after receiving an
external PR review, or when the developer wants a second opinion
on a change set.

The skill follows this process:

1. Scope - Identify what changed:
   - Read the diff or list of changed files
   - Understand the intent: what was this change trying to do?
   - Identify the blast radius: what else could be affected?

2. Review - Independent investigation of each change:
   - Read the changed code in context (not just the diff)
   - Check for: correctness, security, test coverage, edge cases,
     consistency with existing patterns, autonomy tier violations
   - Cross-reference with docs/footguns.md for known landmines
   - Check that the Definition of Done gates are met

3. Report - Structured findings:
   - Severity using RFC 2119: MUST fix / SHOULD fix / MAY improve
   - Every finding backed by file:line evidence
   - Separate blocking issues from suggestions
   - Note what's good (not just what's wrong)

4. Respond to external reviews:
   - When reviewing an external PR review (Copilot, another agent, etc.),
     investigate each suggestion independently
   - Do NOT blindly agree or apply external suggestions
   - State agreement, disagreement, or "needs more investigation" for each

The skill MUST:
- Read changed files in full context, not just the diff
- Provide file:line evidence for every finding
- Use RFC 2119 severity (MUST/SHOULD/MAY)
- Separate blocking issues (MUST) from non-blocking (SHOULD/MAY)
- Respect the project's autonomy tiers when assessing changes

The skill MUST NOT:
- Apply fixes directly (this is a review, not an implementation)
- Blindly agree with external review suggestions
- Report findings without reading the actual code
- Use a name that conflicts with built-in commands

Output format:
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
- [positive observation about the change]

### Definition of Done
- [ ] Code compiles and passes linting
- [ ] All existing tests pass
- [ ] New tests cover the change
- [ ] Preflight passes
- [ ] Learning loop updated (if applicable)
- [ ] Post-rename grep clean (if applicable)

VERIFICATION:
- Verify skill file exists at the correct path
- Verify RFC 2119 severity levels (MUST/SHOULD/MAY)
- Verify DoD checklist is included
- Verify skill is named "goat-review"
```
