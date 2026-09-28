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
#   1) reads package.json version and logs in through npm's browser flow
#      (or uses a bypass token when explicitly selected)
#   2) runs `npm run publish:check` once - the single expensive gate
#      (versions, instruction parity, build, package links, fast + slow tests)
#   3) prints an --ignore-scripts dry-run summary and records the tarball
#      shasum
#   4) asks for manual confirmation, re-probes the shasum so the approved
#      bytes are provably what ships, then publishes with --ignore-scripts.
#      A cancelled browser authentication can be retried without repeating checks
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
#   - Browser access to npm for login and passkey verification.
#   - For token-only publishing, use a granular token with package publish
#     permission and Bypass 2FA enabled, from npm user config, NPM_TOKEN, or
#     NODE_AUTH_TOKEN. This script treats the latter two as token aliases;
#     NPM_TOKEN wins if both are set. In token mode, environment tokens use
#     a temporary npm config that is removed on exit. Never commit tokens.
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

Browser login (default): rerun the script and choose option 1. Follow npm's
  browser link and use your passkey/security key. Do not use account recovery
  codes to publish. npm may request browser verification again when publishing.

If npm reports an account suspension or security hold, stop and follow npm's
  account instructions. Retrying authentication cannot clear that hold.

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
    return 0
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
  local npm_user auth_choice

  echo "--- Auth check ---"
  echo "Choose how this publish will satisfy npm's 2FA requirement:"
  echo "  1) Log in through the browser with your passkey/security key (default)"
  echo "  2) Use a token with Bypass 2FA enabled"
  read -rp "Authentication method [1/2, default 1]: " auth_choice
  case "$auth_choice" in
    "" | 1) AUTH_MODE="web" ;;
    2) AUTH_MODE="token" ;;
    *) printf 'Error: choose 1 or 2.\n' >&2; exit 1 ;;
  esac

  if [[ "$AUTH_MODE" == "web" ]]; then
    echo "Follow npm's browser link and use your passkey/security key."
    echo "Do not use account recovery codes to publish."
    # An inherited OTP forces npm into legacy auth, even with auth-type=web.
    # Clear it explicitly and keep npm attached to the terminal for browser auth.
    if ! npm login --auth-type=web --otp= --registry="$REGISTRY_URL"; then
      print_auth_instructions "npm browser login failed. See npm's error above."
      exit 1
    fi
    AUTH_SOURCE="npm web login"
  else
    echo "NPM_TOKEN and NODE_AUTH_TOKEN are aliases for the same npm token; NPM_TOKEN takes priority."
    # Calling this inside an `if` disables errexit throughout the function,
    # allowing failed temp-file creation or writes to fall through to publishing.
    configure_token_from_env
    if [[ -n "$AUTH_SOURCE" ]]; then
      echo "Using ${AUTH_SOURCE} via temporary npm config."
    fi
    echo "The token must have publish permission for ${PACKAGE_NAME} and Bypass 2FA enabled."
  fi

  if ! npm_user=$(npm whoami --registry="$REGISTRY_URL"); then
    print_auth_instructions "unable to verify npm login for ${REGISTRY_URL}. See npm's error above."
    exit 1
  fi

  echo "Logged in as: ${npm_user}"
  echo "Credential source: ${AUTH_SOURCE:-npm config or npm login}"
  # Profile reads are a separate capability from package publishing. A failed
  # profile lookup cannot establish whether this credential can publish.
  echo "npm will verify publishing permission and 2FA when publishing."
  if [[ "$AUTH_MODE" == "web" ]]; then
    echo "npm may open another browser verification prompt after the release check."
  fi
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

# Retry only the publish request after cancelled browser auth. Every attempt rechecks
# the approved tarball; changed bytes require a fresh full release check.
while true; do
  current_shasum=$(pack_shasum)
  if [[ "$current_shasum" != "$approved_shasum" ]]; then
    printf 'Error: package contents changed since the dry run (shasum %s -> %s). Re-run the script.\n' \
      "$approved_shasum" "$current_shasum" >&2
    exit 1
  fi

  # npm owns the browser challenge. Do not capture or pipe this command:
  # npm requires an interactive terminal to start its authentication flow.
  if npm publish --otp= --dry-run=false --ignore-scripts --access public --registry="$REGISTRY_URL"; then
    break
  fi

  echo "Publish failed. If npm reports a suspension or security hold, stop; retries cannot clear it." >&2
  if [[ "$AUTH_MODE" != "web" ]]; then
    exit 1
  fi
  read -rp "If you cancelled browser authentication, retry publishing? (y/N) " retry
  if [[ "$retry" != "y" && "$retry" != "Y" ]]; then
    exit 1
  fi
done
echo ""
echo "Published: https://www.npmjs.com/package/${PACKAGE_NAME}/v/${VERSION}"
