#!/usr/bin/env bash

# preflight-checks.sh
#
# Purpose:
#   Runs the local pre-flight quality gate used before risky edits or releases.
#
# Usage:
#   bash scripts/preflight-checks.sh
#
# Behavior:
#   - runs project quality gates
#   - runs shell and CLI syntax checks
#   - checks formatting and project-specific quality signals
#
# Exit:
#   0 when all checks pass, non-zero on any failing check.
#
# Requirements:
#   - bash, node, npm, git

set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR" || exit 1
MANIFEST_PATH="$ROOT_DIR/workflow/manifest.json"

manifest_eval() {
    node - "$MANIFEST_PATH" "$@" <<'NODE'
const fs = require("node:fs");

const manifestPath = process.argv[2];
const mode = process.argv[3];
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

if (mode === "skill-roots") {
  const roots = [
    ...new Set(
      Object.values(manifest.agents || {})
        .map((agent) =>
          typeof agent.skills_dir === "string"
            ? agent.skills_dir.replace(/\/$/, "")
            : "",
        )
        .filter(Boolean),
    ),
  ];
  for (const root of roots) console.log(root);
  process.exit(0);
}

if (mode === "hook-dirs") {
  const dirs = [
    ...new Set(
      Object.values(manifest.agents || {})
        .map((agent) =>
          typeof agent.hooks_dir === "string"
            ? agent.hooks_dir.replace(/\/$/, "")
            : "",
        )
        .filter(Boolean),
    ),
  ];
  for (const dir of dirs) console.log(dir);
  process.exit(0);
}

if (mode === "supported-skills") {
  for (const skill of manifest.skills?.canonical || []) console.log(skill);
  process.exit(0);
}

if (mode === "skill-files") {
  const skillName = process.argv[4];
  const canonical = manifest.skills?.canonical;
  const references = manifest.skills?.references || {};
  if (!Array.isArray(canonical) || !canonical.includes(skillName)) {
    process.stderr.write(`unknown skill: ${skillName}\n`);
    process.exit(2);
  }
  const referenceFiles = Array.isArray(references[skillName])
    ? references[skillName].filter((value) => typeof value === "string")
    : [];
  const files = [
    "SKILL.md",
    ...referenceFiles,
  ];
  for (const file of files) console.log(file);
  process.exit(0);
}

process.stderr.write(`unknown manifest_eval mode: ${mode}\n`);
process.exit(1);
NODE
}

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

# Millisecond-precision timing with portable fallback (macOS date lacks %N)
if date +%s%N 2>/dev/null | grep -qv N; then
    now_ms() { echo $(( $(date +%s%N) / 1000000 )); }
elif command -v node >/dev/null 2>&1; then
    now_ms() { node -e 'process.stdout.write(String(Date.now()))'; }
else
    now_ms() { echo $(( $(date +%s) * 1000 )); }
fi
fmt_elapsed() {
    local ms=$(( $1 ))
    local secs=$(( ms / 1000 ))
    local frac=$(( ms % 1000 ))
    printf '%d.%01ds' "$secs" "$(( frac / 100 ))"
}

preflight_start=$(now_ms)
section_start=$(now_ms)

# ── Helpers ──────────────────────────────────────────────────────────
section() {
    # Print elapsed time for the previous section (skip for the first call)
    local now
    now=$(now_ms)
    if [[ "$checks" -gt 0 ]]; then
        echo -e "  ${DIM}($(fmt_elapsed $(( now - section_start ))))${RST}"
    fi
    section_start=$now
    echo -e "\n${B}━━ $1${RST}";
}
pass()    { checks=$((checks + 1)); echo -e "  ${G}✓${RST} $1"; }
fail()    { checks=$((checks + 1)); errors=$((errors + 1)); echo -e "  ${R}✗${RST} $1" >&2; }
warn()    { checks=$((checks + 1)); warnings=$((warnings + 1)); echo -e "  ${Y}⚠${RST} $1"; }
skip()    { echo -e "  ${DIM}⊘ $1 (skipped)${RST}"; }
note()    { warnings=$((warnings + 1)); echo -e "  ${Y}⚠${RST} $1"; }

# ── Shell Scripts ────────────────────────────────────────────────────
section "Shell Scripts"
if bash -n scripts/*.sh scripts/maintenance/*.sh 2>/dev/null; then
    pass "Bash syntax (scripts)"
else
    fail "Bash syntax check (scripts)"
fi

# Also syntax-check installed hooks
while IFS= read -r hookdir; do
    if compgen -G "$hookdir/*.sh" >/dev/null 2>&1; then
        if bash -n "$hookdir"/*.sh 2>/dev/null; then
            pass "Bash syntax ($hookdir/)"
        else
            fail "Bash syntax check ($hookdir/)"
        fi
    fi
done < <(manifest_eval hook-dirs)

if command -v shellcheck >/dev/null 2>&1; then
    if shellcheck --exclude=SC2001 scripts/*.sh scripts/maintenance/*.sh >/dev/null 2>&1; then
        pass "Shellcheck (scripts)"
    else
        fail "Shellcheck (scripts) - run shellcheck scripts/*.sh scripts/maintenance/*.sh for details"
    fi

    # Also shellcheck installed hooks (SC2016 excluded: sed patterns intentionally use single quotes)
    while IFS= read -r hookdir; do
        if compgen -G "$hookdir/*.sh" >/dev/null 2>&1; then
            if shellcheck --exclude=SC2001,SC2016 "$hookdir"/*.sh >/dev/null 2>&1; then
                pass "Shellcheck ($hookdir/)"
            else
                fail "Shellcheck ($hookdir/) - run shellcheck $hookdir/*.sh for details"
            fi
        fi
    done < <(manifest_eval hook-dirs)
else
    warn "Shellcheck not installed - run: bash scripts/setup-initial.sh"
fi

# ── Deny Policy ──────────────────────────────────────────────────────
section "Deny Policy"
if bash scripts/deny-dangerous.sh --self-test >/dev/null 2>&1; then
    pass "scripts/deny-dangerous.sh ($(bash scripts/deny-dangerous.sh --self-test 2>&1 | grep -c PASS) assertions)"
else
    fail "scripts/deny-dangerous.sh self-test"
fi

# Also self-test installed hooks
while IFS= read -r hookdir; do
    if [[ -f "$hookdir/deny-dangerous.sh" ]]; then
        if bash "$hookdir/deny-dangerous.sh" --self-test >/dev/null 2>&1; then
            pass "$hookdir/deny-dangerous.sh self-test"
        else
            fail "$hookdir/deny-dangerous.sh self-test"
        fi
    fi
done < <(manifest_eval hook-dirs)

# Runtime smoke test: pipe a known-blocked command through installed deny hooks
while IFS= read -r hookdir; do
    if [[ -f "$hookdir/deny-dangerous.sh" ]]; then
        if [[ "$hookdir" == ".github/hooks" ]]; then
            test_payload='{"toolName":"bash","toolArgs":"{\"command\":\"rm -rf /\"}"}'
            if output=$(printf '%s' "$test_payload" | bash "$hookdir/deny-dangerous.sh" 2>&1); then
                if echo "$output" | grep -q '"permissionDecision":"deny"'; then
                    pass "$hookdir/deny-dangerous.sh runtime smoke test (copilot payload denied rm -rf)"
                else
                    fail "$hookdir/deny-dangerous.sh did not return a deny decision for Copilot payload"
                fi
            else
                exit_code=$?
                warn "$hookdir/deny-dangerous.sh exited $exit_code on Copilot deny payload (expected 0 + deny JSON)"
            fi
        else
            # Simulate a VS Code-style Bash tool call with a dangerous command
            test_payload='{"tool_name":"Bash","tool_input":{"command":"rm -rf /"}}'
            if printf '%s' "$test_payload" | bash "$hookdir/deny-dangerous.sh" >/dev/null 2>&1; then
                fail "$hookdir/deny-dangerous.sh did not block 'rm -rf /' (exit 0)"
            else
                exit_code=$?
                if [[ $exit_code -eq 2 ]]; then
                    pass "$hookdir/deny-dangerous.sh runtime smoke test (blocked rm -rf)"
                else
                    warn "$hookdir/deny-dangerous.sh exited $exit_code on blocked command (expected 2)"
                fi
            fi
        fi
    fi
done < <(manifest_eval hook-dirs)

# ── Skill Template Versions ──────────────────────────────────────────
section "Skill Template Versions"
skill_version=$(node -e "console.log(require('./package.json').version)" 2>/dev/null || true)
if [[ -z "$skill_version" ]]; then
    note "Could not read version from package.json"
else
    template_fail=0
    while IFS= read -r -d '' f; do
        ver=$(grep -o 'goat-flow-skill-version: "[^"]*"' "$f" | grep -o '"[^"]*"' | tr -d '"' || true)
        if [[ "$ver" != "$skill_version" ]]; then
            fail "Skill template $f has version '$ver', expected '$skill_version'"
            template_fail=1
        fi
    done < <(find workflow/skills -maxdepth 2 -name 'SKILL.md' -print0)
    if [[ "$template_fail" -eq 0 ]]; then
        pass "All workflow skill templates at version $skill_version"
    fi

    # Installed skill copies must also match
    installed_fail=0
    while IFS= read -r dir; do
        if [[ -d "$dir" ]]; then
            while IFS= read -r -d '' f; do
                ver=$(grep -o 'goat-flow-skill-version: "[^"]*"' "$f" | grep -o '"[^"]*"' | tr -d '"' || true)
                if [[ -n "$ver" ]] && [[ "$ver" != "$skill_version" ]]; then
                    fail "Installed skill $f has version '$ver', expected '$skill_version'"
                    installed_fail=1
                fi
            done < <(find "$dir" -name 'SKILL.md' -print0)
        fi
    done < <(manifest_eval skill-roots)
    if [[ "$installed_fail" -eq 0 ]]; then
        pass "All installed skills at version $skill_version"
    fi
fi

# ── Version Consistency ──────────────────────────────────────────────
section "Version Consistency"
if [[ -f package.json ]]; then
    pkg_version=$(node -e "console.log(require('./package.json').version)")
    pass "package.json ($pkg_version)"

    # AUDIT_VERSION derives from package.json - no separate version.ts to check

    # .goat-flow/config.yaml version should match package version
    if [[ -f .goat-flow/config.yaml ]]; then
        config_version=$(grep '^version:' .goat-flow/config.yaml | grep -oE '"[^"]+"' | tr -d '"' || true)
        if [[ -n "$config_version" ]]; then
            if [[ "$config_version" != "$pkg_version" ]]; then
                fail ".goat-flow/config.yaml version ($config_version) does not match package.json ($pkg_version)"
            else
                pass ".goat-flow/config.yaml version ($config_version)"
            fi
        else
            fail ".goat-flow/config.yaml has no version field"
        fi
    fi

    # Instruction file headers must match package version
    for ifile in CLAUDE.md AGENTS.md GEMINI.md .github/copilot-instructions.md; do
        if [[ -f "$ifile" ]]; then
            header_version=$(head -1 "$ifile" | grep -oE 'v[0-9]+\.[0-9]+(\.[0-9]+)?' | sed 's/^v//' || true)
            if [[ -n "$header_version" ]] && [[ "$header_version" != "$pkg_version" ]]; then
                fail "$ifile header says v${header_version}, expected v${pkg_version}"
            fi
        fi
    done
else
    skip "Version check (missing package.json)"
fi

# ── Cross-Agent Loop Consistency ─────────────────────────────────────
agent_files=()
for af in CLAUDE.md AGENTS.md GEMINI.md .github/copilot-instructions.md; do
    [[ -f "$af" ]] && agent_files+=("$af")
done
if [[ ${#agent_files[@]} -ge 2 ]]; then
    section "Cross-Agent Consistency"
    # Extract execution loop (READ→Autonomy) from each file, normalize, compare word sets
    extract_loop() {
        sed -n '/\*\*READ\*\*\|^##.*READ/,/^## \(Autonomy\|Router\|Hard Rules\|Working Memory\|Definition of Done\)/p' "$1" \
            | tr '[:upper:]' '[:lower:]' | tr -cs '[:alnum:]' ' ' | tr -s ' '
    }
    ref_loop=$(extract_loop "${agent_files[0]}")
    loop_ok=true
    for af in "${agent_files[@]:1}"; do
        other_loop=$(extract_loop "$af")
        # Simple word-count divergence check (structural drift detection)
        ref_words=$(echo "$ref_loop" | wc -w)
        other_words=$(echo "$other_loop" | wc -w)
        if [[ "$ref_words" -eq 0 ]] || [[ "$other_words" -eq 0 ]]; then
            fail "Execution loop missing in $af - copy from ${agent_files[0]}"
            loop_ok=false
        else
            # Check word count ratio - >40% divergence = structural drift
            diff_pct=$(( (ref_words - other_words) * 100 / ref_words ))
            abs_diff=${diff_pct#-}
            if [[ "$abs_diff" -gt 40 ]]; then
                fail "Execution loop in $af diverges from ${agent_files[0]} (${abs_diff}% word count difference)"
                loop_ok=false
            fi
        fi
    done
    if $loop_ok; then
        pass "Execution loops consistent across ${#agent_files[@]} agent files"
    fi
fi

# ── TypeScript ───────────────────────────────────────────────────────
if [[ -f tsconfig.json ]]; then
    section "TypeScript"

    if npx tsc 2>/dev/null; then
        pass "Typecheck + build (dist/ produced)"
    else
        fail "Typecheck/build - run npx tsc for details"
    fi

    # Dashboard TypeScript (excluded from main tsconfig.json)
    if [[ -f tsconfig.dashboard.json ]]; then
        if npx tsc -p tsconfig.dashboard.json --noEmit 2>/dev/null; then
            pass "Dashboard typecheck (tsconfig.dashboard.json)"
        else
            fail "Dashboard typecheck failed - run npx tsc -p tsconfig.dashboard.json --noEmit for details"
        fi
    fi

    # ESLint (type-checked rules)
    if command -v npx >/dev/null 2>&1 && [[ -f eslint.config.mjs ]]; then
        lint_output=$(npx eslint src/cli/ 2>&1) && lint_exit=0 || lint_exit=$?
        # grep -c always prints a count (even 0) and exits non-zero on zero
        # matches. Using `|| echo 0` would double-up the output to "0\n0",
        # breaking the downstream `-gt` arithmetic. Use `|| true` to swallow
        # grep's non-zero exit but keep its printed count.
        lint_errors=$(echo "$lint_output" | grep -c ' error ' || true)
        lint_warnings=$(echo "$lint_output" | grep -c ' warning ' || true)
        if [[ "$lint_exit" -eq 0 ]]; then
            pass "ESLint ($lint_warnings warnings)"
        elif [[ "$lint_errors" -gt 0 ]]; then
            fail "ESLint ($lint_errors errors, $lint_warnings warnings) - run npx eslint src/cli/"
        else
            pass "ESLint (0 errors, $lint_warnings warnings)"
        fi
        # Count ESLint warnings in the preflight total
        if [[ "$lint_warnings" -gt 0 ]]; then
            warnings=$((warnings + lint_warnings))
        fi
    else
        skip "ESLint (not configured)"
    fi

    # Knip (unused exports, dead code - breaking error)
    if command -v npx >/dev/null 2>&1 && npx knip --version >/dev/null 2>&1; then
        knip_output=$(npx knip --no-progress 2>&1) && knip_exit=0 || knip_exit=$?
        if [[ "$knip_exit" -eq 0 ]]; then
            pass "Knip (no unused exports or deps)"
        else
            unused_count=$(echo "$knip_output" | grep -c '^[A-Za-z].*  ' || echo "?")
            fail "Knip: $unused_count unused exports/types - run npx knip for details"
        fi
    else
        skip "Knip (not installed)"
    fi

    # Prettier format check
    if command -v npx >/dev/null 2>&1 && [[ -f node_modules/.bin/prettier ]]; then
        prettier_output=$(bash scripts/prettier-check.sh 2>&1) && prettier_exit=0 || prettier_exit=$?
        if [[ "$prettier_exit" -eq 0 ]]; then
            pass "Prettier (all formatted)"
        else
            unformatted=$(echo "$prettier_output" | grep -c '^\[warn\] [^C]' || echo "?")
            fail "Prettier ($unformatted unformatted files) - run npm run format"
        fi
    else
        skip "Prettier (not installed)"
    fi

    # Quality checks (warnings, not failures)
    # console.log is fine - this is a local CLI tool, not a library

    any_hits=$(grep -rn ': any\b' src/cli/ --include='*.ts' || true)
    [[ -n "$any_hits" ]] && note "Explicit 'any' types ($(echo "$any_hits" | wc -l) hits)"

    # TODO/FIXME check removed (false-positive rate too high in string literals)
fi

# ── Tests ────────────────────────────────────────────────────────────
if [[ -f package.json ]] && grep -q '"test"' package.json; then
    section "Tests"
    test_output=$(npm test 2>&1) && test_exit=0 || test_exit=$?

    test_count=$(echo "$test_output" | grep '# tests' | grep -oE '[0-9]+' || echo "?")
    pass_count=$(echo "$test_output" | grep '# pass' | grep -oE '[0-9]+' || echo "?")
    fail_count=$(echo "$test_output" | grep '# fail' | grep -oE '[0-9]+' || echo "0")

    if [[ "$test_exit" -eq 0 ]] && [[ "$test_count" != "0" ]] && [[ "$test_count" != "?" ]]; then
        pass "All passing ($pass_count/$test_count)"
    elif [[ "$test_exit" -eq 0 ]] && [[ "$test_count" == "0" || "$test_count" == "?" ]]; then
        warn "No tests found ($pass_count/$test_count) - test suite needs rebuilding (M23)"
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

# ── GOAT Flow Audit ────────────────────────────────────────────────────
if [[ -f dist/cli/cli.js ]]; then
    section "GOAT Flow Audit"
    audit_output=$(node dist/cli/cli.js audit . --format text 2>&1) && audit_exit=0 || audit_exit=$?
    if [[ "$audit_exit" -eq 0 ]]; then
        pass "Audit passes"
    else
        fail "goat-flow audit failed (exit $audit_exit)"
        echo "$audit_output" | head -5 | sed 's/^/    /'
    fi
else
    skip "GOAT Flow Audit (dist/cli/cli.js not built)"
fi

# ── Learning-Loop Schema ──────────────────────────────────────────────
# Gates footgun schema rules: machine-simple status (active|resolved),
# file:line or (search:) evidence on active entries, resolved-below-section.
if [[ -f dist/cli/cli.js ]]; then
    section "Learning-Loop Schema"
    stats_output=$(node dist/cli/cli.js stats . --check 2>&1) && stats_exit=0 || stats_exit=$?
    if [[ "$stats_exit" -eq 0 ]]; then
        pass "Footgun/lesson schema passes"
    else
        fail "Footgun/lesson schema violations (exit $stats_exit)"
        echo "$stats_output" | head -10 | sed 's/^/    /'
    fi
else
    skip "Learning-Loop Schema (dist/cli/cli.js not built)"
fi

# ── Doc/Code Drift ───────────────────────────────────────────────────
if [[ -f dist/cli/audit/check-goat-flow.js ]]; then
    section "Doc/Code Drift"

    # B.8a: Architecture count validation
    build_count=$(node --input-type=module -e "const s=await import('./dist/cli/audit/check-goat-flow.js');const a=await import('./dist/cli/audit/check-agent-setup.js');console.log(s.SETUP_CHECKS.length+a.AGENT_CHECKS.length)" 2>/dev/null || echo "")
    quality_count=$(node --input-type=module -e "const q=await import('./dist/cli/audit/harness/index.js');console.log(q.HARNESS_CHECKS.length)" 2>/dev/null || echo "")

    if [[ -f .goat-flow/architecture.md ]] && [[ -n "$build_count" ]] && [[ -n "$quality_count" ]]; then
        if grep -q "${build_count} build" .goat-flow/architecture.md && grep -q "${quality_count} AI harness" .goat-flow/architecture.md; then
            pass "Architecture doc counts match code (build: ${build_count}, AI harness: ${quality_count})"
        else
            fail "Architecture doc check counts mismatch - expected ${build_count} build + ${quality_count} AI harness in .goat-flow/architecture.md"
        fi
        # B.8a2: Sub-breakdown validation (setup + agent)
        setup_count=$(node --input-type=module -e "const s=await import('./dist/cli/audit/check-goat-flow.js');console.log(s.SETUP_CHECKS.length)" 2>/dev/null || echo "")
        agent_count=$(node --input-type=module -e "const a=await import('./dist/cli/audit/check-agent-setup.js');console.log(a.AGENT_CHECKS.length)" 2>/dev/null || echo "")
        if [[ -n "$setup_count" ]] && [[ -n "$agent_count" ]]; then
            if grep -q "${setup_count} setup" .goat-flow/architecture.md && grep -q "${agent_count} agent" .goat-flow/architecture.md; then
                pass "Architecture doc sub-breakdown matches code (setup: ${setup_count}, agent: ${agent_count})"
            else
                fail "Architecture doc sub-breakdown mismatch - expected ${setup_count} setup + ${agent_count} agent in .goat-flow/architecture.md"
            fi
        fi
    else
        skip "Architecture count validation (dist/ not fully built or architecture.md missing)"
    fi

    # B.8a3: Downstream doc sub-breakdown drift
    # Architecture.md validated above. This catches stale sub-breakdown numbers
    # in other current-state docs that reference the same counts.
    # Excludes: CHANGELOG.md and workflow/manifest-snapshots/** (frozen per
    # release), .goat-flow/logs/ (historical), .goat-flow/scratchpad/ (WIP),
    # .goat-flow/lessons/ (narrative may include historical numbers).
    if [[ -n "$setup_count" ]]; then
        b8a3_ok=true
        for doc in CLAUDE.md AGENTS.md GEMINI.md .goat-flow/code-map.md CONTRIBUTING.md; do
            [[ -f "$doc" ]] || continue
            stale=$(grep -oE '[0-9]+ setup' "$doc" 2>/dev/null | grep -v "^${setup_count} setup$" | head -1 || true)
            if [[ -n "$stale" ]]; then
                fail "Downstream doc sub-breakdown drift in ${doc}: found '${stale}' (expected '${setup_count} setup')"
                b8a3_ok=false
            fi
        done
        if $b8a3_ok; then
            pass "Downstream docs match setup sub-breakdown (${setup_count} setup)"
        fi
    fi

    # B.8b: Setup doc check ID validation
    if [[ -n "$build_count" ]]; then
        check_ids=$(node --input-type=module -e "const s=await import('./dist/cli/audit/check-goat-flow.js');const a=await import('./dist/cli/audit/check-agent-setup.js');[...s.SETUP_CHECKS,...a.AGENT_CHECKS].forEach(c=>console.log(c.id))" 2>/dev/null || echo "")
        b8b_ok=true
        while IFS= read -r ref; do
            id=$(echo "$ref" | grep -oP '[\w.-]+' | tail -1)
            if [[ -n "$id" ]] && ! echo "$check_ids" | grep -q "^${id}$"; then
                fail "Setup doc references non-existent check ID: $id"
                b8b_ok=false
            fi
        done < <(grep -ohP '\(check [\w.-]+\)' workflow/setup/*.md 2>/dev/null || true)
        if $b8b_ok; then
            pass "Setup doc check IDs are valid"
        fi
    fi

    # B.8d: code-map.md scripts list matches filesystem (catches drift like
    # code-map listing 3 scripts when scripts/ actually has 14).
    if [[ -f .goat-flow/code-map.md ]]; then
        listed_scripts=$(awk '
            /^## scripts\/ -- Shell scripts/ { in_section=1; next }
            in_section && /^## / { in_section=0 }
            in_section
        ' .goat-flow/code-map.md | grep -oE '^[a-z][a-zA-Z0-9_.-]*\.(sh|mjs)' | sort -u)
        actual_scripts=$(find scripts/ -maxdepth 1 -type f \( -name '*.sh' -o -name '*.mjs' \) -printf '%f\n' | sort -u)
        if [[ "$listed_scripts" == "$actual_scripts" ]]; then
            pass "code-map.md scripts list matches scripts/ filesystem"
        else
            fail "code-map.md scripts list drifts from scripts/ filesystem"
            diff <(echo "$actual_scripts") <(echo "$listed_scripts") 2>&1 | head -10 | sed 's/^/    /'
        fi
    fi
fi

# Check template-refs.ts doesn't reference missing workflow docs
if [[ -f src/cli/prompt/template-refs.ts ]]; then
    stale_refs=0
    while IFS= read -r template_path; do
        if [[ ! -f "$template_path" ]]; then
            fail "template-refs.ts references missing: $template_path"
            stale_refs=1
        fi
    done < <(grep -v '^\s*//' src/cli/prompt/template-refs.ts | grep -oE "workflow/[^'\"]*\.md" | sort -u)
    if [[ "$stale_refs" -eq 0 ]]; then
        pass "template-refs.ts: all referenced workflow docs exist"
    fi
fi

# B.8d: Dashboard concern key sync
if [[ -f dist/cli/audit/harness/index.js ]] && [[ -f src/dashboard/views/home.html ]]; then
    code_keys=$(node --input-type=module -e "
      const q=await import('./dist/cli/audit/harness/index.js');
      const keys=[...new Set(q.HARNESS_CHECKS.map(c=>c.concern))].sort();
      console.log(keys.join(','))
    " 2>/dev/null || echo "")
    html_keys=$(grep -oP "concernKeys:\s*\[([^\]]+)\]" src/dashboard/views/home.html \
        | head -1 | grep -oP "'[^']+'" | tr -d "'" | sort | paste -sd, 2>/dev/null || echo "")
    if [[ -n "$code_keys" ]] && [[ -n "$html_keys" ]]; then
        if [[ "$code_keys" == "$html_keys" ]]; then
            pass "Dashboard concern keys match harness checks"
        else
            fail "Dashboard concern keys mismatch: code=[$code_keys] html=[$html_keys]"
        fi
    else
        skip "Dashboard concern key sync (could not extract keys)"
    fi
fi

# ── Preamble/Conventions Sync ────────────────────────────────────────
section "Preamble/Conventions Sync"
if [[ -f workflow/skills/reference/skill-preamble.md ]] && [[ -f .goat-flow/skill-reference/skill-preamble.md ]]; then
    if diff -q workflow/skills/reference/skill-preamble.md .goat-flow/skill-reference/skill-preamble.md >/dev/null 2>&1; then
        pass "skill-preamble.md: template and installed copy match"
    else
        fail "skill-preamble.md: template (workflow/skills/reference/) and installed (.goat-flow/skill-reference/) differ"
    fi
else
    skip "skill-preamble.md sync (one or both files missing)"
fi
if [[ -f workflow/skills/reference/skill-conventions.md ]] && [[ -f .goat-flow/skill-reference/skill-conventions.md ]]; then
    if diff -q workflow/skills/reference/skill-conventions.md .goat-flow/skill-reference/skill-conventions.md >/dev/null 2>&1; then
        pass "skill-conventions.md: template and installed copy match"
    else
        fail "skill-conventions.md: template (workflow/skills/reference/) and installed (.goat-flow/skill-reference/) differ"
    fi
else
    skip "skill-conventions.md sync (one or both files missing)"
fi
if [[ -f workflow/skills/reference/skill-quality-testing.md ]] && [[ -f .goat-flow/skill-reference/skill-quality-testing.md ]]; then
    if diff -q workflow/skills/reference/skill-quality-testing.md .goat-flow/skill-reference/skill-quality-testing.md >/dev/null 2>&1; then
        pass "skill-quality-testing.md: template and installed copy match"
    else
        fail "skill-quality-testing.md: template (workflow/skills/reference/) and installed (.goat-flow/skill-reference/) differ"
    fi
else
    skip "skill-quality-testing.md sync (one or both files missing)"
fi
for topical in tdd-iteration adversarial-framing deployment; do
    tpl="workflow/skills/reference/skill-quality-testing/${topical}.md"
    inst=".goat-flow/skill-reference/skill-quality-testing/${topical}.md"
    if [[ -f "$tpl" ]] && [[ -f "$inst" ]]; then
        if diff -q "$tpl" "$inst" >/dev/null 2>&1; then
            pass "skill-quality-testing/${topical}.md: template and installed copy match"
        else
            fail "skill-quality-testing/${topical}.md: template (workflow/skills/reference/skill-quality-testing/) and installed (.goat-flow/skill-reference/skill-quality-testing/) differ"
        fi
    else
        skip "skill-quality-testing/${topical}.md sync (one or both files missing)"
    fi
done

# ── Skill SKILL.md Parity ────────────────────────────────────────────
# Byte-exact diff (bash) for speed. For semantic comparison (frontmatter key
# reorder, trailing whitespace), see `goat-flow audit --check-drift` which
# adds YAML-aware normalisation. Both paths coexist per M04.
section "Skill SKILL.md Parity"
skill_parity_ok=true
while IFS= read -r skill_name; do
    while IFS= read -r relative_file; do
        [[ -n "$relative_file" ]] || continue
        template="workflow/skills/${skill_name}/${relative_file}"
        if [[ ! -f "$template" ]]; then
            fail "Skill template missing: ${template}"
            skill_parity_ok=false
            continue
        fi
        while IFS= read -r agent_dir; do
            # Skip manifest-declared agent roots that aren't installed in this
            # project. Single-agent consumer installs (only .claude/ or only
            # .agents/) would otherwise get "Skill file missing" failures for
            # every uninstalled agent tree - phantom drift.
            [[ -d "$agent_dir" ]] || continue
            installed="${agent_dir}/${skill_name}/${relative_file}"
            if [[ ! -f "$installed" ]]; then
                fail "Skill file missing: ${installed}"
                skill_parity_ok=false
                continue
            fi
            if ! diff -q "$template" "$installed" >/dev/null 2>&1; then
                fail "Skill file diverged: ${template} vs ${installed}"
                skill_parity_ok=false
            fi
        done < <(manifest_eval skill-roots)
    done < <(manifest_eval skill-files "$skill_name")
done < <(manifest_eval supported-skills)
if [[ "$skill_parity_ok" == true ]]; then
    pass "All installed skill files match workflow templates"
fi

# ── Path Integrity ───────────────────────────────────────────────────
section "Path Integrity"
if bash scripts/check-path-integrity.sh . >/dev/null 2>&1; then
    pass "All internal path references resolve"
else
    bash scripts/check-path-integrity.sh . 2>&1 | grep "^FAIL:" | while IFS= read -r line; do
        fail "$line"
    done
fi

# ── Markdown Links ───────────────────────────────────────────────────
section "Markdown Links"
if bash scripts/check-markdown-links.sh . 2>&1 | grep -q "^All"; then
    link_count=$(bash scripts/check-markdown-links.sh . 2>&1 | grep -oP '\d+' | head -1)
    pass "All $link_count markdown links resolve"
else
    bash scripts/check-markdown-links.sh . 2>&1 | grep "^BROKEN" | while IFS= read -r line; do
        fail "$line"
    done
fi

# ── Summary ──────────────────────────────────────────────────────────
# Print elapsed time for the last section
echo -e "  ${DIM}($(fmt_elapsed $(( $(now_ms) - section_start ))))${RST}"

total_elapsed=$(fmt_elapsed $(( $(now_ms) - preflight_start )))
echo ""
echo -e "${DIM}─────────────────────────────────────────────────${RST}"
if [[ "$errors" -gt 0 ]]; then
    echo -e "${BOLD}${R}PREFLIGHT FAILED${RST}  ${errors} error(s), ${warnings} warning(s), ${checks} checks  ${DIM}(${total_elapsed})${RST}"
    exit 1
fi
echo -e "${BOLD}${G}PREFLIGHT PASSED${RST}  ${checks} checks, ${warnings} warning(s)  ${DIM}(${total_elapsed})${RST}"
