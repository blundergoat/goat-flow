# Prompt: Create or Seed .goat-flow/patterns/

Paste this into your coding agent to create or update the patterns
directory. Patterns capture proven approaches that worked well and
should be reused deliberately by future sessions.

---

## The Prompt

```
Create or update `.goat-flow/patterns/` for this project.

Use category bucket files, not one giant log and not one file per pattern.
Examples: `.goat-flow/patterns/verification.md`, `.goat-flow/patterns/refactoring.md`,
`.goat-flow/patterns/workflow.md`.

IF .goat-flow/patterns/ already exists:
  MERGE with it carefully. Keep existing entries unless they are
  demonstrably wrong or superseded. Prefer updating over deleting.

IF .goat-flow/patterns/ does NOT exist:
  Create the directory with a README.md and seed with category bucket
  files for approaches that have proven effective.

WHAT TO LOOK FOR:
- Verification sequences that caught real problems (e.g. "grep old name
  after every rename")
- Multi-step workflows that succeeded and generalise beyond one task
- Approaches to testing, refactoring, or deployment that avoided known
  failure modes
- Techniques for coordination across agents, tools, or review passes
- Any approach proven by the repo itself, not by general best practice

FORMAT - create or update a category bucket file like this:

---
category: verification
last_reviewed: YYYY-MM-DD
---

## Pattern: [descriptive title]
**Context:** [when this pattern applies]
**Approach:** [what to do and why it works]

RULES:
- Every entry MUST include enough context that a fresh agent can apply
  it without prior session knowledge
- Do NOT include generic advice like "write tests" or "review carefully"
- Every pattern must be SPECIFIC to THIS codebase or proven by it
- If two entries describe the same approach, merge them
- Split a bucket when it grows too large (roughly >200 lines or >10
  entries)

ROUTING:
- If the agent did something wrong → `.goat-flow/lessons/` instead
- If the trap is in the code itself → `.goat-flow/footguns/` instead
- If it's a significant technical decision → `.goat-flow/decisions/`

VERIFICATION:
- Verify .goat-flow/patterns/README.md exists
- Verify each bucket file has `category:` and `last_reviewed:` frontmatter
- Verify every entry has Context and Approach sections
- If merged with existing: verify no confirmed entry was removed without
  an explicit reason
- Report the count of total entries and new entries added
```
