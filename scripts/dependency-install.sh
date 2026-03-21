#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

info() { echo "INFO: $1"; }
warn() { echo "WARN: $1" >&2; }
fail() { echo "ERROR: $1" >&2; exit 1; }

info "=== Dependency Install ==="

# 1. Check Node.js
command -v node >/dev/null 2>&1 || fail "Node.js required"
NODE_VERSION=$(node -e "console.log(process.versions.node.split('.')[0])")
if (( NODE_VERSION < 22 )); then
    fail "Node.js v22+ required, found v$NODE_VERSION"
fi
info "Node.js v$(node --version)"

# 2. Clean install from lockfile
if [[ -f package-lock.json ]]; then
    info "Installing from lockfile (npm ci)..."
    npm ci
else
    info "No lockfile found — running npm install..."
    npm install
fi

# 3. Verify installation
if [[ -f tsconfig.json ]]; then
    info "Verifying TypeScript is available..."
    npx tsc --version || fail "TypeScript not available after install"
fi

# 4. Build if build script exists
if [[ -f package.json ]] && grep -q '"build"' package.json 2>/dev/null; then
    info "Building project..."
    npm run build || fail "Build failed after install"
fi

# 5. Verify tests
if [[ -f package.json ]] && grep -q '"test"' package.json 2>/dev/null; then
    info "Running tests to verify install..."
    npm test || warn "Tests failed — install may be incomplete"
fi

echo ""
info "=== Install Complete ==="
info "Dependencies installed and verified."
