#!/usr/bin/env bash
# SessionStart hook for Codex — injects project context at session start
set -uo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR" || exit 0

echo "PROJECT CONTEXT:"
echo "Modified files:" && git diff --name-only 2>/dev/null | head -20
echo "---"
cat tasks/todo.md 2>/dev/null || echo "No active tasks"
echo "---"
echo "Constraints: read AGENTS.md Autonomy Tiers before proceeding"
exit 0
