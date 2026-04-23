---
category: cli
last_reviewed: 2026-04-24
---

## Footgun: ESM main-module guard breaks under symlinks

**Status:** active | **Created:** 2026-04-24 | **Evidence:** ACTUAL_MEASURED

`path.resolve()` does not follow symlinks, but Node's ESM loader resolves symlinks for `import.meta.url` by default (via `--preserve-symlinks-main=false`). Any main-module guard that compares `resolve(process.argv[1])` against `fileURLToPath(import.meta.url)` silently fails when the script is invoked through a symlink — which is always the case for npm-installed CLIs, because `node_modules/.bin/<name>` is a symlink to the package's bin entry.

**Symptoms:** CLI exits 0 with zero output. No error, no stderr. Downstream scripts that spawn the CLI see the child die immediately with no diagnostic. Only direct invocation via `node dist/cli/cli.js` works.

**Why it happens:** npm creates `node_modules/.bin/goat-flow` → `../@blundergoat/goat-flow/dist/cli/cli.js`. When the shell launches the symlink via shebang, `process.argv[1]` is the symlink path. `resolve()` normalizes it but does not follow the symlink. Meanwhile `import.meta.url` points at the real file because Node's ESM loader follows symlinks by default. The two paths differ, the guard evaluates false, and `main()` never runs.

**Evidence:**
- `src/cli/cli.ts` (search: `isMainModule`) — the fixed guard uses `realpathSync()` on both sides to normalize through symlinks.
- `test/integration/main-guard.test.ts` (search: `launched through a symlink`) — regression test that creates a temp-dir symlink and verifies the CLI produces output.
- Commit 918ca3e introduced the broken guard; the fix adds `realpathSync` to resolve both paths canonically before comparison.

**Prevention:**
1. Never compare `resolve(process.argv[1])` directly to `fileURLToPath(import.meta.url)`. Always wrap both sides in `realpathSync()`.
2. `test/integration/main-guard.test.ts` locks this in — any future change to the entry-point guard must pass the symlink test.
3. When Node 24+ is the minimum, replace the entire guard with `import.meta.main`.
