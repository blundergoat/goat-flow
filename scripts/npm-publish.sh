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
#   1) reads package.json version
#   2) runs build and tests
#   3) prints a dry-run publish summary
#   4) asks for manual confirmation before `npm publish`
#
# Exit:
#   0 if published or explicitly aborted, non-zero on failed build/test/publish.
#
# Requirements:
#   - node, npm
#   - package.json and build/test scripts configured for the project
set -euo pipefail

# Publish @blundergoat/goat-flow to npm
# Usage: bash scripts/npm-publish.sh

VERSION=$(node -p "require('./package.json').version")
echo "Publishing @blundergoat/goat-flow@${VERSION}"

# Auth check
echo "--- Auth check ---"
if ! NPM_USER=$(npm whoami 2>/dev/null); then
  echo "Error: not logged in to npm." >&2
  echo "Run: npm login" >&2
  exit 1
fi
echo "Logged in as: ${NPM_USER}"
echo ""

# Preflight
echo "--- Preflight ---"
npm run build
npm test
echo ""

# Dry run
echo "--- Dry run ---"
npm publish --dry-run --access public 2>&1 | tail -8
echo ""

read -rp "Publish v${VERSION} to npm? (y/N) " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "Aborted."
  exit 0
fi

npm publish --access public
echo ""
echo "Published: https://www.npmjs.com/package/@blundergoat/goat-flow/v/${VERSION}"
