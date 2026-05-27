# Patterns

**Proven approaches worth reusing.** A pattern exists because a problem was solved effectively and the approach generalises. Example: "after any skill rename, grep the entire repo for the old name across all three agent dirs."

If the agent did something wrong → `.goat-flow/lessons/` instead.
If the trap is in the code itself → `.goat-flow/footguns/` instead.

## Automatic Capture Policy

Manual edits are normal: an explicit request to add or update a durable learning-loop entry means edit the Markdown in the correct directory. Programmatic automatic capture from terminal sessions, quality reports, PR reviews, or agent output is disabled unless `.goat-flow/config.yaml` explicitly sets `learning-loop.auto-capture.enabled: true` and a CLI-owned writer for that target exists. Prompts may suggest an entry, but automatic durable writes belong to CLI-owned code after opt-in.

Auto-capture candidates must follow Extract / Consolidate / Skip:

- Extract only when the item changes a future READ/SCOPE/ACT/VERIFY decision.
- Consolidate into an existing entry when the same root cause already exists.
- Skip raw tool output, successful smoke runs, UI/deploy churn, chain-of-thought, screenshots, raw JSON/HTML, duplicate dumps, and "I read the docs" summaries.

Prefer category bucket files such as `verification.md`, `refactoring.md`, or `architecture.md`. Every bucket file MUST start with a YAML frontmatter block that includes BOTH a `category` and a `last_reviewed` date (ISO `YYYY-MM-DD`).

```yaml
---
category: verification
last_reviewed: 2026-05-02
---
```

Inside a bucket, add entries as `## Pattern:` blocks. Each entry SHOULD include `**Context:**` and `**Approach:**` sections so a fresh agent can apply it without prior session knowledge.
