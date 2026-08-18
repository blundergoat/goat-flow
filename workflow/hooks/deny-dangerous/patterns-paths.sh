# patterns-paths.sh
#
# Protects the user's credential-bearing files from shell reads and uploads.
# Use through deny-dangerous.sh when a proposed command names paths or file operands.
# Sample files and near-miss documentation remain available for normal project work.
# This module is sourced by the dispatcher and is not executable on its own.
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

# Build a second path-only view for absolute Windows operands while preserving shell escapes elsewhere.
windows_path_scan_view() {
  local input="$1"
  local out=""
  local word=""
  local character=""
  local candidate=""
  local normalized=""
  local in_single=0
  local in_double=0
  local escaped=0
  local i=0
  local -a words=()

  for ((i = 0; i < ${#input}; i++)); do
    character="${input:i:1}"
    if [[ "$escaped" -eq 1 ]]; then
      word+="$character"
      escaped=0
      continue
    fi
    if [[ "$in_single" -eq 0 && "$character" == "\\" ]]; then
      word+="\\"
      # Outside quotes, an escaped space belongs to this token and must not create a Windows path.
      if [[ "$in_double" -eq 0 ]]; then escaped=1; fi
      continue
    fi
    if [[ "$in_double" -eq 0 && "$character" == "'" ]]; then
      if [[ "$in_single" -eq 1 ]]; then in_single=0; else in_single=1; fi
      continue
    fi
    if [[ "$in_single" -eq 0 && "$character" == '"' ]]; then
      if [[ "$in_double" -eq 1 ]]; then in_double=0; else in_double=1; fi
      continue
    fi
    if [[ "$in_single" -eq 0 && "$in_double" -eq 0 && "$character" =~ [[:space:]] ]]; then
      if [[ -n "$word" ]]; then words+=("$word"); word=""; fi
      continue
    fi
    word+="$character"
  done
  [[ -n "$word" ]] && words+=("$word")

  for word in "${words[@]}"; do
    candidate="${word##*=}"
    candidate="${candidate#@}"
    candidate="${candidate#<}"
    case "$candidate" in
      [A-Za-z]:\\* | \\\\*)
        normalized="${word//\\//}"
        out+="$normalized "
        ;;
    esac
  done
  printf '%s' "${out% }"
}

key_material_path_touch() {
  local input="$1"
  local command_verb="${CMD_VERB:-}"
  local -a words=()
  split_shell_words_into words "$input"
  local word=""
  local candidate=""
  local base=""
  local query_command_index=-1
  local query_filter_index=-1
  local -a query_data_indices=()
  local query_data_index=0
  local skip_query_data=0
  local word_index=0
  local short_bundle=""
  local short_flag=""
  local short_index=0
  local jq_bundle_uses_filter_file=0
  local jq_bundle_consumes_next=0

  # jq always has one positional filter unless -f/--from-file supplies it.
  # yq auto-detects whether a positional token is an expression or a file, so
  # only its explicit --expression operand is safe to exempt. This conservative
  # split keeps ambiguous yq inputs and every file-valued option protected.
  if [[ "$command_verb" == "jq" || "$command_verb" == "yq" ]]; then
    for ((word_index = 0; word_index < ${#words[@]}; word_index++)); do
      base="${words[$word_index]##*/}"
      if [[ "${base,,}" == "$command_verb" ]]; then
        query_command_index="$word_index"
        break
      fi
    done

    if [[ "$query_command_index" -ge 0 && "$command_verb" == "jq" ]]; then
      word_index=$((query_command_index + 1))
      while [[ "$word_index" -lt "${#words[@]}" ]]; do
        word="${words[$word_index]}"
        case "$word" in
          --)
            query_filter_index=$((word_index + 1))
            break
            ;;
          -f|--from-file|--from-file=*)
            break
            ;;
          --arg|--argjson)
            # Variable names and literal values are data, not file operands.
            query_data_indices+=("$((word_index + 1))" "$((word_index + 2))")
            word_index=$((word_index + 3))
            continue
            ;;
          --slurpfile|--rawfile|--argsfile)
            # The variable name is data, but the following value is a file to scan.
            query_data_indices+=("$((word_index + 1))")
            word_index=$((word_index + 3))
            continue
            ;;
          -L)
            word_index=$((word_index + 2))
            continue
            ;;
          --indent)
            # The indentation width cannot name a file.
            query_data_indices+=("$((word_index + 1))")
            word_index=$((word_index + 2))
            continue
            ;;
          -[^-]*)
            short_bundle="${word#-}"
            jq_bundle_uses_filter_file=0
            jq_bundle_consumes_next=0
            for ((short_index = 0; short_index < ${#short_bundle}; short_index++)); do
              short_flag="${short_bundle:short_index:1}"
              case "$short_flag" in
                f)
                  jq_bundle_uses_filter_file=1
                  break
                  ;;
                L)
                  if [[ "$short_index" -eq $((${#short_bundle} - 1)) ]]; then
                    jq_bundle_consumes_next=1
                  fi
                  break
                  ;;
              esac
            done
            if [[ "$jq_bundle_uses_filter_file" -eq 1 ]]; then
              break
            fi
            if [[ "$jq_bundle_consumes_next" -eq 1 ]]; then
              word_index=$((word_index + 2))
            else
              word_index=$((word_index + 1))
            fi
            continue
            ;;
          -*)
            word_index=$((word_index + 1))
            continue
            ;;
        esac
        query_filter_index="$word_index"
        break
      done
    elif [[ "$query_command_index" -ge 0 ]]; then
      for ((word_index = query_command_index + 1; word_index < ${#words[@]}; word_index++)); do
        word="${words[$word_index]}"
        case "$word" in
          --expression)
            if [[ $((word_index + 1)) -lt "${#words[@]}" ]]; then
              query_filter_index=$((word_index + 1))
            fi
            break
            ;;
          --expression=*)
            query_filter_index="$word_index"
            break
            ;;
        esac
      done
    fi
  fi

  for ((word_index = 0; word_index < ${#words[@]}; word_index++)); do
    [[ "$word_index" -eq "$query_filter_index" ]] && continue
    skip_query_data=0
    for query_data_index in "${query_data_indices[@]}"; do
      if [[ "$word_index" -eq "$query_data_index" ]]; then
        skip_query_data=1
        break
      fi
    done
    [[ "$skip_query_data" -eq 1 ]] && continue
    word="${words[$word_index]}"
    candidate="${word#*=}"
    candidate="${candidate#*:}"
    candidate="${candidate,,}"
    base="${candidate##*/}"
    if [[ "$base" =~ ^[^.].*\.(pem|key|pfx)$ ]]; then
      return 0
    fi
  done
  return 1
}

# Decide whether text names a protected credential file or directory.
# Use for direct operands after command-specific parsers reveal their file meaning.
is_secret_path_touch() {
  local c windows_path_view
  c=$(strip_shell_quotes_for_path_scan "$1")
  windows_path_view=$(windows_path_scan_view "$1")
  if [[ -n "$windows_path_view" ]]; then
    c+=" $windows_path_view"
  fi
  # Fast path: only spawn sed if .env.example is even mentioned. The sed below
  # masks .env.example so the subsequent .env regex doesn't false-match.
  local env_scan="$c"
  if [[ "$c" == *.env* ]]; then
    # shellcheck disable=SC2001  # multi-pattern ERE with capture groups
    env_scan=$(sed -E \
      "s#(^|[[:space:]=:/'\"])\\.env\\.example([[:space:]]|$|['\"])#\\1__goat_env_example__\\2#g; s#(>|>>|>\\|)[[:space:]]*(['\"]?)\\.env\\.example([[:space:]]|$|['\"])#\\1\\2__goat_env_example__\\3#g; s#(^|[[:space:]=/'\"])([A-Za-z]):\\.env[a-zA-Z0-9_.-]*([[:space:]]|$|['\"])#\\1\\2:__goat_drive_relative_env__\\3#g" \
      <<<"$c")
  fi
  if [[ "$env_scan" =~ (^|[[:space:]]|=|:|/|[\'\"])\.env[a-zA-Z0-9_.-]*([[:space:]]|$|[\'\"]) ]]; then return 0; fi
  if [[ "$env_scan" =~ (\>|\>\>|\>\|)[[:space:]]*[\'\"]?\.env[a-zA-Z0-9_.-]*([[:space:]]|$|[\'\"]) ]]; then return 0; fi
  local secret_directory_re='(^|[[:space:]]|=|:|/|['\''"])(\.ssh|\.aws|\.config/gcloud|\.gnupg|secrets)(/|[[:space:]]|$|['\''"])'
  # Exact directory operands matter because users usually copy a whole key store without a slash.
  if [[ "$c" =~ $secret_directory_re ]]; then return 0; fi
  local secret_config_file_re='(^|[[:space:]]|=|:|/|['\''"])(\.docker/config\.json|\.kube/config)([[:space:]]|$|['\''"])'
  # Exact client config files contain credentials even though their parent directories are ordinary.
  if [[ "$c" =~ $secret_config_file_re ]]; then return 0; fi
  if [[ "$c" =~ application_default_credentials\.json ]]; then return 0; fi
  if key_material_path_touch "$1"; then return 0; fi
  if [[ "$c" =~ (^|[[:space:]]|=|:|/|[\'\"])(credentials|\.npmrc|\.pypirc)([[:space:]]|$|\.|[\'\"]) ]]; then return 0; fi
  return 1
}

# Decide whether one curl option value makes curl read a protected local file.
# Use after option parsing so literal `--data-raw @name` text is not mistaken for a file read.
curl_file_reference_touches_secret() {
  local curl_operand_kind="$1"
  local curl_option_value="$2"
  local referenced_file=""

  case "$curl_operand_kind" in
    data)
      # Data options read a file only when the value begins with curl's at-file marker.
      [[ "$curl_option_value" == @* ]] || return 1
      referenced_file="${curl_option_value#@}"
      ;;
    data-urlencode)
      # URL-encoding reads a file after either `@` or a `name@` prefix.
      [[ "$curl_option_value" == *@* ]] || return 1
      referenced_file="${curl_option_value#*@}"
      ;;
    form)
      local form_value="$curl_option_value"
      # A named form field keeps its file marker after the first equals sign.
      if [[ "$form_value" == *=* ]]; then
        form_value="${form_value#*=}"
      fi
      # Curl form values use either at-file or less-than-file syntax.
      [[ "$form_value" == @* || "$form_value" == \<* ]] || return 1
      referenced_file="${form_value:1}"
      referenced_file="${referenced_file%%;*}"
      ;;
    direct)
      referenced_file="$curl_option_value"
      ;;
    *)
      return 1
      ;;
  esac

  # An empty reference gives curl no protected filename to read.
  [[ -n "$referenced_file" ]] || return 1
  is_secret_path_touch "$referenced_file"
}

# Inspect curl options that read local files before sending or configuring a request.
# Use so users cannot upload a credential through option grammar that hides the path boundary.
curl_file_operands_touch_secret() {
  local developer_command
  developer_command=$(normalize_command_candidate "$1")
  local -a curl_words=()
  split_shell_words_into curl_words "$developer_command"

  # A valid curl command needs a command word before option parsing can begin.
  [[ "${#curl_words[@]}" -gt 0 ]] || return 1
  # Other network clients keep their own policy and are not parsed as curl.
  [[ "${curl_words[0]##*/}" == "curl" ]] || return 1

  local curl_word_index=1
  local curl_word=""
  local curl_option_value=""
  # Walk every option because one request can combine safe data with a protected file operand.
  while [[ "$curl_word_index" -lt "${#curl_words[@]}" ]]; do
    curl_word="${curl_words[$curl_word_index]}"
    curl_option_value=""
    case "$curl_word" in
      -d|--data|--data-ascii|--data-binary)
        curl_word_index=$((curl_word_index + 1))
        curl_option_value="${curl_words[$curl_word_index]:-}"
        # A protected at-file value would expose local credentials to the request target.
        if curl_file_reference_touches_secret data "$curl_option_value"; then return 0; fi
        ;;
      -d?*)
        curl_option_value="${curl_word#-d}"
        # Attached short data options use the same at-file meaning.
        if curl_file_reference_touches_secret data "$curl_option_value"; then return 0; fi
        ;;
      --data=*|--data-ascii=*|--data-binary=*)
        curl_option_value="${curl_word#*=}"
        # Attached long data options use the same at-file meaning.
        if curl_file_reference_touches_secret data "$curl_option_value"; then return 0; fi
        ;;
      --data-urlencode)
        curl_word_index=$((curl_word_index + 1))
        curl_option_value="${curl_words[$curl_word_index]:-}"
        # URL-encoded at-file values also make curl read a local file.
        if curl_file_reference_touches_secret data-urlencode "$curl_option_value"; then return 0; fi
        ;;
      --data-urlencode=*)
        curl_option_value="${curl_word#*=}"
        # Attached URL-encoding values preserve the same file-reference grammar.
        if curl_file_reference_touches_secret data-urlencode "$curl_option_value"; then return 0; fi
        ;;
      -F|--form)
        curl_word_index=$((curl_word_index + 1))
        curl_option_value="${curl_words[$curl_word_index]:-}"
        # Form fields may name a protected upload after either equals or the marker itself.
        if curl_file_reference_touches_secret form "$curl_option_value"; then return 0; fi
        ;;
      -F?*)
        curl_option_value="${curl_word#-F}"
        # Attached short form fields preserve the same file-reference grammar.
        if curl_file_reference_touches_secret form "$curl_option_value"; then return 0; fi
        ;;
      --form=*)
        curl_option_value="${curl_word#*=}"
        # Attached long form fields preserve the same file-reference grammar.
        if curl_file_reference_touches_secret form "$curl_option_value"; then return 0; fi
        ;;
      -T|--upload-file|-K|--config)
        curl_word_index=$((curl_word_index + 1))
        curl_option_value="${curl_words[$curl_word_index]:-}"
        # Upload and config options always interpret their operand as a local file.
        if curl_file_reference_touches_secret direct "$curl_option_value"; then return 0; fi
        ;;
      -T?*|-K?*)
        curl_option_value="${curl_word:2}"
        # Attached short upload and config options preserve the direct-file meaning.
        if curl_file_reference_touches_secret direct "$curl_option_value"; then return 0; fi
        ;;
      --upload-file=*|--config=*)
        curl_option_value="${curl_word#*=}"
        # Attached long upload and config options preserve the direct-file meaning.
        if curl_file_reference_touches_secret direct "$curl_option_value"; then return 0; fi
        ;;
      --data-raw|--form-string)
        # These options keep at-sign text literal, so skip their value without treating it as a file.
        curl_word_index=$((curl_word_index + 1))
        ;;
    esac
    curl_word_index=$((curl_word_index + 1))
  done

  return 1
}

is_search_command_verb() {
  local verb="${1##*/}"
  case "$verb" in
    grep|egrep|fgrep|rg|ag|ack) return 0 ;;
    *) return 1 ;;
  esac
}

# Reveal a direct search command or Git grep without treating its pattern as a secret path.
secret_search_command_candidate() {
  local developer_command
  developer_command=$(normalize_command_candidate "$1")
  local direct_verb="${developer_command%%[[:space:]]*}"
  direct_verb="${direct_verb##*/}"
  if is_search_command_verb "$direct_verb"; then
    printf '%s' "$developer_command"
    return 0
  fi
  if [[ "$direct_verb" == "git" ]] && __goat_git_strip_globals "$developer_command" && \
    [[ "$__goat_git_rest" =~ ^grep([[:space:]]|$) ]]; then
    printf '%s' "$__goat_git_rest"
    return 0
  fi
  return 1
}

# Remove only Git log search data while retaining every option and path operand for secret scanning.
git_log_candidate_without_search_values() {
  local developer_command
  developer_command=$(normalize_command_candidate "$1")
  __goat_git_strip_globals "$developer_command" || return 1

  local -a words=()
  split_shell_words_into words "$developer_command"

  # Locate the subcommand through the shared Git-global parser's exact suffix,
  # but retain the original words so global path operands remain protected.
  local subcommand_index=-1
  local suffix=""
  local i=1
  while [[ "$i" -lt "${#words[@]}" ]]; do
    suffix=$(join_shell_words_from words "$i")
    if [[ "$suffix" == "$__goat_git_rest" ]]; then
      subcommand_index="$i"
      break
    fi
    i=$((i + 1))
  done
  [[ "$subcommand_index" -ge 1 && "${words[$subcommand_index]}" == "log" ]] || return 1

  local search_value_seen=0
  local after_options=0
  local candidate=""
  for ((i = 0; i <= subcommand_index; i++)); do
    candidate+=" ${words[$i]}"
  done
  candidate="${candidate# }"
  i=$((subcommand_index + 1))
  local word=""
  while [[ "$i" -lt "${#words[@]}" ]]; do
    word="${words[$i]}"
    if [[ "$after_options" -eq 1 ]]; then
      candidate+=" $word"
      i=$((i + 1))
      continue
    fi
    case "$word" in
      --)
        after_options=1
        candidate+=" $word"
        i=$((i + 1))
        ;;
      -S|-G|--grep)
        # Missing option data is malformed Git grammar, so keep the generic fail-closed scan.
        [[ "$((i + 1))" -lt "${#words[@]}" ]] || return 1
        search_value_seen=1
        i=$((i + 2))
        ;;
      -S?*|-G?*|--grep=*)
        search_value_seen=1
        i=$((i + 1))
        ;;
      *)
        candidate+=" $word"
        i=$((i + 1))
        ;;
    esac
  done

  [[ "$search_value_seen" -eq 1 ]] || return 1
  printf '%s' "$candidate"
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

# Apply secret-path policy to one user-visible command segment.
# This gate blocks protected reads and uploads while preserving searches for quoted examples.
check_secret_segment() {
  local cmd="$1"
  cmd="$CMD_TRIMMED"

  if [[ "$HAS_REDIRECT" -eq 0 && "$HAS_PIPE" -eq 0 ]]; then
    case "$CMD_VERB" in
      echo|printf)
        return 0 ;;
    esac
  fi

  local touches_secret=0
  local search_candidate=""
  local git_log_candidate=""
  # Curl needs option-aware file parsing before the generic path scanner runs.
  if [[ "$CMD_VERB" == "curl" ]] && curl_file_operands_touch_secret "$cmd"; then
    touches_secret=1
  elif search_candidate=$(secret_search_command_candidate "$cmd"); then
    if search_file_operands_touch_secret "$search_candidate"; then
      touches_secret=1
    fi
  elif [[ "$CMD_VERB" == "git" ]] && git_log_candidate=$(git_log_candidate_without_search_values "$cmd"); then
    if is_secret_path_touch "$git_log_candidate"; then
      touches_secret=1
    fi
  else
    if is_secret_path_touch "$cmd"; then
      touches_secret=1
    fi
  fi

  # .env.example is sample material, not a secret: reads and writes are both
  # allowed. is_secret_path_touch masks the exact name, so only real .env*
  # variants reach the secret block below.

  if [[ "$touches_secret" -eq 1 ]]; then
    block "Secret-file access ($CMD_VERB). Reading or editing .env / SSH/AWS/GCP keys / credentials through the agent is an exfil risk." || return $?
  fi

  if is_unredirected_unpiped_read_only "$cmd"; then
    return 0
  fi
}
