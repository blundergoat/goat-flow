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
if deny_self_test_output=$(bash scripts/deny-dangerous.sh --self-test=full 2>&1); then
    pass "scripts/deny-dangerous.sh ${deny_self_test_output}"
else
    fail "scripts/deny-dangerous.sh full self-test"
fi

# Also smoke-test installed hooks. Routine audit/preflight only needs the
# install-safe representative set; the local scripts/ copy runs the full corpus
# above.
while IFS= read -r hookdir; do
    if [[ -f "$hookdir/deny-dangerous.sh" ]]; then
        if bash "$hookdir/deny-dangerous.sh" --self-test=smoke >/dev/null 2>&1; then
            pass "$hookdir/deny-dangerous.sh smoke self-test"
        else
            fail "$hookdir/deny-dangerous.sh smoke self-test"
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

# ── Agent Config Parity ──────────────────────────────────────────────
section "Agent Config Parity"
agent_config_output=$(
    node - "$MANIFEST_PATH" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const manifestPath = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

function exists(file) {
  return typeof file === "string" && file.length > 0 && fs.existsSync(file);
}

function templateForSettings(agentId, settingsPath) {
  const ext = path.posix.extname(settingsPath).replace(/^\./, "");
  return `workflow/hooks/agent-config/${agentId}.${ext}`;
}

function templateForHookConfig(agentId) {
  return `workflow/hooks/agent-config/${agentId}-hooks.json`;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function covers(actual, required) {
  if (Array.isArray(required)) {
    return (
      Array.isArray(actual) &&
      required.every((item) => actual.some((candidate) => covers(candidate, item)))
    );
  }
  if (required && typeof required === "object") {
    return (
      actual &&
      typeof actual === "object" &&
      !Array.isArray(actual) &&
      Object.keys(required).every(
        (key) => Object.hasOwn(actual, key) && covers(actual[key], required[key]),
      )
    );
  }
  return Object.is(actual, required);
}

function describeValue(value) {
  if (typeof value === "string") return value;
  return stableJson(value);
}

function collectMissing(required, actual, location, missing) {
  if (Array.isArray(required)) {
    if (!Array.isArray(actual)) {
      missing.push(`${location} is not an array`);
      return;
    }
    for (const item of required) {
      if (!actual.some((candidate) => covers(candidate, item))) {
        missing.push(`${location} missing ${describeValue(item)}`);
      }
    }
    return;
  }
  if (required && typeof required === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
      missing.push(`${location} is not an object`);
      return;
    }
    for (const [key, value] of Object.entries(required)) {
      if (!Object.hasOwn(actual, key)) {
        missing.push(`${location}.${key} missing`);
      } else {
        collectMissing(value, actual[key], `${location}.${key}`, missing);
      }
    }
    return;
  }
  if (!Object.is(actual, required)) {
    missing.push(`${location} expected ${describeValue(required)}`);
  }
}

function compareJson(templatePath, installedPath) {
  const required = JSON.parse(fs.readFileSync(templatePath, "utf8"));
  const installed = JSON.parse(fs.readFileSync(installedPath, "utf8"));
  const missing = [];
  collectMissing(required, installed, "$", missing);
  return missing;
}

function normalizeTomlEntries(file) {
  let section = "";
  const entries = [];
  for (const line of fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*/, "").trim())
    .filter(Boolean)
    .map((line) => line.replace(/\s*=\s*/g, " = ").replace(/\s+/g, " "))) {
    const sectionMatch = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      entries.push(`[${section}]`);
      continue;
    }
    const keyMatch = line.match(/^([A-Za-z0-9_.-]+) = (.*)$/);
    entries.push(keyMatch && section ? `${section}.${line}` : line);
  }
  return entries;
}

function compareToml(templatePath, installedPath) {
  const installed = new Set(normalizeTomlEntries(installedPath));
  return normalizeTomlEntries(templatePath)
    .filter((line) => !installed.has(line))
    .map((line) => `$ missing ${line}`);
}

function compareConfig(templatePath, installedPath) {
  if (templatePath.endsWith(".json")) return compareJson(templatePath, installedPath);
  if (templatePath.endsWith(".toml")) return compareToml(templatePath, installedPath);
  return fs.readFileSync(templatePath, "utf8").trimEnd() ===
    fs.readFileSync(installedPath, "utf8").trimEnd()
    ? []
    : ["$ content differs from template"];
}

function emit(status, message) {
  console.log(`${status}\t${message}`);
}

let checked = 0;
for (const [agentId, agent] of Object.entries(manifest.agents || {})) {
  const settingsPath =
    typeof agent.settings === "string" ? agent.settings : "";
  const hookConfigPath =
    typeof agent.hook_config_file === "string" ? agent.hook_config_file : "";
  const specs = [];

  if (settingsPath) {
    specs.push({
      agentId,
      templatePath: templateForSettings(agentId, settingsPath),
      installedPath: settingsPath,
    });
  }
  if (hookConfigPath && hookConfigPath !== settingsPath) {
    specs.push({
      agentId,
      templatePath: templateForHookConfig(agentId),
      installedPath: hookConfigPath,
    });
  }

  for (const spec of specs) {
    checked += 1;
    if (!exists(spec.templatePath)) {
      emit("FAIL", `${spec.agentId}: missing template ${spec.templatePath}`);
      continue;
    }
    if (!exists(spec.installedPath)) {
      emit("FAIL", `${spec.agentId}: missing installed config ${spec.installedPath}`);
      continue;
    }
    try {
      const missing = compareConfig(spec.templatePath, spec.installedPath);
      if (missing.length === 0) {
        emit(
          "PASS",
          `${spec.agentId}: ${spec.installedPath} includes required entries from ${spec.templatePath}`,
        );
      } else {
        const summary = missing.slice(0, 5).join("; ");
        const suffix = missing.length > 5 ? `; +${missing.length - 5} more` : "";
        emit(
          "FAIL",
          `${spec.agentId}: ${spec.installedPath} missing required entries from ${spec.templatePath}: ${summary}${suffix}`,
        );
      }
    } catch (error) {
      emit(
        "FAIL",
        `${spec.agentId}: could not compare ${spec.templatePath} to ${spec.installedPath}: ${error.message}`,
      );
    }
  }
}

if (checked === 0) emit("SKIP", "No agent config files declared in manifest");
NODE
)
while IFS=$'\t' read -r status message; do
    if [[ -z "${status:-}" ]]; then
        continue
    fi
    case "$status" in
        PASS) pass "$message" ;;
        FAIL) fail "$message" ;;
        SKIP) skip "$message" ;;
        *) fail "Agent config parity emitted unexpected result: $status $message" ;;
    esac
done <<< "$agent_config_output"

# ── Skill and Reference Versions ─────────────────────────────────────
section "Skill and Reference Versions"
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

    reference_fail=0
    while IFS= read -r -d '' f; do
        ver=$(grep -o 'goat-flow-reference-version: "[^"]*"' "$f" | grep -o '"[^"]*"' | tr -d '"' || true)
        if [[ "$ver" != "$skill_version" ]]; then
            fail "Reference template $f has version '$ver', expected '$skill_version'"
            reference_fail=1
        fi
    done < <(find workflow/skills/reference -type f -name '*.md' -print0)
    while IFS= read -r -d '' f; do
        ver=$(grep -o 'goat-flow-reference-version: "[^"]*"' "$f" | grep -o '"[^"]*"' | tr -d '"' || true)
        if [[ "$ver" != "$skill_version" ]]; then
            fail "Reference template $f has version '$ver', expected '$skill_version'"
            reference_fail=1
        fi
    done < <(find workflow/skills -path '*/references/*.md' -print0)
    if [[ "$reference_fail" -eq 0 ]]; then
        pass "All workflow reference templates at version $skill_version"
    fi

    installed_reference_fail=0
    for installed_dir in .goat-flow/skill-reference .goat-flow/skill-playbooks; do
        if [[ -d "$installed_dir" ]]; then
            while IFS= read -r -d '' f; do
                ver=$(grep -o 'goat-flow-reference-version: "[^"]*"' "$f" | grep -o '"[^"]*"' | tr -d '"' || true)
                if [[ "$ver" != "$skill_version" ]]; then
                    fail "Installed shared reference $f has version '$ver', expected '$skill_version'"
                    installed_reference_fail=1
                fi
            done < <(find "$installed_dir" -type f -name '*.md' -print0)
        fi
    done
    while IFS= read -r dir; do
        if [[ -d "$dir" ]]; then
            while IFS= read -r -d '' f; do
                ver=$(grep -o 'goat-flow-reference-version: "[^"]*"' "$f" | grep -o '"[^"]*"' | tr -d '"' || true)
                if [[ "$ver" != "$skill_version" ]]; then
                    fail "Installed skill reference $f has version '$ver', expected '$skill_version'"
                    installed_reference_fail=1
                fi
            done < <(find "$dir" -path '*/references/*.md' -print0)
        fi
    done < <(manifest_eval skill-roots)
    if [[ "$installed_reference_fail" -eq 0 ]]; then
        pass "All installed references at version $skill_version"
    fi

    # Shipped test fixtures: the installer round-trip integration test copies
    # these into a temp repo and runs preflight there. Catching stale versions
    # here avoids a 30s+ round-trip just to learn the fixture drifted.
    # Dynamic stale-version fixtures created programmatically inside tests
    # are not on disk under test/fixtures/, so this scan only hits real ones.
    if [[ -d test/fixtures ]]; then
        fixtures_fail=0
        while IFS= read -r -d '' f; do
            ver=$(grep -o 'goat-flow-skill-version: "[^"]*"' "$f" | grep -o '"[^"]*"' | tr -d '"' || true)
            if [[ -n "$ver" ]] && [[ "$ver" != "$skill_version" ]]; then
                fail "Test fixture $f has version '$ver', expected '$skill_version'"
                fixtures_fail=1
            fi
        done < <(find test/fixtures -name 'SKILL.md' -print0)
        while IFS= read -r -d '' f; do
            ver=$(grep -o 'goat-flow-reference-version: "[^"]*"' "$f" | grep -o '"[^"]*"' | tr -d '"' || true)
            if [[ "$ver" != "$skill_version" ]]; then
                fail "Test fixture reference $f has version '$ver', expected '$skill_version'"
                fixtures_fail=1
            fi
        done < <(find test/fixtures -path '*/references/*.md' -print0)
        if [[ "$fixtures_fail" -eq 0 ]]; then
            pass "All test fixture skills and references at version $skill_version"
        fi
    fi
fi

# Derive instruction file list from manifest once, reuse across sections
agent_files=()
if manifest_agent_lines=$(node -e "const m=require('./workflow/manifest.json');for(const a of Object.values(m.agents))console.log(a.instruction_file)" 2>/dev/null); then
    while IFS= read -r af; do
        [[ -f "$af" ]] && agent_files+=("$af")
    done <<< "$manifest_agent_lines"
else
    warn "Could not read agent profiles from workflow/manifest.json — instruction-file checks will be skipped"
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
    for ifile in "${agent_files[@]}"; do
        header_version=$(head -1 "$ifile" | grep -oE 'v[0-9]+\.[0-9]+(\.[0-9]+)?' | sed 's/^v//' || true)
        if [[ -n "$header_version" ]] && [[ "$header_version" != "$pkg_version" ]]; then
            fail "$ifile header says v${header_version}, expected v${pkg_version}"
        fi
    done
else
    skip "Version check (missing package.json)"
fi

# ── Skill Behavioral Contracts ───────────────────────────────────────
section "Skill Behavioral Contracts"
contract_ok=true
bad_goat_critique_patterns=(
    "Exception: on C""odex"
    "C""odex requires ""explicit user ""delegation ""consent"
    "confirm ""delegation ""consent once ""before spawning"
)
goat_critique_files=("workflow/skills/goat-critique/SKILL.md")
while IFS= read -r agent_dir; do
    [[ -d "$agent_dir" ]] || continue
    goat_critique_files+=("${agent_dir}/goat-critique/SKILL.md")
done < <(manifest_eval skill-roots)

for f in "${goat_critique_files[@]}"; do
    [[ -f "$f" ]] || continue
    for pattern in "${bad_goat_critique_patterns[@]}"; do
        if grep -Fq "$pattern" "$f"; then
            fail "$f contains obsolete goat-critique delegation exception: $pattern"
            contract_ok=false
        fi
    done
done
if [[ "$contract_ok" == true ]]; then
    pass "goat-critique direct invocation has no obsolete Codex delegation exception"
fi

# ── Cross-Agent Loop Consistency ─────────────────────────────────────
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

    # Router Table path parity (path-based, not label-based — labels drift
    # across agents but .goat-flow/ paths are consistent)
    router_parity_output=$(
        node - "${agent_files[@]}" <<'NODE'
const fs = require("node:fs");
const files = process.argv.slice(2);

function extractRouterPaths(filepath) {
    const lines = fs.readFileSync(filepath, "utf8").split(/\r?\n/);
    let inSection = false;
    const paths = new Set();
    for (const line of lines) {
        if (/^##\s+Router\s+Table/i.test(line)) { inSection = true; continue; }
        if (inSection && /^##\s/.test(line)) break;
        if (!inSection) continue;
        for (const m of line.matchAll(/`([^`]+)`/g)) {
            const raw = m[1];
            const wasDir = raw.endsWith("/");
            const p = raw.replace(/\/+$/, "");
            if (/^\.(claude|github|agents|codex|gemini)\//.test(p)) continue;
            if (p.includes("/") || p.endsWith(".md") || p.endsWith(".yaml") || wasDir) paths.add(p);
        }
    }
    return paths;
}

if (files.length < 3) {
    console.log("PASS\tRouter Table parity: " + files.length + " files present, requires 3+ (noted)");
    process.exit(0);
}

const filePaths = new Map();
for (const f of files) filePaths.set(f, extractRouterPaths(f));

function hasCoverage(pathSet, target) {
    if (pathSet.has(target)) return true;
    // Parent-directory coverage: .goat-flow/skill-reference/ covers
    // .goat-flow/skill-reference/README.md
    for (const p of pathSet) {
        if (target.startsWith(p + "/")) return true;
    }
    return false;
}

const allPaths = new Set();
for (const paths of filePaths.values()) for (const p of paths) allPaths.add(p);

const total = files.length;
const majority = Math.ceil(total / 2);
let ok = true;

for (const p of [...allPaths].sort()) {
    const presentIn = files.filter((f) => hasCoverage(filePaths.get(f), p));
    if (presentIn.length >= majority && presentIn.length < total) {
        const missing = files.filter((f) => !hasCoverage(filePaths.get(f), p));
        for (const m of missing) {
            // Skip self-reference warnings (CLAUDE.md doesn't list itself
            // in its own Peer instructions row)
            const basename = require("node:path").basename(m);
            if (p === basename || p.endsWith("/" + basename)) continue;
            console.log("WARN\tRouter Table path '" + p + "' present in " + presentIn.length + "/" + total + " but missing from " + m);
            ok = false;
        }
    }
}
if (ok) console.log("PASS\tRouter Table path parity across " + total + " agent files");
NODE
    )
    while IFS=$'\t' read -r status message; do
        [[ -z "${status:-}" ]] && continue
        case "$status" in
            PASS) pass "$message" ;;
            WARN) warn "$message" ;;
            FAIL) fail "$message" ;;
        esac
    done <<< "$router_parity_output"
fi

# ── Instruction Parity Contract ──────────────────────────────────────
section "Instruction Parity Contract"
if [[ -f scripts/check-instruction-parity.mjs ]]; then
    parity_output=$(node scripts/check-instruction-parity.mjs 2>&1) && parity_exit=0 || parity_exit=$?
    if [[ "$parity_exit" -eq 0 ]]; then
        pass "$parity_output"
    else
        fail "Instruction parity check failed (exit $parity_exit)"
        echo "$parity_output" | head -12 | sed 's/^/    /'
    fi
else
    skip "Instruction parity check (scripts/check-instruction-parity.mjs missing)"
fi

# ── Instruction File Quality ────────────────────────────────────────
section "Instruction File Quality"

# Line-count check (thresholds from manifest, not hard-coded)
line_target=$(node -e "console.log(require('./workflow/manifest.json').instruction_file.line_target)" 2>/dev/null || echo "125")
line_limit=$(node -e "console.log(require('./workflow/manifest.json').instruction_file.line_limit)" 2>/dev/null || echo "150")

for ifile in "${agent_files[@]}"; do
    count=$(wc -l < "$ifile")
    if [[ "$count" -gt "$line_limit" ]]; then
        fail "$ifile exceeds line limit ($count lines, limit $line_limit)"
    elif [[ "$count" -gt "$line_target" ]]; then
        warn "$ifile exceeds line target ($count lines, target $line_target)"
    else
        pass "$ifile ($count lines, target $line_target)"
    fi
done

# Encyclopedia guard (advisory — downstream projects may have edge cases)
encyclopedia_patterns="database schema|api reference|endpoint list|table definition|historical background|architecture history|full project overview"
enc_ok=true
for ifile in "${agent_files[@]}"; do
    if [[ -f "$ifile" ]]; then
        enc_hits=$(grep -inE "$encyclopedia_patterns" "$ifile" || true)
        if [[ -n "$enc_hits" ]]; then
            while IFS= read -r hit; do
                warn "Encyclopedia content in $ifile: $(echo "$hit" | head -c 120)"
                enc_ok=false
            done <<< "$enc_hits"
        fi
    fi
done
if $enc_ok; then
    pass "No encyclopedia content in instruction files"
fi

# Downstream-content guard (fail — upstream surfaces must not contain project-specific names)
downstream_patterns="healthkit|Halaxy|PracGroup|LinkPaG|/home/hxdev/|/home/devgoat/projects/healthkit"
downstream_surfaces=(
    "${agent_files[@]}"
    workflow/setup/agents/claude.md workflow/setup/agents/codex.md
    workflow/setup/agents/copilot.md workflow/setup/agents/gemini.md
    workflow/setup/reference/execution-loop.md
    workflow/setup/02-instruction-file.md
)
ds_ok=true
for f in "${downstream_surfaces[@]}"; do
    if [[ -f "$f" ]]; then
        ds_hits=$(grep -inE "$downstream_patterns" "$f" || true)
        if [[ -n "$ds_hits" ]]; then
            while IFS= read -r hit; do
                fail "Downstream project content in $f: $(echo "$hit" | head -c 120)"
                ds_ok=false
            done <<< "$ds_hits"
        fi
    fi
done
if $ds_ok; then
    pass "No downstream project content in upstream surfaces"
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
        lint_targets=(src/cli src/dashboard)
        lint_output=$(npx eslint "${lint_targets[@]}" 2>&1) && lint_exit=0 || lint_exit=$?
        # Count only diagnostic rows, not ESLint's summary/fixability footer.
        lint_errors=$(echo "$lint_output" | grep -Ec '^[[:space:]]*[0-9]+:[0-9]+[[:space:]]+error[[:space:]]' || true)
        lint_warnings=$(echo "$lint_output" | grep -Ec '^[[:space:]]*[0-9]+:[0-9]+[[:space:]]+warning[[:space:]]' || true)
        if [[ "$lint_exit" -eq 0 ]]; then
            pass "ESLint ($lint_warnings warnings)"
        elif [[ "$lint_errors" -gt 0 ]]; then
            fail "ESLint ($lint_errors errors, $lint_warnings warnings) - run npx eslint ${lint_targets[*]}"
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
    if grep -q '"test:fast"' package.json; then
        test_command=(npm run test:fast)
        test_label="Fast suite passing"
    else
        test_command=(npm test)
        test_label="All passing"
    fi
    test_output=$("${test_command[@]}" 2>&1) && test_exit=0 || test_exit=$?

    test_count=$(echo "$test_output" | grep '# tests' | grep -oE '[0-9]+' || echo "?")
    pass_count=$(echo "$test_output" | grep '# pass' | grep -oE '[0-9]+' || echo "?")
    fail_count=$(echo "$test_output" | grep '# fail' | grep -oE '[0-9]+' || echo "0")

    if [[ "$test_exit" -eq 0 ]] && [[ "$test_count" != "0" ]] && [[ "$test_count" != "?" ]]; then
        pass "$test_label ($pass_count/$test_count)"
    elif [[ "$test_exit" -eq 0 ]] && [[ "$test_count" == "0" || "$test_count" == "?" ]]; then
        warn "No tests found ($pass_count/$test_count) - test suite needs rebuilding (M23)"
    elif [[ "$test_label" == "Fast suite passing" ]]; then
        retry_output=$("${test_command[@]}" 2>&1) && retry_exit=0 || retry_exit=$?
        retry_test_count=$(echo "$retry_output" | grep '# tests' | grep -oE '[0-9]+' || echo "?")
        retry_pass_count=$(echo "$retry_output" | grep '# pass' | grep -oE '[0-9]+' || echo "?")
        retry_fail_count=$(echo "$retry_output" | grep '# fail' | grep -oE '[0-9]+' || echo "0")

        if [[ "$retry_exit" -eq 0 ]] && [[ "$retry_test_count" != "0" ]] && [[ "$retry_test_count" != "?" ]]; then
            warn "$test_label passed on retry after initial failure ($retry_pass_count/$retry_test_count); investigate transient test isolation"
            printf '%s\n' "$test_output" | grep 'not ok' | head -5 | sed 's/^/    initial: /' || true
        else
            fail "Tests failed after retry (initial $fail_count/$test_count failures, retry $retry_fail_count/$retry_test_count failures)"
            printf '%s\n' "$test_output" | grep 'not ok' | head -5 | sed 's/^/    initial: /' || true
            printf '%s\n' "$retry_output" | grep 'not ok' | head -5 | sed 's/^/    retry: /' || true
        fi
    else
        fail "Tests failed ($fail_count/$test_count failures)"
        printf '%s\n' "$test_output" | grep 'not ok' | head -5 | sed 's/^/    /' || true
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
    # Pipe through grep to strip any stray node diagnostics down to a bare number.
    build_count=$(node --input-type=module -e "const s=await import('./dist/cli/audit/check-goat-flow.js');const a=await import('./dist/cli/audit/check-agent-setup.js');console.log(s.SETUP_CHECKS.length+a.AGENT_CHECKS.length)" 2>/dev/null | grep -oE '^[0-9]+$' | tail -1 || echo "")
    quality_count=$(node --input-type=module -e "const q=await import('./dist/cli/audit/harness/index.js');console.log(q.HARNESS_CHECKS.length)" 2>/dev/null | grep -oE '^[0-9]+$' | tail -1 || echo "")

    setup_count=""
    if [[ -f .goat-flow/architecture.md ]] && [[ -n "$build_count" ]] && [[ -n "$quality_count" ]]; then
        if grep -Fq "${build_count} build" .goat-flow/architecture.md && grep -Fq "${quality_count} AI harness" .goat-flow/architecture.md; then
            pass "Architecture doc counts match code (build: ${build_count}, AI harness: ${quality_count})"
        else
            fail "Architecture doc check counts mismatch - expected ${build_count} build + ${quality_count} AI harness in .goat-flow/architecture.md"
        fi
        # B.8a2: Sub-breakdown validation (setup + agent)
        setup_count=$(node --input-type=module -e "const s=await import('./dist/cli/audit/check-goat-flow.js');console.log(s.SETUP_CHECKS.length)" 2>/dev/null | grep -oE '^[0-9]+$' | tail -1 || echo "")
        agent_count=$(node --input-type=module -e "const a=await import('./dist/cli/audit/check-agent-setup.js');console.log(a.AGENT_CHECKS.length)" 2>/dev/null | grep -oE '^[0-9]+$' | tail -1 || echo "")
        if [[ -n "$setup_count" ]] && [[ -n "$agent_count" ]]; then
            if grep -Fq "${setup_count} setup" .goat-flow/architecture.md && grep -Fq "${agent_count} agent" .goat-flow/architecture.md; then
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
            stale=$(grep -oE '[0-9]+ setup' "$doc" 2>/dev/null | grep -Fv "${setup_count} setup" | head -1 || true)
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

# B.8e: Dashboard view-name prose sync
if [[ -f workflow/manifest.json ]] && [[ -f .goat-flow/architecture.md ]]; then
    if dashboard_view_doc_check=$(node --input-type=module <<'NODE'
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("workflow/manifest.json", "utf8"));
const views = [...manifest.facts.dashboard_views].sort();
const expected = views.join(", ");
const architecture = readFileSync(".goat-flow/architecture.md", "utf8");
const requiredSnippets = [
  `views for ${expected}`,
  `Page views (${expected})`,
];
const missing = requiredSnippets.filter((snippet) => !architecture.includes(snippet));

if (missing.length > 0) {
  console.log(`Expected dashboard views: ${expected}`);
  for (const snippet of missing) {
    console.log(`Missing architecture snippet: ${snippet}`);
  }
  process.exit(1);
}
NODE
    ); then
        pass "Dashboard view names match manifest and architecture prose"
    else
        fail "Dashboard view names drift between manifest and architecture prose"
        while IFS= read -r line; do
            printf '    %s\n' "$line"
        done <<< "$dashboard_view_doc_check"
    fi
fi

# ── Skill Reference + Playbooks Sync ─────────────────────────────────
section "Skill Reference + Playbooks Sync"
if [[ -f workflow/skills/reference/README.md ]] && [[ -f .goat-flow/skill-reference/README.md ]]; then
    if diff -q workflow/skills/reference/README.md .goat-flow/skill-reference/README.md >/dev/null 2>&1; then
        pass "skill-reference README.md: template and installed copy match"
    else
        fail "skill-reference README.md: template (workflow/skills/reference/) and installed (.goat-flow/skill-reference/) differ"
    fi
else
    skip "skill-reference README.md sync (one or both files missing)"
fi
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
if [[ -f workflow/skills/playbooks/README.md ]] && [[ -f .goat-flow/skill-playbooks/README.md ]]; then
    if diff -q workflow/skills/playbooks/README.md .goat-flow/skill-playbooks/README.md >/dev/null 2>&1; then
        pass "skill-playbooks README.md: template and installed copy match"
    else
        fail "skill-playbooks README.md: template (workflow/skills/playbooks/) and installed (.goat-flow/skill-playbooks/) differ"
    fi
else
    skip "skill-playbooks README.md sync (one or both files missing)"
fi
if [[ -f workflow/skills/playbooks/browser-use.md ]] && [[ -f .goat-flow/skill-playbooks/browser-use.md ]]; then
    if diff -q workflow/skills/playbooks/browser-use.md .goat-flow/skill-playbooks/browser-use.md >/dev/null 2>&1; then
        pass "browser-use.md: template and installed copy match"
    else
        fail "browser-use.md: template (workflow/skills/playbooks/) and installed (.goat-flow/skill-playbooks/) differ"
    fi
else
    skip "browser-use.md sync (one or both files missing)"
fi
if [[ -f workflow/skills/playbooks/page-capture.md ]] && [[ -f .goat-flow/skill-playbooks/page-capture.md ]]; then
    if diff -q workflow/skills/playbooks/page-capture.md .goat-flow/skill-playbooks/page-capture.md >/dev/null 2>&1; then
        pass "page-capture.md: template and installed copy match"
    else
        fail "page-capture.md: template (workflow/skills/playbooks/) and installed (.goat-flow/skill-playbooks/) differ"
    fi
else
    skip "page-capture.md sync (one or both files missing)"
fi
if [[ -f workflow/skills/playbooks/skill-quality-testing.md ]] && [[ -f .goat-flow/skill-playbooks/skill-quality-testing.md ]]; then
    if diff -q workflow/skills/playbooks/skill-quality-testing.md .goat-flow/skill-playbooks/skill-quality-testing.md >/dev/null 2>&1; then
        pass "skill-quality-testing.md: template and installed copy match"
    else
        fail "skill-quality-testing.md: template (workflow/skills/playbooks/) and installed (.goat-flow/skill-playbooks/) differ"
    fi
else
    skip "skill-quality-testing.md sync (one or both files missing)"
fi
for topical in tdd-iteration adversarial-framing deployment; do
    tpl="workflow/skills/playbooks/skill-quality-testing/${topical}.md"
    inst=".goat-flow/skill-playbooks/skill-quality-testing/${topical}.md"
    if [[ -f "$tpl" ]] && [[ -f "$inst" ]]; then
        if diff -q "$tpl" "$inst" >/dev/null 2>&1; then
            pass "skill-quality-testing/${topical}.md: template and installed copy match"
        else
            fail "skill-quality-testing/${topical}.md: template (workflow/skills/playbooks/skill-quality-testing/) and installed (.goat-flow/skill-playbooks/skill-quality-testing/) differ"
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

# ── Package README Links ─────────────────────────────────────────────
section "Package README Links"
if [[ -f scripts/check-package-readme-links.mjs ]]; then
    package_link_output=$(node scripts/check-package-readme-links.mjs 2>&1) && package_link_exit=0 || package_link_exit=$?
    if [[ "$package_link_exit" -eq 0 ]]; then
        pass "$package_link_output"
    else
        fail "Package README link check failed (exit $package_link_exit)"
        echo "$package_link_output" | head -10 | sed 's/^/    /'
    fi
else
    skip "Package README link check (scripts/check-package-readme-links.mjs missing)"
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
