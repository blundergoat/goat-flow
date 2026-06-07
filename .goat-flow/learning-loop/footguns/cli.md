---
category: cli
last_reviewed: 2026-05-25
---

## Footgun: Host-native paths leak into user-visible CLI output on Windows

**Status:** active | **Created:** 2026-05-11 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Windows users see `C:\Users\thatm\...` style backslash paths in setup prompts, audit `evidence` fields, quality `QUALITY_DIR` Bash snippets, skill scaffold output, glob results, and the `getCliCommand()` re-run hint. When an agent reads the prompt and runs `mkdir -p "C:\Users\..."` inside a Bash subshell, the backslashes act as escape characters and the command fails. Tests written with POSIX-shape assertions also fail (string-equality on `.endsWith(".claude/skills/...")` etc.). A full-suite run on 2026-05-11 had 25 failures all rooted here.

**Why it happens:** `path.join`, `path.resolve`, and `path.relative` from `node:path` use OS-native separators on Windows. Every place a path is composed for *user-visible* output (prompts, audit findings, JSON payloads, dashboard strings) inherits that shape. The same path is fine for `node:fs` operations (which accept either separator), so the bug is invisible until output is rendered.

**Evidence:**
- `src/cli/install-invocation.ts` (search: `toBashPath`) - forward-slashes installer argv on win32.
- `src/cli/prompt/compose-quality-agent-report.ts` (search: `toShellProjectPath`) - posix.join + forward-slash for `QUALITY_DIR` Bash snippets, plus matching test `shell-quotes quality report paths in agent-setup prompt snippets`.
- `src/cli/prompt/compose-setup.ts` (search: `displayTemplatePath`) - forward-slashes packaged-template references; fixes 6 `composeSetup routing` tests.
- `src/cli/paths.ts` (search: `getCliCommand`) - forward-slashes the `node dist/cli/cli.js` re-run hint.
- `src/cli/audit/check-agent-deny-mechanism.ts` (search: `evidencePath`) - forward-slashes 3 audit-evidence emission sites.
- `src/cli/facts/fs.ts` (search: `results.push(relative`) - glob walker forward-slashes results.
- `src/cli/quality/skill-quality-content.ts` (search: `relPosix`) - forward-slashes artifact paths/mirrors/missingMirrors.
- `src/cli/skill-author.ts` (search: `proposedPath`) - forward-slashes skill scaffold paths.

**Prevention:**
1. Treat every emission of a `path.*` result into a string as a candidate for `.replace(/\\/g, "/")`. The boundaries that need this: prompt text, audit findings, JSON output, dashboard URLs/labels, log messages, shell snippets the user or agent will execute.
2. `fs` operations can stay native (Node accepts both). The rule is about *display*, not *use*.
3. For path *composition* (joining a host-native projectPath with a POSIX sub-path), prefer `path.posix.join(projectPath, sub).replace(/\\/g, "/")` to avoid `path.resolve`'s drive-letter prepending on Windows.
4. Test stubs that pattern-match on path strings must normalize incoming paths the same way (`test/unit/audit-command.test.ts` `stubFS` is the canonical example).
5. CI lacks a Windows job, so this class of bug ships silently. Until that's added, any path-emission change must be probed on a Windows host before release.

---

## Footgun: ESM main-module guard breaks under symlinks

**Status:** active | **Created:** 2026-04-24 | **Evidence:** ACTUAL_MEASURED

`path.resolve()` does not follow symlinks, but Node's ESM loader resolves symlinks for `import.meta.url` by default (via `--preserve-symlinks-main=false`). Any main-module guard that compares `resolve(process.argv[1])` against `fileURLToPath(import.meta.url)` silently fails when the script is invoked through a symlink - which is always the case for npm-installed CLIs, because `node_modules/.bin/<name>` is a symlink to the package's bin entry.

**Symptoms:** CLI exits 0 with zero output. No error, no stderr. Downstream scripts that spawn the CLI see the child die immediately with no diagnostic. Only direct invocation via `node dist/cli/cli.js` works.

**Why it happens:** npm creates `node_modules/.bin/goat-flow` → `../@blundergoat/goat-flow/dist/cli/cli.js`. When the shell launches the symlink via shebang, `process.argv[1]` is the symlink path. `resolve()` normalizes it but does not follow the symlink. Meanwhile `import.meta.url` points at the real file because Node's ESM loader follows symlinks by default. The two paths differ, the guard evaluates false, and `main()` never runs.

**Evidence:**
- `src/cli/cli.ts` (search: `isMainModule`) - the fixed guard uses `realpathSync()` on both sides to normalize through symlinks.
- `test/integration/main-guard.test.ts` (search: `launched through a symlink`) - regression test that creates a temp-dir symlink and verifies the CLI produces output.
- Commit 918ca3e introduced the broken guard; the fix adds `realpathSync` to resolve both paths canonically before comparison.

**Prevention:**
1. Never compare `resolve(process.argv[1])` directly to `fileURLToPath(import.meta.url)`. Always wrap both sides in `realpathSync()`.
2. `test/integration/main-guard.test.ts` locks this in - any future change to the entry-point guard must pass the symlink test.
3. When Node 24+ is the minimum, replace the entire guard with `import.meta.main`.

---

## Footgun: Diagnostic logs to stdout corrupt structured-output modes

**Status:** active | **Created:** 2026-05-25 | **Evidence:** EXTERNAL_REFERENCE

**Symptoms:** A CLI command emits structured output (JSON, SARIF, JSONL, CSV) to stdout for a downstream consumer (CI parser, GitHub Code Scanning upload, jq pipeline, MCP client). The consumer fails to parse — sometimes silently (jq returns empty), sometimes loudly ("unexpected token at line N"). The bug is intermittent: only fires when a code path that calls `logger.*` or `console.*` happens to run during the structured emission. Test runs pass because the test invocation may not trigger that code path; production runs fail because (e.g.) a single deprecation warning prints to stdout right before the JSON payload.

**Why it happens:** Most logger libraries default to writing all levels to stdout. The structured-output code path assumes it owns stdout exclusively, but any module imported anywhere in the process can `console.log` during import or initialization. Even one `winston` line on the default Console transport interleaves and breaks the payload. Set-once env-var fixes (`PROMPTFOO_LOG_TO_STDERR=1` in the source PR) only work if they're set BEFORE the logger module is imported, which means before ANY module that might transitively trigger logger initialization.

**Evidence (external — promptfoo PR #9329):** `code-scan --format sarif|json` printed the payload via `console.log`. Winston's Console transport had no `stderrLevels` set, so any `logger.warn` / `logger.info` from cache loading, telemetry, or update-check code silently interleaved with the SARIF payload. GitHub Code Scanning rejected the upload as malformed. Fix: detect structured-output mode early in CLI dispatch, set `PROMPTFOO_LOG_TO_STDERR=1` BEFORE the logger import, route all log levels to stderr unconditionally in that mode.

**Goat-flow applicability — HIGH:** Goat-flow CLI surfaces that emit structured stdout:
- `src/cli/audit/render.ts` and `src/cli/audit/sarif.ts` — SARIF and JSON output modes for audit results.
- `src/cli/quality/` — JSON quality report exports.
- Any future `--json` or `--format` flag added to a goat-flow command.
- MCP server code (when added) — MCP communicates over JSON-RPC stdio; every byte on stdout must be protocol-conformant. A single stray log line breaks the entire MCP session, often with no diagnostic on the consumer side.

**Prevention:**
1. When adding or modifying a CLI mode that emits structured stdout, detect the mode in `src/cli/cli.ts` (before logger import) and set a routing env var. The logger module reads the env var on first import and routes everything to stderr in that mode.
2. The detection must run before ANY module that might trigger logger initialization. In practice this means: parse `argv` for the format flag in the entry-point file, set the env var, THEN import the rest of the CLI.
3. Subprocesses spawned by goat-flow (hooks, git, install scripts) must have their stdout / stderr captured separately. Never merge a subprocess's stdout into the parent's stdout when the parent is in structured-output mode.
4. Contract test pattern: for every structured-output CLI mode, write a test that exercises a code path KNOWN to log (e.g., cache miss, telemetry init, version check). Assert that the captured stdout parses cleanly as the expected format. If logging would corrupt it, the test fails.
5. For MCP specifically: stdout is the protocol channel. Treat any `console.log` / `process.stdout.write` outside the MCP framing as a bug. Enforce with a source-grep guardrail (see `.goat-flow/learning-loop/patterns/verification.md` search: `Source-grep guardrail`) banning `console.log` in MCP server source files.
