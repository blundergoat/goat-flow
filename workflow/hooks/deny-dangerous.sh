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
# - Does NOT catch: variable indirection ($cmd), shell aliases, or encoded
#   commands (base64-decoded payloads, $'...' C-style escapes, etc.)
# - Deeply nested command substitution beyond 3 levels is blocked as a
#   precaution rather than parsed
# - Defense in depth: combine with runtime deny patterns + instruction-file rules
# NOTE: `source .env` and other shell-level secret reads ARE blocked. Plain
#   `.env.example` reads are allowed; writes still block. See self-test cases.
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

parse_structured_input() {
  local -a parsed=()

  if command -v jq >/dev/null 2>&1; then
    mapfile -d '' parsed < <(
      printf '%s' "$INPUT" | jq -jr '
        def extract_command(value):
          if value == null then empty
          elif (value | type) == "object" then (value.command // empty)
          elif (value | type) == "string" then
            ((value | fromjson? // {}) | if type == "object" then (.command // empty) else empty end)
          else empty end;
        (if has("toolName") or has("toolArgs") or has("sessionId") then "copilot-json" else "stderr-exit" end), "\u0000",
        (.toolName // .tool_name // empty), "\u0000",
        (.command // extract_command(.toolArgs) // extract_command(.tool_args) // extract_command(.tool_input) // empty), "\u0000"
      ' 2>/dev/null
    ) || return 1
  elif command -v node >/dev/null 2>&1; then
    mapfile -d '' parsed < <(
      INPUT_JSON="$INPUT" node <<'NODE'
const input = process.env.INPUT_JSON ?? "";
let payload;
try {
  payload = JSON.parse(input);
} catch {
  process.exit(1);
}

function extractCommand(value) {
  if (value == null) return "";
  if (typeof value === "object" && typeof value.command === "string") {
    return value.command;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && typeof parsed.command === "string") {
        return parsed.command;
      }
    } catch {}
  }
  return "";
}

const isCopilot =
  Object.prototype.hasOwnProperty.call(payload, "toolName") ||
  Object.prototype.hasOwnProperty.call(payload, "toolArgs") ||
  Object.prototype.hasOwnProperty.call(payload, "sessionId");
const toolName =
  typeof payload.toolName === "string"
    ? payload.toolName
    : typeof payload.tool_name === "string"
      ? payload.tool_name
      : "";
const command =
  (typeof payload.command === "string" ? payload.command : "") ||
  extractCommand(payload.toolArgs) ||
  extractCommand(payload.tool_args) ||
  extractCommand(payload.tool_input) ||
  "";

process.stdout.write(`${isCopilot ? "copilot-json" : "stderr-exit"}\0${toolName}\0${command}\0`);
NODE
    ) || return 1
  else
    return 1
  fi

  OUTPUT_MODE="${parsed[0]:-stderr-exit}"
  TOOL_NAME="${parsed[1]:-}"
  COMMAND="${parsed[2]:-}"
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

TOOL_NAME=""
COMMAND=""
if [[ "$STRUCTURED_INPUT" -eq 1 ]]; then
  if ! parse_structured_input; then
    block "Structured hook payload must be valid JSON and requires jq or node for safe parsing"
  fi
fi

# Non-bash tool calls (Task, Read, Grep, etc.) go through the same preToolUse
# pipeline on Copilot. This hook only inspects shell commands, so let any other
# tool pass through rather than denying it for missing a "command" field.
if [[ "$STRUCTURED_INPUT" -eq 1 && -n "$TOOL_NAME" ]]; then
  tool_name_lc="${TOOL_NAME,,}"
  case "$tool_name_lc" in
    bash|shell|sh) ;;
    *) exit 0 ;;
  esac
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

    # Pattern prefixed with '!' means "must NOT contain" (forbidden pattern).
    local forbid_mode=0
    local pattern_body="$expected_pattern"
    if [[ "$pattern_body" == !* ]]; then
      forbid_mode=1
      pattern_body="${pattern_body#!}"
    fi
    if [[ -n "$pattern_body" ]]; then
      case "$expected_stream" in
        stdout) target_file="$stdout_file" ;;
        stderr) target_file="$stderr_file" ;;
        *)
          failures=$((failures + 1))
          echo "FAIL [${name}]: invalid expected stream '${expected_stream}'"
          target_file=""
          ;;
      esac
      if [[ -n "$target_file" ]]; then
        if [[ "$forbid_mode" -eq 1 ]]; then
          if grep -Fq "$pattern_body" "$target_file"; then
            failures=$((failures + 1))
            echo "FAIL [${name}]: forbidden pattern '${pattern_body}' present in ${expected_stream}"
          fi
        elif ! grep -Fq "$pattern_body" "$target_file"; then
          failures=$((failures + 1))
          echo "FAIL [${name}]: missing pattern '${pattern_body}' in ${expected_stream}"
        fi
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
  run_case "feature branch containing protected word" "git push origin feature/main-menu-fix" 0
  run_case "feature branch containing deploy word" "git push origin deploy-script-cleanup" 0
  # Unsafe rm command should still block.
  run_case "rm unsafe" "rm -rf /" 2
  run_case "rm unsafe separated flags" "rm -r -f /" 2
  run_case "rm unsafe separated flags reversed" "rm -f -r /" 2
  # Safe-scoped rm command should pass.
  run_case "rm scoped node_modules" "rm -rf ./node_modules" 0
  run_case "rm scoped separated flags" "rm -r -f ./node_modules" 0
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
  # shellcheck disable=SC2016
  run_case "safe dollar substitution" "$(printf 'echo $(printf hi)')" 0
  # shellcheck disable=SC2016
  run_case "dangerous dollar substitution" "$(printf 'echo $(rm -rf /)')" 2
  # shellcheck disable=SC2016
  run_case "dangerous backtick substitution" "$(printf 'echo `rm -rf /`')" 2
  run_case "quoted literal backtick" "printf '%s\n' 'use backtick \` here'" 0
  run_case "double-quoted literal backtick" 'printf "%s\n" "use backtick \` here"' 0
  # shellcheck disable=SC2016
  run_case "unescaped backtick in double quotes" "$(printf 'echo \"`rm -rf /`\"')" 2
  # Whitelist bypass: read-only verb with redirect or pipe-to-shell must still block.
  run_case "echo redirect" 'echo "data" > .env' 2
  run_case "grep pipe bash" 'grep pattern file | bash' 2
  # Secret-file reads must block (Bash bypass of settings.json Read() deny).
  run_case "cat .env" "cat .env" 2
  run_case "cat .env.example" "cat .env.example" 0
  run_case "head nested .env.example" "head config/.env.example" 0
  run_case "source .env" "source .env" 2
  run_case "dot-source .env" ". .env" 2
  run_case "less .env.local" "less .env.local" 2
  run_case "head .env.production" "head .env.production" 2
  run_case "cat .env.example plus .env.local" "cat .env.example .env.local" 2
  run_case "echo redirect .env.example" 'echo "data" > .env.example' 2
  run_case "tee pipe .env.example" 'echo foo | tee .env.example' 2
  run_case "clobber .env.example" 'echo foo >| .env.example' 2
  run_case "cat single-quoted .env" "cat '.env'" 2
  run_case "cat single-quoted .env.example" "cat '.env.example'" 0
  run_case "sed -i single-quoted .env.example" "sed -i '' '.env.example'" 2
  run_case "base64 .env" "base64 .env" 2
  run_case "xxd pem" "xxd server.pem" 2
  run_case "cat ssh key" "cat ~/.ssh/id_rsa" 2
  run_case "cat aws config" "cat ~/.aws/config" 2
  run_case "cat aws credentials" "cat ~/.aws/credentials" 2
  run_case "cat gpg secring" "cat ~/.gnupg/secring.gpg" 2
  run_case "cat credentials.json" "cat credentials.json" 2
  run_case "cat npmrc" "cat ~/.npmrc" 2
  # shellcheck disable=SC2016
  run_case "cat quoted home env" "$(printf 'cat \"$HOME/.env\"')" 2
  # shellcheck disable=SC2016
  run_case "cat quoted gcloud adc" "$(printf 'cat \"$HOME/.config/gcloud/application_default_credentials.json\"')" 2
  # npm token delete/revoke must block; safe npm commands must pass.
  run_case "npm token delete" "npm token delete abc123" 2
  run_case "npm token revoke" "npm token revoke abc123" 2
  run_case "npm token list" "npm token list" 0
  run_case "npm install" "npm install lodash" 0
  # Code-search for env-related strings must still pass (no .env path touch).
  run_case "grep env src" "grep env src/" 0
  run_case "rg dotenv" "rg dotenv src/" 0
  run_case "env pipe grep" "env | grep PATH" 0
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
  # Non-bash tool invocations (view/edit/Task/etc.) must pass through - the hook
  # only inspects shell commands, not structured tool payloads. A '!' prefix on
  # the expected pattern asserts the string is absent (so we catch regressions
  # where the hook emits deny JSON for a non-bash tool).
  run_stdin_case \
    "copilot non-bash view allowed" \
    '{"toolName":"view","toolArgs":{"path":"README.md"}}' \
    0 \
    "stdout" \
    '!permissionDecision'
  run_stdin_case \
    "copilot non-bash edit allowed" \
    '{"toolName":"edit","toolArgs":{"path":"README.md","old_string":"a","new_string":"b"}}' \
    0 \
    "stdout" \
    '!permissionDecision'
  run_stdin_case \
    "copilot non-bash Task allowed" \
    '{"toolName":"Task","toolArgs":{"description":"review"}}' \
    0 \
    "stdout" \
    '!permissionDecision'

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

# Return 0 (match) if the command references a secret-bearing file path:
# .env or .env.* except .env.example, /.ssh/, /.aws/, ~/.config/gcloud/,
# /.gnupg/, /.docker/config.json, /.kube/config, *.pem/*.key/*.pfx,
# credentials*, .npmrc, .pypirc.
# settings.json Read() patterns only cover the Read tool - this check is the
# only line of defence against shell-based secret exfil (cat/less/source/base64/etc.).
is_secret_path_touch() {
  local c="$1"
  local env_scan
  env_scan=$(printf '%s' "$c" | sed -E "s#(^|[[:space:]=:/'\"])\.env\.example([[:space:]]|$|['\"])#\1__goat_env_example__\2#g")
  if [[ "$env_scan" =~ (^|[[:space:]]|=|:|/|[\'\"]).env([[:space:]]|$|[\'\"]|\.[a-zA-Z0-9_-]+([[:space:]]|$|[\'\"])) ]]; then return 0; fi
  if [[ "$c" =~ /\.ssh/|/\.aws/|/\.config/gcloud/|application_default_credentials\.json|/\.gnupg/|/\.docker/config\.json|/\.kube/config ]]; then return 0; fi
  if [[ "$c" =~ (^|[[:space:]]|=|:|[\'\"])[^[:space:]]*\.(pem|key|pfx)([[:space:]]|$|[\'\"]) ]]; then return 0; fi
  if [[ "$c" =~ (^|[[:space:]]|=|:|/|[\'\"])(credentials|\.npmrc|\.pypirc)([[:space:]]|$|\.|[\'\"]) ]]; then return 0; fi
  return 1
}

is_env_example_touch() {
  local c="$1"
  if [[ "$c" =~ (^|[[:space:]]|=|:|/|[\'\"]).env\.example([[:space:]]|$|[\'\"]) ]]; then return 0; fi
  return 1
}

check_command_substitutions() {
  local remaining="$1"
  local depth="$2"
  local inner=""
  local match=""

  while [[ "$remaining" =~ \$\(([^()]*)\) ]]; do
    match="${BASH_REMATCH[0]}"
    inner="${BASH_REMATCH[1]}"
    [[ -n "$inner" ]] && check_segment "$inner" $((depth + 1))
    remaining="${remaining/$match/__goat_subst__}"
  done

  if [[ "$remaining" =~ \$\( ]]; then
    block "Complex command substitution. Write the expanded command directly."
  fi

  local remaining_unquoted="$remaining"
  remaining_unquoted=$(printf '%s' "$remaining_unquoted" | sed -E "s/'[^']*'//g")
  remaining_unquoted="${remaining_unquoted//\\\`/}"

  if [[ "$remaining_unquoted" == *\`* ]]; then
    block "Backtick command substitution hides nested execution. Use a direct command instead."
  fi
}

rm_has_recursive_force() {
  local c="$1"
  local has_recursive=0
  local has_force=0

  [[ "$c" =~ ^[[:space:]]*rm([[:space:]]|$) ]] || return 1

  if [[ "$c" =~ (^|[[:space:]])--recursive([[:space:]]|$) ]] || [[ "$c" =~ (^|[[:space:]])-[^-[:space:]]*r[^[:space:]]*([[:space:]]|$) ]]; then
    has_recursive=1
  fi
  if [[ "$c" =~ (^|[[:space:]])--force([[:space:]]|$) ]] || [[ "$c" =~ (^|[[:space:]])-[^-[:space:]]*f[^[:space:]]*([[:space:]]|$) ]]; then
    has_force=1
  fi

  [[ "$has_recursive" -eq 1 && "$has_force" -eq 1 ]]
}

rm_is_safely_scoped() {
  local c="$1"
  [[ "$c" =~ ^[[:space:]]*rm([[:space:]]+--?[[:alnum:]-]+)*[[:space:]]+(\./[a-zA-Z][^[:space:]]*|[a-zA-Z][^[:space:]]*|/tmp/[a-zA-Z0-9._-][^[:space:]]*)[[:space:]]*$ ]]
}

is_protected_push_token() {
  local token="$1"
  local ref="$1"

  case "$token" in
    ""|-) return 1 ;;
    -*) return 1 ;;
  esac

  if [[ "$ref" == *:* ]]; then
    ref="${ref##*:}"
  fi
  ref="${ref#refs/heads/}"

  case "$ref" in
    main|master|production|deploy) return 0 ;;
  esac
  return 1
}

check_segment() {
  local cmd="$1"
  local depth="${2:-0}"

  # Depth guard for recursive command substitution checking
  if [ "$depth" -gt 3 ]; then
    block "Deeply nested command substitution. Simplify the command."
  fi

  check_command_substitutions "$cmd" "$depth"

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

  local touches_secret=0
  if is_secret_path_touch "$cmd"; then
    touches_secret=1
  fi
  local touches_env_example=0
  if is_env_example_touch "$cmd"; then
    touches_env_example=1
  fi

  local has_redirect=0 has_pipe=0
  [[ "$cmd_unquoted" =~ \>[[:space:]] || "$cmd_unquoted" =~ \>\> || "$cmd_unquoted" =~ \>\| ]] && has_redirect=1
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
  if [[ "$touches_env_example" -eq 1 ]]; then
    local env_example_read_only=0
    case "$cmd_verb" in
      grep|egrep|fgrep|rg|ag|ack|cat|head|tail|less|more|wc|file|diff|printf|echo|read)
        env_example_read_only=1 ;;
      sed)
        if ! [[ "$cmd" =~ sed[[:space:]]+-[a-zA-Z]*i || "$cmd" =~ sed[[:space:]]+--in-place ]]; then
          env_example_read_only=1
        fi ;;
    esac
    if [[ "$cmd" =~ (\>|\>\>|\>\|)[[:space:]]*[\'\"[:space:]]*\.env\.example([\'\"[:space:]]|$) ]]; then
      env_example_read_only=0
    fi
    if [[ "$has_pipe" -eq 1 && "$cmd_unquoted" =~ \|[[:space:]]*(tee|dd|cp|mv|sponge)[[:space:]] ]]; then
      env_example_read_only=0
    fi
    if [[ "$env_example_read_only" -eq 0 ]]; then
      block ".env.example is allowed for read-only inspection only. Use an explicit file-edit approval path for changes."
    fi
  fi
  if [[ "$has_redirect" -eq 0 && "$has_pipe" -eq 0 && "$touches_secret" -eq 0 ]]; then
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
  #    Block: rm -rf /, rm -r -f /, rm --recursive --force ~, rm with path traversal
  #    Allow: rm -rf ./node_modules, rm -r -f dist/, rm --recursive --force /tmp/build-*
  if rm_has_recursive_force "$cmd"; then
    # Block path traversal regardless of prefix
    if [[ "$cmd" =~ \.\. ]]; then
      block "rm -rf with path traversal (..). Resolve the full path first."
    fi
    if ! rm_is_safely_scoped "$cmd"; then
      block "rm -rf without safe scoping. Specify an explicit target path."
    fi
  fi

  # 3. Direct push to main/master (case-insensitive)
  local cmd_lower="${cmd,,}"
  if [[ "$cmd_lower" =~ ^[[:space:]]*git[[:space:]]+push([[:space:]]|$) ]]; then
    local -a push_tokens=()
    local saw_remote=0
    read -r -a push_tokens <<< "$cmd_lower"
    for token in "${push_tokens[@]:2}"; do
      [[ "$token" == -* ]] && continue
      if [[ "$saw_remote" -eq 0 ]]; then
        saw_remote=1
        continue
      fi
      if is_protected_push_token "$token"; then
        block "Direct push to main/master/production/deploy. Push to a feature branch and open a PR."
      fi
    done
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

  # 9. Secret-file access (reads AND writes)
  #    Block: any command that touches .env or .env.* (except read-only
  #    `.env.example`) / SSH/AWS/GCP credentials / .pem / .key / .pfx /
  #    credentials / .npmrc / .pypirc. settings.json Read() patterns only cover
  #    the Read tool, not Bash - so this rule is the only line of defence
  #    against shell-based exfil.
  if [[ "$touches_secret" -eq 1 ]]; then
    block "Secret-file access ($cmd_verb). Reading or editing .env / SSH/AWS/GCP keys / credentials through the agent is an exfil risk."
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

  # 17. npm token delete/revoke (irreversible credential destruction)
  if [[ "$cmd_lower" =~ npm[[:space:]]+token[[:space:]]+(delete|revoke) ]]; then
    block "npm token delete/revoke is irreversible. Manage tokens manually via the npm website."
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
