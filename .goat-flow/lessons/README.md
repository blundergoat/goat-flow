# Lessons

**Mistakes the agent made.** A lesson exists because the agent did something wrong - not because the code is structured badly. Example: "agent proposed a fix before completing diagnosis" or "agent skipped disambiguation when it should have asked."

If the trap is in the code itself → `.goat-flow/footguns/` instead.
If a proven approach should be reused → `.goat-flow/patterns/` instead.

**"Add a lesson" = create/update an entry here.** Not runtime code, not code comments, not test assertions. A lesson is a documentation artifact. If the user also wants a code change, they will ask for it separately.

Prefer category bucket files such as `verification.md`, `workflow.md`, or `coordination.md` with file-level frontmatter:

```yaml
---
category: verification
last_reviewed: 2026-04-18
---
```

Both `category` and `last_reviewed` are required. `last_reviewed` must be a strict `YYYY-MM-DD` date (no timestamps). Bump it when you add an entry or materially edit the body; cosmetic edits (typos, whitespace) do not require a bump. `goat-flow stats --check` fails when the field is missing or malformed.

Inside a bucket, add entries as `## Lesson:` or `## Pattern:` blocks. Legacy one-entry files still work during migration, but category buckets are the preferred format.
