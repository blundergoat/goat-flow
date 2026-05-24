---
category: hooks
last_reviewed: 2026-05-24
---

**Last independent review:** 2026-05-24 - Active entries re-verified against current anchors and hook self-tests. Workflow, Claude, GitHub, Codex, and Antigravity deny-hook self-tests each return `PASS: deny-dangerous.sh self-test`. The direct `cat .env` probe is blocked by the active PreToolUse guard before script execution; coverage relies on self-test cases plus live harness blocking for that command shape.

## Footgun: File-read deny does not bind Bash shell reads of secret files

**Status:** active | **Created:** 2026-04-19 | **Evidence:** ACTUAL_MEASURED
**hallucination-risk:** high - `Read(**/.env*)` in `settings.json` or a Codex TOML permission profile can look like a blanket secret-read deny, but it only binds file-read paths. A Bash payload like `cat .env`, `source .env`, `base64 ~/.aws/credentials` is not bound by that file-read layer and silently succeeds unless the Bash hook blocks it explicitly.

**Symptoms:** Settings-level `Read(**/.env*)` coverage can look complete even though shell-based secret reads require separate Bash-hook coverage. Before the Bash-side sentinel was added, `goat-flow audit --harness` reported `deny-covers-secrets: pass` while a live Bash probe (`bash .claude/hooks/deny-dangerous.sh 'cat .env'`) returned exit 0. Current expected behavior is exit 2 with `BLOCKED: Secret-file access ...`, verified by the runtime probe below.

**Why it happens:** Settings/config file-read deny entries are tool-scoped. Claude/Gemini `Read(...)` patterns bind the Read tool; Codex TOML permission profiles bind filesystem access. An agent using the Bash tool to run `cat .env` is not protected by file-read intent alone. Two independent coverage layers are required: file-read deny for the file tool path AND Bash-hook regex coverage for shell paths.

**Evidence:**
- `.claude/settings.json` (search: `"Read(**/.env*)"`) - tool-scoped deny patterns. Not applied to Bash.
- `.claude/hooks/deny-dangerous.sh` (search: `is_secret_path_touch`) - the Bash-side sentinel function added 2026-04-19. Blocks `cat .env`, `source .env`, `cat ~/.ssh/id_rsa`, `cat ~/.aws/credentials`, `.pem/.key/.pfx` across all four agent hooks.
- `src/cli/audit/harness/check-constraints.ts` (search: `bashDenyCoversSecrets`) - the harness now requires BOTH `readDenyCoversSecrets` (settings/Codex permission file-read coverage) AND `bashDenyCoversSecrets` (Bash hook pattern) before classifying an agent as covered.
- `src/cli/facts/agent/hooks.ts` (search: `detectBashDenyCoversSecrets`) - fact derivation: scans the deny hook file for the active secret sentinel plus family markers for `.env*`, `.env.example` parity, normalized `./` / `../` / `~/` roots, `.ssh/`, `.aws/`, `secrets/`, credentials, and `.pem/.key/.pfx`.
- Runtime probe: `bash .claude/hooks/deny-dangerous.sh 'cat .env'` now returns exit 2 with `BLOCKED: Secret-file access (cat). Reading or editing .env / SSH/AWS/GCP keys / credentials through the agent is an exfil risk.`

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
- Runtime probes before the fix returned exit 0 for `bash scripts/deny-dangerous.sh --check "gh issue comment 64620 --repo owner/repo --body-file /tmp/issue_64620_comment.md"` and `bash scripts/deny-dangerous.sh --check "gh api repos/owner/repo/issues/1/comments -X POST -f body=hi"`.
- Runtime probes before the second fix returned exit 0 for `bash scripts/deny-dangerous.sh --check "gh issue --repo owner/repo comment 64620 --body hi"` and `bash scripts/deny-dangerous.sh --check "printf '%s\n' body | xargs -I{} gh issue comment 64620 --body {}"`.
- `workflow/hooks/deny-dangerous.sh` (search: `is_gh_write_operation`) - classifies known GitHub-mutating `gh` subcommands and `gh api` write/default-body POST forms.
- `workflow/hooks/deny-dangerous.self-test.sh` (search: `gh issue comment body-file blocked`) - locks the original `--body-file` path plus `gh api` write and read-only allow cases.

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
- `workflow/hooks/deny-dangerous.sh` (search: `tool_name_lc`) - the fix extracts `toolName` and exits 0 for non-bash tools.
- Self-test (`bash .github/hooks/deny-dangerous.sh --self-test`) covers `view`, `edit`, and `Task` payloads with `!permissionDecision` assertions.

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
- `workflow/hooks/deny-dangerous.sh` (search: `normalize_git_push_candidate`) - central normalization for shell wrappers/control bodies before `is_git_push`.
- `workflow/hooks/deny-dangerous.self-test.sh` (search: `env option git push`) - self-test coverage for env options, quoted assignments, `if`/`then`, direct `if` conditions, and function bodies.
- Runtime probes before the fix returned exit 0 for `bash scripts/deny-dangerous.sh 'env -i git push origin main'`, `bash scripts/deny-dangerous.sh "FOO='a b' git push origin main"`, `bash scripts/deny-dangerous.sh 'if true; then git push origin main; fi'`, and `bash scripts/deny-dangerous.sh 'f(){ git push origin main; }; f'`.
- Runtime probes before the `-lc` fix returned exit 0 for `bash scripts/deny-dangerous.sh --check "bash -lc 'git push origin main'"` and `bash scripts/deny-dangerous.sh --check "sh -lc 'git push origin main'"`.

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
- `workflow/hooks/deny-dangerous.sh` (search: `check_command_segments`) - central splitter now reused by top-level checks, command substitution/process substitution recursion, and `bash -c` recursion.
- `workflow/hooks/deny-dangerous.self-test.sh` (search: `bash -c semicolon dangerous`) - self-test locks the nested `bash -c "echo ok; rm -rf /"` bypass.
- `workflow/hooks/deny-dangerous.self-test.sh` (search: `dangerous chained dollar substitution`) - self-test locks the nested command-substitution bypass.
- Runtime proof before the fix: `bash workflow/hooks/deny-dangerous.sh --self-test` returned `FAIL [bash -c semicolon dangerous]: expected 2, got 0`, `FAIL [bash -c and-chain dangerous]: expected 2, got 0`, and `FAIL [bash -c semicolon git push]: expected 2, got 0`.

**Prevention:**
1. Recursive hook paths MUST call `check_command_segments`, not `check_segment`, unless the caller has already split shell control operators.
2. Every nested execution feature (`bash -c`, `$()`, `<()`) needs at least one chained-danger self-test, not only a single-danger command body.
3. When a hook edit touches read-only whitelisting or recursive parsing, run the hook self-test before syncing copies so failures point at the canonical template.

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

- **git diff --stat is unreliable for scope detection** (resolved 2026-04-03) - Skill templates rewritten in M17; auto-detect now uses staged changes first, then falls back to unstaged and full diff.
- **Advisory hooks create unfixable quality warning after setup** (resolved 2026-04-14) - Hook scripts now ship in enforce mode by default (`GOAT_LINT_ENFORCE` defaults to 1).
- **Codex hooks registered in config.toml instead of hooks.json** (resolved 2026-04-15) - Moved hook definitions to `.codex/hooks.json` per official Codex docs; TOML hook sections were silently ignored.
- **Codex hook migrations drift across live files, templates, installer, and docs** (resolved 2026-04-15) - Restored missing `.codex/hooks/deny-dangerous.sh` and aligned all four Codex hook surfaces (live files, templates, installer, docs).
- **Deny hook blocks read-only commands containing dangerous string literals** (resolved 2026-04-17) - `.claude/hooks/deny-dangerous.sh` now includes a read-only tool whitelist (grep, rg, cat, head, tail, less, more, wc, file, diff, printf, echo, read, sed-without-`-i`) that skips pattern matching when the command verb is read-only AND there is no output redirection or pipe. Pipe-to-shell (`| bash`, `| python`) still blocks regardless of verb. Self-test covers 5 false-positive cases and 2 bypass-attempt cases (`.claude/hooks/deny-dangerous.self-test.sh` (search: `run_self_test`)). Template at `workflow/hooks/deny-dangerous.sh` and per-agent hooks at `.codex/hooks/` and `.gemini/hooks/` synced to the same implementation (2026-04-17).
