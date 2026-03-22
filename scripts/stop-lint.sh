#!/usr/bin/env bash
# Post-turn verification for Codex
# Checks changed files for lint/type issues after each agent turn
# MUST exit 0 — non-zero causes infinite retry loops

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR" || exit 0

# Get changed files
changed_ts=$(git diff --name-only --diff-filter=ACMR 2>/dev/null | grep '\.ts$' || true)
changed_sh=$(git diff --name-only --diff-filter=ACMR 2>/dev/null | grep '\.sh$' || true)

# Shellcheck on changed .sh files
if [[ -n "$changed_sh" ]] && command -v shellcheck >/dev/null 2>&1; then
    echo "$changed_sh" | xargs shellcheck --exclude=SC2001 2>&1 || true
fi

# Typecheck if TypeScript files changed
if [[ -n "$changed_ts" ]] && [[ -f tsconfig.json ]]; then
    npx tsc --noEmit 2>&1 | head -20 || true
fi

exit 0
