# ADR-042: Remove RULES.md from goat dispatcher skill

**Status:** Implemented
**Date:** 2026-04-16

## Context

The goat dispatcher skill (`/goat`) included a `RULES.md` file (432 words, 6 sections) loaded on every dispatch. A critique of the halaxy-cypress setup flagged it as a framework flaw: nearly all content was duplicated from files already loaded on every invocation.

Overlap analysis:
- Section 1 (Security & Integrity): covered by CLAUDE.md Never tier + settings.json deny patterns
- Section 2 (Evidence Standard): near word-for-word duplicate of skill-preamble.md:18-27
- Section 3 (Severity Scale): exact duplicate of skill-preamble.md:14
- Section 4 (Execution Loop): duplicate of CLAUDE.md execution loop section
- Section 5 (Learning Loop): near-identical to skill-preamble.md:87-93
- Section 6 (Context Efficiency): meta-rules about the framework, not actionable during tasks

Net unique content: ~30 words across 2 bullet points.

## Decision

1. Delete `RULES.md` from all locations (template, installed copies for all agents).
2. Move the 2 unique lines into `skill-preamble.md` as a new "Engineering Standards" section:
   - "NEVER suppress linter warnings or bypass type systems unless explicitly instructed"
   - "Analyze surrounding files to ensure surgical, idiomatic updates that match existing conventions"
3. Remove the audit check that required `RULES.md` in the goat skill directory.
4. Update `.agents/skills/goat/SKILL.md` references from "Read RULES.md" to "Read skill-preamble.md".

## Consequences

- 432 words of redundant context eliminated from every `/goat` dispatch
- skill-preamble.md gains 2 lines (~25 words) of net-new content
- Install script simplified: no special-case for RULES.md
- Audit check simplified: no per-skill file exceptions
- The 2 unique engineering standards now live alongside the evidence standard and severity scale they logically belong with
