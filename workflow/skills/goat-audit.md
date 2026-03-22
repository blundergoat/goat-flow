# Prompt: Create /goat-audit Skill

Paste this into your coding agent to create the `/goat-audit` skill for your project.

---

## The Prompt

```
Create the /goat-audit skill for this project.

## When to Use

Use when running a quality audit on the codebase: systematic codebase quality
review, before major releases, or when investigating a class of issues across
the codebase. More thorough than a normal code review — a systematic audit.

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
5. What's the purpose? (security audit, pre-release quality gate,
   consistency check, etc. — this drives category weighting in Pass 1)
6. Any known false positives to skip? Check `docs/audit-allowlist.md`
   if it exists.

Do NOT start scanning until the user has answered. An unscoped audit
wastes passes on irrelevant areas.

The skill follows a strict multi-pass process:

Pass 0 - Scope Declaration:
- Before scanning, declare in writing:
  - Target directories/files (list exactly what will be scanned)
  - Out-of-scope areas (what will NOT be scanned)
  - Expected file count (approximate number of files in scope)
- If >15 files in scope, ask the user to narrow before proceeding
- HUMAN GATE: "Here's the declared scope. Want me to (a) adjust the
  scope, (b) proceed to scanning?"

Pass 1 - Scan:
- Read the target files/directories systematically
- Log every potential finding with file:line evidence
- Cast a wide net — include anything that might be an issue
- Scope-adaptive categories — weight categories based on the stated
  purpose. A security-focused audit weights security findings higher
  than style issues. A consistency audit weights cross-reference
  integrity higher than performance
- Categories (ordered by default severity): security, correctness,
  cross-reference integrity, performance, consistency, completeness,
  shell script correctness, test coverage gaps, architectural concerns,
  style
- Scope discipline: issues found outside the declared scope go to a
  separate "Out of Scope" section — don't mix them with in-scope
  findings
- Report: "Pass 1 complete. Found [N] potential findings ([M]
  out-of-scope). Starting verification."
- HUMAN GATE: "Want me to (a) re-examine specific areas, (b) expand
  the audit scope, (c) narrow the scope, (d) proceed to verification?"

Pass 2 - Verify:
- Re-read each finding from Pass 1 against the actual code
- Remove false positives (findings that don't hold up on second look)
- Remove duplicate findings
- Strengthen evidence for remaining findings
- Negative verification: for each finding, attempt to DISPROVE it.
  Ask: "Can I prove this is wrong?" Actively look for evidence that
  contradicts each finding. A finding that survives disproof is
  stronger than one that was never challenged
- Report: "[N] findings remain after removing [N] false positives."
- HUMAN GATE: "Want me to (a) re-examine specific findings, (b)
  expand the audit scope, (c) narrow the scope, (d) proceed to
  ranking?"

Pass 3 - Rank:
- Use severity scale: SECURITY > CORRECTNESS > INTEGRATION >
  PERFORMANCE > STYLE
- Critical: data loss, security vulnerability, broken functionality
- High: bugs, missing enforcement, broken cross-references
- Medium: inconsistencies, stale docs, missing tests
- Low: style issues, minor improvements, cosmetic
- Group related findings
- HUMAN GATE: "Want me to (a) re-examine specific findings, (b)
  expand the audit scope, (c) narrow the scope, (d) proceed to
  self-check?"

Pass 4 - Self-check:
- For each remaining finding, ask: "Did I fabricate this?"
- Re-verify file:line references are correct and current
- Remove any finding where the evidence doesn't hold up
- Flag any finding where confidence is low
- Report: "[N] findings remain after removing [N] in self-check."

Pass 5 - Pattern Rollup:
- After individual findings are verified, summarize systemic patterns
- If the same class of issue appears 3+ times, roll it up:
  "Found [N] instances of [pattern] — this is a systemic pattern,
  not [N] separate issues."
- List individual instances as sub-items under the pattern
- Recommend addressing the pattern at its root rather than fixing
  instances one by one

Present Results:
Present the full audit to the user.
HUMAN GATE: "Want me to (a) re-examine specific findings, (b) expand
the audit scope, (c) narrow the scope, (d) wrap up the audit?"

The skill MUST:
- Gather context before scanning (Step 0)
- Declare scope before scanning (Pass 0)
- Complete all passes in order
- Provide file:line evidence for every finding
- Include the self-check pass (Pass 4) — this catches fabrication
- Report how many findings were removed in each pass
- Keep out-of-scope findings separate from in-scope findings

The skill MUST NOT:
- Report findings without file:line evidence
- Skip the self-check pass
- Fabricate file paths or line numbers
- Propose fixes (the audit reports — it does not fix)

## Learning Loop

If this audit run uncovered a lesson or footgun, update the relevant
doc before closing:
- Behavioural mistake -> docs/lessons.md
- Architectural trap with file:line evidence -> docs/footguns.md

## Chains With

- goat-review — audit findings become a review checklist
- goat-security — security-specific audit pass

VERIFICATION:
- Verify skill file exists at the correct path
- Verify Step 0 context gathering is present
- Verify Pass 0 scope declaration is present
- Verify multi-pass structure with fabrication self-check at Pass 4
- Verify pattern rollup at Pass 5
- Verify MUST NOT propose fixes constraint is present
- Verify output format template is included
- Verify Learning Loop section is present
- Verify Chains With section is present

## Output

Multi-pass audit report with scope declaration, findings grouped by severity
(critical/high/medium/low), systemic pattern rollup, out-of-scope section,
and file:line evidence for each finding.
```
