---
category: auditor
last_reviewed: 2026-06-05
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
- `src/cli/audit/check-agent-deny-mechanism.ts` (search: `checkHookRuntimeSmoke`) - sends a runtime-shaped structured Bash payload through the registered deny hook path and expects a deny result for `git push origin main`. This is local hook execution, not proof that the external agent binary delivered the hook event.
- `src/cli/facts/agent/hooks.ts` (search: `detectBashDenyCoversSecrets`) - derives the harness secret-coverage fact from static markers in the hook file; it must stay aligned with `workflow/hooks/deny-dangerous/patterns-paths.sh` (search: `is_secret_path_touch`).
- `test/unit/audit-command/hook-facts.test.ts` (search: `detects current deny hook secret coverage from generalized path matcher`) - regression coverage for the static detector against the canonical hook template.

---

## Footgun: Missing directories can false-pass when harness checks use `listDir()` as an existence test

**Status:** active | **Created:** 2026-05-05 | **Evidence:** ACTUAL_MEASURED

Some harness checks can report a missing directory as present if they rely on `ctx.fs.listDir(path)` throwing for absent paths. The project filesystem abstraction intentionally returns an empty array on missing or unreadable directories, so a `try/catch` around `listDir()` is not an existence check.

**Symptoms:** After deleting the old WIP goat-flow install from `api-main`, `/api/audit?path=/home/hxdev/projects/feature/api-main&quality=true&fresh=true` reported setup failure `Missing: .goat-flow/logs/sessions/`, while the Recovery concern simultaneously reported `Session logs directory exists`.

**Evidence:**
- `src/cli/facts/fs.ts` (search: `listDir(path: string)`) - catches `readdirSync` failures and returns `[]`.
- `src/cli/audit/harness/check-recovery.ts` (search: `if (!ctx.fs.exists(logsDir))`) - the session-log check now guards existence before `listDir()`; future harness checks need the same pattern.
- Runtime probe from 2026-05-05: `createFS("/home/hxdev/projects/feature/api-main").exists(".goat-flow/logs/sessions")` returned `false`, while `listDir(".goat-flow/logs/sessions")` returned `[]`.

**Prevention:** Harness checks that need existence semantics must call `ctx.fs.exists(path)` first. Use `listDir()` only after existence is established, or explicitly document that missing and empty are equivalent for that check.

---

## Footgun: Structural Compliance Illusion

**Status:** active | **Created:** 2026-04-16 | **Evidence:** ACTUAL_MEASURED

Build checks in `src/cli/audit/check-goat-flow.ts` and `src/cli/audit/check-agent-setup.ts` prove the install shape is present, not that the cold-path docs are semantically true. A structural PASS without content verification still creates false confidence.

**Evidence:**
- `src/cli/audit/check-goat-flow.ts` and `src/cli/audit/check-agent-setup.ts` gate file existence / install structure.
- `src/cli/audit/check-content-quality.ts` and `src/cli/audit/check-factual-claims.ts` exist because structural correctness alone did not catch cold-path truth drift.

**Prevention:** Keep structural audit and content-truth checks separate and explicit. Never treat a build PASS as proof that docs, ADRs, or prompts are semantically current.

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

## Footgun: Decision meta files must be excluded from every decision extractor

**Status:** resolved | **Created:** 2026-06-04 | **Resolved:** 2026-06-05 | **Evidence:** ACTUAL_MEASURED

**Resolution:** `src/cli/facts/shared/decision-files.ts` (search: `isDecisionRecordMarkdown`) now owns the shared ADR/meta split; `src/cli/facts/shared/index.ts` (search: `filter(isDecisionRecordMarkdown)`) and `src/cli/facts/shared/learning-loop-entries.ts` (search: `isDecisionRecordMarkdown(basename(file.path))`) use it. `test/unit/learning-loop.test.ts` (search: `excludes the decisions INDEX from shared decision counts and prompt entries`) pins the inflated-count and prompt-entry regression.

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
