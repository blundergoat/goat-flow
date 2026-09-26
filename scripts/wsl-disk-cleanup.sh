#!/usr/bin/env bash

set -Eeuo pipefail
IFS=$'\n\t'

readonly DEFAULT_STALE_DAYS=14
readonly JOURNAL_RETENTION_DAYS=30

MODE="report"
MODE_SET=false
STALE_DAYS="$DEFAULT_STALE_DAYS"
AGGRESSIVE=false
ASSUME_YES=false
RUN_TRIM=true
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
  --dry-run          Preview the exact cleanup plan without changing anything.
  --apply            Run the cleanup after an exact confirmation prompt.

Options:
  --days DAYS        Treat an entry as stale when nothing below it was modified in
                     this many days (default: 14; range: 1-3650).
  --aggressive       Also clear the whole user cache, npm/npx caches, and Go's
                     build/test cache. Requires --apply to make changes.
  --yes              Skip the confirmation prompt. Valid only with --apply.
  --no-trim          Do not run fstrim on the WSL root filesystem after cleanup.
  -h, --help         Show this help text.

Safe cleanup removes only stale direct children of /tmp, /var/tmp, the user
cache, and npm's log directory. It also clears downloaded apt packages and
vacuum journals older than 30 days. A candidate is stale only when the script
can inspect it and finds no recently modified file or directory below it.

This script never removes projects, Docker data, Cargo target directories,
Ollama models, Codex or IDE state, installed packages, or apt dependencies.
VHDX compaction is a separate Windows-side operation.

Examples:
  bash scripts/wsl-disk-cleanup.sh
  bash scripts/wsl-disk-cleanup.sh --dry-run --days 30
  bash scripts/wsl-disk-cleanup.sh --apply --days 30
  bash scripts/wsl-disk-cleanup.sh --dry-run --aggressive
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

if [[ -z "${HOME:-}" || "$HOME" != /* || "$HOME" == "/" ]]; then
  die "HOME must be a non-root absolute path."
fi

if [[ "$SHOW_MENU" == true ]]; then
  choose_mode_from_menu
fi

readonly USER_CACHE_ROOT="${XDG_CACHE_HOME:-$HOME/.cache}"
readonly NPM_ROOT="$HOME/.npm"
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

resolve_cleanup_root() {
  local root="$1"
  local scope="$2"

  if [[ "$scope" == "user" ]]; then
    safe_user_root "$root"
  else
    safe_root "$root"
  fi
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

entry_is_stale() {
  local entry="$1"
  local recent_entry

  if ! recent_entry="$(
    find -P "$entry" -xdev -newermt "$STALE_DAYS days ago" -print -quit 2>/dev/null
  )"; then
    return 1
  fi

  [[ -z "$recent_entry" ]]
}

collect_stale_children() {
  local root="$1"
  local protect_temp_entries="$2"
  local output_name="$3"
  local scope="$4"
  local canonical_root
  local entry
  local -n output_ref="$output_name"

  output_ref=()
  canonical_root="$(resolve_cleanup_root "$root" "$scope")" || return 0

  while IFS= read -r -d '' entry; do
    if [[ "$protect_temp_entries" == true ]] && is_protected_temp_entry "$entry"; then
      continue
    fi
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

path_size() {
  local path="$1"
  local size_output

  if size_output="$(du -shx -- "$path" 2>/dev/null)"; then
    printf '%s\n' "${size_output%%$'\t'*}"
  else
    printf '?\n'
  fi
}

path_owner() {
  stat -c '%U' -- "$1" 2>/dev/null || printf '?\n'
}

print_candidates() {
  local label="$1"
  local array_name="$2"
  local -n candidates_ref="$array_name"
  local entry

  printf '\n%s (%d):\n' "$label" "${#candidates_ref[@]}"
  if (( ${#candidates_ref[@]} == 0 )); then
    printf '  none\n'
    return
  fi

  for entry in "${candidates_ref[@]}"; do
    printf '  %-8s %-12s %q\n' "$(path_size "$entry")" "$(path_owner "$entry")" "$entry"
  done
}

print_disk_usage() {
  printf '\n== WSL root filesystem ==\n'
  df -h / || warn "Could not read root filesystem usage."
}

print_watchlist() {
  local -a watched_paths=(
    "/tmp"
    "/var/tmp"
    "$USER_CACHE_ROOT"
    "$NPM_ROOT"
    "$HOME/.cargo"
    "$HOME/.ollama"
    "$HOME/.codex"
    "$HOME/.kiro-server"
    "$HOME/.vscode-server"
    "$HOME/projects"
  )
  local path

  printf '\n== Watched paths (report only) ==\n'
  printf '  %-8s %s\n' "SIZE" "PATH"
  for path in "${watched_paths[@]}"; do
    if [[ -e "$path" || -L "$path" ]]; then
      printf '  %-8s %s\n' "$(path_size "$path")" "$path"
    fi
  done
}

# These arrays are populated through the nameref output parameters above.
# shellcheck disable=SC2034
declare -a \
  TMP_CANDIDATES=() \
  VAR_TMP_CANDIDATES=() \
  CACHE_CANDIDATES=() \
  NPM_LOG_CANDIDATES=() \
  NPM_EXTRA_CANDIDATES=()

info "Scanning cleanup candidates; this may take a while."
collect_stale_children "/tmp" true TMP_CANDIDATES system
collect_stale_children "/var/tmp" true VAR_TMP_CANDIDATES system

if [[ "$AGGRESSIVE" == true ]]; then
  collect_all_children "$USER_CACHE_ROOT" CACHE_CANDIDATES
  collect_existing_children "$NPM_ROOT" NPM_EXTRA_CANDIDATES \
    "$NPM_ROOT/_npx" "$NPM_ROOT/_logs"
else
  collect_stale_children "$USER_CACHE_ROOT" false CACHE_CANDIDATES user
  collect_stale_children "$NPM_ROOT/_logs" false NPM_LOG_CANDIDATES user
fi

print_disk_usage
print_watchlist

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
if [[ "$AGGRESSIVE" == true ]]; then
  print_candidates "User cache entries (aggressive)" CACHE_CANDIDATES
  print_candidates "npm/npx directories (aggressive)" NPM_EXTRA_CANDIDATES
else
  print_candidates "Stale user cache entries" CACHE_CANDIDATES
  print_candidates "Stale npm log entries" NPM_LOG_CANDIDATES
fi

printf '\nAdditional actions:\n'
printf '  - clear downloaded apt package archives (apt-get clean)\n'
printf '  - vacuum persistent journal entries older than %d days, when available\n' \
  "$JOURNAL_RETENTION_DAYS"
if [[ "$AGGRESSIVE" == true ]]; then
  printf '  - clear npm cache and Go build/test cache, when available\n'
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

remove_candidates() {
  local root="$1"
  local privilege="$2"
  local must_still_be_stale="$3"
  local protect_temp_entries="$4"
  local array_name="$5"
  local canonical_root
  local entry
  local -n candidates_ref="$array_name"

  canonical_root="$(resolve_cleanup_root "$root" "$privilege")" || {
    if (( ${#candidates_ref[@]} > 0 )); then
      fail "Cleanup root is no longer safe or available: $root"
    fi
    return
  }

  for entry in "${candidates_ref[@]}"; do
    if [[ ! -e "$entry" && ! -L "$entry" ]]; then
      info "Already gone: $entry"
      continue
    fi
    if [[ "$(dirname -- "$entry")" != "$canonical_root" || "$entry" == "$canonical_root" ]]; then
      fail "Refusing path outside the cleanup root: $entry"
      continue
    fi
    if [[ "$protect_temp_entries" == true ]] && is_protected_temp_entry "$entry"; then
      warn "Skipped protected temporary entry: $entry"
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

    if [[ "$privilege" == "root" ]]; then
      if run_as_root rm -rf --one-file-system --preserve-root=all -- "$entry"; then
        info "Removed: $entry"
      else
        fail "Could not remove: $entry"
      fi
    elif rm -rf --one-file-system --preserve-root=all -- "$entry"; then
      info "Removed: $entry"
    else
      fail "Could not remove: $entry"
    fi
  done
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
    if npm cache clean --force; then
      info "Cleared npm's content cache."
    else
      fail "npm cache clean failed."
    fi
  else
    info "npm not found; skipping npm content cache."
  fi

  if command -v go >/dev/null 2>&1; then
    if go clean -cache -testcache; then
      info "Cleared Go build and test caches."
    else
      fail "Go cache cleanup failed."
    fi
  else
    info "Go not found; skipping Go build/test cache."
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
remove_candidates "/tmp" root true true TMP_CANDIDATES
remove_candidates "/var/tmp" root true true VAR_TMP_CANDIDATES

if [[ "$AGGRESSIVE" == true ]]; then
  remove_candidates "$USER_CACHE_ROOT" user false false CACHE_CANDIDATES
  remove_candidates "$NPM_ROOT" user false false NPM_EXTRA_CANDIDATES
  clean_aggressive_tool_caches
else
  remove_candidates "$USER_CACHE_ROOT" user true false CACHE_CANDIDATES
  remove_candidates "$NPM_ROOT/_logs" user true false NPM_LOG_CANDIDATES
fi

clean_apt_cache
vacuum_journal
trim_root_filesystem
print_disk_usage

cat <<'EOF'

Cleanup and TRIM do not by themselves shrink the Windows VHDX file. To return
space to Windows, exit WSL, stop Docker Desktop and Remote-WSL sessions, run
`wsl --shutdown` in an elevated PowerShell, then use DevGoat's Disk Space page
to compact the distro's VHDX.
EOF

if (( FAILURES > 0 )); then
  printf '\nMaintenance finished with %d failed action(s) and %d warning(s).\n' \
    "$FAILURES" "$WARNINGS" >&2
  exit 1
fi

printf '\nMaintenance finished with %d warning(s).\n' "$WARNINGS"
