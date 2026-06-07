# Lessons

**Mistakes the agent made.** A lesson exists because the agent did something wrong - not because the code is structured badly. Example: "agent proposed a fix before completing diagnosis" or "agent skipped disambiguation when it should have asked."

If the trap is in the code itself → `.goat-flow/learning-loop/footguns/` instead.
If a proven approach should be reused → `.goat-flow/learning-loop/patterns/` instead.

## Automatic Capture Policy

Manual edits are normal: an explicit request to add or update a durable learning-loop entry means edit the Markdown in the correct directory. Programmatic automatic capture from terminal sessions, quality reports, PR reviews, or agent output is disabled unless `.goat-flow/config.yaml` explicitly sets `learning-loop.auto-capture.enabled: true` and a CLI-owned writer for that target exists. Prompts may suggest an entry, but automatic durable writes belong to CLI-owned code after opt-in.

Auto-capture candidates must follow Extract / Consolidate / Skip:

- Extract only when the item changes a future READ/SCOPE/ACT/VERIFY decision.
- Consolidate into an existing entry when the same root cause already exists.
- Skip raw tool output, successful smoke runs, UI/deploy churn, chain-of-thought, screenshots, raw JSON/HTML, duplicate dumps, and "I read the docs" summaries.

Prefer category bucket files such as `verification.md`, `workflow.md`, or `coordination.md`. Every bucket file MUST start with a YAML frontmatter block that includes BOTH a `category` and a `last_reviewed` date (ISO `YYYY-MM-DD`). `goat-flow stats --check` fails when `last_reviewed` is missing.

```yaml
---
category: verification
last_reviewed: 2026-04-20
---
```

Inside a bucket, add entries as `## Lesson:` or `## Pattern:` blocks. Each entry SHOULD include a `**Created:**` line in `YYYY-MM-DD` form so tooling can detect stale content. Legacy one-entry files still work during migration, but category buckets with the frontmatter contract are the preferred and audited format.
