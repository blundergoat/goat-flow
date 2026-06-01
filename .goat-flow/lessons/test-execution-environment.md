---
category: test-execution-environment
last_reviewed: 2026-06-01
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

**Root cause:** I ran the focused suite outside the repo's declared test invocation path. `package.json` (search: `"test:fast": "node --import tsx --test`) makes `tsx` part of the contract for source-mode tests, so plain `node --test` is a verification mistake here, not reliable failure evidence.

**Fix:** Re-run focused TypeScript tests with `node --import tsx --test <file>` before treating missing-module output as a real regression.

**Prevention:**
1. When a focused repo test imports `src/**/*.js` from the source tree, check `package.json` for the required loader before running it directly.
2. Treat a plain-Node `ERR_MODULE_NOT_FOUND` on source `.js` specifiers as a likely invocation-path problem until the `tsx`-loaded run fails too.

---

## Lesson: Serve local HTML over localhost for browser-use evidence

**Status:** active | **Created:** 2026-04-27

**What happened:** During M12 browser-use verification, `browser-use open file:///home/devgoat/projects/goat-flow/docs/site/goat-flow-landing.html` succeeded at navigation but `browser-use state` returned `Empty DOM tree`. Serving the same directory with `python3 -m http.server 4182 --bind 127.0.0.1` and opening `http://127.0.0.1:4182/goat-flow-landing.html` returned the expected rendered page state and screenshot.

**Root cause:** A `file://` URL is not representative enough for local browser evidence in this agent environment. The browser navigation can succeed while DOM/state capture is empty, which makes a false negative look like a page problem.

**Prevention:** For local HTML/browser-use verification, serve the directory over localhost before opening the page. Treat `file://` empty DOM output as a verification-environment issue to rerun over HTTP before drawing conclusions. Evidence anchors: `workflow/skills/playbooks/browser-use.md` (search: `Local HTML shows an empty DOM`), `.goat-flow/skill-playbooks/browser-use.md` (search: `serve the directory over localhost`).

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

**Prevention:** For shared npm scripts that create, remove, or copy files, prefer `node:fs` or an explicit cross-platform helper instead of raw `rm -rf`, `mkdir -p`, `cp`, or `chmod` in `package.json`. Evidence anchors: `package.json` (search: `require('node:fs').rmSync`), reproduction command `cmd /d /c "mkdir -p dist/dashboard"` -> `The syntax of the command is incorrect.`
