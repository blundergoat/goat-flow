---
category: hook-installation
last_reviewed: 2026-08-04
---

**Scope:** Hook install / launch / registration / config-drift plumbing. The `deny-dangerous` guardrail's shell-grammar policy parser (substitution/heredoc handling, secret-path and `git`/`gh` write classification, payload parsing) lives in [deny-shell.md](deny-shell.md) (command grammar), [deny-secrets.md](deny-secrets.md) (secret-path reads), and [deny-writes.md](deny-writes.md) (external writes).

**Last independent review:** 2026-07-26 - Codex reporting-profile path admission was runtime-probed for allowed local writes, blocked tracked writes, and absent-path startup failures. Other active entries were not reclassified by that check.

## Footgun: Hook toggles can scaffold uninstalled agent surfaces

**Status:** active | **Created:** 2026-05-27 | **Evidence:** ACTUAL_MEASURED

**Regression symptom:** A hook toggle against a clean target created agent config and hook files for agents the target never opted into, making setup and audit state look agent-aware when the project asked only to change one toggle.

**Why it happened:** A registrar loop over supported agents treated support metadata as installation evidence. The hook config writer also treated a missing JSON config as `{}`, so an unguarded disable/enable could create `.claude/settings.json`, `.codex/hooks.json`, `.agents/hooks.json`, `.github/hooks/hooks.json`, and hook script dirs from scratch.

**Evidence:**
- Pre-fix runtime probes against `<clean-temp-dir>`: `node --import tsx src/cli/cli.ts hooks disable deny-dangerous <clean-temp-dir>` created `.agents/hooks.json`, `.claude/settings.json`, `.codex/hooks.json`, `.github/hooks/hooks.json`, and `.goat-flow/config.yaml`; the `hooks enable deny-dangerous` form created hook scripts under `.agents/hooks/`, `.claude/hooks/`, `.codex/hooks/`, and `.github/hooks/`.
- Guard anchors: `src/cli/server/hook-registrar.ts` (search: `shouldReconcileAgent`) gates writes on detected installed surfaces or existing hook residue; `test/unit/hook-registrar.test.ts` (search: `does not scaffold uninstalled agent surfaces`) locks the clean-target regression.

**Prevention:**
1. Treat hook support and agent installation as different facts. Support comes from the manifest; installation from target-project surfaces.
2. Don't count shared markers such as `AGENTS.md` or `.agents/skills/` as a per-agent hook opt-in when multiple profiles share them.
3. On disable, remove existing hook residue, but don't create a missing hook config file just to remove an entry from it.

## Footgun: Hook command strings can fail before guard code starts

**Status:** active | **Created:** 2026-05-27 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Direct hook self-tests pass, but an agent session reports a PreToolUse failure with exit 126 or 127 before any `BLOCKED:` or deny JSON appears. The script exists and works when launched manually, so the failure looks like a runtime mystery rather than a stale/unsupported command string.

**Why it happens:** Agent configs name launch paths, not the abstract hook file. A stale path, lost executable bit, unsupported shell substitution, or cwd assumption can fail before `deny-dangerous.sh` and the thin hook code start. Direct `bash workflow/hooks/<guard>.sh` smoke tests skip that surface.

**Evidence:**
- Preflight/audit parse configured command strings from `.claude/settings.json`, `.codex/hooks.json`, `.agents/hooks.json`, and `.github/hooks/hooks.json`, require an exact guard script path, then run that guard with safe deny payloads. Anchors: `scripts/preflight-checks.sh` (search: `configured_hook_smoke_output`), `src/cli/audit/check-agent-deny-runtime.ts` (search: `configuredGuardCommands`).
- 2026-06-01 release-review recurrence (now fixed): an earlier `runConfiguredHookCommandSmoke` parsed the configured command but launched `bash` against `configured.scriptPath`, so a broken `$root` resolver, stale wrapper, syntax error, or executable-bit failure could pass audit while the configured agent command failed before guard startup. `src/cli/audit/check-agent-deny-runtime.ts` (search: `runConfiguredHookCommandSmoke`) now executes the configured launcher string (`configured.command`) directly, and the drift tests below lock that it must not fall back to the bare script path.
- `test/unit/audit-command/agent-deny-hooks-drift.test.ts` (search: `exact configured hook command points at a stale path`) locks the stale-path case; `test/unit/audit-command/agent-deny-hooks.test.ts` (search: `hides the script path in shell text`) locks the unsafe hidden-script-path case. Runtime contract anchors: `workflow/hooks/README.md` (search: `Failure Modes / Runtime Contracts`) and `src/cli/server/agent-hook-writer.ts` (search: `Policy hook unavailable: git repository root unavailable`).
- 2026-06-04 PR #47 review recurrence: the generated launcher added a `$CLAUDE_PROJECT_DIR` fallback for the script path but still ran `bash "$root/..."` from the old cwd, so the dispatcher recomputed policy root from the wrong directory and failed closed outside a repo. The change had to stay mirrored across `src/cli/server/agent-hook-writer.ts` (search: `ensureRoot`), `workflow/hooks/deny-dangerous.sh` (search: `resolve_goat_flow_root_from_git`), `workflow/hooks/agent-config/claude.json` (search: `CLAUDE_PROJECT_DIR`), and `.claude/settings.json` (search: `CLAUDE_PROJECT_DIR`).
- 2026-06-09 recurrence for Codex: bare `.goat-flow/hooks/deny-dangerous.sh` commands exited 127 from a nested cwd, while a `bash -c` wrapper that resolves `git rev-parse --show-toplevel`, checks `$root/.goat-flow/hooks/deny-dangerous.sh`, `cd`s to `$root`, and then invokes the hook reached the central policy. Current anchors: `workflow/hooks/agent-config/codex-hooks.json` (search: `git rev-parse --show-toplevel`), `src/cli/server/agent-hook-writer.ts` (search: `Codex has no documented equivalent`), and `test/unit/hook-registrar.test.ts` (search: `generated Codex launchers resolve the active root`).

**Prevention:**
1. Treat configured guard-script replay as part of hook verification, not an optional integration smoke.
2. Fail hard on exit 126/127 even when direct script self-tests pass.
3. Document command-shape differences: Claude, Codex, and Antigravity resolve the active git root for central `.goat-flow/hooks` scripts; Claude/Antigravity have a `$CLAUDE_PROJECT_DIR` fallback outside git, Codex does not; Copilot still uses bare project-local paths and needs a repo-root working directory.
4. Runtime smoke must execute the configured command string, or a parser-backed equivalent validating every wrapper component. Don't replace a configured command with `bash <scriptPath>` when it contains resolver logic or direct executable invocation.
5. When a launcher falls back to a root variable, either `cd "$root"` before running the hook or pass root through a contract the hook consumes; resolving only the script path fails when the hook recomputes repo state from cwd.

## Footgun: Hook sync must unignore required policy files

**Status:** active | **Created:** 2026-06-01 | **Evidence:** OBSERVED

**Symptoms:** Historical pre-fix failure: `goat-flow hooks enable deny-dangerous` or `goat-flow hooks sync` made local checks pass, but a fresh clone lacked `.goat-flow/hooks/deny-dangerous/` because stale `.goat-flow/.gitignore` rules still ignored the copied policy modules.

**Why it happens:** Pre-1.9 `.goat-flow/.gitignore` templates use a leading `*`; any CLI/dashboard path that writes required committed files under `.goat-flow/` must append matching unignore entries. The original hook sync path wrote `.goat-flow/hooks/deny-dangerous/` without adding `!hooks/` and `!hooks/**`.

**Evidence:**
- Current repair: `src/cli/server/hook-registrar.ts` (search: `ensureHookGitignoreEntries`) appends both negations whenever hook sync writes the shared policy store.
- Regression: `test/unit/hook-registrar.test.ts` (search: `unignores hooks when enabling deny-dangerous on a stale goat-flow gitignore`) starts from a pre-1.9 gitignore and asserts both negations are added.
- Broader trap: `.goat-flow/learning-loop/footguns/docs-and-crossrefs.md` (search: `Filesystem-backed validation can miss untracked or ignored replacement files`) records how filesystem checks can pass with ignored `.goat-flow/*` files.

**Prevention:**
1. Preserve `ensureHookGitignoreEntries` beside any code path that writes `.goat-flow/hooks/deny-dangerous/`.
2. Keep the pre-1.9 gitignore regression fixture and `git check-ignore` assertion for `.goat-flow/hooks/deny-dangerous/patterns-shell.sh`.
3. Before release, test the clone path: commit hook config plus hooks, clone fresh, then run `.goat-flow/hooks/deny-dangerous/deny-dangerous-self-test.sh --self-test=smoke`.

## Footgun: Legacy per-agent hook launchers using --show-toplevel resolve to the worktree, not the main repo

**Status:** active | **Created:** 2026-05-28 | **Evidence:** ACTUAL_MEASURED

**Current scope:** Active for legacy per-agent hook copies; superseded for central `.goat-flow/hooks` launchers, which must use the active worktree root.

**Symptoms:** A Claude or Antigravity session inside a `git worktree add` checkout fails every Bash with a PreToolUse error like `bash: /path/to/repo/.claude/worktrees/<branch>/.claude/hooks/<guard>.sh: No such file or directory`. Direct self-tests in the main repo pass; guards run fine outside the worktree. The same shape appears after a hook rename if a stale launcher references the old script name.

**Why it happens:** Inside a worktree, `git rev-parse --show-toplevel` returns the worktree's working directory, not the main repo's. The earlier Claude/Antigravity launcher resolved the script path against `--show-toplevel`, looking for `<worktree>/.claude/hooks/<guard>.sh` — which exists only if `.claude/hooks/` is git-tracked. Many projects gitignore `.claude/` entirely, so `git worktree add` checks out no hook scripts and every guard fails before its code starts. Goat-flow's repo tracks `.claude/hooks/`, masking this in development.

**Evidence:**
- Pre-fix runtime probe: a fresh worktree at `<project>/.claude/worktrees/feat+x/` with `.claude/` gitignored started every Bash with `bash: <worktree>/.claude/hooks/patterns-shell.sh: No such file or directory`. The repro inside goat-flow succeeded only because `git ls-files | grep '^\.claude/hooks/'` lists all guard scripts; a fresh worktree inherited them via the branch checkout.
- 2026-06-09 recurrence after the 1.10 central-hook migration: PR review on `blundergoat/gruff-ts#7` caught generated `.agents/hooks.json` launchers still resolving through `git rev-parse --git-common-dir`, which now points at the primary checkout in a linked worktree and can run stale `.goat-flow/hooks` scripts from the wrong checkout. Central hooks are committed under `.goat-flow/hooks`, so the active worktree root is now the correct root.
- Anchors: central-hook launchers in `workflow/hooks/agent-config/claude.json`, `workflow/hooks/agent-config/antigravity-hooks.json`, and `workflow/install-goat-flow.sh` (each search: `git rev-parse --show-toplevel`); generated launcher tests in `test/unit/hook-registrar.test.ts` (search: `resolve active worktrees`); the normalizer at `src/cli/facts/agent/hook-registration.ts` (search: `Hook launchers prefix the script path`) strips both `$(...)` and `$var/` prefixes when extracting the script path for audit.

**Prevention:**
1. Central `.goat-flow/hooks` launchers MUST resolve to the active worktree root with `git rev-parse --show-toplevel`, because those scripts are committed with the worktree. Do not use `--git-common-dir` for central hook lookup; that can borrow stale scripts from the primary checkout.
2. The old main-root rule only applies to legacy per-agent hook copies stored under ignored `.claude/hooks/` or `.agents/hooks/`.
3. When renaming or splitting a guard, regenerate every launcher string the installer writes, not just the hook script; a stale launcher reproduces this even when the main repo has the new scripts.
4. Add worktree coverage to any future configured-command smoke probe: run the literal launcher from a fresh worktree, not just the main checkout, before claiming it works.

## Footgun: Hook launchers fail closed when the shell cwd is outside any git repo, wedging every Bash

**Status:** active | **Created:** 2026-06-04 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A Claude/Antigravity session that `cd`'d outside the repo (usually `/tmp` for scratch) has EVERY later Bash blocked by `BLOCKED: Policy hook unavailable: git repository root unavailable.` (older installs: `Guard cannot start: ...`). The block fires before the command, so even `cd /path/to/repo && ...` is rejected - the session can't escape `/tmp` via Bash (Read/Edit/Write still work).

**Why it happens:** The launcher runs `git rev-parse` in the agent's persistent cwd and fails closed outside any repo. Claude Code keeps one cwd across Bash calls, so one `cd /tmp` gates every later command (the `cd` back included) on a `git rev-parse` that cannot succeed from `/tmp`; `--git-common-dir` also fails there (`fatal: not a git repository`, exit 128). Script-path lookup alone is insufficient: `deny-dangerous.sh` re-resolves `.goat-flow/hooks/deny-dangerous` via `git rev-parse` from cwd, failing closed unless the launcher `cd`s into root.

**Evidence:**
- 2026-06-04 live incident: a session in `~/projects/gruff-workspace/gruff-rs` cd'd to `/tmp`, after which every Bash returned `Guard cannot start: git repository root unavailable.`; `cd <repo> && pwd` was blocked too. Both launcher generations fail from `/tmp`: `git rev-parse --show-toplevel` and `--git-common-dir` each exit 128 with empty output → fail-closed branch.
- End-to-end probe (real guard, from `/tmp`): WITH `$CLAUDE_PROJECT_DIR` + `cd "$root"` → benign allowed (exit 0), `rm -rf /` blocked (exit 2); WITHOUT the env var → fail-closed (exit 2); script-path lookup alone (no `cd`) still failed closed. Anchors: `src/cli/server/agent-hook-writer.ts` (search: `CLAUDE_PROJECT_DIR`), and the generated launchers in `workflow/hooks/agent-config/claude.json`, `workflow/hooks/agent-config/antigravity-hooks.json`, and `workflow/install-goat-flow.sh` (search: `CLAUDE_PROJECT_DIR:-`).

**Prevention:**
1. A launcher MUST locate its guard from a cwd-independent anchor: after git resolution, fall back to `$CLAUDE_PROJECT_DIR`, then fail closed only when neither finds `deny-dangerous.sh`. AND `cd "$root"` before running the guard (cd failure also fails closed), because the guard re-resolves its root from cwd - script-path lookup alone leaves it failing closed from `/tmp`.
2. Keep git resolution FIRST so worktree/submodule checkouts resolve to the main repo; the env fallback only rescues the cwd-outside-repo case. Only Claude exports `$CLAUDE_PROJECT_DIR`; other agents stay fail-closed from `/tmp` until their root env var is wired in.
3. Recovery: the user types `!cd <repo>` to reset the persisted cwd. Keep scratch work in `.goat-flow/scratchpad/`, not `/tmp` (see `.goat-flow/learning-loop/lessons/agent-behavior.md`, search: `wedged its own shell`).

## Footgun: Copilot hook config can exist while runtime policy hooks are disabled

**Status:** active | **Created:** 2026-06-05 | **Evidence:** ACTUAL_MEASURED

**Trap:** Goat-flow can verify `.github/hooks/hooks.json` and the deny script while Copilot never invokes the repo hook. On 2026-06-05, Copilot CLI 1.0.54 reported `POLICY_HOOKS: false`; a live `view` ran; the capture hook received no stdin.

**Evidence:**
- `workflow/hooks/agent-config/copilot-hooks.json` and `.github/hooks/hooks.json` (search: `"preToolUse"`).
- `src/cli/audit/check-agent-deny-runtime.ts` (search: `runtimeSmokePayload`) validates script-shaped stdin only.

**Prevention:** In release QA, label Copilot coverage as script/config evidence unless live capture writes a payload or emits `hook.start`. `POLICY_HOOKS: false` means runtime enforcement is unavailable/limited.

## Footgun: Codex permission profiles must match the local CLI grammar

**Status:** active | **Created:** 2026-05-19 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Admit writable subpaths only after checking their real layout, then exercise the generated profile with an allowed and denied runtime write.
**Trigger phase:** VERIFY

**Symptoms:** Codex warns or fails before shell startup when the profile names a workspace-root token, access value, base-profile shape, or exact path the runtime can't load. On 0.136.0, the old profile that set `"." = "write"` and `"secrets/**" = "none"` under `:workspace_roots` failed before startup with the `bwrap: execvp ... codex: No such file or directory` error (full string in evidence). On 0.131.0, `:project_roots` was ignored and absent exact entries (`.env.example`, `.docker/config.json`, `.kube/config`) could break startup. On 0.145.0, a generated reporting profile that named absent `.goat-flow/plans` and `.goat-flow/scratchpad` write roots failed every command with `bwrap: Can't create file ... Read-only file system`.

**Why it happens:** Codex permission grammar is version-sensitive. On 0.136.0, rebuilding the workspace profile from raw `:workspace_roots` entries instead of extending `:workspace` with `deny` omits Codex-managed runtime paths from the bwrap namespace, hiding Codex's own binary. On 0.131.0 the workspace token was `:workspace_roots` (not `:project_roots`) and exact workspace-root entries had to name files present in the checkout. Exact rules are materialized for every selected workspace root, so a path present in one root but absent in another can also abort startup. A profile can be syntactically plausible yet unlaunchable for the installed version.

**Evidence:**
- `.codex/config.toml` (search: `extends = ":workspace"`) - installed config now extends Codex's built-in workspace profile and uses `deny` entries; `workflow/hooks/agent-config/codex.toml` (search: `extends = ":workspace"`) is the install template mirroring that loadable shape.
- `workflow/install-goat-flow.sh` (search: `active goat-flow profile does not extend`) - installer migration/validation refreshes old profiles that would break shell startup.
- `src/cli/facts/agent/settings.ts` (search: `isCodexDenyMode`) - audit fact extraction recognizes both legacy `none` and current `deny` entries; `src/cli/audit/check-agent-setup.ts` (search: `checkCodexWorkspaceRootExactPaths`) - audit fails when Codex config lists absent exact workspace-root paths.
- Runtime capture 2026-06-04: `codex sandbox --permissions-profile goat-flow -C /home/devgoat/projects/goat-flow pwd` failed with `bwrap: execvp .../vendor/x86_64-unknown-linux-musl/bin/codex: No such file or directory`; same command succeeded when the profile was supplied as `permissions.goat-flow={extends=":workspace", filesystem={... "blocked/**"="deny"}}`.
- 2026-05-19 startup failure showed repeated `':project_roots' is not recognized by this version of Codex and will be ignored` warnings; a binary probe that day found `:workspace_roots` (and no `:project_roots`) in Codex 0.131.0's embedded schema.
- `src/cli/server/terminal.ts` (search: `sharedProtectedPaths`) now admits a reporting write root only when it exists and has the same protected-file layout across all selected roots; `isGitIgnoredPath` separately gates build-directory candidates.
- Runtime capture 2026-07-26 on Codex 0.145.0: the pre-fix generated profile failed allowed report/build writes because an absent exact local-state rule prevented bwrap startup; after layout filtering, allowed writes exited 0 while tracked overwrite/rename/delete probes exited 1.

**Prevention:**
1. For Codex 0.136+, make goat-flow profiles extend `:workspace` and use `deny` access entries; don't rebuild workspace write access with `"." = "write"` and `none`.
2. Don't convert Codex workspace permissions back to `:project_roots`; that token is runtime-invalid on Codex 0.131.0.
3. Verify Codex config changes with `codex sandbox --permissions-profile goat-flow -C <project> pwd` as well as `codex doctor`; install health alone misses project-profile namespace failures.
4. Keep `.codex/config.toml`, `workflow/hooks/agent-config/codex.toml`, and `src/cli/facts/agent/settings.ts` in the same patch whenever Codex permission grammar changes.
5. Treat Codex permission-profile secret coverage as a loadable set, not a future-file deny list. Prefer recursive `deny` globs that leave `.env.example` readable over absent exact root-file entries.
6. For generated multi-root profiles, include only real shared directories with identical protected-file layouts; prove candidate build paths are Git-ignored in every root before granting writes.
7. Runtime-probe one allowed write and blocked tracked overwrite/rename/delete. String assertions and `doctor` output do not prove path materialization succeeds.
