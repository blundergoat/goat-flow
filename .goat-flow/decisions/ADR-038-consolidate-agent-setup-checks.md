# ADR-038: Consolidate agent setup checks from 9 to 4

**Date:** 2026-04-14
**Status:** Implemented

## Context

The agent setup audit (`check-agent-setup.ts`) had 9 individual checks that were hard to follow. Several checked related things - e.g., `canonical-skills`, `skill-versions`, and `deprecated-skills-present` all validate skills. `deny-hook-present`, `hook-syntax`, and `deny-patterns` all validate the deny hook. The flat list made the dashboard noisy and the check inventory hard to scan.

## Decision

Consolidate from 9 individual checks to 4 grouped checks:

1. **`agent-instruction`** - instruction file exists (--agent mode) or no orphaned artifacts (aggregate mode)
2. **`agent-skills`** - all 7 canonical skills installed, versions match AUDIT_VERSION, no deprecated directories
3. **`agent-settings`** - settings file is valid JSON
4. **`agent-deny-hook`** - deny hook exists, hook scripts pass `bash -n`, at least one deny pattern registered

Each grouped check runs sub-validations sequentially and returns the first failure. This means a project with multiple issues in the same group sees one at a time - fix, re-audit, see the next. This is acceptable because the issues are ordered by severity within each group.

## Also removed

- **`agents-supported`** - hardcoded allowlist of agent names, unnecessary
- **`instruction-files`** - dead code, could never fail (detection requires the file to exist)
- **`workflow-path-leaks`** - impossible if skills are verbatim copies from `workflow/skills/`

## Renamed for clarity

- `configured-agent-present` → `agent-instruction` (part of grouped check)
- `stale-skill-dirs` → deprecated skills validation (part of `agent-skills`)
- `hook-files-exist` → deny hook validation (part of `agent-deny-hook`)

## Consequences

- Build check count: 16 → 8 (4 setup + 4 agent)
- Dashboard shows 4 agent checks instead of 9
- Check IDs changed - `compose-setup.ts` check-to-step mapping updated
- Tests updated to reference new IDs
