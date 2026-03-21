# Prompt: Create /goat-audit Skill

Paste this into your coding agent to create the `/goat-audit` skill for your project.

---

## The Prompt

```
Create the /goat-audit skill for this project.

When to use: for systematic codebase quality review, before major
releases, or when investigating a class of issues across the codebase.

Purpose: multi-pass codebase quality review. The skill gathers scope
from the user, then uses 4 passes to find real issues, eliminate false
positives, rank by severity, and self-check for fabrication. More
thorough than a normal code review — a systematic audit.

Write the skill file to: .claude/skills/goat-audit/SKILL.md
(For Codex/Gemini: .agents/skills/goat-audit/SKILL.md)

## Step 0 - Gather Context

Before auditing, the skill MUST ask the user:
1. What's the scope? (whole repo, specific directory, specific concern
   like "security" or "cross-references")
2. Why now? (pre-release, investigating a class of issues, routine check)
3. Any areas to focus on? (or "cast a wide net")
4. Any known issues to skip? (so the audit doesn't flag things already
   being tracked)

Do NOT start scanning until the user has answered. An unscoped audit
wastes passes on irrelevant areas.

The skill follows a strict 4-pass process:

Pass 1 - Scan:
- Read the target files/directories systematically
- Log every potential finding with file:line evidence
- Cast a wide net — include anything that might be an issue
- Categories: security, correctness, performance, maintainability,
  test coverage gaps, architectural concerns
- Report: "Pass 1 complete. Found [N] potential findings."

Pass 2 - Verify:
- Re-read each finding from Pass 1 against the actual code
- Remove false positives (findings that don't hold up on second look)
- Remove duplicate findings
- Strengthen evidence for remaining findings
- Report: "[N] findings remain after removing [N] false positives."

Pass 3 - Rank:
- Critical: data loss, security vulnerability, broken functionality
- High: bugs, missing enforcement, broken cross-references
- Medium: inconsistencies, stale docs, missing tests
- Low: style issues, minor improvements, cosmetic
- Group related findings

Pass 4 - Self-check:
- For each remaining finding, ask: "Did I fabricate this?"
- Re-verify file:line references are correct and current
- Remove any finding where the evidence doesn't hold up
- Flag any finding where confidence is low
- Report: "[N] findings remain after removing [N] in self-check."

Present Results:
Present the full audit to the user. Ask: "Any of these you want me to
dig deeper on? Any that look like false positives?"

The skill MUST:
- Gather context before scanning (Step 0)
- Complete all 4 passes in order
- Provide file:line evidence for every finding
- Include the self-check pass (Pass 4) — this catches fabrication
- Report how many findings were removed in each pass

The skill MUST NOT:
- Report findings without file:line evidence
- Skip the self-check pass
- Fabricate file paths or line numbers
- Propose fixes (the audit reports — it does not fix)

VERIFICATION:
- Verify skill file exists at the correct path
- Verify Step 0 context gathering is present
- Verify 4-pass structure with fabrication self-check at pass 4
- Verify MUST NOT propose fixes constraint is present
- Verify output format template is included
```
