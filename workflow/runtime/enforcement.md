# Prompt: Set Up Enforcement (Hooks, Settings, Permissions)

**This prompt uses Claude Code hook event names.** For Gemini CLI, see `setup/setup-gemini.md` Phase 1c which has the correct Gemini event names (BeforeTool, AfterTool, AfterAgent). Do NOT globally replace hook names in this file — it is the Claude Code reference template.

Paste this into your coding agent to create the enforcement layer for your project.

---

## The Prompt

```
Set up the enforcement layer for this project. This creates the hooks,
permissions deny list, and settings that provide hard guardrails beyond
what CLAUDE.md rules alone can enforce.

Stack:
- Lint: [your lint command]
- Format: [your format command, or "none - no formatter configured"]
- Test: [your test command]

PRE-EXISTING HOOKS:
If hooks already exist in .claude/settings.json (inline commands or
script references), migrate them to external scripts under .claude/hooks/
before adding new hooks. Replace inline commands with:
bash "$(git rev-parse --show-toplevel)/.claude/hooks/script-name.sh"

Create the following:

1. .claude/settings.json

   Permissions deny list:
   "permissions": {
     "deny": [
       "Bash(*git commit*)",
       "Bash(*git push*)"
     ]
   }

   Register all three hooks (structure below). ALL hook commands MUST use:
   bash "$(git rev-parse --show-toplevel)/.claude/hooks/your-hook.sh"

   Hook structure in settings.json:
   "hooks": {
     "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "..." }] }],
     "Stop": [{ "hooks": [{ "type": "command", "command": "..." }] }],
     "PostToolUse": [{ "matcher": "Edit|Write", "hooks": [{ "type": "command", "command": "..." }] }]
   }

2. .claude/hooks/deny-dangerous.sh (PreToolUse hook)

   Block these commands (exit 2 with error message telling Claude what
   to do instead):
   - rm -rf without explicit path scoping
   - git push to main/master/production
   - git push --force (suggest --force-with-lease instead)
   - chmod 777
   - Pipe-to-shell (curl | bash, wget | sh)
   - .env modifications
   - git commit --no-verify or git commit -n
   - Direct modification of lockfiles (package-lock.json, pnpm-lock.yaml,
     composer.lock, Cargo.lock, yarn.lock)
   - Direct modification of generated code files, migration files, or
     compiled artifacts
   - mv without -n flag: WARN but allow (bare mv risks overwriting
     untracked files; prefer mv -n but do not hard-block renames)
   Note: Agents hallucinate dependency version bumps to fix type errors.
   Lockfile changes must go through the package manager.

   JSON parsing: The hook receives JSON on stdin from the agent runtime.
   Use jq if available:
     INPUT=$(cat)
     TOOL=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
     CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
   Fallback if jq is not installed:
     TOOL=$(echo "$INPUT" | sed -n 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
   Do NOT use grep -P (Perl regex) — it is unavailable on macOS.

   Command chaining: Split commands on &&, ||, and ; then check each
   segment independently. Without this, chained dangerous commands
   bypass detection:
     IFS=$'\n' read -ra SEGMENTS <<< "$(echo "$CMD" | sed 's/[&|;]\{1,2\}/\n/g')"
     for seg in "${SEGMENTS[@]}"; do ... done

   Read-deny: The settings permissions.deny list should also block
   reading sensitive files: .env*, .ssh/**, .aws/**, *.pem, *.key,
   credentials*. Add Read(...) patterns alongside the Bash(...) deny
   patterns in the settings file.

   [ADD PROJECT-SPECIFIC BLOCKS if needed: e.g., direct edits to
    binary/generated files that must be modified through tooling]

   Exit 0 for everything else (allow by default).

3. .claude/hooks/stop-lint.sh (Stop hook)

   Stack-adaptive: check git diff for modified file types, run relevant
   lint/type checks only for changed file types.

   MUST exit 0 even when errors are found (informational only - non-zero
   causes infinite fix loops).

   Include:
   - Early exit when nothing changed this turn:
     CHANGED=$(git diff --name-only 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null)
     [ -z "$CHANGED" ] && exit 0
   - Guard against missing tools: command -v check before running
   - Infinite loop guard: if [ "${STOP_HOOK_ACTIVE:-}" = "1" ]; then exit 0; fi
     export STOP_HOOK_ACTIVE=1
   - Exclude slow checks (>10 seconds) - those go in /goat-security
   - Run lint and type-check only for file types that changed

4. .claude/hooks/format-file.sh (PostToolUse hook)

   Format based on file extension using the project's formatter.
   Silence failures (formatter issues shouldn't block work).

   SKIP THIS HOOK ENTIRELY if no formatter is configured for the
   project stack (e.g., shell scripts with no formatter). Do NOT
   create a format hook that re-runs the linter - that duplicates
   the Stop hook.

   Reference script (PostToolUse receives the tool result as JSON on stdin):
   ```bash
   #!/usr/bin/env bash
   INPUT=$(cat)
   FILE_PATH=$(echo "$INPUT" | jq -r '.file_path // empty' 2>/dev/null)
   [ -z "$FILE_PATH" ] && exit 0
   case "$FILE_PATH" in
     *.ts|*.tsx|*.js|*.jsx) npx prettier --write "$FILE_PATH" 2>/dev/null ;;
   esac
   exit 0
   ```
   Note: PostToolUse payloads use `.file_path` at the top level (not
   `.tool_input.command` like PreToolUse). Always test with `jq -r`
   and fall through on empty.

5. .gitignore additions

   Add these lines if not already present:
   .claude/settings.local.json
   tasks/todo.md
   tasks/handoff.md

AGENT IGNORE FILES:
6. Create agent ignore files to prevent reading sensitive files:

   For GitHub Copilot - create `.copilotignore`:
   .env*
   **/secrets/
   **/*.pem
   **/*.key
   **/credentials*
   **/.git/

   For Cursor - create `.cursorignore` with the same patterns.

   For Claude Code - add Read deny patterns to .claude/settings.json:
   "deny": [...existing entries..., "Read(**/.env*)", "Read(**/*.pem)", "Read(**/*.key)"]

CONTENT-PRESERVING WRITE GUARD:
7. Add a PreToolUse hook that blocks Write operations reducing a file
   by more than 80%. This catches agents emptying files during refactors.

   The hook should:
   - Compare the proposed content length against the existing file length
   - If reduction exceeds 80%, exit 2 with message: "This write would
     remove more than 80% of the file's content. If this is intentional,
     confirm with the human first."
   - Exit 0 for all other writes

HOOK CONFIGURATION PITFALLS:
- Use $(git rev-parse --show-toplevel) for ALL paths - relative
  paths break when the working directory changes
- Put each Stop hook in its own array entry - combining command
  and prompt hooks in one entry causes double-firing
- Verify hooks exist at the project root - stale working directories
  can create hooks in subdirectories instead of the project root
- Check git diff before running expensive checks - don't lint
  unchanged files

4. Compaction hook (Notification, optional but recommended)

Register a Notification hook that fires after context compaction.
This re-injects key context that gets lost during long sessions:
- Current task description (from tasks/todo.md if it exists)
- List of modified files (git diff --name-only)
- Hard constraints (Ask First boundaries, Never tier rules)
- Active working notes

In .claude/settings.json, add to the hooks array:
{
  "type": "Notification",
  "matcher": "compact",
  "command": "echo 'CONTEXT AFTER COMPACTION:' && echo 'Modified files:' && git diff --name-only 2>/dev/null && echo '---' && cat tasks/todo.md 2>/dev/null || echo 'No active tasks' && echo '---' && echo 'Constraints: read CLAUDE.md Autonomy Tiers before proceeding'"
}

This is most valuable during multi-hour sessions where losing the
thread means repeating work or violating boundaries.

VERIFICATION:
- Verify .claude/settings.json is valid JSON (parse it)
- Verify deny-dangerous.sh blocks: rm -rf, git push main,
  git push --force, chmod 777, pipe-to-shell, --no-verify
- Verify stop-lint.sh exits 0 even when lint errors found
- Verify stop-lint.sh has the infinite loop guard
- Verify all hook paths use $(git rev-parse --show-toplevel)
- If format hook was skipped, note why
- If compaction hook was skipped, note why
- Run the deny-dangerous hook against a test input to verify it works
```

### Deny Hook Limitations

Deny hooks are best-effort pre-execution filtering for literal shell commands. They do NOT protect against:
- Shell aliases that wrap denied commands
- Variable indirection (`$cmd` where cmd='git push main')
- Pipe to arbitrary shell (`echo malicious | sh` — only `curl|bash` is blocked)
- Encoded or obfuscated commands
- Write/Edit tool operations on .env files (hooks only register for Bash tool)

Defense in depth: hooks + settings.json deny patterns + instruction file rules. No single layer is a complete sandbox.

---

## Codex Enforcement

Codex CLI uses a different enforcement model than Claude Code. Instead of JSON-configured hooks in settings.json, Codex uses TOML-configured hooks and Starlark-based execpolicy rules.

### Hook Events

Codex supports these hook events (registered in `.codex/config.toml`):

| Event | When it fires | Typical use |
|-------|--------------|-------------|
| SessionStart | Once when session opens | Load context, verify environment |
| UserPromptSubmit | Before processing user input | Input validation, prompt logging |
| Stop | After every agent turn completes | Lint, type-check changed files |
| AfterToolUse | After any tool invocation | Format files after edits |
| AfterAgent | After a sub-agent completes | Validate sub-agent output |

**Key difference:** There is no PreToolUse equivalent for non-shell tools. File writes, agent spawns, and other non-shell tool calls cannot be blocked before execution. Only shell commands can be pre-blocked via execpolicy rules.

### Execpolicy Rules (Starlark)

Codex uses Starlark-based execpolicy rules for runtime command blocking. Rules live in `.codex/rules/*.star` (project-level) or `~/.codex/rules/*.star` (user-level).

Each rule returns one of three decisions:

| Decision | Behaviour |
|----------|-----------|
| `allow` | Command runs without prompting |
| `prompt` | User must confirm before execution |
| `forbidden` | Command is blocked entirely |

Config location: `.codex/config.toml`

Rules location: `.codex/rules/*.star`

Example config.toml hook registration:
```toml
[hooks.stop]
command = "bash scripts/stop-lint.sh"

[hooks.after_tool_use]
command = "bash .codex/hooks/after-tool-use.sh"

[hooks.session_start]
command = "bash .codex/hooks/session-start.sh"
```

### Comparison to Claude Code Enforcement

| Layer | Claude Code | Codex |
|-------|------------|-------|
| Pre-execution blocking (all tools) | PreToolUse hook | No equivalent |
| Pre-execution blocking (shell only) | PreToolUse hook | Execpolicy rules (.codex/rules/*.star) |
| Post-turn checks | Stop hook | Stop hook |
| Post-tool checks | PostToolUse hook | AfterToolUse hook |
| Permission deny list | .claude/settings.json deny | Execpolicy rules (shell only) |
| Read-deny patterns | settings.json Read deny | No equivalent |
| Config format | JSON (.claude/settings.json) | TOML (.codex/config.toml) |
| Rule language | Bash scripts | Starlark (.star files) + Bash hooks |
