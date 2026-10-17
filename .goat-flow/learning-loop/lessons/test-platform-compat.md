---
category: test-platform-compat
last_reviewed: 2026-10-17
---

**Scope:** Platform and runtime differences that break tests - CI Node versions older than local, Windows path/URL shapes and symlink privileges, filesystem-clock skew, and npm scripts that assume a POSIX shell. Choosing and invoking the runner is [test-execution-environment.md](test-execution-environment.md); shell and process behaviour under a test is [test-shell-environment.md](test-shell-environment.md).

## Lesson: Test runners need CI-runtime reproduction when local Node is newer

**Status:** active | **Created:** 2026-06-07 | **Incident count:** 7 | **Latest occurrence:** 2026-10-17
**Severity:** INTEGRATION

**Prevention:** When changing test infrastructure or platform-sensitive runtime code, reproduce the package's minimum supported Node path or the exact CI runner before treating local output as release evidence. Prefer CLI-shaped `node --import tsx --test ...` execution when CI already proves that form, and keep `scripts/run-tests.mjs` aligned with the `engines.node` floor. For shell-wrapped binaries, put the alternate Node on `PATH`; do not pass the wrapper to Node. Timing overrides must define zero explicitly and include a future-timestamp fixture instead of assuming the filesystem clock never leads `Date.now()`. A Windows path comparison that decides ownership or containment must handle aliases by proven filesystem identity, not case and separators alone. Evidence anchors: `scripts/run-tests.mjs` (search: `--import`), `test/unit/quality-draft-capture.test.ts` (search: `disables the mtime gate when the stability window is zero`), and `test/unit/hook-registrar-surfaces.test.ts` (search: `uses directory identity when Windows aliases have different spellings`).

**What happened:** PR #48 local verification ran on Node 22 and passed the programmatic `node:test` runner path. GitHub Actions ran Node 20.20.2 and failed every `.ts` test with `TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".ts"` because the programmatic runner's `execArgv: ["--import", "tsx"]` path did not behave like the CLI preload path on the supported minimum Node version.

**Incident ledger:**

- **Recurrence 2026-08-01:** PR #57's Node 20 CI failures came from treating `stableMs: 0` as an active mtime check. Future filesystem timestamps suppressed fresh drafts. Zero now disables the check, with a future-mtime regression in `test/unit/quality-draft-capture.test.ts` (search: `disables the mtime gate when the stability window is zero`).

- **Recurrence 2026-08-02:** Passing Gruff's POSIX wrapper to Node as JavaScript caused a false `SyntaxError`. Put the alternate Node on `PATH` and execute the wrapper normally; this proved `gruff-ts 0.4.0` ran. The npm invocation is owned by `package.json` (search: `"gruff-ts": "gruff-ts"`).

- **Recurrence 2026-08-18:** PR #60's Windows jobs failed three post-turn cases because the root gate compared directory spellings, suppressing Stop registration for another alias of the same Git root. Keep the spelling fast path, then compare device and inode/file ID. The alias regression is in `test/unit/hook-registrar-surfaces.test.ts` (search: `uses directory identity when Windows aliases have different spellings`); the exact Windows job remains the release proof.

- **Recurrence 2026-10-17:** Node 24.21.0 failed nine native audit/probe cases that passed on Node 22.22.1 and 20.11.0: `--import tsx` started esbuild inside the restricted child, and the guard refused it. Build first with the producer runtime, then import built CLI JavaScript; keep the compiler outside the consumer allowlist. Evidence: `test/helpers/spawn-guard.mjs` (search: `GOAT_TEST_SPAWN_DENIED`), `test/integration/hook-direct-native-probe.test.ts` (search: `PROBE_MODULE`) and `test/integration/hook-native-audit-mechanism.test.ts` (search: `MECHANISM_MODULE`).

- **Recurrence 2026-10-17:** The hosted hook matrix lacked supported Bash on macOS and jq in WSL. Windows expanded short fixture paths, omitted the admitted PowerShell directory from restricted PATH and reported EPERM during timeout teardown. Provision retained controls' tools, use native physical paths, include admitted executable directories on PATH and bound cleanup retries. Local WSL proof did not cover the other hosts. Evidence: `.github/workflows/ci.yml` (search: `Prepare macOS Bash controls`), `test/integration/hook-command-native-replay.test.ts` (search: `realpathSync.native`), `test/helpers/restricted-consumer-env.ts` (search: `powershellDirectory`) and `test/unit/hook-registrar.helpers.ts` (search: `maxRetries`).

- **Recurrence 2026-10-17:** Windows/20.11.0 hook CI stopped reporting progress while the same suites passed on Linux, macOS and Windows/24.21.0. A native Windows probe isolated an upstream filesystem defect: creating an emoji directory returned ENOENT, and recursive creation hung until the parent's three-second timeout. The same recursive probe and focused launcher checks passed on 20.12.0. Keep the Unicode-path assertions and seek approval for a runtime-floor amendment rather than hiding the gap with ASCII fixtures. Evidence: `test/unit/hook-launch.test.ts` (search: `project '$& 🐐`), `test/integration/hook-command-native-replay.test.ts` (search: `native's flow & (quoted) [fixture] 🐐`), `package.json` (search: `"engines"`) and the [upstream Windows filename incident and 20.12.0 backport](https://github.com/nodejs/node/issues/48673). The bounded local reproduction establishes the filesystem defect; it does not establish the complete hosted job's state.

**Root cause:** Local verification did not reproduce the supported runtime, host tools, path aliases or filesystem timing. A local pass could therefore miss failures in CI's actual environment.

---

## Lesson: `node --import <abs-path>` on Windows needs a file:// URL

**Status:** active | **Created:** 2026-05-11

**Prevention:**
1. Any test that spawns Node with `--import`, `--loader`, or `--experimental-loader` and passes an absolute path must convert it via `pathToFileURL` first.
2. Same rule applies to dynamic `import()` of absolute paths in production code on Windows. `import("D:\\...\\foo.js")` will throw; `import(pathToFileURL("D:\\...\\foo.js").href)` works.
3. Treat `ERR_UNSUPPORTED_ESM_URL_SCHEME` as a likely Windows path-shape issue, not an actual code bug, until the file:// conversion is verified.

**What happened:** Two `runCLI` test helpers (`test/unit/quality-command.test.ts`, `test/integration/quality-history-diff.test.ts`) passed `join(PROJECT_ROOT, "node_modules", "tsx", "dist", "loader.mjs")` to `spawnSync(process.execPath, ["--import", TSX_LOADER_PATH, ...])`. On Windows the path is `D:\dev-lab\...\loader.mjs`. Node's ESM loader rejected it with `ERR_UNSUPPORTED_ESM_URL_SCHEME: Only URLs with a scheme in: file, data, and node are supported by the default ESM loader. On Windows, absolute paths must be valid file:// URLs. Received protocol 'd:'.` Every test that shelled out via the helper failed with exit 1 - the failures looked like CLI bugs but came from the spawn shape. The 25-test full-suite failure baseline on 2026-05-11 included these as 7-8 of the original count.

**Root cause:** Node's `--import` flag goes through the ESM loader, which parses the value as a URL. Drive-letter `D:` looks like a scheme. POSIX absolute paths happen to be valid `file://`-less URLs on Linux/macOS so the bug never surfaces there.

**Fix:** Convert the loader path via `pathToFileURL(...).href` before passing to `--import`:
```ts
import { pathToFileURL } from "node:url";
const TSX_LOADER_URL = pathToFileURL(
  join(PROJECT_ROOT, "node_modules", "tsx", "dist", "loader.mjs"),
).href;
spawnSync(process.execPath, ["--import", TSX_LOADER_URL, CLI_PATH, ...args], ...);
```

---

## Lesson: Windows test runs require explicit EPERM handling for symlink fixtures

**Status:** active | **Created:** 2026-05-11 | **Trigger phase:** ACT | **Incident count:** 6 | **Latest occurrence:** 2026-09-27
**Severity:** INTEGRATION
**Caught at:** VERIFY

**Prevention:**
1. Isolate a privileged link operation before treating its EPERM as a capability skip; unexpected setup failures must propagate.
2. The skip message must name the platform constraint so a reader knows why coverage dropped, not just that it dropped.
3. Do not decide a capability skip from process.platform; probe the operation because privileges depend on the host context. A supported equivalent fixture, such as a Windows directory junction, can retain the invariant without a skip.
4. Capture the underlying error name, code, syscall, path and destination before a saver wraps it. Distinguish symlink refusal from rename or open failure, and name a capable host that runs any skipped security invariant.
5. Split mixed fixtures before adding a capability skip. A symlink limitation must not suppress hard-link checks or unrelated revision and receipt assertions.

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

Incident ledger: distinguish a missing fixture capability from a product failure, and keep unrelated assertions running.

- **Recurrence 2026-08-22 (ACTUAL_MEASURED):** Three managed-shape fixtures and an existing scan-root fixture raised symlink `EPERM`; hard-linked variants ran. Guard only link mutations at their owning `TestContext`, preserving other filesystem failures. Anchors: `test/unit/hook-registrar-surfaces.test.ts` (search: `mutateOrSkip`) and `test/unit/hook-registrar.helpers.ts` (search: `MANAGED_SHAPE_MUTATIONS`).
- **Recurrence 2026-08-22 (ACTUAL_MEASURED):** Focused ADR-053 suites passed, but the native fast suite failed on unguarded symlinks and a `C:\...` hook path whose backslashes Bash consumed, returning 127. Anchors: `test/unit/hook-launcher.test.ts` (search: `fails closed when the managed hook script is a symlink`) and `test/unit/hooks-runtime-evidence.test.ts` (search: `still executes a regular in-checkout hook script`).
- **Recurrence 2026-08-27 (ACTUAL_MEASURED):** Gruff smoke reached 18 passes and six failures: two symlink refusals and four synthetic Windows mode-bit mismatches. Launcher tests reached 34 passes with three symlink failures; seven focused timeout/path/output controls and the Gruff provider suites passed. Anchors: `test/integration/gruff-code-quality-smoke.test.ts` (search: `accepts a contained configured analyzer symlink`), `test/unit/hook-launcher.test.ts` (search: `fails closed when the managed hook script is a symlink`), and `workflow/hooks/gruff-code-quality.sh` (search: `non-executable config override diagnostic failed`).
- **Recurrence 2026-09-13:** The change passed save but failed three race fixtures: symlink refusal after two successful renames and rename refusal with an open descriptor. Junctions preserved the redirect assertions; a separate rename probe skipped only that syscall's EPERM, while Linux ran all assertions. Anchors: `test/unit/quality-subcommands.test.ts` (search: `DIRECTORY_LINK_TYPE`, `first-save race replaces an existing ancestor`, `allocation follows a swapped parent`), `test/unit/quality-save-safety.test.ts` (search: `rename-probe`, `allocated report parent moves during writing`), and `src/cli/quality/quality-command.ts` (search: `could not persist the validated report`).
- **Recurrence 2026-09-27:** The native 1.17.0 assessment reported 71 failures across product defects and assumptions about privileges, modes, signals and paths. The capability probe and platform-specific assertions preserve surrounding behavior checks. A recheck separated incompatible revisions and hard-link receipts from symlink skips. Anchors: `test/helpers/symlink-capability.ts` (search: `symlinkTestOptions`), `test/unit/quality-draft-staging.test.ts` (search: `win32`), `test/unit/review-validate.helpers.ts` (search: `ETIMEDOUT`), `test/integration/review-validate-authority.test.ts` (search: `refuses incompatible execution views without requiring symlinks`), and `test/unit/quality-draft-capture.test.ts` (search: `receipt destination`). Run the complete native suite after focused repairs.

---

## Lesson: Archive tools need shell-native relative paths on Windows

**Status:** active | **Created:** 2026-08-27 | **Trigger phase:** VERIFY | **Incident count:** 1 | **Latest occurrence:** 2026-08-27

**Prevention:** Give shell-oriented archive tools relative paths from an explicit `cwd` when a fixture controls both locations. This avoids drive-letter parsing and works on POSIX too. Re-run the complete archived-package canary after correcting the transport; do not replace it with a source-tree test. Evidence anchor: `test/integration/packaged-hook-install.test.ts` (search: `basename(packedArchivePath)`).

**What happened:** The archived-package canary failed before it could execute Goat Flow. Node passed GNU tar an absolute `C:\...` archive path; tar interpreted the drive-letter colon as its remote-archive syntax and reported `Cannot connect to C: resolve failed`. Both package tests failed even though `npm pack` had produced the archive correctly.

**Root cause:** A child process can start successfully while still receiving paths in the wrong dialect. Git for Windows supplied a POSIX-oriented tar, but the native Node parent passed a Windows drive path to tar's `-f` argument.

---

## Lesson: Shared npm build scripts must avoid shell builtins on Windows

**Status:** active | **Created:** 2026-04-29

**Prevention:** For shared npm scripts that create, remove, copy, discover, or glob files, prefer `node:fs` or an explicit cross-platform helper instead of raw `rm -rf`, `mkdir -p`, `cp`, `chmod`, shell command substitution, or shell-expanded globs in `package.json`. Evidence anchors: `package.json` (search: `require('node:fs').rmSync`), reproduction command `cmd /d /c "mkdir -p dist/dashboard"` -> `The syntax of the command is incorrect.`

**What happened:** `npm run dashboard` failed on Windows during `build:dashboard` with `The syntax of the command is incorrect.` even though Git's Unix tools were available on `PATH`. Reproducing the subcommand under `cmd.exe` showed `mkdir -p dist/dashboard` failing before the later copy steps ran.

**Root cause:** npm uses `cmd.exe` by default on Windows when `script-shell` is unset. Mixed shell chains are only partially portable in that setup: external GNU helpers such as `rm`, `cp`, and `chmod` may resolve from Git for Windows, but `cmd` still intercepts builtins like `mkdir` and applies Windows syntax rules.

**Updated 2026-06-07:** Windows preflight exposed the same portability class in test scripts: `npm run test:fast` failed before the suite started because `cmd.exe` parsed the Bash-only `$(find ... | sort)` expression as a Windows command, producing `'sort)' is not recognized as an internal or external command`. The fix moved test discovery into `scripts/run-tests.mjs` (search: `filesForMode`) and changed `package.json` (search: `node scripts/run-tests.mjs fast`) so `test:fast`, `test:coverage`, `test:slow`, and `test:performance` no longer depend on npm's shell.
