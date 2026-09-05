---
category: hooks
last_reviewed: 2026-09-05
---

**Scope:** Hook runtime delivery, provider result adapters, policy-module execution, and performance. Scanner blind spots live in [hook-scanning.md](hook-scanning.md); install, launch, registration, and config-drift plumbing in [hook-installation.md](hook-installation.md); the `deny-dangerous` policy parser in [deny-shell.md](deny-shell.md), [deny-secrets.md](deny-secrets.md), and [deny-writes.md](deny-writes.md).

## Footgun: Codex config preservation can leave old permission profiles behind

**Status:** active | **Created:** 2026-05-21 | **Evidence:** ACTUAL_MEASURED

**Prevention:** After a Codex upgrade, run `goat-flow audit . --agent codex --harness`, not only the default setup audit. If settings were preserved, compare `.codex/config.toml` with `workflow/hooks/agent-config/codex.toml`, add the permission profile plus exact denies for sensitive root files present in the checkout, and report hook registration (`.codex/hooks.json`) and the filesystem deny profile (`.codex/config.toml`) as separate surfaces in the installer and setup prompt.

**Symptoms:** A normal `goat-flow install . --agent codex` upgrade refreshes skills and hook scripts but preserves a `.codex/config.toml` that predates the permission-profile template, so setup and agent checks pass while `audit --harness` still reports incomplete direct literal secret-path blocking. The setup prompt shows "0 audit checks failed" unless the audit runs in harness mode.

**Why it happens:** The installer skips existing settings to avoid clobbering local config, and for Codex `.codex/config.toml` is both a settings file and the provider-native filesystem deny surface, so preserving it never migrates `default_permissions = "goat-flow"` or `[permissions.goat-flow.filesystem]`.

**Evidence:** `workflow/install-goat-flow.sh` (search: `Settings file was preserved`) preserves existing settings even under `--force`; `workflow/hooks/agent-config/codex.toml` (search: `default_permissions = "goat-flow"`) carries the required profile; `src/cli/audit/harness/check-constraints.ts` (search: `direct literal secret-path blocking incomplete`) detects the gap. A 2026-05-21 downstream upgrade failed Constraints until exact root env files were added beside the template profile.

---

## Footgun: Registered Stop hooks can be dead config behind agent trust gates

**Status:** active | **Created:** 2026-06-13 | **Evidence:** ACTUAL_MEASURED
**Incident count:** 2 | **Latest occurrence:** 2026-08-10
**Decision changed:** Treat project-layer trust, hook-handler trust, and live model delivery as separate gates before enabling a registration.
**Trigger phase:** VERIFY

**Prevention:** Treat hook registration facts as config evidence only. Before claiming an agent runs a Stop hook, capture a live payload or hook-side log write from that exact provider version, mode, config source, and trust state, and expire the record after 30 days or any relevant provider, hook, adapter, mode, source, or trust change. Gate default registration on verified delivery, not documented support, and keep the gate consistent across every Stop hook for that agent. Gating one Stop hook for one agent is a lock-step edit: `workflow/manifest.json` `hook_events.post_turn` to `null`, which flips `supportsPostTurnHook` in `src/cli/agents/registry.ts` (search: `supportsPostTurnHook`) so `check-verification.ts` skips the agent instead of penalising it; `hooks-registry.ts` `unsupportedAgents`; the generated `.agents/hooks.json` via `goat-flow hooks sync`, never hand-edited; plus the README hook table, CHANGELOG, `docs/dashboard.md`, and the `hook-registrar` tests.

**Symptoms:** Writing a Stop entry into `.codex/hooks.json` or `.agents/hooks.json` does not mean the agent executes it. On 2026-06-13, with Stop hooks registered for all three agents, Claude fired and delivered the full payload; Codex (codex-cli 0.139.0, `features` reporting `hooks stable true`, docs listing `Stop`) never executed the hook across four `codex exec` runs even with `--dangerously-bypass-hook-trust`, project trust, and a project config layer; Antigravity (agy 1.0.6) logged `Loaded hooks.json ... 1 total handlers` and `JSON hook "jsonhook__stop-capture_Stop_0_0": executing command`, but execution waited on `~/.gemini/trusted_hooks.json` review (`toolPermission=request-review`) and print mode exited first.

**Why it happens:** Documented support, trust state, and live delivery change independently. By 2026-08-09 Codex and Antigravity documented `PostToolUse` and `Stop` and Copilot documented `postToolUse` and `agentStop`, which made the earlier capture stale evidence rather than proof that delivery works. **Recurrence 2026-08-10 on Codex CLI 0.147.0:** ignoring user configuration also removed the project trust record, so the project hook layer stayed inactive even with handler review bypassed; a session-only whole-table project trust override activated it and PostToolUse and Stop then delivered in exec and interactive modes, while the provider-owned timeout stayed silent, so Goat Flow must finish first and return its own unavailable response.

**Evidence:** `src/cli/server/hooks-registry.ts` (search: `hook-provider-adapter.v1:codex:turn-stop`) is the time-bounded Codex Stop evidence gate; `src/cli/hook-contracts.ts` (search: `assessHookProviderEvidence`) keeps official documentation, dated live capture, trust, and result delivery as separate states; `workflow/hooks/hook-launch-runtime.mjs` (search: `prepareProviderLauncherUnavailableDelivery`) and `test/integration/hook-consumer-canary.test.ts` (search: `writeObservedCodexFeedbackConfig`) cover the 2026-08-10 shape. ADR-037 (search: `tombstone only`) removes the plan checkbox guard from shipped hooks. `post-turn-safety` was held to the same standard on 2026-06-14, when Antigravity joined Codex in its `unsupportedAgents`; a default-on secret scanner whose Stop event may never fire is false assurance because the dashboard still reports it installed. Provider contracts: [Codex hooks](https://developers.openai.com/codex/hooks), [Antigravity hooks](https://www.antigravity.google/docs/hooks), [GitHub Copilot hooks](https://docs.github.com/en/copilot/reference/hooks-reference).

## Footgun: Launcher-owned failures can bypass provider feedback adapters

**Status:** active | **Created:** 2026-08-10 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Exercise launcher-owned timeout and invalid-output branches through source and packed consumers before registering model-visible feedback.
**Trigger phase:** VERIFY
**Incident count:** 1 | **Latest occurrence:** 2026-08-10

**Prevention:** Route every launcher-owned failure through the neutral unavailable envelope and provider adapter, and keep source and npm-archive canaries that stall the child inside the managed deadline and require non-empty model context. Anchors: `workflow/hooks/run-with-bash.mjs` (search: `reportLauncherUnavailable`), `workflow/hooks/hook-launch-runtime.mjs` (search: `prepareProviderLauncherUnavailableDelivery`), `test/integration/hook-consumer-canary.test.ts` (search: `Empty stdout would reproduce the silent provider timeout`), `test/integration/packaged-hook-install.test.ts` (search: `Empty packed stdout would mean source proof hid a release artifact failure`).

**Symptoms:** A migrated child result used the provider adapter, but the timeout and adapter-failure branches returned through the legacy unavailable reporter, so the terminal showed human stderr while Codex received empty stdout and a stopped analyzer looked silent to the model.

## Footgun: Bash SECONDS can inherit a parent offset and invalidate hook result timing

**Status:** active | **Created:** 2026-09-02 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Establish a hook-owned timing origin before using Bash `SECONDS` for budgets or provider result metadata.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 1 | **Latest occurrence:** 2026-09-02

**Prevention:** Reset or baseline `SECONDS` at the hook process boundary, test an inherited negative value through the real Bash producer and provider-result decoder, and keep the canonical and installed hook copies byte-identical. Anchors: `workflow/hooks/post-turn-safety.sh` (search: `start hook budgets and result timing at this process boundary`), `workflow/hooks/hook-provider-adapters.mjs` (search: `execution duration must be a non-negative integer`), `test/integration/hook-provider-contracts.test.ts` (search: `owns elapsed timing before emitting a managed Stop result`).

**Symptoms:** On 2026-09-02 Codex received `post-turn-safety: UNAVAILABLE` with `adapter-delivery-failed` after the safety scan emitted invalid execution metadata. Replaying the installed launcher with `SECONDS=-1` reproduced it, and removing the inherited value returned the expected result.

**Why it happens:** Bash accepts `SECONDS` from the parent environment. The hook multiplied it directly into `durationMs`, so a negative parent offset became a negative integer the adapter correctly rejected, and a positive offset would have stayed schema-valid while overstating elapsed time and consuming the scan budget.

## Footgun: An aggregating hook must re-derive every terminal decision it aggregates

**Status:** active | **Created:** 2026-08-16 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Prove every aggregate exit path on a legacy host as well as through the provider envelope whenever a hook fans out to child runs of itself.
**Trigger phase:** VERIFY
**Incident count:** 1 | **Latest occurrence:** 2026-08-16

**Prevention:** A child result that ends a bounded cycle is a release decision, not a finding. Aggregation may summarise findings, but it re-derives every terminal decision the single-unit path owns, release, block, and fail-closed, for each host contract the hook ships under, and a status the aggregator never produces itself (a crash or a kill) must not reach the provider as a non-blocking result. Anchors: `workflow/hooks/post-turn-safety.sh` (search: `bounded-reentry-ended`), `workflow/hooks/run-with-bash.mjs` (search: `LEGACY_HOOK_DEADLINES_MS`), `workflow/hooks/hook-provider-adapters.mjs` (search: `adaptStopResult`), `test/integration/post-turn-safety-controller.test.ts` (search: `ends an exhausted child re-entry on a legacy host`).

**Symptoms:** A single-project repository went block, release, block, while the identical controller workspace went block, block, block, block, measured 2026-08-16.

**Why it happens:** The non-Git controller fan-out in `post-turn-safety.sh` computed `bounded-reentry-ended` correctly, but only the migrated branch acted on it. The provider adapter turns that reason into a clean stop while the legacy branch fell through to a blocking exit, and Claude registers its Stop hook with response mode `post-turn`, which the launcher classifies as legacy, so a controller whose children hit an unchanged infrastructure failure could never end the turn.

## Footgun: Per-item subprocess spawning in hooks is ~40x more expensive on Windows Git Bash

**Status:** active | **Created:** 2026-08-01 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Whether a hook may call out to `sed`/`tr`/`awk`/`grep`/`git` once per line, per key, or per file - on Windows that design cannot meet any realistic hook timeout, so batch or use bash builtins instead.
**Trigger phase:** SCOPE
**Caught at:** ACT

**Prevention:**
1. Keep per-line and per-key hook work in bash builtins: `${var,,}` instead of `tr`, `${var##+([[:space:]])}` instead of a trim `sed`, `[[ =~ ]]` capture instead of `sed -nE 's/.../\1/p'`, and return through a global rather than `$(...)` so the call does not fork.
2. Batch git plumbing: one `git diff --unified=0 -- <paths>` with `+++ b/<path>` header attribution replaces one diff per file, `git cat-file --batch-check` replaces per-path `cat-file -s`, and `wc -c` and `grep -Il` accept many paths per call, chunked at about 64 paths for the Windows command-line limit.
3. Put a cheap superset pre-filter in front of expensive per-line analysis and document why each pattern is a provable superset so the filter cannot silently narrow detection.
4. Benchmark hooks on Windows Git Bash, not only Linux, and give any bounded-time hook its own wall-clock budget that reports an explicit incomplete-scan message with a non-zero exit under a runner timeout above that budget, so silent truncation is unreachable.

**Symptoms:** A hook that is fast on Linux is unusable on Windows Git Bash, with `sys` time near half of wall clock and Claude Code parked on `running stop hook · 4m 40s`. Because the runner kills a hook past its timeout, a scan that cannot finish reports nothing and is indistinguishable from a clean pass.

**Why it happens:** MSYS2 and Cygwin have no `fork()`; process creation is emulated, so every subshell or external command costs orders of magnitude more than on Linux, and `$(...)` counts even with no external binary. This does not generalise: removing forks from `deny-dangerous.sh` the same day made it slower, as the next entry records.

**Evidence:** Measured 2026-08-01 on Windows 11 Pro 10.0.26200, Git Bash bash 5.3.15, NTFS: one forked pipeline costs about 44ms (200 pipelines = 8.852s) while 20,000 pure-bash loop iterations cost 0.151s, so one fork is worth roughly 2,900 bash operations. On the same workload (25 changed, 22 staged, 375 added lines across 10 env-assignment files, zero findings) the per-line `post-turn-safety.sh` ran 4m22.109s on Windows and 6.465s on Linux WSL2; the batched rewrite runs 0.655s and 0.027s. The pre-fix hot path spawned two `sed` per scanned line plus per-call helpers and one `git diff` per changed path. Current anchors: `workflow/hooks/post-turn-safety.sh` (search: `run_diff_batch`), (search: `gate_scannable_files`), and (search: `scan_content_files`).

## Footgun: Policy modules must share one prepared command context

**Status:** active | **Created:** 2026-08-01 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Whether each PreToolUse policy module may prepare its own segment context - it may not; preparation belongs to the dispatcher and adding a policy must not multiply parsing work.
**Trigger phase:** SCOPE
**Caught at:** ACT

**Prevention:**
1. Prepare segment context once in `check_segment`; policy modules consume the shared `CMD_*` and `HAS_*` values and never call `prepare_segment_context` themselves.
2. Measure with an interleaved A/B, alternating old and new per round. A sequential run pays cold filesystem and git cache costs first, which produced a false 2x "improvement" for a build that was actually 2x slower, and a `$( )` count does not predict wall clock.
3. This is security-critical parsing: any restructuring needs `--self-test=full` green plus a byte-exact verdict corpus before and after, per `.goat-flow/skill-docs/playbooks/hook-policy-testing.md`.

**Symptoms:** Every Bash tool call carries a visible pause that scales with command complexity and the number of policy modules, and a `bash -x` trace shows more than one `prepare_segment_context` call for a simple command.

**Why it happens:** When policy checks independently call `prepare_segment_context`, the shared tokenisers (`split_shell_words_into`, `normalize_command_candidate`, `normalize_leading_command_word`) walk the same command once per policy. The dominant term is not established: converting the hot tokenisers to fork-free `_into` forms plus memoization made the hook slower, 272 to 392ms simple and 309 to 729ms pipeline, while executing about 3.3x more traced operations with identical verdicts, and was reverted without the cause being identified. Do not repeat that attempt without new evidence.

**Evidence:** 2026-08-01, Windows 11 Git Bash, interleaved A/B, 30 invocations per cell: 272ms per call for `--check='npm run typecheck'`, 309ms for a four-stage pipeline, 652ms for the JSON-stdin path, against about 50ms for a bare `bash empty.sh`; only 6 external processes per invocation against about 1,959 traced bash operations for a simple command. 2026-08-04 Linux interleaved A/B: hoisting preparation from three policy calls to one moved the simple-command median from 39.08ms to 30.99ms and the pipeline median from 102.62ms to 93.12ms, with a 15-case byte-exact verdict comparison at 0 mismatches and both corpora at 327/327. Anchor: `workflow/hooks/deny-dangerous.sh` (search: `Parse once per segment`).

## Footgun: Copilot combines native and Claude project hook registrations

**Status:** active | **Created:** 2026-08-23 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Treat repository `.claude/settings.json` as a Copilot hook source too; keep real Copilot policy only in its native config, give managed Claude rows explicit inert shell routes, and make descriptor readers prefer structured exec operands over those routes.
**Trigger phase:** SCOPE
**Caught at:** VERIFY
**Incident count:** 3 | **Latest occurrence:** 2026-08-26

**Prevention:** Before changing a lifecycle shared by Claude and Copilot, test a mixed-source fixture with both real registration shapes and the exact current providers. Preserve all four Claude identity fields, `command`, ordered `args`, `bash`, and `powershell`, through writer, generated contract, installer, audit, and replay. Descriptor readers select structured exec operands before inert cross-provider shell routes. Audit and runtime proof read the selected provider's native config path; a Claude no-op never counts as Copilot protection. Configured replay proves only local execution; renew live delivery separately and do not extend it to Copilot cloud behaviour or the documented-but-uncaptured Windows route.

**Symptoms:** On 2026-08-23 an isolated session-start fixture registered one command in `.github/hooks/` and one in `.claude/settings.json`, and GitHub Copilot CLI 1.0.80 invoked both for one session, the native entry with camelCase fields and the Claude-compatible entry with PascalCase-event snake_case fields, 32 ms apart with the same session fingerprint. A runner expecting one marker correctly stopped instead of claiming delivery.

**Why it happens:** GitHub's [hook-locations contract](https://docs.github.com/en/copilot/reference/hooks-reference#hooks-locations) says Copilot combines repository `.github/hooks/*.json` with the inline `hooks` block in `.claude/settings.json`, and Goat Flow owns both surfaces: `workflow/manifest.json` (search: `"hook_config_file": ".claude/settings.json"`) and (search: `"hook_config_file": ".github/hooks/hooks.json"`). A hook added to both can run twice under Copilot, and a hook added only to Claude can still run under Copilot and bypass a manifest claim that Copilot is unsupported.

**Evidence:** **Recurrence 2026-08-25:** Copilot selected `command: "node"` from the structured Claude row without its `args`, so a safe `pwd` failed before policy startup with a Node syntax error. The accepted descriptor keeps Claude's `command` plus `args` and adds `bash: "exit 0"` and `powershell: "exit 0"`, making the cross-loaded copy inert while `.github/hooks/hooks.json` stays the sole managed Copilot policy source: `src/cli/server/agent-hook-command.ts` (search: `bash: "exit 0"`), `src/cli/server/agent-hook-writer.ts` (search: `handlerDescriptor.bash`), `test/unit/hooks-runtime-evidence.test.ts` (search: `requires Copilot native registration`). **Recurrence 2026-08-26:** the generic hook fact reader returned the top-level `bash: "exit 0"` before the structured `command` plus `args`, so the full harness audit reported both managed Claude hooks unregistered; `src/cli/facts/agent/hook-registration.ts` (search: `function readHookCommand`) now selects exec operands first, pinned by `test/unit/audit-command/hook-facts.test.ts` (search: `reads managed Claude exec operands before inert shell routes`).

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

## Footgun: Rejecting invalid hook configuration instead of clamping it wedges every tool call

**Status:** resolved | **Created:** 2026-08-11 | **Resolved:** 2026-08-18 | **Evidence:** ACTUAL_MEASURED

**Resolution:** `workflow/hooks/hook-launch-runtime.mjs` (search: `resolveHookLaunchTimeoutMs`) treats an empty `GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS` as unset and clamps oversized values; only inputs that cannot bound a wait (`0` or non-decimal text) are rejected, and `workflow/hooks/run-with-bash.mjs` (search: `describeInvalidHookLaunchTimeout`) names the variable, supplied value, and valid range. `test/unit/hook-launcher.test.ts` (search: `without blocking the command`) covers empty input and (search: `clamps values above the`) covers oversized input.

**Original symptoms:** Empty or over-ceiling values made both policy and Stop hooks fail closed with an unhelpful configuration error, blocking commands and turn completion, because the resolver treated an exported empty string as malformed and every rejection became the same unavailable result.

**Prevention retained:** For each hook configuration validator, probe unset, empty, over-ceiling, zero, and malformed input through every hook class, and assert caller exit status and delivered message, not only the resolver return value.

---

- **git diff --stat unreliable for scope detection** (resolved 2026-04-03) - auto-detect uses staged, then unstaged, then full diff.
- **Advisory hooks create unfixable quality warning after setup** (resolved 2026-04-14) - hooks shipped enforce-mode by default; the `GOAT_LINT_ENFORCE` variable named at the time has since been removed.
- **Codex hooks registered in config.toml instead of hooks.json** (resolved 2026-04-15) - moved to `.codex/hooks.json`; TOML hook sections were silently ignored.
- **Codex hook migrations drift across files, templates, installer, docs** (resolved 2026-04-15) - restored Codex guardrail registration and aligned all four surfaces.

## Footgun: Optional hook migration must remove old registrations and re-add enabled central entries

**Status:** resolved | **Created:** 2026-06-07 | **Resolved:** 2026-07-17 | **Evidence:** OBSERVED

**Resolution:** The migration removes managed legacy Gruff registrations before pruning per-agent scripts and rebuilds only provider-supported, enabled central entries. `test/integration/setup-install-codex-config-migration.test.ts` (search: `migrates legacy Codex Gruff registration to the approved provider contract`) verifies an old Codex command becomes the approved central contract while a custom user event survives, and `test/unit/hook-registrar-surfaces.test.ts` (search: `keeps gruff-code-quality unregistered for Antigravity without result delivery`) verifies an enabled desired state does not restore a registration whose feedback cannot reach the model.

**Original symptoms:** The installer copied new central hook scripts and pruned legacy per-agent files while leaving an agent hook config pointing at the deleted legacy `gruff-code-quality.sh`, visible only after upgrade because fresh installs used the new shape and disabled optional hooks hid the stale entry. `workflow/install-goat-flow.sh` treated only deny-dangerous and the old split guardrails as managed during migration.

**Anchors:** `scripts/generate-managed-hook-desired-state.mjs` (search: `commandScriptNames`) publishes each hook's current and legacy ownership tokens; `workflow/install-goat-flow.sh` (search: `appendSharedHookFragment`) re-adds enabled generated fragments and (search: `configuredHookEnabled`) reads the existing toggle so enabled optional hooks survive upgrades while disabled hooks stay absent.

**Prevention retained:** Add every future optional hook to the managed removal list before legacy files are pruned, rebuild registrations from current registry and config state, preserve desired toggles for unsupported providers, and add upgrade fixtures whenever install paths or delivery support changes.
