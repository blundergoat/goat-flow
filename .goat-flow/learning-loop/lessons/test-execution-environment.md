---
category: test-execution-environment
last_reviewed: 2026-06-07
---

## Lesson: Test runners need CI-runtime reproduction when local Node is newer

**Status:** active | **Created:** 2026-06-07

**What happened:** PR #48 local verification ran on Node 22 and passed the programmatic `node:test` runner path. GitHub Actions ran Node 20.20.2 and failed every `.ts` test with `TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".ts"` because the programmatic runner's `execArgv: ["--import", "tsx"]` path did not behave like the CLI preload path on the supported minimum Node version.

**Root cause:** The package advertised `node >=20.11.0`, but the first implementation was verified only on a newer local runtime. A green local `npm test` did not prove the CI-supported runtime could load TypeScript tests.

**Prevention:** When changing test infrastructure, reproduce the package's minimum supported Node path or the exact CI runner before treating local test output as release evidence. Prefer CLI-shaped `node --import tsx --test ...` execution when CI already proves that form, and keep `scripts/run-tests.mjs` aligned with the `engines.node` floor. Evidence anchor: `scripts/run-tests.mjs` (search: `--import`).

---

## Lesson: Real-timer terminal smoke tests need isolated verification

**Status:** active | **Created:** 2026-05-30

**What happened:** During `docs.missing-internal-function-doc` cleanup, a combined focused command that grouped the dashboard smoke test with heavier unit suites failed `uses the fallback deadline when runner output keeps updating`: `spawned.writes` was still `[]` at the 5600ms assertion. The touched code was comment-only. Rerunning `node --import tsx --test test/smoke/dashboard-endpoints.test.ts` immediately afterward passed with `# pass 15` / `# fail 0`; the two edited unit files also passed in isolated runs.

**Root cause:** The terminal smoke test uses real timers to assert a fallback deadline, while heavy audit-command coverage performs CPU-heavy repo audits in the same Node test process. Grouping them made the timer-sensitive assertion fail like a product regression even though the smoke file passed alone.

**Prevention:** When `test/smoke/dashboard-endpoints.test.ts` is in focused verification, run it as its own `node --import tsx --test` command. Run heavy audit suites separately, and treat a combined-run fallback-deadline failure as an invocation-shape suspect until the isolated smoke file fails too. Evidence anchors: `test/smoke/dashboard-endpoints.test.ts` (search: `uses the fallback deadline when runner output keeps updating`), `src/cli/audit/audit.ts` (search: `runAuditBatch`).

---

## Lesson: Browser terminal fixes need live runner proof, not just timer-unit proof

**Status:** active | **Created:** 2026-05-12

**What happened:** While fixing dashboard setup prompt submission, the focused terminal unit tests passed but the browser-use reproduction still stopped at Claude's `[Pasted text #1 +18 lines]` composer placeholder. Two assumptions were wrong: the fallback timer could race Claude's paste commit, and the pasted-text marker could arrive after pending paste state had already been cleared.

**Root cause:** The unit tests modeled ideal timer order, not the real terminal output order from Claude Code inside xterm/WebSocket. I treated "timer sent Enter in a fake clock" as equivalent to "Claude accepted the prompt" before running the original browser reproduction.

**Fix:** Keep a browser-use reproduction in the proof loop for terminal launch changes: click the real dashboard button, verify the prompt advances past `[Pasted text...]`, and then clean up the terminal session. Evidence anchors: `src/dashboard/dashboard-terminal-connect.ts` (search: `dashboardHandlePasteSubmitOutput`), `test/unit/dashboard-terminal-launch/launch-flow-01.test.ts` (search: `ignores a late Claude paste echo after the no-marker fallback submitted`).

**Prevention:** For terminal automation, unit tests must cover lost/late paste state, but the Definition of Done still requires live browser evidence against the runner that originally failed. Do not close on fake timers alone when xterm, WebSocket, or agent composer behavior is involved.

**Recurrence 2026-05-28:** A fake-timer fix added `TERMINAL_CLAUDE_PASTE_NO_MARKER_FALLBACK_DELAY_MS = 1500` and the built bundle contained it, but live WebSocket probing still showed bracketed paste followed by xterm DA response `\x1b[?1;2c` and then no Enter. The missing test variable was xterm's own protocol replies through `term.onData`: they were forwarded like keystrokes and cleared the pending fallback timer. Future terminal-submit tests must model the actual browser input stream, not just helper timers. Evidence anchors: `src/dashboard/dashboard-terminal.ts` (search: `dashboardTerminalDataLooksProtocolResponse`), `test/unit/dashboard-terminal-launch/launch-flow-01.test.ts` (search: `keeps Claude no-marker fallback armed across xterm protocol replies`).

---

## Lesson: `node --import <abs-path>` on Windows needs a file:// URL

**Status:** active | **Created:** 2026-05-11

**What happened:** Two `runCLI` test helpers (`test/unit/quality-command.test.ts`, `test/integration/quality-history-diff.test.ts`) passed `join(PROJECT_ROOT, "node_modules", "tsx", "dist", "loader.mjs")` to `spawnSync(process.execPath, ["--import", TSX_LOADER_PATH, ...])`. On Windows the path is `D:\dev-lab\...\loader.mjs`. Node's ESM loader rejected it with `ERR_UNSUPPORTED_ESM_URL_SCHEME: Only URLs with a scheme in: file, data, and node are supported by the default ESM loader. On Windows, absolute paths must be valid file:// URLs. Received protocol 'd:'.` Every test that shelled out via the helper failed with exit 1 - looked like CLI bugs, was actually the spawn shape. 25-test full-suite failure baseline on 2026-05-11 included these as 7-8 of the original count.

**Root cause:** Node's `--import` flag goes through the ESM loader, which parses the value as a URL. Drive-letter `D:` looks like a scheme. POSIX absolute paths happen to be valid `file://` -less URLs on Linux/macOS so the bug never surfaces there.

**Fix:** Convert the loader path via `pathToFileURL(...).href` before passing to `--import`:
```ts
import { pathToFileURL } from "node:url";
const TSX_LOADER_URL = pathToFileURL(
  join(PROJECT_ROOT, "node_modules", "tsx", "dist", "loader.mjs"),
).href;
spawnSync(process.execPath, ["--import", TSX_LOADER_URL, CLI_PATH, ...args], ...);
```

**Prevention:**
1. Any test that spawns Node with `--import`, `--loader`, or `--experimental-loader` and passes an absolute path must convert it via `pathToFileURL` first.
2. Same rule applies to dynamic `import()` of absolute paths in production code on Windows. `import("D:\\...\\foo.js")` will throw; `import(pathToFileURL("D:\\...\\foo.js").href)` works.
3. Treat `ERR_UNSUPPORTED_ESM_URL_SCHEME` as a likely Windows path-shape issue, not an actual code bug, until the file:// conversion is verified.

---

## Lesson: Windows test runs require explicit EPERM handling for symlink fixtures

**Status:** active | **Created:** 2026-05-11

**What happened:** Three tests (`main-module guard via symlink`, `skips symlink entries in skill walk roots`, `rejects upload paths that escape through symlinked components`) call `fs.symlinkSync()` to build fixtures. On Windows without Developer Mode (or admin rights), `symlinkSync` throws `EPERM: operation not permitted`. The tests failed because they treated the fixture setup as guaranteed; the production code under test is correct on all platforms, but the test harness can't reach it.

**Root cause:** Windows blocks unprivileged symlink creation by default. Test fixtures need to be defensive about platform capabilities. Plain `assert.fail`-on-error is wrong because the test infrastructure - not the code under test - is unreachable.

**Fix:** Wrap `symlinkSync` in a helper that catches `EPERM` and calls `t.skip(...)`:
```ts
function symlinkOrSkip(t: TestContext, target: string, link: string): boolean {
  try { symlinkSync(target, link); return true; }
  catch (err) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === "EPERM") {
      t.skip("Skipped: host blocks unprivileged symlinks (Windows without Developer Mode)");
      return false;
    }
    throw err;
  }
}
```
Each test that uses `symlinkSync` accepts a `TestContext` arg (`(t) => { ... }`) and bails early when the helper returns false. Evidence: `test/integration/main-guard.test.ts` (search: `symlinkOrSkip`), `test/unit/skill-quality/helpers.ts` (search: `symlinkOrSkip`), `test/unit/terminal-uploads.test.ts` (search: `symlinkOrSkip`).

**Prevention:**
1. Any new test that calls `symlinkSync`, `linkSync`, or any privileged fs op must guard against `EPERM` with a `t.skip(...)`.
2. The skip message must name the platform constraint so a reader knows why coverage dropped, not just that it dropped.
3. Don't try to detect "is Windows" via `process.platform` - the privilege depends on Developer Mode / admin context, not the OS. Always try-and-catch.

---

## Lesson: `npm test -- <file>` can still run the full suite

**Status:** active | **Created:** 2026-04-18

**What happened:** A focused verification run used `npm test -- test/unit/quality-command.test.ts`, expecting only the quality prompt tests to run. In this repo, `package.json` defines `test` as `node --import tsx --test test/*/*.test.ts`, so npm appended the file argument without removing the existing glob. The command still executed the full suite and surfaced unrelated audit failures, obscuring whether the changed file actually passed its own regression.

**Root cause:** Assumed npm positional passthrough would replace the script's built-in test target. It only appends arguments, so any existing glob or file list in the script still runs unless the underlying command supports overriding it.

**Fix:** For focused test verification in this repo, invoke the underlying command directly: `node --import tsx --test test/unit/quality-command.test.ts`. Reserve `npm test` for deliberate full-suite runs.

---

## Lesson: Test suite must exercise the published invocation path

**Status:** active | **Created:** 2026-04-24

**What happened:** Commit 918ca3e wrapped the bare `main().catch(...)` call in an `import.meta.url` guard to prevent side effects on import. The guard used `resolve(process.argv[1]) === fileURLToPath(import.meta.url)`, which silently fails when the CLI is invoked through a symlink (the standard npm/npx path). All 359 tests passed because every test imports CLI functions directly or shells out via `node dist/cli/cli.js` - no test invoked the binary through a symlink, which is how every real consumer runs it.

**Root cause:** The test suite verified internal function behavior but never exercised the actual entry-point guard through the `.bin/` symlink path that `npx` uses. The refactor commit was titled "update goat-critique documentation," making it easy to overlook a CLI entry-point change during review.

**Prevention:**
1. `test/integration/main-guard.test.ts` now tests the CLI via a temp-dir symlink - the exact path that broke. This test would have caught the regression.
2. When modifying the entry-point guard or anything that controls whether `main()` runs, verify via symlink invocation, not just direct `node dist/cli/cli.js`.

---

## Lesson: Source-mode CLI proof does not refresh the package binary

**Status:** active | **Created:** 2026-04-27

**What happened:** A static detector patch made `node --import tsx src/cli/cli.ts audit . --harness --agent claude` pass, but the exact user-facing reproduction `npx goat-flow audit . --harness --agent claude` still failed because `npx` used the package `bin` path in `dist/cli/cli.js`. The built `dist/` copy still contained the old detector until `npm run build` refreshed it.

**Root cause:** I treated source-mode CLI verification as equivalent to the packaged invocation path. In this repo, `npx goat-flow` exercises `package.json` `bin`, so local source edits do not affect that command until the build output is regenerated.

**Prevention:**
1. When fixing a failure reported with `npx goat-flow ...`, rerun that exact command after `npm run build`, even if the `node --import tsx src/cli/cli.ts ...` source path already passes.
2. If source-mode and `npx` results disagree, check `dist/` freshness before changing the business logic again.

---

## Lesson: Focused TypeScript tests in this repo need the `tsx` loader

**Status:** active | **Created:** 2026-04-29

**What happened:** The first focused verification run used `node --test test/smoke/dashboard-endpoints.test.ts` and failed with `ERR_MODULE_NOT_FOUND` while resolving the source module at `src/cli/server/terminal.ts`. The code change was not the problem; the test file imports source modules using `.js` specifiers that are resolved correctly when the repo's TypeScript loader is active.

**Root cause:** I ran the focused suite outside the repo's declared test invocation path. `package.json` (search: `"test:fast": "node scripts/run-tests.mjs fast"`) makes `tsx` part of the contract for source-mode tests, so plain `node --test` is a verification mistake here, not reliable failure evidence.

**Fix:** Re-run focused TypeScript tests with `node --import tsx --test <file>` before treating missing-module output as a real regression.

**Prevention:**
1. When a focused repo test imports `src/**/*.js` from the source tree, check `package.json` for the required loader before running it directly.
2. Treat a plain-Node `ERR_MODULE_NOT_FOUND` on source `.js` specifiers as a likely invocation-path problem until the `tsx`-loaded run fails too.

---

## Lesson: Serve local HTML over localhost for browser-use evidence

**Status:** active | **Created:** 2026-04-27

**What happened:** During M12 browser-use verification, `browser-use open file:///home/devgoat/projects/goat-flow/docs/site/goat-flow-landing.html` succeeded at navigation but `browser-use state` returned `Empty DOM tree`. Serving the same directory with `python3 -m http.server 4182 --bind 127.0.0.1` and opening `http://127.0.0.1:4182/goat-flow-landing.html` returned the expected rendered page state and screenshot.

**Root cause:** A `file://` URL is not representative enough for local browser evidence in this agent environment. The browser navigation can succeed while DOM/state capture is empty, which makes a false negative look like a page problem.

**Prevention:** For local HTML/browser-use verification, serve the directory over localhost before opening the page. Treat `file://` empty DOM output as a verification-environment issue to rerun over HTTP before drawing conclusions. Evidence anchors: `workflow/skills/playbooks/browser-use.md` (search: `Local HTML shows an empty DOM`), `.goat-flow/skill-docs/playbooks/browser-use.md` (search: `serve the directory over localhost`).

---

## Lesson: Browser-use installer smoke must exercise the wrapper path

**Status:** active | **Created:** 2026-05-12

**What happened:** While fixing browser-use availability, `browser-use doctor` and direct Python Playwright launch passed, but `browser-use open https://example.com` failed with a 30s `BrowserStartEvent` timeout. Foreground daemon logs showed `BrowserSession` launched `/usr/bin/google-chrome-stable` and then waited for CDP. Inspecting `BrowserSession(headless=True).browser_profile.get_args()` showed no `--no-sandbox`; setting `IN_DOCKER=true` made `browser-use open` and `browser-use state` pass. A first installer smoke used `file://` and produced an empty title, repeating the existing local-file browser-use trap.

**Root cause:** The installer verified the Python modules and direct Playwright launch path, but not the generated `browser-use` wrapper and daemon launch path. In this root container, browser-use's Docker detection returned false, so it omitted Chrome's no-sandbox flags and Chrome exited before CDP came up. `browser-use close` also removed session metadata while leaving the daemon/browser process alive in this environment.

**Prevention:** Browser tooling installers must run a real wrapper-level smoke: `command -v browser-use`, `browser-use open` against a localhost-served page, a DOM/title read, and session cleanup. For root-run wrappers, set `IN_DOCKER=true` before `browser_use.config` imports so Chrome gets no-sandbox flags. Snapshot and reap browser-use daemon PIDs around `close`, because PID files may disappear before the process exits. Evidence anchors: `scripts/install-browser-tools.sh` (search: `browser-use uses IN_DOCKER`), `scripts/install-browser-tools.sh` (search: `Verifying browser-use CLI launches`), `scripts/install-browser-tools.sh` (search: `browser_use_kill_pid`).

---

## Lesson: Shared npm build scripts must avoid shell builtins on Windows

**Status:** active | **Created:** 2026-04-29

**What happened:** `npm run dashboard` failed on Windows during `build:dashboard` with `The syntax of the command is incorrect.` even though Git's Unix tools were available on `PATH`. Reproducing the subcommand under `cmd.exe` showed `mkdir -p dist/dashboard` failing before the later copy steps ran.

**Root cause:** npm uses `cmd.exe` by default on Windows when `script-shell` is unset. Mixed shell chains are only partially portable in that setup: external GNU helpers such as `rm`, `cp`, and `chmod` may resolve from Git for Windows, but `cmd` still intercepts builtins like `mkdir` and applies Windows syntax rules.

**Prevention:** For shared npm scripts that create, remove, copy, discover, or glob files, prefer `node:fs` or an explicit cross-platform helper instead of raw `rm -rf`, `mkdir -p`, `cp`, `chmod`, shell command substitution, or shell-expanded globs in `package.json`. Evidence anchors: `package.json` (search: `require('node:fs').rmSync`), reproduction command `cmd /d /c "mkdir -p dist/dashboard"` -> `The syntax of the command is incorrect.`

**Updated 2026-06-07:** Windows preflight exposed the same portability class in test scripts: `npm run test:fast` failed before the suite started because `cmd.exe` parsed the Bash-only `$(find ... | sort)` expression as a Windows command, producing `'sort)' is not recognized as an internal or external command`. The fix moved test discovery into `scripts/run-tests.mjs` (search: `filesForMode`) and changed `package.json` (search: `node scripts/run-tests.mjs fast`) so `test:fast`, `test:coverage`, `test:slow`, and `test:performance` no longer depend on npm's shell.

---

## Lesson: A hook's silent output is not proof of non-execution - verify through the test harness

**Status:** active | **Created:** 2026-06-01

**What happened:** Proving the gruff-code-quality hook no longer discovers binaries from the removed `*/.venv/bin` glob or `target/debug` paths (ADR-032), I wrote ad-hoc bash repros that ran the old and new hook against a planted binary. Both printed nothing, so the before/after looked identical and the fix unprovable. The isolated discovery loop, however, showed the old glob clearly resolved the binary - so the repros were wrong, not the fix. They `git init`-ed the temp repo and discarded stderr.

**Root cause:** The hook resolves its root with `repo_root() { git rev-parse --show-toplevel 2>/dev/null || pwd; }`, then fail-soft-exits silently at several early gates (no `.<binary>.yaml` config at root, no `jq`, no binary, no changed range). The smoke-test fixtures deliberately do NOT init git, so `repo_root` falls to `pwd` and the planted files resolve; my `git init` made `repo_root` resolve elsewhere, so the hook bailed before discovery. Discarding stderr hid the diagnostic that would have shown the early exit. A "silent" run looked like "binary not executed" when it was really "exited before reaching discovery."

**Fix:** Stop trusting the ad-hoc repro. Verify through the project's node test harness, which already encodes the right preconditions, and prove the guard by swapping the pre-fix hook in: the regression test failed against commit 4e43cf3d (`not ok ... expected silence for src/example.ts`) and passed against the fix - a real before/after.

**Prevention:** To prove a PostToolUse hook's behaviour change, run it through the project's test harness and mirror its fixture setup exactly, rather than an ad-hoc shell repro; if you must repro by hand, replicate `repo_root` (git-vs-pwd), the pinned `PATH` (must include `jq`), and the config/binary preconditions, and never discard stderr. Treat a silent hook run as inconclusive until every fail-soft early-exit gate is ruled out. To prove a regression test actually guards a fix, run it against the pre-fix revision and confirm it fails. Evidence anchors: `workflow/hooks/gruff-code-quality.sh` (search: `repo_root`), `workflow/hooks/gruff-code-quality.sh` (search: `no changed lines detected`), `test/integration/gruff-code-quality-smoke.test.ts` (search: `does not discover binaries from the removed`).

---

## Lesson: `git archive` is not a clean-clone proof when tests require `.git`

**Status:** active | **Created:** 2026-06-01

**What happened:** During M09 clean-checkout verification, `git archive HEAD | tar -x` produced a no-`dist/` tree, but `npm test` failed five deny-hook audit tests. The failure was not the test partition fix: the archived tree had no `.git`, so `workflow/hooks/deny-dangerous.sh` could not resolve `git rev-parse --git-common-dir` and failed closed. The equivalent local `git clone --no-hardlinks --branch fix/audit-drift-fast-slow-partition --single-branch ...` had `.git`, no `dist/`, and passed `npm test` with `# pass 557`, `# fail 0`, `CLONE_NPM_TEST_EXIT_0`.

**Root cause:** I treated an archive extraction as equivalent to a fresh clone. In this repo, deny-hook and audit tests intentionally rely on git-root discovery, so an archive is a different execution environment.

**Recurrence 2026-06-04:** While fixing PR #47 CI, a clean temporary worktree with symlinked `node_modules` and `dist` produced a false installer round-trip `Skill Template Drift` failure. Re-running the same patch from a clean worktree with real `npm ci` and `npm run build` passed. For installer round-trip proof, symlink shortcuts are not CI-equivalent because the fixture copies the source tree before preflight rebuilds it. Evidence anchors: `test/integration/audit-drift.helpers.ts` (search: `cpSync(PROJECT_ROOT, root`), `package.json` (search: `rmSync('dist'`).

**Prevention:** For "clean checkout" proofs, use a real clone when the test suite includes hooks, audit checks, or git-root discovery. Use `git archive` only for tests that are explicitly gitless. If an archive run fails with `deny-dangerous-self-test.sh --self-test=smoke failed`, rerun in a real clone before changing hook logic. Evidence anchors: `workflow/hooks/deny-dangerous.sh` (search: `resolve_goat_flow_root`), `.goat-flow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `expect_allow shell "echo safe"`), `test/unit/audit-command/agent-deny-hooks.test.ts` (search: `passes when the installed deny hook matches the canonical template`), `package.json` (search: `"test:fast"`).
