---
category: hooks
last_reviewed: 2026-05-27
---

**Last independent review:** 2026-05-26 - Active entries re-verified against current split guardrail anchors and central self-test. Workflow, Claude, GitHub, Codex, and Antigravity guardrail self-tests return `PASS: guardrails self-test`; Antigravity uses `.agents/hooks.json` plus scripts in `.agents/hooks/` for PreToolUse guardrails. The direct `cat .env` probe is blocked by `guard-secret-paths.sh`; coverage relies on self-test cases plus live harness blocking for that command shape.

## Footgun: Hook toggles can scaffold uninstalled agent surfaces

**Status:** active | **Created:** 2026-05-27 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Running a hook toggle against a clean target creates agent config and hook files for agents the target never opted into. That pollution can make setup and audit state look agent-aware when the project only asked to change one hook toggle.

**Why it happens:** A registrar loop over supported agents treats support metadata as installation evidence. The hook config writer also treats a missing JSON config as `{}`, so an unguarded disable or enable can create `.claude/settings.json`, `.codex/hooks.json`, `.agents/hooks.json`, `.github/hooks/hooks.json`, and hook script directories from nothing.

**Evidence:**
- Pre-fix runtime probe: `node --import tsx src/cli/cli.ts hooks disable guard-secret-paths <clean-temp-dir>` created `.agents/hooks.json`, `.claude/settings.json`, `.codex/hooks.json`, `.github/hooks/hooks.json`, and `.goat-flow/config.yaml`.
- Pre-fix runtime probe: `node --import tsx src/cli/cli.ts hooks enable guard-secret-paths <clean-temp-dir>` created hook scripts under `.agents/hooks/`, `.claude/hooks/`, `.codex/hooks/`, and `.github/hooks/`.
- Current anchors: `src/cli/server/hook-registrar.ts` (search: `shouldReconcileAgent`) gates writes on detected installed surfaces or existing hook residue; `test/unit/hook-registrar.test.ts` (search: `does not scaffold uninstalled agent surfaces`) locks the clean-target regression.

**Prevention:**
1. Treat hook support and agent installation as different facts. Support comes from the manifest; installation must come from target-project surfaces.
2. Do not count shared markers such as `AGENTS.md` or `.agents/skills/` as a concrete per-agent hook opt-in when multiple profiles share them.
3. On disable, remove existing hook residue, but do not create a missing hook config file just to remove an entry from it.

## Footgun: Splitting a monolithic guardrail can drop parser coverage while preserving the headline checks

**Status:** active | **Created:** 2026-05-26 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A hook split looks cleaner because `guard-destructive-shell.sh`, `guard-secret-paths.sh`, and `guard-repository-writes.sh` each block the obvious happy-path examples (`rm -rf /`, `cat .env`, `git push`). The pre-M10 monolithic guardrail carried much broader parser coverage, though: wrapper normalization, quoted read-only search literals, `git -C` / `git -c` push forms, global `gh --repo` grammar, split-quoted `.env`, `.envrc`, safe-scoped recursive deletion, and structured Copilot/Antigravity payload variants. A small split can pass smoke tests while re-opening old bypasses and false positives.

**Evidence:**
- Git history before the split had a monolithic workflow guard with 1,997 lines and a paired self-test with 629 lines; the first split replaced them with three small guards totaling 393 lines plus a 195-line self-test.
- Runtime probes before the restoration allowed `git -C /tmp push origin main`, `git -c core.sshCommand=foo push origin main`, `/usr/bin/git push origin main`, `gh --repo owner/repo issue comment ...`, `gh workflow run deploy.yml`, `rm -r src`, `cat .envrc`, `cat '.'env`, and `python3 -c 'print(open(".env").read())'`.
- Runtime probes before the restoration also blocked allowed commands such as `rm -rf ./node_modules`, `rg "&& rm -rf /" src/`, `bash -c "echo hello"`, and `python -c 'print(1)'`.
- Current anchors: `workflow/hooks/guard-repository-writes.sh` (search: `is_gh_write_operation`), `workflow/hooks/guard-destructive-shell.sh` (search: `rm_has_recursive`), `workflow/hooks/guard-secret-paths.sh` (search: `is_secret_path_touch`), and `workflow/hooks/guardrails-self-test.sh` (search: `git -C push`, `quoted destructive search literal`).

**Prevention:**
1. Treat guardrail splits as parser migrations, not simple renames. Port the old parser normalization and the old false-positive corpus before deleting the monolith.
2. Compare line count and self-test case count before approving a split; a large drop is a review smell until the removed coverage is explicitly mapped to replacement tests.
3. Run representative old-case probes across all split hooks: wrapper-prefixed git pushes, global/inherited `gh` flags, read-only search literals containing dangerous text, safe-scoped recursive deletion, split-quoted secret paths, and structured payloads for every registered agent.
4. Keep the central self-test broad enough to fail on both bypasses and false positives. Smoke checks alone only prove the headline examples.

## Footgun: Hook command strings can fail before guard code starts

**Status:** active | **Created:** 2026-05-27 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Direct hook self-tests pass, but an agent session reports a PreToolUse failure with exit 126 or 127 before any `BLOCKED:` or deny JSON response appears. The script exists and works when launched manually, so the failure looks like a runtime mystery instead of a stale or unsupported command string.

**Why it happens:** Agent configs execute registered strings, not the abstract hook file. A stale path, lost executable bit, unsupported shell substitution, or cwd assumption can fail before `guard-common.sh` and the thin hook code start. Direct `bash workflow/hooks/<guard>.sh` smoke tests skip that surface entirely.

**Evidence:**
- M12 preflight and audit now parse configured command strings from `.claude/settings.json`, `.codex/hooks.json`, `.agents/hooks.json`, and `.github/hooks/hooks.json` and run each guard with safe deny payloads. Evidence anchors: `scripts/preflight-checks.sh` (search: `configured_hook_smoke_output`) and `src/cli/audit/check-agent-setup.ts` (search: `configuredGuardCommands`).
- `test/unit/audit-command.test.ts` (search: `exact configured hook command exits 127`) locks the failure case where a configured command exits before a valid installed hook can run.
- Runtime contract anchors: `workflow/hooks/README.md` (search: `Failure Modes / Runtime Contracts`) and `src/cli/server/agent-hook-writer.ts` (search: `Guard cannot start: git repository root unavailable`).

**Prevention:**
1. Treat configured-command replay as part of hook verification, not an optional integration smoke.
2. Fail hard on exit 126/127 even if direct script self-tests pass.
3. Keep command-shape differences documented: Claude and Antigravity resolve the git root and fail closed when unavailable; Codex and Copilot use direct project-local paths and require project-root cwd.

## Footgun: Extension-based secret checks can confuse filenames with query syntax

**Status:** active | **Created:** 2026-05-27 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A secret-path hook correctly blocks `cat path/to/id_rsa.key`, but also blocks harmless jq/yq expressions such as `jq -r .key file.json` and `yq .metadata.key file.yaml`. The same matcher may also block text after an unquoted shell comment, such as `git status # .env`.

**Why it happens:** A broad `.(pem|key|pfx)` extension regex sees dotted query fields and filenames as the same shape. Scanning the raw shell segment before comment stripping also treats inert comment text as a command argument.

**Evidence:**
- M12 pre-fix probes blocked `git status # .env` and `jq -r .key file.json`; post-fix probes return status 0 while `cat path/to/id_rsa.key` still returns status 2.
- `workflow/hooks/guard-common.sh` (search: `strip_unquoted_shell_comments`) strips inert comments before policy matching.
- `workflow/hooks/guard-secret-paths.sh` (search: `key_material_path_touch`) requires a meaningful filename/path stem for `.pem`, `.key`, and `.pfx`.
- `workflow/hooks/guardrails-self-test.sh` (search: `jq bare key query`) locks both allow and block cases.

**Prevention:**
1. Secret-path tests must include inert dotted query expressions as allow controls alongside real key-file paths.
2. Run comment false-positive probes for every policy hook after changing shared shell segment preparation.
3. Prefer file-shape helpers over broad extension regexes when a token can also be valid data syntax.

## Footgun: File-read deny does not bind Bash shell reads of secret files

**Status:** active | **Created:** 2026-04-19 | **Evidence:** ACTUAL_MEASURED
**hallucination-risk:** high - `Read(**/.env*)` in `settings.json` or a Codex TOML permission profile can look like a blanket secret-read deny, but it only binds file-read paths. A Bash payload like `cat .env`, `source .env`, `base64 ~/.aws/credentials` is not bound by that file-read layer and silently succeeds unless the Bash hook blocks it explicitly.

**Symptoms:** Settings-level `Read(**/.env*)` coverage can look complete even though shell-based secret reads require separate Bash-hook coverage. Before the Bash-side sentinel was added, `goat-flow audit --harness` reported `deny-covers-secrets: pass` while a live Bash probe returned exit 0. Current expected behavior is exit 2 with `BLOCKED: Secret-file access ...`, verified by the runtime probe below.

**Why it happens:** Settings/config file-read deny entries are tool-scoped. Claude/Gemini `Read(...)` patterns bind the Read tool; Codex TOML permission profiles bind filesystem access. An agent using the Bash tool to run `cat .env` is not protected by file-read intent alone. Two independent coverage layers are required: file-read deny for the file tool path AND Bash-hook regex coverage for shell paths.

**Evidence:**
- `.claude/settings.json` (search: `"Read(**/.env*)"`) - tool-scoped deny patterns. Not applied to Bash.
- `.claude/hooks/guard-secret-paths.sh` (search: `is_secret_path_touch`) - the Bash-side sentinel function added 2026-04-19. Blocks `cat .env`, `source .env`, `cat ~/.ssh/id_rsa`, `cat ~/.aws/credentials`, `.pem/.key/.pfx` across hook-capable agents.
- `src/cli/audit/harness/check-constraints.ts` (search: `bashDenyCoversSecrets`) - the harness now requires BOTH `readDenyCoversSecrets` (settings/Codex permission file-read coverage) AND `bashDenyCoversSecrets` (Bash hook pattern) before classifying an agent as covered.
- `src/cli/facts/agent/hooks.ts` (search: `detectBashDenyCoversSecrets`) - fact derivation: scans the deny hook file for the active secret sentinel plus family markers for `.env*`, `.env.example` parity, normalized `./` / `../` / `~/` roots, `.ssh/`, `.aws/`, `secrets/`, credentials, and `.pem/.key/.pfx`.
- Runtime probe: `bash .claude/hooks/guard-secret-paths.sh --check="cat .env"` now returns exit 2 with `BLOCKED: Secret-file access blocked`.

**Prevention:**
1. For any new secret-path family added to the harness, extend BOTH `checkReadDenyCoversSecrets` in `src/cli/facts/agent/settings.ts` AND `detectBashDenyCoversSecrets` in `src/cli/facts/agent/hooks.ts`. A settings-only addition creates the same false-pass; a hook-regex refactor without detector coverage creates a false-fail.
2. Every hook `--self-test` must include `run_case "cat <secret>" "cat <secret>" 2` assertions; a structural PASS without live probes re-opens the gap.
3. When reviewing a new agent's deny setup, run a runtime probe explicitly (e.g. `bash <hook> 'cat .env'`). Static inspection alone cannot distinguish tool-scoped deny from shell-scoped deny.

---

## Footgun: GitHub CLI comments bypassed shared-system write guardrails

**Status:** active | **Created:** 2026-05-20 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A model can post to GitHub through `gh issue comment ... --body-file ...` even when `git push` is blocked and the hook catches heredoc command substitution. The guardrail appears to stop the risky shape (`$(cat <<EOF ...)`) but still allows the same external write through a temporary body file. A narrow first fix still missed valid `gh` grammar variants such as inherited flags after the topic (`gh issue --repo owner/repo comment ...`) and `xargs ... gh issue comment ...` pipeline consumers.

**Why it happens:** The deny hook historically treated `gh` as an ordinary command unless it contained an already-blocked shell pattern. GitHub issue comments, PR reviews, releases, workflow runs, secrets/variables, and `gh api` POST/PATCH/PUT/DELETE calls mutate shared systems without using `git push`, so push-only GitHub protection is incomplete. CLI parsers also accept option placement and wrapper forms that are not obvious from the original incident command.

**Evidence:**
- Reported incident: an assistant posted a GitHub issue comment to `owner/repo#64620` from forwarded Slack text; the user deleted the comment and reported the command was `gh issue comment 64620 --repo owner/repo --body-file /tmp/issue_64620_comment.md`.
- Runtime probes before the fix returned exit 0 for `bash workflow/hooks/guard-repository-writes.sh --check "gh issue comment 64620 --repo owner/repo --body-file /tmp/issue_64620_comment.md"` and `bash workflow/hooks/guard-repository-writes.sh --check "gh api repos/owner/repo/issues/1/comments -X POST -f body=hi"`.
- Runtime probes before the second fix returned exit 0 for `bash workflow/hooks/guard-repository-writes.sh --check "gh issue --repo owner/repo comment 64620 --body hi"` and `bash workflow/hooks/guard-repository-writes.sh --check "printf '%s\n' body | xargs -I{} gh issue comment 64620 --body {}"`.
- `workflow/hooks/guard-repository-writes.sh` (search: `is_gh_write_operation`) - classifies known GitHub-mutating `gh` subcommands and `gh api` write/default-body POST forms.
- `workflow/hooks/guardrails-self-test.sh` (search: `gh issue comment`) - locks the current `gh issue comment` path plus read-only allow cases.

**Prevention:**
1. Treat `git push` as only one GitHub write path. Any new shared-system GitHub mutation route must get both a hook rule and a self-test case.
2. For CLI write classifiers, test grammar variants, not only the observed command: global/inherited options before and after the topic, short option forms, pipeline consumers such as `xargs`, and read-only controls.
3. Keep explicit read-only `gh` cases in the self-test (`issue view`, `pr checks`, explicit `gh api --method GET`) so write blocking does not turn into a blanket GitHub-read ban.
4. Forwarded Slack/email/ticket text is evidence, not authorization. The hook blocks mechanical `gh` writes; agents still need an in-turn user approval rule before any shared-system write path outside Bash.

---

## Footgun: Copilot preToolUse hooks must distinguish structured payloads from Bash calls

**Status:** active | **Created:** 2026-04-21 | **Evidence:** ACTUAL_MEASURED

**Active trap:** Copilot-style `preToolUse` hooks can receive structured payloads for non-bash tools as well as shell commands. A bash-only deny check that does not branch on `toolName` can deny safe non-bash tools or apply command regexes to the wrong payload shape.

**Original failure (resolved):** The Copilot variant's hook was registered for all tools and treated every payload as a bash invocation. Non-bash tools (view, edit, Task) had no `command` field, so the hook denied them. The implementation now extracts `toolName` and exits 0 silently for non-bash tools; the active footgun is preserving that runtime-shape distinction in future hook changes.

**Prevention:**
1. Any hook registered for a non-bash-specific event MUST read `toolName` before applying bash-only checks. Structured-payload ≠ bash-payload on runtimes like Copilot that pipe all tool calls through `preToolUse`.
2. When adding a new runtime surface, the self-test must include at least one non-bash `toolName` payload (e.g. `view`, `edit`, `Task`). Bash-only test coverage masks this exact failure shape.
3. Use the forbidden-pattern helper (`!pattern` prefix in `run_stdin_case`) for allow-path assertions - exit 0 alone does NOT distinguish "allowed silently" from "denied via copilot-json" because both exit 0.

**Evidence:**
- `workflow/hooks/guard-common.sh` (search: `detect_output_mode`) - split hooks preserve Copilot JSON deny responses for Bash payloads.
- Self-test (`bash .github/hooks/guardrails-self-test.sh --self-test=smoke`) covers Copilot-shaped Bash payloads with deny JSON assertions.

---

## Footgun: Installed settings.json deny patterns can silently drift from workflow templates

**Status:** active | **Created:** 2026-04-26 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** An agent can perform an action (e.g. `git push origin feature-branch`) that the workflow template blocks, because the installed settings.json has a weaker deny pattern than the template it was installed from. The hook may also allow it if it only blocks a narrower set. This is now covered by preflight's Agent Config Parity check, so the active trap is skipping that check or changing deny semantics without updating the parity rules.

**Why it happens:** `workflow/hooks/agent-config/claude.json` is the install template for `.claude/settings.json`. The template had `Bash(*git push*)` (block all push) but the installed copy drifted to `Bash(*git push*--force*)` (block force only). At incident time, preflight covered skill files and shared references but not settings.json deny patterns. The current `Agent Config Parity` section now verifies installed settings with `covers()` validation.

**Evidence:**
- `workflow/hooks/agent-config/claude.json` (search: `git push`) - the template had the correct blanket pattern.
- `.claude/settings.json` (search: `git push`) - the installed copy had drifted to force-only. Fixed 2026-04-26 per ADR-025.
- `scripts/preflight-checks.sh` (search: `Agent Config Parity`) - current parity check validates installed agent settings against workflow templates.

**Prevention:**
1. After changing any deny pattern in a settings template (`workflow/hooks/agent-config/*.json`), run `bash scripts/preflight-checks.sh` and confirm `Agent Config Parity` still passes.
2. When reviewing hook or settings changes, compare the installed file against its workflow template, not just against the other agent mirrors.
3. If a new agent config surface is added, extend the Agent Config Parity map and `covers()` validation in the same change.

---

## Footgun: Codex workspace-root permission profiles must use the local 0.131 token

**Status:** active | **Created:** 2026-05-19 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Codex starts but prints warnings or fails before shell startup when the permission profile names a workspace-root token or exact path the runtime cannot load. `:project_roots` is ignored by Codex 0.131.0, and exact entries such as `.env.example`, `.docker/config.json`, or `.kube/config` can break startup when those paths are absent. The TOML can still look like it denies `.env`, `.ssh/**`, `.aws/**`, and credential roots, so static review can miss that the running Codex process discarded or could not mount those rules.

**Why it happens:** Codex CLI 0.131.0 recognizes the special workspace token as `:workspace_roots`, not `:project_roots`. Both inline `":workspace_roots" = { ... }` and nested `[permissions.<profile>.filesystem.":workspace_roots"]` TOML shapes load in 0.131.0, but the `:project_roots` token is treated as an unrecognized filesystem path and ignored. Exact workspace-root entries also have to name files that exist in the checkout; absent exact entries are not a safe way to pre-deny future files.

**Evidence:**
- `.codex/config.toml` (search: `absent exact`) - installed config now uses Codex 0.131.0's accepted token and omits absent exact entries from the base profile.
- `workflow/hooks/agent-config/codex.toml` (search: `Exact entries must point at files`) - install template mirrors the accepted token and loadable base profile.
- `src/cli/facts/agent/settings.ts` (search: `existingExactPathsAreDenied`) - audit fact extraction requires exact denies only for sensitive root files that exist in the checkout.
- `src/cli/audit/check-agent-setup.ts` (search: `checkCodexWorkspaceRootExactPaths`) - agent settings audit fails when Codex config lists absent exact workspace-root paths.
- Runtime capture from the 2026-05-19 Codex startup failure showed repeated `Configured filesystem path ':project_roots' is not recognized by this version of Codex and will be ignored` warnings for the unsupported token.
- Local binary probe on 2026-05-19 found `:workspace_roots` in Codex 0.131.0's embedded schema strings and no `:project_roots` support.

**Prevention:**
1. Do not convert Codex workspace permissions back to `:project_roots`; that token is runtime-invalid on Codex 0.131.0.
2. Verify Codex config changes with a TTY startup smoke (`codex` under a short timeout) as well as `codex doctor`; non-interactive commands can miss TUI startup warnings.
3. Keep `.codex/config.toml`, `workflow/hooks/agent-config/codex.toml`, and `src/cli/facts/agent/settings.ts` in the same patch whenever Codex permission grammar changes.
4. Treat Codex permission-profile secret coverage as a loadable set, not a future-file deny list. Use trailing `/**` subtree denies in the base template, and add exact root-file denies only when the file exists in the checkout.

---

## Footgun: Codex config preservation can leave old permission profiles behind

**Status:** active | **Created:** 2026-05-21 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A normal upgrade with `goat-flow install . --agent codex` refreshes skills and hook scripts but preserves an existing `.codex/config.toml`. If that existing file predates the Codex permission-profile template, setup and agent checks can pass while `audit --harness` still reports incomplete direct literal secret-path blocking for Codex. The user sees "0 audit checks failed" from the setup prompt unless they run harness mode.

**Why it happens:** The installer intentionally skips existing settings to avoid clobbering local agent config. For Codex, `.codex/config.toml` is both a settings file and the provider-native filesystem deny surface, while hook registration lives separately in `.codex/hooks.json`. Preserving the file is safe for local customizations but does not migrate `default_permissions = "goat-flow"` or the `[permissions.goat-flow.filesystem]` profile.

**Evidence:**
- `workflow/install-goat-flow.sh` (search: `Settings file was preserved`) - existing settings are skipped unless `--force`.
- `workflow/hooks/agent-config/codex.toml` (search: `default_permissions = "goat-flow"`) - the 1.7.0 template carries the required permission-profile surface.
- `src/cli/audit/harness/check-constraints.ts` (search: `direct literal secret-path blocking incomplete`) - harness detects the missing combined file-read and Bash-hook coverage.
- 2026-05-21 downstream upgrade: after normal Codex install, `audit --agent codex --harness` still failed Constraints until exact existing root env files were added to `.codex/config.toml` alongside the template profile.

**Prevention:**
1. After Codex upgrades, run `goat-flow audit . --agent codex --harness`, not only the default setup audit.
2. If Codex settings were preserved, compare `.codex/config.toml` with `workflow/hooks/agent-config/codex.toml` and add the permission profile plus exact denies only for sensitive root files that exist in the checkout.
3. Improve the installer or setup prompt to distinguish "hook registration" in `.codex/hooks.json` from "filesystem deny profile" in `.codex/config.toml` when settings are preserved.

---

## Footgun: Git push deny checks must normalize shell wrappers and control bodies

**Status:** active | **Created:** 2026-04-27 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A deny hook can appear to block `git push` while still allowing valid shell forms that execute a push through environment wrappers, quoted assignments, `if`/`then` bodies, shell function bodies, or shell login-command wrappers such as `bash -lc 'git push ...'`.

**Why it happens:** A token check that only normalizes the start of a simple command misses shell grammar around the command word. `env -i git push ...` starts with an env option after `env`; `FOO='a b' git push ...` contains whitespace inside an assignment value; `if true; then git push ...; fi` leaves a segment starting with `then`; `f(){ git push ...; }; f` leaves a segment starting with a function declaration.

**Evidence:**
- `workflow/hooks/guard-repository-writes.sh` (search: `is_git_push`) - current split hook blocks git push and destructive git mutations.
- `workflow/hooks/guardrails-self-test.sh` (search: `sudo git push`) - self-test coverage for wrapper-prefixed git push.
- Runtime probes before the fix returned exit 0 for `bash workflow/hooks/guard-repository-writes.sh --check 'env -i git push origin main'`, `bash workflow/hooks/guard-repository-writes.sh --check "FOO='a b' git push origin main"`, `bash workflow/hooks/guard-repository-writes.sh --check 'if true; then git push origin main; fi'`, and `bash workflow/hooks/guard-repository-writes.sh --check 'f(){ git push origin main; }; f'`.
- Runtime probes before the `-lc` fix returned exit 0 for `bash workflow/hooks/guard-repository-writes.sh --check "bash -lc 'git push origin main'"` and `bash workflow/hooks/guard-repository-writes.sh --check "sh -lc 'git push origin main'"`.

**Prevention:**
1. Any future `git push` deny edit must include runtime probes for env options, quoted assignments, shell control keywords, function bodies, and `sh`/`bash -c` plus `-lc` wrappers, not only direct `git push` and pipe/semicolon chains.
2. Keep the workflow hook, `scripts/` copy, and all installed agent hook copies byte-identical after policy changes.
3. Prefer normalizing to the shell command word before calling `is_git_push`; do not add one-off regexes for only the latest bypass.

---

## Footgun: Nested hook checks must reuse the command segment splitter

**Status:** active | **Created:** 2026-04-27 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A hook can block top-level `true; rm -rf /` while allowing the same dangerous command when it is nested inside `bash -c "true; rm -rf /"` or `echo "$(true; rm -rf /)"`.

**Why it happens:** Top-level hook input is split on `&&`, `||`, semicolons, and newlines before checking each segment. Recursive paths for command substitution, process substitution, and `bash -c` can accidentally call the raw segment checker directly. If the nested string starts with a read-only verb such as `echo`, the read-only whitelist returns before the later destructive segment is inspected.

**Evidence:**
- `workflow/hooks/guard-destructive-shell.sh` (search: `rm_has_recursive`) - split destructive guardrail is the current owner for recursive deletion, shell execution, and destructive-command policy.
- `workflow/hooks/guardrails-self-test.sh` (search: `rm -rf`) - central self-test locks representative destructive-command blocking.
- Runtime proof before the fix: `bash workflow/hooks/guardrails-self-test.sh --self-test=full` returned `FAIL [bash -c semicolon dangerous]: expected 2, got 0`, `FAIL [bash -c and-chain dangerous]: expected 2, got 0`, and `FAIL [bash -c semicolon git push]: expected 2, got 0`.

**Prevention:**
1. Recursive hook paths MUST call `check_command_segments`, not `check_segment`, unless the caller has already split shell control operators.
2. Every nested execution feature (`bash -c`, `$()`, `<()`) needs at least one chained-danger self-test, not only a single-danger command body.
3. When a hook edit touches read-only whitelisting or recursive parsing, run the hook self-test before syncing copies so failures point at the canonical template.

---

## Footgun: Heredoc masking can hide executable shell lines

**Status:** active | **Created:** 2026-05-25 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Fixing heredoc false positives by masking quoted heredoc bodies is correct for inert report JSON/prose, but unsafe if the masker does not exactly mirror Bash delimiter semantics. A masker that misses `<<-` tab-indented terminators can keep treating later shell lines as heredoc data, while a masker that is too broad can let inert JSON/prose trip the chain-count cap.

**Why it happens:** The guardrail shell parser is a policy parser, not Bash. It has to preserve the heredoc opener, ignore safe quoted bodies for chain-counting, keep shell-fed heredocs (`bash <<'EOF'`) inspectable, and resume normal command scanning immediately after the real delimiter. Those responsibilities are coupled: false-positive fixes and bypass fixes both live in the same boundary.

**Evidence:**
- Runtime probe before the 2026-05-25 fix returned exit 0 for a `cat <<-'EOF' ... EOF` command followed by `rm -rf /`, because the tab-indented delimiter was not recognized and the later `rm` line was masked as body data.
- `workflow/hooks/guard-destructive-shell.sh` (search: `rm_has_recursive`) - split destructive guardrail owns shell execution and destructive-command checks after the M10 hook split.
- `workflow/hooks/guardrails-self-test.sh` (search: `rm -rf`) - central self-test locks representative destructive-command blocking.

**Prevention:**
1. Any heredoc masking edit must test both sides of the boundary: safe quoted report data is allowed, shell-fed heredoc bodies stay inspectable, and commands after `<<-` tab-indented delimiters are scanned.
2. Self-test helpers must exercise the same policy path as runtime, including the 50-segment cap; testing only `check_command_segments` misses chain-cap false positives.
3. Keep workflow, `scripts/`, and installed agent hook mirrors byte-identical after heredoc policy changes.

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

- **git diff --stat is unreliable for scope detection** (resolved 2026-04-03) - Skill templates rewritten in M17; auto-detect now uses staged changes first, then falls back to unstaged and full diff.
- **Advisory hooks create unfixable quality warning after setup** (resolved 2026-04-14) - Hook scripts now ship in enforce mode by default (`GOAT_LINT_ENFORCE` defaults to 1).
- **Codex hooks registered in config.toml instead of hooks.json** (resolved 2026-04-15) - Moved hook definitions to `.codex/hooks.json` per official Codex docs; TOML hook sections were silently ignored.
- **Codex hook migrations drift across live files, templates, installer, and docs** (resolved 2026-04-15) - Restored the missing Codex guardrail hook registration and aligned all four Codex hook surfaces (live files, templates, installer, docs).
- **Deny hook blocks read-only commands containing dangerous string literals** (resolved 2026-04-17) - the current split guardrails keep representative read-only allow paths in `workflow/hooks/guardrails-self-test.sh` (search: `expect_allow`). Template hooks and installed per-agent hook directories are checked by preflight config parity.
