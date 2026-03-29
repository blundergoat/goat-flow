# ADR-010: Confusion-Log Disposition

**Date:** 2026-03-28
**Status:** Accepted

## Context

ADR-003 removed confusion-log.md from the workflow template in v0.5.0. The file was never created on any of the 7+ real implementations — the "create on first use" trigger never fired. Structural navigation confusion is already addressed by the router table and `docs/architecture.md`.

However, existing projects still carry stale confusion-log files. rampart has 1 entry that duplicates content already present in both footguns.md and lessons.md — triple redundancy for the same incident. The question is whether to enforce removal, merge content elsewhere, or leave the files alone.

This ADR also addresses the broader question of whether the two-file learning loop (footguns + lessons) is sufficient, or whether a third file is needed for a different category of learning.

## Decision

Do NOT resurrect confusion-log.md. ADR-003's decision stands and is extended:

- Projects that still have the file may keep it, but it is not required or scored by the scanner
- Any content in existing confusion-log files should be merged into `docs/lessons.md` with a note indicating the original entry type (e.g., "Originally logged as navigation confusion")
- The two-file loop (footguns for architectural traps with file:line evidence, lessons for behavioral mistakes) is the practical minimum and the framework standard
- No scanner check will penalize the absence or presence of confusion-log.md

## Consequences

- No framework changes needed — this ADR confirms and extends ADR-003
- Projects with existing confusion-log content have a clear merge path (into lessons.md)
- The scanner does not need a new check; the old check (2.3.5) was already removed in ADR-003
- If a genuinely new category of learning emerges in the future, it should be proposed as a new ADR rather than resurrecting the confusion log
