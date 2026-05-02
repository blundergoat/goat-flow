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
# - Settings and config.yaml are NOT overwritten if they already exist
# - Pass --force to overwrite settings and config
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
    config_agents: agentIds.join(","),
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

while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent) AGENT="$2"; shift 2 ;;
    --force) FORCE=true; shift ;;
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

echo "goat-flow install: $(basename "$PROJECT") (agent: $AGENT)"
echo ""

cd "$PROJECT"

# ==========================================================================
# 1. Create .goat-flow/ directories
# ==========================================================================
echo "Directories:"
for dir in .goat-flow/footguns .goat-flow/lessons .goat-flow/patterns .goat-flow/decisions .goat-flow/tasks .goat-flow/scratchpad .goat-flow/logs/sessions .goat-flow/logs/quality .goat-flow/logs/critiques .goat-flow/logs/security .goat-flow/skill-reference; do
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
# 3. Copy shared reference files (always overwrite - verbatim copies)
# ==========================================================================
echo "Reference files → .goat-flow/skill-reference/:"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/reference/README.md" ".goat-flow/skill-reference/README.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/reference/skill-preamble.md" ".goat-flow/skill-reference/skill-preamble.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/reference/skill-conventions.md" ".goat-flow/skill-reference/skill-conventions.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/reference/browser-use.md" ".goat-flow/skill-reference/browser-use.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/reference/skill-quality-testing.md" ".goat-flow/skill-reference/skill-quality-testing.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/reference/skill-quality-testing/tdd-iteration.md" ".goat-flow/skill-reference/skill-quality-testing/tdd-iteration.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/reference/skill-quality-testing/adversarial-framing.md" ".goat-flow/skill-reference/skill-quality-testing/adversarial-framing.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/reference/skill-quality-testing/deployment.md" ".goat-flow/skill-reference/skill-quality-testing/deployment.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/reference/page-capture.md" ".goat-flow/skill-reference/page-capture.md"
copy_if_missing "$GOAT_FLOW_ROOT/workflow/setup/reference/security-policy.md" ".goat-flow/security-policy.md"
echo ""

# ==========================================================================
# 4. Install skills (always overwrite - verbatim from templates)
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
# 5. Install hooks (always overwrite - verbatim copy)
# ==========================================================================
echo "Hooks → $HOOKS_DIR/:"
copy_file "$GOAT_FLOW_ROOT/workflow/hooks/deny-dangerous.sh" "$DENY_HOOK_DST"
chmod +x "$DENY_HOOK_DST"
if [[ -n "${HOOK_CONFIG_DST:-}" && -n "${HOOK_CONFIG_SRC:-}" ]]; then
  echo "Hooks config:"
  copy_if_missing "$GOAT_FLOW_ROOT/$HOOK_CONFIG_SRC" "$HOOK_CONFIG_DST"
fi
echo ""

# ==========================================================================
# 6. Install agent settings (skip if exists, unless --force)
# ==========================================================================
echo "Settings:"
if [[ -n "${SETTINGS_SRC:-}" && -n "${SETTINGS_DST:-}" ]]; then
  copy_if_missing "$GOAT_FLOW_ROOT/$SETTINGS_SRC" "$SETTINGS_DST"
else
  echo "  · no settings file for $AGENT"
fi
echo ""

# ==========================================================================
# 7. Scaffold config.yaml (skip if exists, unless --force)
# ==========================================================================
echo "Config:"
CONFIG_PATH=".goat-flow/config.yaml"
if [[ -f "$CONFIG_PATH" ]] && ! $FORCE; then
  SKIPPED=$((SKIPPED + 1))
  echo "  · $CONFIG_PATH (exists, skipped)"
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
# 8. Write .active marker if exactly one version-named subdir exists
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
echo "Next steps:"
echo "  1. Run the setup steps to create project-specific content"
echo "     (CLAUDE.md, architecture.md, code-map.md, footguns, lessons)"
echo "  2. Run: goat-flow audit . --agent $AGENT"
