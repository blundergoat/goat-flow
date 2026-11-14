#!/usr/bin/env bash

# Prepare this repository for a contributor's first goat-flow development session.
#
# Run `bash scripts/setup-initial.sh` with Node.js v20.12.0+ and npm to install dependencies and create missing workspace folders.
# Setup also prepares ShellCheck and executable scripts; mandatory failures stop setup before the next-step summary.

set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

# Show setup progress so the contributor knows which check is running.
info() { echo "INFO: $1"; }
# Flag a recoverable issue while allowing the contributor to finish setup.
warn() { echo "WARN: $1" >&2; }
# Explain a blocking prerequisite or validation failure and stop setup.
fail() { echo "ERROR: $1" >&2; exit 1; }

info "=== GOAT Flow Initial Setup ==="

# 1. A contributor needs Node before setup can install dependencies.
if ! command -v node >/dev/null 2>&1; then
    fail "Node.js is required (v20.12.0+). Install from https://nodejs.org"
fi
NODE_VERSION=$(node -e "console.log(process.versions.node)")
IFS=. read -r NODE_MAJOR NODE_MINOR _ <<< "$NODE_VERSION"
# Stop before installation when the contributor's Node version cannot run the project's required APIs.
if (( NODE_MAJOR < 20 || (NODE_MAJOR == 20 && NODE_MINOR < 12) )); then
    fail "Node.js v20.12.0+ required, found v$NODE_VERSION"
fi
info "Node.js v$(node --version) detected"

# 2. Install declared dependencies; an empty checkout first needs a package manifest.
if [[ -f package.json ]]; then
    info "Installing dependencies..."
    npm install
else
    info "No package.json found - initializing..."
    npm init -y
    npm install
fi

# 3. Prepare the folders that hold local plans, learning records, and maintenance scripts.
for dir in .goat-flow/learning-loop/decisions .goat-flow/learning-loop/footguns .goat-flow/learning-loop/lessons .goat-flow/plans .goat-flow/logs/sessions scripts/maintenance; do
    # Existing folders already hold the contributor's workspace state and need no setup.
    if [[ ! -d "$dir" ]]; then
        mkdir -p "$dir"
        info "Created $dir/"
    fi
done

# 4. Supply default ignore rules only when the contributor has no existing .gitignore.
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
# Try an available package manager when the contributor cannot yet lint shell scripts.
if ! command -v shellcheck >/dev/null 2>&1; then
    # Git Bash users with winget can install ShellCheck for their own Windows account.
    if [[ "$OSTYPE" == msys* || "$OSTYPE" == mingw* || "$OSTYPE" == cygwin* ]] && command -v winget.exe >/dev/null 2>&1; then
        info "Installing shellcheck via winget for the current user..."
        winget.exe install --id koalaman.shellcheck --exact --source winget --scope user --accept-source-agreements --accept-package-agreements --disable-interactivity
        # A completed winget install can leave this Git Bash session using the previous PATH.
        if ! command -v shellcheck >/dev/null 2>&1; then
            warn "Open a new Git Bash session for the updated PATH, then run shellcheck --version."
        fi
    # Debian-based systems can supply ShellCheck through apt when winget is not applicable.
    elif command -v apt-get >/dev/null 2>&1; then
        info "Installing shellcheck via apt-get..."
        sudo apt-get update -qq && sudo apt-get install -y -qq shellcheck
    # Homebrew provides the same lint tool when it is the available package manager.
    elif command -v brew >/dev/null 2>&1; then
        info "Installing shellcheck via brew..."
        brew install shellcheck
    else
        warn "shellcheck not found - install manually: https://github.com/koalaman/shellcheck#installing"
    fi
fi
# Report the installed version only when this session can actually resolve ShellCheck.
if command -v shellcheck >/dev/null 2>&1; then
    info "shellcheck $(shellcheck --version | grep '^version:' | cut -d' ' -f2) available"
fi

# 6. Ensure scripts are executable
# Make existing shell scripts runnable; unmatched globs do not identify a script to change.
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
