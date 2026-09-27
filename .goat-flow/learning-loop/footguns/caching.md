---
category: caching
last_reviewed: 2026-09-05
---

## Footgun: TTL'd cache invalidation MUST travel with every writer, not just the writer the bug surfaced from

**Status:** active | **Created:** 2026-05-25 | **Evidence:** EXTERNAL_REFERENCE

**Prevention:**
1. When introducing or modifying a TTL'd or memoized cache, grep every mutator of the underlying resource (insert, update, delete, bulk import, reset, reload) and add invalidation to each in the same change. A fix that patches only the writer you observed will recur within weeks.
2. Co-locate `set` and `clear`: when a cache is module-private, export its `clearX()` directly beneath it so any writer importing the cache sees the invalidator.
3. When a cache exports a reset such as `resetManifestCache`, the set of callers must equal the set of mutators; a mutator with no reset call is the bug.
4. A test for a new mutator against a cached resource asserts the cache returns the post-mutation value.

**Symptoms:** A read-side cache returns stale data after a write completes, then self-heals at TTL expiry, so the bug looks transient and timing-dependent. Count-style caches are worst: callers see plausible wrong totals with no way to tell fresh from stale.

**Why it happens:** The developer who adds a cache adds invalidation to the path they observe. Other mutators in other files never import the invalidation primitive because the cache is not visible from there.

**Evidence:** External, promptfoo PRs #9421 and #9431 (May 2026): `getCachedResultsCount()` was cached with a 5-minute TTL, the insert paths never invalidated it, and after that two-line fix the delete path `deleteErrorResults()` shipped the same bug because it lived in a different file. Local caches, re-read 2026-08-01: `src/cli/facts/fs.ts` (search: `contentCache`, `existsCache`, `directoryReadCache`, `globCache`) are four `Map`s closure-scoped inside their factories, so one facts pass cannot serve another stale data, and the exposure returns the moment an adapter outlives a pass, for example a file-watcher refresh. `src/cli/manifest/manifest.ts` (search: `resetManifestCache`) exports an invalidator that every manifest mutator must call. `src/cli/server/dashboard-assets.ts` (search: `dashboardAssetCache`) is a module-level `Map` that dev-mode source watchers must invalidate.
