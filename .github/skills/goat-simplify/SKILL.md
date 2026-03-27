---
name: goat-simplify
description: "Code readability improvement through naming analysis, self-documentation assessment, and complexity reduction"
goat-flow-skill-version: "0.7.0"
---
# /goat-simplify

Improve code readability without changing behaviour.

## When to Use

Use when code works correctly but is hard to read, follow, or maintain.

## Process

1. **Read** — read target code, linter config, and `docs/footguns.md` for related entries
2. **Assess** — identify naming issues, unnecessary comments, dead code, excessive nesting
3. **Rank** — order findings by impact (most confusing first)
4. **Propose** — present findings with before/after diffs, wait for approval
5. **Implement** — apply approved changes, verify behaviour unchanged

## Constraints

- MUST NOT change behaviour — readability only
- Prefer renaming over commenting (self-documenting code)
- MUST verify no functional changes after each edit (run tests/build)
- MUST check `docs/footguns.md` before changing code in known-tricky areas
