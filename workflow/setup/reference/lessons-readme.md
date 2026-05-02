# Lessons

**Mistakes the agent made.** A lesson exists because the agent did something wrong - not because the code is structured badly. Example: "agent proposed a fix before completing diagnosis" or "agent skipped disambiguation when it should have asked."

If the trap is in the code itself → `.goat-flow/footguns/` instead.
If a proven approach should be reused → `.goat-flow/patterns/` instead.

Prefer category bucket files such as `verification.md`, `workflow.md`, or `coordination.md`. Every bucket file MUST start with a YAML frontmatter block that includes BOTH a `category` and a `last_reviewed` date (ISO `YYYY-MM-DD`). `goat-flow stats --check` fails when `last_reviewed` is missing.

```yaml
---
category: verification
last_reviewed: 2026-04-20
---
```

Inside a bucket, add entries as `## Lesson:` or `## Pattern:` blocks. Each entry SHOULD include a `**Created:**` line in `YYYY-MM-DD` form so tooling can detect stale content. Legacy one-entry files still work during migration, but category buckets with the frontmatter contract are the preferred and audited format.
