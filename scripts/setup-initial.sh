#!/usr/bin/env bash

# setup-initial.sh
#
# Purpose:
#   Performs first-time GOAT Flow setup for a repository.
#
# Usage:
#   bash scripts/setup-initial.sh
#
# Behavior:
#   - verifies Node.js version
#   - installs dependencies
#   - creates core GOAT Flow directories and .gitignore
#   - installs shellcheck if missing
#   - makes known shell scripts executable
#
# Exit:
#   0 on successful bootstrap, non-zero if mandatory checks fail.
#
# Requirements:
#   - node v20+ and npm

set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

info() { echo "INFO: $1"; }
warn() { echo "WARN: $1" >&2; }
fail() { echo "ERROR: $1" >&2; exit 1; }

info "=== GOAT Flow Initial Setup ==="

# 1. Check Node.js version
if ! command -v node >/dev/null 2>&1; then
    fail "Node.js is required (v20+). Install from https://nodejs.org"
fi
NODE_VERSION=$(node -e "console.log(process.versions.node.split('.')[0])")
if (( NODE_VERSION < 20 )); then
    fail "Node.js v20+ required, found v$NODE_VERSION"
fi
info "Node.js v$(node --version) detected"

# 2. Install dependencies
if [[ -f package.json ]]; then
    info "Installing dependencies..."
    npm install
else
    info "No package.json found - initializing..."
    npm init -y
    npm install
fi

# 3. Create core directories
for dir in .goat-flow/decisions .goat-flow/footguns .goat-flow/lessons .goat-flow/tasks .goat-flow/logs/sessions scripts/maintenance; do
    if [[ ! -d "$dir" ]]; then
        mkdir -p "$dir"
        info "Created $dir/"
    fi
done

# 4. Create .gitignore if missing
if [[ ! -f .gitignore ]]; then
    cat > .gitignore <<'GITIGNORE'
node_modules/
dist/
.env
settings.local.json
*.log
GITIGNORE
    info "Created .gitignore"
fi

# 5. Install shellcheck if missing
if ! command -v shellcheck >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
        info "Installing shellcheck via apt-get..."
        sudo apt-get update -qq && sudo apt-get install -y -qq shellcheck
    elif command -v brew >/dev/null 2>&1; then
        info "Installing shellcheck via brew..."
        brew install shellcheck
    else
        warn "shellcheck not found - install manually: https://github.com/koalaman/shellcheck#installing"
    fi
fi
if command -v shellcheck >/dev/null 2>&1; then
    info "shellcheck $(shellcheck --version | grep '^version:' | cut -d' ' -f2) available"
fi

# 6. Ensure scripts are executable
for script in scripts/*.sh scripts/maintenance/*.sh; do
    [[ -f "$script" ]] && chmod +x "$script"
done

# 7. Summary
echo ""
info "=== Setup Complete ==="
info "Next steps:"
info "  1. Run: bash scripts/start-dev.sh"
info "  2. Create your instruction file (CLAUDE.md / AGENTS.md)"
info "  3. Run: npx @blundergoat/goat-flow audit ."
