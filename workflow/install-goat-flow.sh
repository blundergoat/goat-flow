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
  echo "Usage: $0 /path/to/project --agent <claude|codex|gemini>"
  exit 1
fi

if [[ ! -d "$PROJECT" ]]; then
  echo "ERROR: $PROJECT is not a directory"
  exit 1
fi

# --- Agent profile ---
case "$AGENT" in
  claude)
    SKILLS_DIR=".claude/skills"
    HOOKS_DIR=".claude/hooks"
    SETTINGS_SRC="workflow/hooks/agent-config/claude.json"
    SETTINGS_DST=".claude/settings.json"
    ;;
  codex)
    SKILLS_DIR=".agents/skills"
    HOOKS_DIR=".codex/hooks"
    SETTINGS_SRC="workflow/hooks/agent-config/codex.toml"
    SETTINGS_DST=".codex/config.toml"
    ;;
  gemini)
    SKILLS_DIR=".agents/skills"
    HOOKS_DIR=".gemini/hooks"
    SETTINGS_SRC="workflow/hooks/agent-config/gemini.json"
    SETTINGS_DST=".gemini/settings.json"
    ;;
  *)
    echo "ERROR: --agent must be claude, codex, or gemini (got: '${AGENT:-<empty>}')"
    exit 1
    ;;
esac

# --- Read version from package.json ---
VERSION=$(node -e "console.log(require('$GOAT_FLOW_ROOT/package.json').version)" 2>/dev/null || echo "1.1.0")

COPIED=0
SKIPPED=0

copy_file() {
  local src="$1" dst="$2"
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

echo "goat-flow install: $(basename "$PROJECT") (agent: $AGENT)"
echo ""

cd "$PROJECT"

# ==========================================================================
# 1. Create .goat-flow/ directories
# ==========================================================================
echo "Directories:"
for dir in .goat-flow/footguns .goat-flow/lessons .goat-flow/decisions .goat-flow/tasks .goat-flow/scratchpad .goat-flow/logs/sessions; do
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
copy_file "$GOAT_FLOW_ROOT/workflow/setup/reference/lessons-readme.md" ".goat-flow/lessons/README.md"
copy_file "$GOAT_FLOW_ROOT/workflow/setup/reference/footguns-readme.md" ".goat-flow/footguns/README.md"
echo ""

# ==========================================================================
# 3. Copy shared reference files (always overwrite - verbatim copies)
# ==========================================================================
echo "Reference files:"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/reference/skill-preamble.md" ".goat-flow/skill-preamble.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/reference/skill-conventions.md" ".goat-flow/skill-conventions.md"
echo ""

# ==========================================================================
# 4. Install skills (always overwrite - verbatim from templates)
# ==========================================================================
echo "Skills → $SKILLS_DIR/:"
SKILL_NAMES="goat goat-debug goat-plan goat-review goat-sbao goat-security goat-test"
for skill in $SKILL_NAMES; do
  skill_dir="$GOAT_FLOW_ROOT/workflow/skills/$skill"
  if [[ ! -d "$skill_dir" ]]; then
    echo "  ✗ $skill (template dir not found: $skill_dir)"
    continue
  fi
  # Copy every .md file in the template directory (SKILL.md, etc.)
  for src_file in "$skill_dir"/*.md; do
    [[ -f "$src_file" ]] || continue
    filename="$(basename "$src_file")"
    copy_file "$src_file" "$SKILLS_DIR/$skill/$filename"
  done
done
echo ""

# ==========================================================================
# 5. Install hooks (always overwrite - verbatim copy)
# ==========================================================================
echo "Hooks → $HOOKS_DIR/:"
copy_file "$GOAT_FLOW_ROOT/workflow/hooks/deny-dangerous.sh" "$HOOKS_DIR/deny-dangerous.sh"
chmod +x "$HOOKS_DIR/deny-dangerous.sh"
# Codex: also install hooks.json (registers the PreToolUse deny hook in Codex format)
if [[ "$AGENT" == "codex" ]]; then
  echo "Hooks config:"
  copy_if_missing "$GOAT_FLOW_ROOT/workflow/hooks/agent-config/codex-hooks.json" ".codex/hooks.json"
fi
echo ""

# ==========================================================================
# 6. Install agent settings (skip if exists, unless --force)
# ==========================================================================
echo "Settings:"
copy_if_missing "$GOAT_FLOW_ROOT/$SETTINGS_SRC" "$SETTINGS_DST"
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
  cat > "$CONFIG_PATH" <<YAML
version: "$VERSION"

agents:
  - claude
  - codex
  - gemini

skills:
  install: all
YAML
  COPIED=$((COPIED + 1))
  echo "  ✓ $CONFIG_PATH (scaffolded)"
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
