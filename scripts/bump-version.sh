#!/usr/bin/env bash
# bump-version.sh
#
# Purpose:
#   Bump the goat-flow version across all files that embed it.
#
# Usage:
#   bash scripts/bump-version.sh <patch|minor|major>
#   bash scripts/bump-version.sh 1.3.0          # explicit version
#
# Updated files:
#   - package.json + package-lock.json (via npm version --no-git-tag-version)
#   - CLAUDE.md header
#   - workflow/manifest.json
#   - workflow/skills/*/SKILL.md frontmatter (7 templates)
#   - test/fixtures/skill-with-references/SKILL.md
#   - docs/audit-and-quality.md sample output
#   - workflow/skills/reference/skill-quality-testing/deployment.md checklist
#
# Exit:
#   0 on success, non-zero on validation failure.
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: bash scripts/bump-version.sh <patch|minor|major|X.Y.Z>"
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

OLD_VERSION=$(node -p "require('./package.json').version")

case "$1" in
  patch|minor|major)
    npm version "$1" --no-git-tag-version >/dev/null
    NEW_VERSION=$(node -p "require('./package.json').version")
    ;;
  *)
    if [[ ! "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      echo "Error: '$1' is not a valid semver (X.Y.Z) or bump type (patch|minor|major)"
      exit 1
    fi
    NEW_VERSION="$1"
    npm version "$NEW_VERSION" --no-git-tag-version >/dev/null
    ;;
esac

echo "Bumping ${OLD_VERSION} → ${NEW_VERSION}"

escaped_old=$(printf '%s' "$OLD_VERSION" | sed 's/\./\\./g')
escaped_new="$NEW_VERSION"

update_file() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    echo "  WARN: $file not found, skipping"
    return
  fi
  if grep -q "$OLD_VERSION" "$file"; then
    sed -i "s/${escaped_old}/${escaped_new}/g" "$file"
    echo "  ✓ $file"
  else
    echo "  - $file (no match, skipped)"
  fi
}

# CLAUDE.md header
update_file "CLAUDE.md"

# Workflow manifest
update_file "workflow/manifest.json"

# Skill templates (7 canonical + 1 test fixture)
for skill_md in workflow/skills/*/SKILL.md; do
  update_file "$skill_md"
done
update_file "test/fixtures/skill-with-references/SKILL.md"

# Docs and reference
update_file "docs/audit-and-quality.md"
update_file "workflow/skills/reference/skill-quality-testing/deployment.md"

echo ""
echo "Done. Verify with: node scripts/check-versions.mjs"
