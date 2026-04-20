---
category: hooks
last_reviewed: 2026-04-21
---

## Footgun: Settings.json Read() deny does not bind Bash shell reads of secret files

**Status:** active | **Created:** 2026-04-19 | **Evidence:** ACTUAL_MEASURED
**hallucination-risk:** high - `Read(**/.env*)` in `settings.json` looks like a blanket secret-read deny, but it only binds the Read tool. A Bash payload like `cat .env`, `source .env`, `base64 ~/.aws/credentials` is not bound by any `Read(...)` pattern and silently succeeds unless the Bash hook blocks it explicitly.

**Symptoms:** `goat-flow audit --harness` reports `deny-covers-secrets: pass` while a live Bash probe (`bash .claude/hooks/deny-dangerous.sh 'cat .env'`) returns exit 0. A quality-report agent running in runtime-probe mode catches this gap; static-analysis reports miss it because the settings.json Read() coverage LOOKS complete.

**Why it happens:** `settings.json` `"permissions.deny"` entries are tool-scoped: `Read(...)`, `Edit(...)`, `Write(...)`, `Bash(...)` each bind only that tool. An agent using the Bash tool to run `cat .env` is never dispatched through the Read tool, so `Read(**/.env*)` is irrelevant. Two independent coverage layers are required: `Read()` denies for the Read tool path AND Bash-hook regex coverage for shell paths.

**Evidence:**
- `.claude/settings.json` (search: `"Read(**/.env*)"`) - tool-scoped deny patterns. Not applied to Bash.
- `.claude/hooks/deny-dangerous.sh` (search: `is_secret_path_touch`) - the Bash-side sentinel function added 2026-04-19. Blocks `cat .env`, `source .env`, `cat ~/.ssh/id_rsa`, `cat ~/.aws/credentials`, `.pem/.key/.pfx` across all four agent hooks.
- `src/cli/audit/harness/check-constraints.ts` (search: `bashDenyCoversSecrets`) - the harness now requires BOTH `readDenyCoversSecrets` (settings.json Read patterns) AND `bashDenyCoversSecrets` (Bash hook pattern) before classifying an agent as covered.
- `src/cli/facts/agent/hooks.ts` (search: `detectBashDenyCoversSecrets`) - fact derivation: scans the deny hook file for `\.env`, `/\.ssh/`, `/\.aws/`, `\.(pem|key|pfx)` pattern tokens.
- Runtime probe: `bash .claude/hooks/deny-dangerous.sh 'cat .env'` now returns exit 2 with `BLOCKED: Secret-file access (cat). Reading or editing .env / SSH/AWS/GCP keys / credentials through the agent is an exfil risk.`

**Prevention:**
1. For any new secret-path family added to the harness, extend BOTH `checkReadDenyCoversSecrets` in `src/cli/facts/agent/settings.ts` AND `detectBashDenyCoversSecrets` in `src/cli/facts/agent/hooks.ts`. A settings-only addition creates the same false-pass.
2. Every hook `--self-test` must include `run_case "cat <secret>" "cat <secret>" 2` assertions; a structural PASS without live probes re-opens the gap.
3. When reviewing a new agent's deny setup, run a runtime probe explicitly (e.g. `bash <hook> 'cat .env'`). Static inspection alone cannot distinguish tool-scoped deny from shell-scoped deny.

---

## Footgun: Copilot deny hook conflates "structured payload" with "bash call"

**Status:** active | **Created:** 2026-04-21 | **Evidence:** ACTUAL_MEASURED
**hallucination-risk:** high - the Copilot variant's `preToolUse` hook is registered for *all* tools, but the command-extraction path assumes every structured payload is a `bash` invocation. When it can't find a `command` field it denies with "Hook payload did not expose a bash command to evaluate", which blocks every non-bash tool (view, edit, Task, etc.) — making Copilot unusable for anything except shell calls.

**Symptoms:** Running a skill (e.g. `/goat-review`) under Copilot CLI surfaces `Denied by preToolUse hook: Hook payload did not expose a bash command to evaluate` for the skill itself and for any sub-agent (Task) invocation. Bash commands inside the same session still work. Self-tests pass because the original test matrix only exercised bash-shaped payloads.

**Why it happens:** `.github/hooks/hooks.json` registers the hook unconditionally for `preToolUse`, so Copilot pipes *every* tool call through it. The hook enters `copilot-json` output mode whenever the payload contains `toolName` / `toolArgs` / `sessionId`, then tries to pull a `.command` string out of it. Non-bash tools have no `command` field, so the "structured but no command" branch fires a deny. The Claude and Gemini variants aren't affected — they fall back to treating the full JSON as the command string, and the pattern matchers then find nothing dangerous and allow.

**Evidence:**
- `.github/hooks/deny-dangerous.sh` (search: `Hook payload did not expose a bash command`) - the original deny branch that fired for every non-bash structured payload.
- `workflow/hooks/deny-dangerous.sh` (search: `tool_name_lc`) - the source-of-truth template. Fix extracts `toolName` and exits 0 silently for anything that isn't `bash`/`shell`/`sh`.
- Runtime probe: `printf '{"toolName":"Task","toolArgs":{"description":"review"}}' | bash .github/hooks/deny-dangerous.sh` returned `{"permissionDecision":"deny",...}` before the fix; now returns empty stdout with exit 0.
- Self-test (`bash .github/hooks/deny-dangerous.sh --self-test`) now covers `view`, `edit`, and `Task` payloads with a `!permissionDecision` assertion so a regression re-adding the deny JSON fails loudly.

**Prevention:**
1. Any hook registered for a non-bash-specific event MUST read `toolName` before applying bash-only checks. Structured-payload ≠ bash-payload on runtimes like Copilot that pipe all tool calls through `preToolUse`.
2. When adding a new runtime surface, the self-test must include at least one non-bash `toolName` payload (e.g. `view`, `edit`, `Task`). Bash-only test coverage masks this exact failure shape.
3. Use the forbidden-pattern helper (`!pattern` prefix in `run_stdin_case`) for allow-path assertions — exit 0 alone does NOT distinguish "allowed silently" from "denied via copilot-json" because both exit 0.

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
- **Deny hook blocks read-only commands containing dangerous string literals** (resolved 2026-04-17) - `.claude/hooks/deny-dangerous.sh` now includes a read-only tool whitelist (grep, rg, cat, head, tail, less, more, wc, file, diff, printf, echo, read, sed-without-`-i`) that skips pattern matching when the command verb is read-only AND there is no output redirection or pipe. Pipe-to-shell (`| bash`, `| python`) still blocks regardless of verb. Self-test covers 5 false-positive cases and 2 bypass-attempt cases (`.claude/hooks/deny-dangerous.sh:88-96`). Template at `workflow/hooks/deny-dangerous.sh` and per-agent hooks at `.codex/hooks/` and `.gemini/hooks/` synced to the same implementation (2026-04-17).
