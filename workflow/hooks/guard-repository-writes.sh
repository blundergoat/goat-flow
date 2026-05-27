#!/usr/bin/env bash
# shellcheck disable=SC2034,SC2317,SC2319

# guard-repository-writes.sh
#
# Purpose:
#   PreToolUse hook that blocks shell commands which write to the local
#   git repository or to remote GitHub state via `gh`. Sources
#   guard-common.sh for payload parsing, command normalization, and
#   segment splitting, then evaluates each segment against the policies
#   below. Implements ADR-025 (git push is never agent-driven).
#
# Blocks:
#   - `git commit` in any form (including via `git -C <dir>`, `git -c
#     alias.x=...`, absolute paths, or `sudo` prefix).
#   - `git push` and `git send-pack` regardless of how the git invocation
#     is decorated (absolute paths, `sudo`, globals like `--git-dir`,
#     `--work-tree`, `--namespace`, or aliases that resolve to push).
#   - Destructive git flags: `--no-verify`, `reset --hard`,
#     `clean -f` / `clean --force`.
#   - GitHub writes via `gh`:
#       * `gh issue`     create / comment / close / reopen / edit /
#                        delete / lock / unlock / pin / unpin / transfer /
#                        develop
#       * `gh pr`        create / comment / review / merge / close /
#                        reopen / edit / ready / update-branch
#       * `gh release`   create / upload / delete / edit
#       * `gh repo`      create / delete / edit / fork / rename /
#                        archive / unarchive / sync / set-default
#       * `gh label`     create / delete / edit / clone
#       * `gh workflow`  run / disable / enable
#       * `gh run`       rerun / cancel / delete
#       * `gh gist`      create / edit / delete
#       * `gh secret`    set / remove / delete
#       * `gh variable`  set / delete
#       * `gh ssh-key`, `gh gpg-key`   add / delete
#       * `gh auth`      login / logout / refresh / setup-git
#       * `gh codespace`, `gh extension`, `gh project`, `gh cache` write
#         subcommands
#   - `gh api` with `-X` / `--method` other than GET or HEAD, or with
#     request-body fields (`-f`, `-F`, `--field`, `--raw-field`,
#     `--input`).
#   - `xargs ... gh <write>` (the `xargs` prefix is stripped before the
#     gh call is classified).
#
# Allows (illustrative):
#   - Read-only git: status, log, diff, show, ls-files, branch, remote.
#   - Read-only gh: `gh issue view`, `gh pr view`, `gh api ... -X GET`.
#   - Quoted-literal mentions of blocked commands inside grep/rg search
#     arguments (the matcher unquotes string literals before policy).
#
# Usage:
#   Wired in to the agent's PreToolUse hook for shell tools. Payload is
#   read from stdin (JSON) in production; the `--check` form is used by
#   guardrails-self-test.sh and for manual verification.
#
#     bash guard-repository-writes.sh --check="git push origin main"
#     echo '<agent-payload-json>' | bash guard-repository-writes.sh
#     bash guard-repository-writes.sh --self-test=smoke
#
# Exit:
#   0 to allow, 2 to block (stderr-exit mode). In Copilot / Antigravity
#   payload mode, exits 0 with a deny JSON document on stdout instead.

set -uo pipefail

if (( BASH_VERSINFO[0] < 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] < 4) )); then
  echo "guard-repository-writes.sh requires bash 4.4+ (got ${BASH_VERSION:-unknown}). On macOS install Homebrew bash and invoke /usr/local/bin/bash or /opt/homebrew/bin/bash explicitly." >&2
  exit 2
fi

GOAT_GUARD_NAME="guard-repository-writes.sh"
GOAT_GUARD_SCOPE="repository"
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

is_git_push() {
  __goat_git_strip_globals "$1" || return 1
  [[ "$__goat_git_rest" =~ ^(push|send-pack)([[:space:]]|$) ]] && return 0
  if [[ "$__goat_git_aliased_push" -eq 1 ]]; then
    return 0
  fi
  return 1
}

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

normalize_git_push_candidate() {
  normalize_command_candidate "$1"
}

is_gh_api_write() {
  local -n __goat_gh_words_ref__="$1"
  local start_index="$2"
  local method=""
  local has_body_fields=0
  local i="$start_index"
  local word=""
  local word_lc=""

  while [[ "$i" -lt "${#__goat_gh_words_ref__[@]}" ]]; do
    word="${__goat_gh_words_ref__[$i]}"
    word_lc="${word,,}"

    case "$word_lc" in
      -x|--method)
        i=$((i + 1))
        method="${__goat_gh_words_ref__[$i]:-}"
        method="${method,,}"
        ;;
      -x*)
        method="${word_lc#-x}"
        ;;
      --method=*)
        method="${word_lc#--method=}"
        ;;
      -f|-F|--field|--raw-field|--input)
        has_body_fields=1
        i=$((i + 1))
        ;;
      -f?*|-F?*|--field=*|--raw-field=*|--input=*)
        has_body_fields=1
        ;;
    esac

    i=$((i + 1))
  done

  case "$method" in
    "" )
      [[ "$has_body_fields" -eq 1 ]]
      return $?
      ;;
    get|head)
      return 1
      ;;
    *)
      return 0
      ;;
  esac
}

gh_skip_options_index() {
  local -n __goat_gh_skip_words_ref__="$1"
  local i="$2"
  local word=""

  while [[ "$i" -lt "${#__goat_gh_skip_words_ref__[@]}" ]]; do
    word="${__goat_gh_skip_words_ref__[$i]}"
    case "$word" in
      --)
        i=$((i + 1))
        break
        ;;
      --repo|--hostname|--cwd|--config-dir|--jq|--template|--cache|-R|-H|-q)
        i=$((i + 2))
        continue
        ;;
      --repo=*|--hostname=*|--cwd=*|--config-dir=*|--jq=*|--template=*|--cache=*|-R?*|-H?*|-q?*)
        i=$((i + 1))
        continue
        ;;
      --paginate|--no-pager|--help|-h)
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

  printf '%s' "$i"
}

strip_xargs_prefix() {
  local c="$1"
  local -a xargs_words=()
  split_shell_words_into xargs_words "$c"
  [[ "${#xargs_words[@]}" -eq 0 ]] && return 1

  local command_word="${xargs_words[0]##*/}"
  [[ "$command_word" == "xargs" ]] || return 1

  local i=1
  local word=""
  while [[ "$i" -lt "${#xargs_words[@]}" ]]; do
    word="${xargs_words[$i]}"
    case "$word" in
      --)
        i=$((i + 1))
        break
        ;;
      -0|--null|-r|--no-run-if-empty|-t|--verbose|-p|--interactive)
        i=$((i + 1))
        continue
        ;;
      -I|-i|-L|-l|-n|-P|-s|-E|-e|-d|--replace|--max-lines|--max-args|--max-procs|--max-chars|--eof|--delimiter)
        i=$((i + 2))
        continue
        ;;
      -I?*|-i?*|-L?*|-l?*|-n?*|-P?*|-s?*|-E?*|-e?*|-d?*|--replace=*|--max-lines=*|--max-args=*|--max-procs=*|--max-chars=*|--eof=*|--delimiter=*)
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

  [[ "$i" -lt "${#xargs_words[@]}" ]] || return 1

  local rest=""
  while [[ "$i" -lt "${#xargs_words[@]}" ]]; do
    rest+="${xargs_words[$i]} "
    i=$((i + 1))
  done
  printf '%s' "${rest% }"
}

is_gh_write_operation() {
  local c
  c=$(normalize_command_candidate "$1")

  local xargs_rest=""
  if xargs_rest=$(strip_xargs_prefix "$c"); then
    c="$xargs_rest"
  fi

  local -a words=()
  split_shell_words_into words "$c"
  [[ "${#words[@]}" -eq 0 ]] && return 1

  local gh_word="${words[0]##*/}"
  [[ "$gh_word" == "gh" ]] || return 1

  local i
  i=$(gh_skip_options_index words 1)

  local topic="${words[$i]:-}"
  [[ -z "$topic" || "$topic" == -* ]] && return 1
  topic="${topic,,}"

  if [[ "$topic" == "api" ]]; then
    is_gh_api_write words $((i + 1))
    return $?
  fi

  local subcommand_index
  subcommand_index=$(gh_skip_options_index words $((i + 1)))
  local subcommand="${words[$subcommand_index]:-}"
  subcommand="${subcommand,,}"
  case "$topic:$subcommand" in
    issue:create|issue:comment|issue:close|issue:reopen|issue:edit|issue:delete|issue:lock|issue:unlock|issue:pin|issue:unpin|issue:transfer|issue:develop)
      return 0 ;;
    pr:create|pr:comment|pr:review|pr:merge|pr:close|pr:reopen|pr:edit|pr:ready|pr:update-branch)
      return 0 ;;
    release:create|release:upload|release:delete|release:edit)
      return 0 ;;
    repo:create|repo:delete|repo:edit|repo:fork|repo:rename|repo:archive|repo:unarchive|repo:sync|repo:set-default)
      return 0 ;;
    label:create|label:delete|label:edit|label:clone)
      return 0 ;;
    workflow:run|workflow:disable|workflow:enable)
      return 0 ;;
    run:rerun|run:cancel|run:delete)
      return 0 ;;
    gist:create|gist:edit|gist:delete)
      return 0 ;;
    secret:set|secret:remove|secret:delete)
      return 0 ;;
    variable:set|variable:delete)
      return 0 ;;
    ssh-key:add|ssh-key:delete|gpg-key:add|gpg-key:delete)
      return 0 ;;
    auth:login|auth:logout|auth:refresh|auth:setup-git)
      return 0 ;;
    codespace:create|codespace:delete|codespace:edit)
      return 0 ;;
    extension:install|extension:remove|extension:upgrade)
      return 0 ;;
    project:create|project:delete|project:edit|project:close|project:copy|project:link|project:unlink|project:mark-template|project:field-create|project:field-delete|project:field-update|project:item-add|project:item-archive|project:item-create|project:item-delete|project:item-edit)
      return 0 ;;
    cache:delete)
      return 0 ;;
  esac

  return 1
}

check_segment() {
  local cmd="$1"
  local depth="${2:-0}"
  prepare_segment_context "$cmd" "$depth" || return $?
  cmd="$CMD_TRIMMED"

  if is_unredirected_unpiped_read_only "$cmd"; then
    return 0
  fi

  local push_scan="${CMD_LOWER//||/__GOAT_OR__}"
  local -a pipe_parts
  local pipe_part
  IFS='|' read -ra pipe_parts <<< "$push_scan"
  for pipe_part in "${pipe_parts[@]}"; do
    local cmd_for_push
    cmd_for_push=$(normalize_git_push_candidate "$pipe_part")
    if is_git_push "$cmd_for_push"; then
      block "git push is not allowed. Ask the user to push manually." || return $?
    fi
  done

  local gh_scan="${CMD_TRIMMED//||/__GOAT_OR__}"
  local -a gh_pipe_parts
  IFS='|' read -ra gh_pipe_parts <<< "$gh_scan"
  for pipe_part in "${gh_pipe_parts[@]}"; do
    if is_gh_write_operation "$pipe_part"; then
      block "GitHub write via gh is not allowed. Draft the content or command and wait for explicit user approval." || return $?
    fi
  done

  local git_rest=""
  local git_subcommand=""
  if __goat_git_strip_globals "$CMD_NORMALIZED"; then
    git_rest="$__goat_git_rest"
    git_subcommand="${git_rest%%[[:space:]]*}"
    if [[ "$git_subcommand" == "commit" ]]; then
      block "git commit is not allowed. Ask the user to commit manually." || return $?
    fi
  fi

  if is_git_destructive "$CMD_NORMALIZED"; then
    block "Destructive git operation (--no-verify / reset --hard / clean -f). Remove the flag, stash first, or run manually." || return $?
  fi
}

main "$@"
