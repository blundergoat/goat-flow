#!/usr/bin/env bash

set -euo pipefail

# Script to scan for accidentally committed secrets in the repository

# Color functions for output
info() {
    echo -e "\033[32mINFO:\033[0m $1"
}

warn() {
    echo -e "\033[33mWARN:\033[0m $1"
}

err() {
    echo -e "\033[31mERROR:\033[0m $1"
}

show_help() {
    cat << EOF
Usage: $0 [OPTIONS] [PATH]

Scans for accidentally committed secrets (AWS keys, private keys, tokens,
passwords). Uses gitleaks if available, falls back to grep-based patterns.

Findings are classified as:
  REVIEW      High-signal match that likely needs investigation
  LOW-SIGNAL  Likely non-secret context (comments/help text/placeholders/vars)

OPTIONS:
    -h, --help      Show this help message
    --staged        Scan only staged files (for pre-commit hook use)
    --all           Scan all files tracked by git (default)
    -n, --dry-run   Show what would be scanned without scanning

ARGUMENTS:
    PATH            Scan a specific file or directory

EXAMPLES:
    $0                          # Scan all tracked files
    $0 --staged                 # Scan only staged files (pre-commit)
    $0 lib/aws/                 # Scan specific directory
    $0 --staged                 # Explicitly scan staged files
EOF
}

# Default values
# Use the git root of the cwd (set by the dashboard to the selected project),
# falling back to the git root of the script's own location.
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null || { cd "$(dirname "$0")/../.." && pwd; })"
SCAN_MODE="all"
TARGET_PATH=""
DRY_RUN=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        --staged)
            SCAN_MODE="staged"
            shift
            ;;
        --all)
            SCAN_MODE="all"
            shift
            ;;
        -n|--dry-run)
            DRY_RUN=true
            shift
            ;;
        -*)
            err "Unknown option: $1"
            show_help
            exit 1
            ;;
        *)
            TARGET_PATH="$1"
            SCAN_MODE="path"
            shift
            ;;
    esac
done

cd "$REPO_ROOT" || exit 1

# Secret patterns (grep -P perl-compatible regex)
# Kept intentionally high-confidence to reduce false positives.
# Install gitleaks for entropy-based detection of broader secret types.
SECRET_PATTERNS=(
    # AWS Access Key ID (starts with AKIA)
    'AKIA[0-9A-Z]{16}'
    # AWS Secret Access Key - only in assignment context (key=value)
    '(aws_secret|secret_access_key|AWS_SECRET)\s*[=:]\s*["\x27]?[A-Za-z0-9/+=]{40}'
    # Private keys
    '-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----'
    # Generic secrets assigned to variables (password/token/key = "value")
    '(password|passwd|secret|token|api_key|apikey|access_key)\s*[=:]\s*["\x27][^\s"'\'']{8,}'
    # GitHub personal access tokens
    'ghp_[A-Za-z0-9]{36}'
    # Generic Bearer tokens
    'Bearer [A-Za-z0-9\-._~+/]+=*'
)

# Build combined pattern
COMBINED_PATTERN=""
for pattern in "${SECRET_PATTERNS[@]}"; do
    if [[ -n "$COMBINED_PATTERN" ]]; then
        COMBINED_PATTERN="${COMBINED_PATTERN}|${pattern}"
    else
        COMBINED_PATTERN="$pattern"
    fi
done

# Collect files to scan
collect_files() {
    case "$SCAN_MODE" in
        staged)
            git diff --cached --name-only --diff-filter=ACMR 2>/dev/null
            ;;
        all)
            git ls-files 2>/dev/null
            ;;
        path)
            if [[ -d "$TARGET_PATH" ]]; then
                git ls-files "$TARGET_PATH" 2>/dev/null
            elif [[ -f "$TARGET_PATH" ]]; then
                echo "$TARGET_PATH"
            else
                err "Path does not exist: $TARGET_PATH"
                exit 1
            fi
            ;;
    esac
}

MATCH_REASON=""
is_low_signal_match() {
    local file="$1"
    local line_text="$2"
    MATCH_REASON=""

    # Comments are noisy for token/secret keyword patterns.
    if [[ "$line_text" =~ ^[[:space:]]*# ]]; then
        MATCH_REASON="comment"
        return 0
    fi

    # CLI help placeholders: --token <token>, etc.
    if [[ "$line_text" =~ \<[A-Za-z0-9_-]+\> ]]; then
        MATCH_REASON="placeholder"
        return 0
    fi

    # Variable references are usually wiring, not embedded secrets.
    if [[ "$line_text" == *"\${"* ]] || [[ "$line_text" == *'BASH_REMATCH'* ]] || [[ "$line_text" =~ \$[A-Za-z_][A-Za-z0-9_]* ]]; then
        MATCH_REASON="variable reference"
        return 0
    fi

    # Help text docs often mention bearer tokens without containing one.
    if [[ "$line_text" =~ [Bb]earer[[:space:]]+token ]]; then
        MATCH_REASON="help/documentation text"
        return 0
    fi

    # Pattern list in this scanner can self-match.
    if [[ "$file" == "lib/maintenance/scan-secrets.sh" ]]; then
        MATCH_REASON="scanner pattern definition"
        return 0
    fi

    return 1
}

FILES=()
while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    # Skip binary files and common non-secret files
    case "$file" in
        *.png|*.jpg|*.jpeg|*.gif|*.ico|*.woff|*.woff2|*.ttf|*.eot|*.pdf|*.zip|*.tar*|*.gz)
            continue
            ;;
    esac
    FILES+=("$file")
done < <(collect_files)

if [[ ${#FILES[@]} -eq 0 ]]; then
    info "No files to scan (mode: $SCAN_MODE)"
    exit 0
fi

info "Scanning ${#FILES[@]} files (mode: $SCAN_MODE)"

if [[ "$DRY_RUN" == true ]]; then
    info "DRY RUN: Would scan the following files:"
    for file in "${FILES[@]}"; do
        echo -e "  \033[36m$file\033[0m"
    done
    exit 0
fi

# Try gitleaks first
if command -v gitleaks &>/dev/null; then
    info "Using gitleaks"
    echo ""

    gitleaks_args=("detect" "--source" "$REPO_ROOT" "--no-git" "--verbose")

    case "$SCAN_MODE" in
        staged)
            gitleaks_args=("detect" "--source" "$REPO_ROOT" "--staged" "--verbose")
            ;;
    esac

    gitleaks_output=$(gitleaks "${gitleaks_args[@]}" 2>&1)
    gitleaks_exit=$?

    if [[ $gitleaks_exit -eq 0 ]]; then
        info "No secrets found"
        exit 0
    else
        err "Potential secrets detected!"
        echo ""
        echo "$gitleaks_output"
        exit 1
    fi
fi

# Fallback: grep-based scan
info "Using grep-based patterns (install gitleaks for better detection)"
echo ""

review_findings=0
low_signal_findings=0
review_files=0
low_signal_files=0
declare -A review_file_seen=()
declare -A low_signal_file_seen=()

for file in "${FILES[@]}"; do
    [[ ! -f "$file" ]] && continue

    # Use grep -P for Perl-compatible regex, fall back to -E
    match_output=""
    if match_output=$(grep -PnH "$COMBINED_PATTERN" "$file" 2>/dev/null); then
        :
    elif match_output=$(grep -EnH "(AKIA[0-9A-Z]{16}|-----BEGIN.*PRIVATE KEY-----|ghp_[A-Za-z0-9]{36})" "$file" 2>/dev/null); then
        :
    fi

    if [[ -n "$match_output" ]]; then
        while IFS= read -r line; do
            line_text="${line#*:}"
            line_text="${line_text#*:}"
            if is_low_signal_match "$file" "$line_text"; then
                echo -e "\033[33mLOW-SIGNAL:\033[0m $line \033[2m($MATCH_REASON)\033[0m"
                low_signal_findings=$((low_signal_findings + 1))
                if [[ -z "${low_signal_file_seen[$file]:-}" ]]; then
                    low_signal_file_seen["$file"]=1
                    low_signal_files=$((low_signal_files + 1))
                fi
            else
                echo -e "\033[31mREVIEW:\033[0m $line"
                review_findings=$((review_findings + 1))
                if [[ -z "${review_file_seen[$file]:-}" ]]; then
                    review_file_seen["$file"]=1
                    review_files=$((review_files + 1))
                fi
            fi
        done <<< "$match_output"
    fi
done

echo ""

if [[ $review_findings -gt 0 ]]; then
    err "INVESTIGATION REQUIRED: $review_findings high-signal match(es) in $review_files file(s)."
    if [[ $low_signal_findings -gt 0 ]]; then
        warn "$low_signal_findings additional low-signal match(es) in $low_signal_files file(s) were also found."
    fi
    exit 1
else
    if [[ $low_signal_findings -gt 0 ]]; then
        warn "No high-signal secrets found. $low_signal_findings low-signal match(es) in $low_signal_files file(s)."
        info "No investigation required for low-signal-only results unless context looks suspicious."
    else
        info "No secrets found"
    fi
fi
