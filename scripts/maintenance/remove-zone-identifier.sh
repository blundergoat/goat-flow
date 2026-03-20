#!/usr/bin/env bash

set -euo pipefail

# Script to recursively remove Zone.Identifier files
# These are alternate data stream files created by Windows when downloading files

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

Recursively removes Zone.Identifier files from directories.

OPTIONS:
    -h, --help      Show this help message
    -n, --dry-run   Show what would be deleted without actually deleting

ARGUMENTS:
    PATH            Directory to search (defaults to current directory)

EXAMPLES:
    $0                              # Remove from current directory
    $0 /mnt/c/Users/Downloads       # Remove from specific path
    $0 --dry-run .                  # Preview what would be deleted
EOF
}

# Default values
TARGET_PATH="."
DRY_RUN=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
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
            shift
            ;;
    esac
done

# Check if target path exists
if [[ ! -d "$TARGET_PATH" ]]; then
    err "Directory does not exist: $TARGET_PATH"
    exit 1
fi

# Convert to absolute path
TARGET_PATH="$(realpath "$TARGET_PATH")"

info "Searching for Zone.Identifier files in: $TARGET_PATH"

# Find all Zone.Identifier files recursively
ZONE_FILES=()
while IFS= read -r -d '' file; do
    ZONE_FILES+=("$file")
done < <(find "$TARGET_PATH" -name "*:Zone.Identifier" -type f -print0 2>/dev/null || true)

if [[ ${#ZONE_FILES[@]} -eq 0 ]]; then
    info "No Zone.Identifier files found"
    exit 0
fi

info "Found ${#ZONE_FILES[@]} Zone.Identifier files"

deleted_count=0

for file in "${ZONE_FILES[@]}"; do
    if [[ "$DRY_RUN" == true ]]; then
        echo -e "\033[36mWould delete:\033[0m $file"
    else
        if rm -f "$file" 2>/dev/null; then
            echo -e "\033[32mDeleted:\033[0m $file"
            deleted_count=$((deleted_count + 1))
        else
            warn "Failed to delete: $file"
        fi
    fi
done

if [[ "$DRY_RUN" == true ]]; then
    info "DRY RUN: Would have deleted ${#ZONE_FILES[@]} Zone.Identifier files"
else
    info "Successfully deleted $deleted_count of ${#ZONE_FILES[@]} Zone.Identifier files"
fi