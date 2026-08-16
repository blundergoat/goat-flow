# patterns-writes.sh
#
# Protects the developer's repository and GitHub project from agent-authored writes.
# Use through deny-dangerous.sh when an agent proposes a shell command that may
# change history, publish work, or mutate remote project state.
# Read-only status and search evidence remain available to the developer.
# shellcheck shell=bash disable=SC2034,SC2154,SC2317,SC2319

__goat_git_rest=""
__goat_git_aliased_push=0

# Decide whether a direct subcommand or alias expansion publishes Git objects.
# Use for both visible Git commands and alias config so their deny set cannot drift.
is_git_publication_target() {
  local candidate="$1"
  candidate="${candidate#"${candidate%%[![:space:]]*}"}"
  case "$candidate" in
    push | push\ * | send-pack | send-pack\ * | \!*) return 0 ;;
    *) return 1 ;;
  esac
}

# Decide whether one Git config operand defines an alias that can publish.
is_git_publication_alias_config() {
  local config_operand="$1"
  local alias_expansion=""
  if [[ "$config_operand" =~ ^alias\.[a-zA-Z0-9_-]+=(.*)$ ]]; then
    alias_expansion="${BASH_REMATCH[1]}"
    is_git_publication_target "$alias_expansion"
    return $?
  fi
  return 1
}

# Decide whether a proposed Git command would publish work to a remote.
# Use after shared wrapper normalization so the user sees one push policy everywhere.
is_git_push() {
  __goat_git_strip_globals "$1" || return 1
  is_git_publication_target "$__goat_git_rest" && return 0
  # A configured Git alias can publish even when the visible subcommand is different.
  if [[ "$__goat_git_aliased_push" -eq 1 ]]; then
    return 0
  fi
  return 1
}

# Decide whether an existing guarded Git flag can discard work or bypass checks.
# Use before execution so the developer retains the manual recovery decision.
is_git_destructive() {
  __goat_git_strip_globals "$1" || return 1
  local rest="$__goat_git_rest"
  # No-verify bypasses project checks the user expects before history changes.
  if [[ "$rest" =~ (^|[[:space:]])--no-verify([[:space:]]|$) ]]; then
    return 0
  fi
  # Hard reset can discard the user's index and worktree state.
  if [[ "$rest" =~ ^reset([[:space:]]|$) ]] && [[ "$rest" =~ (^|[[:space:]])--hard([[:space:]]|$) ]]; then
    return 0
  fi
  # Forced clean can remove untracked work the user has not reviewed.
  if [[ "$rest" =~ ^clean([[:space:]]|$) ]] && \
     { [[ "$rest" =~ (^|[[:space:]])--force([[:space:]]|$) ]] || \
       [[ "$rest" =~ (^|[[:space:]])-[^-[:space:]]*f[^[:space:]]*([[:space:]]|$) ]]; }; then
    return 0
  fi
  return 1
}

# Reveal a direct Git-push candidate after common shell wrappers.
normalize_git_push_candidate() {
  normalize_command_candidate "$1"
}

# Reveal the command xargs will run before applying repository policy.
# Empty output means the proposed command is not a supported xargs payload shape.
normalize_git_policy_candidate() {
  local repository_candidate
  repository_candidate=$(normalize_command_candidate "$1")

  local xargs_payload=""
  # Shared option parsing keeps separated argument-file forms from hiding the payload.
  if xargs_payload=$(strip_xargs_payload_command "$repository_candidate"); then
    repository_candidate="$xargs_payload"
  fi

  printf '%s' "$repository_candidate"
}

# Decide whether a Git command creates history reserved for the developer.
is_git_commit() {
  __goat_git_strip_globals "$1" || return 1
  [[ "$__goat_git_rest" =~ ^commit([[:space:]]|$) ]]
}

# Decide whether `gh api` uses a write method or an implicit body-bearing POST.
# Use so users can still fetch API evidence without silently mutating GitHub.
is_gh_api_write() {
  local -n __goat_gh_words_ref__="$1"
  local start_index="$2"
  local method=""
  local has_body_fields=0
  local i="$start_index"
  local word=""
  local word_lc=""

  # Inspect every API flag because method and body fields may appear in either order.
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

# Return the first GitHub CLI command word after global or inherited options.
# An index at array end means the user supplied options but no command.
gh_skip_options_index() {
  local -n __goat_gh_skip_words_ref__="$1"
  local i="$2"
  local word=""

  # GitHub accepts many options before and between command levels.
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

# Decide whether a GitHub CLI command mutates shared project state.
# The only write exceptions remain issue and pull-request conversation comments.
is_gh_write_operation() {
  local github_candidate
  github_candidate=$(normalize_command_candidate "$1")

  local xargs_payload=""
  # Shared xargs parsing reveals the GitHub command after every supported option form.
  if xargs_payload=$(strip_xargs_payload_command "$github_candidate"); then
    github_candidate="$xargs_payload"
  fi

  local -a words=()
  split_shell_words_into words "$github_candidate"
  # Empty text cannot name a GitHub write operation.
  [[ "${#words[@]}" -eq 0 ]] && return 1

  local gh_word="${words[0]##*/}"
  # Only the GitHub CLI owns this command grammar.
  [[ "$gh_word" == "gh" ]] || return 1

  local i
  i=$(gh_skip_options_index words 1)

  local topic="${words[$i]:-}"
  # Missing command topics and option-only invocations do not mutate GitHub.
  [[ -z "$topic" || "$topic" == -* ]] && return 1
  topic="${topic,,}"

  # API writes use method and field semantics instead of named subcommands.
  if [[ "$topic" == "api" ]]; then
    is_gh_api_write words $((i + 1))
    return $?
  fi

  local subcommand_index
  subcommand_index=$(gh_skip_options_index words $((i + 1)))
  local subcommand="${words[$subcommand_index]:-}"
  subcommand="${subcommand,,}"
  local nested_subcommand_index
  nested_subcommand_index=$(gh_skip_options_index words $((subcommand_index + 1)))
  local nested_subcommand="${words[$nested_subcommand_index]:-}"
  nested_subcommand="${nested_subcommand,,}"
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
    codespace:create|codespace:delete|codespace:edit|codespace:stop)
      return 0 ;;
    extension:install|extension:remove|extension:upgrade)
      return 0 ;;
    project:create|project:delete|project:edit|project:close|project:copy|project:link|project:unlink|project:mark-template|project:field-create|project:field-delete|project:field-update|project:item-add|project:item-archive|project:item-create|project:item-delete|project:item-edit)
      return 0 ;;
    cache:delete)
      return 0 ;;
  esac

  case "$topic:$subcommand:$nested_subcommand" in
    repo:deploy-key:add|repo:deploy-key:delete)
      return 0 ;;
  esac

  return 1
}

# Check each executable pipeline stage before the developer lets an agent run it.
# Quoted search text stays evidence; real repository or GitHub write stages are refused.
check_repository_segment() {
  local developer_command="$1"
  developer_command="$CMD_TRIMMED"

  # A plain read-only command gives the developer evidence without changing project state.
  if is_unredirected_unpiped_read_only "$developer_command"; then
    return 0
  fi

  local -a repository_pipeline_stages=()
  local repository_pipeline_stage=""
  split_top_level_pipeline_stages_into repository_pipeline_stages "$developer_command"

  # Every real stage is checked so a safe producer cannot hide a repository write downstream.
  for repository_pipeline_stage in "${repository_pipeline_stages[@]}"; do
    local repository_write_candidate=""
    repository_write_candidate=$(normalize_git_policy_candidate "$repository_pipeline_stage")

    # Remote publication is always left to the developer, regardless of wrappers or pipeline position.
    if is_git_push "$repository_write_candidate"; then
      block "Git publication is not allowed. Ask the user to push manually." || return $?
    fi

    # History creation is always left to the developer, even when an agent was asked to prepare it.
    if is_git_commit "$repository_write_candidate"; then
      block "git commit is not allowed. Ask the user to commit manually." || return $?
    fi

    # Destructive history or cleanup flags require a manual developer decision and recovery plan.
    if is_git_destructive "$repository_write_candidate"; then
      block \
        "Destructive git operation (--no-verify / reset --hard / clean -f). Remove the flag, stash first, or run manually." ||
        return $?
    fi
  done

  # Remote project stages are checked separately so read-only Git evidence does not mask a GitHub mutation.
  for repository_pipeline_stage in "${repository_pipeline_stages[@]}"; do
    # A GitHub mutation is drafted for the developer instead of being sent without approval.
    if is_gh_write_operation "$repository_pipeline_stage"; then
      block \
        "GitHub write via gh is not allowed. Draft the content or command and wait for explicit user approval." ||
        return $?
    fi
  done

}
