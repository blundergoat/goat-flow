#!/usr/bin/env bash
# =============================================================================
# check-markdown-links.sh - Verify relative markdown links resolve
# =============================================================================
# Finds [text](path) links in markdown files and checks that targets exist.
# Skips URLs, anchors, mailto links, fenced code blocks, archived/task files,
# logs, and scratchpad source material.
#
# Usage: bash scripts/check-markdown-links.sh [root-dir]
# Exit:  0 if all links resolve, 1 if broken links found.
# =============================================================================
set -euo pipefail

ROOT="${1:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$ROOT"

broken=0
checked=0

# Find markdown files in shipped directories.
# Skip: _archived, tasks/logs (local working state), scratchpad source
# material, node_modules, .git
files_with_links=$(find docs/ workflow/setup/ workflow/skills/ .goat-flow/ \
  -name '*.md' \
  -not -path '.goat-flow/plans/*' \
  -not -path '.goat-flow/logs/*' \
  -not -path '.goat-flow/scratchpad/*' \
  -not -path '*/_archived/*' \
  -not -path '*/node_modules/*' \
  -not -path '*/.git/*' \
  2>/dev/null | sort)

for file in $files_with_links; do
  # Extract lines with [text](path), excluding lines inside fenced code blocks
  # and inline-code spans. Two-pass: first strip fenced-block interior lines,
  # then grep for link patterns.
  # SC2016: single-quoted backtick regex is intentional, not a variable expansion.
  # shellcheck disable=SC2016
  matches=$(awk '
    /^```/ || /^~~~/ { in_fence = !in_fence; next }
    in_fence { next }
    /\[[^\]]*\]\([^)]+\)/ { print NR ":" $0 }
  ' "$file" 2>/dev/null \
    | grep -vP '^\d+:.*`[^`]*\[[^\]]*\]\([^)]+\)[^`]*`' || true)

  [[ -z "$matches" ]] && continue

  dir=$(dirname "$file")

  while IFS=: read -r lineno rest; do
    [[ -z "$rest" ]] && continue

    while IFS= read -r target; do
      [[ -z "$target" ]] && continue

      # Skip URLs, anchors, mailto, data URIs
      case "$target" in
        http://*|https://*|ftp://*|mailto:*|\#*|data:*) continue ;;
      esac

      # Strip anchor from path
      target_path="${target%%#*}"
      [[ -z "$target_path" ]] && continue

      resolved="$dir/$target_path"
      checked=$((checked + 1))
      if [[ ! -e "$resolved" ]]; then
        echo "BROKEN  $file:$lineno → $target_path"
        broken=$((broken + 1))
      fi
    done < <(echo "$rest" | grep -oP '\[(?:[^\]]*)\]\(\K[^)]+' 2>/dev/null || true)

  done <<< "$matches"
done

if [[ "$broken" -gt 0 ]]; then
  echo ""
  echo "Found $broken broken link(s) across $checked checked."
  exit 1
fi

echo "All $checked markdown links resolve."
exit 0
