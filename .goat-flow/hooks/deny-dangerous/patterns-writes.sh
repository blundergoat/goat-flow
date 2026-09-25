# patterns-writes.sh
#
# Protects the developer's repository and GitHub project from agent-authored writes.
# deny-git-mutations.sh controls both native Git and GitHub writes for the selected project.
#
# Both use the shared parser before classifying history, publication, or remote writes.
# Read-only status and search evidence remain available to the developer.
# shellcheck shell=bash disable=SC2034,SC2154,SC2317,SC2319

__goat_git_rest=""
__goat_git_selected_directory="$PWD"
__goat_git_aliased_push=0
__goat_git_aliased_commit=0
__goat_git_aliased_destructive=0
# Alias name (lowercased, as Git matches it) to its normalized expansion, for the command being inspected.
declare -gA __goat_git_alias_expansions=()
# Preserve alias argument boundaries for Git commands that execute a nested shell command.
declare -gA __goat_git_raw_alias_expansions=()

# Decide whether a direct subcommand or alias expansion publishes Git objects.
# Use for both visible Git commands and alias config so their deny set cannot drift.
is_git_publication_target() {
  local candidate="$1"
  candidate="${candidate#"${candidate%%[![:space:]]*}"}"
  case "$candidate" in
    push | push\ * | send-pack | send-pack\ * | http-push | http-push\ * | \!*) return 0 ;;
    *) return 1 ;;
  esac
}

# Reveal the command and flags Git reads after splitting an alias value.
#
# The operand's outer shell quotes are already removed; Git removes another layer from every word.
# Reuse the inert word parser so quoted destructive flags reach the same checks as visible flags.
normalize_git_alias_expansion() {
  local -a alias_words=()
  split_shell_words_into alias_words "$1"
  join_shell_words_from alias_words 0
}

# Decide whether one Git config operand defines an alias that can publish.
# Kept for an older guard runtime that still calls it during a partial install; new runtimes record every class below.
is_git_publication_alias_config() {
  local config_operand="$1"
  local alias_expansion=""
  # Only an alias value can hide a publishing action; other temporary Git settings add no publication target.
  if [[ "$config_operand" =~ ^alias\.[a-zA-Z0-9_-]+=(.*)$ ]]; then
    alias_expansion="$(normalize_git_alias_expansion "${BASH_REMATCH[1]}")"
    is_git_publication_target "$alias_expansion"
    return $?
  fi
  return 1
}

# Git verbs that create, rewrite or move history reserved for the developer, before any non-committing exemption.
# Notes changes create commits under a notes ref even when the developer's current branch stays unchanged.
__goat_git_history_verbs=" commit commit-tree update-ref cherry-pick revert am merge rebase pull filter-branch filter-repo fast-import reset branch checkout switch fetch symbolic-ref replace notes worktree "

# Decide whether a verb's arguments are exactly one of the listed words.
# Use for recovery modes such as `--abort`, which Git accepts only without other arguments.
git_arguments_are_one_of() {
  local arguments="$1"
  [[ -n "$arguments" && "$arguments" != *[[:space:]]* && " $2 " == *" $arguments "* ]]
}

# Decide whether every flag in a verb's arguments uses one of the listed exact spellings; other words are operands.
# Git accepts abbreviations and negations such as `--commit` for `--no-commit`, so any unlisted flag keeps the command guarded.
git_flags_within() {
  local -a argument_words=()
  local argument_word
  # Reading to NUL keeps words after an embedded newline in view instead of stopping at the first line.
  read -r -d '' -a argument_words <<< "$1" || true
  for argument_word in "${argument_words[@]}"; do
    [[ "$argument_word" == -* && " $2 " != *" $argument_word "* ]] && return 1
  done
  return 0
}

# Decide whether one exact flag appears among a verb's arguments.
git_arguments_include() {
  [[ " $1 " == *" $2 "* ]]
}

# An explicit fetch destination can update a local branch instead of only a remote-tracking ref.
git_fetch_refspec_moves_local_ref() {
  local refspec="$1"
  [[ "$refspec" == *:* ]] || return 1
  local destination="${refspec#*:}"
  [[ -n "$destination" && "$destination" != refs/remotes/* && "$destination" != FETCH_HEAD ]]
}

# Skip option values before locating the remote; an SSH remote also contains a colon.
# Refmaps and stdin-supplied refspecs need their own decision because neither is a positional destination.
git_fetch_moves_local_ref() {
  local -a fetch_words=()
  local fetch_word expected_value=""
  local remote_seen=0 multiple_remotes=0
  read -r -d '' -a fetch_words <<< "$1" || true
  for fetch_word in "${fetch_words[@]}"; do
    if [[ "$expected_value" == "refmap" ]]; then
      expected_value=""
      git_fetch_refspec_moves_local_ref "$fetch_word" && return 0
      continue
    fi
    if [[ "$expected_value" == "other" ]]; then
      expected_value=""
      continue
    fi
    git_option_present "$fetch_word" "" stdin 3 "" && return 0
    if git_option_present "$fetch_word" "" refmap 4 ""; then
      if [[ "$fetch_word" == *=* ]]; then
        git_fetch_refspec_moves_local_ref "${fetch_word#*=}" && return 0
      else
        expected_value="refmap"
      fi
      continue
    fi
    if git_option_present "$fetch_word" m multiple 4 ""; then
      multiple_remotes=1
      continue
    fi
    case "$fetch_word" in
      --upload-pack|--jobs|-j|--depth|--deepen|--shallow-since|--shallow-exclude|--server-option|-o|--negotiation-tip|--filter)
        expected_value="other"
        continue
        ;;
      --|-*) continue ;;
    esac
    if [[ "$remote_seen" -eq 0 ]]; then
      remote_seen=1
    elif [[ "$multiple_remotes" -eq 0 ]]; then
      git_fetch_refspec_moves_local_ref "$fetch_word" && return 0
    fi
  done
  return 1
}

# Git reset with a pathspec or the current HEAD only changes the index. Other revisions can move the branch.
git_reset_is_index_only() {
  local -a reset_words=()
  local reset_word first_operand="" has_path_operand=0 has_index_mode=0 after_separator=0
  read -r -d '' -a reset_words <<< "$1" || true
  for reset_word in "${reset_words[@]}"; do
    if [[ "$after_separator" -eq 1 ]]; then
      has_path_operand=1
      continue
    fi
    case "$reset_word" in
      --hard|--soft|--merge|--keep) return 1 ;;
      --) after_separator=1; continue ;;
      -p|--patch|--pathspec-from-file|--pathspec-from-file=*) has_index_mode=1; continue ;;
      -q|--quiet|--mixed|--no-refresh|--refresh|--pathspec-file-nul) continue ;;
      -*) return 1 ;;
    esac
    if [[ -z "$first_operand" ]]; then
      first_operand="$reset_word"
    else
      has_path_operand=1
    fi
  done
  [[ "$has_index_mode" -eq 1 || "$has_path_operand" -eq 1 || -z "$first_operand" || "$first_operand" == HEAD ]]
}

# `worktree add -B` resets a branch, while `-b` and `--reason` consume their following word as data.
git_worktree_add_resets_branch() {
  local -n worktree_words_ref="$1"
  [[ "${worktree_words_ref[0]:-}" == worktree && "${worktree_words_ref[1]:-}" == add ]] || return 1
  local index word bundle letter
  for ((index = 2; index < ${#worktree_words_ref[@]}; index++)); do
    word="${worktree_words_ref[index]}"
    case "$word" in
      --) return 1 ;;
      --reason|-b) index=$((index + 1)); continue ;;
      --reason=*|-b?*) continue ;;
      -B|-B?*) return 0 ;;
      -?*)
        bundle="${word#-}"
        for ((letter = 0; letter < ${#bundle}; letter++)); do
          [[ "${bundle:letter:1}" == B ]] && return 0
          [[ "${bundle:letter:1}" == b ]] && break
        done
        ;;
    esac
  done
  return 1
}

# One symbolic-ref operand reads a ref; a second operand or a deletion flag writes it.
git_symbolic_ref_is_read_only() {
  local -a ref_words=()
  local ref_word operands=0 after_separator=0
  read -r -d '' -a ref_words <<< "$1" || true
  for ref_word in "${ref_words[@]}"; do
    if [[ "$after_separator" -eq 0 ]]; then
      case "$ref_word" in
        --) after_separator=1; continue ;;
        -q|--quiet|--short|--recurse|--no-recurse) continue ;;
        -*) return 1 ;;
      esac
    fi
    operands=$((operands + 1))
  done
  [[ "$operands" -eq 1 ]]
}

# Keep notes inspection, prune previews and merge recovery available without allowing notes history writes.
# The optional ref selector precedes the mode; for example, `--ref review show HEAD` reads the user's review notes.
git_notes_preserves_history() {
  local -a notes_words=()
  local notes_index=0 notes_mode notes_arguments
  read -r -d '' -a notes_words <<< "$1" || true
  # Consume each ref selector so a ref named `list` cannot disguise a following write mode.
  while [[ "$notes_index" -lt "${#notes_words[@]}" ]]; do
    case "${notes_words[$notes_index]}" in
      --ref) notes_index=$((notes_index + 2)) ;;
      --ref=*|--no-ref) notes_index=$((notes_index + 1)) ;;
      --) notes_index=$((notes_index + 1)); break ;;
      -h|--help) break ;;
      -*) return 1 ;;
      *) break ;;
    esac
  done
  # No mode means Git lists notes; an alias is checked again after its visible arguments are appended.
  [[ "$notes_index" -ge "${#notes_words[@]}" ]] && return 0
  notes_mode="${notes_words[$notes_index]}"
  notes_arguments="${notes_words[*]:notes_index+1}"
  git_arguments_are_one_of "$notes_arguments" "-h --help" && return 0
  case "$notes_mode" in
    -h|--help) [[ -z "$notes_arguments" ]] && return 0 ;;
    list|show|get-ref) return 0 ;;
    prune)
      # Only an explicit preview with known flags can avoid deleting notes and writing a new notes commit.
      if git_flags_within "$notes_arguments" "-n --dry-run -v --verbose" &&
        { git_arguments_include "$notes_arguments" "-n" || git_arguments_include "$notes_arguments" "--dry-run"; }; then
        return 0
      fi
      ;;
    merge)
      # Aborting an unfinished notes merge is recovery; committing or starting that merge still needs the developer.
      if git_flags_within "$notes_arguments" "--abort -v --verbose -q --quiet" &&
        git_arguments_include "$notes_arguments" "--abort"; then
        return 0
      fi
      ;;
  esac
  return 1
}

# Decide whether a direct subcommand or alias expansion creates history reserved for the developer.
# Pass `strict` for alias expansions: Git appends the visible arguments to an alias, and those can undo an exempt form.
is_git_commit_target() {
  local candidate="$1"
  local mode="${2:-}"
  candidate="${candidate#"${candidate%%[![:space:]]*}"}"
  local verb="${candidate%%[[:space:]]*}"
  local arguments=""
  [[ "$candidate" == *[[:space:]]* ]] && arguments="${candidate#*[[:space:]]}"
  [[ "$__goat_git_history_verbs" == *" $verb "* ]] || return 1
  # Aliases to a conditional verb are safe until their own or appended arguments select the history-writing form.
  if [[ "$mode" == "strict" && " reset branch checkout switch fetch symbolic-ref replace notes worktree " != *" $verb "* ]]; then
    return 0
  fi
  # A lone help flag prints usage and changes nothing, so an agent can still check a verb's option spellings.
  git_arguments_are_one_of "$arguments" "-h --help" && return 1
  # Exemptions allow only exact spellings, so an abbreviation, negation or unknown flag stays with the developer.
  case "$verb" in
    notes)
      git_notes_preserves_history "$arguments" && return 1
      ;;
    reset)
      # The existing destructive gate gives a hard reset its specific recovery reason.
      [[ "$arguments" =~ (^|[[:space:]])--hard([[:space:]]|$) ]] && return 1
      git_reset_is_index_only "$arguments" && return 1
      ;;
    branch)
      git_option_present "$arguments" f force 1 cC && return 0
      git_option_present "$arguments" D "" 0 cC && return 0
      git_option_present "$arguments" M "" 0 cC && return 0
      git_option_present "$arguments" C "" 0 c && return 0
      return 1
      ;;
    symbolic-ref)
      git_symbolic_ref_is_read_only "$arguments" && return 1
      ;;
    replace)
      [[ -z "$arguments" ]] && return 1
      if git_flags_within "$arguments" "-l --list --format=short --format=medium --format=long" &&
        { git_arguments_include "$arguments" "-l" || git_arguments_include "$arguments" "--list"; }; then
        return 1
      fi
      ;;
    checkout)
      git_option_present "$arguments" B force-create 7 b && return 0
      return 1
      ;;
    switch)
      git_option_present "$arguments" C force-create 7 c && return 0
      return 1
      ;;
    fetch)
      git_fetch_moves_local_ref "$arguments" && return 0
      return 1
      ;;
    worktree)
      if [[ "$mode" == direct ]]; then
        git_worktree_add_resets_branch __goat_git_command_words && return 0
      else
        local -a worktree_words=()
        split_shell_words_into worktree_words "$candidate"
        git_worktree_add_resets_branch worktree_words && return 0
      fi
      return 1
      ;;
    cherry-pick|revert)
      git_arguments_are_one_of "$arguments" "--abort --quit" && return 1
      if git_flags_within "$arguments" "-n --no-commit" &&
        { git_arguments_include "$arguments" "-n" || git_arguments_include "$arguments" "--no-commit"; }; then
        return 1
      fi
      ;;
    am)
      git_arguments_are_one_of "$arguments" "--abort --quit --show-current-patch --show-current-patch=diff --show-current-patch=raw" && return 1
      ;;
    merge)
      git_arguments_are_one_of "$arguments" "--abort --quit" && return 1
      # A fast-forward moves the branch even with --no-commit; only --squash or --no-ff --no-commit leaves HEAD in place.
      if git_flags_within "$arguments" "--squash --no-ff --no-commit --stat --no-stat -q --quiet"; then
        git_arguments_include "$arguments" "--squash" && return 1
        git_arguments_include "$arguments" "--no-ff" && git_arguments_include "$arguments" "--no-commit" && return 1
      fi
      ;;
    rebase)
      git_arguments_are_one_of "$arguments" "--abort --quit --show-current-patch" && return 1
      ;;
  esac
  # Pull always fetches and then merges or rebases, so it has no non-committing exemption.
  return 0
}

# Decide whether a direct subcommand or alias expansion carries a guarded destructive flag.
# Use for both the visible command and alias values so the deny set cannot drift between them.
is_git_destructive_target() {
  local rest="$1"
  rest="${rest#"${rest%%[![:space:]]*}"}"
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
  local git_verb="${rest%%[[:space:]]*}"
  local git_arguments=""
  [[ "$rest" == *[[:space:]]* ]] && git_arguments="${rest#*[[:space:]]}"
  # A usage request such as `stash drop -h` prints help and changes nothing.
  git_arguments_request_usage_only "$git_arguments" && return 1
  case "$git_verb" in
    submodule)
      # Forced checkout/deinitialization can discard edits inside a submodule's worktree.
      if [[ "$git_arguments" =~ ^((--quiet|-q)[[:space:]]+)*(deinit|update)([[:space:]]|$) ]]; then
        git_option_present "$git_arguments" f force 1 "" && return 0
      fi
      ;;
    tag)
      git_option_present "$git_arguments" d delete 1 mF && return 0
      git_option_present "$git_arguments" f force 1 mF && return 0
      ;;
    remote)
      # Removing a remote drops its configuration and remote-tracking refs.
      [[ "$git_arguments" =~ ^((-v|--verbose)[[:space:]]+)*(remove|rm)([[:space:]]|$) ]] && return 0
      ;;
    rm)
      # Force removes tracked work even when Git's up-to-date check would otherwise protect it.
      git_option_present "$git_arguments" n dry-run 3 "" && return 1
      git_option_present "$git_arguments" "" cached 3 "" && return 1
      git_option_present "$git_arguments" f force 1 "" && return 0
      ;;
    checkout-index)
      git_option_present "$git_arguments" n "" 0 "" && return 1
      git_option_present "$git_arguments" f force 1 "" && return 0
      ;;
    read-tree)
      git_option_present "$git_arguments" u "" 0 "" &&
        git_option_present "$git_arguments" "" reset 2 "" && return 0
      ;;
    worktree)
      if [[ "$git_arguments" =~ ^remove([[:space:]]|$) ]]; then
        git_option_present "$git_arguments" f force 1 "" && return 0
      fi
      ;;
    restore)
      # A bulk restore discards every matching uncommitted edit, like a hard reset; an index-only restore keeps them.
      if git_pathspecs_name_bulk restore "$git_arguments"; then
        git_option_present "$git_arguments" W worktree 1 s && return 0
        git_option_present "$git_arguments" S staged 2 s && return 1
        return 0
      fi
      ;;
    checkout)
      # A forced or bulk checkout overwrites uncommitted edits the user has not saved anywhere else.
      git_option_present "$git_arguments" f force 1 bB && return 0
      git_pathspecs_name_bulk checkout "$git_arguments" && return 0
      ;;
    switch)
      # A forced switch discards uncommitted edits; `-f` and `--force` are Git's aliases for `--discard-changes`.
      git_option_present "$git_arguments" f force 1 cC && return 0
      git_option_present "$git_arguments" "" discard-changes 2 cC && return 0
      ;;
    stash)
      # Dropping or clearing a stash deletes saved work that nothing else references.
      [[ "$git_arguments" =~ ^(drop|clear)([[:space:]]|$) ]] && return 0
      ;;
    reflog)
      # Expiring or deleting reflog entries removes the only recovery path for reset or rewritten commits.
      [[ "$git_arguments" =~ ^(expire|delete)([[:space:]]|$) ]] && return 0
      ;;
  esac
  return 1
}

# Decide whether a verb's arguments only ask for usage, optionally after one subcommand such as `drop`.
git_arguments_request_usage_only() {
  local -a usage_words=()
  read -r -d '' -a usage_words <<< "$1" || true
  # Stash and reflog name their subcommand before its options, so `drop -h` is still only a usage request.
  if [[ "${#usage_words[@]}" -eq 2 && "${usage_words[0]}" != -* ]]; then
    usage_words=("${usage_words[1]}")
  fi
  [[ "${#usage_words[@]}" -eq 1 && ( "${usage_words[0]}" == "-h" || "${usage_words[0]}" == "--help" ) ]]
}

# Decide whether Git would parse one option from the words before `--`.
# Git accepts a short flag inside a bundle (`-fq`) and a unique long prefix (`--forc`), so exact-word matching misses
# real spellings. A value-taking short flag ends its bundle: `-bfix` names branch `fix` rather than setting `-f`.
#   $1 arguments; $2 short letter, or empty for a long-only option; $3 long name without dashes;
#   $4 shortest prefix Git accepts for that name; $5 short letters that take a value
git_option_present() {
  local -a option_words=()
  local option_word long_name bundle letter
  local index
  read -r -d '' -a option_words <<< "$1" || true
  for option_word in "${option_words[@]}"; do
    [[ "$option_word" == "--" ]] && return 1
    if [[ "$option_word" == --?* ]]; then
      long_name="${option_word#--}"
      long_name="${long_name%%=*}"
      [[ "${#long_name}" -ge "$4" && "$3" == "$long_name"* ]] && return 0
      continue
    fi
    [[ -n "$2" && "$option_word" == -?* ]] || continue
    bundle="${option_word#-}"
    for ((index = 0; index < ${#bundle}; index++)); do
      letter="${bundle:index:1}"
      [[ "$letter" == "$2" ]] && return 0
      [[ "$5" == *"$letter"* ]] && break
    done
  done
  return 1
}

# Decide whether restore or checkout names a bulk pathspec: the whole tree in a spelling this hook can resolve, exclusion
# or glob magic, a `*` or `?` glob, a directory, a pathspec file, or a command substitution.
# A plain relative file such as `src/app.ts` or `app/[id]/page.tsx` stays a targeted restore.
#   $1 verb: `restore` reads every operand as a path, `checkout` only after `--`; $2 arguments
git_pathspecs_name_bulk() {
  local verb="$1"
  # `pathspec-fr` is the shortest prefix distinct from `pathspec-file-nul`; honor Git's option separator.
  git_option_present "$2" "" pathspec-from-file 11 s && return 0
  local -a pathspec_words=()
  local pathspec_word normalized
  local after_separator=0
  local skip_value=0
  local parent_pattern='^\.\.(/\.\.)*$'
  local long_magic_pattern='^:\(([a-z,]*)\)(.*)$'
  local short_magic_pattern='^:([/!^]*):?(.*)$'
  read -r -d '' -a pathspec_words <<< "$2" || true
  for pathspec_word in "${pathspec_words[@]}"; do
    # A separate `--source` value names a tree, not a path.
    if [[ "$skip_value" -eq 1 ]]; then
      skip_value=0
      continue
    fi
    if [[ "$after_separator" -eq 0 ]]; then
      case "$pathspec_word" in
        --) after_separator=1; continue ;;
        -s | --source) skip_value=1; continue ;;
        -*) continue ;;
      esac
    fi
    # A command substitution expands to a path list, often every changed file. Before `--`, a checkout operand may
    # name a branch instead, so only restore operands and checkout operands after `--` count.
    if [[ "$pathspec_word" == *"\$("* || "$pathspec_word" == *"\`"* ]]; then
      [[ "$verb" == "restore" || "$after_separator" -eq 1 ]] && return 0
      continue
    fi
    # Resolve the home and working-directory spellings the hook can see; quote removal leaves ANSI-C `$'.'` as `$.`.
    if [[ "${__goat_git_directory_unknown:-0}" -eq 1 && ( "$pathspec_word" == \$PWD* || "$pathspec_word" == \$\{PWD\}* ) ]]; then
      __goat_git_pathspec_unknown_directory=1
      return 0
    fi
    case "$pathspec_word" in
      \~ | \~/*) normalized="$HOME${pathspec_word:1}" ;;
      "\$HOME" | "\$HOME/"*) normalized="$HOME${pathspec_word:5}" ;;
      "\${HOME}" | "\${HOME}/"*) normalized="$HOME${pathspec_word:7}" ;;
      "\$PWD" | "\$PWD/"*) normalized="${__goat_git_command_directory:-$PWD}${pathspec_word:4}" ;;
      "\${PWD}" | "\${PWD}/"*) normalized="${__goat_git_command_directory:-$PWD}${pathspec_word:6}" ;;
      *) normalized="${pathspec_word#\$}" ;;
    esac
    # Pathspec magic: `:/` and `:(top)` anchor at the repository root, `:(literal)` turns globbing off and `:(icase)` only
    # relaxes case. Exclusion (`:!x`, `:^x`, `:(exclude)`), `:(glob)` and attribute magic select many files at once.
    local literal_pathspec=0
    if [[ "$normalized" == :\(* ]]; then
      [[ "$normalized" =~ $long_magic_pattern ]] || return 0
      local -a magic_words=()
      local magic_word
      IFS=, read -r -a magic_words <<< "${BASH_REMATCH[1]}"
      normalized="${BASH_REMATCH[2]}"
      for magic_word in "${magic_words[@]}"; do
        case "$magic_word" in
          top | icase) ;;
          literal) literal_pathspec=1 ;;
          *) return 0 ;;
        esac
      done
    elif [[ "$normalized" == :* ]]; then
      [[ "$normalized" =~ $short_magic_pattern ]] || return 0
      [[ "${BASH_REMATCH[1]}" == *'!'* || "${BASH_REMATCH[1]}" == *'^'* ]] && return 0
      normalized="${BASH_REMATCH[2]}"
    fi
    # `*` and `?` expand to many files. A `[` class matches one character and names dynamic-route files such as
    # `app/[id]/page.tsx`, which Git matches exactly before trying the class, so brackets alone stay targeted.
    [[ "$literal_pathspec" -eq 0 && "$normalized" == *[\*\?]* ]] && return 0
    # Git folds internal dot and parent components before matching, so `src/..` is as broad as `.`.
    local -a path_components=() normalized_components=()
    local component absolute_path=0
    [[ "$normalized" == /* ]] && absolute_path=1
    IFS=/ read -r -a path_components <<< "$normalized"
    for component in "${path_components[@]}"; do
      case "$component" in
        "" | .) ;;
        ..)
          if [[ "${#normalized_components[@]}" -gt 0 && "${normalized_components[-1]}" != ".." ]]; then
            unset 'normalized_components[-1]'
          elif [[ "$absolute_path" -eq 0 ]]; then
            normalized_components+=("..")
          fi
          ;;
        *) normalized_components+=("$component") ;;
      esac
    done
    printf -v normalized '%s/' "${normalized_components[@]}"
    normalized="${normalized%/}"
    [[ "$absolute_path" -eq 1 ]] && normalized="/$normalized"
    # An absolute directory pathspec can select multiple tracked files even after `git -C`.
    if [[ "$normalized" == /* ]]; then
      normalized="${normalized%/}"
      [[ -d "${normalized:-/}" ]] && return 0
      continue
    fi
    [[ -z "$normalized" || "$normalized" == "." || "$normalized" =~ $parent_pattern ]] && return 0
    # A dynamic cd or Git -C leaves relative pathspec scope unknown; restore and `checkout --` can discard many files.
    if [[ "${__goat_git_selected_directory_unknown:-0}" -eq 1 && ( "$verb" == "restore" || "$after_separator" -eq 1 ) ]]; then
      __goat_git_pathspec_unknown_directory=1
      return 0
    fi
    # A plain relative directory is a bulk pathspec even without glob or top magic.
    [[ -d "$__goat_git_selected_directory/$normalized" ]] && return 0
  done
  return 1
}

# Clear the recorded alias classes before a Git command is parsed so one command never inherits another's aliases.
reset_git_alias_flags() {
  __goat_git_aliased_push=0
  __goat_git_aliased_commit=0
  __goat_git_aliased_destructive=0
  __goat_git_alias_expansions=()
  __goat_git_raw_alias_expansions=()
}

# Record all guarded actions in an alias so another visible command word cannot hide a developer-only write.
record_git_alias_expansion() {
  local alias_expansion
  alias_expansion="$(normalize_git_alias_expansion "$1")"
  # Publishing through an alias requires the same developer-controlled action as a direct Git publication command.
  if is_git_publication_target "$alias_expansion"; then
    __goat_git_aliased_push=1
  fi
  # History creation remains reserved for the developer even when an alias conceals the commit subcommand.
  if is_git_commit_target "$alias_expansion" strict; then
    __goat_git_aliased_commit=1
  fi
  # Destructive flags in an alias retain the same manual-review boundary as a visible destructive Git command.
  if is_git_destructive_target "$alias_expansion"; then
    __goat_git_aliased_destructive=1
  fi
}

# Record the guarded classes of one `-c alias.<name>=<expansion>` operand; other config keys are ignored.
record_git_alias_config() {
  local config_operand="$1"
  # Alias definitions contribute executable expansion text; unrelated config settings cannot add an alias action.
  if [[ "$config_operand" =~ ^alias\.([a-zA-Z0-9_-]+)=(.*)$ ]]; then
    local alias_name="${BASH_REMATCH[1]}"
    local alias_expansion="${BASH_REMATCH[2]}"
    record_git_alias_expansion "$alias_expansion"
    __goat_git_alias_expansions["${alias_name,,}"]="$(normalize_git_alias_expansion "$alias_expansion")"
    __goat_git_raw_alias_expansions["${alias_name,,}"]="$alias_expansion"
  fi
}

# Git never expands an alias that shadows a builtin, so only an unrecognised first word needs a config lookup.
# The list mirrors `git --list-cmds=builtins` for Git 2.43; a newer builtin missing here only costs one lookup.
__goat_git_builtin_words=" add am annotate apply archive bisect blame branch bugreport bundle cat-file check-attr check-ignore check-mailmap check-ref-format checkout checkout--worker checkout-index cherry cherry-pick clean clone column commit commit-graph commit-tree config count-objects credential credential-cache credential-cache--daemon credential-store describe diagnose diff diff-files diff-index diff-tree difftool fast-export fast-import fetch fetch-pack fmt-merge-msg for-each-ref for-each-repo format-patch fsck fsck-objects fsmonitor--daemon gc get-tar-commit-id grep hash-object help hook index-pack init init-db interpret-trailers log ls-files ls-remote ls-tree mailinfo mailsplit maintenance merge merge-base merge-file merge-index merge-ours merge-recursive merge-recursive-ours merge-recursive-theirs merge-subtree merge-tree mktag mktree multi-pack-index mv name-rev notes pack-objects pack-redundant pack-refs patch-id pickaxe prune prune-packed pull push range-diff read-tree rebase receive-pack reflog remote remote-ext remote-fd repack replace rerere reset restore rev-list rev-parse revert rm send-pack shortlog show show-branch show-index show-ref sparse-checkout stage stash status stripspace submodule--helper switch symbolic-ref tag unpack-file unpack-objects update-index update-ref update-server-info upload-archive upload-archive--writer upload-pack var verify-commit verify-pack verify-tag version whatchanged worktree write-tree "

# Recognize Git's built-in commands so their names cannot be mistaken for user-defined aliases during policy inspection.
is_git_builtin_word() {
  [[ "$__goat_git_builtin_words" == *" $1 "* ]]
}

# Resolve a saved alias in the repository and config selected by the proposed Git command.
# A missing Git, an unreadable config or an absent alias leaves the visible word unclassified.
record_git_persistent_alias() {
  local rest="$1"
  shift
  local word="${rest%%[[:space:]]*}"
  [[ "$word" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]] || return 0
  is_git_builtin_word "$word" && return 0
  local expansion=""
  if ! expansion="$(GIT_TERMINAL_PROMPT=0 git "$@" config --get "alias.$word" 2>/dev/null </dev/null)"; then
    # Inline environment assignments are not executed by this inspector. An unresolved
    # environment-backed alias cannot count as evidence that the command is read-only.
    local option
    for option in "$@"; do
      case "$option" in --config-env|--config-env=*) __goat_git_aliased_commit=1 ;; esac
    done
    return 0
  fi
  # No saved expansion means there is no alias action to add to the user's policy check.
  [[ -n "$expansion" ]] || return 0
  record_git_alias_expansion "$expansion"
  __goat_git_alias_expansions["${word,,}"]="$(normalize_git_alias_expansion "$expansion")"
  __goat_git_raw_alias_expansions["${word,,}"]="$expansion"
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
  __goat_git_pathspec_unknown_directory=0
  __goat_git_strip_globals "$1" || return 1
  is_git_destructive_target "$__goat_git_rest" && return 0
  # Git appends the visible arguments to an alias, so an alias to `stash` invoked as `st clear` still clears stashes.
  if resolve_git_invoked_alias_command && is_git_destructive_target "$__goat_git_invoked_alias_command"; then
    return 0
  fi
  # A configured Git alias can carry the guarded flag even when the visible word looks harmless.
  [[ "$__goat_git_aliased_destructive" -eq 1 ]]
}

# Resolve the command Git runs when the visible first word is a recorded alias: its expansion plus the visible arguments.
# Sets __goat_git_invoked_alias_command and succeeds only for a recorded alias; it avoids a subshell on every Git command.
resolve_git_invoked_alias_command() {
  __goat_git_invoked_alias_command=""
  local invoked_word="${__goat_git_rest%%[[:space:]]*}"
  # Only a valid alias name can select a recorded expansion.
  [[ "$invoked_word" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]] || return 1
  local alias_expansion="${__goat_git_alias_expansions["${invoked_word,,}"]-}"
  [[ -n "$alias_expansion" ]] || return 1
  __goat_git_invoked_alias_command="$alias_expansion"
  # Visible arguments follow the expansion exactly as Git appends them.
  if [[ "$__goat_git_rest" == *[[:space:]]* ]]; then
    __goat_git_invoked_alias_command+=" ${__goat_git_rest#*[[:space:]]}"
  fi
  return 0
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
  is_git_commit_target "$__goat_git_rest" direct && return 0
  # Git appends visible arguments to an alias; a safe checkout or fetch alias can become a ref rewrite.
  if resolve_git_invoked_alias_command && is_git_commit_target "$__goat_git_invoked_alias_command"; then
    return 0
  fi
  # A configured Git alias can commit even when the visible subcommand is different.
  [[ "$__goat_git_aliased_commit" -eq 1 ]]
}

# Decide whether `gh api` uses a write method or an implicit body-bearing POST.
# Use so users can still fetch API evidence without silently mutating GitHub.
is_gh_api_write() {
  local -n __goat_gh_words_ref__="$1"
  local start_index="$2"
  local raw_stage="$3"
  local graphql_status
  # GraphQL operation proof precedes method shortcuts. A missing parser or uncertain
  # payload is a denial; only a positively identified REST request reaches the legacy rules.
  if node "$GOAT_HOOK_LIB_DIR/../gh-graphql-read.cjs" "$raw_stage" "${__goat_gh_words_ref__[@]:start_index}"; then
    return 1
  else
    graphql_status=$?
  fi
  [[ "$graphql_status" -eq 3 ]] || return 0
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
      --repo|--hostname|--cwd|--config-dir|--jq|--template|--cache|--codespace|-R|-H|-q|-c)
        i=$((i + 2))
        continue
        ;;
      --repo=*|--hostname=*|--cwd=*|--config-dir=*|--jq=*|--template=*|--cache=*|--codespace=*|-R?*|-H?*|-q?*|-c?*)
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

# Prove skill publishing is validation only before allowing the agent to run it.
# Inspect flags across command levels, keeping tag values and directory operands out of the dry-run decision.
gh_skill_publish_is_dry_run() {
  local -n publish_words="$1"
  local topic_index="$2" command_index="$3"
  local publish_index publish_word dry_run=0 fix_files=0
  # Repeated Boolean flags use the last value, just as GitHub CLI does when a user changes a command's mode.
  for ((publish_index = 1; publish_index < ${#publish_words[@]}; publish_index++)); do
    # The command names are already identified; only their options and operands select preview versus publishing.
    [[ "$publish_index" -eq "$topic_index" || "$publish_index" -eq "$command_index" ]] && continue
    publish_word="${publish_words[$publish_index]}"
    case "$publish_word" in
      --) break ;;
      --dry-run|--dry-run=1|--dry-run=t|--dry-run=T|--dry-run=true|--dry-run=TRUE|--dry-run=True) dry_run=1 ;;
      --dry-run=0|--dry-run=f|--dry-run=F|--dry-run=false|--dry-run=FALSE|--dry-run=False) dry_run=0 ;;
      --fix|--fix=1|--fix=t|--fix=T|--fix=true|--fix=TRUE|--fix=True) fix_files=1 ;;
      --fix=0|--fix=f|--fix=F|--fix=false|--fix=FALSE|--fix=False) fix_files=0 ;;
      --tag|--repo|--hostname|--cwd|--config-dir|-R|-H)
        publish_index=$((publish_index + 1)) ;;
      --tag=*|--repo=*|--hostname=*|--cwd=*|--config-dir=*|-R?*|-H?*|--no-pager) ;;
      -*) return 1 ;;
    esac
  done
  # --fix rewrites the user's local skill files, so disabling publication alone does not qualify as a read.
  [[ "$dry_run" -eq 1 && "$fix_files" -eq 0 ]]
}

# Decide whether a GitHub CLI command mutates shared project state or protected local GitHub settings and skill files.
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

  # Output filenames and descriptors are shell syntax, not gh API arguments.
  github_candidate=$(strip_shell_redirections "$github_candidate") || return 0
  split_shell_words_into words "$github_candidate"

  local i
  i=$(gh_skip_options_index words 1)

  local topic="${words[$i]:-}"
  # Missing command topics and option-only invocations do not mutate GitHub.
  [[ -z "$topic" || "$topic" == -* ]] && return 1
  topic="${topic,,}"
  # GitHub's built-in `cs` shorthand must protect the same codespace actions as the full command name.
  [[ "$topic" == "cs" ]] && topic="codespace"

  # API writes use method and field semantics instead of named subcommands.
  if [[ "$topic" == "api" ]]; then
    is_gh_api_write words $((i + 1)) "$github_candidate"
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
    pr:create|pr:review|pr:merge|pr:close|pr:reopen|pr:edit|pr:ready|pr:update-branch|pr:lock|pr:unlock|pr:revert)
      return 0 ;;
    release:create|release:upload|release:delete|release:edit|release:delete-asset)
      return 0 ;;
    discussion:create|discussion:edit|discussion:comment|agent-task:create|agent:create|agents:create)
      return 0 ;;
    repo:create|repo:delete|repo:edit|repo:fork|repo:rename|repo:archive|repo:unarchive|repo:sync|repo:set-default)
      return 0 ;;
    label:create|label:delete|label:edit|label:clone)
      return 0 ;;
    workflow:run|workflow:disable|workflow:enable)
      return 0 ;;
    run:rerun|run:cancel|run:delete)
      return 0 ;;
    gist:create|gist:edit|gist:delete|gist:rename)
      return 0 ;;
    secret:set|secret:remove|secret:delete)
      return 0 ;;
    variable:set|variable:delete)
      return 0 ;;
    ssh-key:add|ssh-key:delete|gpg-key:add|gpg-key:delete)
      return 0 ;;
    auth:login|auth:logout|auth:refresh|auth:setup-git)
      return 0 ;;
    codespace:create|codespace:delete|codespace:edit|codespace:stop|codespace:rebuild)
      return 0 ;;
    skill:publish)
      gh_skill_publish_is_dry_run words "$i" "$subcommand_index" && return 1
      return 0 ;;
    extension:install|extension:remove|extension:upgrade)
      return 0 ;;
    project:create|project:delete|project:edit|project:close|project:copy|project:link|project:unlink|project:mark-template|project:field-create|project:field-delete|project:field-update|project:item-add|project:item-archive|project:item-create|project:item-delete|project:item-edit)
      return 0 ;;
    cache:delete)
      return 0 ;;
  esac

  case "$topic:$subcommand:$nested_subcommand" in
    repo:deploy-key:add|repo:deploy-key:delete|codespace:ports:visibility)
      return 0 ;;
  esac

  return 1
}

# Apply native Git policy to each executable pipeline stage.
check_git_segment() {
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
      # A visible push names publication; an alias can hide a push or a shell command, so its reason says both.
      if is_git_publication_target "$__goat_git_rest"; then
        block "Git publication is not allowed. Ask the user to push manually." || return $?
      else
        block "This Git alias can publish or run shell commands, so it is not allowed. Ask the user to run it manually." ||
          return $?
      fi
    fi

    # An unlisted global option might take the next word as its value, so the hook cannot tell which command runs.
    if [[ -n "${__goat_git_unknown_global_option-}" ]]; then
      block "Unrecognised Git global option ${__goat_git_unknown_global_option}: the hook cannot tell which Git command runs. Drop the option or ask the user to run the command manually." ||
        return $?
    fi

    # History creation is always left to the developer, even when an agent was asked to prepare it.
    if is_git_commit "$repository_write_candidate"; then
      block "$(git_history_block_reason)" || return $?
    fi

    # Destructive history or cleanup flags require a manual developer decision and recovery plan.
    if is_git_destructive "$repository_write_candidate"; then
      if [[ "${__goat_git_pathspec_unknown_directory:-0}" -eq 1 ]]; then
        block "Cannot inspect Git pathspec after a dynamic directory change. Use a literal directory or ask the user to run this command manually." || return $?
      fi
      block \
        "Destructive git operation (--no-verify, reset --hard, clean -f, forced rm or checkout-index, read-tree reset, worktree remove, bulk restore or checkout, forced checkout or switch, stash drop or clear, reflog expire or delete) can skip checks or discard work. Drop --no-verify if it is not needed; otherwise ask the user to run it manually." ||
        return $?
    fi
  done

}

# Name the blocked history operation so the agent asks the developer for the right action.
# Commit keeps its established wording; an alias whose expansion could not be read gets a neutral reason.
git_history_block_reason() {
  local verb="${__goat_git_rest%%[[:space:]]*}"
  # When the visible command is not the history write, name the invoked alias's verb or give a neutral reason.
  if ! is_git_commit_target "$__goat_git_rest"; then
    verb=""
    if resolve_git_invoked_alias_command && is_git_commit_target "$__goat_git_invoked_alias_command" strict; then
      verb="${__goat_git_invoked_alias_command%%[[:space:]]*}"
    fi
  fi
  case "$verb" in
    commit)
      printf '%s' "git commit is not allowed. Ask the user to commit manually."
      ;;
    "")
      printf '%s' "A Git alias in this command can write Git history, so it is not allowed. Ask the user to run it manually."
      ;;
    *)
      printf 'git %s is not allowed: it writes Git history. Ask the user to run it manually.' "$verb"
      ;;
  esac
}

# Apply GitHub CLI policy beside native Git checks under the same repository-write switch.
check_repository_segment() {
  local developer_command="$CMD_TRIMMED"
  is_unredirected_unpiped_read_only "$developer_command" && return 0
  local -a repository_pipeline_stages=()
  local repository_pipeline_stage=""
  split_top_level_pipeline_stages_into repository_pipeline_stages "$developer_command"
  # Remote project stages are checked separately so read-only Git evidence does not mask a GitHub mutation.
  for repository_pipeline_stage in "${repository_pipeline_stages[@]}"; do
    # The runtime blocks this write; conversational approval does not release the hook.
    if is_gh_write_operation "$repository_pipeline_stage"; then
      block \
        "GitHub write via gh is blocked by Deny Git and GitHub writes. Draft the change for the user to perform; conversational approval does not bypass this hook." ||
        return $?
    fi
  done

}
