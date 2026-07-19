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
#   - Instruction file header versions and release dates (CLAUDE.md, AGENTS.md, .github/copilot-instructions.md)
#   - .goat-flow/config.yaml version field
#   - workflow/manifest.json
#   - workflow/skills/*/SKILL.md frontmatter (7 templates)
#   - workflow/skills/reference/ (shared skill reference docs)
#   - workflow/skills/playbooks/ (standalone skill playbooks)
#   - workflow/skills/*/references/ (per-skill reference packs)
#   - Hook templates and installed hook mirrors
#   - test/fixtures/skill-with-references/SKILL.md
#   - docs/audit-and-quality.md sample output
#   - Installed skill mirrors and per-skill reference packs (.claude/skills/, .agents/skills/, .github/skills/ via manifest)
#   - Installed shared reference docs (.goat-flow/skill-docs/)
#   - Installed standalone playbooks (.goat-flow/skill-docs/playbooks/)
#   - Installed skill-quality-testing methodology pack (.goat-flow/skill-docs/skill-quality-testing/)
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
escaped_new_regex=$(printf '%s' "$NEW_VERSION" | sed 's/\./\\./g')

release_heading=$(grep -E "^## v${escaped_new_regex} - [0-9]{4}-[0-9]{2}-[0-9]{2}$" CHANGELOG.md | head -n 1 || true)
if [[ -n "$release_heading" ]]; then
  RELEASE_DATE="${release_heading##* - }"
else
  RELEASE_DATE=$(date +"%Y-%m-%d")
fi

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

update_instruction_header() {
  local file="$1"
  local first_line
  if [[ ! -f "$file" ]]; then
    echo "  WARN: $file not found, skipping"
    return
  fi
  first_line=$(sed -n '1p' "$file")
  if [[ ! "$first_line" =~ ^#\ .+\ -\ v[0-9]+\.[0-9]+\.[0-9]+\ \([0-9]{4}-[0-9]{2}-[0-9]{2}\)$ ]] ||
    [[ "$first_line" != *" - v${OLD_VERSION} ("* ]]; then
    echo "Error: $file has an unexpected version/date header: $first_line" >&2
    exit 1
  fi
  sed -E -i "1s/- v${escaped_old} \\([0-9]{4}-[0-9]{2}-[0-9]{2}\\)$/- v${escaped_new} (${RELEASE_DATE})/" "$file"
  echo "  ✓ $file"
}

# ── Source files (version string replacement) ──────────────────────────

# Instruction file headers
for ifile in CLAUDE.md AGENTS.md .github/copilot-instructions.md; do
  update_instruction_header "$ifile"
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

# Shared and per-skill reference docs
while IFS= read -r -d '' reference_md; do
  update_file "$reference_md"
done < <(find workflow/skills/reference -type f -name '*.md' -print0)
while IFS= read -r -d '' reference_md; do
  update_file "$reference_md"
done < <(find workflow/skills/playbooks -type f -name '*.md' -print0)
while IFS= read -r -d '' reference_md; do
  update_file "$reference_md"
done < <(find workflow/skills -path '*/references/*.md' -print0)
if [[ -d test/fixtures ]]; then
  while IFS= read -r -d '' reference_md; do
    update_file "$reference_md"
  done < <(find test/fixtures -path '*/references/*.md' -print0)
fi

# Hook templates
for hook_sh in workflow/hooks/*.sh; do
  update_file "$hook_sh"
done

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

manifest_skill_files() {
  local skill_name="$1"
  node - "$MANIFEST_PATH" "$skill_name" <<'NODE'
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const skillName = process.argv[3];
const references = manifest.skills?.references || {};
const files = Array.isArray(references[skillName])
  ? references[skillName].filter((value) => typeof value === "string")
  : [];
console.log("SKILL.md");
for (const file of files) console.log(file);
NODE
}

manifest_deny_hooks() {
  node - "$MANIFEST_PATH" <<'NODE'
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const hooks = [
  ...new Set(
    Object.values(manifest.agents || {})
      .map((a) => (typeof a.deny_hook === "string" ? a.deny_hook : ""))
      .filter(Boolean),
  ),
];
for (const h of hooks) console.log(h);
NODE
}

manifest_hook_script_paths() {
  node - "$MANIFEST_PATH" <<'NODE'
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const paths = [];
for (const agent of Object.values(manifest.agents || {})) {
  if (typeof agent.hooks_dir !== "string" || !Array.isArray(agent.hooks)) continue;
  const hooksDir = agent.hooks_dir.replace(/\/$/, "");
  for (const hook of agent.hooks) {
    if (typeof hook === "string" && hook.endsWith(".sh")) paths.push(`${hooksDir}/${hook}`);
  }
}
for (const path of [...new Set(paths)]) console.log(path);
NODE
}

# Sync skill SKILL.md files and manifest-backed references to each installed mirror
while IFS= read -r skill_root; do
  if [[ ! -d "$skill_root" ]]; then continue; fi
  while IFS= read -r skill_name; do
    while IFS= read -r relative_file; do
      src="workflow/skills/${skill_name}/${relative_file}"
      dst="${skill_root}/${skill_name}/${relative_file}"
      if [[ -f "$src" ]] && [[ -f "$dst" ]]; then
        mkdir -p "$(dirname "$dst")"
        cp "$src" "$dst"
      fi
    done < <(manifest_skill_files "$skill_name")
  done < <(manifest_skill_names)
  echo "  ✓ ${skill_root}/*/{SKILL.md,references/}"
done < <(manifest_skill_roots)

# Sync hook templates to each installed hook mirror
while IFS= read -r hook_dst; do
  hook_src="workflow/hooks/$(basename "$hook_dst")"
  if [[ -f "$hook_src" && -d "$(dirname "$hook_dst")" ]]; then
    cp "$hook_src" "$hook_dst"
    echo "  ✓ ${hook_dst}"
  fi
done < <(manifest_hook_script_paths)

# Sync shared reference docs
if [[ -d ".goat-flow/skill-docs" ]]; then
  cp -r workflow/skills/reference/* .goat-flow/skill-docs/
  echo "  ✓ .goat-flow/skill-docs/"
fi
if [[ -d ".goat-flow/skill-docs/playbooks" ]]; then
  rm -f .goat-flow/skill-docs/playbooks/skill-quality-testing.md
  rm -rf .goat-flow/skill-docs/playbooks/skill-quality-testing
  for playbook_src in workflow/skills/playbooks/*.md; do
    playbook_name="$(basename "$playbook_src")"
    if [[ "$playbook_name" == "skill-quality-testing.md" ]]; then
      continue
    fi
    cp "$playbook_src" ".goat-flow/skill-docs/playbooks/${playbook_name}"
  done
  echo "  ✓ .goat-flow/skill-docs/playbooks/"
fi
if [[ -d ".goat-flow/skill-docs/skill-quality-testing" ]]; then
  cp workflow/skills/playbooks/skill-quality-testing.md .goat-flow/skill-docs/skill-quality-testing/README.md
  cp workflow/skills/playbooks/skill-quality-testing/*.md .goat-flow/skill-docs/skill-quality-testing/
  echo "  ✓ .goat-flow/skill-docs/skill-quality-testing/"
fi

echo ""
echo "Done. Verify with: npm run check-versions && npm run check-instruction-parity"
