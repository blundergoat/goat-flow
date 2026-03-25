#!/usr/bin/env bash
# PreToolUse hook: blocks dangerous commands before execution.
# Exit 0 = allow, Exit 2 = block (stderr shown as reason).
set -uo pipefail

INPUT=$(cat)

# Parse command from JSON using jq (falls back to raw input if jq unavailable)
if command -v jq >/dev/null 2>&1; then
  COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || echo "$INPUT")
else
  # Fallback: extract with sed (less reliable but portable)
  COMMAND=$(echo "$INPUT" | sed -n 's/.*"command"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)
  [[ -z "$COMMAND" ]] && COMMAND="$INPUT"
fi

block() {
  echo "BLOCKED: $1" >&2
  exit 2
}

check_segment() {
  local cmd="$1"

  # rm -rf without scoping (handles both -rf and -fr flag order)
  if [[ "$cmd" =~ rm[[:space:]]+-[a-zA-Z]*r[a-zA-Z]*f|rm[[:space:]]+-[a-zA-Z]*f[a-zA-Z]*r ]]; then
    if ! [[ "$cmd" =~ rm[[:space:]]+-(rf|fr)[[:space:]]+(\./|[a-zA-Z]) ]]; then
      block "rm -rf without safe scoping"
    fi
  fi

  # Direct push to main/master (case-insensitive via lowercased copy)
  local cmd_lower="${cmd,,}"
  if [[ "$cmd_lower" =~ git[[:space:]]+push[[:space:]]+.*(main|master) ]]; then
    block "Direct push to main/master"
  fi

  # Force push
  if [[ "$cmd" =~ git[[:space:]]+push[[:space:]]+.*--force ]]; then
    block "git push --force"
  fi

  # chmod 777
  if [[ "$cmd" =~ chmod[[:space:]]+777 ]]; then
    block "chmod 777"
  fi

  # Pipe to shell
  if [[ "$cmd" =~ (curl|wget)[^|]*\|[[:space:]]*(ba)?sh ]]; then
    block "pipe-to-shell (curl|bash)"
  fi

  # .env modifications (matches .env, .env.local, .env.production, etc.)
  if [[ "$cmd" =~ (\>|\>\>|tee|sed[[:space:]]+-i|nano|vim?|code)[[:space:]]+.*\.env($|[[:space:]]|\.) ]]; then
    block ".env file modification"
  fi

  # --no-verify bypass
  if [[ "$cmd" =~ git[[:space:]]+.*--no-verify ]]; then
    block "git --no-verify (hook bypass)"
  fi

  # Lockfile modifications
  if [[ "$cmd" =~ (\>|\>\>|tee|sed[[:space:]]+-i)[[:space:]]+.*(package-lock\.json|pnpm-lock\.yaml|composer\.lock|Cargo\.lock|yarn\.lock) ]]; then
    block "Lockfile modification"
  fi

  # Generated code / migration modifications
  if [[ "$cmd" =~ (\>|\>\>|tee|sed[[:space:]]+-i)[[:space:]]+.*(\.generated\.|\.g\.|migrations/) ]]; then
    block "Generated code / migration modification"
  fi

  # mv without -n (no-clobber) -- can silently overwrite destination
  if [[ "$cmd" =~ ^[[:space:]]*mv[[:space:]]+ ]]; then
    if ! [[ "$cmd" =~ mv.*[[:space:]](-[^[:space:]]*n[^[:space:]]*|--no-clobber)([[:space:]]|$) ]]; then
      block "Use 'mv -n' instead of 'mv' to prevent overwriting existing files"
    fi
  fi
}

# Split on command chaining operators and check each segment
IFS=$'\n' read -r -d '' -a segments < <(echo "$COMMAND" | sed 's/&&/\n/g; s/||/\n/g; s/;/\n/g' && printf '\0') || true

for segment in "${segments[@]}"; do
  segment=$(echo "$segment" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  [[ -z "$segment" ]] && continue
  check_segment "$segment"
done

exit 0
