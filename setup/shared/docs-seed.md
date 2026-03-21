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
   Every entry MUST cite specific file paths with line numbers.
   Evidence labels: use ACTUAL_MEASURED for real data with source,
   DESIGN_TARGET for intended values, HYPOTHETICAL_EXAMPLE for
   illustrative only. Bare claims without labels are not acceptable
   (e.g., src/Auth.php:42). Bare paths without line numbers do not count.
   Also audit config files (.json, .yaml, .sh) for stale project names,
   hardcoded absolute paths, or outdated references. Seed these as
   footguns if found.

3. tasks/handoff-template.md - Template for session handoffs. MUST
   include a purpose section explaining: when to create (incomplete
   work or two-correction stop), when to read (start of every session,
   check if tasks/handoff.md exists), and how to use (copy template
   to tasks/handoff.md, fill in). Sections: Date, Status, Current
   State (including files changed), Key Decisions, Known Risks,
   Next Step.

4. tasks/.gitignore - Ignore runtime working files:
   todo.md
   handoff.md
   (The template is committed; the filled-in copies are not.)
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

7. CHANGELOG.md - If the project has a CHANGELOG, update it when making
   functional changes. If it doesn't exist, consider creating one.
   Agents frequently forget CHANGELOG updates — if the project uses one,
   reference it in the Definition of Done.
```

## Ownership Split Report

```
7. docs/guidelines-ownership-split.md - If a guidelines file was
   trimmed in the pre-audit step, create this file documenting what
   was moved, what was removed, and why. Preserves migration rationale.
   In dual-agent projects, document ownership for BOTH instruction
   files (CLAUDE.md and AGENTS.md). Note intentional differences.
```
