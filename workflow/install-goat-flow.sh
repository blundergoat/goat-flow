#!/usr/bin/env bash
# =============================================================================
# Installs canonical Goat Flow files into one selected project; use it through `goat-flow install` or `setup --apply` when refreshing an agent.
# Direct use skips the CLI preview, post-write verification, and verified install-state receipt.
#
# - System-owned files become user-visible only after managed preflight and destination-side completion.
# - User-owned settings and configuration remain authoritative.
# - `--force` accepts inspected system conflicts but never resets user content or bypasses path safety.
#
# Project-specific instructions and architecture remain a later setup step.
# Usage: bash workflow/install-goat-flow.sh /path/to/project --agent claude
# =============================================================================
set -euo pipefail

# --- Resolve goat-flow root (directory containing this script's parent) ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GOAT_FLOW_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MANIFEST_PATH="$GOAT_FLOW_ROOT/workflow/manifest.json"
REQUIRED_INLINE_NODE_PACKAGES=("js-yaml")

# Confirm every third-party package used by inline Node transforms is available from this goat-flow package.
# Use before entering the selected project so CLI and direct users fail before any project file can change.
preflight_installer_dependencies() {
  local required_package_name

  # Each declared package is resolved from the shipped framework root, matching the later user-config transforms.
  for required_package_name in "${REQUIRED_INLINE_NODE_PACKAGES[@]}"; do
    # A missing package stops here so the user's target stays empty instead of receiving a partial setup.
    if ! node - "$required_package_name" "$GOAT_FLOW_ROOT" >/dev/null 2>&1 <<'NODE'
const [requiredPackageName, frameworkRoot] = process.argv.slice(2);
require.resolve(requiredPackageName, { paths: [frameworkRoot] });
NODE
    then
      echo "ERROR: installer dependency '$required_package_name' is missing from goat-flow root '$GOAT_FLOW_ROOT'; run npm install in that root" \
        "or reinstall @blundergoat/goat-flow, then retry." >&2
      return 1
    fi
  done
}

# Refuse non-CLI mutation after v2 state or any old-reader cutover marker appears.
# The environment value is cooperative admission supplied only after the public CLI owns and revalidates the complete write-claim batch.
require_managed_install_admission() {
  local managed_state_path="$PROJECT/.goat-flow/install-state/managed.json"
  local marker_path known_agent
  local -a known_agents=()

  if [[ "${GOAT_FLOW_INSTALL_ADMISSION:-}" == "v2" ]]; then
    return 0
  fi
  # Any object at the sole v2 authority path activates the guard; the CLI reports malformed state in detail.
  if [[ -e "$managed_state_path" || -L "$managed_state_path" ]]; then
    echo "ERROR: managed install state requires the public CLI. Run: goat-flow install \"$PROJECT\" --agent \"$AGENT\"" >&2
    return 1
  fi

  IFS=',' read -r -a known_agents <<< "$SUPPORTED_AGENTS_CSV"
  for known_agent in "${known_agents[@]}"; do
    marker_path="$PROJECT/.goat-flow/install-state/$known_agent.json"
    if [[ -L "$marker_path" || ( -e "$marker_path" && ! -f "$marker_path" ) ]]; then
      echo "ERROR: managed install state requires the public CLI. Run: goat-flow install \"$PROJECT\" --agent \"$AGENT\"" >&2
      return 1
    fi
    if [[ -f "$marker_path" ]]; then
      if [[ ! -r "$marker_path" ]] || grep -Eq '"schemaVersion"[[:space:]]*:[[:space:]]*"goat-flow\.install-state\.v1-cutover"' "$marker_path"; then
        echo "ERROR: managed install state requires the public CLI. Run: goat-flow install \"$PROJECT\" --agent \"$AGENT\"" >&2
        return 1
      fi
    fi
  done
}

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

if (mode === "file-ownership") {
  const destinationPath = process.argv[4];
  const declaredFile = manifest.file_ownership?.[destinationPath];

  // Exact manifest records explain canonical files shown by `goat-flow manifest`.
  if (declaredFile) {
    console.log(`${declaredFile.ownership}\t${declaredFile.source || ""}`);
    process.exit(0);
  }

  // Agent settings are seeded once, then kept for the user's local preferences.
  for (const [agentId, agent] of Object.entries(manifest.agents || {})) {
    const settingsPath = typeof agent.settings === "string" ? agent.settings : "";
    const settingsExtension = settingsPath ? settingsPath.split(".").pop() : "";
    const hookConfigPath =
      typeof agent.hook_config_file === "string" ? agent.hook_config_file : "";

    // A settings destination lets users retain local permissions and UI choices.
    if (destinationPath === settingsPath) {
      console.log(
        `user-owned\tworkflow/hooks/agent-config/${agentId}.${settingsExtension}`,
      );
      process.exit(0);
    }

    // A separate hook config is also preserved after the first install.
    if (destinationPath === hookConfigPath && hookConfigPath !== settingsPath) {
      console.log(`user-owned\tworkflow/hooks/agent-config/${agentId}-hooks.json`);
      process.exit(0);
    }

    // Installed skill mirrors are refreshed so users receive the current workflow.
    if (destinationPath.startsWith(trimDir(agent.skills_dir) + "/")) {
      console.log("system-owned\t");
      process.exit(0);
    }

    // Installed guardrails are refreshed so every selected agent gets current policy.
    if (destinationPath.startsWith(trimDir(agent.hooks_dir) + "/")) {
      console.log("system-owned\t");
      process.exit(0);
    }
  }

  process.stderr.write(`unclassified installer destination: ${destinationPath}\n`);
  process.exit(3);
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
UPDATE_CONFIG_VERSION=false
CLEAN_DEPRECATED=false
# System-owned destinations the CLI preview classified as preserved local content.
PRESERVE_PATHS=()
# User-owned destinations the CLI admitted for replacement under named, twice-given authority.
REPLACE_USER_PATHS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent) AGENT="$2"; shift 2 ;;
    --preserve-path)
      # The CLI decides which paths this package leaves alone; the installer does not re-derive that.
      PRESERVE_PATHS+=("$2")
      shift 2
      ;;
    --replace-user-path)
      # Only the CLI can admit this, and only for a path named by both --force-user-owned and --force-path.
      REPLACE_USER_PATHS+=("$2")
      shift 2
      ;;
    --force)
      # The CLI already limits force to inspected system-owned conflicts; this installer never uses it to reset user content.
      shift
      ;;
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

# Dependency errors must reach the user before migrations, directory scaffolding, or staged file writes begin.
preflight_installer_dependencies

# A v1-only CLI or direct script must not mutate a target once v2 state controls admission.
require_managed_install_admission

COPIED=0
SKIPPED=0
REMOVED=0
ACTIVE_STAGING_DIRECTORIES=()
STAGED_PAYLOAD_PATH=""
STAGED_PAYLOAD_DIRECTORY=""
LAST_TRANSFORM_RESULT=""

# Validate every component of one user-visible installer destination.
# Use before directory creation and final replacement so setup cannot follow a target symlink.
assert_safe_installer_destination() {
  local destination_path="$1"
  local inspected_path="."
  local path_component
  local -a path_components=()

  # Empty, absolute, or parent-traversing destinations cannot belong to the selected project.
  if [[ -z "$destination_path" || "$destination_path" == /* ]]; then
    echo "ERROR: unsafe installer destination '$destination_path': expected a project-relative path" >&2
    return 1
  fi
  IFS='/' read -r -a path_components <<< "$destination_path"
  # Each existing parent must be a real directory, not a redirect into another project.
  for path_component in "${path_components[@]:0:${#path_components[@]}-1}"; do
    # Dot segments are harmless; parent traversal is not a project-local destination.
    if [[ -z "$path_component" || "$path_component" == "." ]]; then
      continue
    fi
    # A parent segment would let a manifest path escape the project root.
    if [[ "$path_component" == ".." ]]; then
      echo "ERROR: unsafe installer destination '$destination_path': parent traversal is not allowed" >&2
      return 1
    fi
    inspected_path="$inspected_path/$path_component"
    # A symlinked parent could redirect a managed write outside the selected project.
    if [[ -L "$inspected_path" ]]; then
      echo "ERROR: unsafe installer destination '$destination_path': symlink component '$inspected_path'" >&2
      return 1
    fi
    # A file parent cannot contain the destination the user expects setup to replace.
    if [[ -e "$inspected_path" && ! -d "$inspected_path" ]]; then
      echo "ERROR: unsafe installer destination '$destination_path': non-directory component '$inspected_path'" >&2
      return 1
    fi
  done

  # A symlink leaf is also a redirect and must stay blocked even under --force.
  if [[ -L "$destination_path" ]]; then
    echo "ERROR: unsafe installer destination '$destination_path': destination is a symlink" >&2
    return 1
  fi
  # Existing replacement destinations must be regular files; directories and devices need manual repair.
  if [[ -e "$destination_path" && ! -f "$destination_path" ]]; then
    echo "ERROR: unsafe installer destination '$destination_path': destination is not a regular file" >&2
    return 1
  fi
}

# Validate one setup directory by treating a never-created child as a file destination.
# Use before mkdir so users never receive directories through a symlinked project component.
assert_safe_installer_directory() {
  local directory_path="$1"
  local safety_error

  # The synthetic child makes every directory component participate in the parent walk.
  if ! safety_error="$(
    assert_safe_installer_destination "$directory_path/.goat-flow-directory-check" 2>&1
  )"; then
    echo "ERROR: unsafe installer directory '$directory_path': ${safety_error#ERROR: }" >&2
    return 1
  fi
}

# Remove one installer-owned sibling payload without recursively deleting user paths.
# Use after success or failure; an unexpected leftover stays visible with a cleanup warning.
cleanup_staging_directory() {
  local staging_directory="$1"

  # Only directories carrying the installer marker are eligible for automatic cleanup.
  if [[ -z "$staging_directory" || "$staging_directory" != *"/.goat-flow-stage."* ]]; then
    return 0
  fi
  # A replaced staging path is no longer trustworthy, so leave it for the user to inspect.
  if [[ -L "$staging_directory" ]]; then
    echo "WARNING: staging cleanup skipped redirected path: $staging_directory" >&2
    return 0
  fi
  # A partial copy may have created the single payload file before setup stopped.
  if [[ -d "$staging_directory" ]]; then
    rm -f -- "$staging_directory/payload"
    # Extra or unexpected content remains visible instead of being recursively deleted.
    if ! rmdir -- "$staging_directory" 2>/dev/null; then
      echo "WARNING: staging cleanup incomplete; inspect: $staging_directory" >&2
    fi
  fi
}

# Forget one completed staging directory so the exit trap does not inspect it again.
# Use only after cleanup or a successful rename has removed the installer-owned directory.
forget_staging_directory() {
  local completed_directory="$1"
  local staging_index

  # The array may contain several completed writes from one installer run.
  for staging_index in "${!ACTIVE_STAGING_DIRECTORIES[@]}"; do
    # Removing the matching slot keeps unrelated in-flight payloads protected by the trap.
    if [[ "${ACTIVE_STAGING_DIRECTORIES[$staging_index]}" == "$completed_directory" ]]; then
      unset 'ACTIVE_STAGING_DIRECTORIES[staging_index]'
      return 0
    fi
  done
}

# Clean every in-flight payload when installation exits or the user interrupts it.
# Use as the final safety net after individual helpers perform their immediate cleanup.
cleanup_all_staging_directories() {
  local staging_directory

  # Each entry was created by mktemp during this installer process.
  for staging_directory in "${ACTIVE_STAGING_DIRECTORIES[@]}"; do
    cleanup_staging_directory "$staging_directory"
  done
}

# Convert an interrupt into scoped staging cleanup and a conventional shell exit code.
# For example, Ctrl-C during a large skill copy preserves the previous installed file.
handle_installer_signal() {
  local signal_name="$1" exit_code="$2"
  trap - HUP INT TERM
  cleanup_all_staging_directories
  echo "ERROR: installer interrupted by $signal_name; previous destinations were preserved" >&2
  exit "$exit_code"
}

trap cleanup_all_staging_directories EXIT
trap 'handle_installer_signal HUP 129' HUP
trap 'handle_installer_signal INT 130' INT
trap 'handle_installer_signal TERM 143' TERM

# Create one empty adjacent payload after validating its project-local destination.
# Use before copying or generating bytes that must appear all at once to the user.
prepare_staged_payload() {
  local destination_path="$1"
  local destination_parent destination_name

  assert_safe_installer_destination "$destination_path"
  destination_parent="$(dirname "$destination_path")"
  destination_name="$(basename "$destination_path")"
  mkdir -p -- "$destination_parent"
  # Directory creation must not race into a symlinked component before staging begins.
  assert_safe_installer_destination "$destination_path"
  # A staging allocation failure leaves the old destination untouched and needs a repair clue.
  if ! STAGED_PAYLOAD_DIRECTORY="$(
    mktemp -d "$destination_parent/.goat-flow-stage.${destination_name}.XXXXXX"
  )"; then
    STAGED_PAYLOAD_DIRECTORY=""
    STAGED_PAYLOAD_PATH=""
    echo "ERROR: could not create adjacent staging directory for '$destination_path'; previous destination was preserved" >&2
    return 1
  fi
  STAGED_PAYLOAD_PATH="$STAGED_PAYLOAD_DIRECTORY/payload"
  ACTIVE_STAGING_DIRECTORIES+=("$STAGED_PAYLOAD_DIRECTORY")
}

# Discard the current payload and clear its process-local pointers.
# Use when generation fails or a staged transform determines no user-visible change is needed.
discard_staged_payload() {
  cleanup_staging_directory "$STAGED_PAYLOAD_DIRECTORY"
  forget_staging_directory "$STAGED_PAYLOAD_DIRECTORY"
  STAGED_PAYLOAD_PATH=""
  STAGED_PAYLOAD_DIRECTORY=""
}

# Rename one complete adjacent payload into place without a copy fallback.
# Use replace for supported managed writes and create-only for collision-sensitive user files.
commit_staged_payload() {
  local destination_path="$1" replacement_mode="$2"
  local staging_directory="$STAGED_PAYLOAD_DIRECTORY"

  # A final component check catches target changes that happened while bytes were staged.
  assert_safe_installer_destination "$destination_path"
  # User-owned or generated create-only writes must not win a destination race.
  if [[ "$replacement_mode" == "create-only" ]]; then
    # mv -n leaves the payload in staging when another process created the destination first.
    if ! mv -n -- "$STAGED_PAYLOAD_PATH" "$destination_path"; then
      echo "ERROR: atomic create failed for '$destination_path'; no existing destination was replaced" >&2
      discard_staged_payload
      return 1
    fi
    # A remaining payload proves mv -n preserved a destination that appeared after validation.
    if [[ -e "$STAGED_PAYLOAD_PATH" ]]; then
      echo "ERROR: destination appeared during install: '$destination_path'; existing bytes were preserved" >&2
      discard_staged_payload
      return 1
    fi
  else
    # Managed replacement is supported, but a failed adjacent rename must never degrade to copying.
    if ! mv -f -- "$STAGED_PAYLOAD_PATH" "$destination_path"; then
      echo "ERROR: atomic replacement failed for '$destination_path'; previous destination was preserved and no non-atomic fallback was attempted" >&2
      discard_staged_payload
      return 1
    fi
  fi

  rmdir -- "$staging_directory"
  forget_staging_directory "$staging_directory"
  STAGED_PAYLOAD_PATH=""
  STAGED_PAYLOAD_DIRECTORY=""
}

# Stage the current destination bytes, or an empty payload when the user has no file yet.
# Use before append and structured transforms so parsing never mutates the visible file directly.
stage_existing_destination() {
  local destination_path="$1"

  prepare_staged_payload "$destination_path"
  # Existing regular files keep their current bytes and mode inside the adjacent payload.
  if [[ -f "$destination_path" ]]; then
    # A failed staging copy cannot damage the user's still-visible destination.
    if ! cp "$destination_path" "$STAGED_PAYLOAD_PATH"; then
      echo "ERROR: staging copy failed for '$destination_path'; previous destination was preserved" >&2
      discard_staged_payload
      return 1
    fi
  else
    : > "$STAGED_PAYLOAD_PATH"
  fi
}

# Publish a changed transform or discard an unchanged payload, then expose its result to the caller.
# Use after an inline Node transform so installer counters and messages retain their current behavior.
complete_staged_transform() {
  local destination_path="$1" transform_result="$2"

  # Unchanged transforms leave the original inode and bytes untouched for the user.
  if [[ "$transform_result" == "unchanged" ]]; then
    discard_staged_payload
  else
    commit_staged_payload "$destination_path" "replace"
  fi
  LAST_TRANSFORM_RESULT="$transform_result"
}

# Confirm one installer action matches the update behavior users see in the manifest report.
# Use this before a copy or generated write so an unclassified destination stops safely.
assert_file_ownership() {
  local destination_path="$1" expected_ownership="$2" source_path="${3:-}"
  local ownership_line actual_ownership declared_source

  # An unknown destination has no safe overwrite or preserve behavior.
  if ! ownership_line="$(manifest_eval file-ownership "$destination_path")"; then
    echo "ERROR: no manifest ownership for installer destination: $destination_path"
    exit 1
  fi

  IFS=$'\t' read -r actual_ownership declared_source <<< "$ownership_line"

  # A mismatched action means setup would behave differently from its user-facing report.
  if [[ "$actual_ownership" != "$expected_ownership" ]]; then
    echo "ERROR: $destination_path is $actual_ownership, installer expected $expected_ownership"
    exit 1
  fi

  # Exact manifest sources must match the template the user is about to receive.
  if [[ -n "$declared_source" && -n "$source_path" && "$source_path" != "$GOAT_FLOW_ROOT/$declared_source" ]]; then
    echo "ERROR: $destination_path source differs from manifest: $declared_source"
    exit 1
  fi
}

# Report whether the CLI preview asked this destination to keep its current bytes.
# A preserved path holds local content that the current package template does not change,
# so replacing it would destroy project content for no delivered difference.
installer_path_is_preserved() {
  local candidate="$1" preserved_path
  # The empty-array guard keeps `set -u` satisfied when no path was preserved.
  for preserved_path in ${PRESERVE_PATHS+"${PRESERVE_PATHS[@]}"}; do
    [[ "$preserved_path" == "$candidate" ]] && return 0
  done
  return 1
}

# Report whether the CLI admitted this user-owned destination for replacement.
# Reaching here needs both --force-user-owned and a matching --force-path, so the
# create-only rule is lifted for exactly the paths the user named and nothing else.
installer_user_path_is_replaceable() {
  local candidate="$1" replaceable_path
  for replaceable_path in ${REPLACE_USER_PATHS+"${REPLACE_USER_PATHS[@]}"}; do
    [[ "$replaceable_path" == "$candidate" ]] && return 0
  done
  return 1
}

# Copy one canonical template or create-only user seed into the selected project.
# Use after ownership lookup confirms how setup may change the destination.
copy_file() {
  local src="$1" dst="$2" expected_ownership="${3:-system-owned}" requested_mode="${4:-}"
  local replacement_mode="replace"
  assert_file_ownership "$dst" "$expected_ownership" "$src"

  # Ownership still validates first, so a preserved path cannot hide a manifest mismatch.
  if installer_path_is_preserved "$dst"; then
    SKIPPED=$((SKIPPED + 1))
    echo "  · $dst (preserved local content; this package does not change it)"
    return
  fi

  # Missing packaged content would leave the user's installation incomplete.
  if [[ ! -f "$src" ]]; then
    echo "ERROR: missing installer template: $src"
    echo "Manifest/template drift detected. Restore the referenced template before running install."
    exit 1
  fi
  prepare_staged_payload "$dst"
  # Copy failure leaves only the sibling payload, which cleanup removes without touching old bytes.
  if ! cp "$src" "$STAGED_PAYLOAD_PATH"; then
    echo "ERROR: staging copy failed for '$dst'; previous destination was preserved" >&2
    discard_staged_payload
    return 1
  fi
  # Executable hook modes belong on the payload before users can observe the replacement.
  if [[ -n "$requested_mode" ]]; then
    chmod "$requested_mode" "$STAGED_PAYLOAD_PATH"
  fi
  # User-owned files stay create-only, so refreshing managed files cannot replace the user's project choices.
  if [[ "$expected_ownership" == "user-owned" ]]; then
    replacement_mode="create-only"
    # An explicitly named and separately authorized path is the one exception.
    if installer_user_path_is_replaceable "$dst"; then
      replacement_mode="replace"
    fi
  fi
  commit_staged_payload "$dst" "$replacement_mode"
  COPIED=$((COPIED + 1))
  echo "  ✓ $dst"
}

# Seed a customizable file without replacing the user's existing content.
# Use for policies, settings, and local decision guidance users may edit later.
copy_if_missing() {
  local src="$1" dst="$2"
  assert_file_ownership "$dst" "user-owned" "$src"

  # Existing user content remains authoritative unless the user named this exact path.
  if [[ -f "$dst" ]] && ! installer_user_path_is_replaceable "$dst"; then
    SKIPPED=$((SKIPPED + 1))
    echo "  · $dst (exists, skipped)"
    return
  fi
  copy_file "$src" "$dst" "user-owned"
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
      guard-common.sh|guard-destructive-shell.sh|guard-secret-paths.sh|guard-repository-writes.sh|guardrails-self-test.sh|deny-dangerous.self-test.sh|post-turn-validate.sh|plan-checkbox-guard.sh)
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

# Verify source and destination parent share a device before invoking mv.
# Use for legacy migrations so mv never silently degrades into a cross-device copy.
assert_atomic_migration_filesystem() {
  local source_path="$1" destination_parent="$2"

  if ! node - "$source_path" "$destination_parent" <<'NODE'
const fs = require("node:fs");

const sourcePath = process.argv[2];
const destinationParent = process.argv[3];
const sourceDevice = fs.statSync(sourcePath).dev;
const destinationDevice = fs.statSync(destinationParent).dev;

// Different devices cannot provide the atomic rename users were promised.
if (sourceDevice !== destinationDevice) {
  process.exit(18);
}
NODE
  then
    echo "ERROR: atomic migration rename failed for '$source_path': source and destination are on different filesystems; source was preserved and no copy fallback was attempted" >&2
    return 1
  fi
}

# Move one complete legacy path only when the destination is still absent.
# Use for user-authored migration content so collision or rename failure preserves the source.
rename_migration_path_no_overwrite() {
  local source_path="$1" destination_path="$2"
  local destination_parent

  assert_safe_installer_destination "$destination_path"
  destination_parent="$(dirname "$destination_path")"
  mkdir -p -- "$destination_parent"
  # Directory creation must not introduce a redirected component before migration.
  assert_safe_installer_destination "$destination_path"
  assert_atomic_migration_filesystem "$source_path" "$destination_parent"
  # mv -n preserves a destination that appears after the caller's collision check.
  if ! mv -n -- "$source_path" "$destination_path"; then
    echo "ERROR: atomic migration rename failed for '$source_path' → '$destination_path'; source was preserved and no copy fallback was attempted" >&2
    return 1
  fi
  # A remaining source means another process won the destination race.
  if [[ -e "$source_path" || -L "$source_path" ]]; then
    return 2
  fi
}

move_file_no_overwrite() {
  local src="$1" dst="$2"
  local rename_status=0
  [[ -f "$src" ]] || return 0
  if [[ -e "$dst" ]]; then
    SKIPPED=$((SKIPPED + 1))
    echo "  · $src → $dst (target exists, left old file in place)"
    return 0
  fi
  rename_migration_path_no_overwrite "$src" "$dst" || rename_status=$?
  # A racing destination keeps both the existing target and legacy source intact.
  if [[ "$rename_status" -eq 2 ]]; then
    SKIPPED=$((SKIPPED + 1))
    echo "  · $src → $dst (target appeared, left old file in place)"
    return 0
  fi
  # Any other rename failure has already emitted a user-actionable preservation message.
  if [[ "$rename_status" -ne 0 ]]; then
    return "$rename_status"
  fi
  COPIED=$((COPIED + 1))
  echo "  ✓ $src → $dst"
}

migrate_dir_no_overwrite() {
  local src="$1" dst="$2"
  local rename_status=0
  [[ -d "$src" ]] || return 0
  if [[ ! -e "$dst" ]]; then
    rename_migration_path_no_overwrite "$src" "$dst" || rename_status=$?
    # A racing destination preserves the complete legacy directory for manual resolution.
    if [[ "$rename_status" -eq 2 ]]; then
      SKIPPED=$((SKIPPED + 1))
      echo "  · $src/ → $dst/ (target appeared, left old directory in place)"
      return 0
    fi
    # A filesystem or rename failure keeps the source intact and stops later installer writes.
    if [[ "$rename_status" -ne 0 ]]; then
      return "$rename_status"
    fi
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
    rename_status=0
    rename_migration_path_no_overwrite "$entry" "$target" || rename_status=$?
    # A racing entry stays in the legacy source directory for the user to inspect.
    if [[ "$rename_status" -eq 2 ]]; then
      SKIPPED=$((SKIPPED + 1))
      echo "  · $entry → $target (target appeared, left old entry in place)"
      continue
    fi
    # A filesystem or rename failure stops the merge before any fallback copy can occur.
    if [[ "$rename_status" -ne 0 ]]; then
      return "$rename_status"
    fi
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
    for script in run-with-bash.mjs hook-provider-adapters.mjs hook-launch-runtime.mjs deny-dangerous.sh gruff-code-quality.sh post-turn-safety.sh plan-checkbox-guard.sh post-turn-validate.sh; do
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
  assert_file_ownership "$dst" "generated"

  # An existing anchor already keeps the user's empty workspace directory available.
  if [[ -f "$dst" ]]; then
    SKIPPED=$((SKIPPED + 1))
    echo "  · $dst (exists, skipped)"
    return
  fi
  prepare_staged_payload "$dst"
  : > "$STAGED_PAYLOAD_PATH"
  commit_staged_payload "$dst" "create-only"
  COPIED=$((COPIED + 1))
  echo "  ✓ $dst"
}

ensure_gitignore_entry() {
  local path="$1"
  local entry="$2"
  local transform_result
  # Preview-preserved local content is authoritative for every later reconciliation pass.
  if installer_path_is_preserved "$path"; then
    LAST_TRANSFORM_RESULT="unchanged"
    return 0
  fi
  stage_existing_destination "$path"
  if ! transform_result="$(node - "$STAGED_PAYLOAD_PATH" "$entry" <<'NODE'
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
  )"; then
    echo "ERROR: could not stage gitignore entry for '$path'; previous destination was preserved" >&2
    discard_staged_payload
    return 1
  fi
  complete_staged_transform "$path" "$transform_result"
}

update_config_version_line() {
  local path="$1"
  local transform_result
  stage_existing_destination "$path"
  if ! transform_result="$(node - "$STAGED_PAYLOAD_PATH" "$VERSION" <<'NODE'
const fs = require("node:fs");

const path = process.argv[2];
const version = process.argv[3];
const content = fs.readFileSync(path, "utf8");
fs.writeFileSync(path, content.replace(/^version:.*$/m, `version: "${version}"`));
console.log("changed");
NODE
  )"; then
    echo "ERROR: could not stage config version for '$path'; previous destination was preserved" >&2
    discard_staged_payload
    return 1
  fi
  complete_staged_transform "$path" "$transform_result"
}

remove_config_agents_entry() {
  local path="$1"
  local transform_result
  stage_existing_destination "$path"
  if ! transform_result="$(node - "$STAGED_PAYLOAD_PATH" <<'NODE'
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
  )"; then
    echo "ERROR: could not stage legacy agent cleanup for '$path'; previous destination was preserved" >&2
    discard_staged_payload
    return 1
  fi
  complete_staged_transform "$path" "$transform_result"
}

migrate_config_tasks_entry() {
  local path="$1"
  local transform_result
  stage_existing_destination "$path"
  if ! transform_result="$(node - "$STAGED_PAYLOAD_PATH" <<'NODE'
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
  )"; then
    echo "ERROR: could not stage plans config migration for '$path'; previous destination was preserved" >&2
    discard_staged_payload
    return 1
  fi
  complete_staged_transform "$path" "$transform_result"
}

ensure_config_hooks_entry() {
  local path="$1"
  local transform_result
  stage_existing_destination "$path"
  if ! transform_result="$(node - "$STAGED_PAYLOAD_PATH" "$GOAT_FLOW_ROOT" <<'NODE'
const fs = require("node:fs");

const path = process.argv[2];
const frameworkRoot = process.argv[3];
const yaml = require(require.resolve("js-yaml", { paths: [frameworkRoot] }));
const content = fs.readFileSync(path, "utf8");
const eol = content.includes("\r\n") ? "\r\n" : "\n";
const repeatedEol = new RegExp(`(?:${eol === "\r\n" ? "\\r\\n" : "\\n"}){3,}`, "gu");
const hadFinalNewline = /\r?\n$/u.test(content);
let lines = content.split(/\r?\n/u);
if (hadFinalNewline) lines.pop();
let parsedHooks = null;
try {
  const parsedConfig = yaml.load(content);
  if (
    parsedConfig !== null &&
    typeof parsedConfig === "object" &&
    !Array.isArray(parsedConfig) &&
    parsedConfig.hooks !== null &&
    typeof parsedConfig.hooks === "object" &&
    !Array.isArray(parsedConfig.hooks)
  ) {
    parsedHooks = parsedConfig.hooks;
  }
} catch {
  // Existing line-based migration retains its fail-safe behavior for malformed user YAML.
}
const staleHookRe = /^  guard-(destructive-shell|secret-paths|repository-writes):\s*$/u;
const removedHookRe = /^  plan-checkbox-guard:\s*$/u;
let changed = false;
let legacyEnabled = "true";

function insertHookEntry(lines, hooksIndex, hookId, enabled) {
  const hookRe = new RegExp(`^  ${hookId}:\\s*$`, "u");
  if (
    lines.some((line) => hookRe.test(line)) ||
    (parsedHooks !== null &&
      Object.prototype.hasOwnProperty.call(parsedHooks, hookId))
  ) {
    return false;
  }
  let insertAt = hooksIndex + 1;
  while (insertAt < lines.length && /^  [A-Za-z0-9_-]+:\s*$/u.test(lines[insertAt])) {
    insertAt += 1;
    while (insertAt < lines.length && /^    /.test(lines[insertAt])) insertAt += 1;
  }
  lines.splice(insertAt, 0, `  ${hookId}:`, `    enabled: ${enabled}`);
  return true;
}

// Find the index of the "}" closing the first "{" on the line, honoring quotes; -1 when it does not close on this line.
function flowMappingCloseIndex(line) {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  let started = false;
  for (let index = line.indexOf("{"); index >= 0 && index < line.length; index += 1) {
    const character = line[index];
    if (escaped) { escaped = false; continue; }
    if (inDouble && character === "\\") { escaped = true; continue; }
    if (!inDouble && character === "'") { inSingle = !inSingle; continue; }
    if (!inSingle && character === '"') { inDouble = !inDouble; continue; }
    if (inSingle || inDouble) continue;
    if (character === "{" || character === "[") { depth += 1; started = true; continue; }
    if (character === "}" || character === "]") {
      depth -= 1;
      if (started && depth === 0) return character === "}" ? index : -1;
      if (depth < 0) return -1;
    }
  }
  return -1;
}

// Splice one missing managed hook into a single-line flow mapping, leaving every other byte alone.
// Returns null when the mapping does not close on its own line; corrupting user YAML is never an option.
function insertFlowHookEntry(line, hookId, enabled) {
  const openIndex = line.indexOf("{");
  const closeIndex = flowMappingCloseIndex(line);
  if (openIndex === -1 || closeIndex === -1) return null;
  const body = line.slice(openIndex + 1, closeIndex);
  const entry = `${hookId}: { enabled: ${enabled} }`;
  const mutatedBody = body.trim().length === 0
    ? ` ${entry} `
    : `${body.replace(/\s+$/u, "")}, ${entry} `;
  return `${line.slice(0, openIndex + 1)}${mutatedBody}${line.slice(closeIndex)}`;
}

let hooksIndex = lines.findIndex((line) =>
  /^(?:hooks|"hooks"|'hooks')\s*:/u.test(line),
);
if (hooksIndex !== -1) {
  const next = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (i > hooksIndex && (staleHookRe.test(lines[i]) || removedHookRe.test(lines[i]))) {
      changed = true;
      const staleGuardrailHook = staleHookRe.test(lines[i]);
      i += 1;
      while (i < lines.length && /^    /.test(lines[i])) {
        const match = lines[i].match(/^    enabled:\s*(true|false)\s*$/u);
        if (staleGuardrailHook && match && match[1] === "false") legacyEnabled = "false";
        i += 1;
      }
      i -= 1;
      continue;
    }
    next.push(lines[i]);
  }
  lines = next;
  hooksIndex = lines.findIndex((line) =>
    /^(?:hooks|"hooks"|'hooks')\s*:/u.test(line),
  );
  const hooksInlineValue = lines[hooksIndex].slice(lines[hooksIndex].indexOf(":") + 1).trim();
  if (hooksInlineValue.startsWith("{")) {
    // A flow-style mapping must converge inside its own braces; block-style insertion would break the parse.
    // Without a successful parse the missing set is unknown, so the registry defaults stay authoritative.
    if (parsedHooks !== null) {
      for (const [flowHookId, flowEnabled] of [
        ["deny-dangerous", legacyEnabled],
        ["post-turn-safety", "true"],
        ["gruff-code-quality", "false"],
      ]) {
        if (Object.prototype.hasOwnProperty.call(parsedHooks, flowHookId)) continue;
        const mutatedLine = insertFlowHookEntry(lines[hooksIndex], flowHookId, flowEnabled);
        if (mutatedLine === null) break;
        lines[hooksIndex] = mutatedLine;
        changed = true;
      }
    }
  } else {
    changed = insertHookEntry(lines, hooksIndex, "deny-dangerous", legacyEnabled) || changed;
    changed = insertHookEntry(lines, hooksIndex, "post-turn-safety", "true") || changed;
    changed = insertHookEntry(lines, hooksIndex, "gruff-code-quality", "false") || changed;
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
  "  post-turn-safety:",
  "    enabled: true",
  "  gruff-code-quality:",
  "    enabled: false",
  "",
].join(eol);
fs.writeFileSync(path, next);
console.log("changed");
NODE
  )"; then
    echo "ERROR: could not stage hook config for '$path'; previous destination was preserved" >&2
    discard_staged_payload
    return 1
  fi
  complete_staged_transform "$path" "$transform_result"
}

# Persist an exact repository-owned Gruff path that the runtime deliberately does not discover recursively.
# Existing binary configuration remains authoritative; this only fills an absent override for the supported strands_agents layout.
ensure_config_gruff_binary_entry() {
  local path="$1"
  local transform_result
  stage_existing_destination "$path"
  if ! transform_result="$(node - "$STAGED_PAYLOAD_PATH" "$GOAT_FLOW_ROOT" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const configPath = process.argv[2];
const frameworkRoot = process.argv[3];
const yaml = require(require.resolve("js-yaml", { paths: [frameworkRoot] }));
const relativeBinaryPath = "strands_agents/.venv/bin/gruff-py";
const projectRoot = fs.realpathSync(process.cwd());
const candidatePath = path.join(projectRoot, relativeBinaryPath);

function candidateIsContainedExecutable() {
  try {
    fs.accessSync(candidatePath, fs.constants.X_OK);
    const binaryRealPath = fs.realpathSync(candidatePath);
    const relativeRealPath = path.relative(projectRoot, binaryRealPath);
    if (
      relativeRealPath === ".." ||
      relativeRealPath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeRealPath)
    ) {
      return false;
    }
    return fs.statSync(binaryRealPath).isFile();
  } catch {
    return false;
  }
}

if (!candidateIsContainedExecutable()) {
  console.log("unchanged");
  process.exit(0);
}

const content = fs.readFileSync(configPath, "utf8");
let parsedConfig;
try {
  parsedConfig = yaml.load(content);
} catch {
  console.log("unchanged");
  process.exit(0);
}
const hooks = parsedConfig?.hooks;
const gruffHook = hooks?.["gruff-code-quality"];
if (
  gruffHook === null ||
  typeof gruffHook !== "object" ||
  Array.isArray(gruffHook) ||
  Object.prototype.hasOwnProperty.call(gruffHook, "binaries")
) {
  console.log("unchanged");
  process.exit(0);
}

const eol = content.includes("\r\n") ? "\r\n" : "\n";
const hadFinalNewline = /\r?\n$/u.test(content);
let lines = content.split(/\r?\n/u);
if (hadFinalNewline) lines.pop();

function mappingCloseIndex(line, openIndex) {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  for (let index = openIndex; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) { escaped = false; continue; }
    if (inDouble && character === "\\") { escaped = true; continue; }
    if (!inDouble && character === "'") { inSingle = !inSingle; continue; }
    if (!inSingle && character === '"') { inDouble = !inDouble; continue; }
    if (inSingle || inDouble) continue;
    if (character === "{") { depth += 1; continue; }
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
      if (depth < 0) return -1;
    }
  }
  return -1;
}

function mappingOpenIndex(line, key) {
  if (line.trimStart().startsWith("#")) return -1;
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const entryPattern = new RegExp(
    `(?:^|[{,])\\s*(?:"${escapedKey}"|'${escapedKey}'|${escapedKey})\\s*:\\s*\\{`,
    "gu",
  );
  const hooksFlowLine = /^(?:hooks|"hooks"|'hooks')\s*:\s*\{/u.test(line);
  const expectedParentDepth = hooksFlowLine ? 1 : 0;

  for (const match of line.matchAll(entryPattern)) {
    const openIndex = match.index + match[0].lastIndexOf("{");
    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    let escaped = false;
    for (let index = 0; index < openIndex; index += 1) {
      const character = line[index];
      if (escaped) { escaped = false; continue; }
      if (inDouble && character === "\\") { escaped = true; continue; }
      if (!inDouble && character === "'") { inSingle = !inSingle; continue; }
      if (!inSingle && character === '"') { inDouble = !inDouble; continue; }
      if (inSingle || inDouble) continue;
      if (character === "{" || character === "[") depth += 1;
      if (character === "}" || character === "]") depth -= 1;
    }
    if (!inSingle && !inDouble && depth === expectedParentDepth) return openIndex;
  }
  return -1;
}

function appendFlowProperty(line, openIndex, entry) {
  const closeIndex = mappingCloseIndex(line, openIndex);
  if (closeIndex === -1) return null;
  const body = line.slice(openIndex + 1, closeIndex);
  const nextBody = body.trim().length === 0
    ? ` ${entry} `
    : `${body.replace(/\s+$/u, "")}, ${entry} `;
  return `${line.slice(0, openIndex + 1)}${nextBody}${line.slice(closeIndex)}`;
}

const hooksIndex = lines.findIndex((line) => /^(?:hooks|"hooks"|'hooks')\s*:/u.test(line));
if (hooksIndex === -1) {
  console.log("unchanged");
  process.exit(0);
}
let hooksEnd = hooksIndex + 1;
while (hooksEnd < lines.length) {
  const line = lines[hooksEnd];
  if (
    line.trim() !== "" &&
    !line.trimStart().startsWith("#") &&
    !/^\s/u.test(line)
  ) {
    break;
  }
  hooksEnd += 1;
}

let changed = false;
for (let index = hooksIndex; index < hooksEnd; index += 1) {
  const openIndex = mappingOpenIndex(lines[index], "gruff-code-quality");
  if (openIndex === -1) continue;
  const nextLine = appendFlowProperty(
    lines[index],
    openIndex,
    `binaries: { py: ${relativeBinaryPath} }`,
  );
  if (nextLine !== null) {
    lines[index] = nextLine;
    changed = true;
  }
  break;
}

if (!changed) {
  const directHookIndent = lines
    .slice(hooksIndex + 1, hooksEnd)
    .filter((line) => line.trim() !== "" && !line.trimStart().startsWith("#"))
    .map((line) => line.length - line.trimStart().length)
    .filter((indent) => indent > 0)
    .reduce((smallest, indent) => Math.min(smallest, indent), Infinity);
  const gruffIndex = lines.findIndex(
    (line, index) => {
      if (index <= hooksIndex || index >= hooksEnd) return false;
      const match = /^( *)(?:gruff-code-quality|"gruff-code-quality"|'gruff-code-quality')\s*:\s*(?:#.*)?$/u.exec(line);
      return match !== null && match[1].length === directHookIndent;
    },
  );
  if (gruffIndex !== -1) {
    let gruffEnd = gruffIndex + 1;
    while (gruffEnd < hooksEnd) {
      const line = lines[gruffEnd];
      const indent = line.length - line.trimStart().length;
      if (
        line.trim() !== "" &&
        !line.trimStart().startsWith("#") &&
        indent <= directHookIndent
      ) {
        break;
      }
      gruffEnd += 1;
    }
    const configuredFieldIndents = lines
      .slice(gruffIndex + 1, gruffEnd)
      .filter((line) => line.trim() !== "" && !line.trimStart().startsWith("#"))
      .map((line) => line.length - line.trimStart().length)
      .filter((indent) => indent > directHookIndent);
    const fieldIndent = configuredFieldIndents.length > 0
      ? Math.min(...configuredFieldIndents)
      : directHookIndent + 2;
    const indentStep = fieldIndent - directHookIndent;
    let insertAt = gruffEnd;
    const enabledIndex = lines.findIndex(
      (line, index) => {
        if (index <= gruffIndex || index >= gruffEnd) return false;
        const match = /^( *)enabled\s*:/u.exec(line);
        return match !== null && match[1].length === fieldIndent;
      },
    );
    if (enabledIndex !== -1) insertAt = enabledIndex + 1;
    lines.splice(
      insertAt,
      0,
      `${" ".repeat(fieldIndent)}binaries:`,
      `${" ".repeat(fieldIndent + indentStep)}py: ${relativeBinaryPath}`,
    );
    changed = true;
  }
}

if (!changed) {
  console.log("unchanged");
  process.exit(0);
}
fs.writeFileSync(configPath, `${lines.join(eol)}${hadFinalNewline ? eol : ""}`);
console.log("changed");
NODE
  )"; then
    echo "ERROR: could not stage Gruff binary detection for '$path'; previous destination was preserved" >&2
    discard_staged_payload
    return 1
  fi
  complete_staged_transform "$path" "$transform_result"
}

remove_config_plan_guard_entry() {
  local path="$1"
  local transform_result
  stage_existing_destination "$path"
  if ! transform_result="$(node - "$STAGED_PAYLOAD_PATH" <<'NODE'
const fs = require("node:fs");

const path = process.argv[2];
const content = fs.readFileSync(path, "utf8");
const eol = content.includes("\r\n") ? "\r\n" : "\n";
const repeatedEol = new RegExp(`(?:${eol === "\r\n" ? "\\r\\n" : "\\n"}){3,}`, "gu");
const hadFinalNewline = /\r?\n$/u.test(content);
let lines = content.split(/\r?\n/u);
if (hadFinalNewline) lines.pop();

const start = lines.findIndex((line) => /^plan-guard\s*:/u.test(line));
if (start === -1) {
  console.log("unchanged");
  process.exit(0);
}
let end = start + 1;
while (end < lines.length) {
  const line = lines[end] ?? "";
  if (line.trim() !== "" && /^[A-Za-z0-9_-]+:/u.test(line)) break;
  end += 1;
}
let prefixStart = start;
if (
  prefixStart > 0 &&
  lines[prefixStart - 1] === "# Workflow reminder settings for the plan checkbox guard."
) {
  prefixStart -= 1;
}
if (prefixStart > 0 && (lines[prefixStart - 1] ?? "").trim() === "") {
  prefixStart -= 1;
}
const next = [...lines.slice(0, prefixStart), ...lines.slice(end)]
  .join(eol)
  .replace(repeatedEol, `${eol}${eol}`);
fs.writeFileSync(path, `${next.replace(/\s+$/u, "")}${hadFinalNewline ? eol : ""}`);
console.log("changed");
NODE
  )"; then
    echo "ERROR: could not stage retired plan config cleanup for '$path'; previous destination was preserved" >&2
    discard_staged_payload
    return 1
  fi
  complete_staged_transform "$path" "$transform_result"
}

migrate_agent_hook_config() {
  local user_hook_config_path="$1"
  local desired_state_contract_path="$GOAT_FLOW_ROOT/workflow/hooks/agent-config/managed-hook-desired-state.json"
  local transform_result
  LAST_TRANSFORM_RESULT="unchanged"

  # If this provider has no existing hook config, the user has no registration surface to migrate.
  if [[ -z "$user_hook_config_path" || ! -f "$user_hook_config_path" ]]; then
    return 0
  fi
  # If the packaged contract is missing, stop before setup can write provider state that disagrees with the UI.
  if [[ ! -f "$desired_state_contract_path" ]]; then
    echo "ERROR: managed hook desired-state contract is missing: $desired_state_contract_path" >&2
    return 1
  fi

  stage_existing_destination "$user_hook_config_path"
  if ! transform_result="$(node - "$STAGED_PAYLOAD_PATH" "$desired_state_contract_path" "$AGENT" "$GOAT_FLOW_ROOT" <<'NODE'
/**
 * Reconciles one staged user hook config from the TypeScript-generated desired-state contract.
 * Use during standalone setup so enabled, disabled, duplicate, and retired rows match CLI and dashboard behavior.
 * Invalid user JSON is preserved; an invalid package contract stops installation before replacement.
 */
const childProcess = require("node:child_process");
const fs = require("node:fs");
const pathModule = require("node:path");

const [userHookConfigPath, desiredStateContractPath, agentId, frameworkRoot] =
  process.argv.slice(2);
const CONTRACT_SCHEMA = "goat-flow.managed-hook-desired-state.v1";
const yaml = require(require.resolve("js-yaml", { paths: [frameworkRoot] }));

/** Recognize JSON objects that can safely hold provider hook configuration. */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Read one JSON object, returning null when a user or package file cannot be safely merged. */
function readJsonObject(path) {
  try {
    const parsedValue = JSON.parse(fs.readFileSync(path, "utf8"));
    return isObject(parsedValue) ? parsedValue : null;
  } catch {
    // For example, an interrupted settings-file save can leave partial JSON that setup must preserve for the user to repair.
    return null;
  }
}

/** Escape a managed filename before placing it in an exact-token regular expression. */
function escapeRegularExpression(value) {
  return value.replace(/[.*+?^$(){}|[\]\\]/gu, "\\$&");
}

/**
 * Match a complete managed script token while preserving similar user filenames.
 * For example, custom-post-turn-safety.sh must not be claimed as Goat Flow state.
 */
function commandReferencesScriptToken(commandText, scriptName) {
  const escapedScriptName = escapeRegularExpression(scriptName);
  const backtick = String.fromCharCode(96);
  const scriptTokenPattern = new RegExp(
    "(?:^|[\\s\"'" +
      backtick +
      "=/\\\\])" +
      escapedScriptName +
      "(?=$|[\\s\"'" +
      backtick +
      ";|&),])",
    "mu",
  );
  return scriptTokenPattern.test(commandText);
}

/**
 * Detect a provider command owned by any current or retired managed hook script.
 * Use during install or sync so stale Windows-only registrations are replaced without touching user commands.
 *
 * @param {object} entry - provider row; null, primitive, or array values cannot be direct commands
 * @param {string[]} scriptNames - managed filenames; empty means no command belongs to Goat Flow
 * @returns {boolean} true when any platform command names a managed script; false preserves the user's row
 */
function entryReferencesManagedScript(entry, scriptNames) {
  // Null, primitive, and array values cannot be direct runnable command objects.
  if (!isObject(entry)) return false;
  // Structured exec-form rows name their script operands as argv elements, not one shell string.
  const structuredArgumentText = Array.isArray(entry.args)
    ? entry.args
        .filter((argumentValue) => typeof argumentValue === "string")
        .join("\n")
    : "";
  const commandText = [
    typeof entry.command === "string" ? entry.command : "",
    typeof entry.commandWindows === "string" ? entry.commandWindows : "",
    typeof entry.bash === "string" ? entry.bash : "",
    typeof entry.powershell === "string" ? entry.powershell : "",
    structuredArgumentText,
  ].join("\n");
  return scriptNames.some((scriptName) =>
    commandReferencesScriptToken(commandText, scriptName),
  );
}

/** Detect one exact managed command anywhere inside a provider definition. */
function valueReferencesManagedScript(value, scriptNames) {
  if (Array.isArray(value)) {
    return value.some((nestedValue) =>
      valueReferencesManagedScript(nestedValue, scriptNames),
    );
  }
  if (!isObject(value)) return false;
  if (entryReferencesManagedScript(value, scriptNames)) return true;
  return Object.values(value).some((nestedValue) =>
    valueReferencesManagedScript(nestedValue, scriptNames),
  );
}

/**
 * Remove managed commands recursively while retaining user commands in the same provider row.
 * An empty matcher wrapper disappears so the user's config does not keep a dead lifecycle entry.
 */
function withoutManagedHookCommand(entry, scriptNames) {
  // A direct exact-token match is the registration setup owns and may replace or disable.
  if (entryReferencesManagedScript(entry, scriptNames)) return undefined;
  // A null, primitive, array, or non-group object has no nested command list to reconcile.
  if (!isObject(entry) || !Array.isArray(entry.hooks)) return entry;

  const retainedHooks = entry.hooks
    .map((nestedHook) => withoutManagedHookCommand(nestedHook, scriptNames))
    .filter((nestedHook) => nestedHook !== undefined);
  // An unchanged wrapper remains byte-for-byte equivalent when setup serializes the config.
  if (retainedHooks.length === entry.hooks.length) return entry;
  // An empty wrapper no longer represents any action the user's agent can run.
  if (retainedHooks.length === 0) return undefined;
  return { ...entry, hooks: retainedHooks };
}

/** Remove owned command rows from every lifecycle event while preserving unrelated user hooks. */
function removeManagedRowsFromSharedHooks(currentHooks, scriptNames) {
  // An empty ownership list cannot identify anything setup is allowed to remove.
  if (scriptNames.length === 0) return;

  // Snapshot entries because an emptied event is removed while the user's config is traversed.
  for (const [eventName, eventEntries] of Object.entries(currentHooks)) {
    // A malformed or non-array user event remains untouched unless an enabled fragment replaces that event.
    if (!Array.isArray(eventEntries)) continue;
    const retainedEntries = eventEntries
      .map((entry) => withoutManagedHookCommand(entry, scriptNames))
      .filter((entry) => entry !== undefined);
    // No retained rows means the lifecycle event has nothing left to show or run.
    if (retainedEntries.length === 0) {
      delete currentHooks[eventName];
      continue;
    }
    // Changed nested rows replace only this event while all unrelated provider settings remain intact.
    if (JSON.stringify(retainedEntries) !== JSON.stringify(eventEntries)) {
      currentHooks[eventName] = retainedEntries;
    }
  }
}

/**
 * Read the user's explicit hook toggle, with registry defaults used before config exists.
 * The gruff-on-change alias keeps earlier user choices effective during migration.
 */
function configuredHookEnabled(hookId, defaultEnabled) {
  let configValue;
  try {
    configValue = yaml.load(
      fs.readFileSync(".goat-flow/config.yaml", "utf8"),
    );
  } catch {
    // A missing or malformed config cannot override the registry's documented default.
    return defaultEnabled === true;
  }
  if (!isObject(configValue) || !isObject(configValue.hooks)) {
    return defaultEnabled === true;
  }
  const configuredHook =
    configValue.hooks[hookId] ??
    (hookId === "gruff-code-quality"
      ? configValue.hooks["gruff-on-change"]
      : undefined);
  if (isObject(configuredHook) && typeof configuredHook.enabled === "boolean") {
    return configuredHook.enabled;
  }
  return defaultEnabled === true;
}

const singleQuote = String.fromCharCode(39);

/** Remove one YAML comment without treating quoted hash characters as comments. */
function stripYamlComment(text) {
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inDouble && character === "\\") {
      escaped = true;
      continue;
    }
    if (!inDouble && character === singleQuote) {
      if (inSingle && text[index + 1] === singleQuote) {
        index += 1;
        continue;
      }
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && character === "\"") {
      inDouble = !inDouble;
      continue;
    }
    if (
      !inSingle &&
      !inDouble &&
      character === "#" &&
      (index === 0 || /\s/u.test(text[index - 1]))
    ) {
      return text.slice(0, index).trimEnd();
    }
  }
  return text.trimEnd();
}

/** Parse one YAML string scalar accepted by the post-turn runtime parser. */
function yamlStringScalar(rawValue) {
  const value = stripYamlComment(rawValue).trim();
  if (value.length === 0) return null;
  if (value.startsWith(singleQuote) && value.endsWith(singleQuote)) {
    return value.slice(1, -1).split(singleQuote + singleQuote).join(singleQuote);
  }
  if (value.startsWith("\"") && value.endsWith("\"")) {
    try {
      const decoded = JSON.parse(value);
      return typeof decoded === "string" ? decoded : null;
    } catch {
      return null;
    }
  }
  if (
    /^(?:null|~|true|false)$/iu.test(value) ||
    /^[-+]?\d+(?:\.\d+)?$/u.test(value)
  ) {
    return null;
  }
  return value;
}

/** Parse one inline YAML string list without accepting mappings or scalar coercion. */
function yamlFlowStringList(rawValue) {
  const value = stripYamlComment(rawValue).trim();
  if (!value.startsWith("[") || !value.endsWith("]")) return null;
  const body = value.slice(1, -1);
  if (body.trim().length === 0) return [];
  const rawItems = [];
  let item = "";
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (escaped) {
      item += character;
      escaped = false;
      continue;
    }
    if (inDouble && character === "\\") {
      item += character;
      escaped = true;
      continue;
    }
    if (!inDouble && character === singleQuote) {
      item += character;
      if (inSingle && body[index + 1] === singleQuote) {
        item += body[index + 1];
        index += 1;
        continue;
      }
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && character === "\"") {
      item += character;
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && character === ",") {
      rawItems.push(item);
      item = "";
      continue;
    }
    item += character;
  }
  if (inSingle || inDouble || escaped) return null;
  rawItems.push(item);
  const parsedItems = rawItems.map(yamlStringScalar);
  return parsedItems.every((candidate) => typeof candidate === "string")
    ? parsedItems
    : null;
}

/** Count leading spaces and reject tab-indented config as ambiguous. */
function lineIndent(line) {
  if (line.includes("\t")) return -1;
  return line.length - line.trimStart().length;
}

/** Read the explicit post-turn roots from the same YAML shapes the runtime accepts. */
function configuredPostTurnScanRoots() {
  let configText;
  try {
    configText = fs.readFileSync(".goat-flow/config.yaml", "utf8");
  } catch {
    return null;
  }
  const lines = configText.replace(/\r\n?/gu, "\n").split("\n");
  const hooksIndex = lines.findIndex(
    (line) =>
      lineIndent(line) === 0 && stripYamlComment(line).trim() === "hooks:",
  );
  if (hooksIndex < 0) return null;
  let hooksEnd = lines.length;
  for (let index = hooksIndex + 1; index < lines.length; index += 1) {
    const cleanLine = stripYamlComment(lines[index]);
    if (cleanLine.trim().length > 0 && lineIndent(lines[index]) <= 0) {
      hooksEnd = index;
      break;
    }
  }
  let hookIndex = -1;
  let hookIndent = -1;
  for (let index = hooksIndex + 1; index < hooksEnd; index += 1) {
    const indent = lineIndent(lines[index]);
    if (
      indent > 0 &&
      stripYamlComment(lines[index]).trim() === "post-turn-safety:"
    ) {
      hookIndex = index;
      hookIndent = indent;
      break;
    }
  }
  if (hookIndex < 0) return null;
  for (let index = hookIndex + 1; index < hooksEnd; index += 1) {
    const cleanLine = stripYamlComment(lines[index]);
    const trimmedLine = cleanLine.trim();
    if (trimmedLine.length === 0) continue;
    const indent = lineIndent(lines[index]);
    if (indent <= hookIndent) break;
    const fieldMatch = /^scan-roots:\s*(.*)$/u.exec(trimmedLine);
    if (!fieldMatch) continue;
    const inlineValue = fieldMatch[1].trim();
    if (inlineValue.length > 0) return yamlFlowStringList(inlineValue);
    const roots = [];
    for (
      let rootIndex = index + 1;
      rootIndex < hooksEnd;
      rootIndex += 1
    ) {
      const rootLine = stripYamlComment(lines[rootIndex]);
      if (rootLine.trim().length === 0) continue;
      if (lineIndent(lines[rootIndex]) <= indent) break;
      const itemMatch = /^-\s+(.+)$/u.exec(rootLine.trim());
      if (!itemMatch) return null;
      const root = yamlStringScalar(itemMatch[1]);
      if (root === null) return null;
      roots.push(root);
    }
    return roots;
  }
  return null;
}

/** Resolve one existing directory physically, or return null on any lookup failure. */
function physicalDirectory(directoryPath) {
  try {
    if (!fs.statSync(directoryPath).isDirectory()) return null;
    return fs.realpathSync(directoryPath);
  } catch {
    return null;
  }
}

/** Read one bounded physical Git top level without mutating the target. */
function gitTopLevel(directoryPath) {
  const result = childProcess.spawnSync(
    "git",
    ["-C", directoryPath, "rev-parse", "--show-toplevel"],
    {
      encoding: "utf8",
      shell: false,
      timeout: 5000,
      maxBuffer: 16384,
      windowsHide: true,
    },
  );
  if (
    result.error ||
    result.status !== 0 ||
    typeof result.stdout !== "string" ||
    result.stdout.trim().length === 0
  ) {
    return null;
  }
  return physicalDirectory(result.stdout.trim());
}

/** Return whether a relative-path result escapes the root it was measured from. */
function relativePathEscapesRoot(relativePath) {
  return (
    relativePath === ".." ||
    relativePath.startsWith("../") ||
    relativePath.startsWith("..\\") ||
    pathModule.isAbsolute(relativePath)
  );
}

/** Read one directory's device and inode/file ID, or null when the host cannot prove identity. */
function filesystemDirectoryIdentity(directoryPath) {
  try {
    const stats = fs.statSync(directoryPath, { bigint: true });
    if (!stats.isDirectory() || stats.ino === 0n) return null;
    return { device: stats.dev, inode: stats.ino };
  } catch {
    return null;
  }
}

/** Compare physical spellings first, then exact identity for aliases such as Windows short paths. */
function filesystemPathsAreEquivalent(leftDirectory, rightDirectory) {
  if (!leftDirectory || !rightDirectory) return false;
  const spellingsMatch =
    pathModule.relative(leftDirectory, rightDirectory) === "" &&
    pathModule.relative(rightDirectory, leftDirectory) === "";
  if (spellingsMatch) return true;

  const leftIdentity = filesystemDirectoryIdentity(leftDirectory);
  const rightIdentity = filesystemDirectoryIdentity(rightDirectory);
  return (
    leftIdentity !== null &&
    rightIdentity !== null &&
    leftIdentity.device === rightIdentity.device &&
    leftIdentity.inode === rightIdentity.inode
  );
}

/** Validate one configured root against lexical, physical, and exact Git ownership. */
function isContainedGitScanRoot(projectRoot, configuredRoot) {
  if (
    typeof configuredRoot !== "string" ||
    configuredRoot.length === 0 ||
    pathModule.isAbsolute(configuredRoot) ||
    /^[A-Za-z]:[\\/]/u.test(configuredRoot) ||
    /^\\\\/u.test(configuredRoot)
  ) {
    return false;
  }
  const lexicalCandidate = pathModule.resolve(projectRoot, configuredRoot);
  const lexicalRelative = pathModule.relative(projectRoot, lexicalCandidate);
  if (relativePathEscapesRoot(lexicalRelative)) return false;
  const physicalCandidate = physicalDirectory(lexicalCandidate);
  if (physicalCandidate === null) return false;
  const physicalRelative = pathModule.relative(projectRoot, physicalCandidate);
  if (relativePathEscapesRoot(physicalRelative)) return false;
  return filesystemPathsAreEquivalent(
    gitTopLevel(physicalCandidate),
    physicalCandidate,
  );
}

/** Apply the registrar's implicit-Git or all-explicit-roots registration contract. */
function postTurnRootContractAllowsRegistration() {
  const projectRoot = physicalDirectory(process.cwd());
  if (projectRoot === null) return false;
  if (filesystemPathsAreEquivalent(gitTopLevel(projectRoot), projectRoot)) {
    return true;
  }
  const configuredRoots = configuredPostTurnScanRoots();
  return (
    Array.isArray(configuredRoots) &&
    configuredRoots.length > 0 &&
    configuredRoots.every((configuredRoot) =>
      isContainedGitScanRoot(projectRoot, configuredRoot),
    )
  );
}

/** Hooks already explained once, so a repeated registration pass cannot repeat the notice. */
const explainedBlockedHookIds = new Set();

/**
 * Tell the user why an enabled hook was left unregistered, using the package contract's wording.
 * Losing a safety hook during an upgrade is invisible otherwise, so this prints once per hook.
 */
function explainBlockedRegistration(hookId, hookContract) {
  if (explainedBlockedHookIds.has(hookId)) return;
  explainedBlockedHookIds.add(hookId);
  const prerequisite = hookContract.registrationPrerequisite;
  // A contract without prerequisite prose has nothing truthful to add beyond the skipped registration.
  if (!isObject(prerequisite)) return;
  // stdout carries the migrated/unchanged protocol word, so user-facing prose goes to stderr.
  console.error(`  ! ${hookId} not registered: ${prerequisite.reason}`);
  console.error(`    fix: ${prerequisite.remediation}`);
}

/** Combine the user's toggle with any hook-specific registration prerequisite. */
function shouldRegisterManagedHook(hookId, hookContract) {
  if (!configuredHookEnabled(hookId, hookContract.defaultEnabled)) return false;
  if (hookId !== "post-turn-safety") return true;
  if (postTurnRootContractAllowsRegistration()) return true;
  explainBlockedRegistration(hookId, hookContract);
  return false;
}

/** Validate the generated package contract before it can influence a user's config. */
function readDesiredStateContract(path) {
  const contract = readJsonObject(path);
  // Missing, invalid, or stale-schema package data cannot safely define provider registrations.
  if (
    !contract ||
    contract.schema !== CONTRACT_SCHEMA ||
    !isObject(contract.agents) ||
    !Array.isArray(contract.retiredHookIds) ||
    !Array.isArray(contract.retiredHookScriptNames)
  ) {
    throw new Error("managed hook desired-state contract is invalid");
  }
  return contract;
}

/** Return validated hook rows for the selected provider, rejecting incomplete generated state. */
function managedHookEntries(agentContract) {
  const hookEntries = Object.entries(agentContract.hooks);
  // Every generated hook row declares support and cleanup ownership before optional enabled state.
  for (const [hookId, hookContract] of hookEntries) {
    const cleanup = isObject(hookContract) ? hookContract.cleanup : null;
    if (
      !hookId ||
      !isObject(hookContract) ||
      typeof hookContract.supported !== "boolean" ||
      !isObject(cleanup) ||
      !Array.isArray(cleanup.hookIds) ||
      !Array.isArray(cleanup.commandScriptNames)
    ) {
      throw new Error(
        "managed hook desired-state contract has an invalid hook row",
      );
    }
    // Unsupported rows carry cleanup only, preventing this provider from receiving unusable config.
    if (!hookContract.supported) continue;
    if (
      typeof hookContract.defaultEnabled !== "boolean" ||
      !Array.isArray(hookContract.commandScriptNames) ||
      !Array.isArray(hookContract.managedScriptFiles) ||
      !Array.isArray(hookContract.registrationTargets) ||
      !isObject(hookContract.config)
    ) {
      throw new Error(
        "managed hook desired-state contract has an invalid hook row",
      );
    }
  }
  return hookEntries;
}

/**
 * Append one enabled shared-provider fragment after all owned rows have been removed.
 * Non-hook metadata is repaired only when its type is invalid, preserving valid user values.
 */
function appendSharedHookFragment(currentConfig, hookConfigFragment) {
  // A missing, null, or malformed hooks value cannot contain the lifecycle rows the user enabled.
  if (!isObject(currentConfig.hooks)) currentConfig.hooks = {};
  // A generated shared-provider fragment always carries its registrations under hooks.
  if (!isObject(hookConfigFragment.hooks)) {
    throw new Error("managed hook config fragment has no hooks object");
  }

  // Each generated lifecycle array is already the exact provider shape produced by the TypeScript writer.
  for (const [eventName, managedEntries] of Object.entries(
    hookConfigFragment.hooks,
  )) {
    // A malformed artifact event cannot safely become executable user configuration.
    if (!Array.isArray(managedEntries)) {
      throw new Error("managed hook config fragment has an invalid event");
    }
    const currentEntries = Array.isArray(currentConfig.hooks[eventName])
      ? currentConfig.hooks[eventName]
      : [];
    currentConfig.hooks[eventName] = [...currentEntries, ...managedEntries];
  }

  // Provider metadata such as Copilot's numeric version is seeded without replacing a valid user-selected value.
  for (const [propertyName, propertyValue] of Object.entries(
    hookConfigFragment,
  )) {
    // Hook rows were merged above so user-owned rows remain present.
    if (propertyName === "hooks") continue;
    // A missing or malformed metadata value receives the generated value; a valid same-type value remains user-owned.
    if (typeof currentConfig[propertyName] !== typeof propertyValue) {
      currentConfig[propertyName] = propertyValue;
    }
  }
}

const desiredStateContract = readDesiredStateContract(
  desiredStateContractPath,
);
const agentContract = desiredStateContract.agents[agentId];
// An unknown or incomplete provider contract would otherwise leave the selected user's setup half-migrated.
if (!isObject(agentContract) || !isObject(agentContract.hooks)) {
  throw new Error(
    "managed hook desired-state contract has no selected agent",
  );
}
const hookEntries = managedHookEntries(agentContract);
const supportedHookEntries = hookEntries.filter(
  ([, hookContract]) => hookContract.supported,
);
const currentConfig = readJsonObject(userHookConfigPath);
// Invalid user JSON remains untouched so setup never replaces settings the user needs to repair.
if (!currentConfig) {
  console.log("unchanged");
  process.exit(0);
}
const originalConfig = JSON.stringify(currentConfig);

// Antigravity stores managed hook definitions as top-level ids instead of shared lifecycle arrays.
if (agentId === "antigravity") {
  const managedHookIds = new Set([
    ...hookEntries.flatMap(([, hookContract]) => hookContract.cleanup.hookIds),
    ...desiredStateContract.retiredHookIds,
  ]);
  const managedScriptNames = [
    ...new Set(
      hookEntries.flatMap(
        ([, hookContract]) => hookContract.cleanup.commandScriptNames,
      ),
    ),
  ];
  // Exact command ownership removes renamed definitions as well as canonical current and retired ids.
  for (const [definitionId, definition] of Object.entries(currentConfig)) {
    if (
      managedHookIds.has(definitionId) ||
      valueReferencesManagedScript(definition, managedScriptNames)
    ) {
      delete currentConfig[definitionId];
    }
  }
  // Enabled provider fragments restore exactly one current definition after stale ids are removed.
  for (const [hookId, hookContract] of supportedHookEntries) {
    // A disabled user choice leaves the current files installed but no runnable registration.
    if (!shouldRegisterManagedHook(hookId, hookContract)) continue;
    Object.assign(currentConfig, hookContract.config);
  }
} else {
  // A missing, null, or malformed hooks container becomes the safe shared surface used by enabled fragments.
  if (!isObject(currentConfig.hooks)) currentConfig.hooks = {};
  removeManagedRowsFromSharedHooks(
    currentConfig.hooks,
    desiredStateContract.retiredHookScriptNames,
  );
  // Every supported current hook is removed from all events before its user-selected state is rebuilt.
  for (const [, hookContract] of hookEntries) {
    removeManagedRowsFromSharedHooks(
      currentConfig.hooks,
      hookContract.cleanup.commandScriptNames,
    );
  }
  // Enabled hooks append one generated provider fragment; disabled hooks remain installed but inert.
  for (const [hookId, hookContract] of supportedHookEntries) {
    // The config toggle is the user's authority over whether their agent runs this hook.
    if (!shouldRegisterManagedHook(hookId, hookContract)) continue;
    appendSharedHookFragment(currentConfig, hookContract.config);
  }
}

const nextConfig = JSON.stringify(currentConfig);
// Identical desired state avoids rewriting a settings file the user did not change.
if (nextConfig === originalConfig) {
  console.log("unchanged");
  process.exit(0);
}

fs.writeFileSync(userHookConfigPath, JSON.stringify(currentConfig, null, 2) + "\n");
console.log("changed");
NODE
  )"; then
    echo "ERROR: could not stage hook registration migration for '$user_hook_config_path'; previous destination was preserved" >&2
    discard_staged_payload
    return 1
  fi
  complete_staged_transform "$user_hook_config_path" "$transform_result"
}

migrate_codex_hooks_feature_flag() {
  local path="$1"
  local transform_result
  stage_existing_destination "$path"
  if ! transform_result="$(node - "$STAGED_PAYLOAD_PATH" <<'NODE'
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
  )"; then
    echo "ERROR: could not stage Codex hook flag migration for '$path'; previous destination was preserved" >&2
    discard_staged_payload
    return 1
  fi
  complete_staged_transform "$path" "$transform_result"
}

migrate_codex_filesystem_permissions() {
  local path="$1"
  local transform_result
  stage_existing_destination "$path"
  if ! transform_result="$(node - "$STAGED_PAYLOAD_PATH" <<'NODE'
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
  "**/.env",
  "**/.env.local",
  "**/.env.development",
  "**/.env.production",
  "**/.env.staging",
  "**/.env.test",
  "**/.envrc",
  "**/.env.*.local",
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
  "**/.env*",
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
  "# Deny rules win over allow/read rules on both Codex and Claude, so a broad",
  "# .env* deny cannot be re-opened for the sample file. Real env variants are",
  "# denied individually so .env.example stays readable, matching the Bash deny",
  "# hook; nonstandard variants (e.g. .env.backup) are covered by that hook.",
  '"**/.env" = "deny"',
  '"**/.env.local" = "deny"',
  '"**/.env.development" = "deny"',
  '"**/.env.production" = "deny"',
  '"**/.env.staging" = "deny"',
  '"**/.env.test" = "deny"',
  '"**/.envrc" = "deny"',
  '"**/.env.*.local" = "deny"',
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
  )"; then
    echo "ERROR: could not stage Codex permission migration for '$path'; previous destination was preserved" >&2
    discard_staged_payload
    return 1
  fi
  complete_staged_transform "$path" "$transform_result"
}

# Repair the permission rule arrays (deny/allow/ask) of an existing
# .claude/settings.json so they stop printing Claude Code launch warnings and
# match the current env policy. Three stale rule classes:
#   - MultiEdit(...) rules ("matches no known tool" - Claude Code v2.x removed
#     MultiEdit, folded into Edit): dropped.
#   - Write/NotebookEdit/Glob path rules ("not matched by file permission
#     checks - only Edit(path) rules are"; Edit covers all file-editing tools,
#     Read covers reads): rewritten to the matched equivalent, or dropped when
#     the covering rule already exists.
#   - The broad Read(**/.env*) and Edit(**/.env*) denies (shadowed the shipped
#     .env.example allow and blocked sample-file edits - deny wins): expanded
#     to the enumerated real env variants, deny only.
# Remove/rewrite-list (not allow-list) on purpose: never touch user-added
# rules for valid matched tools (Bash, Read, Edit, WebFetch, mcp__*). Keep
# REMOVED_CLAUDE_TOOLS, UNMATCHED_RULE_REWRITES, and ENV_DENY_EXPANSIONS
# in sync with test/unit/agent-config-template-parity.test.ts. Untouched rules
# keep their exact position; writes back only when a rule was actually
# removed, rewritten, or expanded, so already-clean files are never
# reformatted. Echoes "migrated" or "unchanged".
migrate_claude_permission_deny() {
  local path="$1"
  local transform_result
  stage_existing_destination "$path"
  if ! transform_result="$(node - "$STAGED_PAYLOAD_PATH" <<'NODE'
const fs = require("node:fs");
const path = process.argv[2];

const REMOVED_CLAUDE_TOOLS = new Set(["MultiEdit"]);
// Permission checks only match Edit(path)/Read(path) file rules; these forms
// warn at launch and enforce nothing, so rewrite them to the covering tool.
const UNMATCHED_RULE_REWRITES = new Map([
  ["Write", "Edit"],
  ["NotebookEdit", "Edit"],
  ["Glob", "Read"],
]);
// Deny rules win over allow rules, so the broad env read deny silently
// blocked .env.example despite the shipped allow entries, and the broad env
// edit deny blocked sample-file writes. Expand both to the enumerated real
// env variants; .env.example then matches no deny.
const ENV_DENY_EXPANSIONS = new Map([
  [
    "Read(**/.env*)",
    [
      "Read(**/.env)",
      "Read(**/.env.local)",
      "Read(**/.env.development)",
      "Read(**/.env.production)",
      "Read(**/.env.staging)",
      "Read(**/.env.test)",
      "Read(**/.envrc)",
      "Read(**/.env.*.local)",
    ],
  ],
  [
    "Edit(**/.env*)",
    [
      "Edit(**/.env)",
      "Edit(**/.env.local)",
      "Edit(**/.env.development)",
      "Edit(**/.env.production)",
      "Edit(**/.env.staging)",
      "Edit(**/.env.test)",
      "Edit(**/.envrc)",
      "Edit(**/.env.*.local)",
    ],
  ],
]);

let raw;
try {
  raw = fs.readFileSync(path, "utf8");
} catch {
  console.log("unchanged");
  process.exit(0);
}

let settings;
try {
  settings = JSON.parse(raw);
} catch {
  // Not JSON we can safely rewrite; leave it for the user.
  console.log("unchanged");
  process.exit(0);
}

const perms = settings && settings.permissions;
if (!perms || typeof perms !== "object") {
  console.log("unchanged");
  process.exit(0);
}

// Split a permission rule into tool name and path pattern; null for non-rules.
const parseRule = (entry) =>
  typeof entry === "string" ? entry.match(/^([A-Za-z]+)\((.*)\)$/u) : null;

// Return replacement entries for a stale rule, or null to keep it untouched.
const replacementsFor = (entry, expandEnv) => {
  if (expandEnv && ENV_DENY_EXPANSIONS.has(entry)) {
    return ENV_DENY_EXPANSIONS.get(entry);
  }
  const rule = parseRule(entry);
  if (rule && UNMATCHED_RULE_REWRITES.has(rule[1])) {
    return [`${UNMATCHED_RULE_REWRITES.get(rule[1])}(${rule[2]})`];
  }
  return null;
};

// Drop removed-tool rules, rewrite/expand stale forms, and dedupe against
// rules already present. Untouched rules keep their exact position. Returns
// the repaired array, or null when nothing changed.
const repairRules = (rules, expandEnv) => {
  if (!Array.isArray(rules)) return null;
  const survivors = rules.filter((entry) => {
    const rule = parseRule(entry);
    return !(rule && REMOVED_CLAUDE_TOOLS.has(rule[1]));
  });
  const present = new Set(
    survivors.filter((entry) => replacementsFor(entry, expandEnv) === null),
  );
  const kept = [];
  for (const entry of survivors) {
    const replacements = replacementsFor(entry, expandEnv);
    if (replacements === null) {
      kept.push(entry);
      continue;
    }
    for (const replacement of replacements) {
      if (present.has(replacement)) continue;
      present.add(replacement);
      kept.push(replacement);
    }
  }
  const changed =
    kept.length !== rules.length ||
    kept.some((entry, index) => entry !== rules[index]);
  return changed ? kept : null;
};

let migrated = false;
// Env expansion applies to deny only: expanding an allow would revoke the
// user's .env.example read intent instead of preserving it.
for (const [arrayName, expandEnv] of [
  ["deny", true],
  ["allow", false],
  ["ask", false],
]) {
  const repaired = repairRules(perms[arrayName], expandEnv);
  if (repaired) {
    perms[arrayName] = repaired;
    migrated = true;
  }
}

if (!migrated) {
  console.log("unchanged");
  process.exit(0);
}
const eol = raw.includes("\r\n") ? "\r\n" : "\n";
const hadFinalNewline = /\r?\n$/u.test(raw);
let out = JSON.stringify(settings, null, 2);
if (eol === "\r\n") out = out.replace(/\n/gu, "\r\n");
fs.writeFileSync(path, out + (hadFinalNewline ? eol : ""));
console.log("migrated");
NODE
  )"; then
    echo "ERROR: could not stage Claude permission migration for '$path'; previous destination was preserved" >&2
    discard_staged_payload
    return 1
  fi
  complete_staged_transform "$path" "$transform_result"
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

# The shared setup root must be local before migrations or directory scaffolding can write.
assert_safe_installer_directory ".goat-flow"

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
for dir in .goat-flow/learning-loop/footguns .goat-flow/learning-loop/lessons .goat-flow/learning-loop/patterns .goat-flow/learning-loop/decisions .goat-flow/plans .goat-flow/scratchpad .goat-flow/write-claims .goat-flow/logs/sessions .goat-flow/logs/quality .goat-flow/logs/events .goat-flow/logs/critiques .goat-flow/logs/review .goat-flow/logs/security .goat-flow/skill-docs .goat-flow/skill-docs/playbooks .goat-flow/skill-docs/skill-quality-testing .goat-flow/hooks .goat-flow/hooks/deny-dangerous; do
  assert_safe_installer_directory "$dir"
  # Missing safe directories are created for the user's local workflow surfaces.
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
copy_file "$GOAT_FLOW_ROOT/workflow/setup/reference/session-logs-readme.md" ".goat-flow/logs/sessions/README.md"
copy_if_missing "$GOAT_FLOW_ROOT/workflow/setup/reference/decisions-readme.md" ".goat-flow/learning-loop/decisions/README.md"
touch_anchor ".goat-flow/logs/sessions/.gitkeep"
echo ""

# ==========================================================================
# 3b. Maintain project root .gitignore (append-only)
# ==========================================================================
echo "Project .gitignore:"
ensure_gitignore_entry ".gitignore" "node_modules/"
# A changed result means the user can now keep dependency installs out of version control.
if [[ "$LAST_TRANSFORM_RESULT" == "changed" ]]; then
  COPIED=$((COPIED + 1))
  echo "  ✓ .gitignore (node_modules/ ignored)"
else
  SKIPPED=$((SKIPPED + 1))
  echo "  · .gitignore (node_modules/ already ignored)"
fi
echo ""

# ==========================================================================
# 4. Sweep transitional skill-doc files from older installed layouts.
#    Current installs keep doctrine at .goat-flow/skill-docs/, standalone
#    playbooks at .goat-flow/skill-docs/playbooks/, and skill-authoring
#    methodology at .goat-flow/skill-docs/skill-quality-testing/.
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
    if [[ "$legacy_file" == ".goat-flow/skill-docs/skill-quality-testing.md" ]]; then
      echo "  ✓ migrated $legacy_file → .goat-flow/skill-docs/skill-quality-testing/README.md"
    else
      echo "  ✓ migrated $legacy_file → .goat-flow/skill-docs/playbooks/"
    fi
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
copy_file "$GOAT_FLOW_ROOT/workflow/skills/playbooks/hook-policy-testing.md" ".goat-flow/skill-docs/playbooks/hook-policy-testing.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/playbooks/naming-and-placement.md" ".goat-flow/skill-docs/playbooks/naming-and-placement.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/playbooks/observability.md" ".goat-flow/skill-docs/playbooks/observability.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/playbooks/changelog.md" ".goat-flow/skill-docs/playbooks/changelog.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/playbooks/page-capture.md" ".goat-flow/skill-docs/playbooks/page-capture.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/playbooks/release-notes.md" ".goat-flow/skill-docs/playbooks/release-notes.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/playbooks/skill-playbook-authoring-sync.md" ".goat-flow/skill-docs/playbooks/skill-playbook-authoring-sync.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/playbooks/test-selection.md" ".goat-flow/skill-docs/playbooks/test-selection.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/playbooks/writing-agent-facing-instructions.md" ".goat-flow/skill-docs/playbooks/writing-agent-facing-instructions.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/playbooks/writing-sentence-diagnostics.md" ".goat-flow/skill-docs/playbooks/writing-sentence-diagnostics.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/playbooks/writing-structure-diagnostics.md" ".goat-flow/skill-docs/playbooks/writing-structure-diagnostics.md"
copy_file "$GOAT_FLOW_ROOT/workflow/skills/playbooks/writing-human-facing-prose.md" ".goat-flow/skill-docs/playbooks/writing-human-facing-prose.md"
for retired_writing_playbook in \
  ".goat-flow/skill-docs/playbooks/writing-for-agents.md" \
  ".goat-flow/skill-docs/playbooks/writing-style.md"; do
  if [[ -f "$retired_writing_playbook" ]]; then
    rm -f "$retired_writing_playbook"
    echo "  - removed retired $retired_writing_playbook"
  fi
done
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
# 6b. Remove deprecated skills (only with --clean-deprecated)
# ==========================================================================
if $CLEAN_DEPRECATED; then
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
# 7. Scaffold or migrate config.yaml before hook registration reads it
# ==========================================================================
echo "Config:"
CONFIG_PATH=".goat-flow/config.yaml"
assert_file_ownership "$CONFIG_PATH" "user-owned"

# Existing config keeps user-selected hooks and skills while narrow migrations repair retired shapes.
if [[ -f "$CONFIG_PATH" ]]; then
  CONFIG_CHANGED=false
  CONFIG_NOTES=()
  if $UPDATE_CONFIG_VERSION; then
    if grep -q "^version:" "$CONFIG_PATH"; then
      update_config_version_line "$CONFIG_PATH"
      CONFIG_CHANGED=true
      CONFIG_NOTES+=("version updated to $VERSION")
    else
      stage_existing_destination "$CONFIG_PATH"
      printf 'version: "%s"\n' "$VERSION" >> "$STAGED_PAYLOAD_PATH"
      commit_staged_payload "$CONFIG_PATH" "replace"
      CONFIG_CHANGED=true
      CONFIG_NOTES+=("version field added: $VERSION")
    fi
  fi
  remove_config_agents_entry "$CONFIG_PATH"
  # A changed result removes a legacy agent allowlist that no longer controls setup.
  if [[ "$LAST_TRANSFORM_RESULT" == "changed" ]]; then
    CONFIG_CHANGED=true
    CONFIG_NOTES+=("legacy agents allowlist removed")
  fi
  migrate_config_tasks_entry "$CONFIG_PATH"
  # A changed result points planning workflows at the current local-state directory.
  if [[ "$LAST_TRANSFORM_RESULT" == "changed" ]]; then
    CONFIG_CHANGED=true
    CONFIG_NOTES+=("legacy tasks config migrated to plans")
  fi
  ensure_config_hooks_entry "$CONFIG_PATH"
  # A changed result gives users explicit controls for each shipped hook.
  if [[ "$LAST_TRANSFORM_RESULT" == "changed" ]]; then
    CONFIG_CHANGED=true
    CONFIG_NOTES+=("hook toggles added")
  fi
  ensure_config_gruff_binary_entry "$CONFIG_PATH"
  # Detection persists one reviewed project convention without widening runtime discovery.
  if [[ "$LAST_TRANSFORM_RESULT" == "changed" ]]; then
    CONFIG_CHANGED=true
    CONFIG_NOTES+=("strands_agents gruff-py path detected")
  fi
  remove_config_plan_guard_entry "$CONFIG_PATH"
  # A changed result removes configuration for the retired plan guard.
  if [[ "$LAST_TRANSFORM_RESULT" == "changed" ]]; then
    CONFIG_CHANGED=true
    CONFIG_NOTES+=("removed retired plan guard config")
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
  prepare_staged_payload "$CONFIG_PATH"
  printf 'version: "%s"\n\nskills:\n  install: all\n\nhooks:\n  deny-dangerous:\n    enabled: true\n  post-turn-safety:\n    enabled: true\n  gruff-code-quality:\n    enabled: false\n' "$VERSION" > "$STAGED_PAYLOAD_PATH"
  # A first install may scaffold config, but a concurrent or existing user file wins.
  commit_staged_payload "$CONFIG_PATH" "create-only"
  COPIED=$((COPIED + 1))
  ensure_config_gruff_binary_entry "$CONFIG_PATH"
  if [[ "$LAST_TRANSFORM_RESULT" == "changed" ]]; then
    echo "  ✓ $CONFIG_PATH (scaffolded; strands_agents gruff-py path detected)"
  else
    echo "  ✓ $CONFIG_PATH (scaffolded)"
  fi
fi
echo ""

# ==========================================================================
# 8. Install hooks (always overwrite - verbatim copy)
# ==========================================================================
if $HOOKS_ENABLED; then
  echo "Hooks → $HOOKS_DIR/:"
  copy_file "$GOAT_FLOW_ROOT/workflow/hooks/run-with-bash.mjs" "$HOOKS_DIR/run-with-bash.mjs" "system-owned" "755"
  copy_file "$GOAT_FLOW_ROOT/workflow/hooks/hook-provider-adapters.mjs" "$HOOKS_DIR/hook-provider-adapters.mjs" "system-owned" "755"
  copy_file "$GOAT_FLOW_ROOT/workflow/hooks/hook-launch-runtime.mjs" "$HOOKS_DIR/hook-launch-runtime.mjs" "system-owned" "755"
  copy_file "$GOAT_FLOW_ROOT/workflow/hooks/deny-dangerous.sh" "$HOOKS_DIR/deny-dangerous.sh" "system-owned" "755"
  copy_file "$GOAT_FLOW_ROOT/workflow/hooks/gruff-code-quality.sh" "$HOOKS_DIR/gruff-code-quality.sh" "system-owned" "755"
  copy_file "$GOAT_FLOW_ROOT/workflow/hooks/post-turn-safety.sh" "$HOOKS_DIR/post-turn-safety.sh" "system-owned" "755"
  prune_unlisted_hook_files "$HOOKS_DIR"
  prune_legacy_agent_hook_copies
  echo "Hook policy → .goat-flow/hooks/deny-dangerous/:"
  for hook_policy_script in \
    patterns-shell.sh \
    patterns-paths.sh \
    patterns-writes.sh \
    deny-dangerous-self-test.sh
  do
    copy_file "$GOAT_FLOW_ROOT/workflow/hooks/deny-dangerous/$hook_policy_script" ".goat-flow/hooks/deny-dangerous/$hook_policy_script" "system-owned" "755"
  done
  ensure_gitignore_entry ".goat-flow/.gitignore" "!hooks/"
  # A changed result makes the shipped hook directory visible to version control.
  if [[ "$LAST_TRANSFORM_RESULT" == "changed" ]]; then
    COPIED=$((COPIED + 1))
    echo "  ✓ .goat-flow/.gitignore (hooks/ un-ignored)"
  fi
  ensure_gitignore_entry ".goat-flow/.gitignore" "!**/hooks/**"
  # A changed result makes each shipped hook file visible to version control.
  if [[ "$LAST_TRANSFORM_RESULT" == "changed" ]]; then
    COPIED=$((COPIED + 1))
    echo "  ✓ .goat-flow/.gitignore (hooks/** un-ignored)"
  fi
  if [[ -n "${HOOK_CONFIG_DST:-}" && -n "${HOOK_CONFIG_SRC:-}" ]]; then
    echo "Hooks config:"
    copy_if_missing "$GOAT_FLOW_ROOT/$HOOK_CONFIG_SRC" "$HOOK_CONFIG_DST"
    migrate_agent_hook_config "$HOOK_CONFIG_DST"
    # A changed registration makes the central guardrail active for the selected agent.
    if [[ "$LAST_TRANSFORM_RESULT" == "changed" ]]; then
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
# 9. Install or safely migrate agent settings without replacing user choices
# ==========================================================================
echo "Settings:"
SETTINGS_SKIPPED=false
if [[ -n "${SETTINGS_SRC:-}" && -n "${SETTINGS_DST:-}" ]]; then
  # Existing settings receive narrow migrations; a managed force refresh cannot replace the user's permissions or comments.
  if [[ -f "$SETTINGS_DST" ]]; then
    SETTINGS_MIGRATIONS=()
    if [[ "$AGENT" == "codex" ]]; then
      migrate_codex_hooks_feature_flag "$SETTINGS_DST"
      # A migrated result means Codex will recognize the current hooks feature name.
      if [[ "$LAST_TRANSFORM_RESULT" == "migrated" ]]; then
        SETTINGS_MIGRATIONS+=("deprecated hooks flag")
      fi
      migrate_codex_filesystem_permissions "$SETTINGS_DST"
      # A migrated result means Codex can load the canonical secret-path policy.
      if [[ "$LAST_TRANSFORM_RESULT" == "migrated" ]]; then
        SETTINGS_MIGRATIONS+=("Codex permission profile")
      fi
    elif [[ "$AGENT" == "claude" ]]; then
      migrate_claude_permission_deny "$SETTINGS_DST"
      # A migrated result removes launch warnings (removed tools, unmatched
      # Write/NotebookEdit/Glob rules) and applies the enumerated env policy.
      if [[ "$LAST_TRANSFORM_RESULT" == "migrated" ]]; then
        SETTINGS_MIGRATIONS+=("stale or superseded permission rules")
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
    copy_file "$GOAT_FLOW_ROOT/$SETTINGS_SRC" "$SETTINGS_DST" "user-owned"
  fi
else
  echo "  · no settings file for $AGENT"
fi
# Personal Claude overrides carry the same shipped rule shapes; repair them too.
if [[ "$AGENT" == "claude" && -n "${SETTINGS_DST:-}" ]]; then
  SETTINGS_LOCAL_DST="${SETTINGS_DST%.json}.local.json"
  if [[ -f "$SETTINGS_LOCAL_DST" ]]; then
    migrate_claude_permission_deny "$SETTINGS_LOCAL_DST"
    if [[ "$LAST_TRANSFORM_RESULT" == "migrated" ]]; then
      COPIED=$((COPIED + 1))
      echo "  ✓ $SETTINGS_LOCAL_DST (migrated: stale or superseded permission rules)"
    fi
  fi
fi
if [[ "$AGENT" == "codex" && -n "${SETTINGS_DST:-}" && -f "$SETTINGS_DST" ]]; then
  CODEX_VALIDATION="$(validate_codex_settings_after_install "$SETTINGS_DST")"
  if [[ "$CODEX_VALIDATION" != "ok" ]]; then
    echo ""
    echo "ERROR: $SETTINGS_DST still has invalid Codex permission entries:" >&2
    echo "  ${CODEX_VALIDATION#invalid:}" >&2
    echo "Codex will reject this config at startup. Edit the user-owned file" >&2
    echo "so the active goat-flow profile extends \":workspace\" and uses" >&2
    echo "access=\"deny\" for secret-path filesystem entries." >&2
    exit 1
  fi
fi
if $HOOKS_ENABLED && [[ -z "${HOOK_CONFIG_DST:-}" && -n "${SETTINGS_DST:-}" && -n "${SETTINGS_SRC:-}" && -f "$SETTINGS_DST" ]]; then
  migrate_agent_hook_config "$SETTINGS_DST"
  # A changed embedded registration makes the central guardrail active for this agent.
  if [[ "$LAST_TRANSFORM_RESULT" == "changed" ]]; then
    COPIED=$((COPIED + 1))
    SETTINGS_SKIPPED=false
    echo "  ✓ $SETTINGS_DST (migrated deny hook registration)"
  fi
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
if [[ -f "$ACTIVE_FILE" ]]; then
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
    prepare_staged_payload "$ACTIVE_FILE"
    printf '%s\n' "${version_subdirs[0]}" > "$STAGED_PAYLOAD_PATH"
    # Setup suggests an unambiguous first marker but never overrides the user's selected plan.
    commit_staged_payload "$ACTIVE_FILE" "create-only"
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
echo "HELPER DONE: $COPIED files copied, $SKIPPED skipped, $REMOVED stale removed"
echo "The public goat-flow CLI verifies managed files and records install state after this helper exits."
echo "Direct script use does not perform those CLI steps."
echo ""

# Warn when deny hook is installed but settings file was skipped (hook may not be registered)
if $HOOKS_ENABLED && $SETTINGS_SKIPPED && [[ -f "$HOOKS_DIR/deny-dangerous.sh" ]]; then
  echo "⚠ Settings file was preserved (not overwritten)."
  echo "  The central guardrail hooks in $HOOKS_DIR were installed but may not be"
  echo "  registered in $SETTINGS_DST. Verify your settings file includes"
  echo "  root-resolving PreToolUse hook entries that invoke .goat-flow/hooks/run-with-bash.mjs."
  if [[ "$AGENT" == "claude" ]]; then
    echo ""
    echo "  For Claude, reconcile $SETTINGS_DST, then run:"
    echo "    npx @blundergoat/goat-flow@$VERSION hooks sync"
  elif [[ "$AGENT" == "codex" ]]; then
    echo ""
    echo "  For Codex, sync hooks or mirror workflow/hooks/agent-config/codex-hooks.json."
    echo "  Do not restore a direct .goat-flow/hooks/deny-dangerous.sh command; Codex hooks"
    echo "  run from the session cwd and need the Node git-root launcher."
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
