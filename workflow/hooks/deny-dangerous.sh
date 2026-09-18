#!/usr/bin/env bash
# shellcheck disable=SC2034,SC2317,SC2319
# goat-flow-hook-version: 1.17.0
# deny-dangerous.sh: destructive shell and secret-path policy.
#
# The entrypoint fixes policy ownership; the target project supplies the shared parser.
# Use before an agent runs a shell or file request so unsafe work receives the provider's expected refusal.

set -uo pipefail
readonly GOAT_GUARD_NAME="deny-dangerous.sh"
readonly GOAT_GUARD_SCOPE="deny-dangerous"
readonly GOAT_GUARD_ENTRYPOINT="${BASH_SOURCE[0]}"
GOAT_DENY_DANGEROUS_ORIGINAL_ARGS=("$@")
unset GOAT_ACTIVE_GUARD_SCOPE

# Quote the startup-repair message for JSON providers so the user receives a readable denial even without the shared parser.
deny_dangerous_json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "$value"
}

# Decide whether startup failure may read a provider payload; explicit check and self-test requests must retain their CLI response.
deny_dangerous_startup_payload_available() {
  local arg
  # A CLI classification or self-test option means stdin is not a provider request to decode.
  for arg in "${GOAT_DENY_DANGEROUS_ORIGINAL_ARGS[@]}"; do
    case "$arg" in
      --self-test|--self-test=*|--check|--check=*)
        return 1
        ;;
    esac
  done
  [[ ! -t 0 ]]
}

# Deny startup when the policy runtime is missing or unusable; show setup-repair guidance using the provider's response format.
deny_dangerous_unavailable() {
  local detail="$1"
  local message payload escaped
  message="Policy hook unavailable: $GOAT_GUARD_NAME cannot start: $detail. Re-run goat-flow setup so .goat-flow/hooks/deny-dangerous is installed and tracked."
  payload=""
  # A provider request identifies its denial format; CLI checks report startup failure on stderr instead.
  if deny_dangerous_startup_payload_available; then
    payload="$(cat || true)"
  fi
  escaped="$(deny_dangerous_json_escape "$message")"
  # Copilot needs explicit permission-denial JSON so startup failure cannot silently allow the request.
  if [[ "$payload" == *'"toolName"'* && "$payload" != *'"tool_name"'* ]]; then
    printf '{"permissionDecision":"deny","permissionDecisionReason":"%s"}\n' "$escaped"
    exit 0
  fi
  # Antigravity needs its own denial shape with the same setup-repair guidance.
  if [[ "$payload" == *'"toolCall"'* ]]; then
    printf '{"decision":"deny","reason":"%s"}\n' "$escaped"
    exit 0
  fi
  printf '%s\n' "$message" >&2
  exit 2
}


# An older Bash cannot run the policy parser, so refuse startup and show the user the required version.
if (( BASH_VERSINFO[0] < 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] < 4) )); then
  deny_dangerous_unavailable "requires bash 4.4+ (got ${BASH_VERSION:-unknown}); install a supported Bash"
fi
GOAT_GUARD_SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$GOAT_GUARD_ENTRYPOINT")" && pwd)"
# Without a Git root, only a recognized hook location can identify the selected project's policy store.
if ! GOAT_FLOW_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || [[ -z "$GOAT_FLOW_ROOT" ]]; then
  case "$GOAT_GUARD_SCRIPT_DIR" in
    */.goat-flow/hooks|*/workflow/hooks)
      GOAT_FLOW_ROOT="$(CDPATH='' cd -- "$GOAT_GUARD_SCRIPT_DIR/../.." && pwd)" ||
        deny_dangerous_unavailable "cannot locate the policy store"
      ;;
    *) deny_dangerous_unavailable "git repository root unavailable and script path does not locate a valid policy store" ;;
  esac
fi
readonly GOAT_FLOW_ROOT
readonly GOAT_HOOK_LIB_DIR="$GOAT_FLOW_ROOT/.goat-flow/hooks/deny-dangerous"
[[ -r "$GOAT_HOOK_LIB_DIR/guard-runtime.sh" ]] ||
  deny_dangerous_unavailable "missing required policy runtime $GOAT_HOOK_LIB_DIR/guard-runtime.sh"
# shellcheck disable=SC1090,SC1091
source "$GOAT_HOOK_LIB_DIR/guard-runtime.sh" ||
  deny_dangerous_unavailable "failed to load policy runtime $GOAT_HOOK_LIB_DIR/guard-runtime.sh"
deny_dangerous_unavailable "policy runtime returned without a decision"
