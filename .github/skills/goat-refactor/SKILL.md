---
name: goat-refactor
description: "Cross-file refactoring with blast radius analysis, both-sides-first reading, and absence verification"
goat-flow-skill-version: "0.7.0"
---
# /goat-refactor

Structured cross-file refactoring: renames, extractions, interface changes.

## When to Use

Use for changes that touch multiple files and could break references.

## Process

1. **Scope** — declare files to change, files that might break, boundaries crossed
2. **Read both sides** — read every caller AND definition before changing either
3. **Change one layer** — modify the source of truth first, verify with grep
4. **Change consumers** — update each consumer, verify zero old references remain
5. **Verify** — grep all file types (including .md), run build/tests, check docs

## Constraints

- MUST read both sides of every interface before changing either
- MUST grep for old names after EVERY rename
- MUST check documentation references, not just source code
- MUST run build/typecheck after changes
