#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

info() { echo "INFO: $1"; }
warn() { echo "WARN: $1" >&2; }
fail() { echo "ERROR: $1" >&2; exit 1; }

info "=== GOAT Flow Initial Setup ==="

# 1. Check Node.js version
if ! command -v node >/dev/null 2>&1; then
    fail "Node.js is required (v22+). Install from https://nodejs.org"
fi
NODE_VERSION=$(node -e "console.log(process.versions.node.split('.')[0])")
if (( NODE_VERSION < 22 )); then
    fail "Node.js v22+ required, found v$NODE_VERSION"
fi
info "Node.js v$(node --version) detected"

# 2. Install dependencies
if [[ -f package.json ]]; then
    info "Installing dependencies..."
    npm install
else
    info "No package.json found — initializing..."
    npm init -y
    npm install
fi

# 3. Create core directories
for dir in docs docs/decisions tasks agent-evals scripts/maintenance; do
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

# 5. Ensure scripts are executable
for script in scripts/*.sh scripts/maintenance/*.sh; do
    [[ -f "$script" ]] && chmod +x "$script"
done

# 6. Summary
echo ""
info "=== Setup Complete ==="
info "Next steps:"
info "  1. Run: bash scripts/start-dev.sh"
info "  2. Create your instruction file (CLAUDE.md / AGENTS.md / GEMINI.md)"
info "  3. Run: npx @blundergoat/goat-flow scan ."
