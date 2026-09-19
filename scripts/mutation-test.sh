#!/usr/bin/env bash
# mutation-test.sh
#
# Purpose:
#   Runs targeted StrykerJS mutation testing outside the normal preflight gate.
#
# Usage:
#   bash scripts/mutation-test.sh <mutate-glob> [<mutate-glob> ...] [--tests <test-glob> ...] [-- <stryker-arg> ...]
#   bash scripts/mutation-test.sh
#
# Examples:
#   bash scripts/mutation-test.sh 'src/cli/audit/check-goat-flow.ts'
#   bash scripts/mutation-test.sh 'src/cli/audit/**/*.ts' -- --dryRunOnly
#   bash scripts/mutation-test.sh 'src/cli/learning-loop-index/**/*.ts' --tests 'test/unit/learning-loop-index.test.ts'
#   bash scripts/mutation-test.sh  # opens an interactive target menu
#
# Test selection:
#   Every mutant re-runs the whole test command, so suite size sets campaign cost directly. Passing
#   --tests (repeatable) narrows the run to the tests that cover the mutated files, which is the
#   difference between a campaign measured in minutes and one measured in hours. Without --tests the
#   full mutation-safe suite runs, which is thorough but costs minutes per mutant.
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

# Test files that cannot pass inside a Stryker sandbox, so they never belong in a mutation run.
# Keep the reason with the entry: this list went stale once when suites were split into families,
# and the split-out files silently rejoined the sandbox run.
UNSAFE_TEST_PATHS=(
    # Copy the project root and audit it; under Stryker that root holds instrumented source.
    'test/integration/audit-drift*.test.ts'
    # Require a built dist/dashboard, which the sandbox omits along with the rest of dist.
    'test/integration/dashboard-*.test.ts'
    # Packs an npm tarball from the project root, so it would ship instrumented source.
    'test/integration/packaged-hook-install.test.ts'
    # Asserts process-wide constraint isolation that concurrent mutant runners break.
    'test/integration/quality-constraint-isolation.test.ts'
    # Timing budgets are meaningless while mutant runners saturate the machine.
    'test/performance/*.test.ts'
)

# Individual cases that read the live repository or its build output instead of a fixture, so they
# fail inside a sandbox for reasons unrelated to any mutant. Each entry names why it cannot run.
UNSAFE_TEST_CASES=(
    # Audit the live repository, which needs gitignored local state the sandbox never copies.
    'zero-entry fresh install'
    'passes on this repo'
    'reports version skew without older-template agent or drift findings'
    # Read build output under dist/, which the sandbox omits.
    'main-module guard via symlink'
    'gives goat-security distinct quick and full reporting contracts'
    # Reads uninstrumented source bytes, which every mutant changes by definition.
    'keeps the minimum corpus source-grounded and structurally deterministic'
)

join_unsafe_test_cases() {
    local IFS='|'
    printf '%s' "${UNSAFE_TEST_CASES[*]}"
}

SKIP_PATTERN="$(join_unsafe_test_cases)"

usage() {
    sed -n '3,${/^[^#]/q;p;}' "$0" | sed 's/^# \{0,1\}//'
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

    local -a chosen_tests=()
    read -r -a chosen_tests -p "Covering test files, space separated (Enter = full mutation-safe suite): "
    if [[ ${#chosen_tests[@]} -gt 0 ]]; then
        test_patterns+=("${chosen_tests[@]}")
    fi
}

# Expand each --tests pattern against the repository so a typo fails here rather than as an
# empty Stryker run that reports every mutant as survived.
resolve_test_files() {
    local pattern
    local -a matches=()
    local -a collected=()

    for pattern in "${test_patterns[@]}"; do
        mapfile -t matches < <(find test -name '*.test.ts' -path "$pattern" | sort)
        [[ ${#matches[@]} -gt 0 ]] || fail "No test files match --tests pattern: $pattern"
        collected+=("${matches[@]}")
    done

    mapfile -t test_files < <(printf '%s\n' "${collected[@]}" | sort -u)
}

# Shell-evaluated file list for the full suite, minus every sandbox-hostile path.
full_suite_selection() {
    local expression=""
    local path

    for path in "${UNSAFE_TEST_PATHS[@]}"; do
        expression+=" ! -path '$path'"
    done

    printf "\$(find test -name '*.test.ts'%s | sort)" "$expression"
}

mutate_patterns=()
test_patterns=()
test_files=()
stryker_args=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help)
            usage
            exit 0
            ;;
        --tests)
            [[ $# -ge 2 ]] || fail "--tests needs a test file or glob"
            test_patterns+=("$2")
            shift 2
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

if [[ ${#test_patterns[@]} -gt 0 ]]; then
    resolve_test_files
    test_selection="${test_files[*]}"
    selection_label="focused (${#test_files[@]} test file(s))"
else
    test_selection="$(full_suite_selection)"
    selection_label="full mutation-safe suite"
fi

test_command="node --import tsx --test --test-concurrency=8 --test-skip-pattern \"$SKIP_PATTERN\" $test_selection"

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

node - "$config_file" "$test_command" "${mutate_patterns[@]}" <<'NODE'
const fs = require("node:fs");

const [configFile, testCommand, ...mutate] = process.argv.slice(2);
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
    // Local run output is gitignored, but the tracked README/keep files under it are part of the
    // repository contract that several suites assert, so each tracked path is re-included by name.
    "/.goat-flow/logs/**",
    "!/.goat-flow/logs/",
    "!/.goat-flow/logs/critiques/",
    "!/.goat-flow/logs/critiques/README.md",
    "!/.goat-flow/logs/events/",
    "!/.goat-flow/logs/events/README.md",
    "!/.goat-flow/logs/quality/",
    "!/.goat-flow/logs/quality/README.md",
    "!/.goat-flow/logs/review/",
    "!/.goat-flow/logs/review/README.md",
    "!/.goat-flow/logs/security/",
    "!/.goat-flow/logs/security/README.md",
    "!/.goat-flow/logs/sessions/",
    "!/.goat-flow/logs/sessions/.gitkeep",
    "!/.goat-flow/logs/sessions/README.md",
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
info "Test selection: $selection_label"
for path in ${test_files[@]+"${test_files[@]}"}; do
    info "  $path"
done
info "HTML report target: $report_file"

"${stryker_command[@]}" run "${stryker_args[@]}" "$config_file"
