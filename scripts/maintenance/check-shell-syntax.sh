#!/usr/bin/env bash
# Check that every repository shell script parses, without running it; preflight and the published instruction-file commands both call it.
#
# Run it from the repository root: it checks scripts/, scripts/maintenance/ and scripts/installers/, and a missing or empty group fails.
# It reports every broken file before exiting 1, so a developer fixes them in one pass; this helper is not shipped to target projects.

set -euo pipefail
shopt -s nullglob

required_directories=(
    scripts
    scripts/maintenance
    scripts/installers
)
scripts=()
failures=0
checked=0

# An unmatched required glob must fail rather than disappear under nullglob.
for directory in "${required_directories[@]}"; do
    matches=("$directory"/*.sh)
    if [[ ${#matches[@]} -eq 0 ]]; then
        printf 'FAIL required shell group: %s/*.sh (missing or empty)\n' "$directory"
        failures=$((failures + 1))
    fi
    scripts+=("${matches[@]}")
done

for script in "${scripts[@]}"; do
    checked=$((checked + 1))
    # Bash treats later filename arguments as script arguments, so invoke its parser once per file.
    if [[ -f "$script" ]] && bash -n -- "$script"; then
        printf 'PASS Bash syntax: %s\n' "$script"
    else
        printf 'FAIL Bash syntax: %s\n' "$script"
        failures=$((failures + 1))
    fi
done

printf 'Shell syntax: %d files checked; %d failures\n' "$checked" "$failures"
[[ "$failures" -eq 0 ]]
