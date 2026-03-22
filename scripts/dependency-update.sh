#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

info() { echo "INFO: $1"; }
warn() { echo "WARN: $1" >&2; }
fail() { echo "ERROR: $1" >&2; exit 1; }

info "=== Dependency Update ==="

# 1. Check for outdated packages
if [[ -f package.json ]]; then
    info "Checking for outdated packages..."
    npm outdated 2>/dev/null || true
    echo ""

    info "Updating dependencies..."
    npm update

    info "Checking for major version bumps (not auto-updated)..."
    npm outdated 2>/dev/null || info "All dependencies are current"
fi

# 2. Security audit
info "Running security audit..."
npm audit 2>/dev/null || warn "Security audit found issues — run 'npm audit fix' to resolve"

# 3. Verify build still works after update
if [[ -f tsconfig.json ]]; then
    info "Verifying typecheck after update..."
    npx tsc --noEmit || fail "Typecheck failed after dependency update"
fi

# 4. Verify tests pass
if [[ -f package.json ]]; then
    info "Verifying tests after update..."
    npm test || fail "Tests failed after dependency update"
fi

# 5. Show diff for review
echo ""
info "=== Update Complete ==="
if git diff --quiet package-lock.json 2>/dev/null; then
    info "No dependency changes"
else
    info "Changed files:"
    git diff --stat package-lock.json 2>/dev/null || true
    info ""
    info "Review changes, then commit:"
    info "  git add package.json package-lock.json"
    info "  git commit -m 'chore: update dependencies'"
fi
