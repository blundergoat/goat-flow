# Docs Seed Files

These files are created during Phase 1a regardless of which agent you use. They form the learning loop and project documentation.

---

## Learning Loop Files

```
1. docs/lessons.md - Format header, empty Entries/Patterns sections.
   Do NOT invent entries. Starts empty, fills over time.

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
5. docs/architecture.md - Read the codebase and write a short overview
   (under 100 lines): what the system does, major components, data flows,
   non-obvious constraints, deliberate trade-offs. Every line specific to
   THIS codebase. TODOs for what you can't determine from reading.

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
```
