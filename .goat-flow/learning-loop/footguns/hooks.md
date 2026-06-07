---
category: hooks
last_reviewed: 2026-06-07
---

**Scope:** Hook install / launch / registration / config-drift plumbing. The `deny-dangerous` guardrail's shell-grammar policy parser (substitution/heredoc handling, secret-path and `git`/`gh` write classification, payload parsing) lives in [deny-dangerous.md](deny-dangerous.md).

**Last independent review:** 2026-05-26 - Active entries re-verified against current split guardrail anchors and the central self-test (`PASS` across Workflow/Claude/GitHub/Codex/Antigravity). Antigravity uses `.agents/hooks.json` + `.agents/hooks/` for PreToolUse; `cat .env` is blocked by `patterns-paths.sh`.

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
- Preflight/audit parse configured command strings from `.claude/settings.json`, `.codex/hooks.json`, `.agents/hooks.json`, and `.github/hooks/hooks.json`, require an exact guard script path, then run that guard with safe deny payloads. Anchors: `scripts/preflight-checks.sh` (search: `configured_hook_smoke_output`), `src/cli/audit/check-agent-deny-mechanism.ts` (search: `configuredGuardCommands`).
- 2026-06-01 release-review recurrence: `src/cli/audit/check-agent-deny-mechanism.ts` (search: `runConfiguredHookCommandSmoke`) parses the configured command but launches `bash` against `configured.scriptPath`, so a broken `$root` resolver, stale wrapper, syntax error, or executable-bit failure passes audit while the configured agent command fails before guard startup.
- `test/unit/audit-command/agent-deny-hooks.test.ts` (search: `exact configured hook command points at a stale path`) locks the stale-path case; same file (search: `hides the script path in shell text`) locks the unsafe hidden-script-path case. Runtime contract anchors: `workflow/hooks/README.md` (search: `Failure Modes / Runtime Contracts`) and `src/cli/server/agent-hook-writer.ts` (search: `Policy hook unavailable: git repository root unavailable`).
- 2026-06-04 PR #47 review recurrence: the generated launcher added a `$CLAUDE_PROJECT_DIR` fallback for the script path but still ran `bash "$root/..."` from the old cwd, so `workflow/hooks/deny-dangerous.sh` (search: `git rev-parse --git-common-dir`) recomputed policy root from the wrong directory and failed closed outside a repo. The change had to stay mirrored across `src/cli/server/agent-hook-writer.ts` (search: `ensureRoot`), `workflow/hooks/agent-config/claude.json` (search: `CLAUDE_PROJECT_DIR`), and `.claude/settings.json` (search: `CLAUDE_PROJECT_DIR`).

**Prevention:**
1. Treat configured guard-script replay as part of hook verification, not an optional integration smoke.
2. Fail hard on exit 126/127 even when direct script self-tests pass.
3. Document command-shape differences: Claude and Antigravity resolve the git root and fail closed when unavailable; Codex and Copilot use direct project-local paths and need project-root cwd.
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

## Footgun: Hook launchers using --show-toplevel resolve to the worktree, not the main repo

**Status:** active | **Created:** 2026-05-28 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A Claude or Antigravity session inside a `git worktree add` checkout fails every Bash with a PreToolUse error like `bash: /path/to/repo/.claude/worktrees/<branch>/.claude/hooks/<guard>.sh: No such file or directory`. Direct self-tests in the main repo pass; guards run fine outside the worktree. The same shape appears after a hook rename if a stale launcher references the old script name.

**Why it happens:** Inside a worktree, `git rev-parse --show-toplevel` returns the worktree's working directory, not the main repo's. The earlier Claude/Antigravity launcher resolved the script path against `--show-toplevel`, looking for `<worktree>/.claude/hooks/<guard>.sh` — which exists only if `.claude/hooks/` is git-tracked. Many projects gitignore `.claude/` entirely, so `git worktree add` checks out no hook scripts and every guard fails before its code starts. Goat-flow's repo tracks `.claude/hooks/`, masking this in development.

**Evidence:**
- Pre-fix runtime probe: a fresh worktree at `<project>/.claude/worktrees/feat+x/` with `.claude/` gitignored started every Bash with `bash: <worktree>/.claude/hooks/patterns-shell.sh: No such file or directory`. The repro inside goat-flow succeeded only because `git ls-files | grep '^\.claude/hooks/'` lists all guard scripts; a fresh worktree inherited them via the branch checkout.
- Anchors: `workflow/hooks/agent-config/claude.json`, `workflow/hooks/agent-config/antigravity-hooks.json`, and `workflow/install-goat-flow.sh` (each search: `git rev-parse --git-common-dir`); the normalizer at `src/cli/facts/agent/hook-registration.ts` (search: `Hook launchers prefix the script path`) now strips both `$(...)` and `$var/` prefixes when extracting the script path for audit.

**Prevention:**
1. Hook launchers MUST resolve to the main repo root, not the current tree. Use `git rev-parse --git-common-dir` and take its parent when absolute (worktree) or fall back to `--show-toplevel` when relative (main checkout).
2. When renaming or splitting a guard, regenerate every launcher string the installer writes, not just the hook script; a stale launcher reproduces this even when the main repo has the new scripts.
3. Add worktree coverage to any future configured-command smoke probe: run the literal launcher from a fresh worktree, not just the main checkout, before claiming it works.

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
- `src/cli/audit/check-agent-deny-mechanism.ts` (search: `runtimeSmokePayload`) validates script-shaped stdin only.

**Prevention:** In release QA, label Copilot coverage as script/config evidence unless live capture writes a payload or emits `hook.start`. `POLICY_HOOKS: false` means runtime enforcement is unavailable/limited.

## Footgun: Installed settings.json deny patterns can silently drift from workflow templates

**Status:** active | **Created:** 2026-04-26 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** An agent can perform an action (e.g. `git push origin feature-branch`) that the workflow template blocks, because the installed settings.json drifted to a weaker deny pattern than the template it was installed from (or the hook only blocks a narrower set). Now covered by preflight's Agent Config Parity check, so the active trap is skipping that check or changing deny semantics without updating the parity rules.

**Why it happens:** `workflow/hooks/agent-config/claude.json` is the install template for `.claude/settings.json`. The template had `Bash(*git push*)` (block all push) but the installed copy drifted to `Bash(*git push*--force*)` (block force only). At incident time, preflight covered skill files and shared references but not settings.json deny patterns; the `Agent Config Parity` section now verifies installed settings with `covers()`.

**Evidence:**
- `workflow/hooks/agent-config/claude.json` (search: `git push`) - template had the correct blanket pattern; `.claude/settings.json` (search: `git push`) - installed copy had drifted to force-only, fixed 2026-04-26 per ADR-025.
- `scripts/preflight-checks.sh` (search: `Agent Config Parity`) - parity check validates installed agent settings against workflow templates.

**Prevention:**
1. After changing any deny pattern in a settings template (`workflow/hooks/agent-config/*.json`), run `bash scripts/preflight-checks.sh` and confirm `Agent Config Parity` still passes.
2. When reviewing hook or settings changes, compare the installed file against its workflow template, not just the other agent mirrors.
3. If a new agent config surface is added, extend the Agent Config Parity map and `covers()` validation in the same change.

## Footgun: Codex permission profiles must match the local CLI grammar

**Status:** active | **Created:** 2026-05-19 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Codex warns or fails before shell startup when the profile names a workspace-root token, access value, or base-profile shape the runtime can't load. On 0.136.0, the old profile that set `"." = "write"` and `"secrets/**" = "none"` under `:workspace_roots` failed before startup with the `bwrap: execvp ... codex: No such file or directory` error (full string in evidence). On 0.131.0, `:project_roots` was ignored and absent exact entries (`.env.example`, `.docker/config.json`, `.kube/config`) could break startup. The TOML can still look like it denies `.env`, `.ssh/**`, `.aws/**`, and credential roots, so static review misses that Codex discarded the rules or built a namespace that can't see its own managed binary.

**Why it happens:** Codex permission grammar is version-sensitive. On 0.136.0, rebuilding the workspace profile from raw `:workspace_roots` entries instead of extending `:workspace` with `deny` omits Codex-managed runtime paths from the bwrap namespace, hiding Codex's own binary. On 0.131.0 the workspace token was `:workspace_roots` (not `:project_roots`) and exact workspace-root entries had to name files present in the checkout. A profile can be syntactically plausible yet unlaunchable for the installed version.

**Evidence:**
- `.codex/config.toml` (search: `extends = ":workspace"`) - installed config now extends Codex's built-in workspace profile and uses `deny` entries; `workflow/hooks/agent-config/codex.toml` (search: `extends = ":workspace"`) is the install template mirroring that loadable shape.
- `workflow/install-goat-flow.sh` (search: `active goat-flow profile does not extend`) - installer migration/validation refreshes old profiles that would break shell startup.
- `src/cli/facts/agent/settings.ts` (search: `isCodexDenyMode`) - audit fact extraction recognizes both legacy `none` and current `deny` entries; `src/cli/audit/check-agent-setup.ts` (search: `checkCodexWorkspaceRootExactPaths`) - audit fails when Codex config lists absent exact workspace-root paths.
- Runtime capture 2026-06-04: `codex sandbox --permissions-profile goat-flow -C /home/devgoat/projects/goat-flow pwd` failed with `bwrap: execvp .../vendor/x86_64-unknown-linux-musl/bin/codex: No such file or directory`; same command succeeded when the profile was supplied as `permissions.goat-flow={extends=":workspace", filesystem={... "blocked/**"="deny"}}`.
- 2026-05-19 startup failure showed repeated `':project_roots' is not recognized by this version of Codex and will be ignored` warnings; a binary probe that day found `:workspace_roots` (and no `:project_roots`) in Codex 0.131.0's embedded schema.

**Prevention:**
1. For Codex 0.136+, make goat-flow profiles extend `:workspace` and use `deny` access entries; don't rebuild workspace write access with `"." = "write"` and `none`.
2. Don't convert Codex workspace permissions back to `:project_roots`; that token is runtime-invalid on Codex 0.131.0.
3. Verify Codex config changes with `codex sandbox --permissions-profile goat-flow -C <project> pwd` as well as `codex doctor`; install health alone misses project-profile namespace failures.
4. Keep `.codex/config.toml`, `workflow/hooks/agent-config/codex.toml`, and `src/cli/facts/agent/settings.ts` in the same patch whenever Codex permission grammar changes.
5. Treat Codex permission-profile secret coverage as a loadable set, not a future-file deny list. Prefer recursive `deny` globs that leave `.env.example` readable over absent exact root-file entries.

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

## Footgun: Optional hook migration must remove old registrations and re-add enabled central entries

**Status:** active | **Created:** 2026-06-07 | **Evidence:** OBSERVED

**Symptoms:** The installer can successfully copy the new central hook scripts, prune legacy per-agent hook files, and still leave an existing agent hook config pointing at the deleted legacy `gruff-code-quality.sh` path. The failure only appears after upgrade because fresh installs use the new template shape and disabled optional hooks do not expose the stale entry.

**Why it happens:** `workflow/install-goat-flow.sh` originally treated only deny-dangerous and the old split guardrail scripts as managed during hook-config migration. Optional `gruff-code-quality.sh` registrations were outside that managed set, so pruning `.claude/hooks/`, `.codex/hooks/`, `.agents/hooks/`, or `.github/hooks/` could delete the script while preserving the old registration. Since gruff is optional, migration must remove stale managed entries everywhere and then re-add the central registration only when `.goat-flow/config.yaml` explicitly enables `gruff-code-quality`.

**Evidence:**
- `workflow/install-goat-flow.sh` (search: `managedScripts`) includes `gruff-code-quality.sh` in the managed migration set.
- `workflow/install-goat-flow.sh` (search: `appendGruffHookEntries`) re-adds central gruff registrations from the enabled hook toggle rather than preserving stale per-agent paths.
- `workflow/install-goat-flow.sh` (search: `configuredHookEnabled`) reads the existing config toggle so enabled optional hooks survive upgrades while disabled hooks stay absent.

**Prevention:**
1. Any future optional hook must be in the installer managed-hook removal list before legacy files are pruned.
2. Do not preserve old hook entries by path during a centralization migration; regenerate from the current registry/config toggle.
3. Add upgrade fixtures for enabled and disabled optional hooks whenever a hook's install path changes.

---

## Footgun: Re-adding a removed agent tool (MultiEdit) reprints "matches no known tool" every launch

**Status:** active | **Created:** 2026-06-07 | **Evidence:** ACTUAL_MEASURED

**Regression symptom:** Claude Code printed `Permission deny rule "MultiEdit(**/secrets/**)" matches no known tool — check for typos.` (x12) on every launch. Claude Code v2.x removed the `MultiEdit` tool (folded into `Edit`), and permission deny rules are validated against known tools at startup, so each `MultiEdit(...)` deny rule warns. This exact issue was fixed once already (CHANGELOG: "Stale `MultiEdit` permission rules removed (Claude Code v2.x)") and then silently came back.

**Why it happened:** Commit `4e54072e` ("add gruff code quality hook and update matcher for multi-edit events") added the gruff PostToolUse hook and, modelling on the existing `Edit`/`Write` blocks, re-added 12 `MultiEdit(...)` deny rules plus a `"matcher": "MultiEdit"` hook entry to `.claude/settings.json` and `.codex/hooks.json`. Mirroring the `Edit`/`Write` pattern *looks* correct, but `MultiEdit` no longer exists. The prior fix lived only in CHANGELOG prose and a few file edits — **no test asserted the absence of MultiEdit**, so re-adding it kept every check green and shipped. Same blind spot as [the silent settings-drift footgun above]; deny rules referencing removed tools warn but never fail a build.

**Evidence:**
- Removed-tool deny rules surface as launch-time warnings, not test failures: pre-fix `npm run test:fast` was green with the 12 `MultiEdit(...)` rules present.
- The `Edit(...)` deny rules covering the same 12 secret paths already exist, so dropping the `MultiEdit(...)` rules loses zero coverage (verified: deny count 57 → 45, all paths retain Read/Edit/Write).
- Sources scrubbed: `.claude/settings.json`, `.codex/hooks.json`, template `workflow/hooks/agent-config/claude.json`, generators `src/cli/server/hooks-registry.ts` (matcher `Edit|Write`) + `workflow/install-goat-flow.sh` (`gruffHookEntries`), docs `workflow/hooks/README.md`, and the hook self-test in `workflow/hooks/gruff-code-quality.sh` (synced to the installed `.goat-flow/hooks/` copy or `audit` drift fails).

**Prevention:**
1. A "fixed" config regression needs a test, not just a CHANGELOG line. Guards now in place: `test/unit/agent-config-template-parity.test.ts` (search: `never denies a removed/unknown Claude tool`) locks every Claude deny rule to `{Bash,Read,Edit,Write}`; `test/unit/hook-registrar.test.ts` (search: `Edit|Write`) and `test/integration/setup-install.test.ts` (search: `/"matcher": "MultiEdit"/`) lock the gruff matcher.
2. When mirroring `Edit`/`Write` permission or hook entries for a new tool, confirm the tool still exists in the target agent version first — Claude Code v2.x has `Edit`/`Write`/`NotebookEdit`, not `MultiEdit`.
3. Editing a `workflow/hooks/*.sh` template means re-syncing the installed `.goat-flow/hooks/` copy in the same change; `audit` drift (search: `hook template ... and installed copy ... differ`) fails otherwise.

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

- **git diff --stat unreliable for scope detection** (resolved 2026-04-03) - auto-detect uses staged, then unstaged, then full diff (M17).
- **Advisory hooks create unfixable quality warning after setup** (resolved 2026-04-14) - hooks ship enforce-mode (`GOAT_LINT_ENFORCE` defaults to 1).
- **Codex hooks registered in config.toml instead of hooks.json** (resolved 2026-04-15) - moved to `.codex/hooks.json`; TOML hook sections were silently ignored.
- **Codex hook migrations drift across files, templates, installer, docs** (resolved 2026-04-15) - restored Codex guardrail registration; aligned all four surfaces.
