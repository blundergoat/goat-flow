---
category: dashboard-testing
last_reviewed: 2026-05-18
---

## Lesson: Dashboard release QA should avoid real agent runners unless runner behavior is the target

**Status:** active | **Created:** 2026-05-10

**What happened:** During v1.6.0 browser-use manual dashboard QA, clicking Workspace `Open terminal` launched a real Claude Code session in the selected project. Before cleanup, `git status --short` showed an unexpected tracked diff in `docs/dashboard.md` adding a temporary `### Skills` section that was not part of the QA request; the diff was removed to restore the read-only testing scope.

**Root cause:** I treated the terminal launch as a harmless UI smoke, but the dashboard terminal starts a real agent process in the selected project. For release QA that only needs Workspace layout and session controls, a real runner can attach to existing agent state and mutate the repository.

**Prevention:** For manual dashboard page/modal sweeps, do not click runner launch buttons unless terminal runner behavior is the explicit target. Prefer browser-use state checks of the empty Workspace, `/api/terminal/sessions`, or a non-agent test harness. If the max-session modal needs coverage, trigger Alpine state via browser-use Python/CDP instead of starting ten runner sessions. When terminal launch is in scope, snapshot `git status --short` before and after, then close the session immediately. Evidence anchors: `src/dashboard/views/workspace.html` (search: `launchInTerminal('', activeRunner`), `src/dashboard/dashboard-terminal.ts` (search: `async function dashboardLaunchInTerminal`).

---

## Lesson: Slow verification can expose unrelated dashboard doc drift

**Status:** active | **Created:** 2026-05-09

**What happened:** While double-checking an unrelated Codex config fix, `npm run test:slow` failed in `checkDrift: installer round-trip fixture` because the temp repo's preflight reported `Dashboard view names drift between manifest and architecture prose`. The Codex fix was clean; the blocker was stale `.goat-flow/architecture.md` prose missing the `skill` dashboard view in both required snippets.

**2026-05-10 recurrence:** Manual v1.6.0 CLI release smoke hit the same class through `node dist/cli/cli.js audit . --check-content --format text`: `Cold-Path Content Lint` failed because `docs/dashboard.md` listed dashboard headings without the manifest-backed `skills` view. Adding the missing `### Skills` section changed the check to `Cold-Path Content Lint: PASS (0 warning(s), 9 info, 177 file(s) scanned)`.

**2026-05-15 recurrence:** During M00 side-menu execution, the focused dashboard route test failed before reaching `/api/tasks` because `validateManifest` reported `facts.dashboard_views drift` after `src/dashboard/views/tasks.html` and `src/dashboard/views/coming-soon.html` were added. The fix was to add both view names to `workflow/manifest.json` and update the two dashboard view lists in `.goat-flow/architecture.md` before rerunning the route slice.

**2026-05-18 recurrence:** During the v1.7.0 version bump, `node --import tsx src/cli/cli.ts audit . --check-drift --check-content --format json` failed after the scripted version surfaces were already consistent. The remaining warnings were cold-path doc drift around the manifest-backed `coming-soon` view (`src/dashboard/views/coming-soon.html` (search: `Coming Soon Destinations`)) and `docs/audit-and-quality.md` (search: `Verification:           PASS (4/4)`) not being updated after the Verification harness concern grew to 4 checks. The fix was to align both doc claims, then rerun the content audit.

**Root cause:** I treated the broad slow suite as a final confirmation step, but it also runs repo-wide cold-path truth checks through `scripts/preflight-checks.sh`. Those checks can surface unrelated committed dashboard doc drift that focused tests do not touch.

**Prevention:** When `npm run test:slow` or preflight fails during unrelated verification, separate task-local regressions from repo-wide drift before changing code. For dashboard view drift, compare `workflow/manifest.json` (search: `dashboard_views`) against `.goat-flow/architecture.md` (search: `views for`, `Page views`) and rerun both `bash scripts/preflight-checks.sh` and `npm run test:slow` after the doc correction.

---

## Lesson: Dashboard readers must preserve fields used by score logic

**Status:** active | **Created:** 2026-05-01

**What happened:** The Home, Quality, and Setup pages showed every harness concern at 100 and "All checks passing", but still showed each agent at 94%. The API payload correctly marked `test-runner-configured` as a failing `metric` check, but the dashboard reader dropped the field that lets views treat metric evidence differently from ordinary audit failures.

**Root cause:** The browser-side dashboard reader dropped `check.type` when decoding `/api/audit` payloads. Later, the opposite bug appeared in the view layer: filtering metrics out of dashboard percentages hid score-only verification gaps and restored misleading 100% headlines.

**Prevention:** When dashboard views derive percentages from API fields, add a regression that proves both the reader and the rendered summary preserve score-only warnings. Browser evidence must check summary cards, concern rows, and the "All checks passing" label because those are separate computations. Verify the rendered dashboard against the built `dist/` assets, not source only. Evidence anchors: `src/dashboard/dashboard-readers.ts` (search: `value.type === "metric"`), `test/unit/dashboard-readers.test.ts` (search: `preserves harness check type so metric failures can be shown as non-gating score evidence`), `test/unit/dashboard-home.test.ts` (search: `surfaces score-only metric warnings`).

---

## Lesson: VM helper tests need same-realm assertions

**Status:** active | **Created:** 2026-04-25

**What happened:** M03 added a VM-loaded browser helper test for `dashboard-custom-prompts.ts`. The first focused run failed even though the expected and actual arrays had the same printed contents, because `assert.deepEqual` compared an array created inside the VM realm against a host-realm array literal.

**Current recurrence:** On 2026-05-02, custom prompt form tests repeated this trap for validation arrays, surface tag arrays, and flag group arrays returned from the VM context. On 2026-05-16, the manifest-backed runner hint test hit the same issue for `dashboardValidateCustomPromptDraft(ctx)`. The helper behavior was correct; the assertions needed `Array.from(...)` or scalar field comparisons.

**Root cause:** The test executed browser helper code in `node:vm` to avoid changing classic-script exports, but the assertion treated cross-realm arrays like normal host arrays.

**Prevention:** When testing browser classic-script helpers through `node:vm`, normalize VM-produced arrays/objects with host constructors before strict structural assertions, or compare scalar fields. Evidence anchor: `test/unit/dashboard-custom-prompts.test.ts` (search: `Array.from(helpers.dashboardValidateCustomPromptDraft(ctx))`).

---

## Lesson: Dashboard row metadata should not widen UI sort contracts

**Status:** active | **Created:** 2026-05-16

**What happened:** While adding stable dashboard project identity, `npm run typecheck` failed after `ProjectEntry` gained optional identity metadata and `paths?: string[]`. `ProjectSortKey` was defined as `"name" | keyof ProjectEntry`, so adding non-string fields widened sort values to `string | string[] | undefined` and broke `localeCompare`. The first dashboard integration rerun also failed because the roundtrip test asserted exact `paths` array order even though identity grouping made alias order incidental.

**Root cause:** I treated `ProjectEntry` as both the UI row model and the sortable-column contract. Extending the row shape for identity metadata unintentionally changed the sort type. The test had the same path-only assumption: it verified array order rather than the durable property, which is that all aliases are preserved under one identity-keyed record.

**Prevention:** When adding metadata fields to dashboard row types, keep `ProjectSortKey` as an explicit union of sortable string columns. For identity or alias migrations, assert identity grouping, alias set membership, and title preservation; do not assert incidental path-array ordering unless the ordering is part of the product contract. Evidence anchors: `src/dashboard/app.ts` (search: `type ProjectSortKey = "name"`), `test/integration/dashboard-server.test.ts` (search: `persists project identities without raw private remote URLs`).

---

## Lesson: VM-loaded dashboard helper tests must treat `Error` objects as cross-realm too

**Status:** active | **Created:** 2026-04-29

**What happened:** While adding a focused unit test for `dashboardLaunchInTerminal()`, the runtime behavior was correct but the failure-path assertion still failed. The helper caught a VM-thrown `Error`, `instanceof Error` did not hold in the host realm, and the surfaced message became `String(err)` (`Error: xterm.js load failed`) rather than the host test's exact `err.message` expectation.

**Root cause:** I remembered the existing cross-realm array/object lesson for VM-loaded browser helpers but still treated `Error` identity as if it were shared across realms. In `node:vm`, errors have the same identity problem as arrays and plain objects.

**Prevention:**
1. In VM-loaded dashboard helper tests, compare stable error-message content or normalize the error into the host realm before strict equality checks.
2. When a helper uses `instanceof Error`, expect VM-based tests to surface the `String(err)` fallback unless the test injects same-realm errors deliberately.
3. Evidence anchors: `test/unit/dashboard-terminal-launch.test.ts` (search: `xterm.js load failed`), `src/dashboard/dashboard-terminal.ts` (search: `const msg = err instanceof Error ? err.message : String(err)`).

---

## Lesson: Classic dashboard script splits need Knip ignore coverage

**Status:** active | **Created:** 2026-04-21

**What happened:** Splitting `src/dashboard/app.ts` into additional classic browser scripts passed dashboard typecheck and server asset tests, but `npx knip --no-progress` flagged the new script-tag files as unused because they are loaded from `src/dashboard/index.html` rather than imported by TypeScript.

**Root cause:** The dashboard frontend intentionally uses classic scripts (`x-data="app()"`) and shared browser globals. Knip follows module imports, not HTML script-tag reachability, so new `src/dashboard/dashboard-*.ts` files look unused unless `knip.json` names them alongside the existing `src/dashboard/app.ts` / `globals.d.ts` ignores.

**Evidence:** `knip.json` ignore list carries the dashboard classic-script files; `src/dashboard/index.html` loads `dashboard-readers.js`, `dashboard-setup-quality.js`, `dashboard-projects.js`, `dashboard-prompts.js`, `dashboard-terminal.js`, and `app.js` in order.

**Prevention:**
1. After adding a dashboard classic-script file, add it to `knip.json` in the same change.
2. Re-run `npx knip --no-progress` before relying on preflight, because dashboard typecheck and asset tests will not catch Knip reachability gaps.

---

## Lesson: Dashboard asset tests can read stale dist copies

**Status:** active | **Created:** 2026-04-25

**What happened:** M02 added metadata to `src/dashboard/preset-prompts.json` and the JSON/unit checks passed, but the focused `dashboard assets` integration test failed because `/assets/preset-prompts.json` served the existing `dist/dashboard/preset-prompts.json` copy, which still lacked the new metadata.

**Root cause:** The dashboard server prefers `dist/dashboard/preset-prompts.json` when it exists. Source edits plus `npm run typecheck` do not refresh that built asset, so a local `dist/` directory can make focused source-run tests verify stale data.

**Prevention:** After changing dashboard static assets that are copied by `build:dashboard`, run `npm run build:dashboard` before dashboard-server asset smoke tests, or explicitly remove stale `dist/` before relying on source fallback.

---

## Lesson: Built dashboard browser smoke needs a restarted server after template edits

**Status:** active | **Created:** 2026-05-15

**What happened:** While adding the Tasks active-plan toggle, the built dashboard browser smoke kept showing the old direct Alpine handlers after `npm run build:dashboard`. Clicking the flag wrote `.goat-flow/tasks/.active`, but the visible active marker stayed stale until I manually refreshed. The running dashboard process had cached the assembled HTML before the template-handler fix landed; after restarting `node dist/cli/cli.js dashboard .`, browser-use showed the new dispatched handlers and the active marker flipped immediately from `1.7.0` to `_archived` and back.

**Root cause:** `serveDashboard()` caches `assembleDashboardHtml(shellPath)` at startup when dev mode is off. Rebuilding `dist/dashboard/views/tasks.html` updates files on disk, but an already-running built dashboard server keeps serving the old assembled shell.

**Prevention:** After changing dashboard HTML/view templates, run `npm run build:dashboard`, restart the built dashboard server, then repeat browser-use smoke against the new URL. Evidence anchors: `src/cli/server/dashboard.ts` (search: `let cachedTemplate`), `src/cli/server/dashboard.ts` (search: `assembleDashboardHtml(shellPath)`), `src/dashboard/views/tasks.html` (search: `gf-set-active-task-plan`).

---

## Lesson: Dashboard classic scripts need Knip registration

**Status:** active | **Created:** 2026-04-25

**What happened:** M03 added `src/dashboard/dashboard-custom-prompts.ts` as a browser classic-script helper and loaded it from `src/dashboard/index.html`. Focused tests and typecheck passed, but full `npm test` failed the installer round-trip preflight because Knip reported the file as unused. The same preflight also caught an ESLint complexity error in `src/cli/server/decoders.ts` after the terminal-create payload grew another optional field.

**Root cause:** Dashboard classic scripts are loaded by HTML at runtime, not imported through the TypeScript module graph. Knip only knows they are intentional because `knip.json` ignores existing dashboard classic-script entrypoints. Focused source tests do not run the full preflight lint/Knip gate.

**Prevention:** When adding a `src/dashboard/*.ts` classic script, update `src/dashboard/index.html`, add the built asset smoke, and register the source file in `knip.json`. After adding optional decoder branches, run `npx eslint src/cli src/dashboard` before treating `npm run typecheck` as enough. Evidence anchors: `knip.json` (search: `dashboard-custom-prompts.ts`), `src/cli/server/decoders.ts` (search: `decodeOptionalStringField`).

---

## Lesson: Dashboard audit-route fixes need route-scoped verification, not the full server suite

**Status:** active | **Created:** 2026-04-29

**What happened:** While fixing the Home page's multi-minute `Auditing...` stall, the first focused verification tried to use the entire `test/integration/dashboard-server.test.ts` suite as the gate. That suite still includes endpoints whose deeper behavior is intentionally slower than the Home summary path, so the broad run timed out before producing a useful pass/fail signal for the changed route.

**Root cause:** I used a verification scope wider than the code change. The fix only changed `/api/audit` summary behavior, but the suite also exercises other dashboard routes whose latency profile is different. That diluted the signal and made the timeout look like uncertainty in the changed path.

**Prevention:** For dashboard audit-path fixes, verify the exact `/api/audit` contract first: run the `/api/audit`-only test slice and a direct localhost fetch against `serveDashboard()`. Use the broader dashboard suite only as a follow-up check when the slower routes are relevant to the change. Evidence anchors: `test/integration/dashboard-server.test.ts` (search: `describe("dashboard /api/audit"`), `test/integration/quality-constraint-isolation.test.ts` (search: `dashboard home audit refresh`), `src/cli/server/dashboard-routes.ts` (search: `denyMechanismEvidenceLevel`).

---

## Lesson: Shell-backed performance probes must use the real shell environment

**Status:** active | **Created:** 2026-04-29

**What happened:** While optimizing `/api/quality`, my first localhost timing probes inside the default environment made the route look subsecond and led to a bad footgun draft: `/api/quality` appeared to take about 379 ms, with `runAudit` around 160 ms. A later timing probe against the built dashboard outside the sandbox measured fresh `?fresh=true` requests at about 30,573 ms and 30,182 ms, with only the cached repeat at about 5 ms.

**Root cause:** I treated a sandbox timing probe as representative for a route that shells out to `bash` through the deny-hook self-test. When the verification surface depends on external shell/runtime behavior, the sandbox path can understate real latency or skip the expensive branch entirely.

**Prevention:** For shell-backed audit or hook performance work, capture timings in the same environment that can actually run the shell command before updating docs or declaring the bottleneck understood. For this repo, prefer a built `dist` dashboard probe plus a focused integration test, and compare fresh versus cached requests explicitly when a new cache is involved. Evidence anchors: `src/cli/server/dashboard-routes.ts` (search: `const fresh = url.searchParams.get("fresh") === "true";`), `src/cli/server/dashboard-routes.ts` (search: `readQualityAuditCache(projectPath, agent, fresh)`), `src/cli/audit/check-agent-setup.ts` (search: `execFileSync("bash", [denyPath, "--self-test=smoke"]`).

---

## Lesson: Dashboard endpoint benchmarks need HTTP client warmup

**Status:** active | **Created:** 2026-04-29

**What happened:** While adding `scripts/profile-dashboard-audit.mjs`, the first cached `/api/audit?quality=true` benchmark reported about `1375ms` even though the server-side profile spans totaled only about `17ms`. The route was cached and fast, but the first measured Node `fetch()` included client/session warmup overhead.

**Root cause:** I treated the first HTTP request made by the benchmark process as representative endpoint time. That mixed one-time client setup with the route being measured and made the cached path look much slower than the server profile and same-server curl evidence.

**Prevention:** Warm the benchmark client with a cheap request such as `/api/health` before measuring dashboard endpoint latency. Compare client-visible endpoint time with server-side profile spans; if they differ by orders of magnitude, identify unprofiled client/setup overhead before recording the timing. Evidence anchor: `scripts/profile-dashboard-audit.mjs` (search: `await fetch(\`${baseUrl}/api/health\`)`).
