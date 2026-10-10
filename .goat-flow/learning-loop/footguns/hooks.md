---
category: hooks
last_reviewed: 2026-10-03
---

**Scope:** Hook runtime delivery, provider result adapters, Stop recovery, and policy-module correctness. Execution cost and performance live in [hook-performance.md](hook-performance.md); scanner blind spots in [hook-scanning.md](hook-scanning.md); install, launch, registration, and config-drift plumbing in [hook-installation.md](hook-installation.md); the `deny-dangerous` policy parser in [deny-shell.md](deny-shell.md), [deny-secrets.md](deny-secrets.md), and [deny-writes.md](deny-writes.md).

## Footgun: Codex config preservation can leave old permission profiles behind

**Status:** active | **Created:** 2026-05-21 | **Evidence:** ACTUAL_MEASURED

**Prevention:** After a Codex upgrade, run `goat-flow audit . --agent codex --harness`, not only the default setup audit. If settings were preserved, compare `.codex/config.toml` with `workflow/hooks/agent-config/codex.toml`, add the permission profile plus exact denies for sensitive root files present in the checkout, and report hook registration (`.codex/hooks.json`) and the filesystem deny profile (`.codex/config.toml`) as separate surfaces in the installer and setup prompt.

**Symptoms:** A normal `goat-flow install . --agent codex` upgrade refreshes skills and hook scripts but preserves a `.codex/config.toml` that predates the permission-profile template, so setup and agent checks pass while `audit --harness` still reports incomplete direct literal secret-path blocking. The setup prompt shows "0 audit checks failed" unless the audit runs in harness mode.

**Why it happens:** The installer skips existing settings to avoid clobbering local config, and for Codex `.codex/config.toml` is both a settings file and the provider-native filesystem deny surface, so preserving it never migrates `default_permissions = "goat-flow"` or `[permissions.goat-flow.filesystem]`.

**Evidence:** `workflow/install-goat-flow.sh` (search: `Settings file was preserved`) preserves existing settings even under `--force`; `workflow/hooks/agent-config/codex.toml` (search: `default_permissions = "goat-flow"`) carries the required profile; `src/cli/audit/harness/check-constraints.ts` (search: `direct literal secret-path blocking incomplete`) detects the gap. A 2026-05-21 downstream upgrade failed Constraints until exact root env files were added beside the template profile.

---

## Footgun: Registered Stop hooks can be dead config behind agent trust gates

**Status:** active | **Created:** 2026-06-13 | **Evidence:** ACTUAL_MEASURED
**Severity:** INTEGRATION
**Incident count:** 4 | **Latest occurrence:** 2026-09-18
**Decision changed:** Treat project-layer trust, hook-handler trust, and live model delivery as separate gates before enabling a registration.
**Trigger phase:** VERIFY

**Prevention:** Treat hook registration facts as config evidence only. Before claiming an agent runs a Stop hook, capture a live payload or hook-side log write from that exact provider version, mode, config source, and trust state. Revalidate after any relevant provider, hook, adapter, mode, source, or trust change; elapsed time alone never invalidates evidence. Gate default registration on verified delivery, not documented support, and keep the gate consistent across every Stop hook for that agent. Gating one Stop hook for one agent is a lock-step edit: `workflow/manifest.json` `hook_events.post_turn` to `null`, which flips `supportsPostTurnHook` in `src/cli/agents/registry.ts` (search: `supportsPostTurnHook`) so `check-verification.ts` skips the agent instead of penalising it; `hooks-registry.ts` `unsupportedAgents`; the generated `.agents/hooks.json` via `goat-flow hooks sync`, never hand-edited; plus the README hook table, CHANGELOG, `docs/dashboard.md`, and the `hook-registrar` tests.

**Recurrence 2026-09-17:** In a live Codex CLI 0.154.0 capture, turning Git protection off in the dashboard moved its unchanged PreToolUse registration after the general policy. A fresh session then showed both hooks as modified, with two installed, zero active and two awaiting review, even though the general switch remained on. The in-memory replay preserved both definition hashes and reproduced the captured file exactly. `src/cli/server/agent-hook-writer.ts` (search: `prepareAgentHookState`) removes and appends owned rows; `src/cli/server/hook-registrar.ts` (search: `reconcileHook(change, gitSpec, true)`) reconciles the sibling first on a general toggle. Preserve current Codex registration bytes and order across toggles and Sync; config equivalence does not establish retained provider trust. `test/unit/hook-registrar.test.ts` (search: `keeps current managed files while a user leaves a hook disabled`) now compares exact registration bytes through both policy cycles and Sync; its assertion failed before the writer repair. The capture stopped without accepting the new trust prompts; live recovery remains unverified.

**Recurrence 2026-09-18 (public installer):** After the dashboard repair, the approved public install still reversed the two unchanged PreToolUse rows. Both install calls exited zero and the second preserved all target bytes. Reconstructing the original registration order matched its saved SHA-256 exactly. The earlier live capture established that this row movement can invalidate Codex trust; trust after this installer run was not observed. Keep already-current Codex rows in place in the standalone installer as well as the registrar, and check exact registration bytes through public install after reviewed Sync. Owners: `workflow/install-goat-flow.sh` (search: `const originalConfig = JSON.stringify(currentConfig)`) and `test/integration/hook-sync-recovery.test.ts` (search: `recovers a full v1.16.0 installation`).

**Symptoms:** Writing a Stop entry into `.codex/hooks.json` or `.agents/hooks.json` does not mean the agent executes it. On 2026-06-13, with Stop hooks registered for all three agents, Claude fired and delivered the full payload; Codex (codex-cli 0.139.0, `features` reporting `hooks stable true`, docs listing `Stop`) never executed the hook across four `codex exec` runs even with `--dangerously-bypass-hook-trust`, project trust, and a project config layer; Antigravity (agy 1.0.6) logged `Loaded hooks.json ... 1 total handlers` and `JSON hook "jsonhook__stop-capture_Stop_0_0": executing command`, but execution waited on `~/.gemini/trusted_hooks.json` review (`toolPermission=request-review`) and print mode exited first.

**Why it happens:** Documented support, trust state, and live delivery change independently. By 2026-08-09 Codex and Antigravity documented `PostToolUse` and `Stop` and Copilot documented `postToolUse` and `agentStop`, which made the earlier capture stale evidence rather than proof that delivery works. **Recurrence 2026-08-10 on Codex CLI 0.147.0:** ignoring user configuration also removed the project trust record, so the project hook layer stayed inactive even with handler review bypassed; a session-only whole-table project trust override activated it and PostToolUse and Stop then delivered in exec and interactive modes, while the provider-owned timeout stayed silent, so Goat Flow must finish first and return its own unavailable response.

**Evidence:** `src/cli/server/hooks-registry.ts` (search: `hook-provider-adapter.v1:codex:turn-stop`) is the Codex Stop evidence gate; `src/cli/hook-contracts.ts` (search: `assessHookProviderEvidence`) keeps official documentation, dated live capture, trust, and result delivery as separate states; `workflow/hooks/hook-launch-runtime.mjs` (search: `prepareProviderLauncherUnavailableDelivery`) and `test/integration/hook-consumer-canary.test.ts` (search: `writeObservedCodexFeedbackConfig`) cover the 2026-08-10 shape. `.goat-flow/learning-loop/decisions/ADR-037-separate-post-turn-safety-from-validation.md` (search: `That path is a tombstone`) removes the plan checkbox guard from shipped hooks. `post-turn-safety` was held to the same standard on 2026-06-14, when Antigravity joined Codex in its `unsupportedAgents`; a default-on secret scanner whose Stop event may never fire is false assurance because the dashboard still reports it installed. Provider contracts: [Codex hooks](https://developers.openai.com/codex/hooks), [Antigravity hooks](https://www.antigravity.google/docs/hooks), [GitHub Copilot hooks](https://docs.github.com/en/copilot/reference/hooks-reference).

## Footgun: Launcher-owned failures can bypass provider feedback adapters

**Status:** active | **Created:** 2026-08-10 | **Evidence:** ACTUAL_MEASURED
**Severity:** INTEGRATION
**Decision changed:** Exercise launcher-owned timeout and invalid-output branches through source and packed consumers before registering model-visible feedback.
**Trigger phase:** VERIFY
**Incident count:** 3 | **Latest occurrence:** 2026-10-03

**Prevention:** Route every launcher-owned failure through the neutral unavailable envelope and provider adapter, and keep source and npm-archive canaries that stall the child inside the managed deadline and require non-empty model context. Anchors: `workflow/hooks/run-with-bash.mjs` (search: `reportLauncherUnavailable`), `workflow/hooks/hook-launch-runtime.mjs` (search: `prepareProviderLauncherUnavailableDelivery`), `test/integration/hook-consumer-canary.test.ts` (search: `Empty stdout would reproduce the silent provider timeout`), `test/integration/packaged-hook-install.test.ts` (search: `Empty packed stdout would mean source proof hid a release artifact failure`).

**Symptoms:** A migrated child result used the provider adapter, but the timeout and adapter-failure branches returned through the legacy unavailable reporter, so the terminal showed human stderr while Codex received empty stdout and a stopped analyzer looked silent to the model.
**Recurrence 2026-09-25:** The disabled-policy shortcut exited before the provider adapter and returned empty stdout to Antigravity, which requires an explicit allow object. `workflow/hooks/run-with-bash.mjs` (search: `policyChoiceBeforeBash`) now emits that object without launching Bash; `test/unit/hook-launcher.test.ts` (search: `returns the provider allow response`) checks both policies and the Codex/Claude empty-success controls.

**Recurrence 2026-10-03:** Launcher failures bypassed scanner-owned retry state and repeatedly blocked active Stop deliveries.
Keep one launcher allowance per verified user turn across changing faults; findings still block.
Evidence: `workflow/hooks/hook-launch-runtime.mjs` (search: `applyManagedStopRecovery`).

## Footgun: One shared hook-output limit can erase a completed safety result

**Status:** active | **Created:** 2026-10-03 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Verify separate byte budgets in controller children and the outer launcher.

**Prevention:** Drain diagnostics separately; accept only normally completed, valid results. Floods and timeouts stay unavailable.
**Symptoms:** A 6,274-byte result plus 5,047 diagnostic bytes exceeded the shared cap; controller stderr also erased a completed finding.
Evidence: `test/integration/post-turn-launcher-recovery.test.ts` (search: `preserves controller child findings while draining ordinary diagnostic excess`).


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

## Footgun: Copilot combines native and Claude project hook registrations

**Status:** active | **Created:** 2026-08-23 | **Evidence:** ACTUAL_MEASURED
**Severity:** INTEGRATION
**Decision changed:** Treat repository `.claude/settings.json` as a Copilot hook source too; keep real Copilot policy only in its native config, give managed Claude rows explicit inert shell routes, and make descriptor readers prefer structured exec operands over those routes.
**Trigger phase:** SCOPE
**Caught at:** VERIFY
**Incident count:** 3 | **Latest occurrence:** 2026-08-26

**Prevention:** Before changing a lifecycle shared by Claude and Copilot, test a mixed-source fixture with both real registration shapes and the exact current providers. Preserve all four Claude identity fields, `command`, ordered `args`, `bash`, and `powershell`, through writer, generated contract, installer, audit, and replay. Descriptor readers select structured exec operands before inert cross-provider shell routes. Audit and runtime proof read the selected provider's native config path; a Claude no-op never counts as Copilot protection. Configured replay proves only local execution; renew live delivery separately and do not extend it to Copilot cloud behaviour or the documented-but-uncaptured Windows route.

**Symptoms:** On 2026-08-23 an isolated session-start fixture registered one command in `.github/hooks/` and one in `.claude/settings.json`, and GitHub Copilot CLI 1.0.80 invoked both for one session, the native entry with camelCase fields and the Claude-compatible entry with PascalCase-event snake_case fields, 32 ms apart with the same session fingerprint. A runner expecting one marker correctly stopped instead of claiming delivery.

**Why it happens:** GitHub's [hook-locations contract](https://docs.github.com/en/copilot/reference/hooks-reference#hooks-locations) says Copilot combines repository `.github/hooks/*.json` with the inline `hooks` block in `.claude/settings.json`, and Goat Flow owns both surfaces: `workflow/manifest.json` (search: `"hook_config_file": ".claude/settings.json"`) and (search: `"hook_config_file": ".github/hooks/hooks.json"`). A hook added to both can run twice under Copilot, and a hook added only to Claude can still run under Copilot and bypass a manifest claim that Copilot is unsupported.

**Evidence:** **Recurrence 2026-08-25:** Copilot selected `command: "node"` from the structured Claude row without its `args`, so a safe `pwd` failed before policy startup with a Node syntax error. The accepted descriptor keeps Claude's `command` plus `args` and adds `bash: "exit 0"` and `powershell: "exit 0"`, making the cross-loaded copy inert while `.github/hooks/hooks.json` stays the sole managed Copilot policy source: `src/cli/server/agent-hook-command.ts` (search: `bash: "exit 0"`), `src/cli/server/agent-hook-writer.ts` (search: `handlerDescriptor.bash`), `test/unit/hooks-runtime-evidence.test.ts` (search: `requires Copilot native registration`). **Recurrence 2026-08-26:** the generic hook fact reader returned the top-level `bash: "exit 0"` before the structured `command` plus `args`, so the full harness audit reported both managed Claude hooks unregistered; `src/cli/facts/agent/hook-registration.ts` (search: `function readHookCommand`) now selects exec operands first, pinned by `test/unit/audit-command/hook-facts.test.ts` (search: `reads managed Claude exec operands before inert shell routes`).

## Footgun: Raw option text in policy reasons can break display and provider JSON

**Status:** active | **Created:** 2026-09-28 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Use fixed denial reasons for untrusted option data; pair recovery wording with existing authorization and provider-response assertions.
**Trigger phase:** ACT

**Prevention:** Keep unknown-option reasons fixed instead of echoing the token. Construct display controls in tests and assert the complete text message and decoded provider reason, not just a denial substring. Failure diagnostics must use printable case labels without interpolating rejected command data. Keep the provider's existing exit and decision protocol. A cleanup hint may describe individual literal file removal and empty-directory removal only for already-approved deletion; retain target-count confirmation, secret restrictions and human-only operations.

**Symptoms:** The unknown Git option reason echoed U+202E, U+200B and U+001B through the classifier. The escape character also made Copilot and Antigravity responses fail JSON parsing. The unsafe-recursive-cleanup reason supplied only “Specify an explicit target path”, although the recorded literal-file and empty-directory recovery classified as allowed. Secret-file removal remained denied.

**Evidence:** `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `Unrecognised Git global option`) now supplies fixed text. `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `Only for already-approved deletion`) limits recovery to the existing authority. `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `unknown option $display_label`, `approved cleanup recovery copy`, `cleanup recovery preserves secret restriction`) failed against the original reasons and passed in the complete candidate hook store for text, Copilot and Antigravity. The incident-backed recovery is owned by `.goat-flow/learning-loop/lessons/agent-tooling.md` (search: `When deny hook blocks a command, use the unblocked equivalent`). No candidate deletion was executed. These are local classifier results, not live provider delivery evidence.

**Recheck 2026-09-28:** Injecting the fixed text plus a stray U+202E into the test helper produced zero assertion failures; injecting the whole unsafe token made its failure diagnostic echo U+202E. `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `block copy should match fixed text`, `omit forbidden command data`) now rejects extra text in fixed-message cases and keeps rejected data out of diagnostics. Nine output-mutation checks covered valid text, stray controls and complete tokens for U+202E, U+200B and U+001B; only valid fixed output was accepted, and no tested control appeared in diagnostics.

**Related output boundary, 2026-09-28:** `scripts/check-touched.mjs` (search: `function printable`) escaped C0 and bidi controls but left C1 controls unchanged. Executing the actual formatter with U+0085, U+009B and U+009D returned those same raw code points; `runUnicodeCheck` uses it to print filenames. When diagnostics need supplied text, escape C1 controls as well. `test/unit/check-touched.test.ts` (search: `fails on Unicode controls with printable filenames`) now covers these filename characters. The full CLI regression passed after the verifier distinguished completed `EPERM` metadata from failed launches and captured child output through private files. The earlier launch-blocked diagnosis was incorrect; the existing lesson in `.goat-flow/learning-loop/lessons/hook-probe-testing.md` (search: `Codex sandbox hook probes must distinguish direct Bash from Node child-process`) owns that distinction.

## Footgun: Absolute `mkdir -p` under Git Bash on a WSL network path leaves the Stop re-entry guard without state

**Status:** active | **Created:** 2026-09-30 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Whether a hook may create or confirm a directory by absolute path - on a `//wsl.localhost` path it cannot, so enter the verified root and create the directory by relative path.
**Trigger phase:** ACT
**Enforced-by:** `test/integration/hook-provider-contracts.test.ts` (search: `mkdir refuses absolute paths`, `names dubious ownership`)

**Prevention:**
1. In hook scripts, `cd` into the verified root and run `mkdir -p` on a relative path. Do not pass `mkdir -p` an absolute path that can be a `//wsl.localhost` path.
2. Treat a guard that ends a provider loop as unproven on Windows until its state write has run under Git Bash against a `//wsl.localhost` root.
3. When a Git lookup fails, carry Git's stated reason into the hook result.

**Symptoms:** Codex Desktop on Windows re-fired Stop 2,152 times in a WSL checkout between 2026-09-29 18:29 and 2026-09-30 18:56 AEST. Each invocation reported `post-turn-safety: INCOMPLETE` with `The selected Git repository root could not be opened`; no re-entry state file appeared.

**Why it happens:** Git rejected the checkout for dubious ownership because `safe.directory` lacked an entry. The Stop state writer then passed an absolute WSL network path to `mkdir -p`, which failed even for an existing directory. Without stored state, every Stop blocked again, while generic output hid Git's reason.

**Evidence:** Measured 2026-09-30 with Git for Windows 2.56.0 and Git Bash 5.3.15 against WSL2. Absolute creation returned 1 (`Read-only file system`) for missing and existing directories; relative creation returned 0 for both. Exclusive write, `chmod`, `mv`, and `[ -O ]` succeeded there. The registered Codex Stop command changed from three consecutive blocks to block, empty response, block, with the diagnostic `Git refused this repository for dubious ownership`. Owners: `workflow/hooks/post-turn-safety.sh` (search: `stop_state_relative_directory`, `report_repository_root_failure`).

**Related Gruff failure, 2026-10-01:** An absolute-mkdir-rejecting shim reproduced the lost health marker. Relative creation now preserves deduplication: `workflow/hooks/gruff-code-quality.sh` (search: `announce_verified_health`), `test/integration/gruff-code-quality-contract.test.ts` (search: `deduplicates verified health when mkdir refuses absolute paths`). This is fixture proof, not fresh native or provider proof.

---

## Footgun: Health-marker IO can abort analysis

**Status:** active | **Created:** 2026-10-01 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Guard optional marker reads and writes.

**Prevention:** Use `cat`; Bash's `$(<file)` can exit even inside `if`.

**Evidence:** `workflow/hooks/gruff-code-quality.sh` (search: `announce_verified_health`) exited 1 with empty stdout after valid analysis when its marker was unreadable or obstructed by a directory.

---

## Footgun: Inline `node -e` programs in hook scripts must fit the Windows command line

**Status:** active | **Created:** 2026-10-03 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Whether a hook may pass a growing program to Node as a `node -e` argument - it may not; feed a large program on stdin or keep it in a file.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Enforced-by:** `test/unit/hook-inline-node-programs.test.ts` (search: `keeps every inline node -e program in shipped hooks within the Windows command-line budget`)

**Prevention:** Keep inline `node -e` programs small, because Git Bash passes them on the Windows command line, which Windows caps at 32,767 characters. Feed a large program to Node through a quoted heredoc inside a Bash function, as the post-turn controller does, so the heredoc stays out of `$(...)`.

**Symptoms:** On native Windows, a Stop in a folder that is not a Git top level, including a WSL checkout over `\\wsl.localhost` when Git reports dubious ownership, failed with `node: Argument list too long` and `controller scan could not complete`. No scan ran and the `safe.directory` remedy never reached the user, while Linux CI stayed green.

**Why it happens:** The post-turn controller program grew from 20,171 to 34,145 characters in one change. Code inside a Bash string is invisible to Gruff, ESLint and Prettier, so nothing measured it.

**Evidence:** Measured 2026-10-03 with Windows Node v24.9.0 and Git Bash: the earlier scanner failed with `Argument list too long` in a `\\wsl.localhost` checkout and in an NTFS multi-repo workspace. The stdin version blocked once with the dubious-ownership remedy in the first and reported the child's conflict marker in the second. Owner: `workflow/hooks/post-turn-safety.sh` (search: `run_controller_program`).

## Resolved Entries

> Historical record. These entries are no longer active traps.

## Footgun: Legacy policy child errors can become provider allows

**Status:** resolved | **Created:** 2026-09-25 | **Resolved:** 2026-09-25 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Buffer legacy policy output, accept only complete child decision statuses, and keep the writer in the launch runtime required by policy-only installs.
**Trigger phase:** ACT
**Caught at:** VERIFY
**hallucination-risk:** high
**Incident count:** 2 | **Latest occurrence:** 2026-09-25

**Resolution:** The launcher validates buffered policy results before delivery, and the launch runtime owns output capture independently of the optional provider adapter. Both cited local failure paths have regression coverage; live provider delivery remains a separate qualification.

**Prevention retained:** When changing the launcher or a policy hook, test an unexpected child exit with partial stdout and stderr in Claude, Antigravity and Copilot modes. Keep only exit `0` and Claude policy exit `2` as delivered decisions; convert other statuses to the provider's denial shape. Policy-only installs require the launch runtime but not the provider adapter, so put shared output capture in that runtime and test a missing adapter through the configured handler. Do not use this policy rule for advisory feedback or post-turn hooks.

**Symptoms:** A temporary policy script that wrote partial output and exited `1` or `127` made the launcher return the same status. Claude's PreToolUse exit-1 path is nonblocking, so a broken check could release the command. Antigravity and Copilot also received incomplete policy output instead of a bounded denial.

**Why it happens:** The legacy launcher relayed child output and returned the raw exit code, assuming every nonzero status blocked the host. The provider contracts differ, and stderr from a crashed child is not a complete policy decision.

**Evidence:** `workflow/hooks/run-with-bash.mjs` (search: `renderLegacyPolicyExecution`) buffers policy output and maps unexpected exits through `reportUnavailable`; `test/unit/hook-launcher.test.ts` (search: `denies an incomplete policy result`) reproduces exit `1` and `127` and checks that partial output is withheld. The new tests failed on the old launcher and passed after the repair. Live provider delivery remains separate from this local launcher proof.

**Recurrence 2026-09-25 (adapter dependency):** The first repair statically imported the output adapter. A missing or corrupt adapter then failed module linking before the launcher could render a policy refusal or Gruff's soft-skip response; preflight reported nine test failures. A caught dynamic import restored Gruff but still blocked policy-only installs, whose registry does not include the adapter. `workflow/hooks/hook-launch-runtime.mjs` (search: `appendBoundedHookOutput`) now owns the writer; `workflow/hooks/hook-provider-adapters.mjs` re-exports it for migrated hooks. `test/unit/hook-launcher.test.ts` (search: `keeps legacy policy decisions available without the provider adapter`) and `test/unit/audit-command/agent-deny-hooks-drift.test.ts` (search: `replays literal non-Git launchers`) failed before that move and passed afterward. The existing missing/corrupt Gruff adapter cases in `test/integration/hook-command-spawn-matrix.test.ts` also pass.


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
