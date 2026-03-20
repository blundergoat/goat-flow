# Prompt: Create /goat-audit Skill

Paste this into your coding agent to create the `/goat-audit` skill for your project.

---

## The Prompt

```
Create the /goat-audit skill for this project.

When to use: for systematic codebase quality review, before major
releases, or when investigating a class of issues across the codebase.

Purpose: multi-pass codebase quality review. The skill uses 4 passes to
find real issues, eliminate false positives, rank by severity, and
self-check for fabrication. This is more thorough than a normal code
review — it's a systematic audit.

Write the skill file to: .claude/skills/goat-audit/SKILL.md
(For Codex: docs/codex-playbooks/goat-audit.md)

The skill follows a strict 4-pass process:

Pass 1 — Scan:
- Read the target files/directories systematically
- Log every potential finding with file:line evidence
- Cast a wide net — include anything that might be an issue
- Categories: security, correctness, performance, maintainability,
  test coverage gaps, architectural concerns

Pass 2 — Verify:
- Re-read each finding from Pass 1 against the actual code
- Remove false positives (findings that don't hold up on second look)
- Remove duplicate findings
- Strengthen evidence for remaining findings

Pass 3 — Rank:
- Rank surviving findings by severity (Critical / High / Medium / Low)
- Rank by blast radius (how many components are affected)
- Group related findings

Pass 4 — Self-check:
- For each remaining finding, ask: "Did I fabricate this?"
- Re-verify file:line references are correct and current
- Remove any finding where the evidence doesn't hold up
- Flag any finding where confidence is low

The skill MUST:
- Complete all 4 passes in order
- Provide file:line evidence for every finding
- Include the self-check pass (Pass 4) — this catches fabrication
- Report how many findings were removed in each pass

The skill MUST NOT:
- Report findings without file:line evidence
- Skip the self-check pass
- Fabricate file paths or line numbers
- Mix findings from different severity levels without clear separation

Output format:
## Audit Results

### Summary
- Pass 1: [N] potential findings
- Pass 2: [N] after false positive removal (-[N] removed)
- Pass 3: [N] ranked findings
- Pass 4: [N] after self-check (-[N] fabrication removed)

### Critical
- **[title]** — [file:line] — [description + evidence]

### High
- **[title]** — [file:line] — [description + evidence]

### Medium
- **[title]** — [file:line] — [description + evidence]

### Low
- **[title]** — [file:line] — [description + evidence]

VERIFICATION:
- Verify skill file exists at the correct path
- Verify 4-pass structure with fabrication self-check at pass 4
- Verify MUST NOT propose fixes constraint is present
- Verify output format template is included
```
