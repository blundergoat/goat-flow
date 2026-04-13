#!/usr/bin/env bash

# start-dev.sh
#
# Purpose:
#   Boots a local development session and performs lightweight validation gates.
#
# Usage:
#   bash scripts/start-dev.sh
#
# Behavior:
#   - verifies Node/npm + minimum Node version
#   - installs dependencies if missing
#   - runs typecheck/tests when configured
#   - runs preflight checks and optional self-scan
#
# Exit:
#   0 when local dev bootstrap completes (including any non-fatal warnings), 1 on fatal setup failure.
#
# Requirements:
#   - node, npm

set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

info() { echo "INFO: $1"; }
warn() { echo "WARN: $1" >&2; }
fail() { echo "ERROR: $1" >&2; exit 1; }

info "=== GOAT Flow Dev Environment ==="

# 1. Check prerequisites
command -v node >/dev/null 2>&1 || fail "Node.js required"
command -v npm >/dev/null 2>&1 || fail "npm required"

NODE_VERSION=$(node -e "console.log(process.versions.node.split('.')[0])")
if (( NODE_VERSION < 20 )); then
    fail "Node.js v20+ required, found v$NODE_VERSION"
fi

# 2. Check dependencies are installed
if [[ -f package.json ]] && [[ ! -d node_modules ]]; then
    info "Dependencies not installed - running npm install..."
    npm install
fi

# 3. Typecheck
if [[ -f tsconfig.json ]]; then
    info "Running typecheck..."
    npx tsc --noEmit || warn "Typecheck has errors"
fi

# 4. Run tests
if [[ -f package.json ]] && npm run --silent test --if-present 2>/dev/null; then
    info "Tests passed"
else
    warn "Tests failed or not configured"
fi

# 5. Run preflight if available
if [[ -x scripts/preflight-checks.sh ]]; then
    info "Running preflight checks..."
    bash scripts/preflight-checks.sh || warn "Preflight checks had issues"
fi

# 6. Self-audit
if [[ -f package.json ]] && [[ "$(npm pkg get scripts.audit 2>/dev/null)" != "null" ]]; then
    info "Running self-audit..."
    npm run audit 2>/dev/null || warn "Self-audit not available yet"
fi

echo ""
info "=== Dev environment ready ==="
info "Commands:"
info "  npm run build       - Compile TypeScript"
info "  npm test            - Run tests"
info "  npm run typecheck   - Type-check without emitting"
info "  npm run audit       - Audit this repo with goat-flow"
