#!/usr/bin/env bash

set -euo pipefail

# Script to delete local branches that have been merged into the default branch

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
Usage: $0 [OPTIONS]

Deletes local branches that have been merged into the default branch.
Protects main, master, and develop from deletion.

OPTIONS:
    -h, --help      Show this help message
    -n, --dry-run   Show which branches would be deleted without deleting
    --remote        Also prune remote-tracking branches (git fetch --prune)

EXAMPLES:
    $0                  # Delete merged local branches
    $0 --dry-run        # Preview which branches would be deleted
    $0 --remote         # Also prune stale remote-tracking branches
EOF
}

# Default values
DRY_RUN=false
PRUNE_REMOTE=false
PROTECTED_BRANCHES="main master develop"

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
        --remote)
            PRUNE_REMOTE=true
            shift
            ;;
        -*)
            err "Unknown option: $1"
            show_help
            exit 1
            ;;
        *)
            err "Unexpected argument: $1"
            show_help
            exit 1
            ;;
    esac
done

# Ensure we're in a git repo
if ! git rev-parse --is-inside-work-tree &>/dev/null; then
    err "Not inside a git repository"
    exit 1
fi

# Detect default branch
DEFAULT_BRANCH=""
for candidate in main master; do
    if git show-ref --verify --quiet "refs/heads/$candidate" 2>/dev/null; then
        DEFAULT_BRANCH="$candidate"
        break
    fi
done

if [[ -z "$DEFAULT_BRANCH" ]]; then
    err "Could not detect default branch (tried main, master)"
    exit 1
fi

info "Default branch: $DEFAULT_BRANCH"

# Switch to default branch if not already on it
CURRENT_BRANCH=$(git branch --show-current 2>/dev/null)
if [[ "$CURRENT_BRANCH" != "$DEFAULT_BRANCH" ]]; then
    info "Switching to $DEFAULT_BRANCH"
    git checkout "$DEFAULT_BRANCH" --quiet
fi

# Prune remote-tracking branches
if [[ "$PRUNE_REMOTE" == true ]]; then
    info "Pruning remote-tracking branches..."
    if [[ "$DRY_RUN" == true ]]; then
        git fetch --prune --dry-run 2>&1 | while IFS= read -r line; do
            echo -e "\033[36mWould prune:\033[0m $line"
        done
    else
        pruned=$(git fetch --prune 2>&1)
        if [[ -n "$pruned" ]]; then
            echo "$pruned" | while IFS= read -r line; do
                echo -e "\033[32mPruned:\033[0m $line"
            done
        else
            info "No stale remote-tracking branches"
        fi
    fi
    echo ""
fi

# Find merged branches
MERGED_BRANCHES=()
while IFS= read -r branch; do
    branch="${branch## }"
    branch="${branch%%[[:space:]]*}"

    # Skip empty lines
    [[ -z "$branch" ]] && continue

    # Skip protected branches
    is_protected=false
    for protected in $PROTECTED_BRANCHES; do
        if [[ "$branch" == "$protected" ]]; then
            is_protected=true
            break
        fi
    done
    [[ "$is_protected" == true ]] && continue

    MERGED_BRANCHES+=("$branch")
done < <(git branch --merged "$DEFAULT_BRANCH" 2>/dev/null)

if [[ ${#MERGED_BRANCHES[@]} -eq 0 ]]; then
    info "No merged branches to clean up"
    exit 0
fi

info "Found ${#MERGED_BRANCHES[@]} merged branch(es)"

deleted_count=0

for branch in "${MERGED_BRANCHES[@]}"; do
    if [[ "$DRY_RUN" == true ]]; then
        echo -e "\033[36mWould delete:\033[0m $branch"
    else
        if git branch -d "$branch" &>/dev/null; then
            echo -e "\033[32mDeleted:\033[0m $branch"
            deleted_count=$((deleted_count + 1))
        else
            warn "Failed to delete: $branch"
        fi
    fi
done

if [[ "$DRY_RUN" == true ]]; then
    info "DRY RUN: Would have deleted ${#MERGED_BRANCHES[@]} branch(es)"
else
    info "Deleted $deleted_count of ${#MERGED_BRANCHES[@]} merged branch(es)"
fi
