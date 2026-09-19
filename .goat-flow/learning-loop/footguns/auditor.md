---
category: auditor
last_reviewed: 2026-09-05
---

## Footgun: Audit does not prove end-to-end deny enforcement at runtime

**Status:** active | **Created:** 2026-04-05 | **Updated:** 2026-07-26 | **Evidence:** ACTUAL_MEASURED

**Prevention:** Treat trusted audit results as checkout-local evidence only. Require a fresh provider-, version-, mode-, configuration-, and trust-specific live capture before claiming end-to-end runtime delivery.

**Symptoms:** A selected-agent audit with `--trusted-target` validates hook syntax, self-test behaviour, registration, and a runtime-shaped blocked Bash payload through the registered hook path, and every check passes, yet the external agent runtime can still ignore the configured hook event or change its payload contract.

**Why it happens:** Three residual gaps remain after explicit trust started invoking `--self-test` and a runtime-shaped payload. The `deny-hook-registered` cross-check and the guardrail smoke never launch the external agent binary. `goat-flow hooks verify --agent <id> --scenario deny-hook --trusted-target` drives the fixed deny scenarios through the managed hook at `evidenceLevel: managed-hook-classifier`, and its evidence budget forbids a delivery claim, so a real-binary smoke test is still not built. Static fact extraction can also drift from the hook when regexes are generalized: on 2026-04-27 `detectBashDenyCoversSecrets` still expected older `/.ssh/` and `/.aws/` regex text after the hook moved to relative and home-root normalization, causing a false harness failure.

**Evidence:** `src/cli/audit/harness/check-constraints.ts` (search: `deny-hook-registered`); `src/cli/audit/check-agent-deny-mechanism.ts` (search: `checkHookSelfTest`) invokes the hook's `--self-test` under full evidence; `src/cli/audit/check-agent-deny-runtime.ts` (search: `checkHookRuntimeSmoke`) sends a structured Bash payload and expects a deny for `git push origin main`, which is local execution only; `src/cli/facts/agent/hooks.ts` (search: `detectBashDenyCoversSecrets`) must stay aligned with `workflow/hooks/deny-dangerous/patterns-paths.sh` (search: `is_secret_path_touch`), pinned by `test/unit/audit-command/hook-facts.test.ts` (search: `detects current deny hook secret coverage from generalized path matcher`); `src/cli/hooks-command.ts` (search: `handleHookVerification`) requires `--agent`, the `deny-hook` scenario group, and `--trusted-target`; `src/cli/hooks-runtime-evidence.ts` (search: `verifyManagedDenyHook`) runs the scenarios and returned three local passes on 2026-07-26.

---

## Footgun: The deny-mechanism runtime smoke executes the target checkout's own hook command

**Status:** active | **Created:** 2026-06-14 | **Corrected:** 2026-08-16 | **Evidence:** ACTUAL_MEASURED

**Prevention:** Keep target execution opt-in: passive selected-project requests and omitted library options stop at static evidence, and runtime proof belongs to an explicit `--trusted-target` choice. Before citing a surface as `"static"` or `"full"`, re-read the call site and its route-level test. Treat any change to the default evidence level as a security decision that can also flip a CI audit gate. Do not "harden" this by parsing the launcher and running only the managed script; that reintroduces the stale-path blind spot the full-command smoke exists to catch, recorded in `.goat-flow/learning-loop/footguns/hook-installation.md` (search: `Hook command strings can fail before guard code starts`).

**Symptoms:** Before the 1.16.0 correction, `goat-flow audit --agent <id>` piped a blocked payload into the launcher string taken verbatim from the checkout's `.claude/settings.json`, `.codex/hooks.json`, or `.agents/hooks.json` unless the user passed `--untrusted-target`, so auditing a hostile checkout could run arbitrary shell before the smoke classified anything.

**Why it happens:** Full execution is deliberate because it validates the real `$root` resolution and `cd` glue that a sanitized re-invocation would skip. The current contract makes omission static: only `--trusted-target` enables the configured launcher, managed self-test, and runtime-shaped probes. The deprecated `--untrusted-target` flag remains a static alias, still parsed at 1.17.0, and combining both flags is a usage error.

**Evidence:** `src/cli/audit/check-agent-deny-runtime.ts` (search: `verifyConfiguredHookRuntime`) replays the exact configured command only under `denyMechanismEvidenceLevel: "full"`; `src/cli/cli-handlers.ts` (search: `options.isTargetTrusted`) maps `--trusted-target` to `"full"` and omission or the alias to `"static"`; `src/cli/audit/audit.ts` (search: `denyMechanismEvidenceLevel`) resolves omission to `"static"`. Dashboard: a 2026-08-07 correction recorded `buildDashboardAuditReport` selecting `"full"`, and commit `19046c08` changed that branch to `"static"` the same day; `src/cli/server/dashboard-audit-routes.ts` (search: `agentFilter === null ? "present-only" : "static"`) leaves runtime proof to an explicit CLI audit, and `test/integration/dashboard-audit-api.test.ts` (search: `does not execute selected-project hook launcher in /api/audit`) installs a marker-writing launcher and proves the endpoint does not run it. Reach measured 2026-08-16: `test/unit/audit-deny-runtime-flag.test.ts` (search: `does not run a managed self-test or configured launcher`) records zero runtime calls when the library level is omitted and configured launcher calls under explicit full. Side-effect cousin: [internal-run-isolation.md](internal-run-isolation.md).

---

## Footgun: Missing directories can false-pass when harness checks use `listDir()` as an existence test

**Status:** active | **Created:** 2026-05-05 | **Evidence:** ACTUAL_MEASURED
**Incident count:** 2 | **Latest occurrence:** 2026-07-12

**Prevention:** When a check promises directory storage, require both `exists(path)` and `isReadableDirectory(path)` before using `listDir()`. Use `listDir()` alone only when missing, unreadable, and empty intentionally mean the same thing.

**Symptoms:** After deleting an old WIP install from `api-main`, `/api/audit?path=...&quality=true&fresh=true` reported setup failure `Missing: .goat-flow/logs/sessions/` while the Recovery concern simultaneously reported `Session logs directory exists`.

**Why it happens:** The project filesystem abstraction returns an empty array on missing or unreadable directories, so a `try/catch` around `listDir()` is not an existence check. `exists()` alone was also insufficient: when `.goat-flow/plans` or `.goat-flow/logs/sessions` was an ordinary file, `exists()` returned true and `listDir()` collapsed `ENOTDIR` to `[]`.

**Evidence:** `src/cli/facts/fs.ts` (search: `swallows readdir errors as a cached [] fallback`); `src/cli/audit/harness/check-recovery.ts` (search: `if (!ctx.fs.isReadableDirectory(logsDir))`). Runtime probe 2026-05-05: `exists(".goat-flow/logs/sessions")` returned `false` while `listDir` returned `[]`. **Recurrence 2026-07-12 (M33):** `ReadonlyFS.isReadableDirectory` now shares the adapter's cached directory read, and `test/integration/audit-quality.test.ts` (search: `fails setup and recovery when required storage paths are files`) fails unusable paths while valid empty directories pass.

---

## Footgun: Structural Compliance Illusion

**Status:** active | **Created:** 2026-04-16 | **Evidence:** ACTUAL_MEASURED

**Prevention:** Keep structural audit and content-truth checks separate and explicit. Never treat a build PASS as proof that docs, ADRs, or prompts are semantically current.

**Symptoms:** Build checks prove the install shape is present, and a structural PASS without content verification still creates false confidence about cold-path docs.

**Evidence:** `src/cli/audit/check-goat-flow.ts` (search: "export const SETUP_CHECKS") and `src/cli/audit/check-agent-setup.ts` gate file existence and install structure; `src/cli/audit/check-content-quality.ts` and `src/cli/audit/check-factual-claims.ts` exist because structure alone did not catch truth drift. The cold-path incident record is `.goat-flow/learning-loop/footguns/docs-drift.md` (search: `Cold-path docs drift while structural audit passes`).

---

## Footgun: Selected-agent drift can leak unselected agent surfaces

**Status:** active | **Created:** 2026-07-12 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Every new drift surface must declare whether it is agent-owned or shared and carry the caller's agent filter into agent-owned scans.
**Trigger phase:** SCOPE
**Caught at:** ACT

**Prevention:** Declare whether each new drift surface is agent-owned or shared. Apply `agentFilter` to agent-owned files, keep shared framework assets global, and prove both with a single-agent consumer fixture.

**Symptoms:** On 2026-07-12, `audit --agent codex --check-drift` against a Codex-only consumer still compared Claude and Copilot hook registrations, producing phantom missing files for agents the consumer never installed.

**Why it happens:** Agent selection is easy to preserve in the top-level audit and lose inside a nested helper; any helper that rebuilds the manifest-owned agent inventory silently widens a selected-agent audit.

**Evidence:** `src/cli/audit/audit.ts` (search: `agentFilter: ctx.agentFilter`) passes the selection into drift; `src/cli/audit/check-drift.ts` (search: `selectedInstalledSkillRoots`) filters agent-owned skills, orphan scans, and hook registrations while leaving shared references global; `test/integration/audit-drift-checkdrift-hook-templates.test.ts` (search: `limits hook drift to the selected agent`) reproduces the Codex-only consumer.

---

## Footgun: Version checks that test inequality without direction prescribe a downgrade

**Status:** active | **Created:** 2026-08-03 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Any version comparison that drives user-facing remediation or a file write must branch on direction, not on `!==`.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 2 | **Latest occurrence:** 2026-08-03
**hallucination-risk:** high

**Prevention:** Never drive remediation or a write from version inequality alone. Compare direction first; when the local tool is older, say so and stop rather than proposing to bring the target back to the tool's version. Put skew guards at the write boundary too, not only in the message.

**Symptoms:** A globally installed `goat-flow` v1.14.0 audited a v1.15.0 checkout and returned `"overall": {"status": "fail"}` with `Config version 1.15.0 does not match current 1.14.0`, told the user to run `hooks sync` from the older release for a `goat-flow-hook-version 1.15.0` hook, and produced roughly 45 further drift findings that were artifacts of the version gap.

**Why it happens:** `AUDIT_VERSION` is the running CLI's own version, so an older CLI treats itself as the reference; `version !== AUDIT_VERSION` cannot tell "behind" from "ahead", and the template comparison diffs the target against the older bundle. Following that advice is not advisory: `src/cli/server/hook-registrar.ts` (search: `export function syncHookStates`) rewrites installed hook files from the running CLI's bundle, a silent downgrade of the guardrail layer.

**Evidence:** `src/cli/version-compare.ts` (search: `projectIsAheadOfCli`) is the shared direction test; `src/cli/audit/check-goat-flow.ts` (search: `is newer than this CLI`) branches before prescribing remediation; `src/cli/audit/check-agent-common.ts` (search: `targetUsesNewerGoatFlow`) suppresses older-template skill, guardrail, drift, and content checks; `src/cli/server/hook-managed-installation.ts` (search: `Refusing to overwrite`) makes `copyHookScripts` throw rather than downgrade a newer-stamped hook. Tests: `test/unit/version-compare.test.ts` (search: `flags the CLI as the stale side when the project is newer`), `test/integration/audit-quality.test.ts` (search: `reports version skew without older-template agent or drift findings`), `test/unit/hook-registrar.test.ts` (search: `refuses to overwrite a hook stamped newer than the running CLI`).

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

## Footgun: Audit howToFix emits commands the deny hook blocks

**Status:** resolved | **Created:** 2026-04-15 | **Resolved:** 2026-04-16 | **Evidence:** ACTUAL_MEASURED

**Resolution:** `src/cli/audit/check-agent-setup.ts` (search: `Remove the deprecated`) emits text guidance ("Delete the SKILL.md inside each, then remove the empty directory") instead of `rm -rf ${path}`, which the deny hook blocked when users followed the audit's own fix suggestions.

---

## Footgun: Harness verifies post-turn hooks but not PreToolUse deny registration

**Status:** resolved | **Created:** 2026-04-15 | **Resolved:** 2026-04-16 | **Evidence:** ACTUAL_MEASURED

**Resolution:** `src/cli/audit/harness/check-constraints.ts` (search: `deny-hook-registered`) verifies PreToolUse deny registration via `af.hooks.denyIsRegistered` (commit 708b1af); the `check-verification.ts` hooks-registered check stays scoped to post-turn hooks. A project could previously pass the harness audit with no deny hook wired to PreToolUse.

---

## Footgun: Audit checks existed with no machine-readable justification

**Status:** resolved | **Created:** 2026-04-18 | **Resolved:** 2026-04-18 | **Evidence:** ACTUAL_MEASURED

**Resolution:** M05 defined the `CheckEvidence` schema and M11 back-filled it onto all 33 then-live checks. `BuildCheck` and `HarnessCheck` require `provenance`, `runAudit()` validates every record via `validateProvenance()`, per-check JSON carries the object, and CONTRIBUTING requires new checks to ship provenance.
