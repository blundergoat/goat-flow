# ADR-030: Replace Gemini with Antigravity as the fourth supported runtime

**Status:** Accepted
**Date:** 2026-05-24

## Context

Commit `3bc982de` replaced the old Gemini runtime surfaces with Antigravity across configuration and documentation. After that change, the supported runtime set is no longer Claude, Codex, Gemini, and Copilot; it is Claude, Codex, Antigravity, and Copilot.

The current compile-time authority is `src/cli/types.ts` (search: `KNOWN_AGENT_IDS`), and the runtime/install authority is `workflow/manifest.json` (search: `"antigravity"`). Historical Gemini mentions can remain only when they describe pre-v1.8.0 incidents, external review participants, or ignored scratch/worktree artifacts that are not current product surfaces.

## Decision

Canonical agents are:

- `claude`
- `codex`
- `antigravity`
- `copilot`

Gemini runtime surfaces are removed from current setup, audit, dashboard, hook, and skill-install contracts. Antigravity owns the fourth-agent slot and uses `.agents/` surfaces where the manifest says so. Current docs and ADR revisit-trigger enumerations must use the canonical set above.

## Failure Mode Comparison

Keeping a Gemini stub would reduce rename churn but preserve a false supported-runtime claim. A full swap creates more one-time documentation work, but it keeps runtime lists, audit output, dashboard labels, and installer behavior aligned with what goat-flow can actually support.

## Reversibility

The product choice is a two-way door: Gemini can return only through a new ADR that re-adds it to `KNOWN_AGENT_IDS`, `workflow/manifest.json`, setup docs, hooks, installed mirrors, and dashboard/audit surfaces. The existing v1.8.0 migration is not partially reversible; reintroducing Gemini as a current runtime requires a fresh support pass rather than resurrecting stale files.

## References

- Commit `3bc982de` (`refactor: replace 'gemini' references with 'antigravity' across configuration and documentation`)
- `src/cli/types.ts` (search: `KNOWN_AGENT_IDS`)
- `workflow/manifest.json` (search: `"antigravity"`)
- `.goat-flow/footguns/docs-and-crossrefs.md` (search: `Prose examples for agent-specific paths drift`)
