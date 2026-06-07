#!/usr/bin/env bash
#
# fix-bucket-frontmatter.sh
#
# Purpose:
#   Repair missing `last_reviewed` frontmatter and `**Status:**` entry lines
#   in `.goat-flow/learning-loop/footguns/*.md` and `.goat-flow/learning-loop/lessons/*.md`. Idempotent:
#   re-running leaves already-compliant files untouched.
#
# Context:
#   Shipping goat-flow v1.2.0 consumer migrations surfaced n=3 projects
#   (ambient-scribe, sus-form-detector, blundergoat-platform, rampart) whose
#   bucket files had only `category:` in frontmatter and no `Status` field on
#   footgun entries. `goat-flow stats --check` fails on missing
#   `last_reviewed`. This script is the one-shot repair so those projects
#   and goat-flow itself conform to the v1.2 format.
#   Keep this parser aligned with stats frontmatter validation rules.
#
# Usage:
#   bash scripts/maintenance/fix-bucket-frontmatter.sh [--dry-run] [PROJECT_DIR]
#
# Behaviour:
#   - PROJECT_DIR defaults to the current working directory (`.`).
#   - Touches only `.goat-flow/learning-loop/footguns/*.md` and `.goat-flow/learning-loop/lessons/*.md`.
#   - README.md files inside those dirs are skipped (templates, not buckets).
#   - Adds `last_reviewed: <today>` to bucket frontmatter when absent.
#   - Inserts `**Status:** active | **Created:** <frontmatter-date-or-today> | **Evidence:** OBSERVED`
#     as the first non-blank line of every `## Footgun:` block that lacks a
#     `**Status:**` marker. Lesson entries are not auto-prefixed (Status is
#     required on footguns only; optional on lessons per the bucket contract).
#   - --dry-run prints what would change without writing.
#
# Exit:
#   0 when every candidate file is clean after the pass (or already clean).
#   Non-zero on IO failures or if a file could not be parsed.
#
# Requirements:
#   - bash 4+, awk, sed, date

set -euo pipefail

DRY_RUN=0
PROJECT_DIR="."
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    *) PROJECT_DIR="$arg" ;;
  esac
done

if [[ ! -d "$PROJECT_DIR/.goat-flow" ]]; then
  echo "error: $PROJECT_DIR has no .goat-flow/ directory" >&2
  exit 2
fi

TODAY="$(date -u +%Y-%m-%d)"
CHANGED=0

# Add `last_reviewed: <today>` inside the YAML frontmatter block when absent.
# Operates on a single file. Returns 0 if the file was rewritten, 1 otherwise.
add_last_reviewed() {
  local file="$1"
  if ! head -n1 "$file" | grep -qE '^---$'; then
    # No frontmatter block at top. Skip without error - bucket is malformed
    # in a different way that the content-quality audit will flag.
    return 1
  fi
  if grep -qE '^last_reviewed:' "$file"; then
    return 1
  fi
  local tmp
  tmp="$(mktemp)"
  awk -v today="$TODAY" '
    BEGIN { in_fm = 0; added = 0 }
    NR == 1 && /^---$/ { in_fm = 1; print; next }
    in_fm && /^---$/ {
      if (!added) {
        print "last_reviewed: " today
        added = 1
      }
      in_fm = 0
      print
      next
    }
    { print }
  ' "$file" > "$tmp"
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "  [dry-run] would add last_reviewed: $TODAY to $file"
    rm -f "$tmp"
  else
    mv "$tmp" "$file"
    echo "  + added last_reviewed: $TODAY to $file"
  fi
  return 0
}

# Inject `**Status:** active | **Created:** ... | **Evidence:** OBSERVED` as the
# first non-blank line after every `## Footgun:` heading that lacks an existing
# `**Status:**` line. Preserves all other content. Idempotent - re-running
# a file with Status already present returns 1 (no change).
#
# Only `## Footgun:` sections get injection; other headings (like
# `## Resolved Entries`) are treated as end-of-footgun boundaries only.
inject_status_on_footguns() {
  local file="$1"
  if ! grep -qE '^## Footgun:' "$file"; then
    return 1
  fi
  local tmp
  tmp="$(mktemp)"
  awk -v today="$TODAY" '
    # Emit buffered footgun section. If seen_status is false, inject Status
    # immediately after the heading (idx 0). Returns nothing.
    function flush_footgun() {
      for (i = 0; i < buf_len; i++) {
        print buf[i]
        if (i == 0 && !seen_status) {
          print ""
          print "**Status:** active | **Created:** " today " | **Evidence:** OBSERVED"
          rewritten = 1
        }
      }
      buf_len = 0
      seen_status = 0
      in_footgun = 0
    }
    BEGIN { in_footgun = 0; buf_len = 0; seen_status = 0; rewritten = 0 }
    /^## Footgun:/ {
      if (in_footgun) flush_footgun()
      in_footgun = 1
      buf[buf_len++] = $0
      seen_status = 0
      next
    }
    # Any other level-2 heading ends the current footgun (if any) and is
    # printed verbatim. Covers `## Resolved Entries`, `## Notes`, etc.
    /^## / {
      if (in_footgun) flush_footgun()
      print
      next
    }
    in_footgun {
      if ($0 ~ /^\*\*Status:\*\*/) seen_status = 1
      buf[buf_len++] = $0
      next
    }
    { print }
    END {
      if (in_footgun) flush_footgun()
      exit rewritten ? 0 : 1
    }
  ' "$file" > "$tmp"
  local changed=$?
  if [[ $changed -ne 0 ]]; then
    rm -f "$tmp"
    return 1
  fi
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "  [dry-run] would inject **Status:** active into footgun entries in $file"
    rm -f "$tmp"
  else
    mv "$tmp" "$file"
    echo "  + injected **Status:** active into footgun entries in $file"
  fi
  return 0
}

process_bucket() {
  local file="$1"
  local base
  base="$(basename "$file")"
  if [[ "$base" == "README.md" ]]; then
    return 0
  fi

  if add_last_reviewed "$file"; then
    CHANGED=$((CHANGED + 1))
  fi
  if [[ "$file" == *"/footguns/"* ]]; then
    if inject_status_on_footguns "$file"; then
      CHANGED=$((CHANGED + 1))
    fi
  fi
}

echo "Repairing bucket frontmatter + Status fields in $PROJECT_DIR"
echo "Today: $TODAY | dry-run: $([[ $DRY_RUN -eq 1 ]] && echo yes || echo no)"
echo

for dir in "$PROJECT_DIR/.goat-flow/learning-loop/footguns" "$PROJECT_DIR/.goat-flow/learning-loop/lessons"; do
  if [[ ! -d "$dir" ]]; then
    continue
  fi
  while IFS= read -r -d '' file; do
    process_bucket "$file"
  done < <(find "$dir" -maxdepth 1 -type f -name '*.md' -print0)
done

echo
if [[ $CHANGED -eq 0 ]]; then
  echo "All bucket files already compliant."
else
  echo "$CHANGED change(s) applied. Re-run \`goat-flow stats --check\` to verify."
fi
