#!/usr/bin/env bash
# shellcheck disable=SC2034,SC2317,SC2319

# deny-dangerous.sh
#
# Single goat-flow PreToolUse guardrail dispatcher. It contains the shared
# payload parser/normalizer and sources policy modules from the committed
# .goat-flow/hook-lib/ store, then runs destructive-shell, secret-path, and
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

deny_dangerous_json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "$value"
}

deny_dangerous_unavailable() {
  local detail="$1"
  local message payload escaped
  message="deny-dangerous.sh cannot start: $detail. Re-run goat-flow setup so .goat-flow/hook-lib is installed and tracked."
  payload="$(cat || true)"
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

resolve_goat_flow_root() {
  local gcd
  gcd="$(git rev-parse --git-common-dir 2>/dev/null)" || return 1
  case "$gcd" in
    /*) dirname "$gcd" ;;
    *) git rev-parse --show-toplevel ;;
  esac
}

GOAT_FLOW_ROOT="$(resolve_goat_flow_root)" || deny_dangerous_unavailable "git repository root unavailable"
GOAT_HOOK_LIB_DIR="$GOAT_FLOW_ROOT/.goat-flow/hook-lib"

read_payload() {
  if [[ -n "$CHECK_COMMAND" ]]; then
    printf '%s' "$CHECK_COMMAND"
    return
  fi
  cat || true
}

json_value() {
  local payload="$1"
  local expr="$2"
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$payload" | jq -r "$expr // empty" 2>/dev/null || true
  fi
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
  local tool_pattern='"(toolName|tool_name|name)"[[:space:]]*:[[:space:]]*"([^"]+)"'
  tool="$(json_value "$payload" '.toolName // .tool_name // .toolCall.name')"
  if [[ -z "$tool" && "$payload" =~ $tool_pattern ]]; then
    tool="${BASH_REMATCH[2]}"
  fi
  printf '%s' "$tool"
}

extract_command_text() {
  local payload="$1"
  local command=""
  local file_path=""
  local command_pattern='"(command|CommandLine|commandLine|input)"[[:space:]]*:[[:space:]]*"([^"]+)"'
  local path_pattern='"(file_path|path|AbsolutePath|TargetFile|FilePath|SearchPath)"[[:space:]]*:[[:space:]]*"([^"]+)"'
  if [[ -n "$CHECK_COMMAND" ]]; then
    printf '%s' "$CHECK_COMMAND"
    return
  fi
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
      .file_path
    ] | map(select(type == "string" and length > 0)) | first
  ')"
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
  local strip_tabs=0
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
      strip_tabs=0
      [[ "${BASH_REMATCH[1]}" == "<<-" ]] && strip_tabs=1
      delimiter="${BASH_REMATCH[2]}"
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

block() {
  local reason="$1"
  case "$OUTPUT_MODE" in
    copilot-json)
      printf '{"permissionDecision":"deny","permissionDecisionReason":"%s"}
' "$(json_escape "Guard ${GOAT_ACTIVE_GUARD_SCOPE:-$GOAT_GUARD_SCOPE}: $reason")"
      exit 0
      ;;
    antigravity-json)
      printf '{"decision":"deny","reason":"%s"}
' "$(json_escape "Guard ${GOAT_ACTIVE_GUARD_SCOPE:-$GOAT_GUARD_SCOPE}: $reason")"
      exit 0
      ;;
    *)
      printf 'BLOCKED: Guard %s: %s
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

  if [ "$depth" -gt 3 ]; then
    block "Deeply nested command substitution. Simplify the command." || return $?
  fi

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
      check_command_segments "$inner_c" $((depth + 1)) || return $?
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

  for nested_segment in "${nested_segments[@]}"; do
    nested_segment="${nested_segment#"${nested_segment%%[![:space:]]*}"}"
    nested_segment="${nested_segment%"${nested_segment##*[![:space:]]}"}"
    [[ -z "$nested_segment" ]] && continue
    check_segment "$nested_segment" "$depth" || return $?
  done
}

main() {
  OUTPUT_MODE="stderr-exit"
  SELF_TEST_MODE=""
  CHECK_COMMAND=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --self-test)
        SELF_TEST_MODE="smoke"
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

  local payload structured_input payload_trimmed tool_name command command_policy
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
    tool_name="$(extract_tool_name "$payload")"
    command="$(extract_command_text "$payload")"
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
    if [[ "$structured_input" -eq 1 ]] && { [[ -z "$tool_name" ]] || tool_is_shell_command "$tool_name"; }; then
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
    deny_dangerous_unavailable "missing required hook-lib file $GOAT_HOOK_LIB_DIR/$required_hook_lib_file"
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
