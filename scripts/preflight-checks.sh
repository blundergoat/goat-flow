#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR" || exit 1

# ── Colours (disabled if not a terminal) ─────────────────────────────
if [[ -t 1 ]]; then
    R='\033[0;31m' G='\033[0;32m' Y='\033[0;33m' B='\033[0;34m'
    DIM='\033[2m' BOLD='\033[1m' RST='\033[0m'
else
    R='' G='' Y='' B='' DIM='' BOLD='' RST=''
fi

errors=0
warnings=0
checks=0

# ── Helpers ──────────────────────────────────────────────────────────
section() { echo -e "\n${B}━━ $1${RST}"; }
pass()    { checks=$((checks + 1)); echo -e "  ${G}✓${RST} $1"; }
fail()    { checks=$((checks + 1)); errors=$((errors + 1)); echo -e "  ${R}✗${RST} $1" >&2; }
skip()    { echo -e "  ${DIM}⊘ $1 (skipped)${RST}"; }
note()    { warnings=$((warnings + 1)); echo -e "  ${Y}⚠${RST} $1"; }

# ── Context Validation ───────────────────────────────────────────────
section "Context Validation"
if bash scripts/context-validate.sh >/dev/null 2>&1; then
    pass "Router paths, skills, frontmatter"
else
    fail "Context validation — run scripts/context-validate.sh for details"
fi

# ── Shell Scripts ────────────────────────────────────────────────────
section "Shell Scripts"
if bash -n scripts/*.sh scripts/maintenance/*.sh 2>/dev/null; then
    pass "Bash syntax"
else
    fail "Bash syntax check"
fi

if command -v shellcheck >/dev/null 2>&1; then
    if shellcheck --exclude=SC2001 scripts/*.sh scripts/maintenance/*.sh >/dev/null 2>&1; then
        pass "Shellcheck"
    else
        fail "Shellcheck — run shellcheck scripts/*.sh for details"
    fi
else
    skip "Shellcheck (not installed)"
fi

# ── Deny Policy ──────────────────────────────────────────────────────
section "Deny Policy"
if bash scripts/deny-dangerous.sh --self-test >/dev/null 2>&1; then
    pass "Self-test ($(bash scripts/deny-dangerous.sh --self-test 2>&1 | grep -c PASS) assertions)"
else
    fail "Deny policy self-test"
fi

# ── Version Consistency ──────────────────────────────────────────────
section "Version Consistency"
if [[ -f package.json ]] && [[ -f src/cli/rubric/version.ts ]]; then
    pkg_version=$(node -e "console.log(require('./package.json').version)")
    rubric_version=$(grep "RUBRIC_VERSION" src/cli/rubric/version.ts | grep -oE "'[^']+'" | tr -d "'")
    schema_version=$(grep "SCHEMA_VERSION" src/cli/rubric/version.ts | grep -oE "'[^']+'" | tr -d "'")

    pass "package.json ($pkg_version)"

    # RUBRIC_VERSION should be valid semver and ≤ package version
    if [[ -n "$rubric_version" ]]; then
        pass "RUBRIC_VERSION ($rubric_version)"
    else
        fail "RUBRIC_VERSION not found in version.ts"
    fi

    # SCHEMA_VERSION should be a positive integer
    if [[ "$schema_version" =~ ^[0-9]+$ ]] && [[ "$schema_version" -gt 0 ]]; then
        pass "SCHEMA_VERSION ($schema_version)"
    else
        fail "SCHEMA_VERSION invalid: '$schema_version' (expected positive integer)"
    fi

    # CHANGELOG.md newest version should match package.json + RUBRIC_VERSION
    if [[ -f CHANGELOG.md ]]; then
        changelog_version=$(grep -oP '^## v\K[0-9]+\.[0-9]+\.[0-9]+' CHANGELOG.md | head -1)
        if [[ -n "$changelog_version" ]]; then
            pass "CHANGELOG.md newest entry (v${changelog_version})"
            if [[ "$pkg_version" != "$changelog_version" ]]; then
                fail "package.json ($pkg_version) does not match CHANGELOG.md newest (v${changelog_version})"
            fi
            if [[ -n "$rubric_version" ]] && [[ "$rubric_version" != "$changelog_version" ]]; then
                note "RUBRIC_VERSION ($rubric_version) differs from CHANGELOG.md newest (v${changelog_version}) — bump if rubric changed"
            fi
        else
            fail "CHANGELOG.md has no version entry matching '## vX.Y.Z'"
        fi
    else
        note "No CHANGELOG.md found"
    fi

    # Warn if rubric files changed but RUBRIC_VERSION didn't
    if command -v git >/dev/null 2>&1; then
        rubric_changed=$(git diff --name-only src/cli/rubric/ 2>/dev/null | grep -v version.ts | head -1 || true)
        version_changed=$(git diff --name-only src/cli/rubric/version.ts 2>/dev/null || true)
        if [[ -n "$rubric_changed" ]] && [[ -z "$version_changed" ]]; then
            note "Rubric files changed but RUBRIC_VERSION unchanged — consider bumping"
        fi
    fi
else
    skip "Version check (missing package.json or version.ts)"
fi

# ── TypeScript ───────────────────────────────────────────────────────
if [[ -f tsconfig.json ]]; then
    section "TypeScript"

    if npx tsc --noEmit 2>/dev/null; then
        pass "Typecheck"
    else
        fail "Typecheck — run npx tsc --noEmit for details"
    fi

    if npx tsc 2>/dev/null; then
        pass "Build (dist/ producible)"
    else
        fail "Build"
    fi

    # ESLint (type-checked rules)
    if command -v npx >/dev/null 2>&1 && [[ -f eslint.config.mjs ]]; then
        lint_output=$(npx eslint src/cli/ 2>&1) && lint_exit=0 || lint_exit=$?
        lint_errors=$(echo "$lint_output" | grep -c ' error ' || echo "0")
        lint_warnings=$(echo "$lint_output" | grep -c ' warning ' || echo "0")
        if [[ "$lint_exit" -eq 0 ]]; then
            pass "ESLint ($lint_warnings warnings)"
        elif [[ "$lint_errors" -gt 0 ]]; then
            fail "ESLint ($lint_errors errors, $lint_warnings warnings) — run npx eslint src/cli/"
        else
            pass "ESLint (0 errors, $lint_warnings warnings)"
        fi
    else
        skip "ESLint (not configured)"
    fi

    # Knip (unused exports, dead code — breaking error)
    if command -v npx >/dev/null 2>&1 && npx knip --version >/dev/null 2>&1; then
        knip_output=$(npx knip --no-progress 2>&1) && knip_exit=0 || knip_exit=$?
        if [[ "$knip_exit" -eq 0 ]]; then
            pass "Knip (no unused exports or deps)"
        else
            unused_count=$(echo "$knip_output" | grep -c '^[A-Za-z].*  ' || echo "?")
            fail "Knip: $unused_count unused exports/types — run npx knip for details"
        fi
    else
        skip "Knip (not installed)"
    fi

    # Quality checks (warnings, not failures)
    console_hits=$(grep -rn 'console\.log' src/cli/ --include='*.ts' | grep -v 'cli.ts' | grep -v 'render/' || true)
    [[ -n "$console_hits" ]] && note "console.log outside cli.ts/render/ ($(echo "$console_hits" | wc -l) hits)"

    any_hits=$(grep -rn ': any\b' src/cli/ --include='*.ts' || true)
    [[ -n "$any_hits" ]] && note "Explicit 'any' types ($(echo "$any_hits" | wc -l) hits)"

    todo_hits=$(grep -rn 'TODO\|FIXME\|HACK' src/cli/ --include='*.ts' || true)
    [[ -n "$todo_hits" ]] && note "TODOs ($(echo "$todo_hits" | wc -l) hits)"
fi

# ── Tests ────────────────────────────────────────────────────────────
if [[ -f package.json ]] && grep -q '"test"' package.json; then
    section "Tests"
    test_output=$(npm test 2>&1) && test_exit=0 || test_exit=$?

    test_count=$(echo "$test_output" | grep '# tests' | grep -oE '[0-9]+' || echo "?")
    pass_count=$(echo "$test_output" | grep '# pass' | grep -oE '[0-9]+' || echo "?")
    fail_count=$(echo "$test_output" | grep '# fail' | grep -oE '[0-9]+' || echo "0")

    if [[ "$test_exit" -eq 0 ]]; then
        pass "All passing ($pass_count/$test_count)"
    else
        fail "Tests failed ($fail_count/$test_count failures)"
        echo "$test_output" | grep 'not ok' | head -5 | sed 's/^/    /'
    fi
fi

# ── Removed Patterns (ADR Enforcement) ───────────────────────────────
section "ADR Enforcement"
removed_patterns=(
    "APP.*LIBRARY.*SCRIPT COLLECTION"
    "confusion.log\.md"
    "ProjectShape"
    "detectShape"
    "--shape"
)
adr_clean=true
for pattern in "${removed_patterns[@]}"; do
    hits=$(grep -rn "$pattern" setup/ workflow/ src/ test/ docs/ ai/ .github/ --include='*.md' --include='*.ts' --include='*.yml' 2>/dev/null \
        | grep -v 'CHANGELOG\|TODO_\|ADR-\|design-rationale\|footguns.*RESOLVED\|decisions/\|preflight-checks' || true)
    if [[ -n "$hits" ]]; then
        fail "Removed pattern '$pattern' still found"
        echo "$hits" | head -3 | sed 's/^/    /'
        adr_clean=false
    fi
done
$adr_clean && pass "No removed patterns found"

# ── GOAT Flow Scan ────────────────────────────────────────────────────
if [[ -f dist/cli/cli.js ]]; then
    section "GOAT Flow Scan"
    scan_output=$(node dist/cli/cli.js scan . --format text 2>&1) && scan_exit=0 || scan_exit=$?
    if [[ "$scan_exit" -eq 0 ]]; then
        # Extract per-agent grades and check for any below A
        grades=$(echo "$scan_output" | grep -oP 'Grade: \K\S+ \(\d+%\)')
        all_a=true
        while IFS= read -r grade; do
            [[ -z "$grade" ]] && continue
            pct=$(echo "$grade" | grep -oP '\d+')
            if [[ "$pct" -lt 100 ]]; then
                all_a=false
                note "Scan: $grade (target: 100%)"
            fi
        done <<< "$grades"
        if $all_a; then
            pass "All agents at 100%"
        else
            fail "Not all agents at 100% — run: node dist/cli/cli.js scan . --format text"
        fi
    else
        fail "goat-flow scan failed (exit $scan_exit)"
    fi
else
    skip "GOAT Flow Scan (dist/cli/cli.js not built)"
fi

# ── Summary ──────────────────────────────────────────────────────────
echo ""
echo -e "${DIM}─────────────────────────────────────────────────${RST}"
if [[ "$errors" -gt 0 ]]; then
    echo -e "${BOLD}${R}PREFLIGHT FAILED${RST}  ${errors} error(s), ${warnings} warning(s), ${checks} checks"
    exit 1
fi
echo -e "${BOLD}${G}PREFLIGHT PASSED${RST}  ${checks} checks, ${warnings} warning(s)"
