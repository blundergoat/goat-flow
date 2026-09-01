---
category: refactor-fallout
last_reviewed: 2026-08-23
---

**Scope:** What breaks downstream when code is split, renamed, or extracted - browser script load graphs, source-shape tests that pinned the old layout, dist builds, and shared scope a split test no longer imports. Using the Gruff analyzer is [gruff-cleanup.md](gruff-cleanup.md).

## Lesson: Rename sweeps into test/ skip typecheck entirely

**Status:** active | **Created:** 2026-08-19

**Prevention:** After a rename sweep that touches `test/`, run the suites owning the renamed files before trusting typecheck; for the slow suite that is `npm run test:slow:ci -- --shard=<i>/5` on the shard holding those files. When only a declaration or a call site is renamed, check that the declared return type and every reader moved with it. Evidence anchors: `tsconfig.json` (search: `"exclude"`), `test/integration/dashboard-server.helpers.ts` (search: `export function assertAuditScope`), `test/integration/dashboard-audit-api.test.ts` (search: `ms: elapsedMs`), `test/unit/dashboard-terminal-launch/launch-flow-06.test.ts` (search: `only treats image file drag items`).

**What happened:** The 1.16.0 vocabulary rename (`ccf02efb`) renamed parameters and locals across `src` and `test`. Typecheck, build, and lint stayed green locally, and the breakage only appeared 16 minutes into the CI job, as 17 failures. Two functions took a parameter renamed onto the name of the narrowed local already declared in the same body, which esbuild rejects with `The symbol "scope" has already been declared`; every one of the 15 dashboard integration files that import those helpers failed at transform time without running a single test. A third file renamed `ms` to `elapsedMs` in a returned object literal but not in the declared return type or the call sites, so `fresh.ms` read `undefined`. A fourth pinned the pre-rename `item` identifier in a source-text assertion.

**Root cause:** `tsconfig.json` excludes `test`, so `npm run typecheck` never compiles test files. Nothing validates a rename inside `test/` until tsx transforms the file and runs it, and the files that owned all four breakages live in the slow suite at the end of the run. A same-name parameter and local is a redeclaration rather than a shadow, so the file does not load at all - a green typecheck says nothing about it, and neither does a passing fast suite.

## Lesson: Check staged deletions after bulk gruff rewrites

**Status:** active | **Created:** 2026-05-31

**Prevention:** After any bulk gruff cleanup, run `git status --short` before formatting or tests. If unrelated deletes appear, restore both index and worktree state for only those paths, then re-run the targeted gruff rule to confirm no finding was reintroduced. Evidence anchors: `CHANGELOG.md` (search: `gruff-ts size cleanup`) for the bulk-rewrite campaign that staged these deletions, and `.goat-flow/skill-docs/playbooks/gruff-code-quality.md` (search: `Verification Gate`) for the post-cleanup verification discipline.

**What happened:** During the gruff naming cleanup, a mechanical rewrite left unrelated test files staged as deleted. `git status --short` caught the problem before final verification; affected paths included `test/unit/audit-command/harness.test.ts` and `test/unit/dashboard-toast.test.ts` (both were later removed for real when the audit unit suites were regrouped under `test/unit/audit-harness/`, so they no longer exist in the tree).

**Root cause:** I treated a broad cleanup as a sequence of source edits and did not immediately inspect staged state after the mechanical step. Because the deletions were staged, a worktree-only restore was insufficient and the unexpected `D` entries remained until I checked status again.

## Lesson: Size refactors must preserve browser script load graphs in tests

**Status:** active | **Created:** 2026-05-31

**Prevention:** After splitting dashboard classic scripts, update `src/dashboard/index.html` and every VM helper source list in the same patch. Run the focused VM suites before expanding the refactor. Evidence anchors: `src/dashboard/index.html` (search: `dashboard-app-merge.js`), `test/unit/dashboard-terminal-launch/helpers.ts` (search: `readDashboardAppSource`), `test/unit/dashboard-readers.test.ts` (search: `MODEL_READERS_PATH`).

**What happened:** While I was splitting dashboard and terminal classic-script files to clear gruff `size` findings, the first focused terminal-launch suite failed because the VM test helper still loaded only the old monolithic browser files. Production HTML loaded the new fragment files, but the test harness had its own source bundle list.

**Same-session recurrence:** The standalone dashboard-reader test later failed the same way: it evaluated `dashboard-readers.ts` without the split `dashboard-model-readers.ts`, so `readInjectedSupportedAgents` was undefined in the VM context.

**Root cause:** I treated a browser classic-script split like a TypeScript module split. These files do not import each other; the HTML script order is the dependency graph, and VM tests must mirror that graph explicitly.

## Lesson: Static source-shape tests must follow helper extractions

**Status:** active | **Created:** 2026-06-10

**Prevention:** When extracting helpers from dashboard classic-script fragments, grep the focused VM tests for `readDashboardAppSource` and the moved expression or symbol before the first rerun. Update static assertions to the new stable helper/caller contract, then rerun the focused suite. Evidence anchors: `src/dashboard/dashboard-app-state-fragments.ts` (search: `function isTerminalDetached`), `test/unit/dashboard-terminal-launch/launch-flow-06.test.ts` (search: `serverSession\.id === session\.id`).

**What happened:** During M01 dashboard state-fragment gruff cleanup, extracting the detached-terminal predicate from `dashboardAppFragment02` into `isTerminalDetached` cleared targeted gruff but the focused VM suite failed. `test/unit/dashboard-terminal-launch/launch-flow-06.test.ts` still asserted the old inline regex `s.id === session.id && s.status === "active"`.

**Root cause:** I treated the dashboard terminal VM suite as mostly behavioral coverage and did not pre-scan its `readDashboardAppSource()` assertions after moving source-shape logic into helpers.

## Lesson: Dashboard asset renames need a clean dist build

**Status:** active | **Created:** 2026-05-31

**Prevention:** When verifying dashboard asset renames, run the full `npm run build` or clean `dist` before `npm run build:dashboard`. Then grep `dist` for the old filenames. Evidence anchors: `package.json` (search: "rmSync('dist', { recursive: true, force: true })"), `package.json` (search: "tsconfig.dashboard.json && node scripts/build-dashboard-assets.mjs").

**What happened:** While I was renaming dashboard app fragment files, `npm run build:dashboard` compiled the new descriptive `dashboard-app-*.js` files but left the old generated numbered fragment assets in `dist/dashboard`.

**Root cause:** `build:dashboard` runs the dashboard TypeScript compile and asset copy only; it does not remove `dist/dashboard` before compiling. The full `npm run build` does clean `dist` first.

## Lesson: Split tests must import their former shared scope explicitly

**Status:** active | **Created:** 2026-05-31

**Prevention:** After splitting any test file, run the whole new file glob, not just one renamed slice. Add explicit imports before trusting the split, even when the old parent already imported the same helpers. Evidence anchors: `test/integration/audit-drift.helpers.ts` (search: `export {`), `test/integration/audit-drift-checkdrift-hook-templates.test.ts` (search: `COPILOT_GRUFF_HOOK_ENTRY`).

**What happened:** After I split audit-drift integration cases out of the old grouped file, the renamed files ran as standalone test modules and failed with `ReferenceError: describe is not defined`, followed by missing helper constants. The code had relied on imports that existed only in the former parent module.

**Root cause:** I treated test-file extraction as a filename move. Node's test runner evaluates each `*.test.ts` file as its own module, so every split file needs its own `node:test`, assertion, filesystem, and helper imports.

**Recurrence 2026-05-31:** Full preflight later found the same standalone-module failure in the setup installer split, plus contract tests still reading old unsplit dashboard/CLI files instead of the new owners. Evidence anchors: `test/integration/setup-install.helpers.ts` (search: `runCliInstaller`), `test/unit/dashboard-custom-prompts.test.ts` (search: `CUSTOM_PROMPTS_ACTIONS_PATH`), `src/dashboard/index.html` (search: `dashboard-app-merge.js`), `test/unit/quality-subcommands.test.ts` (search: `quality-command.ts`).

## Lesson: Parameterized matrix tests need named cases with direct assertions

**Status:** active | **Created:** 2026-07-13
**Decision changed:** Generate one named test per matrix value and keep the assertion in that test callback; shared helpers return evidence instead of hiding assertions.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 6
**Latest occurrence:** 2026-08-17

**Prevention:** Register one named case per matrix value, return a concrete result from the shared scenario helper, and assert that result inside the test callback. Document temporary filesystem and subprocess side effects on helpers that perform installer flows. Evidence anchor: `test/integration/setup-install-agent-matrix.test.ts` (search: `Separate names make the failing agent visible`).

**What happened:** The first M03 cross-agent install matrix wrapped assertions for all four agents inside two test-level loops. Gruff reported `test-quality.loop-in-test`; moving the work into named per-agent helpers then exposed `test-quality.no-assertions` because the visible test callbacks only called those helpers. The behavior suite passed both shapes, but its TAP output and analyzer evidence could not prove each named case owned an assertion.

**Root cause:** I optimized the matrix for short source instead of failure localization. A helper can centralize fixture work, but each user-visible test case still needs its own direct assertion so CI and static analysis can connect the case name to evidence.

**Recurrence 2026-07-13:** M14's evidence-envelope and local-data contract tests initially asserted matrix values inside test-level loops. Gruff again reported `test-quality.loop-in-test`; named cases restored direct, user-visible failure localization and produced `A`, composite `100`, with 0 findings. Evidence anchors: `test/unit/evidence-envelope.test.ts` (search: `FORBIDDEN_RAW_PAYLOAD_KEYS`) and `test/contract/local-data-contract.test.ts` (search: `LOCAL_STATE_README_ENTRIES`).

**Recurrence 2026-08-07:** M04 initially checked nine staged-only prompt phrases inside one bounded-saver test loop. Direct Gruff analysis reported a new `test-quality.loop-in-test` advisory. Registering one named test per phrase kept a direct assertion and made the failed contract visible in TAP; the focused suite passed 45 tests and the rerun removed the new finding. Evidence anchor: `test/unit/quality-report-contract.test.ts` (search: `keeps bounded-saver prompts free of staged-only guidance`).

**Recurrence 2026-08-09:** Three hook-registration tests each looped over the two shipped playbook copies. Gruff reported three `test-quality.loop-in-test` advisories; one named mirror runner moved iteration out of the tests while assertion callbacks retained path-labelled failures. The rerun reported 0 findings. Evidence: `test/unit/playbook-contract.test.ts` (search: `assertRegistrationCommandForEachPlaybook`).

**Recurrence 2026-08-09:** The hook launcher suite checked six invalid settings and two feedback ceilings inside one test-level loop. Gruff reported `test-quality.loop-in-test`; registering named cases outside the test callbacks gave every value a direct assertion and distinct TAP result. The final focused analysis reported 0 advisories. Evidence anchor: `test/unit/hook-launcher.test.ts` (search: `Separate names show exactly which mistyped user setting`).

**Recurrence 2026-08-17:** A Gruff discovery contract initially checked twelve ordered candidates inside one test-level loop. Edit feedback reported `test-quality.loop-in-test`; explicit relationship assertions retained the compact case while identifying the exact missing or misordered candidate. Evidence anchor: `test/contract/comment-playbook-doctrine.test.ts` (search: `discovers declared, wrapped, checkout, and installed tools in order`).
