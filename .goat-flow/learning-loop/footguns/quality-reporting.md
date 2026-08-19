---
category: quality-reporting
last_reviewed: 2026-08-16
---

**Scope:** The quality prompt-to-report pipeline - prompt generation, the agent session that runs it, report persistence, and `quality diff` comparison. How audit checks score and temper concerns lives in [quality.md](quality.md).

## Footgun: Quality reviews disappear when the agent skips the final JSON write

**Status:** active | **Created:** 2026-04-19 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A quality review ran end-to-end, but `goat-flow quality history` reports no saved runs and `goat-flow quality diff` has nothing to compare. No file appears under `.goat-flow/logs/quality/`.

**Why it happens:** `goat-flow quality . --agent <id>` composes a prompt that instructs the agent to send its final JSON report through the bounded `quality save` command. The CLI owns redaction, validation, filename selection, and the write, but the agent must still invoke it. If the agent emits JSON inline, skips the command, or cannot obtain permission, nothing persists. The target directory is gitignored, so there is no git-side hint that the save was skipped.

**Evidence:**
- `src/cli/prompt/compose-quality-contract.ts` (search: `Persist through the bounded saver`) - the prompt requires the bounded saver and forbids a raw fallback.
- `src/cli/quality/quality-command.ts` (search: `handleQualitySaveSubcommand`) - the CLI owns redaction, strict validation, and the project-local write.
- `src/cli/prompt/compose-quality-contract.ts` (search: `Wrote quality report to`) - the prompt requires a single-line confirmation that references the saved filename.
- `src/cli/quality/history-render.ts` (search: `No saved quality history`) - `history` and `diff` only read files that were actually written to disk.

**Prevention:**
1. After any `/quality` run, verify the save landed: `ls .goat-flow/logs/quality/*.json | tail -3`. If the latest mtime is older than the review you just ran, the agent skipped the write.
2. If the agent reports `persist-skipped` or emits JSON inline, rerun through the exact `quality save` command. Do not write the raw report with a filesystem tool.
3. Only after the file exists on disk is `quality history` / `quality diff` meaningful - both silently return empty when nothing is saved, so a missing save looks identical to "no prior runs."

See `.goat-flow/learning-loop/patterns/refactoring.md` (search: `Put prompt side effects on the CLI side`) for the durable boundary rule that came out of this incident.

---

## Footgun: YAML heredocs can break tooling before shell execution

**Status:** active | **Created:** 2026-05-27 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A GitHub Actions workflow looks valid as shell, but YAML-aware tools such as Knip fail after an unindented heredoc is embedded inside a `run: |` block.

**Why it happens:** The heredoc delimiter must satisfy both YAML indentation and shell parsing. Shell-focused review can miss that the workflow document itself is malformed or tool-hostile.

**Evidence:** `.github/workflows/ci.yml` (search: `run: |`) and `.github/actions/goat-flow-audit/action.yml` (search: `run: |`) are the current YAML `run` block surfaces where heredoc edits would need YAML-aware validation. `scripts/preflight-checks.sh` (search: `Knip`) is the tooling gate that previously exposed workflow-shape drift.

**Prevention:** For generated multi-line files inside workflow `run: |` blocks, prefer `printf '%s\n' ... > file` unless the heredoc indentation has been validated against both the YAML parser and the shell.

## Footgun: Pre-release prompts can resolve an older global CLI

**Status:** active | **Created:** 2026-07-17 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Framework-checkout commands use the source CLI (or a freshly built local CLI) and verify its version instead of trusting a bare PATH binary; generated write instructions retain the package-identity-gated source fallback.
**Trigger phase:** ACT
**Incident count:** 5
**Latest occurrence:** 2026-08-16

**Symptoms:** A prompt generated from the current source tree invokes a newly added CLI command, prints a success-looking write message, but exits non-zero and persists the output of an older command instead of the requested artifact.

**Why it happens:** During pre-release work, `node --import tsx src/cli/cli.ts` can generate v1.14.0 instructions while the first `goat-flow` on `PATH` is still the globally installed v1.13.0 package. The old parser treated the unknown `redact` token as an audit target, so `goat-flow redact --output <quality-file>` wrote audit JSON to the quality-report path.

**Evidence:** `src/cli/prompt/compose-quality-contract.ts` (search: `Select a compatible saver`) now requires the installed binary to report the current package version and permits the source fallback only from the framework checkout. The 2026-07-17 reproduction resolved `goat-flow` to v1.13.0, printed `Written to /tmp/goat-redact-benign.json`, and exited 1; the source command exited 0 and its redacted quality report passed `quality validate`.

**Recurrence 2026-07-17:** Current consumer guidance still used `npx goat-flow`, although the unscoped registry package is deprecated and a clean-directory probe resolved a stale global v1.13.0 binary instead of source v1.14.0. Current command surfaces now name `@blundergoat/goat-flow`; `test/contract/command-phrases.test.ts` (search: `does not let unscoped npx resolve the deprecated package in`) guards the package identity, one named case per command surface. Skill hardening receipt: `.goat-flow/logs/sessions/2026-07-17-goat-tdd.md` (local, gitignored).

**Recurrence 2026-08-03:** Release verification ran bare `goat-flow index` in the v1.15.0 framework checkout, but PATH resolved `goat-flow v1.14.0`. The command appeared successful and rewrote every generated learning-loop index with the older implementation. The version check exposed the mismatch; rerunning the source entry at `node --import tsx src/cli/cli.ts --version` returned `goat-flow v1.15.0` before regeneration.

**Recurrence 2026-08-06:** A pre-release quality assessment compared the installed `goat-flow v1.14.0` on PATH with the v1.15.0 source checkout and called the mismatch a persistent defect, although `package.json`, `.goat-flow/config.yaml`, installed skills, references, and the source CLI all agreed on v1.15.0. `src/cli/prompt/compose-quality-contract.ts` (search: `Version-skew calibration`) now separates saver compatibility from assessment evidence, and the dashboard mirror carries the same rule.

**Recurrence 2026-08-16:** Controller-hook verification first used the global `goat-flow v1.15.1` against locally patched v1.15.1 hook bytes. The published bundle correctly classified those development bytes as `installed-version-mismatch`, so `hooks verify` returned `hook-not-installed` even though `hooks list` proved the Codex registration itself was present. Running `node --import tsx src/cli/cli.ts hooks verify ...` from the patched checkout compared like with like and passed both configured Stop scenarios. A matching version label is insufficient when unreleased bytes differ; the verifier must come from the same build under test.

**Prevention:** In the framework checkout, use `node --import tsx src/cli/cli.ts <command>` before build or `npm run goat-flow:cli -- <command>` only after a fresh build, and verify `--version` matches `package.json`; do not use bare `goat-flow` during pre-release work. Consumer examples must name the scoped `@blundergoat/goat-flow` package. When a generated prompt calls a command added in the current release, verify the exact version before any output write and gate source fallbacks on both the expected package name and source entry path. Quality prompts must treat executable version checks as saver selection only: PATH-only skew is not a finding or score input, while repository-owned declarations and managed target artifacts remain version-drift evidence.

## Footgun: A permission mode reused as a feature trigger fires on every session that shares the mode

**Status:** active | **Created:** 2026-08-01 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A feature's setup work runs for sessions that will never use the feature. Here, opening any read-only Claude terminal created `.goat-flow/logs/quality/staging/` in both the controlling workspace and the selected target - materialising a `.goat-flow/` tree inside targets that never installed goat-flow, with no `.gitignore` seeded. Because the setup call fails closed, an unrelated `.goat-flow` component of the wrong type in a target could also block a read-only session from opening at all.

**Why it happens:** `src/cli/server/terminal.ts` gated staged-draft capture (ADR-044) on `runner === "claude" && accessMode === "reporting"`, reading "reporting" as "this is a quality report run". It is not: `dashboardTerminalAccessMode` in `src/dashboard/dashboard-terminal-paste.ts` returns `reporting` for every preset without `mayWriteFiles`, for every investigator-role session, and for every custom prompt - which resolves to no preset at all. The real trigger lives one request earlier, where `/api/quality` composes the `persistence: "staged-draft"` prompt, and nothing carried that fact to the launch.

**Evidence:** Raised as P1 by Codex review on PR #57 and confirmed by reading the resolver: `preset?.mayWriteFiles === true` is `undefined` for a custom prompt, so the ternary yields `reporting`. Fixed by adding an explicit `captureQualityDrafts` field to the terminal-create contract (`src/cli/server/decoders.ts`, search: `decodeTerminalCaptureQualityDrafts`), set only by the quality launch and carried through retry as `retryCaptureQualityDrafts`.

**Prevention:** A permission mode answers "what may this session do", not "what is this session for". Before deriving a side effect from one, list every launch that lands in the same mode; if that list is wider than the feature, carry an explicit opt-in field instead. Make the field default to the inert value so an omission skips the side effect rather than performing it, and check the retry/reconnect path in the same change - a flag that opens the feature but is dropped on relaunch fails silently.

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

## Footgun: `quality diff` reports a finding "resolved" when the next report merely omits it

**Status:** resolved | **Created:** 2026-07-31 | **Resolved:** 2026-08-15 | **Evidence:** ACTUAL_MEASURED
**hallucination-risk:** high

**Resolution:** The bucket no longer claims a fix. `src/cli/quality/history.ts` (search: `absent: QualityDiffFindingRow[]`) renames the field and documents that absence is not proof, `src/cli/quality/history-diff.ts` (search: `Absent findings existed before`) computes it under the honest name, and `src/cli/quality/history-render.ts` (search: `Absent from newer report`) prints an inline caveat beside the rows whenever the bucket is non-empty. The set-difference limitation is inherent and unchanged - what is fixed is the claim made about it. Regression coverage: `test/unit/quality-diff-delta-tag.test.ts` (search: `quality diff absent-bucket honesty`) asserts the caveat appears with rows, stays away when the bucket is empty, and that no bare `Resolved (` section returns.

**Original symptoms:** `goat-flow quality diff <from>:<to>` showed a non-zero `resolved` count and the reviewer records those issues as fixed - but the cited files still contain the exact reported defect. Measured 2026-07-31: diffing `2026-07-31-1013-claude-647b9` to `2026-07-31-2123-claude-b5fb8` reported `resolved: 2`, one being `content_quality:goat-flow-logs-sessions-2026-04-18-skill-quality-tests-md:14`. Reading that file showed `## Pressure test results (7/7)` still present at line 14, unchanged. Nothing was fixed; the newer assessment simply did not raise it.

**Why it happens:** `computeQualityDiff` in `src/cli/quality/history-diff.ts` (search: `Absent findings existed before`) derives the bucket purely by finding-id set difference. It cannot distinguish "the defect was repaired" from "this run looked elsewhere, sampled differently, scored more leniently, or ran under a degraded prompt". The signal corrupts in both directions because ids embed a line number: an unfixed defect drops out of the diff when the next run omits it, and a semantically identical defect at a shifted line returns as `new` rather than `persisted`. Assessments are LM-generated and non-exhaustive, so omission is normal rather than exceptional - which makes false resolution the common case, not an edge case.

**Evidence:**
- `src/cli/quality/history-diff.ts` (search: `Absent findings existed before`) - set-difference derivation with no artifact re-check.
- 2026-07-31 measurement above: `resolved: 2` while a grep for the 7/7 aggregate in `.goat-flow/logs/sessions/2026-04-18-skill-quality-tests.md` still returns line 14.
- Same run pair: the other resolved id `skill_flaw:workflow-skills-goat-qa-skill-md:50` names content still present in `workflow/skills/goat-qa/SKILL.md` and previously root-rejected as a false positive, so the bucket also absorbs findings that were never valid.
- The reverse direction was recorded independently in `.goat-flow/plans/1.15.0/M09-behavioural-evidence-refresh-and-verification.md`: two new line-based ids for semantically unchanged findings.

**Prevention:**
1. Never close a remediation milestone on a `resolved` count. Re-read each cited file and anchor and show the defect is gone; treat the bucket as "absent from the newer report" and use it as a prompt to verify, not as evidence.
2. When an exit criterion says "diff shows findings resolved", satisfy it with per-finding artifact checks and record those instead of the diff summary.
3. A degraded prompt silently inflates this: a report generated without prior-report context carries `prior_report_id: null`, so nothing can be tagged `persisted` and every prior finding reads as resolved. Check `audit_status` and `prior_report_id` on both reports before trusting a diff - see `.goat-flow/learning-loop/lessons/browser-evidence.md` (search: `Reproducing a server route means reusing its inputs`).
