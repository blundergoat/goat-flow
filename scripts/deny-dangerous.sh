#!/usr/bin/env bash
# =============================================================================
# deny-dangerous.sh - PreToolUse hook: blocks dangerous commands before execution
# goat-flow-hook-version: 1.5.2
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
# NOTE: direct literal `source .env` and similar shell-level secret reads ARE blocked. Plain
#   `.env.example` reads are allowed; writes still block. See self-test cases.
# =============================================================================
set -uo pipefail

# Fail closed if bash is too old to support namerefs (4.3+), mapfile -d (4.4+),
# and ${var,,} lowercase. macOS /bin/bash is 3.2 - using it would silently
# parse-error the script and the runtime would treat the failure as exit 0,
# allowing dangerous commands. Exit 2 is the security-correct posture.
if (( BASH_VERSINFO[0] < 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] < 4) )); then
  echo "deny-dangerous.sh requires bash 4.4+ (got ${BASH_VERSION:-unknown}). On macOS install Homebrew bash and invoke /usr/local/bin/bash or /opt/homebrew/bin/bash explicitly." >&2
  exit 2
fi

OUTPUT_MODE="stderr-exit"

# Globals shared by __goat_git_strip_globals / is_git_push / is_git_destructive.
# Initialised here so `set -u` doesn't fault on first use.
__goat_git_rest=""
__goat_git_aliased_push=0

# Cache external-tool detection once per script invocation so hot paths don't
# re-fork command-v on every call (gitbash on Windows pays ~10-30ms per fork).
HAS_JQ=0
HAS_NODE=0
command -v jq >/dev/null 2>&1 && HAS_JQ=1
command -v node >/dev/null 2>&1 && HAS_NODE=1

_CHECK_MODE=0
_CHECK_EXIT=0
_CHECK_STDOUT=""
_CHECK_STDERR=""

json_escape() {
  # Pure-bash escape (no fork). SC2001 prefers parameter expansion over sed
  # for simple per-char substitutions; this also saves a printf+sed fork on
  # the block path which used to fire per blocked command.
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '%s' "$s"
}

block() {
  if [[ "$_CHECK_MODE" -eq 1 ]]; then
    if [[ "$OUTPUT_MODE" == "copilot-json" ]]; then
      _CHECK_STDOUT=$(printf '{"permissionDecision":"deny","permissionDecisionReason":"%s"}\n' \
        "$(json_escape "$1")")
      _CHECK_EXIT=0
    else
      _CHECK_STDERR="BLOCKED: $1"
      _CHECK_EXIT=2
    fi
    return 1
  fi
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

  if [[ "$HAS_JQ" -eq 1 ]]; then
    mapfile -d '' parsed < <(
      jq -jr '
        def extract_command(value):
          if value == null then empty
          elif (value | type) == "object" then (value.command // empty)
          elif (value | type) == "string" then
            ((value | fromjson? // {}) | if type == "object" then (.command // empty) else empty end)
          else empty end;
        (if has("toolName") or has("toolArgs") or has("sessionId") then "copilot-json" else "stderr-exit" end), "\u0000",
        (.toolName // .tool_name // empty), "\u0000",
        (.command // extract_command(.toolArgs) // extract_command(.tool_args) // extract_command(.tool_input) // empty), "\u0000"
      ' 2>/dev/null <<<"$INPUT"
    ) || return 1
  elif [[ "$HAS_NODE" -eq 1 ]]; then
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
    # Bash-regex fallback when neither jq nor node is available. Without this,
    # a fresh install (no jq+node) would block EVERY tool call - the runtime
    # routes Bash, Read, Grep, Task, etc. all through this hook on Copilot, and
    # parse failure at this point fires `block` before the non-bash pass-through
    # can let them through. This fallback handles the common JSON shapes well
    # enough to keep the hook functional; complex/nested payloads still fail.
    local mode="stderr-exit"
    if [[ "$INPUT" =~ \"(toolName|toolArgs|sessionId)\" ]]; then
      mode="copilot-json"
    fi
    local tool=""
    if [[ "$INPUT" =~ \"toolName\"[[:space:]]*:[[:space:]]*\"([^\"]*)\" ]]; then
      tool="${BASH_REMATCH[1]}"
    elif [[ "$INPUT" =~ \"tool_name\"[[:space:]]*:[[:space:]]*\"([^\"]*)\" ]]; then
      tool="${BASH_REMATCH[1]}"
    fi
    local non_bash_tool=0
    if [[ -n "$tool" ]]; then
      local tool_lc="${tool,,}"
      case "$tool_lc" in
        bash|shell|sh) ;;
        *) non_bash_tool=1 ;;
      esac
    fi
    # T1.4: fail-closed on unicode/hex escapes the bash regex can't safely
    # decode. Without this, `git push` decodes to `git push` under jq but
    # is left as raw `git push` here - the rule check then misses the
    # bypass. Detecting the escape and refusing to parse is safer than
    # mis-parsing.
    if [[ "$non_bash_tool" -eq 1 ]]; then
      parsed=("$mode" "$tool" "")
    elif [[ "$INPUT" == *'\u'* || "$INPUT" == *'\x'* ]]; then
      return 1
    else
    # Handle stringified Copilot toolArgs: `"toolArgs":"{\"command\":...}"`.
    # The inner JSON is escape-encoded one level deep. If we detect that
    # shape, unescape \" and \\ once on a working copy so the existing
    # command regex matches the inner JSON. Without this, valid Copilot
    # payloads deny when jq+node are unavailable.
    # Bash glob check: literal `"toolArgs":"` followed by `{` then `\"` (the
    # outer-escape signature). Avoids the bash-regex backslash quoting maze.
    local input_for_extract="$INPUT"
    if [[ "$INPUT" == *'"toolArgs":"{\"'* ]] || \
       [[ "$INPUT" == *'"toolArgs": "{\"'* ]]; then
      input_for_extract="${input_for_extract//\\\"/\"}"
      input_for_extract="${input_for_extract//\\\\/\\}"
    fi
    local cmd=""
    if [[ "$input_for_extract" =~ \"command\"[[:space:]]*:[[:space:]]*\"((\\.|[^\"\\])*)\" ]]; then
      cmd="${BASH_REMATCH[1]}"
      cmd="${cmd//\\\"/\"}"
      cmd="${cmd//\\\\/\\}"
      cmd="${cmd//\\n/$'\n'}"
      cmd="${cmd//\\t/$'\t'}"
    fi
      parsed=("$mode" "$tool" "$cmd")
    fi
  fi

  OUTPUT_MODE="${parsed[0]:-stderr-exit}"
  TOOL_NAME="${parsed[1]:-}"
  COMMAND="${parsed[2]:-}"
}

# --- JSON Input Parsing ------------------------------------------------------
# Support direct argv for lightweight callers and stdin JSON payloads.
INPUT=""
SELF_TEST=0
# shellcheck disable=SC2034  # consumed by the sourced self-test sibling at runtime
SELF_TEST_MODE="full"
STRUCTURED_INPUT=0
if [[ "${1:-}" == "--self-test" || "${1:-}" =~ ^--self-test= ]]; then
  SELF_TEST=1
  if [[ "${1:-}" == "--self-test=smoke" ]]; then
    # shellcheck disable=SC2034  # consumed by the sourced self-test sibling at runtime
    SELF_TEST_MODE="smoke"
  elif [[ "${1:-}" == "--self-test=full" || "${1:-}" == "--self-test" ]]; then
    :
  else
    echo "Unknown self-test mode: ${1#--self-test=}. Use --self-test=smoke or --self-test=full." >&2
    exit 2
  fi
  shift
elif [[ "${1:-}" == "--check" ]]; then
  shift
  INPUT="$*"
elif [[ -n "${1:-}" ]]; then
  INPUT="$1"
else
  # The agent runtime typically pipes JSON on stdin with `tool_name` and `tool_input`.
  INPUT=$(cat)
fi

if [[ "$INPUT" =~ ^[[:space:]]*\{ ]]; then
  STRUCTURED_INPUT=1
fi

if [[ "$STRUCTURED_INPUT" -eq 1 ]]; then
  # Pre-detect copilot vs stderr-exit using bash regex so block() emits the
  # right shape if parse_structured_input fails before setting OUTPUT_MODE.
  # parse_structured_input later sets OUTPUT_MODE authoritatively from jq/node.
  if [[ "$INPUT" =~ \"(toolName|toolArgs|sessionId)\" ]]; then
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

# T2.1: input-size cap. The bash splitter walks per-character (O(n^2) due to
# ${var:i:1} access cost), so very long commands stall the hook. Anything
# legitimate fits in 16KB; longer inputs are almost always machine-generated.
# Skip this gate during self-test so the test harness can run.
if [[ "$SELF_TEST" -eq 0 ]] && (( ${#COMMAND} > 16384 )); then
  block "Command exceeds 16KB; review and run manually if intended."
fi

# Note: T2.3 segment-chain cap is enforced just before check_command_segments
# at the bottom of the file, AFTER split_command_segments_into is defined.

# --- Self-test ---------------------------------------------------------------
# The self-test corpus lives in deny-dangerous.self-test.sh so the runtime hook
# stays focused on parsing and policy enforcement. The --self-test interface is
# kept here for callers and CI.
# --- Pattern Checks ----------------------------------------------------------
# Each function checks one dangerous pattern. Add project-specific blocks below.

# Strip shell quotes/backslash escaping for conservative path-shape checks.
# This is not a full shell parser; it exists so split-quoted literal paths such
# as '.'env are scanned as .env without executing command substitutions.
strip_shell_quotes_for_path_scan() {
  local input="$1"
  local out=""
  local char=""
  local in_single=0
  local in_double=0
  local escaped=0
  local i=0

  for ((i = 0; i < ${#input}; i++)); do
    char="${input:i:1}"

    if [[ "$escaped" -eq 1 ]]; then
      out+="$char"
      escaped=0
      continue
    fi

    if [[ "$in_single" -eq 0 && "$char" == "\\" ]]; then
      escaped=1
      continue
    fi

    if [[ "$in_double" -eq 0 && "$char" == "'" ]]; then
      if [[ "$in_single" -eq 1 ]]; then
        in_single=0
      else
        in_single=1
      fi
      continue
    fi

    if [[ "$in_single" -eq 0 && "$char" == '"' ]]; then
      if [[ "$in_double" -eq 1 ]]; then
        in_double=0
      else
        in_double=1
      fi
      continue
    fi

    out+="$char"
  done

  if [[ "$escaped" -eq 1 ]]; then
    out+="\\"
  fi

  printf '%s' "$out"
}

# Return 0 (match) if the command references a direct literal secret-bearing file path:
# .env or .env.* except .env.example, /.ssh/, /.aws/, ~/.config/gcloud/,
# /.gnupg/, /.docker/config.json, /.kube/config, *.pem/*.key/*.pfx,
# credentials*, .npmrc, .pypirc.
# settings.json Read() patterns only cover the Read tool - this check is the
# direct literal Bash-layer defence against common secret reads (cat/less/source/base64/etc.).
is_secret_path_touch() {
  local c
  c=$(strip_shell_quotes_for_path_scan "$1")
  # Fast path: only spawn sed if .env.example is even mentioned. The sed below
  # masks .env.example so the subsequent .env regex doesn't false-match.
  local env_scan="$c"
  if [[ "$c" == *.env.example* ]]; then
    # shellcheck disable=SC2001  # multi-pattern ERE with capture groups
    env_scan=$(sed -E \
      "s#(^|[[:space:]=:/'\"])\\.env\\.example([[:space:]]|$|['\"])#\\1__goat_env_example__\\2#g; s#(>|>>|>\\|)[[:space:]]*(['\"]?)\\.env\\.example([[:space:]]|$|['\"])#\\1\\2__goat_env_example__\\3#g" \
      <<<"$c")
  fi
  if [[ "$env_scan" =~ (^|[[:space:]]|=|:|/|[\'\"])\.env[a-zA-Z0-9_.-]*([[:space:]]|$|[\'\"]) ]]; then return 0; fi
  if [[ "$env_scan" =~ (\>|\>\>|\>\|)[[:space:]]*[\'\"]?\.env[a-zA-Z0-9_.-]*([[:space:]]|$|[\'\"]) ]]; then return 0; fi
  if [[ "$c" =~ (^|[[:space:]]|=|:|/|[\'\"])((\./|\.\./|~/)*)(\.ssh/|\.aws/|\.config/gcloud/|\.gnupg/|\.docker/config\.json|\.kube/config|secrets/) ]]; then return 0; fi
  if [[ "$c" =~ application_default_credentials\.json ]]; then return 0; fi
  if [[ "$c" =~ (^|[[:space:]]|=|:|[\'\"])[^[:space:]]*\.(pem|key|pfx)([[:space:]]|$|[\'\"]) ]]; then return 0; fi
  if [[ "$c" =~ (^|[[:space:]]|=|:|/|[\'\"])(credentials|\.npmrc|\.pypirc)([[:space:]]|$|\.|[\'\"]) ]]; then return 0; fi
  return 1
}

is_env_example_touch() {
  local c
  c=$(strip_shell_quotes_for_path_scan "$1")
  if [[ "$c" =~ (^|[[:space:]]|=|:|/|[\'\"])\.env\.example([[:space:]]|$|[\'\"]) ]]; then return 0; fi
  if [[ "$c" =~ (\>|\>\>|\>\|)[[:space:]]*[\'\"]?\.env\.example([[:space:]]|$|[\'\"]) ]]; then return 0; fi
  return 1
}

check_command_segments() {
  local input="$1"
  local depth="${2:-0}"
  local -a nested_segments=()
  local nested_segment

  # Cross-segment download-then-execute detection. Per-segment rules can't
  # see this because the chain `curl ... -o /tmp/x; bash /tmp/x` splits into
  # two individually-benign segments. Only runs at the outermost depth - inner
  # bash -c bodies wouldn't contain a chained-segment download anyway.
  if [[ "$depth" -eq 0 ]] && \
     [[ "$input" =~ (^|[[:space:]])(curl|wget|fetch|http)([[:space:]]|$) ]] && \
     [[ "$input" =~ (\;|\&\&|\|\|)[[:space:]]*(ba)?sh[[:space:]]+[^[:space:]\&\|\;]+ ]]; then
    block "Download-then-execute (curl/wget ... && bash file). Inspect the downloaded file before running it." || return $?
  fi

  split_command_segments_into nested_segments "$input"

  for nested_segment in "${nested_segments[@]}"; do
    # Trim leading/trailing whitespace via bash builtins (no sed fork).
    nested_segment="${nested_segment#"${nested_segment%%[![:space:]]*}"}"
    nested_segment="${nested_segment%"${nested_segment##*[![:space:]]}"}"
    [[ -z "$nested_segment" ]] && continue
    check_segment "$nested_segment" "$depth" || return $?
  done
}

heredoc_opener_executes_shell() {
  local opener="$1"
  local before_heredoc="${opener%%<<*}"
  local normalized
  local first_word
  local pipe_shell_re

  normalized=$(normalize_command_candidate "$before_heredoc")
  first_word=$(first_word_base "$normalized")
  case "$first_word" in
    bash|sh|dash|zsh|ksh|fish|pwsh|powershell|cmd)
      return 0 ;;
  esac

  pipe_shell_re='[|][[:space:]]*(env[[:space:]]+)?([^[:space:]/]+/)*(bash|sh|dash|zsh|ksh|fish|pwsh|powershell|cmd)([[:space:]]|$)'
  [[ "$opener" =~ $pipe_shell_re ]]
}

mask_safe_quoted_heredoc_bodies() {
  local input="$1"
  local output=""
  local line=""
  local delimiter=""
  local in_body=0
  local mask_body=0
  local single_quoted_re="<<-?[[:space:]]*'([^']+)'"
  local double_quoted_re='<<-?[[:space:]]*"([^"]+)"'

  while IFS= read -r line || [[ -n "$line" ]]; do
    if (( in_body )); then
      if [[ "$line" == "$delimiter" ]]; then
        output+="$line"$'\n'
        in_body=0
        mask_body=0
        delimiter=""
      elif (( mask_body )); then
        output+="__goat_quoted_heredoc_body__"$'\n'
      else
        output+="$line"$'\n'
      fi
      continue
    fi

    output+="$line"$'\n'
    if [[ "$line" =~ $single_quoted_re ]] || [[ "$line" =~ $double_quoted_re ]]; then
      delimiter="${BASH_REMATCH[1]}"
      if heredoc_opener_executes_shell "$line"; then
        mask_body=0
      else
        mask_body=1
      fi
      in_body=1
    fi
  done <<< "$input"

  printf '%s' "${output%$'\n'}"
}

check_command_substitutions() {
  local remaining="$1"
  local depth="$2"
  local inner=""
  local match=""
  local scan_remaining

  if [[ "$remaining" == *\'* ]]; then
    # shellcheck disable=SC2001  # ERE alternation; parameter expansion uses globs
    scan_remaining=$(sed -E "s/'[^']*'/__goat_single_quoted__/g" <<<"$remaining")
  else
    scan_remaining="$remaining"
  fi

  while [[ "$scan_remaining" =~ \$\(([^()]*)\) ]]; do
    match="${BASH_REMATCH[0]}"
    inner="${BASH_REMATCH[1]}"
    if [[ -n "$inner" ]]; then
      check_command_segments "$inner" $((depth + 1)) || return $?
    fi
    scan_remaining="${scan_remaining/$match/__goat_subst__}"
  done

  local proc_subst_re='[<>]\(([^()]*)\)'
  while [[ "$scan_remaining" =~ $proc_subst_re ]]; do
    match="${BASH_REMATCH[0]}"
    inner="${BASH_REMATCH[1]}"
    if [[ -n "$inner" ]]; then
      check_command_segments "$inner" $((depth + 1)) || return $?
    fi
    scan_remaining="${scan_remaining/$match/__goat_proc_subst__}"
  done

  if [[ "$scan_remaining" =~ \$\( ]]; then
    block "Complex command substitution. Write the expanded command directly." || return $?
  fi

  local remaining_unquoted="$remaining"
  if [[ "$remaining" == *\'* ]]; then
    # shellcheck disable=SC2001  # ERE pattern; parameter expansion uses globs
    remaining_unquoted=$(sed -E "s/'[^']*'//g" <<<"$remaining")
  fi
  remaining_unquoted="${remaining_unquoted//\\\`/}"

  if [[ "$remaining_unquoted" == *\`* ]]; then
    block "Backtick command substitution hides nested execution. Use a direct command instead." || return $?
  fi
}

# Returns the basename of the first whitespace-delimited word in $1.
# Used by rules that need wrapper/path-stripped command-word matching.
# E.g. `/bin/rm` -> `rm`, `git` -> `git`. Caller is responsible for any
# wrapper-strip (sudo/env/time/...); pass the result of normalize_command_candidate.
first_word_base() {
  local c="${1#"${1%%[![:space:]]*}"}"
  local word="${c%%[[:space:]]*}"
  printf '%s' "${word##*/}"
}

rm_has_recursive() {
  local c="$1"
  # Match by basename so /bin/rm, /usr/bin/rm, etc. are all caught after
  # normalize_command_candidate has stripped any wrappers.
  local base
  base=$(first_word_base "$c")
  [[ "$base" == "rm" ]] || return 1

  [[ "$c" =~ (^|[[:space:]])--recursive([[:space:]]|$) ]] || [[ "$c" =~ (^|[[:space:]])-[^-[:space:]]*[rR][^[:space:]]*([[:space:]]|$) ]]
}

rm_is_safely_scoped() {
  local c="$1"
  local targets_str
  targets_str=$(drop_first_shell_word "$c")
  targets_str="${targets_str#"${targets_str%%[![:space:]]*}"}"
  targets_str="${targets_str%"${targets_str##*[![:space:]]}"}"
  [[ -z "$targets_str" ]] && return 1
  # Check each target independently - one unsafe path fails the whole command.
  local target
  for target in $targets_str; do
    [[ "$target" == "--" ]] && continue
    [[ "$target" == -* ]] && continue
    target="${target#./}"
    target="${target%/}"
    [[ -z "$target" ]] && return 1
    [[ "$target" =~ ^/tmp/build-[a-zA-Z0-9._-] ]] && continue
    [[ "$target" == /* ]] && return 1
    [[ "$target" == "~"* ]] && return 1
    # Windows drive-rooted paths (e.g. C:/Users/x or C:\Users\x) are absolute
    # in Windows semantics; reject them the same way as POSIX-absolute paths.
    [[ "$target" =~ ^[A-Za-z]:[/\\] ]] && return 1
    case "$target" in
      node_modules|dist|out|build|coverage|__pycache__|.cache|.next|.nuxt|.turbo) continue ;;
    esac
    [[ "$target" == */* ]] && continue
    return 1
  done
  return 0
}


normalize_leading_command_word() {
  local c="$1"
  local rest=""
  local current=""
  local char=""
  local in_single=0
  local in_double=0
  local escaped=0
  local i=0
  local word_space="__goat_word_space__"

  c="${c#"${c%%[![:space:]]*}"}"
  for ((i = 0; i < ${#c}; i++)); do
    char="${c:i:1}"

    if [[ "$escaped" -eq 1 ]]; then
      if [[ "$char" =~ [[:space:]] ]]; then
        current+="$word_space"
      else
        current+="$char"
      fi
      escaped=0
      continue
    fi

    if [[ "$in_single" -eq 0 && "$char" == "\\" ]]; then
      escaped=1
      continue
    fi

    if [[ "$in_double" -eq 0 && "$char" == "'" ]]; then
      if [[ "$in_single" -eq 1 ]]; then
        in_single=0
      else
        in_single=1
      fi
      continue
    fi

    if [[ "$in_single" -eq 0 && "$char" == '"' ]]; then
      if [[ "$in_double" -eq 1 ]]; then
        in_double=0
      else
        in_double=1
      fi
      continue
    fi

    if [[ "$in_single" -eq 0 && "$in_double" -eq 0 && "$char" =~ [[:space:]] ]]; then
      rest="${c:i+1}"
      rest="${rest#"${rest%%[![:space:]]*}"}"
      if [[ -n "$rest" ]]; then
        printf '%s %s' "$current" "$rest"
      else
        printf '%s' "$current"
      fi
      return 0
    fi

    if [[ "$char" =~ [[:space:]] ]]; then
      current+="$word_space"
    else
      current+="$char"
    fi
  done

  if [[ "$escaped" -eq 1 ]]; then
    current+="\\"
  fi

  printf '%s' "$current"
}

drop_first_shell_word() {
  local c="$1"
  local char=""
  local in_single=0
  local in_double=0
  local escaped=0
  local i=0

  c="${c#"${c%%[![:space:]]*}"}"
  for ((i = 0; i < ${#c}; i++)); do
    char="${c:i:1}"

    if [[ "$escaped" -eq 1 ]]; then
      escaped=0
      continue
    fi

    if [[ "$in_single" -eq 0 && "$char" == "\\" ]]; then
      escaped=1
      continue
    fi

    if [[ "$in_double" -eq 0 && "$char" == "'" ]]; then
      if [[ "$in_single" -eq 1 ]]; then
        in_single=0
      else
        in_single=1
      fi
      continue
    fi

    if [[ "$in_single" -eq 0 && "$char" == '"' ]]; then
      if [[ "$in_double" -eq 1 ]]; then
        in_double=0
      else
        in_double=1
      fi
      continue
    fi

    if [[ "$in_single" -eq 0 && "$in_double" -eq 0 && "$char" =~ [[:space:]] ]]; then
      local rest="${c:i+1}"
      rest="${rest#"${rest%%[![:space:]]*}"}"
      printf '%s' "$rest"
      return 0
    fi
  done

  printf ''
}

# Strip git's command word and any global options (-c key=val, -C path,
# --no-pager, --git-dir=..., --work-tree=..., --bare, --paginate, --html-path,
# --info-path, etc.). Sets two globals: __goat_git_rest (subcommand + args
# remainder) and __goat_git_aliased_push (1 if any `-c alias.<name>=push`
# was seen). Returns 0 if the command is git, 1 otherwise.
#
# Globals (not subshell-stdout) because callers pass us via $(...) would lose
# the alias side-effect.
__goat_git_strip_globals() {
  __goat_git_aliased_push=0
  __goat_git_rest=""
  local c="$1"
  c=$(normalize_leading_command_word "$c")
  local command_word="${c%%[[:space:]]*}"
  local command_base="${command_word##*/}"
  [[ "$command_base" == "git" ]] || return 1
  c="${c#"$command_word"}"
  c="${c#"${c%%[![:space:]]*}"}"
  while [[ "$c" =~ ^- ]]; do
    local opt="${c%%[[:space:]]*}"
    c="${c#"$opt"}"
    c="${c#"${c%%[![:space:]]*}"}"
    if [[ "$opt" == "-c" || "$opt" == "-C" ]]; then
      local val=""
      if [[ "$c" == \'* ]]; then
        val="${c#\'}"; val="${val%%\'*}"
        c="${c#\'}" && c="${c#*\'}"
      elif [[ "$c" == \"* ]]; then
        val="${c#\"}"; val="${val%%\"*}"
        c="${c#\"}" && c="${c#*\"}"
      else
        val="${c%%[[:space:]]*}"
        c="${c#"${c%%[[:space:]]*}"}"
      fi
      c="${c#"${c%%[![:space:]]*}"}"
      # Detect dangerous alias forms regardless of quoting. Three cases:
      #   (a) -c alias.X=push           (unquoted; val is whole token)
      #   (b) -c alias.X='push ...'     (key=quoted; val is `alias.X='push` after
      #       parser truncates at first inner space - leading quote left in val)
      #   (c) -c "alias.X=push ..."     (whole-arg-quoted; val is full inner)
      # The regex permits a leading quote between `=` and the dangerous
      # keyword (push or `!`-shell-command).
      if [[ "$opt" == "-c" && "$val" =~ ^alias\.[a-zA-Z0-9_-]+=[\'\"]?(push|!) ]]; then
        __goat_git_aliased_push=1
      fi
    fi
  done
  __goat_git_rest="$c"
  return 0
}

is_git_push() {
  __goat_git_strip_globals "$1" || return 1
  [[ "$__goat_git_rest" =~ ^(push|send-pack)([[:space:]]|$) ]] && return 0
  if [[ "$__goat_git_aliased_push" -eq 1 ]]; then
    return 0
  fi
  return 1
}

# Returns 0 if the command is git (after wrapper + global-flag strip) AND the
# subcommand+args are destructive: reset --hard, clean -f, or anything with
# --no-verify. Caller should pre-normalise via normalize_command_candidate so
# wrappers like sudo/env are stripped.
is_git_destructive() {
  __goat_git_strip_globals "$1" || return 1
  local rest="$__goat_git_rest"
  if [[ "$rest" =~ (^|[[:space:]])--no-verify([[:space:]]|$) ]]; then
    return 0
  fi
  if [[ "$rest" =~ ^reset([[:space:]]|$) ]] && [[ "$rest" =~ (^|[[:space:]])--hard([[:space:]]|$) ]]; then
    return 0
  fi
  if [[ "$rest" =~ ^clean([[:space:]]|$) ]] && \
     { [[ "$rest" =~ (^|[[:space:]])--force([[:space:]]|$) ]] || \
       [[ "$rest" =~ (^|[[:space:]])-[^-[:space:]]*f[^[:space:]]*([[:space:]]|$) ]]; }; then
    return 0
  fi
  return 1
}

is_git_ls_files() {
  __goat_git_strip_globals "$1" || return 1
  [[ "$__goat_git_rest" =~ ^ls-files([[:space:]]|$) ]]
}

is_find_read_only() {
  local c="$1"
  ! [[ "$c" =~ (^|[[:space:]])-(delete|exec|execdir|ok|okdir)([[:space:]]|$) ]]
}

is_env_example_pipe_consumer_read_only() {
  local c
  c=$(normalize_command_candidate "$1")
  local verb="${c%%[[:space:]]*}"
  verb="${verb##*/}"
  case "$verb" in
    grep|egrep|fgrep|rg|ag|ack|cat|head|tail|less|more|wc|file|diff|printf|echo|read|ls|stat|test)
      return 0 ;;
    sed)
      ! [[ "$c" =~ sed[[:space:]]+-[a-zA-Z]*i || "$c" =~ sed[[:space:]]+--in-place ]]
      return $? ;;
    *) return 1 ;;
  esac
}

strip_one_assignment_prefix() {
  local c="$1"
  [[ "$c" =~ ^[a-zA-Z_][a-zA-Z0-9_]*= ]] || return 1

  local i char
  local in_single=0
  local in_double=0
  local escaped=0

  for ((i = 0; i < ${#c}; i++)); do
    char="${c:i:1}"

    if [[ "$escaped" -eq 1 ]]; then
      escaped=0
      continue
    fi

    if [[ "$in_single" -eq 0 && "$char" == "\\" ]]; then
      escaped=1
      continue
    fi

    if [[ "$in_double" -eq 0 && "$char" == "'" ]]; then
      if [[ "$in_single" -eq 1 ]]; then
        in_single=0
      else
        in_single=1
      fi
      continue
    fi

    if [[ "$in_single" -eq 0 && "$char" == '"' ]]; then
      if [[ "$in_double" -eq 1 ]]; then
        in_double=0
      else
        in_double=1
      fi
      continue
    fi

    if [[ "$in_single" -eq 0 && "$in_double" -eq 0 && "$char" =~ [[:space:]] ]]; then
      local rest="${c:i+1}"
      rest="${rest#"${rest%%[![:space:]]*}"}"
      printf '%s' "$rest"
      return 0
    fi
  done

  printf ''
  return 0
}

normalize_env_prefix() {
  local c="$1"
  local stripped=""

  while true; do
    c="${c#"${c%%[![:space:]]*}"}"

    if [[ "$c" =~ ^--unset=[^[:space:]]+[[:space:]]* ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    if [[ "$c" =~ ^--unset[[:space:]]+[^[:space:]]+[[:space:]]* ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    if [[ "$c" =~ ^-u[[:space:]]+[^[:space:]]+[[:space:]]* ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    if [[ "$c" =~ ^-u[^[:space:]]+[[:space:]]* ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    if [[ "$c" =~ ^--(ignore-environment|null)[[:space:]]* ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    if [[ "$c" =~ ^--chdir=[^[:space:]]+[[:space:]]* ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    if [[ "$c" =~ ^--chdir[[:space:]]+ ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      c=$(drop_first_shell_word "$c")
      continue
    fi
    if [[ "$c" =~ ^-[cC][[:space:]]+ ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      c=$(drop_first_shell_word "$c")
      continue
    fi
    if [[ "$c" =~ ^-[i0][[:space:]]* ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    if [[ "$c" =~ ^(-[sS]|--split-string)(=|[[:space:]]+) ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      if [[ "$c" == \'* ]]; then c="${c#\'}"; c="${c%\'}"; fi
      if [[ "$c" == \"* ]]; then c="${c#\"}"; c="${c%\"}"; fi
      break
    fi
    if [[ "$c" =~ ^--[[:space:]]+ ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    if stripped=$(strip_one_assignment_prefix "$c"); then
      c="$stripped"
      continue
    fi
    break
  done

  printf '%s' "$c"
}

normalize_time_prefix() {
  local c="$1"

  while true; do
    c="${c#"${c%%[![:space:]]*}"}"

    if [[ "$c" =~ ^(--portability|--verbose|--quiet|--append|-p|-v|-q|-a)[[:space:]]+ ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    if [[ "$c" =~ ^(--format|--output)= ]]; then
      c=$(drop_first_shell_word "$c")
      continue
    fi
    if [[ "$c" =~ ^(--format|--output|-f|-o)[[:space:]]+ ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      c=$(drop_first_shell_word "$c")
      continue
    fi
    if [[ "$c" =~ ^(-f|-o)[^[:space:]]+[[:space:]]* ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    if [[ "$c" =~ ^--[[:space:]]+ ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    break
  done

  printf '%s' "$c"
}

normalize_sudo_prefix() {
  local c="$1"
  while true; do
    c="${c#"${c%%[![:space:]]*}"}"
    if [[ "$c" =~ ^-[ugCDRTp][[:space:]]+[^[:space:]]+[[:space:]]* ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    if [[ "$c" =~ ^-[ugCDRTp][^[:space:]-]+[[:space:]]* ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    if [[ "$c" =~ ^--(user|group|close-from|chdir|role|type|other-user|prompt|command-timeout|preserve-env)=[^[:space:]]*[[:space:]]* ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    if [[ "$c" =~ ^-[AbeEHhiKknPSsV]+[[:space:]]* ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    if [[ "$c" =~ ^--(askpass|background|bell|edit|preserve-env|set-home|help|login|list|remove-timestamp|reset-timestamp|non-interactive|stdin|shell|validate|version)[[:space:]]* ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    if [[ "$c" =~ ^--[[:space:]]+ ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
    fi
    break
  done
  printf '%s' "$c"
}

normalize_command_candidate() {
  local c="$1"
  local stripped=""
  local word=""
  local base=""
  local case_arm_re='^case[[:space:]][^)]*\)[[:space:]]*'

  while true; do
    c="${c#"${c%%[![:space:]]*}"}"
    c=$(normalize_leading_command_word "$c")

    if [[ "$c" == \(* ]]; then
      c="${c#\(}"
      continue
    fi
    if [[ "$c" == \{* ]]; then
      c="${c#\{}"
      continue
    fi
    if [[ "$c" =~ $case_arm_re ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    if [[ "$c" =~ ^coproc[[:space:]]+[a-zA-Z_][a-zA-Z0-9_]*[[:space:]]+\{[[:space:]]* ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    if [[ "$c" =~ ^coproc[[:space:]]+ ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    if [[ "$c" =~ ^(then|do|else|if|elif|while|until|in)[[:space:]]+ ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    if [[ "$c" =~ ^[a-zA-Z_][a-zA-Z0-9_]*[[:space:]]*\(\)[[:space:]]*\{[[:space:]]* ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    if [[ "$c" =~ ^function[[:space:]]+[a-zA-Z_][a-zA-Z0-9_]*([[:space:]]*\(\))?[[:space:]]*\{[[:space:]]* ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    if [[ "$c" =~ ^command[[:space:]]+ ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      c="${c#"${c%%[![:space:]]*}"}"
      while [[ "$c" =~ ^(-p|--)[[:space:]]+ ]]; do
        c="${c#"${BASH_REMATCH[0]}"}"
      done
      continue
    fi
    if [[ "$c" =~ ^builtin[[:space:]]+ ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    word="${c%%[[:space:]]*}"
    base="${word##*/}"
    if [[ "$base" == "time" || "$base" == "nohup" ]]; then
      c="${c#"$word"}"
      c="${c#"${c%%[![:space:]]*}"}"
      if [[ "$base" == "time" ]]; then
        c=$(normalize_time_prefix "$c")
      fi
      continue
    fi
    if [[ "$base" == "nice" ]]; then
      c="${c#"$word"}"
      c="${c#"${c%%[![:space:]]*}"}"
      if [[ "$c" =~ ^(-n[[:space:]]+[^[:space:]]+|--adjustment(=|[[:space:]]+)[^[:space:]]+|-[0-9]+)[[:space:]]+ ]]; then
        c="${c#"${BASH_REMATCH[0]}"}"
      fi
      continue
    fi
    if [[ "$base" == "sudo" ]]; then
      c="${c#"$word"}"
      c="${c#"${c%%[![:space:]]*}"}"
      c=$(normalize_sudo_prefix "$c")
      continue
    fi
    if stripped=$(strip_one_assignment_prefix "$c"); then
      c="$stripped"
      continue
    fi
    if [[ "$c" =~ ^env([[:space:]]|$) ]]; then
      c="${c#env}"
      c=$(normalize_env_prefix "$c")
      continue
    fi
    if [[ "$c" =~ ^(/usr)?/bin/env([[:space:]]|$) ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      c=$(normalize_env_prefix "$c")
      continue
    fi
    break
  done

  printf '%s' "$c"
}

normalize_git_push_candidate() {
  normalize_command_candidate "$1"
}

is_shell_command() {
  local c
  c=$(normalize_command_candidate "$1")
  c="${c#"${c%%[![:space:]]*}"}"
  local word="${c%%[[:space:]]*}"
  local base="${word##*/}"

  [[ "$base" == "bash" || "$base" == "sh" ]]
}

is_interpreter_command() {
  local c
  c=$(normalize_command_candidate "$1")
  c="${c#"${c%%[![:space:]]*}"}"
  local word="${c%%[[:space:]]*}"
  local base="${word##*/}"

  case "$base" in
    python|python3|node|perl|ruby) return 0 ;;
    *) return 1 ;;
  esac
}

# Same nameref contract as split_command_segments_into - see comment above that
# function. The internal name (`__goat_words_out__`) is namespaced for the same
# reason: prevent silent failure if the caller picks a generic local name.
split_shell_words_into() {
  local -n __goat_words_out__="$1"
  local input="$2"
  __goat_words_out__=()
  local current=""
  local char=""
  local in_single=0
  local in_double=0
  local escaped=0
  local i=0

  for ((i = 0; i < ${#input}; i++)); do
    char="${input:i:1}"

    if [[ "$escaped" -eq 1 ]]; then
      current+="$char"
      escaped=0
      continue
    fi

    if [[ "$in_single" -eq 0 && "$char" == "\\" ]]; then
      escaped=1
      continue
    fi

    if [[ "$in_double" -eq 0 && "$char" == "'" ]]; then
      if [[ "$in_single" -eq 1 ]]; then
        in_single=0
      else
        in_single=1
      fi
      continue
    fi

    if [[ "$in_single" -eq 0 && "$char" == '"' ]]; then
      if [[ "$in_double" -eq 1 ]]; then
        in_double=0
      else
        in_double=1
      fi
      continue
    fi

    if [[ "$in_single" -eq 0 && "$in_double" -eq 0 && "$char" =~ [[:space:]] ]]; then
      if [[ -n "$current" ]]; then
        __goat_words_out__+=("$current")
        current=""
      fi
      continue
    fi

    current+="$char"
  done

  if [[ "$escaped" -eq 1 ]]; then
    current+="\\"
  fi
  if [[ -n "$current" ]]; then
    __goat_words_out__+=("$current")
  fi
}

strip_sql_literals_inside_double_quotes() {
  local input="$1"
  local out=""
  local char=""
  local in_double=0
  local escaped=0
  local i=0

  for ((i = 0; i < ${#input}; i++)); do
    char="${input:i:1}"

    if [[ "$escaped" -eq 1 ]]; then
      out+="$char"
      escaped=0
      continue
    fi

    if [[ "$char" == "\\" ]]; then
      out+="$char"
      escaped=1
      continue
    fi

    if [[ "$char" == '"' ]]; then
      out+="$char"
      if [[ "$in_double" -eq 1 ]]; then
        in_double=0
      else
        in_double=1
      fi
      continue
    fi

    if [[ "$in_double" -eq 1 && "$char" == "'" ]]; then
      out+="''"
      i=$((i + 1))
      while (( i < ${#input} )); do
        char="${input:i:1}"
        if [[ "$char" == "'" ]]; then
          break
        fi
        i=$((i + 1))
      done
      continue
    fi

    out+="$char"
  done

  printf '%s' "$out"
}

is_search_command_verb() {
  local verb="${1##*/}"
  case "$verb" in
    grep|egrep|fgrep|rg|ag|ack) return 0 ;;
    *) return 1 ;;
  esac
}

search_option_consumes_value() {
  local opt="$1"
  case "$opt" in
    -A|-B|-C|-D|-d|-g|-M|-m|-t|-T|--after-context|--before-context|--binary-files|--color|--colour|--colors|--context|--context-separator|--directories|--devices|--encoding|--engine|--exclude|--exclude-dir|--exclude-from|--glob|--group-separator|--iglob|--ignore-file|--include|--label|--max-columns|--max-count|--max-depth|--path-separator|--pre|--pre-glob|--regexp|--replace|--sort|--sortr|--threads|--type|--type-add|--type-clear|--type-not)
      return 0
      ;;
    *) return 1 ;;
  esac
}

search_pattern_file_touches_secret() {
  local option="$1"
  local value="$2"
  case "$option" in
    -f|--file)
      is_secret_path_touch "$value"
      return $?
      ;;
    -f?*)
      is_secret_path_touch "${option#-f}"
      return $?
      ;;
    --file=*)
      is_secret_path_touch "${option#--file=}"
      return $?
      ;;
    *) return 1 ;;
  esac
}

search_file_operands_touch_secret() {
  local c
  c=$(normalize_command_candidate "$1")

  local -a words=()
  split_shell_words_into words "$c"
  [[ "${#words[@]}" -eq 0 ]] && return 1

  local verb="${words[0]##*/}"
  is_search_command_verb "$verb" || return 1

  local pattern_seen=0
  local after_options=0
  local i=1
  local word=""
  local next=""

  while [[ "$i" -lt "${#words[@]}" ]]; do
    word="${words[$i]}"

    if [[ "$after_options" -eq 0 && "$word" == "--" ]]; then
      after_options=1
      i=$((i + 1))
      continue
    fi

    if [[ "$after_options" -eq 0 ]]; then
      if [[ "$word" == "-e" || "$word" == "--regexp" ]]; then
        pattern_seen=1
        i=$((i + 2))
        continue
      fi
      if [[ "$word" == -e?* || "$word" == --regexp=* ]]; then
        pattern_seen=1
        i=$((i + 1))
        continue
      fi
      if [[ "$word" == "-f" || "$word" == "--file" ]]; then
        next="${words[$((i + 1))]:-}"
        if search_pattern_file_touches_secret "$word" "$next"; then
          return 0
        fi
        pattern_seen=1
        i=$((i + 2))
        continue
      fi
      if [[ "$word" == -f?* || "$word" == --file=* ]]; then
        if search_pattern_file_touches_secret "$word" ""; then
          return 0
        fi
        pattern_seen=1
        i=$((i + 1))
        continue
      fi
      if [[ "$word" == --*=* ]]; then
        i=$((i + 1))
        continue
      fi
      if search_option_consumes_value "$word"; then
        i=$((i + 2))
        continue
      fi
      if [[ "$word" == -* ]]; then
        i=$((i + 1))
        continue
      fi
    fi

    if [[ "$pattern_seen" -eq 0 ]]; then
      pattern_seen=1
      i=$((i + 1))
      continue
    fi

    if is_secret_path_touch "$word"; then
      return 0
    fi
    i=$((i + 1))
  done

  return 1
}

check_segment() {
  local cmd="$1"
  local depth="${2:-0}"

  # Depth guard for recursive command substitution checking
  if [ "$depth" -gt 3 ]; then
    block "Deeply nested command substitution. Simplify the command." || return $?
  fi

  check_command_substitutions "$cmd" "$depth" || return $?

  # Read-only tool whitelist: if the command verb is a read-only tool,
  # dangerous patterns in its arguments are data (search terms), not actions.
  # Skip whitelist if: output redirection (>) or pipe-to-shell (| bash/sh) detected.
  local cmd_trimmed
  cmd_trimmed="${cmd#"${cmd%%[![:space:]]*}"}"
  # T1.2: canonical normalisation entry point. Every destructive rule below
  # that needs wrapper-strip (sudo/env/time/nohup/nice/command/builtin/var=val)
  # routes through cmd_normalized. Without this, `sudo rm -rf /`,
  # `env rm -rf /`, `/bin/rm -rf /` slip past the bare `^[[:space:]]*rm` regex.
  local cmd_normalized
  cmd_normalized=$(normalize_command_candidate "$cmd_trimmed")
  local cmd_for_verb="$cmd_normalized"
  local cmd_verb
  cmd_verb="${cmd_for_verb%%[[:space:]]*}"
  cmd_verb="${cmd_verb##*/}"

  # Strip single- and double-quoted strings for structural (pipe/redirect/verb) pattern
  # matching, so dangerous characters inside quoted arguments (e.g. rg 'a|b', awk "x>y")
  # are treated as data, not control flow. This version is best-effort: it handles the
  # common case of balanced quotes without escape processing.
  local cmd_unquoted="$cmd"
  if [[ "$cmd" == *\'* || "$cmd" == *\"* ]]; then
    # shellcheck disable=SC2001  # ERE alternation; parameter expansion uses globs
    cmd_unquoted=$(sed -E "s/'[^']*'//g; s/\"[^\"]*\"//g" <<<"$cmd")
  fi

  local touches_secret=0
  if is_search_command_verb "$cmd_verb"; then
    if search_file_operands_touch_secret "$cmd"; then
      touches_secret=1
    fi
  else
    if is_secret_path_touch "$cmd"; then
      touches_secret=1
    fi
  fi
  local touches_env_example=0
  if is_env_example_touch "$cmd"; then
    touches_env_example=1
  fi

  local has_redirect=0 has_pipe=0
  [[ "$cmd_unquoted" =~ (^|[^=])[0-9]*\>\> || "$cmd_unquoted" =~ (^|[^=])[0-9]*\>\| || "$cmd_unquoted" =~ (^|[^=])[0-9]*\>[[:space:]] || "$cmd_unquoted" =~ (^|[^=])[0-9]*\>[^[:space:]\|=] ]] && has_redirect=1
  # Detect single pipe (|) but not logical OR (||), outside of quoted strings
  local pipe_stripped="${cmd_unquoted//||/}"
  [[ "$pipe_stripped" =~ \| ]] && has_pipe=1
  # If a pipe is present (outside quotes), block pipe-to-shell/interpreter regardless of verb
  if [[ "$has_pipe" -eq 1 ]]; then
    local pipe_scan="${cmd_unquoted//||/__GOAT_OR__}"
    local -a pipeline_parts
    local pipe_index
    IFS='|' read -ra pipeline_parts <<< "$pipe_scan"
    for ((pipe_index = 1; pipe_index < ${#pipeline_parts[@]}; pipe_index++)); do
      if is_shell_command "${pipeline_parts[$pipe_index]}"; then
        block "Pipe to shell. Download or inspect first, then run." || return $?
      fi
      if is_interpreter_command "${pipeline_parts[$pipe_index]}"; then
        block "Pipe to interpreter. Download or inspect first, then run." || return $?
      fi
    done
  fi
  if [[ "$touches_env_example" -eq 1 ]]; then
    local env_example_read_only=0
    case "$cmd_verb" in
      grep|egrep|fgrep|rg|ag|ack|cat|head|tail|less|more|wc|file|diff|printf|echo|read|ls|stat|test)
        env_example_read_only=1 ;;
      find)
        if is_find_read_only "$cmd"; then
          env_example_read_only=1
        fi ;;
      git)
        if is_git_ls_files "$cmd"; then
          env_example_read_only=1
        fi ;;
      sed)
        if ! [[ "$cmd" =~ sed[[:space:]]+-[a-zA-Z]*i || "$cmd" =~ sed[[:space:]]+--in-place ]]; then
          env_example_read_only=1
        fi ;;
    esac
    if [[ "$has_redirect" -eq 1 ]]; then
      env_example_read_only=0
    fi
    if [[ "$has_pipe" -eq 1 ]]; then
      local env_pipe_scan="${cmd_unquoted//||/__GOAT_OR__}"
      local -a env_pipeline_parts
      local env_pipe_index
      IFS='|' read -ra env_pipeline_parts <<< "$env_pipe_scan"
      for ((env_pipe_index = 1; env_pipe_index < ${#env_pipeline_parts[@]}; env_pipe_index++)); do
        if ! is_env_example_pipe_consumer_read_only "${env_pipeline_parts[$env_pipe_index]}"; then
          env_example_read_only=0
          break
        fi
      done
    fi
    if [[ "$env_example_read_only" -eq 0 ]]; then
      block ".env.example is allowed for read-only inspection only. Use an explicit file-edit approval path for changes." || return $?
    fi
  fi
  if [[ "$has_redirect" -eq 0 && "$has_pipe" -eq 0 && "$touches_secret" -eq 0 ]]; then
    case "$cmd_verb" in
      grep|egrep|fgrep|rg|ag|ack|cat|head|tail|less|more|wc|file|diff|printf|echo|read|ls|stat|test)
        return 0 ;;
      sed)
        # sed without -i/--in-place is read-only; sed -i or --in-place is a write operation
        if ! [[ "$cmd" =~ sed[[:space:]]+-[a-zA-Z]*i || "$cmd" =~ sed[[:space:]]+--in-place ]]; then
          return 0
        fi ;;
    esac
  fi

  # 1. rm -r without safe scoping (force flag is irrelevant in agent context)
  #    Block: rm -r /, rm -rf /, rm -r -f /, rm --recursive ~, rm with path traversal
  #    Allow: rm -rf ./node_modules, rm -r dist/, rm --recursive /tmp/build-*
  #    Uses cmd_normalized so sudo rm/env rm//bin/rm are caught.
  if rm_has_recursive "$cmd_normalized"; then
    # Block path traversal regardless of prefix
    if [[ "$cmd_normalized" =~ \.\. ]]; then
      block "rm -r with path traversal (..). Resolve the full path first." || return $?
    fi
    if ! rm_is_safely_scoped "$cmd_normalized"; then
      block "rm -r without safe scoping. Specify an explicit target path." || return $?
    fi
  fi

  # 3. All git push (agents must never push; the user pushes manually)
  #    Checks each pipe sub-segment after normalizing shell wrappers/prefixes.
  #    Uses the original cmd (not cmd_unquoted) so quoted -c values stay intact.
  local cmd_lower="${cmd,,}"
  local push_scan="${cmd_lower//||/__GOAT_OR__}"
  local -a pipe_parts
  IFS='|' read -ra pipe_parts <<< "$push_scan"
  for pipe_part in "${pipe_parts[@]}"; do
    local cmd_for_push
    cmd_for_push=$(normalize_git_push_candidate "$pipe_part")
    if is_git_push "$cmd_for_push"; then
      block "git push is not allowed. Ask the user to push manually." || return $?
    fi
  done

  # 7. chmod 777 (world-writable). Match against cmd_normalized so sudo chmod
  # / /bin/chmod variants are caught.
  if [[ "$cmd_normalized" =~ (^|[[:space:]])chmod([[:space:]]|$) ]] && \
     [[ "$cmd_normalized" =~ chmod[[:space:]]+([^;&|]*[[:space:]])?0?777([[:space:]]|$) ]]; then
    block "chmod 777 sets world-writable permissions. Use a more restrictive mode." || return $?
  fi

  # 8. Pipe-to-shell (curl|bash, wget|sh, curl|python, etc.)
  if [[ "$cmd" =~ (curl|wget)[^|]*\|[[:space:]]*(ba)?sh ]]; then
    block "Pipe-to-shell (curl|bash). Download first, inspect, then run." || return $?
  fi
  if [[ "$cmd" =~ (curl|wget)[^|]*\|[[:space:]]*(python|python3|node|perl|ruby) ]]; then
    block "Pipe-to-interpreter. Download first, inspect, then run." || return $?
  fi

  # 9. Secret-file access (reads AND writes)
  #    Block: any command that touches .env or .env.* (except read-only
  #    `.env.example`) / SSH/AWS/GCP credentials / .pem / .key / .pfx /
  #    credentials / .npmrc / .pypirc. settings.json Read() patterns only cover
  #    the Read tool, not Bash - so this rule is direct literal Bash-layer
  #    defence in depth.
  if [[ "$touches_secret" -eq 1 ]]; then
    block "Secret-file access ($cmd_verb). Reading or editing .env / SSH/AWS/GCP keys / credentials through the agent is an exfil risk." || return $?
  fi

  # 10/12/13. Destructive git subcommands tolerant of global flags.
  # Replaces three older greedy regexes (git[[:space:]]+.*--no-verify, etc.)
  # which both over-matched (git log --grep="--no-verify") and under-matched
  # (git -C path reset --hard left the .* greedy intact but skipped wrappers).
  # is_git_destructive walks past wrappers + global options + alias-pushes.
  if is_git_destructive "$cmd_normalized"; then
    block "Destructive git operation (--no-verify / reset --hard / clean -f). Remove the flag, stash first, or run manually." || return $?
  fi

  # 11. Lockfile direct modifications (must go through package manager)
  if [[ "$cmd" =~ (\>|\>\>|tee|sed[[:space:]]+-i)[[:space:]]+.*(package-lock\.json|pnpm-lock\.yaml|composer\.lock|Cargo\.lock|yarn\.lock) ]]; then
    block "Direct lockfile modification. Use the package manager (npm install, composer update, etc.)." || return $?
  fi

  # 14. eval and indirect execution
  if [[ "$cmd_unquoted" =~ ^eval[[:space:]] ]] || [[ "$cmd_unquoted" =~ [[:space:]]eval[[:space:]] ]]; then
    block "eval hides commands from safety checks. Write the command directly." || return $?
  fi
  # bash -c / sh -c: recurse into the -c argument instead of blanket-blocking, so
  # xargs ... sh -c '<safe>' and similar legitimate patterns still work while
  # dangerous commands inside -c still get caught by the rest of this function.
  # Combined shell flags such as -lc still execute the -c string.
  if [[ "$cmd" =~ (^|[[:space:]])(ba)?sh([[:space:]]+-[a-zA-Z]+)*[[:space:]]+-[a-zA-Z]*c[a-zA-Z]*[[:space:]]+([\'\"])([^\'\"]*)([\'\"]) ]]; then
    local inner_c="${BASH_REMATCH[5]}"
    if [[ -n "$inner_c" ]]; then
      check_command_segments "$inner_c" $((depth + 1)) || return $?
    fi
  fi

  # 15. File truncation. Forms covered:
  #   > file              bare redirect at start of segment
  #   : > file            colon (null command) followed by redirect
  #   true > file         true builtin then redirect
  #   printf '' > file    empty printf output then redirect
  #   echo -n '' > file   empty echo then redirect
  #   foo >| file         clobber form (overrides set -C noclobber)
  #   foo >> file alone   append-to-file when LHS is a null/empty producer
  if [[ "$cmd" =~ ^[[:space:]]*\>[[:space:]] ]]; then
    block "Redirect to empty file. This truncates the target. Use a safer approach." || return $?
  fi
  # Null-command (`:` / `true`) followed by `>` or `>>` redirect. Bash ERE
  # doesn't support backrefs, so we hand-list the redirect variants.
  if [[ "$cmd_normalized" =~ ^[[:space:]]*(:|true)[[:space:]]+\>{1,2}\|?[[:space:]]*[^[:space:]\<\>] ]]; then
    block "Null-command (\`:\` / \`true\`) followed by redirect truncates the target. Use a safer approach." || return $?
  fi
  # Empty-string output via printf '' / printf "" / echo '' / echo "" / echo -n '' / echo -n "".
  if [[ "$cmd" =~ printf[[:space:]]+\'\'[[:space:]]*\>\|?[[:space:]]+[^[:space:]] ]] || \
     [[ "$cmd" =~ printf[[:space:]]+\"\"[[:space:]]*\>\|?[[:space:]]+[^[:space:]] ]] || \
     [[ "$cmd" =~ echo[[:space:]]+(-n[[:space:]]+)?\'\'[[:space:]]*\>\|?[[:space:]]+[^[:space:]] ]] || \
     [[ "$cmd" =~ echo[[:space:]]+(-n[[:space:]]+)?\"\"[[:space:]]*\>\|?[[:space:]]+[^[:space:]] ]]; then
    block "Empty-output redirect truncates the target file. Use a safer approach." || return $?
  fi
  # Bare clobber (>|) at any position outside quoted strings.
  if [[ "$cmd_unquoted" =~ \>\| ]]; then
    block "Clobber redirect (\`>|\`) overrides noclobber and truncates the target. Use a safer approach." || return $?
  fi
  if [[ "$cmd" =~ truncate[[:space:]] ]]; then
    block "truncate can destroy file contents. Verify intent before proceeding." || return $?
  fi

  # 16. Destructive database commands via CLI tools.
  # cmd_lower already case-folds. The flag side now accepts no-space attachment
  # (-e"DROP" / --eval='DROP'), inline = forms (--command=...), and the
  # mongosh --eval flag. Also catches DROP that follows a semicolon-chained
  # SELECT in the same -e/-c value.
  local cmd_db_scan="$cmd_lower"
  if [[ "$cmd_db_scan" == *\"* && "$cmd_db_scan" == *"'"* ]]; then
    cmd_db_scan=$(strip_sql_literals_inside_double_quotes "$cmd_db_scan")
  fi
  if [[ "$cmd_db_scan" =~ (^|[[:space:]])(mysql|mariadb|psql|sqlite3|mongosh|cqlsh)([[:space:]]|$) ]] && \
     [[ "$cmd_db_scan" =~ (-e|-c|--command|--eval) ]] && \
     [[ "$cmd_db_scan" =~ (drop[[:space:]]+(database|table|schema|index|view)|truncate[[:space:]]+table|delete[[:space:]]+from|\.drop[[:space:]]*\(|\.deletemany[[:space:]]*\(|\.deleteone[[:space:]]*\(|\.remove[[:space:]]*\() ]]; then
    block "Destructive database command (DROP/TRUNCATE/DELETE). Run manually with verification." || return $?
  fi
  # File-fed DB execution: psql -f, mysql < file, sqlite3 file. Ask for manual.
  if [[ "$cmd_lower" =~ (^|[[:space:]])(psql|mysql|mariadb|sqlite3|mongosh)([[:space:]]+|$).*-f[[:space:]] ]]; then
    block "File-fed database command. Inspect the SQL file and run it manually." || return $?
  fi

  # 17. npm token delete/revoke (irreversible credential destruction).
  # Normalised so `sudo npm` etc. is also caught.
  local cmd_normalized_lower="${cmd_normalized,,}"
  if [[ "$cmd_normalized_lower" =~ ^npm[[:space:]]+token[[:space:]]+(delete|revoke) ]]; then
    block "npm token delete/revoke is irreversible. Manage tokens manually via the npm website." || return $?
  fi

  # 18. Interpreter -c / -e with shell-execution primitives. Catches the
  # generated-execution bypass: python -c 'os.system(...)', node -e
  # 'require("child_process").execSync(...)', perl -e 'system(...)', etc.
  # The inner command isn't always a literal string we can re-check, so we
  # block the whole class.
  if [[ "$cmd" =~ (^|[[:space:]])(python|python2|python3|node|nodejs|deno|perl|ruby|php)([[:space:]]+-[a-zA-Z]+)*[[:space:]]+-(c|e|-eval|-execute) ]]; then
    if [[ "$cmd" =~ (os\.system|os\.popen|os\.exec|subprocess|child_process|require\([\'\"]child_process[\'\"]\)|system[[:space:]]*\(|backtick|exec[[:space:]]*\(|popen|shell_exec) ]]; then
      block "Interpreter -c/-e with shell-execution primitive. Run the destructive operation directly so the hook can review it." || return $?
    fi
  fi

  # 19. Shell stdin (here-string / here-doc) as command source. `bash <<< "git
  # push"` and here-docs feed a string into bash that's then executed without
  # the bash -c regex catching it.
  if [[ "$cmd" =~ (^|[[:space:]])(ba)?sh([[:space:]]+-[a-zA-Z]+)*[[:space:]]+\<\<\< ]] || \
     [[ "$cmd" =~ (^|[[:space:]])(ba)?sh([[:space:]]+-[a-zA-Z]+)*[[:space:]]+\<\<-?[[:space:]]*[\'\"]?[A-Za-z_] ]]; then
    block "Shell stdin (\`<<<\` / here-doc) hides commands from inspection. Run the command directly." || return $?
  fi

  # 20. Windows command processors (powershell, pwsh, cmd) with destructive
  # verbs. PowerShell + cmd.exe are case-INSENSITIVE, so all matching here
  # routes through cmd_lower (Remove-Item == REMOVE-ITEM == remove-item).
  if [[ "$cmd_lower" =~ (^|[[:space:]])(powershell|pwsh)(\.exe)?([[:space:]]+-[a-zA-Z]+)*[[:space:]]+(-c|-command|-encodedcommand) ]]; then
    if [[ "$cmd_lower" =~ (remove-item|clear-disk|format-volume|stop-computer|restart-computer|set-executionpolicy[[:space:]]+(unrestricted|bypass)) ]]; then
      block "PowerShell destructive verb. Run manually with explicit confirmation." || return $?
    fi
    # EncodedCommand is base64-encoded PowerShell - opaque to the hook.
    if [[ "$cmd_lower" =~ -encodedcommand[[:space:]]+ ]]; then
      block "PowerShell -EncodedCommand is opaque to inspection. Run the decoded command directly." || return $?
    fi
  fi
  if [[ "$cmd_lower" =~ (^|[[:space:]])cmd(\.exe)?[[:space:]]+/[ck][[:space:]]+ ]]; then
    if [[ "$cmd_lower" =~ (^|[[:space:]/\"\'])(del|erase|rmdir|rd|format)([[:space:]]|$|\.exe) ]]; then
      block "cmd.exe destructive verb (del/rmdir/rd/format). Run manually with explicit confirmation." || return $?
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
#
# Nameref contract:
#   - $1 is the NAME of a caller-local indexed array; it gets populated.
#   - The internal name (`__goat_split_out__`) is deliberately namespaced to
#     avoid bash 4.3+ circular-name-reference warnings if a caller happens to
#     use a generic name like `out` or `_out_array`. Without that, the nameref
#     would silently fail to populate and the for-loop iterates zero times,
#     meaning a chained `&& git push` would no longer be split out.
#   - Avoids the process-substitution subshell that `mapfile < <(...)` would
#     spawn (slow on Windows gitbash where each subshell is ~30ms).
split_command_segments_into() {
  local -n __goat_split_out__="$1"
  local input="$2"
  __goat_split_out__=()
  local current=""
  local char=""
  local next=""
  local in_single=0
  local in_double=0
  local escaped=0
  local i=0

  for ((i = 0; i < ${#input}; i++)); do
    char="${input:i:1}"

    if [[ "$escaped" -eq 1 ]]; then
      current+="$char"
      escaped=0
      continue
    fi

    if [[ "$in_single" -eq 0 && "$char" == "\\" ]]; then
      current+="$char"
      escaped=1
      continue
    fi

    if [[ "$in_single" -eq 0 && "$char" == '"' ]]; then
      if [[ "$in_double" -eq 1 ]]; then
        in_double=0
      else
        in_double=1
      fi
      current+="$char"
      continue
    fi

    if [[ "$in_double" -eq 0 && "$char" == "'" ]]; then
      if [[ "$in_single" -eq 1 ]]; then
        in_single=0
      else
        in_single=1
      fi
      current+="$char"
      continue
    fi

    if [[ "$in_single" -eq 0 && "$in_double" -eq 0 ]]; then
      next="${input:i+1:1}"
      if [[ "$char$next" == "&&" || "$char$next" == "||" ]]; then
        __goat_split_out__+=("$current")
        current=""
        i=$((i + 1))
        continue
      fi
      if [[ "$char" == ";" || "$char" == $'\n' ]]; then
        __goat_split_out__+=("$current")
        current=""
        continue
      fi
    fi

    current+="$char"
  done

  __goat_split_out__+=("$current")
}

if [[ "$SELF_TEST" -eq 1 ]]; then
  self_test_script_dir=$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
  self_test_script="${self_test_script_dir}/deny-dangerous.self-test.sh"
  if [[ ! -r "$self_test_script" ]]; then
    echo "Missing self-test script: $self_test_script" >&2
    exit 1
  fi
  # shellcheck source=deny-dangerous.self-test.sh
  # shellcheck disable=SC1091  # sibling file is resolved at runtime from BASH_SOURCE
  source "$self_test_script"
  run_self_test
fi

# T2.3: segment-chain cap. Enforced here (not earlier) because it depends on
# split_command_segments_into being defined. A 50+ chain triggers recursive
# checks, each running normalisation/regex sweeps. >50 segments is almost
# always either a benchmark or a payload trying to exhaust the parser.
# Uses the same quote-aware splitter the rule checks use, so semicolons
# inside quoted strings (`echo 'a;b;c;...'`) don't trip the cap.
COMMAND_POLICY=$(mask_safe_quoted_heredoc_bodies "$COMMAND")

declare -a _goat_chain_segments=()
split_command_segments_into _goat_chain_segments "$COMMAND_POLICY"
if (( ${#_goat_chain_segments[@]} > 50 )); then
  block "Command has more than 50 chained segments; review and run manually if intended."
fi
unset _goat_chain_segments

check_command_segments "$COMMAND_POLICY" 0

# --- Default: allow -----------------------------------------------------------
exit 0
