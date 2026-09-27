#!/usr/bin/env bash
# Parse every declared shell file in a goat-flow framework checkout without executing it.
# Run from the repository root. Required missing/empty groups fail; this helper is not shipped to target projects.
# Exit 0 only when every selected file parses; report all failures before returning 1.

set -euo pipefail
shopt -s nullglob

required_directories=(
    scripts
    scripts/maintenance
    scripts/installers
    workflow/hooks
    workflow/hooks/deny-dangerous
    .goat-flow/hooks
    .goat-flow/hooks/deny-dangerous
)
scripts=(workflow/install-goat-flow.sh)
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
