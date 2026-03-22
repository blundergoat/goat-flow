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

# --- Context validation ---
info "Running: Context validation"
bash scripts/context-validate.sh || fail "Context validation failed"

# --- Shell script checks ---
info "Running: Bash syntax"
bash -n scripts/*.sh scripts/maintenance/*.sh || fail "Bash syntax check failed"

if command -v shellcheck >/dev/null 2>&1; then
    # Exclude style-only warnings (SC2001)
    info "Running: Shellcheck"
    shellcheck --exclude=SC2001 scripts/*.sh scripts/maintenance/*.sh || fail "Shellcheck failed"
else
    warn "shellcheck not installed; skipping shell lint"
fi

# --- Deny policy ---
info "Running: Deny policy self-test"
bash scripts/deny-dangerous.sh --self-test || fail "Deny policy self-test failed"

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

    # Build check — verify dist/ is producible
    info "Running: Build"
    npx tsc || fail "Build failed"

    # Check for common code quality issues in TypeScript
    info "Running: TypeScript quality checks"

    # No console.log in source (except cli.ts which needs it)
    console_hits=$(grep -rn 'console\.log' src/cli/ --include='*.ts' | grep -v 'cli.ts' | grep -v 'render/' || true)
    if [[ -n "$console_hits" ]]; then
        warn "console.log found outside cli.ts/render/:"
        echo "$console_hits" | head -5 | sed 's/^/  /'
    fi

    # No any types (best effort — catches explicit 'any' annotations)
    any_hits=$(grep -rn ': any\b' src/cli/ --include='*.ts' || true)
    if [[ -n "$any_hits" ]]; then
        warn "Explicit 'any' types found:"
        echo "$any_hits" | head -5 | sed 's/^/  /'
    fi

    # No TODO/FIXME/HACK left unresolved
    todo_hits=$(grep -rn 'TODO\|FIXME\|HACK' src/cli/ --include='*.ts' || true)
    if [[ -n "$todo_hits" ]]; then
        info "TODOs found ($(echo "$todo_hits" | wc -l) total):"
        echo "$todo_hits" | head -5 | sed 's/^/  /'
    fi
fi

# --- Tests ---
if [[ -f package.json ]] && grep -q '"test"' package.json; then
    info "Running: Tests"
    test_output=$(npm test 2>&1)
    test_exit=$?
    echo "$test_output"
    if [[ "$test_exit" -ne 0 ]]; then
        fail "Tests failed"
    fi
    test_count=$(echo "$test_output" | grep '# tests' | grep -oE '[0-9]+' || echo "?")
    info "Tests: $test_count total"
fi

# --- Removed patterns (ADR enforcement) ---
info "Running: Removed pattern check"
# Patterns that should not exist anywhere in live files (per ADRs)
removed_patterns=(
    "APP.*LIBRARY.*SCRIPT COLLECTION"
    "confusion.log\.md"
    "ProjectShape"
    "detectShape"
    "--shape"
)
for pattern in "${removed_patterns[@]}"; do
    hits=$(grep -rn "$pattern" setup/ workflow/ src/ test/ docs/ ai/ .github/ --include='*.md' --include='*.ts' --include='*.yml' 2>/dev/null \
        | grep -v 'CHANGELOG\|TODO_\|ADR-\|design-rationale\|footguns.*RESOLVED\|decisions/\|preflight-checks' || true)
    if [[ -n "$hits" ]]; then
        fail "Removed pattern '$pattern' still found:"
        echo "$hits" | head -5 | sed 's/^/  /'
    fi
done

# --- Summary ---
echo ""
if [[ "$errors" -gt 0 ]]; then
    echo "ERROR: Preflight failed with $errors error(s)" >&2
    exit 1
fi

info "Preflight checks passed"
