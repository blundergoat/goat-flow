#!/usr/bin/env bash
# =============================================================================
# deny-dangerous.sh - PreToolUse hook: blocks dangerous commands before execution
# =============================================================================
# Event:  PreToolUse (Claude), BeforeTool (Gemini)
# Match:  Bash tool calls
# Exit 0: allow the command
# Exit 2: block the command (stderr message shown to the agent as the reason)
#
# Install (Claude): copy to .claude/hooks/deny-dangerous.sh
# Register in .claude/settings.json:
#   "PreToolUse": [{ "matcher": "Bash", "hooks": [{
#     "type": "command",
#     "command": "bash \"$(git rev-parse --show-toplevel)/.claude/hooks/deny-dangerous.sh\""
#   }]}]
#
# Limitations:
# - Best-effort pattern matching on literal shell commands
# - Does NOT catch: variable indirection ($cmd), shell aliases, encoded
#   commands, or `source .env`
# - Deeply nested command substitution beyond 3 levels is blocked as a
#   precaution rather than parsed
# - Defense in depth: combine with settings.json deny patterns + CLAUDE.md rules
# =============================================================================
set -uo pipefail

# --- JSON Input Parsing ------------------------------------------------------
# Support direct argv for lightweight callers and stdin JSON payloads.
INPUT=""
SELF_TEST=0
if [[ "${1:-}" == "--self-test" ]]; then
  SELF_TEST=1
  shift
elif [[ -n "${1:-}" && "${1:-}" != "--self-test" ]]; then
  INPUT="$1"
else
  # The agent runtime typically pipes JSON on stdin with `tool_name` and `tool_input`.
  INPUT=$(cat)
fi

if command -v jq >/dev/null 2>&1; then
  COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || echo "$INPUT")
else
  # Fallback: extract with sed (less reliable but works without jq)
  # Handle escaped quotes (\") inside the JSON string value
  COMMAND=$(echo "$INPUT" | sed -n 's/.*"command"\s*:\s*"\(.*\)".*/\1/p' | head -1 | sed 's/\\"/"/g')
  [[ -z "$COMMAND" ]] && COMMAND="$INPUT"
fi

# --- Self-test ---------------------------------------------------------------
run_self_test() {
  local failures=0

  run_case() {
    local name="$1"
    local command="$2"
    local expected="$3"
    local status=0
    local stdout_file
    local stderr_file

    stdout_file=$(mktemp)
    stderr_file=$(mktemp)
    "$0" "$command" >"$stdout_file" 2>"$stderr_file" || status=$?

    if [[ "$status" -ne "$expected" ]]; then
      failures=$((failures + 1))
      echo "FAIL [${name}]: expected $expected, got $status"
      if [[ -s "$stderr_file" ]]; then
        sed -n '1,2p' "$stderr_file" >&2
      fi
    fi

    rm -f "$stdout_file" "$stderr_file"
  }

  # Safe command should pass.
  run_case "safe echo" "echo hello" 0
  # Direct push branches should block (legacy + production/deploy).
  run_case "direct push main" "git push origin main" 2
  run_case "direct push master" "git push origin master" 2
  run_case "direct push production" "git push origin production" 2
  run_case "direct push deploy" "git push origin deploy" 2
  # Unsafe rm command should still block.
  run_case "rm unsafe" "rm -rf /" 2
  # Safe-scoped rm command should pass.
  run_case "rm scoped node_modules" "rm -rf ./node_modules" 0

  if [[ "$failures" -ne 0 ]]; then
    echo "FAIL: $failures self-test failures"
    exit 1
  fi

  echo "PASS: deny-dangerous.sh self-test"
  exit 0
}

if [[ "$SELF_TEST" -eq 1 ]]; then
  run_self_test
fi

# --- Helper -------------------------------------------------------------------
block() {
  echo "BLOCKED: $1" >&2
  exit 2
}

# --- Pattern Checks ----------------------------------------------------------
# Each function checks one dangerous pattern. Add project-specific blocks below.
check_segment() {
  local cmd="$1"
  local depth="${2:-0}"

  # Depth guard for recursive command substitution checking
  if [ "$depth" -gt 3 ]; then
    block "Deeply nested command substitution. Simplify the command."
  fi

  # 1. rm -rf without safe scoping
  #    Block: rm -rf / , rm -rf ~, rm -rf without a real path, rm -rf with path traversal
  #    Allow: rm -rf ./node_modules, rm -rf dist/, rm -rf /tmp/build-*
  if [[ "$cmd" =~ rm[[:space:]]+-[a-zA-Z]*r[a-zA-Z]*f|rm[[:space:]]+-[a-zA-Z]*f[a-zA-Z]*r ]]; then
    # Block path traversal regardless of prefix
    if [[ "$cmd" =~ \.\. ]]; then
      block "rm -rf with path traversal (..). Resolve the full path first."
    fi
    if ! [[ "$cmd" =~ rm[[:space:]]+-(rf|fr)[[:space:]]+(\./[a-zA-Z]|[a-zA-Z]|/tmp/[a-zA-Z0-9._-]) ]]; then
      block "rm -rf without safe scoping. Specify an explicit target path."
    fi
  fi

  # 2. rm with long-form recursive+force flags
  if [[ "$cmd" =~ rm[[:space:]]+.*--recursive ]] && [[ "$cmd" =~ rm[[:space:]]+.*--force ]]; then
    block "rm --recursive --force. Use explicit target paths."
  fi

  # 3. Direct push to main/master (case-insensitive)
  local cmd_lower="${cmd,,}"
  if [[ "$cmd_lower" =~ git[[:space:]]+push[[:space:]]+.*(main|master|production|deploy) ]]; then
    block "Direct push to main/master/production. Push to a feature branch and open a PR."
  fi

  # 4. Force push --force-with-lease (check before --force so specific match wins)
  if [[ "$cmd" =~ git[[:space:]]+push[[:space:]]+.*--force-with-lease ]]; then
    block "git push --force-with-lease. Ask the user before force-pushing, even with lease protection."
  fi

  # 5. Force push --force
  if [[ "$cmd" =~ git[[:space:]]+push[[:space:]]+.*--force([[:space:]]|$) ]]; then
    block "git push --force rewrites remote history. Use --force-with-lease with user approval."
  fi

  # 6. Force push -f shorthand
  if [[ "$cmd" =~ git[[:space:]]+push[[:space:]]+(.*[[:space:]])?-f([[:space:]]|$) ]]; then
    block "git push -f (force push shorthand). Use --force-with-lease with user approval."
  fi

  # 7. chmod 777 (world-writable)
  if [[ "$cmd" =~ chmod[[:space:]]+777 ]]; then
    block "chmod 777 sets world-writable permissions. Use a more restrictive mode."
  fi

  # 8. Pipe-to-shell (curl|bash, wget|sh, curl|python, etc.)
  if [[ "$cmd" =~ (curl|wget)[^|]*\|[[:space:]]*(ba)?sh ]]; then
    block "Pipe-to-shell (curl|bash). Download first, inspect, then run."
  fi
  if [[ "$cmd" =~ (curl|wget)[^|]*\|[[:space:]]*(python|python3|node|perl|ruby) ]]; then
    block "Pipe-to-interpreter. Download first, inspect, then run."
  fi

  # 9. .env file modifications
  #    Block: any write operation targeting .env files
  #    Allow: cat .env (read-only), grep .env, source .env
  if [[ "$cmd" =~ (cp|mv|cat[[:space:]]+[^>]*\>|\>|\>\>|tee|sed[[:space:]]+-i|nano|vim?|code|echo[[:space:]]+.*\>)[[:space:]]+.*\.env($|[[:space:]]|\.) ]]; then
    block ".env file modification. Edit .env files manually, not through the agent."
  fi

  # 10. --no-verify bypass (skips git hooks)
  if [[ "$cmd" =~ git[[:space:]]+.*--no-verify ]]; then
    block "git --no-verify skips safety hooks. Remove the flag and fix the underlying issue."
  fi

  # 11. Lockfile direct modifications (must go through package manager)
  if [[ "$cmd" =~ (\>|\>\>|tee|sed[[:space:]]+-i)[[:space:]]+.*(package-lock\.json|pnpm-lock\.yaml|composer\.lock|Cargo\.lock|yarn\.lock) ]]; then
    block "Direct lockfile modification. Use the package manager (npm install, composer update, etc.)."
  fi

  # 12. git reset --hard (destroys uncommitted work)
  if [[ "$cmd" =~ git[[:space:]]+reset[[:space:]]+.*--hard ]]; then
    block "git reset --hard destroys uncommitted changes. Stash or commit first."
  fi

  # 13. git clean -f (deletes untracked files permanently)
  if [[ "$cmd" =~ git[[:space:]]+clean[[:space:]]+.*-[a-zA-Z]*f ]]; then
    block "git clean -f deletes untracked files permanently. List targets with git clean -n first."
  fi

  # 14. eval and indirect execution
  if [[ "$cmd" =~ ^eval[[:space:]] ]] || [[ "$cmd" =~ [[:space:]]eval[[:space:]] ]]; then
    block "eval hides commands from safety checks. Write the command directly."
  fi
  if [[ "$cmd" =~ (ba)?sh[[:space:]]+-c[[:space:]] ]]; then
    block "bash -c hides commands from safety checks. Write the command directly."
  fi

  # 15. File truncation
  local redirect_pattern='^>[[:space:]]'
  if [[ "$cmd" =~ $redirect_pattern ]]; then
    block "Redirect to empty file. This truncates the target. Use a safer approach."
  fi
  if [[ "$cmd" =~ truncate[[:space:]] ]]; then
    block "truncate can destroy file contents. Verify intent before proceeding."
  fi

  # 16. Destructive database commands via CLI tools
  if [[ "$cmd_lower" =~ (mysql|psql|sqlite3|mongosh)[[:space:]].*(-e|--command|--eval)[[:space:]]+.*(drop[[:space:]]+(database|table|schema)|truncate[[:space:]]+table) ]]; then
    block "Destructive database command (DROP/TRUNCATE). Run manually with verification."
  fi

  # 17. Command substitution (recursive check)
  if [[ "$cmd" =~ \$\( ]]; then
    local inner
    inner=$(echo "$cmd" | sed -n 's/.*\$(\([^)]*\)).*/\1/p' 2>/dev/null || echo "")
    if [ -n "$inner" ]; then
      check_segment "$inner" $((depth + 1))
    fi
  fi

  # --- CUSTOMIZE: Add project-specific blocks below --------------------------
  # Example: block direct edits to generated files
  # if [[ "$cmd" =~ (sed|tee|>)[[:space:]]+.*generated\.ts ]]; then
  #   block "generated.ts is auto-generated. Edit the source template instead."
  # fi
}

# --- Command Chaining Split ---------------------------------------------------
# Split on &&, ||, and ; so chained commands are each checked independently.
# Without this, "safe-cmd && rm -rf /" bypasses detection.
IFS=$'\n' read -r -d '' -a segments < <(echo "$COMMAND" | sed 's/&&/\n/g; s/||/\n/g; s/;/\n/g' && printf '\0') || true

for segment in "${segments[@]}"; do
  segment=$(echo "$segment" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  [[ -z "$segment" ]] && continue
  check_segment "$segment" 0
done

# --- Default: allow -----------------------------------------------------------
exit 0
