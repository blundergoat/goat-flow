# Patterns

**Proven approaches worth reusing.** A pattern exists because a problem was solved effectively and the approach generalises. Example: "after any skill rename, grep the entire repo for the old name across all three agent dirs."

If the agent did something wrong → `.goat-flow/lessons/` instead.
If the trap is in the code itself → `.goat-flow/footguns/` instead.

**"Add a pattern" = create/update an entry here.** Not runtime code, not test assertions, not inline comments. A pattern is a documentation artifact. If the user also wants a code change, they will ask for it separately.

Every entry MUST include enough context that a fresh agent can apply it without prior session knowledge.

Prefer category bucket files such as `verification.md`, `refactoring.md`, or `architecture.md` with file-level frontmatter:

```yaml
---
category: verification
last_reviewed: 2026-05-02
---
```

Both `category` and `last_reviewed` are required. `last_reviewed` must be a strict `YYYY-MM-DD` date (no timestamps). Bump it when you add an entry or materially edit the body; cosmetic edits (typos, whitespace) do not require a bump.

Inside a bucket, add entries as `## Pattern:` blocks.
