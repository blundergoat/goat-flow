#!/usr/bin/env bash

# gruff-ts.sh
#
# Purpose:
#   Runs the gruff-ts static analyzer from the repo root using the locally
#   installed binary. Arguments pass straight through to gruff-ts; with no
#   arguments it prints the compact `summary` digest for orientation.
#
# Usage:
#   bash scripts/gruff-ts.sh                                  # per-pillar digest
#   bash scripts/gruff-ts.sh analyse src/cli/plans-check.ts
#   bash scripts/gruff-ts.sh analyse --diff working-tree
#   bash scripts/gruff-ts.sh analyse --format json --fail-on none . > findings.json
#
# Exit:
#   Propagates gruff-ts's own status - 0 clean, 1 findings at or above
#   --fail-on (not a tool failure), 2 a real diagnostic such as a parse error,
#   missing path, or rejected config. Exits 1 without running when no gruff-ts
#   binary is found.
#
# Requirements:
#   - @blundergoat/gruff-ts installed (node_modules/.bin/gruff-ts) or gruff-ts
#     on PATH.
#   - .gruff-ts.yaml at the repo root.

set -euo pipefail

# gruff-ts auto-applies the .gruff-ts.yaml sitting in the current directory, so
# run from the repo root or the scan silently falls back to built-in defaults.
# Path arguments are therefore resolved relative to the repo root, not the
# caller's directory.
ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

# Diagnostics go to stderr so `--format json` captures stay parseable.
info() { echo "INFO: $1" >&2; }
fail() { echo "ERROR: $1" >&2; exit 1; }

# Resolve the binary directly instead of going through `npm run gruff-ts`: npm
# writes its script banner to stdout ahead of the analyzer payload, which
# corrupts JSON captures.
GRUFF_BIN=""
for candidate in "node_modules/.bin/gruff-ts" "$HOME/.local/bin/gruff-ts" "gruff-ts"; do
    if [[ -x "$candidate" ]]; then
        GRUFF_BIN="$candidate"
        break
    fi
    if command -v "$candidate" >/dev/null 2>&1; then
        GRUFF_BIN="$(command -v "$candidate")"
        break
    fi
done

[[ -n "$GRUFF_BIN" ]] || fail "gruff-ts not found. Install it with: npm install"

# No arguments means orientation: the per-pillar digest, not a per-finding dump.
if [[ $# -eq 0 ]]; then
    set -- summary
fi

info "Running $GRUFF_BIN $*"
exec "$GRUFF_BIN" "$@"
