---
category: hooks
last_reviewed: 2026-09-02
---

**Scope:** Hook runtime delivery, provider result adapters, policy-module execution, and performance. What a scanner can actually see - changed-file enumeration, diff/rename detection, gitignore and gitattribute blind spots - lives in [hook-scanning.md](hook-scanning.md). Install / launch / registration / config-drift plumbing lives in [hook-installation.md](hook-installation.md). The `deny-dangerous` shell-grammar policy parser lives in [deny-shell.md](deny-shell.md), [deny-secrets.md](deny-secrets.md), and [deny-writes.md](deny-writes.md).

## Footgun: Codex config preservation can leave old permission profiles behind

**Status:** active | **Created:** 2026-05-21 | **Evidence:** ACTUAL_MEASURED

**Prevention:**
1. After Codex upgrades, run `goat-flow audit . --agent codex --harness`, not just the default setup audit.
2. If Codex settings were preserved, compare `.codex/config.toml` with `workflow/hooks/agent-config/codex.toml` and add the permission profile plus exact denies only for sensitive root files present in the checkout.
3. When settings are preserved, report hook registration (`.codex/hooks.json`) and filesystem deny profile (`.codex/config.toml`) as separate surfaces in the installer and setup prompt.

**Symptoms:** A normal `goat-flow install . --agent codex` upgrade refreshes skills and hook scripts but preserves an existing `.codex/config.toml`. If that file predates the permission-profile template, setup and agent checks pass while `audit --harness` still reports incomplete direct literal secret-path blocking for Codex - the setup prompt shows "0 audit checks failed" unless the audit runs in harness mode.

**Why it happens:** The installer skips existing settings to avoid clobbering local config. For Codex, `.codex/config.toml` is both a settings file and the provider-native filesystem deny surface (hook registration lives separately in `.codex/hooks.json`). Preserving it is safe for local customizations but doesn't migrate `default_permissions = "goat-flow"` or `[permissions.goat-flow.filesystem]`.

**Evidence:**
- `workflow/install-goat-flow.sh` (search: `Settings file was preserved`) - existing settings remain preserved under `--force`; `workflow/hooks/agent-config/codex.toml` (search: `default_permissions = "goat-flow"`) - the 1.7.0 template carries the required permission-profile surface.
- `src/cli/audit/harness/check-constraints.ts` (search: `direct literal secret-path blocking incomplete`) - harness detects the missing combined file-read and Bash-hook coverage.
- 2026-05-21 downstream upgrade: after normal Codex install, `audit --agent codex --harness` failed Constraints until exact existing root env files were added to `.codex/config.toml` alongside the template profile.

---

## Footgun: Registered Stop hooks can be dead config behind agent trust gates

**Status:** active | **Created:** 2026-06-13 | **Evidence:** ACTUAL_MEASURED
**Incident count:** 2 | **Latest occurrence:** 2026-08-10
**Decision changed:** Treat project-layer trust, hook-handler trust, and live model delivery as separate gates before enabling a registration.
**Trigger phase:** VERIFY

**Prevention:** Treat hook registration facts as config evidence only. Before claiming an agent runs a Stop hook, capture a live payload or hook-side log write from that exact provider version, mode, config source, and trust state. Expire the record after 30 days or any relevant provider, hook, adapter, mode, source, or trust change. Gate default registration on verified delivery, not documented support, and keep the gate consistent across every Stop hook for that agent. Gating one Stop hook for one agent is a lock-step edit: `workflow/manifest.json` `hook_events.post_turn` -> `null` (which flips `supportsPostTurnHook` in `src/cli/agents/registry.ts` (search: `supportsPostTurnHook`) so `check-verification.ts` *skips* the agent instead of penalising it), `hooks-registry.ts` `unsupportedAgents`, the generated `.agents/hooks.json` (regenerate via `goat-flow hooks sync`, never hand-edit the escaped launcher JSON), plus the README hook table / CHANGELOG / `docs/dashboard.md` and the `hook-registrar` tests.

**Trap:** Writing a Stop entry into `.codex/hooks.json` or `.agents/hooks.json` does not mean the agent will ever execute it. On 2026-06-13, a capture fixture with Stop hooks registered for all three agents showed: Claude fired and delivered the full payload; Codex (codex-cli 0.139.0, `features` reports `hooks stable true`, docs document the `Stop` event) never executed the hook across four `codex exec` runs even with `--dangerously-bypass-hook-trust`, project trust, and a project config layer; Antigravity (agy 1.0.6) logged `Loaded hooks.json ... 1 total handlers` and `JSON hook "jsonhook__stop-capture_Stop_0_0": executing command` but the command never ran because execution waits on `~/.gemini/trusted_hooks.json` review (`toolPermission=request-review`) and print mode exits first.

Current primary documentation changed again by 2026-08-09: Codex and Antigravity now document `PostToolUse` and `Stop`, while Copilot documents `postToolUse` and `agentStop`. That makes the earlier live capture stale evidence, not proof that current delivery now works. The documented state and the captured state must change independently.

Recurrence on 2026-08-10: Codex CLI 0.147.0 repeated the trust distinction. Ignoring user configuration also removed the project trust record, so the project hook layer stayed inactive even when handler review was bypassed. A session-only whole-table project trust override activated the project layer; PostToolUse and Stop then delivered in both exec and interactive modes. The provider-owned timeout remained silent, so Goat Flow must finish first and return its own unavailable response. Evidence anchors: `src/cli/hook-contracts.ts` (search: `assessHookProviderEvidence`), `workflow/hooks/hook-launch-runtime.mjs` (search: `prepareProviderLauncherUnavailableDelivery`), and `test/integration/hook-consumer-canary.test.ts` (search: `writeObservedCodexFeedbackConfig`).

**Evidence:**
- `src/cli/server/hooks-registry.ts` (search: `hook-provider-adapter.v1:codex:turn-stop`) identifies the current time-bounded Codex Stop evidence gate; the recurrence above retains the historical failed capture.
- `src/cli/hook-contracts.ts` (search: `assessHookProviderEvidence`) keeps official documentation, dated live capture, trust, and result delivery as separate states.
- Current provider contracts: [Codex hooks](https://developers.openai.com/codex/hooks), [Antigravity hooks](https://www.antigravity.google/docs/hooks), and [GitHub Copilot hooks](https://docs.github.com/en/copilot/reference/hooks-reference).
- ADR-037 (search: `tombstone only`) removes the plan checkbox guard from current shipped hooks and keeps only a tombstone cleanup path.
- `post-turn-safety` was held to the same standard on 2026-06-14: `antigravity` was added to its `unsupportedAgents` (codex was already gated), so goat-flow does not ship a default-on Stop hook to an agent whose delivery is unverified. A default-on *secret scanner* whose Stop event may never fire is false assurance - arguably worse than shipping nothing, because the dashboard still reports it "installed."

## Footgun: Launcher-owned failures can bypass provider feedback adapters

**Status:** active | **Created:** 2026-08-10 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Exercise launcher-owned timeout and invalid-output branches through source and packed consumers before registering model-visible feedback.
**Trigger phase:** VERIFY
**Incident count:** 1 | **Latest occurrence:** 2026-08-10

**Prevention:** Route every migrated launcher-owned failure through the neutral unavailable envelope and provider adapter. Keep source and npm-archive canaries that stall the child inside the managed deadline and require non-empty model context. Evidence anchors: `workflow/hooks/run-with-bash.mjs` (search: `reportLauncherUnavailable`), `workflow/hooks/hook-launch-runtime.mjs` (search: `prepareProviderLauncherUnavailableDelivery`), `test/integration/hook-consumer-canary.test.ts` (search: `Empty stdout would reproduce the silent provider timeout`), and `test/integration/packaged-hook-install.test.ts` (search: `Empty packed stdout would mean source proof hid a release artifact failure`).

A migrated child result used the provider adapter, but timeout and adapter-failure branches returned through the legacy unavailable reporter. The terminal showed human stderr while Codex received empty stdout, so a stopped analyzer looked silent to the active model.

## Footgun: Bash SECONDS can inherit a parent offset and invalidate hook result timing

**Status:** active | **Created:** 2026-09-02 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Establish a hook-owned timing origin before using Bash `SECONDS` for budgets or provider result metadata.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 1 | **Latest occurrence:** 2026-09-02

**Prevention:** Reset or baseline `SECONDS` at the hook process boundary, then test an inherited negative value through the real Bash producer and provider-result decoder. Keep the canonical and installed hook copies byte-identical. Evidence anchors: `workflow/hooks/post-turn-safety.sh` (search: `start hook budgets and result timing at this process boundary`), `workflow/hooks/hook-provider-adapters.mjs` (search: `execution duration must be a non-negative integer`), and `test/integration/hook-provider-contracts.test.ts` (search: `owns elapsed timing before emitting a managed Stop result`).

**Symptoms:** On 2026-09-02, Codex received `post-turn-safety: UNAVAILABLE` with `adapter-delivery-failed` after the safety scan emitted invalid execution metadata. Replaying the installed launcher with `SECONDS=-1` produced the same response; removing that inherited value returned the expected provider result.

**Why it happens:** Bash accepts `SECONDS` from the parent environment. The hook multiplied that value directly for `durationMs`, so a negative parent offset became a negative integer that the provider adapter correctly rejected. A positive inherited offset would remain schema-valid while overstating elapsed time and consuming the scan budget before the hook owned it.

## Footgun: An aggregating hook must re-derive every terminal decision it aggregates

**Status:** active | **Created:** 2026-08-16 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Prove every aggregate exit path on a legacy host as well as through the provider envelope whenever a hook fans out to child runs of itself.
**Trigger phase:** VERIFY
**Incident count:** 1 | **Latest occurrence:** 2026-08-16

**Prevention:** A child result that ends a bounded cycle is a release decision, not a finding. Aggregation may summarise findings, but it must re-derive every terminal decision the single-unit path owns - release, block, and fail-closed - for each host contract the hook actually ships under. Check the same way whenever an aggregate returns a child status verbatim: a status the aggregator never produces itself (a crash or a kill) must not reach the provider as a non-blocking result. Evidence anchors: `workflow/hooks/post-turn-safety.sh` (search: `bounded-reentry-ended`), `workflow/hooks/run-with-bash.mjs` (search: `LEGACY_HOOK_DEADLINES_MS`), `workflow/hooks/hook-provider-adapters.mjs` (search: `adaptStopResult`), and `test/integration/post-turn-safety-controller.test.ts` (search: `ends an exhausted child re-entry on a legacy host`).

The non-Git controller fan-out in `post-turn-safety.sh` collected child envelopes and computed `bounded-reentry-ended` correctly, but only the migrated branch acted on it. The provider adapter turns that reason code into a clean stop, while the legacy branch fell through to a blocking exit. Claude registers its Stop hook with response mode `post-turn`, which the launcher classifies as legacy, so a controller workspace whose children hit an unchanged infrastructure failure could never end the turn. Measured on 2026-08-16: a single-project repository went block, release, block; the identical controller went block, block, block, block.

## Footgun: Per-item subprocess spawning in hooks is ~40x more expensive on Windows Git Bash

**Status:** active | **Created:** 2026-08-01 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Whether a hook may call out to `sed`/`tr`/`awk`/`grep`/`git` once per line, per key, or per file - on Windows that design cannot meet any realistic hook timeout, so batch or use bash builtins instead.
**Trigger phase:** SCOPE
**Caught at:** ACT

**Prevention:**
1. In hook code, keep per-line and per-key work in bash builtins: `${var,,}` instead of `tr`, `${var##+([[:space:]])}` instead of a trim `sed`, `[[ =~ ]]` capture instead of `sed -nE 's/.../\1/p'`. Return through a global rather than `$(...)` so the call does not fork.
2. Batch git plumbing. One `git diff --unified=0 -- <paths>` with `+++ b/<path>` header attribution replaces one diff per file; `git cat-file --batch-check` replaces per-path `cat-file -s`; `wc -c` and `grep -Il` accept many paths per call. Chunk argument lists (~64 paths) to stay under the Windows command-line limit.
3. Put a cheap superset pre-filter in front of expensive per-line analysis, and document why each pattern is a provable superset of the real triggers so the filter cannot silently narrow detection.
4. Benchmark hooks on Windows Git Bash, not only Linux. A Linux-only benchmark hides this entire class of defect.
5. Give any bounded-time hook its own wall-clock budget that reports an explicit incomplete-scan message and a non-zero exit, and register a runner timeout above that budget. Silent truncation by the harness must not be reachable.

**Symptoms:** A hook is comfortably fast on Linux and unusably slow on Windows Git Bash, with `sys` time near half of wall clock. Claude Code shows the turn parked on `running stop hook · 4m 40s`. Because the runner kills a hook that exceeds its registered timeout, a scan that cannot finish reports nothing and is indistinguishable from a clean pass - the correctness failure is worse than the latency.

**Why it happens:** MSYS2/Cygwin has no `fork()`; it emulates process creation, so every subshell or external command costs orders of magnitude more than on Linux. A design that spawns per line looks linear during Linux development and becomes fork-bound on Windows. `$(...)` counts even with no external binary, because the subshell itself is the expensive part.

**Evidence:**
- 2026-08-01 measured on Windows 11 Pro 10.0.26200, Git Bash bash 5.3.15 (x86_64-pc-cygwin), NTFS: one forked pipeline costs ~44ms (200 pipelines = 8.852s) while 20,000 pure-bash loop iterations cost 0.151s (~7.5us each). One fork is worth roughly 2,900 bash operations.
- Same-workload comparison of `post-turn-safety.sh` (25 changed / 22 staged / 375 added lines across 10 env-assignment files, zero findings, exit 0): the pre-fix per-line design ran **4m22.109s** on Windows Git Bash but only **6.465s** on Linux (WSL2, bash 5.2.21) - a ~40x platform penalty on identical code. The batched rewrite runs **0.655s** on Windows and **0.027s** on Linux.
- The pre-fix hot path spawned two `sed` per scanned line plus per-call `sed`/`tr` in helpers, and one `git diff` per changed path. Current batched anchors: `workflow/hooks/post-turn-safety.sh` (search: `run_diff_batch`), (search: `gate_scannable_files`), and (search: `scan_content_files`).
- This reasoning does NOT generalise to every hook: the same day, removing forks from `deny-dangerous.sh` made it slower. See the entry below before applying it elsewhere.

## Footgun: Policy modules must share one prepared command context

**Status:** active | **Created:** 2026-08-01 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Whether each PreToolUse policy module may prepare its own segment context - it may not; preparation belongs to the dispatcher and adding a policy must not multiply parsing work.
**Trigger phase:** SCOPE
**Caught at:** ACT

**Prevention:**
1. Measure with an INTERLEAVED A/B (alternate old/new per round). A sequential "all old, then all new" run is unreliable: the first run pays cold filesystem and git cache costs, which produced a false 2x "improvement" for a build that was actually 2x slower.
2. Do not assume a `$( )` count predicts wall clock. Substitutions actually executed per invocation are far fewer than a count of traced lines mentioning a function name suggests.
3. Prepare segment context once in `check_segment`; policy modules consume the shared `CMD_*` and `HAS_*` values. A new module must not call `prepare_segment_context` itself.
4. This is security-critical parsing: any restructuring needs `--self-test=full` green plus a byte-exact verdict corpus before and after, per `.goat-flow/skill-docs/playbooks/hook-policy-testing.md`.

**Symptoms:** Every Bash tool call carries a visible pause before the command runs, scaling with command complexity and the number of policy modules rather than with anything about the repository. The regression signature is more than one `prepare_segment_context` trace for a simple command, or a policy module calling that function directly.

**Why it happens:** The dispatcher runs on every Bash PreToolUse. When its policy checks independently call `prepare_segment_context`, the shared tokenisers (`split_shell_words_into`, `normalize_command_candidate`, `normalize_leading_command_word`) walk the same command again for each policy. The dominant term is NOT established - see the failed fix.

**Evidence:**
- 2026-08-01, Windows 11 Git Bash, interleaved A/B, 30 invocations per cell: **272ms** per call for `--check='npm run typecheck'`, **309ms** for a four-stage pipeline, **652ms** for the JSON-stdin path (adds `jq`). Bare `bash empty.sh` is ~50ms.
- Only 6 external processes run per invocation (3 `jq`, 1 `git`, 1 `dirname`, 1 `cat`), against ~1,959 traced bash operations for a simple command and ~5,329 for a pipeline.
- One `$(fn)` costs ~12.5ms here and does NOT scale with script size (retested with 400 extra functions and a 200KB exported variable in the process).
- 2026-08-04 Linux interleaved A/B, 30 invocations per cell: hoisting preparation from three policy calls to one reduced the simple-command median from **39.08ms to 30.99ms** and the four-stage-pipeline median from **102.62ms to 93.12ms**. A 15-case byte-exact verdict comparison reported 0 mismatches, and both installed and workflow full corpora passed 327/327.
- Current anchor: `workflow/hooks/deny-dangerous.sh` (search: `Parse once per segment`). A `bash -x` trace for `npm run typecheck` records one `prepare_segment_context` call; the pre-fix checkout records three.

**Failed fix, do not repeat without new evidence:** Converting the hot tokenisers (`normalize_command_candidate`, `normalize_leading_command_word`, `first_word_base`, `drop_first_shell_word`) to fork-free `_into` forms returning through globals, plus memoizing `normalize_command_candidate`, **made the hook slower**: 272→392ms simple, 309→729ms pipeline, 652→751ms JSON, while executing ~3.3x MORE traced operations (simple 1,959→6,428). Verdicts stayed correct (272-case byte-exact corpus identical, `--self-test=full` 319/319), so it was a pure performance regression and was reverted. The cause of the 3.3x increase was not identified.

## Footgun: Copilot combines native and Claude project hook registrations

**Status:** active | **Created:** 2026-08-23 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Treat repository `.claude/settings.json` as a Copilot hook source too; keep real Copilot policy only in its native config, give managed Claude rows explicit inert shell routes, and make descriptor readers prefer structured exec operands over those routes.
**Trigger phase:** SCOPE
**Caught at:** VERIFY
**Incident count:** 3 | **Latest occurrence:** 2026-08-26

**Prevention:** Before changing a lifecycle shared by Claude and Copilot, test a mixed-source fixture with both real registration shapes and the exact current providers. Preserve all four Claude identity fields - `command`, ordered `args`, `bash`, and `powershell` - through writer, generated contract, installer, audit, and replay. Descriptor readers must select structured exec operands before inert cross-provider shell routes. Audit and runtime proof must continue to read the selected provider's native config path; a Claude no-op never counts as Copilot protection. Configured replay proves only local execution. Renew live delivery separately, and do not extend the result to Copilot cloud behavior or to the documented-but-not-live-captured Windows route.

**Incident 2026-08-23:** An isolated session-start fixture registered one command in `.github/hooks/` and one in `.claude/settings.json`. GitHub Copilot CLI 1.0.80 invoked both for one initial session: the native entry received camelCase fields and the Claude-compatible entry received PascalCase-event snake_case fields. Their privacy-safe markers had the same session fingerprint and landed 32 ms apart. A runner that expected one marker correctly stopped instead of claiming delivery.

This is provider behavior, not duplicate JSON inside one config. GitHub's [hook-locations contract](https://docs.github.com/en/copilot/reference/hooks-reference#hooks-locations) says Copilot combines repository `.github/hooks/*.json` with the inline `hooks` block in `.claude/settings.json`. Goat Flow already owns both potential surfaces: `workflow/manifest.json` (search: `"hook_config_file": ".claude/settings.json"`) and (search: `"hook_config_file": ".github/hooks/hooks.json"`). A hook added to both can therefore run twice for Copilot; a hook added only to Claude can still run under Copilot and bypass a manifest claim that Copilot is unsupported.

**Recurrence 2026-08-25:** The second incident exposed field selection, not just duplicate invocation. Copilot selected `command: "node"` from Goat Flow's structured Claude row without its `args`, so a safe `pwd` request failed before policy startup with a Node syntax error. The accepted descriptor keeps Claude's real `command` plus `args` and adds `bash: "exit 0"` and `powershell: "exit 0"`. Copilot's cross-loaded copy becomes inert, while `.github/hooks/hooks.json` remains the sole managed Copilot policy source. Owners: `src/cli/server/agent-hook-command.ts` (search: `bash: "exit 0"`), `src/cli/server/agent-hook-writer.ts` (search: `handlerDescriptor.bash`), and `test/unit/hooks-runtime-evidence.test.ts` (search: `requires Copilot native registration`).

**Recurrence 2026-08-26:** After inert cross-provider shell routes were added, the generic hook fact reader returned top-level `bash: "exit 0"` before examining structured `command` plus `args`. The full harness audit then reported both managed Claude hooks as unregistered even though the shipped descriptors retained their executable script operands. A regression test built from the shipped Claude descriptor confirms both paths resolve when structured exec operands are selected first. Evidence anchors: `src/cli/facts/agent/hook-registration.ts` (search: `function readHookCommand`) and `test/unit/audit-command/hook-facts.test.ts` (search: `reads managed Claude exec operands before inert shell routes`).

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

## Footgun: Rejecting invalid hook configuration instead of clamping it wedges every tool call

**Status:** resolved | **Created:** 2026-08-11 | **Resolved:** 2026-08-18 | **Evidence:** ACTUAL_MEASURED

**Original symptoms:** Empty or over-ceiling `GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS` values made both policy and Stop hooks fail closed with an unhelpful configuration error, blocking commands and turn completion.

**Why it happened:** The resolver treated an exported empty string as malformed rather than unset and rejected values above a mode ceiling instead of clamping them. The caller translated every rejection into the same unavailable result.

**Resolution:** `workflow/hooks/hook-launch-runtime.mjs` (search: `resolveHookLaunchTimeoutMs`) treats empty as unset and clamps oversized values. Only inputs that cannot bound a wait (`0` or non-decimal text) are rejected, and `workflow/hooks/run-with-bash.mjs` (search: `describeInvalidHookLaunchTimeout`) names the variable, supplied value, and valid range.

**Resolution evidence:** `test/unit/hook-launcher.test.ts` (search: `without blocking the command`) covers empty input and (search: `clamps values above the`) covers oversized input at launcher level.

**Prevention:** For each future hook configuration validator, probe unset, empty, over-ceiling, zero, and malformed input through every hook class. Assert caller exit status and delivered message, not only the resolver return value.

---

- **git diff --stat unreliable for scope detection** (resolved 2026-04-03) - auto-detect uses staged, then unstaged, then full diff.
- **Advisory hooks create unfixable quality warning after setup** (resolved 2026-04-14) - hooks ship enforce-mode (`GOAT_LINT_ENFORCE` defaults to 1).
- **Codex hooks registered in config.toml instead of hooks.json** (resolved 2026-04-15) - moved to `.codex/hooks.json`; TOML hook sections were silently ignored.
- **Codex hook migrations drift across files, templates, installer, docs** (resolved 2026-04-15) - restored Codex guardrail registration; aligned all four surfaces.

## Footgun: Optional hook migration must remove old registrations and re-add enabled central entries

**Status:** resolved | **Created:** 2026-06-07 | **Resolved:** 2026-07-17 | **Evidence:** OBSERVED

**Resolution:** Current migration removes managed legacy Gruff registrations before pruning per-agent scripts and rebuilds only provider-supported, enabled central entries. `test/integration/setup-install-codex-config-migration.test.ts` (search: `migrates legacy Codex Gruff registration to the approved provider contract`) verifies that an old Codex command becomes the approved central contract while a custom user event remains. `test/unit/hook-registrar-surfaces.test.ts` (search: `keeps gruff-code-quality unregistered for Antigravity without result delivery`) verifies that an enabled desired state does not restore a registration whose feedback cannot reach the model.

**Original symptoms:** The installer could successfully copy the new central hook scripts, prune legacy per-agent hook files, and still leave an existing agent hook config pointing at the deleted legacy `gruff-code-quality.sh` path. The failure appeared only after upgrade because fresh installs used the new template shape and disabled optional hooks did not expose the stale entry.

**Why it happened:** `workflow/install-goat-flow.sh` originally treated only deny-dangerous and the old split guardrail scripts as managed during hook-config migration. Optional `gruff-code-quality.sh` registrations were outside that managed set, so pruning `.claude/hooks/`, `.codex/hooks/`, `.agents/hooks/`, or `.github/hooks/` could delete the script while preserving the old registration.

**Durable anchors:**
- `scripts/generate-managed-hook-desired-state.mjs` (search: `commandScriptNames`) publishes each hook's current and legacy registration ownership tokens.
- `workflow/install-goat-flow.sh` (search: `appendSharedHookFragment`) re-adds enabled generated fragments rather than preserving stale per-agent paths.
- `workflow/install-goat-flow.sh` (search: `configuredHookEnabled`) reads the existing config toggle so enabled optional hooks survive upgrades while disabled hooks stay absent.

**Prevention:** Add every future optional hook to the managed removal list before legacy files are pruned. Rebuild registrations from current registry and config state, preserve desired toggles for unsupported providers, and add upgrade fixtures whenever install paths or delivery support changes.
