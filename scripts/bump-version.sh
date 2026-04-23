#!/usr/bin/env bash
# bump-version.sh
#
# Purpose:
#   Bump the goat-flow version across all files that embed it,
#   then sync installed mirrors so preflight passes without manual fixups.
#
# Usage:
#   bash scripts/bump-version.sh <patch|minor|major>
#   bash scripts/bump-version.sh 1.3.0          # explicit version
#
# Updated files:
#   - package.json + package-lock.json (via npm version --no-git-tag-version)
#   - Instruction file headers (CLAUDE.md, AGENTS.md, GEMINI.md, .github/copilot-instructions.md)
#   - .goat-flow/config.yaml version field
#   - workflow/manifest.json
#   - workflow/skills/*/SKILL.md frontmatter (7 templates)
#   - workflow/skills/reference/ (shared skill reference docs)
#   - test/fixtures/skill-with-references/SKILL.md
#   - docs/audit-and-quality.md sample output
#   - Installed skill mirrors (.claude/skills/, .agents/skills/, .github/skills/ via manifest)
#   - Installed reference docs (.goat-flow/skill-reference/)
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

# ── Source files (version string replacement) ──────────────────────────

# Instruction file headers
for ifile in CLAUDE.md AGENTS.md GEMINI.md .github/copilot-instructions.md; do
  update_file "$ifile"
done

# Config version field
update_file ".goat-flow/config.yaml"

# Workflow manifest
update_file "workflow/manifest.json"

# Skill templates (7 canonical + 1 test fixture)
for skill_md in workflow/skills/*/SKILL.md; do
  update_file "$skill_md"
done
update_file "test/fixtures/skill-with-references/SKILL.md"

# Shared reference docs
update_file "workflow/skills/reference/skill-quality-testing/deployment.md"

# Docs
update_file "docs/audit-and-quality.md"

# ── Installed mirrors (copy from workflow templates) ───────────────────

echo ""
echo "Syncing installed mirrors..."

MANIFEST_PATH="workflow/manifest.json"

manifest_skill_roots() {
  node - "$MANIFEST_PATH" <<'NODE'
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const roots = [
  ...new Set(
    Object.values(manifest.agents || {})
      .map((a) => (typeof a.skills_dir === "string" ? a.skills_dir.replace(/\/$/, "") : ""))
      .filter(Boolean),
  ),
];
for (const r of roots) console.log(r);
NODE
}

manifest_skill_names() {
  node - "$MANIFEST_PATH" <<'NODE'
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
for (const s of manifest.skills?.canonical || []) console.log(s);
NODE
}

# Sync skill SKILL.md files to each installed mirror
while IFS= read -r skill_root; do
  if [[ ! -d "$skill_root" ]]; then continue; fi
  while IFS= read -r skill_name; do
    src="workflow/skills/${skill_name}/SKILL.md"
    dst="${skill_root}/${skill_name}/SKILL.md"
    if [[ -f "$src" ]] && [[ -f "$dst" ]]; then
      cp "$src" "$dst"
    fi
  done < <(manifest_skill_names)
  echo "  ✓ ${skill_root}/*/SKILL.md"
done < <(manifest_skill_roots)

# Sync shared reference docs
if [[ -d ".goat-flow/skill-reference" ]]; then
  cp -r workflow/skills/reference/* .goat-flow/skill-reference/
  echo "  ✓ .goat-flow/skill-reference/"
fi

echo ""
echo "Done. Verify with: npm run check-versions"
