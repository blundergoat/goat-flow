# patterns-writes.sh
#
# Repository and GitHub write policy extracted from writes.sh.
# Sourced by deny-dangerous.sh; not executable on its own.
# shellcheck shell=bash disable=SC2034,SC2154,SC2317,SC2319

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

normalize_git_policy_candidate() {
  local c
  c=$(normalize_command_candidate "$1")

  local xargs_rest=""
  if xargs_rest=$(strip_xargs_prefix "$c"); then
    c="$xargs_rest"
  fi

  printf '%s' "$c"
}

is_git_commit() {
  __goat_git_strip_globals "$1" || return 1
  [[ "$__goat_git_rest" =~ ^commit([[:space:]]|$) ]]
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
    issue:create|issue:close|issue:reopen|issue:edit|issue:delete|issue:lock|issue:unlock|issue:pin|issue:unpin|issue:transfer|issue:develop)
      return 0 ;;
    pr:create|pr:review|pr:merge|pr:close|pr:reopen|pr:edit|pr:ready|pr:update-branch)
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

check_repository_segment() {
  local cmd="$1"
  local depth="${2:-0}"
  prepare_segment_context "$cmd" "$depth" || return $?
  cmd="$CMD_TRIMMED"

  if is_unredirected_unpiped_read_only "$cmd"; then
    return 0
  fi

  local repo_scan="${CMD_TRIMMED//||/__GOAT_OR__}"
  local -a pipe_parts
  local pipe_part
  IFS='|' read -ra pipe_parts <<< "$repo_scan"
  for pipe_part in "${pipe_parts[@]}"; do
    local git_candidate
    git_candidate=$(normalize_git_policy_candidate "$pipe_part")
    if is_git_push "$git_candidate"; then
      block "git push is not allowed. Ask the user to push manually." || return $?
    fi
    if is_git_commit "$git_candidate"; then
      block "git commit is not allowed. Ask the user to commit manually." || return $?
    fi
    if is_git_destructive "$git_candidate"; then
      block "Destructive git operation (--no-verify / reset --hard / clean -f). Remove the flag, stash first, or run manually." || return $?
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

}
