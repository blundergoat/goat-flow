# ADR-015: Scanner Incentive Alignment -- Allow Abstract Rules

**Date:** 2026-03-28
**Status:** Accepted

## Context

halaxy-agents-lab's Never tier originally contained a specific, high-quality rule: "MUST NOT modify .env with credentials." To pass the scanner's AP13 path-resolution check, the project weakened this to the vaguer "env files." The scanner incentivized a worse instruction rule.

AP13 currently checks that backtick-wrapped paths in instruction files resolve to real files in the project. This is valuable for catching stale references (e.g., a footgun citing `src/old-module.ts` that was renamed). But it fails on deny-list patterns — entries like `.env`, `*.pem`, or `credentials.json` that describe file types to avoid, not specific files that should exist.

The scanner should not penalize projects for writing good security rules that reference files that intentionally do not (and should not) exist.

## Decision

AP13 should skip paths that are clearly abstract rules rather than literal file references.

Heuristic: if a backtick-wrapped path matches any of these patterns, skip the path-resolution check:
- Contains no `/` directory separator (e.g., `.env`, `credentials.json`) — these are file-type references, not project paths
- Matches a known deny-list pattern (`.env*`, `*.pem`, `*.key`, `*.secret`, `*.credentials`)
- Contains glob wildcards (`*`, `?`) — already partially implemented

AP13 only performs path resolution on paths with directory separators that look like actual project file references (e.g., `src/config/database.ts`, `docs/footguns.md`).

## Consequences

- Implement in M03.2 as part of AP13 refinement in the scanner
- Existing AP13 glob-skipping logic is extended, not replaced
- Projects can write specific deny-list rules (`.env with credentials`, `*.pem files`) without scanner penalty
- The heuristic may need tuning — edge cases (e.g., `config/` as a deny-list pattern for a directory) should be tracked and addressed
- No changes to other scanner checks; this is AP13-specific
