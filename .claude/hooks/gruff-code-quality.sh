#!/usr/bin/env bash

# gruff-code-quality.sh
#
# Purpose:
#   Optional PostToolUse hook that runs the matching gruff analyzer after
#   Edit / Write / MultiEdit and surfaces only findings tied to the lines
#   just changed. This keeps the quality feedback on the agent's current
#   work instead of forcing cleanup of unrelated debt elsewhere in the
#   same file.
#
# Supported analyzers:
#   - gruff-ts for .ts / .tsx / .js / .jsx
#   - gruff-php for .php
#   - gruff-go for .go
#   - gruff-rs for .rs
#   - gruff-py for .py
#
# Runtime contract:
#   Payload is read from stdin as agent PostToolUse JSON. The hook prefers
#   an edited file path from the payload, then falls back to git-changed
#   supported files for runtimes that only expose the completed file tool
#   event. It also needs a matching `.gruff-*.yaml` config at the repo root,
#   a matching gruff binary, and `jq` for JSON filtering. Missing
#   prerequisites fail soft: the edit is not blocked and whole-file gruff
#   output is not printed as a fallback.
#
# Changed-line model:
#   Prefer changed ranges from the PostToolUse payload when present.
#   Otherwise parse `git diff --unified=0 -- <file>` for tracked files.
#   New/untracked files are treated as fully changed. If no range can be
#   derived, the hook exits quietly apart from a short stderr diagnostic.
#
# Output:
#   Prints `[severity] path:line rule - message` for findings whose
#   primary reported line intersects the changed ranges, then one compact
#   suppressed-count line for same-file findings outside those ranges.
#   The playbook footer is printed only when at least one changed-line
#   finding is shown. Exit status stays 0 for analyzer findings and
#   fail-soft diagnostics.

set -euo pipefail

FOOTER="For triage: consult .goat-flow/skill-playbooks/gruff-code-quality.md"
SUPPORTED_TOOLS=" edit write multiedit write_to_file replace_file_content multi_replace_file_content "
SKIP_DIR_PATTERN='(^|/)(node_modules|vendor|\.goat-flow|dist|build|coverage|\.git)(/|$)'

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
  return 1
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

json_file_path() {
  local input="$1"
  json_field "$input" '
    def path_from(value):
      if value == null then
        empty
      elif (value | type) == "object" then
        (value.file_path // value.path // value.AbsolutePath // value.TargetFile // value.FilePath // value.SearchPath // empty)
      elif (value | type) == "string" then
        ((value | fromjson? // {})
        | if type == "object" then
            (.file_path // .path // .AbsolutePath // .TargetFile // .FilePath // .SearchPath // empty)
          else
            empty
          end)
      else
        empty
      end;

    [
      .tool_input.file_path,
      .tool_input.path,
      path_from(.toolCall.args),
      path_from(.toolArgs),
      path_from(.tool_args),
      .file_path,
      .path
    ] | map(select(type == "string" and length > 0)) | first
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

fallback_file_path() {
  local input="$1"
  if [[ "$input" =~ \"file_path\"[[:space:]]*:[[:space:]]*\"([^\"]+)\" ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
  elif [[ "$input" =~ \"path\"[[:space:]]*:[[:space:]]*\"([^\"]+)\" ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
  fi
}

supported_tool() {
  local tool_name="${1,,}"
  [[ "$SUPPORTED_TOOLS" == *" $tool_name "* ]]
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

variant_for_path() {
  local file_path="$1"
  case "${file_path##*.}" in
    ts|tsx|js|jsx) printf 'gruff-ts' ;;
    php) printf 'gruff-php' ;;
    go) printf 'gruff-go' ;;
    rs) printf 'gruff-rs' ;;
    py) printf 'gruff-py' ;;
    *) return 1 ;;
  esac
}

supported_candidate_path() {
  local file_path="$1"
  local binary
  [[ -n "$file_path" ]] || return 1
  [[ "$file_path" =~ $SKIP_DIR_PATTERN ]] && return 1
  binary="$(variant_for_path "$file_path" || true)"
  [[ -n "$binary" ]]
}

git_changed_supported_paths() {
  local root="$1"
  local rel_path
  {
    git -C "$root" diff --name-only --diff-filter=ACMR -- 2>/dev/null || true
    git -C "$root" ls-files --others --exclude-standard -- 2>/dev/null || true
  } | while IFS= read -r rel_path; do
    if supported_candidate_path "$rel_path"; then
      printf '%s\n' "$rel_path"
    fi
  done | awk '!seen[$0]++'
}

file_paths_for_payload() {
  local payload="$1"
  local root="$2"
  local file_path
  file_path="$(json_file_path "$payload")"
  [[ -n "$file_path" ]] || file_path="$(fallback_file_path "$payload")"
  if [[ -n "$file_path" ]]; then
    printf '%s\n' "$file_path"
    return
  fi
  git_changed_supported_paths "$root"
}

# Discovery covers package-manager installs, sibling gruff checkouts, root and
# one-level nested virtualenv/debug builds, user-local installs, and finally
# PATH. The nested virtualenv case supports project layouts such as
# `strands_agents/.venv/bin/gruff-py`.
discover_binary() {
  local root="$1"
  local binary="$2"
  local candidate
  for candidate in \
    "$root/vendor/bin/$binary" \
    "$root/node_modules/.bin/$binary" \
    "$root/bin/$binary" \
    "$root/.venv/bin/$binary" \
    "$root"/*/.venv/bin/"$binary" \
    "$root/target/debug/$binary" \
    "${HOME:-}/.local/bin/$binary"
  do
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
        ((.startLine // .start // .line) | tonumber) as $start
        | ((.endLine // .end // .line // $start) | tonumber) as $end
        | select($start > 0 and $end >= $start)
        | "\($start)-\($end)"
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
  local line ranges start count end
  local hunk_re='^@@ -[0-9]+(,[0-9]+)? \+([0-9]+)(,([0-9]+))? @@'
  ranges=""
  while IFS= read -r line; do
    if [[ "$line" =~ $hunk_re ]]; then
      start="${BASH_REMATCH[2]}"
      count="${BASH_REMATCH[4]}"
      [[ -n "$count" ]] || count=1
      [[ "$count" -eq 0 ]] && continue
      end=$((start + count - 1))
      ranges="${ranges}${ranges:+,}${start}-${end}"
    fi
  done <<< "$diff_output"
  printf '%s' "$ranges"
}

git_diff_ranges() {
  local root="$1"
  local rel_path="$2"
  local abs_path="$3"
  local diff_output
  if ! git -C "$root" ls-files --error-unmatch -- "$rel_path" >/dev/null 2>&1; then
    [[ -f "$abs_path" ]] && all_file_range "$abs_path"
    return
  fi
  diff_output="$(git -C "$root" diff --unified=0 -- "$rel_path" 2>/dev/null || true)"
  parse_diff_ranges "$diff_output"
}

changed_ranges() {
  local payload="$1"
  local root="$2"
  local rel_path="$3"
  local abs_path="$4"
  local ranges
  ranges="$(payload_ranges "$payload")"
  if [[ -n "$ranges" ]]; then
    printf '%s' "$ranges"
    return
  fi
  git_diff_ranges "$root" "$rel_path" "$abs_path"
}

# Analyzer invocation adapts to the two flag families currently used by the
# gruff CLIs: long GNU-style flags (`--format json`) and Go-style single-dash
# flags (`-format json`). Findings never cause a non-zero hook exit.
analyse_help() {
  local binary_path="$1"
  "$binary_path" analyse --help 2>&1 || true
}

supports_json_format() {
  local help="$1"
  [[ "$help" == *"--format"* || "$help" == *"-format"* ]]
}

run_gruff_json() {
  local binary_path="$1"
  local help="$2"
  local file_path="$3"
  local args
  args=(analyse)
  if [[ "$help" == *"--format"* ]]; then
    args+=(--format json)
    if [[ "$help" == *"--fail-on"* ]]; then
      args+=(--fail-on none)
    fi
  elif [[ "$help" == *"-format"* ]]; then
    args+=(-format json)
  else
    return 64
  fi

  if command -v timeout >/dev/null 2>&1; then
    timeout 30 "$binary_path" "${args[@]}" "$file_path" 2>&1
    return $?
  fi
  "$binary_path" "${args[@]}" "$file_path" 2>&1
}

valid_gruff_json() {
  local output="$1"
  printf '%s' "$output" | jq -e 'type == "object" and (.findings | type == "array")' >/dev/null 2>&1
}

# Report filtering accepts the JSON shapes emitted across gruff-ts, gruff-go,
# gruff-php, gruff-py, and gruff-rs: path may be `filePath`, `file`, or
# `path`; line may be `line`, `location.line`, or `location.startLine`.
filter_findings() {
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

    (.findings // [])
    | map(. as $finding | ($finding | line_or_null) as $line | select(($finding | same_file) and $line != null and in_changed_ranges($line)))
    | .[]
    | line_or_null as $line
    | "[\(.severity // "unknown")] \(finding_path):\($line) \(.ruleId // "unknown-rule") - \(.message // "")"
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

process_file() {
  local payload="$1"
  local root="$2"
  local file_path="$3"
  local rel_path abs_path binary binary_path config_file
  local ranges help output status changed_output suppressed

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
  [[ -f "$config_file" ]] || return 0

  binary_path="$(discover_binary "$root" "$binary")"
  [[ -n "$binary_path" ]] || return 0

  if ! command -v jq >/dev/null 2>&1; then
    printf 'gruff-code-quality: jq unavailable; changed-line filtering skipped\n' >&2
    return 0
  fi

  ranges="$(changed_ranges "$payload" "$root" "$rel_path" "$abs_path")"
  if [[ -z "$ranges" ]]; then
    printf 'gruff-code-quality: no changed lines detected for %s; skipping gruff output\n' "$rel_path" >&2
    return 0
  fi

  help="$(analyse_help "$binary_path")"
  if ! supports_json_format "$help"; then
    printf 'gruff-code-quality: %s does not expose JSON output; changed-line filtering skipped\n' "$binary" >&2
    return 0
  fi

  set +e
  output="$(run_gruff_json "$binary_path" "$help" "$rel_path")"
  status=$?
  set -e

  if [[ "$status" -eq 124 ]]; then
    printf 'gruff-code-quality: %s crashed or timed out\n' "$binary" >&2
    return 0
  fi
  if [[ -z "$output" ]]; then
    return 0
  fi
  if ! valid_gruff_json "$output"; then
    printf 'gruff-code-quality: %s produced non-JSON output; changed-line filtering skipped\n' "$binary" >&2
    return 0
  fi

  # MVP range model: enforce findings whose primary line intersects edited lines.
  # Wider function-block expansion is deferred unless an analyzer reports new
  # method findings only on unchanged declaration lines.
  changed_output="$(filter_findings "$output" "$rel_path" "$abs_path" "$ranges")"
  suppressed="$(suppressed_count "$output" "$rel_path" "$abs_path" "$ranges")"
  if [[ -n "$changed_output" ]]; then
    printf '%s\n' "$changed_output"
  fi
  if [[ "$suppressed" =~ ^[0-9]+$ && "$suppressed" -gt 0 ]]; then
    printf 'gruff-code-quality: suppressed %s pre-existing finding(s) outside changed lines\n' "$suppressed"
  fi
  if [[ -n "$changed_output" ]]; then
    printf '%s\n' "$FOOTER"
  fi
  return 0
}

main() {
  local payload tool_name root file_path
  local -a file_paths
  payload="$(read_stdin)"
  tool_name="$(json_tool_name "$payload")"
  [[ -n "$tool_name" ]] || tool_name="$(fallback_tool_name "$payload")"
  supported_tool "$tool_name" || exit 0

  root="$(repo_root)"
  mapfile -t file_paths < <(file_paths_for_payload "$payload" "$root")
  [[ "${#file_paths[@]}" -gt 0 ]] || exit 0

  for file_path in "${file_paths[@]}"; do
    process_file "$payload" "$root" "$file_path"
  done
  exit 0
}

main "$@"
