#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

info() {
    echo "INFO: $1"
}

warn() {
    echo "WARN: $1" >&2
}

fail() {
    echo "ERROR: $1" >&2
    exit 1
}

# shellcheck disable=SC2016
backtick_ref_pattern='`[^`]+`'
# shellcheck disable=SC2016
evidence_ref_pattern='`[^`]+:[0-9]+`'

[[ -f AGENTS.md ]] || fail "Missing AGENTS.md"

agents_lines=$(wc -l < AGENTS.md)
if (( agents_lines > 135 )); then
    fail "AGENTS.md exceeds 135-line target ($agents_lines)"
fi
info "AGENTS.md line count: $agents_lines"

allowed_missing_paths=(
    "docs/confusion-log.md"
    "docs/decisions/"
)

router_errors=0
while IFS= read -r ref; do
    [[ -z "$ref" ]] && continue
    [[ "$ref" == *"*"* ]] && continue

    if [[ -e "$ref" ]]; then
        continue
    fi

    allowed=0
    for allowed_ref in "${allowed_missing_paths[@]}"; do
        if [[ "$ref" == "$allowed_ref" ]]; then
            warn "Create-on-first-use path routed but not materialised yet: $ref"
            allowed=1
            break
        fi
    done

    if (( allowed == 0 )); then
        warn "Missing router path: $ref"
        router_errors=1
    fi
done < <(
    awk '
        /^## Router Table/ { in_router=1; next }
        /^## / && in_router { in_router=0 }
        in_router { print }
    ' AGENTS.md | grep -oE "$backtick_ref_pattern" | tr -d '`'
)

(( router_errors == 0 )) || fail "Router table contains missing required paths"
info "Router table references resolve"

required_playbooks=(
    "docs/codex-playbooks/goat-preflight.md"
    "docs/codex-playbooks/goat-debug.md"
    "docs/codex-playbooks/goat-audit.md"
    "docs/codex-playbooks/goat-research.md"
    "docs/codex-playbooks/goat-review.md"
)

for playbook in "${required_playbooks[@]}"; do
    [[ -f "$playbook" ]] || fail "Missing playbook: $playbook"
    grep -q '^## When to Use' "$playbook" || fail "Missing '## When to Use' in $playbook"
    grep -q '^## Process' "$playbook" || fail "Missing '## Process' in $playbook"
    grep -q '^## Output' "$playbook" || fail "Missing '## Output' in $playbook"
done
info "All 5 Codex playbooks exist with required sections"

[[ -d codex-evals ]] || fail "Missing codex-evals/"
[[ -f codex-evals/README.md ]] || fail "Missing codex-evals/README.md"
info "Codex eval directory exists"

if grep -qi 'none confirmed yet' docs/footguns.md; then
    info "docs/footguns.md explicitly states no confirmed footguns yet"
elif ! grep -Eq "$evidence_ref_pattern" docs/footguns.md; then
    fail "docs/footguns.md has no file:line evidence"
else
    info "docs/footguns.md contains file:line evidence"
fi

for script in scripts/preflight-checks.sh scripts/context-validate.sh scripts/deny-dangerous.sh; do
    [[ -x "$script" ]] || fail "Script is not executable: $script"
done
info "Codex scripts are executable"

info "Context validation passed"
