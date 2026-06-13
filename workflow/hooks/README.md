# workflow/hooks/

Copyable hook scripts and agent-config templates for the GOAT Flow enforcement layer.

## Hook Scripts

| Script | Event | Required? | Purpose |
|--------|-------|-----------|---------|
| `deny-dangerous.sh` | PreToolUse | Required | Single dispatcher that blocks destructive shell commands, direct secret-path access, `git commit` / `git push`, destructive git flags, and GitHub writes via `gh` |
| `deny-dangerous/*.sh` | Sourced policy store | Required with `deny-dangerous.sh` | Shared destructive-shell, secret-path, repository-write policy modules plus the central `deny-dangerous-self-test.sh` |
| `gruff-code-quality.sh` | PostToolUse | Optional | Runs the matching `gruff-*` analyzer after file edits and surfaces findings whose reported line intersects changed lines |
| `post-turn-safety.sh` | Stop | Default for supported Stop agents | Scans changed text content for built-in safety hazards such as obvious secrets, private keys, credential assignments, and merge conflict markers |
| `plan-checkbox-guard.sh` | Stop | Default for Claude only (verified Stop payload) | Reminds agents to update the active milestone plan when repo changes move while open checkboxes remain untouched |

## Agent Event Name Mapping

| Purpose | Claude Code | Codex CLI | Antigravity | Copilot CLI |
|---------|-------------|-----------|-------------|-------------|
| Block before tool runs | PreToolUse | PreToolUse in `.codex/hooks.json` with `deny-dangerous.sh` matched to `Bash` | PreToolUse in `.agents/hooks.json` with `deny-dangerous.sh` matched to `run_command` and secret-bearing file tools | `preToolUse` in `.github/hooks/hooks.json` with `deny-dangerous.sh` |
| Changed-line gruff quality | PostToolUse matched to `Edit` and `Write` | PostToolUse matched to `Edit` and `Write` | PostToolUse matched to `write_to_file`, `replace_file_content`, and `multi_replace_file_content` | `postToolUse` entry with the shipped `gruff-code-quality.sh` command |
| Universal post-turn safety | Stop with `post-turn-safety.sh` | Stop with `post-turn-safety.sh` | Stop with `post-turn-safety.sh` | Not supported; no project-local post-turn event |
| Plan checkbox reminder | Stop with `plan-checkbox-guard.sh` | Skipped; Codex Stop-hook delivery is unverified (registered Stop hooks did not fire under codex exec 0.139.0) | Skipped; Antigravity Stop payload is unverified (hook trust gates execution; no `stop_hook_active` loop guard observed) | Not supported; no project-local post-turn event |
| Permission deny list | `.claude/settings.json` deny patterns | Filesystem permission profile in `.codex/config.toml`; command denies in the Bash hooks | Script-only guardrails; no provider-native file-read/file-write deny layer is claimed | Script-only guardrails; no provider-native file-read/file-write deny layer is claimed |
| Config format | JSON | TOML + JSON | JSON | JSON |

## Setup

1. Copy `deny-dangerous.sh`, `post-turn-safety.sh`, and `plan-checkbox-guard.sh` to `.goat-flow/hooks/`, and copy `deny-dangerous/` to `.goat-flow/hooks/deny-dangerous/`.
2. Copy the matching agent-config template(s) for your runtime:
   - Claude: `agent-config/claude.json` -> `.claude/settings.json`
   - Codex: `agent-config/codex.toml` -> `.codex/config.toml` and `agent-config/codex-hooks.json` -> `.codex/hooks.json`
   - Antigravity: `agent-config/antigravity-hooks.json` -> `.agents/hooks.json`
   - Copilot: `agent-config/copilot-hooks.json` -> `.github/hooks/hooks.json`
3. `gruff-code-quality.sh` is opt-in through `.goat-flow/config.yaml`, the dashboard Hooks page, or `goat-flow hooks enable gruff-code-quality`. `plan-checkbox-guard.sh` is default-on for Claude (the only agent whose Stop payload is verified; see the M02b spike in ADR-038) and configurable under `hooks.plan-checkbox-guard` plus the `plan-guard` block.

Claude, Codex, and Antigravity hook commands resolve the active repository root with `git rev-parse --show-toplevel`, so nested cwd sessions and linked worktrees run the `.goat-flow/hooks/` scripts checked out beside the files being edited. Claude and Antigravity then fall back to `$CLAUDE_PROJECT_DIR` for sessions whose persisted shell cwd has moved outside any git checkout; Codex has no documented project-root environment fallback and fails closed outside git. Missing `deny-dangerous.sh` still fails closed before a tool runs: Claude and Codex emit a stderr `BLOCKED:` message with exit 2, and Antigravity emits deny JSON with exit 0. Missing `post-turn-safety.sh` fails closed at Stop because the hook cannot make the promised post-turn safety check. Missing `plan-checkbox-guard.sh` exits 1 with a hook-unavailable diagnostic because the workflow reminder could not run. Missing `gruff-code-quality.sh` fails soft with a short skipped diagnostic because it is an optional PostToolUse analyzer. Copilot hook commands still use bare project-local script paths.

## Failure Modes / Runtime Contracts

- `.goat-flow/hooks/deny-dangerous/` must be present and tracked. If it is missing, `deny-dangerous.sh` denies with a clear policy-store message instead of reaching an undefined policy function or exiting 127.
- Audit and preflight run the exact configured command strings from `.claude/settings.json`, `.codex/hooks.json`, `.agents/hooks.json`, and `.github/hooks/hooks.json`; this catches stale paths, missing executable bits, and command-shape failures before an agent session sees them.
- Claude, Codex, and Antigravity support nested cwd inside a git checkout through the root-resolving wrapper. Outside a git checkout, `deny-dangerous.sh` fails closed unless an agent-specific project root fallback is documented and configured; today that fallback is `$CLAUDE_PROJECT_DIR` for Claude/Antigravity, not Codex. `gruff-code-quality.sh` fails soft.
- Copilot uses direct project-local paths and therefore requires a repo-root working directory for the configured command. Nested-cwd execution is outside the current Copilot contract unless that runtime adds a portable project-root variable or root-resolving command support.
- Directly invoked `.sh` hooks must keep executable bits. Missing `bash` is a hard runtime prerequisite for all shipped guardrails.

## Post-Turn Safety

goat-flow ships `post-turn-safety.sh` as the universal no-setup Stop hook for Claude, Codex, and Antigravity. It scans changed text content for built-in safety hazards. It does not run builds, tests, linters, typecheckers, or formatters, and must not be treated as project validation.

goat-flow does not ship a project-validation Stop hook. Run project-specific build, test, lint, typecheck, and format commands through explicit verification gates. The shipped `gruff-code-quality.sh` is a file-edit hook: it runs on supported file-write tools, prefers the edited path from the hook payload, and falls back to git-changed supported files when a runtime omits the path.

## Plan Checkbox Guard

`plan-checkbox-guard.sh` is a workflow reminder, not a safety or validation hook. On first sighting in a session it records the active plan hash and repo changeset digest under `.goat-flow/logs/plan-guard-state.json`; later Stop events in the same session exit 2 only when repository changes moved, the active plan still has open checkboxes, and the plan file hash did not change.

The active plan resolver prefers an explicit `plan-guard.plan-file`, then files with `status: active`, then the `.goat-flow/plans/.active` version directory, then a single recent frontmatter-less plan inside the configured search paths. Ambiguous or stale roadmap-style plans fail open with a diagnostic instead of blocking a turn.

## Codex Permissions

Codex does not read Claude's `settings.json` `permissions.allow` or `permissions.deny` syntax. The equivalent file-access layer is a TOML permission profile selected by `default_permissions` in `.codex/config.toml`; goat-flow's Codex template extends Codex's built-in `:workspace` profile and adds recursive `deny` rules for common secret-bearing project paths. Shell command patterns still belong in `.codex/hooks.json` through the Bash-matched `PreToolUse` `deny-dangerous.sh` dispatcher.

Claude can re-allow `Read(**/.env.example)` after denying `Read(**/.env*)`. Codex rejects that recursive read exception and denies take precedence over exact read entries, so goat-flow's Codex template intentionally denies `.env.example` along with the rest of `**/.env*`.
