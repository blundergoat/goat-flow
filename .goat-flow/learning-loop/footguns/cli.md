---
category: cli
last_reviewed: 2026-09-05
---

## Footgun: An additive classification rule can silently delete a published state value

**Status:** active | **Created:** 2026-08-16 | **Evidence:** ACTUAL_MEASURED

**Prevention:** After adding or reordering any branch in a classifier whose output is a published contract, grep the repo for every sibling value and confirm each still has a producer. A value with no producer is a contract removal, not dead code, and needs the same doc, fixture, and changelog treatment as any breaking change. Anchors: `src/cli/managed-setup-preview.ts` (search: `classifyManagedSetupFile`) and `test/unit/managed-setup-preview.test.ts` (search: `name: "local-preserved"`).

**Symptoms:** A milestone item reads as purely additive, "add state X before blocker aggregation", and the implementation is one branch. Nothing warns that a sibling state became unreachable: no test constructs the classifier's inputs looking for absence, and the type union still lists it, so the dead value stays in the JSON contract and user docs until someone greps.

**Why it happens:** A classifier is a chain of guarded returns. Adding a branch changes the reachability of every branch below it that shares a condition, and TypeScript checks exhaustiveness of the union, not reachability of its members.

**Evidence:** 1.16.0 M02 added `local-preserved` to `src/cli/managed-setup-preview.ts` (search: `The package has nothing new to deliver here`). That branch owns `newExpectedSha256 === oldExpectedSha256`, the only producer of `local-edited`, which stayed exported in `ManagedSetupFileState`, listed in `BLOCKING_STATES`, documented in `docs/cli.md`, and asserted by three fixtures. Removing it meant repointing those fixtures at `both-changed`, the only managed conflict that still blocks.

## Footgun: Host-native paths leak into user-visible CLI output on Windows

**Status:** active | **Created:** 2026-05-11 | **Evidence:** ACTUAL_MEASURED

**Prevention:**
1. Treat every `path.*` result that reaches a string as a candidate for `.replace(/\\/g, "/")`: prompt text, audit findings, JSON output, dashboard URLs and labels, log messages, and shell snippets. `fs` calls can stay native; the rule is about display, not use.
2. When joining a host-native project path with a POSIX sub-path, prefer `path.posix.join(projectPath, sub).replace(/\\/g, "/")` so `path.resolve` cannot prepend a drive letter.
3. Test stubs that pattern-match on path strings must normalize incoming paths the same way; `test/unit/audit-command/helpers.ts` (search: `export function stubFS`) is the canonical example.
4. The Windows CI job (`.github/workflows/ci.yml`, search: `windows-hook-contracts`) runs hook spawn, path-claim, deny-hook drift, and one packaged-install contract, not path-emission tests, so probe emission changes on a Windows host before release.

**Symptoms:** Windows users see `C:\Users\developer\...` paths in setup prompts, audit `evidence` fields, skill scaffold output, glob results, and the `getCliCommand()` re-run hint. An agent that runs such a path inside a Bash subshell sees the backslashes act as escapes, and POSIX-shaped test assertions fail; a full-suite run on 2026-05-11 had 25 failures rooted here.

**Why it happens:** `path.join`, `path.resolve`, and `path.relative` use OS-native separators, and `node:fs` accepts either, so the bug is invisible until output is rendered.

**Evidence:** `src/cli/install-invocation.ts` (search: `toBashPath`); `src/cli/prompt/compose-setup.ts` (search: `displayTemplatePath`); `src/cli/paths.ts` (search: `getCliCommand`); `src/cli/audit/check-agent-deny-runtime.ts` (search: `evidencePath`); `src/cli/facts/fs.ts` (search: `results.push(relative`); `src/cli/quality/skill-quality-content.ts` (search: `relPosix`); `src/cli/skill-author.ts` (search: `proposedPath`). Each forward-slashes one emission site.

---

## Footgun: ESM main-module guard breaks under symlinks

**Status:** active | **Created:** 2026-04-24 | **Evidence:** ACTUAL_MEASURED

**Prevention:** Never compare `resolve(process.argv[1])` directly to `fileURLToPath(import.meta.url)`; wrap both in `realpathSync()`. Run `test/integration/main-guard.test.ts` after any change to the entry-point guard. When Node 24+ becomes the minimum, replace the guard with `import.meta.main`.

**Symptoms:** The CLI exits 0 with no output and no stderr. Only `node dist/cli/cli.js` works, and scripts that spawn the CLI see the child die without a diagnostic.

**Why it happens:** npm installs `node_modules/.bin/goat-flow` as a symlink. `process.argv[1]` is the symlink path and `resolve()` does not follow it, while Node's ESM loader resolves `import.meta.url` to the real file, so the guard compares two different paths and `main()` never runs.

**Evidence:** `src/cli/cli.ts` (search: `isMainModule`) applies `realpathSync()` to both sides; `test/integration/main-guard.test.ts` (search: `launched through a symlink`) creates a temp-dir symlink and asserts output. Commit 918ca3e introduced the broken guard.

---

## Footgun: Diagnostic logs to stdout corrupt structured-output modes

**Status:** active | **Created:** 2026-05-25 | **Evidence:** EXTERNAL_REFERENCE

**Prevention:**
1. When adding or changing a CLI mode that emits structured stdout, detect the mode in `src/cli/cli.ts` before the logger is imported and route every log level to stderr for that mode. Detection must precede any import that could initialise logging.
2. Capture subprocess stdout and stderr separately; never merge a child's stdout into the parent's structured stream.
3. For every structured-output mode, keep a test that exercises a path known to log (cache miss, version check) and asserts the captured stdout still parses.

**Symptoms:** A command emits JSON, SARIF, JSONL, or CSV for a downstream parser, and the consumer fails, sometimes silently (jq returns nothing) and sometimes loudly ("unexpected token at line N"). The failure is intermittent because it needs a code path that logs during emission.

**Why it happens:** Loggers default every level to stdout, and any module imported anywhere can log during initialisation. A set-once env-var fix works only when it runs before the logger module is first imported.

**Evidence:** External: promptfoo PR #9329, where `code-scan --format sarif|json` printed through `console.log` while Winston's Console transport had no `stderrLevels`, so cache, telemetry, and update-check logs interleaved with the SARIF payload and GitHub Code Scanning rejected the upload; the fix set `PROMPTFOO_LOG_TO_STDERR=1` before the logger import. Local surfaces with the same shape: `src/cli/audit/render.ts` (search: "renderAuditJson") and `src/cli/audit/sarif.ts` (search: "renderAuditSarif"), plus JSON quality report exports under `src/cli/quality/`. The source-grep guardrail for banning stray `console.log` lives in `.goat-flow/learning-loop/patterns/verification.md` (search: `Source-grep guardrail`).

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

## Footgun: POSIX absolute checks admit Windows drive-relative file operands

**Status:** resolved | **Created:** 2026-08-24 | **Resolved:** 2026-08-27 | **Evidence:** OBSERVED
**Decision changed:** Reject every Windows drive prefix before passing a project-relative CLI operand to a project-rooted filesystem.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Resolution:** `src/cli/learning-loop-recall.ts` (search: `function normalizeRecallPath`) rejects a drive prefix before the read-only filesystem classifies the operand; `test/unit/learning-loop-recall.test.ts` (search: `rejects absolute, parent-escaping, and Windows drive-relative operands`) pins POSIX absolute, parent escape, drive-absolute, drive-relative, and UNC forms.

**Original symptoms:** A CLI that accepted only project-relative paths admitted `C:outside`. Replacing backslashes and calling `path.posix.normalize()` did not make Windows drive syntax POSIX-absolute, and a guard for `C:/...` missed `C:...` because `path.posix.isAbsolute("C:outside")` is false.

**Safe handling now:** Interfaces that promise project-relative paths reject `^[A-Za-z]:` and UNC prefixes before any host-native resolution; coverage includes both `C:\\path` and `C:path`.

---

## Footgun: Zero-duration filesystem leases can look live at the clock boundary

**Status:** resolved | **Created:** 2026-08-03 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Handle a zero-duration lease as an explicit immediate-expiry state instead of deriving it from wall-clock subtraction.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Original symptoms:** Identical CI runs at one commit disagreed on `rejects an orphaned stale claim when its draft is already gone`. A local 10,000-sample probe found 93 freshly written marker timestamps ahead of `Date.now()`, the most negative by about 0.6 ms, so a just-created marker under `staleMs: 0` could read as live.

**Resolved by:** `src/cli/server/quality-draft-claims.ts` (search: `if (staleMs <= 0) return snapshot`) bypasses timestamp arithmetic for non-positive leases, replacing the `Date.now() - snapshot.mtimeMs >= staleMs` classification in `src/cli/server/quality-draft-claims.ts` (search: `function staleClaimSnapshot`); `test/unit/quality-draft-orphan-recovery.test.ts` (search: `rejects an orphaned stale claim when its draft is already gone`) forces a future marker mtime.

**Safe handling now:** Treat non-positive lease durations as immediate expiry before timestamp arithmetic, and force boundary conditions in tests rather than relying on scheduler delay or filesystem timestamp rounding.
