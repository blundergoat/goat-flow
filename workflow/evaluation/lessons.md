# Prompt: Create .goat-flow/learning-loop/lessons/

Paste this into your coding agent to create the lessons file for the
learning loop. Lessons capture behavioural mistakes made by the agent so
the same failure mode does not repeat.

---

## The Prompt

```
Create or update .goat-flow/learning-loop/lessons/ for this project.

This directory is for behavioural mistakes by the agent, not ordinary product
bugs. Add entries only after a real mistake or correction happened.

Use category bucket files, not one giant log and not one file per incident.
Examples: `.goat-flow/learning-loop/lessons/verification.md`, `.goat-flow/learning-loop/lessons/workflow.md`,
`.goat-flow/learning-loop/lessons/coordination.md`.

If a matching bucket does not exist, create one like this:

```markdown
---
category: verification
---

## Lesson: [Short title]
**Created:** YYYY-MM-DD
**Decision changed:** [the future agent decision this evidence changes]
**Trigger phase:** READ | SCOPE | ACT | VERIFY (optional)
**Caught at:** READ | SCOPE | ACT | VERIFY (optional; use only when different)
**What happened:** [real mistake and impact]
**Evidence:** `file` (search: `semantic anchor`) - [what was found] (required for code-specific lessons; use grep-friendly anchors, not line numbers - see ADR-024)
**Prevention:** [action that would have prevented the mistake]

## Pattern: recurring theme
**Created:** YYYY-MM-DD
_Entries: [optional related titles]_

Short synthesis of the repeated failure mode and the guardrail it implies.
```

If .goat-flow/learning-loop/lessons/ already exists:
- Keep existing entries intact
- Add the new entry to the most relevant category bucket
- Split a bucket when it grows too large (roughly >200 lines or >10 entries)
- Update Pattern entries only when there are repeated themes worth extracting

RULES:
- Do NOT invent entries
- Do NOT log ordinary code defects unless the agent behaviour caused them
- Prefer one concrete lesson per entry over a vague umbrella statement
- Keep the Prevention action-oriented and enforceable
- `Trigger phase` names the earliest phase where retrieval can prevent the failure, not where the failure surfaced; use optional `Caught at` when those phases differ
- Real example: `Isolated fixtures must create every dependency they assert` uses `Trigger phase: ACT` because fixture construction prevents the failure and `Caught at: VERIFY` because the missing dependency surfaced during proof
- Use the current repo format, not a temporary AI-generated placeholder

VERIFICATION:
- Verify .goat-flow/learning-loop/lessons/ exists
- Verify the bucket file has `category:` frontmatter
- Verify every new entry has `## Lesson:` or `## Pattern:` plus Created/What happened/Prevention
- Verify no fabricated entries were added
```
