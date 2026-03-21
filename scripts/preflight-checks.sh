#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

errors=0

info() {
    echo "INFO: $1"
}

warn() {
    echo "WARN: $1" >&2
}

fail() {
    echo "ERROR: $1" >&2
    errors=$((errors + 1))
}

run_check() {
    local label="$1"
    shift
    info "Running: $label"
    "$@"
}

# --- Context validation ---
run_check "Context validation" bash scripts/context-validate.sh

# --- Shell script checks ---
run_check "Bash syntax" bash -n scripts/*.sh scripts/maintenance/*.sh

if command -v shellcheck >/dev/null 2>&1; then
    # Exclude style-only warnings (SC2001)
    run_check "Shellcheck" shellcheck --exclude=SC2001 scripts/*.sh scripts/maintenance/*.sh
else
    warn "shellcheck not installed; skipping shell lint"
fi

# --- Deny policy ---
run_check "Deny policy self-test" bash scripts/deny-dangerous.sh --self-test

# --- Version consistency ---
info "Running: Version consistency"
if [[ -f package.json ]] && [[ -f src/cli/rubric/version.ts ]]; then
    pkg_version=$(node -e "console.log(require('./package.json').version)")
    ts_version=$(grep "PACKAGE_VERSION" src/cli/rubric/version.ts | grep -oE "'[^']+'" | tr -d "'")

    if [[ "$pkg_version" != "$ts_version" ]]; then
        fail "Version mismatch: package.json=$pkg_version, version.ts=$ts_version"
    else
        info "Versions match: $pkg_version"
    fi

    # Verify cli.ts imports from version.ts (not hardcoded)
    if grep -q "^const PACKAGE_VERSION" src/cli/cli.ts 2>/dev/null; then
        fail "cli.ts has hardcoded PACKAGE_VERSION — should import from rubric/version.ts"
    fi
else
    warn "Skipping version check (missing package.json or version.ts)"
fi

# --- TypeScript ---
if [[ -f tsconfig.json ]]; then
    info "Running: Typecheck"
    npx tsc --noEmit || fail "Typecheck failed"
fi

# --- Tests ---
if [[ -f package.json ]] && grep -q '"test"' package.json; then
    info "Running: Tests"
    npm test || fail "Tests failed"
fi

# --- Summary ---
echo ""
if [[ "$errors" -gt 0 ]]; then
    echo "ERROR: Preflight failed with $errors error(s)" >&2
    exit 1
fi

info "Preflight checks passed"
