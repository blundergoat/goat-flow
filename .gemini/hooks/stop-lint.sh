#!/usr/bin/env bash
# stop-lint.sh - Post-turn hook: runs lint/type checks after every agent turn.
# Advisory mode (default): reports errors, exits 0.
# Enforce mode: exits non-zero on errors (set GOAT_LINT_ENFORCE=1).
# Default stays advisory to prevent infinite fix loops.

# Infinite loop guard (convention from enforcement.md)
if [ "${STOP_HOOK_ACTIVE:-}" = "1" ]; then
  exit 0
fi
export STOP_HOOK_ACTIVE=1

ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -z "$ROOT" ]; then
  exit 0
fi

cd "$ROOT" || exit 0

ERRORS=""
ERROR_COUNT=0

# Check which file types were modified
CHANGED_SH=$(git diff --name-only --diff-filter=ACMR HEAD 2>/dev/null | grep '\.sh$') || CHANGED_SH=""
CHANGED_TS=$(git diff --name-only --diff-filter=ACMR HEAD 2>/dev/null | grep '\.ts$') || CHANGED_TS=""

# Shell scripts: syntax check + shellcheck
if [ -n "$CHANGED_SH" ]; then
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    if [ -f "$f" ]; then
      # Syntax check
      if ! bash -n "$f" 2>/dev/null; then
        ERRORS="${ERRORS}Syntax error in $f\n"
        ERROR_COUNT=$((ERROR_COUNT + 1))
      fi

      # Shellcheck (if available)
      if command -v shellcheck >/dev/null 2>&1; then
        if ! SC_OUT=$(shellcheck "$f" 2>&1); then
          ERRORS="${ERRORS}shellcheck issues in $f:\n${SC_OUT}\n"
          ERROR_COUNT=$((ERROR_COUNT + 1))
        fi
      fi
    fi
  done <<< "$CHANGED_SH"
fi

# TypeScript: type check (if tsc available and tsconfig exists)
if [ -n "$CHANGED_TS" ] && [ -f "tsconfig.json" ]; then
  if command -v npx >/dev/null 2>&1; then
    if ! TSC_OUT=$(npx tsc --noEmit 2>&1); then
      if [ -n "$TSC_OUT" ]; then
        ERRORS="${ERRORS}TypeScript errors:\n${TSC_OUT}\n"
        ERROR_COUNT=$((ERROR_COUNT + 1))
      fi
    fi
  fi
fi

# Report errors to stderr (informational by default)
if [ -n "$ERRORS" ]; then
  printf '%b' "Stop hook found issues:\n$ERRORS" >&2
fi

# Optional enforce mode
if [ "${GOAT_LINT_ENFORCE:-0}" = "1" ] && [ "$ERROR_COUNT" -gt 0 ]; then
  exit 1
fi

# Default advisory exit
exit 0
