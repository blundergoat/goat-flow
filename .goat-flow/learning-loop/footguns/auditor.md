---
category: auditor
last_reviewed: 2026-07-18
---

## Footgun: Audit does not prove end-to-end deny enforcement at runtime

**Status:** active | **Created:** 2026-04-05 | **Updated:** 2026-05-24 | **Evidence:** ACTUAL_MEASURED

The selected-agent audit validates hook syntax, self-test behavior, registration, and a runtime-shaped blocked Bash payload through the registered hook path. It still does not prove that the external agent runtime itself delivered the hook payload for a real Bash tool invocation. A hook that passes every local check can still fail at the provider/runtime boundary if the agent ignores the configured hook event or changes its payload contract.

**Residual scope** (after the selected-agent guardrail check started invoking the hook's `--self-test` and a runtime-shaped blocked payload):

1. Hook registration cross-check (file exists ↔ registered in settings). The `deny-hook-registered` check in `harness/check-constraints.ts` covers this, and the selected-agent guardrail check now exercises the registered hook path with a runtime-shaped payload. Neither launches the external agent binary to prove provider-side delivery.
2. A dedicated `goat-flow verify` command for full external-runtime hook smoke-test is not yet built.
3. Static fact extraction can drift from the deny hook when hook regexes are generalized. On 2026-04-27, `detectBashDenyCoversSecrets` still expected older `/.ssh/` and `/.aws/` regex text after the hook moved to relative/home-root normalization, causing a false harness failure until the detector and unit coverage were updated.

**Evidence:**
- `src/cli/audit/harness/check-constraints.ts` (search: `deny-hook-registered`) - cross-checks hook file existence against settings.json registration.
- `src/cli/audit/check-agent-deny-mechanism.ts` (search: `checkHookSelfTest`) - invokes the hook's `--self-test` so quoted-alternation false positives and pipe-to-shell bypass attempts are exercised, not just parsed.
- `src/cli/audit/check-agent-deny-runtime.ts` (search: `checkHookRuntimeSmoke`) - sends a runtime-shaped structured Bash payload through the registered deny hook path and expects a deny result for `git push origin main`. This is local hook execution, not proof that the external agent binary delivered the hook event.
- `src/cli/facts/agent/hooks.ts` (search: `detectBashDenyCoversSecrets`) - derives the harness secret-coverage fact from static markers in the hook file; it must stay aligned with `workflow/hooks/deny-dangerous/patterns-paths.sh` (search: `is_secret_path_touch`).
- `test/unit/audit-command/hook-facts.test.ts` (search: `detects current deny hook secret coverage from generalized path matcher`) - regression coverage for the static detector against the canonical hook template.

---

## Footgun: The deny-mechanism runtime smoke executes the target checkout's own hook command

**Status:** active | **Created:** 2026-06-14 | **Evidence:** ACTUAL_MEASURED

**Trap:** The runtime evidence level of the agent deny-mechanism audit does not only run goat-flow's own managed script - it executes the *target project's* configured launcher string through `bash -c`. `src/cli/audit/check-agent-deny-runtime.ts` (search: `runConfiguredHookCommandSmoke`, `pipeSmokePayloadTo(configured.command)`) pipes a blocked payload into `configured.command` taken verbatim from the checkout's `.claude/settings.json` / `.codex/hooks.json` / `.agents/hooks.json`. So `goat-flow audit --agent <id>` against a checkout you do not control is arbitrary-shell-execution-on-audit: a hostile or compromised hook config that merely wraps the managed script in other shell still runs that shell before the smoke can classify anything. This is deliberate (it validates the real `$root` resolution and `cd` glue, which a sanitized re-invocation would skip), but the exec surface is easy to widen by accident.

**Evidence:**
- `src/cli/audit/check-agent-deny-runtime.ts` (search: `runConfiguredHookCommandSmoke`) - the comment above the `spawnSync` documents the trusted-target-only intent; runtime runs when `denyMechanismEvidenceLevel` is `"full"` or unset.
- `src/cli/cli-handlers.ts` (search: `options.isTargetUntrusted`) - `--untrusted-target` maps to `denyMechanismEvidenceLevel: "static"` so a CLI audit can skip execution; `src/cli/server/dashboard-audit-routes.ts` (search: `denyMechanismEvidenceLevel`) already audits selected targets at `"static"` for the same reason.
- Inverse concern (audit proving too *little*, not too much): the "Audit does not prove end-to-end deny enforcement at runtime" footgun above. Side-effect cousin: [internal-run-isolation.md](internal-run-isolation.md).

**Prevention:** Keep an execution opt-out reachable and keep the dashboard / arbitrary-selected-target path on `"static"`. Never make runtime smoke the unconditional default for a surface that can audit untrusted checkouts. Treat any change to the default evidence level as a security decision - and note it can also flip a CI audit gate, because runtime smoke catches launcher / `$root` failures that static checks do not. Do not "harden" this by parsing the launcher and running only the managed script: that reintroduces the stale-path / broken-glue blind spot the full-command smoke exists to catch (see [hooks.md](hooks.md) search: `Hook command strings can fail before guard code starts`).

---

## Footgun: Missing directories can false-pass when harness checks use `listDir()` as an existence test

**Status:** active | **Created:** 2026-05-05 | **Evidence:** ACTUAL_MEASURED

Some harness checks can report a missing directory as present if they rely on `ctx.fs.listDir(path)` throwing for absent paths. The project filesystem abstraction intentionally returns an empty array on missing or unreadable directories, so a `try/catch` around `listDir()` is not an existence check.

**Symptoms:** After deleting the old WIP goat-flow install from `api-main`, `/api/audit?path=/home/hxdev/projects/feature/api-main&quality=true&fresh=true` reported setup failure `Missing: .goat-flow/logs/sessions/`, while the Recovery concern simultaneously reported `Session logs directory exists`.

**Evidence:**
- `src/cli/facts/fs.ts` (search: `swallows readdir errors as a cached [] fallback`) - catches `readdirSync` failures and returns `[]`.
- `src/cli/audit/harness/check-recovery.ts` (search: `if (!ctx.fs.isReadableDirectory(logsDir))`) - the session-log check now verifies directory readability before using the non-throwing listing.
- Runtime probe from 2026-05-05: `createFS("/home/hxdev/projects/feature/api-main").exists(".goat-flow/logs/sessions")` returned `false`, while `listDir(".goat-flow/logs/sessions")` returned `[]`.

**Recurrence update (2026-07-12):** M33 found that existence alone still false-passed when `.goat-flow/plans` or `.goat-flow/logs/sessions` was an ordinary file. Setup and Recovery both reported PASS because `exists()` returned true and `listDir()` collapsed `ENOTDIR` to `[]`. `ReadonlyFS.isReadableDirectory` now shares the adapter's cached directory read, and both checks fail unusable paths while valid empty directories still pass. Evidence: `test/integration/audit-quality.test.ts` (search: `fails setup and recovery when required storage paths are files`).

**Prevention:** When a check promises directory storage, require both `exists(path)` and `isReadableDirectory(path)` before using `listDir()`. Use `listDir()` alone only when missing, unreadable, and empty intentionally mean the same thing.

---

## Footgun: Structural Compliance Illusion

**Status:** active | **Created:** 2026-04-16 | **Evidence:** ACTUAL_MEASURED

Build checks in `src/cli/audit/check-goat-flow.ts` and `src/cli/audit/check-agent-setup.ts` prove the install shape is present, not that the cold-path docs are semantically true. A structural PASS without content verification still creates false confidence.

**Evidence:**
- `src/cli/audit/check-goat-flow.ts` and `src/cli/audit/check-agent-setup.ts` gate file existence / install structure.
- `src/cli/audit/check-content-quality.ts` and `src/cli/audit/check-factual-claims.ts` exist because structural correctness alone did not catch cold-path truth drift.

**Prevention:** Keep structural audit and content-truth checks separate and explicit. Never treat a build PASS as proof that docs, ADRs, or prompts are semantically current.

---

## Footgun: Learning-loop record counts have two grammars that disagree on resolved entries

**Status:** active | **Created:** 2026-06-10 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Two surfaces show different counts under the same bucket label. Measured 2026-06-10: the dashboard Home LEARNING LOOP pill said `94 footguns` while the Learning loop card's per-bucket bar said `footguns 78`. Both are correct - they use different counting grammars.

**Evidence:**
- `src/cli/server/dashboard-reporting.ts` (search: `footgunCount: stats.footguns.totalEntries`) - pill counts come from `buildStatsReport`, which counts every entry heading including `Status: resolved` footguns.
- Same file (search: `entryCount: parseBucket`) - the card's bars use `parseBucket` from `src/cli/learning-loop-index/parse-bucket.ts`, which returns active entries only (the INDEX.md grammar, "active-entry rows" per its doc comment).
- Measured gap: 94 total vs 78 active footguns (16 resolved); lessons matched at 212 because they have no resolved state, so the mismatch hides on buckets without resolved entries.
- First Learning loop card draft rendered both numbers on one card; fixed by deriving the card's status line from the same `entryCount` data as its bars (search: `learningLoopStatusDetail` in `src/dashboard/views/home.html`).

**Prevention:**
1. Match the count source to the surface's concept: retrieval/index surfaces use `parseBucket` active counts; size/health surfaces use stats totals.
2. Never render counts from both grammars under the same bucket label on one surface; if both must appear, label them distinctly ("active entries" vs total records).

---

## Footgun: Selected-agent drift can leak unselected agent surfaces

**Status:** active | **Created:** 2026-07-12 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Every new drift surface must declare whether it is agent-owned or shared and carry the caller's agent filter into agent-owned scans.
**Trigger phase:** ACT

**Trap:** Agent selection is easy to preserve in the top-level audit and lose inside a nested drift helper. Any helper that rebuilds the manifest-owned agent inventory can silently widen a selected-agent audit, producing phantom missing files for agents the consumer did not install. The current implementation prevents this for known drift surfaces; each new agent-owned surface can reintroduce it if it ignores `agentFilter`.

**Original incident:** On 2026-07-12, `audit --agent codex --check-drift` against a Codex-only consumer still compared Claude and Copilot hook registrations because `checkDrift` rebuilt the full agent inventory.

**Evidence:**
- `src/cli/audit/audit.ts` (search: `agentFilter: ctx.agentFilter`) passes the selected agent into drift instead of dropping the caller's scope.
- `src/cli/audit/check-drift.ts` (search: `selectedInstalledSkillRoots`) filters agent-owned skills, orphan scans, and hook registrations while leaving shared references and central hook policy global.
- `test/integration/audit-drift-checkdrift-hook-templates.test.ts` (search: `limits hook drift to the selected agent`) reproduces the Codex-only consumer and fails if another agent leaks back into the report.

**Prevention:** Any new drift surface must declare whether it is agent-owned or shared. Apply `agentFilter` to agent-owned files and keep shared framework assets global; prove both with a single-agent consumer fixture.

---

## Footgun: Extractor diagnostics can encode valid empty state

**Status:** active | **Created:** 2026-07-12 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Diagnostic consumers must classify every documented state at their boundary; non-null diagnostic text is not an error flag.
**Trigger phase:** ACT

**Trap:** A shared diagnostic channel can carry malformed-metadata errors and valid status such as an empty first-run store. Any new consumer that treats every non-null diagnostic as failure can turn a valid fresh installation into a failed harness. The current Feedback Loop consumer classifies the known empty states; new diagnostics or consumers can reintroduce the conflation.

**Original incident:** On 2026-07-12, a fresh consumer with valid but empty footgun and lesson directories failed the Feedback Loop concern because the harness treated the valid messages `Footgun directory exists but contains 0 entries` and `Lesson directory exists but contains 0 entries` as errors.

**Evidence:**
- `src/cli/audit/harness/check-feedback-loop.ts` (search: `EMPTY_LEARNING_LOOP_DIAGNOSTICS`) distinguishes the two valid first-run messages from actionable format failures.
- `test/integration/audit-quality.test.ts` (search: `accepts extractor diagnostics that only report zero learning-loop entries`) pins the empty-install behavior without suppressing malformed-bucket diagnostics.
- `test/integration/setup-quality-lifecycle.test.ts` (search: `consumer setup to quality-report lifecycle`) proves a newly installed consumer reaches a passing selected-agent harness before any incident entries exist.

**Prevention:** Do not interpret a general-purpose diagnostic field as an error flag. Classify each documented diagnostic state at the consuming boundary, and keep a fresh-install fixture beside malformed-metadata coverage.

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

## Footgun: Decision meta files must be excluded from every decision extractor

**Status:** resolved | **Created:** 2026-06-04 | **Resolved:** 2026-06-05 | **Evidence:** ACTUAL_MEASURED

**Resolution:** `src/cli/facts/shared/decision-files.ts` (search: `isDecisionRecordMarkdown`) now owns the shared ADR/meta split; `src/cli/facts/shared/index.ts` (search: `filter(isDecisionRecordMarkdown)`) and `src/cli/facts/shared/learning-loop-entries.ts` (search: `isDecisionRecordMarkdown(sourceFilename(decisionFile.path))`) use it. `test/unit/learning-loop.test.ts` (search: `excludes the decisions INDEX from shared decision counts and prompt entries`) pins the inflated-count and prompt-entry regression.

**Original symptoms:** Adding a hand-maintained `.goat-flow/learning-loop/decisions/INDEX.md` could pass `stats --check` filename validation while shared decision facts and prompt learning-loop entries still counted or surfaced it as a real decision. The dashboard, harness, and prompt context then reported inflated decision counts or included a "Decisions Index" entry beside ADR records.

**Why it happened:** Decision validation, decision directory facts, and compact learning-loop entry extraction had separate filters. Updating only the stats validator's meta-file allowlist left `src/cli/facts/shared/index.ts` and the learning-loop entry helpers using the older "exclude README only" rule. In this checkout, `rg --files .goat-flow/learning-loop/decisions | rg '\.md$' | wc -l` returned 34, while `rg --files .goat-flow/learning-loop/decisions | rg '/ADR-[0-9]{3}-.*\.md$' | wc -l` returned 32 and `.goat-flow/learning-loop/decisions/INDEX.md` was present.

**Prevention:** Treat decision meta-file additions like a shared extractor contract change. Update the stats validator, shared decision facts, compact learning-loop entries, prompt filters, and tests in one patch; assert both the failing gate (`stats --check`) and the non-gating facts (`decisions.fileCount`, decision entry titles) so meta files cannot leak into user-facing counts.

---

## Footgun: Learning-loop stale-ref detection misses bare-path `Evidence anchors:` entries

**Status:** resolved | **Created:** 2026-06-01 | **Resolved:** 2026-06-03 | **Evidence:** ACTUAL_MEASURED

**Resolution:** `src/cli/facts/shared/learning-loop-common.ts` (search: `scanBareEvidenceAnchors`) now existence-checks non-glob bare backtick paths on `Evidence anchors:` lines, while leaving line refs and search anchors to their existing scanners. `test/unit/learning-loop.test.ts` (search: `flags bare Evidence anchors paths`) pins the stale-path regression.

**Original symptoms:** `goat-flow stats --check` existence-checked a learning-loop file reference in only three anchor shapes: `` `file:line` ``, `` `file` (search: `needle`) ``, and `(search: "needle")`. A bare backtick path with no line number and no `(search: ...)` suffix - the `Evidence anchors: \`path/to/file.ts\`` convention - was never checked. `Evidence anchors:` lines appeared in 15 learning-loop files as of 2026-06-01, so a whole class of anchor silently bypassed the integrity gate.

The miss kept `stats --check` green while `.goat-flow/learning-loop/lessons/gruff-cleanup.md` cited two deleted tests (`test/unit/audit-command/harness.test.ts`, `test/unit/dashboard-toast.test.ts`) and `.goat-flow/learning-loop/lessons/verification.md` cited a deleted task milestone under `.goat-flow/plans/1.8.0/`; a Codex quality run found them by hand, not the detector.

**Invariant:** durable learning-loop evidence should use the sanctioned `(search: "needle")` form when content identity matters. Never anchor to `.goat-flow/plans/**` milestone files - they are gitignored WIP and get cleaned up.

## Footgun: Audit howToFix emits commands the deny hook blocks

**Status:** resolved | **Created:** 2026-04-15 | **Resolved:** 2026-04-16 | **Evidence:** ACTUAL_MEASURED

**Resolution:** `check-agent-setup.ts` (search: `howToFix.*deprecated`) now emits text guidance ("Delete the SKILL.md inside each, then remove the empty directory") instead of shell commands. No longer triggers deny hook blocks.

**Original symptoms:** Running `goat-flow audit` and following its fix suggestions triggered deny-hook blocks because howToFix emitted `rm -rf ${path}` for deprecated skill directories.

---

## Footgun: Harness verifies post-turn hooks but not PreToolUse deny registration

**Status:** resolved | **Created:** 2026-04-15 | **Resolved:** 2026-04-16 | **Evidence:** ACTUAL_MEASURED

**Resolution:** `check-constraints.ts` (search: `deny-hook-registered`) now verifies PreToolUse/pre-tool deny hook registration via `af.hooks.denyIsRegistered`. Added in commit 708b1af. The `check-verification.ts` hooks-registered check correctly remains scoped to post-turn hooks only.

**Original symptoms:** A project could pass the harness audit without the deny hook being wired to PreToolUse.

---

## Footgun: Audit checks existed with no machine-readable justification

**Status:** resolved | **Created:** 2026-04-18 | **Resolved:** 2026-04-18 | **Evidence:** ACTUAL_MEASURED

**Resolution:** M05 defined the `CheckEvidence` schema and M11 back-filled it onto all 33 live audit checks. `BuildCheck` and `HarnessCheck` now require `provenance`, `runAudit()` validates every registered record via `validateProvenance()`, and per-check JSON output carries the full provenance object. CONTRIBUTING now requires new checks to ship provenance in the same change.

**Original symptoms:** The live registry had deterministic checks, but no per-check machine-readable record of why each one existed, which source justified it, or whether a rule was MUST/SHOULD/BEST_PRACTICE. Reviewers had to infer rationale from code, stale milestone text, or repo history.

---

## Footgun: Preflight node-to-grep pipeline passes unsanitized stdout into regex patterns

**Status:** resolved | **Created:** 2026-04-21 | **Resolved:** 2026-04-21 | **Evidence:** ACTUAL_MEASURED

**Resolution:** Node output piped through `grep -oE '^[0-9]+$' | tail -1` to extract only numeric lines. Architecture doc matching switched from `grep -q` (BRE) to `grep -Fq` (fixed strings). `setup_count` initialized before the conditional block to prevent `set -u` crash. Commit on `dev` branch, `scripts/preflight-checks.sh` (search: `grep -oE '^[0-9]+$'`).

**Original symptoms:** `npm publish` failed: the round-trip fixture test (`test/integration/audit-drift.test.ts`, search: `installs fixture-backed references`) intermittently crashed with `grep: Unmatched [, [^, [:, [., or [=` in the Doc/Code Drift section. Root cause: `node --input-type=module` commands that compute check counts (`build_count`, `quality_count`, `setup_count`, `agent_count`) captured raw stdout including stray node diagnostic lines containing `[` characters. These were then interpolated into `grep -q "${build_count} build"` where grep interpreted `[` as a regex character class. The first fix (output sanitization) introduced a second failure: when the sanitized pipeline returned empty in the temp fixture (node imports fail without a working `dist/`), `setup_count` was never set because it was assigned inside the `if [[ -n "$build_count" ]]` block but referenced unconditionally on line 526 - crashing with `set -u` (`unbound variable`).
