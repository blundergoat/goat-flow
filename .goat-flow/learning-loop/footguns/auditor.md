---
category: auditor
last_reviewed: 2026-08-23
---

## Footgun: Audit does not prove end-to-end deny enforcement at runtime

**Status:** active | **Created:** 2026-04-05 | **Updated:** 2026-07-26 | **Evidence:** ACTUAL_MEASURED

The selected-agent audit with explicit `--trusted-target` validates hook syntax, self-test behavior, registration, and a runtime-shaped blocked Bash payload through the registered hook path. It still does not prove that the external agent runtime itself delivered the hook payload for a real Bash tool invocation. A hook that passes every local check can still fail at the provider/runtime boundary if the agent ignores the configured hook event or changes its payload contract.

**Residual scope** (after an explicitly trusted selected-agent guardrail check started invoking the hook's `--self-test` and sending a runtime-shaped blocked payload):

1. Hook registration cross-check (file exists ↔ registered in settings). The `deny-hook-registered` check in `harness/check-constraints.ts` covers this, and the selected-agent guardrail check now exercises the registered hook path with a runtime-shaped payload. Neither launches the external agent binary to prove provider-side delivery.
2. `goat-flow hooks verify --agent <id> --scenario deny-hook --trusted-target` closes only the checkout-local half: it drives the fixed deny scenarios through the managed hook and returns a per-scenario verdict at `evidenceLevel: managed-hook-classifier`. Its evidence budget explicitly forbids an external-agent delivery claim, so a smoke-test that launches the real agent binary and proves the provider delivered the hook event is still not built. Do not read this item as "no verify surface exists".
3. Static fact extraction can drift from the deny hook when hook regexes are generalized. On 2026-04-27, `detectBashDenyCoversSecrets` still expected older `/.ssh/` and `/.aws/` regex text after the hook moved to relative/home-root normalization, causing a false harness failure until the detector and unit coverage were updated.

**Evidence:**
- `src/cli/audit/harness/check-constraints.ts` (search: `deny-hook-registered`) - cross-checks hook file existence against settings.json registration.
- `src/cli/audit/check-agent-deny-mechanism.ts` (search: `checkHookSelfTest`) - explicit full evidence invokes the hook's `--self-test` so quoted-alternation false positives and pipe-to-shell bypass attempts are exercised, not just parsed.
- `src/cli/audit/check-agent-deny-runtime.ts` (search: `checkHookRuntimeSmoke`) - sends a runtime-shaped structured Bash payload through the registered deny hook path and expects a deny result for `git push origin main`. This is local hook execution, not proof that the external agent binary delivered the hook event.
- `src/cli/facts/agent/hooks.ts` (search: `detectBashDenyCoversSecrets`) - derives the harness secret-coverage fact from static markers in the hook file; it must stay aligned with `workflow/hooks/deny-dangerous/patterns-paths.sh` (search: `is_secret_path_touch`).
- `test/unit/audit-command/hook-facts.test.ts` (search: `detects current deny hook secret coverage from generalized path matcher`) - regression coverage for the static detector against the canonical hook template.
- `src/cli/hooks-command.ts` (search: `handleHookVerification`) - the `hooks verify` entry point; requires `--agent`, the fixed `deny-hook` scenario group, and `--trusted-target` before execution, then exits 1 when any scenario lacks matching recorded proof.
- `src/cli/hooks-runtime-evidence.ts` (search: `verifyManagedDenyHook`) - runs every fixed deny scenario against the managed script and returns the local-evidence report. Confirmed 2026-07-26: three scenarios (secret read, repository push, read-only control) all `pass`, all local.

---

## Footgun: The deny-mechanism runtime smoke executes the target checkout's own hook command

**Status:** active | **Created:** 2026-06-14 | **Corrected:** 2026-08-16 | **Evidence:** ACTUAL_MEASURED

**Original trap:** The runtime evidence level of the agent deny-mechanism audit does not only run goat-flow's own managed script - it executes the *target project's* configured launcher string through `bash -c`. `src/cli/audit/check-agent-deny-runtime.ts` (search: `verifyConfiguredHookRuntime`, `pipeRuntimeProbeTo(configured.command)`) pipes a blocked payload into `configured.command` taken verbatim from the checkout's `.claude/settings.json` / `.codex/hooks.json` / `.agents/hooks.json`. Before the 1.16.0 correction, `goat-flow audit --agent <id>` did this unless the user supplied `--untrusted-target`, so auditing a hostile or compromised checkout could run arbitrary shell before the smoke classified anything. Full execution is deliberate because it validates the real `$root` resolution and `cd` glue, which a sanitized re-invocation would skip.

**Current contract:** Omission is static. Only `--trusted-target` enables the configured launcher, managed self-test, and runtime-shaped probes. The deprecated `--untrusted-target` flag remains a static compatibility alias throughout v1.16.x; combining both flags is a usage error.

**Evidence:**
- `src/cli/audit/check-agent-deny-runtime.ts` (search: `verifyConfiguredHookRuntime`) - runtime replays the exact configured command; callers reach it only with explicit `denyMechanismEvidenceLevel: "full"`.
- `src/cli/cli-handlers.ts` (search: `options.isTargetTrusted`) - audit and setup map `--trusted-target` to `"full"`; omission and the deprecated alias map to `"static"`.
- **Dashboard mitigation, 2026-08-07.** The correction committed at 07:09 accurately recorded that `buildDashboardAuditReport` then selected `"full"`; commit `19046c08` changed that branch to `"static"` at 17:06 the same day. Current `src/cli/server/dashboard-audit-routes.ts` (search: `agentFilter === null ? "present-only" : "static"`) leaves runtime proof to an explicit CLI audit. `test/integration/dashboard-audit-api.test.ts` (search: `does not execute selected-project hook launcher in /api/audit`) installs a marker-writing launcher and proves the selected-agent dashboard endpoint does not run it.
- **Reach, measured 2026-08-16.** Only a selected-agent CLI audit using explicit full evidence executes. `test/unit/audit-deny-runtime-flag.test.ts` (search: `does not run a managed self-test or configured launcher`) intercepts both runtime surfaces and records zero calls when the library evidence level is omitted; its explicit-full control records configured launcher calls. `src/cli/audit/audit.ts` (search: `denyMechanismEvidenceLevel`) resolves omission to `"static"`, while aggregate audit still skips agent-scope checks. The dashboard per-agent route remains explicitly static.
- Inverse concern (audit proving too *little*, not too much): the "Audit does not prove end-to-end deny enforcement at runtime" footgun above. Side-effect cousin: [internal-run-isolation.md](internal-run-isolation.md).

**Prevention:** Keep target execution opt-in. Preserve the invariant that passive selected-project requests and omitted library options stop at static evidence; runtime proof belongs to an explicit `--trusted-target` choice. Before citing a surface as `"static"` or `"full"`, re-read the call site and its route-level test. Treat any change to the default evidence level as a security decision - it can also flip a CI audit gate, because runtime smoke catches launcher / `$root` failures that static checks do not. Do not "harden" this by parsing the launcher and running only the managed script: that reintroduces the stale-path / broken-glue blind spot the full-command smoke exists to catch (see [hooks.md](hooks.md) search: `Hook command strings can fail before guard code starts`).

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
- `src/cli/audit/check-goat-flow.ts` (search: "export const SETUP_CHECKS") and `src/cli/audit/check-agent-setup.ts` gate file existence / install structure.
- `src/cli/audit/check-content-quality.ts` and `src/cli/audit/check-factual-claims.ts` exist because structural correctness alone did not catch cold-path truth drift.

**Prevention:** Keep structural audit and content-truth checks separate and explicit. Never treat a build PASS as proof that docs, ADRs, or prompts are semantically current.

---

## Footgun: Selected-agent drift can leak unselected agent surfaces

**Status:** active | **Created:** 2026-07-12 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Every new drift surface must declare whether it is agent-owned or shared and carry the caller's agent filter into agent-owned scans.
**Trigger phase:** SCOPE
**Caught at:** ACT

**Trap:** Agent selection is easy to preserve in the top-level audit and lose inside a nested drift helper. Any helper that rebuilds the manifest-owned agent inventory can silently widen a selected-agent audit, producing phantom missing files for agents the consumer did not install. The current implementation prevents this for known drift surfaces; each new agent-owned surface can reintroduce it if it ignores `agentFilter`.

**Original incident:** On 2026-07-12, `audit --agent codex --check-drift` against a Codex-only consumer still compared Claude and Copilot hook registrations because `checkDrift` rebuilt the full agent inventory.

**Evidence:**
- `src/cli/audit/audit.ts` (search: `agentFilter: ctx.agentFilter`) passes the selected agent into drift instead of dropping the caller's scope.
- `src/cli/audit/check-drift.ts` (search: `selectedInstalledSkillRoots`) filters agent-owned skills, orphan scans, and hook registrations while leaving shared references and central hook policy global.
- `test/integration/audit-drift-checkdrift-hook-templates.test.ts` (search: `limits hook drift to the selected agent`) reproduces the Codex-only consumer and fails if another agent leaks back into the report.

**Prevention:** Declare whether each new drift surface is agent-owned or shared. Apply `agentFilter` to agent-owned files and keep shared framework assets global; prove both with a single-agent consumer fixture.

---

## Footgun: Version checks that test inequality without direction prescribe a downgrade

**Status:** active | **Created:** 2026-08-03 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Any version comparison that drives user-facing remediation or a file write must branch on direction, not on `!==`.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 2 | **Latest occurrence:** 2026-08-03
**hallucination-risk:** high

**Symptoms:** A globally installed `goat-flow` v1.14.0 audited a v1.15.0 checkout and returned `"overall": {"status": "fail"}` with exit 1 on a target the matching source CLI passes cleanly. It emitted `Config version 1.15.0 does not match current 1.14.0` with remediation pointing at 1.14.0, plus `deny-dangerous.sh is goat-flow-hook-version 1.15.0 but the current release is 1.14.0` telling the user to run `hooks sync` from the older release. Roughly 45 further drift findings ("templates differ", "stale installed shared artifact") were artifacts of the version gap, not target defects.

**Why it happens:** `AUDIT_VERSION` is the running CLI's own package version, so an older CLI treats itself as the reference. A bare `version !== AUDIT_VERSION` cannot distinguish "project is behind" from "project is ahead", and the remediation string interpolates `AUDIT_VERSION` either way. The template-comparison sections diff the target against the bundle inside that older CLI, so every newer file reads as drift.

**Why it matters:** `hooks sync` is not advisory. `src/cli/server/hook-registrar.ts` (search: `export function syncHookStates`) documents that it rewrites installed hook files, and `copyHookScripts` writes `hookScriptContent(script)` from the running CLI's bundle. Following the older CLI's advice replaces current deny/safety hooks with stale copies - a silent downgrade of the guardrail layer.

**Evidence:**
- `src/cli/version-compare.ts` (search: `projectIsAheadOfCli`) - direction test now shared by the audit and the hook writer.
- `src/cli/audit/check-goat-flow.ts` (search: `is newer than this CLI`) - config and hook checks branch before prescribing remediation.
- `src/cli/audit/check-agent-common.ts` (search: `targetUsesNewerGoatFlow`) - one validated target-version gate now suppresses older-template skill, guardrail, drift, and content checks.
- `src/cli/server/hook-managed-installation.ts` (search: `Refusing to overwrite`) - `copyHookScripts` throws rather than downgrading a newer-stamped hook.
- `test/unit/version-compare.test.ts` (search: `flags the CLI as the stale side when the project is newer`) - locks the direction contract, including that `1.10.0` sorts above `1.9.0`.
- `test/integration/audit-quality.test.ts` (search: `reports version skew without older-template agent or drift findings`) - simulates a newer installed config, skills, and hooks against the current CLI and pins the user-visible audit result.
- `test/unit/hook-registrar.test.ts` (search: `refuses to overwrite a hook stamped newer than the running CLI`) - proves the write boundary preserves the newer hook byte-for-byte.

**Prevention:** Never drive remediation or a write from version inequality alone. Compare direction first; when the local tool is older, say so and stop, rather than proposing to bring the target back to the tool's version. Skew guards belong at the write boundary too, not only in the message.

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

## Footgun: Audit howToFix emits commands the deny hook blocks

**Status:** resolved | **Created:** 2026-04-15 | **Resolved:** 2026-04-16 | **Evidence:** ACTUAL_MEASURED

**Resolution:** `src/cli/audit/check-agent-setup.ts` (search: `Remove the deprecated`) now emits text guidance ("Delete the SKILL.md inside each, then remove the empty directory") instead of shell commands. That guidance no longer triggers deny hook blocks.

**Original symptoms:** Running `goat-flow audit` and following its fix suggestions triggered deny-hook blocks because howToFix emitted `rm -rf ${path}` for deprecated skill directories.

---

## Footgun: Harness verifies post-turn hooks but not PreToolUse deny registration

**Status:** resolved | **Created:** 2026-04-15 | **Resolved:** 2026-04-16 | **Evidence:** ACTUAL_MEASURED

**Resolution:** `src/cli/audit/harness/check-constraints.ts` (search: `deny-hook-registered`) now verifies PreToolUse/pre-tool deny hook registration via `af.hooks.denyIsRegistered`. Added in commit 708b1af. The `check-verification.ts` hooks-registered check correctly remains scoped to post-turn hooks only.

**Original symptoms:** A project could pass the harness audit without the deny hook being wired to PreToolUse.

---

## Footgun: Audit checks existed with no machine-readable justification

**Status:** resolved | **Created:** 2026-04-18 | **Resolved:** 2026-04-18 | **Evidence:** ACTUAL_MEASURED

**Resolution:** M05 defined the `CheckEvidence` schema and M11 back-filled it onto all 33 live audit checks. `BuildCheck` and `HarnessCheck` now require `provenance`, `runAudit()` validates every registered record via `validateProvenance()`, and per-check JSON output carries the full provenance object. CONTRIBUTING now requires new checks to ship provenance in the same change.

**Original symptoms:** The live registry had deterministic checks, but no per-check machine-readable record of why each one existed, which source justified it, or whether a rule was MUST/SHOULD/BEST_PRACTICE. Reviewers had to infer rationale from code, stale milestone text, or repo history.
