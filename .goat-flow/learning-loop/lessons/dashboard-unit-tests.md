---
category: dashboard-unit-tests
last_reviewed: 2026-08-15
---

**Scope:** Asserting against dashboard source and VM-loaded helpers - cross-realm objects and timers, attribute-order independence, and reader fields the score logic depends on. Build, asset, route, and performance testing is [dashboard-testing.md](dashboard-testing.md).

## Lesson: Dashboard readers must preserve fields used by score logic

**Status:** active | **Created:** 2026-05-01

**What happened:** The Home, Quality, and Setup pages showed every harness concern at 100 and "All checks passing", but still showed each agent at 94%. The API payload correctly marked `test-runner-configured` as a failing `metric` check, but the dashboard reader dropped the field that lets views treat metric evidence differently from ordinary audit failures.

**Root cause:** The browser-side dashboard reader dropped `check.type` when decoding `/api/audit` payloads. Later, the opposite bug appeared in the view layer: filtering metrics out of dashboard percentages hid score-only verification gaps and restored misleading 100% headlines.

**Recurrence update (2026-07-12):** M30's first GREEN slice made expanded Home concern rows and the Quality baseline show `Evidence limit`, but the collapsed Home agent cards still said `All checks passing`. The focused helper tests had not asserted that primary headline. Fresh browser state exposed the contradiction; a new RED assertion now requires `recommendationSummary` to count concern limits before it can emit the clean-state copy. Evidence anchors: `src/dashboard/views/home.html` (search: `evidenceLimitCount`), `test/unit/dashboard-home.test.ts` (search: `2 evidence limits`).

**Prevention:** When dashboard views derive percentages from API fields, add a regression that proves both the reader and the rendered summary preserve score-only warnings. Browser evidence must check summary cards, concern rows, and the "All checks passing" label because those are separate computations. Verify the rendered dashboard against the built `dist/` assets, not source only. Evidence anchors: `src/dashboard/dashboard-readers.ts` (search: `rawCheck.type`), `test/unit/dashboard-readers.test.ts` (search: `preserves harness check type so metric failures can be shown as non-gating score evidence`), `test/unit/dashboard-home.test.ts` (search: `surfaces score-only metric warnings`).

---

## Lesson: VM helper tests need same-realm assertions

**Status:** active | **Created:** 2026-04-25

**What happened:** M03 added a VM-loaded browser helper test for `dashboard-custom-prompts.ts`. The first focused run failed even though the expected and actual arrays had the same printed contents, because `assert.deepEqual` compared an array created inside the VM realm against a host-realm array literal.

**Current recurrence:** On 2026-05-02, custom prompt form tests repeated this trap for validation arrays, surface tag arrays, and flag group arrays returned from the VM context. On 2026-05-16, the manifest-backed runner hint test hit the same issue for `dashboardValidateCustomPromptDraft(ctx)`. On 2026-05-20, the dashboard readers enforcement-summary regression failed with "Values have same structure but are not reference-equal" because `readDashboardReport` returned a VM-realm plain object. The helper behavior was correct; the assertions needed `Array.from(...)`, host-realm normalization, or scalar field comparisons.

**Root cause:** The test executed browser helper code in `node:vm` to avoid changing classic-script exports, but the assertion treated cross-realm arrays like normal host arrays.

**Prevention:** When testing browser classic-script helpers through `node:vm`, normalize VM-produced arrays/objects with host constructors before strict structural assertions, or compare scalar fields. Evidence anchor: `test/unit/dashboard-custom-prompts.test.ts` (search: `Array.from(helpers.dashboardValidateCustomPromptDraft(ctx))`).

---

## Lesson: VM helper timer harnesses must fake every timer primitive they exercise

**Status:** active | **Created:** 2026-05-24

**What happened:** PR #44's CI `Test` step stayed in progress far past the usual runtime even after the dashboard terminal unit suite had printed its passing suite summary locally. The local minimised repro was `timeout 35s node --import tsx --test --test-reporter=spec test/unit/dashboard-terminal-launch.test.ts`: the suite body completed, then Node stayed alive until the external timeout killed it.

**Root cause:** The VM-loaded dashboard helper tests injected fake `setTimeout` / `clearTimeout`, but still passed real `setInterval` / `clearInterval` into the VM. Tests that called `dashboardConnectTerminal()` exercised the production age-update interval and left a live event-loop handle behind. Node's test runner waits for live handles, so this converted "test assertions finished" into an unbounded CI wait.

**Prevention:** When a VM-loaded browser helper test exercises lifecycle code, fake or explicitly clean up every timer primitive the helper can use (`setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`). For terminal helper tests specifically, prefer the shared fake timer harness and assert the focused file exits under a short outer `timeout`, not just that the suite prints passing assertions. Evidence anchors: `test/unit/dashboard-terminal-launch/helpers.ts` (search: `type TimerControls`), `test/unit/dashboard-terminal-launch/helpers.ts` (search: `createFakeTimers`), `src/dashboard/dashboard-terminal-connect.ts` (search: `ageInterval = setInterval`).

---

## Lesson: Dashboard HTML source tests should not depend on attribute order

**Status:** active | **Created:** 2026-05-21

**What happened:** While fixing Prompts custom-editor selection, the first focused prompt-source test failed because it searched for `<div class="gf-validation-summary"` even though the template puts Alpine attributes before the `class` attribute. The product change was correct; the test anchor assumed attribute order.

**Root cause:** I used a tag-prefix source regex for a formatter-owned HTML template instead of anchoring on the semantic class/id token that mattered.

**Prevention:** For dashboard HTML source tests, anchor on stable class/id tokens or parse a scoped slice instead of requiring tag attribute order. Evidence anchors: `src/dashboard/views/prompts.html` (search: `gf-validation-summary`), `src/dashboard/views/prompts.html` (search: `gf-custom-form-actions`).

---

## Lesson: Dashboard row metadata should not widen UI sort contracts

**Status:** active | **Created:** 2026-05-16

**What happened:** While adding stable dashboard project identity, `npm run typecheck` failed after `ProjectEntry` gained optional identity metadata and `paths?: string[]`. `ProjectSortKey` was defined as `"name" | keyof ProjectEntry`, so adding non-string fields widened sort values to `string | string[] | undefined` and broke `localeCompare`. The first dashboard integration rerun also failed because the roundtrip test asserted exact `paths` array order even though identity grouping made alias order incidental.

**Root cause:** I treated `ProjectEntry` as both the UI row model and the sortable-column contract. Extending the row shape for identity metadata unintentionally changed the sort type. The test had the same path-only assumption: it verified array order rather than the durable property, which is that all aliases are preserved under one identity-keyed record.

**Prevention:** When adding metadata fields to dashboard row types, keep `ProjectSortKey` as an explicit union of sortable string columns. For identity or alias migrations, assert identity grouping, alias set membership, and title preservation; do not assert incidental path-array ordering unless the ordering is part of the product contract. Evidence anchors: `src/dashboard/app.ts` (search: `type ProjectSortKey = "name"`), `test/integration/dashboard-projects-api.test.ts` (search: `persists project identities without raw private remote URLs`).

---

## Lesson: VM-loaded dashboard helper tests must treat `Error` objects as cross-realm too

**Status:** active | **Created:** 2026-04-29

**What happened:** While adding a focused unit test for `dashboardLaunchInTerminal()`, the runtime behavior was correct but the failure-path assertion still failed. The helper caught a VM-thrown `Error`, `instanceof Error` did not hold in the host realm, and the surfaced message became `String(err)` (`Error: xterm.js load failed`) rather than the host test's exact `err.message` expectation.

**Root cause:** I remembered the existing cross-realm array/object lesson for VM-loaded browser helpers but still treated `Error` identity as if it were shared across realms. In `node:vm`, errors have the same identity problem as arrays and plain objects.

**Prevention:**
1. In VM-loaded dashboard helper tests, compare stable error-message content or normalize the error into the host realm before strict equality checks.
2. When a helper uses `instanceof Error`, expect VM-based tests to surface the `String(err)` fallback unless the test injects same-realm errors deliberately.
3. Evidence anchors: `test/unit/dashboard-terminal-launch/launch-flow-03.test.ts` (search: `xterm.js load failed`), `src/dashboard/dashboard-terminal-runtime.ts` (search: `const msg = err instanceof Error ? err.message : String(err)`).

---

