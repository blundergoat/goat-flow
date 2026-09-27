#!/usr/bin/env bash
# npm-publish.sh
#
# Purpose:
#   Release goat-flow to npm with a preflight check and human confirmation.
#
# Usage:
#   bash scripts/npm-publish.sh
#
# Behavior:
#   1) reads package.json version and selects interactive 2FA or a bypass token
#   2) runs `npm run publish:check` once - the single expensive gate
#      (versions, instruction parity, build, package links, fast + slow tests)
#   3) prints an --ignore-scripts dry-run summary and records the tarball
#      shasum
#   4) asks for manual confirmation, re-probes the shasum so the approved
#      bytes are provably what ships, then publishes with --ignore-scripts.
#      A failed interactive 2FA attempt can be retried without repeating checks
#      (prepublishOnly already ran as step 2; rerunning it would repeat
#      the full release check against an unchanged tree)
#
# Exit:
#   0 if published or explicitly aborted; non-zero on failed checks, package
#   contents changed after confirmation, or failed publish.
#
# Requirements:
#   - node, npm
#   - package.json and build/test scripts configured for the project
#   - npm authentication from `npm login`, npm user config, NPM_TOKEN, or
#     NODE_AUTH_TOKEN. This script treats the latter two as token aliases;
#     NPM_TOKEN wins if both are set. Environment tokens are placed in a
#     temporary npm config that is removed on exit.
#   - For interactive 2FA, enable account 2FA for authorization and writes.
#     For token-only publishing, use a granular token with package publish
#     permission and Bypass 2FA enabled. Never commit a token-bearing .npmrc.
set -euo pipefail

# Publish @blundergoat/goat-flow to npm
# Usage: bash scripts/npm-publish.sh

PACKAGE_NAME="@blundergoat/goat-flow"
REGISTRY_URL="https://registry.npmjs.org/"
AUTH_SOURCE=""
AUTH_MODE=""
TEMP_NPMRC=""

cleanup() {
  if [[ -n "$TEMP_NPMRC" && -f "$TEMP_NPMRC" ]]; then
    rm -f -- "$TEMP_NPMRC"
  fi
}
trap cleanup EXIT

print_auth_instructions() {
  local reason="$1"

  printf 'Error: %s\n' "$reason" >&2
  cat >&2 <<'EOF'

Interactive 2FA: enable "authorization and writes" for your npm account,
  then run `npm login --auth-type=web` and rerun this script without token
  environment overrides:

    env -u NPM_TOKEN -u NODE_AUTH_TOKEN bash scripts/npm-publish.sh

  Enter a fresh authenticator code when asked, after the release check.

Token-only publishing: create a granular token with "Read and write (publish
  and stage)" for @blundergoat/goat-flow and "Bypass 2FA" enabled. Set it as
  NPM_TOKEN, or store it in your npm user config. NODE_AUTH_TOKEN is an alias;
  this script accepts either name, and you only need one. Do not commit a
  token-bearing .npmrc.
EOF
}

configure_token_from_env() {
  local token_source=""
  local token_value=""

  if [[ -n "${NPM_TOKEN:-}" ]]; then
    token_source="NPM_TOKEN"
    token_value="$NPM_TOKEN"
  elif [[ -n "${NODE_AUTH_TOKEN:-}" ]]; then
    token_source="NODE_AUTH_TOKEN"
    token_value="$NODE_AUTH_TOKEN"
  else
    return 1
  fi

  TEMP_NPMRC=$(mktemp)
  chmod 0600 "$TEMP_NPMRC"
  {
    printf 'registry=%s\n' "$REGISTRY_URL"
    printf '//registry.npmjs.org/:_authToken=%s\n' "$token_value"
  } >"$TEMP_NPMRC"

  export NPM_CONFIG_USERCONFIG="$TEMP_NPMRC"
  AUTH_SOURCE="$token_source"
}

trim_output() {
  tr -d '\r' | awk '{$1=$1; print}'
}

# Shasum of the tarball npm would publish from the current tree.
# Probed before and after the confirmation prompt: npm tarballs are
# content-derived (internal mtimes are fixed), so equal shasums prove the
# publish ships exactly the bytes the dry run displayed. The JSON travels as
# an argument, not a pipe, so a failed npm probe aborts under `set -e`
# instead of feeding the parser an empty stream.
pack_shasum() {
  local pack_json
  pack_json=$(npm pack --dry-run --json --ignore-scripts 2>/dev/null)
  node -e "const raw = process.argv[1]; const records = raw ? JSON.parse(raw) : []; const shasum = records[0]?.shasum ?? ''; if (!shasum) { console.error('npm pack reported no shasum'); process.exit(1); } console.log(shasum);" "$pack_json"
}

verify_publish_auth() {
  local npm_user
  local tfa_mode

  echo "--- Auth check ---"
  if configure_token_from_env; then
    echo "Using ${AUTH_SOURCE} via temporary npm config."
  fi

  if ! npm_user=$(npm whoami --registry="$REGISTRY_URL" 2>/dev/null); then
    print_auth_instructions "npm is not authenticated for ${REGISTRY_URL}."
    exit 1
  fi

  echo "Logged in as: ${npm_user}"

  echo "Credential source: ${AUTH_SOURCE:-npm config or npm login}"
  echo "This script accepts NPM_TOKEN or NODE_AUTH_TOKEN for the same npm token; NPM_TOKEN takes priority."
  echo "Choose how this publish will satisfy npm's 2FA requirement:"
  echo "  1) Enter a fresh 2FA code after the release check (default)"
  echo "  2) Use a token with Bypass 2FA enabled"
  read -rp "Authentication method [1/2, default 1]: " auth_choice
  case "$auth_choice" in
    "" | 1) AUTH_MODE="otp" ;;
    2) AUTH_MODE="token" ;;
    *) printf 'Error: choose 1 or 2.\n' >&2; exit 1 ;;
  esac

  if [[ "$AUTH_MODE" == "token" ]]; then
    echo "The token must have publish permission for ${PACKAGE_NAME} and Bypass 2FA enabled."
    echo ""
    return 0
  fi

  if ! tfa_mode=$(npm profile get "two-factor auth" --registry="$REGISTRY_URL" 2>/dev/null | trim_output); then
    print_auth_instructions "unable to verify npm account 2FA before the release check."
    exit 1
  fi

  if [[ -z "$tfa_mode" ]]; then
    print_auth_instructions "npm did not report an account 2FA mode."
    exit 1
  fi

  echo "Account 2FA mode: ${tfa_mode}"
  if [[ "$tfa_mode" != *auth-and-writes ]]; then
    print_auth_instructions "interactive publishing requires account 2FA for authorization and writes."
    exit 1
  fi

  echo "A fresh 2FA code will be requested immediately before publishing."
  echo ""
}

VERSION=$(node -p "require('./package.json').version")
echo "Publishing ${PACKAGE_NAME}@${VERSION}"
verify_publish_auth

# The single expensive gate. Runs directly (not under `npm publish`) so test
# output streams live and no npm_config_* lifecycle environment reaches the
# suites; the publish calls below pass --ignore-scripts so prepublishOnly
# cannot rerun the same checks against the unchanged tree.
echo "--- Publish check ---"
echo "Running the full release gate, including the serial slow test suite."
check_started=$SECONDS
npm run publish:check
check_elapsed=$((SECONDS - check_started))
printf 'Release check passed in %dm %ds.\n' "$((check_elapsed / 60))" "$((check_elapsed % 60))"
echo ""

# Tarball preview only; the gate above already validated this exact tree.
echo "--- Dry run ---"
npm publish --dry-run --ignore-scripts --access public --registry="$REGISTRY_URL"
echo ""

approved_shasum=$(pack_shasum)
echo "Tarball shasum locked for confirmation: ${approved_shasum}"

read -rp "Publish v${VERSION} to npm? (y/N) " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "Aborted."
  exit 0
fi

# Retry only the publish request after an OTP failure. Every attempt rechecks
# the approved tarball; changed bytes require a fresh full release check.
while true; do
  current_shasum=$(pack_shasum)
  if [[ "$current_shasum" != "$approved_shasum" ]]; then
    printf 'Error: package contents changed since the dry run (shasum %s -> %s). Re-run the script.\n' \
      "$approved_shasum" "$current_shasum" >&2
    exit 1
  fi

  if [[ "$AUTH_MODE" == "otp" ]]; then
    read -rsp "Current npm 2FA code (Enter for npm's own prompt): " otp
    printf '\n'
    if [[ -n "$otp" ]]; then
      if NPM_CONFIG_OTP="$otp" npm publish --ignore-scripts --access public --registry="$REGISTRY_URL"; then
        break
      fi
    elif npm publish --ignore-scripts --access public --registry="$REGISTRY_URL"; then
      break
    fi
    otp=""
    read -rp "Publish failed. If the error above was a 2FA code rejection, retry with a fresh code? (y/N) " retry
    if [[ "$retry" != "y" && "$retry" != "Y" ]]; then
      exit 1
    fi
  else
    npm publish --ignore-scripts --access public --registry="$REGISTRY_URL"
    break
  fi
done
echo ""
echo "Published: https://www.npmjs.com/package/${PACKAGE_NAME}/v/${VERSION}"
