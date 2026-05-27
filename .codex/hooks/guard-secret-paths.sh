#!/usr/bin/env bash
# shellcheck disable=SC2034,SC2317,SC2319

# guard-secret-paths.sh
#
# Purpose:
#   PreToolUse hook that blocks direct literal access to files known to
#   carry secrets. Applies to shell commands (Bash tool) AND, uniquely
#   among the guardrails, to agent file-operation tools (Read / View /
#   Edit / Write / MultiEdit / Replace) on payload shapes that route
#   file ops through this hook. Sources guard-common.sh for payload
#   parsing and command normalization.
#
# Blocks:
#   - `.env` and any `.env*` variant other than `.env.example` (including
#     `.envrc`, `.env.local`, `.env.production`, `./.env`, `../.env`,
#     split-quoted forms like `'.'env`).
#   - `~/.ssh/`, `~/.aws/`, `~/.config/gcloud/`, `~/.gnupg/`,
#     `~/.docker/config.json`, `~/.kube/config`, and `secrets/` trees.
#   - GCP `application_default_credentials.json`.
#   - Generic key material by extension: `*.pem`, `*.key`, `*.pfx`.
#   - Literal references to `credentials`, `.npmrc`, `.pypirc`.
#   - Pattern-file inputs to grep/rg (`-f file`, `--file=file`,
#     `-ffile`, `--file=file`) that point at any of the above.
#   - `.env.example` writes (`>`, `>>`, `>|`, `tee`, `sed -i`) or pipes
#     to a non-read-only consumer.
#
# Allows:
#   - `.env.example` for strictly read-only operations:
#       grep / egrep / fgrep / rg / ag / ack / cat / head / tail / less /
#       more / wc / file / diff / printf / echo / read / ls / stat /
#       test; `find` without `-delete` / `-exec` / `-execdir` / `-ok` /
#       `-okdir`; `git ls-files`; `sed` without `-i` / `--in-place`;
#     with no redirect and no pipe to a non-read-only consumer.
#   - Quoted-literal occurrences of secret paths inside grep/rg search
#     arguments (e.g. `grep -n 'JWT_KEY=.env.local' config/app.yaml`).
#   - Bare `echo` / `printf` that mention the path but do not touch it.
#
# Usage:
#   Wired in to the agent's PreToolUse hook. Payload is read from stdin
#   (JSON) in production; the `--check` form is used by
#   guardrails-self-test.sh and for manual verification.
#
#     bash guard-secret-paths.sh --check="cat .env"
#     echo '<agent-payload-json>' | bash guard-secret-paths.sh
#     bash guard-secret-paths.sh --self-test=smoke
#
# Exit:
#   0 to allow, 2 to block (stderr-exit mode). In Copilot / Antigravity
#   payload mode, exits 0 with a deny JSON document on stdout instead.

set -uo pipefail

if (( BASH_VERSINFO[0] < 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] < 4) )); then
  echo "guard-secret-paths.sh requires bash 4.4+ (got ${BASH_VERSION:-unknown}). On macOS install Homebrew bash and invoke /usr/local/bin/bash or /opt/homebrew/bin/bash explicitly." >&2
  exit 2
fi

GOAT_GUARD_NAME="guard-secret-paths.sh"
GOAT_GUARD_SCOPE="secret"
GOAT_GUARD_SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
GOAT_GUARD_COMMON="$GOAT_GUARD_SCRIPT_DIR/guard-common.sh"

guard_common_missing_json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "$value"
}

guard_common_unavailable() {
  local detail="$1"
  local message payload escaped
  message="$GOAT_GUARD_NAME cannot start: $detail. Re-run goat-flow setup so guard-common.sh is installed beside this hook."
  payload="$(cat || true)"
  escaped="$(guard_common_missing_json_escape "$message")"
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

if [[ ! -r "$GOAT_GUARD_COMMON" ]]; then
  guard_common_unavailable "missing required shared helper $GOAT_GUARD_COMMON"
fi

# shellcheck disable=SC1090,SC1091
source "$GOAT_GUARD_COMMON" || guard_common_unavailable "failed to load required shared helper $GOAT_GUARD_COMMON"

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

check_segment() {
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
    if [[ "$HAS_REDIRECT" -eq 1 ]]; then
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

main "$@"
