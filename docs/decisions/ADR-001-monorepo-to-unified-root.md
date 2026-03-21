# ADR-001: Move CLI from cli/ subdirectory to unified root layout

**Date:** 2026-03-21
**Status:** Accepted

## Context

The CLI scanner (`@blundergoat/goat-flow`) lived in a `cli/` subdirectory with its own `package.json`, `tsconfig.json`, and `node_modules/`. This caused friction:

- Self-scan required `node dist/cli.js ..` — reaching up to the parent to scan its own project.
- Every npm/tsc command required `cd cli/` first.
- The upcoming HTML dashboard (M3) had no natural home — nesting it inside `cli/` would be wrong since the dashboard is a peer, not a child.
- Contributors had to know the CLI was nested before they could build or test.

## Decision

Move all CLI source to `src/cli/`, tests to `test/`, and config to root. Create `src/dashboard/` as a peer directory for M3. Single `package.json` at root.

```
src/cli/        — scanner, evaluators, scoring, prompts (33 .ts files)
src/dashboard/  — Tailwind HTML dashboard (M3, empty until built)
test/           — all tests (82 tests across 18 suites)
package.json    — single package at root
tsconfig.json   — rootDir: src, outDir: dist
```

`dist/cli/cli.js` is the bin entry point. `dist/cli/index.js` is the library export.

## Consequences

- Self-scan is now `node dist/cli/cli.js .` — scans itself, no parent reference.
- One `npm install`, one `npm test` from root.
- Dashboard gets first-class citizenship at `src/dashboard/` — neither nested inside nor above the CLI.
- Bin path is `dist/cli/cli.js` instead of `dist/cli.js` — slightly longer but users never see it (they use `npx`).
- All test imports changed from `../../src/` to `../../src/cli/` (4 files, mechanical change).
