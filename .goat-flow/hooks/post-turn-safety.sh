#!/usr/bin/env bash

# post-turn-safety.sh
# goat-flow-hook-version: 1.12.1
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

set -uo pipefail

MAX_FILE_BYTES="${GOAT_FLOW_POST_TURN_SAFETY_MAX_BYTES:-1048576}"
MAX_FINDINGS="${GOAT_FLOW_POST_TURN_SAFETY_MAX_FINDINGS:-20}"

findings=0
reported_findings="
"

repo_root() {
  git rev-parse --show-toplevel 2>/dev/null
}

has_head() {
  git rev-parse --verify HEAD >/dev/null 2>&1
}

trim_value() {
  local value="$1"
  value="$(printf '%s' "$value" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
  case "$value" in
    \"*)
      value="${value#\"}"
      value="${value%%\"*}"
      ;;
    \'*)
      value="${value#\'}"
      value="${value%%\'*}"
      ;;
    *)
      value="${value%%#*}"
      value="$(printf '%s' "$value" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
      ;;
  esac
  printf '%s' "$value"
}

is_placeholder_text() {
  local value
  value="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$value" in
    ""|*example*|*placeholder*|*changeme*|*change-me*|*change_me*|*dummy*|*fake*|*sample*|*test*|*redacted*|*xxxx*|*your-token*|*your_token*|*your-key*|*your_key*|*your-api-key*|*your_api_key*|*not-a-secret*)
      return 0
      ;;
  esac
  return 1
}

is_placeholder_token() {
  local all_x_re
  local marker_re
  local value
  value="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$value" in
    ""|akiaiosfodnn7example|asiaiosfodnn7example)
      return 0
      ;;
  esac
  all_x_re='^(gh[pousr]_|github_pat_|npm_|sk-)?x+$'
  [[ "$value" =~ $all_x_re ]] && return 0
  marker_re='(^|[_-])(example|placeholder|changeme|change-me|change_me|dummy|fake|sample|test|redacted|xxxx|your-token|your_token|your-key|your_key|your-api-key|your_api_key|not-a-secret)([_-]|$)'
  [[ "$value" =~ $marker_re ]]
}

strip_space() {
  printf '%s' "$1" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//'
}

is_excluded_credential_key() {
  local key="$1"
  case "$key" in
    tokens|*tokens|tokenizer|tokeniser|tokenize|*tokenizer*|*tokeniser*|*tokenize*|*_count|*_index|*_id|*_name|*_type|*_header|*_url|*_path|*_list|*_re|*_pattern|*_field)
      return 0
      ;;
  esac
  return 1
}

is_credential_key() {
  local key
  key="$(printf '%s' "$1" | tr '[:upper:]-' '[:lower:]_')"
  is_excluded_credential_key "$key" && return 1
  case "$key" in
    token|secret|secrets|password|passwords|api_key|apikey|private_key|access_token|auth_token|refresh_token|bearer_token|client_secret|client_secrets|secret_key|secret_keys)
      return 0
      ;;
    *_api_key|*_apikey|*_private_key|*_access_token|*_auth_token|*_refresh_token|*_bearer_token|*_client_secret|*_client_secrets|*_secret_key|*_secret_keys|*_password|*_passwords|*_token|*_secret|*_secrets)
      return 0
      ;;
  esac
  return 1
}

has_credential_entropy() {
  local value="$1"
  case "$value" in
    gh[pousr]_*|github_pat_*|npm_*|sk-*|xox[baprs]-*|AKIA*|ASIA*)
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

  raw="$(strip_space "$1")"
  case "$raw" in
    [fF]\"*|[fF]\'*|[fF][rR]\"*|[fF][rR]\'*|[rR][fF]\"*|[rR][fF]\'*)
      return 1
      ;;
  esac

  case "${raw:0:1}" in
    '"')
      rest="${raw:1}"
      [[ "$rest" == *\"* ]] || return 1
      value="${rest%%\"*}"
      case "$value" in
        *'$'*) return 1 ;;
      esac
      after="${rest#*\"}"
      after="$(strip_space "$after")"
      case "$after" in
        ""|\#*) ;;
        *) return 1 ;;
      esac
      printf '%s' "$value"
      return 0
      ;;
    "'")
      rest="${raw:1}"
      [[ "$rest" == *"'"* ]] || return 1
      value="${rest%%\'*}"
      after="${rest#*\'}"
      after="$(strip_space "$after")"
      case "$after" in
        ""|\#*) ;;
        *) return 1 ;;
      esac
      printf '%s' "$value"
      return 0
      ;;
  esac

  bare="${raw%%#*}"
  bare="$(strip_space "$bare")"
  [ -n "$bare" ] || return 1
  case "$bare" in
    *[[:space:]]*|*"("*|*")"*|*"["*|*"]"*|*"{"*|*"}"*|*","*|*";"*|*"<"*|*">"*|*"|"*|*"&"*|*'`'*|*'$'*)
      return 1
      ;;
  esac
  if [[ "$bare" =~ ^[a-z_][a-z0-9_]*$ ]]; then
    return 1
  fi
  dotted_identifier_re='^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$'
  if [[ "$bare" =~ $dotted_identifier_re ]]; then
    first_segment="${bare%%.*}"
    first_segment_lower="$(printf '%s' "$first_segment" | tr '[:upper:]' '[:lower:]')"
    case "$first_segment_lower" in
      app|application|cfg|conf|config|configs|configuration|constant|constants|context|credentials|credential|creds|ctx|default|defaults|env|environ|environment|os|process|self|setting|settings|this)
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
  printf '%s' "$bare"
}

is_dockerfile_path() {
  local basename
  local lower_path

  lower_path="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  basename="${lower_path##*/}"
  case "$basename" in
    dockerfile|dockerfile.*|*.dockerfile)
      return 0
      ;;
  esac
  return 1
}

is_env_assignment_file() {
  local basename
  local lower_path

  lower_path="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  basename="${lower_path##*/}"
  case "$basename" in
    .env*|*.env|*.env.*|dockerfile|dockerfile.*|*.dockerfile|*.sh|*.bash|*.zsh|*.ksh|*.yaml|*.yml|*.ini|*.toml|*.properties|*.conf|*.cfg)
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
  local value

  if is_dockerfile_path "$path"; then
    key="$(printf '%s\n' "$line" | sed -nE 's/^[[:space:]]*(arg|ARG|env|ENV)[[:space:]]+([A-Za-z_][A-Za-z0-9_-]*)([[:space:]]*[:=][[:space:]]*|[[:space:]]+).*/\2/p' | head -n 1)"
    raw_value="$(printf '%s\n' "$line" | sed -nE 's/^[[:space:]]*(arg|ARG|env|ENV)[[:space:]]+[A-Za-z_][A-Za-z0-9_-]*([[:space:]]*[:=][[:space:]]*|[[:space:]]+)(.*)$/\3/p' | head -n 1)"
  else
    key="$(printf '%s\n' "$line" | sed -nE 's/^[[:space:]]*((export|EXPORT|arg|ARG|env|ENV)[[:space:]]+)?([A-Za-z_][A-Za-z0-9_-]*)[[:space:]]*[:=].*/\3/p' | head -n 1)"
    raw_value="$(printf '%s\n' "$line" | sed -nE 's/^[[:space:]]*((export|EXPORT|arg|ARG|env|ENV)[[:space:]]+)?[A-Za-z_][A-Za-z0-9_-]*[[:space:]]*[:=][[:space:]]*(.*)$/\3/p' | head -n 1)"
  fi
  [ -n "$key" ] || return 0
  is_credential_key "$key" || return 0

  if ! value="$(literal_assignment_value "$raw_value")"; then
    return 0
  fi
  [ "${#value}" -ge 12 ] || return 0
  # Assignment values use delimiter-aware placeholder matching so ordinary
  # substrings such as "test" inside a generated password do not suppress a
  # credential finding. Known documented token placeholders are handled there.
  if is_placeholder_token "$value"; then
    return 0
  fi

  report_finding "$path" "credential assignment ($key)"
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

scan_line() {
  local path="$1"
  local line="$2"
  local api_token_reported=0

  case "$line" in
    "<<<<<<< "*|"======="|">>>>>>> "*)
      report_finding "$path" "merge conflict marker"
      ;;
  esac

  if [[ "$line" =~ -----BEGIN[[:space:]](RSA[[:space:]]|DSA[[:space:]]|EC[[:space:]]|OPENSSH[[:space:]])?PRIVATE[[:space:]]KEY----- ]]; then
    report_finding "$path" "private key block"
  fi

  if [[ "$line" =~ (AKIA|ASIA)[A-Z0-9]{16} ]]; then
    report_token_if_real "$path" "AWS access key" "${BASH_REMATCH[0]}"
  fi
  if [[ "$line" =~ gh[pousr]_[A-Za-z0-9_]{30,} || "$line" =~ github_pat_[A-Za-z0-9_]{20,} ]]; then
    report_token_if_real "$path" "GitHub token" "${BASH_REMATCH[0]}"
  fi
  if [[ "$line" =~ npm_[A-Za-z0-9]{36,} ]]; then
    report_token_if_real "$path" "npm token" "${BASH_REMATCH[0]}"
  fi
  if [[ "$line" =~ xox[baprs]-[A-Za-z0-9-]{20,} ]]; then
    report_token_if_real "$path" "Slack token" "${BASH_REMATCH[0]}"
  fi
  if [[ "$line" =~ (OPENAI|ANTHROPIC|API_KEY|TOKEN).*(sk-[A-Za-z0-9]{32,}) ]]; then
    report_token_if_real "$path" "API token" "${BASH_REMATCH[2]}"
    api_token_reported=1
  fi
  if [ "$api_token_reported" -eq 0 ] && [[ "$line" =~ (^|[^A-Za-z0-9_])(sk-[A-Za-z0-9]{32,})([^A-Za-z0-9_]|$) ]]; then
    report_token_if_real "$path" "API token" "${BASH_REMATCH[2]}"
  fi

  if is_env_assignment_file "$path"; then
    scan_env_assignment "$path" "$line"
  fi
}

is_scannable_file() {
  local root="$1"
  local path="$2"
  local absolute="$root/$path"
  local bytes

  [ -f "$absolute" ] || return 1
  bytes="$(wc -c < "$absolute" | tr -d '[:space:]')"
  case "$bytes" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "$bytes" -le "$MAX_FILE_BYTES" ] || return 1
  LC_ALL=C grep -Iq . "$absolute" 2>/dev/null
}

scan_untracked_file() {
  local root="$1"
  local path="$2"
  local line

  is_scannable_file "$root" "$path" || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    scan_line "$path" "$line"
  done < "$root/$path"
}

scan_diff_added_lines() {
  local path="$1"
  local line

  shift 1
  while IFS= read -r line; do
    case "$line" in
      "+++"*|"---"*|"@@"*) continue ;;
      +*) scan_line "$path" "${line#+}" ;;
    esac
  done < <("$@" 2>/dev/null || true)
}

scan_worktree_diff_file() {
  local root="$1"
  local path="$2"

  is_scannable_file "$root" "$path" || return 0
  if ! has_head; then
    scan_untracked_file "$root" "$path"
    return 0
  fi

  scan_diff_added_lines "$path" git diff --no-ext-diff --no-color --unified=0 HEAD -- "$path"
}

is_scannable_staged_file() {
  local root="$1"
  local path="$2"
  local bytes

  bytes="$(git -C "$root" cat-file -s ":$path" 2>/dev/null | tr -d '[:space:]')"
  case "$bytes" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "$bytes" -le "$MAX_FILE_BYTES" ] || return 1
}

scan_cached_diff_file() {
  local root="$1"
  local path="$2"

  is_scannable_staged_file "$root" "$path" || return 0
  scan_diff_added_lines "$path" git diff --cached --no-ext-diff --no-color --unified=0 -- "$path"
}

scan_tracked_changes() {
  local root="$1"
  local path

  if has_head; then
    while IFS= read -r -d '' path; do
      scan_worktree_diff_file "$root" "$path"
    done < <(git diff --name-only -z --diff-filter=ACMR HEAD -- 2>/dev/null || true)
    while IFS= read -r -d '' path; do
      scan_cached_diff_file "$root" "$path"
    done < <(git diff --cached --name-only -z --diff-filter=ACMR -- 2>/dev/null || true)
    return 0
  fi

  while IFS= read -r -d '' path; do
    scan_worktree_diff_file "$root" "$path"
  done < <(git ls-files -z 2>/dev/null || true)
  while IFS= read -r -d '' path; do
    scan_cached_diff_file "$root" "$path"
  done < <(git diff --cached --name-only -z --diff-filter=ACMR -- 2>/dev/null || true)
}

scan_untracked_changes() {
  local root="$1"
  local path

  while IFS= read -r -d '' path; do
    scan_untracked_file "$root" "$path"
  done < <(git ls-files --others --exclude-standard -z 2>/dev/null || true)
}

main() {
  local root
  root="$(repo_root)"
  if [ -z "$root" ]; then
    printf 'post-turn-safety: git repository root unavailable; cannot scan changed content.\n' >&2
    return 1
  fi

  cd "$root" || {
    printf 'post-turn-safety: cannot enter repository root %s.\n' "$root" >&2
    return 1
  }

  scan_tracked_changes "$root"
  scan_untracked_changes "$root"

  if [ "$findings" -gt 0 ]; then
    if [ "$findings" -gt "$MAX_FINDINGS" ]; then
      printf 'post-turn-safety: %s additional finding(s) hidden by output cap.\n' "$((findings - MAX_FINDINGS))" >&2
    fi
    printf 'post-turn-safety: fix or remove the flagged changed content before stopping.\n' >&2
    return 2
  fi

  return 0
}

main "$@"
