# Docs Seed Files

These files are created during Phase 1a regardless of which agent you use. They form the learning loop and project documentation.

---

## Learning Loop Files

```
1. docs/lessons.md - Format header with Entries/Patterns sections.
   Do NOT invent entries. If agent-evals/ exist, check each incident:
   if the root cause was a behavioural mistake (not an architectural
   landmine), seed one lesson from it. This gives agents a format
   example and makes the file visible. If no evals exist, start empty.

2. docs/footguns.md - If the file already exists, MERGE with it: keep
   existing entries, add new footguns from reading the codebase.
   If the file doesn't exist, create and seed with real footguns only.
   Do NOT invent hypothetical ones. Do NOT replace existing entries.
   Every entry MUST cite specific file paths with line numbers
   (e.g., src/Auth.php:42). Bare paths without line numbers do not count.

3. docs/confusion-log.md - Create on first use. Materialise this file
   when the first real confusion incident occurs, not pre-created empty.
   However, ALWAYS reference it in the LOG section and router table so
   agents know the destination exists when they need it.

4. tasks/handoff-template.md - Status, Current State, Key Decisions,
   Known Risks, Next Step. Template is copied for each handoff.
```

## Architecture Docs

```
5. docs/architecture.md - If the file already exists: review against
   the under-100-lines target. If over, compress. If it only covers
   one layer, note missing components as TODOs.
   If the file doesn't exist: read the codebase and write a short
   overview (under 100 lines): what the system does, major components,
   data flows, non-obvious constraints, deliberate trade-offs.

6. docs/decisions/ - ADR directory. Create on first use. Materialise
   when the first real architectural decision worth recording occurs.
   If you can identify 1-2 real decisions from the code, create them.
   Do NOT invent decisions.
```

## Ownership Split Report

```
7. docs/guidelines-ownership-split.md - If a guidelines file was
   trimmed in the pre-audit step, create this file documenting what
   was moved, what was removed, and why. Preserves migration rationale.
   In dual-agent projects, document ownership for BOTH instruction
   files (CLAUDE.md and AGENTS.md). Note intentional differences.
```
