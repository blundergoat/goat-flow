---
category: hooks
last_reviewed: 2026-05-04
---

**Last independent review:** 2026-05-04 - All five active entries were reviewed against current anchors and hook self-tests. Targeted `rg` checks resolved every cited semantic anchor; workflow, Claude, GitHub, Codex, and Gemini deny-hook self-tests each returned `PASS: deny-dangerous.sh self-test`. The direct `cat .env` probe was blocked by the active PreToolUse guard before script execution, so this review relies on self-test coverage plus live harness blocking for that command shape.

## Footgun: Settings.json Read() deny does not bind Bash shell reads of secret files

**Status:** active | **Created:** 2026-04-19 | **Evidence:** ACTUAL_MEASURED
**hallucination-risk:** high - `Read(**/.env*)` in `settings.json` looks like a blanket secret-read deny, but it only binds the Read tool. A Bash payload like `cat .env`, `source .env`, `base64 ~/.aws/credentials` is not bound by any `Read(...)` pattern and silently succeeds unless the Bash hook blocks it explicitly.

**Symptoms:** Settings-level `Read(**/.env*)` coverage can look complete even though shell-based secret reads require separate Bash-hook coverage. Before the Bash-side sentinel was added, `goat-flow audit --harness` reported `deny-covers-secrets: pass` while a live Bash probe (`bash .claude/hooks/deny-dangerous.sh 'cat .env'`) returned exit 0. Current expected behavior is exit 2 with `BLOCKED: Secret-file access ...`, verified by the runtime probe below.

**Why it happens:** `settings.json` `"permissions.deny"` entries are tool-scoped: `Read(...)`, `Edit(...)`, `Write(...)`, `Bash(...)` each bind only that tool. An agent using the Bash tool to run `cat .env` is never dispatched through the Read tool, so `Read(**/.env*)` is irrelevant. Two independent coverage layers are required: `Read()` denies for the Read tool path AND Bash-hook regex coverage for shell paths.

**Evidence:**
- `.claude/settings.json` (search: `"Read(**/.env*)"`) - tool-scoped deny patterns. Not applied to Bash.
- `.claude/hooks/deny-dangerous.sh` (search: `is_secret_path_touch`) - the Bash-side sentinel function added 2026-04-19. Blocks `cat .env`, `source .env`, `cat ~/.ssh/id_rsa`, `cat ~/.aws/credentials`, `.pem/.key/.pfx` across all four agent hooks.
- `src/cli/audit/harness/check-constraints.ts` (search: `bashDenyCoversSecrets`) - the harness now requires BOTH `readDenyCoversSecrets` (settings.json Read patterns) AND `bashDenyCoversSecrets` (Bash hook pattern) before classifying an agent as covered.
- `src/cli/facts/agent/hooks.ts` (search: `detectBashDenyCoversSecrets`) - fact derivation: scans the deny hook file for the active secret sentinel plus family markers for `.env*`, `.env.example` parity, normalized `./` / `../` / `~/` roots, `.ssh/`, `.aws/`, `secrets/`, credentials, and `.pem/.key/.pfx`.
- Runtime probe: `bash .claude/hooks/deny-dangerous.sh 'cat .env'` now returns exit 2 with `BLOCKED: Secret-file access (cat). Reading or editing .env / SSH/AWS/GCP keys / credentials through the agent is an exfil risk.`

**Prevention:**
1. For any new secret-path family added to the harness, extend BOTH `checkReadDenyCoversSecrets` in `src/cli/facts/agent/settings.ts` AND `detectBashDenyCoversSecrets` in `src/cli/facts/agent/hooks.ts`. A settings-only addition creates the same false-pass; a hook-regex refactor without detector coverage creates a false-fail.
2. Every hook `--self-test` must include `run_case "cat <secret>" "cat <secret>" 2` assertions; a structural PASS without live probes re-opens the gap.
3. When reviewing a new agent's deny setup, run a runtime probe explicitly (e.g. `bash <hook> 'cat .env'`). Static inspection alone cannot distinguish tool-scoped deny from shell-scoped deny.

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

## Footgun: Git push deny checks must normalize shell wrappers and control bodies

**Status:** active | **Created:** 2026-04-27 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A deny hook can appear to block `git push` while still allowing valid shell forms that execute a push through environment wrappers, quoted assignments, `if`/`then` bodies, shell function bodies, or shell login-command wrappers such as `bash -lc 'git push ...'`.

**Why it happens:** A token check that only normalizes the start of a simple command misses shell grammar around the command word. `env -i git push ...` starts with an env option after `env`; `FOO='a b' git push ...` contains whitespace inside an assignment value; `if true; then git push ...; fi` leaves a segment starting with `then`; `f(){ git push ...; }; f` leaves a segment starting with a function declaration.

**Evidence:**
- `workflow/hooks/deny-dangerous.sh` (search: `normalize_git_push_candidate`) - central normalization for shell wrappers/control bodies before `is_git_push`.
- `workflow/hooks/deny-dangerous.sh` (search: `env option git push`) - self-test coverage for env options, quoted assignments, `if`/`then`, direct `if` conditions, and function bodies.
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
- `workflow/hooks/deny-dangerous.sh` (search: `bash -c semicolon dangerous`) - self-test locks the nested `bash -c "echo ok; rm -rf /"` bypass.
- `workflow/hooks/deny-dangerous.sh` (search: `dangerous chained dollar substitution`) - self-test locks the nested command-substitution bypass.
- Runtime proof before the fix: `bash workflow/hooks/deny-dangerous.sh --self-test` returned `FAIL [bash -c semicolon dangerous]: expected 2, got 0`, `FAIL [bash -c and-chain dangerous]: expected 2, got 0`, and `FAIL [bash -c semicolon git push]: expected 2, got 0`.

**Prevention:**
1. Recursive hook paths MUST call `check_command_segments`, not `check_segment`, unless the caller has already split shell control operators.
2. Every nested execution feature (`bash -c`, `$()`, `<()`) needs at least one chained-danger self-test, not only a single-danger command body.
3. When a hook edit touches read-only whitelisting or recursive parsing, run the hook self-test before syncing copies so failures point at the canonical template.

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

- **Notification/compact hook was silently dead** (resolved 2026-04-19) - Claude Code's hook events are `PreCompact` / `PostCompact`; `Notification` + matcher `"compact"` was never a real event, so the hook's echo-state-after-compaction command never fired. M17-2 removed the entire compaction-hook machinery from settings files, scanner (`detectCompactionHookExists`, `compactionHookExists` fact, `compaction_support` capability), harness check (`check-recovery.ts` `compactionHook`), tests, and docs. The recovery concern now has two checks: `milestone-tracking` and `session-logs`.
- **Codex has no compaction notification hook** (resolved 2026-04-19) - rolled up into the Notification/compact removal above. Platform-parity gap is moot now that no agent registers a compaction hook.
- **Post-turn hook swallows failures with `|| true`** (resolved 2026-04-14) - goat-flow removed `stop-lint.sh` from core in v1.1.0 per ADR-015; post-turn lint hooks are project-specific. Consumer projects on pre-v1.1 installs should update their local `stop-lint.sh` to default `GOAT_LINT_ENFORCE=1`. Originally surfaced by Codex critiques on downstream consumer projects (the-summit-chatroom and blundergoat-platform) where `|| true` after lint commands hid failures; goat-flow itself never shipped the trap.
- **git diff --stat is unreliable for scope detection** (resolved 2026-04-03) - Skill templates rewritten in M17; auto-detect now uses staged changes first, then falls back to unstaged and full diff.
- **Advisory hooks create unfixable quality warning after setup** (resolved 2026-04-14) - Hook scripts now ship in enforce mode by default (`GOAT_LINT_ENFORCE` defaults to 1).
- **Codex hooks registered in config.toml instead of hooks.json** (resolved 2026-04-15) - Moved hook definitions to `.codex/hooks.json` per official Codex docs; TOML hook sections were silently ignored.
- **Codex hook migrations drift across live files, templates, installer, and docs** (resolved 2026-04-15) - Restored missing `.codex/hooks/deny-dangerous.sh` and aligned all four Codex hook surfaces (live files, templates, installer, docs).
- **Deny hook blocks read-only commands containing dangerous string literals** (resolved 2026-04-17) - `.claude/hooks/deny-dangerous.sh` now includes a read-only tool whitelist (grep, rg, cat, head, tail, less, more, wc, file, diff, printf, echo, read, sed-without-`-i`) that skips pattern matching when the command verb is read-only AND there is no output redirection or pipe. Pipe-to-shell (`| bash`, `| python`) still blocks regardless of verb. Self-test covers 5 false-positive cases and 2 bypass-attempt cases (`.claude/hooks/deny-dangerous.sh` (search: `run_self_test`)). Template at `workflow/hooks/deny-dangerous.sh` and per-agent hooks at `.codex/hooks/` and `.gemini/hooks/` synced to the same implementation (2026-04-17).
