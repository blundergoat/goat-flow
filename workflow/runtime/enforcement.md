# Prompt: Set Up Enforcement (Hooks, Settings, Permissions)

**This prompt uses Claude Code hook event names.** For Gemini CLI, see `setup/setup-gemini.md` Phase 1c which has the correct Gemini event names (BeforeTool, AfterTool, AfterAgent). Do NOT globally replace hook names in this file - it is the Claude Code reference template.

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
   Note: Agents hallucinate dependency version bumps to fix type errors.
   Lockfile changes must go through the package manager.

   JSON parsing: The hook receives JSON on stdin from the agent runtime.
   Use jq if available:
     INPUT=$(cat)
     TOOL=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
     CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
   Fallback if jq is not installed:
     TOOL=$(echo "$INPUT" | sed -n 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
   Do NOT use grep -P (Perl regex) - it is unavailable on macOS.

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
   - PERFORMANCE: Heavy linters (PHPStan, mypy, pylint) can add
     30-60 seconds per turn on large projects (500+ files). Scope
     them to changed files only:
       phpstan analyse --memory-limit=256M $(git diff --name-only -- '*.php')
       mypy $(git diff --name-only -- '*.py')
     Or skip them in the Stop hook entirely and run them only in
     the preflight script / CI.

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
   # Skip agent config dirs — prettier rewrites $(git rev-parse) to absolute paths
   case "$FILE_PATH" in
     */.claude/*|*/.gemini/*|*/.codex/*|*/.agents/*|*/.github/skills/*) exit 0 ;;
   esac
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

   For Claude Code - add Read/Edit/Write deny patterns to .claude/settings.json:
   "deny": [...existing entries..., "Read(**/.env*)", "Edit(**/.env*)", "Write(**/.env*)", "Read(**/*.pem)", "Read(**/*.key)"]

CONTENT-PRESERVING WRITE GUARD:
7. Add a PreToolUse hook that blocks Write operations reducing a file
   by more than 80%. This catches agents emptying files during refactors.

   ```bash
   #!/usr/bin/env bash
   # guard-write-size.sh — PreToolUse hook for Write tool
   # Blocks writes that remove >80% of an existing file's content.
   set -euo pipefail
   ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
   INPUT=$(cat)
   FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
   NEW_CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // empty' 2>/dev/null)
   [[ -z "$FILE_PATH" || -z "$NEW_CONTENT" ]] && exit 0
   # Resolve to absolute path
   [[ "$FILE_PATH" != /* ]] && FILE_PATH="$ROOT/$FILE_PATH"
   # New files are always allowed
   [[ ! -f "$FILE_PATH" ]] && exit 0
   OLD_SIZE=$(wc -c < "$FILE_PATH")
   NEW_SIZE=${#NEW_CONTENT}
   # Skip tiny files (under 100 bytes)
   (( OLD_SIZE < 100 )) && exit 0
   REDUCTION=$(( (OLD_SIZE - NEW_SIZE) * 100 / OLD_SIZE ))
   if (( REDUCTION > 80 )); then
     echo "BLOCKED: This write would remove ${REDUCTION}% of ${FILE_PATH##*/} (${OLD_SIZE}→${NEW_SIZE} bytes). If intentional, confirm with the human first." >&2
     exit 2
   fi
   exit 0
   ```

   Register as PreToolUse for Write only:
   ```json
   { "type": "PreToolUse", "matcher": "Write", "command": "bash \"$(git rev-parse --show-toplevel)/.claude/hooks/guard-write-size.sh\"" }
   ```

FORMAT HOOK MUST SKIP AGENT CONFIG DIRS:
- The PostToolUse format hook MUST exclude agent configuration directories.
  Without this, formatters (prettier, php-cs-fixer) rewrite skill files
  on every Edit/Write, collapsing numbered lists and changing syntax.
  Add these skip patterns to format-file.sh:
    case "$FILE_PATH" in
      */.claude/*|*/.gemini/*|*/.codex/*|*/.agents/*|*/.github/skills/*) exit 0 ;;
    esac

HOOK CONFIGURATION PITFALLS:
- Use $(git rev-parse --show-toplevel) for ALL paths - relative
  paths break when the working directory changes
- NEVER hardcode absolute paths as fallbacks in hook scripts.
  Only $(git rev-parse --show-toplevel) is portable. Hardcoded
  paths like /home/user/projects/myapp break when the repo is
  cloned elsewhere or the directory is renamed.
- Put each Stop hook in its own array entry - combining command
  and prompt hooks in one entry causes double-firing
- Verify hooks exist at the project root - stale working directories
  can create hooks in subdirectories instead of the project root
- Check git diff before running expensive checks - don't lint
  unchanged files

SESSION LOG REMINDER (optional Stop hook):
   Add a Stop hook that checks whether a session log was written when
   a skill was invoked. This catches the common failure mode where agents
   skip the closing protocol after delivering their output.

   The hook should:
   - Check if the conversation contained a skill invocation (grep for
     "Running /goat-" in recent output)
   - If yes, check if tasks/logs/sessions/ has a file with today's date
   - If no file found, print a reminder to stderr:
     "Skill session detected but no log written to tasks/logs/sessions/.
      Write a session summary before closing."
   - Always exit 0 (informational only — don't block the agent)

   This pairs with the Shared Conventions closing protocol which says
   "FIRST: write session summary" to make logging happen during delivery,
   not as an afterthought.

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
- Pipe to arbitrary shell (`echo malicious | sh` - only `curl|bash` is blocked)
- Encoded or obfuscated commands
- Write/Edit tool operations on .env files (mitigated by adding Edit(**/.env*) and Write(**/.env*) to settings.json deny — ensure these are present)

### What `--dangerously-skip-permissions` Bypasses

When Claude Code runs with `--dangerously-skip-permissions`:

| Layer | Status | Impact |
|-------|--------|--------|
| **settings.json deny patterns** | **BYPASSED** | All 20+ deny rules (git commit, git push, .env reads, secrets) are skipped |
| **PreToolUse hooks** (deny-dangerous.sh) | **Still fires** | Pattern-based blocking still works (~90% for known patterns) |
| **CLAUDE.md rules** (autonomy tiers) | **Still loaded** | Behavioral guidance still present (~70% compliance) |
| **Stop hooks** (stop-lint.sh) | **Still fires** | Post-turn linting still runs |

**Known bypass vectors even with hooks active:**
- Variable indirection: `$cmd` where `cmd='git push main'`
- Subshell execution: `echo $(rm -rf /)`
- Shell aliases wrapping denied commands
- Encoded or obfuscated commands
- `source .env` (reads .env without matching the cat/nano/vim pattern)

**Recommendation:** Never run `--dangerously-skip-permissions` on a workstation with real data. Use a disposable container with a read-only repo mount.

### Settings.json Deny Pattern Breadth

`Bash(*git commit*)` is a glob substring match — it blocks ANY Bash command containing the string "git commit", including `git log --oneline | grep commit` or comments mentioning "git commit". This is a deliberate safety-first trade-off: broad matching prevents bypass via command chaining but may block legitimate commands that happen to contain denied substrings. If a user hits a false positive, they can run the blocked command manually via `! <command>` in the Claude Code prompt.

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
