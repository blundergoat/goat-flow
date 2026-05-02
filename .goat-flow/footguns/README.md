# Footguns

**Traps in the code itself.** A footgun exists whether or not an agent triggers it - it's a property of how the codebase is structured. Example: "renaming one doc breaks 5 others because of dense cross-referencing." The trap is in the architecture, not in what the agent did.

If the agent did something wrong → `.goat-flow/lessons/` instead.
If a proven approach should be reused → `.goat-flow/patterns/` instead.

**"Add a footgun" = create/update an entry here.** Not runtime code, not console diagnostics, not test assertions, not UI warnings. A footgun is a documentation artifact. If the user also wants a code change, they will ask for it separately.

Every entry MUST include file path evidence with a **grep-friendly semantic anchor** - a function name, unique string, section heading, or search pattern that survives refactors. Line numbers go stale on every edit; semantic anchors don't.

**Good:** `check-agent-setup.ts` (search: `howToFix.*deprecated`) - emits blocked commands
**Bad:** `check-agent-setup.ts:142` - stale tomorrow

Line numbers are optional convenience. If included, treat as approximate snapshot, not verification target. Each file ref must be in its own backtick span.

Agents should scan only entries above the `## Resolved Entries` section. Resolved entries are historical record, not active traps. Status values should stay machine-simple: `active` or `resolved`.

Prefer category bucket files such as `hooks.md`, `setup.md`, or `auditor.md` with file-level frontmatter:

```yaml
---
category: hooks
last_reviewed: 2026-04-18
---
```

Both `category` and `last_reviewed` are required. `last_reviewed` must be a strict `YYYY-MM-DD` date (no timestamps). Bump it when you add an entry or materially edit the body; cosmetic edits (typos, whitespace) do not require a bump. `goat-flow stats --check` fails when the field is missing or malformed.

Inside a bucket, add entries as `## Footgun:` blocks. Legacy single-entry files still work during migration, but category buckets are the preferred format.
