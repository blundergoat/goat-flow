#!/usr/bin/env bash

# Check this repository before a contributor starts a local development session.
#
# Run `bash scripts/start-dev.sh` with Node.js v20.12.0+ and npm; missing dependencies are installed before validation.
# Missing prerequisites stop startup; typecheck, test, preflight, and audit issues print warnings for the contributor.

set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

# Show setup progress so the contributor knows which check is running.
info() { echo "INFO: $1"; }
# Flag a recoverable issue while allowing the contributor to finish setup.
warn() { echo "WARN: $1" >&2; }
# Explain a blocking prerequisite or validation failure and stop setup.
fail() { echo "ERROR: $1" >&2; exit 1; }

info "=== GOAT Flow Dev Environment ==="

# 1. Check prerequisites
command -v node >/dev/null 2>&1 || fail "Node.js required"
command -v npm >/dev/null 2>&1 || fail "npm required"

NODE_VERSION=$(node -e "console.log(process.versions.node)")
IFS=. read -r NODE_MAJOR NODE_MINOR _ <<< "$NODE_VERSION"
# Stop before installation when the contributor's Node version cannot run the project's required APIs.
if (( NODE_MAJOR < 20 || (NODE_MAJOR == 20 && NODE_MINOR < 12) )); then
    fail "Node.js v20.12.0+ required, found v$NODE_VERSION"
fi

# 2. Install dependencies for a contributor opening a checkout without node_modules.
if [[ -f package.json ]] && [[ ! -d node_modules ]]; then
    info "Dependencies not installed - running npm install..."
    npm install
fi

# 3. Check types when this checkout declares TypeScript; errors remain visible as startup warnings.
if [[ -f tsconfig.json ]]; then
    info "Running typecheck..."
    npx tsc --noEmit || warn "Typecheck has errors"
fi

# 4. Report a clean configured test run; missing or failing tests leave a startup warning.
if [[ -f package.json ]] && npm run --silent test --if-present 2>/dev/null; then
    info "Tests passed"
else
    warn "Tests failed or not configured"
fi

# 5. Run the repository's preflight gate when its script is executable in this checkout.
if [[ -x scripts/preflight-checks.sh ]]; then
    info "Running preflight checks..."
    bash scripts/preflight-checks.sh || warn "Preflight checks had issues"
fi

# 6. Audit this controlling repository only when its package declares an audit command.
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
