---
category: dashboard-testing
last_reviewed: 2026-09-05
---

**Scope:** Testing the dashboard as a built, served application - stale dist copies, servers needing a restart after template edits, Knip registration for classic scripts, route-scoped verification, and performance probes that need the real shell. Asserting against source and VM-loaded helpers is [dashboard-unit-tests.md](dashboard-unit-tests.md); proving a provider actually delivers hook feedback is [hook-testing.md](hook-testing.md).

## Lesson: Dashboard release QA should avoid real agent runners unless runner behavior is the target

**Status:** active | **Created:** 2026-05-10

**Prevention:** For manual dashboard page and modal sweeps, do not click runner launch buttons unless terminal runner behaviour is the explicit target; prefer browser-use state checks of the empty Workspace, `/api/terminal/sessions`, or a non-agent harness. Trigger Alpine state through browser-use Python or CDP instead of starting ten runner sessions for the max-session modal. When terminal launch is in scope, snapshot `git status --short` before and after, then close the session immediately. Evidence anchors: `src/dashboard/views/workspace.html` (search: `launchInTerminal('', activeRunner`), `src/dashboard/dashboard-terminal-runtime.ts` (search: `async function dashboardLaunchInTerminal`).

**What happened:** During v1.6.0 browser-use manual QA, clicking Workspace `Open terminal` launched a real Claude Code session in the selected project; before cleanup `git status --short` showed a tracked diff in `docs/dashboard.md` adding a temporary `### Skills` section that was not part of the QA request.

**Root cause:** The terminal launch was treated as a harmless UI smoke, but the dashboard terminal starts a real agent process that can attach to existing agent state and mutate the repository.

---

## Lesson: Slow verification can expose unrelated dashboard doc drift

**Status:** active | **Created:** 2026-05-09
**Incident count:** 4 | **Latest occurrence:** 2026-05-18

**Prevention:** When `npm run test:slow` or preflight fails during unrelated verification, separate task-local regressions from repo-wide drift before changing code. For dashboard view drift, compare `workflow/manifest.json` (search: `dashboard_views`) against `.goat-flow/architecture.md` (search: `Page views`), then rerun both `bash scripts/preflight-checks.sh` and `npm run test:slow` after the doc correction.

**What happened:** While double-checking an unrelated Codex config fix, `npm run test:slow` failed in `checkDrift: installer round-trip fixture` because the temp repo's preflight reported `Dashboard view names drift between manifest and architecture prose`; the Codex fix was clean and the blocker was stale architecture prose missing the `skill` view in both required snippets.

**Root cause:** The broad slow suite was treated as a final confirmation step, but it also runs repo-wide cold-path truth checks through `scripts/preflight-checks.sh`, which surface committed doc drift focused tests never touch.

**Recurrence 2026-05-10:** A v1.6.0 CLI release smoke hit the same class through `audit . --check-content`: `Cold-Path Content Lint` failed because `docs/dashboard.md` listed dashboard headings without the manifest-backed `skills` view, and adding the section produced `PASS (0 warning(s), 9 info, 177 file(s) scanned)`.
**Recurrence 2026-05-15:** A focused dashboard route test failed before reaching `/api/tasks` because `validateManifest` reported `facts.dashboard_views drift` after the then-current tasks view and a `coming-soon` view (both since removed or renamed, the tasks route to `src/dashboard/views/plans.html`) were added; both names had to reach `workflow/manifest.json` and the two architecture lists first.
**Recurrence 2026-05-18:** During the v1.7.0 bump, `audit . --check-drift --check-content` failed after the scripted version surfaces were consistent, on cold-path drift around the manifest-backed `coming-soon` view and on `docs/audit-and-quality.md` (search: `Verification:           PASS (4/4)`) not tracking the Verification concern's growth to four checks.

---

## Lesson: Classic dashboard script splits need Knip ignore coverage

**Status:** active | **Created:** 2026-04-21
**Decision changed:** Register a new dashboard classic script in `knip.json` and `src/dashboard/index.html` in the change that creates it, and run the repository Knip command before trusting preflight.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 2 | **Latest occurrence:** 2026-04-25
**Merged:** 2026-09-05 - absorbed "Dashboard classic scripts need Knip registration" (2026-04-25); one root cause, HTML-loaded scripts are invisible to the module graph.

**Prevention:** When adding a `src/dashboard/*.ts` classic script, update `src/dashboard/index.html`, add the built asset smoke, and register the source file in `knip.json` in the same change. Run the repository Knip command before relying on preflight; dashboard typecheck and asset tests cannot see reachability. After adding optional decoder branches, run `npx eslint src/cli src/dashboard` rather than treating `npm run typecheck` as enough. Evidence anchors: `knip.json` (search: `dashboard-custom-prompts.ts`), `src/cli/server/decoders.ts` (search: `decodeOptionalStringField`).

**What happened:** Splitting `src/dashboard/app.ts` into further classic browser scripts passed dashboard typecheck and server asset tests, but Knip flagged the new script-tag files as unused because `src/dashboard/index.html` loads them rather than TypeScript importing them.

**Root cause:** The dashboard frontend intentionally uses classic scripts (`x-data="app()"`) and shared browser globals, so Knip follows module imports and never sees HTML script-tag reachability; `knip.json` is the only place that records the intent.

**Recurrence 2026-04-25:** M03 added `src/dashboard/dashboard-custom-prompts.ts` and loaded it from the HTML shell; focused tests and typecheck passed, but the installer round-trip preflight reported the file unused, and the same run caught an ESLint complexity error in `src/cli/server/decoders.ts` after the terminal-create payload grew another optional field.

---

## Lesson: Dashboard asset tests can read stale dist copies

**Status:** active | **Created:** 2026-04-25
**Decision changed:** Refresh the built dashboard asset before any test that can read it, and clean `dist` when the change renames or removes a generated file.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 4 | **Latest occurrence:** 2026-08-29
**Merged:** 2026-09-05 - absorbed "Dashboard asset renames need a clean dist build" (2026-05-31) from `.goat-flow/learning-loop/lessons/refactor-fallout.md`; both are the built copy disagreeing with source.

**Prevention:** After changing dashboard static assets copied by `build:dashboard`, run `npm run build:dashboard` before dashboard-server asset smoke tests and before the first expanded suite, not after a favourable focused run. When the change renames or deletes a generated asset, run the full `npm run build` or clean `dist` first, because `build:dashboard` compiles and copies without removing `dist/dashboard`; then grep `dist` for the old filenames. Evidence anchors: `package.json` (search: `rmSync('dist', { recursive: true, force: true })`), `package.json` (search: `tsconfig.dashboard.json && node scripts/build-dashboard-assets.mjs`).

**What happened:** M02 added metadata to `src/dashboard/preset-prompts.json` and the JSON and unit checks passed, but the focused `dashboard assets` integration test failed because `/assets/preset-prompts.json` served the existing `dist/dashboard/preset-prompts.json` copy without the new metadata.

**Root cause:** The dashboard server prefers the built copy when it exists, and source edits plus `npm run typecheck` never refresh it, so a local `dist/` makes source-run tests verify stale data.

**Recurrence 2026-05-31:** Renaming dashboard app fragment files, `npm run build:dashboard` compiled the new descriptive `dashboard-app-*.js` files but left the old generated numbered assets in `dist/dashboard`, because only the full build cleans `dist` first.
**Recurrence 2026-08-14:** M03 changed the four QA-facing records in the preset catalog; focused preset and doctrine tests passed, but a later full-suite run failed the source/dist parity contract because the built copy still held the earlier catalog. `test/contract/skill-hardening-security-2.test.ts` (search: `dashboard preset source/dist parity`).
**Recurrence 2026-08-29:** M68 changed the Coverage Audit preset and its focused unit contract, and the first full `npm test` failed the same parity contract until `npm run build:dashboard` ran before repeating it. `src/dashboard/preset-prompts.json` (search: `blocking-gate contract`).

---

## Lesson: Built dashboard browser smoke needs a restarted server after template edits

**Status:** active | **Created:** 2026-05-15

**Prevention:** After changing dashboard HTML or view templates, run `npm run build:dashboard`, restart the built dashboard server, then repeat the browser-use smoke against the new URL. Evidence anchors: `src/cli/server/dashboard.ts` (search: `let cachedTemplate`), `src/cli/server/dashboard.ts` (search: `assembleDashboardHtml(shellPath)`), `src/dashboard/views/plans.html` (search: `gf-set-active-task-plan`).

**What happened:** While adding the Plans active-plan toggle, the browser smoke kept showing the old direct Alpine handlers after `npm run build:dashboard`. Clicking the flag wrote `.goat-flow/plans/.active`, but the visible marker stayed stale until a manual refresh; after restarting `node dist/cli/cli.js dashboard .`, the new dispatched handlers appeared and the marker flipped from `1.7.0` to `_archived` and back.

**Root cause:** `serveDashboard()` caches the assembled HTML at startup when dev mode is off, so rebuilding the view file on disk does not change what a running built server serves.

---

## Lesson: Dashboard audit-route fixes need route-scoped verification, not the full server suite

**Status:** active | **Created:** 2026-04-29

**Prevention:** For dashboard audit-path fixes, verify the exact `/api/audit` contract first: run the `/api/audit`-only test slice and a direct localhost fetch against `serveDashboard()`. Use the broader dashboard suite only as a follow-up when the slower routes are relevant. Evidence anchors: `test/integration/dashboard-audit-api.test.ts` (search: `describe("dashboard /api/audit"`), `test/integration/quality-constraint-isolation.test.ts` (search: `dashboard home audit refresh`), `src/cli/server/dashboard-audit-routes.ts` (search: `denyMechanismEvidenceLevel`).

**What happened:** Fixing the Home page's multi-minute `Auditing...` stall, the first verification used the entire dashboard-server suite as the gate; that suite includes endpoints deliberately slower than the Home summary path, so the run timed out before producing a pass or fail signal for the changed route.

**Root cause:** The verification scope was wider than the code change, which diluted the signal and made a timeout look like uncertainty in the changed path.

---

## Lesson: Shell-backed performance probes must use the real shell environment

**Status:** active | **Created:** 2026-04-29

**Prevention:** For shell-backed audit or hook performance work, capture timings in an environment that can actually run the shell command before updating docs or naming the bottleneck. Prefer a built `dist` dashboard probe plus a focused integration test, and compare fresh against cached requests explicitly when a new cache is involved. Evidence anchors: `src/cli/server/dashboard-audit-routes.ts` (search: `const fresh = url.searchParams.get("fresh") === "true";`), `src/cli/server/dashboard-quality-routes.ts` (search: `function readQualityAuditCache`), `src/cli/audit/check-agent-deny-mechanism.ts` (search: `execFileSync("bash", [denyPath, "--self-test=smoke"]`).

**What happened:** Optimizing `/api/quality`, localhost timing probes inside the sandbox made the route look subsecond, about 379 ms with `runAudit` near 160 ms, and led to a bad footgun draft. A later probe against the built dashboard outside the sandbox measured fresh `?fresh=true` requests at about 30,573 ms and 30,182 ms, with only the cached repeat near 5 ms.

**Root cause:** A sandbox timing probe was treated as representative for a route that shells out to `bash` through the deny-hook self-test; the sandbox path can understate real latency or skip the expensive branch entirely.

---

## Lesson: Dashboard endpoint benchmarks need HTTP client warmup

**Status:** active | **Created:** 2026-04-29

**Prevention:** Declare server cache state (`fresh` or `cached`) and client state (`cold` or `warmed`) separately before sampling, and never combine them into one series. Warm the client with a cheap request such as `/api/health`, then measure fresh and cached series independently. If client-visible time and server-side profile spans differ by orders of magnitude, find the unprofiled client or setup overhead before recording the timing. This incident establishes the warmup and cache-state controls, not a reusable latency threshold; the shared evidence matrix owns iteration count, median, spread, and correctness. Evidence anchor: `scripts/profile-dashboard-audit.mjs` (search: `await fetch(\`${baseUrl}/api/health\`)`).

**What happened:** The first cached `/api/audit?quality=true` benchmark in `scripts/profile-dashboard-audit.mjs` reported about `1375ms` while server-side profile spans totalled about `17ms`; the route was cached and fast, and the first Node `fetch()` carried client and session warmup.

**Root cause:** The benchmark process's first HTTP request was treated as representative endpoint time, mixing one-time client setup with the route being measured.
