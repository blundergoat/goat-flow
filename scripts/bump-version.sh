#!/usr/bin/env bash
# bump-version.sh - move every goat-flow version stamp to the next release in one pass.
#
# Add the "## vX.Y.Z - YYYY-MM-DD" heading to CHANGELOG.md first when the release date is known.
# Instruction-file headers take their release date from that heading, or today's date when it is missing.
#
# The script replaces the old version in canonical sources, then refreshes the runtime mirrors this checkout already has.
# It does not create workflow/manifest-snapshots/vX.Y.Z.json, which npm test requires once CHANGELOG.md has the release heading.
#
# Usage:
#   bash scripts/bump-version.sh <patch|minor|major>
#   bash scripts/bump-version.sh 1.3.0          # explicit version
#
# Updated files:
#   - package.json + package-lock.json (via npm version --no-git-tag-version)
#   - Instruction file header versions and release dates (CLAUDE.md, AGENTS.md, .github/copilot-instructions.md)
#   - .goat-flow/config.yaml, workflow/manifest.json and the docs/audit-and-quality.md sample output
#   - Canonical skills, shared references, playbooks and per-skill reference packs under workflow/skills/, plus test fixture copies
#   - Hook runtimes: every top-level workflow/hooks/*.sh and *.mjs, plus each nested module carrying a goat-flow-hook-version stamp
#   - Runtime mirrors: .claude/skills/, .agents/skills/, .github/skills/, .goat-flow/hooks/ and .goat-flow/skill-docs/
#
# Exit:
#   0 on success, non-zero on validation failure.
set -euo pipefail

# A missing version argument, or more than one, stops the script before any file changes.
if [[ $# -ne 1 ]]; then
  echo "Usage: bash scripts/bump-version.sh <patch|minor|major|X.Y.Z>"
  exit 1
fi

# Every path below is repository-relative, so the maintainer can run the script from any directory.
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

OLD_VERSION=$(node -p "require('./package.json').version")

# A bump keyword lets npm work out the next version; anything else must be an exact X.Y.Z.
case "$1" in
  patch|minor|major)
    npm version "$1" --no-git-tag-version >/dev/null
    NEW_VERSION=$(node -p "require('./package.json').version")
    ;;
  *)
    # Input such as "v1.18.0" or "1.18" is rejected here, before package.json changes.
    if [[ ! "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      echo "Error: '$1' is not a valid semver (X.Y.Z) or bump type (patch|minor|major)"
      exit 1
    fi
    NEW_VERSION="$1"
    npm version "$NEW_VERSION" --no-git-tag-version >/dev/null
    ;;
esac

echo "Bumping ${OLD_VERSION} → ${NEW_VERSION}"

# sed and grep -E read "." as any character, so the search patterns escape it; the sed replacement text needs no escaping.
old_version_pattern=$(printf '%s' "$OLD_VERSION" | sed 's/\./\\./g')
new_version_replacement="$NEW_VERSION"
new_version_pattern=$(printf '%s' "$NEW_VERSION" | sed 's/\./\\./g')

# A prepared "## vX.Y.Z - YYYY-MM-DD" CHANGELOG heading fixes the release date; `|| true` lets an unprepared release continue.
release_heading=$(grep -E "^## v${new_version_pattern} - [0-9]{4}-[0-9]{2}-[0-9]{2}$" CHANGELOG.md | head -n 1 || true)
# Without that heading the headers get today's date, which needs correcting if the release ships on another day.
if [[ -n "$release_heading" ]]; then
  RELEASE_DATE="${release_heading##* - }"
else
  RELEASE_DATE=$(date +"%Y-%m-%d")
fi

# Replace every occurrence of the old version in one file and print a result line, so the maintainer can scan what changed.
# $1 is a repository-relative path; a missing file prints a WARN line and the bump carries on.
replace_version_in_file() {
  local file="$1"
  # A file this checkout lacks only warns, so one missing surface does not abort the whole release.
  if [[ ! -f "$file" ]]; then
    echo "  WARN: $file not found, skipping"
    return
  fi
  # A file that never mentions the old version is left untouched and listed as skipped.
  if grep -q "$OLD_VERSION" "$file"; then
    sed -i "s/${old_version_pattern}/${new_version_replacement}/g" "$file"
    echo "  ✓ $file"
  else
    echo "  - $file (no match, skipped)"
  fi
}

# Rewrite the "# Title - vX.Y.Z (YYYY-MM-DD)" first line of one instruction file to the new version and release date.
# $1 is a repository-relative path; a missing file prints a WARN line and the bump carries on.
update_instruction_header() {
  local file="$1"
  local first_line
  # A missing instruction file only warns, like any other surface this checkout lacks.
  if [[ ! -f "$file" ]]; then
    echo "  WARN: $file not found, skipping"
    return
  fi
  first_line=$(sed -n '1p' "$file")
  # Any other header shape, such as one already hand-edited to the new version, stops the script instead of guessing a date.
  # package.json and any header rewritten before this one already hold the new version at that point.
  if [[ ! "$first_line" =~ ^#\ .+\ -\ v[0-9]+\.[0-9]+\.[0-9]+\ \([0-9]{4}-[0-9]{2}-[0-9]{2}\)$ ]] ||
    [[ "$first_line" != *" - v${OLD_VERSION} ("* ]]; then
    echo "Error: $file has an unexpected version/date header: $first_line" >&2
    exit 1
  fi
  sed -E -i "1s/- v${old_version_pattern} \\([0-9]{4}-[0-9]{2}-[0-9]{2}\\)$/- v${new_version_replacement} (${RELEASE_DATE})/" "$file"
  echo "  ✓ $file"
}

# ── Source files (version string replacement) ──────────────────────────

# Instruction file headers
for ifile in CLAUDE.md AGENTS.md .github/copilot-instructions.md; do
  update_instruction_header "$ifile"
done

# Config version field
replace_version_in_file ".goat-flow/config.yaml"

# Workflow manifest
replace_version_in_file "workflow/manifest.json"

# Canonical skill entry points and the fixture skill that carries the same stamp
for skill_md in workflow/skills/*/SKILL.md; do
  replace_version_in_file "$skill_md"
done
replace_version_in_file "test/fixtures/skill-with-references/SKILL.md"

# Shared references, playbooks and per-skill reference packs, plus their test fixture copies
while IFS= read -r -d '' reference_md; do
  replace_version_in_file "$reference_md"
done < <(find workflow/skills/reference -type f -name '*.md' -print0)
while IFS= read -r -d '' reference_md; do
  replace_version_in_file "$reference_md"
done < <(find workflow/skills/playbooks -type f -name '*.md' -print0)
while IFS= read -r -d '' reference_md; do
  replace_version_in_file "$reference_md"
done < <(find workflow/skills -path '*/references/*.md' -print0)
if [[ -d test/fixtures ]]; then
  while IFS= read -r -d '' reference_md; do
    replace_version_in_file "$reference_md"
  done < <(find test/fixtures -path '*/references/*.md' -print0)
fi

# Hook templates use one stamp across shell detectors, the launcher, and adapter runtimes.
for hook_runtime in workflow/hooks/*.sh workflow/hooks/*.mjs; do
  # Generated modules take their complete bytes and stamp from src/hooks below.
  if grep -q '^// Generated by scripts/generate-hook-runtime.mjs' "$hook_runtime"; then
    continue
  fi
  replace_version_in_file "$hook_runtime"
done
# Nested modules such as deny-dangerous/guard-runtime.sh carry the same stamp, and the audit fails when it lags the release.
while IFS= read -r -d '' nested_hook_runtime; do
  # Unstamped pattern files and vendored libraries keep their bytes; only stamped modules move with the release.
  if grep -q '^// Generated by scripts/generate-hook-runtime.mjs' "$nested_hook_runtime"; then
    continue
  fi
  if grep -q 'goat-flow-hook-version:' "$nested_hook_runtime"; then
    replace_version_in_file "$nested_hook_runtime"
  fi
done < <(find workflow/hooks -mindepth 2 -type f -print0)

# Compile native modules once package.json owns the new release stamp.
node scripts/generate-hook-runtime.mjs --write

# Docs
replace_version_in_file "docs/audit-and-quality.md"

# ── Installed mirrors (copy from workflow templates) ───────────────────

echo ""
echo "Syncing installed mirrors..."

MANIFEST_PATH="workflow/manifest.json"

# Print each agent's installed skill folder from the manifest, such as .claude/skills, once even when agents share one.
manifest_skill_roots() {
  node - "$MANIFEST_PATH" <<'NODE'
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const roots = [
  ...new Set(
    Object.values(manifest.agents || {})
      .map((agent) => (typeof agent.skills_dir === "string" ? agent.skills_dir.replace(/\/$/, "") : ""))
      .filter(Boolean),
  ),
];
for (const skillRoot of roots) console.log(skillRoot);
NODE
}

# Print the canonical skill names the manifest ships, one per line; each names a folder under workflow/skills/.
manifest_skill_names() {
  node - "$MANIFEST_PATH" <<'NODE'
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
for (const skillName of manifest.skills?.canonical || []) console.log(skillName);
NODE
}

# Print SKILL.md plus the manifest-listed reference files for one skill, relative to its folder.
# $1 is the skill name; a skill with no listed references prints only SKILL.md.
manifest_skill_files() {
  local skill_name="$1"
  node - "$MANIFEST_PATH" "$skill_name" <<'NODE'
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const skillName = process.argv[3];
const references = manifest.skills?.references || {};
// A skill without a references list still syncs its SKILL.md.
const files = Array.isArray(references[skillName])
  ? references[skillName].filter((value) => typeof value === "string")
  : [];
console.log("SKILL.md");
for (const file of files) console.log(file);
NODE
}

# Print one "<installed path><TAB><canonical source>" line for each hook runtime whose mirror the release must refresh.
# That is every top-level runtime, including Node support modules, plus nested modules that carry the version stamp.
manifest_hook_runtime_paths() {
  node - "$MANIFEST_PATH" <<'NODE'
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const managedHookRuntimeSources = new Map();
// Each manifest-owned runtime has one canonical workflow/hooks source.
for (const [installedPath, ownershipRecord] of Object.entries(manifest.file_ownership || {})) {
  // Ownership also lists installed config and docs such as .goat-flow/config.yaml; only hook files belong to this pass.
  if (!installedPath.startsWith(".goat-flow/hooks/")) continue;
  // A missing or non-hook source cannot identify bytes safe to copy into the user's mirror.
  if (typeof ownershipRecord?.source !== "string" || !ownershipRecord.source.startsWith("workflow/hooks/")) continue;
  // Setup syncs unstamped nested modules; a stamped one must move with the release or the audit reports a stale version.
  if (!/^\.goat-flow\/hooks\/[^/]+$/u.test(installedPath)) {
    // A row whose source file is gone is skipped; reading it would crash Node and cut this list short without stopping the script.
    if (!fs.existsSync(ownershipRecord.source)) continue;
    if (!fs.readFileSync(ownershipRecord.source, "utf8").includes("goat-flow-hook-version:")) continue;
  }
  managedHookRuntimeSources.set(installedPath, ownershipRecord.source);
}
for (const [installedPath, source] of managedHookRuntimeSources) console.log(installedPath + "\t" + source);
NODE
}

# Sync skill SKILL.md files and manifest-backed references to each installed mirror
while IFS= read -r skill_root; do
  # An agent this checkout has not installed has no skill folder to refresh.
  if [[ ! -d "$skill_root" ]]; then continue; fi
  while IFS= read -r skill_name; do
    while IFS= read -r relative_file; do
      src="workflow/skills/${skill_name}/${relative_file}"
      dst="${skill_root}/${skill_name}/${relative_file}"
      # Only files already in the mirror are refreshed; the bump never adds a new reference file to a mirror.
      if [[ -f "$src" ]] && [[ -f "$dst" ]]; then
        mkdir -p "$(dirname "$dst")"
        cp "$src" "$dst"
      fi
    done < <(manifest_skill_files "$skill_name")
  done < <(manifest_skill_names)
  echo "  ✓ ${skill_root}/*/{SKILL.md,references/}"
done < <(manifest_skill_roots)

# Sync hook templates to each installed hook mirror
while IFS=$'\t' read -r hook_dst hook_src; do
  # A mirror folder this checkout lacks is left alone; inside an existing one, a missing runtime file is created.
  if [[ -f "$hook_src" && -d "$(dirname "$hook_dst")" ]]; then
    cp "$hook_src" "$hook_dst"
    echo "  ✓ ${hook_dst}"
  fi
done < <(manifest_hook_runtime_paths)

# Sync shared reference docs when this checkout has the skill-docs mirror; the bump never creates a new install.
if [[ -d ".goat-flow/skill-docs" ]]; then
  cp -r workflow/skills/reference/* .goat-flow/skill-docs/
  echo "  ✓ .goat-flow/skill-docs/"
fi
# Sync standalone playbooks when the playbooks mirror exists.
if [[ -d ".goat-flow/skill-docs/playbooks" ]]; then
  # The skill-quality-testing pack installs to its own folder, so remove any copy left under playbooks/.
  rm -f .goat-flow/skill-docs/playbooks/skill-quality-testing.md
  rm -rf .goat-flow/skill-docs/playbooks/skill-quality-testing
  for playbook_src in workflow/skills/playbooks/*.md; do
    playbook_name="$(basename "$playbook_src")"
    # The pack's entry page is installed below as skill-quality-testing/README.md, not as a playbook.
    if [[ "$playbook_name" == "skill-quality-testing.md" ]]; then
      continue
    fi
    cp "$playbook_src" ".goat-flow/skill-docs/playbooks/${playbook_name}"
  done
  echo "  ✓ .goat-flow/skill-docs/playbooks/"
fi
# The skill-quality-testing pack: its entry page becomes the folder README and its chapters copy alongside.
if [[ -d ".goat-flow/skill-docs/skill-quality-testing" ]]; then
  cp workflow/skills/playbooks/skill-quality-testing.md .goat-flow/skill-docs/skill-quality-testing/README.md
  cp workflow/skills/playbooks/skill-quality-testing/*.md .goat-flow/skill-docs/skill-quality-testing/
  echo "  ✓ .goat-flow/skill-docs/skill-quality-testing/"
fi

echo ""
echo "Done. Verify with: npm run check-versions && npm run check-instruction-parity"
