# workflow/hooks/

Copyable hook scripts and agent-config templates for the GOAT Flow enforcement layer.

## Hook Scripts

| Script | Event | Required? | Purpose |
|--------|-------|-----------|---------|
| `deny-dangerous.sh` | PreToolUse | Required | Single dispatcher that blocks destructive shell commands, direct secret-path access, `git commit` / `git push`, destructive git flags, and GitHub writes via `gh` |
| `hook-lib/*.sh` | Sourced policy store | Required with `deny-dangerous.sh` | Shared destructive-shell, secret-path, repository-write policy modules plus the central `deny-dangerous-self-test.sh` |
| `gruff-code-quality.sh` | PostToolUse | Optional | Runs the matching `gruff-*` analyzer after file edits and surfaces findings whose reported line intersects changed lines |

## Agent Event Name Mapping

| Purpose | Claude Code | Codex CLI | Antigravity | Copilot CLI |
|---------|-------------|-----------|-------------|-------------|
| Block before tool runs | PreToolUse | PreToolUse in `.codex/hooks.json` with `deny-dangerous.sh` matched to `Bash` | PreToolUse in `.agents/hooks.json` with `deny-dangerous.sh` matched to `run_command` and secret-bearing file tools | `preToolUse` in `.github/hooks/hooks.json` with `deny-dangerous.sh` |
| Changed-line gruff quality | PostToolUse matched to `Edit`, `Write`, and `MultiEdit` | PostToolUse matched to `Edit`, `Write`, and `MultiEdit` | PostToolUse matched to `write_to_file`, `replace_file_content`, and `multi_replace_file_content` | `postToolUse` entry with the shipped `gruff-code-quality.sh` command |
| Permission deny list | `.claude/settings.json` deny patterns | Filesystem permission profile in `.codex/config.toml`; command denies in the Bash hooks | Script-only guardrails; no provider-native file-read/file-write deny layer is claimed | Script-only guardrails; no provider-native file-read/file-write deny layer is claimed |
| Config format | JSON | TOML + JSON | JSON | JSON |

## Setup

1. Copy `deny-dangerous.sh` to your agent's hooks directory and copy `hook-lib/` to `.goat-flow/hook-lib/`.
2. Copy the matching agent-config template(s) for your runtime:
   - Claude: `agent-config/claude.json` -> `.claude/settings.json`
   - Codex: `agent-config/codex.toml` -> `.codex/config.toml` and `agent-config/codex-hooks.json` -> `.codex/hooks.json`
   - Antigravity: `agent-config/antigravity-hooks.json` -> `.agents/hooks.json`
   - Copilot: `agent-config/copilot-hooks.json` -> `.github/hooks/hooks.json`
3. `gruff-code-quality.sh` is opt-in through `.goat-flow/config.yaml`, the dashboard Hooks page, or `goat-flow hooks enable gruff-code-quality`.

Claude and Antigravity hook commands resolve the repository root with `git rev-parse --git-common-dir` and take its parent directory, so the launcher always points at the main repo's `.claude/hooks/` (or `.agents/hooks/`) even inside a worktree at `.claude/worktrees/<branch>/`. The launcher falls back to `--show-toplevel` when `--git-common-dir` returns a relative `.git` path (i.e. the main checkout from its working directory). If neither resolution succeeds, the configured command fails closed before the hook script starts: Claude emits a stderr `BLOCKED:` message with exit 2, and Antigravity emits deny JSON with exit 0. Codex and Copilot hook commands use direct project-local script paths because their configs are expected to run from the selected project root.

## Failure Modes / Runtime Contracts

- `.goat-flow/hook-lib/` must be present and tracked. If it is missing, `deny-dangerous.sh` denies with a clear hook-lib message instead of reaching an undefined policy function or exiting 127.
- Audit and preflight run the exact configured command strings from `.claude/settings.json`, `.codex/hooks.json`, `.agents/hooks.json`, and `.github/hooks/hooks.json`; this catches stale paths, missing executable bits, and command-shape failures before an agent session sees them.
- Claude and Antigravity support nested cwd inside a git checkout through the root-resolving wrapper. Outside a git checkout they fail closed as described above.
- Codex and Copilot use direct project-local paths and therefore require project-root cwd for the configured command. Nested-cwd execution is outside the current contract unless those runtimes add a portable project-root variable.
- Directly invoked `.sh` hooks must keep executable bits. Missing `bash` is a hard runtime prerequisite for all shipped guardrails.

## Post-Turn Linting (project-specific, not shipped)

goat-flow does not ship a post-turn lint hook. Every project has different linters, configs, and performance constraints. If you want post-turn validation, write a project-specific script for the Claude `Stop`, Codex `Stop`, or Antigravity `Stop` event and register it in that agent's hook config. The shipped `gruff-code-quality.sh` is a file-edit hook: it runs on supported file-write tools, prefers the edited path from the hook payload, and falls back to git-changed supported files when a runtime omits the path.

## Codex Permissions

Codex does not read Claude's `settings.json` `permissions.allow` or `permissions.deny` syntax. The equivalent file-access layer is a TOML permission profile selected by `default_permissions` in `.codex/config.toml`; goat-flow's Codex template denies common secret-bearing project subtrees there and leaves `.env.example` to the Bash hook's read-only allowlist. Codex rules must be exact paths that exist in the checkout or trailing `/**` subtrees, so recursive filename globs such as `**/.env.example` cannot be used for `read` access and absent exact paths must not be listed. Shell command patterns still belong in `.codex/hooks.json` through the Bash-matched `PreToolUse` `deny-dangerous.sh` dispatcher.
