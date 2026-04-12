#!/usr/bin/env bash

# shellcheck disable=SC2148
# validate-goat-flow-setup.sh
#
# GOAT-Flow setup validation entrypoint.
# Verifies repository governance and onboarding invariants used by the
# goat-flow auditor, including:
#   - Router wiring in instruction files
#   - Required skill files and facts used by the CLI
#   - Learning-loop surfaces (lessons / footguns / decisions)
#   - Setup template composition and consistency checks
#
# Usage:
#   bash scripts/validate-goat-flow-setup.sh
#
# Exit behavior:
#   - 0: all checks passed
#   - 1: one or more checks failed (ERROR/WARN emitted and script exits)
#
# Notes:
#   - Run from repository root or from anywhere (script resolves repo root itself).
#   - Required tools: git, awk, grep, sed, find, bash.
#   - Optional: node (for CLI template-reference validation).

set -euo pipefail

# Always execute from repository root so all relative checks are stable.
ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

# Lightweight logger helpers: keep all validation output machine- and human-readable.
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

# Regex for extracting backtick-quoted references in router sections.
# shellcheck disable=SC2016  # pattern contains shell metacharacters by design
backtick_ref_pattern='`[^`]+`'

# Regex for evidence markers in lessons/footguns, e.g. `file.md` or `path/to/file.ts:12`.
# shellcheck disable=SC2016
evidence_ref_pattern='`[^`]+\.[a-zA-Z]+`'

# Foundation validation: AGENTS.md must exist before deeper checks.
[[ -f AGENTS.md ]] || fail "Missing AGENTS.md"

# Enforce line limits for instruction files (target: 120, hard limit: 150).
for instrfile in AGENTS.md CLAUDE.md GEMINI.md; do
    if [[ -f "$instrfile" ]]; then
        instr_lines=$(wc -l < "$instrfile")
        if (( instr_lines > 150 )); then
            fail "$instrfile exceeds 150-line hard limit ($instr_lines)"
        fi
        info "$instrfile line count: $instr_lines"
    fi
done

# trim_yaml_value is intentionally separate so config value parsing stays readable and
# testable in place. It strips inline comments and quotes.
trim_yaml_value() {
    sed -E 's/[[:space:]]+#.*$//' | sed -E 's/^[[:space:]]+|[[:space:]]+$//g' | sed -E "s/^'(.*)'$/\\1/; s/^\"(.*)\"$/\\1/"
}

# Read a single key from .goat-flow/config.yaml safely. If config doesn't exist
# yet (fresh project), fall back to the caller-provided default.
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

# Resolve canonical directories from config, with sensible defaults when config absent.
# This lets validation run in partially bootstrapped states.
footguns_dir="$(config_path footguns path ".goat-flow/footguns/")"
lessons_dir="$(config_path lessons path ".goat-flow/lessons/")"
tasks_dir="$(config_path tasks path ".goat-flow/tasks/")"
logs_dir="$(config_path logs path ".goat-flow/logs/")"

# Some paths are intentionally allowed to be missing because they are created lazily.
allowed_missing_paths=(
    ".goat-flow/decisions/"
    "$tasks_dir"
    "$logs_dir"
)

# Validate AGENTS.md Router Table references:
# - parse each path between router headings
# - ignore empty lines and wildcards
# - allow known create-on-first-use buckets
# - hard-fail on any other missing path
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

# Validate CLAUDE.md and GEMINI.md router tables if present.
for extra_instrfile in CLAUDE.md GEMINI.md; do
    if [[ -f "$extra_instrfile" ]]; then
        extra_router_errors=0
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
                warn "Missing $extra_instrfile router path: $ref"
                extra_router_errors=1
            fi
        done < <(
            awk '
                /^## Router Table/ { in_router=1; next }
                /^## / && in_router { in_router=0 }
                in_router { print }
            ' "$extra_instrfile" | grep -oE "$backtick_ref_pattern" | tr -d '`'
        )

        (( extra_router_errors == 0 )) || fail "$extra_instrfile router table contains missing required paths"
        info "$extra_instrfile router table references resolve"
    fi
done

# Canonical skill files required by setup.
# This list is the single source for what this repo expects to be installed.
# Both .agents/skills (Codex/Gemini) and .claude/skills (Claude) must be present.
required_skills=(
    ".agents/skills/goat-security/SKILL.md"
    ".agents/skills/goat-debug/SKILL.md"
    ".agents/skills/goat-review/SKILL.md"
    ".agents/skills/goat-plan/SKILL.md"
    ".agents/skills/goat-sbao/SKILL.md"
    ".agents/skills/goat-test/SKILL.md"
    ".agents/skills/goat/SKILL.md"
    ".claude/skills/goat-security/SKILL.md"
    ".claude/skills/goat-debug/SKILL.md"
    ".claude/skills/goat-review/SKILL.md"
    ".claude/skills/goat-plan/SKILL.md"
    ".claude/skills/goat-sbao/SKILL.md"
    ".claude/skills/goat-test/SKILL.md"
    ".claude/skills/goat/SKILL.md"
)

# For each required skill, validate presence plus required structure.
# The dispatcher (`goat`) intentionally has a different top-level section label.
for skill in "${required_skills[@]}"; do
    [[ -f "$skill" ]] || fail "Missing skill: $skill"
    # Every skill must advertise when to call it; dispatcher is allowed to use
    # "How It Works" because it has a different doc shape.
    # Dispatcher uses 'How It Works' instead of 'When to Use' - accept either
    grep -Eq '^## (When to Use|How It Works)' "$skill" || fail "Missing '## When to Use' (or '## How It Works' for dispatcher) in $skill"
    # "Constraints"/"Process"/"Phase" ensures each skill documents execution guidance.
    grep -Eq '^## (Constraints|Process|Phase)' "$skill" || fail "Missing '## Constraints', '## Process', or '## Phase' in $skill"
    # Canonical non-dispatcher skills must include an explicit output contract.
    # Dispatcher has no Output section - only require it for canonical skills
    if [[ "$skill" != *"/goat/SKILL.md" ]]; then
        grep -Eq '^## Output' "$skill" || fail "Missing '## Output' or '## Output Format' in $skill"
    fi
    # Frontmatter must define stable identifiers for scanner + docs alignment.
    grep -q '^name:' "$skill" || fail "Missing YAML frontmatter 'name:' in $skill"
    grep -q '^description:' "$skill" || fail "Missing YAML frontmatter 'description:' in $skill"
done
info "All 14 skills (7 per agent directory) exist with required sections and frontmatter"

# Validate category buckets for lessons; keep legacy flat files as warnings only.
if [[ -d "$lessons_dir" ]]; then
    mapfile -t lesson_entries < <(find "$lessons_dir" -maxdepth 1 -type f -name '*.md' ! -name 'README.md' | sort)
    if (( ${#lesson_entries[@]} == 0 )); then
        fail "$lessons_dir exists but contains no lesson category files"
    else
        info "$lessons_dir contains lesson category files"
    fi
else
    info "No lessons directory ($lessons_dir) - acceptable if setup could not seed real entries"
fi
warn_if_legacy_surface_exists "docs/lessons.md" "$lessons_dir" "lesson"

# Validate category buckets for footguns and enforce evidence requirement.
# The special-case "none confirmed yet" allows a placeholder acknowledgement.
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
    info "No footguns directory ($footguns_dir) - acceptable if setup could not seed real entries"
fi
warn_if_legacy_surface_exists "docs/footguns.md" "$footguns_dir" "footgun"

# Validate utility scripts remain executable for CI and local command usage.
    for script in scripts/preflight-checks.sh scripts/validate-goat-flow-setup.sh scripts/deny-dangerous.sh; do
    [[ -x "$script" ]] || fail "Script is not executable: $script"
done
info "Required scripts are executable"

# Validate template consistency for setup reference docs:
# - execution-loop must exist
# - lesson/footgun evaluation templates must exist and declare category semantics.
template_errors=0

if [[ ! -f workflow/setup/reference/execution-loop.md ]]; then
    warn "Missing template file: workflow/setup/reference/execution-loop.md"
    template_errors=1
fi

if [[ ! -f workflow/evaluation/lessons.md ]]; then
    # Lessons template defines category buckets; missing this breaks the migration model.
    warn "Missing template file: workflow/evaluation/lessons.md"
    template_errors=1
elif ! grep -Fq 'category: verification' workflow/evaluation/lessons.md; then
    # This exact marker is used by setup checks to classify lesson content.
    warn "workflow/evaluation/lessons.md should describe the category-bucket format"
    template_errors=1
fi

if [[ ! -f workflow/evaluation/footguns.md ]]; then
    # Footgun template includes required evidence and severity conventions.
    warn "Missing template file: workflow/evaluation/footguns.md"
    template_errors=1
elif ! grep -Fq 'category: hooks' workflow/evaluation/footguns.md; then
    # Keep the template in sync with the scanner's category expectation.
    warn "workflow/evaluation/footguns.md should describe the category-bucket format"
    template_errors=1
fi

if [[ "$template_errors" -ne 0 ]]; then
    fail "Template consistency checks failed"
fi
info "Template consistency checks passed"

# Validate setup prompt template refs from the built CLI index (M2.11):
# this keeps file existence checks aligned with runtime template resolution.
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

# Final output only appears when all required checks have passed.
info "Context validation passed"
