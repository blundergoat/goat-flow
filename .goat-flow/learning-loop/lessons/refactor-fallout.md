---
category: refactor-fallout
last_reviewed: 2026-09-05
---

**Scope:** What breaks downstream when code is split, renamed, or extracted - browser script load graphs, source-shape tests that pinned the old layout, and shared scope a split test no longer imports. Using the Gruff analyzer is [gruff-cleanup.md](gruff-cleanup.md); stale built dashboard assets are [dashboard-testing.md](dashboard-testing.md).

## Lesson: Rename sweeps into test/ skip typecheck entirely

**Status:** active | **Created:** 2026-08-19

**Prevention:** After a rename sweep that touches `test/`, run the suites owning the renamed files before trusting typecheck; for the slow suite that is `npm run test:slow:ci -- --shard=<i>/5` on the shard holding those files. When a declaration or call site is renamed, check that the declared return type and every reader moved with it. Evidence anchors: `tsconfig.json` (search: `"exclude"`), `test/integration/dashboard-server.helpers.ts` (search: `export function assertAuditScope`), `test/integration/dashboard-audit-api.test.ts` (search: `ms: elapsedMs`), `test/unit/dashboard-terminal-launch/launch-flow-06.test.ts` (search: `only treats image file drag items`).

**What happened:** The 1.16.0 vocabulary rename (`ccf02efb`) renamed parameters and locals across `src` and `test`. Typecheck, build, and lint stayed green locally, and the breakage appeared 16 minutes into CI as 17 failures. Two functions took a parameter renamed onto a narrowed local already declared in the same body, which esbuild rejects with `The symbol "scope" has already been declared`, so all 15 dashboard integration files importing those helpers failed at transform time without running a test. A third file renamed `ms` to `elapsedMs` in a returned object literal but not in the declared return type or call sites, so `fresh.ms` read `undefined`, and a fourth pinned the pre-rename `item` identifier in a source-text assertion.

**Root cause:** `tsconfig.json` excludes `test`, so `npm run typecheck` never compiles test files, and nothing validates a rename inside `test/` until tsx transforms it. A same-name parameter and local is a redeclaration rather than a shadow, so the file does not load at all.

## Lesson: Check staged deletions after bulk gruff rewrites

**Status:** active | **Created:** 2026-05-31

**Prevention:** After any bulk Gruff cleanup, run `git status --short` before formatting or tests. If unrelated deletes appear, restore index and worktree state for only those paths, then re-run the targeted Gruff rule to confirm no finding returned. Evidence anchors: `CHANGELOG.md` (search: `gruff-ts size cleanup`), `.goat-flow/skill-docs/playbooks/gruff-code-quality.md` (search: `Verification Gate`).

**What happened:** A mechanical rewrite during the naming cleanup left unrelated test files staged as deleted; `git status --short` caught it before final verification. The affected paths were `test/unit/audit-command/harness.test.ts` and `test/unit/dashboard-toast.test.ts`, both later removed for real when the audit unit suites were regrouped under `test/unit/audit-harness/`.

**Root cause:** A broad cleanup was treated as a sequence of source edits without inspecting staged state after the mechanical step, and because the deletions were staged, a worktree-only restore was insufficient.

## Lesson: Size refactors must preserve browser script load graphs in tests

**Status:** active | **Created:** 2026-05-31
**Decision changed:** After splitting or extracting from a dashboard classic script, update the HTML load order, every VM helper source list, and every source-shape assertion in the same patch, then run the focused VM suites before expanding the refactor.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 3 | **Latest occurrence:** 2026-06-10
**Merged:** 2026-09-05 - absorbed "Static source-shape tests must follow helper extractions" (2026-06-10); both are the VM harness holding its own copy of a source graph the split invalidated.

**Prevention:** After splitting dashboard classic scripts, update `src/dashboard/index.html` and every VM helper source list in the same patch. Before the first rerun, grep the focused VM tests for `readDashboardAppSource` and for the moved expression or symbol, and update static assertions to the new helper or caller contract. Then run the focused VM suites. Evidence anchors: `src/dashboard/index.html` (search: `dashboard-app-merge.js`), `test/unit/dashboard-terminal-launch/helpers.ts` (search: `readDashboardAppSource`), `test/unit/dashboard-readers.test.ts` (search: `MODEL_READERS_PATH`).

**What happened:** Splitting dashboard and terminal classic-script files to clear Gruff `size` findings failed the first focused terminal-launch suite because the VM test helper still loaded only the old monolithic browser files while production HTML loaded the new fragments.

**Root cause:** A browser classic-script split was treated like a TypeScript module split. These files do not import each other: the HTML script order is the dependency graph, and VM tests mirror that graph explicitly rather than deriving it.

**Recurrence 2026-05-31 (same session):** The standalone dashboard-reader test failed the same way, evaluating `dashboard-readers.ts` without the split `dashboard-model-readers.ts`, so `readInjectedSupportedAgents` was undefined in the VM context.
**Recurrence 2026-06-10:** Extracting the detached-terminal predicate from `dashboardAppFragment02` into `isTerminalDetached` cleared targeted Gruff, but the focused VM suite still asserted the old inline regex `s.id === session.id && s.status === "active"`. `src/dashboard/dashboard-app-state-fragments.ts` (search: `function isTerminalDetached`), `test/unit/dashboard-terminal-launch/launch-flow-06.test.ts` (search: `serverSession\.id === session\.id`).

## Lesson: Split tests must import their former shared scope explicitly

**Status:** active | **Created:** 2026-05-31
**Incident count:** 2 | **Latest occurrence:** 2026-05-31

**Prevention:** After splitting any test file, run the whole new file glob rather than one renamed slice, and add explicit imports before trusting the split even when the old parent imported the same helpers. Evidence anchors: `test/integration/audit-drift.helpers.ts` (search: `export {`), `test/integration/audit-drift-checkdrift-hook-templates.test.ts` (search: `COPILOT_GRUFF_HOOK_ENTRY`).

**What happened:** After audit-drift integration cases were split out of the grouped file, the renamed files ran as standalone modules and failed with `ReferenceError: describe is not defined`, then with missing helper constants, because they had relied on imports that existed only in the former parent.

**Root cause:** Test-file extraction was treated as a filename move, but Node's test runner evaluates each `*.test.ts` file as its own module, so every split file needs its own `node:test`, assertion, filesystem, and helper imports.

**Recurrence 2026-05-31:** Full preflight found the same standalone-module failure in the setup installer split, plus contract tests still reading the old unsplit dashboard and CLI files instead of the new owners. `test/integration/setup-install.helpers.ts` (search: `runCliInstaller`), `test/unit/dashboard-custom-prompts.test.ts` (search: `CUSTOM_PROMPTS_ACTIONS_PATH`), `src/dashboard/index.html` (search: `dashboard-app-merge.js`), `test/unit/quality-subcommands.test.ts` (search: `quality-command.ts`).

## Lesson: Parameterized matrix tests need named cases with direct assertions

**Status:** active | **Created:** 2026-07-13
**Decision changed:** Generate one named test per matrix value and keep the assertion in that test callback; shared helpers return evidence instead of hiding assertions.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 6 | **Latest occurrence:** 2026-08-17

**Prevention:** Register one named case per matrix value, return a concrete result from the shared scenario helper, and assert that result inside the test callback. Document temporary filesystem and subprocess side effects on helpers that perform installer flows. Evidence anchor: `test/integration/setup-install-agent-matrix.test.ts` (search: `Separate names make the failing agent visible`).

**What happened:** The first M03 cross-agent install matrix wrapped assertions for all four agents inside two test-level loops. Gruff reported `test-quality.loop-in-test`; moving the work into named per-agent helpers then exposed `test-quality.no-assertions` because the visible callbacks only called those helpers. The behaviour suite passed both shapes, but its TAP output and analyzer evidence could not prove each named case owned an assertion.

**Root cause:** The matrix was optimized for short source instead of failure localization. A helper can centralize fixture work, but each user-visible case still needs its own direct assertion so CI and static analysis can connect the case name to evidence.

**Recurrence 2026-07-13:** M14's evidence-envelope and local-data contract tests asserted matrix values inside test-level loops; named cases restored failure localization and produced `A`, composite `100`, with 0 findings. `test/unit/evidence-envelope.test.ts` (search: `FORBIDDEN_RAW_PAYLOAD_KEYS`), `test/contract/local-data-contract.test.ts` (search: `LOCAL_STATE_README_ENTRIES`).
**Recurrence 2026-08-07:** M04 checked nine staged-only prompt phrases inside one bounded-saver test loop; one named test per phrase kept a direct assertion, the focused suite passed 45 tests, and the rerun removed the finding. `test/unit/quality-report-contract.test.ts` (search: `keeps bounded-saver prompts free of staged-only guidance`).
**Recurrence 2026-08-09 (playbook mirrors):** Three hook-registration tests each looped over the two shipped playbook copies; one named mirror runner moved iteration out of the tests while assertion callbacks kept path-labelled failures. `test/unit/playbook-contract.test.ts` (search: `assertRegistrationCommandForEachPlaybook`).
**Recurrence 2026-08-09 (launcher settings):** The hook launcher suite checked six invalid settings and two feedback ceilings inside one loop; named cases gave every value a direct assertion and a distinct TAP result. `test/unit/hook-launcher.test.ts` (search: `Separate names show exactly which mistyped user setting`).
**Recurrence 2026-08-17:** A Gruff discovery contract checked twelve ordered candidates inside one loop; explicit relationship assertions kept the compact case while identifying the exact missing or misordered candidate. `test/contract/comment-playbook-doctrine.test.ts` (search: `discovers declared, wrapped, checkout, and installed tools in order`).
