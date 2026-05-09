#!/usr/bin/env bash
# =============================================================================
# install-goat-flow.sh - Install goat-flow files into a target project
# =============================================================================
# Usage: bash /path/to/goat-flow/workflow/install-goat-flow.sh /path/to/project --agent claude
#
# Deterministic file copy - no detection, no adaptation. Creates directories,
# copies skill templates, hooks, settings, and shared reference files.
# Agent-driven setup steps handle project-specific content afterward.
#
# Safe by design:
# - Skills and reference files are always overwritten (verbatim copies)
# - Settings are NOT overwritten if they already exist
# - Existing config.yaml is preserved but the requested agent is registered
# - Pass --force to overwrite settings and config
# - Pass --update-config-version to update only the version field in existing config.yaml
# - Pass --clean-deprecated to remove deprecated skill directories
# =============================================================================
set -euo pipefail

# --- Resolve goat-flow root (directory containing this script's parent) ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GOAT_FLOW_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MANIFEST_PATH="$GOAT_FLOW_ROOT/workflow/manifest.json"

manifest_eval() {
  node - "$MANIFEST_PATH" "$@" <<'NODE'
const fs = require("node:fs");

const manifestPath = process.argv[2];
const mode = process.argv[3];
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const trimDir = (value) =>
  typeof value === "string" ? value.replace(/\/$/, "") : "";
const agentIds = Object.keys(manifest.agents || {});

if (mode === "supported-agents") {
  console.log(agentIds.join(","));
  console.log(agentIds.join("|"));
  process.exit(0);
}

if (mode === "supported-skills") {
  for (const skill of manifest.skills?.canonical || []) {
    console.log(skill);
  }
  process.exit(0);
}

if (mode === "stale-skills") {
  for (const skill of manifest.skills?.stale_names || []) {
    console.log(skill);
  }
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
  for (const file of files) {
    console.log(file);
  }
  process.exit(0);
}

if (mode === "agent-profile") {
  const agentId = process.argv[4];
  const agent = manifest.agents?.[agentId];
  if (!agent) {
    process.stderr.write(`unknown agent: ${agentId}\n`);
    process.exit(2);
  }

  const settingsDst = typeof agent.settings === "string" ? agent.settings : "";
  const settingsExt = settingsDst ? settingsDst.split(".").pop() : "";
  const hookConfigDst =
    typeof agent.hook_config_file === "string" &&
    agent.hook_config_file !== settingsDst
      ? agent.hook_config_file
      : "";

  const entries = {
    skills_dir: trimDir(agent.skills_dir),
    hooks_dir: trimDir(agent.hooks_dir),
    settings_src: settingsDst
      ? `workflow/hooks/agent-config/${agentId}.${settingsExt}`
      : "",
    settings_dst: settingsDst,
    hook_config_src: hookConfigDst
      ? `workflow/hooks/agent-config/${agentId}-hooks.json`
      : "",
    hook_config_dst: hookConfigDst,
    deny_hook_dst:
      typeof agent.deny_hook === "string" ? agent.deny_hook : "",
    config_agents: agentId,
  };

  for (const [key, value] of Object.entries(entries)) {
    console.log(`${key}\t${value}`);
  }
  process.exit(0);
}

process.stderr.write(`unknown manifest_eval mode: ${mode}\n`);
process.exit(1);
NODE
}

readarray -t SUPPORTED_AGENT_LINES < <(manifest_eval supported-agents)
SUPPORTED_AGENTS_CSV="${SUPPORTED_AGENT_LINES[0]:-}"
SUPPORTED_AGENTS_PIPE="${SUPPORTED_AGENT_LINES[1]:-}"
SUPPORTED_AGENTS_DISPLAY="${SUPPORTED_AGENTS_CSV//,/, }"

# --- Parse arguments ---
PROJECT=""
AGENT=""
FORCE=false
UPDATE_CONFIG_VERSION=false
CLEAN_DEPRECATED=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent) AGENT="$2"; shift 2 ;;
    --force) FORCE=true; shift ;;
    --update-config-version) UPDATE_CONFIG_VERSION=true; shift ;;
    --clean-deprecated) CLEAN_DEPRECATED=true; shift ;;
    -*)      echo "ERROR: Unknown flag: $1"; exit 1 ;;
    *)       PROJECT="$1"; shift ;;
  esac
done

if [[ -z "$PROJECT" ]]; then
  echo "Usage: $0 /path/to/project --agent <${SUPPORTED_AGENTS_PIPE}>"
  exit 1
fi

if [[ ! -d "$PROJECT" ]]; then
  echo "ERROR: $PROJECT is not a directory"
  exit 1
fi

# --- Agent profile ---
PROFILE_DATA="$(manifest_eval agent-profile "$AGENT")" || {
  echo "ERROR: --agent must be ${SUPPORTED_AGENTS_DISPLAY} (got: '${AGENT:-<empty>}')"
  exit 1
}

while IFS=$'\t' read -r key value; do
  case "$key" in
    skills_dir) SKILLS_DIR="$value" ;;
    hooks_dir) HOOKS_DIR="$value" ;;
    settings_src) SETTINGS_SRC="$value" ;;
    settings_dst) SETTINGS_DST="$value" ;;
    hook_config_src) HOOK_CONFIG_SRC="$value" ;;
    hook_config_dst) HOOK_CONFIG_DST="$value" ;;
    deny_hook_dst) DENY_HOOK_DST="$value" ;;
    config_agents) CONFIG_AGENTS_CSV="$value" ;;
  esac
done <<< "$PROFILE_DATA"

if [[ -z "${SKILLS_DIR:-}" || -z "${HOOKS_DIR:-}" || -z "${DENY_HOOK_DST:-}" ]]; then
  echo "ERROR: manifest profile for '$AGENT' is incomplete"
  exit 1
fi

if [[ -n "${SETTINGS_DST:-}" && -z "${SETTINGS_SRC:-}" ]]; then
  echo "ERROR: manifest profile for '$AGENT' is missing settings_src"
  exit 1
fi

readarray -t SKILL_NAMES < <(manifest_eval supported-skills)

# --- Read version from package.json ---
VERSION=$(
  node -e "console.log(require('$GOAT_FLOW_ROOT/package.json').version)" 2>/dev/null ||
    sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$GOAT_FLOW_ROOT/package.json" | head -n1
)

if [[ -z "$VERSION" ]]; then
  echo "ERROR: could not determine goat-flow version from package.json"
  exit 1
fi

COPIED=0
SKIPPED=0

copy_file() {
  local src="$1" dst="$2"
  if [[ ! -f "$src" ]]; then
    echo "ERROR: missing installer template: $src"
    echo "Manifest/template drift detected. Restore the referenced template before running install."
    exit 1
  fi
  mkdir -p "$(dirname "$dst")"
  cp "$src" "$dst"
  COPIED=$((COPIED + 1))
  echo "  ✓ $dst"
}

copy_if_missing() {
  local src="$1" dst="$2"
  if [[ -f "$dst" ]] && ! $FORCE; then
    SKIPPED=$((SKIPPED + 1))
    echo "  · $dst (exists, skipped)"
    return
  fi
  copy_file "$src" "$dst"
}

touch_anchor() {
  local dst="$1"
  if [[ -f "$dst" ]]; then
    SKIPPED=$((SKIPPED + 1))
    echo "  · $dst (exists, skipped)"
    return
  fi
  mkdir -p "$(dirname "$dst")"
  : > "$dst"
  COPIED=$((COPIED + 1))
  echo "  ✓ $dst"
}

update_config_version_line() {
  local path="$1"
  node - "$path" "$VERSION" <<'NODE'
const fs = require("node:fs");

const path = process.argv[2];
const version = process.argv[3];
const content = fs.readFileSync(path, "utf8");
fs.writeFileSync(path, content.replace(/^version:.*$/m, `version: "${version}"`));
NODE
}

ensure_config_agent_entry() {
  local path="$1"
  local agent="$2"
  node - "$path" "$agent" <<'NODE'
const fs = require("node:fs");

const path = process.argv[2];
const agent = process.argv[3];
const content = fs.readFileSync(path, "utf8");
const eol = content.includes("\r\n") ? "\r\n" : "\n";
const hadFinalNewline = /\r?\n$/u.test(content);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitInlineList(value) {
  const match = value.trim().match(/^\[(.*)\]$/u);
  if (!match) return null;
  return match[1]
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function indentOf(line) {
  return line.match(/^\s*/u)?.[0] ?? "";
}

let lines = content.split(/\r?\n/u);
if (hadFinalNewline) lines = lines.slice(0, -1);

const agentKeyRe = /^(\s*)agents\s*:\s*(.*?)(\s*#.*)?$/u;
const agentItemRe = new RegExp(
  `^\\s*-\\s*["']?${escapeRegExp(agent)}["']?\\s*(?:#.*)?$`,
  "u",
);
const index = lines.findIndex((line) => agentKeyRe.test(line));
let changed = false;

if (index === -1) {
  if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
  lines.push("agents:", `  - ${agent}`);
  changed = true;
} else {
  const match = lines[index].match(agentKeyRe);
  const baseIndent = match?.[1] ?? "";
  const rest = (match?.[2] ?? "").trim();
  const inlineAgents = splitInlineList(rest);

  if (inlineAgents) {
    if (!inlineAgents.includes(agent)) {
      inlineAgents.push(agent);
      changed = true;
    }
    if (changed) {
      lines.splice(
        index,
        1,
        `${baseIndent}agents:`,
        ...inlineAgents.map((id) => `${baseIndent}  - ${id}`),
      );
    }
  } else if (rest === "null" || rest === "[]") {
    lines.splice(index, 1, `${baseIndent}agents:`, `${baseIndent}  - ${agent}`);
    changed = true;
  } else {
    const baseIndentLength = baseIndent.length;
    let cursor = index + 1;
    let lastAgentItem = -1;
    let agentAlreadyPresent = false;

    while (cursor < lines.length) {
      const line = lines[cursor];
      const trimmed = line.trim();
      if (trimmed !== "" && !trimmed.startsWith("#")) {
        const currentIndentLength = indentOf(line).length;
        if (currentIndentLength <= baseIndentLength) break;
      }
      if (/^\s*-\s*/u.test(line)) {
        lastAgentItem = cursor;
        if (agentItemRe.test(line)) agentAlreadyPresent = true;
      }
      cursor += 1;
    }

    if (!agentAlreadyPresent) {
      const insertAt = lastAgentItem >= 0 ? lastAgentItem + 1 : index + 1;
      lines.splice(insertAt, 0, `${baseIndent}  - ${agent}`);
      changed = true;
    }
  }
}

if (changed) {
  fs.writeFileSync(path, `${lines.join(eol)}${hadFinalNewline ? eol : ""}`);
}
console.log(changed ? "changed" : "unchanged");
NODE
}

migrate_codex_hooks_feature_flag() {
  local path="$1"
  node - "$path" <<'NODE'
const fs = require("node:fs");

const path = process.argv[2];
const content = fs.readFileSync(path, "utf8");
const eol = content.includes("\r\n") ? "\r\n" : "\n";
const hadFinalNewline = /\r?\n$/u.test(content);
const lines = content.split(/\r?\n/u);
if (hadFinalNewline) lines.pop();

function parseFeatureBooleanAssignment(line, section) {
  if (/^\s*(#|$)/u.test(line)) return null;
  const match = line.match(
    /^(\s*)([A-Za-z0-9_.-]+)(\s*=\s*)(true|false)(\s*(?:#.*)?)$/u,
  );
  if (!match) return null;
  const [, indent, rawKey, separator, value, suffix] = match;
  const normalizedKey =
    section === "features" && !rawKey.includes(".")
      ? `features.${rawKey}`
      : rawKey;
  return { indent, rawKey, separator, value, suffix, normalizedKey };
}

let section = "";
const deprecated = [];
const current = [];
for (let index = 0; index < lines.length; index += 1) {
  const sectionMatch = lines[index].match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/u);
  if (sectionMatch) {
    section = sectionMatch[1].trim();
    continue;
  }
  const assignment = parseFeatureBooleanAssignment(lines[index], section);
  if (!assignment) continue;
  if (assignment.normalizedKey === "features.codex_hooks") {
    deprecated.push({ index, assignment });
  } else if (assignment.normalizedKey === "features.hooks") {
    current.push(index);
  }
}

if (deprecated.length === 0) {
  console.log("unchanged");
  process.exit(0);
}

const remove = new Set();
if (current.length === 0) {
  const first = deprecated[0];
  const replacementKey = first.assignment.rawKey.includes(".")
    ? "features.hooks"
    : "hooks";
  lines[first.index] =
    first.assignment.indent +
    replacementKey +
    first.assignment.separator +
    first.assignment.value +
    first.assignment.suffix;
  for (const entry of deprecated.slice(1)) remove.add(entry.index);
} else {
  for (const entry of deprecated) remove.add(entry.index);
}

const next = lines.filter((_, index) => !remove.has(index)).join(eol);
fs.writeFileSync(path, next + (hadFinalNewline ? eol : ""));
console.log("migrated");
NODE
}

echo "goat-flow install: $(basename "$PROJECT") (agent: $AGENT)"
echo ""

cd "$PROJECT"

# ==========================================================================
# 1. Create .goat-flow/ directories
# ==========================================================================
echo "Directories:"
for dir in .goat-flow/footguns .goat-flow/lessons .goat-flow/patterns .goat-flow/decisions .goat-flow/tasks .goat-flow/scratchpad .goat-flow/logs/sessions .goat-flow/logs/quality .goat-flow/logs/critiques .goat-flow/logs/security .goat-flow/skill-reference .goat-flow/skill-playbooks; do
  if [[ ! -d "$dir" ]]; then
    mkdir -p "$dir"
    echo "  ✓ $dir/"
  else
    echo "  · $dir/ (exists)"
  fi
done
echo ""

# ==========================================================================
# 2. Copy .gitignore (always overwrite)
# ==========================================================================
echo "Gitignore + READMEs:"
copy_file "$GOAT_FLOW_ROOT/workflow/setup/reference/goat-flow-gitignore" ".goat-flow/.gitignore"
copy_file "$GOAT_FLOW_ROOT/workflow/setup/reference/tasks-gitignore" ".goat-flow/tasks/.gitignore"
copy_file "$GOAT_FLOW_ROOT/workflow/setup/reference/scratchpad-gitignore" ".goat-flow/scratchpad/.gitignore"
copy_file "$GOAT_FLOW_ROOT/workflow/setup/reference/lessons-readme.md" ".goat-flow/lessons/README.md"
copy_file "$GOAT_FLOW_ROOT/workflow/setup/reference/footguns-readme.md" ".goat-flow/footguns/README.md"
copy_file "$GOAT_FLOW_ROOT/workflow/setup/reference/patterns-readme.md" ".goat-flow/patterns/README.md"
copy_file "$GOAT_FLOW_ROOT/workflow/setup/reference/tasks-readme.md" ".goat-flow/tasks/README.md"
copy_file "$GOAT_FLOW_ROOT/workflow/setup/reference/scratchpad-readme.md" ".goat-flow/scratchpad/README.md"
copy_file "$GOAT_FLOW_ROOT/workflow/setup/reference/quality-readme.md" ".goat-flow/logs/quality/README.md"
copy_file "$GOAT_FLOW_ROOT/workflow/setup/reference/critiques-readme.md" ".goat-flow/logs/critiques/README.md"
copy_file "$GOAT_FLOW_ROOT/workflow/setup/reference/security-readme.md" ".goat-flow/logs/security/README.md"
copy_if_missing "$GOAT_FLOW_ROOT/workflow/setup/reference/decisions-readme.md" ".goat-flow/decisions/README.md"
touch_anchor ".goat-flow/logs/sessions/.gitkeep"
echo ""

# ==========================================================================
# 3. Migrate legacy skill-reference layout (1.5.1 → 1.5.2 split)
#    The `skill-reference/` dir was split into:
#      - skill-reference/   (meta only: skill-preamble.md, skill-conventions.md)
#      - skill-playbooks/   (browser-use.md, page-capture.md, skill-quality-testing.md + topical dir)
#    On upgrade, sweep the legacy locations so the installed layout matches.
# ==========================================================================
legacy_reference_files=(
  ".goat-flow/skill-reference/browser-use.md"
  ".goat-flow/skill-reference/page-capture.md"
  ".goat-flow/skill-reference/skill-quality-testing.md"
)
legacy_reference_dir=".goat-flow/skill-reference/skill-quality-testing"
removed_any=false
for legacy_file in "${legacy_reference_files[@]}"; do
  if [[ -f "$legacy_file" ]]; then
    rm -f "$legacy_file"
    echo "  ✓ migrated $legacy_file → .goat-flow/skill-playbooks/"
    removed_any=true
  fi
done
if [[ -d "$legacy_reference_dir" ]]; then
  rm -rf "$legacy_reference_dir"
  echo "  ✓ migrated $legacy_reference_dir/ → .goat-flow/skill-playbooks/"
  removed_any=true
fi
if [[ "$removed_any" == true ]]; then
  echo ""
fi

# ==========================================================================
# 4. Copy shared reference files (always overwrite - verbatim copies)
# ==========================================================================
echo "Meta references → .goat-flow/skill-reference/:"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/reference/README.md" ".goat-flow/skill-reference/README.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/reference/skill-preamble.md" ".goat-flow/skill-reference/skill-preamble.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/reference/skill-conventions.md" ".goat-flow/skill-reference/skill-conventions.md"

echo "Standalone playbooks → .goat-flow/skill-playbooks/:"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/playbooks/README.md" ".goat-flow/skill-playbooks/README.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/playbooks/browser-use.md" ".goat-flow/skill-playbooks/browser-use.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/playbooks/page-capture.md" ".goat-flow/skill-playbooks/page-capture.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/playbooks/skill-quality-testing.md" ".goat-flow/skill-playbooks/skill-quality-testing.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/playbooks/skill-quality-testing/tdd-iteration.md" ".goat-flow/skill-playbooks/skill-quality-testing/tdd-iteration.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/playbooks/skill-quality-testing/adversarial-framing.md" ".goat-flow/skill-playbooks/skill-quality-testing/adversarial-framing.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/playbooks/skill-quality-testing/deployment.md" ".goat-flow/skill-playbooks/skill-quality-testing/deployment.md"
copy_if_missing "$GOAT_FLOW_ROOT/workflow/setup/reference/security-policy.md" ".goat-flow/security-policy.md"
echo ""

# ==========================================================================
# 5. Install skills (always overwrite - verbatim from templates)
# ==========================================================================
echo "Skills → $SKILLS_DIR/:"
for skill in "${SKILL_NAMES[@]}"; do
  skill_dir="$GOAT_FLOW_ROOT/workflow/skills/$skill"
  if [[ ! -d "$skill_dir" ]]; then
    echo "  ✗ $skill (template dir not found: $skill_dir)"
    continue
  fi
  while IFS= read -r relative_file; do
    [[ -n "$relative_file" ]] || continue
    copy_file "$skill_dir/$relative_file" "$SKILLS_DIR/$skill/$relative_file"
  done < <(manifest_eval skill-files "$skill")
done
echo ""

# ==========================================================================
# 4b. Remove deprecated skills (only with --clean-deprecated or --force)
# ==========================================================================
if $CLEAN_DEPRECATED || $FORCE; then
  readarray -t STALE_NAMES < <(manifest_eval stale-skills)
  if [[ ${#STALE_NAMES[@]} -gt 0 ]]; then
    REMOVED=0
    echo "Deprecated skill cleanup:"
    for stale in "${STALE_NAMES[@]}"; do
      [[ -n "$stale" ]] || continue
      stale_path="$SKILLS_DIR/$stale"
      if [[ -d "$stale_path" ]]; then
        rm -rf "$stale_path"
        REMOVED=$((REMOVED + 1))
        echo "  ✗ $stale_path (removed)"
      fi
    done
    if [[ $REMOVED -eq 0 ]]; then
      echo "  · no deprecated skills found"
    fi
    echo ""
  fi
fi

# ==========================================================================
# 6. Install hooks (always overwrite - verbatim copy)
# ==========================================================================
echo "Hooks → $HOOKS_DIR/:"
copy_file "$GOAT_FLOW_ROOT/workflow/hooks/deny-dangerous.sh" "$DENY_HOOK_DST"
DENY_SELF_TEST_DST="$(dirname "$DENY_HOOK_DST")/deny-dangerous.self-test.sh"
copy_file "$GOAT_FLOW_ROOT/workflow/hooks/deny-dangerous.self-test.sh" "$DENY_SELF_TEST_DST"
chmod +x "$DENY_HOOK_DST" "$DENY_SELF_TEST_DST"
if [[ -n "${HOOK_CONFIG_DST:-}" && -n "${HOOK_CONFIG_SRC:-}" ]]; then
  echo "Hooks config:"
  copy_if_missing "$GOAT_FLOW_ROOT/$HOOK_CONFIG_SRC" "$HOOK_CONFIG_DST"
fi
echo ""

# ==========================================================================
# 7. Install agent settings (skip if exists, unless --force)
# ==========================================================================
echo "Settings:"
SETTINGS_SKIPPED=false
if [[ -n "${SETTINGS_SRC:-}" && -n "${SETTINGS_DST:-}" ]]; then
  if [[ -f "$SETTINGS_DST" ]] && ! $FORCE; then
    if [[ "$AGENT" == "codex" ]] && [[ "$(migrate_codex_hooks_feature_flag "$SETTINGS_DST")" == "migrated" ]]; then
      COPIED=$((COPIED + 1))
      echo "  ✓ $SETTINGS_DST (migrated deprecated hooks flag)"
    else
      SETTINGS_SKIPPED=true
      SKIPPED=$((SKIPPED + 1))
      echo "  · $SETTINGS_DST (exists, skipped)"
    fi
  else
    copy_file "$GOAT_FLOW_ROOT/$SETTINGS_SRC" "$SETTINGS_DST"
  fi
else
  echo "  · no settings file for $AGENT"
fi
echo ""

# ==========================================================================
# 8. Scaffold or maintain config.yaml
# ==========================================================================
echo "Config:"
CONFIG_PATH=".goat-flow/config.yaml"
if [[ -f "$CONFIG_PATH" ]] && ! $FORCE; then
  CONFIG_CHANGED=false
  CONFIG_NOTES=()
  if $UPDATE_CONFIG_VERSION; then
    if grep -q "^version:" "$CONFIG_PATH"; then
      update_config_version_line "$CONFIG_PATH"
      CONFIG_CHANGED=true
      CONFIG_NOTES+=("version updated to $VERSION")
    else
      echo "version: \"$VERSION\"" >> "$CONFIG_PATH"
      CONFIG_CHANGED=true
      CONFIG_NOTES+=("version field added: $VERSION")
    fi
  fi
  if [[ "$(ensure_config_agent_entry "$CONFIG_PATH" "$AGENT")" == "changed" ]]; then
    CONFIG_CHANGED=true
    CONFIG_NOTES+=("agent $AGENT registered")
  fi
  if $CONFIG_CHANGED; then
    COPIED=$((COPIED + 1))
    note_text="$(IFS=', '; echo "${CONFIG_NOTES[*]}")"
    echo "  ✓ $CONFIG_PATH ($note_text)"
  else
    SKIPPED=$((SKIPPED + 1))
    echo "  · $CONFIG_PATH (exists, no config changes)"
  fi
else
  IFS=',' read -r -a CONFIG_AGENTS <<< "${CONFIG_AGENTS_CSV:-$SUPPORTED_AGENTS_CSV}"
  config_agent_lines=""
  for supported_agent in "${CONFIG_AGENTS[@]}"; do
    config_agent_lines+="  - ${supported_agent}"$'\n'
  done
  printf 'version: "%s"\n\nagents:\n%s\nskills:\n  install: all\n' \
    "$VERSION" \
    "$config_agent_lines" > "$CONFIG_PATH"
  COPIED=$((COPIED + 1))
  echo "  ✓ $CONFIG_PATH (scaffolded)"
fi
echo ""

# ==========================================================================
# 9. Write .active marker if exactly one version-named subdir exists
# ==========================================================================
# Convention: .goat-flow/tasks/.active is a one-line file naming the active
# plan subdir (e.g. "1.2.2"). Skills (goat, goat-plan) read it to scope their
# scan. See ADR-017. We only write it automatically when there is no ambiguity.
echo "Active plan marker:"
ACTIVE_FILE=".goat-flow/tasks/.active"
if [[ -f "$ACTIVE_FILE" ]] && ! $FORCE; then
  SKIPPED=$((SKIPPED + 1))
  echo "  · $ACTIVE_FILE (exists, skipped)"
else
  shopt -s nullglob
  version_subdirs=()
  for d in .goat-flow/tasks/[0-9]*.[0-9]*.[0-9]*/; do
    [[ -d "$d" ]] && version_subdirs+=("$(basename "$d")")
  done
  shopt -u nullglob
  if [[ ${#version_subdirs[@]} -eq 1 ]]; then
    echo "${version_subdirs[0]}" > "$ACTIVE_FILE"
    COPIED=$((COPIED + 1))
    echo "  ✓ $ACTIVE_FILE → ${version_subdirs[0]}"
  elif [[ ${#version_subdirs[@]} -eq 0 ]]; then
    echo "  · no version subdirs found, skipped (skills will fall back to asking)"
  else
    echo "  · ${#version_subdirs[@]} version subdirs found, skipped (skills will ask which is active)"
  fi
fi
echo ""

# ==========================================================================
# Summary
# ==========================================================================
echo "─────────────────────────────────────────"
echo "DONE: $COPIED files installed, $SKIPPED skipped"
echo ""

# Warn when deny hook is installed but settings file was skipped (hook may not be registered)
if $SETTINGS_SKIPPED && [[ -f "$DENY_HOOK_DST" ]]; then
  echo "⚠ Settings file was preserved (not overwritten)."
  echo "  The deny hook at $DENY_HOOK_DST was installed but may not be"
  echo "  registered in $SETTINGS_DST. Verify your settings file includes"
  echo "  a PreToolUse hook entry pointing at the deny script."
  if [[ "$AGENT" == "claude" ]]; then
    echo ""
    echo "  For Claude, add this to $SETTINGS_DST under \"hooks\":{\"PreToolUse\":[...]}:"
    # shellcheck disable=SC2016
    echo '    {"matcher":"Bash","hooks":[{"type":"command","command":"bash \"$(git rev-parse --show-toplevel)/.claude/hooks/deny-dangerous.sh\""}]}'
  fi
  echo ""
fi

echo "Next steps:"
echo "  1. Run the setup steps to create project-specific content"
echo "     (CLAUDE.md, architecture.md, code-map.md, footguns, lessons)"
echo "  2. Run: goat-flow audit . --agent $AGENT"
