#!/usr/bin/env bash
# PostToolUse hook: auto-format changed files.
set -uo pipefail

INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)
[[ -z "$FILE" ]] && exit 0

case "$FILE" in
  *.ts|*.tsx|*.js|*.jsx|*.json|*.md)
    command -v prettier >/dev/null 2>&1 && prettier --write "$FILE" 2>/dev/null || true
    ;;
esac

exit 0
