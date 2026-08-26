---
category: test-platform-compat
last_reviewed: 2026-08-27
---

**Scope:** Platform and runtime differences that break tests - CI Node versions older than local, Windows path/URL shapes and symlink privileges, filesystem-clock skew, and npm scripts that assume a POSIX shell. Choosing and invoking the runner is [test-execution-environment.md](test-execution-environment.md); shell and process behaviour under a test is [test-shell-environment.md](test-shell-environment.md).

## Lesson: Test runners need CI-runtime reproduction when local Node is newer

**Status:** active | **Created:** 2026-06-07 | **Incident count:** 4 | **Latest occurrence:** 2026-08-18

**What happened:** PR #48 local verification ran on Node 22 and passed the programmatic `node:test` runner path. GitHub Actions ran Node 20.20.2 and failed every `.ts` test with `TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".ts"` because the programmatic runner's `execArgv: ["--import", "tsx"]` path did not behave like the CLI preload path on the supported minimum Node version.

**Recurrence 2026-08-01:** PR #57 passed the staged-quality capture suite on local Node 22 but failed seven or eight cases per Node 20 CI run. The test override used `stableMs: 0`, yet the runtime still compared `Date.now() - stats.mtimeMs < 0`; CI filesystem timestamps could therefore leave a just-written draft unprocessed when its mtime appeared slightly ahead of the process clock. A deterministic future-mtime fixture reproduced the skipped draft. The correction makes zero explicitly disable the stability gate and keeps that future-mtime case in the focused suite.

**Recurrence 2026-08-02:** An alternate-Node probe passed Gruff's POSIX wrapper to Node as JavaScript, causing a false `SyntaxError`. Putting Node 20 on `PATH` and executing the wrapper normally proved `gruff-ts 0.4.0` ran.

**Recurrence 2026-08-18:** PR #60 passed its focused hook suite on local Linux but both Node 20.11.0 Windows jobs failed the same three post-turn cases. The shared root gate accepted case and separator changes but compared directory spellings only, so another Windows alias form could make one Git root look like two locations and suppress its Stop registration. The correction keeps the spelling fast path, falls back to the directory's device and inode/file ID, and adds an alias-form regression; the exact Windows job remains the release proof.

**Root cause:** The package advertised `node >=20.11.0`, but the implementations were verified only on a newer local runtime. A green local test did not prove the CI-supported runtime and filesystem-time behavior matched.

**Prevention:** When changing test infrastructure or platform-sensitive runtime code, reproduce the package's minimum supported Node path or the exact CI runner before treating local output as release evidence. Prefer CLI-shaped `node --import tsx --test ...` execution when CI already proves that form, and keep `scripts/run-tests.mjs` aligned with the `engines.node` floor. For shell-wrapped binaries, put the alternate Node on `PATH`; do not pass the wrapper to Node. Timing overrides must define zero explicitly and include a future-timestamp fixture instead of assuming the filesystem clock never leads `Date.now()`. A Windows path comparison that decides ownership or containment must handle aliases by proven filesystem identity, not case and separators alone. Evidence anchors: `scripts/run-tests.mjs` (search: `--import`), `test/unit/quality-draft-capture.test.ts` (search: `disables the mtime gate when the stability window is zero`), and `test/unit/hook-registrar-surfaces.test.ts` (search: `uses directory identity when Windows aliases have different spellings`).

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

**Status:** active | **Created:** 2026-05-11 | **Trigger phase:** ACT | **Incident count:** 3 | **Latest occurrence:** 2026-08-27
**Caught at:** VERIFY

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

**Recurrence 2026-08-22 (ACTUAL_MEASURED):** The ADR-053 Codex Windows work added three managed-shape fixtures (`symlinked registration`, `symlinked launcher`, `symlinked requested script`) that call `symlinkSync` through a shared data table, with no guard. All three threw `EPERM` on this host, alongside the pre-existing `rejects a scan root that escapes through a symlink`, turning four tests red for a fixture limitation rather than a defect. Measured directly: `node -e "require('fs').symlinkSync(...)"` returns `EPERM: operation not permitted`. The guard belongs at the point that owns the `TestContext`, while each link-dependent mutation explicitly opts into `EPERM` skipping. Ordinary mutations must rethrow `EPERM` so unrelated fixture failures stay visible. Hard-linked variants executed on this host, so `linkSync` coverage remained active. Anchors: `test/unit/hook-registrar-surfaces.test.ts` (search: `mutateOrSkip`), `test/unit/hook-registrar.helpers.ts` (search: `MANAGED_SHAPE_MUTATIONS`).

**Second recurrence 2026-08-22 (ACTUAL_MEASURED):** The focused ADR-053 hook suites passed on Windows, but the repository-wide fast suite still exited 1 on existing platform assumptions outside that patch. Unguarded symlink fixtures raised `EPERM`, and the direct hook probe passed an OS-native `C:\...` script path to Bash, which stripped the backslashes and returned 127. A focused pass is therefore not evidence of repository-wide Windows readiness. Anchors: `test/unit/hook-launcher.test.ts` (search: `fails closed when the managed hook script is a symlink`), `test/unit/hooks-runtime-evidence.test.ts` (search: `still executes a regular in-checkout hook script`).

**Third recurrence 2026-08-27 (ACTUAL_MEASURED):** The full Gruff smoke suite reached 18 passes but failed six cases on Windows. Two fixture setups called `symlinkSync` without a capability guard and raised `EPERM`; four self-test cases expected `chmod -x` to make an analyzer non-executable, a Unix permission transition this Windows filesystem did not represent. The focused Gruff contract and provider-adaptation suites passed separately, so these failures remain test-platform debt rather than evidence against the Codex PostToolUse fix. Anchors: `test/integration/gruff-code-quality-smoke.test.ts` (search: `accepts a contained configured analyzer symlink`) and `workflow/hooks/gruff-code-quality.sh` (search: `non-executable config override diagnostic failed`).

**Prevention:**
1. Any new test that calls `symlinkSync`, `linkSync`, or any privileged fs op must guard against `EPERM` with a `t.skip(...)`.
2. The skip message must name the platform constraint so a reader knows why coverage dropped, not just that it dropped.
3. Don't try to detect "is Windows" via `process.platform` - the privilege depends on Developer Mode / admin context, not the OS. Always try-and-catch.

---

## Lesson: Archive tools need shell-native relative paths on Windows

**Status:** active | **Created:** 2026-08-27 | **Trigger phase:** VERIFY | **Incident count:** 1 | **Latest occurrence:** 2026-08-27

**What happened:** The archived-package canary failed before it could execute Goat Flow. Node passed GNU tar an absolute `C:\...` archive path; tar interpreted the drive-letter colon as its remote-archive syntax and reported `Cannot connect to C: resolve failed`. Both package tests failed even though `npm pack` had produced the archive correctly.

**Root cause:** A child process can start successfully while still receiving paths in the wrong dialect. Git for Windows supplied a POSIX-oriented tar, but the native Node parent passed a Windows drive path to tar's `-f` argument.

**Prevention:** Give shell-oriented archive tools relative paths from an explicit `cwd` when a fixture controls both locations. This avoids drive-letter parsing and works on POSIX too. Re-run the complete archived-package canary after correcting the transport; do not replace it with a source-tree test. Evidence anchor: `test/integration/packaged-hook-install.test.ts` (search: `basename(packedArchivePath)`).

---

## Lesson: Shared npm build scripts must avoid shell builtins on Windows

**Status:** active | **Created:** 2026-04-29

**What happened:** `npm run dashboard` failed on Windows during `build:dashboard` with `The syntax of the command is incorrect.` even though Git's Unix tools were available on `PATH`. Reproducing the subcommand under `cmd.exe` showed `mkdir -p dist/dashboard` failing before the later copy steps ran.

**Root cause:** npm uses `cmd.exe` by default on Windows when `script-shell` is unset. Mixed shell chains are only partially portable in that setup: external GNU helpers such as `rm`, `cp`, and `chmod` may resolve from Git for Windows, but `cmd` still intercepts builtins like `mkdir` and applies Windows syntax rules.

**Prevention:** For shared npm scripts that create, remove, copy, discover, or glob files, prefer `node:fs` or an explicit cross-platform helper instead of raw `rm -rf`, `mkdir -p`, `cp`, `chmod`, shell command substitution, or shell-expanded globs in `package.json`. Evidence anchors: `package.json` (search: `require('node:fs').rmSync`), reproduction command `cmd /d /c "mkdir -p dist/dashboard"` -> `The syntax of the command is incorrect.`

**Updated 2026-06-07:** Windows preflight exposed the same portability class in test scripts: `npm run test:fast` failed before the suite started because `cmd.exe` parsed the Bash-only `$(find ... | sort)` expression as a Windows command, producing `'sort)' is not recognized as an internal or external command`. The fix moved test discovery into `scripts/run-tests.mjs` (search: `filesForMode`) and changed `package.json` (search: `node scripts/run-tests.mjs fast`) so `test:fast`, `test:coverage`, `test:slow`, and `test:performance` no longer depend on npm's shell.
