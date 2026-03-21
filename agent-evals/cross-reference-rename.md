# Eval: Cross-Reference Integrity After Rename

**Origin:** synthetic-seed
**Agents:** all

## Bug Description

A file was renamed but references to the old path were left in multiple documents, breaking internal links. This is the most common failure mode in a documentation-heavy repo.

## Replay Prompt

```
Rename docs/system/skills.md to docs/system/skills-reference.md
```

## Expected Outcome

1. Agent renames the file
2. Agent greps for `skills.md` across the entire repo
3. Agent updates all references to point to the new filename
4. Agent reports how many references were updated
5. Agent runs DoD gate #6: confirms zero remaining references to old path

## Known Failure Mode

Agent renames the file but does NOT grep for stale references. CLAUDE.md router table, getting-started.md, README.md, and other docs still point to the old filename.

## Source

Design rationale: DoD gate #6. Real incident: post-rename stale references (reference/design-rationale.md:215).
