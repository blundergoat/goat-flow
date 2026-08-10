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
#   1) reads package.json version and verifies npm publish auth
#   2) runs `npm run publish:check` once - the single expensive gate
#      (versions, instruction parity, build, package links, fast + slow tests)
#   3) prints an --ignore-scripts dry-run summary and records the tarball
#      shasum
#   4) asks for manual confirmation, re-probes the shasum so the approved
#      bytes are provably what ships, then publishes with --ignore-scripts
#      (prepublishOnly already ran as step 2; rerunning it would repeat
#      ~11 minutes of identical checks against an unchanged tree)
#
# Exit:
#   0 if published or explicitly aborted; non-zero on failed checks, package
#   contents changed after confirmation, or failed publish.
#
# Requirements:
#   - node, npm
#   - package.json and build/test scripts configured for the project
#   - npm publish authentication:
#       npm package publishing requires either account 2FA for the publish
#       prompt or a granular access token with Bypass 2FA enabled.
#
#     Preferred token setup for this script:
#       1. In npmjs.com, open Account -> Access Tokens.
#       2. Generate a Granular Access Token.
#       3. Grant read/write access to @blundergoat/goat-flow or the
#          @blundergoat scope.
#       4. Enable Bypass 2FA for write actions.
#       5. Either store it in your npm user config:
#            npm config set //registry.npmjs.org/:_authToken=npm_...
#            bash scripts/npm-publish.sh
#
#          Or keep it out of ~/.npmrc and pass it for this shell only:
#            export NPM_TOKEN="npm_..."
#            bash scripts/npm-publish.sh
#
#     NODE_AUTH_TOKEN is also accepted for the temporary-token path. The
#     script writes env tokens to a temporary npm config file and removes it
#     on exit. Do not commit an .npmrc containing a real token.
set -euo pipefail

# Publish @blundergoat/goat-flow to npm
# Usage: bash scripts/npm-publish.sh

PACKAGE_NAME="@blundergoat/goat-flow"
REGISTRY_URL="https://registry.npmjs.org/"
AUTH_SOURCE=""
TEMP_NPMRC=""

cleanup() {
  if [[ -n "$TEMP_NPMRC" && -f "$TEMP_NPMRC" ]]; then
    rm -f -- "$TEMP_NPMRC"
  fi
}
trap cleanup EXIT

print_token_instructions() {
  local reason="$1"

  printf 'Error: %s\n' "$reason" >&2
  cat >&2 <<'EOF'

Publish token setup:
  1. Go to npmjs.com -> Account -> Access Tokens.
  2. Generate a Granular Access Token.
  3. Grant read/write access to @blundergoat/goat-flow or the @blundergoat scope.
  4. Enable Bypass 2FA for write actions.
  5. Store the token in your npm user config:

       npm config set //registry.npmjs.org/:_authToken=npm_...
       bash scripts/npm-publish.sh

     This is simple, but it persists the token in ~/.npmrc.

     To avoid storing the token, pass it for this shell only:

       export NPM_TOKEN="npm_..."
       bash scripts/npm-publish.sh

     NODE_AUTH_TOKEN works too:

       export NODE_AUTH_TOKEN="npm_..."
       bash scripts/npm-publish.sh

Do not commit an .npmrc containing a real token.
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

has_configured_registry_token() {
  npm config list 2>/dev/null | grep -Eq '^//registry\.npmjs\.org/:_authToken = \(protected\)$'
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
    print_token_instructions "npm is not authenticated for ${REGISTRY_URL}."
    exit 1
  fi

  echo "Logged in as: ${npm_user}"

  if [[ -n "$AUTH_SOURCE" ]]; then
    echo "Publish token source: ${AUTH_SOURCE}"
    echo "Token must be granular, read/write for ${PACKAGE_NAME}, and Bypass 2FA enabled."
    echo ""
    return 0
  fi

  if has_configured_registry_token; then
    AUTH_SOURCE="npm user config"
    echo "Publish token source: ${AUTH_SOURCE}"
    echo "Token must be granular, read/write for ${PACKAGE_NAME}, and Bypass 2FA enabled."
    echo ""
    return 0
  fi

  if ! tfa_mode=$(npm profile get "two-factor auth" --registry="$REGISTRY_URL" 2>/dev/null | trim_output); then
    print_token_instructions "unable to verify npm 2FA state and no publish token was supplied."
    exit 1
  fi

  if [[ -z "$tfa_mode" ]]; then
    print_token_instructions "npm did not report an account 2FA mode and no publish token was supplied."
    exit 1
  fi

  echo "Account 2FA mode: ${tfa_mode}"
  if [[ "$tfa_mode" == "disabled" ]]; then
    print_token_instructions "npm account 2FA is disabled and no publish token was supplied."
    exit 1
  fi

  echo "No explicit publish token supplied; npm must complete the publish with an interactive OTP."
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
npm run publish:check
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

# Approval covered the dry-run bytes; publishing different bytes needs a new
# gate run, not a warning.
current_shasum=$(pack_shasum)
if [[ "$current_shasum" != "$approved_shasum" ]]; then
  printf 'Error: package contents changed since the dry run (shasum %s -> %s). Re-run the script.\n' \
    "$approved_shasum" "$current_shasum" >&2
  exit 1
fi

npm publish --ignore-scripts --access public --registry="$REGISTRY_URL"
echo ""
echo "Published: https://www.npmjs.com/package/${PACKAGE_NAME}/v/${VERSION}"
