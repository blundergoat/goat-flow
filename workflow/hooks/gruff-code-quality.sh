#!/usr/bin/env bash

# gruff-code-quality.sh
# goat-flow-hook-version: 1.15.1
# Runs the matching Gruff analyzer after a user or agent edits a supported file.
# It attributes line/symbol findings to the edit while retaining file/project findings.
# Package-local configs select monorepo targets; explicit overrides cover other layouts.
# Migrated launches emit one bounded result for provider adaptation; older launches keep text.
# Use this hook for immediate review feedback, not as proof that project-wide checks passed.

set -euo pipefail

# A user on stock macOS Bash needs a clear setup message before newer syntax runs.
if (( BASH_VERSINFO[0] < 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] < 4) )); then
  printf 'gruff-code-quality: requires bash 4.4+ (got %s); skipped. On macOS install Homebrew bash and invoke /usr/local/bin/bash or /opt/homebrew/bin/bash explicitly.\n' "${BASH_VERSION:-unknown}" >&2
  exit 0
fi

FOOTER="For triage: consult .goat-flow/skill-docs/playbooks/gruff-code-quality.md"
HOOK_VERSION="1.15.1"
HOOK_RESULT_SCHEMA="goat-flow.hook-result.v1"
SUPPORTED_TOOLS=" edit write multiedit apply_patch write_to_file replace_file_content multi_replace_file_content "
SKIP_DIR_PATTERN='(^|/)(node_modules|vendor|\.goat-flow|dist|build|coverage|\.git|target|\.venv|\.mypy_cache|\.pytest_cache|\.ruff_cache)(/|$)'
BINARY_SEARCH_PATHS='vendor/bin, node_modules/.bin, bin, .venv/bin, ~/.local/bin, PATH'
GRUFF_CODE_QUALITY_TIMEOUT_SECONDS="${GRUFF_CODE_QUALITY_TIMEOUT_SECONDS:-60}"
# Max changed-line findings listed per file before the rest are summarised as
# "(<m> more on changed lines)". Keeps a large edit from flooding the agent.
GRUFF_CODE_QUALITY_MAX_FINDINGS="${GRUFF_CODE_QUALITY_MAX_FINDINGS:-20}"
# Lowest severity surfaced on changed lines (advisory|warning|error). Findings
# below it are counted, not listed - a project that only wants the agent pushed on
# warning+ sets this to `warning`. Default `advisory` keeps every finding visible.
GRUFF_CODE_QUALITY_MIN_SEVERITY="${GRUFF_CODE_QUALITY_MIN_SEVERITY:-advisory}"
# Per-binary cache of gruff.hook.v1 capabilities JSON ("" = analyzer is pre-contract).
declare -A HOOK_CAPS_CACHE

FILE_RESULT_PRIORITY=0
FILE_RESULT_OUTCOME="pass"
FILE_RESULT_REASON_CODE="completed-clean"
FILE_RESULT_FINDINGS='[]'
FILE_RESULT_COMPLETED=0
FILE_RESULT_VERIFIED=0
FILE_RESULT_BINARY=""

# Reset one edited file before prerequisites, Git scope, and its analyzer are checked.
reset_file_result() {
  FILE_RESULT_PRIORITY=80
  FILE_RESULT_OUTCOME="unavailable"
  FILE_RESULT_REASON_CODE="hook-unavailable"
  FILE_RESULT_FINDINGS='[]'
  FILE_RESULT_COMPLETED=0
  FILE_RESULT_VERIFIED=0
  FILE_RESULT_BINARY=""
}

# Record what the user should understand about one file after Gruff finishes or stops.
record_file_result() {
  local priority="$1" outcome="$2" reason_code="$3" finding_code="$4"
  local finding_message="$5" finding_target="$6" completed="$7" verified="$8"
  FILE_RESULT_PRIORITY="$priority"
  FILE_RESULT_OUTCOME="$outcome"
  FILE_RESULT_REASON_CODE="$reason_code"
  FILE_RESULT_COMPLETED="$completed"
  FILE_RESULT_VERIFIED="$verified"
  # An empty code means the analyzer completed cleanly and needs no UI detail.
  if [[ -z "$finding_code" ]]; then
    FILE_RESULT_FINDINGS='[]'
    return 0
  fi
  # A host without jq cannot safely interpolate analyzer text into provider JSON.
  if ! command -v jq >/dev/null 2>&1; then
    FILE_RESULT_FINDINGS='[]'
    return 0
  fi
  FILE_RESULT_FINDINGS="$(jq -cn \
    --arg code "$finding_code" \
    --arg message "$finding_message" \
    --arg target "$finding_target" \
    '[{code: $code, message: $message, target: $target}]')"
}

# Convert surfaced analyzer details into the bounded finding list shown in the coding-agent UI.
record_report_result() {
  local report_json="$1" rel_path="$2" binary="$3"
  local total
  total="$(printf '%s' "$report_json" | jq -r '.total // 0')"
  FILE_RESULT_BINARY="$binary"
  # Any attributable finding becomes advisory feedback while still proving analyzer health.
  if [[ "$total" =~ ^[0-9]+$ && "$total" -gt 0 ]]; then
    FILE_RESULT_PRIORITY=20
    FILE_RESULT_OUTCOME="advisory"
    FILE_RESULT_REASON_CODE="findings-reported"
    FILE_RESULT_FINDINGS="$(printf '%s' "$report_json" | jq -c --arg target "$rel_path" '
      [(.resultFindings // [])[] | .target = $target] | .[0:20]
    ')"
    FILE_RESULT_COMPLETED=1
    FILE_RESULT_VERIFIED=1
    return 0
  fi
  record_file_result 0 "pass" "completed-clean" "" "" "$rel_path" 1 1
  FILE_RESULT_BINARY="$binary"
}

# Payload extraction stays jq-first for correctness but keeps small regex
# fallbacks so unsupported tools and paths can still be skipped when jq is
# absent. Full changed-line filtering requires jq later in `main`.
read_stdin() {
  local input
  input="$(cat || true)"
  printf '%s' "$input"
}

json_field() {
  local input="$1"
  local expr="$2"
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$input" | jq -r "$expr // empty" 2>/dev/null || true
    return
  fi
  return 0
}

json_tool_name() {
  local input="$1"
  json_field "$input" '
    [
      .tool_name,
      .toolName,
      .toolCall.name,
      .name
    ] | map(select(type == "string" and length > 0)) | first
  '
}

json_file_paths() {
  local input="$1"
  json_field "$input" '
    def string_path_fields(value):
      if (value | type) == "object" then
        [
          value.file_path?,
          value.filePath?,
          value.path?,
          value.AbsolutePath?,
          value.absolutePath?,
          value.TargetFile?,
          value.targetFile?,
          value.FilePath?,
          value.SearchPath?,
          value.searchPath?
        ]
      else
        []
      end;
    def paths_from(value):
      if value == null then
        empty
      elif (value | type) == "array" then
        value[] | paths_from(.)
      elif (value | type) == "object" then
        (string_path_fields(value)[]?),
        (value.files? | paths_from(.)),
        (value.paths? | paths_from(.)),
        (value.edits? | paths_from(.)),
        (value.changes? | paths_from(.)),
        (value.operations? | paths_from(.))
      elif (value | type) == "string" then
        (try (value | fromjson | paths_from(.)) catch value)
      else
        empty
      end;

    [
      paths_from(.tool_input),
      paths_from(.toolCall.args),
      paths_from(.toolArgs),
      paths_from(.tool_args),
      paths_from(.result),
      paths_from(.)
    ] | map(select(type == "string" and length > 0)) | unique | .[]
  '
}

# Read patch or command text that may name files without a file_path field.
json_patch_texts() {
  local input="$1"
  json_field "$input" '
    [
      .tool_input.patch?,
      .tool_input.command?,
      .toolCall.args.patch?,
      .toolCall.args.command?,
      .toolArgs.patch?,
      .toolArgs.command?,
      .tool_args.patch?,
      .tool_args.command?
    ] | map(select(type == "string" and length > 0)) | .[]
  '
}

# Extract only patch-declared targets, such as a user's `*** Update File: src/app.ts` edit.
patch_file_paths() {
  local input="$1"
  json_patch_texts "$input" | awk '
    /^\*\*\* (Add|Update|Delete) File: / {
      sub(/^\*\*\* (Add|Update|Delete) File: /, "")
      print
      next
    }
    /^\+\+\+ (b\/)?[^/]/ {
      sub(/^\+\+\+ /, "")
      sub(/^b\//, "")
      if ($0 != "/dev/null") print
    }
  '
}

fallback_tool_name() {
  local input="$1"
  if [[ "$input" =~ \"tool_name\"[[:space:]]*:[[:space:]]*\"([^\"]+)\" ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
  elif [[ "$input" =~ \"toolName\"[[:space:]]*:[[:space:]]*\"([^\"]+)\" ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
  elif [[ "$input" =~ \"name\"[[:space:]]*:[[:space:]]*\"([^\"]+)\" ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
  fi
}

fallback_file_paths() {
  local input="$1"
  if [[ "$input" =~ \"file_path\"[[:space:]]*:[[:space:]]*\"([^\"]+)\" ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
  elif [[ "$input" =~ \"path\"[[:space:]]*:[[:space:]]*\"([^\"]+)\" ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
  fi
}

supported_tool() {
  local tool_name="${1,,}"
  [[ "$SUPPORTED_TOOLS" == *" $tool_name "* ]]
}

# Accept a shell event only when its command contains an actual apply_patch document.
payload_invokes_apply_patch() {
  local payload="$1"
  local patch_text
  patch_text="$(json_patch_texts "$payload")"
  [[ "$patch_text" == *"apply_patch"* && "$patch_text" == *"*** Begin Patch"* ]]
}

# Decide whether this completed tool can identify files the user just changed.
supported_payload_tool() {
  local tool_name="$1" payload="$2"
  # Normal edit/write tools already carry a supported provider name.
  if supported_tool "$tool_name"; then
    return 0
  fi
  payload_invokes_apply_patch "$payload"
}

repo_root() {
  git rev-parse --show-toplevel 2>/dev/null || pwd
}

# Normalize agent-provided paths to a repo-relative form for git diff and
# report matching, while preserving absolute paths only for filesystem reads.
relative_path() {
  local root="$1"
  local file_path="$2"
  local normalized="${file_path//\\//}"
  case "$normalized" in
    "$root"/*) normalized="${normalized#"$root"/}" ;;
    ./*) normalized="${normalized#./}" ;;
  esac
  printf '%s' "$normalized"
}

absolute_path() {
  local root="$1"
  local file_path="$2"
  case "$file_path" in
    /*) printf '%s' "$file_path" ;;
    *) printf '%s/%s' "$root" "$file_path" ;;
  esac
}

# Map an edited file to the nearest ancestor config a monorepo user selected for it.
analyzer_target_for_path() {
  local root="$1" rel_path="$2" binary="$3"
  local candidate_rel_dir target_root target_rel_path yaml_config yml_config
  candidate_rel_dir="${rel_path%/*}"
  # A root-level file has no directory segment before its name.
  if [[ "$candidate_rel_dir" == "$rel_path" ]]; then
    candidate_rel_dir="."
  fi
  while :; do
    # The root candidate uses the project directory itself, not a literal `/.` path in output.
    if [[ "$candidate_rel_dir" == "." ]]; then
      target_root="$root"
      target_rel_path="$rel_path"
    else
      target_root="$root/$candidate_rel_dir"
      target_rel_path="${rel_path#"$candidate_rel_dir"/}"
    fi
    yaml_config="$target_root/.${binary}.yaml"
    yml_config="$target_root/.${binary}.yml"
    # Two configs at the same target are ambiguous to users and must be resolved explicitly.
    if [[ -f "$yaml_config" && -f "$yml_config" ]]; then
      return 2
    fi
    # The nearest single config owns the edited file and its analyzer working directory.
    if [[ -f "$yaml_config" ]]; then
      printf '%s\t%s\t%s' "$target_root" "$target_rel_path" "$yaml_config"
      return 0
    fi
    # The alternate extension has the same target semantics.
    if [[ -f "$yml_config" ]]; then
      printf '%s\t%s\t%s' "$target_root" "$target_rel_path" "$yml_config"
      return 0
    fi
    # Reaching the repository root means no analyzer was configured for this file.
    if [[ "$candidate_rel_dir" == "." ]]; then
      return 1
    fi
    # Nested paths move one ancestor at a time; one-segment paths move to root.
    if [[ "$candidate_rel_dir" == */* ]]; then
      candidate_rel_dir="${candidate_rel_dir%/*}"
    else
      candidate_rel_dir="."
    fi
  done
}

variant_for_path() {
  local file_path="$1"
  case "${file_path##*.}" in
    ts|tsx|mts|cts|js|jsx|mjs|cjs) printf 'gruff-ts' ;;
    php) printf 'gruff-php' ;;
    go) printf 'gruff-go' ;;
    rs) printf 'gruff-rs' ;;
    py) printf 'gruff-py' ;;
    *) return 1 ;;
  esac
}

binary_env_name() {
  local binary="$1"
  local suffix="${binary#gruff-}"
  suffix="${suffix//-/_}"
  printf 'GRUFF_%s_BIN' "${suffix^^}"
}

timeout_env_name() {
  local binary="$1"
  local suffix="${binary#gruff-}"
  suffix="${suffix//-/_}"
  printf 'GRUFF_%s_TIMEOUT_SECONDS' "${suffix^^}"
}

supported_candidate_path() {
  local file_path="$1"
  local binary
  [[ -n "$file_path" ]] || return 1
  [[ "$file_path" =~ $SKIP_DIR_PATTERN ]] && return 1
  binary="$(variant_for_path "$file_path" || true)"
  [[ -n "$binary" ]]
}

# Run Git diff without project-configured programs transforming the user's source.
run_safe_git_diff() {
  local root="$1"
  shift
  GIT_EXTERNAL_DIFF='' GIT_CONFIG_NOSYSTEM=1 GIT_ATTR_NOSYSTEM=1 \
    git -C "$root" diff --no-ext-diff --no-textconv "$@"
}

# List dirty supported files only when every Git source completed successfully.
git_changed_supported_paths() {
  local root="$1"
  local rel_path unstaged_paths staged_paths untracked_paths combined_paths
  # A failed working-tree query cannot justify choosing files from partial output.
  if ! unstaged_paths="$(run_safe_git_diff "$root" --name-only --diff-filter=ACMR --)"; then
    printf 'gruff-code-quality: Git could not list working-tree changes\n' >&2
    return 1
  fi
  # Staged edits are separate user work and must be included without text converters.
  if ! staged_paths="$(run_safe_git_diff "$root" --cached --name-only --diff-filter=ACMR --)"; then
    printf 'gruff-code-quality: Git could not list staged changes\n' >&2
    return 1
  fi
  # Untracked source files have no diff hunk, so Git must identify them explicitly.
  if ! untracked_paths="$(GIT_CONFIG_NOSYSTEM=1 GIT_ATTR_NOSYSTEM=1 git -C "$root" ls-files --others --exclude-standard --)"; then
    printf 'gruff-code-quality: Git could not list untracked files\n' >&2
    return 1
  fi
  combined_paths="${unstaged_paths}${unstaged_paths:+$'\n'}${staged_paths}${staged_paths:+$'\n'}${untracked_paths}"
  printf '%s\n' "$combined_paths" | while IFS= read -r rel_path; do
    # Only supported source files can map to a Gruff analyzer.
    if supported_candidate_path "$rel_path"; then
      printf '%s\n' "$rel_path"
    fi
  done | awk 'length($0) && !seen[$0]++'
}

payload_file_paths() {
  local payload="$1"
  local paths patch_paths
  paths="$(json_file_paths "$payload" || true)"
  patch_paths="$(patch_file_paths "$payload" || true)"
  # Patch markers are the trustworthy targets when a provider omits file_path.
  if [[ -n "$patch_paths" ]]; then
    paths="${paths}${paths:+$'\n'}${patch_paths}"
  fi
  # A restricted host may lack jq, so retain the small direct-path fallback.
  [[ -n "$paths" ]] || paths="$(fallback_file_paths "$payload")"
  # Empty path sets mean the completed tool did not identify analyzable user content.
  if [[ -n "$paths" ]]; then
    printf '%s\n' "$paths" | awk 'length($0) && !seen[$0]++'
  fi
}

payload_supported_file_paths() {
  local root="$1"
  local payload="$2"
  local file_path rel_path normalized_root
  normalized_root="${root//\\//}"
  payload_file_paths "$payload" | while IFS= read -r file_path; do
    # Blank provider fields cannot name a file the user edited.
    [[ -n "$file_path" ]] || continue
    file_path="${file_path//\\//}"
    case "$file_path" in
      "$normalized_root"/*) rel_path="${file_path#"$normalized_root"/}" ;;
      # Windows drive-letter paths that missed the root match above are outside
      # this repo, same as the rooted-path case below.
      [A-Za-z]:/*) continue ;;
      /*) continue ;;
      *) rel_path="$(relative_path "$normalized_root" "$file_path")" ;;
    esac
    case "$rel_path" in
      ""|.|..|../*|*/../*) continue ;;
    esac
    supported_candidate_path "$rel_path" || continue
    printf '%s\n' "$rel_path"
  done | awk '!seen[$0]++'
}

# Read the repo-owned analyzer override for one binary from
# `.goat-flow/config.yaml` (`hooks.gruff-code-quality.binaries.<lang>`). Prints
# the raw configured value, or nothing when the config or key is absent. The
# awk pass tracks indentation depth rather than fixed columns so hand-edited
# indent widths and CRLF files parse; anything that does not match the expected
# key path fails soft to "not configured".
config_binary_override() {
  local root="$1"
  local binary="$2"
  local lang="${binary#gruff-}"
  local config_file="$root/.goat-flow/config.yaml"
  local value
  [[ -f "$config_file" ]] || return 0
  value="$(awk -v lang="$lang" '
    function trim_value(s) {
      sub(/^[[:space:]]+/, "", s)
      sub(/[[:space:]]+#.*$/, "", s)
      sub(/[[:space:]]+$/, "", s)
      return s
    }
    function inline_map_value(rest, map_body, pattern, value) {
      rest = trim_value(rest)
      # Users may paste the documented one-line form: binaries: { py: path }.
      if (rest !~ /^\{.*\}$/) return ""
      map_body = rest
      sub(/^\{[[:space:]]*/, "", map_body)
      sub(/[[:space:]]*\}$/, "", map_body)
      pattern = "(^|,)[[:space:]]*" lang "[[:space:]]*:[[:space:]]*"
      # A different language in the inline map belongs to another analyzer.
      if (!match(map_body, pattern)) return ""
      value = substr(map_body, RSTART + RLENGTH)
      sub(/[[:space:]]*,[[:space:]]*[A-Za-z0-9_-]+[[:space:]]*:.*$/, "", value)
      return trim_value(value)
    }
    BEGIN {
      want[1] = "hooks"
      want[2] = "gruff-code-quality"
      want[3] = "binaries"
      want[4] = lang
      depth = 0
    }
    {
      sub(/\r$/, "")
      trimmed = $0
      sub(/^ */, "", trimmed)
      # Blank/comment lines do not change the hook settings the user sees.
      if (trimmed == "" || trimmed ~ /^#/) next
      ind = length($0) - length(trimmed)
      # Moving back up the YAML tree means the previous nested key is done.
      while (depth > 0 && ind <= lvl[depth]) depth--
      # Nested content without a matching parent is outside the hook block.
      if (depth == 0 && ind != 0) next
      # Only plain key/value rows participate in this tiny config reader.
      if (trimmed !~ /^[A-Za-z0-9_-]+:( |$)/) next
      key = trimmed
      sub(/:.*$/, "", key)
      # Skip sibling keys until the requested hooks/gruff/binaries path resumes.
      if (key != want[depth + 1]) next
      depth++
      lvl[depth] = ind
      # Inline binaries maps keep the override visible in compact config files.
      if (depth == 3) {
        rest = trimmed
        sub(/^[A-Za-z0-9_-]+:[ ]*/, "", rest)
        inline_value = inline_map_value(rest)
        # A matching inline value lets the edited file run the configured tool.
        if (inline_value != "") {
          print inline_value
          exit
        }
      }
      # Block-style language rows name the exact analyzer the hook should run.
      if (depth == 4) {
        rest = trimmed
        sub(/^[A-Za-z0-9_-]+:[ ]*/, "", rest)
        print trim_value(rest)
        exit
      }
    }
  ' "$config_file" 2>/dev/null || true)"
  # YAML comments are for humans; strip them before quote cleanup.
  value="${value%% \#*}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  # Double-quoted values should resolve to the path the user typed.
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value#\"}"
    value="${value%\"}"
  # Single-quoted values get the same user-facing path cleanup.
  elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value#\'}"
    value="${value%\'}"
  else
    value="${value%"${value##*[![:space:]]}"}"
  fi
  [[ -n "$value" ]] && printf '%s' "$value"
  return 0
}

# Resolve a repo-owned config override to an absolute path, or print nothing
# when the value is not acceptable. Only repo-relative values that stay inside
# the repo are accepted: machine-specific absolute, home, or drive-letter paths
# belong in the GRUFF_<LANG>_BIN env override, and rejecting `.`/`..` segments
# keeps the named executable inside the reviewed repo (the ADR-032 property:
# configuration names the exact executable, discovery never leaves the repo).
resolve_config_binary() {
  local root="$1"
  local value="${2//\\//}"
  value="${value#./}"
  case "$value" in
    ''|/*|~*|[A-Za-z]:*) return 0 ;;
  esac
  case "/$value/" in
    */../*|*/./*) return 0 ;;
  esac
  printf '%s/%s' "$root" "$value"
}

# Discovery covers each ecosystem's standard install location - package-manager
# bin dirs (vendor/bin for composer, node_modules/.bin for npm), an in-repo bin/,
# the root virtualenv (.venv/bin), user-local installs (~/.local/bin), and finally
# PATH. It deliberately excludes a `*/.venv/bin` subdirectory glob and the
# `target/debug` build-output dir: auto-executing a name-matched binary from an
# arbitrary subtree or build artifact on every edit is RCE-shaped for little gain.
# A per-language `GRUFF_<LANG>_BIN` env override or a repo-owned
# `hooks.gruff-code-quality.binaries.<lang>` config entry is explicit opt-in and
# therefore safe for monorepos with a deliberately managed analyzer in a
# non-standard location. Env wins over config; an override that is set but
# invalid resolves to nothing rather than falling back to discovery, so a wrong
# override fails loudly in the caller's diagnostic instead of silently running
# a different binary.
discover_binary() {
  local root="$1"
  local binary="$2"
  local target_root="${3:-$root}"
  local candidate env_name override config_override resolved
  env_name="$(binary_env_name "$binary")"
  override="${!env_name:-}"
  if [[ -n "$override" ]]; then
    if [[ -x "$override" ]]; then
      printf '%s' "$override"
    fi
    return 0
  fi
  config_override="$(config_binary_override "$root" "$binary")"
  if [[ -n "$config_override" ]]; then
    resolved="$(resolve_config_binary "$root" "$config_override")"
    if [[ -n "$resolved" && -f "$resolved" && -x "$resolved" ]]; then
      printf '%s' "$resolved"
    fi
    return 0
  fi
  for candidate in \
    "$target_root/vendor/bin/$binary" \
    "$target_root/node_modules/.bin/$binary" \
    "$target_root/bin/$binary" \
    "$target_root/.venv/bin/$binary" \
    "$root/vendor/bin/$binary" \
    "$root/node_modules/.bin/$binary" \
    "$root/bin/$binary" \
    "$root/.venv/bin/$binary" \
    "${HOME:-}/.local/bin/$binary"
  do
    # Package-local candidates precede repo-root and user PATH choices for this edited file.
    if [[ -n "$candidate" && -x "$candidate" ]]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  command -v "$binary" 2>/dev/null || true
}

# Range derivation returns comma-separated inclusive ranges such as
# `3-3,8-10`. The hook filters findings against the analyzer's primary
# reported line; function-block expansion is deliberately not attempted here.
line_count() {
  local path="$1"
  awk 'END { print NR }' "$path" 2>/dev/null || printf '0'
}

all_file_range() {
  local path="$1"
  local total
  total="$(line_count "$path")"
  if [[ "$total" =~ ^[0-9]+$ && "$total" -gt 0 ]]; then
    printf '1-%s' "$total"
  fi
}

payload_ranges() {
  local payload="$1"
  if ! command -v jq >/dev/null 2>&1; then
    return 1
  fi
  printf '%s' "$payload" | jq -r '
    def ranges_from(value):
      if value == null then
        []
      elif (value | type) == "object" then
        (value.changed_ranges? // value.changedRanges? // [])
      elif (value | type) == "string" then
        ((value | fromjson? // {})
        | if type == "object" then
            (.changed_ranges? // .changedRanges? // [])
          else
            []
          end)
      else
        []
      end;
    def range_text:
      if ((.startLine // .start // .line) != null) then
        ((.startLine // .start // .line) | tonumber) as $rangeStart
        | ((.endLine // .end // .line // $rangeStart) | tonumber) as $rangeEnd
        | select($rangeStart > 0 and $rangeEnd >= $rangeStart)
        | "\($rangeStart)-\($rangeEnd)"
      else
        empty
      end;

    [
      (ranges_from(.tool_input)[]? | range_text),
      (ranges_from(.toolCall.args)[]? | range_text),
      (ranges_from(.toolArgs)[]? | range_text),
      (ranges_from(.tool_args)[]? | range_text)
    ] | join(",")
  ' 2>/dev/null || true
}

parse_diff_ranges() {
  local diff_output="$1"
  local line ranges start count end saw_hunk
  local hunk_re='^@@ -[0-9]+(,[0-9]+)? \+([0-9]+)(,([0-9]+))? @@'
  ranges=""
  saw_hunk=0
  while IFS= read -r line; do
    # Each hunk describes the new-file lines attributable to the completed edit.
    if [[ "$line" =~ $hunk_re ]]; then
      saw_hunk=1
      start="${BASH_REMATCH[2]}"
      count="${BASH_REMATCH[4]}"
      # A missing count means Git's compact one-line hunk form.
      [[ -n "$count" ]] || count=1
      # Zero added lines is a deletion-only hunk with no remaining code to analyze.
      [[ "$count" -eq 0 ]] && continue
      end=$((start + count - 1))
      ranges="${ranges}${ranges:+,}${start}-${end}"
    fi
  done <<< "$diff_output"
  # Positive ranges let Gruff attribute findings to remaining source.
  if [[ -n "$ranges" ]]; then
    printf '%s' "$ranges"
    return 0
  fi
  # A hunk with no added lines is a completed not-applicable deletion analysis.
  if [[ "$saw_hunk" -eq 1 ]]; then
    return 10
  fi
  return 11
}

# Read the apply_patch operation for one repo-relative path.
patch_operation_for_path() {
  local payload="$1" rel_path="$2"
  json_patch_texts "$payload" | awk -v wanted="$rel_path" '
    /^\*\*\* (Add|Update|Delete) File: / {
      operation = $2
      path = $0
      sub(/^\*\*\* (Add|Update|Delete) File: /, "", path)
      if (path == wanted) {
        print tolower(operation)
        exit
      }
    }
  '
}

# Read numbered new-file hunks for one apply_patch target; empty means Git must derive them.
patch_ranges_for_path() {
  local payload="$1" rel_path="$2"
  json_patch_texts "$payload" | awk -v wanted="$rel_path" '
    /^\*\*\* (Add|Update|Delete) File: / {
      path = $0
      sub(/^\*\*\* (Add|Update|Delete) File: /, "", path)
      active = (path == wanted)
      next
    }
    active && /^@@ -[0-9]+(,[0-9]+)? \+[0-9]+(,[0-9]+)? @@/ {
      plus = $0
      sub(/^.* \+/, "", plus)
      sub(/ .*/, "", plus)
      split(plus, fields, ",")
      start = fields[1] + 0
      count = (fields[2] == "" ? 1 : fields[2] + 0)
      if (count > 0) {
        end = start + count - 1
        ranges = ranges (ranges == "" ? "" : ",") start "-" end
      }
    }
    END { print ranges }
  '
}

# Return the former path when Git identifies this edited path as a rename destination.
# Use before hunk parsing so a rename plus edits compares both names instead of treating
# the destination as a wholly new file; empty means the file was not renamed.
rename_source_for_path() {
  local name_status_output="$1" rel_path="$2"
  printf '%s\n' "$name_status_output" | awk -F '\t' -v wanted="$rel_path" '
    $1 ~ /^R[0-9]+$/ && $3 == wanted {
      print $2
      exit
    }
  '
}

git_diff_ranges() {
  local root="$1"
  local rel_path="$2"
  local abs_path="$3"
  local allow_cached_fallback="${4:-1}"
  local diff_output tracked_path ranges range_status head_status
  local name_status_output rename_source_path
  # A listing error means Git cannot establish whether this is a new user file.
  if ! tracked_path="$(GIT_CONFIG_NOSYSTEM=1 git -C "$root" ls-files -- "$rel_path")"; then
    return 12
  fi
  # New files are wholly attributable because Git has no earlier line map.
  if [[ -z "$tracked_path" ]]; then
    # A missing new file has no remaining content to analyze.
    if [[ -f "$abs_path" ]]; then
      all_file_range "$abs_path"
      return 0
    fi
    return 10
  fi
  set +e
  GIT_CONFIG_NOSYSTEM=1 git -C "$root" rev-parse --verify --quiet HEAD >/dev/null 2>&1
  head_status=$?
  set -e
  # A normal repository compares the user's current file against HEAD.
  if [[ "$head_status" -eq 0 ]]; then
    # Rename discovery needs the full change set because a destination-only pathspec hides its source.
    if ! name_status_output="$(run_safe_git_diff "$root" --name-status --find-renames HEAD --)"; then
      return 12
    fi
    rename_source_path="$(rename_source_for_path "$name_status_output" "$rel_path")"
    # A renamed file compares both names so only real content edits become attributable ranges.
    if [[ -n "$rename_source_path" ]]; then
      if ! diff_output="$(run_safe_git_diff "$root" HEAD --unified=0 -- "$rename_source_path" "$rel_path")"; then
        return 12
      fi
    # A normal edit needs only its declared project-relative path.
    elif ! diff_output="$(run_safe_git_diff "$root" HEAD --unified=0 -- "$rel_path")"; then
      return 12
    fi
  # An unborn branch has no HEAD, so working-tree and staged content are queried separately.
  elif [[ "$head_status" -eq 1 ]]; then
    if ! diff_output="$(run_safe_git_diff "$root" --unified=0 -- "$rel_path")"; then
      return 12
    fi
    # An empty working-tree diff may still have the user's first staged version.
    if [[ -z "$diff_output" && "$allow_cached_fallback" -eq 1 ]]; then
      if ! diff_output="$(run_safe_git_diff "$root" --cached --unified=0 -- "$rel_path")"; then
        return 12
      fi
    fi
  else
    return 12
  fi
  set +e
  ranges="$(parse_diff_ranges "$diff_output")"
  range_status=$?
  set -e
  # A normal hunk returns its attributable new-file ranges.
  if [[ "$range_status" -eq 0 ]]; then
    printf '%s' "$ranges"
    return 0
  fi
  # Non-empty rename, binary, or deletion output is explicitly not applicable.
  if [[ -n "$diff_output" ]]; then
    return 10
  fi
  return 11
}

changed_ranges() {
  local payload="$1"
  local root="$2"
  local rel_path="$3"
  local abs_path="$4"
  local file_count="${5:-1}"
  local allow_cached_fallback="${6:-1}"
  local ranges patch_operation
  patch_operation="$(patch_operation_for_path "$payload" "$rel_path")"
  # A deleted file has no remaining source for an after-edit analyzer.
  if [[ "$patch_operation" == "delete" ]]; then
    return 10
  fi
  # New patch files are wholly attributable, including edits without numbered hunks.
  if [[ "$patch_operation" == "add" ]]; then
    ranges="$(all_file_range "$abs_path")"
    # An empty added file is valid but has no analyzable lines.
    if [[ -z "$ranges" ]]; then
      return 10
    fi
    printf '%s' "$ranges"
    return 0
  fi
  # Numbered update hunks can identify scope before the working tree is otherwise inspected.
  if [[ "$patch_operation" == "update" ]]; then
    ranges="$(patch_ranges_for_path "$payload" "$rel_path")"
    if [[ -n "$ranges" ]]; then
      printf '%s' "$ranges"
      return 0
    fi
  fi
  # Payload changed_ranges is a single flat list with no per-file attribution.
  # Trust it only for single-file edits; multi-file payloads derive per-file
  # ranges from git so one file's ranges are not applied to every file.
  if [[ "$file_count" -le 1 ]]; then
    ranges="$(payload_ranges "$payload")"
    # Provider ranges are used only when they belong to this single edited file.
    if [[ -n "$ranges" ]]; then
      printf '%s' "$ranges"
      return 0
    fi
  fi
  git_diff_ranges "$root" "$rel_path" "$abs_path" "$allow_cached_fallback"
}

self_test() {
  local payload paths ranges variant report_output report_json first_line
  local help_full help_missing counts
  local tmp output override_path config_error
  local sample_payload discovered config_path winner
  if ! command -v jq >/dev/null 2>&1; then
    printf 'gruff-code-quality self-test: jq unavailable\n' >&2
    return 1
  fi

  payload='{"tool_name":"multi_replace_file_content","tool_input":{"edits":[{"file_path":"src/a.mts"},{"path":"src/b.php"}],"changed_ranges":[{"startLine":2,"endLine":4}]}}'
  paths="$(json_file_paths "$payload")"
  [[ "$paths" == *"src/a.mts"* && "$paths" == *"src/b.php"* ]] || {
    printf 'gruff-code-quality self-test: path extraction failed: %s\n' "$paths" >&2
    return 1
  }
  ranges="$(payload_ranges "$payload")"
  [[ "$ranges" == "2-4" ]] || {
    printf 'gruff-code-quality self-test: range extraction failed: %s\n' "$ranges" >&2
    return 1
  }
  variant="$(variant_for_path "src/a.mts")"
  [[ "$variant" == "gruff-ts" ]] || {
    printf 'gruff-code-quality self-test: variant mapping failed: %s\n' "$variant" >&2
    return 1
  }

  # A payload carrying both a top-level file_path and an edits array should
  # return only the target file path, not any synthetic path from the array.
  payload='{"tool_name":"Edit","tool_input":{"file_path":"src/x.rs","edits":[{"old_string":"a","new_string":"b"}]}}'
  paths="$(json_file_paths "$payload")"
  [[ "$paths" == "src/x.rs" ]] || {
    printf 'gruff-code-quality self-test: single-file edit path failed: %s\n' "$paths" >&2
    return 1
  }

  # A single edited file trusts payload changed_ranges; several edited files
  # must not share one range set, so changed_ranges falls back to per-file git
  # ranges (empty under this bogus root).
  payload='{"tool_name":"multi_replace_file_content","tool_input":{"edits":[{"file_path":"src/a.mts"},{"path":"src/b.php"}],"changed_ranges":[{"startLine":2,"endLine":4}]}}'
  [[ "$(changed_ranges "$payload" "/nonexistent" "src/a.mts" "/nonexistent/src/a.mts" 1)" == "2-4" ]] || {
    printf 'gruff-code-quality self-test: single-file payload range failed\n' >&2
    return 1
  }
  [[ -z "$(changed_ranges "$payload" "/nonexistent" "src/a.mts" "/nonexistent/src/a.mts" 2 2>/dev/null)" ]] || {
    printf 'gruff-code-quality self-test: multi-file payload range sharing not suppressed\n' >&2
    return 1
  }

  help_full='usage: gruff analyse --format json --changed-ranges 1-2 --changed-scope symbol --no-baseline'
  help_missing='usage: gruff analyse --format json --changed-ranges 1-2 --no-baseline'
  supports_native_changed_regions "$help_full" || {
    printf 'gruff-code-quality self-test: native capability probe failed\n' >&2
    return 1
  }
  ! supports_native_changed_regions "$help_missing" || {
    printf 'gruff-code-quality self-test: incomplete native capability probe passed\n' >&2
    return 1
  }

  [[ "$(GRUFF_CODE_QUALITY_TIMEOUT_SECONDS=bogus normalized_timeout_seconds gruff-ts)" == "60" \
     && "$(GRUFF_CODE_QUALITY_TIMEOUT_SECONDS=0 normalized_timeout_seconds gruff-ts)" == "60" \
     && "$(GRUFF_CODE_QUALITY_TIMEOUT_SECONDS='' normalized_timeout_seconds gruff-ts)" == "60" \
     && "$(GRUFF_CODE_QUALITY_TIMEOUT_SECONDS=45 normalized_timeout_seconds gruff-ts)" == "45" \
     && "$(GRUFF_CODE_QUALITY_TIMEOUT_SECONDS=45 GRUFF_PHP_TIMEOUT_SECONDS=75 normalized_timeout_seconds gruff-php)" == "75" ]] || {
    printf 'gruff-code-quality self-test: timeout normalization failed\n' >&2
    return 1
  }

  tmp="$(mktemp -d)"
  mkdir -p "$tmp/src" "$tmp/empty-bin" "$tmp/env-bin" "$tmp/strands_agents/.venv/bin" "$tmp/.goat-flow"
  sample_payload='{"tool_name":"Edit","tool_input":{"file_path":"src/sample.py","changed_ranges":[{"startLine":1,"endLine":1}]}}'
  printf 'rules: {}\n' > "$tmp/.gruff-py.yaml"
  printf 'print("x")\n' > "$tmp/src/sample.py"
  output="$(PATH="$tmp/empty-bin" process_file "$sample_payload" "$tmp" "src/sample.py" 1 1 2>&1)"
  [[ "$output" == *".gruff-py.yaml present but gruff-py not found on search paths"* && "$output" == *"hooks.gruff-code-quality.binaries.py"* && "$output" == *"GRUFF_PY_BIN"* ]] || {
    rm -rf "$tmp"
    printf 'gruff-code-quality self-test: binary-missing diagnostic failed: %s\n' "$output" >&2
    return 1
  }
  printf '#!/usr/bin/env bash\nexit 0\n' > "$tmp/strands_agents/.venv/bin/gruff-py"
  chmod +x "$tmp/strands_agents/.venv/bin/gruff-py"
  # The nested venv binary now exists but no override names it - discovery must
  # still skip it (ADR-032: no arbitrary-subtree auto-discovery).
  discovered="$(PATH="$tmp/empty-bin" discover_binary "$tmp" gruff-py)"
  [[ -z "$discovered" ]] || {
    rm -rf "$tmp"
    printf 'gruff-code-quality self-test: nested venv must not be auto-discovered: %s\n' "$discovered" >&2
    return 1
  }
  override_path="$(PATH="$tmp/empty-bin" GRUFF_PY_BIN="$tmp/strands_agents/.venv/bin/gruff-py" discover_binary "$tmp" gruff-py)"
  [[ "$override_path" == "$tmp/strands_agents/.venv/bin/gruff-py" ]] || {
    rm -rf "$tmp"
    printf 'gruff-code-quality self-test: env binary override failed: %s\n' "$override_path" >&2
    return 1
  }
  output="$(PATH="$tmp/empty-bin" GRUFF_PY_BIN="$tmp/missing-gruff-py" process_file "$sample_payload" "$tmp" "src/sample.py" 1 1 2>&1)"
  [[ "$output" == *"GRUFF_PY_BIN is set but is not executable: $tmp/missing-gruff-py"* ]] || {
    rm -rf "$tmp"
    printf 'gruff-code-quality self-test: invalid env override diagnostic failed: %s\n' "$output" >&2
    return 1
  }
  # Repo-owned config override: quoted value plus CRLF line endings must both
  # parse, and the resolved path must be the configured nested-venv binary.
  # These config-driven calls keep the real PATH appended because the parser
  # needs awk; they never reach the PATH binary search - a present config
  # override returns from discovery before the standard-location loop.
  printf 'hooks:\r\n  gruff-code-quality:\r\n    enabled: true\r\n    binaries:\r\n      py: "strands_agents/.venv/bin/gruff-py"\r\n' > "$tmp/.goat-flow/config.yaml"
  config_path="$(PATH="$tmp/empty-bin:$PATH" discover_binary "$tmp" gruff-py)"
  [[ "$config_path" == "$tmp/strands_agents/.venv/bin/gruff-py" ]] || {
    rm -rf "$tmp"
    printf 'gruff-code-quality self-test: config binary override failed: %s\n' "$config_path" >&2
    return 1
  }
  printf 'hooks:\n  gruff-code-quality:\n    enabled: true\n    binaries: { py: strands_agents/.venv/bin/gruff-py }\n' > "$tmp/.goat-flow/config.yaml"
  inline_config_path="$(PATH="$tmp/empty-bin:$PATH" discover_binary "$tmp" gruff-py)"
  # The compact dashboard-friendly YAML form must run the same analyzer.
  [[ "$inline_config_path" == "$tmp/strands_agents/.venv/bin/gruff-py" ]] || {
    rm -rf "$tmp"
    printf 'gruff-code-quality self-test: inline config binary override failed: %s\n' "$inline_config_path" >&2
    return 1
  }
  printf 'hooks:\n  gruff-code-quality:\n    enabled: true\n    binaries:\n      py: "strands_agents/.venv/bin/gruff-py" # analyzer\n' > "$tmp/.goat-flow/config.yaml"
  commented_config_path="$(PATH="$tmp/empty-bin:$PATH" discover_binary "$tmp" gruff-py)"
  # Inline comments should stay readable without becoming part of the path.
  [[ "$commented_config_path" == "$tmp/strands_agents/.venv/bin/gruff-py" ]] || {
    rm -rf "$tmp"
    printf 'gruff-code-quality self-test: commented config binary override failed: %s\n' "$commented_config_path" >&2
    return 1
  }
  printf '#!/usr/bin/env bash\nexit 0\n' > "$tmp/env-bin/gruff-py"
  chmod +x "$tmp/env-bin/gruff-py"
  winner="$(PATH="$tmp/empty-bin" GRUFF_PY_BIN="$tmp/env-bin/gruff-py" discover_binary "$tmp" gruff-py)"
  [[ "$winner" == "$tmp/env-bin/gruff-py" ]] || {
    rm -rf "$tmp"
    printf 'gruff-code-quality self-test: env override must beat config override: %s\n' "$winner" >&2
    return 1
  }
  chmod -x "$tmp/strands_agents/.venv/bin/gruff-py"
  output="$(PATH="$tmp/empty-bin:$PATH" process_file "$sample_payload" "$tmp" "src/sample.py" 1 1 2>&1)"
  [[ "$output" == *"hooks.gruff-code-quality.binaries.py points at strands_agents/.venv/bin/gruff-py which is not an executable file"* ]] || {
    rm -rf "$tmp"
    printf 'gruff-code-quality self-test: non-executable config override diagnostic failed: %s\n' "$output" >&2
    return 1
  }
  chmod +x "$tmp/strands_agents/.venv/bin/gruff-py"
  printf 'hooks:\n  gruff-code-quality:\n    binaries:\n      py: missing/gruff-py\n' > "$tmp/.goat-flow/config.yaml"
  output="$(PATH="$tmp/empty-bin:$PATH" process_file "$sample_payload" "$tmp" "src/sample.py" 1 1 2>&1)"
  [[ "$output" == *"hooks.gruff-code-quality.binaries.py points at missing/gruff-py which does not exist"* ]] || {
    rm -rf "$tmp"
    printf 'gruff-code-quality self-test: missing config override diagnostic failed: %s\n' "$output" >&2
    return 1
  }
  printf 'hooks:\n  gruff-code-quality:\n    binaries:\n      py: /usr/bin/env\n' > "$tmp/.goat-flow/config.yaml"
  output="$(PATH="$tmp/empty-bin:$PATH" process_file "$sample_payload" "$tmp" "src/sample.py" 1 1 2>&1)"
  [[ "$output" == *"hooks.gruff-code-quality.binaries.py must be a repo-relative path inside the repo, got /usr/bin/env"* ]] || {
    rm -rf "$tmp"
    printf 'gruff-code-quality self-test: absolute config override must be rejected: %s\n' "$output" >&2
    return 1
  }
  printf 'hooks:\n  gruff-code-quality:\n    binaries:\n      py: ../outside/gruff-py\n' > "$tmp/.goat-flow/config.yaml"
  output="$(PATH="$tmp/empty-bin:$PATH" process_file "$sample_payload" "$tmp" "src/sample.py" 1 1 2>&1)"
  [[ "$output" == *"hooks.gruff-code-quality.binaries.py must be a repo-relative path inside the repo, got ../outside/gruff-py"* ]] || {
    rm -rf "$tmp"
    printf 'gruff-code-quality self-test: escaping config override must be rejected: %s\n' "$output" >&2
    return 1
  }
  rm -rf "$tmp"

  report_output='{"findings":[],"diagnostics":[{"type":"config-error","message":"Unknown threshold size.file-length"}],"filesDiscovered":0}'
  config_error="$(config_error_message "$report_output")"
  [[ "$config_error" == "Unknown threshold size.file-length" ]] || {
    printf 'gruff-code-quality self-test: JSON config-error surfacing failed: %s\n' "$config_error" >&2
    return 1
  }

  # An ignored file that also carries a generic diagnostic must NOT be reported
  # as a config error - the caller renders it as "skipped - ignored" instead.
  report_output='{"findings":[],"diagnostics":[{"type":"info","message":"path ignored by config"}],"filesDiscovered":0,"ignored":{"paths":[{"path":"x.css"}]}}'
  config_error="$(config_error_message "$report_output")"
  [[ -z "$config_error" ]] || {
    printf 'gruff-code-quality self-test: ignored-file diagnostic must not be a config error: %s\n' "$config_error" >&2
    return 1
  }

  # With no ignore signal, a zero-files generic diagnostic still surfaces so a
  # port reporting config trouble as an untyped diagnostic is not swallowed.
  report_output='{"findings":[],"diagnostics":[{"type":"runtime","message":"analyzer produced no files"}],"filesDiscovered":0}'
  config_error="$(config_error_message "$report_output")"
  [[ "$config_error" == "analyzer produced no files" ]] || {
    printf 'gruff-code-quality self-test: zero-files diagnostic without ignore should surface: %s\n' "$config_error" >&2
    return 1
  }

  [[ "$(min_severity_rank warning)" == "2" && "$(min_severity_rank error)" == "3" && "$(min_severity_rank bogus)" == "1" ]] || {
    printf 'gruff-code-quality self-test: min_severity_rank mapping failed\n' >&2
    return 1
  }

  report_output='{"findings":[{"severity":"advisory","line":2,"file":"x.ts","ruleId":"a.one","message":"m1"},{"severity":"error","line":3,"file":"x.ts","ruleId":"z.two","message":"m2"},{"severity":"warning","line":4,"file":"x.ts","ruleId":"m.three","message":"m3"}]}'
  report_json="$(changed_findings_report "$report_output" "x.ts" "/tmp/x.ts" "2-4" 1 2)"
  first_line="$(printf '%s' "$report_json" | jq -r '.lines[0]')"
  [[ "$first_line" == "- [error] x.ts:3 z.two - m2" ]] || {
    printf 'gruff-code-quality self-test: severity sort failed: %s\n' "$first_line" >&2
    return 1
  }
  [[ "$(printf '%s' "$report_json" | jq -r '.total')" == "3" && "$(printf '%s' "$report_json" | jq -r '.more')" == "1" ]] || {
    printf 'gruff-code-quality self-test: volume cap failed\n' >&2
    return 1
  }
  report_json="$(changed_findings_report "$report_output" "x.ts" "/tmp/x.ts" "2-4" 2 20 0)"
  [[ "$(printf '%s' "$report_json" | jq -r '.surfaced')" == "2" && "$(printf '%s' "$report_json" | jq -r '.floored')" == "1" ]] || {
    printf 'gruff-code-quality self-test: severity floor failed\n' >&2
    return 1
  }
  report_output='{"findings":[{"severity":"ERROR","line":3,"file":"x.ts","ruleId":"upper.error","message":"m"}]}'
  report_json="$(changed_findings_report "$report_output" "x.ts" "/tmp/x.ts" "2-4" 3 20 0)"
  [[ "$(printf '%s' "$report_json" | jq -r '.surfaced')" == "1" && "$(printf '%s' "$report_json" | jq -r '.e')" == "1" ]] || {
    printf 'gruff-code-quality self-test: uppercase severity normalization failed\n' >&2
    return 1
  }
  report_output='{"findings":[{"line":2,"file":"x.ts","ruleId":"missing.severity","message":"m"},{"severity":"error","line":3,"file":"x.ts","ruleId":"error.severity","message":"m"}]}'
  report_json="$(changed_findings_report "$report_output" "x.ts" "/tmp/x.ts" "2-4" 1 20 0)"
  counts="$(printf '%s' "$report_json" | jq -r '[.total, (.e + .w + .a)] | @tsv')"
  [[ "$counts" == $'2\t2' ]] || {
    printf 'gruff-code-quality self-test: severity counts do not sum to total: %s\n' "$counts" >&2
    return 1
  }

  # Native mode (analyzer owns scoping) surfaces a finding outside the literal
  # changed range; the portable fallback filters that same finding out.
  report_output='{"findings":[{"severity":"warning","line":99,"file":"x.ts","ruleId":"r.one","message":"m"}]}'
  report_json="$(changed_findings_report "$report_output" "x.ts" "/tmp/x.ts" "2-4" 1 20 1)"
  [[ "$(printf '%s' "$report_json" | jq -r '.total')" == "1" ]] || {
    printf 'gruff-code-quality self-test: native scope bypass failed\n' >&2
    return 1
  }
  report_json="$(changed_findings_report "$report_output" "x.ts" "/tmp/x.ts" "2-4" 1 20 0)"
  [[ "$(printf '%s' "$report_json" | jq -r '.total')" == "0" ]] || {
    printf 'gruff-code-quality self-test: fallback range filter failed\n' >&2
    return 1
  }

  # Contract render: hook_v1_report surfaces every finding the analyzer returned
  # (it already scoped them), nulls the line for file/project scope, and
  # severity-sorts.
  report_output='{"findings":[{"severity":"warning","scope":"file","line":1,"file":"x.ts","ruleId":"size.file-length","message":"too long","remediation":"split"},{"severity":"advisory","scope":"line","line":12,"file":"x.ts","ruleId":"naming.x","message":"rename"}]}'
  report_json="$(hook_v1_report "$report_output" 1 20)"
  [[ "$(printf '%s' "$report_json" | jq -r '[.total,.surfaced] | @tsv')" == $'2\t2' ]] || {
    printf 'gruff-code-quality self-test: hook_v1_report counts failed\n' >&2
    return 1
  }
  [[ "$(printf '%s' "$report_json" | jq -r '.lines[0]')" == "- [warning] x.ts size.file-length - too long" ]] || {
    printf 'gruff-code-quality self-test: hook_v1 file-scope line suppression failed\n' >&2
    return 1
  }
  [[ "$(printf '%s' "$report_json" | jq -r '.lines[1]')" == "- [advisory] x.ts:12 naming.x - rename" ]] || {
    printf 'gruff-code-quality self-test: hook_v1 line-scope rendering failed\n' >&2
    return 1
  }

  # Finding location falls back file -> filePath -> path, so a port that reports
  # the path under `path` (not `file`) still renders its findings.
  report_output='{"findings":[{"severity":"warning","scope":"line","line":7,"path":"y.ts","ruleId":"r.path","message":"via path key"}]}'
  report_json="$(hook_v1_report "$report_output" 1 20)"
  [[ "$(printf '%s' "$report_json" | jq -r '.lines[0]')" == "- [warning] y.ts:7 r.path - via path key" ]] || {
    printf 'gruff-code-quality self-test: hook_v1 .path finding-key fallback failed\n' >&2
    return 1
  }

  printf 'gruff-code-quality self-test: ok\n'
}

# An analyzer "owns" changed-region filtering when it can scope the scan itself.
# When its help advertises the symbol-aware trio (`--changed-ranges`,
# `--changed-scope`, `--no-baseline`), the hook delegates scoping to the
# analyzer instead of filtering by primary line.
supports_native_changed_regions() {
  local help="$1"
  [[ "$help" == *"--changed-ranges"* ]] || return 1
  [[ "$help" == *"--changed-scope"* ]] || return 1
  [[ "$help" == *"--no-baseline"* ]] || return 1
}

# Analyzer invocation adapts to the two flag families currently used by the
# gruff CLIs: long GNU-style flags (`--format json`) and Go-style single-dash
# flags (`-format json`). When the binary owns changed-region scoping the hook
# passes `--no-baseline --changed-ranges <ranges> --changed-scope symbol`.
# Findings never cause a non-zero hook exit.
analyse_help() {
  local binary_path="$1"
  "$binary_path" analyse --help 2>&1 || true
}

supports_json_format() {
  local help="$1"
  [[ "$help" == *"--format"* || "$help" == *"-format"* ]]
}

normalized_timeout_seconds() {
  local binary="${1:-}"
  local timeout_seconds="" env_name
  if [[ -n "$binary" ]]; then
    env_name="$(timeout_env_name "$binary")"
    timeout_seconds="${!env_name:-}"
  fi
  [[ -n "$timeout_seconds" ]] || timeout_seconds="${GRUFF_CODE_QUALITY_TIMEOUT_SECONDS:-}"
  if ! [[ "$timeout_seconds" =~ ^[0-9]+$ ]] || [[ "$timeout_seconds" -lt 1 ]]; then
    timeout_seconds=60
  fi
  printf '%s' "$timeout_seconds"
}

run_gruff_json() {
  local binary_path="$1"
  local binary="$2"
  local help="$3"
  local file_path="$4"
  local ranges="$5"
  local scope="${6:-symbol}"
  local target_root="${7:-.}"
  local args timeout_seconds
  args=(analyse)
  if [[ "$help" == *"--format"* ]]; then
    args+=(--format json)
    if [[ "$help" == *"--fail-on"* ]]; then
      args+=(--fail-on none)
    fi
    if supports_native_changed_regions "$help"; then
      args+=(--no-baseline --changed-ranges "$ranges" --changed-scope "$scope")
    fi
  elif [[ "$help" == *"-format"* ]]; then
    args+=(-format json)
  else
    return 64
  fi

  timeout_seconds="$(normalized_timeout_seconds "$binary")"

  # Hosts with GNU timeout keep slow analysis inside the coding-agent feedback window.
  if command -v timeout >/dev/null 2>&1; then
    (cd "$target_root" && timeout "$timeout_seconds" "$binary_path" "${args[@]}" "$file_path" 2>&1)
    return $?
  fi
  # A host without timeout still runs from the package whose config owns this edited file.
  (cd "$target_root" && "$binary_path" "${args[@]}" "$file_path" 2>&1)
}

valid_gruff_json() {
  local output="$1"
  printf '%s' "$output" | jq -e 'type == "object" and (.findings | type == "array")' >/dev/null 2>&1
}

# Extract a config-error message to surface to the agent, or empty when the run
# is clean. Definitive config rejections (schemaOk=false, or a diagnostic typed
# config-error) always surface. A generic untyped diagnostic only counts as a
# config error when NO files were analysed AND the file was not ignored -
# otherwise an ignored-but-OK file (which the caller renders as "skipped -
# ignored") would be mislabelled "could not analyse".
config_error_message() {
  local output="$1"
  printf '%s' "$output" | jq -r '
    ([ (.diagnostics // [])[]
      | select(((.type? // .code? // .kind? // .category? // "") | tostring | ascii_downcase | test("config[-_ ]?error|config")))
      | (.message? // .detail? // .reason? // .error? // empty)
    ] | first // "") as $config_diag
    | ([ (.diagnostics // [])[]
        | (.message? // .detail? // .reason? // .error? // empty)
      ] | first // "") as $any_diag
    | ((.filesDiscovered? // .paths.analysedFiles? // -1) == 0) as $zero_files
    | ((((.ignored.paths? // []) + (.paths.ignoredPaths? // []) + (.ignoredPaths? // []) + (.paths.skipped? // [])) | length) > 0) as $has_ignore
    | if (.config.schemaOk == false) then
        (.config.error // "project gruff config rejected")
      elif ($config_diag | length) > 0 then
        $config_diag
      elif $zero_files and (($any_diag | length) > 0) and ($has_ignore | not) then
        $any_diag
      else
        empty
      end
  ' 2>/dev/null || true
}

# Map a min-severity name to its rank (advisory=1, warning=2, error=3). Any
# unrecognised value (or empty) floors at advisory, the default - the hook never
# hides findings because of a typo in GRUFF_CODE_QUALITY_MIN_SEVERITY.
min_severity_rank() {
  case "${1,,}" in
    warning) printf '2' ;;
    error) printf '3' ;;
    *) printf '1' ;;
  esac
}

# Build a single JSON control object describing the changed-line findings:
#   { total, e, w, a, surfaced, floored, more, lines }
# `total`/`e`/`w`/`a` count every finding whose primary line intersects the
# changed ranges, by severity. `lines` holds the canonical
# `- [severity] file:line ruleId - message` rows for the findings that survive the
# severity floor (rank >= $floor_rank), sorted error -> warning -> advisory then
# file/line/ruleId, capped at $max; `more` is how many surfaced findings the cap
# hid and `floored` how many were dropped below the floor. Accepts the JSON shapes
# emitted across all five ports: path may be `filePath`, `file`, or `path`; line
# may be `line`, `location.line`, or `location.startLine`.
changed_findings_report() {
  local output="$1"
  local rel_path="$2"
  local abs_path="$3"
  local ranges="$4"
  local floor_rank="$5"
  local max="$6"
  local native="${7:-0}"
  printf '%s' "$output" | jq -c --arg rel "$rel_path" --arg abs "$abs_path" --arg ranges "$ranges" --argjson floor_rank "$floor_rank" --argjson max "$max" --argjson native "$native" '
    def normalize_path:
      tostring | gsub("\\\\"; "/") | sub("^\\./"; "");
    def finding_path:
      .filePath? // .file? // .path? // "";
    def line_number:
      (.line? // .location.line? // .location.startLine?) as $line
      | if ($line | type) == "number" then
          $line
        elif ($line | type) == "string" then
          ($line | tonumber?)
        else
          empty
        end;
    def line_or_null:
      [line_number] | first // null;
    def same_file:
      (finding_path | normalize_path) as $path
      | ($path == ($rel | normalize_path)
        or $path == ($abs | normalize_path)
        or $path == ("./" + ($rel | normalize_path))
        or ($path | endswith("/" + ($rel | normalize_path))));
    def parsed_ranges:
      $ranges
      | split(",")
      | map(select(length > 0) | split("-") | {start: (.[0] | tonumber), end: (.[1] | tonumber)});
    def in_changed_ranges($line):
      parsed_ranges as $parsed
      | any($parsed[]; $line >= .start and $line <= .end);
    def sev_rank($s):
      # error > warning > everything else (advisory, or an unknown/missing severity)
      # so an unrecognised severity still clears the default advisory floor and stays visible.
      ($s | tostring | ascii_downcase) as $sev
      | if $sev == "error" then 3 elif $sev == "warning" then 2 else 1 end;

    [ (.findings // [])[]
      | . as $finding
      | ($finding | line_or_null) as $line
      | select(($finding | same_file) and $line != null and ($native == 1 or in_changed_ranges($line)))
      | { sev: ((.severity // "unknown") | tostring | ascii_downcase),
          rank: sev_rank(.severity // ""),
          line: $line,
          file: ($finding | finding_path),
          ruleId: (.ruleId // "unknown-rule"),
          message: (.message // "") } ] as $all
    | ($all | sort_by([ (3 - .rank), .file, .line, .ruleId ])) as $sorted
    | [ $sorted[] | select(.rank >= $floor_rank) ] as $surfaced
    | { total: ($all | length),
        e: ([ $all[] | select(.rank == 3) ] | length),
        w: ([ $all[] | select(.rank == 2) ] | length),
        a: ([ $all[] | select(.rank == 1) ] | length),
        surfaced: ($surfaced | length),
        floored: (($all | length) - ($surfaced | length)),
        more: (if ($surfaced | length) > $max then ($surfaced | length) - $max else 0 end),
        resultFindings: [ limit($max; $surfaced[])
          | {code: .ruleId, message: ("[" + .sev + "] " + .message), target: .file} ],
        lines: [ limit($max; $surfaced[]) | "- [\(.sev)] \(.file):\(.line) \(.ruleId) - \(.message)" ] }
  ' 2>/dev/null || true
}

suppressed_count() {
  local output="$1"
  local rel_path="$2"
  local abs_path="$3"
  local ranges="$4"
  printf '%s' "$output" | jq -r --arg rel "$rel_path" --arg abs "$abs_path" --arg ranges "$ranges" '
    def normalize_path:
      tostring | gsub("\\\\"; "/") | sub("^\\./"; "");
    def finding_path:
      .filePath? // .file? // .path? // "";
    def line_number:
      (.line? // .location.line? // .location.startLine?) as $line
      | if ($line | type) == "number" then
          $line
        elif ($line | type) == "string" then
          ($line | tonumber?)
        else
          empty
        end;
    def line_or_null:
      [line_number] | first // null;
    def same_file:
      (finding_path | normalize_path) as $path
      | ($path == ($rel | normalize_path)
        or $path == ($abs | normalize_path)
        or $path == ("./" + ($rel | normalize_path))
        or ($path | endswith("/" + ($rel | normalize_path))));
    def parsed_ranges:
      $ranges
      | split(",")
      | map(select(length > 0) | split("-") | {start: (.[0] | tonumber), end: (.[1] | tonumber)});
    def in_changed_ranges($line):
      parsed_ranges as $parsed
      | any($parsed[]; $line >= .start and $line <= .end);

    [
      (.findings // [])
      | .[]
      | . as $finding
      | ($finding | line_or_null) as $line
      | select(same_file)
      | select($line == null or (in_changed_ranges($line) | not))
    ] | length
  ' 2>/dev/null || printf '0'
}

# When the analyzer owns changed-region scoping, it reports how many findings it
# suppressed as out-of-scope in its own output; read that count rather than
# re-deriving it. Falls back to 0 when the field is absent.
native_suppressed_count() {
  local output="$1"
  printf '%s' "$output" | jq -r '
    (.suppressedCount? // .diff.suppressedCount? // 0)
  ' 2>/dev/null || printf '0'
}

# When the analyzer reports the edited file as ignored by its config
# (`paths.ignore`), return a short human descriptor (for example
# "ignored by gruff config (matched *.css)") so the hook can tell the agent the
# file is out of scope instead of surfacing findings for it. The verdict is read
# from gruff's own output (`paths.ignoredPaths`, or `paths.skipped` for
# gruff-go); the hook never re-derives ignore rules. Handles bare-string and
# `{path,source,pattern,reason}` entry shapes, and prints nothing when the file
# is not ignored. No-op on gruff binaries that still bypass `paths.ignore` for
# explicitly-passed files (the list comes back empty).
ignored_descriptor() {
  local output="$1"
  local rel_path="$2"
  local abs_path="$3"
  printf '%s' "$output" | jq -r --arg rel "$rel_path" --arg abs "$abs_path" '
    def normalize_path:
      tostring | gsub("\\\\"; "/") | sub("^\\./"; "");
    def entry_path:
      if type == "string" then . else (.path? // .file? // "") end;
    def entry_detail:
      if type == "object" then (.pattern? // .source? // .reason? // "") else "" end;
    def is_match($p):
      ($p | normalize_path) as $n
      | ($n == ($rel | normalize_path)
        or $n == ($abs | normalize_path)
        or $n == ("./" + ($rel | normalize_path))
        or ($n | endswith("/" + ($rel | normalize_path))));

    ((.paths.ignoredPaths? // []) + (.ignoredPaths? // []) + (.paths.skipped? // []))
    | map(select(is_match(entry_path)))
    | ((map(select(entry_detail | length > 0)) | first) // first)
    | if . == null then empty
      else (entry_detail) as $d
        | if ($d | length) > 0 then "ignored by gruff config (matched \($d))"
          else "ignored by gruff config" end
      end
  ' 2>/dev/null || true
}

# Translate rule families into the specific thing a reviewer will be missing, so an agent
# fixes the underlying gap instead of inserting marker words to clear the finding. The
# wording deliberately mirrors code-comments.md, which is the standard these rules approximate.
print_reviewability_guidance() {
  local report="$1"
  local surfaced_lines
  surfaced_lines="$(printf '%s' "$report" | jq -r '.lines[]?' 2>/dev/null || true)"
  [[ -n "$surfaced_lines" ]] || return 0

  local shown_docs=0 shown_naming=0 shown_structure=0 line
  while IFS= read -r line; do
    case "$line" in
      *" docs."*)
        [[ "$shown_docs" -eq 1 ]] || {
          shown_docs=1
          printf 'gruff-code-quality: docs findings want a real contract, not a marker word - say what it does, when a reader reaches it, and what null/empty means for them (code-comments.md tiers 1 and 4).\n'
        }
        ;;
    esac
    case "$line" in
      *" naming."*)
        [[ "$shown_naming" -eq 1 ]] || {
          shown_naming=1
          printf 'gruff-code-quality: naming findings want the words a reader already knows, not internal mechanics - a better name often removes the need for the comment too (code-comments.md tier 2).\n'
        }
        ;;
    esac
    case "$line" in
      *" size."*|*" design.circular-import"*)
        [[ "$shown_structure" -eq 1 ]] || {
          shown_structure=1
          printf "gruff-code-quality: structural findings are review cost - split along the concern a reader follows, then re-run \`goat-flow stats --check\`, because moving a symbol breaks learning-loop anchors that no compiler can see.\n"
        }
        ;;
    esac
  done <<<"$surfaced_lines"
  return 0
}

# Show attributable totals without labelling structural findings as changed-line-only.
print_scope_header() {
  local binary="$1"
  local rel_path="$2"
  local ranges="$3"
  local total="$4"
  local err="$5"
  local warn="$6"
  local adv="$7"
  local edit_total="${8:-$total}"
  local structural_total="${9:-0}"
  printf 'gruff-code-quality: %s %s edit-ranges=%s; %s attributable finding(s) (edit=%s, file/project=%s): %s error, %s warning, %s advisory\n' \
    "$binary" "$rel_path" "$ranges" "$total" "$edit_total" "$structural_total" "$err" "$warn" "$adv"
}

# Probe a binary's gruff.hook.v1 capabilities once per binary (cached for the
# run). Returns the capabilities JSON when the binary advertises contractVersion
# "gruff.hook.v1", else empty - the caller then uses the legacy analyse path, so
# a pre-contract analyzer is unaffected.
hook_capabilities() {
  local binary_path="$1"
  local binary="${2:-}"
  if [[ -n "${HOOK_CAPS_CACHE[$binary_path]+x}" ]]; then
    printf '%s' "${HOOK_CAPS_CACHE[$binary_path]}"
    return 0
  fi
  local caps="" probe
  if command -v jq >/dev/null 2>&1; then
    if command -v timeout >/dev/null 2>&1; then
      probe="$(timeout "$(normalized_timeout_seconds "$binary")" "$binary_path" hook --capabilities --format json 2>/dev/null || true)"
    else
      probe="$("$binary_path" hook --capabilities --format json 2>/dev/null || true)"
    fi
    if printf '%s' "$probe" | jq -e '.contractVersion == "gruff.hook.v1" and (.supports.changedRanges == true) and ((.flags | type) == "object")' >/dev/null 2>&1; then
      caps="$probe"
    fi
  fi
  HOOK_CAPS_CACHE["$binary_path"]="$caps"
  printf '%s' "$caps"
}

# Project a gruff.hook.v1 envelope into the same control object
# changed_findings_report emits ({ total, e, w, a, surfaced, floored, more,
# lines }), so process_file_contract reuses the existing print block. The
# analyzer has already scoped the findings (B1), so EVERY returned finding is
# surfaced - no re-filtering by line. file/project-scope findings render without
# a `:line` because their line is a synthetic anchor, not a code location.
hook_v1_report() {
  local output="$1" floor_rank="$2" max="$3" ranges="${4:-}"
  printf '%s' "$output" | jq -c --argjson floor_rank "$floor_rank" --argjson max "$max" --arg ranges "$ranges" '
    def sev_rank($s):
      ($s | tostring | ascii_downcase) as $x
      | if $x == "error" then 3 elif $x == "warning" then 2 else 1 end;
    def parsed_ranges:
      $ranges
      | split(",")
      | map(select(length > 0) | split("-") | {start: (.[0] | tonumber), end: (.[1] | tonumber)});
    def in_changed_ranges($line):
      parsed_ranges as $parsed
      | ($parsed | length) == 0 or any($parsed[]; $line >= .start and $line <= .end);
    # A file-scope finding describes the file the agent is editing right now - it is too long,
    # it has no overview, it sits in an import cycle. Those never overlap a changed line, so
    # range filtering would hide them forever and let a file grow unbounded while every edit
    # reports clean. They always surface. Line and symbol findings stay range-filtered so the
    # agent is not handed pre-existing debt from parts of the file it did not touch.
    [ (.findings // [])[]
      | select(
          ((.scope // "line") == "file" or (.scope // "line") == "project")
          or in_changed_ranges(.line // 0)
        )
      | { sev: ((.severity // "advisory") | tostring | ascii_downcase),
          rank: sev_rank(.severity // ""),
          scope: (.scope // "line"),
          file: (.file // .filePath // .path // ""),
          line: (if ((.scope // "line") == "file" or (.scope // "line") == "project")
                 then null else (.line // null) end),
          ruleId: (.ruleId // "unknown-rule"),
          message: (.message // "") } ] as $all
    | ($all | sort_by([ (3 - .rank), .file, (.line // 0), .ruleId ])) as $sorted
    | [ $sorted[] | select(.rank >= $floor_rank) ] as $surfaced
    | { total: ($all | length),
        editTotal: ([ $all[] | select(.scope != "file" and .scope != "project") ] | length),
        structuralTotal: ([ $all[] | select(.scope == "file" or .scope == "project") ] | length),
        e: ([ $all[] | select(.rank == 3) ] | length),
        w: ([ $all[] | select(.rank == 2) ] | length),
        a: ([ $all[] | select(.rank == 1) ] | length),
        surfaced: ($surfaced | length),
        floored: (($all | length) - ($surfaced | length)),
        more: (if ($surfaced | length) > $max then ($surfaced | length) - $max else 0 end),
        resultFindings: [ limit($max; $surfaced[])
          | {code: .ruleId, message: ("[" + .sev + "] " + .message), target: .file} ],
        lines: [ limit($max; $surfaced[])
                 | "- [\(.sev)] \(.file)\(if .line != null then ":" + (.line | tostring) else "" end) \(.ruleId) - \(.message)" ] }
  ' 2>/dev/null || true
}

# Run a versioned analyzer exchange and retain a typed result for the provider adapter.
process_file_contract() {
  local binary_path="$1" binary="$2" rel_path="$3" target_root="$4"
  local target_rel_path="$5" ranges="$6"
  local output status timeout_seconds report_json suppressed analyzer_error_path analyzer_error
  local config_error ignored_match scope_fields
  local max_findings floor_rank total edit_total structural_total err warn adv surfaced floored more

  timeout_seconds="$(normalized_timeout_seconds "$binary")"
  analyzer_error_path="$(mktemp)"
  set +e
  # A host with timeout support bounds the analyzer before the coding agent UI deadline.
  if command -v timeout >/dev/null 2>&1; then
    output="$(cd "$target_root" && timeout "$timeout_seconds" "$binary_path" hook --format json "$target_rel_path" 2>"$analyzer_error_path")"
  else
    output="$(cd "$target_root" && "$binary_path" hook --format json "$target_rel_path" 2>"$analyzer_error_path")"
  fi
  status=$?
  set -e
  analyzer_error="$(<"$analyzer_error_path")"
  rm -f "$analyzer_error_path"

  # A user-facing timeout must never be translated into a clean edit.
  if [[ "$status" -eq 124 || "$status" -eq 137 ]]; then
    record_file_result 70 "incomplete" "execution-timeout" "analyzer-timeout" \
      "$binary exceeded ${timeout_seconds}s while checking this edit" "$rel_path" 0 0
    printf 'gruff-code-quality: %s exceeded %ss; analysis incomplete\n' "$binary" "$timeout_seconds" >&2
    return 0
  fi
  # Contract analyzers use exit zero; any other status means the exchange failed.
  if [[ "$status" -ne 0 ]]; then
    record_file_result 80 "unavailable" "hook-unavailable" "analyzer-failed" \
      "${analyzer_error:-$binary exited $status without a complete result}" "$rel_path" 0 0
    printf 'gruff-code-quality: %s failed for %s: %s\n' "$binary" "$rel_path" "${analyzer_error:-exit $status}" >&2
    return 0
  fi
  # Exit-zero silence is an invalid response, not evidence that the edited file is clean.
  if [[ -z "$output" ]]; then
    record_file_result 60 "incomplete" "output-invalid" "analyzer-response-invalid" \
      "$binary returned no result for this edit" "$rel_path" 0 0
    printf 'gruff-code-quality: %s returned no result for %s\n' "$binary" "$rel_path" >&2
    return 0
  fi
  # A schema mismatch means the user cannot trust any finding or clean claim in the payload.
  if ! printf '%s' "$output" | jq -e '
    type == "object"
    and .contractVersion == "gruff.hook.v1"
    and ((.findings | type == "array") or (.config | type == "object") or (.ignored | type == "object"))
  ' >/dev/null 2>&1; then
    record_file_result 60 "incomplete" "output-invalid" "analyzer-response-invalid" \
      "$binary returned malformed or unsupported result JSON" "$rel_path" 0 0
    printf 'gruff-code-quality: %s returned an invalid result for %s\n' "$binary" "$rel_path" >&2
    return 0
  fi

  config_error="$(config_error_message "$output")"
  # A rejected project config explains why no reliable analysis reached the UI.
  if [[ -n "$config_error" ]]; then
    record_file_result 80 "unavailable" "hook-unavailable" "analyzer-config-invalid" \
      "$config_error" "$rel_path" 0 0
    printf 'gruff-code-quality: %s could not analyse %s - %s\n' "$binary" "$rel_path" "$config_error"
    return 0
  fi

  ignored_match="$(printf '%s' "$output" | jq -r --arg p "$target_rel_path" '
    def norm: tostring | gsub("\\\\"; "/") | sub("^\\./"; "");
    ($p | norm) as $rel
    | first((.ignored.paths // [])[]
      | ((.path? // .file? // "") | norm) as $ignored_path
      | select($ignored_path == $rel or ($ignored_path | endswith("/" + $rel)))
      | (.source // "config") + (if (.pattern // "") != "" then " " + .pattern else "" end))
      // empty
  ' 2>/dev/null || true)"
  # An ignored file completed a valid exchange but is intentionally outside project scope.
  if [[ -n "$ignored_match" ]]; then
    record_file_result 20 "advisory" "findings-reported" "analysis-not-applicable" \
      "This file is ignored by $ignored_match, so Gruff did not request changes" "$rel_path" 1 1
    FILE_RESULT_BINARY="$binary"
    printf 'gruff-code-quality: skipped %s %s - ignored by %s; out of scope\n' "$binary" "$rel_path" "$ignored_match"
    return 0
  fi

  max_findings="$GRUFF_CODE_QUALITY_MAX_FINDINGS"
  # Invalid user configuration falls back to the shared provider-safe cap.
  [[ "$max_findings" =~ ^[0-9]+$ && "$max_findings" -ge 1 ]] || max_findings=20
  floor_rank="$(min_severity_rank "$GRUFF_CODE_QUALITY_MIN_SEVERITY")"
  report_json="$(hook_v1_report "$output" "$floor_rank" "$max_findings" "$ranges")"
  # A failed projection is itself an invalid analyzer response.
  if [[ -z "$report_json" ]]; then
    record_file_result 60 "incomplete" "output-invalid" "analyzer-response-invalid" \
      "$binary result could not be projected into feedback" "$rel_path" 0 0
    return 0
  fi
  record_report_result "$report_json" "$rel_path" "$binary"
  suppressed="$(printf '%s' "$output" | jq -r '.suppressed.count // 0' 2>/dev/null || true)"
  # Missing suppression metadata means no hidden count is shown to the user.
  [[ "$suppressed" =~ ^[0-9]+$ ]] || suppressed=0

  scope_fields="$(printf '%s' "$report_json" | jq -r '[.total,.editTotal,.structuralTotal,.e,.w,.a,.surfaced,.floored,.more] | @tsv')"
  IFS=$'\t' read -r total edit_total structural_total err warn adv surfaced floored more <<< "$scope_fields"
  # Findings or analyzer-owned suppression justify a concise scope summary.
  if [[ "$total" -gt 0 || "$suppressed" -gt 0 ]]; then
    print_scope_header "$binary" "$rel_path" "$ranges" "$total" "$err" "$warn" "$adv" "$edit_total" "$structural_total"
  fi
  # Only surfaced findings consume the user's immediate review context.
  if [[ "$surfaced" -gt 0 ]]; then
    printf '%s' "$report_json" | jq -r '.lines[]'
  fi
  # The bounded cap is visible so users know additional attributable findings exist.
  if [[ "$more" -gt 0 ]]; then
    printf 'gruff-code-quality: %s more attributable finding(s) were capped\n' "$more"
  fi
  # A project severity floor remains visible instead of masquerading as zero findings.
  if [[ "$floored" -gt 0 ]]; then
    printf 'gruff-code-quality: %s attributable finding(s) below the configured floor\n' "$floored"
  fi
  # Analyzer-owned suppression reports unrelated debt without asking the user to fix it.
  if [[ "$suppressed" -gt 0 ]]; then
    printf 'gruff-code-quality: suppressed %s finding(s) outside the changed scope\n' "$suppressed"
  fi
  # Practical guidance appears only when the user has a finding to address.
  if [[ "$surfaced" -gt 0 ]]; then
    print_reviewability_guidance "$report_json"
    printf '%s\n' "$FOOTER"
  fi
  return 0
}

process_file() {
  local payload="$1"
  local root="$2"
  local file_path="$3"
  local file_count="${4:-1}"
  local allow_cached_fallback="${5:-1}"
  local rel_path abs_path binary binary_path config_file config_rel
  local binary_env binary_override config_error
  local config_binary config_key resolved_binary
  local ranges range_status help output status suppressed ignored_desc uses_native_regions
  local max_findings floor_rank report_json scope_fields changed_scope
  local total err warn adv surfaced floored more

  [[ -n "$file_path" ]] || return 0
  [[ "$file_path" =~ $SKIP_DIR_PATTERN ]] && return 0

  rel_path="$(relative_path "$root" "$file_path")"
  case "$rel_path" in
    ..|../*|*/../*) return 0 ;;
  esac
  abs_path="$(absolute_path "$root" "$rel_path")"
  [[ "$abs_path" == "$root"/* ]] || return 0
  binary="$(variant_for_path "$rel_path" || true)"
  [[ -n "$binary" ]] || return 0
  config_file="$root/.${binary}.yaml"
  if [[ ! -f "$config_file" ]]; then
    config_file="$root/.${binary}.yml"
  fi
  [[ -f "$config_file" ]] || return 0

  binary_path="$(discover_binary "$root" "$binary")"
  if [[ -z "$binary_path" ]]; then
    binary_env="$(binary_env_name "$binary")"
    binary_override="${!binary_env:-}"
    config_binary="$(config_binary_override "$root" "$binary")"
    config_key="hooks.gruff-code-quality.binaries.${binary#gruff-}"
    if [[ -n "$binary_override" ]]; then
      printf 'gruff-code-quality: %s is set but is not executable: %s; skipped\n' "$binary_env" "$binary_override" >&2
    elif [[ -n "$config_binary" ]]; then
      resolved_binary="$(resolve_config_binary "$root" "$config_binary")"
      if [[ -z "$resolved_binary" ]]; then
        printf 'gruff-code-quality: %s must be a repo-relative path inside the repo, got %s; use %s for machine-specific paths; skipped\n' "$config_key" "$config_binary" "$binary_env" >&2
      elif [[ ! -e "$resolved_binary" ]]; then
        printf 'gruff-code-quality: %s points at %s which does not exist; skipped\n' "$config_key" "${resolved_binary#"$root"/}" >&2
      else
        printf 'gruff-code-quality: %s points at %s which is not an executable file; skipped\n' "$config_key" "${resolved_binary#"$root"/}" >&2
      fi
    else
      config_rel="${config_file#"$root"/}"
      printf 'gruff-code-quality: %s present but %s not found on search paths (%s); set %s in .goat-flow/config.yaml or %s to an executable path for non-standard monorepo layouts; skipped\n' "$config_rel" "$binary" "$BINARY_SEARCH_PATHS" "$config_key" "$binary_env" >&2
    fi
    return 0
  fi

  if ! command -v jq >/dev/null 2>&1; then
    printf 'gruff-code-quality: jq unavailable; changed-line filtering skipped\n' >&2
    return 0
  fi

  set +e
  ranges="$(changed_ranges "$payload" "$root" "$rel_path" "$abs_path" "$file_count" "$allow_cached_fallback")"
  range_status=$?
  set -e
  # Legacy launches keep their established fail-soft skip for every unavailable range state.
  if [[ "$range_status" -ne 0 || -z "$ranges" ]]; then
    printf 'gruff-code-quality: no changed lines detected for %s; skipping gruff output\n' "$rel_path" >&2
    return 0
  fi

  # Contract path: when the analyzer advertises gruff.hook.v1 it owns changed-region
  # scoping, scope tagging, metadata, remediation and new-only - the hook only
  # renders. Pre-contract analyzers fall through to the legacy analyse path below.
  local hook_caps
  hook_caps="$(hook_capabilities "$binary_path" "$binary")"
  if [[ -n "$hook_caps" ]]; then
    process_file_contract "$binary_path" "$binary" "$rel_path" "$root" "$rel_path" "$ranges"
    return 0
  fi

  help="$(analyse_help "$binary_path")"
  if ! supports_json_format "$help"; then
    printf 'gruff-code-quality: %s does not expose JSON output; changed-line filtering skipped\n' "$binary" >&2
    return 0
  fi
  uses_native_regions=0
  if supports_native_changed_regions "$help"; then
    uses_native_regions=1
  fi

  # Same rule as the contract path: when the changed range already covers the whole file,
  # `symbol` scope only serves to hide findings that belong to no symbol - a missing file
  # overview, an over-long file - so widen to `file` scope for that case alone.
  changed_scope="symbol"
  if [[ -n "$ranges" && "$ranges" == "$(all_file_range "$abs_path")" ]]; then
    changed_scope="file"
  fi

  set +e
  output="$(run_gruff_json "$binary_path" "$binary" "$help" "$rel_path" "$ranges" "$changed_scope")"
  status=$?
  set -e

  if [[ "$status" -eq 124 || "$status" -eq 137 ]]; then
    printf 'gruff-code-quality: %s exceeded %ss or was killed; changed-line filtering skipped. Raise %s or GRUFF_CODE_QUALITY_TIMEOUT_SECONDS if this analyzer needs more time.\n' "$binary" "$(normalized_timeout_seconds "$binary")" "$(timeout_env_name "$binary")" >&2
    return 0
  fi
  if [[ -z "$output" ]]; then
    return 0
  fi
  if ! valid_gruff_json "$output"; then
    # gruff returned no JSON. $output holds gruff's merged stdout+stderr, which
    # on current builds is usually a config-schema rejection: the project's
    # `.<binary>.yaml` lacks the required `schemaVersion:` line, so `analyse`
    # exits non-zero with an error instead of findings. Relay gruff's own words
    # (which name its fix, e.g. `<binary> init --force`) to the agent on stdout
    # so the cause is visible, not buried under a generic note. The hook never
    # edits the project's gruff config; that file is the project's to own.
    if [[ "$output" == *schemaVersion* ]]; then
      printf 'gruff-code-quality: %s could not analyse - its project config (.%s.yaml) was rejected. gruff reported:\n' "$binary" "$binary"
      printf '%s\n' "$output" | awk 'NR <= 12 { print "  " $0 }'
      return 0
    fi
    printf 'gruff-code-quality: %s exited %s with non-JSON output; changed-line filtering skipped\n' "$binary" "$status" >&2
    return 0
  fi

  config_error="$(config_error_message "$output")"
  if [[ -n "$config_error" ]]; then
    printf 'gruff-code-quality: %s could not analyse %s - %s\n' "$binary" "$rel_path" "$config_error"
    return 0
  fi

  # If gruff reports the edited file as ignored by config (`paths.ignore`), tell
  # the agent it is out of scope and stop - never surface findings for a file the
  # project deliberately excludes. The verdict is gruff's own (`ignoredPaths`);
  # the hook does not re-derive ignore rules. No-op on gruff binaries that still
  # bypass `paths.ignore` for explicitly-passed files.
  ignored_desc="$(ignored_descriptor "$output" "$rel_path" "$abs_path")"
  if [[ -n "$ignored_desc" ]]; then
    printf 'gruff-code-quality: skipped %s %s - %s; out of scope, do not modify to satisfy gruff.\n' "$binary" "$rel_path" "$ignored_desc"
    record_file_result 20 "advisory" "findings-reported" "analysis-not-applicable" \
      "This file is $ignored_desc" "$rel_path" 1 1
    FILE_RESULT_BINARY="$binary"
    return 0
  fi

  # MVP range model: enforce findings whose primary line intersects edited lines.
  # Wider function-block expansion is deferred unless an analyzer reports new
  # method findings only on unchanged declaration lines. Surfaced findings are
  # severity-sorted (error first), floored at GRUFF_CODE_QUALITY_MIN_SEVERITY, and
  # capped at GRUFF_CODE_QUALITY_MAX_FINDINGS.
  max_findings="$GRUFF_CODE_QUALITY_MAX_FINDINGS"
  [[ "$max_findings" =~ ^[0-9]+$ && "$max_findings" -ge 1 ]] || max_findings=20
  floor_rank="$(min_severity_rank "$GRUFF_CODE_QUALITY_MIN_SEVERITY")"

  report_json="$(changed_findings_report "$output" "$rel_path" "$abs_path" "$ranges" "$floor_rank" "$max_findings" "$uses_native_regions")"
  [[ -n "$report_json" ]] || report_json='{"total":0,"e":0,"w":0,"a":0,"surfaced":0,"floored":0,"more":0,"lines":[]}'
  record_report_result "$report_json" "$rel_path" "$binary"
  if [[ "$uses_native_regions" -eq 1 ]]; then
    suppressed="$(native_suppressed_count "$output")"
  else
    suppressed="$(suppressed_count "$output" "$rel_path" "$abs_path" "$ranges")"
  fi

  scope_fields="$(printf '%s' "$report_json" | jq -r '[.total,.e,.w,.a,.surfaced,.floored,.more] | @tsv' 2>/dev/null || true)"
  IFS=$'\t' read -r total err warn adv surfaced floored more <<< "$scope_fields"
  [[ "$total" =~ ^[0-9]+$ ]] || total=0
  [[ "$surfaced" =~ ^[0-9]+$ ]] || surfaced=0
  [[ "$floored" =~ ^[0-9]+$ ]] || floored=0
  [[ "$more" =~ ^[0-9]+$ ]] || more=0

  if [[ "$total" -gt 0 || ( "$suppressed" =~ ^[0-9]+$ && "$suppressed" -gt 0 ) ]]; then
    print_scope_header "$binary" "$rel_path" "$ranges" "$total" "$err" "$warn" "$adv"
  fi
  if [[ "$surfaced" -gt 0 ]]; then
    printf '%s' "$report_json" | jq -r '.lines[]' 2>/dev/null || true
  fi
  if [[ "$more" -gt 0 ]]; then
    printf 'gruff-code-quality: (%s more on changed lines; raise GRUFF_CODE_QUALITY_MAX_FINDINGS to list them)\n' "$more"
  fi
  if [[ "$floored" -gt 0 ]]; then
    printf 'gruff-code-quality: %s finding(s) below GRUFF_CODE_QUALITY_MIN_SEVERITY=%s not listed\n' "$floored" "${GRUFF_CODE_QUALITY_MIN_SEVERITY:-advisory}"
  fi
  if [[ "$suppressed" =~ ^[0-9]+$ && "$suppressed" -gt 0 ]]; then
    printf 'gruff-code-quality: suppressed %s pre-existing finding(s) outside changed lines\n' "$suppressed"
  fi
  if [[ "$surfaced" -gt 0 ]]; then
    print_reviewability_guidance "$report_json"
    printf '%s\n' "$FOOTER"
  fi
  return 0
}

# Produce one provider-neutral state for an edited file while registrations migrate.
# Use from result-mode launchers: package selection, Git attribution, and analyzer
# validation all finish before the provider adapter decides what the user sees.
process_file_result() {
  local payload="$1" root="$2" file_path="$3" file_count="${4:-1}"
  local allow_cached_fallback="${5:-1}"
  local rel_path abs_path binary target_details target_status
  local target_root target_rel_path config_file binary_path ranges range_status
  local hook_caps help output status uses_native_regions changed_scope
  local config_error ignored_desc report_json floor_rank max_findings

  reset_file_result

  # An empty provider path cannot identify user content for Gruff to inspect.
  if [[ -z "$file_path" ]]; then
    record_file_result 60 "incomplete" "input-invalid" "edited-path-missing" \
      "The completed edit did not name a file" "project" 0 0
    return 0
  fi
  rel_path="$(relative_path "$root" "$file_path")"
  abs_path="$(absolute_path "$root" "$rel_path")"
  # A path outside the selected project cannot be attributed to this user edit.
  if [[ "$rel_path" == ".." || "$rel_path" == ../* || "$rel_path" == */../* || "$abs_path" != "$root"/* ]]; then
    record_file_result 60 "incomplete" "input-invalid" "edited-path-outside-project" \
      "The completed edit named a path outside the selected project" "$rel_path" 0 0
    return 0
  fi

  binary="$(variant_for_path "$rel_path" || true)"
  # Unsupported extensions have no analyzer contract and cannot produce a clean badge.
  if [[ -z "$binary" ]]; then
    record_file_result 20 "advisory" "findings-reported" "analysis-not-applicable" \
      "No Gruff analyzer supports this file type" "$rel_path" 0 0
    return 0
  fi
  FILE_RESULT_BINARY="$binary"

  set +e
  target_details="$(analyzer_target_for_path "$root" "$rel_path" "$binary")"
  target_status=$?
  set -e
  # Two config extensions at one package leave the user's intended analyzer ambiguous.
  if [[ "$target_status" -eq 2 ]]; then
    record_file_result 80 "unavailable" "hook-unavailable" "analyzer-config-ambiguous" \
      "Both .${binary}.yaml and .${binary}.yml exist for this file" "$rel_path" 0 0
    return 0
  fi
  # A missing ancestor config means the file was not covered, never that it was clean.
  if [[ "$target_status" -ne 0 || -z "$target_details" ]]; then
    record_file_result 80 "unavailable" "hook-unavailable" "analyzer-config-missing" \
      "No .${binary}.yaml or .${binary}.yml config owns this edited file" "$rel_path" 0 0
    return 0
  fi
  IFS=$'\t' read -r target_root target_rel_path config_file <<< "$target_details"

  binary_path="$(discover_binary "$root" "$binary" "$target_root")"
  # A configured file without an executable analyzer is an unavailable check.
  if [[ -z "$binary_path" ]]; then
    record_file_result 80 "unavailable" "hook-unavailable" "analyzer-binary-missing" \
      "$binary could not be resolved for ${config_file#"$root"/}" "$rel_path" 0 0
    return 0
  fi
  # jq validates analyzer responses before any clean or finding state reaches the UI.
  if ! command -v jq >/dev/null 2>&1; then
    record_file_result 80 "unavailable" "hook-unavailable" "result-parser-missing" \
      "jq is unavailable, so Gruff output cannot be validated" "$rel_path" 0 0
    return 0
  fi

  set +e
  ranges="$(changed_ranges "$payload" "$root" "$rel_path" "$abs_path" "$file_count" "$allow_cached_fallback")"
  range_status=$?
  set -e
  # A deletion or binary-only edit leaves no source lines for after-edit analysis.
  if [[ "$range_status" -eq 10 ]]; then
    record_file_result 20 "advisory" "findings-reported" "analysis-not-applicable" \
      "This edit has no remaining source lines for Gruff to analyze" "$rel_path" 0 0
    return 0
  fi
  # A Git command failure makes changed-scope coverage explicitly incomplete.
  if [[ "$range_status" -eq 12 ]]; then
    record_file_result 60 "incomplete" "coverage-incomplete" "git-scope-failed" \
      "Git could not derive trustworthy changed ranges for this edit" "$rel_path" 0 0
    return 0
  fi
  # Missing hunks cannot support a reliable clean result for a tracked file.
  if [[ "$range_status" -ne 0 || -z "$ranges" ]]; then
    record_file_result 60 "incomplete" "coverage-incomplete" "git-scope-unavailable" \
      "No trustworthy changed ranges were available for this edited file" "$rel_path" 0 0
    return 0
  fi

  hook_caps="$(hook_capabilities "$binary_path" "$binary")"
  # Capability-aware analyzers preserve clean, finding, invalid, failed, and timeout states.
  if [[ -n "$hook_caps" ]]; then
    process_file_contract "$binary_path" "$binary" "$rel_path" "$target_root" "$target_rel_path" "$ranges"
    return 0
  fi

  help="$(analyse_help "$binary_path")"
  # A legacy analyzer without JSON cannot prove what happened to this edit.
  if ! supports_json_format "$help"; then
    record_file_result 80 "unavailable" "hook-unavailable" "analyzer-capability-unsupported" \
      "$binary does not expose JSON analysis output" "$rel_path" 0 0
    return 0
  fi
  uses_native_regions=0
  # Native changed-region support lets Gruff expand an edited line to its symbol.
  if supports_native_changed_regions "$help"; then
    uses_native_regions=1
  fi
  changed_scope="symbol"
  # A whole-file edit also needs file-level findings such as size or missing overview.
  if [[ "$ranges" == "$(all_file_range "$abs_path")" ]]; then
    changed_scope="file"
  fi

  set +e
  output="$(run_gruff_json "$binary_path" "$binary" "$help" "$target_rel_path" "$ranges" "$changed_scope" "$target_root")"
  status=$?
  set -e
  # A timeout is incomplete analysis even though the editing tool itself finished.
  if [[ "$status" -eq 124 || "$status" -eq 137 ]]; then
    record_file_result 70 "incomplete" "execution-timeout" "analyzer-timeout" \
      "$binary exceeded the configured feedback deadline" "$rel_path" 0 0
    return 0
  fi
  # Exit-zero silence is not evidence that a legacy analyzer completed cleanly.
  if [[ -z "$output" ]]; then
    record_file_result 60 "incomplete" "output-invalid" "analyzer-response-invalid" \
      "$binary returned no analysis result" "$rel_path" 0 0
    return 0
  fi
  # Non-JSON output cannot safely become a finding or clean state.
  if ! valid_gruff_json "$output"; then
    record_file_result 60 "incomplete" "output-invalid" "analyzer-response-invalid" \
      "$binary returned non-JSON analysis output after exit $status" "$rel_path" 0 0
    return 0
  fi

  config_error="$(config_error_message "$output")"
  # A rejected config explains why no reliable analysis reached the user.
  if [[ -n "$config_error" ]]; then
    record_file_result 80 "unavailable" "hook-unavailable" "analyzer-config-invalid" \
      "$config_error" "$rel_path" 0 0
    return 0
  fi
  ignored_desc="$(ignored_descriptor "$output" "$target_rel_path" "$abs_path")"
  # An analyzer-confirmed ignore is a verified not-applicable state, not a clean scan.
  if [[ -n "$ignored_desc" ]]; then
    record_file_result 20 "advisory" "findings-reported" "analysis-not-applicable" \
      "This file is $ignored_desc" "$rel_path" 1 1
    FILE_RESULT_BINARY="$binary"
    return 0
  fi

  max_findings="$GRUFF_CODE_QUALITY_MAX_FINDINGS"
  # Invalid user configuration falls back to the shared provider-safe cap.
  if ! [[ "$max_findings" =~ ^[0-9]+$ && "$max_findings" -ge 1 ]]; then
    max_findings=20
  fi
  floor_rank="$(min_severity_rank "$GRUFF_CODE_QUALITY_MIN_SEVERITY")"
  report_json="$(changed_findings_report "$output" "$target_rel_path" "$abs_path" "$ranges" "$floor_rank" "$max_findings" "$uses_native_regions")"
  # A failed projection is invalid analyzer output rather than a zero-finding result.
  if [[ -z "$report_json" ]]; then
    record_file_result 60 "incomplete" "output-invalid" "analyzer-response-invalid" \
      "$binary output could not be projected into bounded feedback" "$rel_path" 0 0
    return 0
  fi
  record_report_result "$report_json" "$rel_path" "$binary"
  return 0
}

# Read the provider's stable conversation identity for health deduplication.
# Use after a validated analyzer response; empty means the host supplied no session key.
payload_session_identifier() {
  local payload="$1"
  json_field "$payload" '
    [
      .session_id,
      .sessionId,
      .session.id,
      .conversation_id,
      .conversationId
    ] | map(select(type == "string" and length > 0)) | first
  '
}

# Announce analyzer health once per provider session, project, hook version, and day.
# Use only after schema-valid work; malformed markers are replaced and findings are
# never deduplicated, so a user sees every actionable result from later edits.
announce_verified_health() {
  local root="$1" payload="$2" binary="$3"
  local session_identifier health_day marker_directory identity checksum marker expected current
  session_identifier="$(payload_session_identifier "$payload")"
  # A host without session identity gets honest repeated health instead of a false dedupe.
  if [[ -z "$session_identifier" ]]; then
    printf 'gruff-code-quality: verified analyzer exchange (%s); session id unavailable, so health will be announced again.\n' "$binary" >&2
    return 0
  fi
  health_day="${GRUFF_CODE_QUALITY_HEALTH_DAY:-$(date -u +%F)}"
  marker_directory="$root/.goat-flow/logs/events"
  # An unwritable event directory cannot weaken the analyzer result already produced.
  if ! mkdir -p "$marker_directory" 2>/dev/null; then
    printf 'gruff-code-quality: verified analyzer exchange (%s); health marker could not be stored.\n' "$binary" >&2
    return 0
  fi
  identity="${session_identifier}|${root}|${HOOK_VERSION}|${health_day}"
  checksum="$(printf '%s' "$identity" | cksum | awk '{print $1}')"
  marker="$marker_directory/.gruff-hook-health.$checksum"
  printf -v expected 'schema=gruff-hook-health.v1\nsession=%s\nproject=%s\nhookVersion=%s\nday=%s\nbinary=%s\n' \
    "$session_identifier" "$root" "$HOOK_VERSION" "$health_day" "$binary"
  current=""
  # A well-formed matching marker means this session already saw verified health today.
  if [[ -f "$marker" ]]; then
    current="$(<"$marker")"$'\n'
    if [[ "$current" == "$expected" ]]; then
      return 0
    fi
  fi
  printf '%s' "$expected" > "$marker"
  printf 'gruff-code-quality: verified analyzer exchange (%s); health is current for this session.\n' "$binary" >&2
}

# Emit the bounded result the launcher validates before translating it for a provider.
# Use once per migrated invocation; even incomplete work produces one JSON object so
# the user can distinguish clean analysis from unavailable or partial coverage.
emit_hook_result() {
  local outcome="$1" coverage_status="$2" attempted_units="$3"
  local completed_units="$4" skipped_units="$5" reason_code="$6"
  local findings_json="$7" duration_ms="$8"
  local provider provider_mode adapter_version adapter_name event
  provider="${GOAT_FLOW_HOOK_PROVIDER:-claude}"
  provider_mode="${GOAT_FLOW_HOOK_PROVIDER_MODE:-managed}"
  adapter_version="${GOAT_FLOW_HOOK_ADAPTER_VERSION:-1}"
  event="${GOAT_FLOW_HOOK_EVENT:-post-tool}"
  adapter_name="${provider}-${event}"
  # jq is the same parser required for analyzer validation and safe JSON escaping.
  if command -v jq >/dev/null 2>&1; then
    jq -cn \
      --arg schema "$HOOK_RESULT_SCHEMA" \
      --arg hook_id "gruff-code-quality" \
      --arg event "$event" \
      --arg outcome "$outcome" \
      --arg coverage_status "$coverage_status" \
      --argjson attempted_units "$attempted_units" \
      --argjson completed_units "$completed_units" \
      --argjson skipped_units "$skipped_units" \
      --arg reason_code "$reason_code" \
      --argjson findings "$findings_json" \
      --arg hook_version "$HOOK_VERSION" \
      --arg provider "$provider" \
      --arg provider_mode "$provider_mode" \
      --arg adapter_name "$adapter_name" \
      --arg adapter_version "$adapter_version" \
      --argjson duration_ms "$duration_ms" '
        {
          schema: $schema,
          hookId: $hook_id,
          event: $event,
          outcome: $outcome,
          coverage: {
            status: $coverage_status,
            attemptedUnits: $attempted_units,
            completedUnits: $completed_units,
            skippedUnits: $skipped_units
          },
          reasonCode: $reason_code,
          findings: $findings,
          execution: {
            hookVersion: $hook_version,
            provider: $provider,
            providerMode: $provider_mode,
            adapterName: $adapter_name,
            adapterVersion: $adapter_version,
            durationMs: $duration_ms
          }
        }
      '
    return 0
  fi
  # A minimal fixed envelope keeps parser loss visible without interpolating unsafe text.
  printf '%s\n' '{"schema":"goat-flow.hook-result.v1","hookId":"gruff-code-quality","event":"post-tool","outcome":"unavailable","coverage":{"status":"none","attemptedUnits":0,"completedUnits":0,"skippedUnits":0},"reasonCode":"hook-unavailable","findings":[{"code":"result-parser-missing","message":"jq is unavailable, so Gruff could not emit validated feedback","target":"project"}],"execution":{"hookVersion":"1.15.1","provider":"claude","providerMode":"fallback","adapterName":"claude-post-tool","adapterVersion":"1","durationMs":0}}'
}

main() {
  local payload tool_name root file_path payload_paths all_payload_paths allow_cached_fallback
  local migrated_result_mode started_seconds duration_ms changed_paths git_status
  local attempted_units completed_units skipped_units coverage_status
  local best_priority best_outcome best_reason findings_json verified_exchange verified_binary
  local diagnostic_path
  local -a file_paths
  # Bare and explicit smoke forms give users the same safe installation check.
  if [[ "${1:-}" == "--self-test" || "${1:-}" == "--self-test=smoke" ]]; then
    self_test
    exit $?
  fi

  started_seconds="$SECONDS"
  migrated_result_mode=0
  # Managed launchers provide all four fields before requesting a neutral result.
  if [[ -n "${GOAT_FLOW_HOOK_PROVIDER:-}" && -n "${GOAT_FLOW_HOOK_EVENT:-}" && -n "${GOAT_FLOW_HOOK_PROVIDER_MODE:-}" && -n "${GOAT_FLOW_HOOK_ADAPTER_VERSION:-}" ]]; then
    migrated_result_mode=1
  fi
  payload="$(read_stdin)"
  tool_name="$(json_tool_name "$payload" || true)"
  # Restricted hosts may need the small direct-field fallback to identify the completed tool.
  [[ -n "$tool_name" ]] || tool_name="$(fallback_tool_name "$payload" || true)"
  # A missing tool identity is malformed because the hook cannot classify the event safely.
  if [[ -z "$tool_name" ]]; then
    if [[ "$migrated_result_mode" -eq 1 ]]; then
      duration_ms=$(( (SECONDS - started_seconds) * 1000 ))
      emit_hook_result "incomplete" "none" 0 0 0 "input-invalid" \
        '[{"code":"unsupported-tool-payload","message":"The completed tool did not identify a supported source edit","target":"project"}]' "$duration_ms"
    fi
    exit 0
  fi
  # Broad provider matchers also send valid non-edit events; complete their zero-unit scope silently.
  if ! supported_payload_tool "$tool_name" "$payload"; then
    if [[ "$migrated_result_mode" -eq 1 ]]; then
      duration_ms=$(( (SECONDS - started_seconds) * 1000 ))
      emit_hook_result "pass" "complete" 0 0 0 "completed-clean" '[]' "$duration_ms"
    fi
    exit 0
  fi

  root="$(repo_root)"
  # A vanished working directory cannot produce trustworthy project-relative feedback.
  if ! cd "$root"; then
    if [[ "$migrated_result_mode" -eq 1 ]]; then
      duration_ms=$(( (SECONDS - started_seconds) * 1000 ))
      emit_hook_result "unavailable" "none" 0 0 0 "hook-unavailable" \
        '[{"code":"project-root-unavailable","message":"The selected project root could not be opened","target":"project"}]' "$duration_ms"
    fi
    exit 0
  fi
  payload_paths="$(payload_supported_file_paths "$root" "$payload")"
  all_payload_paths="$(payload_file_paths "$payload")"
  allow_cached_fallback=0
  # Provider-declared source paths are the narrowest trustworthy edit scope.
  if [[ -n "$payload_paths" ]]; then
    mapfile -t file_paths <<< "$payload_paths"
  # A named non-source path must not fall back to unrelated dirty source files.
  elif [[ -n "$all_payload_paths" ]]; then
    if [[ "$migrated_result_mode" -eq 1 ]]; then
      duration_ms=$(( (SECONDS - started_seconds) * 1000 ))
      emit_hook_result "advisory" "complete" 0 0 0 "findings-reported" \
        '[{"code":"analysis-not-applicable","message":"The completed edit did not target a supported Gruff source file","target":"project"}]' "$duration_ms"
    fi
    exit 0
  else
    set +e
    changed_paths="$(git_changed_supported_paths "$root")"
    git_status=$?
    set -e
    # A failed fallback listing cannot safely choose a subset of dirty files.
    if [[ "$git_status" -ne 0 ]]; then
      if [[ "$migrated_result_mode" -eq 1 ]]; then
        duration_ms=$(( (SECONDS - started_seconds) * 1000 ))
        emit_hook_result "incomplete" "none" 0 0 0 "coverage-incomplete" \
          '[{"code":"git-scope-failed","message":"Git could not identify source files changed by this edit","target":"project"}]' "$duration_ms"
      fi
      exit 0
    fi
    # An empty successful listing means this tool changed no supported source file.
    if [[ -n "$changed_paths" ]]; then
      mapfile -t file_paths <<< "$changed_paths"
    fi
    allow_cached_fallback=1
  fi

  # No eligible source work is a complete zero-unit invocation, not an analyzer clean claim.
  if [[ "${#file_paths[@]}" -eq 0 ]]; then
    if [[ "$migrated_result_mode" -eq 1 ]]; then
      duration_ms=$(( (SECONDS - started_seconds) * 1000 ))
      emit_hook_result "pass" "complete" 0 0 0 "completed-clean" '[]' "$duration_ms"
    fi
    exit 0
  fi

  attempted_units="${#file_paths[@]}"
  completed_units=0
  best_priority=-1
  best_outcome="pass"
  best_reason="completed-clean"
  findings_json='[]'
  verified_exchange=0
  verified_binary=""
  for file_path in "${file_paths[@]}"; do
    # Migrated launches capture prose away from stdout, then aggregate the typed file result.
    if [[ "$migrated_result_mode" -eq 1 ]]; then
      diagnostic_path="$(mktemp)"
      process_file_result "$payload" "$root" "$file_path" "${#file_paths[@]}" "$allow_cached_fallback" >"$diagnostic_path" 2>&1
      # Operational detail remains visible without corrupting the one-object result channel.
      if [[ -s "$diagnostic_path" ]]; then
        cat "$diagnostic_path" >&2
      fi
      rm -f "$diagnostic_path"
      completed_units=$((completed_units + FILE_RESULT_COMPLETED))
      findings_json="$(jq -cn --argjson current "$findings_json" --argjson next "$FILE_RESULT_FINDINGS" '($current + $next)[:20]')"
      # The highest-priority state prevents one clean file from hiding another file's failure.
      if [[ "$FILE_RESULT_PRIORITY" -gt "$best_priority" ]]; then
        best_priority="$FILE_RESULT_PRIORITY"
        best_outcome="$FILE_RESULT_OUTCOME"
        best_reason="$FILE_RESULT_REASON_CODE"
      fi
      # One valid analyzer response is enough to establish health, never to widen coverage.
      if [[ "$FILE_RESULT_VERIFIED" -eq 1 ]]; then
        verified_exchange=1
        verified_binary="$FILE_RESULT_BINARY"
      fi
    else
      reset_file_result
      process_file "$payload" "$root" "$file_path" "${#file_paths[@]}" "$allow_cached_fallback"
      # Legacy users receive health only after the same run produced a validated response.
      if [[ "$FILE_RESULT_VERIFIED" -eq 1 ]]; then
        verified_exchange=1
        verified_binary="$FILE_RESULT_BINARY"
      fi
    fi
  done

  # Health follows verified analyzer work and never suppresses subsequent findings.
  if [[ "$verified_exchange" -eq 1 ]]; then
    announce_verified_health "$root" "$payload" "$verified_binary"
  fi
  # Legacy launchers keep their established text response while normal sync migrates registration.
  if [[ "$migrated_result_mode" -eq 0 ]]; then
    exit 0
  fi

  skipped_units=$((attempted_units - completed_units))
  coverage_status="none"
  # Completing every declared file is the only path to complete coverage.
  if [[ "$completed_units" -eq "$attempted_units" ]]; then
    coverage_status="complete"
  # Completing some files gives the user partial rather than all-or-nothing coverage.
  elif [[ "$completed_units" -gt 0 ]]; then
    coverage_status="partial"
  fi
  duration_ms=$(( (SECONDS - started_seconds) * 1000 ))
  emit_hook_result "$best_outcome" "$coverage_status" "$attempted_units" \
    "$completed_units" "$skipped_units" "$best_reason" "$findings_json" "$duration_ms"
  exit 0
}

main "$@"
