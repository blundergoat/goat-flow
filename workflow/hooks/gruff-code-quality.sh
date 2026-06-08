#!/usr/bin/env bash

# gruff-code-quality.sh
# goat-flow-hook-version: 1.10.1
#
# Purpose:
#   Optional PostToolUse hook that runs the matching gruff analyzer after
#   a file edit (Edit / Write, or a multi-file edit payload) and surfaces only
#   findings tied to the lines just changed. This keeps the quality feedback on
#   the agent's current work instead of forcing cleanup of unrelated debt
#   elsewhere in the same file.
#
# Supported analyzers:
#   - gruff-ts for .ts / .tsx / .mts / .cts / .js / .jsx / .mjs / .cjs
#   - gruff-php for .php
#   - gruff-go for .go
#   - gruff-rs for .rs
#   - gruff-py for .py
#
# Runtime contract:
#   Payload is read from stdin as agent PostToolUse JSON. The hook prefers
#   an edited file path from the payload, then falls back to git-changed
#   supported files for runtimes that only expose the completed file tool
#   event. It also needs a matching `.gruff-*.yaml` or `.gruff-*.yml` config at
#   the repo root, a matching gruff binary, and `jq` for JSON filtering. Missing
#   prerequisites fail soft: the edit is not blocked and whole-file gruff
#   output is not printed as a fallback.
#
# Changed-line model:
#   Prefer changed ranges from the PostToolUse payload when present.
#   Otherwise parse `git diff HEAD --unified=0 -- <file>` for tracked files,
#   falling back to the index diff only on unborn branches with no HEAD.
#   New/untracked files are treated as fully changed. If no range can be
#   derived, the hook exits quietly apart from a short stderr diagnostic.
#   Analyzers with native changed-region support own the filtering: any analyzer
#   advertising `--changed-ranges`, `--changed-scope`, and `--no-baseline` is
#   invoked with those flags so symbol-aware scope is used and adoption baselines
#   do not hide agent feedback. Other analyzers use the portable primary-line
#   fallback above. Either way the surfaced findings are severity-sorted,
#   floored, and capped identically.
#
# Output:
#   Prints a scope/tally header
#   `gruff-code-quality: <binary> <path> changed-lines=<ranges>; <n> on changed
#   lines: <e> error, <w> warning, <a> advisory`, then one canonical finding line
#   per surfaced finding `- [severity] file:line ruleId - message` (matching
#   gruff's native CLI per-finding line so hook and analyzer output read
#   identically). Findings on changed lines are sorted error -> warning ->
#   advisory so the highest-value land first; they are floored at
#   GRUFF_CODE_QUALITY_MIN_SEVERITY (default advisory) and capped at
#   GRUFF_CODE_QUALITY_MAX_FINDINGS (default 20) with a "(<m> more on changed
#   lines)" note when the cap hides some. A trailing line reports findings dropped
#   below the floor and the count of same-file findings outside the changed
#   ranges. The playbook footer is printed only when at least one changed-line
#   finding is shown. If the analyzer reports the edited file as ignored by
#   its `paths.ignore` config, the hook instead prints a single
#   `skipped <path> - out of scope` line and surfaces no findings, so the
#   agent does not try to fix a file the project deliberately excludes. Exit
#   status stays 0 for analyzer findings and fail-soft diagnostics.

set -euo pipefail

# Bash 4.4+ required - the same baseline the deny-dangerous guard enforces. This
# hook uses declare -A (capability cache), mapfile (main), and ${var,,} case-folding;
# on bash 3.2 (notably macOS /bin/bash) those fail mid-run with a cryptic error.
# Detect the unsupported shell up front and fail soft (exit 0, the hook's standard
# "skipped" disposition) with the same guidance deny-dangerous gives.
if (( BASH_VERSINFO[0] < 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] < 4) )); then
  printf 'gruff-code-quality: requires bash 4.4+ (got %s); skipped. On macOS install Homebrew bash and invoke /usr/local/bin/bash or /opt/homebrew/bin/bash explicitly.\n' "${BASH_VERSION:-unknown}" >&2
  exit 0
fi

FOOTER="For triage: consult .goat-flow/skill-docs/playbooks/gruff-code-quality.md"
SUPPORTED_TOOLS=" edit write multiedit write_to_file replace_file_content multi_replace_file_content "
SKIP_DIR_PATTERN='(^|/)(node_modules|vendor|\.goat-flow|dist|build|coverage|\.git|target|\.venv|\.mypy_cache|\.pytest_cache|\.ruff_cache)(/|$)'
GRUFF_CODE_QUALITY_TIMEOUT_SECONDS="${GRUFF_CODE_QUALITY_TIMEOUT_SECONDS:-30}"
# Max changed-line findings listed per file before the rest are summarised as
# "(<m> more on changed lines)". Keeps a large edit from flooding the agent.
GRUFF_CODE_QUALITY_MAX_FINDINGS="${GRUFF_CODE_QUALITY_MAX_FINDINGS:-20}"
# Lowest severity surfaced on changed lines (advisory|warning|error). Findings
# below it are counted, not listed - a project that only wants the agent pushed on
# warning+ sets this to `warning`. Default `advisory` keeps every finding visible.
GRUFF_CODE_QUALITY_MIN_SEVERITY="${GRUFF_CODE_QUALITY_MIN_SEVERITY:-advisory}"
# Per-binary cache of gruff.hook.v1 capabilities JSON ("" = analyzer is pre-contract).
declare -A HOOK_CAPS_CACHE

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
    ts|tsx|mts|cts|js|jsx|mjs|cjs) printf 'gruff-ts' ;;
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
    git -C "$root" diff --cached --name-only --diff-filter=ACMR -- 2>/dev/null || true
    git -C "$root" ls-files --others --exclude-standard -- 2>/dev/null || true
  } | while IFS= read -r rel_path; do
    if supported_candidate_path "$rel_path"; then
      printf '%s\n' "$rel_path"
    fi
  done | awk '!seen[$0]++'
}

payload_file_paths() {
  local payload="$1"
  local paths
  paths="$(json_file_paths "$payload" || true)"
  [[ -n "$paths" ]] || paths="$(fallback_file_paths "$payload")"
  if [[ -n "$paths" ]]; then
    printf '%s\n' "$paths" | awk 'length($0) && !seen[$0]++'
  fi
}

# Discovery covers each ecosystem's standard install location - package-manager
# bin dirs (vendor/bin for composer, node_modules/.bin for npm), an in-repo bin/,
# the root virtualenv (.venv/bin), user-local installs (~/.local/bin), and finally
# PATH. It deliberately excludes a `*/.venv/bin` subdirectory glob and the
# `target/debug` build-output dir: auto-executing a name-matched binary from an
# arbitrary subtree or build artifact on every edit is RCE-shaped for little gain.
discover_binary() {
  local root="$1"
  local binary="$2"
  local candidate
  for candidate in \
    "$root/vendor/bin/$binary" \
    "$root/node_modules/.bin/$binary" \
    "$root/bin/$binary" \
    "$root/.venv/bin/$binary" \
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
  local allow_cached_fallback="${4:-1}"
  local diff_output
  if ! git -C "$root" ls-files --error-unmatch -- "$rel_path" >/dev/null 2>&1; then
    if [[ -f "$abs_path" ]]; then
      all_file_range "$abs_path"
    fi
    return
  fi
  if git -C "$root" rev-parse --verify --quiet HEAD >/dev/null 2>&1; then
    diff_output="$(git -C "$root" diff HEAD --unified=0 -- "$rel_path" 2>/dev/null || true)"
  else
    diff_output="$(git -C "$root" diff --unified=0 -- "$rel_path" 2>/dev/null || true)"
    if [[ -z "$diff_output" && "$allow_cached_fallback" -eq 1 ]]; then
      diff_output="$(git -C "$root" diff --cached --unified=0 -- "$rel_path" 2>/dev/null || true)"
    fi
  fi
  parse_diff_ranges "$diff_output"
}

changed_ranges() {
  local payload="$1"
  local root="$2"
  local rel_path="$3"
  local abs_path="$4"
  local file_count="${5:-1}"
  local allow_cached_fallback="${6:-1}"
  local ranges
  # Payload changed_ranges is a single flat list with no per-file attribution.
  # Trust it only for single-file edits; multi-file payloads derive per-file
  # ranges from git so one file's ranges are not applied to every file.
  if [[ "$file_count" -le 1 ]]; then
    ranges="$(payload_ranges "$payload")"
    if [[ -n "$ranges" ]]; then
      printf '%s' "$ranges"
      return
    fi
  fi
  git_diff_ranges "$root" "$rel_path" "$abs_path" "$allow_cached_fallback"
}

self_test() {
  local payload paths ranges variant report_output report_json first_line
  local help_full help_missing counts
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
  [[ -z "$(changed_ranges "$payload" "/nonexistent" "src/a.mts" "/nonexistent/src/a.mts" 2)" ]] || {
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

  [[ "$(GRUFF_CODE_QUALITY_TIMEOUT_SECONDS=bogus normalized_timeout_seconds)" == "30" \
     && "$(GRUFF_CODE_QUALITY_TIMEOUT_SECONDS=0 normalized_timeout_seconds)" == "30" \
     && "$(GRUFF_CODE_QUALITY_TIMEOUT_SECONDS='' normalized_timeout_seconds)" == "30" \
     && "$(GRUFF_CODE_QUALITY_TIMEOUT_SECONDS=45 normalized_timeout_seconds)" == "45" ]] || {
    printf 'gruff-code-quality self-test: timeout normalization failed\n' >&2
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
  local timeout_seconds="${GRUFF_CODE_QUALITY_TIMEOUT_SECONDS:-}"
  if ! [[ "$timeout_seconds" =~ ^[0-9]+$ ]] || [[ "$timeout_seconds" -lt 1 ]]; then
    timeout_seconds=30
  fi
  printf '%s' "$timeout_seconds"
}

run_gruff_json() {
  local binary_path="$1"
  local help="$2"
  local file_path="$3"
  local ranges="$4"
  local args timeout_seconds
  args=(analyse)
  if [[ "$help" == *"--format"* ]]; then
    args+=(--format json)
    if [[ "$help" == *"--fail-on"* ]]; then
      args+=(--fail-on none)
    fi
    if supports_native_changed_regions "$help"; then
      args+=(--no-baseline --changed-ranges "$ranges" --changed-scope symbol)
    fi
  elif [[ "$help" == *"-format"* ]]; then
    args+=(-format json)
  else
    return 64
  fi

  timeout_seconds="$(normalized_timeout_seconds)"

  if command -v timeout >/dev/null 2>&1; then
    timeout "$timeout_seconds" "$binary_path" "${args[@]}" "$file_path" 2>&1
    return $?
  fi
  "$binary_path" "${args[@]}" "$file_path" 2>&1
}

valid_gruff_json() {
  local output="$1"
  printf '%s' "$output" | jq -e 'type == "object" and (.findings | type == "array")' >/dev/null 2>&1
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

print_scope_header() {
  local binary="$1"
  local rel_path="$2"
  local ranges="$3"
  local total="$4"
  local err="$5"
  local warn="$6"
  local adv="$7"
  printf 'gruff-code-quality: %s %s changed-lines=%s; %s on changed lines: %s error, %s warning, %s advisory\n' \
    "$binary" "$rel_path" "$ranges" "$total" "$err" "$warn" "$adv"
}

# Probe a binary's gruff.hook.v1 capabilities once per binary (cached for the
# run). Returns the capabilities JSON when the binary advertises contractVersion
# "gruff.hook.v1", else empty - the caller then uses the legacy analyse path, so
# a pre-contract analyzer is unaffected.
hook_capabilities() {
  local binary_path="$1"
  if [[ -n "${HOOK_CAPS_CACHE[$binary_path]+x}" ]]; then
    printf '%s' "${HOOK_CAPS_CACHE[$binary_path]}"
    return 0
  fi
  local caps="" probe
  if command -v jq >/dev/null 2>&1; then
    if command -v timeout >/dev/null 2>&1; then
      probe="$(timeout "$(normalized_timeout_seconds)" "$binary_path" hook --capabilities --format json 2>/dev/null || true)"
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
  local output="$1" floor_rank="$2" max="$3"
  printf '%s' "$output" | jq -c --argjson floor_rank "$floor_rank" --argjson max "$max" '
    def sev_rank($s):
      ($s | tostring | ascii_downcase) as $x
      | if $x == "error" then 3 elif $x == "warning" then 2 else 1 end;
    [ (.findings // [])[]
      | { sev: ((.severity // "advisory") | tostring | ascii_downcase),
          rank: sev_rank(.severity // ""),
          file: (.file // .filePath // .path // ""),
          line: (if ((.scope // "line") == "file" or (.scope // "line") == "project")
                 then null else (.line // null) end),
          ruleId: (.ruleId // "unknown-rule"),
          message: (.message // "") } ] as $all
    | ($all | sort_by([ (3 - .rank), .file, (.line // 0), .ruleId ])) as $sorted
    | [ $sorted[] | select(.rank >= $floor_rank) ] as $surfaced
    | { total: ($all | length),
        e: ([ $all[] | select(.rank == 3) ] | length),
        w: ([ $all[] | select(.rank == 2) ] | length),
        a: ([ $all[] | select(.rank == 1) ] | length),
        surfaced: ($surfaced | length),
        floored: (($all | length) - ($surfaced | length)),
        more: (if ($surfaced | length) > $max then ($surfaced | length) - $max else 0 end),
        lines: [ limit($max; $surfaced[])
                 | "- [\(.sev)] \(.file)\(if .line != null then ":" + (.line | tostring) else "" end) \(.ruleId) - \(.message)" ] }
  ' 2>/dev/null || true
}

# Contract path: the analyzer owns scoping/metadata/remediation/new-only; the
# hook calls `<binary> hook --format json --changed-ranges <ranges> <file>` and
# renders the envelope. Relays config-schema errors (B8) and ignore verdicts
# (B7) from the envelope, then prints the same scope header / findings / footer
# as the legacy path. Findings never set a non-zero exit.
process_file_contract() {
  local binary_path="$1" binary="$2" rel_path="$3" ranges="$4" caps="$5"
  local cr_flag output status timeout_seconds report_json suppressed
  local config_ok config_error ignored_match scope_fields
  local max_findings floor_rank total err warn adv surfaced floored more

  cr_flag="$(printf '%s' "$caps" | jq -r '.flags.changedRanges // "--changed-ranges"' 2>/dev/null || true)"
  [[ -n "$cr_flag" ]] || cr_flag="--changed-ranges"
  timeout_seconds="$(normalized_timeout_seconds)"

  # Scope to the changed lines and let the analyzer return the attributable
  # findings. Capture stdout ONLY: the gruff.hook.v1 envelope is JSON on stdout,
  # and any analyzer/git diagnostics on stderr (e.g. "path not in HEAD") would
  # corrupt the JSON if merged in. New-only file/project surfacing via `--diff`
  # is intentionally NOT requested here: a single `--diff` pass also new-only-
  # filters line/symbol findings, hiding pre-existing findings on the very lines
  # the agent edited (confirmed across all five analyzers). See M02 for the
  # scope-specific combined-mode fix that re-enables it.
  set +e
  if command -v timeout >/dev/null 2>&1; then
    output="$(timeout "$timeout_seconds" "$binary_path" hook --format json "$cr_flag" "$ranges" "$rel_path" 2>/dev/null)"
  else
    output="$("$binary_path" hook --format json "$cr_flag" "$ranges" "$rel_path" 2>/dev/null)"
  fi
  status=$?
  set -e

  if [[ "$status" -eq 124 || "$status" -eq 137 ]]; then
    printf 'gruff-code-quality: %s hook exceeded %ss or was killed; skipped\n' "$binary" "$timeout_seconds" >&2
    return 0
  fi
  [[ -n "$output" ]] || return 0
  # Accept any well-formed envelope: a findings array (normal), a config object
  # (B8 schema error, which a port may emit without findings), or an ignored
  # object (B7 verdict, likewise). Requiring `.findings` here would let a port
  # that omits it on a config error or ignore verdict swallow that signal.
  if ! printf '%s' "$output" | jq -e 'type == "object" and ((.findings | type == "array") or (.config | type == "object") or (.ignored | type == "object"))' >/dev/null 2>&1; then
    printf 'gruff-code-quality: %s hook returned non-JSON; skipped\n' "$binary" >&2
    return 0
  fi

  config_ok="$(printf '%s' "$output" | jq -r 'if (.config.schemaOk == false) then "false" else "true" end' 2>/dev/null || true)"
  if [[ "$config_ok" == "false" ]]; then
    config_error="$(printf '%s' "$output" | jq -r '.config.error // "project gruff config rejected"' 2>/dev/null || true)"
    printf 'gruff-code-quality: %s could not analyse %s - %s\n' "$binary" "$rel_path" "${config_error:-project gruff config rejected}"
    return 0
  fi

  # Match the ignored entry against the edited file the same way the legacy
  # ignored_descriptor does: normalize slashes and a leading ./, read the entry
  # path from `.path` or `.file`, and accept an exact or trailing-segment match
  # so a port that echoes ./src/x.ts, a back-slashed path, or an absolute path
  # still resolves to the edited file.
  ignored_match="$(printf '%s' "$output" | jq -r --arg p "$rel_path" 'def norm: tostring | gsub("\\\\"; "/") | sub("^\\./"; ""); ($p | norm) as $rel | first((.ignored.paths // [])[] | ((.path? // .file? // "") | norm) as $ip | select($ip == $rel or ($ip | endswith("/" + $rel))) | (.source // "config") + (if (.pattern // "") != "" then " " + .pattern else "" end)) // empty' 2>/dev/null || true)"
  if [[ -n "$ignored_match" ]]; then
    printf 'gruff-code-quality: skipped %s %s - ignored by %s; out of scope, do not modify to satisfy gruff.\n' "$binary" "$rel_path" "$ignored_match"
    return 0
  fi

  max_findings="$GRUFF_CODE_QUALITY_MAX_FINDINGS"
  [[ "$max_findings" =~ ^[0-9]+$ && "$max_findings" -ge 1 ]] || max_findings=20
  floor_rank="$(min_severity_rank "$GRUFF_CODE_QUALITY_MIN_SEVERITY")"

  report_json="$(hook_v1_report "$output" "$floor_rank" "$max_findings")"
  [[ -n "$report_json" ]] || report_json='{"total":0,"e":0,"w":0,"a":0,"surfaced":0,"floored":0,"more":0,"lines":[]}'
  suppressed="$(printf '%s' "$output" | jq -r '.suppressed.count // 0' 2>/dev/null || true)"
  [[ "$suppressed" =~ ^[0-9]+$ ]] || suppressed=0

  scope_fields="$(printf '%s' "$report_json" | jq -r '[.total,.e,.w,.a,.surfaced,.floored,.more] | @tsv' 2>/dev/null || true)"
  IFS=$'\t' read -r total err warn adv surfaced floored more <<< "$scope_fields"
  [[ "$total" =~ ^[0-9]+$ ]] || total=0
  [[ "$surfaced" =~ ^[0-9]+$ ]] || surfaced=0
  [[ "$floored" =~ ^[0-9]+$ ]] || floored=0
  [[ "$more" =~ ^[0-9]+$ ]] || more=0

  if [[ "$total" -gt 0 || "$suppressed" -gt 0 ]]; then
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
  if [[ "$suppressed" -gt 0 ]]; then
    printf 'gruff-code-quality: suppressed %s finding(s) outside the changed scope\n' "$suppressed"
  fi
  if [[ "$surfaced" -gt 0 ]]; then
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
  local rel_path abs_path binary binary_path config_file
  local ranges help output status suppressed ignored_desc uses_native_regions
  local max_findings floor_rank report_json scope_fields
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
  [[ -n "$binary_path" ]] || return 0

  if ! command -v jq >/dev/null 2>&1; then
    printf 'gruff-code-quality: jq unavailable; changed-line filtering skipped\n' >&2
    return 0
  fi

  ranges="$(changed_ranges "$payload" "$root" "$rel_path" "$abs_path" "$file_count" "$allow_cached_fallback")"
  if [[ -z "$ranges" ]]; then
    printf 'gruff-code-quality: no changed lines detected for %s; skipping gruff output\n' "$rel_path" >&2
    return 0
  fi

  # Contract path: when the analyzer advertises gruff.hook.v1 it owns changed-region
  # scoping, scope tagging, metadata, remediation and new-only - the hook only
  # renders. Pre-contract analyzers fall through to the legacy analyse path below.
  local hook_caps
  hook_caps="$(hook_capabilities "$binary_path")"
  if [[ -n "$hook_caps" ]]; then
    process_file_contract "$binary_path" "$binary" "$rel_path" "$ranges" "$hook_caps"
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

  set +e
  output="$(run_gruff_json "$binary_path" "$help" "$rel_path" "$ranges")"
  status=$?
  set -e

  if [[ "$status" -eq 124 || "$status" -eq 137 ]]; then
    printf 'gruff-code-quality: %s exceeded %ss or was killed; changed-line filtering skipped\n' "$binary" "$(normalized_timeout_seconds)" >&2
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

  # If gruff reports the edited file as ignored by config (`paths.ignore`), tell
  # the agent it is out of scope and stop - never surface findings for a file the
  # project deliberately excludes. The verdict is gruff's own (`ignoredPaths`);
  # the hook does not re-derive ignore rules. No-op on gruff binaries that still
  # bypass `paths.ignore` for explicitly-passed files.
  ignored_desc="$(ignored_descriptor "$output" "$rel_path" "$abs_path")"
  if [[ -n "$ignored_desc" ]]; then
    printf 'gruff-code-quality: skipped %s %s - %s; out of scope, do not modify to satisfy gruff.\n' "$binary" "$rel_path" "$ignored_desc"
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
    printf '%s\n' "$FOOTER"
  fi
  return 0
}

main() {
  local payload tool_name root file_path payload_paths allow_cached_fallback
  local -a file_paths
  if [[ "${1:-}" == "--self-test=smoke" ]]; then
    self_test
    exit $?
  fi

  payload="$(read_stdin)"
  tool_name="$(json_tool_name "$payload" || true)"
  [[ -n "$tool_name" ]] || tool_name="$(fallback_tool_name "$payload" || true)"
  supported_tool "$tool_name" || exit 0

  root="$(repo_root)"
  cd "$root" || exit 0
  payload_paths="$(payload_file_paths "$payload")"
  allow_cached_fallback=0
  if [[ -n "$payload_paths" ]]; then
    mapfile -t file_paths <<< "$payload_paths"
  else
    mapfile -t file_paths < <(git_changed_supported_paths "$root")
    allow_cached_fallback=1
  fi
  [[ "${#file_paths[@]}" -gt 0 ]] || exit 0

  for file_path in "${file_paths[@]}"; do
    process_file "$payload" "$root" "$file_path" "${#file_paths[@]}" "$allow_cached_fallback"
  done
  exit 0
}

main "$@"
