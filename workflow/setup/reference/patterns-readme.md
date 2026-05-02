# Patterns

**Proven approaches worth reusing.** A pattern exists because a problem was solved effectively and the approach generalises. Example: "after any skill rename, grep the entire repo for the old name across all three agent dirs."

If the agent did something wrong → `.goat-flow/lessons/` instead.
If the trap is in the code itself → `.goat-flow/footguns/` instead.

Prefer category bucket files such as `verification.md`, `refactoring.md`, or `architecture.md`. Every bucket file MUST start with a YAML frontmatter block that includes BOTH a `category` and a `last_reviewed` date (ISO `YYYY-MM-DD`).

```yaml
---
category: verification
last_reviewed: 2026-05-02
---
```

Inside a bucket, add entries as `## Pattern:` blocks. Each entry SHOULD include `**Context:**` and `**Approach:**` sections so a fresh agent can apply it without prior session knowledge.
