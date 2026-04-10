# ADR-023: Expand inline shared conventions from 12 to ~62 lines

**Status:** Superseded by ADR-028
**Date:** 2026-04-04
**Context:** A 4-agent deep review of workflow/ found that the 12-line inlined shared conventions block was a lossy compression of the 150-line canonical preamble. Recovery procedures, Working Memory management, and Autonomy Awareness were silently lost - exactly the instructions agents need when things go wrong. All 4 reviewers flagged this independently.

## Decision

Expand the inline shared conventions from 12 to ~62 lines. Keep inline (ADR-011's core self-containment principle preserved). Add all instruction content from the canonical preamble; strip only formatting/prose/headings and the full lesson/footgun entry templates (agents can match format from existing entries).

Sections added that were previously missing:
- Recovery (4 failure scenarios with actions)
- Working Memory (5-turn threshold, state files)
- Autonomy Awareness (Ask First boundary checking)
- Closing Protocol (handoff template fields, session log format)
- Evidence re-read rule (verify citations before presenting)
- Flush counter reset rule
- Learning Loop routing guidance (team-wide vs session-only)

## Consequences

- ~50 additional lines per skill template (×5 = 250 total across skill templates)
- Drift surface grows from 60 lines (12×5) to 310 lines (62×5), but content gap is closed
- M03.2 drift check must compare against the expanded canonical source in `workflow/skills/reference/skill-conventions.md`
- `skill-conventions.md` remains the canonical source - update there first, then propagate
- No structural change to skill distribution model - templates remain single-file, self-contained
