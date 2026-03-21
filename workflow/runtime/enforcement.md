# Prompt: Set Up Enforcement (Hooks, Settings, Permissions)

**This prompt uses Claude Code hook event names.** For Gemini CLI, see `setup/setup-gemini.md` Phase 1c which has the correct Gemini event names (BeforeTool, AfterTool, AfterAgent). Do NOT globally replace hook names in this file — it is the Claude Code reference template.

Paste this into your coding agent to create the enforcement layer for your project.

---

## The Prompt

```
Set up the enforcement layer for this project. This creates the hooks,
permissions deny list, and settings that provide hard guardrails beyond
what CLAUDE.md rules alone can enforce.

This project is a [APP / LIBRARY / SCRIPT COLLECTION].
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
   - mv without -n flag (bare mv silently overwrites destination files;
     use mv -n to prevent data loss on untracked files)
   Note: Agents hallucinate dependency version bumps to fix type errors.
   Lockfile changes must go through the package manager.
   [ADD PROJECT-SPECIFIC BLOCKS if needed: e.g., direct edits to
    binary/generated files that must be modified through tooling]

   Exit 0 for everything else (allow by default).

3. .claude/hooks/stop-lint.sh (Stop hook)

   Stack-adaptive: check git diff for modified file types, run relevant
   lint/type checks only for changed file types.

   MUST exit 0 even when errors are found (informational only - non-zero
   causes infinite fix loops).

   Include:
   - Guard against missing tools: command -v check before running
   - Infinite loop guard: if [ "${STOP_HOOK_ACTIVE:-}" = "1" ]; then exit 0; fi
     export STOP_HOOK_ACTIVE=1
   - Exclude slow checks (>10 seconds) - those go in /goat-preflight
   - Run lint and type-check only for file types that changed

4. .claude/hooks/format-file.sh (PostToolUse hook)

   Format based on file extension using the project's formatter.
   Silence failures (formatter issues shouldn't block work).

   SKIP THIS HOOK ENTIRELY if no formatter is configured for the
   project stack (e.g., shell scripts with no formatter). Do NOT
   create a format hook that re-runs the linter - that duplicates
   the Stop hook.

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

VERIFICATION:
- Verify .claude/settings.json is valid JSON (parse it)
- Verify deny-dangerous.sh blocks: rm -rf, git push main,
  git push --force, chmod 777, pipe-to-shell, --no-verify
- Verify stop-lint.sh exits 0 even when lint errors found
- Verify stop-lint.sh has the infinite loop guard
- Verify all hook paths use $(git rev-parse --show-toplevel)
- If format hook was skipped, note why
- Run the deny-dangerous hook against a test input to verify it works
```
