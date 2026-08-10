# Testing

The test suite uses Node's built-in test runner (`node:test` + `node:assert`). No external test framework.

## Running tests

```bash
npm test                          # Fast suite; excludes slow, dashboard, and perf tests
npm run test:slow                 # Builds first, then the slow suite at concurrency 1
npm run test:full                 # Fast then slow; run this before a release
npm run typecheck                 # Type-check src/cli and src/dashboard
npx eslint src/cli src/dashboard  # Lint
bash scripts/preflight-checks.sh  # Full preflight gate (includes all of the above)
```

`npm test` is not the whole suite. `scripts/run-tests.mjs` routes integration,
dashboard, audit-drift, and a few known-heavy unit files to `test:slow` so local
iteration stays quick. A change that touches the dashboard server, the installer,
or drift detection is only covered once `test:slow` has run.

## Test structure

Tests live in `test/` with subdirectories:

- `unit/` - config reader, CLI parsing, manifest, hooks, plans, learning loop, and the `audit-command/`, `audit-harness/`, `skill-quality/`, and `dashboard-terminal-launch/` groups
- `integration/` - audit build and quality runs, installer round-trips, drift detection, deny-policy enforcement, and the dashboard HTTP/WebSocket API
- `contract/` - cross-surface consistency: skill hardening per skill, command phrasing, ADR-023 word budgets, coding-standard drift, and the local-data contract
- `smoke/` - dashboard and terminal export surfaces plus the session concurrency cap
- `fixtures/` - test data for isolated check evaluation

## What the tests guard

- Audit output has no scan references
- Step 06 references audit (not scanner)
- package.json version matches AUDIT_VERSION
- SKILL_NAMES matches manifest.json canonical skills
- Build check IDs are unique
- Quality checks cover all 5 harness concerns
- manifest.json paths use .goat-flow/ prefix
- Skill templates do not reference workflow/ in install sections
- Build/quality checks produce correct results on healthy and broken projects
- Config reader handles valid YAML, invalid YAML, and missing files
- CLI parsing: audit is default, scan is rejected, removed flags rejected
- Quality prompt generates non-empty output with required sections
