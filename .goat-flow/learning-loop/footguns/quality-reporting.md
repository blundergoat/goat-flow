---
category: quality-reporting
last_reviewed: 2026-09-05
---

**Scope:** The quality prompt-to-report pipeline: prompt generation, the agent session that runs it, report persistence, and `quality diff` comparison. How audit checks score and temper concerns lives in [quality.md](quality.md).

## Footgun: Quality reviews disappear when the agent skips the final JSON write

**Status:** active | **Created:** 2026-04-19 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Test the prompt's complete persistence transport at realistic report size; a saver that works only below an upstream hook limit is unavailable in practice.
**Trigger phase:** VERIFY
**Incident count:** 2
**Latest occurrence:** 2026-08-28

**Prevention:**
1. After any `/quality` run, verify the save landed with `ls .goat-flow/logs/quality/*.json | tail -3`; a latest mtime older than the review means the agent skipped the write.
2. If the agent reports `persist-skipped` or emits JSON inline, rerun through the exact `quality save` command. Do not write the raw report with a filesystem tool.
3. Trust `quality history` and `quality diff` only after the file exists; both return empty when nothing was saved, so a missing save looks like "no prior runs".
4. Exercise the prompt-derived heredoc above the ordinary hook ceiling, with large unquoted and generic-command controls that must remain blocked.

**Symptoms:** A quality review runs end to end, but `goat-flow quality history` reports no saved runs, `goat-flow quality diff` has nothing to compare, and no file appears under `.goat-flow/logs/quality/`.

**Why it happens:** The prompt instructs the agent to send its final JSON through the bounded `quality save` command, which owns redaction, validation, filename selection, and the write. If the agent emits JSON inline, skips the command, or lacks permission, nothing persists, and the gitignored target directory gives no git-side hint.

**Evidence:** `src/cli/prompt/compose-quality-contract.ts` (search: `Persist through the bounded saver`) requires the saver and forbids a raw fallback, and the same file (search: `Wrote quality report to`) requires a confirmation line naming the file; `src/cli/quality/quality-command.ts` (search: `handleQualitySaveSubcommand`) owns the write; `src/cli/quality/history-render.ts` (search: `No saved quality history`) reads only files on disk. **Recurrence 2026-08-28:** the deny hook refused a 17,065-byte quoted `quality save` command with `BLOCKED: Policy deny-dangerous: Command exceeds 16KB` while a 15,065-byte control passed, because a 60-field placeholder never exercised a thorough report's real command shape. `.goat-flow/hooks/deny-dangerous.sh` (search: `large_quality_save_heredoc_is_bounded_data`) now admits the prompt's quoted data transport while keeping the ordinary ceiling, and `test/unit/quality-report-contract.test.ts` (search: `sends a thorough report block through the actual deny hook`) pushes a block over 16KB through the hook. The boundary rule is in `.goat-flow/learning-loop/patterns/refactoring.md` (search: `Put prompt side effects on the CLI side`).

---

## Footgun: YAML heredocs can break tooling before shell execution

**Status:** active | **Created:** 2026-05-27 | **Evidence:** ACTUAL_MEASURED

**Prevention:** For generated multi-line files inside workflow `run: |` blocks, prefer `printf '%s\n' ... > file` unless the heredoc indentation has been validated against both the YAML parser and the shell.

**Symptoms:** A GitHub Actions workflow reads as valid shell, but YAML-aware tools such as Knip fail after an unindented heredoc is embedded in a `run: |` block.

**Why it happens:** The heredoc delimiter must satisfy YAML indentation and shell parsing at once, and shell-focused review misses that the document itself is malformed.

**Evidence:** `.github/workflows/ci.yml` (search: `run: |`) and `.github/actions/goat-flow-audit/action.yml` (search: `run: |`) are the `run` block surfaces; `scripts/preflight-checks.sh` (search: `Knip`) is the gate that exposed the drift.

## Footgun: Pre-release prompts can resolve an older global CLI

**Status:** active | **Created:** 2026-07-17 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Framework-checkout commands use the source CLI (or a freshly built local CLI) and verify its version instead of trusting a bare PATH binary; generated write instructions retain the package-identity-gated source fallback.
**Trigger phase:** READ
**Caught at:** ACT
**Incident count:** 8
**Latest occurrence:** 2026-08-24

**Prevention:** In the framework checkout, run `node --import tsx src/cli/cli.ts <command>`, or `npm run goat-flow:cli -- <command>` only after a fresh build, and verify `--version` matches `package.json`. Never use bare `goat-flow` during pre-release work, because a matching version label does not make a published binary authoritative for a dirty checkout. Consumer examples name the scoped `@blundergoat/goat-flow` package. A generated prompt that calls a command added in the current release verifies the exact version before any write and gates source fallbacks on both package name and source entry path. Quality prompts treat executable version checks as saver selection only: PATH-only skew is not a finding or score input, while repository-owned declarations and managed target artifacts remain version-drift evidence.

**Symptoms:** A prompt generated from the source tree invokes a newly added command, prints a success-looking write message, exits non-zero, and persists the output of an older command; or `goat-flow index` from PATH rewrites every generated index with an older or different implementation.

**Why it happens:** The first `goat-flow` on `PATH` is the globally installed package, one release or one uncommitted change behind the source tree. On 2026-07-17 the old parser treated the unknown `redact` token as an audit target, so `goat-flow redact --output <quality-file>` wrote audit JSON to the quality-report path.

**Evidence:** `src/cli/prompt/compose-quality-contract.ts` (search: `Select a compatible saver`) requires the installed binary to report the current package version and permits the source fallback only from the framework checkout, and the same file (search: `Version-skew calibration`) separates saver compatibility from assessment evidence. The 2026-07-17 reproduction resolved `goat-flow` to v1.13.0, printed `Written to /tmp/goat-redact-benign.json`, and exited 1; the source command exited 0 and passed `quality validate`.

**Incident ledger:**
- **Recurrence 2026-07-17:** consumer guidance still used `npx goat-flow`, and a clean-directory probe resolved a stale global v1.13.0 instead of source v1.14.0; `test/contract/command-phrases.test.ts` (search: `does not let unscoped npx resolve the deprecated package in`) now guards the package identity per command surface.
- **Recurrence 2026-08-03:** release verification ran bare `goat-flow index` in the v1.15.0 checkout while PATH resolved v1.14.0 and rewrote every index with the older implementation.
- **Recurrence 2026-08-06:** a pre-release quality assessment called the v1.14.0 PATH binary versus v1.15.0 source a persistent defect although every repository-owned declaration agreed on v1.15.0; the calibration anchor above followed.
- **Recurrence 2026-08-16:** global `goat-flow v1.15.1` classified locally patched v1.15.1 hook bytes as `installed-version-mismatch`, so `hooks verify` returned `hook-not-installed` while `hooks list` proved the registration; the source verifier passed both configured Stop scenarios.
- **Recurrence 2026-08-24 (and 2026-08-23):** three milestone closeouts ran bare `goat-flow index` after PATH and source both reported v1.16.0. Uncommitted formatter changes made the bytes differ, source `stats --check` marked all four indexes stale, and one run added blank-summary whitespace caught by `git diff --check`; regenerating with the source entry restored `"status": "pass"`.

## Footgun: A permission mode reused as a feature trigger fires on every session that shares the mode

**Status:** active | **Created:** 2026-08-01 | **Evidence:** ACTUAL_MEASURED

**Prevention:** A permission mode answers "what may this session do", not "what is this session for". Before deriving a side effect from one, list every launch that lands in the same mode; if the list is wider than the feature, carry an explicit opt-in field that defaults to the inert value, and check the retry and reconnect path in the same change.

**Symptoms:** Opening any read-only Claude terminal created `.goat-flow/logs/quality/staging/` in both the controlling workspace and the selected target, materialising a `.goat-flow/` tree with no `.gitignore` inside targets that never installed goat-flow. Because the setup call fails closed, an unrelated `.goat-flow` component of the wrong type could block a read-only session from opening.

**Why it happens:** `src/cli/server/terminal.ts` gated staged-draft capture (ADR-044) on `runner === "claude" && accessMode === "reporting"`, but `dashboardTerminalAccessMode` in `src/dashboard/dashboard-terminal-paste.ts` returns `reporting` for every preset without `mayWriteFiles`, every investigator-role session, and every custom prompt, where `preset?.mayWriteFiles === true` is `undefined`. The real trigger lived one request earlier, where `/api/quality` composed the `persistence: "staged-draft"` prompt.

**Evidence:** Raised as P1 by Codex review on PR #57. Fixed with an explicit `captureQualityDrafts` field on the terminal-create contract in `src/cli/server/decoders.ts` (search: "decodeTerminalCaptureQualityDrafts"), set only by the quality launch and carried through retry as `retryCaptureQualityDrafts`.

---

## Footgun: Path validation does not pin a later pathname write

**Status:** active | **Created:** 2026-08-27 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Allocate an empty destination exclusively, revalidate its ancestry and descriptor/path identity, then write sensitive bytes through the pinned descriptor.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 2
**Latest occurrence:** 2026-08-28

**Prevention:** Any persistence path that validates directories before writing must allocate an empty destination exclusively, recheck every trusted ancestor, compare descriptor and pathname device/inode identity, write through the descriptor, fsync, and check again. On rejection after allocation, truncate through the descriptor before closing so a raced rename cannot retain sensitive bytes.

**Symptoms:** The saver validated that its destination chain held only project-local directories, and a concurrent replacement still redirected the later pathname write outside the selected project. The command returned success because the resulting file was a regular single-link file.

**Why it happens:** `lstat` proves what a pathname names only at that instant. Opening it later performs a new traversal, so a parent can become a symlink in the gap, and validating the final file afterwards detects neither the changed ancestors nor where the bytes landed.

**Evidence:** A 2026-08-27 probe replaced `.goat-flow/logs/quality` with a symlink immediately before the write; the saver returned normally and `realpath` placed the report under the external fixture root. `src/cli/quality/quality-command.ts` (search: `function assertAllocatedQualityReport`) now checks the chain and descriptor identity before and after the descriptor write; `test/unit/quality-subcommands.test.ts` (search: `fails closed when report allocation follows a swapped parent`) proves the external allocation stays empty. **Recurrence 2026-08-28:** `goat-flow redact --output` followed a symlinked `.goat-flow/logs/review` parent and replaced a receipt outside the project; `src/cli/redact-command.ts` (search: `function assertRedactAllocation`) gives redacted artifacts the same create-only boundary, and `test/unit/redact-command.test.ts` (search: `refuses a symlinked parent without changing the outside file`) preserves the outside sentinel with direct outside-path and existing-file controls.

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

## Footgun: `quality diff` reports a finding "resolved" when the next report merely omits it

**Status:** resolved | **Created:** 2026-07-31 | **Resolved:** 2026-08-15 | **Evidence:** ACTUAL_MEASURED
**hallucination-risk:** high

**Resolution:** The bucket no longer claims a fix. `src/cli/quality/history.ts` (search: `absent: QualityDiffFindingRow[]`) renames the field and documents that absence is not proof, `src/cli/quality/history-diff.ts` (search: `Absent findings existed before`) computes it under that name, and `src/cli/quality/history-render.ts` (search: `Absent from newer report`) prints an inline caveat beside the rows. The set-difference limitation is unchanged; the claim is fixed. `test/unit/quality-diff-delta-tag.test.ts` (search: `quality diff absent-bucket honesty`) asserts the caveat appears with rows and no bare `Resolved (` section returns.

**Original symptoms:** `goat-flow quality diff <from>:<to>` showed `resolved: 2` on 2026-07-31 while the cited files still held the exact defects: `content_quality:goat-flow-logs-sessions-2026-04-18-skill-quality-tests-md:14` still had `## Pressure test results (7/7)` at line 14, and the other id named content already rejected as a false positive. Ids embed a line number, so an unfixed defect drops out when the next run omits it and a shifted defect returns as `new`; assessments are LM-generated and non-exhaustive, so omission is the common case.

**Prevention retained:** Never close a remediation milestone on a `resolved` count; re-read each cited anchor and record per-finding artifact checks instead. Check `audit_status` and `prior_report_id` on both reports first, because a report generated without prior-report context carries `prior_report_id: null` and every prior finding reads as resolved; see `.goat-flow/learning-loop/lessons/browser-evidence.md` (search: `Reproducing a server route means reusing its inputs`).
