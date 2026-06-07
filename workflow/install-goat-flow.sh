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
# - Existing config.yaml is preserved but legacy agents allowlists are removed
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

if (mode === "stale-hooks") {
  for (const hook of manifest.hooks?.stale_names || []) {
    console.log(hook);
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
  esac
done <<< "$PROFILE_DATA"

if [[ -z "${SKILLS_DIR:-}" ]]; then
  echo "ERROR: manifest profile for '$AGENT' is incomplete"
  exit 1
fi

HOOKS_ENABLED=false
if [[ -n "${HOOKS_DIR:-}" || -n "${DENY_HOOK_DST:-}" || -n "${HOOK_CONFIG_DST:-}" || -n "${HOOK_CONFIG_SRC:-}" ]]; then
  if [[ -z "${HOOKS_DIR:-}" || -z "${DENY_HOOK_DST:-}" ]]; then
    echo "ERROR: manifest hook profile for '$AGENT' is incomplete"
    exit 1
  fi
  HOOKS_ENABLED=true
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
REMOVED=0

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

prune_unlisted_skill_references() {
  local skill="$1" skill_dst="$2"
  local references_dir="$skill_dst/references"
  [[ -d "$references_dir" ]] || return 0

  readarray -t stale_references < <(
    node - "$skill_dst" "$references_dir" "${@:3}" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const skillDir = process.argv[2];
const referencesDir = process.argv[3];
const expected = new Set(
  process.argv
    .slice(4)
    .filter((file) => file.startsWith("references/"))
    .map((file) => file.replace(/\\/g, "/")),
);

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;

    const relativePath = path
      .relative(skillDir, fullPath)
      .replace(/\\/g, "/");
    if (!expected.has(relativePath)) {
      console.log(relativePath);
    }
  }
}

walk(referencesDir);
NODE
  )

  for stale_reference in "${stale_references[@]}"; do
    [[ -n "$stale_reference" ]] || continue
    case "$stale_reference" in
      *..*|*"//"*)
        echo "ERROR: refusing to prune path with traversal: $stale_reference" >&2
        exit 1
        ;;
      references/*)
        case "$stale_reference" in
          *.md) ;;
          *)
            echo "ERROR: refusing to prune non-markdown reference: $stale_reference" >&2
            exit 1
            ;;
        esac
        ;;
      *)
        echo "ERROR: refusing to prune unexpected path shape: $stale_reference" >&2
        exit 1
        ;;
    esac
    rm -f "$skill_dst/$stale_reference"
    REMOVED=$((REMOVED + 1))
    echo "  ✗ $skill_dst/$stale_reference (removed stale reference)"
  done
}

prune_unlisted_hook_files() {
  local hooks_dir="$1"
  [[ -d "$hooks_dir" ]] || return 0
  readarray -t stale_hooks < <(manifest_eval stale-hooks)
  for stale_hook in "${stale_hooks[@]}"; do
    [[ -n "$stale_hook" ]] || continue
    case "$stale_hook" in
      *..*|*"//"*|*/*)
        echo "ERROR: refusing to prune unexpected hook path: $stale_hook" >&2
        exit 1
        ;;
      guard-common.sh|guard-destructive-shell.sh|guard-secret-paths.sh|guard-repository-writes.sh|guardrails-self-test.sh|deny-dangerous.self-test.sh)
        ;;
      *)
        echo "ERROR: refusing to prune unknown stale hook: $stale_hook" >&2
        exit 1
        ;;
    esac
    if [[ -f "$hooks_dir/$stale_hook" ]]; then
      rm -f "$hooks_dir/$stale_hook"
      REMOVED=$((REMOVED + 1))
      echo "  ✗ $hooks_dir/$stale_hook (removed stale hook)"
    fi
  done
}

move_file_no_overwrite() {
  local src="$1" dst="$2"
  [[ -f "$src" ]] || return 0
  mkdir -p "$(dirname "$dst")"
  if [[ -e "$dst" ]]; then
    SKIPPED=$((SKIPPED + 1))
    echo "  · $src → $dst (target exists, left old file in place)"
    return 0
  fi
  mv "$src" "$dst"
  COPIED=$((COPIED + 1))
  echo "  ✓ $src → $dst"
}

migrate_dir_no_overwrite() {
  local src="$1" dst="$2"
  [[ -d "$src" ]] || return 0
  if [[ ! -e "$dst" ]]; then
    mkdir -p "$(dirname "$dst")"
    mv "$src" "$dst"
    COPIED=$((COPIED + 1))
    echo "  ✓ $src/ → $dst/"
    return 0
  fi

  mkdir -p "$dst"
  local moved=false
  local entry base target
  shopt -s dotglob nullglob
  for entry in "$src"/*; do
    base="$(basename "$entry")"
    target="$dst/$base"
    if [[ -e "$target" ]]; then
      SKIPPED=$((SKIPPED + 1))
      echo "  · $entry → $target (target exists, left old entry in place)"
      continue
    fi
    mv "$entry" "$target"
    moved=true
    COPIED=$((COPIED + 1))
    echo "  ✓ $entry → $target"
  done
  shopt -u dotglob nullglob
  rmdir "$src" 2>/dev/null || true
  if [[ "$moved" == false ]]; then
    echo "  · $src/ (no movable entries)"
  fi
}

prune_legacy_agent_hook_copies() {
  local script
  for legacy_hooks_dir in .claude/hooks .codex/hooks .agents/hooks .github/hooks; do
    [[ -d "$legacy_hooks_dir" ]] || continue
    for script in deny-dangerous.sh gruff-code-quality.sh; do
      if [[ -f "$legacy_hooks_dir/$script" ]]; then
        rm -f "$legacy_hooks_dir/$script"
        REMOVED=$((REMOVED + 1))
        echo "  ✗ $legacy_hooks_dir/$script (removed stale per-agent copy)"
      fi
    done
    prune_unlisted_hook_files "$legacy_hooks_dir"
  done
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

ensure_gitignore_entry() {
  local path="$1"
  local entry="$2"
  node - "$path" "$entry" <<'NODE'
const fs = require("node:fs");

const path = process.argv[2];
const entry = process.argv[3];
const content = fs.existsSync(path) ? fs.readFileSync(path, "utf8") : "";
const eol = content.includes("\r\n") ? "\r\n" : "\n";
const lines = content.split(/\r?\n/u);
const equivalentEntries = new Set([
  entry,
  entry.replace(/\/$/u, ""),
  `/${entry}`,
  `/${entry.replace(/\/$/u, "")}`,
  `**/${entry}`,
  `**/${entry.replace(/\/$/u, "")}`,
]);

if (lines.some((line) => equivalentEntries.has(line.trim()))) {
  console.log("unchanged");
  process.exit(0);
}

let next = content;
if (next.length > 0 && !/\r?\n$/u.test(next)) next += eol;
next += `${entry}${eol}`;
fs.writeFileSync(path, next);
console.log("changed");
NODE
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

remove_config_agents_entry() {
  local path="$1"
  node - "$path" <<'NODE'
const fs = require("node:fs");

const path = process.argv[2];
const content = fs.readFileSync(path, "utf8");
const eol = content.includes("\r\n") ? "\r\n" : "\n";
const hadFinalNewline = /\r?\n$/u.test(content);

function indentOf(line) {
  return line.match(/^\s*/u)?.[0] ?? "";
}

let lines = content.split(/\r?\n/u);
if (hadFinalNewline) lines = lines.slice(0, -1);

const agentKeyRe = /^agents\s*:\s*(.*?)(\s*#.*)?$/u;
const index = lines.findIndex((line) => agentKeyRe.test(line));

if (index === -1) {
  console.log("unchanged");
  process.exit(0);
}

let removeUntil = index + 1;
while (removeUntil < lines.length) {
  const line = lines[removeUntil];
  const trimmed = line.trim();
  if (trimmed !== "") {
    const currentIndentLength = indentOf(line).length;
    if (currentIndentLength === 0) break;
  }
  removeUntil += 1;
}

lines.splice(index, removeUntil - index);
while (lines.length > 1 && lines[index] === "" && lines[index - 1] === "") {
  lines.splice(index, 1);
}
fs.writeFileSync(path, `${lines.join(eol)}${hadFinalNewline ? eol : ""}`);
console.log("changed");
NODE
}

migrate_config_tasks_entry() {
  local path="$1"
  node - "$path" <<'NODE'
const fs = require("node:fs");

const path = process.argv[2];
const content = fs.readFileSync(path, "utf8");
const eol = content.includes("\r\n") ? "\r\n" : "\n";
const hadFinalNewline = /\r?\n$/u.test(content);

function indentOf(line) {
  return line.match(/^\s*/u)?.[0] ?? "";
}

function topLevelBlockRange(lines, key) {
  const keyRe = new RegExp(`^${key}\\s*:\\s*(?:#.*)?$`, "u");
  const index = lines.findIndex((line) => keyRe.test(line));
  if (index === -1) return null;
  let end = index + 1;
  while (end < lines.length) {
    const line = lines[end];
    const trimmed = line.trim();
    if (trimmed !== "" && indentOf(line).length === 0) break;
    end += 1;
  }
  return { index, end };
}

let lines = content.split(/\r?\n/u);
if (hadFinalNewline) lines = lines.slice(0, -1);

const tasksRange = topLevelBlockRange(lines, "tasks");
if (!tasksRange) {
  console.log("unchanged");
  process.exit(0);
}

const plansRange = topLevelBlockRange(lines, "plans");
if (plansRange) {
  lines.splice(tasksRange.index, tasksRange.end - tasksRange.index);
} else {
  lines[tasksRange.index] = lines[tasksRange.index].replace(/^tasks/u, "plans");
  for (let i = tasksRange.index + 1; i < tasksRange.end; i += 1) {
    lines[i] = lines[i].replace(/\.goat-flow\/tasks\//gu, ".goat-flow/plans/");
    lines[i] = lines[i].replace(/\.goat-flow\/tasks\b/gu, ".goat-flow/plans");
  }
}

fs.writeFileSync(path, `${lines.join(eol)}${hadFinalNewline ? eol : ""}`);
console.log("changed");
NODE
}

ensure_config_hooks_entry() {
  local path="$1"
  node - "$path" <<'NODE'
const fs = require("node:fs");

const path = process.argv[2];
const content = fs.readFileSync(path, "utf8");
const eol = content.includes("\r\n") ? "\r\n" : "\n";
const hadFinalNewline = /\r?\n$/u.test(content);
let lines = content.split(/\r?\n/u);
if (hadFinalNewline) lines.pop();
const staleHookRe = /^  guard-(destructive-shell|secret-paths|repository-writes):\s*$/u;
let changed = false;
let legacyEnabled = "true";

let hooksIndex = lines.findIndex((line) => /^hooks\s*:/u.test(line));
if (hooksIndex !== -1) {
  const next = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (i > hooksIndex && staleHookRe.test(lines[i])) {
      changed = true;
      i += 1;
      while (i < lines.length && /^    /.test(lines[i])) {
        const match = lines[i].match(/^    enabled:\s*(true|false)\s*$/u);
        if (match && match[1] === "false") legacyEnabled = "false";
        i += 1;
      }
      i -= 1;
      continue;
    }
    next.push(lines[i]);
  }
  lines = next;
  hooksIndex = lines.findIndex((line) => /^hooks\s*:/u.test(line));
  const hasDenyDangerous = lines.some((line) =>
    /^  deny-dangerous:\s*$/u.test(line),
  );
  if (!hasDenyDangerous) {
    let insertAt = hooksIndex + 1;
    while (insertAt < lines.length && /^  [A-Za-z0-9_-]+:\s*$/u.test(lines[insertAt])) {
      insertAt += 1;
      while (insertAt < lines.length && /^    /.test(lines[insertAt])) insertAt += 1;
    }
    lines.splice(insertAt, 0, "  deny-dangerous:", `    enabled: ${legacyEnabled}`);
    changed = true;
  }
  if (changed) {
    fs.writeFileSync(path, `${lines.join(eol)}${hadFinalNewline ? eol : ""}`);
    console.log("changed");
  } else {
    console.log("unchanged");
  }
  process.exit(0);
}

let next = content;
if (next.length > 0 && !/\r?\n$/u.test(next)) next += eol;
next += [
  "",
  "# Hook toggles for goat-flow-shipped hooks.",
  "hooks:",
  "  deny-dangerous:",
  "    enabled: true",
  "  gruff-code-quality:",
  "    enabled: false",
  "",
].join(eol);
fs.writeFileSync(path, next);
console.log("changed");
NODE
}

migrate_agent_hook_config() {
  local dst="$1"
  local src="$2"
  [[ -n "$dst" && -n "$src" && -f "$dst" && -f "$GOAT_FLOW_ROOT/$src" ]] || return 0
  node - "$dst" "$GOAT_FLOW_ROOT/$src" "$AGENT" <<'NODE'
const fs = require("node:fs");

const [dst, src, agent] = process.argv.slice(2);
const managedScripts = [
  "deny-dangerous.sh",
  "gruff-code-quality.sh",
  "deny-dangerous.self-test.sh",
  "guard-common.sh",
  "guard-destructive-shell.sh",
  "guard-secret-paths.sh",
  "guard-repository-writes.sh",
  "guardrails-self-test.sh",
];
const managedHookIds = [
  "deny-dangerous",
  "gruff-code-quality",
  "guard-destructive-shell",
  "guard-secret-paths",
  "guard-repository-writes",
];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readJson(path) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path, "utf8"));
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function entryReferencesManagedHook(value) {
  return managedScripts.some((script) => JSON.stringify(value).includes(script));
}

function removeManagedHookEntries(currentHooks) {
  let changed = false;
  for (const [event, entries] of Object.entries(currentHooks)) {
    if (!Array.isArray(entries)) continue;
    const filtered = entries.filter((entry) => !entryReferencesManagedHook(entry));
    if (filtered.length === 0) {
      delete currentHooks[event];
      changed = true;
    } else if (JSON.stringify(entries) !== JSON.stringify(filtered)) {
      currentHooks[event] = filtered;
      changed = true;
    }
  }
  return changed;
}

function appendTemplateEventEntries(currentHooks, templateHooks) {
  let changed = false;
  for (const [event, templateEntries] of Object.entries(templateHooks)) {
    if (!Array.isArray(templateEntries)) continue;
    const currentEntries = Array.isArray(currentHooks[event])
      ? currentHooks[event]
      : [];
    const filtered = currentEntries.filter(
      (entry) => !entryReferencesManagedHook(entry),
    );
    const nextEntries = [...filtered, ...templateEntries];
    if (JSON.stringify(currentEntries) !== JSON.stringify(nextEntries)) {
      currentHooks[event] = nextEntries;
      changed = true;
    }
  }
  return changed;
}

function configuredHookEnabled(hookId) {
  let content = "";
  try {
    content = fs.readFileSync(".goat-flow/config.yaml", "utf8");
  } catch {
    return false;
  }
  let inHooks = false;
  let currentHook = "";
  for (const line of content.split(/\r?\n/u)) {
    if (/^\S/u.test(line) && !/^hooks\s*:/u.test(line)) {
      inHooks = false;
      currentHook = "";
    }
    if (/^hooks\s*:/u.test(line)) {
      inHooks = true;
      continue;
    }
    if (!inHooks) continue;
    const hookMatch = line.match(/^  ([A-Za-z0-9_-]+):\s*$/u);
    if (hookMatch) {
      currentHook = hookMatch[1];
      continue;
    }
    if (currentHook === hookId || (hookId === "gruff-code-quality" && currentHook === "gruff-on-change")) {
      const enabledMatch = line.match(/^    enabled:\s*(true|false)\s*$/u);
      if (enabledMatch) return enabledMatch[1] === "true";
    }
  }
  return false;
}

function rootResolvingCommand(script) {
  const unavailable =
    agent === "antigravity"
      ? "{ printf '\\''{\"decision\":\"deny\",\"reason\":\"Policy hook unavailable: git repository root unavailable.\"}\\n'\\''; exit 0; }"
      : "{ printf '\\''BLOCKED: Policy hook unavailable: git repository root unavailable.\\n'\\'' >&2; exit 2; }";
  return `bash -c 'gcd="$(git rev-parse --git-common-dir 2>/dev/null)"; root=""; case "$gcd" in */.git/modules/*|.git/modules/*) root="$(git rev-parse --show-toplevel 2>/dev/null || true)" ;; /*|[A-Za-z]:/*|[A-Za-z]:\\\\*) gcd="\${gcd//\\\\//}"; root="$(dirname "$gcd")" ;; *) root="$(git rev-parse --show-toplevel 2>/dev/null || true)" ;; esac; [ -f "$root/.goat-flow/hooks/${script}" ] || root="\${CLAUDE_PROJECT_DIR:-}"; [ -f "$root/.goat-flow/hooks/${script}" ] || ${unavailable}; cd "$root" || ${unavailable}; bash "$root/.goat-flow/hooks/${script}"'`;
}

function gruffHookEntries() {
  const script = "gruff-code-quality.sh";
  if (agent === "codex") {
    return ["Edit", "Write"].map((matcher) => ({
      matcher,
      hooks: [
        {
          type: "command",
          command: ".goat-flow/hooks/gruff-code-quality.sh",
          statusMessage: "gruff code quality",
        },
      ],
    }));
  }
  if (agent === "copilot") {
    const path = ".goat-flow/hooks/gruff-code-quality.sh";
    return [
      {
        type: "command",
        bash: path,
        powershell: `if (Get-Command bash -ErrorAction SilentlyContinue) { bash ${path} } else { Write-Output '{"permissionDecision":"deny","permissionDecisionReason":"Bash, Git Bash, or WSL is required to run ${path} on Windows."}' }`,
        timeoutSec: 30,
      },
    ];
  }
  return ["Edit", "Write"].map((matcher) => ({
    matcher,
    hooks: [{ type: "command", command: rootResolvingCommand(script) }],
  }));
}

function appendGruffHookEntries(currentHooks) {
  if (!configuredHookEnabled("gruff-code-quality")) return false;
  const event = agent === "copilot" ? "postToolUse" : "PostToolUse";
  const currentEntries = Array.isArray(currentHooks[event]) ? currentHooks[event] : [];
  const nextEntries = [...currentEntries, ...gruffHookEntries()];
  if (JSON.stringify(currentEntries) === JSON.stringify(nextEntries)) return false;
  currentHooks[event] = nextEntries;
  return true;
}

function gruffAntigravityDefinition() {
  return {
    enabled: true,
    PostToolUse: [
      {
        matcher: "write_to_file|replace_file_content|multi_replace_file_content",
        hooks: [
          {
            type: "command",
            command: rootResolvingCommand("gruff-code-quality.sh"),
            timeout: 30,
          },
        ],
      },
    ],
  };
}

const current = readJson(dst);
const template = readJson(src);
if (!current || !template) {
  console.log("unchanged");
  process.exit(0);
}

let changed = false;
if (agent === "antigravity") {
  for (const hookId of managedHookIds) {
    if (
      hookId !== "deny-dangerous" &&
      Object.prototype.hasOwnProperty.call(current, hookId)
    ) {
      delete current[hookId];
      changed = true;
    }
  }
  if (isObject(template["deny-dangerous"])) {
    if (
      JSON.stringify(current["deny-dangerous"]) !==
      JSON.stringify(template["deny-dangerous"])
    ) {
      current["deny-dangerous"] = template["deny-dangerous"];
      changed = true;
    }
  }
  if (configuredHookEnabled("gruff-code-quality")) {
    const gruff = gruffAntigravityDefinition();
    if (JSON.stringify(current["gruff-code-quality"]) !== JSON.stringify(gruff)) {
      current["gruff-code-quality"] = gruff;
      changed = true;
    }
  }
} else if (isObject(template.hooks)) {
  if (!isObject(current.hooks)) {
    current.hooks = {};
    changed = true;
  }
  changed = removeManagedHookEntries(current.hooks) || changed;
  changed = appendTemplateEventEntries(current.hooks, template.hooks) || changed;
  changed = appendGruffHookEntries(current.hooks) || changed;
}

if (changed) {
  fs.writeFileSync(dst, `${JSON.stringify(current, null, 2)}\n`);
  console.log("changed");
} else {
  console.log("unchanged");
}
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

migrate_codex_filesystem_permissions() {
  local path="$1"
  node - "$path" <<'NODE'
const fs = require("node:fs");

const path = process.argv[2];
const content = fs.readFileSync(path, "utf8");
const eol = content.includes("\r\n") ? "\r\n" : "\n";
const hadFinalNewline = /\r?\n$/u.test(content);
const lines = content.split(/\r?\n/u);
if (hadFinalNewline) lines.pop();

const anySectionPattern = /^\s*\[[^\]]+\]\s*$/u;
const tomlStringPattern = String.raw`(?:"((?:\\.|[^"\\])*)"|'([^']*)')`;
const noneEntryPattern = new RegExp(
  String.raw`^\s*${tomlStringPattern}\s*=\s*(?:"none"|'none')\s*(?:#.*)?$`,
  "u",
);
const inlineTablePattern = /^\s*"[^"]+"\s*=\s*\{([^}]*)\}\s*(?:#.*)?$/u;
const inlineEntryPattern = new RegExp(
  String.raw`${tomlStringPattern}\s*=\s*(?:"none"|'none')`,
  "gu",
);
const filesystemAccessEntryPattern = new RegExp(
  String.raw`${tomlStringPattern}\s*=\s*(?:"(none|deny)"|'(none|deny)')`,
  "gu",
);
const legacyAccessPattern = new RegExp(
  String.raw`^\s*${tomlStringPattern}\s*=\s*(?:"none"|'none')\s*(?:#.*)?$`,
  "u",
);
const legacyInlineAccessPattern = new RegExp(
  String.raw`${tomlStringPattern}\s*=\s*(?:"none"|'none')`,
  "u",
);
const legacyProjectRootsPattern = /":project_roots"/u;

function parseTomlBasicString(value) {
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return value.replace(/\\"/gu, '"').replace(/\\\\/gu, "\\");
  }
}

function tomlKeyFromMatch(match) {
  return match[1] ?? match[2] ?? "";
}

function tomlModeFromMatch(match) {
  return match[3] ?? match[4] ?? "";
}

function readActivePermissionProfile(configLines) {
  for (const line of configLines) {
    const basicMatch = line.match(
      /^\s*default_permissions\s*=\s*"((?:\\.|[^"\\])*)"\s*(?:#.*)?$/u,
    );
    if (basicMatch) {
      const profile = parseTomlBasicString(basicMatch[1]).trim();
      if (profile) return profile;
    }
    const literalMatch = line.match(
      /^\s*default_permissions\s*=\s*'([^']+)'\s*(?:#.*)?$/u,
    );
    if (literalMatch && literalMatch[1].trim()) return literalMatch[1].trim();
  }
  return "goat-flow";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

const activeProfile = readActivePermissionProfile(lines);
const hasDefaultPermissions = lines.some((line) =>
  /^\s*default_permissions\s*=/u.test(line),
);
const profileSectionPattern = new RegExp(
  `^\\s*\\[\\s*permissions\\.${escapeRegExp(activeProfile)}\\s*\\]\\s*$`,
  "u",
);
const filesystemSectionPattern = new RegExp(
  `^\\s*\\[\\s*permissions\\.${escapeRegExp(activeProfile)}\\.filesystem(?:\\..+)?\\s*\\]\\s*$`,
  "u",
);

// Single source of truth: a "none" key is only invalid if it contains a glob
// metacharacter AND is not a trailing-/** subtree. Codex accepts exact paths
// and trailing /** subtrees but rejects other glob shapes. Must match the
// validator's isInvalidNoneKey in validate_codex_settings_after_install.
function isInvalidNoneKey(key) {
  if (!key.includes("*")) return false;
  return !key.endsWith("/**");
}

const canonicalDenyPatterns = new Set([
  "**/.env*",
  "**/secrets/**",
  "**/.ssh/**",
  "**/.aws/**",
  "**/.docker/**",
  "**/.gnupg/**",
  "**/.kube/**",
  "**/credentials*",
  "**/.npmrc",
  "**/.pypirc",
  "**/*.pem",
  "**/*.key",
  "**/*.pfx",
]);
const oldGeneratedPatterns = new Set([
  ".",
  "secrets/**",
  ".ssh/**",
  ".aws/**",
  ".docker/**",
  ".gnupg/**",
  ".kube/**",
  "**/.env",
  "**/.env.local",
  "**/.env.development",
  "**/.env.production",
  "**/.env.staging",
  "**/.env.test",
  "**/.envrc",
  "**/credentials",
]);

function escapeTomlString(value) {
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
}

const regions = [];
const profileRegions = [];
let i = 0;
while (i < lines.length) {
  if (profileSectionPattern.test(lines[i])) {
    const start = i;
    i += 1;
    while (i < lines.length && !anySectionPattern.test(lines[i])) i += 1;
    profileRegions.push({ start, end: i });
  } else if (filesystemSectionPattern.test(lines[i])) {
    const start = i;
    i += 1;
    while (i < lines.length && !anySectionPattern.test(lines[i])) i += 1;
    regions.push({ start, end: i });
  } else {
    i += 1;
  }
}

if (
  regions.length === 0 &&
  profileRegions.length === 0 &&
  !hasDefaultPermissions
) {
  console.log("unchanged");
  process.exit(0);
}

let hasInvalidEntry = false;
let usesLegacyAccess = false;
let usesLegacyAnchor = false;
let profileExtendsWorkspace = false;
const additionalDenyPatterns = new Set();
const activeDenyPatterns = new Set();
for (const region of profileRegions) {
  for (let j = region.start; j < region.end; j += 1) {
    if (/^\s*extends\s*=\s*":workspace"\s*(?:#.*)?$/u.test(lines[j])) {
      profileExtendsWorkspace = true;
    }
  }
}
for (const region of regions) {
  for (let j = region.start; j < region.end; j += 1) {
    const line = lines[j];
    if (legacyProjectRootsPattern.test(line)) usesLegacyAnchor = true;
    if (legacyAccessPattern.test(line) || legacyInlineAccessPattern.test(line)) {
      usesLegacyAccess = true;
    }
    for (const entry of line.matchAll(filesystemAccessEntryPattern)) {
      const pattern = tomlKeyFromMatch(entry);
      const mode = tomlModeFromMatch(entry);
      if ((mode === "none" || mode === "deny") && pattern) {
        activeDenyPatterns.add(pattern);
      }
      if (
        (mode === "none" || mode === "deny") &&
        pattern &&
        !canonicalDenyPatterns.has(pattern) &&
        !oldGeneratedPatterns.has(pattern)
      ) {
        additionalDenyPatterns.add(pattern);
      }
      if (mode === "none" && isInvalidNoneKey(pattern)) {
        hasInvalidEntry = true;
      }
    }
    const noneMatch = line.match(noneEntryPattern);
    if (noneMatch && isInvalidNoneKey(tomlKeyFromMatch(noneMatch))) {
      hasInvalidEntry = true;
    }
    const inlineMatch = line.match(inlineTablePattern);
    if (inlineMatch) {
      for (const entry of inlineMatch[1].matchAll(inlineEntryPattern)) {
        if (isInvalidNoneKey(tomlKeyFromMatch(entry))) hasInvalidEntry = true;
      }
    }
  }
}

const shouldRefreshGoatFlowProfile =
  activeProfile === "goat-flow" &&
  hasDefaultPermissions &&
  !profileExtendsWorkspace;
const missingCanonicalDenyPatterns = [...canonicalDenyPatterns].some(
  (pattern) => !activeDenyPatterns.has(pattern),
);

if (
  !hasInvalidEntry &&
  !usesLegacyAnchor &&
  !usesLegacyAccess &&
  !shouldRefreshGoatFlowProfile &&
  !missingCanonicalDenyPatterns
) {
  console.log("unchanged");
  process.exit(0);
}

const canonicalBlock = [
  `[permissions.${activeProfile}]`,
  'description = "goat-flow workspace editing with secret-path read denies."',
  'extends = ":workspace"',
  "",
  `[permissions.${activeProfile}.filesystem]`,
  "glob_scan_max_depth = 3",
  "",
  `[permissions.${activeProfile}.filesystem.":workspace_roots"]`,
  "# Codex deny rules win over same-profile read rules. Unlike Claude settings,",
  "# Codex cannot re-allow recursive sample env reads behind a broad filename",
  "# deny, so .env.example is intentionally denied here to keep .env* variants",
  "# protected consistently across agents.",
  '"**/.env*" = "deny"',
  '"**/secrets/**" = "deny"',
  '"**/.ssh/**" = "deny"',
  '"**/.aws/**" = "deny"',
  '"**/.docker/**" = "deny"',
  '"**/.gnupg/**" = "deny"',
  '"**/.kube/**" = "deny"',
  '"**/credentials*" = "deny"',
  '"**/.npmrc" = "deny"',
  '"**/.pypirc" = "deny"',
  '"**/*.pem" = "deny"',
  '"**/*.key" = "deny"',
  '"**/*.pfx" = "deny"',
];
for (const pattern of additionalDenyPatterns) {
  canonicalBlock.push(`"${escapeTomlString(pattern)}" = "deny"`);
}

const inRegion = new Array(lines.length).fill(false);
for (const region of regions) {
  for (let j = region.start; j < region.end; j += 1) inRegion[j] = true;
}
for (const region of profileRegions) {
  for (let j = region.start; j < region.end; j += 1) inRegion[j] = true;
}

const firstRegionStart = Math.min(
  ...regions.map((region) => region.start),
  ...profileRegions.map((region) => region.start),
);
const before = lines.slice(0, firstRegionStart);
const after = [];
for (let j = firstRegionStart; j < lines.length; j += 1) {
  if (!inRegion[j]) after.push(lines[j]);
}

while (before.length && before[before.length - 1].trim() === "") before.pop();
let trailingStart = 0;
while (trailingStart < after.length && after[trailingStart].trim() === "")
  trailingStart += 1;

const rebuilt = [...before];
if (rebuilt.length > 0) rebuilt.push("");
rebuilt.push(...canonicalBlock);
if (trailingStart < after.length) {
  rebuilt.push("");
  rebuilt.push(...after.slice(trailingStart));
}

fs.writeFileSync(path, rebuilt.join(eol) + (hadFinalNewline ? eol : ""));
console.log("migrated");
NODE
}

validate_codex_settings_after_install() {
  local path="$1"
  node - "$path" <<'NODE'
const fs = require("node:fs");
const path = process.argv[2];
if (!fs.existsSync(path)) {
  console.log("ok");
  process.exit(0);
}
const content = fs.readFileSync(path, "utf8");
const problems = new Set();

// Single source of truth: must match isInvalidNoneKey in
// migrate_codex_filesystem_permissions. A key is invalid only if it contains a
// glob metacharacter AND is not a trailing-/** subtree.
function isInvalidNoneKey(key) {
  if (!key.includes("*")) return false;
  return !key.endsWith("/**");
}

const anySectionPattern = /^\s*\[[^\]]+\]\s*$/u;
const sectionEntryPattern = /^\s*"([^"]+)"\s*=\s*"none"\s*(?:#.*)?$/u;
const inlineTablePattern = /^\s*"[^"]+"\s*=\s*\{([^}]*)\}\s*(?:#.*)?$/u;
const inlineEntryPattern = /"([^"]+)"\s*=\s*"none"/gu;
const legacyAccessPattern = /^\s*"[^"]+"\s*=\s*"none"\s*(?:#.*)?$/u;
const legacyInlineAccessPattern = /"[^"]+"\s*=\s*"none"/u;
const legacyProjectRootsPattern = /":project_roots"/u;

function parseTomlBasicString(value) {
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return value.replace(/\\"/gu, '"').replace(/\\\\/gu, "\\");
  }
}

function readActivePermissionProfile(configLines) {
  for (const line of configLines) {
    const basicMatch = line.match(
      /^\s*default_permissions\s*=\s*"((?:\\.|[^"\\])*)"\s*(?:#.*)?$/u,
    );
    if (basicMatch) {
      const profile = parseTomlBasicString(basicMatch[1]).trim();
      if (profile) return profile;
    }
    const literalMatch = line.match(
      /^\s*default_permissions\s*=\s*'([^']+)'\s*(?:#.*)?$/u,
    );
    if (literalMatch && literalMatch[1].trim()) return literalMatch[1].trim();
  }
  return "goat-flow";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

const lines = content.split(/\r?\n/u);
const activeProfile = readActivePermissionProfile(lines);
const hasDefaultPermissions = lines.some((line) =>
  /^\s*default_permissions\s*=/u.test(line),
);
const profileSectionPattern = new RegExp(
  `^\\s*\\[\\s*permissions\\.${escapeRegExp(activeProfile)}\\s*\\]\\s*$`,
  "u",
);
const filesystemSectionPattern = new RegExp(
  `^\\s*\\[\\s*permissions\\.${escapeRegExp(activeProfile)}\\.filesystem(?:\\..+)?\\s*\\]\\s*$`,
  "u",
);

// Build filesystem section regions so we only flag entries that actually live
// under the active [permissions.<default_permissions>.filesystem*] profile. A
// bare "*.pem" = "none" in an unrelated table is not a Codex filesystem error.
const regions = [];
const profileRegions = [];
let i = 0;
while (i < lines.length) {
  if (profileSectionPattern.test(lines[i])) {
    const start = i;
    i += 1;
    while (i < lines.length && !anySectionPattern.test(lines[i])) i += 1;
    profileRegions.push({ start, end: i });
  } else if (filesystemSectionPattern.test(lines[i])) {
    const start = i;
    i += 1;
    while (i < lines.length && !anySectionPattern.test(lines[i])) i += 1;
    regions.push({ start, end: i });
  } else {
    i += 1;
  }
}

let profileExtendsWorkspace = false;
for (const region of profileRegions) {
  for (let j = region.start; j < region.end; j += 1) {
    if (/^\s*extends\s*=\s*":workspace"\s*(?:#.*)?$/u.test(lines[j])) {
      profileExtendsWorkspace = true;
    }
  }
}
if (
  activeProfile === "goat-flow" &&
  hasDefaultPermissions &&
  !profileExtendsWorkspace
) {
  problems.add('active goat-flow profile does not extend ":workspace"');
}

for (const region of regions) {
  for (let j = region.start; j < region.end; j += 1) {
    const line = lines[j];
    const match = line.match(sectionEntryPattern);
    if (match && isInvalidNoneKey(match[1])) {
      problems.add(`section entry "${match[1]}" with access="none"`);
    }
    if (legacyAccessPattern.test(line) || legacyInlineAccessPattern.test(line)) {
      problems.add('legacy access value "none" still present');
    }
    if (legacyProjectRootsPattern.test(line)) {
      problems.add("legacy :project_roots anchor still present");
    }
    const inlineMatch = line.match(inlineTablePattern);
    if (inlineMatch) {
      for (const entry of inlineMatch[1].matchAll(inlineEntryPattern)) {
        if (isInvalidNoneKey(entry[1])) {
          problems.add(`inline entry "${entry[1]}" with access="none"`);
        }
      }
    }
  }
}

if (problems.size > 0) {
  console.log("invalid:" + [...problems].join("; "));
  process.exit(0);
}
console.log("ok");
NODE
}

echo "goat-flow install: $(basename "$PROJECT") (agent: $AGENT)"
echo ""

cd "$PROJECT"

# ==========================================================================
# 1. Migrate old .goat-flow/ layout without overwriting user content
# ==========================================================================
echo "Migrations:"
migrate_dir_no_overwrite ".goat-flow/footguns" ".goat-flow/learning-loop/footguns"
migrate_dir_no_overwrite ".goat-flow/lessons" ".goat-flow/learning-loop/lessons"
migrate_dir_no_overwrite ".goat-flow/patterns" ".goat-flow/learning-loop/patterns"
migrate_dir_no_overwrite ".goat-flow/decisions" ".goat-flow/learning-loop/decisions"
migrate_dir_no_overwrite ".goat-flow/tasks" ".goat-flow/plans"
migrate_dir_no_overwrite ".goat-flow/hook-lib" ".goat-flow/hooks/deny-dangerous"
migrate_dir_no_overwrite ".goat-flow/skill-reference" ".goat-flow/skill-docs"
move_file_no_overwrite ".goat-flow/skill-playbooks/skill-quality-testing.md" ".goat-flow/skill-docs/skill-quality-testing/README.md"
migrate_dir_no_overwrite ".goat-flow/skill-playbooks/skill-quality-testing" ".goat-flow/skill-docs/skill-quality-testing"
migrate_dir_no_overwrite ".goat-flow/skill-playbooks" ".goat-flow/skill-docs/playbooks"
rmdir .goat-flow/skill-playbooks 2>/dev/null || true
echo ""

# ==========================================================================
# 2. Create .goat-flow/ directories
# ==========================================================================
echo "Directories:"
for dir in .goat-flow/learning-loop/footguns .goat-flow/learning-loop/lessons .goat-flow/learning-loop/patterns .goat-flow/learning-loop/decisions .goat-flow/plans .goat-flow/scratchpad .goat-flow/logs/sessions .goat-flow/logs/quality .goat-flow/logs/events .goat-flow/logs/critiques .goat-flow/logs/review .goat-flow/logs/security .goat-flow/skill-docs .goat-flow/skill-docs/playbooks .goat-flow/skill-docs/skill-quality-testing .goat-flow/hooks .goat-flow/hooks/deny-dangerous; do
  if [[ ! -d "$dir" ]]; then
    mkdir -p "$dir"
    echo "  ✓ $dir/"
  else
    echo "  · $dir/ (exists)"
  fi
done
echo ""

# ==========================================================================
# 3. Copy .gitignore (always overwrite)
# ==========================================================================
echo "Gitignore + READMEs:"
copy_file "$GOAT_FLOW_ROOT/workflow/setup/reference/goat-flow-gitignore" ".goat-flow/.gitignore"
copy_file "$GOAT_FLOW_ROOT/workflow/setup/reference/plans-gitignore" ".goat-flow/plans/.gitignore"
copy_file "$GOAT_FLOW_ROOT/workflow/setup/reference/scratchpad-gitignore" ".goat-flow/scratchpad/.gitignore"
copy_file "$GOAT_FLOW_ROOT/workflow/setup/reference/lessons-readme.md" ".goat-flow/learning-loop/lessons/README.md"
copy_file "$GOAT_FLOW_ROOT/workflow/setup/reference/footguns-readme.md" ".goat-flow/learning-loop/footguns/README.md"
copy_file "$GOAT_FLOW_ROOT/workflow/setup/reference/patterns-readme.md" ".goat-flow/learning-loop/patterns/README.md"
copy_file "$GOAT_FLOW_ROOT/workflow/setup/reference/plans-readme.md" ".goat-flow/plans/README.md"
copy_file "$GOAT_FLOW_ROOT/workflow/setup/reference/scratchpad-readme.md" ".goat-flow/scratchpad/README.md"
copy_file "$GOAT_FLOW_ROOT/workflow/setup/reference/quality-readme.md" ".goat-flow/logs/quality/README.md"
copy_file "$GOAT_FLOW_ROOT/workflow/setup/reference/events-readme.md" ".goat-flow/logs/events/README.md"
copy_file "$GOAT_FLOW_ROOT/workflow/setup/reference/critiques-readme.md" ".goat-flow/logs/critiques/README.md"
copy_file "$GOAT_FLOW_ROOT/workflow/setup/reference/review-readme.md" ".goat-flow/logs/review/README.md"
copy_file "$GOAT_FLOW_ROOT/workflow/setup/reference/security-readme.md" ".goat-flow/logs/security/README.md"
copy_if_missing "$GOAT_FLOW_ROOT/workflow/setup/reference/decisions-readme.md" ".goat-flow/learning-loop/decisions/README.md"
touch_anchor ".goat-flow/logs/sessions/.gitkeep"
echo ""

# ==========================================================================
# 3b. Maintain project root .gitignore (append-only)
# ==========================================================================
echo "Project .gitignore:"
if [[ "$(ensure_gitignore_entry ".gitignore" "node_modules/")" == "changed" ]]; then
  COPIED=$((COPIED + 1))
  echo "  ✓ .gitignore (node_modules/ ignored)"
else
  SKIPPED=$((SKIPPED + 1))
  echo "  · .gitignore (node_modules/ already ignored)"
fi
echo ""

# ==========================================================================
# 4. Sweep transitional skill-doc files from older installed layouts.
#    Current installs keep doctrine at .goat-flow/skill-docs/ and standalone
#    playbooks at .goat-flow/skill-docs/playbooks/.
# ==========================================================================
legacy_reference_files=(
  ".goat-flow/skill-docs/browser-use.md"
  ".goat-flow/skill-docs/page-capture.md"
  ".goat-flow/skill-docs/skill-quality-testing.md"
)
removed_any=false
for legacy_file in "${legacy_reference_files[@]}"; do
  if [[ -f "$legacy_file" ]]; then
    rm -f "$legacy_file"
    echo "  ✓ migrated $legacy_file → .goat-flow/skill-docs/playbooks/"
    removed_any=true
  fi
done
if [[ "$removed_any" == true ]]; then
  echo ""
fi

# ==========================================================================
# 5. Copy shared reference files (always overwrite - verbatim copies)
# ==========================================================================
echo "Meta references → .goat-flow/skill-docs/:"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/reference/README.md" ".goat-flow/skill-docs/README.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/reference/skill-preamble.md" ".goat-flow/skill-docs/skill-preamble.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/reference/skill-conventions.md" ".goat-flow/skill-docs/skill-conventions.md"

echo "Standalone playbooks → .goat-flow/skill-docs/playbooks/:"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/playbooks/README.md" ".goat-flow/skill-docs/playbooks/README.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/playbooks/browser-use.md" ".goat-flow/skill-docs/playbooks/browser-use.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/playbooks/code-comments.md" ".goat-flow/skill-docs/playbooks/code-comments.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/playbooks/gruff-code-quality.md" ".goat-flow/skill-docs/playbooks/gruff-code-quality.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/playbooks/observability.md" ".goat-flow/skill-docs/playbooks/observability.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/playbooks/changelog.md" ".goat-flow/skill-docs/playbooks/changelog.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/playbooks/page-capture.md" ".goat-flow/skill-docs/playbooks/page-capture.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/playbooks/release-notes.md" ".goat-flow/skill-docs/playbooks/release-notes.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/playbooks/skill-quality-testing.md" ".goat-flow/skill-docs/skill-quality-testing/README.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/playbooks/skill-quality-testing/tdd-iteration.md" ".goat-flow/skill-docs/skill-quality-testing/tdd-iteration.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/playbooks/skill-quality-testing/adversarial-framing.md" ".goat-flow/skill-docs/skill-quality-testing/adversarial-framing.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/playbooks/skill-quality-testing/deployment.md" ".goat-flow/skill-docs/skill-quality-testing/deployment.md"
copy_if_missing "$GOAT_FLOW_ROOT/workflow/setup/reference/security-policy.md" ".goat-flow/security-policy.md"
echo ""

# ==========================================================================
# 6. Install skills (always overwrite - verbatim from templates)
# ==========================================================================
echo "Skills → $SKILLS_DIR/:"
for skill in "${SKILL_NAMES[@]}"; do
  skill_dir="$GOAT_FLOW_ROOT/workflow/skills/$skill"
  if [[ ! -d "$skill_dir" ]]; then
    echo "  ✗ $skill (template dir not found: $skill_dir)"
    continue
  fi
  readarray -t skill_files < <(manifest_eval skill-files "$skill")
  prune_unlisted_skill_references "$skill" "$SKILLS_DIR/$skill" "${skill_files[@]}"
  while IFS= read -r relative_file; do
    [[ -n "$relative_file" ]] || continue
    copy_file "$skill_dir/$relative_file" "$SKILLS_DIR/$skill/$relative_file"
  done < <(printf '%s\n' "${skill_files[@]}")
done
echo ""

# ==========================================================================
# 6b. Remove deprecated skills (only with --clean-deprecated or --force)
# ==========================================================================
if $CLEAN_DEPRECATED || $FORCE; then
  readarray -t STALE_NAMES < <(manifest_eval stale-skills)
  if [[ ${#STALE_NAMES[@]} -gt 0 ]]; then
    DEPRECATED_REMOVED=0
    echo "Deprecated skill cleanup:"
    for stale in "${STALE_NAMES[@]}"; do
      [[ -n "$stale" ]] || continue
      stale_path="$SKILLS_DIR/$stale"
      if [[ -d "$stale_path" ]]; then
        rm -rf "$stale_path"
        DEPRECATED_REMOVED=$((DEPRECATED_REMOVED + 1))
        REMOVED=$((REMOVED + 1))
        echo "  ✗ $stale_path (removed)"
      fi
    done
    if [[ $DEPRECATED_REMOVED -eq 0 ]]; then
      echo "  · no deprecated skills found"
    fi
    echo ""
  fi
fi

# ==========================================================================
# 7. Install hooks (always overwrite - verbatim copy)
# ==========================================================================
if $HOOKS_ENABLED; then
  echo "Hooks → $HOOKS_DIR/:"
  copy_file "$GOAT_FLOW_ROOT/workflow/hooks/deny-dangerous.sh" "$HOOKS_DIR/deny-dangerous.sh"
  chmod +x "$HOOKS_DIR/deny-dangerous.sh"
  copy_file "$GOAT_FLOW_ROOT/workflow/hooks/gruff-code-quality.sh" "$HOOKS_DIR/gruff-code-quality.sh"
  chmod +x "$HOOKS_DIR/gruff-code-quality.sh"
  prune_unlisted_hook_files "$HOOKS_DIR"
  prune_legacy_agent_hook_copies
  echo "Hook policy → .goat-flow/hooks/deny-dangerous/:"
  for hook_policy_script in \
    patterns-shell.sh \
    patterns-paths.sh \
    patterns-writes.sh \
    deny-dangerous-self-test.sh
  do
    copy_file "$GOAT_FLOW_ROOT/workflow/hooks/deny-dangerous/$hook_policy_script" ".goat-flow/hooks/deny-dangerous/$hook_policy_script"
    chmod +x ".goat-flow/hooks/deny-dangerous/$hook_policy_script"
  done
  if [[ "$(ensure_gitignore_entry ".goat-flow/.gitignore" "!hooks/")" == "changed" ]]; then
    COPIED=$((COPIED + 1))
    echo "  ✓ .goat-flow/.gitignore (hooks/ un-ignored)"
  fi
  if [[ "$(ensure_gitignore_entry ".goat-flow/.gitignore" "!hooks/**")" == "changed" ]]; then
    COPIED=$((COPIED + 1))
    echo "  ✓ .goat-flow/.gitignore (hooks/** un-ignored)"
  fi
  if [[ -n "${HOOK_CONFIG_DST:-}" && -n "${HOOK_CONFIG_SRC:-}" ]]; then
    echo "Hooks config:"
    copy_if_missing "$GOAT_FLOW_ROOT/$HOOK_CONFIG_SRC" "$HOOK_CONFIG_DST"
    if [[ "$(migrate_agent_hook_config "$HOOK_CONFIG_DST" "$HOOK_CONFIG_SRC")" == "changed" ]]; then
      COPIED=$((COPIED + 1))
      echo "  ✓ $HOOK_CONFIG_DST (migrated deny hook registration)"
    fi
  fi
else
  echo "Hooks:"
  echo "  · no hook files for $AGENT"
fi
echo ""

# ==========================================================================
# 8. Install agent settings (skip if exists, unless --force)
# ==========================================================================
echo "Settings:"
SETTINGS_SKIPPED=false
if [[ -n "${SETTINGS_SRC:-}" && -n "${SETTINGS_DST:-}" ]]; then
  if [[ -f "$SETTINGS_DST" ]] && ! $FORCE; then
    SETTINGS_MIGRATIONS=()
    if [[ "$AGENT" == "codex" ]]; then
      if [[ "$(migrate_codex_hooks_feature_flag "$SETTINGS_DST")" == "migrated" ]]; then
        SETTINGS_MIGRATIONS+=("deprecated hooks flag")
      fi
      if [[ "$(migrate_codex_filesystem_permissions "$SETTINGS_DST")" == "migrated" ]]; then
        SETTINGS_MIGRATIONS+=("Codex permission profile")
      fi
    fi
    if [[ ${#SETTINGS_MIGRATIONS[@]} -gt 0 ]]; then
      COPIED=$((COPIED + 1))
      SETTINGS_NOTE="$(IFS=', '; echo "${SETTINGS_MIGRATIONS[*]}")"
      echo "  ✓ $SETTINGS_DST (migrated: $SETTINGS_NOTE)"
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
if [[ "$AGENT" == "codex" && -n "${SETTINGS_DST:-}" && -f "$SETTINGS_DST" ]]; then
  CODEX_VALIDATION="$(validate_codex_settings_after_install "$SETTINGS_DST")"
  if [[ "$CODEX_VALIDATION" != "ok" ]]; then
    echo ""
    echo "ERROR: $SETTINGS_DST still has invalid Codex permission entries:" >&2
    echo "  ${CODEX_VALIDATION#invalid:}" >&2
    echo "Codex will reject this config at startup. Re-run with --force to" >&2
    echo "refresh from the canonical template, or edit the file manually so" >&2
    echo "the active goat-flow profile extends \":workspace\" and uses" >&2
    echo "access=\"deny\" for secret-path filesystem entries." >&2
    exit 1
  fi
fi
if $HOOKS_ENABLED && [[ -z "${HOOK_CONFIG_DST:-}" && -n "${SETTINGS_DST:-}" && -n "${SETTINGS_SRC:-}" && -f "$SETTINGS_DST" ]]; then
  if [[ "$(migrate_agent_hook_config "$SETTINGS_DST" "$SETTINGS_SRC")" == "changed" ]]; then
    COPIED=$((COPIED + 1))
    SETTINGS_SKIPPED=false
    echo "  ✓ $SETTINGS_DST (migrated deny hook registration)"
  fi
fi
echo ""

# ==========================================================================
# 9. Scaffold or maintain config.yaml
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
  if [[ "$(remove_config_agents_entry "$CONFIG_PATH")" == "changed" ]]; then
    CONFIG_CHANGED=true
    CONFIG_NOTES+=("legacy agents allowlist removed")
  fi
  if [[ "$(migrate_config_tasks_entry "$CONFIG_PATH")" == "changed" ]]; then
    CONFIG_CHANGED=true
    CONFIG_NOTES+=("legacy tasks config migrated to plans")
  fi
  if [[ "$(ensure_config_hooks_entry "$CONFIG_PATH")" == "changed" ]]; then
    CONFIG_CHANGED=true
    CONFIG_NOTES+=("hook toggles added")
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
  printf 'version: "%s"\n\nskills:\n  install: all\n\nhooks:\n  deny-dangerous:\n    enabled: true\n  gruff-code-quality:\n    enabled: false\n' "$VERSION" > "$CONFIG_PATH"
  COPIED=$((COPIED + 1))
  echo "  ✓ $CONFIG_PATH (scaffolded)"
fi
echo ""

# ==========================================================================
# 10. Write .active marker if exactly one version-named subdir exists
# ==========================================================================
# Convention: .goat-flow/plans/.active is a one-line file naming the active
# plan subdir (e.g. "1.2.2"). Skills (goat, goat-plan) read it to scope their
# scan. See ADR-017. We only write it automatically when there is no ambiguity.
echo "Active plan marker:"
ACTIVE_FILE=".goat-flow/plans/.active"
if [[ -f "$ACTIVE_FILE" ]] && ! $FORCE; then
  SKIPPED=$((SKIPPED + 1))
  echo "  · $ACTIVE_FILE (exists, skipped)"
else
  shopt -s nullglob
  version_subdirs=()
  for d in .goat-flow/plans/[0-9]*.[0-9]*.[0-9]*/; do
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
echo "DONE: $COPIED files installed, $SKIPPED skipped, $REMOVED stale removed"
echo ""

# Warn when deny hook is installed but settings file was skipped (hook may not be registered)
if $HOOKS_ENABLED && $SETTINGS_SKIPPED && [[ -f "$HOOKS_DIR/deny-dangerous.sh" ]]; then
  echo "⚠ Settings file was preserved (not overwritten)."
  echo "  The central guardrail hooks in $HOOKS_DIR were installed but may not be"
  echo "  registered in $SETTINGS_DST. Verify your settings file includes"
  echo "  PreToolUse hook entries pointing at .goat-flow/hooks/deny-dangerous.sh."
  if [[ "$AGENT" == "claude" ]]; then
    echo ""
    echo "  For Claude, add this to $SETTINGS_DST under \"hooks\":{\"PreToolUse\":[...]}:"
    # shellcheck disable=SC2016,SC1003 # literal JSON snippet preserves nested shell quoting for copy/paste guidance.
    printf '%s\n' '    {"matcher":"Bash","hooks":[{"type":"command","command":"bash -c '\''gcd=\"$(git rev-parse --git-common-dir 2>/dev/null)\"; root=\"\"; case \"$gcd\" in */.git/modules/*|.git/modules/*) root=\"$(git rev-parse --show-toplevel 2>/dev/null || true)\" ;; /*|[A-Za-z]:/*|[A-Za-z]:\\\\*) gcd=\"${gcd//\\\\//}\"; root=\"$(dirname \"$gcd\")\" ;; *) root=\"$(git rev-parse --show-toplevel 2>/dev/null || true)\" ;; esac; [ -f \"$root/.goat-flow/hooks/deny-dangerous.sh\" ] || root=\"${CLAUDE_PROJECT_DIR:-}\"; [ -f \"$root/.goat-flow/hooks/deny-dangerous.sh\" ] || { printf '\''\\'\'''\''BLOCKED: Policy hook unavailable: git repository root unavailable.\\n'\''\\'\'''\'' >&2; exit 2; }; cd \"$root\" || { printf '\''\\'\'''\''BLOCKED: Policy hook unavailable: git repository root unavailable.\\n'\''\\'\'''\'' >&2; exit 2; }; bash \"$root/.goat-flow/hooks/deny-dangerous.sh\"'\''"}]}'
  fi
  echo ""
fi

# Hint about previously-hidden committed goat-flow surfaces.
# Older .goat-flow/.gitignore templates lacked one or more current exceptions, so
# upgraders may have files on disk that git still treats as untracked-but-ignored.
# Detect by asking git itself, only inside a git repo, and only when at least
# one of the directories holds files. No automatic `git add` - that is the
# user's decision.
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  hidden_paths=()
  for hint_dir in \
    ".goat-flow/learning-loop" \
    ".goat-flow/skill-docs" \
    ".goat-flow/hooks" \
    ".goat-flow/plans"
  do
    if [[ -d "$hint_dir" ]] && \
       git -C . check-ignore -q "$hint_dir/." 2>/dev/null; then
      hidden_paths+=("$hint_dir/")
    fi
  done
  if [[ ${#hidden_paths[@]} -gt 0 ]]; then
    echo "⚠ Some installed directories are still gitignored:"
    for path in "${hidden_paths[@]}"; do
      echo "    $path"
    done
    echo "  The installer refreshed .goat-flow/.gitignore, but git tracks the"
    echo "  ignore state per file. To track these (recommended), run:"
    echo "    git add ${hidden_paths[*]}"
    echo "  Skip this step only for surfaces you intentionally keep local."
    echo ""
  fi
fi

echo "Next steps:"
echo "  1. Run the setup steps to create project-specific content"
echo "     (CLAUDE.md, architecture.md, code-map.md, footguns, lessons)"
echo "  2. Run: goat-flow audit . --agent $AGENT"
