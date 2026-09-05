---
category: test-execution-environment
last_reviewed: 2026-08-21
---

**Scope:** Choosing and invoking the right runner - which binary and loader actually execute, why a file argument may not narrow the suite, and when proof needs the published invocation path rather than source mode. Shell and process behaviour is [test-shell-environment.md](test-shell-environment.md).

## Lesson: An ad-hoc `node --test` run can execute stale checkout copies under `.goat-flow/scratchpad/`

**Status:** active | **Created:** 2026-08-16

**Prevention:** Quote gate numbers from `npm test`. For a targeted subset, generate the list with `find test -type f -name '<pattern>'` rather than a `**` glob, and confirm the reported top-level plan (`1..N`) matches the file count before citing a pass total. A suite name you cannot locate with `command grep -rl '<name>' test/` means the run reached outside the tracked tree. Evidence anchors: `scripts/run-tests.mjs` (search: `function listTestFiles`) and [`test-execution-environment.md`](test-execution-environment.md) (search: `Directory targets can break`).

**What happened:** A manual hook verification pass built its file list with `ls test/**/*hook*.test.ts`. This shell has no `globstar`, so `**` collapsed to `*` and six of the listed paths did not exist in the tracked tree. `node --import tsx --test` did not fail on the missing arguments; the run reported `# tests 365` across suites named `hook provider adapters`, `hook registrar: ...`, and `dashboard Hooks view`, none of which exist under `test/`. Those files survive only inside earlier goat-clarity validation worktrees beneath `.goat-flow/scratchpad/`. The corrected list of 18 real files reports `# tests 363`.

**Root cause:** `.goat-flow/scratchpad/` holds complete checkout copies from previous validation runs, and Node's fallback discovery walks the repository rather than the tracked `test/` tree. `scripts/run-tests.mjs` is unaffected because its `listTestFiles` walk starts at `test/`, so `npm test` never sees the stale copies; the exposure is limited to ad-hoc `node --test` invocations whose arguments do not all resolve.

---

## Lesson: Directory targets can break Node's test runner

**Status:** active | **Created:** 2026-06-11
**Incident count:** 2 | **Latest occurrence:** 2026-08-29

**Prevention:** For suite-wide verification, use `node scripts/run-tests.mjs fast` or the matching npm script from `package.json`. Use `node --import tsx --test <specific-file.test.ts>` only for focused files. Treat `ERR_MODULE_NOT_FOUND` on a test directory or `index.json` as an invocation-shape failure before diagnosing product code. Evidence anchors: `scripts/run-tests.mjs` (search: `listTestFiles`), `package.json` (search: `"test:fast": "node scripts/run-tests.mjs fast"`).

**What happened:** While executing `.goat-flow/plans/1.12.0/M01-verification-score-spike-and-decision.md`, the milestone's baseline command `node --import tsx --test test/unit/` failed before running tests: Node treated the directory argument as a module target and tried to import `test/unit/index.json`, producing `ERR_MODULE_NOT_FOUND`. The canonical repo runner `node scripts/run-tests.mjs fast` immediately passed with `# pass 661`, `# fail 0`.

**Recurrence (2026-08-29):** M70 named `test/unit` and `test/contract` directly in a focused `node --test` command. Node treated both directories as test modules and returned `tests 2`, `pass 0`, `fail 2` before executing any owning case. Replacing the directory arguments with the four explicit M70 `*.test.ts` paths restored the intended 166-case proof. Evidence anchors: `package.json` (search: `"test:fast": "node scripts/run-tests.mjs fast"`) and `test/contract/command-phrases.test.ts` (search: `instruction-files must remain a bounded manifest mode`).

**Root cause:** I trusted a milestone's directory-shaped test command instead of checking `package.json` and `scripts/run-tests.mjs`. In this repo, test file discovery and slow/fast partitioning live in `scripts/run-tests.mjs`; direct Node `--test` invocations should name specific `*.test.ts` files, not a directory.

---

## Lesson: `npm test -- <file>` can still run the full suite

**Status:** active | **Created:** 2026-04-18

**Prevention:** For focused test verification in this repo, invoke the underlying command directly, as in `node --import tsx --test test/unit/quality-subcommands.test.ts`, and reserve `npm test` for deliberate full-suite runs. Confirm the reported test count matches the file you meant to run before citing the result. Evidence anchors: `package.json` (search: `"test": "npm run test:fast"`), `scripts/run-tests.mjs` (search: `const mode = process.argv[2]`).

**What happened:** A focused verification run appended a test path to `npm test` to run only the quality prompt tests, and the full suite ran anyway, surfacing unrelated audit failures that obscured whether the changed file passed its own regression.

**Root cause:** npm passthrough appends arguments rather than replacing the script's target, and this repo's script chain never consumes them: `test` delegates to `test:fast`, which runs `scripts/run-tests.mjs`, which reads only its first argument as the mode and discovers files itself. An appended path is therefore silently ignored, so the command looks focused and is not.

---

## Lesson: Test suite must exercise the published invocation path

**Status:** active | **Created:** 2026-04-24
**Trigger phase:** VERIFY
**Incident count:** 2 | **Latest occurrence:** 2026-08-10
**Decision changed:** Run the packed public command and capture its complete output instead of inferring entry-point behavior or presentation from source and package metadata.

**Prevention:**
1. `test/integration/main-guard.test.ts` now tests the CLI via a temp-dir symlink - the exact path that broke. This test would have caught the regression.
2. When modifying the entry-point guard or anything that controls whether `main()` runs, verify via symlink invocation, not just direct `node dist/cli/cli.js`.
3. Treat package metadata and CLI presentation as separate contracts: run the archived `--version` command and assert its complete user-facing output before testing later package flows.

**What happened:** Commit 918ca3e wrapped the bare `main().catch(...)` call in an `import.meta.url` guard to prevent side effects on import. The guard used `resolve(process.argv[1]) === fileURLToPath(import.meta.url)`, which silently fails when the CLI is invoked through a symlink (the standard npm/npx path). All 359 tests passed because every test imports CLI functions directly or shells out via `node dist/cli/cli.js` - no test invoked the binary through a symlink, which is how every real consumer runs it.

**Root cause:** The test suite verified internal function behavior but never exercised the actual entry-point guard through the `.bin/` symlink path that `npx` uses. The refactor commit was titled "update goat-critique documentation," making it easy to overlook a CLI entry-point change during review.

**Recurrence 2026-08-10:** A new packed-bin release fixture asserted that `--version` would print the package value `1.15.1`. The real archived `.bin/goat-flow` command printed `goat-flow v1.15.1`, so the first run failed before fresh-install and migration checks began. The assertion now preserves the complete public string. Evidence anchor: `test/integration/packaged-hook-install.test.ts` (search: `runs fresh install through the archived CLI bin`).

---

## Lesson: Source-mode CLI proof does not refresh the package binary

**Status:** active | **Created:** 2026-04-27

**Prevention:**
1. When fixing a failure reported with `npx goat-flow ...`, rerun that exact command after `npm run build`, even if the `node --import tsx src/cli/cli.ts ...` source path already passes.
2. If source-mode and `npx` results disagree, check `dist/` freshness before changing the business logic again.

**What happened:** A static detector patch made `node --import tsx src/cli/cli.ts audit . --harness --agent claude` pass, but the exact user-facing reproduction `npx goat-flow audit . --harness --agent claude` still failed because `npx` used the package `bin` path in `dist/cli/cli.js`. The built `dist/` copy still contained the old detector until `npm run build` refreshed it.

**Root cause:** I treated source-mode CLI verification as equivalent to the packaged invocation path. In this repo, `npx goat-flow` exercises `package.json` `bin`, so local source edits do not affect that command until the build output is regenerated.

---

## Lesson: Focused TypeScript tests need verified paths and the `tsx` loader

**Status:** active | **Created:** 2026-04-29 | **Incident count:** 5 | **Latest occurrence:** 2026-08-21

**Prevention:** Resolve focused paths with `find test -type f -name '<pattern>'` rather than a shell glob or ripgrep, then use `node --import tsx --test <specific-file.test.ts>` as declared by `package.json` (search: `"test:fast": "node scripts/run-tests.mjs fast"`). When a spawned Node process names `tsx` as a package import, keep its cwd inside the dependency tree or pass a resolved loader location; a source entry point at an absolute path does not relocate package resolution. Before using the runner across Windows and WSL, verify that the runtime platform matches both the installed native dependencies and any subprocess paths in the suite. For WSL tests that require POSIX shell paths, keep the Linux runtime and use `ESBUILD_BINARY_PATH` only with a platform-correct binary from a same-version, same-lockfile dependency tree. Before treating a source/dist parity failure as a code regression, run the repository gate that rebuilds ignored `dist/` output (`scripts/preflight-checks.sh`, search: `Typecheck + build (dist/ produced)`) and rerun the test. A missing target, source-resolution error, native-package mismatch, stale ignored build artifact, or cross-platform subprocess failure is an invocation failure until the resolved command also fails.

**What happened:** `node --test test/smoke/dashboard-endpoints.test.ts` failed resolving source `.js` specifiers because the focused command omitted this repo's `tsx` loader.

**Root cause:** I guessed a focused invocation instead of resolving the path and runner contract first.

**Recurrence 2026-08-01:** I derived the nonexistent path `test/unit/preflight-command-runner.test.mjs` from the source name. `rg --files | rg 'preflight|command-runner'` found `test/integration/preflight-progress.test.ts`; the corrected command passed all nine cases.

**Recurrence 2026-08-16:** I ran the documented focused command under WSL against a checkout whose `node_modules` had been installed by Windows. The `tsx` loader stopped before test discovery because `@esbuild/win32-x64` was present while Linux required `@esbuild/linux-x64`. A native Windows retry was not equivalent because the suite spawns `/bin/bash` with POSIX paths. Keeping the Linux runtime and setting `ESBUILD_BINARY_PATH` to the Linux binary from a same-version clone with the same lockfile hash made the exact local `tsx` command pass all 24 tests.

**Recurrence 2026-08-16 (ignored build output):** A direct `npm test` run reached all 2,043 tests but failed only `dashboard preset source/dist parity`. The source preset named all eight skills while the ignored local `dist/` artifact still named seven; neither parity input had a tracked working-tree change. Running the canonical preflight path rebuilds `dist/` with `tsc` before its test phase, so a direct fast-suite result from an old build is not source-regression evidence until the build output is refreshed.

**Recurrence 2026-08-21:** The first concise-help integration test spawned the source CLI with `--import tsx` while setting the child cwd to an empty temp project. Node resolved the package-name import from that cwd and failed with `ERR_MODULE_NOT_FOUND` before the CLI started. Keeping the child cwd at the repository, while using the temp path only as the no-write sentinel, restored the intended public-behavior proof. Evidence anchor: `test/integration/cli-help.test.ts` (search: `audit-output.json`).

---

## Lesson: `git archive` is not a clean-clone proof when tests require `.git`

**Status:** active | **Created:** 2026-06-01

**Prevention:** For "clean checkout" proofs, use a real clone when the test suite includes hooks, audit checks, or git-root discovery. Use `git archive` only for tests that are explicitly gitless. If an archive run fails with `deny-dangerous-self-test.sh --self-test=smoke failed`, rerun in a real clone before changing hook logic. Evidence anchors: `workflow/hooks/deny-dangerous.sh` (search: `resolve_goat_flow_root`), `.goat-flow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `expect_allow shell "echo safe"`), `test/unit/audit-command/agent-deny-hooks-drift.test.ts` (search: `passes when the installed deny hook matches the canonical template`), `package.json` (search: `"test:fast"`).

**What happened:** During M09 clean-checkout verification, `git archive HEAD | tar -x` produced a no-`dist/` tree, but `npm test` failed five deny-hook audit tests. The failure was not the test partition fix: the archived tree had no `.git`, so `workflow/hooks/deny-dangerous.sh` could not resolve `git rev-parse --git-common-dir` and failed closed. The equivalent local `git clone --no-hardlinks --branch fix/audit-drift-fast-slow-partition --single-branch ...` had `.git`, no `dist/`, and passed `npm test` with `# pass 557`, `# fail 0`, `CLONE_NPM_TEST_EXIT_0`.

**Root cause:** I treated an archive extraction as equivalent to a fresh clone. In this repo, deny-hook and audit tests intentionally rely on git-root discovery, so an archive is a different execution environment.

**Recurrence 2026-06-04:** While I was fixing PR #47 CI, a clean temporary worktree with symlinked `node_modules` and `dist` produced a false installer round-trip `Skill Template Drift` failure. Re-running the same patch from a clean worktree with real `npm ci` and `npm run build` passed. For installer round-trip proof, symlink shortcuts are not CI-equivalent because the fixture copies the source tree before preflight rebuilds it. Evidence anchors: `test/integration/audit-drift.helpers.ts` (search: `cpSync(PROJECT_ROOT, root`), `package.json` (search: `rmSync('dist'`).

---

## Lesson: `npx vitest` is not this repo's runner and trips on `_temp/stryker-tmp` sandboxes

**Status:** active | **Created:** 2026-06-14

**Prevention:** Use `node scripts/run-tests.mjs fast` (or `npm test`) for suite runs and `node --import tsx --test <specific-file.test.ts>` for focused files. Do not use `npx vitest` here. Read `No test suite found` originating from a `_temp/stryker-tmp/sandbox-*` path as a wrong-runner signal, not a product failure. Evidence anchors: `scripts/run-tests.mjs` (search: `listTestFiles`), `package.json` (search: `"test:fast": "node scripts/run-tests.mjs fast"`), and `.gitignore` (search: `_temp`).

**What happened:** Verifying goat-debug skill edits, I ran `npx vitest run test/contract/skill-hardening-contracts.test.ts test/unit/check-content-quality.test.ts`. Vitest treated the paths as substring filters and matched the gitignored mutation-testing sandboxes under `_temp/stryker-tmp/sandbox-*/`, whose stub copies contain no suites, so every run reported `No test suite found` and `8 failed`. The real `test/` files never executed. Re-running with `node --import tsx --test <files>` ran the actual suites (`# tests 54`).

**Root cause:** This repo's runner is `node scripts/run-tests.mjs fast` (node:test via `node --import tsx --test`), which walks only `test/` and never sees `_temp/`. Vitest is not wired into the project; invoking it globs the whole tree, including Stryker's local-only `_temp/stryker-tmp` sandboxes that are gitignored and hold stubbed test files.

**Recurrence 2026-06-14:** While searching for this lesson, I put the literal Markdown title `` `npx vitest` is not this repo's runner `` inside a double-quoted `rg` pattern. Bash treated the backticked text as command substitution and launched `npx vitest`, reproducing the same wrong-runner failure mode from a read-only search.

---

## Lesson: CI must use package test scripts after suite splits

**Status:** active | **Created:** 2026-06-01
**Merged:** 2026-09-05 - moved here from `.goat-flow/learning-loop/lessons/test-snapshots.md`; choosing the invocation CI runs belongs with the other runner-selection entries.

**Prevention:** After splitting, renaming, or serialising test files, compare `.github/workflows/ci.yml` against `package.json` test scripts before trusting local runs. Point CI at the package script that encodes exclusions/concurrency instead of duplicating a raw test glob. Evidence anchors: `.github/workflows/ci.yml` (search: `npm run test:fast`, `npm run test:slow:ci`), `CHANGELOG.md` (search: `CI uses the split test contract`), `package.json` (search: `"test:slow": "npm run build && node scripts/run-tests.mjs slow"`), `test/integration/audit-drift.helpers.ts` (search: `export {`), `test/integration/dashboard-server.helpers.ts` (search: `DASHBOARD_STATE_PATH`).

**What happened:** PR #45 split the audit-drift and dashboard integration tests into standalone files and updated `package.json` so fast tests exclude stateful dashboard suites while `test:slow` runs them serially. The GitHub Actions `Test` step still invoked the raw `node --import tsx --test --test-reporter=spec test/*/*.test.ts` glob, so CI bypassed the split-suite contract and failed on `test/integration/audit-drift.test.ts` with `ReferenceError: describe is not defined`. A local raw-glob rerun also exposed dashboard state cross-contamination in `dashboard /api/projects`.

**Root cause:** I updated the npm test scripts as the canonical suite entry points but did not update CI to call them, leaving Actions on an older invocation shape that no longer matched the test layout.

---

## Lesson: Node test filters must precede explicit test paths

**Status:** active | **Created:** 2026-08-01
**Merged:** 2026-09-05 - moved here from `.goat-flow/learning-loop/lessons/test-snapshots.md`; argument order for the runner belongs with the other invocation-shape entries.

**Decision changed:** Put Node test-runner filters before explicit test paths and verify the reported test count proves isolation.

**Trigger phase:** VERIFY

**Prevention:** Use `node --import tsx --test --test-name-pattern="<pattern>" <test-path>` and require both the named subtest and expected `# tests` count before treating the run as focused proof.

**What happened:** The M03 anchor command placed `--test-name-pattern` after the TypeScript test path. The Node/tsx runner executed all 110 contracts instead of the one anchor contract, so expected interim mirror failures obscured the intended proof. Moving the filter before the path produced exactly one passing test and the zero-miss diagnostic.

**Evidence:** `test/contract/skill-hardening-review-2.test.ts` (search: `goat-review internal anchors resolve to named current targets`) - this is the intended isolated contract; its diagnostic reports checked, exempted, and missed anchors.
