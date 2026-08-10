# workflow/hooks/

Copyable hook scripts and agent-config templates for the GOAT Flow enforcement layer.

## Hook Scripts

| Script | Event | Required? | Purpose |
|--------|-------|-----------|---------|
| `run-with-bash.mjs` | Managed launcher | Required with registered hooks | Resolves the selected project, enforces the launcher deadline, and preserves direct legacy output or delivers a bounded result |
| `hook-provider-adapters.mjs` | Provider response | Required with migrated result hooks | Validates the versioned result envelope and translates it into the active coding agent's documented response shape |
| `deny-dangerous.sh` | PreToolUse | Required | Single dispatcher that blocks destructive shell commands, direct secret-path access, `git commit` / `git push`, destructive git flags, and GitHub writes via `gh` |
| `deny-dangerous/*.sh` | Sourced policy store | Required with `deny-dangerous.sh` | Shared destructive-shell, secret-path, repository-write policy modules plus the central `deny-dangerous-self-test.sh` |
| `gruff-code-quality.sh` | PostToolUse | Optional | Checks each edited source file with its nearest package config and returns attributable line, symbol, file, and project findings through a bounded provider result |
| `post-turn-safety.sh` | Stop | Default for supported Stop agents | Scans changed text content for built-in safety hazards such as obvious secrets, private keys, credential assignments, and merge conflict markers |

## Agent Event Name Mapping

| Purpose | Claude Code | Codex CLI | Antigravity | Copilot CLI |
|---------|-------------|-----------|-------------|-------------|
| Block before tool runs | PreToolUse | PreToolUse in `.codex/hooks.json` with `deny-dangerous.sh` matched to `Bash` | PreToolUse in `.agents/hooks.json` with `deny-dangerous.sh` matched to `run_command` and secret-bearing file tools | `preToolUse` in `.github/hooks/hooks.json` with `deny-dangerous.sh` |
| Attributable Gruff quality | PostToolUse matched to `Edit`, `Write`, and `Bash` events containing `apply_patch` | Unsupported until Codex PostToolUse result delivery is verified | Unsupported because PostToolUse cannot return feedback to the active model | `postToolUse` entry with the shipped `gruff-code-quality.sh` command |
| Universal post-turn safety | Stop with `post-turn-safety.sh` | Unsupported; Codex Stop-hook delivery is unverified (registered Stop hooks did not fire under codex exec 0.139.0) | Skipped; Antigravity Stop-hook delivery is unverified (hook trust gates execution; no Stop payload captured firing) | Unsupported; `agentStop` delivery is unverified and Goat Flow has no current registration adapter |
| Permission deny list | `.claude/settings.json` deny patterns | Filesystem permission profile in `.codex/config.toml`; command denies in the Bash hooks | Script-only guardrails; no provider-native file-read/file-write deny layer is claimed | Script-only guardrails; no provider-native file-read/file-write deny layer is claimed |
| Config format | JSON | TOML + JSON | JSON | JSON |

## Setup

1. Copy `run-with-bash.mjs`, `deny-dangerous.sh`, and `post-turn-safety.sh` to `.goat-flow/hooks/`, and copy `deny-dangerous/` to `.goat-flow/hooks/deny-dangerous/`. When Gruff is enabled, install `hook-provider-adapters.mjs` and `gruff-code-quality.sh` together.
2. Copy the matching agent-config template(s) for your runtime:
   - Claude: `agent-config/claude.json` -> `.claude/settings.json`
   - Codex: `agent-config/codex.toml` -> `.codex/config.toml` and `agent-config/codex-hooks.json` -> `.codex/hooks.json`
   - Antigravity: `agent-config/antigravity-hooks.json` -> `.agents/hooks.json`
   - Copilot: `agent-config/copilot-hooks.json` -> `.github/hooks/hooks.json`
3. `gruff-code-quality.sh` is opt-in through `.goat-flow/config.yaml`, the dashboard Hooks page, or `goat-flow hooks enable gruff-code-quality`.

Generated hook commands resolve a verified managed project root before starting `run-with-bash.mjs`, so nested working directories and linked worktrees use the scripts beside the files being edited. Claude, Antigravity, and Copilot can use `CLAUDE_PROJECT_DIR` as a final configured-root fallback; Codex has no supported host-root variable and fails closed when no managed root is available. Missing policy or post-turn hooks fail closed. Missing Gruff remains a visible non-blocking skip.

## Direct and Registered Results

Direct `.sh` use keeps each hook's existing stdout, stderr, exit status, `--check`, and self-test interface. Registered Gruff commands for Claude and Copilot use a namespaced provider-result contract; legacy hooks keep their one-word mode. A migrated command names the provider, response kind, result protocol, lifecycle event, adapter version, and launcher deadline.

The `goat-flow.hook-result.v1` path captures at most 10,000 combined stdout/stderr bytes, accepts one JSON object, caps findings at 20, and requires complete declared coverage before `pass`. Malformed, empty, partial, timed-out, or mismatched results become explicit unavailable outcomes. Provider adapters preserve blocking semantics; a host/event pair that cannot deliver the result remains unsupported instead of receiving weaker advice.

## Failure Modes / Runtime Contracts

- `.goat-flow/hooks/deny-dangerous/` must be present and tracked. If it is missing, `deny-dangerous.sh` denies with a clear policy-store message instead of reaching an undefined policy function or exiting 127.
- `deny-dangerous.sh` is a defense-in-depth classifier, not a shell interpreter or sandbox. It normalizes supported `xargs`, `find -exec`, `watch`, shell-c, and common GNU Parallel forms before applying the existing destructive, secret-path, and repository-write rules. Unknown wrapper grammar and variable-computed executable names remain outside its guarantees; agent permissions, filesystem isolation, and operating-system credentials remain the hard boundary.
- Known read-only download filters, local data passed to an explicit script file, literal `vendor` or `target` cleanup, and approved issue or pull-request comments remain allowed. Run an unclear command manually after inspection.
- Audit and preflight run the exact configured command strings from `.claude/settings.json`, `.codex/hooks.json`, `.agents/hooks.json`, and `.github/hooks/hooks.json`; this catches stale paths, missing executable bits, and command-shape failures before an agent session sees them.
- Use `goat-flow hooks verify . --agent <id> --scenario <deny-hook|post-turn-hook|gruff-hook>` to replay fixed offline inputs through one agent's exact configured command. A passing report proves only that local boundary; it does not prove the external provider fired the hook or showed the result to the model.
- Claude, Codex, and Antigravity support nested cwd inside a git checkout through the root-resolving wrapper. Outside a git checkout, `deny-dangerous.sh` fails closed unless an agent-specific project root fallback is documented and configured; today that fallback is `$CLAUDE_PROJECT_DIR` for Claude/Antigravity, not Codex. `gruff-code-quality.sh` fails soft.
- Copilot uses direct project-local paths and therefore requires a repo-root working directory for the configured command. Nested-cwd execution is outside the current Copilot contract unless that runtime adds a portable project-root variable or root-resolving command support.
- Directly invoked `.sh` hooks must keep executable bits. Missing `bash` is a hard runtime prerequisite for all shipped guardrails.
- Registered Gruff installs `hook-provider-adapters.mjs` with its namespaced launch mode. Missing or malformed pieces produce visible unavailable feedback.
- `post-turn-safety.sh` uses an optimized Bash 4+ scanner and a bounded compatibility scanner on stock macOS Bash 3.2. Both enforce the same findings and wall-clock limit. Tracked and staged text streams as added hunks regardless of full file size; binary changed paths and whole untracked text above `GOAT_FLOW_POST_TURN_SAFETY_MAX_BYTES` report incomplete and block. A valid Stop payload can end one exact repeated command failure loudly, while findings, coverage gaps, budget exhaustion, and malformed payloads keep blocking. The default scan budget is 60 seconds and the registered Stop timeout is 90 seconds, so the hook can print its own diagnostic before the runner intervenes. Run `bash .goat-flow/hooks/post-turn-safety.sh --self-test` after install or upgrade.

## Post-Turn Safety

goat-flow ships `post-turn-safety.sh` as the universal no-setup Stop hook for Claude; Codex and Antigravity are excluded until their Stop-hook delivery is verified (Codex registered Stop hooks did not fire under codex exec 0.139.0; Antigravity hook trust gates execution and no Stop payload was captured firing). It scans changed text content for built-in safety hazards. It does not run builds, tests, linters, typecheckers, or formatters, and must not be treated as project validation.

Tracked and staged text is scanned from added hunks, including files above the whole-file cap. Non-ignored untracked text above the cap and binary changed paths return explicit incomplete results. New content cannot authorize its own suppression: inline allow markers on a new finding still block. Move intentional scanner fixtures to split synthetic values, or leave a reviewed committed fixture unchanged.

For a valid Claude Stop payload, the first incomplete command failure blocks and records only owner-local hashes. One exact active replay can end loudly without claiming a clean scan. Changed findings, incomplete content coverage, budget exhaustion, and malformed input always block. Run `bash .goat-flow/hooks/post-turn-safety.sh --self-test` to check clean, finding, incomplete, and Bash 3 outcomes; unknown options fail instead of scanning.

goat-flow does not ship a project-validation Stop hook or a plan-reminder Stop hook. Run project-specific build, test, lint, typecheck, format, and milestone accounting through explicit verification gates. The shipped `gruff-code-quality.sh` prefers payload-declared edit or patch targets, uses Git only when a runtime omits paths, and reports incomplete scope instead of clean work when Git fails.

## Codex Permissions

Codex does not read Claude's `settings.json` `permissions.allow` or `permissions.deny` syntax. The equivalent file-access layer is a TOML permission profile selected by `default_permissions` in `.codex/config.toml`; goat-flow's Codex template extends Codex's built-in `:workspace` profile and adds recursive `deny` rules for common secret-bearing project paths. Shell command patterns still belong in `.codex/hooks.json` through the Bash-matched `PreToolUse` `deny-dangerous.sh` dispatcher.

Deny rules take precedence over allow rules on BOTH agents, so a broad `Read(**/.env*)` deny cannot be re-opened for `.env.example` - the shipped Claude allow entries were dead config until this was corrected in 2026-07. Both templates therefore deny the real env variants individually (`**/.env`, `**/.envrc`, `**/.env.local`, `**/.env.development`, `**/.env.production`, `**/.env.staging`, `**/.env.test`, `**/.env.*.local`) for reads AND edits, so `.env.example` matches no deny and stays fully readable and writable - the same policy the Bash deny hook enforces, which allows `.env.example` reads and writes while blocking real `.env*` access in both directions. Nonstandard variants (e.g. `.env.backup`) are covered by the Bash hook's literal-path blocking for shell commands only, not by the file-read deny layer.
