#!/usr/bin/env bash

# Install this repository's dependencies and check that a contributor can build and test them.
#
# Run `bash scripts/dependency-install.sh` with Node.js v20.12.0+ and npm; a lockfile selects the reproducible install.
# Required checks stop installation on failure; test failures print a warning for the contributor to investigate.

set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

# Show setup progress so the contributor knows which check is running.
info() { echo "INFO: $1"; }
# Flag a recoverable issue while allowing the contributor to finish setup.
warn() { echo "WARN: $1" >&2; }
# Explain a blocking prerequisite or validation failure and stop setup.
fail() { echo "ERROR: $1" >&2; exit 1; }

info "=== Dependency Install ==="

# 1. Check Node.js
command -v node >/dev/null 2>&1 || fail "Node.js required"
NODE_VERSION=$(node -e "console.log(process.versions.node)")
IFS=. read -r NODE_MAJOR NODE_MINOR _ <<< "$NODE_VERSION"
# Stop before installation when the contributor's Node version cannot run the project's required APIs.
if (( NODE_MAJOR < 20 || (NODE_MAJOR == 20 && NODE_MINOR < 12) )); then
    fail "Node.js v20.12.0+ required, found v$NODE_VERSION"
fi
info "Node.js $(node --version)"

# 2. Use the lockfile when present; a checkout without one needs npm to resolve dependencies.
if [[ -f package-lock.json ]]; then
    info "Installing from lockfile (npm ci)..."
    npm ci
else
    info "No lockfile found - running npm install..."
    npm install
fi

# 3. Check the compiler only when this checkout declares a TypeScript project.
if [[ -f tsconfig.json ]]; then
    info "Verifying TypeScript is available..."
    npx tsc --version || fail "TypeScript not available after install"
fi

# 4. Build when the checkout provides a build command so installation catches compilation failures.
if [[ -f package.json ]] && grep -q '"build"' package.json 2>/dev/null; then
    info "Building project..."
    npm run build || fail "Build failed after install"
fi

# 5. Run configured tests; failures warn the contributor without discarding the installed dependencies.
if [[ -f package.json ]] && grep -q '"test"' package.json 2>/dev/null; then
    info "Running tests to verify install..."
    npm test || warn "Tests failed - install may be incomplete"
fi

echo ""
info "=== Install Complete ==="
info "Dependencies installed and verified."
