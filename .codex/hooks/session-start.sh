#!/usr/bin/env bash
# SessionStart hook for Codex - injects project context at session start
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR" || exit 0

echo "PROJECT CONTEXT:"
echo "Modified files:" && (git diff --name-only 2>/dev/null | head -20 || true)
echo "---"
echo "Check milestone files in .goat-flow/tasks/ for progress"
echo "---"
echo "Constraints: read AGENTS.md Autonomy Tiers before proceeding"
exit 0
