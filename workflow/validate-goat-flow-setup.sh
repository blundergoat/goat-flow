#!/usr/bin/env bash

# shellcheck disable=SC2148
# validate-goat-flow-setup.sh
#
# Quick GOAT Flow setup validation entrypoint.
# Runs the audit engine and reports only the GOAT Flow Setup scope:
#   lessons, footguns, architecture, code-map, glossary, patterns,
#   decisions, session-logs, tasks, other-files, config-parses, config-version.
#
# Usage:
#   bash workflow/validate-goat-flow-setup.sh [project-path]
#
# Exit behavior:
#   - 0: GOAT Flow Setup scope passed
#   - 1: one or more GOAT Flow Setup checks failed
#   - 2: validator could not run or parse audit output

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GOAT_FLOW_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_PATH="${1:-.}"

usage() {
    echo "Usage: bash workflow/validate-goat-flow-setup.sh [project-path]" >&2
    exit 2
}

fail() {
    echo "ERROR: $1" >&2
    exit 2
}

if [[ $# -gt 1 ]]; then
    usage
fi

if [[ ! -d "$PROJECT_PATH" ]]; then
    fail "$PROJECT_PATH is not a directory"
fi

CLI_CMD=()
if [[ -f "$GOAT_FLOW_ROOT/src/cli/cli.ts" ]]; then
    CLI_CMD=(node --import tsx "$GOAT_FLOW_ROOT/src/cli/cli.ts")
elif [[ -f "$GOAT_FLOW_ROOT/dist/cli/cli.js" ]]; then
    CLI_CMD=(node "$GOAT_FLOW_ROOT/dist/cli/cli.js")
else
    fail "Could not find goat-flow CLI entrypoint (expected src/cli/cli.ts or dist/cli/cli.js)"
fi

stdout_file="$(mktemp)"
stderr_file="$(mktemp)"
cleanup() {
    rm -f "$stdout_file" "$stderr_file"
}
trap cleanup EXIT

audit_exit=0
"${CLI_CMD[@]}" audit "$PROJECT_PATH" --format json >"$stdout_file" 2>"$stderr_file" || audit_exit=$?

node - "$stdout_file" "$stderr_file" "$audit_exit" <<'NODE'
const fs = require("fs");

const [stdoutPath, stderrPath, auditExitRaw] = process.argv.slice(2);
const stdout = fs.readFileSync(stdoutPath, "utf8");
const stderr = fs.readFileSync(stderrPath, "utf8");
const auditExit = Number(auditExitRaw);

let report;
try {
  report = JSON.parse(stdout);
} catch {
  console.error(
    "ERROR: validate-goat-flow-setup.sh could not parse audit JSON output.",
  );
  if (stderr.trim()) {
    console.error(stderr.trim());
  } else if (stdout.trim()) {
    console.error(stdout.trim());
  } else if (auditExit !== 0) {
    console.error(`audit exited with status ${auditExit}`);
  }
  process.exit(2);
}

const setup = report?.scopes?.setup;
if (!setup || !Array.isArray(setup.checks)) {
  console.error("ERROR: audit report did not include a setup scope.");
  process.exit(2);
}

console.log(`GOAT Flow Setup: ${setup.status.toUpperCase()}`);
for (const check of setup.checks) {
  const label = `${check.id} (${check.name})`;
  if (check.status === "pass") {
    console.log(`PASS: ${label}`);
    continue;
  }

  const message = check.failure?.message ?? "failed";
  console.log(`FAIL: ${label} - ${message}`);
  if (check.failure?.howToFix) {
    console.log(`  Fix: ${check.failure.howToFix}`);
  }
}

process.exit(setup.status === "pass" ? 0 : 1);
NODE
