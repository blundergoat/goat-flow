#!/usr/bin/env bash
# shellcheck disable=SC2034,SC2154,SC2317,SC2319
# goat-flow-hook-version: 1.17.0
# Shared command parser and provider responses for the two managed policy hooks.
#
# Entry points own the immutable policy selection and bootstrap failure response.
# Use before an agent command runs so both policies inspect the same command and return the expected provider response.

# Read the proposed command or provider payload before classifying the agent action; check mode never executes its text.
read_payload() {
  # Check mode supplies explicit command text for classification; provider mode reads its payload from stdin instead.
  if [[ -n "$CHECK_COMMAND" ]]; then
    printf '%s' "$CHECK_COMMAND"
    return
  fi
  cat || true
}

# Choose full JSON decoding when jq is available; restricted installations use the conservative fallback reader.
jq_available() {
  [[ "${GOAT_DENY_FORCE_NO_JQ:-}" != "1" ]] && command -v jq >/dev/null 2>&1
}

# Read one provider field with jq; absent fields or decoding failures leave empty text for the caller to handle.
json_value() {
  local payload="$1"
  local expr="$2"
  # Full JSON decoding makes the provider field usable; without jq, leave extraction to the conservative fallback reader.
  if jq_available; then
    printf '%s' "$payload" | jq -r "$expr // empty" 2>/dev/null || true
  fi
}

# Decode a supported JSON string without jq so provider commands remain inspectable; unsupported escapes report an unsafe payload.
json_fallback_string_value() {
  local payload="$1"
  local key_re="$2"
  awk -v key_re="^(${key_re})$" '
    # Decode one JSON string so fallback field extraction preserves the proposed command and rejects unsupported escapes.
    function parse_string(pos,    out, c, esc) {
      out = ""
      esc = 0
      # Decode each payload character so escaped user command text reaches policy checks without being executed.
      for (; pos <= n; pos += 1) {
        c = substr(s, pos, 1)
        # A JSON escape changes the next character into command data; decode only the supported escape forms.
        if (esc == 1) {
          # JSON punctuation escapes preserve the command text exactly rather than adding shell syntax.
          if (c == "\"" || c == "\\" || c == "/") out = out c
          # Decode escaped backspace so provider command text reaches inspection unchanged.
          else if (c == "b") out = out "\b"
          # Decode escaped form feed so provider command text reaches inspection unchanged.
          else if (c == "f") out = out "\f"
          # Decode an escaped newline so multiline commands retain their boundaries during inspection.
          else if (c == "n") out = out "\n"
          # Decode an escaped carriage return so Windows command payloads retain their text during inspection.
          else if (c == "r") out = out "\r"
          # Decode an escaped tab so command arguments keep their original separation during inspection.
          else if (c == "t") out = out "\t"
          else {
            parse_error = 1
            return 0
          }
          esc = 0
          continue
        }
        # Remember a JSON escape before interpreting the next character as the end of the command string.
        if (c == "\\") {
          esc = 1
          continue
        }
        # The closing JSON quote completes this provider field and returns inspection to the surrounding payload.
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
      # Discard only the reader-added final newline so provider field matching sees the original payload.
      if (length(s) > 0) s = substr(s, 1, length(s) - 1)
      n = length(s)
      # Find the requested provider field among JSON strings so missing jq does not skip command inspection.
      for (i = 1; i <= n; i += 1) {
        # Only a JSON string can name a provider field; other payload characters contribute no field name.
        if (substr(s, i, 1) != "\"") continue
        next_pos = parse_string(i + 1)
        # An unsupported escape cannot establish safe command text, so report unsafe extraction to the policy gate.
        if (parse_error == 1) exit 2
        key = parsed
        i = next_pos
        # Whitespace around a provider key has no command meaning; move to its JSON separator.
        while (i <= n && substr(s, i, 1) ~ /[[:space:]]/) i += 1
        # A quoted value without a key separator is not the requested provider field and must not become command text.
        if (substr(s, i, 1) != ":") continue
        i += 1
        # Whitespace before the provider value has no command meaning; move to the actual JSON value.
        while (i <= n && substr(s, i, 1) ~ /[[:space:]]/) i += 1
        # Only string-valued fields can supply this fallback reader with command text; skip other JSON value shapes.
        if (substr(s, i, 1) != "\"") continue
        value_pos = parse_string(i + 1)
        # An unsupported value escape leaves the command uncertain, so report unsafe extraction rather than allowing it.
        if (parse_error == 1) exit 2
        # The requested key supplies the command or path used by the next policy check; unrelated fields remain unused.
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

# Read direct or JSON-encoded tool arguments without jq; missing fields stay empty, while unsupported escapes remain explicit failures.
json_fallback_nested_string_value() {
  local payload="$1"
  local key_re="$2"
  local value=""
  local status=0
  # A direct provider field already exposes the requested text, so encoded argument containers need no extra decoding.
  if value="$(json_fallback_string_value "$payload" "$key_re")"; then
    printf '%s' "$value"
    return 0
  else
    status=$?
    [[ "$status" -eq 2 ]] && return 2
  fi

  local nested_key nested=""
  # Try both provider spellings for encoded tool arguments so supported clients reach the same policy checks.
  for nested_key in toolArgs tool_args; do
    # A readable encoded argument container may hold the command that the outer payload did not expose.
    if nested="$(json_fallback_string_value "$payload" "$nested_key")"; then
      # A usable field inside encoded arguments supplies the same policy input as a direct provider field.
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

# Choose the denial channel expected by the invoking provider so its agent receives the policy result.
detect_output_mode() {
  local payload="$1"
  # Copilot expects JSON permission decisions; select that response channel before reporting a denial.
  if [[ "$payload" == *'"toolName"'* && "$payload" != *'"tool_name"'* ]]; then
    printf 'copilot-json'
    return
  fi
  # Antigravity expects its own JSON decision envelope; select it so the invoking agent receives the verdict.
  if [[ "$payload" == *'"toolCall"'* ]]; then
    printf 'antigravity-json'
    return
  fi
  printf 'stderr-exit'
}

# Identify the provider tool that requested this action; unsupported JSON escapes report unsafe extraction instead of a trusted tool name.
extract_tool_name() {
  local payload="$1"
  local tool=""
  local fallback_status=0
  local unsafe=0
  local tool_pattern='"(toolName|tool_name|name)"[[:space:]]*:[[:space:]]*"([^"]+)"'
  tool="$(json_value "$payload" '.toolName // .tool_name // .toolCall.name')"
  # Without jq and a readable tool name, decode the supported provider fields through the conservative fallback.
  if [[ -z "$tool" ]] && ! jq_available; then
    fallback_status=0
    tool="$(json_fallback_nested_string_value "$payload" 'toolName|tool_name|name')" || fallback_status=$?
    # Missing or unsafe fallback fields leave no trusted tool name; unsupported escapes also mark extraction unsafe.
    if [[ "$fallback_status" -ne 0 ]]; then
      [[ "$fallback_status" -eq 2 ]] && unsafe=1
      tool=""
    fi
  fi
  # A simple visible tool field supplies a last fallback name; unsafe extraction remains flagged for refusal.
  if [[ -z "$tool" && "$payload" =~ $tool_pattern ]]; then
    tool="${BASH_REMATCH[2]}"
  fi
  printf '%s' "$tool"
  [[ "$unsafe" -eq 1 ]] && return 2
  return 0
}

# Read the proposed command and file path across provider payload shapes; unsupported escapes report unsafe extraction for the policy gate.
extract_command_text() {
  local payload="$1"
  local command=""
  local file_path=""
  local fallback_status=0
  local unsafe=0
  local command_pattern='"(command|CommandLine|commandLine|input)"[[:space:]]*:[[:space:]]*"([^"]+)"'
  local path_pattern='"(file_path|path|AbsolutePath|TargetFile|FilePath|SearchPath)"[[:space:]]*:[[:space:]]*"([^"]+)"'
  # Explicit check mode classifies the supplied command instead of treating it as a provider JSON payload.
  if [[ -n "$CHECK_COMMAND" ]]; then
    printf '%s' "$CHECK_COMMAND"
    return
  fi
  # Full JSON decoding supports direct and encoded command arguments; installations without jq use narrower extraction.
  if jq_available; then
    command="$(json_value "$payload" '
      def extract_command(value):
        # Absent tool arguments contain no proposed command and must not produce an invented policy input.
        if value == null then empty
        # Structured arguments expose their command fields directly for the same policy checks as ordinary shell requests.
        elif (value | type) == "object" then (value.command // value.CommandLine // value.commandLine // value.input // empty)
        # Encoded argument strings need JSON decoding before their command fields can become policy input.
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
        # Absent tool arguments contain no file path and must not produce an invented secret-path target.
        if value == null then empty
        # Structured arguments expose the requested file path for the selected secret-path policy.
        elif (value | type) == "object" then (value.file_path // value.path // value.AbsolutePath // value.TargetFile // value.FilePath // value.SearchPath // empty)
        # Encoded argument strings need JSON decoding before a requested file path can become policy input.
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
    # A missing or unsupported command field leaves no trusted command; unsupported escapes also mark extraction unsafe.
    if [[ "$fallback_status" -ne 0 ]]; then
      [[ "$fallback_status" -eq 2 ]] && unsafe=1
      command=""
    fi
    fallback_status=0
    file_path="$(json_fallback_nested_string_value "$payload" 'file_path|path|AbsolutePath|TargetFile|FilePath|SearchPath')" || fallback_status=$?
    # A missing or unsupported path field leaves no trusted target; unsupported escapes also mark extraction unsafe.
    if [[ "$fallback_status" -ne 0 ]]; then
      [[ "$fallback_status" -eq 2 ]] && unsafe=1
      file_path=""
    fi
  fi
  # A simple visible command field supplies a last fallback candidate; unsafe decoding remains flagged for refusal.
  if [[ -z "$command" && "$payload" =~ $command_pattern ]]; then
    command="${BASH_REMATCH[2]}"
  fi
  # A simple visible path field supplies a last fallback target; unsafe decoding remains flagged for refusal.
  if [[ -z "$file_path" && "$payload" =~ $path_pattern ]]; then
    file_path="${BASH_REMATCH[2]}"
  fi
  # Include a separately supplied file path so a provider file action receives the same secret-path inspection as command text.
  if [[ -n "$file_path" && "$command" != *"$file_path"* ]]; then
    command="${command} ${file_path}"
  fi
  printf '%s' "${command# }"
  [[ "$unsafe" -eq 1 ]] && return 2
  return 0
}

# Escape denial text for the provider JSON response so the user receives a readable policy reason.
json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '%s' "$s"
}

# Identify provider tools that run shell commands and therefore require command-policy inspection.
tool_is_shell_command() {
  local tool_lc="${1,,}"
  case "$tool_lc" in
    bash|shell|sh|run_command) return 0 ;;
    *) return 1 ;;
  esac
}

# Identify provider file tools whose requested paths need the selected secret-path policy.
tool_is_secret_file_operation() {
  local tool_lc="${1,,}"
  case "$tool_lc" in
    read|view|view_file|write|edit|multiedit|write_to_file|replace_file_content|multi_replace_file_content) return 0 ;;
    *) return 1 ;;
  esac
}

# Recognize stdin consumers whose heredoc body this guard does not interpret as shell commands.
goat_first_word_is_inert() {
  # Only listed non-shell consumers qualify; shells, dispatchers, variable handoffs and unknown commands keep the body visible.
  #
  # Interpreter-language execution, data persistence and exfiltration remain outside this shell-policy check.
  # For example, an accepted Python heredoc still runs Python; this classification does not inspect its own-language program.
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

# Recognize report and prose commands that consume stdin as data; other Goat Flow commands keep their heredoc contents inspectable.
goat_flow_cli_consumes_heredoc_as_data() {
  local command="$1"
  local word="${command%%[[:space:]]*}"
  local base="${word##*/}"
  local arguments=""

  [[ "$base" == "goat-flow" ]] || return 1
  arguments="${command#"$word"}"
  arguments="${arguments#"${arguments%%[![:space:]]*}"}"

  # Only these three Goat Flow commands consume report or prose data on stdin.
  # Match the full command: other subcommands can change projects or launch runtimes, so Goat Flow itself is not an inert consumer.
  [[ "$arguments" =~ ^quality[[:space:]]+save([[:space:]]|$) ]] && return 0
  [[ "$arguments" =~ ^review[[:space:]]+validate([[:space:]]|$) ]] && return 0
  [[ "$arguments" =~ ^redact([[:space:]]|$) ]] && return 0
  return 1
}

# Recognize the sole larger report-data transport after masking; unrelated commands retain the ordinary inspection size limit.
large_quality_save_heredoc_is_bounded_data() {
  local command_policy="$1"
  local opener normalized word base arguments

  [[ "$command_policy" == *"__goat_quoted_heredoc_body__"* ]] || return 1
  opener="${command_policy%%$'\n'*}"
  normalized="$(normalize_command_candidate "$opener")"
  word="${normalized%%[[:space:]]*}"
  base="${word##*/}"
  arguments="${normalized#"$word"}"
  arguments="${arguments#"${arguments%%[![:space:]]*}"}"

  # The installed quality saver may carry larger quoted report data after that data has been safely masked.
  if [[ "$base" == "goat-flow" ]]; then
    [[ "$arguments" =~ ^quality[[:space:]]+save([[:space:]]|$) ]]
    return $?
  fi
  # The source-CLI quality saver receives the same bounded report-data allowance as the installed command.
  if [[ "$base" == "node" || "$base" == "nodejs" ]]; then
    [[ "$arguments" =~ ^--import(=tsx|[[:space:]]+tsx)[[:space:]]+src/cli/cli\.ts[[:space:]]+quality[[:space:]]+save([[:space:]]|$) ]]
    return $?
  fi
  return 1
}

# Check every heredoc consumer, including process substitutions, before hiding data that cannot execute as shell commands.
heredoc_command_list_is_inert() {
  local scan segment first normalized inner match ps_re substitution_count iterations
  local -a segs=()

  # Strip quoted spans first (so a shell NAME used as data is not read as a
  # command, and a quoted delimiter/pipe does not split).
  # shellcheck disable=SC2001  # regex strip of quoted spans, not a glob
  scan=$(printf '%s' "$1" | sed -E "s/'[^']*'//g; s/\"[^\"]*\"//g")

  # Process substitutions route the body to another consumer; inspect it before hiding heredoc data that could feed a shell.
  #
  # Replace reviewed substitutions with placeholders so the remaining opener can be split without rescanning the same consumer.
  substitution_count="$(count_substitution_openers "$scan")"
  (( substitution_count > 32 )) && return 1
  ps_re='[<>]\(([^()]*)\)'
  iterations=0
  # Inspect each process-substitution consumer before treating heredoc bytes as data rather than shell code.
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
  # Inspect openers with more than 64 pipeline commands instead of masking them as data.
  # Bound parser subprocesses so a long submitted opener cannot fork-DoS the masker and exhaust the hook's resources.
  (( ${#segs[@]} > 64 )) && return 1
  # Every opener stage must consume non-shell data before the heredoc body may be hidden from command checks.
  for segment in "${segs[@]}"; do
    segment="${segment#"${segment%%[![:space:]]*}"}"
    [[ -z "$segment" ]] && continue
    normalized=$(normalize_command_candidate "$segment")
    first=$(first_word_base "$normalized")
    goat_first_word_is_inert "$first" ||
      goat_flow_cli_consumes_heredoc_as_data "$normalized" || return 1
  done
  return 0
}

# Hide quoted heredoc data only after every opener stage and process-substitution consumer passes the non-shell check.
heredoc_body_is_inert() {
  # SAFE BY DEFAULT: hide data only after every opener stage and process-substitution consumer qualifies; other consumers remain inspectable.
  #
  # The opener, redirects and arguments still receive policy checks; a long unrecognized heredoc may hit the chain limit and need manual review.
  heredoc_command_list_is_inert "$1"
}

# Hide only reviewed non-shell heredoc data so long report text does not count as executable command chains.
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

  # Read the complete proposed script so heredoc openers and bodies receive consistent inspection.
  while IFS= read -r line || [[ -n "$line" ]]; do
    # Inside a heredoc, classify body data separately from the opener that may execute or redirect it.
    if (( in_body )); then
      stripped_line="$line"
      # A tab-stripping heredoc may indent its closing delimiter; account for that syntax before ending body inspection.
      if (( strip_tabs )); then
        # Remove only delimiter-leading tabs so an indented heredoc close does not look like another body line.
        while [[ "$stripped_line" == $'\t'* ]]; do
          stripped_line="${stripped_line#$'\t'}"
        done
      fi
      # The closing delimiter returns inspection to executable commands after the heredoc.
      if [[ "$line" == "$delimiter" || "$stripped_line" == "$delimiter" ]]; then
        output+="$line"$'\n'
        in_body=0
        mask_body=0
        strip_tabs=0
        body_masked=0
        delimiter=""
      # Reviewed non-shell data needs a single placeholder; executable shell-fed data remains visible in the alternate branch.
      elif (( mask_body )); then
        # Collapse the whole inert body to one placeholder so a long inline smoke script does not count as dozens of chained shell actions.
        #
        # Shell-fed bodies remain visible line by line for command inspection and chain counting.
        if (( ! body_masked )); then
          output+="__goat_quoted_heredoc_body__"$'\n'
          body_masked=1
        fi
      else
        output+="$line"$'\n'
      fi
      continue
    fi

    # Join bash line-continuations so a heredoc piped into Bash is inspected as one executable command.
    # Backslashes inside the heredoc body remain literal data; the body branch above handles them separately.
    logical="$line"
    # Join a continued opener before classification so a shell consumer on its next line cannot hide executable input.
    while [[ "$logical" =~ (^|[^\\])(\\\\)*\\$ ]]; do
      IFS= read -r line || break
      logical="${logical%\\}$line"
    done

    output+="$logical"$'\n'
    # Only explicitly quoted heredoc bodies qualify for this data-masking review; ordinary command text stays visible.
    if [[ "$logical" =~ $single_quoted_re ]] || [[ "$logical" =~ $double_quoted_re ]]; then
      strip_tabs=0
      [[ "${BASH_REMATCH[1]}" == "<<-" ]] && strip_tabs=1
      delimiter="${BASH_REMATCH[2]}"
      # All opener consumers have been classified as non-shell, so hiding their data does not hide a shell command.
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

# Find a complete nested command boundary while respecting quoted operands; an unmatched opener leaves no safe boundary to inspect.
find_matching_shell_paren() {
  local input="$1"
  local open_index="$2"
  local depth=0
  local in_single=0
  local in_double=0
  local escaped=0
  local i=0
  local char=""

  # Walk the nested command until its real closing parenthesis so quoted delimiters cannot shorten inspection.
  for ((i = open_index; i < ${#input}; i++)); do
    char="${input:i:1}"

    # An escaped character stays literal so quotes or separators in an argument cannot change the inspected command boundary.
    if [[ "$escaped" -eq 1 ]]; then
      escaped=0
      continue
    fi
    # Outside single quotes, an escape protects the next character from becoming a command or argument boundary.
    if [[ "$in_single" -eq 0 && "$char" == "\\" ]]; then
      escaped=1
      continue
    fi
    # Single-quoted text belongs to a literal operand, so its separators and substitution markers cannot become executable actions.
    if [[ "$in_double" -eq 0 && "$char" == "'" ]]; then
      # Closing a single-quoted operand returns inspection to the surrounding command context.
      if [[ "$in_single" -eq 1 ]]; then
        in_single=0
      else
        in_single=1
      fi
      continue
    fi
    # Double quotes preserve an argument boundary while still allowing executable command substitutions to be inspected.
    if [[ "$in_single" -eq 0 && "$char" == '"' ]]; then
      # Closing double quotes restores the surrounding word boundaries for the proposed action.
      if [[ "$in_double" -eq 1 ]]; then
        in_double=0
      else
        in_double=1
      fi
      continue
    fi
    # Quoted delimiters are operand data rather than nested command boundaries; keep scanning for the real closing parenthesis.
    if [[ "$in_single" -eq 1 || "$in_double" -eq 1 ]]; then
      continue
    fi

    # A nested opener extends the command boundary; its enclosed commands still need complete policy inspection.
    if [[ "$char" == "(" ]]; then
      depth=$((depth + 1))
    # A closing parenthesis narrows the nesting level until the complete proposed substitution has been found.
    elif [[ "$char" == ")" ]]; then
      depth=$((depth - 1))
      # The matching outer close gives policy checks a complete substitution body rather than a partial command.
      if [[ "$depth" -eq 0 ]]; then
        printf '%s\n' "$i"
        return 0
      fi
    fi
  done

  return 1
}

# Inspect commands executed inside substitutions before the outer action; unresolved forms deny execution with a direct-command instruction.
check_command_substitutions() {
  local remaining="$1"
  local depth="$2"
  local residual=""
  local command_substitution_candidates=""
  local process_substitution_candidates=""
  local i=0
  local close_index=""
  local char=""
  local next=""
  local next2=""
  local inner=""
  local in_single=0
  local in_double=0
  local escaped=0

  # Inspect substitutions using only characters Bash can execute in the user's quoted context.
  # Double quotes allow command substitutions and backticks to execute, but keep process substitutions literal.
  for ((i = 0; i < ${#remaining}; i++)); do
    char="${remaining:i:1}"

    # An escaped character stays literal so quotes or separators in an argument cannot change the inspected command boundary.
    if [[ "$escaped" -eq 1 ]]; then
      residual+="$char"
      # Escaped characters separate adjacent opener text. A backslash-newline
      # is removed by Bash, so it does not add a separator.
      if [[ "$char" != $'\n' ]]; then
        command_substitution_candidates+="__goat_escaped__"
        # Only unquoted text can start a process substitution; double-quoted text still needs command-substitution inspection.
        if [[ "$in_double" -eq 0 ]]; then
          process_substitution_candidates+="__goat_escaped__"
        fi
      fi
      escaped=0
      continue
    fi
    # Outside single quotes, an escape protects the next character from becoming a command or argument boundary.
    if [[ "$in_single" -eq 0 && "$char" == "\\" ]]; then
      residual+="$char"
      escaped=1
      continue
    fi
    # Single-quoted text belongs to a literal operand, so its separators and substitution markers cannot become executable actions.
    if [[ "$in_double" -eq 0 && "$char" == "'" ]]; then
      # Closing a single-quoted operand returns inspection to the surrounding command context.
      if [[ "$in_single" -eq 1 ]]; then
        in_single=0
      else
        in_single=1
      fi
      residual+="$char"
      continue
    fi
    # Double quotes preserve an argument boundary while still allowing executable command substitutions to be inspected.
    if [[ "$in_single" -eq 0 && "$char" == '"' ]]; then
      # Closing double quotes restores the surrounding word boundaries for the proposed action.
      if [[ "$in_double" -eq 1 ]]; then
        in_double=0
      else
        in_double=1
      fi
      residual+="$char"
      continue
    fi

    # Single-quoted command data cannot execute substitutions; inspect executable contexts separately.
    if [[ "$in_single" -eq 0 ]]; then
      next="${remaining:i+1:1}"
      next2="${remaining:i+2:1}"
      # Arithmetic expansion can contain nested executable substitutions, so inspect its interior before hiding arithmetic syntax.
      if [[ "$char$next" == "\$(" && "$next2" == "(" ]]; then
        # A complete arithmetic boundary lets nested-command checks inspect the entire expression before the outer action.
        if close_index="$(find_matching_shell_paren "$remaining" $((i + 1)))"; then
          inner="${remaining:i+3:close_index-i-3}"
          check_command_substitutions "$inner" "$depth" || return $?
          residual+="__goat_arith__"
          command_substitution_candidates+="__goat_arith__"
          # Unquoted arithmetic placeholders also keep the process-substitution projection aligned with the inspected expression.
          if [[ "$in_double" -eq 0 ]]; then
            process_substitution_candidates+="__goat_arith__"
          fi
          i="$close_index"
          continue
        fi
      # Command substitution executes its interior before the outer command, so it needs its own policy verdict.
      elif [[ "$char$next" == "\$(" ]]; then
        # A complete command-substitution boundary allows inspection of the whole nested action.
        if close_index="$(find_matching_shell_paren "$remaining" $((i + 1)))"; then
          inner="${remaining:i+2:close_index-i-2}"
          # An empty substitution contains no action to classify; nonempty interiors receive the same policy checks as direct commands.
          if [[ -n "$inner" ]]; then
            check_command_segments "$inner" $((depth + 1)) || return $?
          fi
          residual+="__goat_subst__"
          command_substitution_candidates+="__goat_subst__"
          # Unquoted substitution placeholders keep process-boundary detection aligned after the nested command is checked.
          if [[ "$in_double" -eq 0 ]]; then
            process_substitution_candidates+="__goat_subst__"
          fi
          i="$close_index"
          continue
        fi
      # Process substitution launches another command outside double quotes, so inspect that action before the outer command.
      elif [[ "$in_double" -eq 0 && ( "$char$next" == '<(' || "$char$next" == '>(' ) ]]; then
        # A complete process-substitution boundary lets the policy inspect the whole producer or consumer action.
        if close_index="$(find_matching_shell_paren "$remaining" $((i + 1)))"; then
          inner="${remaining:i+2:close_index-i-2}"
          # An empty process substitution supplies no action; a nonempty body must pass the selected policy.
          if [[ -n "$inner" ]]; then
            check_command_segments "$inner" $((depth + 1)) || return $?
          fi
          residual+="__goat_proc_subst__"
          command_substitution_candidates+="__goat_proc_subst__"
          process_substitution_candidates+="__goat_proc_subst__"
          i="$close_index"
          continue
        fi
      fi
    fi

    residual+="$char"
    # Only executable contexts contribute substitution candidates; literal single-quoted data cannot add hidden actions.
    if [[ "$in_single" -eq 0 ]]; then
      command_substitution_candidates+="$char"
      # Process substitutions execute only outside double quotes, unlike command substitutions within quoted arguments.
      if [[ "$in_double" -eq 0 ]]; then
        process_substitution_candidates+="$char"
      fi
    fi
  done

  # An unresolved executable substitution cannot be inspected safely; ask for its expanded command before proceeding.
  if [[ "$command_substitution_candidates" =~ \$\( ||
        "$process_substitution_candidates" =~ [\<\>]\( ]]; then
    block "Complex command substitution. Write the expanded command directly." || return $?
  fi

  # Executable backticks hide another command; require direct command text so the user can review the actual action.
  if [[ "$command_substitution_candidates" == *\`* ]]; then
    block "Backtick command substitution hides nested execution. Use a direct command instead, or for an inline script run it from a file (e.g. node script.js)." || return $?
  fi
}

# Identify the executable basename so an absolute command path receives the same policy as its ordinary command name.
first_word_base() {
  local c="${1#"${1%%[![:space:]]*}"}"
  local word="${c%%[[:space:]]*}"
  printf '%s' "${word##*/}"
}

# Remove shell quoting from the executable name while keeping quoted spaces inside that word for consistent policy classification.
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
  # Read the executable word with its quoting intact so quoted spaces cannot turn a different program into a trusted command name.
  for ((i = 0; i < ${#c}; i++)); do
    char="${c:i:1}"

    # An escaped character stays literal so quotes or separators in an argument cannot change the inspected command boundary.
    if [[ "$escaped" -eq 1 ]]; then
      # An escaped space belongs to the executable word rather than separating its first argument.
      if [[ "$char" =~ [[:space:]] ]]; then
        current+="$word_space"
      else
        current+="$char"
      fi
      escaped=0
      continue
    fi

    # Outside single quotes, an escape protects the next character from becoming a command or argument boundary.
    if [[ "$in_single" -eq 0 && "$char" == "\\" ]]; then
      escaped=1
      continue
    fi

    # Single-quoted text belongs to a literal operand, so its separators and substitution markers cannot become executable actions.
    if [[ "$in_double" -eq 0 && "$char" == "'" ]]; then
      # Closing a single-quoted operand returns inspection to the surrounding command context.
      if [[ "$in_single" -eq 1 ]]; then
        in_single=0
      else
        in_single=1
      fi
      continue
    fi

    # Double quotes preserve an argument boundary while still allowing executable command substitutions to be inspected.
    if [[ "$in_single" -eq 0 && "$char" == '"' ]]; then
      # Closing double quotes restores the surrounding word boundaries for the proposed action.
      if [[ "$in_double" -eq 1 ]]; then
        in_double=0
      else
        in_double=1
      fi
      continue
    fi

    # Only unquoted whitespace ends the executable word; quoted spaces remain part of the program name.
    # Unquoted IFS expansion can turn this apparent word into a different executable and arguments.
    if [[ "$in_single" -eq 0 && "$in_double" -eq 0 && ! "$current" =~ ^[a-zA-Z_][a-zA-Z0-9_]*= &&
      ( "${c:i}" == "\${IFS}"* || "${c:i}" =~ ^\$IFS([^a-zA-Z0-9_]|$) ) ]]; then
      return 2
    fi
    if [[ "$in_single" -eq 0 && "$in_double" -eq 0 && "$char" =~ [[:space:]] ]]; then
      rest="${c:i+1}"
      rest="${rest#"${rest%%[![:space:]]*}"}"
      # Arguments following the executable stay attached to the policy candidate; a command without arguments needs no separator.
      if [[ -n "$rest" ]]; then
        printf '%s %s' "$current" "$rest"
      else
        printf '%s' "$current"
      fi
      return 0
    fi

    # Spaces still inside the executable word must not become argument boundaries during policy inspection.
    if [[ "$char" =~ [[:space:]] ]]; then
      current+="$word_space"
    else
      current+="$char"
    fi
  done

  # A trailing escape remains part of the proposed word rather than disappearing from policy inspection.
  if [[ "$escaped" -eq 1 ]]; then
    current+="\\"
  fi

  printf '%s' "$current"
}

# Skip one complete quoted option value so wrapper settings cannot conceal the command the agent would run.
drop_first_shell_word() {
  local c="$1"
  local char=""
  local in_single=0
  local in_double=0
  local escaped=0
  local i=0

  c="${c#"${c%%[![:space:]]*}"}"
  # Skip one quoted word without executing it so the wrapper value cannot replace the actual program in policy checks.
  for ((i = 0; i < ${#c}; i++)); do
    char="${c:i:1}"

    # An escaped character stays literal so quotes or separators in an argument cannot change the inspected command boundary.
    if [[ "$escaped" -eq 1 ]]; then
      escaped=0
      continue
    fi

    # Outside single quotes, an escape protects the next character from becoming a command or argument boundary.
    if [[ "$in_single" -eq 0 && "$char" == "\\" ]]; then
      escaped=1
      continue
    fi

    # Single-quoted text belongs to a literal operand, so its separators and substitution markers cannot become executable actions.
    if [[ "$in_double" -eq 0 && "$char" == "'" ]]; then
      # Closing a single-quoted operand returns inspection to the surrounding command context.
      if [[ "$in_single" -eq 1 ]]; then
        in_single=0
      else
        in_single=1
      fi
      continue
    fi

    # Double quotes preserve an argument boundary while still allowing executable command substitutions to be inspected.
    if [[ "$in_single" -eq 0 && "$char" == '"' ]]; then
      # Closing double quotes restores the surrounding word boundaries for the proposed action.
      if [[ "$in_double" -eq 1 ]]; then
        in_double=0
      else
        in_double=1
      fi
      continue
    fi

    # Unquoted whitespace completes the skipped word and reveals the remaining proposed command.
    if [[ "$in_single" -eq 0 && "$in_double" -eq 0 && "$char" =~ [[:space:]] ]]; then
      local rest="${c:i+1}"
      rest="${rest#"${rest%%[![:space:]]*}"}"
      printf '%s' "$rest"
      return 0
    fi
  done

  printf ''
}

# Read quoted command arguments without executing expansions so option and path checks inspect the same words the agent proposed.
split_shell_words_into() {
  local -n __goat_words_out__="$1"
  local input="$2"
  __goat_words_out__=()
  local current=""
  local char=""
  local in_single=0
  local in_double=0
  local escaped=0
  local word_started=0
  local i=0

  # Read each proposed argument without expanding it so paths and wrapper operands remain reviewable data.
  for ((i = 0; i < ${#input}; i++)); do
    char="${input:i:1}"

    # An escaped character stays literal so quotes or separators in an argument cannot change the inspected command boundary.
    if [[ "$escaped" -eq 1 ]]; then
      current+="$char"
      word_started=1
      escaped=0
      continue
    fi

    # Outside single quotes, an escape protects the next character from becoming a command or argument boundary.
    if [[ "$in_single" -eq 0 && "$char" == "\\" ]]; then
      escaped=1
      continue
    fi

    # Single-quoted text belongs to a literal operand, so its separators and substitution markers cannot become executable actions.
    if [[ "$in_double" -eq 0 && "$char" == "'" ]]; then
      word_started=1
      # Closing a single-quoted operand returns inspection to the surrounding command context.
      if [[ "$in_single" -eq 1 ]]; then
        in_single=0
      else
        in_single=1
      fi
      continue
    fi

    # Double quotes preserve an argument boundary while still allowing executable command substitutions to be inspected.
    if [[ "$in_single" -eq 0 && "$char" == '"' ]]; then
      word_started=1
      # Closing double quotes restores the surrounding word boundaries for the proposed action.
      if [[ "$in_double" -eq 1 ]]; then
        in_double=0
      else
        in_double=1
      fi
      continue
    fi

    # Only unquoted whitespace separates arguments; spaces in a quoted user path stay within that path.
    if [[ "$in_single" -eq 0 && "$in_double" -eq 0 && "$char" =~ [[:space:]] ]]; then
      # A complete nonempty word becomes one reviewed argument; repeated spaces add no synthetic operand.
      if [[ "$word_started" -eq 1 ]]; then
        __goat_words_out__+=("$current")
        current=""
        word_started=0
      fi
      continue
    fi

    current+="$char"
    word_started=1
  done

  # A trailing escape remains part of the proposed word rather than disappearing from policy inspection.
  if [[ "$escaped" -eq 1 ]]; then
    current+="\\"
  fi
  # Retain the final nonempty argument so a command without trailing whitespace still receives complete inspection.
  if [[ "$word_started" -eq 1 ]]; then
    __goat_words_out__+=("$current")
  fi
}

# Rebuild the remaining proposed command after wrapper options so downstream policies see its executable and arguments together.
join_shell_words_from() {
  local -n __goat_words_join_ref__="$1"
  local start_index="$2"
  local out=""
  local i
  # Keep the remaining argument order when rebuilding the executable action after wrapper settings.
  for ((i = start_index; i < ${#__goat_words_join_ref__[@]}; i++)); do
    out+="${__goat_words_join_ref__[$i]} "
  done
  printf '%s' "${out% }"
}

# Return the command xargs will run after its own options and operands.
# Use this shared parser so delete and repository policies show users the same verdict.
strip_xargs_payload_command() {
  local developer_command="$1"
  local -a xargs_words=()
  split_shell_words_into xargs_words "$developer_command"

  # An empty command gives xargs nothing for the policy to inspect.
  [[ "${#xargs_words[@]}" -gt 0 ]] || return 1
  local xargs_command_name="${xargs_words[0]##*/}"
  # Only xargs owns this option grammar; other commands stay unchanged.
  [[ "$xargs_command_name" == "xargs" ]] || return 1

  local xargs_word_index=1
  local xargs_word=""
  # Skip xargs options so the first remaining word is what the user would execute.
  while [[ "$xargs_word_index" -lt "${#xargs_words[@]}" ]]; do
    xargs_word="${xargs_words[$xargs_word_index]}"
    case "$xargs_word" in
      --)
        xargs_word_index=$((xargs_word_index + 1))
        break
        ;;
      -0|--null|-r|--no-run-if-empty|-t|--verbose|-p|--interactive|-x|--exit|--show-limits|-e|-i|-l|--eof|--replace|--max-lines)
        xargs_word_index=$((xargs_word_index + 1))
        continue
        ;;
      # A separated value must be skipped with its option; otherwise the value itself looks like
      # the payload and hides the real command, as `--process-slot-var VAR git push` once did.
      -a|--arg-file|-I|-L|-n|-P|-s|-E|-d|--max-args|--max-procs|--max-chars|--delimiter|--process-slot-var)
        [[ $((xargs_word_index + 1)) -lt "${#xargs_words[@]}" ]] || return 2
        xargs_word_index=$((xargs_word_index + 2))
        continue
        ;;
      -a?*|--arg-file=*|-I?*|-i?*|-L?*|-l?*|-n?*|-P?*|-s?*|-E?*|-e?*|-d?*|--replace=*|--max-lines=*|--max-args=*|--max-procs=*|--max-chars=*|--eof=*|--delimiter=*|--process-slot-var=*)
        xargs_word_index=$((xargs_word_index + 1))
        continue
        ;;
      --help|--version)
        return 1
        ;;
      -*)
        return 2
        ;;
    esac
    break
  done

  # Missing payload means there is no downstream user command to classify.
  [[ "$xargs_word_index" -lt "${#xargs_words[@]}" ]] || return 1
  # Keep the original option prefix recoverable and quoted payload data intact.
  local payload="$developer_command"
  local dropped_word
  for ((dropped_word = 0; dropped_word < xargs_word_index; dropped_word++)); do
    payload=$(drop_first_shell_word "$payload")
  done
  printf '%s' "$payload"
}

# Return the repeated command after supported watch display and timing options.
# Use when a user asks watch to rerun Git or another policy-relevant command.
strip_watch_payload_command() {
  local developer_command="$1"
  local -a watch_words=()
  split_shell_words_into watch_words "$developer_command"

  # Watch needs both its own command word and a repeated payload.
  [[ "${#watch_words[@]}" -gt 1 ]] || return 1
  # A similarly named executable must not inherit watch grammar.
  [[ "${watch_words[0]##*/}" == "watch" ]] || return 1

  local watch_word_index=1
  local watch_word=""
  # Return 2 for uncertain option arity so the caller cannot silently allow a hidden payload.
  while [[ "$watch_word_index" -lt "${#watch_words[@]}" ]]; do
    watch_word="${watch_words[$watch_word_index]}"
    case "$watch_word" in
      --)
        watch_word_index=$((watch_word_index + 1))
        break
        ;;
      -n|--interval|-q|--equexit|-s|--shotsdir)
        [[ $((watch_word_index + 1)) -lt "${#watch_words[@]}" ]] || return 2
        watch_word_index=$((watch_word_index + 2))
        continue
        ;;
      -n?*|--interval=*|-q?*|--equexit=*|-s?*|--shotsdir=*)
        watch_word_index=$((watch_word_index + 1))
        continue
        ;;
      -b|--beep|-c|--color|-C|--no-color|-d|--differences|--differences=*|-e|--errexit|-g|--chgexit|-p|--precise|-r|--no-rerun|-t|--no-title|-w|--no-wrap|-x|--exec)
        watch_word_index=$((watch_word_index + 1))
        continue
        ;;
      -h|--help|-v|--version)
        return 1
        ;;
      -*)
        return 2
        ;;
    esac
    break
  done

  # Missing payload means watch would not run a user command.
  [[ "$watch_word_index" -lt "${#watch_words[@]}" ]] || return 1
  join_shell_words_from watch_words "$watch_word_index"
}

# Return the command GNU parallel will invoke for the supported common option forms.
# Use when a user feeds repeated inputs into a repository or destructive command.
strip_parallel_payload_command() {
  local developer_command="$1"
  local -a parallel_words=()
  split_shell_words_into parallel_words "$developer_command"

  # Parallel needs both its own command word and a downstream payload.
  [[ "${#parallel_words[@]}" -gt 1 ]] || return 1
  # A similarly named executable must not inherit GNU parallel grammar.
  [[ "${parallel_words[0]##*/}" == "parallel" ]] || return 1

  local parallel_word_index=1
  local parallel_word=""
  # Return 2 for uncertain option arity rather than hiding a child from policy checks.
  while [[ "$parallel_word_index" -lt "${#parallel_words[@]}" ]]; do
    parallel_word="${parallel_words[$parallel_word_index]}"
    case "$parallel_word" in
      --)
        parallel_word_index=$((parallel_word_index + 1))
        break
        ;;
      -j|--jobs|-S|--sshlogin|--sshloginfile|--results|--joblog|--timeout|--delay|--retries|--workdir|--halt|--tagstring)
        [[ $((parallel_word_index + 1)) -lt "${#parallel_words[@]}" ]] || return 2
        parallel_word_index=$((parallel_word_index + 2))
        continue
        ;;
      -j?*|--jobs=*|-S?*|--sshlogin=*|--sshloginfile=*|--results=*|--joblog=*|--timeout=*|--delay=*|--retries=*|--workdir=*|--halt=*|--tagstring=*)
        parallel_word_index=$((parallel_word_index + 1))
        continue
        ;;
      --bar|--eta|--keep-order|-k|--line-buffer|--ungroup|--dry-run|--tag|--will-cite)
        parallel_word_index=$((parallel_word_index + 1))
        continue
        ;;
      --help|--version)
        return 1
        ;;
      -*)
        return 2
        ;;
    esac
    break
  done

  # Missing payload means parallel would not invoke a user command.
  [[ "$parallel_word_index" -lt "${#parallel_words[@]}" ]] || return 1
  join_shell_words_from parallel_words "$parallel_word_index"
}

# Read the Git command and retain the repository/config options needed to resolve the user's saved aliases.
# The lookup runs only Git's read-only config command; the proposed subcommand is never executed.
# shellcheck disable=SC2329 # -- Called by patterns-paths.sh and patterns-writes.sh, sourced through GOAT_HOOK_LIB_DIR below.
__goat_git_strip_globals() {
  __goat_git_unknown_global_option=""
  __goat_git_unresolved_config_env_key=""
  reset_git_alias_flags
  __goat_git_rest=""
  __goat_git_command_words=()
  __goat_git_inline_commands=()
  __goat_git_selected_directory="${__goat_git_command_directory:-$PWD}"
  __goat_git_selected_directory_unknown="${__goat_git_directory_unknown:-0}"
  local c="$1"
  c=$(normalize_leading_command_word "$c")

  local -a words=()
  local -a alias_config_options=()
  split_shell_words_into words "$c"
  # Empty command text cannot select a Git repository or invoke an alias.
  [[ "${#words[@]}" -gt 0 ]] || return 1

  local command_base="${words[0]##*/}"
  # Git subcommands can also run as git-<verb> executables, including absolute paths in Git's exec directory.
  if [[ "$command_base" == git-* ]]; then
    words=(git "${command_base#git-}" "${words[@]:1}")
    command_base=git
  fi
  [[ "$command_base" == "git" ]] || return 1

  local i=1
  local opt=""
  local val=""
  local config_payload=""
  # Global options select the project and config before the proposed Git action.
  while [[ "$i" -lt "${#words[@]}" ]]; do
    opt="${words[$i]}"
    case "$opt" in
      --)
        i=$((i + 1))
        break
        ;;
      # Each option here takes the next word as its value; a missing entry would let that value pose as the Git command.
      -c|-C|--git-dir|--work-tree|--namespace|--exec-path|--config-env|--attr-source|--shallow-file|--super-prefix)
        val="${words[$((i + 1))]:-}"
        if [[ "$opt" == "-C" ]]; then
          if [[ "$val" == /* && "$val" != *'$'* && "$val" != *'`'* ]]; then
            __goat_git_selected_directory="$val"
            __goat_git_selected_directory_unknown=0
          else
            __goat_git_selected_directory+="/$val"
            [[ "$val" == *'$'* || "$val" == *'`'* ]] && __goat_git_selected_directory_unknown=1
          fi
        fi
        # Repository selection and temporary config must affect alias lookup exactly as they affect the proposed command.
        case "$opt" in
          -c|-C|--git-dir|--work-tree|--config-env) alias_config_options+=("$opt" "$val") ;;
        esac
        # An inline guarded alias still denies even when the command invokes another word.
        if [[ "$opt" == "-c" ]]; then
          record_git_alias_config "$val"
          if [[ "$val" == *=* ]] && config_payload=$(git_config_command_payload "${val%%=*}" "${val#*=}"); then
            __goat_git_inline_commands+=("$config_payload")
          fi
        elif [[ "$opt" == "--config-env" ]] && git_config_key_may_host_command "${val%%=*}"; then
          __goat_git_unresolved_config_env_key="${val%%=*}"
        fi
        i=$((i + 2))
        continue
        ;;
      -c?*)
        val="${opt#-c}"
        alias_config_options+=("$opt")
        record_git_alias_config "$val"
        if [[ "$val" == *=* ]] && config_payload=$(git_config_command_payload "${val%%=*}" "${val#*=}"); then
          __goat_git_inline_commands+=("$config_payload")
        fi
        i=$((i + 1))
        continue
        ;;
      -C?*|--git-dir=*|--work-tree=*|--namespace=*|--exec-path=*|--config-env=*|--attr-source=*|--shallow-file=*|--super-prefix=*|--list-cmds=*)
        # Preserve attached values so Git itself decides which option spellings its config reader accepts.
        case "$opt" in
          -C?*)
            val="${opt#-C}"
            if [[ "$val" == /* && "$val" != *'$'* && "$val" != *'`'* ]]; then
              __goat_git_selected_directory="$val"
              __goat_git_selected_directory_unknown=0
            else
              __goat_git_selected_directory+="/$val"
              [[ "$val" == *'$'* || "$val" == *'`'* ]] && __goat_git_selected_directory_unknown=1
            fi
            ;;
        esac
        case "$opt" in
          -C?*|--git-dir=*|--work-tree=*|--config-env=*) alias_config_options+=("$opt") ;;
        esac
        if [[ "$opt" == --config-env=* ]]; then
          val="${opt#--config-env=}"
          if git_config_key_may_host_command "${val%%=*}"; then
            __goat_git_unresolved_config_env_key="${val%%=*}"
          fi
        fi
        i=$((i + 1))
        continue
        ;;
      --bare)
        alias_config_options+=("$opt")
        i=$((i + 1))
        continue
        ;;
      -p|-P|-h|-v|--no-pager|--paginate|--literal-pathspecs|--glob-pathspecs|--noglob-pathspecs|--icase-pathspecs|--help|--version|--html-path|--man-path|--info-path|--no-replace-objects|--no-lazy-fetch|--no-optional-locks|--no-advice)
        i=$((i + 1))
        continue
        ;;
      -*)
        # An unlisted option might take a value that would then pose as the command, so Git policy treats it as unresolved.
        [[ -n "$__goat_git_unknown_global_option" ]] || __goat_git_unknown_global_option="$opt"
        i=$((i + 1))
        continue
        ;;
    esac
    break
  done

  local rest=""
  __goat_git_global_words=("${words[@]:0:i}")
  __goat_git_command_words=("${words[@]:i}")
  # Keep the proposed action and arguments together for each repository-policy check.
  while [[ "$i" -lt "${#words[@]}" ]]; do
    rest+="${words[$i]} "
    i=$((i + 1))
  done
  __goat_git_rest="${rest% }"
  # A saved alias can hide a guarded command behind an unrecognised first word.
  local alias_word="${__goat_git_rest%%[[:space:]]*}"
  if [[ "${__goat_git_selected_directory_unknown:-0}" -eq 1 &&
        "${__goat_git_hosted_directory_unknown:-0}" -eq 0 &&
        "$alias_word" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]] && ! is_git_builtin_word "$alias_word"; then
    # This Git-alias denial belongs to the repository or destructive policy, not the secret-file scope left active by an earlier check.
    [[ "$GOAT_GUARD_SCOPE" == deny-git-mutations ]] || GOAT_ACTIVE_GUARD_SCOPE="destructive"
    block "Cannot inspect a saved Git alias after a dynamic directory change. Use a literal directory or ask the user to run the command manually." || return $?
  fi
  # A preceding shell cd changes Git's config lookup base; later Git -C options still apply in their original order.
  record_git_persistent_alias "$__goat_git_rest" -C "${__goat_git_command_directory:-$PWD}" "${alias_config_options[@]}"
  return 0
}

# These settings can contain command text, unlike ordinary Git configuration values.
git_config_key_runs_command() {
  case "${1,,}" in
    core.pager|core.fsmonitor|core.editor|core.sshcommand|core.askpass|core.gitproxy|core.alternaterefscommand|\
    diff.external|diff.*.command|diff.*.textconv|difftool.*.cmd|\
    filter.*.clean|filter.*.smudge|filter.*.process|merge.*.driver|mergetool.*.cmd|\
    pager.*|interactive.difffilter|sequence.editor|gpg.program|gpg.*.program|gpg.ssh.defaultkeycommand|\
    imap.tunnel|sendemail.sendmailcmd|sendemail.tocmd|sendemail.cccmd|sendemail.headercmd|\
    sendemail.*.sendmailcmd|sendemail.*.tocmd|sendemail.*.cccmd|sendemail.*.headercmd|\
    browser.*.cmd|guitool.*.cmd|man.*.cmd|instaweb.httpd|gc.recentobjectshook|uploadpack.packobjectshook|\
    remote.*.uploadpack|remote.*.receivepack) return 0 ;;
    *) return 1 ;;
  esac
}

# A --config-env value lives outside the command text, so command-bearing keys cannot be proved safe.
git_config_key_may_host_command() {
  local key="${1,,}"
  git_config_key_runs_command "$key" && return 0
  case "$key" in
    credential.helper|credential.*.helper|remote.*.url|remote.*.pushurl|submodule.*.url|submodule.*.update) return 0 ;;
  esac
  return 1
}

# Apply Git's command transformations for custom submodule updates and credential helpers.
git_config_command_payload() {
  local key="${1,,}" value="$2"
  case "$key" in
    remote.*.url|remote.*.pushurl|submodule.*.url)
      [[ "$value" == ext::* ]] || return 1
      printf '%s' "$value"
      return 0
      ;;
    submodule.*.update)
      [[ "$value" == '!'* ]] || return 1
      printf '%s' "${value#!}"
      return 0
      ;;
    credential.helper|credential.*.helper)
      [[ -n "$value" ]] || return 1
      case "$value" in
        '!'*) printf '%s' "${value#!}" ;;
        /*) printf '%s' "$value" ;;
        *) printf 'git credential-%s' "$value" ;;
      esac
      return 0
      ;;
  esac
  git_config_key_runs_command "$key" || return 1
  printf '%s' "$value"
}

# Apply the selected policy to explicit commands Git will execute now or from saved configuration.
# Inspection uses a subshell so nested parser state cannot replace the enclosing command's state.
check_git_hosted_commands() {
  local cmd="$1" depth="$2"
  __goat_git_strip_globals "$cmd" || return 0
  if [[ -n "$__goat_git_unresolved_config_env_key" ]]; then
    [[ "$GOAT_GUARD_SCOPE" == deny-git-mutations ]] || GOAT_ACTIVE_GUARD_SCOPE="destructive"
    block "Git --config-env may supply a command through $__goat_git_unresolved_config_env_key; use a literal inspected value or ask the user to run it manually." || return $?
  fi
  local -a hosted_commands=("${__goat_git_inline_commands[@]}")
  local -a git_words=("${__goat_git_command_words[@]}")
  local -a alias_words=()
  local alias_name="${git_words[0]:-}"
  local expanded_alias appended_args="" alias_hosted_index=-1 payload_index=0
  # Git splits the alias value, then appends the caller's original arguments without splitting them again.
  if [[ "$alias_name" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]] && ! is_git_builtin_word "$alias_name" &&
    [[ -n "${__goat_git_raw_alias_expansions[${alias_name,,}]:-}" ]]; then
    if [[ "${__goat_git_raw_alias_expansions[${alias_name,,}]}" == '!'* ]]; then
      # Git passes the caller's remaining arguments to its shell alias command.
      if [[ "${#git_words[@]}" -gt 1 ]]; then
        printf -v appended_args '%q ' "${git_words[@]:1}"
      fi
      expanded_alias="${__goat_git_raw_alias_expansions[${alias_name,,}]#!} $appended_args"
    else
      split_shell_words_into alias_words "${__goat_git_raw_alias_expansions[${alias_name,,}]}"
      printf -v expanded_alias '%q ' "${__goat_git_global_words[@]}" "${alias_words[@]}" "${git_words[@]:1}"
    fi
    alias_hosted_index="${#hosted_commands[@]}"
    hosted_commands+=("$expanded_alias")
    git_words=()
  fi
  local verb="${git_words[0]:-}" word payload output hosted_status key=""
  local index=1 start=0 skip_value=0 scan_ext_transport=0
  case "$verb" in
    clone|fetch|pull|push|archive)
      scan_ext_transport=1
      ;;
    ls-remote)
      scan_ext_transport=1
      for word in "${git_words[@]:1}"; do
        [[ "$word" == --get-url ]] && scan_ext_transport=0
      done
      ;;
    remote)
      [[ "${git_words[1]:-}" == add || "${git_words[1]:-}" == set-url ]] && scan_ext_transport=1
      ;;
    bisect)
      [[ "${git_words[1]:-}" == run ]] && start=2
      ;;
    submodule)
      while [[ "${git_words[index]:-}" == --quiet || "${git_words[index]:-}" == -q ]]; do
        index=$((index + 1))
      done
      [[ "${git_words[index]:-}" == add || "${git_words[index]:-}" == set-url ]] && scan_ext_transport=1
      if [[ "${git_words[index]:-}" == foreach ]]; then
        index=$((index + 1))
        while [[ "${git_words[index]:-}" == --recursive || "${git_words[index]:-}" == --quiet || "${git_words[index]:-}" == -- ]]; do
          index=$((index + 1))
        done
        start="$index"
      fi
      ;;
    difftool)
      for ((index = 1; index < ${#git_words[@]}; index++)); do
        word="${git_words[index]}"
        case "$word" in
          --) break ;;
          -x|--extcmd) hosted_commands+=("${git_words[index+1]:-}"); index=$((index + 1)) ;;
          --extcmd=*) hosted_commands+=("${word#*=}") ;;
          -x?*) hosted_commands+=("${word#-x}") ;;
        esac
      done
      ;;
    grep)
      # Git passes each matching path to this explicit pager command.
      for ((index = 1; index < ${#git_words[@]}; index++)); do
        word="${git_words[index]}"
        case "$word" in
          --) break ;;
          -O?*) hosted_commands+=("${word#-O} ./__goat_git_grep_match__") ;;
          --open-files-in-pager=?*) hosted_commands+=("${word#*=} ./__goat_git_grep_match__") ;;
        esac
      done
      ;;
    config)
      # Queries and removals do not install executable values. File/type options consume their next word.
      for ((index = 1; index < ${#git_words[@]}; index++)); do
        word="${git_words[index]}"
        if [[ "$skip_value" -eq 1 ]]; then skip_value=0; continue; fi
        case "$word" in
          --get*|--list|-l|--unset*|--remove-section|--rename-section|--edit|-e|get|list|unset|remove-section|rename-section|edit) break ;;
          -f|--file|--blob|--type) skip_value=1; continue ;;
          set|--add|--replace-all|--local|--global|--system|--worktree|--includes|--no-includes|--) continue ;;
          -*) continue ;;
        esac
        key="$word"
        if payload=$(git_config_command_payload "$key" "${git_words[index+1]:-}"); then
          hosted_commands+=("$payload")
        fi
        break
      done
      ;;
  esac
  if [[ "$scan_ext_transport" -eq 1 ]]; then
    for ((index = 1; index < ${#git_words[@]}; index++)); do
      word="${git_words[index]}"
      case "$word" in
        # These option values are data, even when they resemble an ext remote URL.
        --branch|-b|--depth|--sort|-t|--track|--origin|-o)
          index=$((index + 1))
          ;;
        --branch=*|--depth=*|--sort=*|--track=*|--origin=*|-b?*|-t?*|-o?*) ;;
        -u|--upload-pack|--exec)
          hosted_commands+=("${git_words[index+1]:-}")
          index=$((index + 1))
          ;;
        -u?*) hosted_commands+=("${word#-u}") ;;
        --upload-pack=*|--exec=*) hosted_commands+=("${word#*=}") ;;
        ext::*|--remote=ext::*) hosted_commands+=("${word#--remote=}") ;;
      esac
    done
  fi
  if [[ "$start" -gt 0 && "$start" -lt "${#git_words[@]}" ]]; then
    if [[ $((${#git_words[@]} - start)) -eq 1 ]]; then
      hosted_commands+=("${git_words[start]}")
    else
      printf -v payload '%q ' "${git_words[@]:start}"
      hosted_commands+=("$payload")
    fi
  fi
  # A submodule or a deferred helper may execute in a different directory.
  local __goat_git_command_directory="$__goat_git_selected_directory"
  local __goat_git_directory_unknown=1
  local __goat_git_hosted_directory_unknown=1
  for payload in "${hosted_commands[@]}"; do
    # Git expands its own alias in the selected repository; other hosted commands may change directory.
    __goat_git_directory_unknown=1
    __goat_git_hosted_directory_unknown=1
    if [[ "$payload_index" -eq "$alias_hosted_index" ]]; then
      __goat_git_directory_unknown="$__goat_git_selected_directory_unknown"
      __goat_git_hosted_directory_unknown=0
    fi
    payload_index=$((payload_index + 1))
    [[ -n "$payload" ]] || continue
    if [[ "$payload" == ext::* ]]; then
      # git-remote-ext decodes "% " inside an argument; that boundary is not shell syntax.
      if [[ "$payload" == *'% '* ]]; then
        [[ "$GOAT_GUARD_SCOPE" == "deny-git-mutations" ]] || GOAT_ACTIVE_GUARD_SCOPE="destructive"
        block "Git ext transport with escaped spaces cannot be inspected; invoke the command directly." || return $?
      fi
      payload="${payload#ext::}"
    fi
    if [[ "$depth" -ge 8 ]]; then
      # Keep the repository or destructive scope; a nesting-depth denial is not a secret-file access.
      [[ "$GOAT_GUARD_SCOPE" == deny-git-mutations ]] || GOAT_ACTIVE_GUARD_SCOPE="destructive"
      block "Git-hosted command nesting exceeds inspection depth; invoke the command directly." || return $?
    fi
    if output=$(check_command_segments "$payload" $((depth + 1))); then
      # Structured providers deliver a denial with exit zero; preserve that decision unchanged.
      if [[ -n "$output" ]]; then printf '%s\n' "$output"; exit 0; fi
    else
      hosted_status=$?
      # A delivered stderr denial must end the parent, not become a second unavailable-result message.
      [[ "$hosted_status" -eq 2 ]] && exit 2
      return "$hosted_status"
    fi
  done
  return 0
}

# Remove one environment assignment without splitting its quoted value so the following executable receives policy checks.
strip_one_assignment_prefix() {
  local c="$1"
  [[ "$c" =~ ^[a-zA-Z_][a-zA-Z0-9_]*\+?= ]] || return 1

  local i char
  local in_single=0
  local in_double=0
  local escaped=0

  # Read the assignment value as one quoted word before revealing the executable that follows it.
  for ((i = 0; i < ${#c}; i++)); do
    char="${c:i:1}"

    # An escaped character stays literal so quotes or separators in an argument cannot change the inspected command boundary.
    if [[ "$escaped" -eq 1 ]]; then
      escaped=0
      continue
    fi

    # Outside single quotes, an escape protects the next character from becoming a command or argument boundary.
    if [[ "$in_single" -eq 0 && "$char" == "\\" ]]; then
      escaped=1
      continue
    fi

    # Single-quoted text belongs to a literal operand, so its separators and substitution markers cannot become executable actions.
    if [[ "$in_double" -eq 0 && "$char" == "'" ]]; then
      # Closing a single-quoted operand returns inspection to the surrounding command context.
      if [[ "$in_single" -eq 1 ]]; then
        in_single=0
      else
        in_single=1
      fi
      continue
    fi

    # Double quotes preserve an argument boundary while still allowing executable command substitutions to be inspected.
    if [[ "$in_single" -eq 0 && "$char" == '"' ]]; then
      # Closing double quotes restores the surrounding word boundaries for the proposed action.
      if [[ "$in_double" -eq 1 ]]; then
        in_double=0
      else
        in_double=1
      fi
      continue
    fi

    # Unquoted whitespace ends the environment assignment and reveals the action that still requires policy inspection.
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

# Reveal the executable after env settings so a changed environment cannot hide a guarded command.
normalize_env_prefix() {
  local c="$1"
  local stripped=""

  # Remove only recognized environment settings until the proposed executable is exposed.
  while true; do
    c="${c#"${c%%[![:space:]]*}"}"

    # An attached environment-unset value configures env rather than naming the command to inspect.
    if [[ "$c" =~ ^--unset=[^[:space:]]+[[:space:]]* ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    # A separated environment-unset value must be skipped with its option so the real command stays visible.
    if [[ "$c" =~ ^--unset[[:space:]]+[^[:space:]]+[[:space:]]* ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    # The short unset option consumes its variable name before the guarded executable begins.
    if [[ "$c" =~ ^-u[[:space:]]+[^[:space:]]+[[:space:]]* ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    # An attached short unset value belongs to env settings rather than the executable action.
    if [[ "$c" =~ ^-u[^[:space:]]+[[:space:]]* ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    # Environment and diagnostic options do not exempt the child command from policy.
    if [[ "$c" =~ ^--(ignore-environment|null|debug)([[:space:]]+|$) ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    # An attached working-directory setting precedes the executable; inspect the remaining command normally.
    if [[ "$c" =~ ^--chdir=[^[:space:]]+[[:space:]]* ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    # A separated working-directory setting consumes a quoted folder before the executable can be identified.
    if [[ "$c" =~ ^--chdir[[:space:]]+ ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      c=$(drop_first_shell_word "$c")
      continue
    fi
    # Short directory options consume their folder value before policy checks identify the executable.
    if [[ "$c" =~ ^-[cC][[:space:]]+ ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      c=$(drop_first_shell_word "$c")
      continue
    fi
    # Short environment and diagnostic flags leave the child action subject to inspection.
    if [[ "$c" =~ ^-[i0v]+([[:space:]]+|$) ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    # Split-string mode carries the command in its remaining text, so expose that text for ordinary policy classification.
    if [[ "$c" =~ ^(-[sS]|--split-string)(=|[[:space:]]+) ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      # Remove the split string's outer single quotes so its command word reaches the same policy as a direct call.
      if [[ "$c" == \'* ]]; then c="${c#\'}"; c="${c%\'}"; fi
      # Remove the split string's outer double quotes so its command word reaches the same policy as a direct call.
      if [[ "$c" == \"* ]]; then c="${c#\"}"; c="${c%\"}"; fi
      break
    fi
    # The option terminator marks the remaining executable rather than another environment setting.
    if [[ "$c" =~ ^--[[:space:]]+ ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    # An environment assignment is setup for the child command; continue until its executable is exposed.
    if stripped=$(strip_one_assignment_prefix "$c"); then
      c="$stripped"
      continue
    fi
    # Help/version exit without a payload; every other unrecognised option has uncertain arity.
    if [[ "$c" == -* && ! "$c" =~ ^--(help|version)([[:space:]]|$) ]]; then
      return 2
    fi
    break
  done

  printf '%s' "$c"
}

# Variable names whose value chooses which Git configuration, aliases or hooks a later git process loads.
git_config_source_variable_name() {
  case "$1" in
    HOME|XDG_CONFIG_HOME|GIT_DIR|GIT_COMMON_DIR|GIT_CONFIG|GIT_CONFIG_GLOBAL|GIT_CONFIG_SYSTEM|GIT_CONFIG_COUNT|GIT_CONFIG_PARAMETERS)
      return 0 ;;
    GIT_CONFIG_KEY_*|GIT_CONFIG_VALUE_*)
      return 0 ;;
  esac
  return 1
}

# Config-source names a git-running shell already exports, so a plain declare/typeset/readonly/for/append keeps them visible to git.
# The other config-source names need an explicit export before a child git can read them, matching the unexported-declare allow cases.
git_config_source_variable_is_ambiently_exported() {
  case "$1" in
    HOME|XDG_CONFIG_HOME) return 0 ;;
  esac
  return 1
}

# Environment variables whose value git runs as a command, mirroring the command-hosting -c config keys above.
git_command_environment_variable_name() {
  case "$1" in
    GIT_EXTERNAL_DIFF|GIT_SSH|GIT_SSH_COMMAND|GIT_PAGER|PAGER|GIT_EDITOR|GIT_SEQUENCE_EDITOR|GIT_PROXY_COMMAND|GIT_ASKPASS|SSH_ASKPASS)
      return 0 ;;
  esac
  return 1
}

# Classify command-hosting Git environment variables set for a git action, so an env-supplied command receives the same
# policy as its -c config equivalent. A literal value is inspected like any command; the value's danger is intrinsic, so an
# exported assignment is inspected where it is written even when the git action follows in a later segment.
check_git_command_environment() {
  local raw="$1" verb="$2" depth="$3"
  local -a words=()
  local -a hosted=()
  local word name value index=0 exports=0
  case "$verb" in
    git|git-*)
      split_shell_words_into words "$raw"
      # Skip a leading env wrapper so its assignments still reach inspection.
      if [[ "${words[0]##*/}" == env ]]; then
        index=1
        while [[ "$index" -lt "${#words[@]}" ]]; do
          case "${words[$index]}" in
            --) index=$((index + 1)); break ;;
            -u|--unset) index=$((index + 2)) ;;
            -*) index=$((index + 1)) ;;
            *) break ;;
          esac
        done
      fi
      # Only leading prefix assignments configure the following git action; a later argument that quotes the same text is data.
      while [[ "$index" -lt "${#words[@]}" && "${words[$index]}" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; do
        name="${BASH_REMATCH[1]}"
        value="${BASH_REMATCH[2]}"
        git_command_environment_variable_name "$name" && hosted+=("$value")
        index=$((index + 1))
      done
      ;;
    export|declare|typeset|local|readonly)
      split_shell_words_into words "$raw"
      [[ "$verb" == export ]] && exports=1
      # A -x declaration exports its assignments to a later git just as export does; a plain declaration stays shell-local.
      for word in "${words[@]}"; do
        [[ "$word" == -* && "$word" == *x* ]] && exports=1
      done
      [[ "$exports" -eq 1 ]] || return 0
      for word in "${words[@]}"; do
        [[ "$word" == -* || "$word" == +* ]] && continue
        [[ "${word##*/}" == "$verb" ]] && continue
        if [[ "$word" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
          name="${BASH_REMATCH[1]}"
          value="${BASH_REMATCH[2]}"
          git_command_environment_variable_name "$name" && hosted+=("$value")
        fi
      done
      ;;
    *)
      return 0
      ;;
  esac
  local payload output hosted_status
  for payload in "${hosted[@]}"; do
    [[ -n "$payload" ]] || continue
    if output=$(check_command_segments "$payload" $((depth + 1))); then
      # A structured provider returns its denial with exit zero; preserve that decision unchanged.
      if [[ -n "$output" ]]; then printf '%s\n' "$output"; exit 0; fi
    else
      hosted_status=$?
      # A delivered stderr denial ends the parent instead of becoming a second unavailable-result message.
      [[ "$hosted_status" -eq 2 ]] && exit 2
      return "$hosted_status"
    fi
  done
  return 0
}

# Visible Git config environment assignments are not inherited by the hook's read-only alias lookup.
# Refuse the unresolved configuration before normalizing away the assignments or export command.
visible_git_config_environment_is_unresolved() {
  local raw="$1" verb="$2"
  local -a words=()
  local word name value saw_declaration=0 declaration_exports=0 scan_after_verb=0
  # An earlier chained segment relocated Git's configuration source, so this Git action is also unresolved.
  if [[ "${__goat_git_config_env_unresolved:-0}" -eq 1 &&
        ( "$verb" == git || "$verb" == git-* ||
          "$verb" == bash || "$verb" == sh || "$verb" == zsh || "$verb" == dash ||
          "$verb" == find || "$verb" == xargs || "$verb" == parallel ) ]]; then
    return 0
  fi
  split_shell_words_into words "$raw"
  # Bash's declare/typeset/local -x exports assignments just like export; a plain declaration stays local to the shell.
  if [[ "$verb" == declare || "$verb" == typeset || "$verb" == local ]]; then
    for word in "${words[@]}"; do
      if [[ "$saw_declaration" -eq 0 ]]; then
        [[ "${word##*/}" == "$verb" ]] && saw_declaration=1
        continue
      fi
      case "$word" in
        --) ;;
        -*) [[ "$word" == -*x* ]] && declaration_exports=1 ;;
        +*) ;;
        *) break ;;
      esac
    done
  fi
  [[ "$verb" == export || "$declaration_exports" -eq 1 ]] && scan_after_verb=1
  for word in "${words[@]}"; do
    # A command argument can quote the same text as inert data; only prefixes affect the process environment.
    if [[ -n "$verb" && "$scan_after_verb" -eq 0 && "${word##*/}" == "$verb" ]]; then
      break
    fi
    if [[ "$word" =~ ^(GIT_CONFIG_(COUNT|PARAMETERS|KEY_[0-9]+|VALUE_[0-9]+|GLOBAL|SYSTEM))=(.*)$ ]]; then
      name="${BASH_REMATCH[1]}"
      value="${BASH_REMATCH[3]}"
      case "$name" in
        GIT_CONFIG_COUNT) [[ "$value" == 0 ]] || return 0 ;;
        GIT_CONFIG_PARAMETERS|GIT_CONFIG_GLOBAL|GIT_CONFIG_SYSTEM) [[ -z "$value" ]] || return 0 ;;
        *) return 0 ;;
      esac
    elif [[ "$word" =~ ^(HOME|XDG_CONFIG_HOME|GIT_DIR|GIT_COMMON_DIR)\+?= &&
            ( "$scan_after_verb" -eq 1 || "$verb" == git || "$verb" == git-* ||
              "$verb" == bash || "$verb" == sh || "$verb" == zsh || "$verb" == dash ||
              "$verb" == find || "$verb" == xargs || "$verb" == parallel ) ]]; then
      # The hook cannot use its own environment to prove which aliases or executable settings Git will load.
      return 0
    fi
  done
  return 1
}

# Reveal the executable after timing and output options so measured commands receive ordinary policy checks.
normalize_time_prefix() {
  local c="$1"

  # Skip supported timing settings until the measured executable can receive its policy check.
  while true; do
    c="${c#"${c%%[![:space:]]*}"}"

    # Timing display flags do not change which guarded command the agent would execute.
    if [[ "$c" =~ ^(--portability|--verbose|--quiet|--append|-p|-v|-q|-a)[[:space:]]+ ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    # An attached timing format or output setting is wrapper data; the remaining executable still needs inspection.
    if [[ "$c" =~ ^(--format|--output)= ]]; then
      c=$(drop_first_shell_word "$c")
      continue
    fi
    # A separated timing format or output setting consumes its quoted value before the executable begins.
    if [[ "$c" =~ ^(--format|--output|-f|-o)[[:space:]]+ ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      c=$(drop_first_shell_word "$c")
      continue
    fi
    # Attached short timing values belong to wrapper settings rather than the command being measured.
    if [[ "$c" =~ ^(-f|-o)[^[:space:]]+[[:space:]]* ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    # The timing option terminator leaves the remaining executable ready for ordinary policy inspection.
    if [[ "$c" =~ ^--[[:space:]]+ ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    break
  done

  printf '%s' "$c"
}

# Reveal the executable after sudo options so elevated commands receive the same policy as direct commands.
normalize_sudo_prefix() {
  local c="$1"
  # Skip recognized privilege-wrapper settings until the elevated executable becomes visible to the policy.
  while true; do
    c="${c#"${c%%[![:space:]]*}"}"
    # Privilege options consume their separated identity, folder or timeout value before the executable begins.
    if [[ "$c" =~ ^-[ugCDRTp][[:space:]]+[^[:space:]]+[[:space:]]* ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    # Attached privilege option values configure sudo and must not conceal the remaining executable.
    if [[ "$c" =~ ^-[ugCDRTp][^[:space:]-]+[[:space:]]* ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    # Long privilege option values configure the wrapper; elevated commands still receive the ordinary policy check.
    if [[ "$c" =~ ^--(user|group|close-from|chdir|role|type|other-user|prompt|command-timeout|preserve-env)=[^[:space:]]*[[:space:]]* ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    # Short privilege flags change wrapper behavior without removing policy checks from the child command.
    if [[ "$c" =~ ^-[AbeEHhiKknPSsV]+[[:space:]]* ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    # Long privilege flags configure the wrapper without granting the child command a policy exemption.
    if [[ "$c" =~ ^--(askpass|background|bell|edit|preserve-env|set-home|help|login|list|remove-timestamp|reset-timestamp|non-interactive|stdin|shell|validate|version)[[:space:]]* ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    # The privilege option terminator exposes the executable that still requires policy inspection.
    if [[ "$c" =~ ^--[[:space:]]+ ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
    fi
    break
  done
  printf '%s' "$c"
}

# Identify an I/O operand that cannot safely serve as the executable revealed by a wrapper.
word_starts_with_redirection() {
  local redirection_re='^([0-9]+)?[<>]'
  [[ "$1" =~ $redirection_re ]]
}

# Reveal a supported exec payload; uncertain option arity must fail closed at the caller.
normalize_exec_prefix() {
  local c="$1"
  local -a words=()
  split_shell_words_into words "$c"
  local i=0
  local word=""
  # Walk supported exec options until the launched command is visible to policy checks.
  while [[ "$i" -lt "${#words[@]}" ]]; do
    word="${words[$i]}"
    case "$word" in
      --)
        i=$((i + 1))
        break
        ;;
      -a)
        [[ $((i + 1)) -lt "${#words[@]}" ]] || return 2
        i=$((i + 2))
        continue
        ;;
      -*)
        # Recognized exec flags change the launch environment; unfamiliar flags leave the original action unnormalized for review.
        if [[ "$word" =~ ^-[cl]+$ ]]; then
          i=$((i + 1))
          continue
        fi
        return 2
        ;;
    esac
    break
  done
  [[ "$i" -lt "${#words[@]}" ]] || return 1
  word="${words[$i]}"
  word_starts_with_redirection "$word" && return 1
  join_shell_words_from words "$i"
}

# Reveal the command after timeout options and duration; uncertain option arity must fail closed at the caller.
normalize_timeout_prefix() {
  local c="$1"
  local -a words=()
  split_shell_words_into words "$c"
  local i=0
  local word=""
  # Walk supported timeout options until the launched command is visible to policy checks.
  while [[ "$i" -lt "${#words[@]}" ]]; do
    word="${words[$i]}"
    case "$word" in
      --)
        i=$((i + 1))
        break
        ;;
      -s|-k|--signal|--kill-after)
        [[ $((i + 1)) -lt "${#words[@]}" ]] || return 2
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
        return 2
        ;;
    esac
    break
  done
  [[ "$i" -lt "${#words[@]}" ]] || return 1
  i=$((i + 1)) # DURATION
  [[ "$i" -lt "${#words[@]}" ]] || return 1
  join_shell_words_from words "$i"
}

# Reveal a supported session-launch command so a new session cannot conceal the guarded executable.
normalize_setsid_prefix() {
  local c="$1"
  local -a words=()
  split_shell_words_into words "$c"
  local i=0
  local word=""
  # Walk supported setsid options until the launched command is visible to policy checks.
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
        # Recognized session flags change launch behavior; unfamiliar flags leave the original action visible for review.
        if [[ "$word" =~ ^-[cfw]+$ ]]; then
          i=$((i + 1))
          continue
        fi
        return 2
        ;;
    esac
    break
  done
  [[ "$i" -lt "${#words[@]}" ]] || return 1
  join_shell_words_from words "$i"
}

# Reveal the command after stream-buffer settings so output buffering does not change policy classification.
normalize_stdbuf_prefix() {
  local c="$1"
  local -a words=()
  split_shell_words_into words "$c"
  local i=0
  local word=""
  # Walk supported stdbuf options until the launched command is visible to policy checks.
  while [[ "$i" -lt "${#words[@]}" ]]; do
    word="${words[$i]}"
    case "$word" in
      --)
        i=$((i + 1))
        break
        ;;
      -i|-o|-e|--input|--output|--error)
        [[ $((i + 1)) -lt "${#words[@]}" ]] || return 2
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
        return 2
        ;;
    esac
    break
  done
  [[ "$i" -lt "${#words[@]}" ]] || return 1
  join_shell_words_from words "$i"
}

# Reveal a newly launched command after I/O scheduling options; existing-process forms supply no launch payload.
normalize_ionice_prefix() {
  local c="$1"
  local -a words=()
  split_shell_words_into words "$c"
  local i=0
  local word=""
  # Walk supported ionice options until the launched command is visible to policy checks.
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
        [[ $((i + 1)) -lt "${#words[@]}" ]] || return 2
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
        return 2
        ;;
    esac
    break
  done
  [[ "$i" -lt "${#words[@]}" ]] || return 1
  join_shell_words_from words "$i"
}

# Reveal a newly launched command after CPU selection; existing-process forms supply no launch payload.
normalize_taskset_prefix() {
  local c="$1"
  local -a words=()
  split_shell_words_into words "$c"
  local i=0
  local word=""
  # Walk supported taskset options until the launched command is visible to policy checks.
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
        return 2
        ;;
    esac
    break
  done
  [[ "$i" -lt "${#words[@]}" ]] || return 1
  i=$((i + 1)) # CPU mask/list
  [[ "$i" -lt "${#words[@]}" ]] || return 1
  join_shell_words_from words "$i"
}

# Reveal a newly launched command after scheduling policy and priority; existing-process forms supply no launch payload.
normalize_chrt_prefix() {
  local c="$1"
  local -a words=()
  split_shell_words_into words "$c"
  local i=0
  local word=""
  # Walk supported chrt options until the launched command is visible to policy checks.
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
        [[ $((i + 1)) -lt "${#words[@]}" ]] || return 2
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
        return 2
        ;;
    esac
    break
  done
  [[ "$i" -lt "${#words[@]}" ]] || return 1
  i=$((i + 1)) # priority
  [[ "$i" -lt "${#words[@]}" ]] || return 1
  join_shell_words_from words "$i"
}

# Reveal the executable or explicit command string protected by a lock; incomplete lock-only forms supply no launch payload.
normalize_flock_prefix() {
  local c="$1"
  local -a words=()
  split_shell_words_into words "$c"
  local i=0
  local word=""
  # Walk supported flock options until the launched command is visible to policy checks.
  while [[ "$i" -lt "${#words[@]}" ]]; do
    word="${words[$i]}"
    case "$word" in
      --)
        i=$((i + 1))
        break
        ;;
      -c|--command)
        [[ $((i + 1)) -lt "${#words[@]}" ]] || return 2
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
        [[ $((i + 1)) -lt "${#words[@]}" ]] || return 2
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
        return 2
        ;;
    esac
    break
  done
  [[ "$i" -lt "${#words[@]}" ]] || return 1
  # A descriptor-only lock request has no child command whose action this wrapper parser can reveal.
  if [[ "${words[$i]}" =~ ^[0-9]+$ && $((i + 1)) -ge "${#words[@]}" ]]; then
    return 1
  fi
  i=$((i + 1)) # lock file/dir or fd
  [[ "$i" -lt "${#words[@]}" ]] || return 1
  # An explicit locked command string is the action to classify rather than the lock file itself.
  if [[ "${words[$i]}" == "-c" || "${words[$i]}" == "--command" ]]; then
    [[ $((i + 1)) -lt "${#words[@]}" ]] || return 2
    printf '%s' "${words[$((i + 1))]}"
    return 0
  fi
  join_shell_words_from words "$i"
}

# Keep shell redirections out of the API request so developers can save read-only GitHub evidence to a file.
# Use before decoding gh arguments; unresolved redirect syntax returns failure instead of guessing the request.
strip_shell_redirections() {
  local command_text="$1" request_words="" character quote="" escaped=0 cursor=0 word_start=0 descriptor_prefix remaining_command
  # Preserve quoted request data while separating where the developer sends command output.
  while [[ "$cursor" -lt "${#command_text}" ]]; do
    character="${command_text:cursor:1}"
    # Quoted or escaped operators belong to the developer's argument, such as a search for the literal greater-than sign.
    if [[ "$escaped" -eq 1 ]]; then
      request_words+="$character"; escaped=0
    elif [[ "$quote" != "'" && "$character" == "\\" ]]; then
      request_words+="$character"; escaped=1
    elif [[ -n "$quote" ]]; then
      request_words+="$character"
      [[ "$character" == "$quote" ]] && quote=""
    elif [[ "$character" == "'" || "$character" == '"' ]]; then
      quote="$character"; request_words+="$character"
    elif [[ "$character" == '<' || "$character" == '>' || "${command_text:cursor:2}" == '&>' ]]; then
      descriptor_prefix="${request_words:word_start}"
      # A descriptor such as 2 belongs to stderr redirection; a quoted number remains an API argument.
      if [[ "$descriptor_prefix" =~ ^[0-9]+$ ]]; then request_words="${request_words:0:word_start}"; fi
      remaining_command="${command_text:cursor}"
      # Here-documents and process substitutions need their owning parser, not a filename guess.
      [[ "$remaining_command" != '<<'* && "$remaining_command" != '<('* && "$remaining_command" != '>('* ]] || return 2
      # Consume the complete redirect operator before skipping the developer's filename or descriptor target.
      if [[ "$remaining_command" == '&>>'* ]]; then remaining_command="${remaining_command:3}"
      elif [[ "$remaining_command" == '>>'* || "$remaining_command" == '>&'* || "$remaining_command" == '<&'* || "$remaining_command" == '<>'* || "$remaining_command" == '>|'* || "$remaining_command" == '&>'* ]]; then remaining_command="${remaining_command:2}"
      else remaining_command="${remaining_command:1}"; fi
      remaining_command="${remaining_command#"${remaining_command%%[![:space:]]*}"}"
      [[ -n "$remaining_command" ]] || return 2
      remaining_command=$(drop_first_shell_word "$remaining_command")
      command_text="$remaining_command"; cursor=0; request_words+=' '; word_start=${#request_words}
      continue
    else
      request_words+="$character"
      [[ "$character" =~ [[:space:]] ]] && word_start=${#request_words}
    fi
    cursor=$((cursor + 1))
  done
  [[ -z "$quote" && "$escaped" -eq 0 ]] || return 2
  printf '%s' "$request_words"
}

# Reveal the command a user would actually run after supported wrappers and dispatchers.
# Use before every policy module so equivalent command shapes receive the same verdict.
normalize_command_candidate() {
  local c="$1"
  local stripped=""
  local word=""
  local base=""
  local after_word=""
  local xargs_prefix=""
  local case_arm_re='^case[[:space:]][^)]*\)[[:space:]]*'

  # Peel supported wrappers repeatedly so nested launch syntax cannot conceal the command the agent would actually run.
  while true; do
    c="${c#"${c%%[![:space:]]*}"}"

    # Remove leading redirections before identifying the program the user's command would run.
    # Redirections change input/output, so treating one as CMD_VERB would hide the real rm, Git, find or sudo command from policy checks.
    if stripped=$(strip_leading_shell_redirections "$c"); then
      c="$stripped"
      continue
    fi

    word="${c%%[[:space:]]*}"
    # Plain command words are already normalized; inspect quotes, escapes, and IFS expansion to reveal the executable.
    if [[ "$word" == *\'* || "$word" == *\"* || "$word" == *\\* || "$word" == *"\$IFS"* || "$word" == *"\${IFS}"* ]]; then
      c=$(normalize_leading_command_word "$c") || return $?
    fi

    # `!` changes only the pipeline's exit status; reveal the command it negates.
    if [[ "$c" =~ ^\![[:space:]]+ ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    # A subshell opener wraps the action without changing its command policy; expose its interior for inspection.
    if [[ "$c" == \(* ]]; then
      c="${c#\(}"
      continue
    fi
    # A command-group opener wraps executable actions; the contained command still requires ordinary policy inspection.
    if [[ "$c" == \{* ]]; then
      c="${c#\{}"
      continue
    fi
    # A case-arm label selects a branch but does not exempt its contained executable action from policy.
    if [[ "$c" =~ $case_arm_re ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    # A named coprocess wrapper starts another executable action; expose that command before applying policy.
    if [[ "$c" =~ ^coproc[[:space:]]+[a-zA-Z_][a-zA-Z0-9_]*[[:space:]]+\{[[:space:]]* ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    # A coprocess keyword precedes the action that still needs the same checks as a direct command.
    if [[ "$c" =~ ^coproc[[:space:]]+ ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    # Control-flow keywords organize proposed actions; inspect the executable command after the keyword.
    if [[ "$c" =~ ^(then|do|else|if|elif|while|until|in)[[:space:]]+ ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    # A function declaration can carry guarded commands in its body, so expose the body for inspection.
    if [[ "$c" =~ ^[a-zA-Z_][a-zA-Z0-9_]*[[:space:]]*\(\)[[:space:]]*\{[[:space:]]* ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    # Alternate function-declaration syntax also carries executable body text that must receive policy checks.
    if [[ "$c" =~ ^function[[:space:]]+[a-zA-Z_][a-zA-Z0-9_]*([[:space:]]*\(\))?[[:space:]]*\{[[:space:]]* ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      continue
    fi
    # The command builtin changes lookup behavior without exempting the executable that follows it.
    if [[ "$c" =~ ^command[[:space:]]+ ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      c="${c#"${c%%[![:space:]]*}"}"
      # Command-lookup options are wrapper settings; the remaining word identifies the action to inspect.
      while [[ "$c" =~ ^(-p|--)[[:space:]]+ ]]; do
        c="${c#"${BASH_REMATCH[0]}"}"
      done
      continue
    fi
    # The builtin keyword selects a shell builtin whose action still needs ordinary policy classification.
    if [[ "$c" =~ ^builtin[[:space:]]+ ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      c="${c#"${c%%[![:space:]]*}"}"
      # Bash accepts `--` before a builtin name; it does not make the builtin inert.
      if [[ "$c" =~ ^--([[:space:]]+|$) ]]; then
        c="${c#"${BASH_REMATCH[0]}"}"
      fi
      continue
    fi
    word="${c%%[[:space:]]*}"
    base="${word##*/}"
    # Timing and hangup wrappers do not change the child action, so reveal its executable before classification.
    if [[ "$base" == "time" || "$base" == "nohup" ]]; then
      c="${c#"$word"}"
      c="${c#"${c%%[![:space:]]*}"}"
      # Timing options precede the measured command and must not become its apparent executable name.
      if [[ "$base" == "time" ]]; then
        c=$(normalize_time_prefix "$c")
      fi
      continue
    fi
    # Priority adjustment wraps the proposed action without granting it a policy exemption.
    if [[ "$base" == "nice" ]]; then
      c="${c#"$word"}"
      c="${c#"${c%%[![:space:]]*}"}"
      # Nice accepts repeated priority options, including attached -n values.
      local -a nice_words=()
      split_shell_words_into nice_words "$c"
      local nice_index=0 nice_word=""
      while [[ "$nice_index" -lt "${#nice_words[@]}" ]]; do
        nice_word="${nice_words[$nice_index]}"
        case "$nice_word" in
          --) nice_index=$((nice_index + 1)); break ;;
          -n|--adjustment)
            [[ $((nice_index + 1)) -lt "${#nice_words[@]}" ]] || return 2
            nice_index=$((nice_index + 2))
            ;;
          -n?*|--adjustment=*|-[0-9]*)
            nice_index=$((nice_index + 1))
            ;;
          --help|--version)
            printf '%s' "nice $c"
            return 0
            ;;
          -*) return 2 ;;
          *) break ;;
        esac
      done
      c=$(join_shell_words_from nice_words "$nice_index")
      continue
    fi
    # Privilege elevation wraps the action but does not authorize an otherwise guarded command.
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
        # A supported exec wrapper reveals its child action for the same policy checks as a direct command.
        if stripped=$(normalize_exec_prefix "$after_word"); then
          c="$stripped"
          continue
        else
          [[ $? -ne 2 ]] || return 2
        fi
        ;;
      timeout)
        # A supported timeout wrapper reveals its child action for the same policy checks as a direct command.
        if stripped=$(normalize_timeout_prefix "$after_word"); then
          c="$stripped"
          continue
        else
          [[ $? -ne 2 ]] || return 2
        fi
        ;;
      setsid)
        # A supported setsid wrapper reveals its child action for the same policy checks as a direct command.
        if stripped=$(normalize_setsid_prefix "$after_word"); then
          c="$stripped"
          continue
        else
          [[ $? -ne 2 ]] || return 2
        fi
        ;;
      stdbuf)
        # A supported stdbuf wrapper reveals its child action for the same policy checks as a direct command.
        if stripped=$(normalize_stdbuf_prefix "$after_word"); then
          c="$stripped"
          continue
        else
          [[ $? -ne 2 ]] || return 2
        fi
        ;;
      ionice)
        # A supported ionice wrapper reveals its child action for the same policy checks as a direct command.
        if stripped=$(normalize_ionice_prefix "$after_word"); then
          c="$stripped"
          continue
        else
          [[ $? -ne 2 ]] || return 2
        fi
        ;;
      taskset)
        # A supported taskset wrapper reveals its child action for the same policy checks as a direct command.
        if stripped=$(normalize_taskset_prefix "$after_word"); then
          c="$stripped"
          continue
        else
          [[ $? -ne 2 ]] || return 2
        fi
        ;;
      chrt)
        # A supported chrt wrapper reveals its child action for the same policy checks as a direct command.
        if stripped=$(normalize_chrt_prefix "$after_word"); then
          c="$stripped"
          continue
        else
          [[ $? -ne 2 ]] || return 2
        fi
        ;;
      flock)
        # A supported flock wrapper reveals its child action for the same policy checks as a direct command.
        if stripped=$(normalize_flock_prefix "$after_word"); then
          c="$stripped"
          continue
        else
          [[ $? -ne 2 ]] || return 2
        fi
        ;;
      xargs)
        # Normalize the child while retaining the outer xargs options and stdin
        # target semantics. Returning the original child hides nested wrappers.
        if stripped=$(strip_xargs_payload_command "$c"); then
          [[ -n "$xargs_prefix" ]] || xargs_prefix="${c:0:${#c}-${#stripped}}"
          c="$stripped"
          continue
        else
          [[ $? -ne 2 ]] || return 2
        fi
        ;;
      watch)
        # Reveal the repeated command so users cannot hide a blocked action behind watch.
        if stripped=$(strip_watch_payload_command "$c"); then
          c="$stripped"
          continue
        else
          [[ $? -ne 2 ]] || return 2
        fi
        ;;
      parallel)
        # Reveal the repeated command so parallel receives the same policy as a direct call.
        if stripped=$(strip_parallel_payload_command "$c"); then
          c="$stripped"
          continue
        else
          [[ $? -ne 2 ]] || return 2
        fi
        ;;
    esac
    # The parser cannot strip anything unless the command starts with a NAME=value or NAME+=value assignment.
    if [[ "$c" =~ ^[a-zA-Z_][a-zA-Z0-9_]*\+?= ]] && stripped=$(strip_one_assignment_prefix "$c"); then
      c="$stripped"
      continue
    fi
    # Environment settings precede the executable; inspect that executable after supported env syntax is removed.
    if [[ "$c" =~ ^env([[:space:]]|$) ]]; then
      c="${c#env}"
      c=$(normalize_env_prefix "$c") || return 2
      continue
    fi
    # A path-qualified env wrapper receives the same normalization as its ordinary command-name spelling.
    if [[ "$c" =~ ^(/usr)?/bin/env([[:space:]]|$) ]]; then
      c="${c#"${BASH_REMATCH[0]}"}"
      c=$(normalize_env_prefix "$c") || return 2
      continue
    fi
    break
  done

  printf '%s' "$xargs_prefix$c"
}

# Split a developer's command at executable top-level boundaries before policy checks.
# Pipeline mode also separates real pipe stages while preserving quoted search text.
split_command_segments_into() {
  local -n __goat_split_out__="$1"
  local developer_command="$2"
  local split_pipeline_stages="${3:-0}"
  local background_output_name="${4:-}"
  __goat_split_out__=()
  local current_policy_stage=""
  local command_character=""
  local next_command_character=""
  local previous_command_character=""
  local in_single_quote=0
  local in_double_quote=0
  local previous_character_escaped=0
  local command_substitution_depth=0
  local command_index=0

  # Each character extends the stage the developer submitted or closes a real shell boundary.
  for ((command_index = 0; command_index < ${#developer_command}; command_index++)); do
    command_character="${developer_command:command_index:1}"

    # An escaped character is user data, so a protected-looking pipe stays inside the current stage.
    if [[ "$previous_character_escaped" -eq 1 ]]; then
      current_policy_stage+="$command_character"
      previous_character_escaped=0
      continue
    fi

    # Outside single quotes, a backslash protects the user's next search or path character.
    if [[ "$in_single_quote" -eq 0 && "$command_character" == "\\" ]]; then
      current_policy_stage+="$command_character"
      previous_character_escaped=1
      continue
    fi

    # Double-quoted text remains one user value instead of becoming executable pipeline stages.
    if [[ "$in_single_quote" -eq 0 && "$command_character" == '"' ]]; then
      # Closing quotes return later shell operators to executable policy scope.
      if [[ "$in_double_quote" -eq 1 ]]; then
        in_double_quote=0
      else
        in_double_quote=1
      fi
      current_policy_stage+="$command_character"
      continue
    fi

    # Single-quoted patterns remain search data even when they name protected operations.
    if [[ "$in_double_quote" -eq 0 && "$command_character" == "'" ]]; then
      # Closing quotes return later shell operators to executable policy scope.
      if [[ "$in_single_quote" -eq 1 ]]; then
        in_single_quote=0
      else
        in_single_quote=1
      fi
      current_policy_stage+="$command_character"
      continue
    fi

    # Only unquoted operators can change what the agent would execute for the developer.
    if [[ "$in_single_quote" -eq 0 && "$in_double_quote" -eq 0 ]]; then
      next_command_character="${developer_command:command_index+1:1}"

      # Command/process substitution openers are checked recursively, so inner pipes stay out of this stage list.
      if [[ "$next_command_character" == '(' ]] &&
         [[ "$command_character" == '$' || "$command_character" == '<' || "$command_character" == '>' ]]; then
        current_policy_stage+="$command_character$next_command_character"
        command_substitution_depth=$((command_substitution_depth + 1))
        command_index=$((command_index + 1))
        continue
      fi

      # Inner substitution operators stay together until the recursive policy pass evaluates them.
      if [[ "$command_substitution_depth" -gt 0 ]]; then
        # Nested parentheses keep the substitution open until its matching close.
        if [[ "$command_character" == '(' ]]; then
          command_substitution_depth=$((command_substitution_depth + 1))
        # The matching close lets subsequent outer operators affect the developer's command.
        elif [[ "$command_character" == ')' ]]; then
          command_substitution_depth=$((command_substitution_depth - 1))
        fi
        current_policy_stage+="$command_character"
        continue
      fi

      # Command-list operators start a new action without creating empty pipeline stages.
      if [[ "$command_character$next_command_character" == "&&" ||
            "$command_character$next_command_character" == "||" ]]; then
        __goat_split_out__+=("$current_policy_stage")
        current_policy_stage=""
        command_index=$((command_index + 1))
        continue
      fi

      # A real top-level pipe exposes the next executable stage to repository policy.
      if [[ "$split_pipeline_stages" -eq 1 && "$command_character" == "|" ]]; then
        __goat_split_out__+=("$current_policy_stage")
        current_policy_stage=""
        # Bash's |& operator pipes stderr too; its ampersand belongs to the
        # operator and must not hide the next executable behind a leading ampersand.
        if [[ "$next_command_character" == "&" ]]; then
          command_index=$((command_index + 1))
        fi
        continue
      fi

      # A bare ampersand starts a background action. Redirection and stderr-pipe
      # ampersands stay with their operator.
      if [[ "$command_character" == "&" && "$next_command_character" != ">" ]]; then
        previous_command_character=""
        # The character before an ampersand distinguishes a background action from an I/O operator.
        if [[ "$command_index" -gt 0 ]]; then
          previous_command_character="${developer_command:command_index-1:1}"
        fi
        # A true background separator starts another executable action; descriptor and stderr-pipe ampersands stay with their operator.
        if [[ "$previous_command_character" != ">" &&
              "$previous_command_character" != "<" &&
              "$previous_command_character" != "|" ]]; then
          # The directory tracker needs the same quote-aware decision as this splitter.
          if [[ -n "$background_output_name" ]]; then
            printf -v "$background_output_name" '%s' 1
          fi
          __goat_split_out__+=("$current_policy_stage")
          current_policy_stage=""
          continue
        fi
      fi

      # Semicolons and newlines start the next action the agent wants to run.
      if [[ "$command_character" == ";" || "$command_character" == $'\n' ]]; then
        __goat_split_out__+=("$current_policy_stage")
        current_policy_stage=""
        continue
      fi
    fi

    current_policy_stage+="$command_character"
  done

  __goat_split_out__+=("$current_policy_stage")
}

# Split a proposed shell command into the real pipeline stages repository policy must inspect.
# Use it when quoted or escaped pipes may be search text rather than executable boundaries.
split_top_level_pipeline_stages_into() {
  split_command_segments_into "$1" "$2" 1
}

# Return a policy denial through the invoking provider channel so the agent stops and the user sees the reason.
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

# Finish an allowed policy check using the provider continuation contract; this result supplies no proof of a completed safety scan.
allow() {
  # Antigravity requires an explicit allow envelope so its agent can continue after this policy check.
  if [[ "$OUTPUT_MODE" == "antigravity-json" ]]; then
    printf '{"decision":"allow"}
'
  fi
  exit 0
}

# Remove actual shell comments while preserving quoted search text so prose cannot create false policy matches.
strip_unquoted_shell_comments() {
  local input="$1"
  local out=""
  local char=""
  local previous=""
  local in_single=0
  local in_double=0
  local escaped=0
  local i=0

  # Read command quoting before removing comments so literal search data cannot disappear from policy context.
  for ((i = 0; i < ${#input}; i++)); do
    char="${input:i:1}"

    # An escaped character stays literal so quotes or separators in an argument cannot change the inspected command boundary.
    if [[ "$escaped" -eq 1 ]]; then
      out+="$char"
      escaped=0
      previous="$char"
      continue
    fi

    # Outside single quotes, an escape protects the next character from becoming a command or argument boundary.
    if [[ "$in_single" -eq 0 && "$char" == "\\" ]]; then
      out+="$char"
      escaped=1
      previous="$char"
      continue
    fi

    # Single-quoted text belongs to a literal operand, so its separators and substitution markers cannot become executable actions.
    if [[ "$in_double" -eq 0 && "$char" == "'" ]]; then
      # Closing a single-quoted operand returns inspection to the surrounding command context.
      if [[ "$in_single" -eq 1 ]]; then
        in_single=0
      else
        in_single=1
      fi
      out+="$char"
      previous="$char"
      continue
    fi

    # Double quotes preserve an argument boundary while still allowing executable command substitutions to be inspected.
    if [[ "$in_single" -eq 0 && "$char" == '"' ]]; then
      # Closing double quotes restores the surrounding word boundaries for the proposed action.
      if [[ "$in_double" -eq 1 ]]; then
        in_double=0
      else
        in_double=1
      fi
      out+="$char"
      previous="$char"
      continue
    fi

    # Only an unquoted hash can begin a shell comment; quoted hashes remain part of the user's argument.
    if [[ "$in_single" -eq 0 && "$in_double" -eq 0 && "$char" == "#" ]]; then
      # A hash at a word boundary starts nonexecuting prose; a hash inside a command word remains inspectable text.
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

# Remove subshell parentheses from one segment so `(git push)` and `(cd x && cat .env)` reach policy as plain commands.
# Segment splitting leaves the opener on the first command and the closer on the last; the result is in __goat_subshell_stripped.
strip_subshell_parentheses() {
  local text="$1"
  text="${text#"${text%%[![:space:]]*}"}"
  # A leading opener only groups the command; a `$(` substitution starts with `$` and keeps its parentheses.
  while [[ "$text" == \(* ]]; do
    text="${text#\(}"
    text="${text#"${text%%[![:space:]]*}"}"
  done
  # An unmatched closer belongs to an enclosing subshell, even when redirections follow it.
  while has_unmatched_closing_parenthesis "$text"; do
    text="${text:0:__goat_subshell_closer_index} ${text:__goat_subshell_closer_index+1}"
  done
  __goat_subshell_stripped="${text%"${text##*[![:space:]]}"}"
}

# Find an unmatched closer outside quotes and escapes; return its position in __goat_subshell_closer_index.
has_unmatched_closing_parenthesis() {
  local text="$1"
  __goat_subshell_closer_index=-1
  local depth=0
  local in_single=0
  local in_double=0
  local escaped=0
  local i char
  for ((i = 0; i < ${#text}; i++)); do
    char="${text:i:1}"
    # An escaped character is literal text, never a grouping parenthesis.
    if [[ "$escaped" -eq 1 ]]; then
      escaped=0
      continue
    fi
    if [[ "$in_single" -eq 0 && "$char" == "\\" ]]; then
      escaped=1
      continue
    fi
    # Quoted parentheses are argument data, such as a commit message or search pattern.
    if [[ "$in_double" -eq 0 && "$char" == "'" ]]; then
      in_single=$((1 - in_single))
      continue
    fi
    if [[ "$in_single" -eq 0 && "$char" == '"' ]]; then
      in_double=$((1 - in_double))
      continue
    fi
    [[ "$in_single" -eq 1 || "$in_double" -eq 1 ]] && continue
    if [[ "$char" == "(" ]]; then
      depth=$((depth + 1))
    elif [[ "$char" == ")" ]]; then
      depth=$((depth - 1))
      if [[ "$depth" -lt 0 ]]; then
        __goat_subshell_closer_index="$i"
        return 0
      fi
    fi
  done
  return 1
}

# Prepare one shared view of a user-visible command segment for every policy module.
# Use once per segment so shell, secret, and repository checks classify identical text.
prepare_segment_context() {
  local cmd="$1"
  local depth="${2:-0}"
  local policy_cmd
  local saved_cmd_trimmed saved_cmd_normalized saved_cmd_verb saved_cmd_unquoted saved_cmd_lower
  local saved_has_redirect saved_has_pipe

  # A command containing a hash needs quote-aware comment removal so search prose cannot create false blocks.
  if [[ "$cmd" == *"#"* ]]; then
    policy_cmd=$(strip_unquoted_shell_comments "$cmd")
  else
    # Match the comment parser's trailing trim without spawning its character scan.
    policy_cmd="${cmd%"${cmd##*[![:space:]]}"}"
  fi
  # Subshell parentheses stay attached to the first and last commands after segment splitting, so remove them first.
  if [[ "$policy_cmd" == *[\(\)]* ]]; then
    strip_subshell_parentheses "$policy_cmd"
    policy_cmd="$__goat_subshell_stripped"
  fi
  check_command_substitutions "$policy_cmd" "$depth" || return $?

  CMD_TRIMMED="${policy_cmd#"${policy_cmd%%[![:space:]]*}"}"
  if ! CMD_NORMALIZED=$(normalize_command_candidate "$CMD_TRIMMED"); then
    block "Cannot inspect command syntax; use a literal executable and supported wrapper options." || return $?
  fi
  CMD_VERB="${CMD_NORMALIZED%%[[:space:]]*}"
  CMD_VERB="${CMD_VERB##*/}"

  CMD_UNQUOTED="$policy_cmd"
  # Quoted spans are argument data for redirect and pipe detection; inspect executable operators outside those spans.
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

  # Every real pipeline stage executes independently. Check its complete policy,
  # not just uncertain options, without replacing the outer command's shared state.
  if [[ "$HAS_PIPE" -eq 1 ]]; then
    local -a wrapper_pipeline_stages=()
    local wrapper_pipeline_stage wrapper_pipeline_output
    split_top_level_pipeline_stages_into wrapper_pipeline_stages "$policy_cmd"
    # A pipe inside a nested construct is not another top-level stage.
    if [[ "${#wrapper_pipeline_stages[@]}" -gt 1 ]]; then
      for wrapper_pipeline_stage in "${wrapper_pipeline_stages[@]}"; do
        if wrapper_pipeline_output=$(check_command_segments "$wrapper_pipeline_stage" $((depth + 1))); then
          # JSON providers deny with exit 0. Forward that one decision and stop
          # the parent too; continuing would append another deny or an allow.
          if [[ -n "$wrapper_pipeline_output" ]]; then
            printf '%s\n' "$wrapper_pipeline_output"
            exit 0
          fi
        else
          return $?
        fi
      done
    fi
  fi

  local -a inline_shell_words=()
  local inner_c="" shell_index
  case "$CMD_VERB" in
    sh|bash|dash|ash|ksh|zsh)
      split_shell_words_into inline_shell_words "$CMD_NORMALIZED"
      for ((shell_index = 1; shell_index < ${#inline_shell_words[@]}; shell_index += 1)); do
        case "${inline_shell_words[$shell_index]}" in
          -o|+o) shell_index=$((shell_index + 1)) ;;
          -[a-zA-Z]*c*|-c)
            inner_c="${inline_shell_words[$((shell_index + 1))]:-}"
            local raw_shell_body="$CMD_NORMALIZED" drop_index
            for ((drop_index = 0; drop_index <= shell_index; drop_index += 1)); do
              raw_shell_body=$(drop_first_shell_word "$raw_shell_body")
            done
            if [[ "$raw_shell_body" == \$\'* ]]; then
              # The inert word parser retains the ANSI-C quote marker. Plain bodies
              # are inspectable; escape decoding needs direct, ordinary shell quoting.
              inner_c="${inner_c#\$}"
              if [[ "$inner_c" == *\\* ]]; then
                block "Cannot inspect ANSI-C escapes in shell code; use ordinary shell quoting." || return $?
              fi
            fi
            # Inspect statically supplied argv for the standard exec "$@" forwarding idiom.
            local inner_candidate
            local -a inner_words=()
            inner_candidate=$(normalize_command_candidate "$inner_c")
            split_shell_words_into inner_words "$inner_candidate"
            if [[ "${#inner_words[@]}" -eq 1 && ( "${inner_words[0]}" == "\$@" || "${inner_words[0]}" == "\${@}" ) ]]; then
              inner_c=""
              if (( shell_index + 3 < ${#inline_shell_words[@]} )); then
                printf -v inner_c '%q ' "${inline_shell_words[@]:shell_index+3}"
              fi
            elif [[ "$inner_c" =~ \$\{?[@*0-9] ]]; then
              # Data-only printing stays available; executable positional expansions require a directly inspectable command.
              if [[ ! "$inner_candidate" =~ ^(echo|printf)[[:space:]] || "$inner_c" == *';'* || "$inner_c" == *'|'* || "$inner_c" == *'&'* || "$inner_c" == *$'\n'* ]]; then
                block "Cannot inspect executable shell positional expansion; invoke the command directly." || return $?
              fi
            fi
            break ;;
          -*) ;;
          *) break ;;
        esac
      done ;;
  esac
  # Inline shell code executes inside the outer action, so its body must receive its own complete policy inspection.
  if [[ -n "$inner_c" ]]; then
    # An empty inline shell body contains no action; a nonempty body must pass the same checks as direct commands.
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

# Recognize direct inspection that cannot redirect or pipe output; modifying sed forms still require policy checks.
# shellcheck disable=SC2329 # -- Called by the policy modules sourced through GOAT_HOOK_LIB_DIR below.
is_unredirected_unpiped_read_only() {
  local cmd="$1"
  [[ "$HAS_REDIRECT" -eq 0 && "$HAS_PIPE" -eq 0 ]] || return 1
  case "$CMD_VERB" in
    grep|egrep|fgrep|rg|ag|ack|cat|head|tail|less|more|wc|file|diff|printf|echo|read|ls|stat|test)
      return 0 ;;
    sed)
      # Ordinary sed inspection remains available; in-place editing must continue through write-policy checks.
      if ! [[ "$cmd" =~ sed[[:space:]]+-[a-zA-Z]*i || "$cmd" =~ sed[[:space:]]+--in-place ]]; then
        return 0
      fi ;;
  esac
  return 1
}

# Carry a literal shell cd into later Git segments without executing the proposed command.
# Dynamic cd and directory-stack commands leave pathspec location uncertain until an absolute cd resolves it.
track_git_shell_directory() {
  local segment="$1"
  [[ "$segment" == *cd* || "$segment" == *pushd* || "$segment" == *popd* ]] || return 0
  local -a cd_words=()
  local word_index=0 target candidate inline_cdpath=0
  split_shell_words_into cd_words "$segment"
  while [[ "${cd_words[$word_index]:-}" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; do
    [[ "${cd_words[$word_index]}" == CDPATH=?* ]] && inline_cdpath=1
    word_index=$((word_index + 1))
  done
  case "${cd_words[$word_index]:-}" in
    pushd|popd) __goat_git_directory_unknown=1; return 0 ;;
    cd) word_index=$((word_index + 1)) ;;
    *) return 0 ;;
  esac
  if [[ "${__goat_git_chain_directory_ambiguous:-0}" -eq 1 ]]; then
    __goat_git_directory_unknown=1
    return 0
  fi
  while [[ "${cd_words[$word_index]:-}" == -L || "${cd_words[$word_index]:-}" == -P || "${cd_words[$word_index]:-}" == -- ]]; do
    word_index=$((word_index + 1))
  done
  if [[ "${#cd_words[@]}" -ne $((word_index + 1)) ]]; then
    __goat_git_directory_unknown=1
    return 0
  fi
  target="${cd_words[$word_index]}"
  if [[ -z "$target" || "$target" == "-" || "$target" == \~* || "$target" == *'$'* || "$target" == *'`'* ]]; then
    __goat_git_directory_unknown=1
    return 0
  fi
  if [[ "$target" == /* ]]; then
    candidate="$target"
    __goat_git_directory_unknown=0
  elif [[ "${__goat_git_directory_unknown:-0}" -eq 0 && "$inline_cdpath" -eq 0 && -z "${CDPATH-}" ]]; then
    candidate="$__goat_git_command_directory/$target"
  else
    __goat_git_directory_unknown=1
    return 0
  fi
  if [[ -d "$candidate" ]]; then
    __goat_git_command_directory="$candidate"
  else
    __goat_git_directory_unknown=1
  fi
}

# A chained segment can relocate Git's configuration source for every later command in the same shell.
# Record that so a following Git action is treated as unresolved even when the assignment and the command are separate segments.
track_git_config_environment() {
  local segment="$1"
  # Strip leading subshell and brace-group openers so an assignment inside a group is inspected like a top-level one.
  # A later git in the same group then sees the relocated config; an isolated group followed by git fails safe (denied).
  while [[ "$segment" == \(* || "$segment" == \{[[:space:]]* || "$segment" == \{ ]]; do
    segment="${segment#[\({]}"
    segment="${segment#"${segment%%[![:space:]]*}"}"
  done
  # Skip word-splitting unless a configuration-source variable name could appear.
  case "$segment" in
    *HOME*|*GIT_DIR*|*GIT_COMMON_DIR*|*GIT_CONFIG*) ;;
    *) return 0 ;;
  esac
  local -a words=()
  split_shell_words_into words "$segment"
  local index=0 base word prev saw_config_assignment=0
  # Consume every leading NAME=value or NAME+=value assignment, remembering whether any names a configuration source.
  while [[ "${words[$index]:-}" =~ ^([A-Za-z_][A-Za-z0-9_]*)\+?= ]]; do
    git_config_source_variable_name "${BASH_REMATCH[1]}" && saw_config_assignment=1
    index=$((index + 1))
  done
  # A bare assignment with no following command persists to later chained commands; a prefix assignment is scoped to its command.
  if [[ "$saw_config_assignment" -eq 1 && -z "${words[$index]:-}" ]]; then
    __goat_git_config_env_unresolved=1
    return 0
  fi
  base="${words[$index]:-}"
  base="${base##*/}"
  case "$base" in
    export)
      # export always sends its variables to child processes; an exported -x declaration is caught in the same segment instead.
      for word in "${words[@]:$((index + 1))}"; do
        [[ "$word" == -* || "$word" == +* ]] && continue
        if [[ "$word" =~ ^([A-Za-z_][A-Za-z0-9_]*)(=|$) ]] && git_config_source_variable_name "${BASH_REMATCH[1]}"; then
          __goat_git_config_env_unresolved=1
          return 0
        fi
      done
      ;;
    read|mapfile|readarray)
      # These builtins assign shell variables from input; a configuration-source target relocates Git config.
      for word in "${words[@]:$((index + 1))}"; do
        [[ "$word" == -* ]] && continue
        if git_config_source_variable_name "$word"; then
          __goat_git_config_env_unresolved=1
          return 0
        fi
      done
      ;;
    printf)
      # printf -v NAME (separate or attached, e.g. -vNAME) writes into a shell variable; a config-source target relocates Git config.
      prev=""
      for word in "${words[@]:$((index + 1))}"; do
        if [[ "$word" == -v?* ]] && git_config_source_variable_name "${word#-v}"; then
          __goat_git_config_env_unresolved=1
          return 0
        fi
        if [[ "$prev" == -v ]] && git_config_source_variable_name "$word"; then
          __goat_git_config_env_unresolved=1
          return 0
        fi
        prev="$word"
      done
      ;;
    for)
      # `for HOME in ...` reassigns the loop variable for every command in the loop body; an already-exported target relocates Git config.
      if git_config_source_variable_is_ambiently_exported "${words[$((index + 1))]:-}"; then
        __goat_git_config_env_unresolved=1
        return 0
      fi
      ;;
    declare|typeset|readonly|local)
      # declare/typeset/readonly/local keep an already-exported variable exported without -x, so a config-source target relocates Git config.
      # A -x flag exports every assignment, matching the export case; a plain declaration only reaches git for a name the shell already exports.
      local declares_export=0
      for word in "${words[@]:$((index + 1))}"; do
        [[ "$word" == -* && "$word" == *x* ]] && declares_export=1
      done
      for word in "${words[@]:$((index + 1))}"; do
        [[ "$word" == -* || "$word" == +* ]] && continue
        if [[ "$word" =~ ^([A-Za-z_][A-Za-z0-9_]*)(\+?=|$) ]] && git_config_source_variable_name "${BASH_REMATCH[1]}"; then
          if [[ "$declares_export" -eq 1 ]] || git_config_source_variable_is_ambiently_exported "${BASH_REMATCH[1]}"; then
            __goat_git_config_env_unresolved=1
            return 0
          fi
        fi
      done
      ;;
  esac
  return 0
}

# Inspect each executable action and its nested commands while preserving the selected policy and bounded parser work.
check_command_segments() {
  local input="$1"
  local depth="${2:-0}"
  local -a nested_segments=()
  local nested_segment directory_segment closing_segment
  local __goat_git_command_directory="${__goat_git_command_directory:-$PWD}"
  local __goat_git_directory_unknown="${__goat_git_directory_unknown:-0}"
  local __goat_git_config_env_unresolved="${__goat_git_config_env_unresolved:-0}"
  local __goat_git_chain_directory_ambiguous=0
  local -a git_directory_stack=()
  local -a git_directory_unknown_stack=()
  local -a git_config_unresolved_stack=()

  # Only the destructive-shell policy owns download-then-execute chain checks; Git policy retains its separate scope.
  if [[ "$GOAT_GUARD_SCOPE" == "deny-dangerous" ]] && declare -F check_command_chain_policy >/dev/null 2>&1; then
    check_command_chain_policy "$input" "$depth" || return $?
  fi

  # A backgrounded cd runs in a child shell. The splitter identifies real '&' operators without treating quoted data as one.
  split_command_segments_into nested_segments "$input" 0 __goat_git_chain_directory_ambiguous

  # Enforce the chain-count cap at nested depths too; splitting preserves substitution contents for this recursive inspection.
  # The main entry point already caps top-level commands, while this branch protects nested commands the user could execute.
  if (( depth > 0 && ${#nested_segments[@]} > 50 )); then
    block "Command has more than 50 chained segments; review and run manually if intended." || return $?
  fi

  # Every nonempty action in the proposed chain must pass policy before the agent can run the overall command.
  for nested_segment in "${nested_segments[@]}"; do
    nested_segment="${nested_segment#"${nested_segment%%[![:space:]]*}"}"
    nested_segment="${nested_segment%"${nested_segment##*[![:space:]]}"}"
    [[ -z "$nested_segment" ]] && continue
    directory_segment="$nested_segment"
    while [[ "$directory_segment" == \(* ]]; do
      git_directory_stack+=("$__goat_git_command_directory")
      git_directory_unknown_stack+=("$__goat_git_directory_unknown")
      # A subshell discards config-source assignments on close, so remember the pre-subshell state to restore.
      git_config_unresolved_stack+=("$__goat_git_config_env_unresolved")
      directory_segment="${directory_segment#\(}"
      directory_segment="${directory_segment#"${directory_segment%%[![:space:]]*}"}"
    done
    closing_segment="$directory_segment"
    if [[ "$directory_segment" == *\)* ]]; then
      strip_subshell_parentheses "$nested_segment"
      directory_segment="$__goat_subshell_stripped"
    fi
    check_segment "$nested_segment" "$depth" || return $?
    track_git_shell_directory "$directory_segment"
    track_git_config_environment "$directory_segment"
    if [[ "$closing_segment" == *\)* ]]; then
      while has_unmatched_closing_parenthesis "$closing_segment"; do
        if [[ "${#git_directory_stack[@]}" -gt 0 ]]; then
          __goat_git_command_directory="${git_directory_stack[-1]}"
          __goat_git_directory_unknown="${git_directory_unknown_stack[-1]}"
          unset 'git_directory_stack[-1]'
          unset 'git_directory_unknown_stack[-1]'
        fi
        # Leaving the subshell restores the config-source state it could not persist to the enclosing shell.
        if [[ "${#git_config_unresolved_stack[@]}" -gt 0 ]]; then
          __goat_git_config_env_unresolved="${git_config_unresolved_stack[-1]}"
          unset 'git_config_unresolved_stack[-1]'
        fi
        closing_segment="${closing_segment:0:__goat_subshell_closer_index} ${closing_segment:__goat_subshell_closer_index+1}"
      done
    fi
  done
}

# Count executable substitution openers before recursive inspection so excessive nesting cannot stall the agent turn.
count_substitution_openers() {
  local input="$1"
  local count=0
  local i ch next next2
  local in_single=0
  local in_double=0
  local escaped=0
  # Count possible nested executable actions before recursively inspecting the proposed command.
  for ((i = 0; i < ${#input}; i += 1)); do
    ch="${input:i:1}"
    # An escaped character stays literal so quotes or separators in an argument cannot change the inspected command boundary.
    if [[ "$escaped" -eq 1 ]]; then
      escaped=0
      continue
    fi
    # Outside single quotes, an escape protects the next character from becoming a command or argument boundary.
    if [[ "$in_single" -eq 0 && "$ch" == "\\" ]]; then
      escaped=1
      continue
    fi
    # Single-quoted text belongs to a literal operand, so its separators and substitution markers cannot become executable actions.
    if [[ "$in_double" -eq 0 && "$ch" == "'" ]]; then
      # Closing a single-quoted operand returns inspection to the surrounding command context.
      if [[ "$in_single" -eq 1 ]]; then
        in_single=0
      else
        in_single=1
      fi
      continue
    fi
    # Double quotes preserve an argument boundary while still allowing executable command substitutions to be inspected.
    if [[ "$in_single" -eq 0 && "$ch" == '"' ]]; then
      # Closing double quotes restores the surrounding word boundaries for the proposed action.
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
    # A command-substitution opener adds another action to the bounded inspection workload.
    if [[ "$ch$next" == "\$(" ]]; then
      # Arithmetic expansion itself is not a child command; count only executable command-substitution openers here.
      if [[ "$next2" != '(' ]]; then
        count=$((count + 1))
      fi
    # A process-substitution opener also starts a child action and consumes the same inspection budget.
    elif [[ "$ch$next" == '<(' || "$ch$next" == '>(' ]]; then
      count=$((count + 1))
    fi
  done
  printf '%s\n' "$count"
}

# Read one command source, validate provider input and parser limits, then deliver the selected policy verdict to the agent.
main() {
  OUTPUT_MODE="stderr-exit"
  SELF_TEST_MODE=""
  CHECK_COMMAND=""
  local check_command_source=""

  # Read check and self-test options before choosing the command source so diagnostic requests never execute their operand.
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
        check_command_source="check-flag"
        ;;
      --check)
        shift
        CHECK_COMMAND="${1:-}"
        check_command_source="check-flag"
        ;;
      *)
        # The first positional operand supplies check text; later arguments must not silently replace the inspected command.
        if [[ -z "$CHECK_COMMAND" ]]; then
          CHECK_COMMAND="$1"
          check_command_source="positional"
        fi
        ;;
    esac
    shift || true
  done

  local script_dir
  script_dir="${GOAT_GUARD_SCRIPT_DIR:-$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)}"
  # A self-test request runs the policy corpus instead of waiting for or inspecting an ordinary provider payload.
  if [[ -n "$SELF_TEST_MODE" ]]; then
    [[ -r "$GOAT_HOOK_LIB_DIR/deny-dangerous-self-test.sh" ]] ||
      deny_dangerous_unavailable "missing required policy self-test"
    GOAT_DENY_DANGEROUS_HOOK="$GOAT_GUARD_ENTRYPOINT" exec bash "$GOAT_HOOK_LIB_DIR/deny-dangerous-self-test.sh" "--self-test=$SELF_TEST_MODE" "--policy=$GOAT_GUARD_SCOPE"
  fi

  local payload structured_input payload_trimmed tool_name command command_policy extraction_status
  # A positional command plus piped input could identify two different actions; check that only one source was supplied.
  if [[ "$check_command_source" == "positional" && ! -t 0 ]]; then
    local competing_payload competing_payload_trimmed
    competing_payload="$(cat || true)"
    competing_payload_trimmed="${competing_payload#"${competing_payload%%[![:space:]]*}"}"
    # Competing nonempty stdin makes the intended action ambiguous, so deny it with the provider's expected response channel.
    if [[ -n "$competing_payload_trimmed" ]]; then
      OUTPUT_MODE="$(detect_output_mode "$competing_payload")"
      block "Hook received both positional command and stdin payload. Submit exactly one command source."
    fi
  fi
  JSON_EXTRACTION_UNSAFE=0
  payload="$(read_payload)"
  structured_input=0
  payload_trimmed="${payload#"${payload%%[![:space:]]*}"}"
  # Provider JSON requires structured extraction; explicit check text remains a literal proposed command.
  if [[ -z "$CHECK_COMMAND" && "$payload_trimmed" == \{* ]]; then
    structured_input=1
    OUTPUT_MODE="$(detect_output_mode "$payload")"
  fi

  tool_name=""
  command=""
  # Structured provider input must expose a trustworthy tool and command before any relevant action can be allowed.
  if [[ "$structured_input" -eq 1 ]]; then
    extraction_status=0
    tool_name="$(extract_tool_name "$payload")" || extraction_status=$?
    [[ "$extraction_status" -eq 2 ]] && JSON_EXTRACTION_UNSAFE=1
    extraction_status=0
    command="$(extract_command_text "$payload")" || extraction_status=$?
    [[ "$extraction_status" -eq 2 ]] && JSON_EXTRACTION_UNSAFE=1
    # Unsupported JSON escapes leave the provider action uncertain and require a refusal for policy-relevant tools.
    if [[ "$JSON_EXTRACTION_UNSAFE" -eq 1 ]]; then
      # Unknown, shell and file tools can reach guarded actions; unsafe extraction cannot establish permission to continue.
      if [[ -z "$tool_name" ]] || tool_is_shell_command "$tool_name" || tool_is_secret_file_operation "$tool_name"; then
        block "Hook payload contains unsupported JSON escapes. Fail closed and rerun with jq installed or a simpler payload."
      fi
    fi
    # A known tool name decides whether this policy owns the requested action or should return provider continuation.
    if [[ -n "$tool_name" ]]; then
      # Non-shell tools bypass shell classification only when the selected policy does not own their requested file action.
      if ! tool_is_shell_command "$tool_name"; then
        # The dangerous-hook entrypoint still inspects secret-file operations even when no shell tool was invoked.
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

  # No command text means there is no action to inspect; policy-relevant structured requests must explain that absence.
  if [[ -z "$command" ]]; then
    # A relevant structured request without command text cannot establish a safe action, so report a malformed payload.
    if [[ "$structured_input" -eq 1 ]] && { [[ -z "$tool_name" ]] || tool_is_shell_command "$tool_name" || tool_is_secret_file_operation "$tool_name"; }; then
      block "Hook payload did not expose a bash command to evaluate"
    fi
    allow
  fi

  # Multiline commands and heredocs need data masking before parser limits; executable opener text remains policy-checked.
  if [[ "$command" == *"<<"* || "$command" == *$'\n'* ]]; then
    command_policy="$(mask_safe_quoted_heredoc_bodies "$command")"
  else
    # A single-line command without a heredoc opener cannot contain a body to mask.
    command_policy="$command"
  fi

  # Keep the ordinary 16KB inspection limit; only the quoted quality-report data transport may reach 256KB.
  # That larger body is admitted only when masking leaves an executable command within the ordinary limit.
  if (( ${#command} > 262144 )); then
    block "Command is too large for policy inspection; use file or stdin input for large data."
  fi
  # Only safely masked quality-report data may exceed the ordinary command size limit; other large actions need file or stdin input.
  if (( ${#command} > 16384 )) && {
    (( ${#command_policy} > 16384 )) ||
      ! large_quality_save_heredoc_is_bounded_data "$command_policy"
  }; then
    block "Command is too large for policy inspection; use file or stdin input for large data."
  fi

  declare -a _goat_chain_segments=()
  split_command_segments_into _goat_chain_segments "$command_policy"
  # Too many chained actions exceed bounded inspection; ask the user to review and run the intended command manually.
  if (( ${#_goat_chain_segments[@]} > 50 )); then
    block "Command has more than 50 chained segments; review and run manually if intended."
  fi
  unset _goat_chain_segments

  # Count executable substitution openers once before recursion to prevent a policy-parser DoS from excessive nested actions.
  #
  # Excessive nested actions require manual review so a crafted command cannot stall the agent turn.
  local _goat_subst_n=0
  # shellcheck disable=SC2016  # literal substitution openers are matched, not expanded
  if [[ "$command_policy" == *'$('* || "$command_policy" == *'<('* || "$command_policy" == *'>('* ]]; then
    _goat_subst_n="$(count_substitution_openers "$command_policy")"
  fi
  # Too many executable substitutions exceed bounded inspection; return a manual-review refusal instead of stalling the agent turn.
  if (( _goat_subst_n > 32 )); then
    block "Command has too many command substitutions; review and run manually if intended."
  fi

  check_command_segments "$command_policy" 0 ||
    block "Policy hook unavailable: $GOAT_GUARD_NAME could not evaluate the command. Re-run goat-flow setup."
  allow
}

required_hook_lib_files=(
  "patterns-shell.sh"
  "patterns-paths.sh"
  "patterns-writes.sh"
  "../gh-graphql-read.cjs"
  "../vendor/graphql.cjs"
)

# Every required policy module must be readable before the entrypoint can return a trustworthy verdict.
for required_hook_lib_file in "${required_hook_lib_files[@]}"; do
  # A missing or unreadable policy file prevents complete inspection; report an unavailable hook instead of allowing the action.
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

# During an interrupted upgrade the old policy file can still be present. It
# must not reach main without the split API and accidentally allow on return 127.
for required_policy_function in check_destructive_segment check_secret_segment check_repository_segment check_git_segment reset_git_alias_flags normalize_git_alias_expansion record_git_alias_config record_git_persistent_alias is_git_builtin_word git_arguments_are_one_of git_flags_within git_arguments_include split_curl_form_parts_into curl_form_files_touch_secret git_symbolic_ref_is_read_only; do
  declare -F "$required_policy_function" >/dev/null ||
    deny_dangerous_unavailable "policy store lacks required function $required_policy_function"
done

# Inspect one action with the selected policy and restore the enclosing denial scope for nested command checks.
check_segment() {
  local cmd="$1"
  local depth="${2:-0}"
  local previous_scope="${GOAT_ACTIVE_GUARD_SCOPE-}"

  # Parse once per segment. Every policy module below consumes the same
  # CMD_* and HAS_* context; reparsing here would add policy-count latency.
  GOAT_ACTIVE_GUARD_SCOPE="destructive"
  # Git policy uses the repository denial label so the user sees which switch owns the proposed write.
  if [[ "$GOAT_GUARD_SCOPE" == "deny-git-mutations" ]]; then
    GOAT_ACTIVE_GUARD_SCOPE="repository"
  fi
  prepare_segment_context "$cmd" "$depth" || return $?
  if visible_git_config_environment_is_unresolved "$CMD_TRIMMED" "$CMD_VERB"; then
    block "Visible Git configuration environment can change aliases or executable commands without hook inspection; use literal git -c values or ask the user to run it manually." || return $?
  fi
  # Git policy checks native Git and GitHub actions; the alternate branch checks destructive shell and secret-file actions.
  if [[ "$GOAT_GUARD_SCOPE" == "deny-git-mutations" ]]; then
    # The existing find walker recursively checks executable payloads. Its
    # deletion verdict belongs to the sibling shell policy, not this hook.
    find_has_destructive_action "$CMD_NORMALIZED" "$depth" || true
    check_git_segment "$cmd" "$depth" || return $?
    check_repository_segment "$cmd" "$depth" || return $?
  else
    check_destructive_segment "$cmd" "$depth" || return $?
    GOAT_ACTIVE_GUARD_SCOPE="secret"
    check_secret_segment "$cmd" "$depth" || return $?
  fi

  # Direct git-<verb> helpers can install executable config values just like the git dispatcher.
  if [[ "$CMD_VERB" == git || "$CMD_VERB" == git-* ]]; then
    check_git_hosted_commands "$CMD_NORMALIZED" "$depth" || return $?
  fi

  # A command-hosting Git environment variable, set as a prefix or exported, runs its value the same as a -c config key.
  check_git_command_environment "$CMD_TRIMMED" "$CMD_VERB" "$depth" || return $?

  # Nested inspection restores its enclosing policy label so any later denial names the correct user-visible protection.
  if [[ -n "$previous_scope" ]]; then
    GOAT_ACTIVE_GUARD_SCOPE="$previous_scope"
  else
    unset GOAT_ACTIVE_GUARD_SCOPE
  fi
}

main "$@"
