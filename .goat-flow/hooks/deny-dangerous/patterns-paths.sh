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

    # A single input redirect opens a file even without spaces; here-strings and quoted '<' remain data.
    if [[ "$in_single" -eq 0 && "$in_double" -eq 0 && "$char" == '<' &&
          "${input:i+1:1}" != [\<\&\(] && ( "$i" -eq 0 || "${input:i-1:1}" != '<' ) ]]; then
      out+='< '
    else
      out+="$char"
    fi
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
  local input="$1"
  local c="$input"
  local windows_path_view=""
  if [[ "$input" == *\'* || "$input" == *\"* || "$input" == *\\* || "$input" == *'<'* ]]; then
    c=$(strip_shell_quotes_for_path_scan "$input")
  fi
  # Only backslash-rooted Windows operands need the secondary slash-normalized view.
  if [[ "$input" == *\\* ]]; then
    windows_path_view=$(windows_path_scan_view "$input")
  fi
  if [[ -n "$windows_path_view" ]]; then
    c+=" $windows_path_view"
  fi
  # Fast path: only spawn sed if the allowed .env.example spelling is mentioned. The sed below
  # masks .env.example so the subsequent .env regex doesn't false-match.
  # Drive-relative operands such as `C:.env` are deliberately not masked here: Windows resolves
  # them against the current directory on that drive, so they address the checkout's own
  # credential file. Only the `.env.example` spelling is exempt, on any drive.
  local env_scan="$c"
  if [[ "$c" == *.env.example* ]]; then
    # shellcheck disable=SC2001  # multi-pattern ERE with capture groups
    env_scan=$(sed -E \
      "s#(^|[[:space:]=:/'\"])\\.env\\.example([[:space:]]|$|['\"])#\\1__goat_env_example__\\2#g; s#(>|>>|>\\|)[[:space:]]*(['\"]?)\\.env\\.example([[:space:]]|$|['\"])#\\1\\2__goat_env_example__\\3#g" \
      <<<"$c")
  fi
  if [[ "$env_scan" =~ (^|[[:space:]]|=|:|/|[\'\"])\.env[a-zA-Z0-9_.-]*([[:space:]]|$|[\'\"]) ]]; then return 0; fi
  if [[ "$env_scan" =~ (\>|\>\>|\>\|)[[:space:]]*[\'\"]?\.env[a-zA-Z0-9_.-]*([[:space:]]|$|[\'\"]) ]]; then return 0; fi
  # Credential stores are dot-directories the user never edits as source, so a bare `secrets` folder is not on this list:
  # an application with a secrets page keeps `src/pages/secrets/` readable while `.ssh`, `.aws`, gcloud, and `.gnupg` stay blocked.
  local secret_directory_re='(^|[[:space:]]|=|:|/|['\''"])(\.ssh|\.aws|\.config/gcloud|\.gnupg)(/|[[:space:]]|$|['\''"])'
  # Exact directory operands matter because users usually copy a whole key store without a slash.
  if [[ "$c" =~ $secret_directory_re ]]; then return 0; fi
  local secret_config_file_re='(^|[[:space:]]|=|:|/|['\''"])(\.docker/config\.json|\.kube/config|\.netrc|\.git-credentials|\.config/gh/hosts\.yml|\.pgpass)([[:space:]]|$|['\''"])'
  # Exact client config files contain credentials even though their parent directories are ordinary.
  if [[ "$c" =~ $secret_config_file_re ]]; then return 0; fi
  if [[ "$c" =~ application_default_credentials\.json ]]; then return 0; fi
  if key_material_path_touch "$1"; then return 0; fi
  # Only the exact `credentials.json` download and the two registry auth files count; a `credentials.ts` auth provider is ordinary source.
  if [[ "$c" =~ (^|[[:space:]]|=|:|/|[\'\"])(credentials\.json|\.npmrc|\.pypirc)([[:space:]]|$|\.|[\'\"]) ]]; then return 0; fi
  return 1
}

# Split curl's inner form grammar without treating quoted delimiters as attributes or files.
split_curl_form_parts_into() {
  local -n __goat_form_parts__="$1"
  local value="$2" delimiter="$3" part="" char=""
  local quoted=0 escaped=0 i
  __goat_form_parts__=()
  for ((i = 0; i < ${#value}; i++)); do
    char="${value:i:1}"
    if [[ "$escaped" -eq 1 ]]; then
      part+="$char"
      escaped=0
      continue
    fi
    if [[ "$quoted" -eq 1 && "$char" == \\ ]]; then
      part+="$char"
      escaped=1
      continue
    fi
    if [[ "$char" == '"' ]]; then quoted=$((1 - quoted)); fi
    if [[ "$quoted" -eq 0 && "$char" == "$delimiter" ]]; then
      __goat_form_parts__+=("$part")
      part=""
    else
      part+="$char"
    fi
  done
  __goat_form_parts__+=("$part")
}

# Form uploads and per-part header files are separate file-reading operands.
curl_form_files_touch_secret() {
  local form_value="${1#*=}" part file
  local -a form_parts=() form_files=()
  split_curl_form_parts_into form_parts "$form_value" ';'
  part="${form_parts[0]}"
  if [[ "$part" == @* || "$part" == \<* ]]; then
    split_curl_form_parts_into form_files "${part:1}" ','
    for file in "${form_files[@]}"; do
      if is_secret_path_touch "$file"; then return 0; fi
    done
  fi
  # Attributes apply to literal fields too; only headers=@file reads another local file.
  for part in "${form_parts[@]:1}"; do
    part="${part#"${part%%[![:space:]]*}"}"
    if [[ "$part" == headers=@* ]] && is_secret_path_touch "${part#headers=@}"; then
      return 0
    fi
  done
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
      curl_form_files_touch_secret "$curl_option_value"
      return $?
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
      -d|--data|--data-ascii|--data-binary|--json|-H|--header|--proxy-header)
        curl_word_index=$((curl_word_index + 1))
        curl_option_value="${curl_words[$curl_word_index]:-}"
        # A protected at-file value would expose local credentials to the request target.
        if curl_file_reference_touches_secret data "$curl_option_value"; then return 0; fi
        ;;
      -d?*|-H?*)
        curl_option_value="${curl_word:2}"
        # Attached short data options use the same at-file meaning.
        if curl_file_reference_touches_secret data "$curl_option_value"; then return 0; fi
        ;;
      --data=*|--data-ascii=*|--data-binary=*|--json=*|--header=*|--proxy-header=*)
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

# GitHub CLI can print a stored credential without naming its backing file.
# Keep ordinary auth status available while rejecting its explicit token mode.
is_gh_token_disclosure() {
  local candidate
  candidate=$(normalize_command_candidate "$1")
  local xargs_payload=""
  if xargs_payload=$(strip_xargs_payload_command "$candidate"); then
    candidate="$xargs_payload"
  fi
  local -a words=()
  split_shell_words_into words "$candidate"
  [[ "${#words[@]}" -gt 0 ]] || return 1
  [[ "${words[0]##*/}" == gh ]] || return 1
  candidate=$(strip_shell_redirections "$candidate") || return 0
  split_shell_words_into words "$candidate"
  local topic_index subcommand_index topic subcommand index
  topic_index=$(gh_skip_options_index words 1)
  topic="${words[topic_index]:-}"
  [[ "${topic,,}" == auth ]] || return 1
  subcommand_index=$(gh_skip_options_index words $((topic_index + 1)))
  subcommand="${words[subcommand_index]:-}"
  case "${subcommand,,}" in
    token)
      [[ "${#words[@]}" -eq $((subcommand_index + 2)) && "${words[subcommand_index + 1]}" == --help ]] && return 1
      return 0 ;;
    status)
      for ((index = topic_index + 1; index < ${#words[@]}; index++)); do
        [[ "$index" -eq "$subcommand_index" ]] && continue
        case "${words[index]}" in
          -h|--hostname|-u|--user) index=$((index + 1)) ;;
          -t|-t=*|--show-token|--show-token=*) return 0 ;;
        esac
      done
      ;;
    git-credential)
      [[ "${words[subcommand_index + 1]:-}" == get ]] && return 0
      ;;
  esac
  return 1
}

# Git's credential fill and helper get operations print stored passwords or tokens to stdout.
is_git_credential_disclosure() {
  local candidate
  candidate=$(normalize_command_candidate "$1")
  local xargs_payload=""
  if xargs_payload=$(strip_xargs_payload_command "$candidate"); then
    candidate="$xargs_payload"
  fi
  __goat_git_strip_globals "$candidate" || return 1
  local -a git_words=("${__goat_git_command_words[@]}")
  local word
  case "${git_words[0]:-}" in
    credential) [[ "${git_words[1]:-}" == fill ]] ;;
    credential-*)
      for word in "${git_words[@]:1}"; do
        [[ "$word" == get ]] && return 0
      done
      return 1
      ;;
    *) return 1 ;;
  esac
}

# Separate file-opening redirections from arguments without interpreting quoted operators or here-string data as paths.
# Unsupported compound syntax keeps the caller's original command under the generic secret scan.
split_secret_redirections_into() {
  local -n secret_words_ref="$1" secret_redirects_ref="$2"
  local input="$3" word="" character quote="" escaped=0 redirect=0 i
  secret_words_ref=()
  secret_redirects_ref=()
  for ((i = 0; i <= ${#input}; i++)); do
    character="${input:i:1}"
    if [[ "$escaped" -eq 1 ]]; then
      [[ -n "$character" ]] || return 1
      word+="$character"; escaped=0; continue
    fi
    if [[ "$quote" != "'" && "$character" == \\ ]]; then
      word+="$character"; escaped=1; continue
    fi
    if [[ -n "$quote" ]]; then
      word+="$character"
      [[ "$character" == "$quote" ]] && quote=""
      continue
    fi
    if [[ "$character" == "'" || "$character" == '"' ]]; then
      word+="$character"; quote="$character"; continue
    fi
    if [[ -z "$character" || "$character" == [[:space:]\<\>\|\&\;] ]]; then
      if [[ -n "$word" ]]; then
        if [[ "$redirect" -eq 1 ]]; then
          secret_redirects_ref+=("$word")
        elif [[ "$redirect" -eq 0 ]]; then
          # An unquoted descriptor belongs to its following redirect, not to the executable's argument list.
          if [[ "$character" != [\<\>] || ! "$word" =~ ^([0-9]+|\{[a-zA-Z_][a-zA-Z0-9_]*\})$ ]]; then
            secret_words_ref+=("$word")
          fi
        fi
        word=""; redirect=0
      fi
      if [[ "$character" == [\<\>] || "${input:i:2}" == '&>' ]]; then
        [[ "$redirect" -eq 0 ]] || return 1
        case "${input:i}" in
          '<<<'*) redirect=2; i=$((i + 2)) ;;
          '<<'*|'<('*|'>('*) return 1 ;;
          '&>>'*) redirect=1; i=$((i + 2)) ;;
          '>>'*|'>&'*|'<&'*|'<>'*|'>|'*|'&>'*) redirect=1; i=$((i + 1)) ;;
          *) redirect=1 ;;
        esac
      elif [[ "$character" == [\|\&\;] ]]; then
        return 1
      fi
    else
      word+="$character"
    fi
  done
  [[ -z "$quote" && "$redirect" -eq 0 ]]
}

# Exempt only a proven literal-output suffix; wrapper operands such as flock's lock file remain protected.
literal_output_prefix_candidate() {
  local command_text="$1" normalized prefix_count i suffix matches=1
  local -a original_words=() output_words=() normalized_words=() normalized_redirects=()
  normalized=$(normalize_command_candidate "$command_text") || return 1
  split_shell_words_into output_words "$normalized"
  [[ "${#output_words[@]}" -gt 0 ]] || return 1
  case "${output_words[0]##*/}" in printf|echo) ;; *) return 1 ;; esac
  # Shell-text wrappers can expose redirects that were quoted in the outer command.
  split_secret_redirections_into normalized_words normalized_redirects "$normalized" || return 1
  split_shell_words_into original_words "$command_text"
  prefix_count=$((${#original_words[@]} - ${#output_words[@]}))
  if [[ "$prefix_count" -ge 0 ]]; then
    for ((i = 0; i < ${#output_words[@]}; i++)); do
      [[ "${original_words[prefix_count+i]}" == "${output_words[i]}" ]] || matches=0
    done
  else
    matches=0
  fi
  if [[ "$matches" -eq 0 ]]; then
    # watch and parallel join their command arguments as shell text rather than forwarding argv.
    prefix_count=-1
    for ((i = 0; i < ${#original_words[@]}; i++)); do
      suffix=$(join_shell_words_from original_words "$i")
      if [[ "$suffix" == "$normalized" ]]; then prefix_count="$i"; break; fi
    done
    [[ "$prefix_count" -ge 0 ]] || return 1
  fi
  for ((i = 0; i < prefix_count; i++)); do
    # Environment assignments supply data to the literal producer; wrapper path options remain inspectable.
    [[ "${original_words[i]}" =~ ^[a-zA-Z_][a-zA-Z0-9_]*= ]] || printf '%q ' "${original_words[i]}"
  done
  printf '%s ' "${normalized_redirects[@]}"
}

# Apply secret-path policy to one user-visible command segment.
# This gate blocks protected reads and uploads while preserving searches for quoted examples.
check_secret_segment() {
  local cmd="$1"
  cmd="$CMD_TRIMMED"

  # prepare_segment_context already checked every real stage and propagated provider denials.
  # Scanning the combined pipeline again would turn literal producer data into file operands.
  if [[ "$HAS_PIPE" -eq 1 ]]; then
    local -a secret_pipeline_stages=()
    split_top_level_pipeline_stages_into secret_pipeline_stages "$cmd"
    [[ "${#secret_pipeline_stages[@]}" -gt 1 ]] && return 0
  fi
  local -a secret_command_words=() secret_redirect_words=()
  local secret_command_text="$cmd" redirect_paths="" literal_prefix=""
  local touches_secret=0
  if [[ "$CMD_VERB" == echo || "$CMD_VERB" == printf || "$cmd" == *'<'* || "$cmd" == *'>'* ]] &&
     split_secret_redirections_into secret_command_words secret_redirect_words "$cmd"; then
    printf -v secret_command_text '%s ' "${secret_command_words[@]}"
    printf -v redirect_paths '%s ' "${secret_redirect_words[@]}"
    if is_secret_path_touch "$redirect_paths"; then
      touches_secret=1
    elif literal_prefix=$(literal_output_prefix_candidate "$secret_command_text"); then
      if is_secret_path_touch "$literal_prefix"; then touches_secret=1; else return 0; fi
    fi
  fi

  if is_gh_token_disclosure "$cmd"; then
    block "GitHub authentication token output exposes a stored credential to the agent. Use gh auth status without token display." || return $?
  fi
  if is_git_credential_disclosure "$cmd"; then
    block "Git credential output exposes stored passwords or tokens to the agent. Use git config --get credential.helper or request sanitized status." || return $?
  fi

  local search_candidate=""
  local git_log_candidate=""
  # Curl needs option-aware file parsing before the generic path scanner runs.
  if [[ "$CMD_VERB" == "curl" ]] && curl_file_operands_touch_secret "$cmd"; then
    touches_secret=1
  # Ordered-letter globs are deliberate supersets: shell quotes or escapes can
  # split the visible grep/log spelling, but cannot remove those ordered letters.
  elif { is_search_command_verb "$CMD_VERB" ||
          [[ "$CMD_VERB" == "git" && "$CMD_NORMALIZED" == *g*r*e*p* ]]; } &&
       search_candidate=$(secret_search_command_candidate "$cmd"); then
    if search_file_operands_touch_secret "$search_candidate"; then
      touches_secret=1
    fi
  elif [[ "$CMD_VERB" == "git" && "$CMD_NORMALIZED" == *l*o*g* ]] &&
       git_log_candidate=$(git_log_candidate_without_search_values "$cmd"); then
    if is_secret_path_touch "$git_log_candidate"; then
      touches_secret=1
    fi
  else
    if is_secret_path_touch "$secret_command_text"; then
      touches_secret=1
    fi
  fi

  # .env.example is sample material, not a secret: reads and writes are both
  # allowed. is_secret_path_touch masks the exact name, so only real .env*
  # variants reach the secret block below.

  if [[ "$touches_secret" -eq 1 ]]; then
    block "Secret-file access ($CMD_VERB). Reading or editing .env / SSH/AWS/GCP keys / credentials through the agent is an exfil risk. Use a checked-in example or ask the user for sanitized fields." || return $?
  fi

  if is_unredirected_unpiped_read_only "$cmd"; then
    return 0
  fi
}
