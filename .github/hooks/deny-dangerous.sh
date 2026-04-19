#!/usr/bin/env bash
# =============================================================================
# deny-dangerous.sh - PreToolUse hook: blocks dangerous commands before execution
# =============================================================================
# Event:  PreToolUse / equivalent pre-command hook for the current runtime
# Match:  Bash tool calls
# Exit 0: allow the command
# Exit 2: block the command (stderr message shown to the agent as the reason)
#
# Install: place in the runtime's hooks directory and register it with the
# runtime's pre-tool / pre-command hook config.
#
# Limitations:
# - Best-effort pattern matching on literal shell commands
# - Does NOT catch: variable indirection ($cmd), shell aliases, encoded
#   commands, or `source .env`
# - Deeply nested command substitution beyond 3 levels is blocked as a
#   precaution rather than parsed
# - Defense in depth: combine with runtime deny patterns + instruction-file rules
# =============================================================================
set -uo pipefail

OUTPUT_MODE="stderr-exit"

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

block() {
  if [[ "$OUTPUT_MODE" == "copilot-json" ]]; then
    printf '{"permissionDecision":"deny","permissionDecisionReason":"%s"}\n' \
      "$(json_escape "$1")"
    exit 0
  fi
  echo "BLOCKED: $1" >&2
  exit 2
}

# --- JSON Input Parsing ------------------------------------------------------
# Support direct argv for lightweight callers and stdin JSON payloads.
INPUT=""
SELF_TEST=0
STRUCTURED_INPUT=0
if [[ "${1:-}" == "--self-test" ]]; then
  SELF_TEST=1
  shift
elif [[ -n "${1:-}" && "${1:-}" != "--self-test" ]]; then
  INPUT="$1"
else
  # The agent runtime typically pipes JSON on stdin with `tool_name` and `tool_input`.
  INPUT=$(cat)
fi

if [[ "$INPUT" =~ ^[[:space:]]*\{ ]]; then
  STRUCTURED_INPUT=1
fi

if [[ "$STRUCTURED_INPUT" -eq 1 ]]; then
  if command -v jq >/dev/null 2>&1; then
    if printf '%s' "$INPUT" | jq -e '
      has("toolName") or has("toolArgs") or has("sessionId")
    ' >/dev/null 2>&1; then
      OUTPUT_MODE="copilot-json"
    fi
  elif printf '%s' "$INPUT" | grep -qE '"toolName"|"toolArgs"|"sessionId"'; then
    OUTPUT_MODE="copilot-json"
  fi
fi

COMMAND=""
if command -v jq >/dev/null 2>&1; then
  COMMAND=$(
    printf '%s' "$INPUT" | jq -r '
      def extract_command(value):
        if value == null then empty
        elif (value | type) == "object" then (value.command // empty)
        elif (value | type) == "string" then
          ((value | fromjson? // {}) | if type == "object" then (.command // empty) else empty end)
        else empty end;
      .command //
      extract_command(.toolArgs) //
      extract_command(.tool_args) //
      extract_command(.tool_input) //
      empty
    ' 2>/dev/null
  )
else
  # Fallback: extract with sed (less reliable but works without jq)
  # Handle both direct `"command":"..."` fields and stringified Copilot toolArgs.
  COMMAND=$(
    printf '%s' "$INPUT" |
      sed -n 's/.*\\"command\\"\s*:\s*\\"\(.*\)\\".*/\1/p' |
      head -1 |
      sed 's/\\"/"/g'
  )
  if [[ -z "$COMMAND" ]]; then
    COMMAND=$(
      printf '%s' "$INPUT" |
        sed -n 's/.*"command"\s*:\s*"\([^"]*\)".*/\1/p' |
        head -1
    )
  fi
fi

if [[ "$STRUCTURED_INPUT" -eq 0 && -z "$COMMAND" ]]; then
  COMMAND="$INPUT"
fi

if [[ "$STRUCTURED_INPUT" -eq 1 && -z "$COMMAND" ]]; then
  block "Hook payload did not expose a bash command to evaluate"
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

  run_stdin_case() {
    local name="$1"
    local payload="$2"
    local expected="$3"
    local expected_stream="$4"
    local expected_pattern="$5"
    local status=0
    local stdout_file
    local stderr_file
    local target_file

    stdout_file=$(mktemp)
    stderr_file=$(mktemp)
    printf '%s' "$payload" | "$0" >"$stdout_file" 2>"$stderr_file" || status=$?

    if [[ "$status" -ne "$expected" ]]; then
      failures=$((failures + 1))
      echo "FAIL [${name}]: expected $expected, got $status"
    fi

    if [[ -n "$expected_pattern" ]]; then
      case "$expected_stream" in
        stdout) target_file="$stdout_file" ;;
        stderr) target_file="$stderr_file" ;;
        *)
          failures=$((failures + 1))
          echo "FAIL [${name}]: invalid expected stream '${expected_stream}'"
          target_file=""
          ;;
      esac
      if [[ -n "$target_file" ]] && ! grep -Fq "$expected_pattern" "$target_file"; then
        failures=$((failures + 1))
        echo "FAIL [${name}]: missing pattern '${expected_pattern}' in ${expected_stream}"
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
  # False-positive cases: read-only commands containing dangerous literals as data.
  run_case "grep rm -rf" 'grep "rm -rf" CLAUDE.md' 0
  run_case "rg rm -rf" 'rg "rm -rf" src/' 0
  run_case "printf rm -rf" "printf '%s\n' 'rm -rf /'" 0
  run_case "grep chmod 777" 'grep "chmod 777" file.ts' 0
  run_case "grep push main" 'grep "git push origin main" docs/' 0
  # Quoted alternation inside read-only commands must not trip pipe-to-shell detection.
  run_case "rg quoted alternation" "rg -n 'shellcheck|bash -n|npm test' CLAUDE.md" 0
  run_case "rg double-quoted alternation" 'rg -n "foo|bar" CLAUDE.md' 0
  # Safe sh -c / bash -c wrappers around read-only commands should pass; dangerous ones still block.
  run_case "xargs sh -c safe" "xargs -I {} sh -c 'echo {}'" 0
  run_case "bash -c safe" 'bash -c "echo hello"' 0
  run_case "bash -c dangerous" 'bash -c "rm -rf /"' 2
  # Whitelist bypass: read-only verb with redirect or pipe-to-shell must still block.
  run_case "echo redirect" 'echo "data" > .env' 2
  run_case "grep pipe bash" 'grep pattern file | bash' 2
  # Structured runtime payloads must parse both VS Code and Copilot CLI shapes.
  run_stdin_case \
    "vscode payload dangerous" \
    '{"tool_name":"Bash","tool_input":{"command":"rm -rf /"}}' \
    2 \
    "stderr" \
    "BLOCKED:"
  run_stdin_case \
    "copilot payload dangerous stringified" \
    '{"toolName":"bash","toolArgs":"{\"command\":\"rm -rf /\"}"}' \
    0 \
    "stdout" \
    '"permissionDecision":"deny"'
  run_stdin_case \
    "copilot payload dangerous object" \
    '{"toolName":"bash","toolArgs":{"command":"rm -rf /"}}' \
    0 \
    "stdout" \
    '"permissionDecision":"deny"'
  run_stdin_case \
    "copilot payload parse failure is denied" \
    '{"toolName":"bash","toolArgs":{}}' \
    0 \
    "stdout" \
    'Hook payload did not expose a bash command'

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

# --- Pattern Checks ----------------------------------------------------------
# Each function checks one dangerous pattern. Add project-specific blocks below.
check_segment() {
  local cmd="$1"
  local depth="${2:-0}"

  # Depth guard for recursive command substitution checking
  if [ "$depth" -gt 3 ]; then
    block "Deeply nested command substitution. Simplify the command."
  fi

  # Read-only tool whitelist: if the command verb is a read-only tool,
  # dangerous patterns in its arguments are data (search terms), not actions.
  # Skip whitelist if: output redirection (>) or pipe-to-shell (| bash/sh) detected.
  local cmd_trimmed
  cmd_trimmed="${cmd#"${cmd%%[![:space:]]*}"}"
  local cmd_verb
  cmd_verb=$(echo "$cmd_trimmed" | awk '{print $1}')

  # Strip single- and double-quoted strings for structural (pipe/redirect/verb) pattern
  # matching, so dangerous characters inside quoted arguments (e.g. rg 'a|b', awk "x>y")
  # are treated as data, not control flow. This version is best-effort: it handles the
  # common case of balanced quotes without escape processing.
  local cmd_unquoted="$cmd"
  cmd_unquoted="${cmd_unquoted//\'[^\']*\'/}"
  cmd_unquoted=$(echo "$cmd_unquoted" | sed -E "s/'[^']*'//g; s/\"[^\"]*\"//g")

  local has_redirect=0 has_pipe=0
  [[ "$cmd_unquoted" =~ \>[[:space:]] || "$cmd_unquoted" =~ \>\> ]] && has_redirect=1
  # Detect single pipe (|) but not logical OR (||), outside of quoted strings
  local pipe_stripped="${cmd_unquoted//||/}"
  [[ "$pipe_stripped" =~ \| ]] && has_pipe=1
  # If a pipe is present (outside quotes), block pipe-to-shell/interpreter regardless of verb
  if [[ "$has_pipe" -eq 1 ]]; then
    if [[ "$cmd_unquoted" =~ \|[[:space:]]*(ba)?sh([[:space:]]|$) ]]; then
      block "Pipe to shell. Download or inspect first, then run."
    fi
    if [[ "$cmd_unquoted" =~ \|[[:space:]]*(python|python3|node|perl|ruby)([[:space:]]|$) ]]; then
      block "Pipe to interpreter. Download or inspect first, then run."
    fi
  fi
  if [[ "$has_redirect" -eq 0 && "$has_pipe" -eq 0 ]]; then
    case "$cmd_verb" in
      grep|egrep|fgrep|rg|ag|ack|cat|head|tail|less|more|wc|file|diff|printf|echo|read)
        return 0 ;;
      sed)
        # sed without -i/--in-place is read-only; sed -i or --in-place is a write operation
        if ! [[ "$cmd" =~ sed[[:space:]]+-[a-zA-Z]*i || "$cmd" =~ sed[[:space:]]+--in-place ]]; then
          return 0
        fi ;;
    esac
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
  if [[ "$cmd_unquoted" =~ ^eval[[:space:]] ]] || [[ "$cmd_unquoted" =~ [[:space:]]eval[[:space:]] ]]; then
    block "eval hides commands from safety checks. Write the command directly."
  fi
  # bash -c / sh -c: recurse into the -c argument instead of blanket-blocking, so
  # xargs ... sh -c '<safe>' and similar legitimate patterns still work while
  # dangerous commands inside -c still get caught by the rest of this function.
  if [[ "$cmd" =~ (^|[[:space:]])(ba)?sh[[:space:]]+-c[[:space:]]+([\'\"])([^\'\"]*)([\'\"]) ]]; then
    local inner_c="${BASH_REMATCH[4]}"
    if [[ -n "$inner_c" ]]; then
      check_segment "$inner_c" $((depth + 1))
    fi
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
    # shellcheck disable=SC2016  # sed pattern intentionally matches literal $( inside single quotes
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
