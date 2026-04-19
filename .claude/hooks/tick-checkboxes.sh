#!/usr/bin/env bash
# =============================================================================
# tick-checkboxes.sh - PostToolUse hook: nudges when milestone-file edits
# don't tick a `- [x]` in the change.
# =============================================================================
# Event:  PostToolUse (Claude)
# Match:  Edit, Write, NotebookEdit
# Exit 0: always (non-blocking advisory). Writes a reminder to stderr when the
#         edit targets a milestone file but contains no `- [x]`.
#
# Addresses the x4 recurrence documented in .goat-flow/lessons/verification.md
# "Agent doesn't tick milestone checkboxes". Documentation-level rules have
# failed for this pattern; this hook nudges at the moment of the edit.
#
# Install (Claude): copy to .claude/hooks/tick-checkboxes.sh
# Register in .claude/settings.json:
#   "PostToolUse": [{ "matcher": "Edit|Write|NotebookEdit", "hooks": [{
#     "type": "command",
#     "command": "bash \"$(git rev-parse --show-toplevel)/.claude/hooks/tick-checkboxes.sh\""
#   }]}]
# =============================================================================
set -uo pipefail

# --- JSON Input Parsing ------------------------------------------------------
INPUT=""
SELF_TEST=0
if [[ "${1:-}" == "--self-test" ]]; then
  SELF_TEST=1
  shift
else
  INPUT=$(cat 2>/dev/null || true)
fi

# --- Core detection ----------------------------------------------------------
# Returns "nudge" or "silent" for a given JSON payload.
classify() {
  local payload="$1"

  local tool_name
  tool_name=$(printf '%s' "$payload" | sed -n 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
  case "$tool_name" in
    Edit | Write | NotebookEdit) ;;
    *)
      echo "silent"
      return
      ;;
  esac

  # Extract file_path; fall back to notebook_path for NotebookEdit.
  local file_path
  file_path=$(printf '%s' "$payload" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
  if [[ -z "$file_path" ]]; then
    file_path=$(printf '%s' "$payload" | sed -n 's/.*"notebook_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
  fi
  if [[ -z "$file_path" ]]; then
    echo "silent"
    return
  fi

  # Match milestone-file pattern: .goat-flow/tasks/<plan>/M*.md
  case "$file_path" in
    *.goat-flow/tasks/*/M*.md) ;;
    *)
      echo "silent"
      return
      ;;
  esac

  # A literal `[x]` anywhere in the payload counts as a tick, tolerant of JSON
  # escaping. False negatives (missing nudge when a tick happened inside an
  # unrelated code example) are preferable to false positives because the hook
  # is non-blocking advisory; either way nothing breaks.
  if printf '%s' "$payload" | grep -qF '[x]'; then
    echo "silent"
    return
  fi

  echo "nudge"
}

# --- Self-test ---------------------------------------------------------------
run_self_test() {
  local failures=0

  run_case() {
    local name="$1"
    local payload="$2"
    local expected="$3" # nudge | silent
    local got
    got=$(classify "$payload")
    if [[ "$got" != "$expected" ]]; then
      failures=$((failures + 1))
      echo "FAIL [${name}]: expected ${expected}, got ${got}" >&2
    fi
  }

  run_case "edit milestone without tick" \
    '{"tool_name":"Edit","tool_input":{"file_path":".goat-flow/tasks/1.2.0/M01-foo.md","new_string":"## Assumption\nNew stuff"}}' \
    "nudge"

  run_case "edit milestone with tick" \
    '{"tool_name":"Edit","tool_input":{"file_path":".goat-flow/tasks/1.2.0/M01-foo.md","new_string":"- [x] done"}}' \
    "silent"

  run_case "edit non-milestone file" \
    '{"tool_name":"Edit","tool_input":{"file_path":"src/cli/cli.ts","new_string":"const x = 1;"}}' \
    "silent"

  run_case "write milestone without tick" \
    '{"tool_name":"Write","tool_input":{"file_path":".goat-flow/tasks/1.2.0/M01-foo.md","content":"# M01\n- [ ] open"}}' \
    "nudge"

  run_case "write milestone with tick" \
    '{"tool_name":"Write","tool_input":{"file_path":".goat-flow/tasks/1.2.0/M01-foo.md","content":"# M01\n- [x] done"}}' \
    "silent"

  run_case "notebook edit with tick" \
    '{"tool_name":"NotebookEdit","tool_input":{"notebook_path":".goat-flow/tasks/1.2.0/M02.md","new_source":"- [x] cell updated"}}' \
    "silent"

  run_case "bash command ignored" \
    '{"tool_name":"Bash","tool_input":{"command":"echo hi"}}' \
    "silent"

  run_case "read ignored" \
    '{"tool_name":"Read","tool_input":{"file_path":".goat-flow/tasks/1.2.0/M01-foo.md"}}' \
    "silent"

  run_case "absolute path to milestone" \
    '{"tool_name":"Edit","tool_input":{"file_path":"/home/user/project/.goat-flow/tasks/1.2.0/M03-bar.md","new_string":"note"}}' \
    "nudge"

  run_case "milestone-shaped non-milestone path" \
    '{"tool_name":"Edit","tool_input":{"file_path":"docs/Migration.md","new_string":"note"}}' \
    "silent"

  if [[ "$failures" -eq 0 ]]; then
    echo "PASS: tick-checkboxes.sh self-test"
    exit 0
  else
    echo "FAIL: $failures tick-checkboxes self-test case(s) failed" >&2
    exit 1
  fi
}

if [[ "$SELF_TEST" == "1" ]]; then
  run_self_test
fi

# --- Runtime -----------------------------------------------------------------
[[ -z "$INPUT" ]] && exit 0

verdict=$(classify "$INPUT")
if [[ "$verdict" == "silent" ]]; then
  exit 0
fi

cat >&2 <<'EOF'
[tick-checkboxes] Reminder: milestone file edited with no `- [x]` in the change.
If you completed a task, tick it NOW before continuing. If this edit was adding
a new task, updating assumptions, or restructuring the file, ignore this nudge.
See .goat-flow/lessons/verification.md (recurrence x4) for context.
EOF
exit 0
