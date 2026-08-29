---
category: dashboard-testing
last_reviewed: 2026-08-27
---

**Scope:** Testing the dashboard as a built, served application - stale dist copies, servers needing a restart after template edits, Knip registration for classic scripts, route-scoped verification, and performance probes that need the real shell. Asserting against source and VM-loaded helpers is [dashboard-unit-tests.md](dashboard-unit-tests.md).

## Lesson: Prove hook capability before marking an agent unsupported

**Status:** active | **Created:** 2026-05-26
**Decision changed:** Treat provider input, command execution, result delivery, and model visibility as separate support gates.
**Trigger phase:** VERIFY
**Incident count:** 7 | **Latest occurrence:** 2026-08-27

**What happened:** The Hooks dashboard first used `not supported`, then `unavailable`, for Antigravity Gruff before the local command path had been tested. Antigravity had project-local config, file-tool matchers, and a changed-file fallback, so the agent-wide label was too broad. That evidence proved local command feasibility, not model-visible Gruff feedback.

**Root cause:** I first collapsed missing payload evidence into no hook capability, then collapsed local input handling into delivered feedback. Both shortcuts let one layer stand in for the entire effective-state chain.

**Recurrence update (2026-07-13):** A four-runner capability fixture asserted hard secret file-read protection for every agent. The failing run showed that Antigravity and Copilot are script-only and correctly report limited file-tool protection, while Claude and Codex have settings-backed coverage. Shared shell assertions were separated from per-runner file-read expectations. A negative reader fixture also showed that a `hard` row with no source survived dashboard decoding; source-less rows are now dropped before rendering. Evidence anchors: `test/unit/enforcement-capability.test.ts` (search: `assertSecretFileStatusForAgent`), `src/cli/audit/enforcement.ts` (search: `secretFileReadCapability`), and `src/dashboard/dashboard-readers.ts` (search: `hasVisibleEvidence`).

**Recurrence update (2026-08-10):** A registrar test still treated Antigravity's runnable PostToolUse command as usable Gruff support. The full suite showed that current setup intentionally removes the registration because its output cannot reach the active model. The corrected fixture keeps the user's desired toggle visible, leaves the hook unregistered, reports `result-undelivered`, and offers no local repair command. Evidence anchors: `src/cli/server/hooks-registry.ts` (search: `cannot deliver Gruff feedback to the active model`), `src/cli/server/hook-registrar.ts` (search: `doesProviderExclusionOwnState`), and `test/unit/hook-registrar-surfaces.test.ts` (search: `keeps gruff-code-quality unregistered for Antigravity without result delivery`).

**Recurrence update (2026-08-10):** Fresh Codex canaries promoted Gruff and Stop to effective support, but the registry used the nonexistent final status `scenario-verified` and an integration test still selected Codex as its unsupported-provider example. Typecheck rejected the status, then the focused effective-state suite exposed the stale provider choice. At that capture boundary the registry used `effective`, while the unsupported assertion named Antigravity and preserved its absent-capture outcome. Evidence anchors: `src/cli/server/hooks-registry.ts` (search: `hook-provider-adapter.v1:codex:post-tool`), `test/integration/hook-effective-state.test.ts` (search: `antigravityState`), and `test/integration/hook-effective-state.test.ts` (search: `expires exact Codex proof while keeping uncaptured Stop stale`).

**Recurrence update (2026-08-22):** Adding Codex's Windows-only registration override invalidated the earlier Gruff and Stop capture. An initial disposable 0.149.0 session did not load project hooks; a subsequent session in the already-trusted project delivered the exact PreToolUse denial but no Gruff or Stop result. The registry now keeps those two event gates stale, and registration-surface tests assert the separate local `isRegistered` fact without allowing it to hide the earlier provider-capture gap. Evidence anchors: `src/cli/server/hooks-registry.ts` (search: `effectiveSupportGate: "provider-capture-stale"`), `test/integration/hook-effective-state.test.ts` (search: `replays Codex Stop results without upgrading stale provider proof`), and `workflow/hooks/README.md` (search: `initial disposable Codex CLI 0.149.0`).

**Recurrence update (2026-08-27):** A bypass-trust PostToolUse capture still could not renew the trusted-provider gate. The follow-up Codex CLI 0.149.1 run used the already trusted project and exact hash-trusted handler without the bypass flag, completed `apply_patch`, ran Gruff, and exposed an analyzer-only marker to the model. The registry now dates only Codex Gruff's `scenario-unverified` gate; Stop stays stale because no Stop result was captured. Evidence anchors: `src/cli/server/hooks-registry.ts` (search: `2026-09-25T20:17:22.830Z`), `test/integration/hook-effective-state.test.ts` (search: `expires exact Codex proof while keeping uncaptured Stop stale`), and `workflow/hooks/README.md` (search: `without the bypass flag`).

**Recurrence update (2026-08-10):** The Hooks-view unit test also required at least one Codex exclusion after fresh live proof removed the last one. The dashboard slice failed even though ambient declarations and rendering were unchanged. The test now asserts the current explicit exclusions for Antigravity and Copilot and checks that each carries a provider-named reason. Evidence anchors: `test/unit/dashboard-hooks-view.test.ts` (search: `keeps current provider exclusions paired with reasons`) and `src/cli/server/hooks-registry.ts` (search: `unsupportedAgents`).

**Recurrence update (2026-08-10):** A fresh-install test still expected Codex to omit Stop after live provider proof enabled the post-turn feedback path. The standalone installer suite failed while the migration suite already asserted the current contract. The corrected test now checks the installed Stop event, script, timeout, and result protocol while keeping optional Gruff absent. Evidence anchors: `test/integration/setup-install.test.ts` (search: `Fresh Codex users receive the live-proven Stop feedback path`) and `src/cli/server/hooks-registry.ts` (search: `hook-provider-adapter.v1:codex:turn-stop`).

**Prevention:** Verify each hook layer separately before choosing a support label. A payload fixture proves input extraction; an installed script proves local availability; neither proves the host returned feedback to the model. Keep provider-specific expectations explicit and use the first causal gap for the UI state and repair guidance. `test/integration/gruff-code-quality-smoke.test.ts` (search: `runs for Antigravity file-tool payloads without a file path`) remains input-path proof only.

---

## Lesson: Dashboard release QA should avoid real agent runners unless runner behavior is the target

**Status:** active | **Created:** 2026-05-10

**What happened:** During v1.6.0 browser-use manual dashboard QA, clicking Workspace `Open terminal` launched a real Claude Code session in the selected project. Before cleanup, `git status --short` showed an unexpected tracked diff in `docs/dashboard.md` adding a temporary `### Skills` section that was not part of the QA request; the diff was removed to restore the read-only testing scope.

**Root cause:** I treated the terminal launch as a harmless UI smoke, but the dashboard terminal starts a real agent process in the selected project. For release QA that only needs Workspace layout and session controls, a real runner can attach to existing agent state and mutate the repository.

**Prevention:** For manual dashboard page/modal sweeps, do not click runner launch buttons unless terminal runner behavior is the explicit target. Prefer browser-use state checks of the empty Workspace, `/api/terminal/sessions`, or a non-agent test harness. If the max-session modal needs coverage, trigger Alpine state via browser-use Python/CDP instead of starting ten runner sessions. When terminal launch is in scope, snapshot `git status --short` before and after, then close the session immediately. Evidence anchors: `src/dashboard/views/workspace.html` (search: `launchInTerminal('', activeRunner`), `src/dashboard/dashboard-terminal-runtime.ts` (search: `async function dashboardLaunchInTerminal`).

---

## Lesson: Slow verification can expose unrelated dashboard doc drift

**Status:** active | **Created:** 2026-05-09

**What happened:** While double-checking an unrelated Codex config fix, `npm run test:slow` failed in `checkDrift: installer round-trip fixture` because the temp repo's preflight reported `Dashboard view names drift between manifest and architecture prose`. The Codex fix was clean; the blocker was stale `.goat-flow/architecture.md` prose missing the `skill` dashboard view in both required snippets.

**2026-05-10 recurrence:** Manual v1.6.0 CLI release smoke hit the same class through `node dist/cli/cli.js audit . --check-content --format text`: `Cold-Path Content Lint` failed because `docs/dashboard.md` listed dashboard headings without the manifest-backed `skills` view. Adding the missing `### Skills` section changed the check to `Cold-Path Content Lint: PASS (0 warning(s), 9 info, 177 file(s) scanned)`.

**2026-05-15 recurrence:** During M00 side-menu execution, the focused dashboard route test failed before reaching `/api/tasks` because `validateManifest` reported `facts.dashboard_views drift` after the then-current tasks view and a `coming-soon` view (since removed in 1.13.0) were added. The fix was to add both view names to `workflow/manifest.json` and update the two dashboard view lists in `.goat-flow/architecture.md` before rerunning the route slice. The tasks view route was later renamed to `src/dashboard/views/plans.html`.

**2026-05-18 recurrence:** During the v1.7.0 version bump, `node --import tsx src/cli/cli.ts audit . --check-drift --check-content --format json` failed after the scripted version surfaces were already consistent. The remaining warnings were cold-path doc drift around the manifest-backed `coming-soon` view (its `Coming Soon Destinations` block, since removed in 1.13.0) and `docs/audit-and-quality.md` (search: `Verification:           PASS (4/4)`) not being updated after the Verification harness concern grew to 4 checks. The fix was to align both doc claims, then rerun the content audit.

**Root cause:** I treated the broad slow suite as a final confirmation step, but it also runs repo-wide cold-path truth checks through `scripts/preflight-checks.sh`. Those checks can surface unrelated committed dashboard doc drift that focused tests do not touch.

**Prevention:** When `npm run test:slow` or preflight fails during unrelated verification, separate task-local regressions from repo-wide drift before changing code. For dashboard view drift, compare `workflow/manifest.json` (search: `dashboard_views`) against `.goat-flow/architecture.md` (search: `views for`, `Page views`) and rerun both `bash scripts/preflight-checks.sh` and `npm run test:slow` after the doc correction.

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

**Recurrence (2026-08-14):** M03 changed the four QA-facing records in `src/dashboard/preset-prompts.json`. Focused preset and doctrine tests passed, but a later full-suite run failed the existing source/dist parity contract because `dist/dashboard/preset-prompts.json` still held the earlier catalog. Evidence anchor: `test/contract/skill-hardening-security-2.test.ts` (search: `dashboard preset source/dist parity`). Refresh the copied asset before the first expanded suite, not after a favourable focused run.

---

## Lesson: Built dashboard browser smoke needs a restarted server after template edits

**Status:** active | **Created:** 2026-05-15

**What happened:** While adding the Plans active-plan toggle, the built dashboard browser smoke kept showing the old direct Alpine handlers after `npm run build:dashboard`. Clicking the flag wrote `.goat-flow/plans/.active`, but the visible active marker stayed stale until I manually refreshed. The running dashboard process had cached the assembled HTML before the template-handler fix landed; after restarting `node dist/cli/cli.js dashboard .`, browser-use showed the new dispatched handlers and the active marker flipped immediately from `1.7.0` to `_archived` and back.

**Root cause:** `serveDashboard()` caches `assembleDashboardHtml(shellPath)` at startup when dev mode is off. Rebuilding `dist/dashboard/views/plans.html` updates files on disk, but an already-running built dashboard server keeps serving the old assembled shell.

**Prevention:** After changing dashboard HTML/view templates, run `npm run build:dashboard`, restart the built dashboard server, then repeat browser-use smoke against the new URL. Evidence anchors: `src/cli/server/dashboard.ts` (search: `let cachedTemplate`), `src/cli/server/dashboard.ts` (search: `assembleDashboardHtml(shellPath)`), `src/dashboard/views/plans.html` (search: `gf-set-active-task-plan`).

---

## Lesson: Dashboard classic scripts need Knip registration

**Status:** active | **Created:** 2026-04-25

**What happened:** M03 added `src/dashboard/dashboard-custom-prompts.ts` as a browser classic-script helper and loaded it from `src/dashboard/index.html`. Focused tests and typecheck passed, but full `npm test` failed the installer round-trip preflight because Knip reported the file as unused. The same preflight also caught an ESLint complexity error in `src/cli/server/decoders.ts` after the terminal-create payload grew another optional field.

**Root cause:** Dashboard classic scripts are loaded by HTML at runtime, not imported through the TypeScript module graph. Knip only knows they are intentional because `knip.json` ignores existing dashboard classic-script entrypoints. Focused source tests do not run the full preflight lint/Knip gate.

**Prevention:** When adding a `src/dashboard/*.ts` classic script, update `src/dashboard/index.html`, add the built asset smoke, and register the source file in `knip.json`. After adding optional decoder branches, run `npx eslint src/cli src/dashboard` before treating `npm run typecheck` as enough. Evidence anchors: `knip.json` (search: `dashboard-custom-prompts.ts`), `src/cli/server/decoders.ts` (search: `decodeOptionalStringField`).

---

## Lesson: Dashboard audit-route fixes need route-scoped verification, not the full server suite

**Status:** active | **Created:** 2026-04-29

**What happened:** While fixing the Home page's multi-minute `Auditing...` stall, the first verification attempt used the entire `test/integration/dashboard-server.test.ts` suite as the gate. That suite still includes endpoints whose deeper behavior is intentionally slower than the Home summary path, so the broad run timed out before producing a useful pass/fail signal for the changed route.

**Root cause:** I used a verification scope wider than the code change. The fix only changed `/api/audit` summary behavior, but the suite also exercises other dashboard routes whose latency profile is different. That diluted the signal and made the timeout look like uncertainty in the changed path.

**Prevention:** For dashboard audit-path fixes, verify the exact `/api/audit` contract first: run the `/api/audit`-only test slice and a direct localhost fetch against `serveDashboard()`. Use the broader dashboard suite only as a follow-up check when the slower routes are relevant to the change. Evidence anchors: `test/integration/dashboard-audit-api.test.ts` (search: `describe("dashboard /api/audit"`), `test/integration/quality-constraint-isolation.test.ts` (search: `dashboard home audit refresh`), `src/cli/server/dashboard-audit-routes.ts` (search: `denyMechanismEvidenceLevel`).

---

## Lesson: Shell-backed performance probes must use the real shell environment

**Status:** active | **Created:** 2026-04-29

**What happened:** While optimizing `/api/quality`, my first localhost timing probes inside the sandbox made the route look subsecond and led to a bad footgun draft: `/api/quality` appeared to take about 379 ms, with `runAudit` around 160 ms. A later timing probe against the built dashboard outside the sandbox measured fresh `?fresh=true` requests at about 30,573 ms and 30,182 ms, with only the cached repeat at about 5 ms.

**Root cause:** I treated a sandbox timing probe as representative for a route that shells out to `bash` through the deny-hook self-test. When the verification surface depends on external shell/runtime behavior, the sandbox path can understate real latency or skip the expensive branch entirely.

**Prevention:** For shell-backed audit or hook performance work, capture timings in the same environment that can actually run the shell command before updating docs or declaring the bottleneck understood. For this repo, prefer a built `dist` dashboard probe plus a focused integration test, and compare fresh versus cached requests explicitly when a new cache is involved. Evidence anchors: `src/cli/server/dashboard-audit-routes.ts` (search: `const fresh = url.searchParams.get("fresh") === "true";`), `src/cli/server/dashboard-quality-routes.ts` (search: `function readQualityAuditCache`), `src/cli/audit/check-agent-deny-mechanism.ts` (search: `execFileSync("bash", [denyPath, "--self-test=smoke"]`).

---

## Lesson: Dashboard endpoint benchmarks need HTTP client warmup

**Status:** active | **Created:** 2026-04-29

**What happened:** While adding `scripts/profile-dashboard-audit.mjs`, the first cached `/api/audit?quality=true` benchmark reported about `1375ms` even though the server-side profile spans totaled only about `17ms`. The route was cached and fast, but the first measured Node `fetch()` included client/session warmup overhead.

**Root cause:** I treated the first HTTP request made by the benchmark process as representative endpoint time. That mixed one-time client setup with the route being measured and made the cached path look much slower than the server profile and same-server curl evidence.

**Prevention:**

1. Declare server cache state (`fresh` or `cached`) and client state (`cold` or `warmed`) separately before sampling; never combine those states into one series.
2. Warm the client with a cheap request such as `/api/health`, then measure fresh and cached endpoint series independently.
3. Compare client-visible endpoint time with server-side profile spans. If they differ by orders of magnitude, identify unprofiled client or setup overhead before recording the timing.

This incident establishes the warmup and cache-state controls, not a reusable latency threshold. The shared evidence matrix owns iteration count, median, spread, and correctness requirements. Evidence anchor: `scripts/profile-dashboard-audit.mjs` (search: `await fetch(\`${baseUrl}/api/health\`)`).
