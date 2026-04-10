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
# Accept both file:line refs and bare file paths as evidence
evidence_ref_pattern='`[^`]+\.[a-zA-Z]+`'

[[ -f AGENTS.md ]] || fail "Missing AGENTS.md"

agents_lines=$(wc -l < AGENTS.md)
if (( agents_lines > 135 )); then
    fail "AGENTS.md exceeds 135-line target ($agents_lines)"
fi
info "AGENTS.md line count: $agents_lines"

trim_yaml_value() {
    sed -E 's/[[:space:]]+#.*$//' | sed -E 's/^[[:space:]]+|[[:space:]]+$//g' | sed -E "s/^'(.*)'$/\\1/; s/^\"(.*)\"$/\\1/"
}

config_path() {
    local section=$1
    local key=$2
    local default_value=$3

    if [[ ! -f .goat-flow/config.yaml ]]; then
        printf '%s\n' "$default_value"
        return
    fi

    local value
    value="$(
        awk -v section="$section" -v key="$key" '
            $0 ~ "^" section ":" { in_section = 1; next }
            in_section && $0 ~ "^[^[:space:]]" { in_section = 0 }
            in_section && $1 == key ":" {
                sub(/^[[:space:]]*[^:]+:[[:space:]]*/, "", $0)
                print $0
                exit
            }
        ' .goat-flow/config.yaml | trim_yaml_value
    )"

    if [[ -n "$value" ]]; then
        printf '%s\n' "$value"
    else
        printf '%s\n' "$default_value"
    fi
}

warn_if_legacy_surface_exists() {
    local legacy_path=$1
    local canonical_path=$2
    local kind=$3

    if [[ -e "$legacy_path" ]]; then
        warn "Legacy $kind surface still exists at $legacy_path. Canonical path is $canonical_path"
    fi
}

footguns_dir="$(config_path footguns path ".goat-flow/footguns/")"
lessons_dir="$(config_path lessons path ".goat-flow/lessons/")"
tasks_dir="$(config_path tasks path ".goat-flow/tasks/")"
logs_dir="$(config_path logs path ".goat-flow/logs/")"

allowed_missing_paths=(
    ".goat-flow/decisions/"
    "$tasks_dir"
    "$logs_dir"
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

(( router_errors == 0 )) || fail "AGENTS.md router table contains missing required paths"
info "AGENTS.md router table references resolve"

# Validate CLAUDE.md router table if it exists
if [[ -f CLAUDE.md ]]; then
    claude_router_errors=0
    while IFS= read -r ref; do
        [[ -z "$ref" ]] && continue
        [[ "$ref" == *"*"* ]] && continue

        if [[ -e "$ref" ]]; then
            continue
        fi

        allowed=0
        for allowed_ref in "${allowed_missing_paths[@]}"; do
            if [[ "$ref" == "$allowed_ref" ]]; then
                allowed=1
                break
            fi
        done

        if (( allowed == 0 )); then
            warn "Missing CLAUDE.md router path: $ref"
            claude_router_errors=1
        fi
    done < <(
        awk '
            /^## Router Table/ { in_router=1; next }
            /^## / && in_router { in_router=0 }
            in_router { print }
        ' CLAUDE.md | grep -oE "$backtick_ref_pattern" | tr -d '`'
    )

    (( claude_router_errors == 0 )) || fail "CLAUDE.md router table contains missing required paths"
    info "CLAUDE.md router table references resolve"
fi

required_skills=(
    ".agents/skills/goat-security/SKILL.md"
    ".agents/skills/goat-debug/SKILL.md"
    ".agents/skills/goat-review/SKILL.md"
    ".agents/skills/goat-plan/SKILL.md"
    ".agents/skills/goat-test/SKILL.md"
    ".agents/skills/goat/SKILL.md"
)

for skill in "${required_skills[@]}"; do
    [[ -f "$skill" ]] || fail "Missing skill: $skill"
    # Dispatcher uses 'How It Works' instead of 'When to Use' - accept either
    grep -Eq '^## (When to Use|How It Works)' "$skill" || fail "Missing '## When to Use' (or '## How It Works' for dispatcher) in $skill"
    grep -Eq '^## (Constraints|Process|Phase)' "$skill" || fail "Missing '## Constraints', '## Process', or '## Phase' in $skill"
    # Dispatcher has no Output section - only require it for canonical skills
    if [[ "$skill" != *"/goat/SKILL.md" ]]; then
        grep -Eq '^## Output' "$skill" || fail "Missing '## Output' or '## Output Format' in $skill"
    fi
    grep -q '^name:' "$skill" || fail "Missing YAML frontmatter 'name:' in $skill"
    grep -q '^description:' "$skill" || fail "Missing YAML frontmatter 'description:' in $skill"
done
info "All 6 skills (5 + dispatcher) exist with required sections and frontmatter"

if [[ -d "$lessons_dir" ]]; then
    mapfile -t lesson_entries < <(find "$lessons_dir" -maxdepth 1 -type f -name '*.md' ! -name 'README.md' | sort)
    if (( ${#lesson_entries[@]} == 0 )); then
        fail "$lessons_dir exists but contains no lesson category files"
    else
        info "$lessons_dir contains lesson category files"
    fi
else
    fail "Missing canonical lessons directory ($lessons_dir)"
fi
warn_if_legacy_surface_exists "docs/lessons.md" "$lessons_dir" "lesson"

if [[ -d "$footguns_dir" ]]; then
    mapfile -t footgun_entries < <(find "$footguns_dir" -maxdepth 1 -type f -name '*.md' ! -name 'README.md' | sort)
    if (( ${#footgun_entries[@]} == 0 )); then
        fail "$footguns_dir exists but contains no footgun category files"
    elif grep -Rqi 'none confirmed yet' "$footguns_dir"; then
        info "$footguns_dir explicitly states no confirmed footguns yet"
    elif ! grep -REq "$evidence_ref_pattern" "${footgun_entries[@]}"; then
        fail "$footguns_dir has no file path evidence in entry files"
    else
        info "$footguns_dir contains footgun entries with file path evidence"
    fi
else
    fail "Missing canonical footguns directory ($footguns_dir)"
fi
warn_if_legacy_surface_exists "docs/footguns.md" "$footguns_dir" "footgun"

for script in scripts/preflight-checks.sh scripts/context-validate.sh scripts/deny-dangerous.sh; do
    [[ -x "$script" ]] || fail "Script is not executable: $script"
done
info "Codex scripts are executable"

# Validate template consistency for deduplicated execution-loop + execution docs
template_errors=0

if [[ ! -f workflow/setup/reference/execution-loop.md ]]; then
    warn "Missing template file: workflow/setup/reference/execution-loop.md"
    template_errors=1
fi

if [[ ! -f workflow/evaluation/lessons.md ]]; then
    warn "Missing template file: workflow/evaluation/lessons.md"
    template_errors=1
elif ! grep -Fq 'category: verification' workflow/evaluation/lessons.md; then
    warn "workflow/evaluation/lessons.md should describe the category-bucket format"
    template_errors=1
fi

if [[ ! -f workflow/evaluation/footguns.md ]]; then
    warn "Missing template file: workflow/evaluation/footguns.md"
    template_errors=1
elif ! grep -Fq 'category: hooks' workflow/evaluation/footguns.md; then
    warn "workflow/evaluation/footguns.md should describe the category-bucket format"
    template_errors=1
fi

if [[ "$template_errors" -ne 0 ]]; then
    fail "Template consistency checks failed"
fi
info "Template consistency checks passed"

# Validate setup prompt template refs (M2.11)
# Uses the built CLI to check all template paths referenced by the setup renderer
if [[ -f dist/cli/prompt/template-refs.js ]]; then
    template_errors=0
    while IFS= read -r tmpl; do
        if [[ ! -f "$tmpl" ]]; then
            warn "Missing setup template: $tmpl"
            template_errors=1
        fi
    done < <(
        node -e "
import('./dist/cli/prompt/template-refs.js').then(m => {
  for (const agent of ['claude', 'codex', 'gemini']) {
    const refs = m.getAgentTemplates(agent);
    const seen = new Set();
    for (const ref of refs) {
      if (!seen.has(ref.template)) {
        seen.add(ref.template);
        console.log(ref.template);
      }
    }
  }
});
" 2>/dev/null
    )
    (( template_errors == 0 )) || fail "Setup template references contain missing files"
    info "Setup template references all resolve"
else
    warn "dist/cli/prompt/template-refs.js not built - skipping template ref validation"
fi

info "Context validation passed"
