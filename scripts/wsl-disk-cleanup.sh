#!/usr/bin/env bash

set -Eeuo pipefail
IFS=$'\n\t'

# Drop shell functions inherited through the environment. Agent harnesses can
# export wrappers that replace find or grep with tools that reject GNU options,
# which would break the staleness checks this cleanup depends on.
while IFS= read -r inherited_function; do
  unset -f "$inherited_function"
done < <(compgen -A function)

readonly DEFAULT_STALE_DAYS=14
readonly JOURNAL_RETENTION_DAYS=30
readonly REPORT_ROWS=15
readonly KEPT_REPORT_ROWS=5
readonly HOME_REPORT_ROWS=10
readonly UV_PRUNE_TIMEOUT_SECONDS=120

MODE="report"
MODE_SET=false
STALE_DAYS="$DEFAULT_STALE_DAYS"
AGGRESSIVE=false
ASSUME_YES=false
RUN_TRIM=true
VERBOSE=false
FAILURES=0
WARNINGS=0
SHOW_MENU=false
if (( $# == 0 )) && [[ -t 0 ]]; then
  SHOW_MENU=true
fi

usage() {
  cat <<'EOF'
Report on and clean disposable data inside a WSL distro.

Usage:
  bash scripts/wsl-disk-cleanup.sh [options]

Run without options in a terminal to choose from a menu. Without a terminal,
running without options produces a report.

Modes:
  --report-only      Show disk usage and cleanup candidates without changing anything.
  --dry-run          Preview the cleanup plan without changing anything.
  --apply            Run the cleanup after an exact confirmation prompt.

Options:
  --days DAYS        Treat an entry as stale when nothing below it was modified in
                     this many days (default: 14; range: 1-3650).
  --aggressive       Also clear the whole user cache, npm/npx caches, Go's
                     build/test/module caches, and all Trash items. Requires
                     --apply to make changes.
  --verbose          List every candidate path instead of grouping similar names.
  --yes              Skip the confirmation prompt. Valid only with --apply.
  --no-trim          Do not run fstrim on the WSL root filesystem after cleanup.
  -h, --help         Show this help text.

Safe cleanup removes stale direct children of /tmp and /var/tmp, stale
entries in the user cache and npm's log directory, and Trash items deleted
more than DAYS days ago. Claude Code keeps one scratch directory per session
under /tmp/claude-<uid>; each session is judged on its own, and a session
whose transcript changed within DAYS days is kept. A temporary entry is also
kept while a running process uses it as a working directory, root, or
executable, holds it open, maps it, listens on a socket inside it, or names it
in its arguments; every process is checked again with sudo just before
removal. Safe cleanup also prunes unreferenced pnpm store and uv cache
entries, clears downloaded apt packages, and vacuums journals older than 30
days.

This script never removes projects, Docker data, Cargo target directories,
Ollama models, Codex or IDE state, installed packages, or apt dependencies.
Freed space stays allocated to the Windows VHDX until it is compacted; run
scripts/wsl-compact.sh from Git Bash on Windows afterwards.

Examples:
  bash scripts/wsl-disk-cleanup.sh
  bash scripts/wsl-disk-cleanup.sh --dry-run --days 30
  bash scripts/wsl-disk-cleanup.sh --apply --days 30
  bash scripts/wsl-disk-cleanup.sh --dry-run --aggressive --verbose
EOF
}

info() {
  printf '[INFO] %s\n' "$*"
}

warn() {
  WARNINGS=$((WARNINGS + 1))
  printf '[WARN] %s\n' "$*" >&2
}

fail() {
  FAILURES=$((FAILURES + 1))
  printf '[ERR] %s\n' "$*" >&2
}

die() {
  printf '[ERR] %s\n' "$*" >&2
  exit 1
}

set_mode() {
  local requested_mode="$1"

  if [[ "$MODE_SET" == true && "$MODE" != "$requested_mode" ]]; then
    die "Choose only one of --report-only, --dry-run, or --apply."
  fi

  MODE="$requested_mode"
  MODE_SET=true
}

choose_mode_from_menu() {
  local choice

  while true; do
    printf '\nWSL disk cleanup (stale threshold: %s days)\n' "$STALE_DAYS"
    printf '  1) Report storage use and cleanup candidates\n'
    printf '  2) Preview safe cleanup\n'
    printf '  3) Apply safe cleanup\n'
    printf '  4) Preview aggressive cache cleanup\n'
    printf '  5) Apply aggressive cache cleanup\n'
    printf '  q) Quit\n'
    printf 'Choose an option: '
    IFS= read -r choice || die "Could not read a menu choice."

    case "$choice" in
      1) set_mode report; return ;;
      2) set_mode dry-run; return ;;
      3) set_mode apply; return ;;
      4) set_mode dry-run; AGGRESSIVE=true; return ;;
      5) set_mode apply; AGGRESSIVE=true; return ;;
      q|Q) info "Cancelled; no files were changed."; exit 0 ;;
      *) printf 'Choose 1-5 or q.\n' >&2 ;;
    esac
  done
}

while (( $# > 0 )); do
  case "$1" in
    --report-only)
      set_mode "report"
      shift
      ;;
    --dry-run)
      set_mode "dry-run"
      shift
      ;;
    --apply)
      set_mode "apply"
      shift
      ;;
    --days)
      (( $# >= 2 )) || die "--days requires a value."
      STALE_DAYS="$2"
      shift 2
      ;;
    --aggressive)
      AGGRESSIVE=true
      shift
      ;;
    --verbose)
      VERBOSE=true
      shift
      ;;
    --yes)
      ASSUME_YES=true
      shift
      ;;
    --no-trim)
      RUN_TRIM=false
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1"
      ;;
  esac
done

if [[ ! "$STALE_DAYS" =~ ^[0-9]+$ ]] || (( STALE_DAYS < 1 || STALE_DAYS > 3650 )); then
  die "--days must be an integer between 1 and 3650."
fi

if [[ "$ASSUME_YES" == true && "$MODE" != "apply" ]]; then
  die "--yes is valid only with --apply."
fi

is_wsl() {
  [[ -n "${WSL_DISTRO_NAME:-}" || -n "${WSL_INTEROP:-}" ]] && return 0
  [[ -r /proc/sys/kernel/osrelease ]] && grep -qi 'microsoft' /proc/sys/kernel/osrelease
}

is_wsl || die "This script must be run inside WSL."

for required_command in numfmt timeout; do
  command -v "$required_command" >/dev/null 2>&1 \
    || die "$required_command (GNU coreutils) is required."
done

if [[ -z "${HOME:-}" || "$HOME" != /* || "$HOME" == "/" ]]; then
  die "HOME must be a non-root absolute path."
fi

if [[ "$SHOW_MENU" == true ]]; then
  choose_mode_from_menu
fi

readonly USER_CACHE_ROOT="${XDG_CACHE_HOME:-$HOME/.cache}"
readonly NPM_ROOT="$HOME/.npm"
readonly TRASH_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/Trash"
readonly CLAUDE_TRANSCRIPT_ROOT="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects"
CANONICAL_HOME="$(readlink -f -- "$HOME")" || die "Could not resolve HOME."
readonly CANONICAL_HOME

if [[ "$CANONICAL_HOME" == "/" ]]; then
  die "HOME must not resolve to the filesystem root."
fi

if [[ "$USER_CACHE_ROOT" != /* || "$USER_CACHE_ROOT" == "/" || "$USER_CACHE_ROOT" == "$HOME" ]]; then
  die "The user cache path must be an absolute directory below HOME."
fi

canonical_path() {
  readlink -m -- "$1" 2>/dev/null || readlink -f -- "$1" 2>/dev/null
}

paths_overlap() {
  local left="${1%/}"
  local right="${2%/}"
  [[ "$left" == "$right" || "$left" == "$right/"* || "$right" == "$left/"* ]]
}

assert_cache_root_is_disposable() {
  local canonical_cache
  local canonical_default_cache
  local protected_path
  local canonical_protected
  local -a protected_roots=(
    "$HOME/projects"
    "$HOME/.cargo"
    "$HOME/.codex"
    "$HOME/.config"
    "$HOME/.docker"
    "$HOME/.gnupg"
    "$HOME/.kiro-server"
    "$HOME/.local"
    "$HOME/.npm"
    "$HOME/.ollama"
    "$HOME/.ssh"
    "$HOME/.vscode-server"
  )

  canonical_cache="$(canonical_path "$USER_CACHE_ROOT")" \
    || die "Could not resolve the user cache path."
  canonical_default_cache="$(canonical_path "$HOME/.cache")" \
    || die "Could not resolve the default user cache path."
  case "$canonical_cache" in
    "$CANONICAL_HOME"/*) ;;
    *) die "The user cache path resolves outside HOME; refusing cleanup." ;;
  esac

  for protected_path in "${protected_roots[@]}"; do
    canonical_protected="$(canonical_path "$protected_path")" || continue
    if paths_overlap "$canonical_cache" "$canonical_protected"; then
      die "The user cache path overlaps protected state ($protected_path); refusing cleanup."
    fi
  done

  case "$canonical_cache" in
    "$canonical_default_cache"|"$canonical_default_cache"/*) ;;
    *) die "The user cache path resolves outside the default .cache tree; refusing cleanup." ;;
  esac
}

assert_cache_root_is_disposable

safe_root() {
  local root="$1"
  local canonical_root

  [[ -d "$root" ]] || return 1
  canonical_root="$(readlink -f -- "$root")" || return 1
  [[ -n "$canonical_root" && "$canonical_root" != "/" ]] || return 1

  printf '%s\n' "${canonical_root%/}"
}

safe_user_root() {
  local root="$1"
  local canonical_root

  canonical_root="$(safe_root "$root")" || return 1
  case "$canonical_root" in
    "$CANONICAL_HOME"/*)
      printf '%s\n' "$canonical_root"
      ;;
    *)
      return 1
      ;;
  esac
}

if [[ -e "$USER_CACHE_ROOT" || -L "$USER_CACHE_ROOT" ]]; then
  safe_user_root "$USER_CACHE_ROOT" >/dev/null \
    || die "The user cache path resolves outside HOME; refusing cleanup."
fi

if [[ -e "$NPM_ROOT" || -L "$NPM_ROOT" ]]; then
  safe_user_root "$NPM_ROOT" >/dev/null \
    || die "The npm path resolves outside HOME; refusing cleanup."
fi

is_mountpoint() {
  local path="$1"
  command -v mountpoint >/dev/null 2>&1 && mountpoint -q -- "$path"
}

is_protected_temp_entry() {
  local entry_name="${1##*/}"

  case "$entry_name" in
    .X11-unix|.ICE-unix|.XIM-unix|.font-unix|.Test-unix|.wslg|\
      systemd-private-*|snap-private-tmp|.mount_*|ssh-*|tmux-*|vscode-ipc-*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

# Returns 0 when nothing below ENTRY changed within the stale window, 1 when
# something did, and 2 when ENTRY could not be fully inspected.
entry_is_stale() {
  local entry="$1"
  local recent_entry

  if ! recent_entry="$(
    find -P "$entry" -xdev -newermt "$STALE_DAYS days ago" -print -quit 2>/dev/null
  )"; then
    return 2
  fi

  [[ -z "$recent_entry" ]]
}

declare -a TEMP_ROOTS=()
declare -A IN_USE_PATHS=()
declare -A KEEP_REASONS=()
TEMP_KEEP_REASON=""

init_temp_roots() {
  local root
  local canonical_root

  for root in /tmp /var/tmp; do
    if canonical_root="$(safe_root "$root")"; then
      TEMP_ROOTS+=("$canonical_root")
    fi
  done
}

# Marks PATH and every parent below its temporary root as in use.
# /proc shows a link to a deleted file with a " (deleted)" suffix; stripping it keeps that file's directory marked.
add_in_use_path() {
  local path="${1% (deleted)}"
  local root

  for root in "${TEMP_ROOTS[@]}"; do
    if [[ "$path" == "$root"/* ]]; then
      while [[ "$path" == "$root"/* && -z "${IN_USE_PATHS[$path]:-}" ]]; do
        IN_USE_PATHS["$path"]=1
        path="${path%/*}"
      done
      return 0
    fi
  done
  return 0
}

# Best effort: finds temporary paths inside one argument, such as "--out=/tmp/run-1/report.json" or a shell snippet.
# A path ends at whitespace, a quote, or shell punctuation.
# A match inside a longer path, such as /home/u/tmp/x or /var/tmp/x, is not a use of the /tmp root.
add_in_use_argument() {
  local root
  local rest
  local preceding
  local path

  for root in "${TEMP_ROOTS[@]}"; do
    # An argument that is itself a path may contain spaces; keep it whole.
    if [[ "$1" == "$root"/* ]]; then
      add_in_use_path "$1"
    fi
    rest="$1"
    while [[ "$rest" == *"$root/"* ]]; do
      preceding="${rest%%"$root"/*}"
      preceding="${preceding: -1}"
      rest="${rest#*"$root"/}"
      case "$preceding" in
        ''|[[:space:]]|[=:,@\;\|\&\(\<\>\"\'\`]) ;;
        *) continue ;;
      esac
      path="$root/${rest%%[[:space:]\"\'\;\&\|\(\)\<\>,\`]*}"
      add_in_use_path "$path"
    done
  done
}

# Adds temporary paths that running processes use as a working or root directory or executable, hold open, map, listen on, or name in arguments.
# Pass "root" to inspect every process through sudo; otherwise only processes the current user may inspect are seen.
# Results accumulate across calls, so a failed rescan can only keep more entries, never fewer.
collect_in_use_paths() {
  local -a reader=()
  local path
  local argument

  if [[ "${1:-}" == root ]] && (( EUID != 0 )); then
    reader=(sudo --)
  fi

  while IFS= read -r path; do
    if [[ -n "$path" ]]; then
      add_in_use_path "$path"
    fi
  done < <(
    "${reader[@]}" find -P /proc/[0-9]*/cwd /proc/[0-9]*/root /proc/[0-9]*/exe \
      /proc/[0-9]*/fd -maxdepth 1 -type l -printf '%l\n' 2>/dev/null || true
    { "${reader[@]}" cat /proc/[0-9]*/maps 2>/dev/null || true; } \
      | sed -nE 's#^([^ ]+ +){5}(/.*)$#\2#p'
    # A listening socket shows up in /proc/<pid>/fd only as socket:[inode],
    # so bound socket paths come from the kernel's socket table instead.
    sed -nE '1d; s#^([^ ]+ +){7}(/.*)$#\2#p' /proc/net/unix 2>/dev/null || true
  )

  while IFS= read -r -d '' argument; do
    add_in_use_argument "$argument"
  done < <("${reader[@]}" cat /proc/[0-9]*/cmdline 2>/dev/null || true)
}

# Claude Code keeps per-session scratch space in /tmp/claude-<uid>/<project>/<session>.
# The container changes whenever any session runs, so its sessions are judged
# one by one, and only in the container that belongs to the current user.
is_session_container() {
  local entry="$1"

  [[ "${entry##*/}" == "claude-$EUID" && -d "$entry" && ! -L "$entry" ]] || return 1
  [[ "$(stat -c %u -- "$entry" 2>/dev/null)" == "$EUID" ]]
}

# A session directory is recent when its transcript changed within the stale
# window, even if the session wrote nothing to its scratch space.
session_transcript_is_recent() {
  local entry="$1"
  local session="${entry##*/}"
  local project_dir="${entry%/*}"
  local project="${project_dir##*/}"
  local transcript="$CLAUDE_TRANSCRIPT_ROOT/$project/$session.jsonl"

  [[ "$project" == -* && -f "$transcript" ]] || return 1
  [[ -n "$(find -P "$transcript" -newermt "$STALE_DAYS days ago" -print -quit 2>/dev/null)" ]]
}

# Also sets TEMP_KEEP_REASON, which the report and the apply-time skip warning print.
temp_entry_must_be_kept() {
  local entry="$1"
  local stale_status=0

  TEMP_KEEP_REASON=""
  if [[ -n "${IN_USE_PATHS[$entry]:-}" ]]; then
    TEMP_KEEP_REASON="in use"
    return 0
  fi

  entry_is_stale "$entry" || stale_status=$?
  case "$stale_status" in
    0) ;;
    1) TEMP_KEEP_REASON="recent"; return 0 ;;
    *) TEMP_KEEP_REASON="unreadable"; return 0 ;;
  esac

  if session_transcript_is_recent "$entry"; then
    TEMP_KEEP_REASON="recent session"
    return 0
  fi
  return 1
}

classify_temp_entry() {
  local entry="$1"
  local -n removable_ref="$2"
  local -n kept_ref="$3"

  if temp_entry_must_be_kept "$entry"; then
    kept_ref+=("$entry")
    KEEP_REASONS["$entry"]="$TEMP_KEEP_REASON"
  else
    removable_ref+=("$entry")
  fi
}

collect_session_container_entries() {
  local container="$1"
  local removable_name="$2"
  local kept_name="$3"
  local child
  local session_entry

  while IFS= read -r -d '' child; do
    if is_mountpoint "$child"; then
      continue
    fi
    # Project directories are named after a working directory with '/' replaced by '-', so they start with '-'.
    # Each session directory inside one is judged on its own; any other child of the container is judged whole.
    if [[ "${child##*/}" == -* && -d "$child" && ! -L "$child" ]]; then
      while IFS= read -r -d '' session_entry; do
        if ! is_mountpoint "$session_entry"; then
          classify_temp_entry "$session_entry" "$removable_name" "$kept_name"
        fi
      done < <(find -P "$child" -xdev -mindepth 1 -maxdepth 1 -print0 2>/dev/null)
    else
      classify_temp_entry "$child" "$removable_name" "$kept_name"
    fi
  done < <(find -P "$container" -xdev -mindepth 1 -maxdepth 1 -print0 2>/dev/null)
}

collect_temp_entries() {
  local root="$1"
  local removable_name="$2"
  local kept_name="$3"
  local canonical_root
  local entry

  canonical_root="$(safe_root "$root")" || return 0

  while IFS= read -r -d '' entry; do
    if is_protected_temp_entry "$entry" || is_mountpoint "$entry"; then
      continue
    fi
    if is_session_container "$entry"; then
      collect_session_container_entries "$entry" "$removable_name" "$kept_name"
    else
      classify_temp_entry "$entry" "$removable_name" "$kept_name"
    fi
  done < <(find -P "$canonical_root" -xdev -mindepth 1 -maxdepth 1 -print0 2>/dev/null)
}

collect_stale_children() {
  local root="$1"
  local output_name="$2"
  local canonical_root
  local entry
  local -n output_ref="$output_name"

  output_ref=()
  canonical_root="$(safe_user_root "$root")" || return 0

  while IFS= read -r -d '' entry; do
    if is_mountpoint "$entry"; then
      continue
    fi
    if entry_is_stale "$entry"; then
      output_ref+=("$entry")
    fi
  done < <(find -P "$canonical_root" -xdev -mindepth 1 -maxdepth 1 -print0 2>/dev/null)
}

collect_all_children() {
  local root="$1"
  local output_name="$2"
  local canonical_root
  local entry
  # ShellCheck cannot infer that this named output parameter refers to an array.
  # shellcheck disable=SC2178
  local -n output_ref="$output_name"

  output_ref=()
  canonical_root="$(safe_user_root "$root")" || return 0

  while IFS= read -r -d '' entry; do
    if ! is_mountpoint "$entry"; then
      output_ref+=("$entry")
    fi
  done < <(find -P "$canonical_root" -xdev -mindepth 1 -maxdepth 1 -print0 2>/dev/null)
}

collect_existing_children() {
  local root="$1"
  local output_name="$2"
  shift 2
  local canonical_root
  local candidate
  # ShellCheck cannot infer that this named output parameter refers to an array.
  # shellcheck disable=SC2178
  local -n output_ref="$output_name"

  output_ref=()
  canonical_root="$(safe_user_root "$root")" || return 0

  for candidate in "$@"; do
    if [[ "$(dirname -- "$candidate")" == "$canonical_root" ]] \
      && [[ -e "$candidate" || -L "$candidate" ]] \
      && ! is_mountpoint "$candidate"; then
      output_ref+=("$candidate")
    fi
  done
}

# Trash items keep their original modification times, so age comes from the
# DeletionDate in each .trashinfo file. Items without one fall back to mtime.
collect_trash_entries() {
  local output_name="$1"
  local include_all="$2"
  local files_root
  local entry
  local info_file
  local deleted_at
  local deleted_epoch
  local cutoff_epoch
  # ShellCheck cannot infer that this named output parameter refers to an array.
  # shellcheck disable=SC2178
  local -n output_ref="$output_name"

  output_ref=()
  files_root="$(safe_user_root "$TRASH_ROOT/files")" || return 0
  cutoff_epoch="$(date -d "$STALE_DAYS days ago" +%s)"

  while IFS= read -r -d '' entry; do
    info_file="$TRASH_ROOT/info/${entry##*/}.trashinfo"
    if [[ "$include_all" == true ]]; then
      output_ref+=("$entry")
    elif [[ -f "$info_file" ]]; then
      deleted_at="$(sed -n 's/^DeletionDate=//p' -- "$info_file" 2>/dev/null)" || deleted_at=""
      deleted_epoch="$(date -d "${deleted_at%%$'\n'*}" +%s 2>/dev/null)" || continue
      if (( deleted_epoch < cutoff_epoch )); then
        output_ref+=("$entry")
      fi
    elif entry_is_stale "$entry"; then
      output_ref+=("$entry")
    fi
  done < <(find -P "$files_root" -xdev -mindepth 1 -maxdepth 1 -print0 2>/dev/null)
}

GO_BUILD_CACHE=""
GO_MODULE_CACHE=""
PNPM_STORE=""
UV_CACHE=""

# Runs a tool from HOME with no input, so a go.mod toolchain pin or a project
# .npmrc in the caller's directory cannot trigger downloads or redirect caches.
in_home() {
  (cd -- "$HOME" && "$@" </dev/null)
}

is_existing_absolute_dir() {
  [[ "$1" == /* && -d "$1" ]]
}

# Asks each installed tool where its cache lives, because users often move them.
resolve_tool_paths() {
  if command -v go >/dev/null 2>&1; then
    GO_BUILD_CACHE="$(in_home go env GOCACHE 2>/dev/null)" || GO_BUILD_CACHE=""
    GO_MODULE_CACHE="$(in_home go env GOMODCACHE 2>/dev/null)" || GO_MODULE_CACHE=""
  fi
  if command -v pnpm >/dev/null 2>&1; then
    PNPM_STORE="$(in_home pnpm store path 2>/dev/null)" || PNPM_STORE=""
    PNPM_STORE="${PNPM_STORE##*$'\n'}"
  fi
  if command -v uv >/dev/null 2>&1; then
    UV_CACHE="$(in_home uv cache dir 2>/dev/null)" || UV_CACHE=""
  fi
}

path_size() {
  local size_output

  # du exits non-zero when a subdirectory is unreadable but still prints the
  # total it could measure.
  size_output="$(du -shx -- "$1" 2>/dev/null)" || true
  if [[ -n "$size_output" ]]; then
    printf '%s\n' "${size_output%%$'\t'*}"
  else
    printf '?\n'
  fi
}

human_kb() {
  numfmt --to=iec --from-unit=1024 "$1" 2>/dev/null || printf '%sK\n' "$1"
}

format_entry_count() {
  if (( $1 == 1 )); then
    printf '1 entry\n'
  else
    printf '%d entries\n' "$1"
  fi
}

declare -A SIZE_KB=()
PLAN_TOTAL_KB=0

# Sizes every path in the named array with one du process.
measure_sizes() {
  local -n paths_ref="$1"
  local line

  (( ${#paths_ref[@]} > 0 )) || return 0
  while IFS= read -r -d '' line; do
    SIZE_KB["${line#*$'\t'}"]="${line%%$'\t'*}"
  done < <(printf '%s\0' "${paths_ref[@]}" | du -skx --null --files0-from=- 2>/dev/null || true)
}

# Prints candidates largest first and adds their size to PLAN_TOTAL_KB.
# Without --verbose, mktemp-style siblings such as build-a1B2c3 and
# build-x9Y8z7 share one "build-*" row.
print_candidates() {
  local label="$1"
  local -n candidates_ref="$2"
  local -A group_kb=()
  local -A group_count=()
  local -A group_example=()
  local entry
  local key
  local size_kb
  local size
  local count
  local shown
  local rows
  local label_total_kb=0
  local hidden_rows=0

  printf '\n%s: ' "$label"
  if (( ${#candidates_ref[@]} == 0 )); then
    printf 'none\n'
    return
  fi

  for entry in "${candidates_ref[@]}"; do
    size_kb="${SIZE_KB[$entry]:-0}"
    label_total_kb=$(( label_total_kb + size_kb ))
    key="$entry"
    if [[ "$VERBOSE" != true && "${entry##*/}" =~ ^(.+[-_.])[[:alnum:]]{6,}$ ]]; then
      key="${entry%/*}/${BASH_REMATCH[1]}"
    fi
    group_kb["$key"]=$(( ${group_kb[$key]:-0} + size_kb ))
    group_count["$key"]=$(( ${group_count[$key]:-0} + 1 ))
    group_example["$key"]="$entry"
  done
  PLAN_TOTAL_KB=$(( PLAN_TOTAL_KB + label_total_kb ))
  printf '%s, %s\n' "$(format_entry_count "${#candidates_ref[@]}")" "$(human_kb "$label_total_kb")"

  rows="$(
    for key in "${!group_kb[@]}"; do
      if [[ "${group_count[$key]}" == 1 ]]; then
        printf -v shown '%q' "${group_example[$key]}"
      else
        printf -v shown '%q*' "$key"
      fi
      printf '%s\t%s\t%s\n' "${group_kb[$key]}" "${group_count[$key]}" "$shown"
    done | sort -t $'\t' -k1,1nr
  )"
  if [[ "$VERBOSE" != true ]] && (( ${#group_kb[@]} > REPORT_ROWS )); then
    hidden_rows=$(( ${#group_kb[@]} - REPORT_ROWS ))
    rows="$(head -n "$REPORT_ROWS" <<< "$rows")"
  fi

  while IFS=$'\t' read -r size count shown; do
    if [[ "$count" == 1 ]]; then
      printf '  %-8s %s\n' "$size" "$shown"
    else
      printf '  %-8s %s  (%s entries)\n' "$size" "$shown" "$count"
    fi
  done < <(numfmt -d $'\t' --field=1 --to=iec --from-unit=1024 <<< "$rows")

  if (( hidden_rows > 0 )); then
    printf '  ... %d more rows; use --verbose to list every path.\n' "$hidden_rows"
  fi
}

print_kept_temp_entries() {
  # ShellCheck cannot infer that this named parameter refers to an array.
  # shellcheck disable=SC2178
  local -n kept_ref="$1"
  local entry
  local size
  local reason
  local shown

  printf '\nTemporary entries kept: '
  if (( ${#kept_ref[@]} == 0 )); then
    printf 'none\n'
    return
  fi
  printf '%s; largest:\n' "$(format_entry_count "${#kept_ref[@]}")"

  while IFS=$'\t' read -r size reason shown; do
    printf '  %-8s %-15s %s\n' "$size" "$reason" "$shown"
  done < <(
    for entry in "${kept_ref[@]}"; do
      printf -v shown '%q' "$entry"
      printf '%s\t%s\t%s\n' "${SIZE_KB[$entry]:-0}" "${KEEP_REASONS[$entry]:-kept}" "$shown"
    done | sort -t $'\t' -k1,1nr | sed -n "1,${KEPT_REPORT_ROWS}p" \
      | numfmt -d $'\t' --field=1 --to=iec --from-unit=1024
  )
}

print_disk_usage() {
  printf '\n== WSL root filesystem ==\n'
  df -h / || warn "Could not read root filesystem usage."
}

print_home_usage() {
  local size
  local path

  printf '\n== Largest items in %s (report only) ==\n' "$HOME"
  while IFS=$'\t' read -r size path; do
    printf '  %-8s %s\n' "$size" "$path"
  done < <(
    { du -xak --max-depth=1 -- "$HOME" 2>/dev/null || true; } \
      | awk -F '\t' -v home="$HOME" '$2 != home' \
      | sort -t $'\t' -k1,1nr | sed -n "1,${HOME_REPORT_ROWS}p" \
      | numfmt -d $'\t' --field=1 --to=iec --from-unit=1024
  )
}

print_cache_row() {
  local path="$1"
  local handling="$2"

  if is_existing_absolute_dir "$path"; then
    printf '  %-8s %s  (%s)\n' "$(path_size "$path")" "$path" "$handling"
  fi
}

print_caches_and_trash() {
  printf '\n== Caches and Trash ==\n'
  print_cache_row "$USER_CACHE_ROOT" "safe: stale entries; aggressive: everything"
  print_cache_row "$NPM_ROOT" "safe: stale logs; aggressive: cache, _npx, and _logs"
  print_cache_row "$GO_BUILD_CACHE" "aggressive: go clean -cache -testcache"
  print_cache_row "$GO_MODULE_CACHE" "aggressive: go clean -modcache"
  print_cache_row "$PNPM_STORE" "safe: pnpm store prune"
  print_cache_row "$UV_CACHE" "safe: uv cache prune"
  print_cache_row "$TRASH_ROOT" "safe: items trashed ${STALE_DAYS}+ days ago; aggressive: everything"
}

# These arrays are populated through the nameref output parameters above.
# shellcheck disable=SC2034
declare -a \
  TMP_CANDIDATES=() \
  VAR_TMP_CANDIDATES=() \
  TEMP_KEPT=() \
  CACHE_CANDIDATES=() \
  NPM_LOG_CANDIDATES=() \
  NPM_EXTRA_CANDIDATES=() \
  TRASH_CANDIDATES=()

info "Scanning cleanup candidates; this may take a while."
init_temp_roots
resolve_tool_paths
collect_in_use_paths
collect_temp_entries "/tmp" TMP_CANDIDATES TEMP_KEPT
collect_temp_entries "/var/tmp" VAR_TMP_CANDIDATES TEMP_KEPT

if [[ "$AGGRESSIVE" == true ]]; then
  collect_all_children "$USER_CACHE_ROOT" CACHE_CANDIDATES
  collect_existing_children "$NPM_ROOT" NPM_EXTRA_CANDIDATES \
    "$NPM_ROOT/_npx" "$NPM_ROOT/_logs"
  collect_trash_entries TRASH_CANDIDATES true
else
  collect_stale_children "$USER_CACHE_ROOT" CACHE_CANDIDATES
  collect_stale_children "$NPM_ROOT/_logs" NPM_LOG_CANDIDATES
  collect_trash_entries TRASH_CANDIDATES false
fi

for array_name in TMP_CANDIDATES VAR_TMP_CANDIDATES TEMP_KEPT CACHE_CANDIDATES \
  NPM_LOG_CANDIDATES NPM_EXTRA_CANDIDATES TRASH_CANDIDATES; do
  measure_sizes "$array_name"
done

print_disk_usage
print_home_usage
print_caches_and_trash

printf '\n== Cleanup plan ==\n'
printf 'Mode: %s\n' "$MODE"
if [[ "$AGGRESSIVE" == true ]]; then
  printf 'Profile: aggressive\n'
else
  printf 'Profile: safe\n'
fi
printf 'Stale threshold: %s days\n' "$STALE_DAYS"

print_candidates "Stale /tmp entries" TMP_CANDIDATES
print_candidates "Stale /var/tmp entries" VAR_TMP_CANDIDATES
print_kept_temp_entries TEMP_KEPT
if [[ "$AGGRESSIVE" == true ]]; then
  print_candidates "User cache entries (aggressive)" CACHE_CANDIDATES
  print_candidates "npm/npx directories (aggressive)" NPM_EXTRA_CANDIDATES
  print_candidates "Trash items (aggressive)" TRASH_CANDIDATES
else
  print_candidates "Stale user cache entries" CACHE_CANDIDATES
  print_candidates "Stale npm log entries" NPM_LOG_CANDIDATES
  print_candidates "Trash items deleted over $STALE_DAYS days ago" TRASH_CANDIDATES
fi

printf '\nRemovals above free about %s.\n' "$(human_kb "$PLAN_TOTAL_KB")"
printf '\nAdditional actions:\n'
if is_existing_absolute_dir "$PNPM_STORE"; then
  printf '  - prune packages no project references from the pnpm store\n'
fi
if is_existing_absolute_dir "$UV_CACHE"; then
  printf '  - prune unused uv cache entries\n'
fi
printf '  - clear downloaded apt package archives (apt-get clean)\n'
printf '  - vacuum persistent journal entries older than %d days, when available\n' \
  "$JOURNAL_RETENTION_DAYS"
if [[ "$AGGRESSIVE" == true ]]; then
  printf '  - clear npm cache and Go build, test, and module caches, when available\n'
fi
if [[ "$RUN_TRIM" == true ]]; then
  printf '  - trim unused blocks on the WSL root filesystem\n'
else
  printf '  - skip filesystem trim (--no-trim)\n'
fi

if [[ "$MODE" == "report" ]]; then
  printf '\nReport only: no files were changed. Use --dry-run or --apply to continue.\n'
  exit 0
fi

if [[ "$MODE" == "dry-run" ]]; then
  printf '\nDry run complete: no files were changed.\n'
  exit 0
fi

confirm_cleanup() {
  local expected="CLEAN"
  local answer

  if [[ "$ASSUME_YES" == true ]]; then
    return 0
  fi

  [[ -t 0 ]] || die "Interactive confirmation requires a terminal; use --yes for automation."
  if [[ "$AGGRESSIVE" == true ]]; then
    expected="AGGRESSIVE"
  fi

  printf '\nType %s to run this cleanup: ' "$expected"
  IFS= read -r answer
  if [[ "$answer" != "$expected" ]]; then
    info "Cleanup cancelled; no files were changed."
    exit 0
  fi
}

ensure_root_access() {
  if (( EUID == 0 )); then
    return 0
  fi
  command -v sudo >/dev/null 2>&1 || die "sudo is required for system cleanup and fstrim."
  sudo -v || die "Could not obtain sudo access; cleanup has not started."
}

run_as_root() {
  if (( EUID == 0 )); then
    "$@"
  else
    sudo -- "$@"
  fi
}

REMOVED_COUNT=0

record_removal() {
  REMOVED_COUNT=$((REMOVED_COUNT + 1))
  if [[ "$VERBOSE" == true ]]; then
    info "Removed: $1"
  fi
}

# PRIVILEGE is user, root, or user-then-root. The last tries without sudo
# first and falls back to root for read-only directories inside the entry,
# such as a copied Go module cache.
remove_path() {
  local privilege="$1"
  local entry="$2"

  if [[ "$privilege" == user-then-root ]]; then
    if rm -rf --one-file-system --preserve-root=all -- "$entry" 2>/dev/null; then
      record_removal "$entry"
      return
    fi
    privilege=root
  fi

  if [[ "$privilege" == root ]]; then
    if run_as_root rm -rf --one-file-system --preserve-root=all -- "$entry"; then
      record_removal "$entry"
      return
    fi
  elif rm -rf --one-file-system --preserve-root=all -- "$entry"; then
    record_removal "$entry"
    return
  fi
  fail "Could not remove: $entry"
}

report_removals() {
  local label="$1"
  local removed_before="$2"
  local planned="$3"

  if (( planned > 0 )); then
    info "Removed $((REMOVED_COUNT - removed_before)) of $planned planned entries from $label."
  fi
}

# A removable temporary path is a direct child of the cleanup root or an entry inside the current user's session container:
# either a direct child of the container or an entry inside one of its project directories (see is_session_container).
temp_entry_is_in_scope() {
  local canonical_root="$1"
  local entry="$2"
  local parent="${entry%/*}"
  local relative="${entry#"$canonical_root"/}"
  local container

  case "${entry##*/}" in
    ''|.|..) return 1 ;;
  esac
  [[ "$relative" != "$entry" ]] || return 1
  if [[ "$parent" == "$canonical_root" ]]; then
    return 0
  fi

  container="$canonical_root/${relative%%/*}"
  is_session_container "$container" || return 1
  [[ "$(readlink -f -- "$parent")" == "$parent" ]] || return 1
  if [[ "$parent" == "$container" ]]; then
    return 0
  fi
  [[ "${parent%/*}" == "$container" && "${parent##*/}" == -* ]]
}

remove_temp_candidates() {
  local root="$1"
  local array_name="$2"
  local canonical_root
  local entry
  local removed_before="$REMOVED_COUNT"
  local -n candidates_ref="$array_name"

  canonical_root="$(safe_root "$root")" || {
    if (( ${#candidates_ref[@]} > 0 )); then
      fail "Cleanup root is no longer safe or available: $root"
    fi
    return
  }

  for entry in "${candidates_ref[@]}"; do
    if [[ ! -e "$entry" && ! -L "$entry" ]]; then
      continue
    fi
    if ! temp_entry_is_in_scope "$canonical_root" "$entry"; then
      fail "Refusing path outside the cleanup root: $entry"
      continue
    fi
    if [[ "${entry%/*}" == "$canonical_root" ]] && is_protected_temp_entry "$entry"; then
      warn "Skipped protected temporary entry: $entry"
      continue
    fi
    if is_mountpoint "$entry"; then
      warn "Skipped mounted path: $entry"
      continue
    fi
    if temp_entry_must_be_kept "$entry"; then
      warn "Skipped entry that changed after the report ($TEMP_KEEP_REASON): $entry"
      continue
    fi

    # Entries inside the session container belong to the current user, so sudo is only a fallback.
    if [[ "${entry%/*}" == "$canonical_root" ]]; then
      remove_path root "$entry"
    else
      remove_path user-then-root "$entry"
    fi
  done
  report_removals "$root" "$removed_before" "${#candidates_ref[@]}"
}

remove_candidates() {
  local root="$1"
  local must_still_be_stale="$2"
  local array_name="$3"
  local canonical_root
  local entry
  local removed_before="$REMOVED_COUNT"
  local -n candidates_ref="$array_name"

  canonical_root="$(safe_user_root "$root")" || {
    if (( ${#candidates_ref[@]} > 0 )); then
      fail "Cleanup root is no longer safe or available: $root"
    fi
    return
  }

  for entry in "${candidates_ref[@]}"; do
    if [[ ! -e "$entry" && ! -L "$entry" ]]; then
      continue
    fi
    if [[ "$(dirname -- "$entry")" != "$canonical_root" || "$entry" == "$canonical_root" ]]; then
      fail "Refusing path outside the cleanup root: $entry"
      continue
    fi
    if is_mountpoint "$entry"; then
      warn "Skipped mounted path: $entry"
      continue
    fi
    if [[ "$must_still_be_stale" == true ]] && ! entry_is_stale "$entry"; then
      warn "Skipped entry that changed after the report: $entry"
      continue
    fi

    remove_path user "$entry"
  done
  report_removals "$root" "$removed_before" "${#candidates_ref[@]}"
}

remove_trash_entries() {
  local entry

  remove_candidates "$TRASH_ROOT/files" false TRASH_CANDIDATES
  for entry in "${TRASH_CANDIDATES[@]}"; do
    if [[ ! -e "$entry" && ! -L "$entry" ]]; then
      rm -f -- "$TRASH_ROOT/info/${entry##*/}.trashinfo" \
        || warn "Could not remove Trash metadata for: $entry"
    fi
  done
}

prune_package_stores() {
  local uv_status=0

  if is_existing_absolute_dir "$PNPM_STORE"; then
    if in_home pnpm store prune; then
      info "Pruned unreferenced packages from the pnpm store."
    else
      fail "pnpm store prune failed."
    fi
  fi

  if is_existing_absolute_dir "$UV_CACHE"; then
    # uv waits indefinitely while another uv process holds the cache lock.
    in_home timeout "$UV_PRUNE_TIMEOUT_SECONDS" uv cache prune || uv_status=$?
    case "$uv_status" in
      0) info "Pruned unused uv cache entries." ;;
      124) warn "uv cache prune timed out; another uv process may be using the cache." ;;
      *) fail "uv cache prune failed." ;;
    esac
  fi
}

clean_apt_cache() {
  if ! command -v apt-get >/dev/null 2>&1; then
    info "apt-get not found; skipping apt package cache."
    return
  fi

  if run_as_root apt-get clean; then
    info "Cleared downloaded apt package archives."
  else
    fail "apt-get clean failed."
  fi
}

vacuum_journal() {
  if ! command -v journalctl >/dev/null 2>&1 || [[ ! -d /var/log/journal ]]; then
    info "Persistent system journal not available; skipping journal vacuum."
    return
  fi

  if run_as_root journalctl --vacuum-time="${JOURNAL_RETENTION_DAYS}d"; then
    info "Vacuumed persistent journal entries older than ${JOURNAL_RETENTION_DAYS} days."
  else
    warn "Journal vacuum failed; other cleanup can continue."
  fi
}

clean_aggressive_tool_caches() {
  if command -v npm >/dev/null 2>&1; then
    if in_home npm cache clean --force; then
      info "Cleared npm's content cache."
    else
      fail "npm cache clean failed."
    fi
  else
    info "npm not found; skipping npm content cache."
  fi

  if command -v go >/dev/null 2>&1; then
    if in_home go clean -cache -testcache -modcache; then
      info "Cleared Go build, test, and module caches."
    else
      fail "Go cache cleanup failed."
    fi
  else
    info "Go not found; skipping Go caches."
  fi
}

trim_root_filesystem() {
  if [[ "$RUN_TRIM" != true ]]; then
    return
  fi
  if ! command -v fstrim >/dev/null 2>&1; then
    warn "fstrim not found; deleted blocks were not trimmed."
    return
  fi

  if run_as_root fstrim -v /; then
    info "Trimmed unused blocks on the WSL root filesystem."
  else
    warn "fstrim failed or discard is unsupported; cleanup still ran."
  fi
}

confirm_cleanup
ensure_root_access

printf '\n== Applying cleanup ==\n'
info "Rechecking running processes before removing temporary entries."
# The sudo scan sees every user's processes; the unprivileged scan still counts if sudo cannot read /proc.
collect_in_use_paths
collect_in_use_paths root
remove_temp_candidates "/tmp" TMP_CANDIDATES
remove_temp_candidates "/var/tmp" VAR_TMP_CANDIDATES
prune_package_stores

if [[ "$AGGRESSIVE" == true ]]; then
  remove_candidates "$USER_CACHE_ROOT" false CACHE_CANDIDATES
  remove_candidates "$NPM_ROOT" false NPM_EXTRA_CANDIDATES
  clean_aggressive_tool_caches
else
  remove_candidates "$USER_CACHE_ROOT" true CACHE_CANDIDATES
  remove_candidates "$NPM_ROOT/_logs" true NPM_LOG_CANDIDATES
fi
remove_trash_entries

clean_apt_cache
vacuum_journal
trim_root_filesystem
print_disk_usage

cat <<'EOF'

Freed space is available inside WSL now, but the Windows VHDX keeps its size
until it is compacted. Close WSL terminals and Docker Desktop, then run
scripts/wsl-compact.sh from an administrator Git Bash on Windows. Sparse VHDs
are not a reliable alternative: sparseVhd=true in .wslconfig affects only new
distros, and current WSL releases block enabling sparse mode by default
because of data-corruption reports.
EOF

if (( FAILURES > 0 )); then
  printf '\nMaintenance removed %d entries and finished with %d failed action(s) and %d warning(s).\n' \
    "$REMOVED_COUNT" "$FAILURES" "$WARNINGS" >&2
  exit 1
fi

printf '\nMaintenance removed %d entries and finished with %d warning(s).\n' \
  "$REMOVED_COUNT" "$WARNINGS"
