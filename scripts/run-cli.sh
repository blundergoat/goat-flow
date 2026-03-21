#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

cli() { node dist/cli/cli.js "$@"; }

usage() {
    cat <<'EOF'

  Usage: scripts/run-cli.sh <command> [path] [flags]

  Commands:
    scan [path] [flags]     Score a project (default: .)
    fix [path] [flags]      Generate fix prompt
    setup [path] [flags]    Generate setup prompt
    audit [path] [flags]    Generate audit prompt
    test-all                Run all human testing gate checks
    test-all --full         Run all checks, show full output

  Examples:
    scripts/run-cli.sh scan .
    scripts/run-cli.sh scan . --agent claude
    scripts/run-cli.sh fix . --agent claude
    scripts/run-cli.sh test-all

EOF
}

# Build if needed
if [[ ! -f dist/cli/cli.js ]]; then
    echo "Building..."
    npm run build
fi

# Show output with smart truncation and header
show() {
    local label="$1" max_lines="$2"
    shift 2
    local output exit_code=0

    output=$("$@" 2>&1) || exit_code=$?

    echo ""
    printf "  \033[1;36m%s\033[0m\n" "$label"
    printf "  \033[2m%s\033[0m\n" "$(printf '%.0s─' {1..40})"

    if [[ -z "$output" ]]; then
        printf "  \033[2m(no output, exit %d)\033[0m\n" "$exit_code"
        return
    fi

    local total_lines
    total_lines=$(wc -l <<< "$output")

    if [[ "$total_lines" -le "$max_lines" ]]; then
        sed 's/^/  /' <<< "$output"
    else
        head -"$max_lines" <<< "$output" | sed 's/^/  /'
        printf "  \033[2m... +%d lines (pipe to less or use --format json > file.json)\033[0m\n" $((total_lines - max_lines))
    fi
}

# Check function for test-all
check() {
    local num="$1" name="$2" preview_lines="${3:-5}"
    shift 3
    local output exit_code=0

    output=$("$@" 2>&1) || exit_code=$?

    # Fail if: no output, non-zero exit, or output starts with error markers
    local is_error=0
    [[ -z "$output" ]] && is_error=1
    [[ "$exit_code" -ne 0 ]] && is_error=1
    echo "$output" | head -1 | grep -qiE '^(fatal error|error:|unknown)' && is_error=1

    if [[ "$is_error" -eq 0 ]]; then
        printf "  \033[32m✓\033[0m %s. %s\n" "$num" "$name"
        if [[ "$preview_lines" -gt 0 ]]; then
            head -"$preview_lines" <<< "$output" | sed 's/^/    /'
            local total_lines
            total_lines=$(wc -l <<< "$output")
            if [[ "$total_lines" -gt "$preview_lines" ]]; then
                printf "    \033[2m... (%d more lines)\033[0m\n" $((total_lines - preview_lines))
            fi
        fi
        passed=$((passed + 1))
    else
        printf "  \033[31m✗\033[0m %s. %s (exit %d)\n" "$num" "$name" "$exit_code"
        if [[ -n "$output" ]]; then
            head -3 <<< "$output" | sed 's/^/    /'
        fi
        failed=$((failed + 1))
    fi
}

cmd="${1:-}"

if [[ -z "$cmd" ]]; then
    echo ""
    printf "  \033[1m🐐  GOAT Flow CLI\033[0m\n"
    echo ""
    printf "  \033[2mScan\033[0m\n"
    printf "  \033[36m1\033[0m  scan .                          Score all agents\n"
    printf "  \033[36m2\033[0m  scan . --format text --verbose  Full report with per-check details\n"
    printf "  \033[36m3\033[0m  scan . --agent claude           Score one agent only\n"
    echo ""
    printf "  \033[2mGenerate\033[0m\n"
    printf "  \033[36m4\033[0m  fix . --agent claude            Prompt to fix failed checks\n"
    printf "  \033[36m5\033[0m  setup . --agent claude          Prompt for fresh GOAT Flow setup\n"
    printf "  \033[36m6\033[0m  audit . --agent claude          Read-only diagnosis prompt\n"
    echo ""
    printf "  \033[2mTest\033[0m\n"
    printf "  \033[36m7\033[0m  test-all                        Run all 7 human testing gates\n"
    printf "  \033[36mh\033[0m  help                            Show full usage + examples\n"
    echo ""
    printf "  \033[1mPick:\033[0m "
    read -r choice
    case "$choice" in
        1) cli scan . ;;
        2) cli scan . --format text --verbose ;;
        3) cli scan . --agent claude --format text ;;
        4) cli fix . --agent claude ;;
        5) cli setup . --agent claude ;;
        6) cli audit . --agent claude ;;
        7) cmd="test-all" ;;
        h|H) usage; exit 0 ;;
        *) echo "Invalid choice"; exit 1 ;;
    esac
    [[ "${cmd:-}" != "test-all" ]] && exit 0
fi

shift

case "$cmd" in
    scan|fix|setup|audit)
        cli "$cmd" "$@"
        ;;
    test-all)
        full_mode=0
        [[ "${1:-}" == "--full" ]] && full_mode=1

        if [[ "$full_mode" -eq 1 ]]; then
            # Full output mode — no truncation
            echo ""
            printf "\033[1m  GOAT Flow CLI — Full Output\033[0m\n"

            show "1. JSON output" 9999 cli scan . --format json --agent claude
            show "2. Text + verbose" 9999 cli scan . --format text --verbose --agent claude
            show "3. Fix prompt" 9999 cli fix . --agent claude
            show "4. Audit prompt" 9999 cli audit . --agent claude
            echo ""
        else
            passed=0
            failed=0
            total=7

            echo ""
            printf "\033[1m  GOAT Flow CLI — Human Testing Gate\033[0m\n"
            echo ""

            printf "\033[1m  Scanner\033[0m\n"

            check 1 "JSON output valid" 3 \
                cli scan . --format json

            check 2 "Text + verbose renders" 8 \
                cli scan . --format text --verbose

            tmp=$(mktemp -d)
            echo '{"name":"empty"}' > "$tmp/package.json"
            check 3 "No-setup project handled" 3 \
                cli scan "$tmp" --format text
            rm -r "$tmp"

            check 4 "Agent filter (claude only)" 4 \
                cli scan . --agent claude --format text

            echo ""
            printf "\033[1m  Prompts\033[0m\n"

            check 5 "Fix prompt generates" 6 \
                cli fix . --agent claude

            tmp=$(mktemp -d)
            echo '{"name":"fresh","scripts":{"start":"node ."}}' > "$tmp/package.json"
            check 6 "Setup prompt (fresh project)" 6 \
                cli setup "$tmp" --agent claude
            rm -r "$tmp"

            check 7 "Audit prompt (read-only)" 6 \
                cli audit . --agent claude

            echo ""
            printf "  ─────────────────────────────────\n"
            if [[ "$failed" -eq 0 ]]; then
                printf "  \033[32m✓ %d/%d passed\033[0m" "$passed" "$total"
            else
                printf "  \033[31m✗ %d/%d passed, %d failed\033[0m" "$passed" "$total" "$failed"
            fi
            echo ""
            echo ""
        fi
        ;;
    -h|--help|help)
        usage
        ;;
    *)
        echo "Unknown command: $cmd"
        usage
        exit 1
        ;;
esac
