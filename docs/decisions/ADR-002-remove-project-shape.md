# ADR-002: Remove project shape (app/library/collection) from scoring

**Date:** 2026-03-21
**Status:** Accepted

## Context

The scanner originally detected project shape (app, library, collection) from package manifests and used it to gate checks. Permission Profile checks (3.3.1-3.3.3) were N/A for libraries and collections but active for apps. A `--shape` CLI flag allowed overriding detection.

In practice this caused problems:
- The only shape-gated checks were Permission Profiles, which turned out to be create-on-first-use for all projects — not just libraries
- `--shape app` vs no flag produced different scores for the same project, confusing users
- The shape detection heuristics were fragile (Go projects always defaulted to app, the `exports` field in package.json doesn't reliably indicate a library)
- No rubric check other than profiles ever used shape, making the entire detection pipeline dead weight

## Decision

Remove project shape entirely:
- Delete `detect/shape.ts` and `ProjectShape` type
- Remove `--shape` CLI flag
- Make Permission Profile checks (3.3.1-3.3.3) always N/A (create-on-first-use)
- Remove shape from `ProjectFacts`, `ScanReport`, text renderer, and prompt variables
- All projects scored identically regardless of manifest structure

## Consequences

- Same project always produces the same score — no confusing shape-dependent differences
- `--shape` flag is gone — one less thing to explain to users
- Shape detection code deleted — less code to maintain
- If future rubric versions need shape-specific checks, the detection will need to be re-added. This is acceptable because no such check has been identified after 7+ real implementations across apps, libraries, and script collections
- The `detect/` directory still contains `agents.ts` and `stack.ts` — shape was the only detector removed
