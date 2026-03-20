#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

info() {
    echo "INFO: $1"
}

warn() {
    echo "WARN: $1" >&2
}

run_check() {
    local label="$1"
    shift
    info "Running: $label"
    "$@"
}

run_check "Context validation" bash scripts/context-validate.sh
run_check "Bash syntax" bash -n scripts/*.sh scripts/maintenance/*.sh

if command -v shellcheck >/dev/null 2>&1; then
    run_check "Shellcheck" shellcheck scripts/*.sh scripts/maintenance/*.sh
else
    warn "shellcheck not installed; skipping shell lint"
fi

run_check "Deny policy self-test" bash scripts/deny-dangerous.sh --self-test

info "Preflight checks passed"
