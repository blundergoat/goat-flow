#!/usr/bin/env bash
# shellcheck disable=SC2034,SC2317,SC2319

# deny-dangerous.sh
# goat-flow-hook-version: 1.11.0
#
# Single goat-flow PreToolUse guardrail dispatcher. It contains the shared
# payload parser/normalizer and sources policy modules from the committed
# .goat-flow/hooks/deny-dangerous/ store, then runs destructive-shell, secret-path, and
# repository-write checks in one process.

set -uo pipefail

if (( BASH_VERSINFO[0] < 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] < 4) )); then
  echo "deny-dangerous.sh requires bash 4.4+ (got ${BASH_VERSION:-unknown}). On macOS install Homebrew bash and invoke /usr/local/bin/bash or /opt/homebrew/bin/bash explicitly." >&2
  exit 2
fi

GOAT_GUARD_NAME="deny-dangerous.sh"
GOAT_GUARD_SCOPE="deny-dangerous"
GOAT_GUARD_SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
GOAT_HOOK_LIB_DIR=""
GOAT_REQUIRED_HOOK_POLICY_FILES=(
  "patterns-shell.sh"
  "patterns-paths.sh"
  "patterns-writes.sh"
)
GOAT_DENY_DANGEROUS_ORIGINAL_ARGS=("$@")

deny_dangerous_json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "$value"
}

deny_dangerous_startup_payload_available() {
  local arg
  for arg in "${GOAT_DENY_DANGEROUS_ORIGINAL_ARGS[@]}"; do
    case "$arg" in
      --self-test|--self-test=*|--check|--check=*)
        return 1
        ;;
    esac
  done
  [[ ! -t 0 ]]
}

deny_dangerous_unavailable() {
  local detail="$1"
  local message payload escaped
  message="Policy hook unavailable: deny-dangerous.sh cannot start: $detail. Re-run goat-flow setup so .goat-flow/hooks/deny-dangerous is installed and tracked."
  payload=""
  if deny_dangerous_startup_payload_available; then
    payload="$(cat || true)"
  fi
  escaped="$(deny_dangerous_json_escape "$message")"
  if [[ "$payload" == *'"toolName"'* && "$payload" != *'"tool_name"'* ]]; then
    printf '{"permissionDecision":"deny","permissionDecisionReason":"%s"}\n' "$escaped"
    exit 0
  fi
  if [[ "$payload" == *'"toolCall"'* ]]; then
    printf '{"decision":"deny","reason":"%s"}\n' "$escaped"
    exit 0
  fi
  printf '%s\n' "$message" >&2
  exit 2
}

goat_policy_store_is_valid() {
  local root="$1"
  local policy_dir="$root/.goat-flow/hooks/deny-dangerous"
  local required_hook_lib_file
  [[ -n "$root" && -d "$policy_dir" ]] || return 1
  for required_hook_lib_file in "${GOAT_REQUIRED_HOOK_POLICY_FILES[@]}"; do
    [[ -r "$policy_dir/$required_hook_lib_file" ]] || return 1
  done
  return 0
}

resolve_goat_flow_root_from_git() {
  local top_level
  top_level="$(git rev-parse --show-toplevel 2>/dev/null)" || return 1
  [[ -n "$top_level" ]] || return 1
  printf '%s\n' "$top_level"
}

resolve_goat_flow_root_from_script_path() {
  local script_dir="$GOAT_GUARD_SCRIPT_DIR"
  local candidate=""
  case "$script_dir" in
    */.goat-flow/hooks|*/workflow/hooks)
      candidate="$(CDPATH='' cd -- "$script_dir/../.." && pwd)" || return 1
      ;;
    *)
      return 1
      ;;
  esac
  goat_policy_store_is_valid "$candidate" || return 1
  printf '%s\n' "$candidate"
}

resolve_goat_flow_root() {
  local root
  if root="$(resolve_goat_flow_root_from_git)"; then
    printf '%s\n' "$root"
    return 0
  fi
  resolve_goat_flow_root_from_script_path
}

GOAT_FLOW_ROOT="$(resolve_goat_flow_root)" || deny_dangerous_unavailable "git repository root unavailable and script path does not locate a valid policy store"
GOAT_HOOK_LIB_DIR="$GOAT_FLOW_ROOT/.goat-flow/hooks/deny-dangerous"

read_payload() {
  if [[ -n "$CHECK_COMMAND" ]]; then
    printf '%s' "$CHECK_COMMAND"
    return
  fi
  cat || true
}

jq_available() {
  [[ "${GOAT_DENY_FORCE_NO_JQ:-}" != "1" ]] && command -v jq >/dev/null 2>&1
}

json_value() {
  local payload="$1"
  local expr="$2"
  if jq_available; then
    printf '%s' "$payload" | jq -r "$expr // empty" 2>/dev/null || true
  fi
}

json_fallback_string_value() {
  local payload="$1"
  local key_re="$2"
  awk -v key_re="^(${key_re})$" '
    function parse_string(pos,    out, c, esc) {
      out = ""
      esc = 0
      for (; pos <= n; pos += 1) {
        c = substr(s, pos, 1)
        if (esc == 1) {
          if (c == "\"" || c == "\\" || c == "/") out = out c
          else if (c == "b") out = out "\b"
          else if (c == "f") out = out "\f"
          else if (c == "n") out = out "\n"
          else if (c == "r") out = out "\r"
          else if (c == "t") out = out "\t"
          else {
            parse_error = 1
            return 0
          }
          esc = 0
          continue
        }
        if (c == "\\") {
          esc = 1
          continue
        }
        if (c == "\"") {
          parsed = out
          return pos + 1
        }
        out = out c
      }
      parse_error = 1
      return 0
    }

    { s = s $0 "\n" }
    END {
      if (length(s) > 0) s = substr(s, 1, length(s) - 1)
      n = length(s)
      for (i = 1; i <= n; i += 1) {
        if (substr(s, i, 1) != "\"") continue
        next_pos = parse_string(i + 1)
        if (parse_error == 1) exit 2
        key = parsed
        i = next_pos
        while (i <= n && substr(s, i, 1) ~ /[[:space:]]/) i += 1
        if (substr(s, i, 1) != ":") continue
        i += 1
        while (i <= n && substr(s, i, 1) ~ /[[:space:]]/) i += 1
        if (substr(s, i, 1) != "\"") continue
        value_pos = parse_string(i + 1)
        if (parse_error == 1) exit 2
        if (key ~ key_re) {
          print parsed
          exit 0
        }
        i = value_pos
      }
      exit 3
    }
  ' <<<"$payload"
}

json_fallback_nested_string_value() {
  local payload="$1"
  local key_re="$2"
  local value=""
  local status=0
  if value="$(json_fallback_string_value "$payload" "$key_re")"; then
    printf '%s' "$value"
    return 0
  else
    status=$?
    [[ "$status" -eq 2 ]] && return 2
  fi

  local nested_key nested=""
  for nested_key in toolArgs tool_args; do
    if nested="$(json_fallback_string_value "$payload" "$nested_key")"; then
      if value="$(json_fallback_string_value "$nested" "$key_re")"; then
        printf '%s' "$value"
        return 0
      else
        status=$?
        [[ "$status" -eq 2 ]] && return 2
      fi
    else
      status=$?
      [[ "$status" -eq 2 ]] && return 2
    fi
  done

  return 3
}

detect_output_mode() {
  local payload="$1"
  if [[ "$payload" == *'"toolName"'* && "$payload" != *'"tool_name"'* ]]; then
    printf 'copilot-json'
    return
  fi
  if [[ "$payload" == *'"toolCall"'* ]]; then
    printf 'antigravity-json'
    return
  fi
  printf 'stderr-exit'
}

extract_tool_name() {
  local payload="$1"
  local tool=""
  local fallback_status=0
  local unsafe=0
  local tool_pattern='"(toolName|tool_name|name)"[[:space:]]*:[[:space:]]*"([^"]+)"'
  tool="$(json_value "$payload" '.toolName // .tool_name // .toolCall.name')"
  if [[ -z "$tool" ]] && ! jq_available; then
    fallback_status=0
    tool="$(json_fallback_nested_string_value "$payload" 'toolName|tool_name|name')" || fallback_status=$?
    if [[ "$fallback_status" -ne 0 ]]; then
      [[ "$fallback_status" -eq 2 ]] && unsafe=1
      tool=""
    fi
  fi
  if [[ -z "$tool" && "$payload" =~ $tool_pattern ]]; then
    tool="${BASH_REMATCH[2]}"
  fi
  printf '%s' "$tool"
  [[ "$unsafe" -eq 1 ]] && return 2
  return 0
}

extract_command_text() {
  local payload="$1"
  local command=""
  local file_path=""
  local fallback_status=0
  local unsafe=0
  local command_pattern='"(command|CommandLine|commandLine|input)"[[:space:]]*:[[:space:]]*"([^"]+)"'
  local path_pattern='"(file_path|path|AbsolutePath|TargetFile|FilePath|SearchPath)"[[:space:]]*:[[:space:]]*"([^"]+)"'
  if [[ -n "$CHECK_COMMAND" ]]; then
    printf '%s' "$CHECK_COMMAND"
    return
  fi
  if jq_available; then
    command="$(json_value "$payload" '
      def extract_command(value):
        if value == null then empty
        elif (value | type) == "object" then (value.command // value.CommandLine // value.commandLine // value.input // empty)
        elif (value | type) == "string" then
          ((value | fromjson? // {}) | if type == "object" then (.command // .CommandLine // .commandLine // .input // empty) else empty end)
        else empty end;
      [
        .tool_input.command,
        .toolCall.args.CommandLine,
        .toolCall.args.command,
        .toolCall.args.commandLine,
        .toolCall.args.input,
        .command,
        .input,
        extract_command(.toolArgs),
        extract_command(.tool_args)
      ] | map(select(type == "string" and length > 0)) | first
    ')"
    file_path="$(json_value "$payload" '
      def extract_path(value):
        if value == null then empty
        elif (value | type) == "object" then (value.file_path // value.path // value.AbsolutePath // value.TargetFile // value.FilePath // value.SearchPath // empty)
        elif (value | type) == "string" then
          ((value | fromjson? // {}) | if type == "object" then (.file_path // .path // .AbsolutePath // .TargetFile // .FilePath // .SearchPath // empty) else empty end)
        else empty end;
      [
        .tool_input.file_path,
        .tool_input.path,
        .toolCall.args.AbsolutePath,
        .toolCall.args.TargetFile,
        .toolCall.args.FilePath,
        .toolCall.args.SearchPath,
        .toolCall.args.path,
        .toolCall.args.file_path,
        .path,
        .file_path,
        extract_path(.toolArgs),
        extract_path(.tool_args)
      ] | map(select(type == "string" and length > 0)) | first
    ')"
  else
    fallback_status=0
    command="$(json_fallback_nested_string_value "$payload" 'command|CommandLine|commandLine|input')" || fallback_status=$?
    if [[ "$fallback_status" -ne 0 ]]; then
      [[ "$fallback_status" -eq 2 ]] && unsafe=1
      command=""
    fi
    fallback_status=0
    file_path="$(json_fallback_nested_string_value "$payload" 'file_path|path|AbsolutePath|TargetFile|FilePath|SearchPath')" || fallback_status=$?
    if [[ "$fallback_status" -ne 0 ]]; then
      [[ "$fallback_status" -eq 2 ]] && unsafe=1
      file_path=""
    fi
  fi
  if [[ -z "$command" && "$payload" =~ $command_pattern ]]; then
    command="${BASH_REMATCH[2]}"
  fi
  if [[ -z "$file_path" && "$payload" =~ $path_pattern ]]; then
    file_path="${BASH_REMATCH[2]}"
  fi
  if [[ -n "$file_path" && "$command" != *"$file_path"* ]]; then
    command="${command} ${file_path}"
  fi
  printf '%s' "${command# }"
  [[ "$unsafe" -eq 1 ]] && return 2
  return 0
}

json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '%s' "$s"
}

tool_is_shell_command() {
  local tool_lc="${1,,}"
  case "$tool_lc" in
    bash|shell|sh|run_command) return 0 ;;
    *) return 1 ;;
  esac
}

tool_is_secret_file_operation() {
  local tool_lc="${1,,}"
  case "$tool_lc" in
    read|view|view_file|write|edit|multiedit|write_to_file|replace_file_content|multi_replace_file_content) return 0 ;;
    *) return 1 ;;
  esac
}

goat_first_word_is_inert() {
  # A command that treats the heredoc body as data, or runs it as its OWN
  # (non-shell) language - never as shell commands. Keep this list conservative:
  # anything NOT listed (a shell, xargs/parallel, source/., read/mapfile, a control
  # keyword, ssh, or any unknown command) makes the masker leave the body
  # inspectable. NB the interpreters/clients here still execute the body AS THEIR
  # OWN LANGUAGE (python `os.system`, sed `e`, awk `system()`, sql `\!`/`.shell`) -
  # a deliberately accepted scope limit: deny-dangerous guards SHELL, not
  # interpreter languages, the same reason `python - <<X` is not inspected.
  # Some data consumers can persist or exfiltrate the body (`tee`, mail tools);
  # that is outside this single-shell-command guard's scope.
  case "$1" in
    cat|tac|tee|head|tail|sort|uniq|wc|nl|rev|cut|tr|fold|fmt|column|paste|join|comm|expand|unexpand|strings|iconv|\
    base64|base32|xxd|hexdump|od|md5sum|sha1sum|sha256sum|sha512sum|cksum|\
    grep|egrep|fgrep|rg|ag|sed|gsed|awk|gawk|mawk|nawk|jq|yq|xq|mlr|\
    python|python2|python3|php|node|nodejs|deno|ruby|perl|lua|\
    psql|mysql|mariadb|sqlite3|mongosh|mongo|redis-cli|cqlsh|duckdb|\
    echo|printf|true|false|:|mail|mailx|sendmail|less|more)
      return 0 ;;
  esac
  return 1
}

heredoc_command_list_is_inert() {
  local scan segment first inner match ps_re substitution_count iterations
  local -a segs=()

  # Strip quoted spans first (so a shell NAME used as data is not read as a
  # command, and a quoted delimiter/pipe does not split).
  # shellcheck disable=SC2001  # regex strip of quoted spans, not a glob
  scan=$(printf '%s' "$1" | sed -E "s/'[^']*'//g; s/\"[^\"]*\"//g")

  # Process substitutions route the body to/from their inner command: `cat >
  # >(bash)`, `tee >(bash)` feed the heredoc body straight into that command's
  # stdin. The `;&|` split below never looks inside `>(...)`/`<(...)`, so classify
  # the whole inner command list here; `>(printf ''; bash)` is not inert even
  # though its first command is. Replace each checked substitution with a token so
  # the loop terminates and the leftover never confuses the segment split.
  substitution_count="$(count_substitution_openers "$scan")"
  (( substitution_count > 32 )) && return 1
  ps_re='[<>]\(([^()]*)\)'
  iterations=0
  while [[ "$scan" =~ $ps_re ]]; do
    iterations=$((iterations + 1))
    (( iterations > 32 )) && return 1
    match="${BASH_REMATCH[0]}"
    inner="${BASH_REMATCH[1]}"
    heredoc_command_list_is_inert "$inner" || return 1
    scan="${scan/"$match"/ __goat_ps__ }"
  done

  # Break the pipeline on every command separator ; & | and inspect each leading
  # command word.
  scan="${scan//$'\n'/;}"
  IFS=';&|' read -ra segs <<< "$scan"
  (( ${#segs[@]} > 0 )) || return 1
  # An opener with many pipeline commands is not a simple inert-consumer pipeline;
  # refuse to mask (inspect instead). This also bounds the per-segment subshell
  # forks so a crafted `cat <<X; cat; cat; ...` opener cannot fork-DoS the masker.
  (( ${#segs[@]} > 64 )) && return 1
  for segment in "${segs[@]}"; do
    segment="${segment#"${segment%%[![:space:]]*}"}"
    [[ -z "$segment" ]] && continue
    first=$(first_word_base "$(normalize_command_candidate "$segment")")
    goat_first_word_is_inert "$first" || return 1
  done
  return 0
}

heredoc_body_is_inert() {
  # SAFE BY DEFAULT. Mask a quoted heredoc body (hide it from chain-counting and
  # content checks) ONLY when EVERY command in the opener's pipeline - including
  # every command in any process-substitution target - is a known NON-shell
  # consumer. Anything else - a shell, an `xargs`/`parallel` dispatcher,
  # `source`/`.`, a `read`/`mapfile` variable handoff, a control keyword
  # (while/for/if/do/then/done), `ssh`, a `>(bash)` process substitution, or any
  # unrecognised command - means we do NOT mask, so the body stays inspectable and
  # an executed `rm -rf /` is caught however it is reached. The opener arrives
  # continuation-joined; its own redirects/args are still policy-checked
  # separately, so masking the body never hides a dangerous opener. Trade-off
  # (chosen deliberately): a >50-line heredoc to an unrecognised or
  # compound-wrapped consumer may trip the chain cap - a safe false positive
  # ("review and run manually"), never a bypass.
  heredoc_command_list_is_inert "$1"
}

mask_safe_quoted_heredoc_bodies() {
  local input="$1"
  local output=""
  local line=""
  local logical=""
  local delimiter=""
  local in_body=0
  local mask_body=0
  local strip_tabs=0
  local body_masked=0
  local stripped_line=""
  local single_quoted_re="(<<-?)[[:space:]]*'([^']+)'"
  local double_quoted_re='(<<-?)[[:space:]]*"([^"]+)"'

  while IFS= read -r line || [[ -n "$line" ]]; do
    if (( in_body )); then
      stripped_line="$line"
      if (( strip_tabs )); then
        while [[ "$stripped_line" == $'\t'* ]]; do
          stripped_line="${stripped_line#$'\t'}"
        done
      fi
      if [[ "$line" == "$delimiter" || "$stripped_line" == "$delimiter" ]]; then
        output+="$line"$'\n'
        in_body=0
        mask_body=0
        strip_tabs=0
        body_masked=0
        delimiter=""
      elif (( mask_body )); then
        # Collapse the whole inert body to ONE placeholder: a quoted-interpreter
        # heredoc (e.g. python - <<'PY' ... PY) is a single command argument, not
        # one chain link per line. Emitting one token per line let a body over 50
        # lines trip the 50-chained-segment cap - a false positive on ordinary
        # inline smoke scripts. Shell-fed heredocs keep mask_body=0 and fall to
        # the else branch below, so they stay emitted line by line, inspectable
        # and still counted.
        if (( ! body_masked )); then
          output+="__goat_quoted_heredoc_body__"$'\n'
          body_masked=1
        fi
      else
        output+="$line"$'\n'
      fi
      continue
    fi

    # Join bash line-continuations into one logical opener so a heredoc whose
    # pipeline/dispatcher is split across `\`<newline> (e.g. `cat <<'X' \`<nl>`|
    # bash`) is classified as a whole. A trailing `\` inside a heredoc body is
    # literal and is handled by the in_body branch above, never here.
    logical="$line"
    while [[ "$logical" =~ (^|[^\\])(\\\\)*\\$ ]]; do
      IFS= read -r line || break
      logical="${logical%\\}$line"
    done

    output+="$logical"$'\n'
    if [[ "$logical" =~ $single_quoted_re ]] || [[ "$logical" =~ $double_quoted_re ]]; then
      strip_tabs=0
      [[ "${BASH_REMATCH[1]}" == "<<-" ]] && strip_tabs=1
      delimiter="${BASH_REMATCH[2]}"
      if heredoc_body_is_inert "$logical"; then
        mask_body=1
      else
        mask_body=0
      fi
      in_body=1
      body_masked=0
    fi
  done <<< "$input"

  printf '%s' "${output%$'\n'}"
}

find_matching_shell_paren() {
  local input="$1"
  local open_index="$2"
  local depth=0
  local in_single=0
  local in_double=0
  local escaped=0
  local i=0
  local char=""

  for ((i = open_index; i < ${#input}; i++)); do
    char="${input:i:1}"

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
    if [[ "$in_single" -eq 1 || "$in_double" -eq 1 ]]; then
      continue
    fi

    if [[ "$char" == "(" ]]; then
      depth=$((depth + 1))
    elif [[ "$char" == ")" ]]; then
      depth=$((depth - 1))
      if [[ "$depth" -eq 0 ]]; then
        printf '%s\n' "$i"
        return 0
      fi
    fi
  done

  return 1
}

check_command_substitutions() {
  local remaining="$1"
  local depth="$2"
  local residual=""
  local residual_unquoted=""
  local i=0
  local close_index=""
  local char=""
  local next=""
  local next2=""
  local inner=""
  local in_single=0
  local in_double=0
  local escaped=0

  for ((i = 0; i < ${#remaining}; i++)); do
    char="${remaining:i:1}"

    if [[ "$escaped" -eq 1 ]]; then
      residual+="$char"
      escaped=0
      continue
    fi
    if [[ "$in_single" -eq 0 && "$char" == "\\" ]]; then
      residual+="$char"
      escaped=1
      continue
    fi
    if [[ "$in_double" -eq 0 && "$char" == "'" ]]; then
      if [[ "$in_single" -eq 1 ]]; then
        in_single=0
      else
        in_single=1
      fi
      residual+="$char"
      continue
    fi
    if [[ "$in_single" -eq 0 && "$char" == '"' ]]; then
      if [[ "$in_double" -eq 1 ]]; then
        in_double=0
      else
        in_double=1
      fi
      residual+="$char"
      continue
    fi

    if [[ "$in_single" -eq 0 ]]; then
      next="${remaining:i+1:1}"
      next2="${remaining:i+2:1}"
      if [[ "$char$next" == "\$(" && "$next2" == "(" ]]; then
        if close_index="$(find_matching_shell_paren "$remaining" $((i + 1)))"; then
          inner="${remaining:i+3:close_index-i-3}"
          check_command_substitutions "$inner" "$depth" || return $?
          residual+="__goat_arith__"
          i="$close_index"
          continue
        fi
      elif [[ "$char$next" == "\$(" ]]; then
        if close_index="$(find_matching_shell_paren "$remaining" $((i + 1)))"; then
          inner="${remaining:i+2:close_index-i-2}"
          if [[ -n "$inner" ]]; then
            check_command_segments "$inner" $((depth + 1)) || return $?
          fi
          residual+="__goat_subst__"
          i="$close_index"
          continue
        fi
      elif [[ "$in_double" -eq 0 && ( "$char$next" == '<(' || "$char$next" == '>(' ) ]]; then
        if close_index="$(find_matching_shell_paren "$remaining" $((i + 1)))"; then
          inner="${remaining:i+2:close_index-i-2}"
          if [[ -n "$inner" ]]; then
            check_command_segments "$inner" $((depth + 1)) || return $?
          fi
          residual+="__goat_proc_subst__"
          i="$close_index"
          continue
        fi
      fi
    fi

    residual+="$char"
  done

  residual_unquoted="$residual"
  if [[ "$residual" == *\'* ]]; then
    # shellcheck disable=SC2001  # ERE pattern; parameter expansion uses globs
    residual_unquoted=$(sed -E "s/'[^']*'//g" <<<"$residual")
  fi

  if [[ "$residual_unquoted" =~ \$\( || "$residual_unquoted" =~ [\<\>]\( ]]; then
    block "Complex command substitution. Write the expanded command directly." || return $?
  fi

  local remaining_unquoted="$remaining"
  if [[ "$remaining" == *\'* ]]; then
    # shellcheck disable=SC2001  # ERE pattern; parameter expansion uses globs
    remaining_unquoted=$(sed -E "s/'[^']*'//g" <<<"$remaining")
  fi
  remaining_unquoted="${remaining_unquoted//\\\`/}"

  if [[ "$remaining_unquoted" == *\`* ]]; then
    block "Backtick command substitution hides nested execution. Use a direct command instead, or for an inline script run it from a file (e.g. node script.js)." || return $?
  fi
}

first_word_base() {
  local c="${1#"${1%%[![:space:]]*}"}"
  local word="${c%%[[:space:]]*}"
  printf '%s' "${word##*/}"
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

join_shell_words_from() {
  local -n __goat_words_join_ref__="$1"
  local start_index="$2"
  local out=""
  local i
  for ((i = start_index; i < ${#__goat_words_join_ref__[@]}; i++)); do
    out+="${__goat_words_join_ref__[$i]} "
  done
  printf '%s' "${out% }"
}

__goat_git_strip_globals() {
  __goat_git_aliased_push=0
  __goat_git_rest=""
  local c="$1"
  c=$(normalize_leading_command_word "$c")

  local -a words=()
  split_shell_words_into words "$c"
  [[ "${#words[@]}" -gt 0 ]] || return 1

  local command_base="${words[0]##*/}"
  [[ "$command_base" == "git" ]] || return 1

  local i=1
  local opt=""
  local val=""
  while [[ "$i" -lt "${#words[@]}" ]]; do
    opt="${words[$i]}"
    case "$opt" in
      --)
        i=$((i + 1))
        break
        ;;
      -c|-C|--git-dir|--work-tree|--namespace|--exec-path|--config-env)
        val="${words[$((i + 1))]:-}"
        if [[ "$opt" == "-c" && "$val" =~ ^alias\.[a-zA-Z0-9_-]+=[\'\"]?(push|!) ]]; then
          __goat_git_aliased_push=1
        fi
        i=$((i + 2))
        continue
        ;;
      -c?*)
        val="${opt#-c}"
        if [[ "$val" =~ ^alias\.[a-zA-Z0-9_-]+=[\'\"]?(push|!) ]]; then
          __goat_git_aliased_push=1
        fi
        i=$((i + 1))
        continue
        ;;
      -C?*|--git-dir=*|--work-tree=*|--namespace=*|--exec-path=*|--config-env=*)
        i=$((i + 1))
        continue
        ;;
      --no-pager|--paginate|--bare|--literal-pathspecs|--glob-pathspecs|--noglob-pathspecs|--icase-pathspecs|--help|--version|--html-path|--man-path|--info-path)
        i=$((i + 1))
        continue
        ;;
      -*)
        i=$((i + 1))
        continue
        ;;
    esac
    break
  done

  local rest=""
  while [[ "$i" -lt "${#words[@]}" ]]; do
    rest+="${words[$i]} "
    i=$((i + 1))
  done
  __goat_git_rest="${rest% }"
  return 0
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

word_starts_with_redirection() {
  local redirection_re='^([0-9]+)?[<>]'
  [[ "$1" =~ $redirection_re ]]
}

normalize_exec_prefix() {
  local c="$1"
  local -a words=()
  split_shell_words_into words "$c"
  local i=0
  local word=""
  while [[ "$i" -lt "${#words[@]}" ]]; do
    word="${words[$i]}"
    case "$word" in
      --)
        i=$((i + 1))
        break
        ;;
      -a)
        [[ $((i + 1)) -lt "${#words[@]}" ]] || return 1
        i=$((i + 2))
        continue
        ;;
      -*)
        if [[ "$word" =~ ^-[cl]+$ ]]; then
          i=$((i + 1))
          continue
        fi
        return 1
        ;;
    esac
    break
  done
  [[ "$i" -lt "${#words[@]}" ]] || return 1
  word="${words[$i]}"
  word_starts_with_redirection "$word" && return 1
  join_shell_words_from words "$i"
}

normalize_timeout_prefix() {
  local c="$1"
  local -a words=()
  split_shell_words_into words "$c"
  local i=0
  local word=""
  while [[ "$i" -lt "${#words[@]}" ]]; do
    word="${words[$i]}"
    case "$word" in
      --)
        i=$((i + 1))
        break
        ;;
      -s|-k|--signal|--kill-after)
        [[ $((i + 1)) -lt "${#words[@]}" ]] || return 1
        i=$((i + 2))
        continue
        ;;
      --signal=*|--kill-after=*|-s?*|-k?*)
        i=$((i + 1))
        continue
        ;;
      --preserve-status|--foreground|--verbose|-v)
        i=$((i + 1))
        continue
        ;;
      --help|--version)
        return 1
        ;;
      -*)
        return 1
        ;;
    esac
    break
  done
  [[ "$i" -lt "${#words[@]}" ]] || return 1
  i=$((i + 1)) # DURATION
  [[ "$i" -lt "${#words[@]}" ]] || return 1
  join_shell_words_from words "$i"
}

normalize_setsid_prefix() {
  local c="$1"
  local -a words=()
  split_shell_words_into words "$c"
  local i=0
  local word=""
  while [[ "$i" -lt "${#words[@]}" ]]; do
    word="${words[$i]}"
    case "$word" in
      --)
        i=$((i + 1))
        break
        ;;
      --ctty|--fork|--wait)
        i=$((i + 1))
        continue
        ;;
      --help|--version)
        return 1
        ;;
      -*)
        if [[ "$word" =~ ^-[cfw]+$ ]]; then
          i=$((i + 1))
          continue
        fi
        return 1
        ;;
    esac
    break
  done
  [[ "$i" -lt "${#words[@]}" ]] || return 1
  join_shell_words_from words "$i"
}

normalize_stdbuf_prefix() {
  local c="$1"
  local -a words=()
  split_shell_words_into words "$c"
  local i=0
  local word=""
  while [[ "$i" -lt "${#words[@]}" ]]; do
    word="${words[$i]}"
    case "$word" in
      --)
        i=$((i + 1))
        break
        ;;
      -i|-o|-e|--input|--output|--error)
        [[ $((i + 1)) -lt "${#words[@]}" ]] || return 1
        i=$((i + 2))
        continue
        ;;
      -i?*|-o?*|-e?*|--input=*|--output=*|--error=*)
        i=$((i + 1))
        continue
        ;;
      --help|--version)
        return 1
        ;;
      -*)
        return 1
        ;;
    esac
    break
  done
  [[ "$i" -lt "${#words[@]}" ]] || return 1
  join_shell_words_from words "$i"
}

normalize_ionice_prefix() {
  local c="$1"
  local -a words=()
  split_shell_words_into words "$c"
  local i=0
  local word=""
  while [[ "$i" -lt "${#words[@]}" ]]; do
    word="${words[$i]}"
    case "$word" in
      --)
        i=$((i + 1))
        break
        ;;
      -p|--pid|-p?*|--pid=*)
        return 1
        ;;
      -c|-n|--class|--classdata)
        [[ $((i + 1)) -lt "${#words[@]}" ]] || return 1
        i=$((i + 2))
        continue
        ;;
      -c?*|-n?*|--class=*|--classdata=*|-t|--ignore)
        i=$((i + 1))
        continue
        ;;
      --help|--version)
        return 1
        ;;
      -*)
        return 1
        ;;
    esac
    break
  done
  [[ "$i" -lt "${#words[@]}" ]] || return 1
  join_shell_words_from words "$i"
}

normalize_taskset_prefix() {
  local c="$1"
  local -a words=()
  split_shell_words_into words "$c"
  local i=0
  local word=""
  while [[ "$i" -lt "${#words[@]}" ]]; do
    word="${words[$i]}"
    case "$word" in
      --)
        i=$((i + 1))
        break
        ;;
      -p|--pid|-p?*|--pid=*)
        return 1
        ;;
      -a|--all-tasks|-c|--cpu-list)
        i=$((i + 1))
        continue
        ;;
      --help|--version)
        return 1
        ;;
      -*)
        return 1
        ;;
    esac
    break
  done
  [[ "$i" -lt "${#words[@]}" ]] || return 1
  i=$((i + 1)) # CPU mask/list
  [[ "$i" -lt "${#words[@]}" ]] || return 1
  join_shell_words_from words "$i"
}

normalize_chrt_prefix() {
  local c="$1"
  local -a words=()
  split_shell_words_into words "$c"
  local i=0
  local word=""
  while [[ "$i" -lt "${#words[@]}" ]]; do
    word="${words[$i]}"
    case "$word" in
      --)
        i=$((i + 1))
        break
        ;;
      -p|--pid|-p?*|--pid=*)
        return 1
        ;;
      -f|-r|-o|-b|-i|-d|--fifo|--rr|--other|--batch|--idle|--deadline|--reset-on-fork|-R)
        i=$((i + 1))
        continue
        ;;
      -T|-P|-D|--sched-runtime|--sched-period|--sched-deadline)
        [[ $((i + 1)) -lt "${#words[@]}" ]] || return 1
        i=$((i + 2))
        continue
        ;;
      -T?*|-P?*|-D?*|--sched-runtime=*|--sched-period=*|--sched-deadline=*)
        i=$((i + 1))
        continue
        ;;
      --max|-m|--help|--version)
        return 1
        ;;
      -*)
        return 1
        ;;
    esac
    break
  done
  [[ "$i" -lt "${#words[@]}" ]] || return 1
  i=$((i + 1)) # priority
  [[ "$i" -lt "${#words[@]}" ]] || return 1
  join_shell_words_from words "$i"
}

normalize_flock_prefix() {
  local c="$1"
  local -a words=()
  split_shell_words_into words "$c"
  local i=0
  local word=""
  while [[ "$i" -lt "${#words[@]}" ]]; do
    word="${words[$i]}"
    case "$word" in
      --)
        i=$((i + 1))
        break
        ;;
      -c|--command)
        [[ $((i + 1)) -lt "${#words[@]}" ]] || return 1
        printf '%s' "${words[$((i + 1))]}"
        return 0
        ;;
      -c?*)
        printf '%s' "${word#-c}"
        return 0
        ;;
      --command=*)
        printf '%s' "${word#--command=}"
        return 0
        ;;
      -E|-w|--conflict-exit-code|--timeout)
        [[ $((i + 1)) -lt "${#words[@]}" ]] || return 1
        i=$((i + 2))
        continue
        ;;
      -E?*|-w?*|--conflict-exit-code=*|--timeout=*)
        i=$((i + 1))
        continue
        ;;
      -s|-x|-n|-u|-o|-F|--shared|--exclusive|--nb|--nonblock|--unlock|--close|--no-fork|--verbose)
        i=$((i + 1))
        continue
        ;;
      --help|--version)
        return 1
        ;;
      -*)
        return 1
        ;;
    esac
    break
  done
  [[ "$i" -lt "${#words[@]}" ]] || return 1
  if [[ "${words[$i]}" =~ ^[0-9]+$ && $((i + 1)) -ge "${#words[@]}" ]]; then
    return 1
  fi
  i=$((i + 1)) # lock file/dir or fd
  [[ "$i" -lt "${#words[@]}" ]] || return 1
  if [[ "${words[$i]}" == "-c" || "${words[$i]}" == "--command" ]]; then
    [[ $((i + 1)) -lt "${#words[@]}" ]] || return 1
    printf '%s' "${words[$((i + 1))]}"
    return 0
  fi
  join_shell_words_from words "$i"
}

normalize_command_candidate() {
  local c="$1"
  local stripped=""
  local word=""
  local base=""
  local after_word=""
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
    after_word="${c#"$word"}"
    after_word="${after_word#"${after_word%%[![:space:]]*}"}"
    case "$base" in
      exec)
        if stripped=$(normalize_exec_prefix "$after_word"); then
          c="$stripped"
          continue
        fi
        ;;
      timeout)
        if stripped=$(normalize_timeout_prefix "$after_word"); then
          c="$stripped"
          continue
        fi
        ;;
      setsid)
        if stripped=$(normalize_setsid_prefix "$after_word"); then
          c="$stripped"
          continue
        fi
        ;;
      stdbuf)
        if stripped=$(normalize_stdbuf_prefix "$after_word"); then
          c="$stripped"
          continue
        fi
        ;;
      ionice)
        if stripped=$(normalize_ionice_prefix "$after_word"); then
          c="$stripped"
          continue
        fi
        ;;
      taskset)
        if stripped=$(normalize_taskset_prefix "$after_word"); then
          c="$stripped"
          continue
        fi
        ;;
      chrt)
        if stripped=$(normalize_chrt_prefix "$after_word"); then
          c="$stripped"
          continue
        fi
        ;;
      flock)
        if stripped=$(normalize_flock_prefix "$after_word"); then
          c="$stripped"
          continue
        fi
        ;;
    esac
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
  local subst_depth=0
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
      # Command/process substitution openers ( $(  <(  >( ) start a no-split
      # region: control operators inside them are not top-level chain
      # separators. check_command_substitutions recurses into the interior, so
      # those operators are still policy-checked at the correct level. Plain
      # (...) subshells are deliberately NOT tracked here - they are not
      # recursed into elsewhere, so they must stay splittable to avoid a
      # (cmd && rm -rf /) bypass.
      if [[ "$next" == '(' && ( "$char" == '$' || "$char" == '<' || "$char" == '>' ) ]]; then
        current+="$char$next"
        subst_depth=$((subst_depth + 1))
        i=$((i + 1))
        continue
      fi
      if [[ "$subst_depth" -gt 0 ]]; then
        if [[ "$char" == '(' ]]; then
          subst_depth=$((subst_depth + 1))
        elif [[ "$char" == ')' ]]; then
          subst_depth=$((subst_depth - 1))
        fi
        current+="$char"
        continue
      fi
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

block() {
  local reason="$1"
  case "$OUTPUT_MODE" in
    copilot-json)
      printf '{"permissionDecision":"deny","permissionDecisionReason":"%s"}
' "$(json_escape "Policy ${GOAT_ACTIVE_GUARD_SCOPE:-$GOAT_GUARD_SCOPE}: $reason")"
      exit 0
      ;;
    antigravity-json)
      printf '{"decision":"deny","reason":"%s"}
' "$(json_escape "Policy ${GOAT_ACTIVE_GUARD_SCOPE:-$GOAT_GUARD_SCOPE}: $reason")"
      exit 0
      ;;
    *)
      printf 'BLOCKED: Policy %s: %s
' "${GOAT_ACTIVE_GUARD_SCOPE:-$GOAT_GUARD_SCOPE}" "$reason" >&2
      exit 2
      ;;
  esac
}

allow() {
  if [[ "$OUTPUT_MODE" == "antigravity-json" ]]; then
    printf '{"decision":"allow"}
'
  fi
  exit 0
}

strip_unquoted_shell_comments() {
  local input="$1"
  local out=""
  local char=""
  local previous=""
  local in_single=0
  local in_double=0
  local escaped=0
  local i=0

  for ((i = 0; i < ${#input}; i++)); do
    char="${input:i:1}"

    if [[ "$escaped" -eq 1 ]]; then
      out+="$char"
      escaped=0
      previous="$char"
      continue
    fi

    if [[ "$in_single" -eq 0 && "$char" == "\\" ]]; then
      out+="$char"
      escaped=1
      previous="$char"
      continue
    fi

    if [[ "$in_double" -eq 0 && "$char" == "'" ]]; then
      if [[ "$in_single" -eq 1 ]]; then
        in_single=0
      else
        in_single=1
      fi
      out+="$char"
      previous="$char"
      continue
    fi

    if [[ "$in_single" -eq 0 && "$char" == '"' ]]; then
      if [[ "$in_double" -eq 1 ]]; then
        in_double=0
      else
        in_double=1
      fi
      out+="$char"
      previous="$char"
      continue
    fi

    if [[ "$in_single" -eq 0 && "$in_double" -eq 0 && "$char" == "#" ]]; then
      if [[ -z "$previous" || "$previous" =~ [[:space:]] ]]; then
        break
      fi
    fi

    out+="$char"
    previous="$char"
  done

  out="${out%"${out##*[![:space:]]}"}"
  printf '%s' "$out"
}

prepare_segment_context() {
  local cmd="$1"
  local depth="${2:-0}"
  local policy_cmd
  local saved_cmd_trimmed saved_cmd_normalized saved_cmd_verb saved_cmd_unquoted saved_cmd_lower
  local saved_has_redirect saved_has_pipe

  policy_cmd=$(strip_unquoted_shell_comments "$cmd")
  check_command_substitutions "$policy_cmd" "$depth" || return $?

  CMD_TRIMMED="${policy_cmd#"${policy_cmd%%[![:space:]]*}"}"
  CMD_NORMALIZED=$(normalize_command_candidate "$CMD_TRIMMED")
  CMD_VERB="${CMD_NORMALIZED%%[[:space:]]*}"
  CMD_VERB="${CMD_VERB##*/}"

  CMD_UNQUOTED="$policy_cmd"
  if [[ "$policy_cmd" == *"'"* || "$policy_cmd" == *'"'* ]]; then
    # shellcheck disable=SC2001  # ERE alternation; parameter expansion uses globs
    CMD_UNQUOTED=$(sed -E "s/'[^']*'//g; s/\"[^\"]*\"//g" <<<"$policy_cmd")
  fi

  CMD_LOWER="${policy_cmd,,}"
  HAS_REDIRECT=0
  HAS_PIPE=0
  local redirect_append_re='(^|[^=])[0-9]*>>'
  local redirect_clobber_re='(^|[^=])[0-9]*>\|'
  local redirect_space_re='(^|[^=])[0-9]*>[[:space:]]'
  local redirect_word_re='(^|[^=])[0-9]*>[^[:space:]|=]'
  [[ "$CMD_UNQUOTED" =~ $redirect_append_re || "$CMD_UNQUOTED" =~ $redirect_clobber_re || "$CMD_UNQUOTED" =~ $redirect_space_re || "$CMD_UNQUOTED" =~ $redirect_word_re ]] && HAS_REDIRECT=1
  local pipe_stripped="${CMD_UNQUOTED//||/}"
  [[ "$pipe_stripped" == *"|"* ]] && HAS_PIPE=1

  local shell_c_re="(^|[[:space:]])(ba)?sh([[:space:]]+-[a-zA-Z]+)*[[:space:]]+-[a-zA-Z]*c[a-zA-Z]*[[:space:]]+(['\"])([^'\"]*)(['\"])"
  if [[ "$policy_cmd" =~ $shell_c_re ]]; then
    local inner_c="${BASH_REMATCH[5]}"
    if [[ -n "$inner_c" ]]; then
      saved_cmd_trimmed="$CMD_TRIMMED"
      saved_cmd_normalized="$CMD_NORMALIZED"
      saved_cmd_verb="$CMD_VERB"
      saved_cmd_unquoted="$CMD_UNQUOTED"
      saved_cmd_lower="$CMD_LOWER"
      saved_has_redirect="$HAS_REDIRECT"
      saved_has_pipe="$HAS_PIPE"
      check_command_segments "$inner_c" $((depth + 1)) || return $?
      CMD_TRIMMED="$saved_cmd_trimmed"
      CMD_NORMALIZED="$saved_cmd_normalized"
      CMD_VERB="$saved_cmd_verb"
      CMD_UNQUOTED="$saved_cmd_unquoted"
      CMD_LOWER="$saved_cmd_lower"
      HAS_REDIRECT="$saved_has_redirect"
      HAS_PIPE="$saved_has_pipe"
    fi
  fi
}

is_unredirected_unpiped_read_only() {
  local cmd="$1"
  [[ "$HAS_REDIRECT" -eq 0 && "$HAS_PIPE" -eq 0 ]] || return 1
  case "$CMD_VERB" in
    grep|egrep|fgrep|rg|ag|ack|cat|head|tail|less|more|wc|file|diff|printf|echo|read|ls|stat|test)
      return 0 ;;
    sed)
      if ! [[ "$cmd" =~ sed[[:space:]]+-[a-zA-Z]*i || "$cmd" =~ sed[[:space:]]+--in-place ]]; then
        return 0
      fi ;;
  esac
  return 1
}

check_command_segments() {
  local input="$1"
  local depth="${2:-0}"
  local -a nested_segments=()
  local nested_segment

  if declare -F check_command_chain_policy >/dev/null 2>&1; then
    check_command_chain_policy "$input" "$depth" || return $?
  fi

  split_command_segments_into nested_segments "$input"

  # Substitution interiors stay intact through split_command_segments_into and
  # are recursed into here, so enforce the chain-count cap at nested depths too
  # (depth 0 is already capped in main).
  if (( depth > 0 && ${#nested_segments[@]} > 50 )); then
    block "Command has more than 50 chained segments; review and run manually if intended." || return $?
  fi

  for nested_segment in "${nested_segments[@]}"; do
    nested_segment="${nested_segment#"${nested_segment%%[![:space:]]*}"}"
    nested_segment="${nested_segment%"${nested_segment##*[![:space:]]}"}"
    [[ -z "$nested_segment" ]] && continue
    check_segment "$nested_segment" "$depth" || return $?
  done
}

count_substitution_openers() {
  local input="$1"
  local count=0
  local i ch next next2
  local in_single=0
  local in_double=0
  local escaped=0
  for ((i = 0; i < ${#input}; i += 1)); do
    ch="${input:i:1}"
    if [[ "$escaped" -eq 1 ]]; then
      escaped=0
      continue
    fi
    if [[ "$in_single" -eq 0 && "$ch" == "\\" ]]; then
      escaped=1
      continue
    fi
    if [[ "$in_double" -eq 0 && "$ch" == "'" ]]; then
      if [[ "$in_single" -eq 1 ]]; then
        in_single=0
      else
        in_single=1
      fi
      continue
    fi
    if [[ "$in_single" -eq 0 && "$ch" == '"' ]]; then
      if [[ "$in_double" -eq 1 ]]; then
        in_double=0
      else
        in_double=1
      fi
      continue
    fi
    [[ "$in_single" -eq 1 ]] && continue
    next="${input:i+1:1}"
    next2="${input:i+2:1}"
    if [[ "$ch$next" == "\$(" ]]; then
      if [[ "$next2" != '(' ]]; then
        count=$((count + 1))
      fi
    elif [[ "$ch$next" == '<(' || "$ch$next" == '>(' ]]; then
      count=$((count + 1))
    fi
  done
  printf '%s\n' "$count"
}

main() {
  OUTPUT_MODE="stderr-exit"
  SELF_TEST_MODE=""
  CHECK_COMMAND=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --self-test)
        SELF_TEST_MODE="full"
        ;;
      --self-test=*)
        SELF_TEST_MODE="${1#--self-test=}"
        ;;
      --check=*)
        CHECK_COMMAND="${1#--check=}"
        ;;
      --check)
        shift
        CHECK_COMMAND="${1:-}"
        ;;
      *)
        if [[ -z "$CHECK_COMMAND" ]]; then
          CHECK_COMMAND="$1"
        fi
        ;;
    esac
    shift || true
  done

  local script_dir
  script_dir="${GOAT_GUARD_SCRIPT_DIR:-$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)}"
  if [[ -n "$SELF_TEST_MODE" ]]; then
    GOAT_DENY_DANGEROUS_HOOK="${BASH_SOURCE[0]}" exec bash "$GOAT_HOOK_LIB_DIR/deny-dangerous-self-test.sh" "--self-test=$SELF_TEST_MODE"
  fi

  local payload structured_input payload_trimmed tool_name command command_policy extraction_status
  JSON_EXTRACTION_UNSAFE=0
  payload="$(read_payload)"
  structured_input=0
  payload_trimmed="${payload#"${payload%%[![:space:]]*}"}"
  if [[ -z "$CHECK_COMMAND" && "$payload_trimmed" == \{* ]]; then
    structured_input=1
    OUTPUT_MODE="$(detect_output_mode "$payload")"
  fi

  tool_name=""
  command=""
  if [[ "$structured_input" -eq 1 ]]; then
    extraction_status=0
    tool_name="$(extract_tool_name "$payload")" || extraction_status=$?
    [[ "$extraction_status" -eq 2 ]] && JSON_EXTRACTION_UNSAFE=1
    extraction_status=0
    command="$(extract_command_text "$payload")" || extraction_status=$?
    [[ "$extraction_status" -eq 2 ]] && JSON_EXTRACTION_UNSAFE=1
    if [[ "$JSON_EXTRACTION_UNSAFE" -eq 1 ]]; then
      if [[ -z "$tool_name" ]] || tool_is_shell_command "$tool_name" || tool_is_secret_file_operation "$tool_name"; then
        block "Hook payload contains unsupported JSON escapes. Fail closed and rerun with jq installed or a simpler payload."
      fi
    fi
    if [[ -n "$tool_name" ]]; then
      if ! tool_is_shell_command "$tool_name"; then
        if { [[ "$GOAT_GUARD_SCOPE" == "secret" ]] || [[ "$GOAT_GUARD_NAME" == "deny-dangerous.sh" ]]; } && tool_is_secret_file_operation "$tool_name"; then
          :
        else
          allow
        fi
      fi
    fi
  else
    command="$payload"
  fi

  if [[ -z "$command" ]]; then
    if [[ "$structured_input" -eq 1 ]] && { [[ -z "$tool_name" ]] || tool_is_shell_command "$tool_name" || tool_is_secret_file_operation "$tool_name"; }; then
      block "Hook payload did not expose a bash command to evaluate"
    fi
    allow
  fi

  if (( ${#command} > 16384 )); then
    block "Command exceeds 16KB; review and run manually if intended."
  fi

  command_policy="$(mask_safe_quoted_heredoc_bodies "$command")"

  declare -a _goat_chain_segments=()
  split_command_segments_into _goat_chain_segments "$command_policy"
  if (( ${#_goat_chain_segments[@]} > 50 )); then
    block "Command has more than 50 chained segments; review and run manually if intended."
  fi
  unset _goat_chain_segments

  # Cap total command/process substitution openers before the recursive
  # check_command_segments walk. Each `$(`/`<(`/`>(` triggers its own recursive
  # re-scan, so a command packed with hundreds (e.g. `cat <(:) <(:) ... <(:)`) is a
  # policy-parser DoS (~10s at 300). This flat O(len) count bounds the work;
  # real commands use a handful, so pathological input blocks ("run it manually").
  local _goat_subst_n=0
  _goat_subst_n="$(count_substitution_openers "$command_policy")"
  if (( _goat_subst_n > 32 )); then
    block "Command has too many command substitutions; review and run manually if intended."
  fi

  check_command_segments "$command_policy" 0
  allow
}

required_hook_lib_files=(
  "patterns-shell.sh"
  "patterns-paths.sh"
  "patterns-writes.sh"
)

for required_hook_lib_file in "${required_hook_lib_files[@]}"; do
  if [[ ! -r "$GOAT_HOOK_LIB_DIR/$required_hook_lib_file" ]]; then
    deny_dangerous_unavailable "missing required hook policy file $GOAT_HOOK_LIB_DIR/$required_hook_lib_file"
  fi
done

# shellcheck disable=SC1090,SC1091
source "$GOAT_HOOK_LIB_DIR/patterns-shell.sh" || deny_dangerous_unavailable "failed to load $GOAT_HOOK_LIB_DIR/patterns-shell.sh"
# shellcheck disable=SC1090,SC1091
source "$GOAT_HOOK_LIB_DIR/patterns-paths.sh" || deny_dangerous_unavailable "failed to load $GOAT_HOOK_LIB_DIR/patterns-paths.sh"
# shellcheck disable=SC1090,SC1091
source "$GOAT_HOOK_LIB_DIR/patterns-writes.sh" || deny_dangerous_unavailable "failed to load $GOAT_HOOK_LIB_DIR/patterns-writes.sh"

check_segment() {
  local cmd="$1"
  local depth="${2:-0}"
  local previous_scope="${GOAT_ACTIVE_GUARD_SCOPE-}"

  GOAT_ACTIVE_GUARD_SCOPE="destructive"
  check_destructive_segment "$cmd" "$depth" || return $?
  GOAT_ACTIVE_GUARD_SCOPE="secret"
  check_secret_segment "$cmd" "$depth" || return $?
  GOAT_ACTIVE_GUARD_SCOPE="repository"
  check_repository_segment "$cmd" "$depth" || return $?

  if [[ -n "$previous_scope" ]]; then
    GOAT_ACTIVE_GUARD_SCOPE="$previous_scope"
  else
    unset GOAT_ACTIVE_GUARD_SCOPE
  fi
}

main "$@"
