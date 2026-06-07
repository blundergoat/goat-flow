#!/usr/bin/env bash
# mutation-test.sh
#
# Purpose:
#   Runs targeted StrykerJS mutation testing outside the normal preflight gate.
#
# Usage:
#   bash scripts/mutation-test.sh <mutate-glob> [<mutate-glob> ...] [-- <stryker-arg> ...]
#   bash scripts/mutation-test.sh
#
# Examples:
#   bash scripts/mutation-test.sh 'src/cli/audit/check-goat-flow.ts'
#   bash scripts/mutation-test.sh 'src/cli/audit/**/*.ts' -- --dryRunOnly
#   bash scripts/mutation-test.sh  # opens an interactive target menu
#
# Exit:
#   Stryker's exit code.
#
# Requirements:
#   - node, npm
#   - local StrykerJS install, or npx network access to download @stryker-mutator/core

set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR" || exit 1

info() { echo "INFO: $1"; }
fail() { echo "ERROR: $1" >&2; exit 1; }

usage() {
    sed -n '3,18p' "$0" | sed 's/^# \{0,1\}//'
}

menu() {
    cat <<'MENU'
Mutation test targets
  1) Single source file
  2) Custom glob
  3) Full CLI                  src/cli/**/*.ts
  4) Audit engine              src/cli/audit/**/*.ts
  5) Harness checks            src/cli/audit/harness/**/*.ts
  6) CLI facts                 src/cli/facts/**/*.ts
  7) Dashboard server          src/cli/server/**/*.ts
  8) Quality engine            src/cli/quality/**/*.ts
  q) Quit
MENU
}

read_required() {
    local prompt=$1
    local value=""

    read -r -p "$prompt" value
    [[ -n "$value" ]] || fail "No value entered"
    printf '%s\n' "$value"
}

choose_mutation_target() {
    local choice=""
    local target=""

    if [[ ! -t 0 ]]; then
        usage
        fail "Pass at least one mutate glob, or run without arguments in an interactive terminal."
    fi

    menu
    read -r -p "Choose target: " choice

    case "$choice" in
        1)
            target=$(read_required "Source file: ")
            mutate_patterns+=("$target")
            ;;
        2)
            target=$(read_required "Mutate glob: ")
            mutate_patterns+=("$target")
            ;;
        3)
            mutate_patterns+=("src/cli/**/*.ts")
            ;;
        4)
            mutate_patterns+=("src/cli/audit/**/*.ts")
            ;;
        5)
            mutate_patterns+=("src/cli/audit/harness/**/*.ts")
            ;;
        6)
            mutate_patterns+=("src/cli/facts/**/*.ts")
            ;;
        7)
            mutate_patterns+=("src/cli/server/**/*.ts")
            ;;
        8)
            mutate_patterns+=("src/cli/quality/**/*.ts")
            ;;
        q|Q)
            echo "No mutation test selected."
            exit 0
            ;;
        *)
            fail "Unknown menu option: $choice"
            ;;
    esac
}

mutate_patterns=()
stryker_args=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help)
            usage
            exit 0
            ;;
        --)
            shift
            stryker_args=("$@")
            break
            ;;
        *)
            mutate_patterns+=("$1")
            shift
            ;;
    esac
done

if [[ ${#mutate_patterns[@]} -eq 0 ]]; then
    choose_mutation_target
fi

if [[ -x node_modules/.bin/stryker ]]; then
    stryker_command=(node_modules/.bin/stryker)
elif command -v npx >/dev/null 2>&1; then
    stryker_command=(npx --yes -p @stryker-mutator/core stryker)
else
    fail "StrykerJS not found. Install it locally or make npx available."
fi

config_dir="_temp/stryker"
report_file="_temp/mutation/index.html"
mkdir -p "$config_dir" "_temp/mutation"
config_file=$(mktemp "$config_dir/stryker.config.XXXXXX.json")
trap 'rm -f "$config_file"' EXIT

node - "$config_file" "${mutate_patterns[@]}" <<'NODE'
const fs = require("node:fs");

const [configFile, ...mutate] = process.argv.slice(2);
const testCommand = [
  "node --import tsx --test --test-concurrency=8",
  '--test-skip-pattern "zero-entry fresh install|main-module guard via symlink"',
  "$(find test -name '*.test.ts' ! -path 'test/integration/audit-drift.test.ts' ! -path 'test/integration/dashboard-server.test.ts' ! -path 'test/integration/quality-constraint-isolation.test.ts' ! -path 'test/performance/*.test.ts' | sort)",
].join(" ");
const config = {
  mutate,
  testRunner: "command",
  commandRunner: {
    command: testCommand,
  },
  coverageAnalysis: "off",
  reporters: ["clear-text", "progress", "html"],
  htmlReporter: {
    fileName: "_temp/mutation/index.html",
  },
  tempDirName: "_temp/stryker-tmp",
  ignorePatterns: [
    ".git",
    "/.goat-flow/logs/**",
    "!/.goat-flow/logs/",
    "!/.goat-flow/logs/critiques/",
    "!/.goat-flow/logs/critiques/README.md",
    "!/.goat-flow/logs/quality/",
    "!/.goat-flow/logs/quality/README.md",
    "!/.goat-flow/logs/security/",
    "!/.goat-flow/logs/security/README.md",
    "!/.goat-flow/logs/sessions/",
    "!/.goat-flow/logs/sessions/.gitkeep",
    "/.goat-flow/scratchpad/**",
    "!/.goat-flow/scratchpad/",
    "!/.goat-flow/scratchpad/.gitignore",
    "!/.goat-flow/scratchpad/README.md",
    "/.goat-flow/plans/**",
    "!/.goat-flow/plans/",
    "!/.goat-flow/plans/.gitignore",
    "!/.goat-flow/plans/README.md",
    "_temp",
    "coverage",
    "dist",
    "node_modules",
  ],
};

fs.writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
NODE

info "Mutation targets:"
for pattern in "${mutate_patterns[@]}"; do
    info "  $pattern"
done
info "Using command runner: mutation-safe fast suite"
info "HTML report target: $report_file"

"${stryker_command[@]}" run "${stryker_args[@]}" "$config_file"
