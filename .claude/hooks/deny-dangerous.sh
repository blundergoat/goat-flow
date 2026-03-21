#!/usr/bin/env bash
# PreToolUse hook: blocks dangerous commands before execution.
# Exit 0 = allow, Exit 2 = block (stderr shown as reason).

set -uo pipefail

# Read tool input from stdin
INPUT=$(cat)

# Extract the command from the tool input
COMMAND=$(echo "$INPUT" | grep -oP '"command"\s*:\s*"([^"]*)"' | head -1 | sed 's/"command"\s*:\s*"//;s/"$//' 2>/dev/null || echo "$INPUT")

block() {
  echo "BLOCKED: $1" >&2
  exit 2
}

# rm -rf without scoping
echo "$COMMAND" | grep -qP 'rm\s+-[a-zA-Z]*r[a-zA-Z]*f|rm\s+-[a-zA-Z]*f[a-zA-Z]*r' && \
  echo "$COMMAND" | grep -qvP 'rm\s+-rf\s+\./|rm\s+-rf\s+[a-zA-Z]' && \
  block "rm -rf without safe scoping"

# Direct push to main/master
echo "$COMMAND" | grep -qiP 'git\s+push\s+.*\b(main|master)\b' && \
  block "Direct push to main/master"

# Force push
echo "$COMMAND" | grep -qP 'git\s+push\s+.*--force' && \
  block "git push --force"

# chmod 777
echo "$COMMAND" | grep -qP 'chmod\s+777' && \
  block "chmod 777"

# Pipe to shell
echo "$COMMAND" | grep -qP 'curl\s.*\|\s*(ba)?sh|wget\s.*\|\s*(ba)?sh' && \
  block "pipe-to-shell (curl|bash)"

# .env modifications
echo "$COMMAND" | grep -qP '(>|>>|tee|sed\s+-i|nano|vim?|code)\s+.*\.env\b' && \
  block ".env file modification"

# --no-verify bypass
echo "$COMMAND" | grep -qP 'git\s+.*--no-verify' && \
  block "git --no-verify (hook bypass)"

# Lockfile modifications
echo "$COMMAND" | grep -qP '(>|>>|tee|sed\s+-i)\s+.*(package-lock\.json|pnpm-lock\.yaml|composer\.lock|Cargo\.lock|yarn\.lock)' && \
  block "Lockfile modification"

# Generated code / migration modifications
echo "$COMMAND" | grep -qP '(>|>>|tee|sed\s+-i)\s+.*(\.generated\.|\.g\.|migrations/)' && \
  block "Generated code / migration modification"

# mv without -n (no-clobber) — can silently overwrite destination
echo "$COMMAND" | grep -qP '^\s*mv\s+' && \
  ! echo "$COMMAND" | grep -qP 'mv\b.*\s(-[^\s]*n[^\s]*|--no-clobber)\b' && \
  block "Use 'mv -n' instead of 'mv' to prevent overwriting existing files"

# All clear
exit 0
