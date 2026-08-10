# workflow/hooks/

Copyable hook scripts and agent-config templates for the GOAT Flow enforcement layer.

## Hook Scripts

| Script | Event | Required? | Purpose |
|--------|-------|-----------|---------|
| `run-with-bash.mjs` | Managed launcher | Required with registered hooks | Resolves the selected project, enforces the launcher deadline, and preserves direct legacy output or delivers a bounded result |
| `hook-launch-runtime.mjs` | Managed runtime | Required with registered hooks | Runs the child hook, caps output, enforces deadlines, and prepares provider-visible launcher failures |
| `hook-provider-adapters.mjs` | Provider response | Required with migrated result hooks | Validates the versioned result envelope and translates it into the active coding agent's documented response shape |
| `deny-dangerous.sh` | PreToolUse | Required | Single dispatcher that blocks destructive shell commands, direct secret-path access, `git commit` / `git push`, destructive git flags, and GitHub writes via `gh` |
| `deny-dangerous/*.sh` | Sourced policy store | Required with `deny-dangerous.sh` | Shared destructive-shell, secret-path, repository-write policy modules plus the central `deny-dangerous-self-test.sh` |
| `gruff-code-quality.sh` | PostToolUse | Optional | Checks each edited source file with its nearest package config and returns attributable line, symbol, file, and project findings through a bounded provider result |
| `post-turn-safety.sh` | Stop | Default for supported Stop agents | Scans changed text content for built-in safety hazards such as obvious secrets, private keys, credential assignments, and merge conflict markers |

## Agent Event Name Mapping

| Purpose | Claude Code | Codex CLI | Antigravity | Copilot CLI |
|---------|-------------|-----------|-------------|-------------|
| Block before tool runs | PreToolUse | PreToolUse in `.codex/hooks.json` with `deny-dangerous.sh` matched to `Bash` | PreToolUse in `.agents/hooks.json` with `deny-dangerous.sh` matched to `run_command` and secret-bearing file tools | `preToolUse` in `.github/hooks/hooks.json` with `deny-dangerous.sh` |
| Attributable Gruff quality | Registered PostToolUse for `Edit`, `Write`, and `Bash` containing `apply_patch`; no fresh 1.15.1 provider-delivery claim | Registered PostToolUse matched to `^apply_patch$`; time-bounded live delivery for project hooks in interactive and exec modes | Disabled because PostToolUse did not deliver feedback to the active model | Registered `postToolUse`; no fresh 1.15.1 provider-delivery claim |
| Universal post-turn safety | Registered Stop with `post-turn-safety.sh`; no fresh 1.15.1 provider-delivery claim | Registered Stop; time-bounded live delivery for project hooks in interactive and exec modes | Disabled because execution was not captured past the hook trust gate | Disabled because `agentStop` delivery and a Goat Flow registration adapter are unverified |
| Permission deny list | `.claude/settings.json` deny patterns | Filesystem permission profile in `.codex/config.toml`; command denies in the Bash hooks | Script-only guardrails; no provider-native file-read/file-write deny layer is claimed | Script-only guardrails; no provider-native file-read/file-write deny layer is claimed |
| Config format | JSON | TOML + JSON | JSON | JSON |

The Codex live claim is exact: Codex CLI 0.147.0 project hooks, a trusted project layer, interactive TUI and noninteractive exec, `PostToolUse` for `apply_patch`, and `Stop`. The capture was recorded on 2026-08-10 and expires at 2026-09-09T00:00:00Z. The registry then reports stale provider evidence instead of effective coverage.

The capture becomes stale sooner when the provider version or mode, project-layer trust, event, adapter, or registration changes. Project-layer trust decides whether Codex loads project hooks; handler trust separately decides whether a loaded command may run. Passing either gate does not pass the other. Codex app-server, remote execution, and every other provider/mode/event combination have no fresh live-delivery claim in this release.

## Setup

1. Copy `run-with-bash.mjs`, `hook-launch-runtime.mjs`, `hook-provider-adapters.mjs`, `deny-dangerous.sh`, and `post-turn-safety.sh` to `.goat-flow/hooks/`, then copy `deny-dangerous/` to `.goat-flow/hooks/deny-dangerous/`. When Gruff is enabled, also copy `gruff-code-quality.sh`.
2. Copy the matching agent-config template(s) for your runtime:
   - Claude: `agent-config/claude.json` -> `.claude/settings.json`
   - Codex: `agent-config/codex.toml` -> `.codex/config.toml` and `agent-config/codex-hooks.json` -> `.codex/hooks.json`
   - Antigravity: `agent-config/antigravity-hooks.json` -> `.agents/hooks.json`
   - Copilot: `agent-config/copilot-hooks.json` -> `.github/hooks/hooks.json`
3. `gruff-code-quality.sh` is opt-in through `.goat-flow/config.yaml`, the dashboard Hooks page, or `goat-flow hooks enable gruff-code-quality`.

Generated hook commands resolve a verified managed project root before starting `run-with-bash.mjs`, so nested working directories and linked worktrees use the scripts beside the files being edited. Claude, Antigravity, and Copilot can use `CLAUDE_PROJECT_DIR` as a final configured-root fallback; Codex has no supported host-root variable and fails closed when no managed root is available. Missing policy or post-turn hooks fail closed. Missing Gruff remains a visible non-blocking skip.

## Direct and Registered Results

Direct `.sh` use keeps each hook's existing stdout, stderr, exit status, `--check`, and self-test interface. Registered Gruff commands for Claude, Codex, and Copilot, plus the Codex Stop command, use the namespaced provider-result contract. Deny commands and other registered Stop commands retain their legacy result mode. A namespaced command records the provider, response kind, result protocol, lifecycle event, adapter version, and launcher deadline.

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
- Every namespaced result command installs `hook-provider-adapters.mjs` and `hook-launch-runtime.mjs`. Missing or malformed pieces produce visible unavailable feedback.
- `post-turn-safety.sh` uses an optimized Bash 4+ scanner and a bounded compatibility scanner on stock macOS Bash 3.2. Both enforce the same findings and wall-clock limit. Tracked and staged text streams as added hunks regardless of full file size; binary changed paths and whole untracked text above `GOAT_FLOW_POST_TURN_SAFETY_MAX_BYTES` report incomplete and block. A valid Stop payload can end one exact repeated command failure loudly, while findings, coverage gaps, budget exhaustion, and malformed payloads keep blocking. The default scan budget is 60 seconds and the registered Stop timeout is 90 seconds, so the hook can print its own diagnostic before the runner intervenes. Run `bash .goat-flow/hooks/post-turn-safety.sh --self-test` after install or upgrade.

## Post-Turn Safety

goat-flow configures `post-turn-safety.sh` by default for Claude and Codex. Only the exact Codex project-hook combination above has fresh live-provider delivery evidence for this release. Antigravity remains disabled because Stop execution was not captured past its trust gate, and Copilot remains disabled because `agentStop` delivery and a Goat Flow registration adapter are unverified. The hook scans changed text content for built-in safety hazards. It does not run builds, tests, linters, typecheckers, or formatters, and must not be treated as project validation.

Tracked and staged text is scanned from added hunks, including files above the whole-file cap. Non-ignored untracked text above the cap and binary changed paths return explicit incomplete results. New content cannot authorize its own suppression: inline allow markers on a new finding still block. Move intentional scanner fixtures to split synthetic values, or leave a reviewed committed fixture unchanged.

For a valid Stop payload, the first incomplete command failure blocks and records only owner-local hashes. One exact active replay may end with an incomplete `bounded-reentry-ended` result so the user can regain control; it never becomes a pass or a clean scan. Changed findings, incomplete content coverage, budget exhaustion, and malformed input always block. Run `bash .goat-flow/hooks/post-turn-safety.sh --self-test` to check clean, finding, incomplete, and Bash 3 outcomes; unknown options fail instead of scanning.

goat-flow does not ship a project-validation Stop hook or a plan-reminder Stop hook. Run project-specific build, test, lint, typecheck, format, and milestone accounting through explicit verification gates. The shipped `gruff-code-quality.sh` prefers payload-declared edit or patch targets, uses Git only when a runtime omits paths, and reports incomplete scope instead of clean work when Git fails.

## Codex Permissions

Codex does not read Claude's `settings.json` `permissions.allow` or `permissions.deny` syntax. The equivalent file-access layer is a TOML permission profile selected by `default_permissions` in `.codex/config.toml`; goat-flow's Codex template extends Codex's built-in `:workspace` profile and adds recursive `deny` rules for common secret-bearing project paths. Shell command patterns still belong in `.codex/hooks.json` through the Bash-matched `PreToolUse` `deny-dangerous.sh` dispatcher.

Deny rules take precedence over allow rules on BOTH agents, so a broad `Read(**/.env*)` deny cannot be re-opened for `.env.example` - the shipped Claude allow entries were dead config until this was corrected in 2026-07. Both templates therefore deny the real env variants individually (`**/.env`, `**/.envrc`, `**/.env.local`, `**/.env.development`, `**/.env.production`, `**/.env.staging`, `**/.env.test`, `**/.env.*.local`) for reads AND edits, so `.env.example` matches no deny and stays fully readable and writable - the same policy the Bash deny hook enforces, which allows `.env.example` reads and writes while blocking real `.env*` access in both directions. Nonstandard variants (e.g. `.env.backup`) are covered by the Bash hook's literal-path blocking for shell commands only, not by the file-read deny layer.
