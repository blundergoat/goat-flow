#!/usr/bin/env bash

# post-turn-safety.sh
# goat-flow-hook-version: 1.15.0
#
# Purpose:
#   Universal Stop-event safety guard for supported agents. This hook checks
#   changed text content for built-in safety hazards that goat-flow can evaluate
#   without knowing the target project's language stack or validation commands.
#
# Runtime contract:
#   This is not project validation. It does not run tests, builds, linters, or
#   formatters, and it must not claim that the project passed validation. It
#   blocks only high-confidence safety hazards in changed content.
#
# Exit codes:
#   0  clean scan, no findings
#   1  reserved for host-level hook unavailability
#   2  findings blocked, or the scan could not complete
#
# Bash 4+ performance architecture (Windows Git Bash ships fork costs 10-40x
# Linux, so its optimized scan must not spawn per line or per file):
#   1. Path sets come from the same `git diff --name-only -z` / `git ls-files -z`
#      plumbing as before, but content is read through one batched
#      `git diff --unified=0` per pass instead of one diff process per path.
#   2. A grep pre-filter (a provable superset of every scan_line trigger, see
#      the *_RE definitions) selects candidate lines; only matched lines reach
#      the per-line bash analysis.
#   3. Its string helpers are pure bash (no sed/tr/subshell forks).
#   4. External commands are chunked to stay inside Windows' command-line
#      length limit; total process count is O(passes), not O(files or lines).
# The Bash 3 compatibility path favors coverage on stock macOS and remains
# bounded by the same wall-clock, file-size, and output limits.

set -uo pipefail
shopt -s extglob

# Bash 3.2 ships with supported macOS versions. Keep this compatibility path
# free of associative arrays, mapfile, and Bash-4 parameter expansions. The
# force flag executes this exact path under newer Bash during integration tests.
fallback_findings=0
fallback_reported="
"
fallback_conflict_path=""
fallback_conflict_state=0
fallback_bail=0
fallback_incomplete_reason=""
fallback_workdir=""
fallback_temp_sequence=0
fallback_max_seconds="${GOAT_FLOW_POST_TURN_SAFETY_MAX_SECONDS:-60}"
fallback_max_bytes="${GOAT_FLOW_POST_TURN_SAFETY_MAX_BYTES:-1048576}"
fallback_max_findings="${GOAT_FLOW_POST_TURN_SAFETY_MAX_FINDINGS:-20}"

# Detector shapes are shared by the Bash 3 compatibility and optimized paths.
# Keep thresholds and placeholder/allowlist decisions in this Bash-3-safe block
# so either execution path cannot silently define a different security policy.
AWS_TOKEN_RE='(AKIA|ASIA)[A-Z0-9]{16}'
GITHUB_LEGACY_TOKEN_RE='gh[pousr]_[A-Za-z0-9_]{30,}'
GITHUB_FINE_GRAINED_TOKEN_RE='github_pat_[A-Za-z0-9_]{20,}'
NPM_TOKEN_RE='npm_[A-Za-z0-9]{36,}'
SLACK_TOKEN_RE='xox[baprs]-[A-Za-z0-9-]{20,}'
API_TOKEN_RE='sk-[A-Za-z0-9]{32,}'
PRIVATE_KEY_RE='-----BEGIN[[:space:]](RSA[[:space:]]|DSA[[:space:]]|EC[[:space:]]|OPENSSH[[:space:]])?PRIVATE[[:space:]]KEY-----'
PLACEHOLDER_ALL_X_RE='^(gh[pousr]_|github_pat_|npm_|sk-)?x+$'
PLACEHOLDER_MARKER_RE='(^|[_-])(example|placeholder|changeme|change-me|change_me|dummy|fake|sample|test|redacted|xxxx|your-token|your_token|your-key|your_key|your-api-key|your_api_key|not-a-secret)([_-]|$)'

is_line_allowlisted() {
  case "$1" in
    *goat-flow-allow-secret* | *gitleaks:allow* | *'pragma: allowlist secret'*)
      return 0
      ;;
  esac
  return 1
}

has_credential_entropy() {
  local value="$1"
  case "$value" in
    gh[pousr]_* | github_pat_* | npm_* | sk-* | xox[baprs]-* | AKIA* | ASIA*)
      return 0
      ;;
  esac
  [[ "$value" =~ [0-9] ]] || return 1
  if [[ "$value" =~ [[:lower:]] ]] && [[ "$value" =~ [[:upper:]] ]]; then
    return 0
  fi
  if [[ "$value" =~ [._+/=~-] ]]; then
    return 0
  fi
  if [ "${#value}" -ge 20 ] && [[ "$value" =~ ^[a-f0-9]+$ ]]; then
    return 0
  fi
  return 1
}

is_reference_or_interpolation() {
  local value="$1"
  case "$value" in
    *%env\(* | *%ENV\(*) return 0 ;;
    *\$\{* | *\$\(*) return 0 ;;
    *\{\{* | *\}\}* | *\{%* | *%\}*) return 0 ;;
    *\<%* | *%\>*) return 0 ;;
  esac
  [[ "$value" =~ ^%[^%[:space:]]+%$ ]] && return 0
  return 1
}

fallback_mark_incomplete() {
  if [ -z "$fallback_incomplete_reason" ]; then
    fallback_incomplete_reason="$1"
  fi
  fallback_bail=1
}

fallback_budget_check() {
  if [ "$fallback_bail" -ne 0 ]; then
    return 1
  fi
  if [ "$SECONDS" -ge "$fallback_max_seconds" ]; then
    fallback_mark_incomplete "budget ${fallback_max_seconds}s exceeded"
    return 1
  fi
  return 0
}

fallback_next_temp_path() {
  fallback_temp_sequence=$((fallback_temp_sequence + 1))
  FALLBACK_TEMP_PATH="$fallback_workdir/$1-$fallback_temp_sequence"
}

fallback_lower() {
  if ! FALLBACK_LOWER=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]'); then
    fallback_mark_incomplete "text normalization command failed"
    FALLBACK_LOWER=""
    return 1
  fi
  return 0
}

fallback_trim() {
  FALLBACK_TRIMMED="${1##+([[:space:]])}"
  FALLBACK_TRIMMED="${FALLBACK_TRIMMED%%+([[:space:]])}"
}

fallback_normalize_key() {
  local raw="$1"
  local first=""
  local second=""
  local c
  local i
  local n

  n=${#raw}
  i=0
  while [ "$i" -lt "$n" ]; do
    c="${raw:$i:1}"
    if [ "$i" -gt 0 ] && [[ "${raw:$((i - 1)):1}" == [[:lower:][:digit:]] && "$c" == [[:upper:]] ]]; then
      first="${first}_"
    fi
    first="${first}${c}"
    i=$((i + 1))
  done

  n=${#first}
  i=0
  while [ "$i" -lt "$n" ]; do
    c="${first:$i:1}"
    if [ "$i" -gt 0 ] && [ "$((i + 1))" -lt "$n" ] && [[ "${first:$((i - 1)):1}" == [[:upper:]] && "$c" == [[:upper:]] && "${first:$((i + 1)):1}" == [[:lower:]] ]]; then
      second="${second}_"
    fi
    second="${second}${c}"
    i=$((i + 1))
  done

  fallback_lower "$second" || return 1
  FALLBACK_NORMALIZED_KEY="${FALLBACK_LOWER//-/_}"
}

fallback_report() {
  local path="$1"
  local family="$2"
  local key="
$path|$family
"
  case "$fallback_reported" in
    *"$key"*) return 0 ;;
  esac
  fallback_reported="${fallback_reported}$path|$family
"
  fallback_findings=$((fallback_findings + 1))
  if [ "$fallback_findings" -le "$fallback_max_findings" ]; then
    printf 'post-turn-safety: %s in %s (Bash 3 compatibility scan).\n' "$family" "$path" >&2
  fi
}

fallback_is_placeholder() {
  local value
  if ! fallback_lower "$1"; then
    return 0
  fi
  value="$FALLBACK_LOWER"
  case "$value" in
    "" | akiaiosfodnn7example | asiaiosfodnn7example)
      return 0
      ;;
  esac
  [[ "$value" =~ $PLACEHOLDER_ALL_X_RE ]] && return 0
  [[ "$value" =~ $PLACEHOLDER_MARKER_RE ]]
}

# Decides whether what follows a closing quote still leaves one plain secret.
# A user writing `API_KEY="abc123";` in a deploy script means exactly what
# `API_KEY="abc123"` means, so the trailing semicolon must not stop the scan
# from warning them. Accepts nothing, a comment, or one bare semicolon
# (optionally with spaces and a comment); anything else is treated as an
# expression the scanner will not guess about, which keeps interpolations and
# chained commands out of credential warnings. Shared by the native scanner and
# the Bash 3 fallback so stock macOS users get the same verdict; callers pass a
# suffix already trimmed of surrounding whitespace.
# $1 - text after the closing quote; empty means the assignment ended there.
# Returns 0 when a single literal remains, 1 when the line is an expression.
suffix_ends_assignment() {
  local after_terminator
  case "$1" in
    # Nothing or a comment follows, so the quoted value is the whole assignment.
    "" | \#*) return 0 ;;
    # A bare statement terminator, as in `export TOKEN="abc123";`.
    ";") return 0 ;;
    ";"*)
      fallback_trim "${1#;}"
      after_terminator="$FALLBACK_TRIMMED"
      # Only spacing or a trailing comment after the semicolon, still one value.
      case "$after_terminator" in
        "" | \#*) return 0 ;;
      esac
      return 1
      ;;
  esac
  return 1
}

fallback_is_env_assignment_file() {
  local basename
  local lower_path
  fallback_lower "$1" || return 1
  lower_path="$FALLBACK_LOWER"
  basename="${lower_path##*/}"
  case "$basename" in
    .env* | *.env | *.env.* | dockerfile | dockerfile.* | *.dockerfile | *.sh | *.bash | *.zsh | *.ksh | *.yaml | *.yml | *.ini | *.toml | *.properties | *.conf | *.cfg)
      return 0
      ;;
  esac
  return 1
}

fallback_is_dockerfile_path() {
  local basename
  local lower_path
  fallback_lower "$1" || return 1
  lower_path="$FALLBACK_LOWER"
  basename="${lower_path##*/}"
  case "$basename" in
    dockerfile | dockerfile.* | *.dockerfile)
      return 0
      ;;
  esac
  return 1
}

# Extracts the literal a stock macOS user placed in a credential assignment.
# Sets FALLBACK_LITERAL_VALUE on success; references and expressions stay allowed.
fallback_literal_assignment_value() {
  local dotted_identifier_re
  local literal_value
  local operator_expression_re
  local operator_left_identifier
  local raw_assignment_value
  local text_after_closing_quote
  local text_after_opening_quote
  local unquoted_assignment_value
  local value_first_segment
  local value_first_segment_lower

  FALLBACK_LITERAL_VALUE=""
  fallback_trim "$1"
  raw_assignment_value="$FALLBACK_TRIMMED"
  # Keep language-formatted strings in the allowed expression path.
  case "$raw_assignment_value" in
    [fF]\"* | [fF]\'* | [fF][rR]\"* | [fF][rR]\'* | [rR][fF]\"* | [rR][fF]\'*)
      return 1
      ;;
  esac

  # Parse quoted values so a trailing user comment cannot hide a credential.
  case "$raw_assignment_value" in
    \"*)
      text_after_opening_quote="${raw_assignment_value#?}"
      # An unclosed quote is not a literal the scanner can classify safely.
      case "$text_after_opening_quote" in *\"*) ;; *) return 1 ;; esac
      literal_value="${text_after_opening_quote%%\"*}"
      # Whitespace or interpolation means the user entered an expression.
      case "$literal_value" in
        *[[:space:]]* | *'$'*) return 1 ;;
      esac
      # References stay allowed because they do not embed a credential.
      is_reference_or_interpolation "$literal_value" && return 1
      text_after_closing_quote="${text_after_opening_quote#*\"}"
      fallback_trim "$text_after_closing_quote"
      text_after_closing_quote="$FALLBACK_TRIMMED"
      # Only an assignment-ending suffix may follow the closing quote.
      suffix_ends_assignment "$text_after_closing_quote" || return 1
      FALLBACK_LITERAL_VALUE="$literal_value"
      return 0
      ;;
    \'*)
      text_after_opening_quote="${raw_assignment_value#?}"
      # An unclosed quote is not a literal the scanner can classify safely.
      case "$text_after_opening_quote" in *\'*) ;; *) return 1 ;; esac
      literal_value="${text_after_opening_quote%%\'*}"
      # Whitespace means the user entered more than one literal token.
      case "$literal_value" in *[[:space:]]*) return 1 ;; esac
      # References stay allowed because they do not embed a credential.
      is_reference_or_interpolation "$literal_value" && return 1
      text_after_closing_quote="${text_after_opening_quote#*\'}"
      fallback_trim "$text_after_closing_quote"
      text_after_closing_quote="$FALLBACK_TRIMMED"
      # Only an assignment-ending suffix may follow the closing quote.
      suffix_ends_assignment "$text_after_closing_quote" || return 1
      FALLBACK_LITERAL_VALUE="$literal_value"
      return 0
      ;;
  esac

  # Remove a trailing user comment before classifying an unquoted value.
  unquoted_assignment_value="${raw_assignment_value%%#*}"
  fallback_trim "$unquoted_assignment_value"
  unquoted_assignment_value="$FALLBACK_TRIMMED"
  # An empty value gives the user no credential to rotate.
  [ -n "$unquoted_assignment_value" ] || return 1
  # Expression punctuation keeps ordinary code out of credential warnings.
  case "$unquoted_assignment_value" in
    *[[:space:]]* | *"("* | *")"* | *"["* | *"]"* | *"{"* | *"}"* | *","* | *";"* | *"<"* | *">"* | *"|"* | *"&"* | *'`'* | *'$'*)
      return 1
      ;;
  esac
  # A lowercase identifier is a variable reference, not an embedded secret.
  if [[ "$unquoted_assignment_value" =~ ^[a-z_][a-z0-9_]*$ ]]; then
    return 1
  fi
  dotted_identifier_re='^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$'
  # Dotted config references stay allowed unless their first segment is token-like.
  if [[ "$unquoted_assignment_value" =~ $dotted_identifier_re ]]; then
    value_first_segment="${unquoted_assignment_value%%.*}"
    fallback_lower "$value_first_segment" || return 1
    value_first_segment_lower="$FALLBACK_LOWER"
    case "$value_first_segment_lower" in
      app | application | cfg | conf | config | configs | configuration | constant | constants | context | credentials | credential | creds | ctx | default | defaults | env | environ | environment | os | process | self | setting | settings | this)
        return 1
        ;;
    esac
    # A low-entropy first segment still behaves like an ordinary reference.
    if ! has_credential_entropy "$value_first_segment"; then
      return 1
    fi
  fi
  operator_expression_re='^([A-Za-z_][A-Za-z0-9_]*)([+*/%=]|==|!=)([A-Za-z_][A-Za-z0-9_]*)$'
  # Operators remain allowed when their left side is clearly an identifier.
  if [[ "$unquoted_assignment_value" =~ $operator_expression_re ]]; then
    operator_left_identifier="${BASH_REMATCH[1]}"
    has_credential_entropy "$operator_left_identifier" || return 1
  fi
  # Report only long, token-shaped values the user could need to rotate.
  if [[ ! "$unquoted_assignment_value" =~ ^[A-Za-z0-9._+/=~-]{12,}$ ]]; then
    return 1
  fi
  # Require enough character variety to avoid warning on ordinary words.
  has_credential_entropy "$unquoted_assignment_value" || return 1
  FALLBACK_LITERAL_VALUE="$unquoted_assignment_value"
  return 0
}

# Warns when a changed assignment embeds a literal credential.
# Stock Bash 3 users receive the same Stop-hook decision as newer Bash users.
fallback_scan_literal_assignment() {
  local changed_file_path="$1"
  local credential_key_text="$2"
  local assignment_value_text="$3"
  local literal_value
  local normalized_credential_key

  if ! fallback_normalize_key "$credential_key_text"; then
    return 0
  fi
  normalized_credential_key="$FALLBACK_NORMALIZED_KEY"
  case "$normalized_credential_key" in
    tokens | *tokens | tokenizer | tokeniser | tokenize | *tokenizer* | *tokeniser* | *tokenize* | *_count | *_index | *_id | *_name | *_type | *_header | *_url | *_path | *_list | *_re | *_pattern | *_field | *not_secret | *not_a_secret | *non_secret | *no_secret | *not_token | *not_a_token | *non_token | *no_token | *not_password | *not_a_password | *non_password | *no_password | *not_api_key | *not_an_api_key | *non_api_key | *no_api_key | *not_private_key | *not_a_private_key | *non_private_key | *no_private_key)
      return 0
      ;;
    token | secret | secrets | password | passwords | api_key | apikey | private_key | access_token | auth_token | refresh_token | bearer_token | client_secret | client_secrets | secret_key | secret_keys | *_api_key | *_apikey | *_private_key | *_access_token | *_auth_token | *_refresh_token | *_bearer_token | *_client_secret | *_client_secrets | *_secret_key | *_secret_keys | *_password | *_passwords | *_token | *_secret | *_secrets)
      ;;
    *) return 0 ;;
  esac

  # Parse only embedded literals; references remain safe for the user.
  fallback_literal_assignment_value "$assignment_value_text" || return 0
  literal_value="$FALLBACK_LITERAL_VALUE"
  # Short values are not credential-shaped enough to interrupt the turn.
  [ "${#literal_value}" -ge 12 ] || return 0
  # Documented placeholders stay usable in examples and setup screens.
  fallback_is_placeholder "$literal_value" && return 0
  fallback_report "$changed_file_path" "credential assignment ($credential_key_text)"
}

fallback_scan_assignment() {
  local path="$1"
  local line="$2"
  local assignment_re='^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_-]*)[[:space:]]*[:=][[:space:]]*(.+)$'

  case "$line" in
    [Ee][Nn][Vv]\ * | [Aa][Rr][Gg]\ *) line="${line#* }" ;;
  esac
  [[ "$line" =~ $assignment_re ]] || return 0
  fallback_scan_literal_assignment "$path" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}"
}

fallback_scan_dockerfile_assignment() {
  local path="$1"
  local line="$2"
  local instruction
  local payload
  local first_word
  local key
  local raw_value
  local word
  local -a words=()
  local docker_instruction_re='^[[:space:]]*([aA][rR][gG]|[eE][nN][vV])[[:space:]]+(.*)$'
  local docker_key_value_re='^([A-Za-z_][A-Za-z0-9_-]*)[[:space:]]*=[[:space:]]*(.*)$'
  local docker_key_space_re='^([A-Za-z_][A-Za-z0-9_-]*)[[:space:]]+(.+)$'
  local docker_key_only_re='^([A-Za-z_][A-Za-z0-9_-]*)$'
  local docker_env_word_re='^([A-Za-z_][A-Za-z0-9_-]*)=(.*)$'

  [[ "$line" =~ $docker_instruction_re ]] || return 0
  fallback_lower "${BASH_REMATCH[1]}" || return 0
  instruction="$FALLBACK_LOWER"
  fallback_trim "${BASH_REMATCH[2]}"
  payload="$FALLBACK_TRIMMED"
  [ -n "$payload" ] || return 0

  if [ "$instruction" = "env" ]; then
    first_word="${payload%%[[:space:]]*}"
    if [[ "$first_word" =~ $docker_env_word_re ]]; then
      read -r -a words <<<"$payload"
      for word in ${words[@]+"${words[@]}"}; do
        if [[ "$word" =~ $docker_env_word_re ]]; then
          fallback_scan_literal_assignment "$path" "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
        fi
      done
      return 0
    fi
  fi

  if [[ "$payload" =~ $docker_key_value_re ]]; then
    key="${BASH_REMATCH[1]}"
    raw_value="${BASH_REMATCH[2]}"
  elif [[ "$payload" =~ $docker_key_space_re ]]; then
    key="${BASH_REMATCH[1]}"
    raw_value="${BASH_REMATCH[2]}"
  elif [[ "$payload" =~ $docker_key_only_re ]]; then
    key="${BASH_REMATCH[1]}"
    raw_value=""
  else
    return 0
  fi

  fallback_scan_literal_assignment "$path" "$key" "$raw_value"
}

fallback_reset_conflict() {
  if [ "$fallback_conflict_path" != "$1" ]; then
    fallback_conflict_path="$1"
    fallback_conflict_state=0
  fi
}

fallback_scan_line() {
  local path="$1"
  local line="$2"
  local token
  local api_token_reported=0

  fallback_budget_check || return 1
  is_line_allowlisted "$line" && return 0

  fallback_reset_conflict "$path"
  case "$line" in
    '<<<<<<< '*) fallback_conflict_state=1 ;;
    '=======')
      if [ "$fallback_conflict_state" -eq 1 ]; then
        fallback_conflict_state=2
      fi
      ;;
    '>>>>>>> '*)
      if [ "$fallback_conflict_state" -eq 2 ]; then
        fallback_report "$path" "merge conflict marker"
      fi
      fallback_conflict_state=0
      ;;
  esac

  if [[ "$line" =~ $AWS_TOKEN_RE ]]; then
    token="${BASH_REMATCH[0]}"
    fallback_is_placeholder "$token" || fallback_report "$path" "AWS access key"
  fi
  if [[ "$line" =~ $GITHUB_LEGACY_TOKEN_RE ]]; then
    token="${BASH_REMATCH[0]}"
    fallback_is_placeholder "$token" || fallback_report "$path" "GitHub token"
  elif [[ "$line" =~ $GITHUB_FINE_GRAINED_TOKEN_RE ]]; then
    token="${BASH_REMATCH[0]}"
    fallback_is_placeholder "$token" || fallback_report "$path" "GitHub token"
  fi
  if [[ "$line" =~ $NPM_TOKEN_RE ]]; then
    token="${BASH_REMATCH[0]}"
    fallback_is_placeholder "$token" || fallback_report "$path" "npm token"
  fi
  if [[ "$line" =~ $SLACK_TOKEN_RE ]]; then
    token="${BASH_REMATCH[0]}"
    fallback_is_placeholder "$token" || fallback_report "$path" "Slack token"
  fi
  if [[ "$line" =~ (OPENAI|ANTHROPIC|API_KEY|TOKEN).*($API_TOKEN_RE) ]]; then
    token="${BASH_REMATCH[2]}"
    fallback_is_placeholder "$token" || fallback_report "$path" "API token"
    api_token_reported=1
  fi
  if [ "$api_token_reported" -eq 0 ] && [[ "$line" =~ (^|[^A-Za-z0-9_])($API_TOKEN_RE)([^A-Za-z0-9_]|$) ]]; then
    token="${BASH_REMATCH[2]}"
    fallback_is_placeholder "$token" || fallback_report "$path" "API token"
  fi
  if [[ "$line" =~ $PRIVATE_KEY_RE ]]; then
    fallback_report "$path" "private key block"
  fi
  if fallback_is_dockerfile_path "$path"; then
    fallback_scan_dockerfile_assignment "$path" "$line"
  elif fallback_is_env_assignment_file "$path"; then
    fallback_scan_assignment "$path" "$line"
  fi
}

# Returns success when one changed file fits the user's configured scan limit.
# Staged paths use the index blob so staged-only content gets the same decision.
fallback_diff_path_within_byte_cap() {
  local repository_root="$1"
  local changed_file_path="$2"
  local uses_staged_blob="$3"
  local changed_file_bytes
  local worktree_file_path

  # A staged scan measures exactly what the user placed in the index.
  if [ "$uses_staged_blob" -eq 1 ]; then
    if ! changed_file_bytes=$(git -C "$repository_root" cat-file -s ":$changed_file_path" 2>/dev/null); then
      fallback_mark_incomplete "staged byte-count command failed"
      return 1
    fi
  else
    worktree_file_path="$repository_root/$changed_file_path"
    # A selected file that vanishes or becomes unreadable leaves the scan incomplete.
    if [ ! -f "$worktree_file_path" ] || [ ! -r "$worktree_file_path" ]; then
      fallback_mark_incomplete "selected worktree content became unavailable"
      return 1
    fi
    if ! changed_file_bytes=$(wc -c <"$worktree_file_path" 2>/dev/null); then
      fallback_mark_incomplete "byte-count command failed"
      return 1
    fi
  fi
  # An empty or invalid size cannot prove that the file fits the scan limit.
  case "$changed_file_bytes" in
    '' | *[!0-9[:space:]]*)
      fallback_mark_incomplete "byte-count command returned invalid output"
      return 1
      ;;
  esac
  # Files over the limit are skipped consistently on both supported shells.
  [ "$changed_file_bytes" -le "$fallback_max_bytes" ]
}

# Decode one default Git diff destination header into the literal repository path.
# Git tab-terminates unquoted names containing spaces and C-quotes names with
# non-ASCII or control bytes; passing either decorated form to filesystem checks
# silently disables the compatibility scan for that file.
fallback_decode_diff_path() {
  local encoded_path="${1#+++ }"
  FALLBACK_DIFF_PATH=""

  case "$encoded_path" in
    *$'\t') encoded_path="${encoded_path%$'\t'}" ;;
  esac
  case "$encoded_path" in
    \"*\")
      encoded_path="${encoded_path#\"}"
      encoded_path="${encoded_path%\"}"
      ;;
  esac
  case "$encoded_path" in
    b/*) encoded_path="${encoded_path#b/}" ;;
  esac
  [ -n "$encoded_path" ] || return 1
  # Bash's builtin printf understands Git's octal and escaped-quote notation.
  printf -v FALLBACK_DIFF_PATH '%b' "$encoded_path" || return 1
  [ -n "$FALLBACK_DIFF_PATH" ]
}

# Scans added diff lines while preserving the configured file-size boundary.
# For example, a staged-only secret is checked against the staged blob size.
fallback_scan_diff() {
  local repository_root="$1"
  shift
  local changed_file_path=""
  local diff_argument
  local diff_line
  local diff_stream
  local expect_file_header=0
  local scan_changed_file=0
  local uses_staged_blob=0

  # Detect whether this diff represents the user's staged snapshot.
  for diff_argument in "$@"; do
    # Cached diffs must measure content from Git's index rather than the worktree.
    if [ "$diff_argument" = "--cached" ]; then
      uses_staged_blob=1
      break
    fi
  done

  fallback_conflict_path=""
  fallback_conflict_state=0
  fallback_next_temp_path "diff-stream"
  diff_stream="$FALLBACK_TEMP_PATH"
  if ! git -C "$repository_root" \
    -c core.quotepath=off \
    -c diff.noprefix=false \
    -c diff.mnemonicprefix=false \
    -c diff.srcprefix=a/ \
    -c diff.dstprefix=b/ \
    diff --no-ext-diff --no-color --unified=0 "$@" >"$diff_stream" 2>/dev/null; then
    fallback_mark_incomplete "Git diff command failed"
    return 1
  fi
  # Read every added diff line, including a final line without a newline.
  while IFS= read -r diff_line || [ -n "$diff_line" ]; do
    fallback_budget_check || break
    case "$diff_line" in
      'diff --git '*)
        expect_file_header=1
        changed_file_path=""
        scan_changed_file=0
        ;;
      '+++ /dev/null')
        if [ "$expect_file_header" -eq 1 ]; then
          expect_file_header=0
          changed_file_path=""
          scan_changed_file=0
        elif [ -n "$changed_file_path" ] && [ "$scan_changed_file" -eq 1 ]; then
          fallback_scan_line "$changed_file_path" "${diff_line#+}"
        fi
        ;;
      '+++ '*)
        if [ "$expect_file_header" -eq 1 ]; then
          expect_file_header=0
          if fallback_decode_diff_path "$diff_line"; then
            changed_file_path="$FALLBACK_DIFF_PATH"
          else
            changed_file_path=""
          fi
          # Scan this file only when its selected content fits the user's byte cap.
          if [ -n "$changed_file_path" ] && fallback_diff_path_within_byte_cap "$repository_root" "$changed_file_path" "$uses_staged_blob"; then
            scan_changed_file=1
          else
            scan_changed_file=0
            [ "$fallback_bail" -eq 0 ] || break
          fi
        elif [ -n "$changed_file_path" ] && [ "$scan_changed_file" -eq 1 ]; then
          # Outside the one accepted header slot, +++-shaped text is content.
          fallback_scan_line "$changed_file_path" "${diff_line#+}"
        fi
        ;;
      +*)
        # An eligible path means the added line can affect the user's Stop result.
        if [ -n "$changed_file_path" ] && [ "$scan_changed_file" -eq 1 ]; then
          fallback_scan_line "$changed_file_path" "${diff_line#+}"
        fi
        ;;
    esac
  done <"$diff_stream"
}

fallback_open_scan_file() {
  exec 3<"$1"
}

fallback_scan_file() {
  local root="$1"
  local path="$2"
  local full_path="$root/$path"
  local size
  local line
  local grep_status

  [ -f "$full_path" ] && [ ! -L "$full_path" ] || return 0
  LC_ALL=C grep -Iq . "$full_path" 2>/dev/null
  grep_status=$?
  case "$grep_status" in
    0) ;;
    1) return 0 ;;
    *)
      fallback_mark_incomplete "binary-content gate failed"
      return 1
      ;;
  esac
  if ! size=$(wc -c <"$full_path" 2>/dev/null); then
    fallback_mark_incomplete "byte-count command failed"
    return 1
  fi
  case "$size" in
    '' | *[!0-9[:space:]]*)
      fallback_mark_incomplete "byte-count command returned invalid output"
      return 1
      ;;
  esac
  [ "$size" -le "$fallback_max_bytes" ] || return 0

  if ! fallback_open_scan_file "$full_path" 2>/dev/null; then
    fallback_mark_incomplete "selected content became unreadable"
    return 1
  fi

  fallback_conflict_path=""
  fallback_conflict_state=0
  while IFS= read -r line || [ -n "$line" ]; do
    fallback_scan_line "$path" "$line" || break
  done <&3
  exec 3<&-
}

fallback_main() {
  local root
  local path
  local path_list
  local head_status

  case "$fallback_max_seconds" in '' | *[!0-9]*) fallback_max_seconds=60 ;; esac
  case "$fallback_max_bytes" in '' | *[!0-9]*) fallback_max_bytes=1048576 ;; esac
  case "$fallback_max_findings" in '' | *[!0-9]*) fallback_max_findings=20 ;; esac

  if ! root=$(git rev-parse --show-toplevel 2>/dev/null) || [ -z "$root" ]; then
    printf 'post-turn-safety: scan incomplete (git repository root unavailable).\n' >&2
    return 2
  fi

  if ! cd "$root" 2>/dev/null; then
    printf 'post-turn-safety: scan incomplete (repository root cannot be entered).\n' >&2
    return 2
  fi

  if ! fallback_workdir=$(mktemp -d 2>/dev/null) || [ -z "$fallback_workdir" ]; then
    printf 'post-turn-safety: scan incomplete (scan workspace unavailable).\n' >&2
    return 2
  fi
  trap 'rm -rf "$fallback_workdir"' EXIT

  git -C "$root" rev-parse --verify HEAD >/dev/null 2>&1
  head_status=$?
  if [ "$head_status" -eq 0 ]; then
    fallback_scan_diff "$root" HEAD
    if [ "$fallback_bail" -eq 0 ]; then
      fallback_scan_diff "$root" --cached
    fi
  elif [ "$head_status" -eq 128 ]; then
    fallback_next_temp_path "tracked-paths"
    path_list="$FALLBACK_TEMP_PATH"
    if git -C "$root" ls-files -z >"$path_list" 2>/dev/null; then
      while IFS= read -r -d '' path; do
        fallback_budget_check || break
        fallback_scan_file "$root" "$path"
        [ "$fallback_bail" -eq 0 ] || break
      done <"$path_list"
    else
      fallback_mark_incomplete "Git tracked-path inventory failed"
    fi
    if [ "$fallback_bail" -eq 0 ]; then
      fallback_scan_diff "$root" --cached --root
    fi
  else
    fallback_mark_incomplete "Git HEAD inspection failed"
  fi

  if [ "$fallback_bail" -eq 0 ]; then
    fallback_next_temp_path "untracked-paths"
    path_list="$FALLBACK_TEMP_PATH"
    if git -C "$root" ls-files --others --exclude-standard -z >"$path_list" 2>/dev/null; then
      while IFS= read -r -d '' path; do
        fallback_budget_check || break
        fallback_scan_file "$root" "$path"
        [ "$fallback_bail" -eq 0 ] || break
      done <"$path_list"
    else
      fallback_mark_incomplete "Git untracked-path inventory failed"
    fi
  fi

  if [ "$fallback_bail" -ne 0 ]; then
    printf 'post-turn-safety: Bash 3 compatibility scan incomplete (%s).\n' "$fallback_incomplete_reason" >&2
  fi

  if [ "$fallback_findings" -gt 0 ]; then
    if [ "$fallback_findings" -gt "$fallback_max_findings" ]; then
      printf 'post-turn-safety: %s additional finding(s) hidden by output cap.\n' "$((fallback_findings - fallback_max_findings))" >&2
    fi
    printf 'post-turn-safety: fix or remove the flagged changed content before stopping.\n' >&2
    return 2
  fi
  if [ "$fallback_bail" -ne 0 ]; then
    return 2
  fi
  return 0
}

if ((BASH_VERSINFO[0] < 4)) || [ "${GOAT_FLOW_POST_TURN_SAFETY_FORCE_BASH3_FALLBACK:-0}" = 1 ]; then
  fallback_main "$@"
  exit $?
fi


# extglob is required by the +([[:space:]]) trim patterns in strip_space.
shopt -s extglob

MAX_FILE_BYTES="${GOAT_FLOW_POST_TURN_SAFETY_MAX_BYTES:-1048576}"
MAX_FINDINGS="${GOAT_FLOW_POST_TURN_SAFETY_MAX_FINDINGS:-20}"
# Wall-clock budget for the whole scan. The registered agent-side hook timeout
# must stay above this so the incomplete-scan diagnostic below prints before
# the runner kills the process (same layering as gruff-code-quality.sh).
MAX_SECONDS="${GOAT_FLOW_POST_TURN_SAFETY_MAX_SECONDS:-60}"
case "$MAX_SECONDS" in
  '' | *[!0-9]*) MAX_SECONDS=60 ;;
esac

# External commands receive at most this many path arguments per invocation so
# batched calls stay far below the ~32k character Windows command-line limit.
CHUNK_SIZE=64

findings=0
reported_findings="
"
merge_conflict_scan_path=""
merge_conflict_scan_state=0

# Budget bookkeeping: BAIL flips once SECONDS crosses MAX_SECONDS; every scan
# loop checks it and unwinds. PENDING_FILES over-counts remaining candidate
# files (never under-counts) so the incomplete-scan message stays honest.
BAIL=0
PENDING_FILES=0
INCOMPLETE_REASON=""
INCOMPLETE_KIND=""
TEMP_FILE_SEQUENCE=0

mark_scan_incomplete() {
  if [ -z "$INCOMPLETE_REASON" ]; then
    INCOMPLETE_KIND="$1"
    INCOMPLETE_REASON="$2"
  fi
  BAIL=1
}

budget_check() {
  if ((BAIL == 0)) && ((SECONDS >= MAX_SECONDS)); then
    mark_scan_incomplete "budget" "budget ${MAX_SECONDS}s exceeded"
  fi
  ((BAIL == 0))
}

next_temp_path() {
  TEMP_FILE_SEQUENCE=$((TEMP_FILE_SEQUENCE + 1))
  TEMP_PATH="$WORKDIR/$1-$TEMP_FILE_SEQUENCE"
}

# Grep exit 1 is its documented no-match result. Any other non-zero status
# means candidate selection or content gating did not complete.
capture_grep_output() {
  local output="$1"
  local failure_reason="$2"
  local status
  shift 2

  LC_ALL=C grep "$@" >"$output" 2>/dev/null
  status=$?
  GREP_STATUS=$status
  if [ "$status" -gt 1 ]; then
    mark_scan_incomplete "command" "$failure_reason"
    return 1
  fi
  return 0
}

repo_root() {
  git rev-parse --show-toplevel 2>/dev/null
}

has_head() {
  git rev-parse --verify HEAD >/dev/null 2>&1
}

# Sets STRIPPED to $1 without leading/trailing [[:space:]]. A function output
# via global instead of stdout: $(...) forks a subshell, and this runs on the
# per-line hot path.
strip_space() {
  STRIPPED="${1##+([[:space:]])}"
  STRIPPED="${STRIPPED%%+([[:space:]])}"
}

is_placeholder_token() {
  local value
  value="${1,,}"
  case "$value" in
    "" | akiaiosfodnn7example | asiaiosfodnn7example)
      return 0
      ;;
  esac
  [[ "$value" =~ $PLACEHOLDER_ALL_X_RE ]] && return 0
  [[ "$value" =~ $PLACEHOLDER_MARKER_RE ]]
}

is_excluded_credential_key() {
  local key="$1"
  case "$key" in
    tokens | *tokens | tokenizer | tokeniser | tokenize | *tokenizer* | *tokeniser* | *tokenize* | *_count | *_index | *_id | *_name | *_type | *_header | *_url | *_path | *_list | *_re | *_pattern | *_field)
      return 0
      ;;
    *not_secret | *not_a_secret | *non_secret | *no_secret | *not_token | *not_a_token | *non_token | *no_token | *not_password | *not_a_password | *non_password | *no_password | *not_api_key | *not_an_api_key | *non_api_key | *no_api_key | *not_private_key | *not_a_private_key | *non_private_key | *no_private_key)
      return 0
      ;;
  esac
  return 1
}

# Sets NORMALIZED_KEY to the snake_case lowercase form of $1. Reproduces the
# original two-pass sed exactly: first insert "_" between [[:lower:][:digit:]]
# and [[:upper:]], then between [[:upper:]] and [[:upper:]][[:lower:]]; finally
# lowercase and map "-" to "_". Boundary-by-boundary insertion is equivalent to
# sed's resume-after-match /g scan because neither pattern can overlap itself.
normalize_credential_key() {
  local raw="$1" first="" second="" c i n
  n=${#raw}
  for ((i = 0; i < n; i++)); do
    c=${raw:i:1}
    if ((i > 0)) && [[ ${raw:i-1:1} == [[:lower:][:digit:]] && $c == [[:upper:]] ]]; then
      first+="_"
    fi
    first+="$c"
  done
  n=${#first}
  for ((i = 0; i < n; i++)); do
    c=${first:i:1}
    if ((i > 0 && i + 1 < n)) && [[ ${first:i-1:1} == [[:upper:]] && $c == [[:upper:]] && ${first:i+1:1} == [[:lower:]] ]]; then
      second+="_"
    fi
    second+="$c"
  done
  second="${second,,}"
  NORMALIZED_KEY="${second//-/_}"
}

is_credential_key() {
  local key
  normalize_credential_key "$1"
  key="$NORMALIZED_KEY"
  is_excluded_credential_key "$key" && return 1
  case "$key" in
    token | secret | secrets | password | passwords | api_key | apikey | private_key | access_token | auth_token | refresh_token | bearer_token | client_secret | client_secrets | secret_key | secret_keys)
      return 0
      ;;
    *_api_key | *_apikey | *_private_key | *_access_token | *_auth_token | *_refresh_token | *_bearer_token | *_client_secret | *_client_secrets | *_secret_key | *_secret_keys | *_password | *_passwords | *_token | *_secret | *_secrets)
      return 0
      ;;
  esac
  return 1
}

scan_literal_credential_assignment() {
  local path="$1"
  local key="$2"
  local raw_value="$3"
  local value

  [ -n "$key" ] || return 0
  is_credential_key "$key" || return 0

  if ! literal_assignment_value "$raw_value"; then
    return 0
  fi
  value="$LITERAL_VALUE"
  [ "${#value}" -ge 12 ] || return 0
  # Assignment values use delimiter-aware placeholder matching so ordinary
  # substrings such as "test" inside a generated password do not suppress a
  # credential finding. Known documented token placeholders are handled there.
  if is_placeholder_token "$value"; then
    return 0
  fi

  report_finding "$path" "credential assignment ($key)"
}

scan_dockerfile_assignment() {
  local path="$1"
  local line="$2"
  local instruction
  local payload
  local first_word
  local key
  local raw_value
  local word
  local -a words=()
  local docker_instruction_re='^[[:space:]]*([aA][rR][gG]|[eE][nN][vV])[[:space:]]+(.*)$'
  local docker_key_value_re='^([A-Za-z_][A-Za-z0-9_-]*)[[:space:]]*=[[:space:]]*(.*)$'
  local docker_key_space_re='^([A-Za-z_][A-Za-z0-9_-]*)[[:space:]]+(.+)$'
  local docker_key_only_re='^([A-Za-z_][A-Za-z0-9_-]*)$'
  local docker_env_word_re='^([A-Za-z_][A-Za-z0-9_-]*)=(.*)$'

  [[ "$line" =~ $docker_instruction_re ]] || return 0
  instruction="${BASH_REMATCH[1],,}"
  strip_space "${BASH_REMATCH[2]}"
  payload="$STRIPPED"
  [ -n "$payload" ] || return 0

  if [[ "$instruction" == "env" ]]; then
    first_word="${payload%%[[:space:]]*}"
    if [[ "$first_word" =~ $docker_env_word_re ]]; then
      read -r -a words <<<"$payload"
      for word in ${words[@]+"${words[@]}"}; do
        if [[ "$word" =~ $docker_env_word_re ]]; then
          scan_literal_credential_assignment "$path" "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
        fi
      done
      return 0
    fi
  fi

  if [[ "$payload" =~ $docker_key_value_re ]]; then
    key="${BASH_REMATCH[1]}"
    raw_value="${BASH_REMATCH[2]}"
  elif [[ "$payload" =~ $docker_key_space_re ]]; then
    key="${BASH_REMATCH[1]}"
    raw_value="${BASH_REMATCH[2]}"
  elif [[ "$payload" =~ $docker_key_only_re ]]; then
    key="${BASH_REMATCH[1]}"
    raw_value=""
  else
    return 0
  fi

  scan_literal_credential_assignment "$path" "$key" "$raw_value"
}

# Extracts a literal secret-looking value from an assignment right-hand side.
# On success sets LITERAL_VALUE and returns 0; returns 1 when the value is a
# reference, expression, identifier, or otherwise not a literal credential.
literal_assignment_value() {
  local after
  local bare
  local dotted_identifier_re
  local first_segment
  local first_segment_lower
  local operator_expression_re
  local raw
  local rest
  local value

  LITERAL_VALUE=""
  strip_space "$1"
  raw="$STRIPPED"
  case "$raw" in
    [fF]\"* | [fF]\'* | [fF][rR]\"* | [fF][rR]\'* | [rR][fF]\"* | [rR][fF]\'*)
      return 1
      ;;
  esac

  case "${raw:0:1}" in
    '"')
      rest="${raw:1}"
      [[ "$rest" == *\"* ]] || return 1
      value="${rest%%\"*}"
      case "$value" in
        *[[:space:]]* | *'$'*) return 1 ;;
      esac
      is_reference_or_interpolation "$value" && return 1
      after="${rest#*\"}"
      strip_space "$after"
      after="$STRIPPED"
      # Only an assignment-ending suffix may follow the closing quote.
      suffix_ends_assignment "$after" || return 1
      LITERAL_VALUE="$value"
      return 0
      ;;
    "'")
      rest="${raw:1}"
      [[ "$rest" == *"'"* ]] || return 1
      value="${rest%%\'*}"
      case "$value" in
        *[[:space:]]*) return 1 ;;
      esac
      is_reference_or_interpolation "$value" && return 1
      after="${rest#*\'}"
      strip_space "$after"
      after="$STRIPPED"
      # Only an assignment-ending suffix may follow the closing quote.
      suffix_ends_assignment "$after" || return 1
      LITERAL_VALUE="$value"
      return 0
      ;;
  esac

  bare="${raw%%#*}"
  strip_space "$bare"
  bare="$STRIPPED"
  [ -n "$bare" ] || return 1
  case "$bare" in
    *[[:space:]]* | *"("* | *")"* | *"["* | *"]"* | *"{"* | *"}"* | *","* | *";"* | *"<"* | *">"* | *"|"* | *"&"* | *'`'* | *'$'*)
      return 1
      ;;
  esac
  if [[ "$bare" =~ ^[a-z_][a-z0-9_]*$ ]]; then
    return 1
  fi
  dotted_identifier_re='^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$'
  if [[ "$bare" =~ $dotted_identifier_re ]]; then
    first_segment="${bare%%.*}"
    first_segment_lower="${first_segment,,}"
    case "$first_segment_lower" in
      app | application | cfg | conf | config | configs | configuration | constant | constants | context | credentials | credential | creds | ctx | default | defaults | env | environ | environment | os | process | self | setting | settings | this)
        return 1
        ;;
    esac
    if ! has_credential_entropy "$first_segment"; then
      return 1
    fi
  fi
  operator_expression_re='^([A-Za-z_][A-Za-z0-9_]*)([+*/%=]|==|!=)([A-Za-z_][A-Za-z0-9_]*)$'
  if [[ "$bare" =~ $operator_expression_re ]]; then
    has_credential_entropy "${BASH_REMATCH[1]}" || return 1
  fi
  if [[ ! "$bare" =~ ^[A-Za-z0-9._+/=~-]{12,}$ ]]; then
    return 1
  fi
  has_credential_entropy "$bare" || return 1
  LITERAL_VALUE="$bare"
  return 0
}

is_dockerfile_path() {
  local basename
  local lower_path

  lower_path="${1,,}"
  basename="${lower_path##*/}"
  case "$basename" in
    dockerfile | dockerfile.* | *.dockerfile)
      return 0
      ;;
  esac
  return 1
}

is_env_assignment_file() {
  local basename
  local lower_path

  lower_path="${1,,}"
  basename="${lower_path##*/}"
  case "$basename" in
    .env* | *.env | *.env.* | dockerfile | dockerfile.* | *.dockerfile | *.sh | *.bash | *.zsh | *.ksh | *.yaml | *.yml | *.ini | *.toml | *.properties | *.conf | *.cfg)
      return 0
      ;;
  esac
  return 1
}

report_finding() {
  local path="$1"
  local family="$2"
  local fingerprint="${path}|${family}"
  case "$reported_findings" in
    *"
$fingerprint
"*) return 0 ;;
  esac
  reported_findings="${reported_findings}${fingerprint}
"
  findings=$((findings + 1))
  if [ "$findings" -le "$MAX_FINDINGS" ]; then
    printf 'post-turn-safety: blocked %s in %s\n' "$family" "$path" >&2
  fi
}

scan_env_assignment() {
  local path="$1"
  local line="$2"
  local key
  local raw_value
  local env_assignment_re='^[[:space:]]*((export|EXPORT|arg|ARG|env|ENV)[[:space:]]+)?([A-Za-z_][A-Za-z0-9_-]*)[[:space:]]*[:=][[:space:]]*(.*)$'

  if is_dockerfile_path "$path"; then
    scan_dockerfile_assignment "$path" "$line"
    return 0
  fi

  [[ "$line" =~ $env_assignment_re ]] || return 0
  key="${BASH_REMATCH[3]}"
  raw_value="${BASH_REMATCH[4]}"
  scan_literal_credential_assignment "$path" "$key" "$raw_value"
}

# Report a raw token match unless the matched token is itself an obvious
# placeholder (for example AWS's documented `AKIA...EXAMPLE` key or a
# `xoxb-test-...` fixture). The placeholder check runs against the matched token,
# not the whole line, so a real token on a line that merely mentions
# "test"/"example"/"sample" is still reported instead of silently skipped.
report_token_if_real() {
  local path="$1"
  local family="$2"
  local token="$3"
  is_placeholder_token "$token" && return 0
  report_finding "$path" "$family"
}

reset_merge_conflict_scan() {
  merge_conflict_scan_path="$1"
  merge_conflict_scan_state=0
}

scan_merge_conflict_marker() {
  local path="$1"
  local line="$2"

  if [ "$merge_conflict_scan_path" != "$path" ]; then
    reset_merge_conflict_scan "$path"
  fi

  case "$line" in
    "<<<<<<< "*)
      merge_conflict_scan_state=1
      ;;
    "=======")
      if [ "$merge_conflict_scan_state" -eq 1 ]; then
        merge_conflict_scan_state=2
      fi
      ;;
    ">>>>>>> "*)
      if [ "$merge_conflict_scan_state" -eq 2 ]; then
        report_finding "$path" "merge conflict marker"
      fi
      merge_conflict_scan_state=0
      ;;
    *) ;;
  esac
}

scan_line() {
  local path="$1"
  local line="$2"
  local api_token_reported=0

  is_line_allowlisted "$line" && return 0

  scan_merge_conflict_marker "$path" "$line"

  if [[ "$line" =~ $PRIVATE_KEY_RE ]]; then
    report_finding "$path" "private key block"
  fi

  if [[ "$line" =~ $AWS_TOKEN_RE ]]; then
    report_token_if_real "$path" "AWS access key" "${BASH_REMATCH[0]}"
  fi
  if [[ "$line" =~ $GITHUB_LEGACY_TOKEN_RE || "$line" =~ $GITHUB_FINE_GRAINED_TOKEN_RE ]]; then
    report_token_if_real "$path" "GitHub token" "${BASH_REMATCH[0]}"
  fi
  if [[ "$line" =~ $NPM_TOKEN_RE ]]; then
    report_token_if_real "$path" "npm token" "${BASH_REMATCH[0]}"
  fi
  if [[ "$line" =~ $SLACK_TOKEN_RE ]]; then
    report_token_if_real "$path" "Slack token" "${BASH_REMATCH[0]}"
  fi
  if [[ "$line" =~ (OPENAI|ANTHROPIC|API_KEY|TOKEN).*($API_TOKEN_RE) ]]; then
    report_token_if_real "$path" "API token" "${BASH_REMATCH[2]}"
    api_token_reported=1
  fi
  if [ "$api_token_reported" -eq 0 ] && [[ "$line" =~ (^|[^A-Za-z0-9_])($API_TOKEN_RE)([^A-Za-z0-9_]|$) ]]; then
    report_token_if_real "$path" "API token" "${BASH_REMATCH[2]}"
  fi

  if is_env_assignment_file "$path"; then
    scan_env_assignment "$path" "$line"
  fi
}

# --- grep pre-filter patterns -------------------------------------------------
#
# Only lines matching one of these patterns reach scan_line. Each pattern is a
# strict superset of the corresponding scan_line trigger, so pre-filtering can
# never drop a line the full analysis would have flagged:
#
#   ^diff --git , ^+++    In the diff stream: file-section starts and +++ path
#                         headers, needed for path attribution. In a --unified=0
#                         stream a line starting "diff --git " can only be a
#                         real section start (added lines render as "+diff...",
#                         removed as "--diff...", and no context lines exist),
#                         so a "+++ b/..." header is accepted only directly
#                         after one; content that merely looks like a header
#                         (e.g. an added line "++ b/x") is skipped exactly like
#                         the original per-line reader skipped "+++"* lines.
#   <<<<<<< , =======, >>>>>>>   The only three line shapes that can advance,
#                         complete, or reset the merge-conflict state machine
#                         (case arms "<<<<<<< "*, exact "=======", ">>>>>>> "*).
#                         Lines matching none of them leave the state untouched,
#                         so skipping them cannot change conflict detection.
#   -----BEGIN            Required literal substring of the private-key regex.
#   (AKIA|ASIA)[A-Z0-9]{16} and the gh/github_pat/npm/xox token patterns are
#                         the detector regexes themselves (trivially supersets).
#   sk-[A-Za-z0-9]{32,}   Required by both API-token branches.
#   token|secret|password|api[-_]?key|private[-_]?key  (case-insensitive, env
#                         files only): every accepting arm of is_credential_key
#                         contains one of the stems token/secret/password/
#                         api_key/apikey/private_key/secret_key in the
#                         normalized key. Normalization only lowercases, maps
#                         "-" to "_", and inserts underscores; it never removes
#                         or reorders characters, so the raw line must contain
#                         the stem letters contiguously (any case) with at most
#                         one "-"/"_" inside the api/private+key stems. The
#                         same holds for Dockerfile ARG/ENV findings, which
#                         also require an is_credential_key key on the line.
#                         Allowlist markers and placeholder values only ever
#                         suppress findings, so they need no pre-filter clause.
TOKEN_BODY_RE="-----BEGIN|${AWS_TOKEN_RE}|${GITHUB_LEGACY_TOKEN_RE}|${GITHUB_FINE_GRAINED_TOKEN_RE}|${NPM_TOKEN_RE}|${SLACK_TOKEN_RE}|${API_TOKEN_RE}"
STEM_BODY_RE='token|secret|password|api[-_]?key|private[-_]?key'
DIFF_GLOBAL_RE="^diff --git |^\\+\\+\\+ |^\\+<<<<<<< |^\\+={7}\$|^\\+>>>>>>> |^\\+.*(${TOKEN_BODY_RE})"
DIFF_STEM_RE="^\\+.*(${STEM_BODY_RE})"
CONTENT_GLOBAL_RE="^<<<<<<< |^={7}\$|^>>>>>>> |${TOKEN_BODY_RE}"
CONTENT_STEM_RE="${STEM_BODY_RE}"

# --- batched file gates -------------------------------------------------------

# Populates SCANNABLE[path]=1 for every candidate worktree file that passes the
# original is_scannable_file gate: regular readable file, byte size at most
# MAX_FILE_BYTES (batched wc -c), and text content (batched `grep -Il`, the
# same binary heuristic the old per-file `grep -Iq .` used, which also skips
# empty files). Paths with embedded newlines fall back to per-file probes.
declare -A SCANNABLE=()
gate_scannable_files() {
  local -a batch=() chunk=() sizes=()
  local path line size i count total_lines sizes_output grep_output

  for path in "$@"; do
    if [ ! -f "$path" ] || [ ! -r "$path" ] || [ -L "$path" ]; then
      continue
    fi
    if [[ "$path" == *$'\n'* ]]; then
      if ! size="$(wc -c <"$path" 2>/dev/null)"; then
        mark_scan_incomplete "command" "byte-count command failed"
        return 1
      fi
      case "$size" in
        '' | *[!0-9[:space:]]*)
          mark_scan_incomplete "command" "byte-count command returned invalid output"
          return 1
          ;;
      esac
      [ "$size" -le "$MAX_FILE_BYTES" ] || continue
      next_temp_path "binary-gate"
      grep_output="$TEMP_PATH"
      if ! capture_grep_output "$grep_output" "binary-content gate failed" -Iq . "$path"; then
        return 1
      fi
      if [ "$GREP_STATUS" -eq 0 ]; then SCANNABLE["$path"]=1; fi
      continue
    fi
    batch+=("$path")
  done
  set -- ${batch[@]+"${batch[@]}"}

  while (($# > 0)); do
    budget_check || return 0
    chunk=("${@:1:CHUNK_SIZE}")
    if (($# > CHUNK_SIZE)); then shift "$CHUNK_SIZE"; else shift $#; fi

    next_temp_path "byte-count"
    sizes_output="$TEMP_PATH"
    if ! wc -c -- "${chunk[@]}" >"$sizes_output" 2>/dev/null; then
      mark_scan_incomplete "command" "byte-count command failed"
      return 1
    fi
    sizes=()
    mapfile -t sizes <"$sizes_output"
    count=${#chunk[@]}
    total_lines=${#sizes[@]}
    if { ((count == 1)) && ((total_lines == 1)); } || { ((count > 1)) && ((total_lines == count + 1)); }; then
      for ((i = 0; i < count; i++)); do
        [[ "${sizes[i]}" =~ ^[[:space:]]*([0-9]+) ]] || continue
        if ((BASH_REMATCH[1] <= MAX_FILE_BYTES)); then
          SCANNABLE["${chunk[i]}"]=2
        fi
      done
    else
      # Unexpected wc output shape (e.g. a file vanished mid-run): probe the
      # chunk per file only after marking the scan incomplete; shifted output
      # cannot safely prove that any neighboring path stayed within the cap.
      mark_scan_incomplete "command" "byte-count command returned invalid output"
      return 1
    fi

    # Only paths marked 2 (size gate passed) are promoted to 1 (scannable);
    # leftover 2 markers fail every "= 1" admission test downstream, so they
    # need no separate cleanup.
    next_temp_path "binary-gate"
    grep_output="$TEMP_PATH"
    if ! capture_grep_output "$grep_output" "binary-content gate failed" -IlZ -e . -- "${chunk[@]}"; then
      return 1
    fi
    while IFS= read -r -d '' path; do
      if [ "${SCANNABLE[$path]:-0}" = 2 ]; then
        SCANNABLE["$path"]=1
      fi
    done <"$grep_output"
  done
}

# --- diff-stream scanning -----------------------------------------------------

# Unquotes a C-style quoted git path ("caf\303\251.env" style) into UNQUOTED.
c_unquote_path() {
  local quoted="$1" out="" c oct
  quoted="${quoted#\"}"
  quoted="${quoted%\"}"
  while [ -n "$quoted" ]; do
    c="${quoted:0:1}"
    if [ "$c" != "\\" ]; then
      out+="$c"
      quoted="${quoted:1}"
      continue
    fi
    c="${quoted:1:1}"
    case "$c" in
      [0-7])
        oct="${quoted:1:3}"
        oct="${oct%%[!0-7]*}"
        printf -v c '%b' "\\0$oct"
        out+="$c"
        quoted="${quoted:$((1 + ${#oct}))}"
        ;;
      a) out+=$'\a'; quoted="${quoted:2}" ;;
      b) out+=$'\b'; quoted="${quoted:2}" ;;
      f) out+=$'\f'; quoted="${quoted:2}" ;;
      n) out+=$'\n'; quoted="${quoted:2}" ;;
      r) out+=$'\r'; quoted="${quoted:2}" ;;
      t) out+=$'\t'; quoted="${quoted:2}" ;;
      v) out+=$'\v'; quoted="${quoted:2}" ;;
      *) out+="$c"; quoted="${quoted:2}" ;;
    esac
  done
  UNQUOTED="$out"
}

# Scans one batched `git diff --unified=0` stream stored in a file. Two greps
# select header lines plus candidate added lines (see the *_RE supersets); the
# walk below re-applies the original reader's "+++"*/"---"*/"@@"* skip rules to
# every candidate, attributes content to the current +++ header, and feeds the
# survivors to scan_line. Stem-only matches are scanned only inside env
# assignment files, mirroring the is_env_assignment_file guard in scan_line.
scan_diff_stream() {
  local stream="$1"
  local -a global_hits=() stem_hits=()
  local ai=0 bi=0 an bn hit line from_global
  local cur_path="" cur_active=0 cur_env=0 expect_header=0 rest
  local global_output stem_output

  # -a forces text handling of odd bytes; -U keeps CR bytes at end of line
  # (Windows grep builds strip them in text mode, which would alter the line
  # content scan_line sees compared to the original `read -r` loop).
  next_temp_path "diff-global-hits"
  global_output="$TEMP_PATH"
  if ! capture_grep_output "$global_output" "diff candidate grep failed" -aUnE "$DIFF_GLOBAL_RE" "$stream"; then
    return 1
  fi
  next_temp_path "diff-stem-hits"
  stem_output="$TEMP_PATH"
  if ! capture_grep_output "$stem_output" "diff candidate grep failed" -iaUnE "$DIFF_STEM_RE" "$stream"; then
    return 1
  fi
  mapfile -t global_hits <"$global_output"
  mapfile -t stem_hits <"$stem_output"

  while ((ai < ${#global_hits[@]} || bi < ${#stem_hits[@]})); do
    budget_check || return 0
    if ((ai < ${#global_hits[@]})); then an="${global_hits[ai]%%:*}"; else an=""; fi
    if ((bi < ${#stem_hits[@]})); then bn="${stem_hits[bi]%%:*}"; else bn=""; fi

    from_global=1
    if [ -z "$an" ]; then
      from_global=0
      hit="${stem_hits[bi]}"
      bi=$((bi + 1))
    elif [ -z "$bn" ] || ((an < bn)); then
      hit="${global_hits[ai]}"
      ai=$((ai + 1))
    elif ((an == bn)); then
      hit="${global_hits[ai]}"
      ai=$((ai + 1))
      bi=$((bi + 1))
    else
      from_global=0
      hit="${stem_hits[bi]}"
      bi=$((bi + 1))
    fi
    line="${hit#*:}"

    if ((from_global)) && [[ "$line" == "diff --git "* ]]; then
      expect_header=1
      cur_active=0
      continue
    fi
    if ((from_global && expect_header)) && [[ "$line" == "+++ "* ]]; then
      expect_header=0
      rest="${line#+++ }"
      if [ "$rest" = "/dev/null" ]; then
        cur_active=0
        continue
      fi
      if [[ "$rest" == \"* ]]; then
        c_unquote_path "$rest"
        rest="$UNQUOTED"
      else
        rest="${rest%$'\t'}"
      fi
      rest="${rest#b/}"
      cur_path="$rest"
      cur_active=1
      cur_env=0
      if is_env_assignment_file "$cur_path"; then cur_env=1; fi
      reset_merge_conflict_scan "$cur_path"
      if ((DIFF_FILES_DONE >= 0)); then DIFF_FILES_DONE=$((DIFF_FILES_DONE + 1)); fi
      continue
    fi

    ((cur_active)) || continue
    case "$line" in
      "+++"* | "---"* | "@@"*) continue ;;
      +*) ;;
      *) continue ;;
    esac
    if ((from_global)) || ((cur_env)); then
      scan_line "$cur_path" "${line#+}"
    fi
  done
}

# Runs one batched --unified=0 diff over a chunked path list and scans the
# stream. Prefix/quotepath settings are pinned so header parsing stays stable
# under any user diff config; content and path selection semantics match the
# original per-path `git diff` calls (same pathspec set, same flags).
DIFF_FILES_DONE=0
run_diff_batch() {
  local mode="$1"
  shift
  local -a chunk=()
  local stream

  while (($# > 0)); do
    budget_check || return 0
    chunk=("${@:1:CHUNK_SIZE}")
    if (($# > CHUNK_SIZE)); then shift "$CHUNK_SIZE"; else shift $#; fi
    next_temp_path "diff-stream"
    stream="$TEMP_PATH"
    if [ "$mode" = "cached" ]; then
      if ! git -c core.quotepath=off -c diff.noprefix=false -c diff.mnemonicprefix=false \
        -c diff.srcprefix=a/ -c diff.dstprefix=b/ \
        diff --cached --no-ext-diff --no-color --unified=0 -- "${chunk[@]}" \
        >"$stream" 2>/dev/null; then
        mark_scan_incomplete "command" "Git diff command failed"
        return 1
      fi
    else
      if ! git -c core.quotepath=off -c diff.noprefix=false -c diff.mnemonicprefix=false \
        -c diff.srcprefix=a/ -c diff.dstprefix=b/ \
        diff --no-ext-diff --no-color --unified=0 HEAD -- "${chunk[@]}" \
        >"$stream" 2>/dev/null; then
        mark_scan_incomplete "command" "Git diff command failed"
        return 1
      fi
    fi
    scan_diff_stream "$stream" || return 1
  done
}

# --- full-content scanning (untracked and unborn-HEAD files) -------------------

# Scans complete file contents for an ordered, already-gated path list. Two
# chunked greps (-H -n --null for unambiguous path attribution) select the
# candidate lines; matches from both greps are merged in (file, line) order so
# the merge-conflict state machine sees lines in their original sequence.
scan_content_files() {
  local -a files=("$@") env_files=() g_path=() g_ln=() g_line=() s_path=() s_ln=() s_line=()
  local -A file_order=()
  local -a chunk=()
  local path rest i gi si cur="" grep_output

  ((${#files[@]} > 0)) || return 0
  for ((i = 0; i < ${#files[@]}; i++)); do
    file_order["${files[i]}"]=$i
    if is_env_assignment_file "${files[i]}"; then
      env_files+=("${files[i]}")
    fi
  done

  set -- "${files[@]}"
  while (($# > 0)); do
    budget_check || return 0
    chunk=("${@:1:CHUNK_SIZE}")
    if (($# > CHUNK_SIZE)); then shift "$CHUNK_SIZE"; else shift $#; fi
    next_temp_path "content-global-hits"
    grep_output="$TEMP_PATH"
    if ! capture_grep_output "$grep_output" "content candidate grep failed" -aUHnZE --null -e "$CONTENT_GLOBAL_RE" -- "${chunk[@]}"; then
      return 1
    fi
    while IFS= read -r -d '' path && IFS= read -r rest; do
      g_path+=("$path")
      g_ln+=("${rest%%:*}")
      g_line+=("${rest#*:}")
    done <"$grep_output"
  done

  set -- ${env_files[@]+"${env_files[@]}"}
  while (($# > 0)); do
    budget_check || return 0
    chunk=("${@:1:CHUNK_SIZE}")
    if (($# > CHUNK_SIZE)); then shift "$CHUNK_SIZE"; else shift $#; fi
    next_temp_path "content-stem-hits"
    grep_output="$TEMP_PATH"
    if ! capture_grep_output "$grep_output" "content candidate grep failed" -iaUHnZE --null -e "$CONTENT_STEM_RE" -- "${chunk[@]}"; then
      return 1
    fi
    while IFS= read -r -d '' path && IFS= read -r rest; do
      s_path+=("$path")
      s_ln+=("${rest%%:*}")
      s_line+=("${rest#*:}")
    done <"$grep_output"
  done

  gi=0
  si=0
  while ((gi < ${#g_path[@]} || si < ${#s_path[@]})); do
    budget_check || return 0
    local g_ok=0 s_ok=0 g_key=0 s_key=0 pick_path pick_line
    if ((gi < ${#g_path[@]})); then
      g_ok=1
      g_key=$((${file_order[${g_path[gi]}]:-0} * 10000000 + g_ln[gi]))
    fi
    if ((si < ${#s_path[@]})); then
      s_ok=1
      s_key=$((${file_order[${s_path[si]}]:-0} * 10000000 + s_ln[si]))
    fi
    if ((g_ok && s_ok && g_key == s_key)); then
      pick_path="${g_path[gi]}"
      pick_line="${g_line[gi]}"
      gi=$((gi + 1))
      si=$((si + 1))
    elif ((g_ok)) && { ((!s_ok)) || ((g_key < s_key)); }; then
      pick_path="${g_path[gi]}"
      pick_line="${g_line[gi]}"
      gi=$((gi + 1))
    else
      pick_path="${s_path[si]}"
      pick_line="${s_line[si]}"
      si=$((si + 1))
    fi
    if [ "$pick_path" != "$cur" ]; then
      cur="$pick_path"
      reset_merge_conflict_scan "$cur"
    fi
    scan_line "$pick_path" "$pick_line"
  done
}

# --- path-set collection ------------------------------------------------------

COLLECTED=()
collect_z() {
  local path output
  COLLECTED=()
  next_temp_path "path-inventory"
  output="$TEMP_PATH"
  if ! "$@" >"$output" 2>/dev/null; then
    mark_scan_incomplete "command" "Git path inventory failed"
    return 1
  fi
  while IFS= read -r -d '' path; do
    COLLECTED+=("$path")
  done <"$output"
}

main() {
  local root
  local WORKDIR
  local head_status
  if ! root="$(repo_root)" || [ -z "$root" ]; then
    printf 'post-turn-safety: scan incomplete (git repository root unavailable).\n' >&2
    return 2
  fi

  cd "$root" 2>/dev/null || {
    printf 'post-turn-safety: scan incomplete (repository root cannot be entered).\n' >&2
    return 2
  }

  WORKDIR="$(mktemp -d 2>/dev/null)" || WORKDIR=""
  if [ -z "$WORKDIR" ]; then
    printf 'post-turn-safety: scan incomplete (scan workspace unavailable).\n' >&2
    return 2
  fi
  # shellcheck disable=SC2064
  trap "rm -rf '$WORKDIR'" EXIT

  local head_present=0
  has_head
  head_status=$?
  if [ "$head_status" -eq 0 ]; then
    head_present=1
  elif [ "$head_status" -ne 128 ]; then
    mark_scan_incomplete "command" "Git HEAD inspection failed"
  fi

  local -a worktree_paths=() cached_paths=() untracked_paths=()
  if ((BAIL == 0)); then
    if ((head_present)); then
      collect_z git diff --name-only -z --diff-filter=ACMR HEAD --
    else
      collect_z git ls-files -z
    fi
    worktree_paths=(${COLLECTED[@]+"${COLLECTED[@]}"})
  fi
  if ((BAIL == 0)); then
    collect_z git diff --cached --name-only -z --diff-filter=ACMR --
    cached_paths=(${COLLECTED[@]+"${COLLECTED[@]}"})
  fi
  if ((BAIL == 0)); then
    collect_z git ls-files --others --exclude-standard -z
    untracked_paths=(${COLLECTED[@]+"${COLLECTED[@]}"})
  fi

  # Fast exit: nothing changed, staged, or untracked, so there is nothing to
  # scan and no batch work to set up.
  if ((BAIL == 0 && ${#worktree_paths[@]} == 0 && ${#cached_paths[@]} == 0 && ${#untracked_paths[@]} == 0)); then
    return 0
  fi

  PENDING_FILES=$((${#worktree_paths[@]} + ${#cached_paths[@]} + ${#untracked_paths[@]}))

  # One gate pass covers every path scanned from worktree content: the tracked
  # pass-1 set and the untracked set (plus the ls-files set when HEAD is
  # unborn, which is content-scanned like untracked files).
  if ((BAIL == 0)); then
    gate_scannable_files ${worktree_paths[@]+"${worktree_paths[@]}"} ${untracked_paths[@]+"${untracked_paths[@]}"}
  fi

  # Pass 1: tracked changes (worktree vs HEAD), or full index contents when
  # HEAD is unborn. Mirrors scan_tracked_changes/scan_worktree_diff_file.
  local -a pass1=()
  local -A pass1_scanned=()
  local path
  for path in ${worktree_paths[@]+"${worktree_paths[@]}"}; do
    if [ "${SCANNABLE[$path]:-0}" = 1 ]; then
      pass1+=("$path")
      pass1_scanned["$path"]=1
    fi
  done
  if budget_check; then
    if ((head_present)); then
      DIFF_FILES_DONE=0
      run_diff_batch worktree ${pass1[@]+"${pass1[@]}"}
      PENDING_FILES=$((PENDING_FILES - (BAIL ? DIFF_FILES_DONE : ${#worktree_paths[@]})))
    else
      scan_content_files ${pass1[@]+"${pass1[@]}"}
      if ((BAIL == 0)); then PENDING_FILES=$((PENDING_FILES - ${#worktree_paths[@]})); fi
    fi
  fi

  # Pass 2: staged changes. When the index entry equals the worktree file
  # (path absent from `git diff --name-only`) and pass 1 scanned that path,
  # the --cached diff is byte-identical to the pass-1 diff, so every finding it
  # could produce was already reported (report_finding dedupes on path+family);
  # such paths are safely skipped. Paths whose index differs from the worktree
  # (including staged-then-reverted and staged-then-edited states) are always
  # scanned, as is everything when HEAD is unborn.
  if ((BAIL == 0)) && ((${#cached_paths[@]} > 0)); then
    local -A dirty_vs_index=()
    if ((head_present)); then
      collect_z git diff --name-only -z --
      if ((BAIL == 0)); then
        for path in ${COLLECTED[@]+"${COLLECTED[@]}"}; do
          dirty_vs_index["$path"]=1
        done
      fi
    fi
    local -a cached_candidates=()
    if ((BAIL == 0)); then
      for path in ${cached_paths[@]+"${cached_paths[@]}"}; do
        if ((head_present == 0)) || [ -n "${dirty_vs_index[$path]:-}" ] || [ -z "${pass1_scanned[$path]:-}" ]; then
          cached_candidates+=("$path")
        fi
      done
    fi

    # Staged-size gate, batched: mirrors is_scannable_staged_file, which only
    # checks the index blob size (`git cat-file -s :path`).
    local -a cached_scan=()
    if ((${#cached_candidates[@]} > 0)); then
      local -a batch_check_in=()
      local -a sizes=()
      local i blob_size sizes_output cat_status
      for path in "${cached_candidates[@]}"; do
        if [[ "$path" == *$'\n'* ]]; then
          if ! blob_size="$(git cat-file -s ":$path" 2>/dev/null)"; then
            mark_scan_incomplete "command" "staged byte-count command failed"
            break
          fi
          case "$blob_size" in
            '' | *[!0-9[:space:]]*)
              mark_scan_incomplete "command" "staged byte-count command returned invalid output"
              break
              ;;
          esac
          [ "$blob_size" -le "$MAX_FILE_BYTES" ] && cached_scan+=("$path")
          continue
        fi
        batch_check_in+=("$path")
      done
      if ((BAIL == 0 && ${#batch_check_in[@]} > 0)); then
        next_temp_path "staged-byte-count"
        sizes_output="$TEMP_PATH"
        printf ':%s\n' "${batch_check_in[@]}" | git cat-file --batch-check='%(objectsize)' >"$sizes_output" 2>/dev/null
        cat_status=$?
        if [ "$cat_status" -ne 0 ]; then
          mark_scan_incomplete "command" "staged byte-count command failed"
        else
          mapfile -t sizes <"$sizes_output"
        fi
        if ((BAIL == 0 && ${#sizes[@]} != ${#batch_check_in[@]})); then
          mark_scan_incomplete "command" "staged byte-count command returned incomplete output"
        fi
        for ((i = 0; BAIL == 0 && i < ${#batch_check_in[@]}; i++)); do
          case "${sizes[i]}" in
            '' | *[!0-9[:space:]]*)
              mark_scan_incomplete "command" "staged byte-count command returned invalid output"
              break
              ;;
          esac
          if ((sizes[i] <= MAX_FILE_BYTES)); then
            cached_scan+=("${batch_check_in[i]}")
          fi
        done
      fi
    fi
    if ((BAIL == 0)); then
      DIFF_FILES_DONE=0
      run_diff_batch cached ${cached_scan[@]+"${cached_scan[@]}"}
      PENDING_FILES=$((PENDING_FILES - (BAIL ? DIFF_FILES_DONE : ${#cached_paths[@]})))
    fi
  fi

  # Untracked pass: full-content scan of non-ignored untracked files, mirroring
  # scan_untracked_changes/scan_untracked_file.
  if ((BAIL == 0)); then
    local -a untracked_scan=()
    for path in ${untracked_paths[@]+"${untracked_paths[@]}"}; do
      if [ "${SCANNABLE[$path]:-0}" = 1 ]; then
        untracked_scan+=("$path")
      fi
    done
    scan_content_files ${untracked_scan[@]+"${untracked_scan[@]}"}
    if ((BAIL == 0)); then PENDING_FILES=0; fi
  fi

  # An incomplete native scan must block instead of showing a clean turn.
  if ((BAIL)); then
    if [ "$INCOMPLETE_KIND" = "budget" ]; then
      ((PENDING_FILES > 0)) || PENDING_FILES=1
      printf 'post-turn-safety: scan incomplete, %s file(s) unscanned (budget %ss exceeded; raise GOAT_FLOW_POST_TURN_SAFETY_MAX_SECONDS to scan more).\n' "$PENDING_FILES" "$MAX_SECONDS" >&2
    else
      printf 'post-turn-safety: scan incomplete (%s).\n' "$INCOMPLETE_REASON" >&2
    fi
  fi

  if [ "$findings" -gt 0 ]; then
    if [ "$findings" -gt "$MAX_FINDINGS" ]; then
      printf 'post-turn-safety: %s additional finding(s) hidden by output cap.\n' "$((findings - MAX_FINDINGS))" >&2
    fi
    printf 'post-turn-safety: fix or remove the flagged changed content before stopping.\n' >&2
    return 2
  fi

  if ((BAIL)); then
    return 2
  fi

  return 0
}

main "$@"
