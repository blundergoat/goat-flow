#!/usr/bin/env bash
# npm-publish.sh
#
# Purpose:
#   Release goat-flow to npm with a preflight check and human confirmation.
#
# Usage:
#   bash scripts/npm-publish.sh [--full]
#
# Behavior:
#   1) reads package.json version, stops if npm already has it, and selects
#      interactive 2FA or a bypass token
#   2) runs `npm run publish:check` once - the single expensive gate
#      (versions, instruction parity, build, package links, fast + slow tests).
#      When GitHub CI's push run already passed for HEAD and the working tree
#      is clean, it runs `npm run publish:check:quick` instead, which skips the
#      test suites CI just ran; --full always runs the whole gate
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
#   - node, npm, git
#   - gh logged in to GitHub, only for the CI-verified quick check
#   - package.json and build/test scripts configured for the project
#   - npm authentication from `npm login`, npm user config, NPM_TOKEN, or
#     NODE_AUTH_TOKEN. This script treats the latter two as token aliases;
#     NPM_TOKEN wins if both are set. Environment tokens are placed in a
#     temporary npm config that is removed on exit.
#   - For interactive 2FA, enable account 2FA for authorization and writes.
#     For token-only publishing, use a granular token with package publish
#     permission and Bypass 2FA enabled. Never commit a token-bearing .npmrc.
set -euo pipefail

PACKAGE_NAME="@blundergoat/goat-flow"
REGISTRY_URL="https://registry.npmjs.org/"
AUTH_SOURCE=""
AUTH_MODE=""
TEMP_NPMRC=""
FULL_CHECK=0

for arg in "$@"; do
  case "$arg" in
    --full) FULL_CHECK=1 ;;
    *) printf 'Error: unknown option %s (expected --full).\n' "$arg" >&2; exit 2 ;;
  esac
done

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

  After the release check, type a fresh authenticator code, or press Enter
  without typing anything to approve in a browser (passkey or security key).

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

# Shasum of the tarball npm would publish from the current tree.
# Probed before and after the confirmation prompt: npm tarballs are
# content-derived (internal mtimes are fixed), so equal shasums prove the
# publish ships exactly the bytes the dry run displayed. Callers run this
# inside $(...), where Bash turns `set -e` off, so a failed npm probe returns
# explicitly and leaves npm's own error visible on stderr.
pack_shasum() {
  local pack_json
  pack_json=$(npm pack --dry-run --json --ignore-scripts) || return 1
  node -e "const raw = process.argv[1]; const records = raw ? JSON.parse(raw) : []; const shasum = records[0]?.shasum ?? ''; if (!shasum) { console.error('npm pack reported no shasum'); process.exit(1); } console.log(shasum);" "$pack_json"
}

# npm never accepts a second publish of the same version, so catch it before
# the release check rather than at the final publish. Lookup failures other
# than a match (404, offline) continue; the publish itself still enforces it.
fail_if_already_published() {
  local published
  if published=$(npm view "${PACKAGE_NAME}@${VERSION}" version --registry="$REGISTRY_URL" 2>/dev/null) &&
    [[ "$published" == "$VERSION" ]]; then
    printf 'Error: %s@%s is already on npm. Bump the version before publishing.\n' "$PACKAGE_NAME" "$VERSION" >&2
    exit 1
  fi
}

# Succeeds only when GitHub CI's push run (which runs on main only) passed for
# this exact commit and the working tree matches that commit, so the local
# test suites would repeat what CI already verified. Prints why otherwise.
ci_verified_head() {
  local head_sha tree_status runs_json verdict

  # An unreadable commit must not reach `gh run list --commit`, which would
  # then report CI for some other commit.
  if ! head_sha=$(git rev-parse HEAD) || ! tree_status=$(git status --porcelain); then
    echo "Running the full gate: could not read the git commit and working tree."
    return 1
  fi
  if [[ -n "$tree_status" ]]; then
    echo "Running the full gate: the working tree has uncommitted changes that CI never tested."
    return 1
  fi
  if ! command -v gh >/dev/null ||
    ! runs_json=$(gh run list --commit "$head_sha" --workflow ci.yml --event push --limit 1 \
      --json status,conclusion 2>/dev/null); then
    echo "Running the full gate: could not read CI results with gh (is it installed and logged in?)."
    return 1
  fi
  verdict=$(node -e "const runs = JSON.parse(process.argv[1] || '[]'); const run = runs[0]; console.log(run ? run.status + '/' + run.conclusion : 'no CI push run');" "$runs_json" 2>/dev/null) ||
    verdict="unreadable"
  if [[ "$verdict" != "completed/success" ]]; then
    printf 'Running the full gate: CI for %s is %s. Rerun after CI passes to skip the local tests.\n' \
      "${head_sha:0:8}" "$verdict"
    return 1
  fi
  printf 'CI passed for %s, so the local test suites are skipped. Use --full to run them anyway.\n' "${head_sha:0:8}"
}

verify_publish_auth() {
  local npm_user

  echo "--- Auth check ---"
  if configure_token_from_env; then
    echo "Using ${AUTH_SOURCE} via temporary npm config."
  fi

  if ! npm_user=$(npm whoami --registry="$REGISTRY_URL"); then
    print_auth_instructions "unable to verify npm login for ${REGISTRY_URL}. See npm's error above."
    exit 1
  fi

  echo "Logged in as: ${npm_user}"

  echo "Credential source: ${AUTH_SOURCE:-npm config or npm login}"
  echo "This script accepts NPM_TOKEN or NODE_AUTH_TOKEN for the same npm token; NPM_TOKEN takes priority."
  echo "Choose how this publish will satisfy npm's 2FA requirement:"
  echo "  1) Use interactive 2FA after the release check: authenticator code or browser login (default)"
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

  # Profile reads are a separate capability from package publishing. A failed
  # profile lookup cannot establish whether this credential can publish.
  echo "npm will verify publishing permission and 2FA when publishing."
  echo "After the release check, type an authenticator code, or press Enter to approve in a browser."
  echo ""
}

VERSION=$(node -p "require('./package.json').version")
echo "Publishing ${PACKAGE_NAME}@${VERSION}"
fail_if_already_published
verify_publish_auth

# The single expensive gate. Runs directly (not under `npm publish`) so test
# output streams live and no npm_config_* lifecycle environment reaches the
# suites; the publish calls below pass --ignore-scripts so prepublishOnly
# cannot rerun the same checks against the unchanged tree.
echo "--- Publish check ---"
release_check="publish:check"
if [[ "$FULL_CHECK" == 1 ]]; then
  echo "Running the full gate: --full was requested."
elif ci_verified_head; then
  release_check="publish:check:quick"
fi
if [[ "$release_check" == "publish:check" ]]; then
  echo "Running the full release gate, including the serial slow test suite."
fi
check_started=$SECONDS
npm run "$release_check"
check_elapsed=$((SECONDS - check_started))
printf 'Release check passed in %dm %ds.\n' "$((check_elapsed / 60))" "$((check_elapsed % 60))"
echo ""

# Tarball preview only; the gate above already validated this exact tree.
echo "--- Dry run ---"
npm publish --dry-run --ignore-scripts --access public --registry="$REGISTRY_URL"
echo ""

approved_shasum=$(pack_shasum)
echo "Tarball shasum locked for confirmation: ${approved_shasum}"

uncommitted=$(git status --porcelain)
if [[ -n "$uncommitted" ]]; then
  echo "Warning: the working tree has uncommitted changes. Packaged files among them ship as they are on disk:"
  printf '%s\n' "$uncommitted" | sed 's/^/  /'
fi

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
    echo ""
    echo "npm 2FA:"
    echo "  - Authenticator app: type the current code (hidden as you type), then press Enter."
    echo "  - Browser login, passkey, or security key: press Enter without typing anything."
    echo "    npm then prints an \"Authenticate your account at\" URL. Open it and approve;"
    echo "    if no browser opens, copy the URL into one. The publish continues after approval."
    read -rsp "2FA code, or Enter for browser login: " otp
    printf '\n'
    if [[ -n "$otp" ]]; then
      # npm normalizes both environment spellings; keep them consistent so an
      # inherited lowercase setting cannot override the freshly entered code.
      if NPM_CONFIG_OTP="$otp" npm_config_otp="$otp" npm publish --ignore-scripts --access public --registry="$REGISTRY_URL"; then
        break
      fi
    elif npm publish --otp= --ignore-scripts --access public --registry="$REGISTRY_URL"; then
      # The empty CLI flag also clears an OTP stored in npm config files.
      break
    fi
    otp=""
    read -rp "Publish failed. If the error above was a rejected code or an unapproved browser login, retry 2FA? (y/N) " retry
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
