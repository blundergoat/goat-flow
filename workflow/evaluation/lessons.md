# Prompt: Create .goat-flow/lessons/

Paste this into your coding agent to create the lessons file for the
learning loop. Lessons capture behavioural mistakes made by the agent so
the same failure mode does not repeat.

---

## The Prompt

```
Create or update .goat-flow/lessons/ for this project.

This directory is for behavioural mistakes by the agent, not ordinary product
bugs. Add entries only after a real mistake or correction happened.

Use category bucket files, not one giant log and not one file per incident.
Examples: `.goat-flow/lessons/verification.md`, `.goat-flow/lessons/workflow.md`,
`.goat-flow/lessons/coordination.md`.

If a matching bucket does not exist, create one like this:

```markdown
---
category: verification
---

## Lesson: [Short title]
**Created:** YYYY-MM-DD
**What happened:** [real mistake and impact]
**Evidence:** `file:line` - [what was found] (required for code-specific lessons; omit for behavioral lessons where file:line evidence doesn't apply)
**Prevention:** [action that would have prevented the mistake]

## Pattern: recurring theme
**Created:** YYYY-MM-DD
_Entries: [optional related titles]_

Short synthesis of the repeated failure mode and the guardrail it implies.
```

If .goat-flow/lessons/ already exists:
- Keep existing entries intact
- Add the new entry to the most relevant category bucket
- Split a bucket when it grows too large (roughly >200 lines or >10 entries)
- Update Pattern entries only when there are repeated themes worth extracting

RULES:
- Do NOT invent entries
- Do NOT log ordinary code defects unless the agent behaviour caused them
- Prefer one concrete lesson per entry over a vague umbrella statement
- Keep the Prevention action-oriented and enforceable
- Use the current repo format, not a temporary AI-generated placeholder

VERIFICATION:
- Verify .goat-flow/lessons/ exists
- Verify the bucket file has `category:` frontmatter
- Verify every new entry has `## Lesson:` or `## Pattern:` plus Created/What happened/Prevention
- Verify no fabricated entries were added
```
