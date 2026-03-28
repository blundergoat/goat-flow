# ADR-009: Evidence Lifecycle Convention

**Date:** 2026-03-28
**Status:** Accepted

## Context

Footguns files across all 8 projects only grow — entries are added when traps are discovered but never updated when the underlying issue is fixed. ambient-scribe invented MITIGATED strikethrough markers in its local CLAUDE.md. halaxy-agents-lab has stale lesson paths. blundergoat's footgun header says ">30 days, propose archive" but no mechanism exists to enforce that.

The result is that long-lived projects accumulate stale entries that degrade trust in the file. Agents waste read budget on warnings about problems that were fixed months ago. No convention exists for marking an entry as resolved, and no tooling checks for staleness.

## Decision

Define a three-state lifecycle for footgun and lesson entries: **ACTIVE** (default), **MITIGATED** (partial fix, cite commit), **RESOLVED** (fully fixed, cite commit).

Resolved entries stay in-place with a `**Status: RESOLVED**` line and the commit ref that fixed them — the same pattern footgun #3 already uses. Do not move resolved entries to a separate file or collapsed section. In-place markers are the lightest-weight option and match what ambient-scribe's MITIGATED annotations already approximate.

This is a framework-wide convention. The canonical description lives in `docs/system-spec.md` under the learning loop section.

## Consequences

- All 8 projects should audit existing footguns and lessons for staleness during their next review cycle
- New footgun entries default to ACTIVE; no status line needed (absence = ACTIVE)
- MITIGATED entries include a commit ref and a note on what remains unfixed
- RESOLVED entries include a commit ref; they stay in the file as historical record
- M03.2 scanner can eventually check for entries older than 30 days without a status marker and flag them for review
- No file structure changes — this is a convention, not a new artifact
