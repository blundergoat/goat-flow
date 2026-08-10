# patterns-shell.sh
#
# Protects the user's files and machine from destructive shell commands.
# Use through deny-dangerous.sh before an agent-proposed command can execute.
# Safe inspection, local data handling, and scoped build cleanup remain available.
# This module is sourced by the dispatcher and is not executable on its own.
# shellcheck shell=bash disable=SC2034,SC2154,SC2317,SC2319

# Is this an rm command that deletes recursively (-r/-R/--recursive)?
# First gate of the delete guard: only recursive removals get the strict
# path checks below - a plain `rm file.txt` is left alone.
rm_has_recursive() {
  local c="$1"
  # Match by basename so /bin/rm, /usr/bin/rm, etc. are all caught after
  # normalize_command_candidate has stripped any wrappers.
  local base
  base=$(first_word_base "$c")
  # Not rm at all -> nothing for this rule to judge.
  [[ "$base" == "rm" ]] || return 1

  # True when the long flag or any bundled short flags (-rf, -fR, ...) ask for recursion.
  [[ "$c" =~ (^|[[:space:]])--recursive([[:space:]]|$) ]] || [[ "$c" =~ (^|[[:space:]])-[^-[:space:]]*[rR][^[:space:]]*([[:space:]]|$) ]]
}

# Decide whether every recursive deletion target is explicit and project-scoped.
# Use for user-requested cleanup: `vendor` is allowed, while `cache/$TARGET` blocks.
# Absolute, home-relative, traversing, or unresolved targets remain manual decisions.
rm_is_safely_scoped() {
  local c="$1"
  local targets_str
  targets_str=$(drop_first_shell_word "$c")
  targets_str="${targets_str#"${targets_str%%[![:space:]]*}"}"
  targets_str="${targets_str%"${targets_str##*[![:space:]]}"}"
  # No targets at all (bare `rm -rf`) -> unsafe; never guess what was meant.
  [[ -z "$targets_str" ]] && return 1
  # Check each target independently - one unsafe path fails the whole command.
  local target
  for target in $targets_str; do
    # Strip quotes before every scope check: a leading quote otherwise defeats
    # the absolute/home/drive checks below AND the safe-target allowlist, so
    # `rm -rf "/etc"` slipped through while `rm -rf "node_modules"` was blocked.
    target=$(strip_shell_quotes_for_path_scan "$target")
    # `--` only ends option parsing; it is not a path.
    [[ "$target" == "--" ]] && continue
    # Options like -rf are not paths either.
    [[ "$target" == -* ]] && continue
    # Normalize ./foo/ -> foo so the allowlist below sees one spelling.
    target="${target#./}"
    target="${target%/}"
    # Target reduced to nothing (e.g. `rm -rf ./`) -> unsafe.
    [[ -z "$target" ]] && return 1
    # Any unresolved expansion can move a reviewed cleanup outside the project.
    # For example, `cache/$TARGET` may become `cache/../../home` at execution time.
    [[ "$target" == *'$'* || "$target" == *'`'* ]] && return 1
    # Dot traversal makes the path shown in review differ from what rm deletes.
    case "/$target/" in
      */../*|*/./*) return 1 ;;
    esac
    # Scratch dirs under /tmp/build-* are the one absolute location we allow.
    [[ "$target" =~ ^/tmp/build-[a-zA-Z0-9._-]+(/[a-zA-Z0-9._-]+)*$ ]] && continue
    # Absolute paths could reach anywhere on the machine -> block.
    [[ "$target" == /* ]] && return 1
    # Home-relative paths (~/...) reach the user's personal files -> block.
    [[ "$target" == "~"* ]] && return 1
    # Windows drive-rooted paths (e.g. C:/Users/x or C:\Users\x) are absolute
    # in Windows semantics; reject them the same way as POSIX-absolute paths.
    [[ "$target" =~ ^[A-Za-z]:[/\\] ]] && return 1
    # Well-known disposable build/cache dirs are always fine to remove.
    case "$target" in
      node_modules|vendor|target|dist|out|build|coverage|__pycache__|.cache|.next|.nuxt|.turbo) continue ;;
    esac
    # A slash means the path stays scoped inside the project (src/old-module) -> fine.
    [[ "$target" == */* ]] && continue
    # Anything else is a bare top-level name we don't recognise -> unsafe.
    return 1
  done
  return 0
}

# Inspect destructive actions embedded in find so users get the same policy as a direct command.
# Use when find's `-exec` or `-execdir` would otherwise hide the downstream action.
find_has_destructive_action() {
  local c
  local depth="${2:-0}"
  c=$(normalize_command_candidate "$1")
  c="${c#"${c%%[![:space:]]*}"}"
  [[ "$(first_word_base "$c")" == "find" ]] || return 1

  local -a words=()
  split_shell_words_into words "$c"
  local i=1
  local word=""
  local exec_cmd=""
  # Walk find arguments until every executable action has been inspected.
  while [[ "$i" -lt "${#words[@]}" ]]; do
    word="${words[$i]}"
    # Direct find deletion is already an existing destructive policy category.
    if [[ "$word" == "-delete" ]]; then
      return 0
    fi
    # An exec action may hide a command that would be blocked when run directly.
    if [[ "$word" == "-exec" || "$word" == "-execdir" ]]; then
      i=$((i + 1))
      exec_cmd=""
      # Collect one executable action up to find's semicolon or plus terminator.
      while [[ "$i" -lt "${#words[@]}" ]]; do
        word="${words[$i]}"
        [[ "$word" == ";" || "$word" == "+" ]] && break
        exec_cmd+="$word "
        i=$((i + 1))
      done
      exec_cmd="${exec_cmd% }"
      # A non-empty exec payload receives every policy module before find can run it.
      if [[ -n "$exec_cmd" ]]; then
        check_command_segments "$exec_cmd" $((depth + 1)) || return $?
      fi
      # Recursive deletion remains a destructive find action even with a scoped target.
      if rm_has_recursive "$exec_cmd"; then
        return 0
      fi
      continue
    fi
    i=$((i + 1))
  done
  return 1
}

# Decide whether a bare command word names a POSIX-family shell binary.
# Shared so pipeline classification and the script-file exemption cover the same shells; a shell
# recognized by only one of them would either bypass the guard or lose a legitimate exemption.
is_shell_name() {
  case "$1" in
    bash|sh|dash|zsh|ksh|ksh93|mksh|ash|yash) return 0 ;;
    *) return 1 ;;
  esac
}

# Decide whether a command word starts a shell that would execute piped bytes as its program.
# Every POSIX-family shell reads stdin the same way, so classifying only bash and sh would let
# `printf payload | dash` run the payload while `printf payload | bash` stayed blocked.
is_shell_command() {
  local c
  c=$(normalize_command_candidate "$1")
  c="${c#"${c%%[![:space:]]*}"}"
  local word="${c%%[[:space:]]*}"
  local base="${word##*/}"

  # BusyBox is a multi-call binary, so only its shell applets read stdin as a program.
  if [[ "$base" == "busybox" ]]; then
    local busybox_rest="${c#"$word"}"
    busybox_rest="${busybox_rest#"${busybox_rest%%[![:space:]]*}"}"
    local busybox_applet="${busybox_rest%%[[:space:]]*}"
    [[ "$busybox_applet" == "sh" || "$busybox_applet" == "ash" ]]
    return $?
  fi

  is_shell_name "$base"
}

# Decide whether Bash or sh reads its program from an explicit local script file.
# Use to let a user pipe local data into a checked-in script while bare shell stdin stays blocked.
is_script_file_shell_command() {
  local developer_command="$1"
  local -a shell_words=()
  split_shell_words_into shell_words "$developer_command"

  # A shell plus one script operand is the smallest safe file-backed shape.
  [[ "${#shell_words[@]}" -gt 1 ]] || return 1
  local shell_name="${shell_words[0]##*/}"
  # The exemption must cover exactly the shells the pipeline check classifies; a shell blocked
  # there but unrecognized here would lose its legitimate explicit-script-file exemption.
  is_shell_name "$shell_name" || return 1

  local shell_word_index=1
  local shell_word=""
  # Skip non-executing shell options until the first script-file operand.
  while [[ "$shell_word_index" -lt "${#shell_words[@]}" ]]; do
    shell_word="${shell_words[$shell_word_index]}"
    # A short option bundle containing `c` runs inline code, not a script file.
    if [[ "$shell_word" =~ ^-[^-]*c ]]; then
      return 1
    fi
    case "$shell_word" in
      --)
        shell_word_index=$((shell_word_index + 1))
        break
        ;;
      -s|-s?*)
        return 1
        ;;
      --init-file|--rcfile)
        # A startup file is read before the script operand, so `--rcfile /dev/stdin -i script.sh`
        # would execute the piped bytes as the interactive rcfile while the operand looked safe.
        # A checked-in startup file stays allowed; only stdin-backed sources are rejected.
        shell_word_index=$((shell_word_index + 1))
        script_file_word_is_safe "${shell_words[$shell_word_index]:-}" || return 1
        shell_word_index=$((shell_word_index + 1))
        continue
        ;;
      --init-file=*|--rcfile=*)
        script_file_word_is_safe "${shell_word#*=}" || return 1
        shell_word_index=$((shell_word_index + 1))
        continue
        ;;
      -O|-o)
        shell_word_index=$((shell_word_index + 2))
        continue
        ;;
      -O?*|-o?*|--noprofile|--norc|--posix|--restricted|--verbose|--version)
        shell_word_index=$((shell_word_index + 1))
        continue
        ;;
      -*)
        shell_word_index=$((shell_word_index + 1))
        continue
        ;;
    esac
    break
  done

  # Missing script means the shell would execute the piped bytes as its program.
  [[ "$shell_word_index" -lt "${#shell_words[@]}" ]] || return 1
  script_file_word_is_safe "${shell_words[$shell_word_index]}"
}

is_interpreter_command() {
  local c
  c=$(normalize_command_candidate "$1")
  c="${c#"${c%%[![:space:]]*}"}"
  local word="${c%%[[:space:]]*}"
  local base="${word##*/}"

  case "$base" in
    python|python3|node|perl|ruby) return 0 ;;
    *) return 1 ;;
  esac
}

# Decide whether a pipeline stage is a known read-only local data producer.
# Use to allow fixed scripts to consume local text; unknown or network tools stay blocked.
# For example, `tail app.log | python -c ...` is local, while `ssh host cat file` is not.
is_local_data_pipe_source() {
  local c
  c=$(normalize_command_candidate "$1")
  c="${c#"${c%%[![:space:]]*}"}"
  case "$(first_word_base "$c")" in
    cat|tac|head|tail|grep|egrep|fgrep|rg|sort|uniq|cut|tr|wc|nl|jq|yq|column|paste|comm|join|printf|echo) return 0 ;;
    *) return 1 ;;
  esac
}

is_downloader_pipe_source() {
  local c
  c=$(normalize_command_candidate "$1")
  c="${c#"${c%%[![:space:]]*}"}"
  case "$(first_word_base "$c")" in
    curl|wget|fetch|http) return 0 ;;
    *) return 1 ;;
  esac
}

# Decide whether a stage only presents or transforms downloaded data for the user.
# Unknown consumers fail closed because they may execute bytes received from the network.
is_inert_download_pipe_consumer() {
  is_local_data_pipe_source "$1"
}

is_inline_interpreter_command() {
  local c="$1"
  local -a words=()
  local base i word
  c=$(normalize_command_candidate "$c")
  c="${c#"${c%%[![:space:]]*}"}"
  split_shell_words_into words "$c"
  [[ "${#words[@]}" -gt 0 ]] || return 1

  base="${words[0]##*/}"
  for ((i = 1; i < ${#words[@]}; i++)); do
    word="${words[$i]}"
    case "$base:$word" in
      python:-c|python3:-c|node:-e|node:--eval|perl:-e|ruby:-e)
        return 0
        ;;
    esac
  done
  return 1
}

script_file_word_is_safe() {
  local word="$1"
  word=$(strip_shell_quotes_for_path_scan "$word")
  # "-" and process/device paths make stdin (or another fd) the program.
  [[ "$word" == "-" ]] && return 1
  case "$word" in
    /dev/*|/proc/*) return 1 ;;
  esac
  # Unresolved expansions can point anywhere, including /dev/stdin.
  [[ "$word" == '$'* || "$word" == '`'* ]] && return 1
  # Require a slash or a script extension so bare words never pass.
  [[ "$word" == */* ]] && return 0
  case "$word" in
    *.py|*.js|*.mjs|*.cjs|*.rb|*.pl|*.ts) return 0 ;;
  esac
  return 1
}

interpreter_option_action() {
  local base="$1"
  local word="$2"
  INTERPRETER_OPTION_ACTION="reject"
  case "$word" in
    --)
      INTERPRETER_OPTION_ACTION="stop"
      return 0
      ;;
  esac
  [[ "$word" == -?* ]] || {
    INTERPRETER_OPTION_ACTION="positional"
    return 0
  }

  case "$base" in
    python|python3)
      case "$word" in
        -c|-c?*|-m|-m?*)
          INTERPRETER_OPTION_ACTION="reject"
          ;;
        -W|-X|--check-hash-based-pycs)
          INTERPRETER_OPTION_ACTION="skip_next"
          ;;
        -W?*|-X?*|--check-hash-based-pycs=*|--*=*)
          INTERPRETER_OPTION_ACTION="skip"
          ;;
        --help|--version|-h|-V)
          INTERPRETER_OPTION_ACTION="skip"
          ;;
        *)
          if [[ "$word" =~ ^-[bBdEhiIOqRsSuvVxO]+$ ]]; then
            INTERPRETER_OPTION_ACTION="skip"
          fi
          ;;
      esac
      ;;
    node)
      case "$word" in
        -e|-e?*|-p|-p?*|--eval|--eval=*|--print|--print=*)
          INTERPRETER_OPTION_ACTION="reject"
          ;;
        -r|--require|--import|--loader|--experimental-loader|--input-type|--conditions|-C|--env-file|--env-file-if-exists|--inspect-port|--icu-data-dir|--openssl-config|--redirect-warnings|--diagnostic-dir|--cpu-prof-dir|--heap-prof-dir|--snapshot-blob|--test-reporter|--test-name-pattern)
          INTERPRETER_OPTION_ACTION="skip_next"
          ;;
        -r?*|-C?*|--require=*|--import=*|--loader=*|--experimental-loader=*|--input-type=*|--conditions=*|--env-file=*|--env-file-if-exists=*|--inspect-port=*|--icu-data-dir=*|--openssl-config=*|--redirect-warnings=*|--diagnostic-dir=*|--cpu-prof-dir=*|--heap-prof-dir=*|--snapshot-blob=*|--test-reporter=*|--test-name-pattern=*|--*=*)
          INTERPRETER_OPTION_ACTION="skip"
          ;;
        --help|--version|-h|-v|--check|--watch|--test|--inspect|--inspect-brk|--trace-*|--throw-deprecation|--enable-source-maps|--preserve-symlinks|--preserve-symlinks-main|--experimental-*|--no-*|--prof|--zero-fill-buffers)
          INTERPRETER_OPTION_ACTION="skip"
          ;;
      esac
      ;;
    perl)
      case "$word" in
        -e|-e?*|-E|-E?*)
          INTERPRETER_OPTION_ACTION="reject"
          ;;
        -I|-M|-m)
          INTERPRETER_OPTION_ACTION="skip_next"
          ;;
        -I?*|-M?*|-m?*|--*=*)
          INTERPRETER_OPTION_ACTION="skip"
          ;;
        -c|-w|-d|-T|-U|-W|-X|-v|--help|--version)
          INTERPRETER_OPTION_ACTION="skip"
          ;;
      esac
      ;;
    ruby)
      case "$word" in
        -e|-e?*)
          INTERPRETER_OPTION_ACTION="reject"
          ;;
        -I|-r|-E|-K|--encoding|--external-encoding|--internal-encoding)
          INTERPRETER_OPTION_ACTION="skip_next"
          ;;
        -I?*|-r?*|-E?*|-K?*|--encoding=*|--external-encoding=*|--internal-encoding=*|--*=*)
          INTERPRETER_OPTION_ACTION="skip"
          ;;
        -c|-w|-d|-v|--help|--version)
          INTERPRETER_OPTION_ACTION="skip"
          ;;
      esac
      ;;
  esac
}

# Does this interpreter invocation run a script FILE (python x.py,
# node tools/build.mjs), leaving piped stdin as plain data? Fail-closed: the
# first positional word after known option parsing must be path-shaped (contain
# a slash or a script extension), which rejects stdin-as-program spellings
# ("-", /dev/stdin, /dev/fd/*, /proc/*), unresolved $/backtick expansions,
# module execution (`python -m code` runs stdin as a REPL program), and
# path-looking flag values (`node --require ./setup.js`, `python3 -W ./x`).
is_script_file_interpreter_command() {
  local c="$1"
  local -a words=()
  local base i word options_done action
  c=$(normalize_command_candidate "$c")
  c="${c#"${c%%[![:space:]]*}"}"
  split_shell_words_into words "$c"
  [[ "${#words[@]}" -gt 1 ]] || return 1

  base="${words[0]##*/}"
  case "$base" in
    python|python3|node|perl|ruby) ;;
    *) return 1 ;;
  esac

  options_done=0
  for ((i = 1; i < ${#words[@]}; i++)); do
    word="${words[$i]}"
    if [[ "$options_done" -eq 0 ]]; then
      interpreter_option_action "$base" "$word"
      action="$INTERPRETER_OPTION_ACTION"
      case "$action" in
        stop)
          options_done=1
          continue
          ;;
        skip)
          continue
          ;;
        skip_next)
          i=$((i + 1))
          [[ "$i" -lt "${#words[@]}" ]] || return 1
          continue
          ;;
        reject)
          return 1
          ;;
        positional) ;;
      esac
    fi
    script_file_word_is_safe "$word"
    return $?
  done
  return 1
}

# Piped bytes stay DATA when the interpreter's program comes from somewhere
# else: an inline code flag (python -c, node -e) or a checked-in script file.
# Bare interpreters and stdin-path spellings execute the pipe as the program.
interpreter_treats_stdin_as_data() {
  is_inline_interpreter_command "$1" || is_script_file_interpreter_command "$1"
}

strip_sql_literals_inside_double_quotes() {
  local input="$1"
  local out=""
  local char=""
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

    if [[ "$char" == "\\" ]]; then
      out+="$char"
      escaped=1
      continue
    fi

    if [[ "$char" == '"' ]]; then
      out+="$char"
      if [[ "$in_double" -eq 1 ]]; then
        in_double=0
      else
        in_double=1
      fi
      continue
    fi

    if [[ "$in_double" -eq 1 && "$char" == "'" ]]; then
      out+="''"
      i=$((i + 1))
      while (( i < ${#input} )); do
        char="${input:i:1}"
        if [[ "$char" == "'" ]]; then
          break
        fi
        i=$((i + 1))
      done
      continue
    fi

    out+="$char"
  done

  printf '%s' "$out"
}

check_command_chain_policy() {
  local input="$1"
  local depth="${2:-0}"
  local download_re='(^|[[:space:]])(curl|wget|fetch|http)([[:space:]]|$)'
  local execute_re='(;|&&|\|\|)[[:space:]]*(ba)?sh[[:space:]]+[^[:space:]&|;]+'
  if [[ "$depth" -eq 0 && "$input" =~ $download_re && "$input" =~ $execute_re ]]; then
    block "Download-then-execute (curl/wget ... && bash file). Inspect the downloaded file before running it." || return $?
  fi
}

# Inspect every pipeline stage so downloaded code cannot reach an executable consumer.
# Local data may still feed visible inline code or an explicit checked-in script file.
check_pipeline_shell_consumers() {
  local pipe_scan="${CMD_UNQUOTED//||/__GOAT_OR__}"
  local -a pipeline_parts
  local pipe_index
  local previous_part
  local current_part
  local saw_downloader_pipe_source=0
  local all_upstream_pipe_sources_local=1
  IFS='|' read -ra pipeline_parts <<< "$pipe_scan"
  # Each downstream stage inherits whether any earlier stage downloaded its input.
  for ((pipe_index = 1; pipe_index < ${#pipeline_parts[@]}; pipe_index++)); do
    previous_part="${pipeline_parts[$((pipe_index - 1))]}"
    current_part="${pipeline_parts[$pipe_index]}"
    # Once a downloader appears, later filters cannot erase the remote origin.
    if is_downloader_pipe_source "$previous_part"; then
      saw_downloader_pipe_source=1
    fi
    # Only known local producers qualify for the local-data script exemption.
    if ! is_local_data_pipe_source "$previous_part"; then
      all_upstream_pipe_sources_local=0
    fi

    # A user may inspect downloads with inert tools; unknown consumers may execute them.
    if [[ "$saw_downloader_pipe_source" -eq 1 ]] && ! is_inert_download_pipe_consumer "$current_part"; then
      block "Downloaded content reaches an executable or unknown pipeline consumer. Save and inspect it before running it." || return $?
    fi

    # Local data stays data when Bash reads its program from an explicit script file.
    if is_shell_command "$current_part"; then
      if [[ "${depth:-0}" -eq 0 && "$saw_downloader_pipe_source" -eq 0 && "$all_upstream_pipe_sources_local" -eq 1 ]] && is_script_file_shell_command "$current_part"; then
        continue
      fi
      block "Pipe to shell. Download or inspect first, then run; to feed a local script, redirect from a file (cmd < file) instead of piping." || return $?
    fi

    # Known language runtimes may consume local data only when their program is explicit.
    if is_interpreter_command "$current_part"; then
      if [[ "${depth:-0}" -eq 0 && "$saw_downloader_pipe_source" -eq 0 && "$all_upstream_pipe_sources_local" -eq 1 ]] && interpreter_treats_stdin_as_data "$current_part"; then
        continue
      fi
      block "Pipe to interpreter. Download or inspect first, then run; to feed local data to inline interpreter code, redirect from a file (cmd < file) instead of piping." || return $?
    fi
  done
}

# Check the command xargs will invoke so input options cannot hide recursive deletion.
check_xargs_destructive_payload() {
  local candidate="$1"
  local normalized xargs_payload
  normalized="$(normalize_command_candidate "$candidate")"
  # Only a real recursive-delete payload belongs to this destructive rule.
  if xargs_payload="$(strip_xargs_payload_command "$normalized")" && rm_has_recursive "$xargs_payload"; then
    block "xargs feeding rm -r hides recursive deletion targets. Review the input list and run manually." || return $?
  fi
}

check_pipeline_xargs_destructive_payloads() {
  local pipe_scan="${CMD_UNQUOTED//||/__GOAT_OR__}"
  local -a pipeline_parts
  local pipe_index
  IFS='|' read -ra pipeline_parts <<< "$pipe_scan"
  for ((pipe_index = 0; pipe_index < ${#pipeline_parts[@]}; pipe_index++)); do
    check_xargs_destructive_payload "${pipeline_parts[$pipe_index]}" || return $?
  done
}

# Apply destructive-shell policy to one user-visible command segment.
# This is the final shell gate before secret and repository policy inspect the same segment.
check_destructive_segment() {
  local cmd="$1"
  cmd="$CMD_TRIMMED"

  if [[ "$HAS_PIPE" -eq 1 ]]; then
    check_pipeline_shell_consumers || return $?
  fi

  if is_unredirected_unpiped_read_only "$cmd"; then
    return 0
  fi

  if rm_has_recursive "$CMD_NORMALIZED"; then
    if [[ "$CMD_NORMALIZED" == *".."* ]]; then
      block "rm -r with path traversal (..). Resolve the full path first." || return $?
    fi
    if ! rm_is_safely_scoped "$CMD_NORMALIZED"; then
      block "rm -r without safe scoping. Specify an explicit target path." || return $?
    fi
  fi

  check_pipeline_xargs_destructive_payloads || return $?

  if find_has_destructive_action "$CMD_NORMALIZED" "$depth"; then
    block "find deletion action (-delete / -exec rm -r) can remove many files. Review matches and run manually." || return $?
  fi

  if [[ "$CMD_NORMALIZED" =~ (^|[[:space:]])chmod([[:space:]]|$) ]] &&      [[ "$CMD_NORMALIZED" =~ chmod[[:space:]]+([^;&|]*[[:space:]])?0?777([[:space:]]|$) ]]; then
    block "chmod 777 sets world-writable permissions. Use a more restrictive mode." || return $?
  fi

  local mkfs_re='(^|[[:space:]])mkfs(\.[^[:space:]]*)?([[:space:]]|$)'
  if [[ "$CMD_NORMALIZED" =~ $mkfs_re ]]; then
    block "mkfs formats filesystems and can destroy data. Run manually with explicit confirmation." || return $?
  fi

  local dd_re='(^|[[:space:]])dd([[:space:]]|$)'
  local dd_device_re='(^|[[:space:]])of=/dev/([^[:space:]]+)'
  if [[ "$CMD_NORMALIZED" =~ $dd_re && "$CMD_NORMALIZED" =~ $dd_device_re ]]; then
    local dd_target="${BASH_REMATCH[2]}"
    case "$dd_target" in
      null|stdout|stderr|fd/*) ;;
      *)
        block "dd writing to a device path can overwrite disks. Write to an ordinary file or run manually." || return $?
        ;;
    esac
  fi

  local lockfile_write_re='(>|>>|tee|sed[[:space:]]+-i)[[:space:]]+.*(package-lock\.json|pnpm-lock\.yaml|composer\.lock|Cargo\.lock|yarn\.lock)'
  if [[ "$cmd" =~ $lockfile_write_re ]]; then
    block "Direct lockfile modification. Use the package manager (npm install, composer update, etc.)." || return $?
  fi

  if [[ "$CMD_UNQUOTED" =~ ^eval[[:space:]] ]] || [[ "$CMD_UNQUOTED" =~ [[:space:]]eval[[:space:]] ]]; then
    block "eval hides commands from safety checks. Write the command directly." || return $?
  fi

  local bare_redirect_re='^[[:space:]]*>[[:space:]]'
  if [[ "$cmd" =~ $bare_redirect_re ]]; then
    block "Redirect to empty file. This truncates the target. Use a safer approach." || return $?
  fi
  local null_redirect_re='^[[:space:]]*(:|true)[[:space:]]+>{1,2}\|?[[:space:]]*[^[:space:]<>]'
  if [[ "$CMD_NORMALIZED" =~ $null_redirect_re ]]; then
    block "Null-command (: / true) followed by redirect truncates the target. Use a safer approach." || return $?
  fi
  local cat_null_redirect_re='(^|[[:space:]])cat[[:space:]]+/dev/null[[:space:]]*>{1,2}\|?[[:space:]]*[^[:space:]<>]'
  if [[ "$CMD_NORMALIZED" =~ $cat_null_redirect_re ]]; then
    block "cat /dev/null redirected to a file truncates the target. Use a safer approach." || return $?
  fi
  local empty_printf_single_re="printf[[:space:]]+''[[:space:]]*>\\|?[[:space:]]+[^[:space:]]"
  local empty_printf_double_re='printf[[:space:]]+""[[:space:]]*>\|?[[:space:]]+[^[:space:]]'
  local empty_echo_single_re="echo[[:space:]]+(-n[[:space:]]+)?''[[:space:]]*>\\|?[[:space:]]+[^[:space:]]"
  local empty_echo_double_re='echo[[:space:]]+(-n[[:space:]]+)?""[[:space:]]*>\|?[[:space:]]+[^[:space:]]'
  if [[ "$cmd" =~ $empty_printf_single_re ]] || [[ "$cmd" =~ $empty_printf_double_re ]] || [[ "$cmd" =~ $empty_echo_single_re ]] || [[ "$cmd" =~ $empty_echo_double_re ]]; then
    block "Empty-output redirect truncates the target file. Use a safer approach." || return $?
  fi
  if [[ "$CMD_UNQUOTED" == *">|"* ]]; then
    block "Clobber redirect (>|) overrides noclobber and truncates the target. Use a safer approach." || return $?
  fi
  if [[ "$cmd" =~ truncate[[:space:]] ]]; then
    block "truncate can destroy file contents. Verify intent before proceeding." || return $?
  fi

  local cmd_db_scan="$CMD_LOWER"
  if [[ "$cmd_db_scan" == *'"'* && "$cmd_db_scan" == *"'"* ]]; then
    cmd_db_scan=$(strip_sql_literals_inside_double_quotes "$cmd_db_scan")
  fi
  local db_cli_re='(^|[[:space:]])(mysql|mariadb|psql|sqlite3|mongosh|cqlsh)([[:space:]]|$)'
  local db_eval_flag_re='(-e|-c|--command|--eval)'
  local db_destructive_re='(drop[[:space:]]+(database|table|schema|index|view)|truncate[[:space:]]+table|delete[[:space:]]+from|\.drop[[:space:]]*\(|\.deletemany[[:space:]]*\(|\.deleteone[[:space:]]*\(|\.remove[[:space:]]*\()'
  if [[ "$cmd_db_scan" =~ $db_cli_re ]] && [[ "$cmd_db_scan" =~ $db_eval_flag_re ]] && [[ "$cmd_db_scan" =~ $db_destructive_re ]]; then
    block "Destructive database command (DROP/TRUNCATE/DELETE). Run manually with verification." || return $?
  fi
  if [[ "$CMD_LOWER" =~ (^|[[:space:]])(psql|mysql|mariadb|sqlite3|mongosh)([[:space:]]+|$).*-f[[:space:]] ]]; then
    block "File-fed database command. Inspect the SQL file and run it manually." || return $?
  fi

  local cmd_normalized_lower="${CMD_NORMALIZED,,}"
  if [[ "$cmd_normalized_lower" =~ ^npm[[:space:]]+token[[:space:]]+(delete|revoke) ]]; then
    block "npm token delete/revoke is irreversible. Manage tokens manually via the npm website." || return $?
  fi

  local interpreter_eval_re='(^|[[:space:]])(python|python2|python3|node|nodejs|deno|perl|ruby|php)([[:space:]]+-[a-zA-Z]+)*[[:space:]]+-(c|e|-eval|-execute)'
  if [[ "$cmd" =~ $interpreter_eval_re ]]; then
    local shell_primitive_re='(os\.system|os\.popen|os\.exec|subprocess|child_process|system[[:space:]]*\(|backtick|exec[[:space:]]*\(|popen|shell_exec)'
    if [[ "$cmd" =~ $shell_primitive_re ]]; then
      block "Interpreter -c/-e with shell-execution primitive. Run the destructive operation directly so the hook can review it." || return $?
    fi
  fi

  local shell_here_string_re='(^|[[:space:]])(ba)?sh([[:space:]]+-[a-zA-Z]+)*[[:space:]]+<<<'
  local shell_here_doc_re="(^|[[:space:]])(ba)?sh([[:space:]]+-[a-zA-Z]+)*[[:space:]]+<<-?[[:space:]]*['\"]?[A-Za-z_]"
  if [[ "$cmd" =~ $shell_here_string_re ]] || [[ "$cmd" =~ $shell_here_doc_re ]]; then
    block "Shell stdin (<<< / here-doc) hides commands from inspection. Run the command directly." || return $?
  fi

  local powershell_eval_re='(^|[[:space:]])(powershell|pwsh)(\.exe)?([[:space:]]+--?[a-z0-9-]+(=[^[:space:]]+)?)*[[:space:]]+--?(c|command|encodedcommand)([[:space:]]|$)'
  if [[ "$CMD_LOWER" =~ $powershell_eval_re ]]; then
    if [[ "$CMD_LOWER" =~ (remove-item|clear-disk|format-volume|stop-computer|restart-computer|set-executionpolicy[[:space:]]+(unrestricted|bypass)) ]]; then
      block "PowerShell destructive verb. Run manually with explicit confirmation." || return $?
    fi
    if [[ "$CMD_LOWER" =~ --?encodedcommand[[:space:]]+ ]]; then
      block "PowerShell -EncodedCommand is opaque to inspection. Run the decoded command directly." || return $?
    fi
  fi
  local cmd_eval_re='(^|[[:space:]])cmd(\.exe)?[[:space:]]+/[ck][[:space:]]+'
  if [[ "$CMD_LOWER" =~ $cmd_eval_re ]]; then
    local cmd_destructive_re='(^|[[:space:]/"])(del|erase|rmdir|rd|format)([[:space:]]|$|\.exe)'
    if [[ "$CMD_LOWER" =~ $cmd_destructive_re ]]; then
      block "cmd.exe destructive verb (del/rmdir/rd/format). Run manually with explicit confirmation." || return $?
    fi
  fi

  local sudo_package_re='(^|[[:space:];&|])sudo[[:space:]]+(apt(-get)?|dnf|yum|pacman|brew)[[:space:]]+(install|remove|upgrade|update)'
  if [[ "$CMD_LOWER" =~ $sudo_package_re ]]; then
    block "Privileged package-manager mutation. Ask the user to run it manually." || return $?
  fi
  local infra_re='(^|[[:space:];&|])(docker[[:space:]]+push|terraform[[:space:]]+destroy|terraform[[:space:]]+apply[^;&|]*-auto-approve|aws[[:space:]]+s3[[:space:]]+rm|aws[[:space:]]+ec2[[:space:]]+terminate)'
  local infra_normalized_re='^(docker[[:space:]]+push|terraform[[:space:]]+destroy|terraform[[:space:]]+apply[^;&|]*-auto-approve|aws[[:space:]]+s3[[:space:]]+rm|aws[[:space:]]+ec2[[:space:]]+terminate)'
  if [[ "$CMD_LOWER" =~ $infra_re ]] || [[ "$CMD_NORMALIZED" =~ $infra_normalized_re ]]; then
    block "Cloud or infrastructure destructive command. Ask the user to run it manually." || return $?
  fi
}
