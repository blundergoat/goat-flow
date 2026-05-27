#!/usr/bin/env bash

# dependency-update.sh
#
# Purpose:
#   Audits outdated dependencies, applies safe updates, and validates the result.
#
# Usage:
#   bash scripts/dependency-update.sh
#
# Behavior:
#   1) prints outdated packages, including transitive dependencies
#   2) runs npm update
#   3) reviews npm overrides for stale upstream pins
#   4) runs npm audit as a blocking verification gate
#   5) validates typecheck and tests when project scripts/files are present
#   6) prints a diff summary for review
#
# Exit:
#   0 on successful audit/update/verification flow, non-zero on any verification failure.
#
# Requirements:
#   - npm, node, git

set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

info() { echo "INFO: $1"; }
warn() { echo "WARN: $1" >&2; }
fail() { echo "ERROR: $1" >&2; exit 1; }

print_outdated() {
    local output

    output="$(npm outdated --all 2>/dev/null || true)"
    if [[ -n "$output" ]]; then
        printf '%s\n' "$output"
    else
        info "All dependencies are current"
    fi
}

review_npm_overrides() {
    local overrides

    overrides="$(
        node --input-type=module <<'NODE'
import { readFileSync } from "node:fs";

function packageNameFromKey(key) {
  if (key.startsWith("@")) {
    const slashIndex = key.indexOf("/");
    if (slashIndex === -1) return key;
    const versionIndex = key.indexOf("@", slashIndex + 1);
    return versionIndex === -1 ? key : key.slice(0, versionIndex);
  }

  const versionIndex = key.indexOf("@");
  return versionIndex === -1 ? key : key.slice(0, versionIndex);
}

function emitOverride(parentKey, value, rows) {
  const parentPackage = packageNameFromKey(parentKey);

  if (typeof value === "string") {
    rows.push(["(root)", parentPackage, parentPackage, value, "global"]);
    return;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) return;

  for (const [childKey, spec] of Object.entries(value)) {
    if (childKey === ".") {
      if (typeof spec === "string") {
        rows.push([parentKey, parentPackage, parentPackage, spec, "self"]);
      }
      continue;
    }

    const childPackage = packageNameFromKey(childKey);
    if (typeof spec === "string") {
      rows.push([parentKey, parentPackage, childPackage, spec, "child"]);
    } else {
      emitOverride(childKey, spec, rows);
    }
  }
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const rows = [];

for (const [key, value] of Object.entries(pkg.overrides ?? {})) {
  emitOverride(key, value, rows);
}

for (const row of rows) {
  console.log(row.join("\t"));
}
NODE
    )"

    if [[ -z "$overrides" ]]; then
        info "No npm overrides configured"
        return
    fi

    info "Reviewing npm overrides..."
    while IFS=$'\t' read -r parent_display parent_package child_package override_spec override_kind; do
        [[ -n "${parent_display:-}" ]] || continue

        if [[ "$override_kind" == "global" ]]; then
            info "  ${child_package} => ${override_spec} (global override)"
            continue
        fi

        info "  ${parent_display} -> ${child_package}@${override_spec}"

        local installed_declared
        installed_declared="$(
            node --input-type=module - "$parent_package" "$child_package" <<'NODE' 2>/dev/null || true
import { readFileSync } from "node:fs";

const [parentPackage, childPackage] = process.argv.slice(2);

try {
  const pkg = JSON.parse(
    readFileSync(`node_modules/${parentPackage}/package.json`, "utf8"),
  );
  const spec =
    pkg.dependencies?.[childPackage] ??
    pkg.optionalDependencies?.[childPackage] ??
    pkg.peerDependencies?.[childPackage] ??
    pkg.devDependencies?.[childPackage] ??
    "";
  if (spec) console.log(spec);
} catch {
  // Missing node_modules entries are reported by the caller.
}
NODE
        )"

        if [[ -z "$installed_declared" ]]; then
            warn "    installed ${parent_package} no longer declares ${child_package}; review removing this override"
        elif [[ "$installed_declared" == "$override_spec" ]]; then
            warn "    override matches installed ${parent_package}'s declared ${child_package}@${installed_declared}; review removing it"
        else
            info "    installed ${parent_package} declares ${child_package}@${installed_declared}; override still changes it"
        fi

        local latest_dependencies
        latest_dependencies="$(npm view "${parent_package}@latest" --json 2>/dev/null || true)"

        local latest_declared
        latest_declared="$(
            CHILD_PACKAGE="$child_package" node --input-type=module --eval '
const childPackage = process.env.CHILD_PACKAGE;

let input = "";
for await (const chunk of process.stdin) input += chunk;

try {
  const pkg = input.trim() ? JSON.parse(input) : {};
  const spec =
    pkg.dependencies?.[childPackage] ??
    pkg.optionalDependencies?.[childPackage] ??
    pkg.peerDependencies?.[childPackage] ??
    pkg.devDependencies?.[childPackage] ??
    "";
  if (spec) console.log(spec);
} catch {
  // Malformed or missing registry data is treated as unavailable.
}
            ' <<< "$latest_dependencies"
        )"

        if [[ -z "$latest_declared" ]]; then
            warn "    latest ${parent_package} no longer declares ${child_package}; update the parent and remove the override if audit stays clean"
        elif [[ "$latest_declared" != "$installed_declared" ]]; then
            info "    latest ${parent_package} declares ${child_package}@${latest_declared}; parent update may make this override obsolete"
        fi
    done <<< "$overrides"
}

info "=== Dependency Update ==="

# 1. Check for outdated packages
if [[ -f package.json ]]; then
    info "Checking for outdated packages..."
    print_outdated
    echo ""

    info "Updating dependencies..."
    npm update

    info "Checking for major version bumps (not auto-updated)..."
    print_outdated

    review_npm_overrides
fi

# 2. Security audit
info "Running security audit..."
npm audit || fail "Security audit found issues after dependency update"

# 3. Verify build still works after update
if [[ -f tsconfig.json ]]; then
    info "Verifying typecheck after update..."
    npx tsc --noEmit || fail "Typecheck failed after dependency update"
fi

# 4. Verify tests pass
if [[ -f package.json ]]; then
    info "Verifying tests after update..."
    npm test || fail "Tests failed after dependency update"
fi

# 5. Show diff for review
echo ""
info "=== Update Complete ==="
if git diff --quiet package-lock.json 2>/dev/null; then
    info "No dependency changes"
else
    info "Changed files:"
    git diff --stat package-lock.json 2>/dev/null || true
    info ""
    info "Review changes, then commit:"
    info "  git add package.json package-lock.json"
    info "  git commit -m 'chore: update dependencies'"
fi
