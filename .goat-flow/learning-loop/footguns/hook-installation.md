---
category: hook-installation
last_reviewed: 2026-08-27
---

**Scope:** Hook install / launch / registration / config-drift plumbing. The `deny-dangerous` guardrail's shell-grammar policy parser (substitution/heredoc handling, secret-path and `git`/`gh` write classification, payload parsing) lives in [deny-shell.md](deny-shell.md) (command grammar), [deny-secrets.md](deny-secrets.md) (secret-path reads), and [deny-writes.md](deny-writes.md) (external writes).

**Last independent review:** 2026-07-26 - Codex reporting-profile path admission was runtime-probed for allowed local writes, blocked tracked writes, and absent-path startup failures. Other active entries were not reclassified by that check.

## Footgun: Hook toggles can scaffold uninstalled agent surfaces

**Status:** active | **Created:** 2026-05-27 | **Evidence:** ACTUAL_MEASURED

**Regression symptom:** A hook toggle against a clean target created agent config and hook files for agents the target never opted into, making setup and audit state look agent-aware when the project asked only to change one toggle.

**Why it happened:** A registrar loop over supported agents treated support metadata as installation evidence. The hook config writer also treated a missing JSON config as `{}`, so an unguarded disable/enable could create `.claude/settings.json`, `.codex/hooks.json`, `.agents/hooks.json`, `.github/hooks/hooks.json`, and hook script dirs from scratch.

**Evidence:**
- Pre-fix runtime probes against `<clean-temp-dir>`: `node --import tsx src/cli/cli.ts hooks disable deny-dangerous <clean-temp-dir>` created `.agents/hooks.json`, `.claude/settings.json`, `.codex/hooks.json`, `.github/hooks/hooks.json`, and `.goat-flow/config.yaml`; the `hooks enable deny-dangerous` form created hook scripts under `.agents/hooks/`, `.claude/hooks/`, `.codex/hooks/`, and `.github/hooks/`.
- Guard anchors: `src/cli/server/hook-registrar.ts` (search: `shouldReconcileAgent`) gates writes on detected installed surfaces or existing hook residue; `test/unit/hook-registrar-surfaces.test.ts` (search: `does not scaffold uninstalled agent surfaces`) locks the clean-target regression.
- 2026-08-09 recurrence: copying Copilot's baseline template over its installed config removed the explicitly enabled Gruff hook. Audit expected the project toggle and reported drift until the writer restored it. Anchor: `src/cli/audit/check-drift-hooks.ts` (search: `applyExplicitHookToggles`).

**Prevention:**
1. Treat hook support and agent installation as different facts. Support comes from the manifest; installation from target-project surfaces.
2. Don't count shared markers such as `AGENTS.md` or `.agents/skills/` as a per-agent hook opt-in when multiple profiles share them.
3. On disable, remove existing hook residue, but don't create a missing hook config file just to remove an entry from it.
4. Regenerate installed configs through the hook writer so project toggles survive; raw template copies are only defaults.

## Footgun: Hook command strings can fail before guard code starts

**Status:** active | **Created:** 2026-05-27 | **Evidence:** ACTUAL_MEASURED
**Incident count:** 8 | **Latest occurrence:** 2026-08-27

**Symptoms:** Direct hook self-tests pass, but an agent session reports a PreToolUse failure with exit 126 or 127 before any `BLOCKED:` or deny JSON appears. The script exists and works when launched manually, so the failure looks like a runtime mystery rather than a stale/unsupported command string.

**Why it happens:** Agent configs name launch paths, not the abstract hook file. A stale path, lost executable bit, unsupported shell substitution, or cwd assumption can fail before `deny-dangerous.sh` and the thin hook code start. Direct `bash workflow/hooks/<guard>.sh` smoke tests skip that surface.

**Evidence:**
- Preflight/audit parse configured command strings from `.claude/settings.json`, `.codex/hooks.json`, `.agents/hooks.json`, and `.github/hooks/hooks.json`, require an exact guard script path, then run that guard with safe deny payloads. Anchors: `scripts/preflight-checks.sh` (search: `configured_hook_smoke_output`), `src/cli/audit/check-agent-deny-runtime.ts` (search: `configuredGuardCommands`).
- 2026-06-01 release-review recurrence (now fixed): an earlier `verifyConfiguredHookRuntime` parsed the configured command but launched `bash` against `configured.scriptPath`, so a broken `$root` resolver, stale wrapper, syntax error, or executable-bit failure could pass audit while the configured agent command failed before guard startup. `src/cli/audit/check-agent-deny-runtime.ts` (search: `verifyConfiguredHookRuntime`) now executes the configured launcher string (`configured.command`) directly, and the drift tests below lock that it must not fall back to the bare script path.
- `test/unit/audit-command/agent-deny-hooks-drift.test.ts` (search: `exact configured hook command points at a stale path`) locks the stale-path case; `test/unit/audit-command/agent-deny-hooks.test.ts` (search: `hides the script path in shell text`) locks the unsafe hidden-script-path case. Runtime contract anchors: `workflow/hooks/README.md` (search: `Failure Modes / Runtime Contracts`) and `src/cli/server/agent-hook-command.ts` (search: `managed root unavailable`).
- 2026-06-04 PR #47 review recurrence: the generated launcher added a `$CLAUDE_PROJECT_DIR` fallback for the script path but still ran `bash "$root/..."` from the old cwd, so the dispatcher recomputed policy root from the wrong directory and failed closed outside a repo. The current Node launcher preserves the corrected root as its child cwd. Anchors: `src/cli/server/agent-hook-command.ts` (search: `hookLaunchBootstrap`), `workflow/hooks/deny-dangerous.sh` (search: `resolve_goat_flow_root_from_git`), `workflow/hooks/agent-config/claude.json` (search: `CLAUDE_PROJECT_DIR`), and `.claude/settings.json` (search: `CLAUDE_PROJECT_DIR`).
- 2026-06-09 recurrence for Codex: bare `.goat-flow/hooks/deny-dangerous.sh` commands exited 127 from a nested cwd, while a root-resolving wrapper reached the central policy. The current cross-platform implementation replaces that shell wrapper with a Node bootstrap and managed Bash launcher. Current anchors: `workflow/hooks/agent-config/codex-hooks.json` (search: `run-with-bash.mjs`), `src/cli/server/agent-hook-command.ts` (search: `rootEnvironmentName`), and `test/unit/hook-registrar.test.ts` (search: `generated Codex launchers resolve the active root`).
- 2026-08-06 launcher migration recurrence: adding `run-with-bash.mjs` to every hook spec made naive per-spec registration matching treat the shared support file as proof that any managed hook was installed. Focused drift tests then removed or cross-matched unrelated deny, gruff, and post-turn entries. Current guards explicitly exclude the shared launcher from identity checks in the shared recognizer `src/cli/server/agent-hook-command.ts` (search: `script !== "run-with-bash.mjs"`), which the writer and drift audit both consume since the ADR-053 descriptor consolidation.
- 2026-08-13 Windows recurrence (measured): every Windows transport mangled the registered 5,648-character inline `node -e` command before policy code started - cmd.exe exited 255, PowerShell failed parsing, and the provider `bash -c` argv round-trip collapsed `\\` and `\"` into a Node `[eval]:1` SyntaxError. A Bash file control ran the same bootstrap, isolating the failure to command transport. ADR-053 migrates Claude to an exec-form handler (`command: "node"` plus an ordered `args` tuple) that no host shell retokenizes; catchable failures after Node starts return the provider's unavailable response, while a host that cannot start `node` stays an explicit prerequisite. A live capture on the same host then delivered `BLOCKED: Policy destructive:` at exit 2 in a real Claude Code session. Anchors: `src/cli/server/agent-hook-command.ts` (search: `structuredHookLaunchBootstrap`), `.goat-flow/learning-loop/decisions/ADR-053-claude-structured-hook-descriptors.md` (search: `exec form`), `test/integration/hook-command-spawn-matrix.test.ts` (search: `hostile-named root`).
- 2026-08-22 Codex Windows recurrence (measured): Codex's unchanged inline `command` still failed under Windows PowerShell before policy startup. The first override also exposed three host-specific traps: raw bootstrap text was unsafe to transport, PowerShell changed `$PWD` to its install directory for a hostile-named cwd even though `[Environment]::CurrentDirectory` stayed correct, and an unhandled native exit 2 surfaced as hook-failure exit 1. The final `commandWindows` Base64-transports the trusted bootstrap, restores the literal OS cwd, starts `node.exe`, and explicitly exits with `$LASTEXITCODE`. A minimal verifier environment must preserve Windows `Path` casing and `PATHEXT`. Exact replay then returned safe 0 and deny 2 from a path containing spaces, `&`, parentheses, and brackets. An initial Codex CLI 0.149.0 disposable capture did not load project hooks; a fresh session in this already-trusted project then loaded the exact registration and delivered a PreToolUse secret-path block before shell execution. That event-specific proof does not renew PostToolUse or Stop. Anchors: `src/cli/server/agent-hook-command.ts` (search: `codexWindowsHookCommand`), `src/cli/hooks-configured-runtime-evidence.ts` (search: `agentHookSpawnDescriptor`), `test/integration/hook-command-spawn-matrix.test.ts` (search: `Windows override`).
- **Recurrence 2026-08-27:** DevGoat's published 1.16.0 installation had zero `commandWindows` fields while the current Goat Flow checkout had three. Replaying DevGoat's exact legacy PostToolUse command under Windows PowerShell returned status 1 before the analyzer started; the generated override returned status 0, started the analyzer, and emitted valid PostToolUse JSON from a cwd containing spaces, an apostrophe, `&`, parentheses, and brackets. A Codex CLI 0.149.1 capture in a disposable generated fixture then applied the requested change, exited 0 with empty stderr, ran Gruff, and surfaced an analyzer-only marker to the model; because that first capture bypassed hook trust, it proved only the exact fixture. A follow-up 0.149.1 `exec` capture ran from the hash-trusted Goat Flow project without the bypass flag, completed `apply_patch`, started both analyzer exchanges, and delivered a fresh marker to the model. That renews trusted CLI-exec PostToolUse evidence through 2026-09-25T20:17:22.830Z, but it does not prove untouched DevGoat, Stop, app-server, or remote execution. The review also found two secondary readers that could hide or preserve drift: configured runtime audit selected only `command`, and the standalone installer did not recognize a managed script referenced only by `commandWindows`. Current anchors: `src/cli/audit/check-agent-deny-runtime.ts` (search: `configuredHookExecutable`), `workflow/install-goat-flow.sh` (search: `entryReferencesManagedScript`), `src/cli/server/hooks-registry.ts` (search: `2026-09-25T20:17:22.830Z`), and `test/integration/hook-command-spawn-matrix.test.ts` (search: `delivers a managed Gruff result through Codex's registered Windows override`).

**Prevention:**
1. Treat configured guard-script replay as part of hook verification, not an optional integration smoke.
2. Fail hard on exit 126/127 even when direct script self-tests pass.
3. Document command-shape differences: Claude registers an exec-form `node` handler with an `args` tuple; Codex keeps its non-Windows `command` and adds `commandWindows`; Copilot and Antigravity keep command strings. Every shape uses the Node bootstrap and `run-with-bash.mjs`, all resolve the active git root, non-Codex agents may use `$CLAUDE_PROJECT_DIR` as a fallback outside git, and Codex fails closed without a complete managed root.
4. Runtime smoke must execute the configured handler - the exec-form argv or the command string - or a parser-backed equivalent validating every wrapper component. Don't replace a configured command with `bash <scriptPath>` when it contains resolver logic or direct executable invocation.
5. When a launcher falls back to a root variable, either `cd "$root"` before running the hook or pass root through a contract the hook consumes; resolving only the script path fails when the hook recomputes repo state from cwd.
6. Shared support files belong in install/sync ownership, but not in per-hook registration identity. Match deny, gruff, and post-turn entries by their primary script or historical aliases, never by a launcher every spec shares.
7. Keep configured-command replay and provider capture as separate evidence. A passing PowerShell replay proves the selected command path; it cannot renew a Codex event-delivery gate unless the provider itself demonstrably loads, fires, and delivers that exact registration.
8. When a hook failure appears only in a consumer, compare its installed package template with the current generator before changing runtime code. A source-only correction requires a package release; running `hooks sync` from the affected package cannot materialize a field that package never shipped.

## Footgun: Hook sync must unignore required policy files

**Status:** active | **Created:** 2026-06-01 | **Evidence:** OBSERVED

**Symptoms:** Historical pre-fix failure: `goat-flow hooks enable deny-dangerous` or `goat-flow hooks sync` made local checks pass, but a fresh clone lacked `.goat-flow/hooks/deny-dangerous/` because stale `.goat-flow/.gitignore` rules still ignored the copied policy modules.

**Why it happens:** Pre-1.9 `.goat-flow/.gitignore` templates use a leading `*`; any CLI/dashboard path that writes required committed files under `.goat-flow/` must append matching unignore entries. The original hook sync path wrote `.goat-flow/hooks/deny-dangerous/` without adding `!hooks/` and `!hooks/**`.

**Evidence:**
- Current repair: `src/cli/server/hook-managed-installation.ts` (search: `ensureHookGitignoreEntries`) appends both negations whenever hook sync writes the shared policy store.
- Regression: `test/unit/hook-registrar-surfaces.test.ts` (search: `unignores hooks when enabling deny-dangerous on a stale goat-flow gitignore`) starts from a pre-1.9 gitignore and asserts both negations are added.
- Broader trap: `.goat-flow/learning-loop/footguns/docs-and-crossrefs.md` (search: `Filesystem-backed validation can miss untracked or ignored replacement files`) records how filesystem checks can pass with ignored `.goat-flow/*` files.

**Prevention:**
1. Preserve `ensureHookGitignoreEntries` beside any code path that writes `.goat-flow/hooks/deny-dangerous/`.
2. Keep the pre-1.9 gitignore regression fixture and `git check-ignore` assertion for `.goat-flow/hooks/deny-dangerous/patterns-shell.sh`.
3. Before release, test the clone path: commit hook config plus hooks, clone fresh, then run `.goat-flow/hooks/deny-dangerous/deny-dangerous-self-test.sh --self-test=smoke`.

## Footgun: Workflow hook edits can leave the tracked installed runtime stale

**Status:** active | **Created:** 2026-08-14 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Treat every tracked workflow-hook edit as a source/install mirror change and prove byte parity before provider or repository audits.
**Trigger phase:** SCOPE
**Caught at:** ACT

**Symptoms:** A focused contract against `workflow/hooks/gruff-code-quality.sh` passed, but the repository audit failed because Claude, Codex, and Copilot still loaded a stale `.goat-flow/hooks/gruff-code-quality.sh`.

**Why it happens:** The workflow script is the install source while `.goat-flow/hooks/` is the tracked runtime used in this repository. A test that reads only the workflow source can prove its wording without proving the active runtime received the same edit.

**Evidence:**
- The 2026-08-14 M02 preflight reported three `gruff-code-quality` installations stale after a wording-only workflow edit; `cmp workflow/hooks/gruff-code-quality.sh .goat-flow/hooks/gruff-code-quality.sh` located the first difference at the edited guidance anchor (search: `Documentation wording mirrors code-comments.md`).
- `workflow/manifest.json` (search: `".goat-flow/hooks/gruff-code-quality.sh"`) declares the installed file's source, and `workflow/install-goat-flow.sh` (search: `copy_file "$GOAT_FLOW_ROOT/workflow/hooks/gruff-code-quality.sh"`) performs that copy for consumers.
- After the installed mirror received the same two lines, byte comparison returned zero and `test/unit/audit-command/main.test.ts` (search: `passes on this repo`) changed from one failure to `pass 1`, `fail 0`.

**Prevention:**
1. Before editing a tracked workflow hook, resolve its installed destination from `workflow/manifest.json` and include both paths in scope.
2. Keep source and installed hook bodies byte-identical; verify with `cmp` before running provider coverage or repository audit checks.
3. A focused hook contract must exercise the active installed runtime or be paired with mirror parity. Workflow-source assertions alone are incomplete.

## Footgun: Legacy per-agent hook launchers using --show-toplevel resolve to the worktree, not the main repo

**Status:** active | **Created:** 2026-05-28 | **Evidence:** ACTUAL_MEASURED

**Current scope:** Active for legacy per-agent hook copies; superseded for central `.goat-flow/hooks` launchers, which must use the active worktree root.

**Symptoms:** A Claude or Antigravity session inside a `git worktree add` checkout fails every Bash with a PreToolUse error like `bash: /path/to/repo/.claude/worktrees/<branch>/.claude/hooks/<guard>.sh: No such file or directory`. Direct self-tests in the main repo pass; guards run fine outside the worktree. The same shape appears after a hook rename if a stale launcher references the old script name.

**Why it happens:** Inside a worktree, `git rev-parse --show-toplevel` returns the worktree's working directory, not the main repo's. The earlier Claude/Antigravity launcher resolved the script path against `--show-toplevel`, looking for `<worktree>/.claude/hooks/<guard>.sh` — which exists only if `.claude/hooks/` is git-tracked. Many projects gitignore `.claude/` entirely, so `git worktree add` checks out no hook scripts and every guard fails before its code starts. Goat-flow's repo tracks `.claude/hooks/`, masking this in development.

**Evidence:**
- Pre-fix runtime probe: a fresh worktree at `<project>/.claude/worktrees/feat+x/` with `.claude/` gitignored started every Bash with `bash: <worktree>/.claude/hooks/patterns-shell.sh: No such file or directory`. The repro inside goat-flow succeeded only because `git ls-files | grep '^\.claude/hooks/'` lists all guard scripts; a fresh worktree inherited them via the branch checkout.
- 2026-06-09 recurrence after the 1.10 central-hook migration: PR review on `blundergoat/gruff-ts#7` caught generated `.agents/hooks.json` launchers still resolving through `git rev-parse --git-common-dir`, which now points at the primary checkout in a linked worktree and can run stale `.goat-flow/hooks` scripts from the wrong checkout. Central hooks are committed under `.goat-flow/hooks`, so the active worktree root is now the correct root.
- Anchors: central-hook launchers in `workflow/hooks/agent-config/claude.json`, `workflow/hooks/agent-config/antigravity-hooks.json`, and `workflow/install-goat-flow.sh` (each search: `run-with-bash.mjs`); generated launcher tests in `test/unit/hook-registrar.test.ts` (search: `resolve active worktrees`); the normalizer at `src/cli/facts/agent/hook-registration.ts` (search: `Hook launchers prefix the script path`) recognizes configured script paths for audit.

**Prevention:**
1. Central `.goat-flow/hooks` launchers MUST resolve to the active worktree root with `git rev-parse --show-toplevel`, because those scripts are committed with the worktree. Do not use `--git-common-dir` for central hook lookup; that can borrow stale scripts from the primary checkout.
2. The old main-root rule only applies to legacy per-agent hook copies stored under ignored `.claude/hooks/` or `.agents/hooks/`.
3. When renaming or splitting a guard, regenerate every launcher string the installer writes, not just the hook script; a stale launcher reproduces this even when the main repo has the new scripts.
4. Add worktree coverage to any future configured-command smoke probe: run the literal launcher from a fresh worktree, not just the main checkout, before claiming it works.

## Footgun: Hook launchers fail closed when the shell cwd is outside any git repo, wedging every Bash

**Status:** active | **Created:** 2026-06-04 | **Evidence:** ACTUAL_MEASURED
**Incident count:** 2 | **Latest occurrence:** 2026-08-09

**Symptoms:** Before 1.15.1, a Claude/Antigravity session that `cd`'d outside the repo (usually `/tmp` for scratch) had every later Bash blocked by `BLOCKED: Policy hook unavailable: git repository root unavailable.` The block fired before the command, so even `cd /path/to/repo && ...` was rejected. Current launchers recover from a complete managed ancestor without Git; a cwd outside every complete candidate still fails closed.

**Why it happens:** The old launcher made `git rev-parse` its only root source. Claude Code keeps one cwd across Bash calls, so one `cd /tmp` gated every later command on a Git lookup that could not succeed there. Script-path lookup alone was insufficient because policy also needed a verified project cwd. The replacement prefers Git for worktree correctness, then accepts only a complete managed ancestor; it deliberately rejects partial, redirected, or multiply-linked installations.

**Evidence:**
- 2026-06-04 live incident: a session in `~/projects/gruff-workspace/gruff-rs` cd'd to `/tmp`, after which every Bash returned `Guard cannot start: git repository root unavailable.`; `cd <repo> && pwd` was blocked too. Both launcher generations fail from `/tmp`: `git rev-parse --show-toplevel` and `--git-common-dir` each exit 128 with empty output → fail-closed branch.
- End-to-end probe (real guard, from `/tmp`): WITH `$CLAUDE_PROJECT_DIR` + the resolved child cwd → benign allowed (exit 0), `rm -rf /` blocked (exit 2); WITHOUT the env var → fail-closed (exit 2); script-path lookup alone (without the corrected cwd) still failed closed. Anchors: `src/cli/server/agent-hook-command.ts` and generated `workflow/hooks/agent-config/managed-hook-desired-state.json` (search: `CLAUDE_PROJECT_DIR`).
- 2026-08-09 recurrence: the first managed-ancestor classifier treated the shared `run-with-bash.mjs` as a relevant requested-hook trace. A nested root with only another managed hook would therefore appear corrupt and suppress a valid outer candidate. Relevance now requires the requested script or an exact registration operand; the shared launcher is validated only after that threshold is met. Anchors: `src/cli/server/agent-hook-command.ts` (search: `const relevant=scriptSeen||registered`) and `test/unit/hook-registrar.test.ts` (search: `skips unrelated configs but stops at a partial managed trace`).
- 2026-08-10 packaged-bin reproduction: archived 1.15.1 bytes installed into a bare non-Git project, upgraded exact tagged 1.15.0 launcher bytes through `hooks sync`, allowed safe input, and denied destructive input. Anchor: `test/integration/packaged-hook-install.test.ts` (search: `runs fresh install and 1.15.0 sync through the archived CLI bin`).

**Prevention:**
1. Keep Git resolution first so worktree and submodule checkouts can win, but continue upward when that Git root has no requested-hook trace. Select only a complete managed root, then run the launcher with that verified root as child cwd.
2. Treat the requested script or an exact registration operand as relevance. The shared launcher alone may belong to another enabled hook and cannot classify the candidate as partial.
3. After the ancestor walk, consult the supported project-root environment fallback. Codex can use a complete managed ancestor without Git but still fails closed when its cwd has no candidate and its host supplies no root environment.
4. Keep policy-root and diff-root claims separate: deny policy works in a complete non-Git installation, while post-turn scanning blocks without a trustworthy Git comparison baseline.
5. Keep each launcher deadline below its supported host limit and stop the full child process tree on timeout so the user's agent can render the bounded failure.
6. Recovery: the user types `!cd <repo>` to reset the persisted cwd. Keep scratch work in `.goat-flow/scratchpad/`, not `/tmp`; see `.goat-flow/learning-loop/lessons/agent-tooling.md` (search: "Agent wedged its own shell in /tmp and tried to bypass the guard instead of recovering").

## Footgun: Copilot hook config can exist while runtime policy hooks are disabled

**Status:** active | **Created:** 2026-06-05 | **Evidence:** ACTUAL_MEASURED

**Trap:** Goat-flow can verify `.github/hooks/hooks.json` and the deny script while Copilot never invokes the repo hook. On 2026-06-05, Copilot CLI 1.0.54 reported `POLICY_HOOKS: false`; a live `view` ran; the capture hook received no stdin.

**Evidence:**
- `workflow/hooks/agent-config/copilot-hooks.json` and `.github/hooks/hooks.json` (search: `"preToolUse"`).
- `src/cli/audit/check-agent-deny-runtime.ts` (search: `blockedRuntimeProbe`) validates script-shaped stdin only.

**Prevention:** In release QA, label Copilot coverage as script/config evidence unless live capture writes a payload or emits `hook.start`. `POLICY_HOOKS: false` means runtime enforcement is unavailable/limited.

## Footgun: Codex permission profiles must match the local CLI grammar

**Status:** active | **Created:** 2026-05-19 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Admit writable subpaths only after checking their real layout, then exercise the generated profile with an allowed and denied runtime write.
**Trigger phase:** READ
**Caught at:** VERIFY

**Symptoms:** Codex warns or fails before shell startup when the profile names a workspace-root token, access value, base-profile shape, or exact path the runtime can't load. On 0.136.0, the old profile that set `"." = "write"` and `"secrets/**" = "none"` under `:workspace_roots` failed before startup with the `bwrap: execvp ... codex: No such file or directory` error (full string in evidence). On 0.131.0, `:project_roots` was ignored and absent exact entries (`.env.example`, `.docker/config.json`, `.kube/config`) could break startup. On 0.145.0, a generated reporting profile that named absent `.goat-flow/plans` and `.goat-flow/scratchpad` write roots failed every command with `bwrap: Can't create file ... Read-only file system`.

**Why it happens:** Codex permission grammar is version-sensitive. On 0.136.0, rebuilding the workspace profile from raw `:workspace_roots` entries instead of extending `:workspace` with `deny` omits Codex-managed runtime paths from the bwrap namespace, hiding Codex's own binary. On 0.131.0 the workspace token was `:workspace_roots` (not `:project_roots`) and exact workspace-root entries had to name files present in the checkout. Exact rules are materialized for every selected workspace root, so a path present in one root but absent in another can also abort startup. A profile can be syntactically plausible yet unlaunchable for the installed version.

**Evidence:**
- `.codex/config.toml` (search: `extends = ":workspace"`) - installed config now extends Codex's built-in workspace profile and uses `deny` entries; `workflow/hooks/agent-config/codex.toml` (search: `extends = ":workspace"`) is the install template mirroring that loadable shape.
- `workflow/install-goat-flow.sh` (search: `active goat-flow profile does not extend`) - installer migration/validation refreshes old profiles that would break shell startup.
- `src/cli/facts/agent/settings.ts` (search: `isCodexDenyMode`) - audit fact extraction recognizes both legacy `none` and current `deny` entries; `src/cli/audit/check-agent-codex.ts` (search: `checkCodexWorkspaceRootExactPaths`) - audit fails when Codex config lists absent exact workspace-root paths.
- Runtime capture 2026-06-04: `codex sandbox --permissions-profile goat-flow -C /home/devgoat/projects/goat-flow pwd` failed with `bwrap: execvp .../vendor/x86_64-unknown-linux-musl/bin/codex: No such file or directory`; same command succeeded when the profile was supplied as `permissions.goat-flow={extends=":workspace", filesystem={... "blocked/**"="deny"}}`.
- 2026-05-19 startup failure showed repeated `':project_roots' is not recognized by this version of Codex and will be ignored` warnings; a binary probe that day found `:workspace_roots` (and no `:project_roots`) in Codex 0.131.0's embedded schema.
- `src/cli/server/terminal-reporting-profile.ts` (search: `sharedProtectedPaths`) now admits a reporting write root only when it exists and has the same protected-file layout across all selected roots; `isGitIgnoredPath` separately gates build-directory candidates.
- Runtime capture 2026-07-26 on Codex 0.145.0: the pre-fix generated profile failed allowed report/build writes because an absent exact local-state rule prevented bwrap startup; after layout filtering, allowed writes exited 0 while tracked overwrite/rename/delete probes exited 1.

**Prevention:**
1. For Codex 0.136+, make goat-flow profiles extend `:workspace` and use `deny` access entries; don't rebuild workspace write access with `"." = "write"` and `none`.
2. Don't convert Codex workspace permissions back to `:project_roots`; that token is runtime-invalid on Codex 0.131.0.
3. Verify Codex config changes with `codex sandbox --permissions-profile goat-flow -C <project> pwd` as well as `codex doctor`; install health alone misses project-profile namespace failures.
4. Keep `.codex/config.toml`, `workflow/hooks/agent-config/codex.toml`, and `src/cli/facts/agent/settings.ts` in the same patch whenever Codex permission grammar changes.
5. Treat Codex permission-profile secret coverage as a loadable set, not a future-file deny list. Prefer recursive `deny` globs that leave `.env.example` readable over absent exact root-file entries.
6. For generated multi-root profiles, include only real shared directories with identical protected-file layouts; prove candidate build paths are Git-ignored in every root before granting writes.
7. Runtime-probe one allowed write and blocked tracked overwrite/rename/delete. String assertions and `doctor` output do not prove path materialization succeeds.
