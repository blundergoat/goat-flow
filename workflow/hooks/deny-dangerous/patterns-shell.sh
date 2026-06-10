# patterns-shell.sh
#
# Destructive shell-command policy extracted from shell.sh.
# Sourced by deny-dangerous.sh; not executable on its own.
# shellcheck shell=bash disable=SC2034,SC2154,SC2317,SC2319

rm_has_recursive() {
  local c="$1"
  # Match by basename so /bin/rm, /usr/bin/rm, etc. are all caught after
  # normalize_command_candidate has stripped any wrappers.
  local base
  base=$(first_word_base "$c")
  [[ "$base" == "rm" ]] || return 1

  [[ "$c" =~ (^|[[:space:]])--recursive([[:space:]]|$) ]] || [[ "$c" =~ (^|[[:space:]])-[^-[:space:]]*[rR][^[:space:]]*([[:space:]]|$) ]]
}

rm_is_safely_scoped() {
  local c="$1"
  local targets_str
  targets_str=$(drop_first_shell_word "$c")
  targets_str="${targets_str#"${targets_str%%[![:space:]]*}"}"
  targets_str="${targets_str%"${targets_str##*[![:space:]]}"}"
  [[ -z "$targets_str" ]] && return 1
  # Check each target independently - one unsafe path fails the whole command.
  local target
  for target in $targets_str; do
    [[ "$target" == "--" ]] && continue
    [[ "$target" == -* ]] && continue
    target="${target#./}"
    target="${target%/}"
    [[ -z "$target" ]] && return 1
    [[ "$target" =~ ^/tmp/build-[a-zA-Z0-9._-] ]] && continue
    [[ "$target" == /* ]] && return 1
    [[ "$target" == "~"* ]] && return 1
    # Windows drive-rooted paths (e.g. C:/Users/x or C:\Users\x) are absolute
    # in Windows semantics; reject them the same way as POSIX-absolute paths.
    [[ "$target" =~ ^[A-Za-z]:[/\\] ]] && return 1
    case "$target" in
      node_modules|dist|out|build|coverage|__pycache__|.cache|.next|.nuxt|.turbo) continue ;;
    esac
    [[ "$target" == */* ]] && continue
    return 1
  done
  return 0
}

strip_xargs_payload_command() {
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
      # Flags that consume a following operand - skip the flag AND its value.
      # -a/--arg-file read the input list from a FILE; without them the filename
      # is misread as the command, letting `xargs -a list rm -rf` slip through.
      -a|--arg-file|-I|-i|-L|-l|-n|-P|-s|-E|-e|-d|--replace|--max-lines|--max-args|--max-procs|--max-chars|--eof|--delimiter)
        i=$((i + 2))
        continue
        ;;
      -a?*|--arg-file=*|-I?*|-i?*|-L?*|-l?*|-n?*|-P?*|-s?*|-E?*|-e?*|-d?*|--replace=*|--max-lines=*|--max-args=*|--max-procs=*|--max-chars=*|--eof=*|--delimiter=*)
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

find_has_destructive_action() {
  local c
  c=$(normalize_command_candidate "$1")
  c="${c#"${c%%[![:space:]]*}"}"
  [[ "$(first_word_base "$c")" == "find" ]] || return 1

  local -a words=()
  split_shell_words_into words "$c"
  local i=1
  local word=""
  local exec_cmd=""
  while [[ "$i" -lt "${#words[@]}" ]]; do
    word="${words[$i]}"
    if [[ "$word" == "-delete" ]]; then
      return 0
    fi
    if [[ "$word" == "-exec" || "$word" == "-execdir" ]]; then
      i=$((i + 1))
      exec_cmd=""
      while [[ "$i" -lt "${#words[@]}" ]]; do
        word="${words[$i]}"
        [[ "$word" == ";" || "$word" == "+" ]] && break
        exec_cmd+="$word "
        i=$((i + 1))
      done
      exec_cmd="${exec_cmd% }"
      if rm_has_recursive "$exec_cmd"; then
        return 0
      fi
      continue
    fi
    i=$((i + 1))
  done
  return 1
}

is_shell_command() {
  local c
  c=$(normalize_command_candidate "$1")
  c="${c#"${c%%[![:space:]]*}"}"
  local word="${c%%[[:space:]]*}"
  local base="${word##*/}"

  [[ "$base" == "bash" || "$base" == "sh" ]]
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

check_pipeline_shell_consumers() {
  local pipe_scan="${CMD_UNQUOTED//||/__GOAT_OR__}"
  local -a pipeline_parts
  local pipe_index
  IFS='|' read -ra pipeline_parts <<< "$pipe_scan"
  for ((pipe_index = 1; pipe_index < ${#pipeline_parts[@]}; pipe_index++)); do
    if is_shell_command "${pipeline_parts[$pipe_index]}"; then
      block "Pipe to shell. Download or inspect first, then run; to feed a local script, redirect from a file (cmd < file) instead of piping." || return $?
    fi
    if is_interpreter_command "${pipeline_parts[$pipe_index]}"; then
      block "Pipe to interpreter. Download or inspect first, then run." || return $?
    fi
  done
}

check_xargs_destructive_payload() {
  local candidate="$1"
  local normalized xargs_payload
  normalized="$(normalize_command_candidate "$candidate")"
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

check_destructive_segment() {
  local cmd="$1"
  local depth="${2:-0}"
  prepare_segment_context "$cmd" "$depth" || return $?
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

  if find_has_destructive_action "$CMD_NORMALIZED"; then
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

  local pipe_to_shell_re='(curl|wget)[^|]*\|[[:space:]]*(ba)?sh'
  if [[ "$cmd" =~ $pipe_to_shell_re ]]; then
    block "Pipe-to-shell (curl|bash). Download first, inspect, then run." || return $?
  fi
  local pipe_to_interpreter_re='(curl|wget)[^|]*\|[[:space:]]*(python|python3|node|perl|ruby)'
  if [[ "$cmd" =~ $pipe_to_interpreter_re ]]; then
    block "Pipe-to-interpreter. Download first, inspect, then run." || return $?
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
