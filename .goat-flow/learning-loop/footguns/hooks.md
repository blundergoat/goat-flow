---
category: hooks
last_reviewed: 2026-08-10
---

**Scope:** Hook runtime delivery, Stop-scanner behavior, execution performance, and resolved hook history. Install / launch / registration / config-drift plumbing lives in [hook-installation.md](hook-installation.md). The `deny-dangerous` shell-grammar policy parser lives in [deny-shell.md](deny-shell.md), [deny-secrets.md](deny-secrets.md), and [deny-writes.md](deny-writes.md).

## Footgun: Destination-only Git pathspecs disguise renames as full-file additions

**Status:** active | **Created:** 2026-08-10 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Resolve rename identity before deriving edit ranges from a path-limited diff.
**Trigger phase:** VERIFY

A Git diff limited to a rename destination can hide the source path and render an unchanged rename as a full-file addition. Edit-time analysis then treats every line as user-authored and may report a clean scan or unrelated debt instead of a not-applicable rename.

Git rename detection needs both sides of the move. Query full `--name-status --find-renames` output first, then diff the matched source and destination together before parsing positive hunks. Evidence anchors: `workflow/hooks/gruff-code-quality.sh` (search: `rename_source_for_path`) and `test/integration/gruff-code-quality-contract.test.ts` (search: `classifies rename-only Git changes as not applicable`).

## Footgun: Changed-range scoping makes a quality hook structurally blind to file-level rules

**Status:** active | **Created:** 2026-08-05 | **Evidence:** ACTUAL_MEASURED
**Incident count:** 5 | **Latest occurrence:** 2026-08-10
**Decision changed:** Keep edit-time attribution and release-time repository enforcement as separate layers: the hook reports findings attributable to touched files/ranges, while preflight owns a full-repository accepted-debt ratchet.
**Trigger phase:** VERIFY

A per-edit quality hook that scopes findings to changed lines cannot report any rule that anchors to the file rather than to a line. `size.file-length`, `docs.missing-file-overview`, and `design.circular-import` all report at line 1 with `scope=file`, and passing `--changed-ranges` makes the analyzer drop them before the hook ever sees them. The result reads exactly like success: every edit to an oversized file reports clean, so the file keeps growing and no warning is ever emitted for an agent to ignore.

Measured on 2026-08-05: editing `test/unit/hook-registrar.test.ts` (1,139 lines, threshold 750) produced no hook output at all, while `gruff-ts analyse` on the same file reported `size.file-length` immediately. Twenty files had crossed the gate this way. The nearby trap is fixing only half of it - scoping the whole file when the changed range already covers it repairs the new-file case but leaves the far more common "editing an existing oversized file" case still silent.

The fix trades symbol-aware scoping for structural visibility: request the whole file and select scopes in the hook, keeping `scope=file`/`scope=project` findings unconditionally while confining line and symbol findings to the edited ranges. Symbol widening is lost, which is a real cost, but a rule nobody can ever see is worth less than one that occasionally reports a sibling function. Residual gap: the fix covers only the `gruff.hook.v1` contract path (gruff-ts today). The legacy `analyse` path still delegates ranges to analyzers advertising the native trio, and those cannot express finding scope, so partial edits to oversized files stay silent until those analyzers expose scope-aware results. Evidence anchors: `workflow/hooks/gruff-code-quality.sh` (search: `hook_v1_report`), `workflow/hooks/gruff-code-quality.sh` (search: `A file-scope finding describes the file the agent is editing right now`).

Recurrence on 2026-08-05 exposed the adjacent release gate gap. A fresh gruff-ts 0.4.0 full-repository scan at commit `9f1bb2be` reported 36 findings: 14 `size.file-length` warnings, 4 `security.process-exec` warnings, and 18 documentation advisories. Preflight still reported `PASS   79 checks · 0 warnings` because its Gruff Policy check only rejects disabled rules; it never runs the analyzer. The per-edit hook also cannot be expected to enumerate untouched repository debt. Neither result proves a clean repository, even though both surfaces can be read that way.

Recurrence on 2026-08-08 showed that the ratchet's downward path is part of completing a fix. Replacing history-derived commit guidance shortened `src/cli/cli-handlers.ts` from 759 to 747 lines, below the 750-line threshold. Full preflight then failed on stale accepted identity `4348d703d920ab92` until only that baseline entry was removed; rule thresholds and enabled state stayed unchanged. A change that eliminates a warning must reconcile the accepted-debt manifest in the same proof pass. Evidence anchors: `scripts/gruff-warning-ratchet-checks.mjs` (search: `The finding is gone`) enforces stale-entry removal; `src/cli/cli-handlers.ts` (search: `ensureGitCommitInstructions`) contains the shortened command handler.

Recurrence on 2026-08-09: a changed-range scan showed only three advisories, while full preflight found three task-local file-length warnings. Moving matrix checks into existing helper/suite files and compacting the runtime audit cleared them without accepting debt. Evidence: `test/unit/hook-registrar.helpers.ts` (search: `verifyAgentHookRegistrationMatrix`) and `src/cli/audit/check-agent-deny-runtime.ts` (search: `configuredRuntimeProbes`).

Recurrence on 2026-08-10: source and packed consumer canaries passed after launcher-owned failures gained provider feedback, but a whole-file Gruff scan measured the edited adapter and launcher at 827 and 836 lines, above the 750-line limit. Moving lifecycle capture and timeout selection into the launch runtime restored the adapter to 742 lines and the launcher to 746; changed-range feedback alone would not enforce that file-level limit. Evidence anchors: `workflow/hooks/hook-launch-runtime.mjs` (search: `captureHookProcessUntilDeadline`) and `test/integration/packaged-hook-install.test.ts` (search: `npm archive must contain the candidate launch runtime bytes`).

Prevention has two layers. Keep PostToolUse fast and attributable, but expose incomplete coverage explicitly when the analyzer is missing, times out, emits invalid JSON, or reports zero analyzed files. In preflight, run the repo-local analyzer once in JSON mode and compare findings by `stableIdentity` against reviewed accepted debt; fail on analyzer errors, new warnings, worsened size metadata, stale baseline state, or degraded scan coverage while reporting unchanged accepted findings. Do not use the composite grade or raw finding count as the ratchet, and do not clear the gate by disabling rules or raising thresholds. Evidence anchors: `scripts/preflight-checks.sh` (search: `No gruff-ts rules disabled (satisfy or tune)`), `.goat-flow/skill-docs/playbooks/gruff-code-quality.md` (search: "Prefer `stableIdentity` for finding diffs"), `.gruff-ts.yaml` (search: `size.file-length`).

## Footgun: Codex config preservation can leave old permission profiles behind

**Status:** active | **Created:** 2026-05-21 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A normal `goat-flow install . --agent codex` upgrade refreshes skills and hook scripts but preserves an existing `.codex/config.toml`. If that file predates the permission-profile template, setup and agent checks pass while `audit --harness` still reports incomplete direct literal secret-path blocking for Codex - the setup prompt shows "0 audit checks failed" unless run in harness mode.

**Why it happens:** The installer skips existing settings to avoid clobbering local config. For Codex, `.codex/config.toml` is both a settings file and the provider-native filesystem deny surface (hook registration lives separately in `.codex/hooks.json`). Preserving it is safe for local customizations but doesn't migrate `default_permissions = "goat-flow"` or `[permissions.goat-flow.filesystem]`.

**Evidence:**
- `workflow/install-goat-flow.sh` (search: `Settings file was preserved`) - existing settings are skipped unless `--force`; `workflow/hooks/agent-config/codex.toml` (search: `default_permissions = "goat-flow"`) - the 1.7.0 template carries the required permission-profile surface.
- `src/cli/audit/harness/check-constraints.ts` (search: `direct literal secret-path blocking incomplete`) - harness detects the missing combined file-read and Bash-hook coverage.
- 2026-05-21 downstream upgrade: after normal Codex install, `audit --agent codex --harness` failed Constraints until exact existing root env files were added to `.codex/config.toml` alongside the template profile.

**Prevention:**
1. After Codex upgrades, run `goat-flow audit . --agent codex --harness`, not just the default setup audit.
2. If Codex settings were preserved, compare `.codex/config.toml` with `workflow/hooks/agent-config/codex.toml` and add the permission profile plus exact denies only for sensitive root files present in the checkout.
3. Improve the installer/setup prompt to distinguish "hook registration" (`.codex/hooks.json`) from "filesystem deny profile" (`.codex/config.toml`) when settings are preserved.

---

## Footgun: Registered Stop hooks can be dead config behind agent trust gates

**Status:** active | **Created:** 2026-06-13 | **Evidence:** ACTUAL_MEASURED
**Incident count:** 2 | **Latest occurrence:** 2026-08-10
**Decision changed:** Treat project-layer trust, hook-handler trust, and live model delivery as separate gates before enabling a registration.
**Trigger phase:** VERIFY

**Trap:** Writing a Stop entry into `.codex/hooks.json` or `.agents/hooks.json` does not mean the agent will ever execute it. On 2026-06-13, a capture fixture with Stop hooks registered for all three agents showed: Claude fired and delivered the full payload; Codex (codex-cli 0.139.0, `features` reports `hooks stable true`, docs document the `Stop` event) never executed the hook across four `codex exec` runs even with `--dangerously-bypass-hook-trust`, project trust, and a project config layer; Antigravity (agy 1.0.6) logged `Loaded hooks.json ... 1 total handlers` and `JSON hook "jsonhook__stop-capture_Stop_0_0": executing command` but the command never ran because execution waits on `~/.gemini/trusted_hooks.json` review (`toolPermission=request-review`) and print mode exits first.

Current primary documentation changed again by 2026-08-09: Codex and Antigravity now document `PostToolUse` and `Stop`, while Copilot documents `postToolUse` and `agentStop`. That makes the earlier live capture stale evidence, not proof that current delivery now works. The documented state and the captured state must change independently.

Recurrence on 2026-08-10: Codex CLI 0.147.0 repeated the trust distinction. Ignoring user configuration also removed the project trust record, so the project hook layer stayed inactive even when handler review was bypassed. A session-only whole-table project trust override activated the project layer; PostToolUse and Stop then delivered in both exec and interactive modes. The provider-owned timeout remained silent, so Goat Flow must finish first and return its own unavailable response. Evidence anchors: `src/cli/hook-contracts.ts` (search: `assessHookProviderEvidence`), `workflow/hooks/hook-launch-runtime.mjs` (search: `prepareProviderLauncherUnavailableDelivery`), and `test/integration/hook-consumer-canary.test.ts` (search: `writeObservedCodexFeedbackConfig`).

**Evidence:**
- `src/cli/server/hooks-registry.ts` (search: `hook-provider-adapter.v1:codex:turn-stop`) identifies the current time-bounded Codex Stop evidence gate; the recurrence above retains the historical failed capture.
- `src/cli/hook-contracts.ts` (search: `assessHookProviderEvidence`) keeps official documentation, dated live capture, trust, and result delivery as separate states.
- Current provider contracts: [Codex hooks](https://developers.openai.com/codex/hooks), [Antigravity hooks](https://www.antigravity.google/docs/hooks), and [GitHub Copilot hooks](https://docs.github.com/en/copilot/reference/hooks-reference).
- ADR-039 (search: `Remove Plan Checkbox Guard`) removes the plan checkbox guard from current shipped hooks and keeps only a tombstone cleanup path.
- `post-turn-safety` was held to the same standard on 2026-06-14: `antigravity` was added to its `unsupportedAgents` (codex was already gated), so goat-flow does not ship a default-on Stop hook to an agent whose delivery is unverified. A default-on *secret scanner* whose Stop event may never fire is false assurance - arguably worse than shipping nothing, because the dashboard still reports it "installed."

**Prevention:** Treat hook registration facts as config evidence only. Before claiming an agent runs a Stop hook, capture a live payload or hook-side log write from that exact provider version, mode, config source, and trust state. Expire the record after 30 days or any relevant provider, hook, adapter, mode, source, or trust change. Gate default registration on verified delivery, not documented support, and keep the gate consistent across every Stop hook for that agent. Gating one Stop hook for one agent is a lock-step edit: `workflow/manifest.json` `hook_events.post_turn` -> `null` (which flips `supportsPostTurnHook` in `src/cli/agents/registry.ts` (search: `supportsPostTurnHook`) so `check-verification.ts` *skips* the agent instead of penalising it), `hooks-registry.ts` `unsupportedAgents`, the generated `.agents/hooks.json` (regenerate via `goat-flow hooks sync`, never hand-edit the escaped launcher JSON), plus the README hook table / CHANGELOG / `docs/dashboard.md` and the `hook-registrar` tests.

## Footgun: Launcher-owned failures can bypass provider feedback adapters

**Status:** active | **Created:** 2026-08-10 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Exercise launcher-owned timeout and invalid-output branches through source and packed consumers before registering model-visible feedback.
**Trigger phase:** VERIFY
**Incident count:** 1 | **Latest occurrence:** 2026-08-10

A migrated child result used the provider adapter, but timeout and adapter-failure branches returned through the legacy unavailable reporter. The terminal showed human stderr while Codex received empty stdout, so a stopped analyzer looked silent to the active model.

Route every migrated launcher-owned failure through the neutral unavailable envelope and provider adapter. Keep source and npm-archive canaries that stall the child inside the managed deadline and require non-empty model context. Evidence anchors: `workflow/hooks/run-with-bash.mjs` (search: `reportLauncherUnavailable`), `workflow/hooks/hook-launch-runtime.mjs` (search: `prepareProviderLauncherUnavailableDelivery`), `test/integration/hook-consumer-canary.test.ts` (search: `Empty stdout would reproduce the silent provider timeout`), and `test/integration/packaged-hook-install.test.ts` (search: `Empty packed stdout would mean source proof hid a release artifact failure`).

## Footgun: Blocking Stop scanners can wedge on gitignored local state

**Status:** active | **Created:** 2026-06-14 | **Evidence:** OBSERVED

**Symptoms:** A Claude turn cannot stop even though the tracked/staged repo changes are safe. The Stop hook repeatedly reports findings under ignored generated output, scratch material, caches, or mutation-test sandboxes; every attempted "holding" response re-runs the Stop hook and repeats the block.

**Why it happens:** A blocking Stop hook runs at turn-end, not at commit time. If it scans gitignored files, it treats local runtime state as work the agent must fix before it can yield. That is too broad for a default hook: ignored paths commonly include real local `.env` files, `_temp/`, coverage output, caches, and test sandboxes. The safety boundary for `post-turn-safety` is committable content: tracked diffs, staged diffs, and untracked non-ignored files.

**Evidence:**
- 2026-06-14 live loop: `post-turn-safety` scanned ignored mutation-test sandbox copies of an environment example and blocked placeholder assignments such as `NOTION_TOKEN="ntn_your_notion_token_here"`, causing Claude Stop to re-fire repeatedly.
- Current hook scope: `workflow/hooks/post-turn-safety.sh` (search: `scan_tracked_changes`) and (search: `scan_untracked_changes`) scan tracked/staged/non-ignored changes only; there is no ignored-file scan.
- Regression coverage: `test/integration/post-turn-safety-hook-scanning.test.ts` (search: `allows ignored env files that are not staged`) and (search: `blocks ignored env files once they are force-staged`) lock the boundary: local ignored files are skipped, force-staged ignored files still block.

**Prevention:**
1. For default blocking Stop hooks, define "changed content" as committable content. Do not add `git ls-files --others -i --exclude-standard` scans unless the hook is explicitly opt-in or advisory.
2. Preserve staged-diff scanning so `git add -f .env` still blocks even though the path is ignored.
3. Any scanner expansion needs paired block/allow tests: one real staged hazard that must block and one ignored local-state fixture that must not wedge the agent.

## Footgun: Per-item subprocess spawning in hooks is ~40x more expensive on Windows Git Bash

**Status:** active | **Created:** 2026-08-01 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Whether a hook may call out to `sed`/`tr`/`awk`/`grep`/`git` once per line, per key, or per file - on Windows that design cannot meet any realistic hook timeout, so batch or use bash builtins instead.
**Trigger phase:** ACT

**Symptoms:** A hook is comfortably fast on Linux and unusably slow on Windows Git Bash, with `sys` time near half of wall clock. Claude Code shows the turn parked on `running stop hook · 4m 40s`. Because the runner kills a hook that exceeds its registered timeout, a scan that cannot finish reports nothing and is indistinguishable from a clean pass - the correctness failure is worse than the latency.

**Why it happens:** MSYS2/Cygwin has no `fork()`; it emulates process creation, so every subshell or external command costs orders of magnitude more than on Linux. A design that spawns per line looks linear during Linux development and becomes fork-bound on Windows. `$(...)` counts even with no external binary, because the subshell itself is the expensive part.

**Evidence:**
- 2026-08-01 measured on Windows 11 Pro 10.0.26200, Git Bash bash 5.3.15 (x86_64-pc-cygwin), NTFS: one forked pipeline costs ~44ms (200 pipelines = 8.852s) while 20,000 pure-bash loop iterations cost 0.151s (~7.5us each). One fork is worth roughly 2,900 bash operations.
- Same-workload comparison of `post-turn-safety.sh` (25 changed / 22 staged / 375 added lines across 10 env-assignment files, zero findings, exit 0): the pre-fix per-line design ran **4m22.109s** on Windows Git Bash but only **6.465s** on Linux (WSL2, bash 5.2.21) - a ~40x platform penalty on identical code. The batched rewrite runs **0.655s** on Windows and **0.027s** on Linux.
- The pre-fix hot path spawned two `sed` per scanned line plus per-call `sed`/`tr` in helpers, and one `git diff` per changed path. Current batched anchors: `workflow/hooks/post-turn-safety.sh` (search: `run_diff_batch`), (search: `gate_scannable_files`), and (search: `scan_content_files`).
- This reasoning does NOT generalise to every hook: the same day, removing forks from `deny-dangerous.sh` made it slower. See the entry below before applying it elsewhere.

**Prevention:**
1. In hook code, keep per-line and per-key work in bash builtins: `${var,,}` instead of `tr`, `${var##+([[:space:]])}` instead of a trim `sed`, `[[ =~ ]]` capture instead of `sed -nE 's/.../\1/p'`. Return through a global rather than `$(...)` so the call does not fork.
2. Batch git plumbing. One `git diff --unified=0 -- <paths>` with `+++ b/<path>` header attribution replaces one diff per file; `git cat-file --batch-check` replaces per-path `cat-file -s`; `wc -c` and `grep -Il` accept many paths per call. Chunk argument lists (~64 paths) to stay under the Windows command-line limit.
3. Put a cheap superset pre-filter in front of expensive per-line analysis, and document why each pattern is a provable superset of the real triggers so the filter cannot silently narrow detection.
4. Benchmark hooks on Windows Git Bash, not only Linux. A Linux-only benchmark hides this entire class of defect.
5. Give any bounded-time hook its own wall-clock budget that reports an explicit incomplete-scan message and a non-zero exit, and register a runner timeout above that budget. Silent truncation by the harness must not be reachable.

## Footgun: Policy modules must share one prepared command context

**Status:** active | **Created:** 2026-08-01 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Whether each PreToolUse policy module may prepare its own segment context - it may not; preparation belongs to the dispatcher and adding a policy must not multiply parsing work.
**Trigger phase:** ACT

**Symptoms:** Every Bash tool call carries a visible pause before the command runs, scaling with command complexity and the number of policy modules rather than with anything about the repository. The regression signature is more than one `prepare_segment_context` trace for a simple command, or a policy module calling that function directly.

**Why it happens:** The dispatcher runs on every Bash PreToolUse. When its policy checks independently call `prepare_segment_context`, the shared tokenisers (`split_shell_words_into`, `normalize_command_candidate`, `normalize_leading_command_word`) walk the same command again for each policy. The dominant term is NOT established - see the failed fix.

**Evidence:**
- 2026-08-01, Windows 11 Git Bash, interleaved A/B, 30 invocations per cell: **272ms** per call for `--check='npm run typecheck'`, **309ms** for a four-stage pipeline, **652ms** for the JSON-stdin path (adds `jq`). Bare `bash empty.sh` is ~50ms.
- Only 6 external processes run per invocation (3 `jq`, 1 `git`, 1 `dirname`, 1 `cat`), against ~1,959 traced bash operations for a simple command and ~5,329 for a pipeline.
- One `$(fn)` costs ~12.5ms here and does NOT scale with script size (retested with 400 extra functions and a 200KB exported variable in the process).
- 2026-08-04 Linux interleaved A/B, 30 invocations per cell: hoisting preparation from three policy calls to one reduced the simple-command median from **39.08ms to 30.99ms** and the four-stage-pipeline median from **102.62ms to 93.12ms**. A 15-case byte-exact verdict comparison reported 0 mismatches, and both installed and workflow full corpora passed 327/327.
- Current anchor: `workflow/hooks/deny-dangerous.sh` (search: `Parse once per segment`). A `bash -x` trace for `npm run typecheck` records one `prepare_segment_context` call; the pre-fix checkout records three.

**Failed fix, do not repeat without new evidence:** Converting the hot tokenisers (`normalize_command_candidate`, `normalize_leading_command_word`, `first_word_base`, `drop_first_shell_word`) to fork-free `_into` forms returning through globals, plus memoizing `normalize_command_candidate`, **made the hook slower**: 272→392ms simple, 309→729ms pipeline, 652→751ms JSON, while executing ~3.3x MORE traced operations (simple 1,959→6,428). Verdicts stayed correct (272-case byte-exact corpus identical, `--self-test=full` 319/319), so it was a pure performance regression and was reverted. The cause of the 3.3x increase was not identified.

**Prevention:**
1. Measure with an INTERLEAVED A/B (alternate old/new per round). A sequential "all old, then all new" run is unreliable: the first run pays cold filesystem and git cache costs, which produced a false 2x "improvement" for a build that was actually 2x slower.
2. Do not assume a `$( )` count predicts wall clock. Substitutions actually executed per invocation are far fewer than a count of traced lines mentioning a function name suggests.
3. Prepare segment context once in `check_segment`; policy modules consume the shared `CMD_*` and `HAS_*` values. A new module must not call `prepare_segment_context` itself.
4. This is security-critical parsing: any restructuring needs `--self-test=full` green plus a byte-exact verdict corpus before and after, per `.goat-flow/skill-docs/playbooks/hook-policy-testing.md`.

## Footgun: Gitignored local artifacts make repository scans diverge between local and CI

**Status:** active | **Created:** 2026-08-07 | **Evidence:** ACTUAL_MEASURED
**Incident count:** 2 | **Latest occurrence:** 2026-08-07

**Trap:** A full-repository analyzer can silently depend on gitignored local state. The gruff warning-ratchet floor was first recorded as 448 analysed files because the scan counted `.goat-flow/hooks/run-with-bash.mjs`, the gitignored installed mirror of the tracked `workflow/hooks/run-with-bash.mjs`. Later, local `dist/cli/cli.js` satisfied the package binary check while a fresh CI checkout ran the ratchet before building `dist/` and reported `design.package-bin-missing`. In both cases local verification was green only because the developer tree contained files CI did not.

**Evidence:** Measured on 2026-08-07 while adding the ratchet: local scan `paths.analysedFiles: 448` with a `security.process-exec` identity for the gitignored mirror; the identical tree minus gitignored state analysed 447 files with no mirror identity. Measured again from a clean `git archive`: the ratchet emitted stable identity `75483f7900f8f4f6` before the build, then passed after `npm run build` with 449 analysed files. Anchors: `.gruff-ts.yaml` (search: `installed hook mirrors are gitignored local copies`), `scripts/check-gruff-warning-ratchet.mjs` (search: `minimumAnalysedFiles`), `.github/workflows/ci.yml` (search: `Build package binary`).

**Prevention:** A shared scan contract may only cover files every environment can reproduce. Before recording a coverage floor or accepted-debt manifest, ignore duplicated gitignored artifacts in the analyzer's path config and verify every manifest entry's file with `git ls-files --error-unmatch`. When a rule validates a declared generated artifact, build that artifact before the scan in every environment. Reproduce the gate from a clean tracked-tree fixture instead of trusting a developer tree that already contains build output.

## Footgun: Nested template literals can blind the gruff-ts block scanner to everything after them

**Status:** active | **Created:** 2026-08-07 | **Evidence:** ACTUAL_MEASURED

**Trap:** A template literal nested inside another template's `${...}` interpolation (for example `` `${JSON.stringify({ reason: `text ${value}` })}` ``) breaks gruff-ts 0.4.0 function-block detection: the scanner treats the inner backtick as closing the outer template, misreads the following braces, and attributes the rest of the file to the enclosing function. Findings inside the blinded region simply never appear, so the file reads cleaner than it is - the launcher's argv `spawnSync` calls produced no `security.process-exec` finding at all until the nesting was removed, and the phantom mega-function only surfaced when added lines pushed it over `size.function-length`.

**Evidence:** Measured on 2026-08-07: with nested templates in `reportUnavailable`, the analyzer reported `size.function-length` of 226 lines attributed to `reportUnavailable` (a ~40-line function) and zero process-exec findings for the file; after replacing the nested template with plain concatenation, the phantom finding disappeared and the file's real `spawnSync` warning appeared for the first time. Anchors: `workflow/hooks/run-with-bash.mjs` (search: `a template literal`), `scripts/gruff-warning-baseline.json` (search: `Hook launcher spawns validated Bash`).

**Prevention:** Treat a suspiciously clean gruff result on a file with nested template literals as unparsed, not clean. Prefer plain concatenation or an extracted variable over templates nested inside interpolations in analyzed source, and when a size/complexity finding names a function far smaller than the reported span, suspect scanner blinding before refactoring the named function.

---

## Footgun: A `-diff` gitattribute blinds content scanners that enumerate changed paths

**Status:** active | **Created:** 2026-08-10 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A post-turn or pre-commit content scanner reports a changed path as unscannable and refuses to claim coverage, even though the file is plain text. Marking it `text` alone does not clear the report.

**Evidence:**
- `.goat-flow/hooks/post-turn-safety.sh` (search: `binary changed path not scanned`) builds its inventory from `git diff --numstat` and treats every `-\t-\t<path>` record as a coverage gap.
- `.gitattributes` (search: `package-lock.json`) previously carried `binary`. `git diff --numstat` emitted `-\t-\tpackage-lock.json` while `file` reported JSON text data with zero NUL bytes.
- Switching to `text -diff` did **not** fix it: `-diff` alone still suppresses numstat counts. Only removing `-diff` restored `2\t2\tpackage-lock.json`.

**Why it happens:** `binary` is shorthand for `-text -diff`, and it is `-diff` - not `-text` - that makes numstat report a path as uncountable. A scanner reading numstat therefore cannot distinguish a real binary from a text file whose diff is merely suppressed.

**Prevention:** To keep a generated file out of review noise without blinding scanners, use `text linguist-generated=true`, which collapses the diff in GitHub review while leaving numstat counts intact. Reserve `-diff` for genuinely unreadable content. After changing a lockfile attribute, confirm with `git diff --numstat -- <path>` that real counts appear.

## Resolved Entries

> Historical record. These entries are no longer active traps.

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
- `workflow/install-goat-flow.sh` (search: `managedScripts`) includes `gruff-code-quality.sh` in the managed migration set.
- `workflow/install-goat-flow.sh` (search: `appendGruffHookEntries`) re-adds central gruff registrations from the enabled hook toggle rather than preserving stale per-agent paths.
- `workflow/install-goat-flow.sh` (search: `configuredHookEnabled`) reads the existing config toggle so enabled optional hooks survive upgrades while disabled hooks stay absent.

**Prevention:** Add every future optional hook to the managed removal list before legacy files are pruned. Rebuild registrations from current registry and config state, preserve desired toggles for unsupported providers, and add upgrade fixtures whenever install paths or delivery support changes.

## Footgun: Fail-soft analyzer skips can silently uncover a configured language

**Status:** resolved | **Created:** 2026-06-09 | **Resolved:** 2026-07-17 | **Evidence:** OBSERVED

**Resolution:** Missing project configuration still exits silently, but a matching `.gruff-<lang>.yaml` with no discoverable analyzer now emits a targeted stderr diagnostic while preserving fail-soft exit 0. The focused regression `test/integration/gruff-code-quality-smoke.test.ts` (search: `exits silently when project config is missing and diagnoses configured languages without a binary`) verifies both sides of that boundary.

**Original symptoms:** A project had a root `.gruff-<lang>.yaml` config, the matching language file was edited, and the PostToolUse hook exited 0 with no output. The agent saw no gruff feedback and could infer the changed lines were clean while the analyzer never ran.

**Why it happened:** `gruff-code-quality.sh` is intentionally fail-soft for missing config, unsupported files, no `jq`, and no changed-line range. It was dangerous when a matching config existed but `discover_binary` missed the analyzer, because the project had opted that language into gruff coverage. A measured monorepo incident kept `gruff-py` only under `strands_agents/.venv/bin/gruff-py`; ADR-032 correctly rejected automatic `*/.venv/bin` discovery, so the old hook returned 0 silently and left Python uncovered.

**Durable anchors:**
- Diagnostic path: `workflow/hooks/gruff-code-quality.sh` (search: `present but %s not found on search paths`).
- Config-error path: `workflow/hooks/gruff-code-quality.sh` (search: `config_error_message`).
- Explicit override coverage: `test/integration/gruff-code-quality-smoke.test.ts` (search: `uses an explicit env override for a non-standard monorepo gruff binary`).
- Security constraint: `.goat-flow/learning-loop/decisions/ADR-032-scope-gruff-hook-binary-discovery.md` (search: `Scope gruff-code-quality hook binary discovery to standard install locations`).

**Prevention:** Keep config-present/binary-absent visible while preserving fail-soft exit 0 and ADR-032's no-recursive-discovery rule. Monorepos with managed analyzers outside standard paths must use an explicit executable override.
