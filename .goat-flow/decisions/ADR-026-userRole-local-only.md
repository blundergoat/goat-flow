## ADR-026: userRole is local-only config, not committed

**Supersession note (M13):** The old gitignored local config file was removed in M13. `config.yaml` is now the only machine-readable config file.

**Status:** accepted
**Created:** 2026-04-05

### Context

`userRole` controls dispatcher routing and skill ceremony level (developer, investigator, tester). Contract tests in `test/contract/autonomous-and-modes.test.ts` originally asserted that the project's own `.goat-flow/config.yaml` contained `userRole: developer`.

This broke CI because `userRole` was intentionally removed from the committed config - it's a per-user preference (like editor theme), not a project setting.

### Decision

- `userRole` is optional in `config.yaml`. When absent, the config reader defaults to `'developer'`.
- Prior to M13, `userRole` was intended to live in a gitignored local config file. That file no longer exists.
- Contract tests verify that the config reader supports `userRole` and defaults correctly - they do NOT assert that the project config file contains the field.

### Consequences

- Users set `userRole` locally without affecting the team's committed config.
- The config reader (`src/cli/config/reader.ts`) owns the default, not the config file.
- Tests that check config shape must distinguish between "reader supports X" and "project file contains X".
- Local personal preferences are not stored in the config file.
