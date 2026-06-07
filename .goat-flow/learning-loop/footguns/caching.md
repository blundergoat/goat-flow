---
category: caching
last_reviewed: 2026-05-25
---

## Footgun: TTL'd cache invalidation MUST travel with every writer, not just the writer the bug surfaced from

**Status:** active | **Created:** 2026-05-25 | **Evidence:** EXTERNAL_REFERENCE

**Symptoms:** A read-side cache returns stale data after a write completes. The cache eventually self-heals at TTL expiry, so the bug looks transient: "metrics seem stale right after I retry, but they come good after a few minutes." Repros are timing-dependent and easy to dismiss. Particularly insidious for COUNT-style caches (row counts, fact counts, artifact counts) — callers see plausible but wrong totals and have no way to tell whether the count is fresh or stale.

**Why it happens:** Caches are usually conceived as a read-side optimization. The writer who introduces the cache adds invalidation to the path they observe. Other mutators in different files (insert vs delete vs bulk-import vs config-reload vs cleanup) do not import the invalidation primitive because the cache module's existence isn't visible from those files. The cache definition stays in one place; the invalidators are scattered across every mutation site. A single missed callsite ages stale until TTL.

**Evidence (external — promptfoo PR #9421 + #9431):**
- PR #9421 (merged 2026-05-24, `mldangelo`): `getCachedResultsCount()` / `getTotalResultRowCount()` cached with 5-min TTL. Insert paths `createFromEvaluateResult` and `createManyFromEvaluateResult` never invalidated. Two-line fix: import `clearCountCache`, call after each insert.
- PR #9431 (merged shortly after, same project): `deleteErrorResults()` had the SAME bug class. The fix had to discover affected eval IDs via `selectDistinct` before deletion, then loop `clearCountCache(evalId)` after the batched delete. Sharing / metrics observed stale totals after retry cleanup.
- Together: the same cache-invalidation bug shipped TWICE in the same product because the first fix only patched the writer the team observed (insert). Delete was a different file and never got the import. Strong evidence that "fix the one I saw" isn't enough for cache invalidation.

**Goat-flow applicability — HIGH:** Goat-flow has at least three caches with explicit invalidation surfaces, each currently safe only because their writer set is small:
- `src/cli/facts/fs.ts` (search: `contentCache`, `existsCache`, `listDirCache`, `globCache`) — four module-level `Map`s. Today they're seeded inside the facts collection pass and never mutated externally, but any future "refresh on file watcher event" or "invalidate on write through audit" would need to know about all four.
- `src/cli/manifest/manifest.ts` (search: `resetManifestCache`) — already exports an invalidator, which means callers are EXPECTED to call it. Every place that mutates the underlying manifest JSON (CLI commands, install script, repair routines) MUST grep-confirm it calls `resetManifestCache()`.
- `src/cli/server/dashboard-assets.ts` (search: `dashboardAssetCache`) — module-level `Map`. Dev-mode source watchers must invalidate; production never mutates.

**Prevention:**
1. When introducing or modifying a TTL'd or memoized cache, do ONE grep before committing: `rg -n "<table_or_artifact_name>" src/ --type ts` and audit every mutator (insert/update/delete/bulk/import/reset/reload). Add invalidation to each one in the SAME PR. If you ship a fix that only patches the writer you observed, expect the second occurrence within weeks.
2. Co-locate `set` and `clear` callsites where possible. If the cache is module-private (a `Map` declared at module top), put its `clearX()` export immediately under it so any writer importing the cache also sees the invalidator one screen away.
3. When a cache exports `resetXCache()` (e.g., `resetManifestCache`), search for every reference: `rg -n "resetManifestCache" src/`. The set of callers should equal the set of mutators of the underlying resource. If there's a mutator with no reset call, that's the bug — fix before the user reports stale data.
4. Contract test pattern: when a new mutator function is added against a cached resource, the test that exercises it should also assert the cache returns the post-mutation value (not the pre-mutation cached value). The test fails if the invalidator is missing.
