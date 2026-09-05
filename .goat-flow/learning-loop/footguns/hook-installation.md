---
category: hook-installation
last_reviewed: 2026-09-05
---

**Scope:** Hook install, launch, registration, and config-drift plumbing. The `deny-dangerous` policy parser lives in [deny-shell.md](deny-shell.md), [deny-secrets.md](deny-secrets.md), and [deny-writes.md](deny-writes.md); runtime delivery and provider adapters live in [hooks.md](hooks.md).

## Footgun: Hook toggles can scaffold uninstalled agent surfaces

**Status:** active | **Created:** 2026-05-27 | **Evidence:** ACTUAL_MEASURED

**Prevention:**
1. Treat hook support and agent installation as different facts: support comes from the manifest, installation from target-project surfaces.
2. Do not count shared markers such as `AGENTS.md` or `.agents/skills/` as a per-agent opt-in when several profiles share them.
3. On disable, remove existing residue, but never create a missing hook config just to remove an entry from it.
4. Regenerate installed configs through the hook writer so project toggles survive; raw template copies are only defaults.

**Symptoms:** A hook toggle against a clean target creates agent config and hook files for agents the target never opted into, so setup and audit look agent-aware after a one-toggle request.

**Why it happens:** A registrar loop over supported agents treated support metadata as installation evidence, and the config writer treated a missing JSON file as `{}`, so an unguarded toggle created `.claude/settings.json`, `.codex/hooks.json`, `.agents/hooks.json`, `.github/hooks/hooks.json`, and hook script directories from scratch.

**Evidence:** Pre-fix, `hooks disable deny-dangerous <clean-dir>` created all four configs plus `.goat-flow/config.yaml`, and `hooks enable` created scripts under every agent hook directory. `src/cli/server/hook-registrar.ts` (search: `shouldReconcileAgent`) now gates writes on detected surfaces or existing residue; `test/unit/hook-registrar-surfaces.test.ts` (search: `does not scaffold uninstalled agent surfaces`) locks it. On 2026-08-09, copying Copilot's baseline template over its installed config removed an explicitly enabled Gruff hook until `src/cli/audit/check-drift-hooks.ts` (search: `applyExplicitHookToggles`) restored the project toggle.

## Footgun: Hook command strings can fail before guard code starts

**Status:** active | **Created:** 2026-05-27 | **Evidence:** ACTUAL_MEASURED
**Incident count:** 8 | **Latest occurrence:** 2026-08-27

**Prevention:**
1. Treat configured-launcher replay as part of hook verification, and fail hard on exit 126 or 127 even when direct script self-tests pass.
2. Runtime smoke must execute the configured handler, the exec-form argv or the command string, or a parser-backed equivalent that validates every wrapper component. Never substitute `bash <scriptPath>` for a launcher that carries resolver logic.
3. When a launcher falls back to a root variable, `cd "$root"` before running the hook or pass root through a contract the hook consumes; resolving only the script path fails when the hook recomputes repo state from cwd.
4. Match deny, gruff, and post-turn registrations by their primary script or historical aliases, never by the shared `run-with-bash.mjs` launcher.
5. Keep configured-command replay and provider capture as separate evidence. A passing replay proves the selected command path; only the provider loading, firing, and delivering that exact registration renews an event-delivery gate.
6. When a hook fails only in a consumer, compare its installed package template with the current generator before touching runtime code; `hooks sync` from an older package cannot materialize a field that package never shipped.
7. Command shapes differ by agent: Claude registers an exec-form `node` handler with an `args` tuple; Codex keeps its non-Windows `command` and adds `commandWindows`; Copilot and Antigravity keep command strings. All use the Node bootstrap and `run-with-bash.mjs`, all resolve the active git root, non-Codex agents may fall back to `$CLAUDE_PROJECT_DIR` outside git, and Codex fails closed without a complete managed root.

**Symptoms:** Direct hook self-tests pass, but an agent session reports a PreToolUse failure with exit 126 or 127 before any `BLOCKED:` or deny JSON appears. The script runs when launched by hand, so the failure looks like a runtime mystery rather than a stale or unsupported command string.

**Why it happens:** Agent configs name launch paths, not the abstract hook file. A stale path, lost executable bit, unsupported shell substitution, cwd assumption, or host-shell retokenization fails before `deny-dangerous.sh` starts, and a `bash workflow/hooks/<guard>.sh` smoke test skips that surface entirely.

**Evidence:** Preflight and audit parse the configured command strings from every agent config, require an exact guard script path, and replay them with safe deny payloads: `scripts/preflight-checks.sh` (search: `configured_hook_smoke_output`) and `src/cli/audit/check-agent-deny-runtime.ts` (search: `configuredGuardCommands`). Contract anchors: `workflow/hooks/README.md` (search: `Failure Modes / Runtime Contracts`) and `src/cli/server/agent-hook-command.ts` (search: `managed root unavailable`).

**Incident ledger:**
- **Recurrence 2026-06-01:** `verifyConfiguredHookRuntime` parsed the configured command but launched `bash` against `configured.scriptPath`, so a broken `$root` resolver or stale wrapper passed audit. It now executes `configured.command` directly: `src/cli/audit/check-agent-deny-runtime.ts` (search: `verifyConfiguredHookRuntime`), `test/unit/audit-command/agent-deny-hooks-drift.test.ts` (search: `exact configured hook command points at a stale path`), `test/unit/audit-command/agent-deny-hooks.test.ts` (search: `hides the script path in shell text`).
- **Recurrence 2026-06-04 (PR #47):** the launcher added a `$CLAUDE_PROJECT_DIR` fallback for the script path but still ran from the old cwd, so the dispatcher recomputed policy root from the wrong directory. The Node launcher now preserves the corrected root as child cwd: `src/cli/server/agent-hook-command.ts` (search: `hookLaunchBootstrap`), `workflow/hooks/deny-dangerous.sh` (search: `resolve_goat_flow_root_from_git`), `workflow/hooks/agent-config/claude.json` and `.claude/settings.json` (search: `CLAUDE_PROJECT_DIR`).
- **Recurrence 2026-06-09 (Codex):** bare `.goat-flow/hooks/deny-dangerous.sh` commands exited 127 from a nested cwd. The shell wrapper became a Node bootstrap plus managed Bash launcher: `workflow/hooks/agent-config/codex-hooks.json` (search: `run-with-bash.mjs`), `src/cli/server/agent-hook-command.ts` (search: `rootEnvironmentName`), `test/unit/hook-registrar.test.ts` (search: `generated Codex launchers resolve the active root`).
- **Recurrence 2026-08-06:** adding `run-with-bash.mjs` to every spec made per-spec matching treat the shared file as proof that any hook was installed, so drift tests removed or cross-matched unrelated entries. The shared recognizer excludes it: `src/cli/server/agent-hook-command.ts` (search: `script !== "run-with-bash.mjs"`).
- **Recurrence 2026-08-13 (Windows):** every transport mangled the 5,648-character inline `node -e` command before policy code ran: cmd.exe exited 255, PowerShell failed parsing, and the provider `bash -c` round-trip collapsed `\\` and `\"` into a Node `[eval]:1` SyntaxError. ADR-053 moved Claude to an exec-form handler no host shell retokenizes, and a live capture then delivered `BLOCKED: Policy destructive:` at exit 2. Anchors: `src/cli/server/agent-hook-command.ts` (search: `structuredHookLaunchBootstrap`), `.goat-flow/learning-loop/decisions/ADR-053-claude-structured-hook-descriptors.md` (search: `exec form`), `test/integration/hook-command-spawn-matrix.test.ts` (search: `hostile-named root`).
- **Recurrence 2026-08-22 (Codex on Windows):** Codex's inline `command` still failed under PowerShell, which also rewrote `$PWD` for a hostile-named cwd and surfaced a native exit 2 as hook-failure exit 1. The `commandWindows` override Base64-transports the bootstrap, restores the literal OS cwd, starts `node.exe`, and exits with `$LASTEXITCODE`; a verifier environment must preserve Windows `Path` casing and `PATHEXT`. Exact replay returned safe 0 and deny 2 from a path containing spaces, `&`, parentheses, and brackets, and a trusted Codex CLI 0.149.0 session delivered a PreToolUse secret-path block. Anchors: `src/cli/server/agent-hook-command.ts` (search: `codexWindowsHookCommand`), `src/cli/hooks-configured-runtime-evidence.ts` (search: `agentHookSpawnDescriptor`), `test/integration/hook-command-spawn-matrix.test.ts` (search: `Windows override`).
- **Recurrence 2026-08-27 (consumer template lag):** DevGoat's published 1.16.0 install had no `commandWindows` fields. Its legacy PostToolUse command returned status 1 under PowerShell before the analyzer started; the generated override returned 0 and emitted valid PostToolUse JSON from a hostile-named cwd. A Codex CLI 0.149.1 `exec` capture from the hash-trusted goat-flow project delivered a fresh Gruff marker to the model, renewing trusted CLI-exec PostToolUse evidence through 2026-09-25T20:17:22.830Z without proving untouched DevGoat, Stop, app-server, or remote execution. Two secondary readers also hid drift: configured runtime audit selected only `command`, and the standalone installer did not recognize a managed script referenced only by `commandWindows`. Anchors: `src/cli/audit/check-agent-deny-runtime.ts` (search: `configuredHookExecutable`), `workflow/install-goat-flow.sh` (search: `entryReferencesManagedScript`), `src/cli/server/hooks-registry.ts` (search: `2026-09-25T20:17:22.830Z`), `test/integration/hook-command-spawn-matrix.test.ts` (search: `delivers a managed Gruff result through Codex's registered Windows override`).

## Footgun: Hook sync must unignore required policy files

**Status:** active | **Created:** 2026-06-01 | **Evidence:** OBSERVED

**Prevention:** Keep `ensureHookGitignoreEntries` beside every code path that writes `.goat-flow/hooks/deny-dangerous/`, keep the pre-1.9 gitignore fixture with its `git check-ignore` assertion, and before a release test the clone path: commit hook config plus hooks, clone fresh, then run `.goat-flow/hooks/deny-dangerous/deny-dangerous-self-test.sh --self-test=smoke`.

**Symptoms:** `hooks enable deny-dangerous` or `hooks sync` passes locally, but a fresh clone lacks `.goat-flow/hooks/deny-dangerous/` because a pre-1.9 `.goat-flow/.gitignore` still ignores the copied policy modules.

**Why it happens:** Pre-1.9 gitignore templates start with `*`, so any path that writes required committed files under `.goat-flow/` must append matching unignore entries. The original sync path wrote the policy store without `!hooks/` and `!hooks/**`.

**Evidence:** `src/cli/server/hook-managed-installation.ts` (search: `ensureHookGitignoreEntries`) appends both negations; `test/unit/hook-registrar-surfaces.test.ts` (search: `unignores hooks when enabling deny-dangerous on a stale goat-flow gitignore`) starts from a pre-1.9 gitignore. The broader trap is `.goat-flow/learning-loop/footguns/docs-and-crossrefs.md` (search: `Filesystem-backed validation can miss untracked or ignored replacement files`).

## Footgun: Workflow hook edits can leave the tracked installed runtime stale

**Status:** active | **Created:** 2026-08-14 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Treat every tracked workflow-hook edit as a source/install mirror change and prove byte parity before provider or repository audits.
**Trigger phase:** SCOPE
**Caught at:** ACT

**Prevention:** Before editing a tracked workflow hook, resolve its installed destination from `workflow/manifest.json` and put both paths in scope. Verify byte parity with `cmp` before provider coverage or repository audit checks; a focused contract that reads only the workflow source is incomplete.

**Symptoms:** A contract against `workflow/hooks/gruff-code-quality.sh` passes, and the repository audit fails because Claude, Codex, and Copilot still load a stale `.goat-flow/hooks/gruff-code-quality.sh`.

**Why it happens:** The workflow script is the install source; `.goat-flow/hooks/` is the tracked runtime this repository actually runs.

**Evidence:** The 2026-08-14 M02 preflight reported three stale `gruff-code-quality` installations after a wording-only edit, and `cmp` located the difference at the edited guidance (search: `Documentation wording mirrors code-comments.md`). `workflow/manifest.json` (search: `".goat-flow/hooks/gruff-code-quality.sh"`) declares the installed file, `workflow/install-goat-flow.sh` (search: `copy_file "$GOAT_FLOW_ROOT/workflow/hooks/gruff-code-quality.sh"`) performs the copy, and `test/unit/audit-command/main.test.ts` (search: `passes on this repo`) went from one failure to `pass 1`, `fail 0` after the mirror was synced.

## Footgun: Legacy per-agent hook launchers using --show-toplevel resolve to the worktree, not the main repo

**Status:** active | **Created:** 2026-05-28 | **Evidence:** ACTUAL_MEASURED

**Prevention:**
1. Central `.goat-flow/hooks` launchers resolve with `git rev-parse --show-toplevel`, because those scripts are committed with the worktree. Do not use `--git-common-dir` for central lookup; it borrows stale scripts from the primary checkout.
2. The main-root rule applies only to legacy per-agent copies under ignored `.claude/hooks/` or `.agents/hooks/`.
3. When renaming or splitting a guard, regenerate every launcher string the installer writes, and run the literal launcher from a fresh worktree before claiming it works.

**Symptoms:** Inside a `git worktree add` checkout, every Bash fails with `bash: <worktree>/.claude/hooks/<guard>.sh: No such file or directory` while the main checkout passes. The same shape appears after a hook rename when a stale launcher names the old script.

**Why it happens:** `--show-toplevel` returns the worktree directory. Legacy launchers resolved `<worktree>/.claude/hooks/<guard>.sh`, which exists only when `.claude/hooks/` is tracked; goat-flow tracks it, which masked the failure in development.

**Evidence:** A fresh worktree with `.claude/` gitignored failed every Bash on 2026-05-28. On 2026-06-09, review of `blundergoat/gruff-ts#7` caught generated `.agents/hooks.json` launchers resolving through `--git-common-dir` after the central-hook migration. Anchors: `workflow/hooks/agent-config/claude.json`, `workflow/hooks/agent-config/antigravity-hooks.json`, and `workflow/install-goat-flow.sh` (each search: `run-with-bash.mjs`); `test/unit/hook-registrar.test.ts` (search: `resolve active worktrees`); `src/cli/facts/agent/hook-registration.ts` (search: `Hook launchers prefix the script path`).

## Footgun: Hook launchers fail closed when the shell cwd is outside any git repo, wedging every Bash

**Status:** active | **Created:** 2026-06-04 | **Evidence:** ACTUAL_MEASURED
**Incident count:** 2 | **Latest occurrence:** 2026-08-09

**Prevention:**
1. Resolve Git first so worktree and submodule checkouts win, then walk upward when that root has no requested-hook trace. Select only a complete managed root and run the launcher with it as child cwd.
2. Relevance means the requested script or an exact registration operand; the shared launcher alone may belong to another hook and cannot classify a candidate as partial.
3. After the ancestor walk, consult the supported project-root environment fallback. Codex can use a complete managed ancestor without Git but fails closed when its cwd has no candidate and its host supplies no root.
4. Keep policy-root and diff-root claims separate: deny policy works in a complete non-Git installation, while post-turn scanning blocks without a trustworthy Git baseline.
5. Keep each launcher deadline below its host limit and stop the child process tree on timeout so the agent can render the bounded failure.
6. Recovery: the user types `!cd <repo>` to reset the persisted cwd. Keep scratch work in `.goat-flow/scratchpad/`, not `/tmp`; see `.goat-flow/learning-loop/lessons/agent-tooling.md` (search: "Agent wedged its own shell in /tmp and tried to bypass the guard instead of recovering").

**Symptoms:** Before 1.15.1, a session that `cd`'d outside the repo, usually to `/tmp`, had every later Bash blocked with `BLOCKED: Policy hook unavailable: git repository root unavailable.`, including `cd /path/to/repo && ...`. Current launchers recover from a complete managed ancestor without Git; a cwd outside every complete candidate still fails closed.

**Why it happens:** The old launcher made `git rev-parse` its only root source, and Claude Code keeps one cwd across Bash calls, so one `cd /tmp` gated every later command on a lookup that could not succeed there. The replacement prefers Git, then accepts only a complete managed ancestor, and rejects partial, redirected, or multiply-linked installations.

**Evidence:** 2026-06-04 live incident in `gruff-rs`: from `/tmp`, `--show-toplevel` and `--git-common-dir` both exit 128 with empty output. An end-to-end probe from `/tmp` with `$CLAUDE_PROJECT_DIR` plus the resolved child cwd allowed a benign command and blocked `rm -rf /`; without the variable, or with script-path lookup alone, it failed closed. Anchors: `src/cli/server/agent-hook-command.ts` and `workflow/hooks/agent-config/managed-hook-desired-state.json` (search: `CLAUDE_PROJECT_DIR`). On 2026-08-09 the first managed-ancestor classifier treated the shared launcher as a relevant trace, so a nested root holding another managed hook suppressed a valid outer candidate: `src/cli/server/agent-hook-command.ts` (search: `const relevant=scriptSeen||registered`) and `test/unit/hook-registrar.test.ts` (search: `skips unrelated configs but stops at a partial managed trace`). On 2026-08-10 the archived 1.15.1 CLI installed into a bare non-Git project, upgraded through `hooks sync`, allowed safe input, and denied destructive input: `test/integration/packaged-hook-install.test.ts` (search: `runs fresh install through the archived CLI bin`) and (search: `syncs a 1.15.0 install through the archived CLI bin`).

## Footgun: Copilot hook config can exist while runtime policy hooks are disabled

**Status:** active | **Created:** 2026-06-05 | **Evidence:** ACTUAL_MEASURED

**Prevention:** In release QA, label Copilot pre-tool coverage as script and config evidence until a live capture of that exact event writes a payload or emits `hook.start`. `POLICY_HOOKS: false` in Copilot's diagnostics means runtime enforcement is unavailable or limited, and a session-start capture does not prove pre-tool delivery.

**Symptoms:** `.github/hooks/hooks.json` and the deny script verify cleanly while Copilot never invokes the pre-tool hook. On 2026-06-05, Copilot CLI 1.0.54 reported `POLICY_HOOKS: false`, a live `view` ran, and the capture hook received no stdin.

**Why it happens:** Registration is config evidence only; the provider decides which events it fires and when. Copilot CLI 1.0.80 did invoke session-start registrations on 2026-08-23, recorded in `.goat-flow/learning-loop/footguns/hooks.md` (search: `Copilot combines native and Claude project hook registrations`), so support varies by version and event, and the registry still gates Copilot pre-tool as `scenario-unverified`.

**Evidence:** `workflow/hooks/agent-config/copilot-hooks.json` and `.github/hooks/hooks.json` (search: `"preToolUse"`); `src/cli/audit/check-agent-deny-runtime.ts` (search: `blockedRuntimeProbe`) validates script-shaped stdin only; `src/cli/server/hooks-registry.ts` (search: `hook-provider-adapter.v1:copilot:pre-tool`) carries the gate.

## Footgun: Codex permission profiles must match the local CLI grammar

**Status:** active | **Created:** 2026-05-19 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Admit writable subpaths only after checking their real layout, then exercise the generated profile with an allowed and denied runtime write.
**Trigger phase:** READ
**Caught at:** VERIFY

**Prevention:**
1. For Codex 0.136+, extend `:workspace` and use `deny` entries. Do not rebuild workspace write access with `"." = "write"` and `none`, and never convert back to `:project_roots`, which 0.131.0 rejects.
2. Verify Codex config changes with `codex sandbox --permissions-profile goat-flow -C <project> pwd` as well as `codex doctor`; install health misses project-profile namespace failures.
3. Change `.codex/config.toml`, `workflow/hooks/agent-config/codex.toml`, and `src/cli/facts/agent/settings.ts` in the same patch whenever the permission grammar changes.
4. Treat secret coverage as a loadable set: prefer recursive `deny` globs that leave `.env.example` readable over exact root-file entries that may be absent.
5. For generated multi-root profiles, include only real shared directories with identical protected-file layouts, prove build-path candidates are Git-ignored in every root, and runtime-probe one allowed write plus blocked tracked overwrite, rename, and delete. String assertions and `doctor` output do not prove path materialization.

**Symptoms:** Codex warns or fails before shell startup when the profile names a token, access value, base-profile shape, or exact path the installed runtime cannot load. On 0.136.0 the old `"." = "write"` profile under `:workspace_roots` failed with `bwrap: execvp ... codex: No such file or directory`; on 0.131.0 `:project_roots` was ignored and absent exact entries could break startup; on 0.145.0 a reporting profile naming absent `.goat-flow/plans` and `.goat-flow/scratchpad` write roots failed every command with `bwrap: Can't create file ... Read-only file system`.

**Why it happens:** Codex permission grammar is version-sensitive, and exact rules are materialized for every selected workspace root. Rebuilding the workspace profile from raw entries omits Codex-managed runtime paths from the bwrap namespace, and a path present in one root but absent in another aborts startup.

**Evidence:** `.codex/config.toml` and `workflow/hooks/agent-config/codex.toml` (search: `extends = ":workspace"`); `workflow/install-goat-flow.sh` (search: `active goat-flow profile does not extend`) refreshes old profiles; `src/cli/facts/agent/settings.ts` (search: `isCodexDenyMode`) reads legacy `none` and current `deny`; `src/cli/audit/check-agent-codex.ts` (search: `checkCodexWorkspaceRootExactPaths`) fails absent exact paths; `src/cli/server/terminal-reporting-profile.ts` (search: `sharedProtectedPaths`) admits a reporting write root only when it exists with the same layout across roots. Runtime captures: 2026-05-19 startup on 0.131.0 repeated `':project_roots' is not recognized by this version of Codex and will be ignored`; 2026-06-04 `codex sandbox ... pwd` failed on the old profile and succeeded with `extends=":workspace"` plus `deny`; 2026-07-26 on 0.145.0, allowed report writes exited 0 and tracked overwrite, rename, and delete probes exited 1 after layout filtering.
