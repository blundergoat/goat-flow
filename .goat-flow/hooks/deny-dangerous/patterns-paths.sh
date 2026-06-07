# patterns-paths.sh
#
# Secret-path policy extracted from paths.sh.
# Sourced by deny-dangerous.sh; not executable on its own.
# shellcheck shell=bash disable=SC2034,SC2154,SC2317,SC2319

__goat_git_rest=""
__goat_git_aliased_push=0

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

key_material_path_touch() {
  local input="$1"
  local -a words=()
  split_shell_words_into words "$input"
  local word=""
  local candidate=""
  local base=""

  for word in "${words[@]}"; do
    candidate="${word#*=}"
    candidate="${candidate#*:}"
    candidate="${candidate,,}"
    base="${candidate##*/}"
    if [[ "$base" =~ ^[^.][^[:space:]]*\.(pem|key|pfx)$ ]]; then
      return 0
    fi
  done
  return 1
}

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
  if key_material_path_touch "$c"; then return 0; fi
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

# True only when a redirect actually writes to .env.example. A bare fd dup
# (2>&1), a stderr discard (2>/dev/null), or a redirect to some other file is
# still a read of .env.example, so those must not be treated as writes.
is_env_example_redirect_write() {
  local c
  c=$(strip_shell_quotes_for_path_scan "$1")
  # The redirect target may carry a path prefix (./ , sub/dir/ , ~/x/ , /abs/),
  # so allow an optional leading path before the .env.example basename.
  [[ "$c" =~ (\>|\>\>|\>\|)[[:space:]]*[\'\"]?([^[:space:]>|\'\"]*/)?\.env\.example([[:space:]]|$|[\'\"]) ]]
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

check_secret_segment() {
  local cmd="$1"
  local depth="${2:-0}"
  prepare_segment_context "$cmd" "$depth" || return $?
  cmd="$CMD_TRIMMED"

  if [[ "$HAS_REDIRECT" -eq 0 && "$HAS_PIPE" -eq 0 ]]; then
    case "$CMD_VERB" in
      echo|printf)
        return 0 ;;
    esac
  fi

  local touches_secret=0
  if is_search_command_verb "$CMD_VERB"; then
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

  if [[ "$touches_env_example" -eq 1 ]]; then
    local env_example_read_only=0
    case "$CMD_VERB" in
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
    if [[ "$HAS_REDIRECT" -eq 1 ]] && is_env_example_redirect_write "$cmd"; then
      env_example_read_only=0
    fi
    if [[ "$HAS_PIPE" -eq 1 ]]; then
      local env_pipe_scan="${CMD_UNQUOTED//||/__GOAT_OR__}"
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

  if [[ "$touches_secret" -eq 1 ]]; then
    block "Secret-file access ($CMD_VERB). Reading or editing .env / SSH/AWS/GCP keys / credentials through the agent is an exfil risk." || return $?
  fi

  if is_unredirected_unpiped_read_only "$cmd"; then
    return 0
  fi
}

