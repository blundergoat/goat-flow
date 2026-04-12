# ADR-021: Category bucket files for lessons and footguns

**Status:** Accepted
**Date:** 2026-04-03
**Context:** The learning loop had evolved through three formats: (1) monolithic single file, (2) per-incident files, (3) category bucket files. Per-incident files created 51 files (20 footguns + 31 lessons) that were hard to navigate, created merge noise, and made it difficult to see patterns within a category.

## Decision

Use **category bucket files** - one file per category with multiple entries inside.

**Footguns:** `.goat-flow/footguns/<category>.md` (e.g., `hooks.md`, `auditor.md`, `setup.md`)
- Each entry: `## Footgun: <name>` with Status/Created/Evidence header line
- New categories created only when no existing category fits
- Split a bucket at ~200 lines or ~10 entries

**Lessons:** `.goat-flow/lessons/<category>.md` (e.g., `verification.md`, `agent-behavior.md`)
- Each entry: `## Lesson: <name>` or `## Pattern: <name>` with Created line
- Same split threshold

## Rationale

| Approach | Files | Navigability | Merge noise | Pattern visibility |
|----------|-------|-------------|-------------|-------------------|
| Monolithic | 1 | Poor (scroll through everything) | Low | Poor |
| Per-incident | 51 (and growing) | Poor (too many files) | High | Poor (each file is isolated) |
| **Category bucket** | **10** | **Good (5 per type, category names)** | **Low** | **Good (related entries together)** |

## Consequences

- Scanner updated: counts `## Footgun:` / `## Lesson:` headings, not files
- Evidence label detection updated: matches both `**Evidence type:**` and `**Evidence:** ACTUAL_MEASURED` formats
- All instruction files (CLAUDE.md, AGENTS.md, GEMINI.md), skill files, workflow templates, and setup templates updated to reference category bucket format
- Migration script not needed: sub-agents consolidated existing per-incident files into buckets
