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

required_skills=(
    ".agents/skills/goat-security/SKILL.md"
    ".agents/skills/goat-debug/SKILL.md"
    ".agents/skills/goat-audit/SKILL.md"
    ".agents/skills/goat-investigate/SKILL.md"
    ".agents/skills/goat-review/SKILL.md"
    ".agents/skills/goat-plan/SKILL.md"
    ".agents/skills/goat-test/SKILL.md"
    ".agents/skills/goat-reflect/SKILL.md"
    ".agents/skills/goat-onboard/SKILL.md"
    ".agents/skills/goat-resume/SKILL.md"
)

for skill in "${required_skills[@]}"; do
    [[ -f "$skill" ]] || fail "Missing skill: $skill"
    grep -q '^## When to Use' "$skill" || fail "Missing '## When to Use' in $skill"
    grep -Eq '^## (Constraints|Process|Phase)' "$skill" || fail "Missing '## Constraints', '## Process', or '## Phase' in $skill"
    grep -Eq '^## Output' "$skill" || fail "Missing '## Output' or '## Output Format' in $skill"
    grep -q '^name:' "$skill" || fail "Missing YAML frontmatter 'name:' in $skill"
    grep -q '^description:' "$skill" || fail "Missing YAML frontmatter 'description:' in $skill"
done
info "All 10 skills exist with required sections and frontmatter"

if [[ -d agent-evals ]]; then
    [[ -f agent-evals/README.md ]] || fail "Missing agent-evals/README.md"
    info "Agent eval directory exists (agent-evals/)"
elif [[ -d codex-evals ]]; then
    [[ -f codex-evals/README.md ]] || fail "Missing codex-evals/README.md"
    info "Codex eval directory exists (codex-evals/)"
else
    fail "Missing eval directory (agent-evals/ or codex-evals/)"
fi

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
