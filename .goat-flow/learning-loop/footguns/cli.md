---
category: cli
last_reviewed: 2026-08-04
---

## Footgun: Host-native paths leak into user-visible CLI output on Windows

**Status:** active | **Created:** 2026-05-11 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Windows users see `C:\Users\developer\...` style backslash paths in setup prompts, audit `evidence` fields, skill scaffold output, glob results, and the `getCliCommand()` re-run hint. When an agent reads the prompt and runs a host-native path inside a Bash subshell, the backslashes can act as escape characters and the command fails. Tests written with POSIX-shape assertions also fail (string-equality on `.endsWith(".claude/skills/...")` etc.). A full-suite run on 2026-05-11 had 25 failures all rooted here.

**Why it happens:** `path.join`, `path.resolve`, and `path.relative` from `node:path` use OS-native separators on Windows. Every place a path is composed for *user-visible* output (prompts, audit findings, JSON payloads, dashboard strings) inherits that shape. The same path is fine for `node:fs` operations (which accept either separator), so the bug is invisible until output is rendered.

**Evidence:**
- `src/cli/install-invocation.ts` (search: `toBashPath`) - forward-slashes installer argv on win32.
- `src/cli/prompt/compose-setup.ts` (search: `displayTemplatePath`) - forward-slashes packaged-template references; fixes 6 `composeSetup routing` tests.
- `src/cli/paths.ts` (search: `getCliCommand`) - forward-slashes the `node dist/cli/cli.js` re-run hint.
- `src/cli/audit/check-agent-deny-runtime.ts` (search: `evidencePath`) - forward-slashes 3 audit-evidence emission sites.
- `src/cli/facts/fs.ts` (search: `results.push(relative`) - glob walker forward-slashes results.
- `src/cli/quality/skill-quality-content.ts` (search: `relPosix`) - forward-slashes artifact paths/mirrors/missingMirrors.
- `src/cli/skill-author.ts` (search: `proposedPath`) - forward-slashes skill scaffold paths.

**Prevention:**
1. Treat every emission of a `path.*` result into a string as a candidate for `.replace(/\\/g, "/")`. The boundaries that need this: prompt text, audit findings, JSON output, dashboard URLs/labels, log messages, shell snippets the user or agent will execute.
2. `fs` operations can stay native (Node accepts both). The rule is about *display*, not *use*.
3. For path *composition* (joining a host-native projectPath with a POSIX sub-path), prefer `path.posix.join(projectPath, sub).replace(/\\/g, "/")` to avoid `path.resolve`'s drive-letter prepending on Windows.
4. Test stubs that pattern-match on path strings must normalize incoming paths the same way (`test/unit/audit-command/helpers.ts` (search: `export function stubFS`) is the canonical example).
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

---

## Footgun: Strict validation of a new evidence artifact retroactively fails finished plans

**Status:** active | **Created:** 2026-08-02 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Gate an evidence artifact's shape on whether something claims authority from it, not on its mere presence.
**Trigger phase:** VERIFY
**Incident count:** 4 | **Latest occurrence:** 2026-08-04

**Symptoms:** A milestone that passed strict validation for weeks starts failing after an unrelated release. The errors name an artifact the milestone does not depend on - here, five `timing receipt ... inconsistent` errors on a `complete` goat-debug-improve milestone whose Actual is `retrospective` and cites no receipt at all. Separately, a seven-cell timing row was silently skipped and a receipt containing `S01` plus `S03` allocated `S03` again because the writer used row count as identity authority. In a later change, the receipt parser correctly diagnosed a summary on an active receipt, but strict checking first exited 0 because the new message did not begin with the classifier's `timing receipt` prefix. After that prefix was corrected, paused and incomplete receipts still exited 0 because general receipt warnings become fatal only for a live clock or claimed Actual. Each failure surfaced late because parser behavior was not verified through every policy-owning consumer state.

**Why it happens:** `src/cli/plans-time-receipt.ts` (search: `export function parseTimingReceiptMarkdown`) defines a receipt grammar requiring a `State` column and a `**Receipt state:**` header. Hand-written receipts predating the CLI used a free-text `Work` column instead. `src/cli/plans-check.ts` (search: `function isValidationWarning`) classifies receipt diagnostics with `warning.startsWith("timing receipt")`; message text is therefore part of the routing contract, not presentation alone. That classifier previously promoted every matching warning to a strict error regardless of whether any Actual cited the receipt. On the live workflow path, `readTimingDataColumns` treated a table-shaped wrong-width row as unrelated prose, and `nextSegmentId` derived identity from `segments.length` instead of the highest canonical suffix.

**Safe handling now:**
1. Before shipping validation for a new artifact, run the checker across *every* existing plan directory, not just the one the feature was built in.
2. Make the artifact's shape fatal only when a claim or live workflow depends on it - `src/cli/plans-check.ts` (search: `const receiptIsActive`) gates receipt warnings on a `measured` Actual or an active clock, while malformed unclaimed historical receipts stay advisory.
3. Keep the claimed path failing twice over: shape validation plus reconciliation, so relaxing the unclaimed case cannot weaken the claimed one.
4. Treat "this artifact is decorative here" as a first-class state rather than forcing migration of finished work.
5. Once a receipt is live or claimed, reject every table-shaped row that does not match the canonical width and allocate new identifiers after the highest canonical suffix, not after the row count. Regression anchors: `test/unit/plans-time.test.ts` (search: `rejects timing table rows with extra cells`) and (search: `allocates a new segment after the highest existing suffix`).
6. When adding a parser warning, inspect every consumer that classifies warning text and verify the public command path across each relevant receipt state. Keep receipt diagnostics under the stable `timing receipt` prefix until routing uses structured codes, and promote inherently invalid authority such as a non-final summary independently of the live-or-claimed compatibility exception. Regression anchor: `test/unit/plans-check.test.ts` (search: `const staleSummaryCases`).

---

## Footgun: Markdown proof gates can promote hidden examples into authority

**Status:** active | **Created:** 2026-08-03 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Validate structural evidence against rendered Markdown semantics and exact documented field values, then pair every exclusion fixture with a visible-content control.
**Trigger phase:** VERIFY
**Incident count:** 6 | **Latest occurrence:** 2026-08-04

**Symptoms:** A review report containing every required field inside a raw `<pre>` block passed validation. A balanced inline-code span containing the literal `<!--` token, and later a visible backslash-escaped `\<!--` opener, entered comment state and hid subsequent fields. The first multiline fix still lost state when one continuation line closed a code span and opened another, so a comment marker on the following line hid the rest of the report. A complete custom tag such as `<x-review>` also opened a blank-terminated raw HTML block under CommonMark type 7, but the masker left its hidden fields authoritative. Separately, the compact Review Integrity grammar accepted `risk-depth-declined` in its degradation slot while returning `isRiskDepthDeclined: false`, so a degraded review could claim a stronger conclusion and verdict.

**Why it happens:** `src/cli/rendered-markdown.ts` (search: `export function maskNonRenderedMarkdown`) is a source-aligned Markdown masker rather than a complete Markdown parser; every omitted exclusion form can accidentally grant hidden examples structural authority or suppress visible evidence. `src/cli/review-validate.ts` (search: `const COMPACT_INTEGRITY`) compounded that risk by accepting any non-empty degradation text even though the documented compact form permits only `no degradation flags`.

**Safe handling now:**
1. Add paired regressions for every Markdown exclusion change: hidden headings and fields must stay hidden, while visible structure immediately after the construct must retain its original offset. Include complete custom tags that open CommonMark type-7 blocks and a control proving they do not interrupt a paragraph.
2. Treat comment markers inside balanced inline-code spans and backslash-escaped openers as visible code, but keep real comments masked. Carry delimiter state across source lines, including a continuation line that closes one span and opens another. Test odd and even backslash parity so the exception cannot swallow comments. Evidence anchors: `test/unit/plans-export.test.ts` (search: `keeps backslash-escaped HTML comment openers visible`) and (search: `tracks a new multiline code span after closing one on the same line`).
3. Match compact proof receipts to their canonical documented values. Do not accept arbitrary text and then hardcode the corresponding semantic state.
4. Re-run both the shared masker tests and the consuming proof-gate tests. Evidence anchors: `test/unit/plans-export.test.ts` (search: `masks type-7 custom-tag blocks without hiding later visible structure`) and `test/unit/review-validate.test.ts` (search: `rejects structural review evidence inside a type-7 HTML block`).

---

## Resolved Entries

## Footgun: Zero-duration filesystem leases can look live at the clock boundary

**Status:** resolved | **Created:** 2026-08-03 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Handle a zero-duration lease as an explicit immediate-expiry state instead of deriving it from wall-clock subtraction.
**Trigger phase:** VERIFY

**Symptoms:** Identical CI runs at the same commit disagree on `rejects an orphaned stale claim when its draft is already gone`. The failing run keeps the claim marker and produces no rejection receipt, while a parallel run passes. A local 10,000-sample probe observed 93 freshly written marker timestamps ahead of `Date.now()`, with the most negative delta at about -0.6 ms.

**Why it happened:** `src/cli/server/quality-draft-claims.ts` (search: `function staleClaimSnapshot`) previously classified every lease with `Date.now() - snapshot.mtimeMs >= staleMs`. Node's clock is integer milliseconds, while filesystem modification times can retain fractional precision or be rounded ahead. For the test/recovery contract `staleMs: 0`, a just-created marker can therefore appear live even though zero means immediate expiry.

**Resolved by:** `src/cli/server/quality-draft-claims.ts` (search: `if (staleMs <= 0) return snapshot`) now bypasses timestamp arithmetic for non-positive leases. `test/unit/quality-draft-orphan-recovery.test.ts` (search: `rejects an orphaned stale claim when its draft is already gone`) forces a future marker mtime and verifies immediate expiry.

**Safe handling now:**
1. Treat non-positive lease durations as immediate expiry before doing timestamp arithmetic; keep positive leases on the normal age comparison.
2. Keep the deterministic future-mtime regression so clock precision cannot make the test intermittent again.
3. When testing time boundaries, force the boundary condition rather than depending on scheduler delay or filesystem timestamp rounding to reproduce it.

---

## Footgun: Structured Actual cannot represent uninstrumented time

**Status:** resolved | **Created:** 2026-08-02 | **Evidence:** OBSERVED
**Decision changed:** Instrument timing before work; if timing is missing, declare the honest state instead of manufacturing precision.
**Trigger phase:** VERIFY

**Symptoms:** A completed or `human-verification-pending` milestone had to contain a numeric Actual total and product/proof/other split even when no clock was started. `_`, `unknown`, or an explanation without a number failed strict validation. An agent under completion pressure could therefore turn task estimates into a precise-looking Actual value with no elapsed-time evidence.

**Why it happened:** `src/cli/plans-check.ts` (search: `function collectActualErrors`) made numeric Actual mandatory at the human gate. `src/cli/plans-effort.ts` (search: `ACTUAL_PATTERN`) accepted only numeric minutes and an optional numeric split, with no measurement-provenance or unknown state.

**Resolved by:** `src/cli/plans-effort.ts` (search: `ACTUAL_UNKNOWN_STATE_PATTERN`) now parses four Actual states - `measured`, `retrospective`, `unavailable`, `incomplete`. `src/cli/plans-time.ts` (search: `export function applyPlanTimeTransition`) system-stamps UTC/epoch spans into a `## Timing Receipt` inside the milestone, and `measured` requires a finalized internally consistent receipt. Untagged legacy numerics classify as `retrospective` rather than silently becoming measured. Verified 2026-08-02: a `complete` milestone carrying `Actual: unavailable: no clock was started for this milestone` passes `plans check --strict` at exit 0.

**Safe handling now:**
1. `goat-flow plans time start <milestone-file> --category <product|proof|other>` before work; `stop` before every human wait; `stop --finalize` at the gate.
2. Let the receipt supply raw seconds; the rounded structured Actual is derived, never hand-written.
3. If prospective timing was missed, declare `unavailable:` or `incomplete:` with a reason - never back-calculate from planned estimates.
4. Treat estimate accuracy and Actual accuracy as separate claims.
