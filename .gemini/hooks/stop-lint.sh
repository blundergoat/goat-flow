#!/usr/bin/env bash
# AfterAgent hook: runs after every agent turn.
# MUST exit 0 even on errors (non-zero causes infinite loops).
# Errors go to stderr as informational feedback.

# Infinite loop guard
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

# Check which file types were modified
CHANGED_SH=$(git diff --name-only --diff-filter=ACMR HEAD 2>/dev/null | grep '\.sh$' || true)

# Shell scripts: syntax check + shellcheck
if [ -n "$CHANGED_SH" ]; then
  for f in $CHANGED_SH; do
    if [ -f "$f" ]; then
      # Syntax check
      if ! bash -n "$f" 2>/dev/null; then
        ERRORS="${ERRORS}Syntax error in $f\n"
      fi

      # Shellcheck (if available)
      if command -v shellcheck >/dev/null 2>&1; then
        SC_OUT=$(shellcheck "$f" 2>&1) || true
        if [ -n "$SC_OUT" ]; then
          ERRORS="${ERRORS}shellcheck issues in $f:\n${SC_OUT}\n"
        fi
      fi
    fi
  done
fi

# Report errors to stderr (informational, not imperative)
if [ -n "$ERRORS" ]; then
  echo -e "Stop hook found issues:\n$ERRORS" >&2
fi

# MUST exit 0 to prevent infinite loops
exit 0
