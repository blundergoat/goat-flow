#!/usr/bin/env bash
# =============================================================================
# migrate-to-1.1.sh - Migrate goat-flow 0.9/1.0 projects to 1.1.0 layout
# =============================================================================
# Usage: bash /path/to/goat-flow/scripts/migrate-to-1.1.sh /path/to/project
#
# What it does:
# 1. Migrates docs/footguns.md → .goat-flow/footguns/ (category bucket)
# 2. Migrates docs/lessons.md → .goat-flow/lessons/ (category bucket)
# 3. Migrates docs/decisions/ → .goat-flow/decisions/
# 4. Migrates docs/architecture.md → .goat-flow/architecture.md
# 5. Migrates docs/code-map.md → .goat-flow/code-map.md
# 6. Deletes stale goat-* skill directories
# 7. Removes legacy task/handoff/milestone files
# 8. Updates config.yaml paths if they point to old locations
#
# Safe by design:
# - Never overwrites existing .goat-flow/ content (merges or skips)
# - Creates backups in .goat-flow/_migrated-from-0.9/
# - Dry-run mode by default - pass --execute to actually make changes
# =============================================================================
set -euo pipefail

PROJECT="${1:-}"
EXECUTE=false

if [[ "$PROJECT" == "--execute" ]]; then
  echo "ERROR: project path must come first. Usage: $0 /path/to/project [--execute]"
  exit 1
fi

if [[ -z "$PROJECT" ]]; then
  echo "Usage: $0 /path/to/project [--execute]"
  echo ""
  echo "  --execute    Actually make changes (default is dry-run)"
  exit 1
fi

if [[ "${2:-}" == "--execute" ]]; then
  EXECUTE=true
fi

if [[ ! -d "$PROJECT" ]]; then
  echo "ERROR: $PROJECT is not a directory"
  exit 1
fi

cd "$PROJECT"

BACKUP_DIR=".goat-flow/_migrated-from-0.9"
CHANGES=0

log() { echo "  $1"; }
action() {
  CHANGES=$((CHANGES + 1))
  if $EXECUTE; then
    echo "  ✓ $1"
  else
    echo "  → $1 (dry-run)"
  fi
}

echo "goat-flow migration: $(basename "$PROJECT")"
echo "Mode: $($EXECUTE && echo 'EXECUTE' || echo 'DRY-RUN')"
echo ""

# --- Create backup dir ---
if $EXECUTE; then
  mkdir -p "$BACKUP_DIR"
  mkdir -p .goat-flow/footguns
  mkdir -p .goat-flow/lessons
  mkdir -p .goat-flow/decisions
fi

# --- 1. Migrate docs/footguns.md → .goat-flow/footguns/ ---
if [[ -f "docs/footguns.md" ]]; then
  if [[ -d ".goat-flow/footguns" ]] && ls .goat-flow/footguns/*.md >/dev/null 2>&1; then
    log "docs/footguns.md exists AND .goat-flow/footguns/ has content - MERGE needed"
    action "Copy docs/footguns.md → $BACKUP_DIR/footguns.md (backup)"
    action "Append unique entries from docs/footguns.md to .goat-flow/footguns/migrated.md"
    if $EXECUTE; then
      cp docs/footguns.md "$BACKUP_DIR/footguns.md"
      # Only copy if there's content not already in .goat-flow/footguns/
      if ! grep -qF "Migrated from docs/footguns.md" .goat-flow/footguns/migrated.md 2>/dev/null; then
        echo "# Migrated from docs/footguns.md" > .goat-flow/footguns/migrated.md
        echo "" >> .goat-flow/footguns/migrated.md
        cat docs/footguns.md >> .goat-flow/footguns/migrated.md
      fi
    fi
  else
    action "Move docs/footguns.md → .goat-flow/footguns/migrated.md"
    if $EXECUTE; then
      cp docs/footguns.md "$BACKUP_DIR/footguns.md"
      mkdir -p .goat-flow/footguns
      echo "# Migrated from docs/footguns.md" > .goat-flow/footguns/migrated.md
      echo "" >> .goat-flow/footguns/migrated.md
      cat docs/footguns.md >> .goat-flow/footguns/migrated.md
    fi
  fi
  action "Delete docs/footguns.md"
  $EXECUTE && rm -f docs/footguns.md
fi

# --- 2. Migrate docs/lessons.md → .goat-flow/lessons/ ---
if [[ -f "docs/lessons.md" ]]; then
  action "Move docs/lessons.md → .goat-flow/lessons/migrated.md"
  if $EXECUTE; then
    cp docs/lessons.md "$BACKUP_DIR/lessons.md"
    mkdir -p .goat-flow/lessons
    if ! grep -qF "Migrated from docs/lessons.md" .goat-flow/lessons/migrated.md 2>/dev/null; then
      echo "# Migrated from docs/lessons.md" > .goat-flow/lessons/migrated.md
      echo "" >> .goat-flow/lessons/migrated.md
      cat docs/lessons.md >> .goat-flow/lessons/migrated.md
    fi
    rm -f docs/lessons.md
  fi
fi

# --- 3. Migrate docs/decisions/ → .goat-flow/decisions/ ---
if [[ -d "docs/decisions" ]]; then
  for f in docs/decisions/*.md; do
    [[ -f "$f" ]] || continue
    base=$(basename "$f")
    # Skip blank templates
    if [[ "$base" == "ADR-template.md" ]] || [[ "$base" == "ADR-000-template.md" ]]; then
      action "Skip template: $f"
      continue
    fi
    if [[ -f ".goat-flow/decisions/$base" ]]; then
      log "Already exists: .goat-flow/decisions/$base - skipping"
    else
      action "Copy $f → .goat-flow/decisions/$base"
      if $EXECUTE; then
        cp "$f" "$BACKUP_DIR/$base"
        cp "$f" ".goat-flow/decisions/$base"
      fi
    fi
  done
fi

# --- 4. Migrate docs/architecture.md ---
if [[ -f "docs/architecture.md" ]]; then
  if [[ -f ".goat-flow/architecture.md" ]]; then
    log "Both docs/architecture.md and .goat-flow/architecture.md exist"
    action "Backup docs/architecture.md → $BACKUP_DIR/architecture.md"
    $EXECUTE && cp docs/architecture.md "$BACKUP_DIR/architecture.md"
    log ".goat-flow/architecture.md kept as canonical (likely more detailed)"
  else
    action "Move docs/architecture.md → .goat-flow/architecture.md"
    if $EXECUTE; then
      cp docs/architecture.md "$BACKUP_DIR/architecture.md"
      mv docs/architecture.md .goat-flow/architecture.md
    fi
  fi
fi

# --- 5. Migrate docs/code-map.md ---
if [[ -f "docs/code-map.md" ]]; then
  if [[ -f ".goat-flow/code-map.md" ]]; then
    log "Both docs/code-map.md and .goat-flow/code-map.md exist - keeping .goat-flow/ version"
    action "Backup docs/code-map.md → $BACKUP_DIR/code-map.md"
    $EXECUTE && cp docs/code-map.md "$BACKUP_DIR/code-map.md"
  else
    action "Move docs/code-map.md → .goat-flow/code-map.md"
    if $EXECUTE; then
      cp docs/code-map.md "$BACKUP_DIR/code-map.md"
      mv docs/code-map.md .goat-flow/code-map.md
    fi
  fi
fi

# --- 6. Delete stale goat-* skill directories ---
STALE_SKILLS="goat-audit goat-investigate goat-onboard goat-reflect goat-resume goat-context goat-simplify goat-refactor goat-preflight goat-research"
for dir in .claude/skills .agents/skills .github/skills .gemini/skills; do
  [[ -d "$dir" ]] || continue
  for skill in $STALE_SKILLS; do
    if [[ -d "$dir/$skill" ]]; then
      action "Delete stale skill: $dir/$skill/"
      $EXECUTE && rm -rf "${dir:?}/${skill:?}"
    fi
  done
done

# --- 7. Remove legacy task/handoff/milestone files ---
for f in tasks/todo.md tasks/handoff.md tasks/handoff-template.md; do
  if [[ -f "$f" ]]; then
    action "Backup and delete $f"
    if $EXECUTE; then
      cp "$f" "$BACKUP_DIR/$(basename "$f")"
      rm -f "$f"
    fi
  fi
done

if [[ -d "milestones" ]]; then
  count=$(find milestones -name "*.md" | wc -l)
  if [[ "$count" -gt 0 ]]; then
    action "Move milestones/ ($count files) → $BACKUP_DIR/milestones/"
    if $EXECUTE; then
      cp -r milestones "$BACKUP_DIR/milestones"
      rm -rf milestones
    fi
  fi
fi

# --- 8. Remove old codex playbooks (non-goat-prefixed) ---
if [[ -d "docs/codex-playbooks" ]]; then
  OLD_PLAYBOOKS="audit.md code-review.md debug-investigate.md preflight.md research.md"
  for f in $OLD_PLAYBOOKS; do
    if [[ -f "docs/codex-playbooks/$f" ]]; then
      action "Delete old playbook: docs/codex-playbooks/$f"
      $EXECUTE && rm -f "docs/codex-playbooks/$f"
    fi
  done
fi

# --- 9. Update config.yaml paths ---
if [[ -f ".goat-flow/config.yaml" ]] && $EXECUTE; then
  # Update any paths still pointing to docs/
  if grep -q "docs/footguns" .goat-flow/config.yaml 2>/dev/null; then
    action "Update config.yaml: footguns path → .goat-flow/footguns/"
    sed -i 's|docs/footguns\.md|.goat-flow/footguns/|g' .goat-flow/config.yaml
    sed -i 's|docs/footguns/|.goat-flow/footguns/|g' .goat-flow/config.yaml
  fi
  if grep -q "docs/lessons" .goat-flow/config.yaml 2>/dev/null; then
    action "Update config.yaml: lessons path → .goat-flow/lessons/"
    sed -i 's|docs/lessons\.md|.goat-flow/lessons/|g' .goat-flow/config.yaml
    sed -i 's|docs/lessons/|.goat-flow/lessons/|g' .goat-flow/config.yaml
  fi
fi

# --- 10. Clean up empty docs/ if nothing left ---
if [[ -d "docs" ]]; then
  remaining=$(find docs -type f -name "*.md" 2>/dev/null | wc -l)
  if [[ "$remaining" -eq 0 ]]; then
    log "docs/ is empty after migration"
  else
    log "docs/ still has $remaining .md files - not removing (may have non-goat-flow content)"
  fi
fi

# --- Summary ---
echo ""
echo "─────────────────────────────────────────"
if $EXECUTE; then
  echo "DONE: $CHANGES changes applied"
  echo "Backups in: $BACKUP_DIR/"
  echo ""
  echo "Next steps:"
  echo "  1. Run setup to install v1.1.0 skills and update CLAUDE.md"
  echo "  2. Review .goat-flow/footguns/migrated.md and split into category buckets"
  echo "  3. Update AGENTS.md/GEMINI.md to reference .goat-flow/ paths"
  echo "  4. Run: goat-flow scan . --agent claude"
else
  echo "DRY-RUN: $CHANGES changes would be made"
  echo "Run with --execute to apply: $0 $PROJECT --execute"
fi
