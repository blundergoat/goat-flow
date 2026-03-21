#!/usr/bin/env bash

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
if (( NODE_VERSION < 22 )); then
    fail "Node.js v22+ required, found v$NODE_VERSION"
fi

# 2. Check dependencies are installed
if [[ -f package.json ]] && [[ ! -d node_modules ]]; then
    info "Dependencies not installed — running npm install..."
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

# 6. Self-scan
if [[ -f package.json ]] && grep -q '"self-scan"' package.json 2>/dev/null; then
    info "Running self-scan..."
    npm run self-scan -- --format text 2>/dev/null || warn "Self-scan not available yet"
fi

echo ""
info "=== Dev environment ready ==="
info "Commands:"
info "  npm run build       — Compile TypeScript"
info "  npm test            — Run tests"
info "  npm run typecheck   — Type-check without emitting"
info "  npm run self-scan   — Scan this repo with goat-flow"
