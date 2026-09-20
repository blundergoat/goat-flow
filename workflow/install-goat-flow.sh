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
  # Public install relocates legacy state before admission; direct Bash must not split the namespaces.
  if [[ -e "$PROJECT/.goat-flow/install-state" || -L "$PROJECT/.goat-flow/install-state" || -e "$PROJECT/.goat-flow/write-claims" || -L "$PROJECT/.goat-flow/write-claims" ]]; then
    echo "ERROR: legacy local state requires migration. Stop and upgrade all writers, then run: goat-flow install \"$PROJECT\" --agent \"$AGENT\"" >&2
    return 1
  fi
  local managed_state_path="$PROJECT/.goat-flow/state/install/managed.json"
  local marker_path known_agent
  local -a known_agents=()

  # The public CLI has already claimed the complete install batch, so this admitted setup can proceed.
  if [[ "${GOAT_FLOW_INSTALL_ADMISSION:-}" == "v2" ]]; then
    return 0
  fi
  # Any object at the sole v2 authority path activates the guard; the CLI reports malformed state in detail.
  if [[ -e "$managed_state_path" || -L "$managed_state_path" ]]; then
    echo "ERROR: managed install state requires the public CLI. Run: goat-flow install \"$PROJECT\" --agent \"$AGENT\"" >&2
    return 1
  fi

  IFS=',' read -r -a known_agents <<< "$SUPPORTED_AGENTS_CSV"
  # Check each provider's earlier receipt before allowing direct setup to change the selected project.
  for known_agent in "${known_agents[@]}"; do
    marker_path="$PROJECT/.goat-flow/state/install/$known_agent.json"
    # A linked or non-file receipt needs the CLI's repair checks before setup can write anything.
    if [[ -L "$marker_path" || ( -e "$marker_path" && ! -f "$marker_path" ) ]]; then
      echo "ERROR: managed install state requires the public CLI. Run: goat-flow install \"$PROJECT\" --agent \"$AGENT\"" >&2
      return 1
    fi
    # An existing provider receipt may record the cutover that requires managed installation.
    if [[ -f "$marker_path" ]]; then
      # Unreadable receipts and completed cutovers route the user back through the public install command.
      if [[ ! -r "$marker_path" ]] || grep -Eq '"schemaVersion"[[:space:]]*:[[:space:]]*"goat-flow\.install-state\.v1-cutover"' "$marker_path"; then
        echo "ERROR: managed install state requires the public CLI. Run: goat-flow install \"$PROJECT\" --agent \"$AGENT\"" >&2
        return 1
      fi
    fi
  done
}

# Read manifest-owned agents, skills and destinations so setup follows the selected provider and file ownership rules.
manifest_eval() {
  node - "$MANIFEST_PATH" "$@" <<'NODE'
const fs = require("node:fs");

const manifestPath = process.argv[2];
const mode = process.argv[3];
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
// Normalize manifest directory prefixes for ownership checks; an absent directory yields no configured destination.
const trimDir = (value) =>
  typeof value === "string" ? value.replace(/\/$/, "") : "";
const agentIds = Object.keys(manifest.agents || {});

// List the supported agents so setup can validate the user's provider choice.
if (mode === "supported-agents") {
  console.log(agentIds.join(","));
  console.log(agentIds.join("|"));
  process.exit(0);
}

// List the canonical workflows available for the selected agent's installation.
if (mode === "supported-skills") {
  // An absent skill list yields no install entries; each declared skill is emitted for setup.
  for (const skill of manifest.skills?.canonical || []) {
    console.log(skill);
  }
  process.exit(0);
}

// List retired workflow names so refresh can remove their old installed copies.
if (mode === "stale-skills") {
  // An absent retired list means no workflows need this cleanup.
  for (const skill of manifest.skills?.stale_names || []) {
    console.log(skill);
  }
  process.exit(0);
}

// List retired hook names so refresh does not leave obsolete launchers installed.
if (mode === "stale-hooks") {
  // An absent retired list means no hook files need this cleanup.
  for (const hook of manifest.hooks?.stale_names || []) {
    console.log(hook);
  }
  process.exit(0);
}

// Resolve who owns a destination before setup decides whether it may replace that file.
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

// Resolve the files belonging to the requested skill before copying it into the project.
if (mode === "skill-files") {
  const skillName = process.argv[4];
  const canonical = manifest.skills?.canonical;
  const references = manifest.skills?.references || {};
  // An unknown skill is refused instead of copying an undeclared workflow.
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
  // Emit the entry point and declared references that make this installed skill usable.
  for (const file of files) {
    console.log(file);
  }
  process.exit(0);
}

// Resolve the selected agent's settings, skill and hook destinations for setup.
if (mode === "agent-profile") {
  const agentId = process.argv[4];
  const agent = manifest.agents?.[agentId];
  // An unknown provider cannot supply safe destinations, so setup stops.
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

  // Emit each resolved destination; an empty value means this provider has no such install surface.
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

# Read the user's target and setup options before resolving any destination paths.
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

# Without a selected project, show usage and stop before creating setup files.
if [[ -z "$PROJECT" ]]; then
  echo "Usage: $0 /path/to/project --agent <${SUPPORTED_AGENTS_PIPE}>"
  exit 1
fi

# A missing target directory cannot receive the selected agent's setup.
if [[ ! -d "$PROJECT" ]]; then
  echo "ERROR: $PROJECT is not a directory"
  exit 1
fi

# --- Agent profile ---
PROFILE_DATA="$(manifest_eval agent-profile "$AGENT")" || {
  echo "ERROR: --agent must be ${SUPPORTED_AGENTS_DISPLAY} (got: '${AGENT:-<empty>}')"
  exit 1
}

# Load the selected provider's destinations from the manifest so setup writes its own settings and hooks.
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

# An incomplete skill destination stops setup before the user's project changes.
if [[ -z "${SKILLS_DIR:-}" ]]; then
  echo "ERROR: manifest profile for '$AGENT' is incomplete"
  exit 1
fi

HOOKS_ENABLED=false
# A provider declaring hooks must supply the complete hook destination contract.
if [[ -n "${HOOKS_DIR:-}" || -n "${DENY_HOOK_DST:-}" || -n "${HOOK_CONFIG_DST:-}" || -n "${HOOK_CONFIG_SRC:-}" ]]; then
  # Missing hook paths stop setup rather than leave the user's guardrails partly installed.
  if [[ -z "${HOOKS_DIR:-}" || -z "${DENY_HOOK_DST:-}" ]]; then
    echo "ERROR: manifest hook profile for '$AGENT' is incomplete"
    exit 1
  fi
  HOOKS_ENABLED=true
fi

# A settings destination needs its shipped seed before setup can create that file.
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

# A package without a version cannot record which framework the user installed.
if [[ -z "$VERSION" ]]; then
  echo "ERROR: could not determine goat-flow version from package.json"
  exit 1
fi

# Dependency errors must reach the user before migrations, directory scaffolding, or staged file writes begin.
preflight_installer_dependencies

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

# A symlinked shared setup root would redirect the policy read below, so report the unsafe directory first.
( cd "$PROJECT" && assert_safe_installer_directory ".goat-flow" ) || exit 1

# Mixed policy upgrades require dashboard review even when the CLI already admitted file replacements or the caller supplied force.
node - "$PROJECT" "$GOAT_FLOW_ROOT/workflow/hooks" <<'NODE'
const [projectRoot, bundledHooksRoot] = process.argv.slice(2);
try {
  const { inspectPolicyUpgrade } = require(bundledHooksRoot + "/hook-policy-state.cjs");
  const review = inspectPolicyUpgrade(projectRoot, bundledHooksRoot);
  // An older installation with differing switches would change GitHub protection; no installer flag expresses that consent.
  if (review) {
    console.error("ERROR: GitHub policy review is required before installation. Review the choices and affected files on the newer dashboard Hooks page, then retry. Force cannot approve this change.");
    process.exitCode = 1;
  }
} catch (error) {
  // Invalid YAML or a linked policy file leaves the current protection unknown, so setup must stop before creating any target files.
  // The reader's first line names the key or path to repair, such as conflicting choices for one policy.
  const reason = String(error && error.message ? error.message : error).split("\n")[0].slice(0, 200);
  console.error("ERROR: policy choices or ownership files could not be read safely (" + reason + "); repair the project's hook configuration before installation.");
  process.exitCode = 1;
}
NODE

# A v1-only CLI or direct script must not mutate a target once v2 state controls admission.
require_managed_install_admission

COPIED=0
SKIPPED=0
REMOVED=0
ACTIVE_STAGING_DIRECTORIES=()
STAGED_PAYLOAD_PATH=""
STAGED_PAYLOAD_DIRECTORY=""
LAST_TRANSFORM_RESULT=""

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
#
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
#
# Reaching here needs both --force-user-owned and a matching --force-path, so the
# create-only rule is lifted for exactly the paths the user named and nothing else.
installer_user_path_is_replaceable() {
  local candidate="$1" replaceable_path
  # Match the user's explicit replacement choices before replacing a user-owned destination.
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

# Retire undeclared Markdown references after refreshing an installed skill; retain the manifest-listed workflow files.
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

// Find obsolete installed Markdown references recursively so refresh retains only this skill's declared reference files.
function walk(dir) {
  // Inspect each installed reference so refresh can identify obsolete Markdown files.
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    // Nested reference folders are checked too, preserving their declared current files.
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    // Non-Markdown files are outside this reference cleanup and remain user-owned.
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;

    const relativePath = path
      .relative(skillDir, fullPath)
      .replace(/\\/g, "/");
    // An undeclared Markdown reference is reported for the installer's checked retirement step.
    if (!expected.has(relativePath)) {
      console.log(relativePath);
    }
  }
}

walk(referencesDir);
NODE
  )

  # Remove only references absent from this installed skill's current manifest; keep its remaining content.
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

# Remove the manifest-listed retired hook copies so the selected agent uses the current shared runtime.
prune_unlisted_hook_files() {
  local hooks_dir="$1"
  [[ -d "$hooks_dir" ]] || return 0
  readarray -t stale_hooks < <(manifest_eval stale-hooks)
  # Check the manifest's retired hook filenames rather than claim arbitrary user scripts.
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
    # Remove an existing retired hook copy so the agent cannot retain that obsolete launcher.
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

  # A filesystem lookup failure stops migration before the user's source can be moved.
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

# Move one legacy setup file to its current location; an occupied destination leaves the user with both files to inspect.
move_file_no_overwrite() {
  local src="$1" dst="$2"
  local rename_status=0
  [[ -f "$src" ]] || return 0
  # Keep both files when the new destination already contains user content.
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

# Move or merge a legacy setup folder while preserving every destination collision for the user to resolve.
migrate_dir_no_overwrite() {
  local src="$1" dst="$2"
  local rename_status=0
  [[ -d "$src" ]] || return 0
  # An unused destination allows the old directory to move as one complete setup folder.
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
  # Merge the old directory one entry at a time, retaining any destination collisions.
  for entry in "$src"/*; do
    base="$(basename "$entry")"
    target="$dst/$base"
    # A matching destination belongs to the user, so leave this old entry in place.
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
  # Tell the user when every entry was retained because no collision-free move was available.
  if [[ "$moved" == false ]]; then
    echo "  · $src/ (no movable entries)"
  fi
}

# Retire known per-agent launchers after the shared runtime is installed so agents use one current policy implementation.
prune_legacy_agent_hook_copies() {
  local script
  # Inspect the earlier per-agent hook folders after installing the shared runtime.
  for legacy_hooks_dir in .claude/hooks .codex/hooks .agents/hooks .github/hooks; do
    [[ -d "$legacy_hooks_dir" ]] || continue
    # Retire only these known framework launchers from the old agent folders.
    for script in run-with-bash.mjs hook-provider-adapters.mjs hook-launch-runtime.mjs deny-dangerous.sh gruff-code-quality.sh post-turn-safety.sh plan-checkbox-guard.sh post-turn-validate.sh; do
      # An existing old launcher is removed after its shared replacement is installed.
      if [[ -f "$legacy_hooks_dir/$script" ]]; then
        rm -f "$legacy_hooks_dir/$script"
        REMOVED=$((REMOVED + 1))
        echo "  ✗ $legacy_hooks_dir/$script (removed stale per-agent copy)"
      fi
    done
    prune_unlisted_hook_files "$legacy_hooks_dir"
  done
}

# Create an absent folder anchor so the selected project can retain empty workflow directories in version control.
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

# Add a missing setup ignore entry while preserving the user's newline style and existing equivalent entries.
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
  # A failed config read or staged write discards the transform and preserves the user's previous destination.
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

// An equivalent ignore entry already hides this setup path, so leave the user's file unchanged.
if (lines.some((line) => equivalentEntries.has(line.trim()))) {
  console.log("unchanged");
  process.exit(0);
}

let next = content;
// Separate the new ignore entry from an existing final line that lacks a newline.
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

# Record the requested framework version in staged project config before replacing the user's original file.
update_config_version_line() {
  local path="$1"
  local transform_result
  stage_existing_destination "$path"
  # A failed config read or staged write discards the transform and preserves the user's previous destination.
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

# Remove the retired agents config section during setup while preserving the user's other project configuration.
remove_config_agents_entry() {
  local path="$1"
  local transform_result
  stage_existing_destination "$path"
  # A failed config read or staged write discards the transform and preserves the user's previous destination.
  if ! transform_result="$(node - "$STAGED_PAYLOAD_PATH" <<'NODE'
const fs = require("node:fs");

const path = process.argv[2];
const content = fs.readFileSync(path, "utf8");
const eol = content.includes("\r\n") ? "\r\n" : "\n";
const hadFinalNewline = /\r?\n$/u.test(content);

// Read a config line's indentation to keep a retired section migration inside its own user settings.
function indentOf(line) {
  return line.match(/^\s*/u)?.[0] ?? "";
}

let lines = content.split(/\r?\n/u);
// Keep the original final-newline choice when rebuilding the user's config.
if (hadFinalNewline) lines = lines.slice(0, -1);

const agentKeyRe = /^agents\s*:\s*(.*?)(\s*#.*)?$/u;
const index = lines.findIndex((line) => agentKeyRe.test(line));

// Without the retired agents section, this migration has nothing to remove.
if (index === -1) {
  console.log("unchanged");
  process.exit(0);
}

let removeUntil = index + 1;
// Find the retired section's end without consuming the user's next top-level setting.
while (removeUntil < lines.length) {
  const line = lines[removeUntil];
  const trimmed = line.trim();
  // Blank lines stay within the section search until another setting establishes its boundary.
  if (trimmed !== "") {
    const currentIndentLength = indentOf(line).length;
    // A new top-level setting belongs to the user's remaining config and ends removal.
    if (currentIndentLength === 0) break;
  }
  removeUntil += 1;
}

lines.splice(index, removeUntil - index);
// Collapse only duplicate blanks left at the removed section's boundary.
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

# Move the old tasks settings into plans, keeping an existing plans section as the user's current choice.
migrate_config_tasks_entry() {
  local path="$1"
  local transform_result
  stage_existing_destination "$path"
  # A failed config read or staged write discards the transform and preserves the user's previous destination.
  if ! transform_result="$(node - "$STAGED_PAYLOAD_PATH" <<'NODE'
const fs = require("node:fs");

const path = process.argv[2];
const content = fs.readFileSync(path, "utf8");
const eol = content.includes("\r\n") ? "\r\n" : "\n";
const hadFinalNewline = /\r?\n$/u.test(content);

// Read a config line's indentation to keep a retired section migration inside its own user settings.
function indentOf(line) {
  return line.match(/^\s*/u)?.[0] ?? "";
}

// Find a top-level section's bounds for plan migration; null means the user has no such section to migrate.
function topLevelBlockRange(lines, key) {
  const keyRe = new RegExp(`^${key}\\s*:\\s*(?:#.*)?$`, "u");
  const index = lines.findIndex((line) => keyRe.test(line));
  // A missing section returns null so migration can leave unrelated project settings alone.
  if (index === -1) return null;
  let end = index + 1;
  // Find the next top-level setting to bound this config section's migration.
  while (end < lines.length) {
    const line = lines[end];
    const trimmed = line.trim();
    // The next nonblank top-level line belongs to another user setting.
    if (trimmed !== "" && indentOf(line).length === 0) break;
    end += 1;
  }
  return { index, end };
}

let lines = content.split(/\r?\n/u);
// Keep the original final-newline choice when rebuilding the user's config.
if (hadFinalNewline) lines = lines.slice(0, -1);

const tasksRange = topLevelBlockRange(lines, "tasks");
// Without old tasks settings, no plan migration is needed.
if (!tasksRange) {
  console.log("unchanged");
  process.exit(0);
}

const plansRange = topLevelBlockRange(lines, "plans");
// An existing plans section keeps the user's current choices; otherwise migrate the old section.
if (plansRange) {
  lines.splice(tasksRange.index, tasksRange.end - tasksRange.index);
} else {
  lines[tasksRange.index] = lines[tasksRange.index].replace(/^tasks/u, "plans");
  // Update paths inside the migrated section so the user's plans use their current directory.
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

# Fill missing hook choices and migrate retired toggles during refresh without replacing the user's saved current choices.
ensure_config_hooks_entry() {
  local path="$1"
  local transform_result
  stage_existing_destination "$path"
  # A failed config read or staged write discards the transform and preserves the user's previous destination.
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
// Keep the original final-newline choice when rebuilding the user's config.
if (hadFinalNewline) lines.pop();
let parsedHooks = null;
try {
  const parsedConfig = yaml.load(content);
  // Only a parsed hooks mapping can supply saved choices for migration.
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
// Check each retired guard choice before deriving the combined guard's initial state.
for (const legacyId of ["guard-destructive-shell", "guard-secret-paths", "guard-repository-writes"]) {
  // A saved disabled guard carries that opt-out into this upgrade's combined guard default.
  if (parsedHooks?.[legacyId]?.enabled === false) legacyEnabled = "false";
}

// Fill one missing hook choice in block YAML while retaining the user's existing hook choices and nesting.
function insertHookEntry(lines, hooksIndex, hookId, enabled) {
  const firstChild = lines.slice(hooksIndex + 1).find((line) =>
    line.trim() !== "" && !line.trimStart().startsWith("#"),
  );
  const indent = firstChild?.match(/^( +)\S/u)?.[1] ?? "  ";
  const hookRe = new RegExp(`^${indent}${hookId}:\\s*$`, "u");
  // An existing text or parsed hook entry is the user's choice and is not inserted again.
  if (
    lines.some((line) => hookRe.test(line)) ||
    (parsedHooks !== null &&
      Object.prototype.hasOwnProperty.call(parsedHooks, hookId))
  ) {
    return false;
  }
  let insertAt = hooksIndex + 1;
  const siblingRe = new RegExp(`^${indent}[A-Za-z0-9_-]+:\\s*$`, "u");
  // Place a missing hook after its existing siblings instead of disturbing their order.
  while (insertAt < lines.length && siblingRe.test(lines[insertAt])) {
    insertAt += 1;
    // Skip each sibling's nested settings so the new hook stays at the correct level.
    while (insertAt < lines.length && lines[insertAt].startsWith(`${indent} `)) insertAt += 1;
  }
  lines.splice(insertAt, 0, `${indent}${hookId}:`, `${indent.repeat(2)}enabled: ${enabled}`);
  return true;
}

// Find the index of the "}" closing the first "{" on the line, honoring quotes; -1 when it does not close on this line.
function flowMappingCloseIndex(line) {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  let started = false;
  // Scan the flow mapping while preserving braces and brackets inside the user's quoted values.
  for (let index = line.indexOf("{"); index >= 0 && index < line.length; index += 1) {
    const character = line[index];
    // An escaped character is literal user text and cannot change the YAML structure being read.
    if (escaped) { escaped = false; continue; }
    // A backslash inside a double-quoted value protects the next character from structural interpretation.
    if (inDouble && character === "\\") { escaped = true; continue; }
    // Track single-quoted user values so their punctuation cannot become YAML structure.
    if (!inDouble && character === "'") { inSingle = !inSingle; continue; }
    // Track double-quoted user values so their punctuation cannot become YAML structure.
    if (!inSingle && character === '"') { inDouble = !inDouble; continue; }
    // Quoted punctuation belongs to the user's value and does not open or close a mapping.
    if (inSingle || inDouble) continue;
    // An unquoted container opens a nested value that must remain separate from the direct hook entry.
    if (character === "{" || character === "[") { depth += 1; started = true; continue; }
    // An unquoted closing container returns the parser toward the direct hook entry.
    if (character === "}" || character === "]") {
      depth -= 1;
      // The outer closing brace marks where a missing hook entry can be appended.
      if (started && depth === 0) return character === "}" ? index : -1;
      // Unbalanced nesting cannot provide a safe insertion point for the user's YAML.
      if (depth < 0) return -1;
    }
  }
  return -1;
}

// Splice into a parsed flow mapping while preserving existing choices and YAML node properties.
function insertFlowHookEntry(line, hookId, enabled) {
  const openIndex = line.indexOf("{");
  const closeIndex = flowMappingCloseIndex(line);
  // Without an opening mapping brace, leave the user's hook text unchanged.
  if (openIndex === -1) return null;
  const entry = `${hookId}: { enabled: ${enabled} }`;
  // A valid multiline flow mapping can accept a new first entry, including a trailing comma.
  if (closeIndex === -1) return `${line.slice(0, openIndex + 1)} ${entry},${line.slice(openIndex + 1)}`;
  const body = line.slice(openIndex + 1, closeIndex);
  const trimmedBody = body.replace(/\s+$/u, "");
  const mutatedBody = body.trim().length === 0
    ? ` ${entry} `
    : `${trimmedBody}${trimmedBody.endsWith(",") ? "" : ","} ${entry} `;
  return `${line.slice(0, openIndex + 1)}${mutatedBody}${line.slice(closeIndex)}`;
}

let hooksIndex = lines.findIndex((line) =>
  /^(?:hooks|"hooks"|'hooks')\s*:/u.test(line),
);
// Migrate an existing hooks section before considering a new section.
if (hooksIndex !== -1) {
  const next = [];
  // Retain the user's config lines while removing only recognized retired hook blocks.
  for (let i = 0; i < lines.length; i += 1) {
    // A recognized retired hook block is replaced by the current hook choices.
    if (i > hooksIndex && (staleHookRe.test(lines[i]) || removedHookRe.test(lines[i]))) {
      changed = true;
      const staleGuardrailHook = staleHookRe.test(lines[i]);
      i += 1;
      // Inspect the retired block's nested settings before removing its lines.
      while (i < lines.length && /^    /.test(lines[i])) {
        const match = lines[i].match(/^    enabled:\s*(true|false)\s*$/u);
        // A retired guard's disabled choice carries into the combined guard during upgrade.
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
  // An explicit current guard choice takes priority over inherited retired choices.
  if (typeof parsedHooks?.["deny-dangerous"]?.enabled === "boolean") {
    legacyEnabled = String(parsedHooks["deny-dangerous"].enabled);
  }
  const hooksInlineValue = lines[hooksIndex].slice(lines[hooksIndex].indexOf(":") + 1).trim();
  const hooksNodeValue = hooksInlineValue.replace(/^&[^\s]+[ \t]+/u, "");
  // A flow-style hooks mapping needs an insertion inside its existing braces.
  if (hooksNodeValue.startsWith("{")) {
    // A flow-style mapping must converge inside its own braces; block-style insertion would break the parse.
    // Without a successful parse the missing set is unknown, so the registry defaults stay authoritative.
    if (parsedHooks !== null) {
      // Fill each missing current hook choice without replacing choices already saved in the mapping.
      for (const [flowHookId, flowEnabled] of [
        ["deny-dangerous", legacyEnabled],
        ["deny-git-mutations", legacyEnabled],
        ["post-turn-safety", "true"],
        ["gruff-code-quality", "false"],
      ]) {
        // A saved flow entry remains the user's choice and is not added again.
        if (Object.prototype.hasOwnProperty.call(parsedHooks, flowHookId)) continue;
        const mutatedLine = insertFlowHookEntry(lines[hooksIndex], flowHookId, flowEnabled);
        // A mapping without a safe insertion point ends this text migration without guessing its structure.
        if (mutatedLine === null) break;
        lines[hooksIndex] = mutatedLine;
        changed = true;
      }
    }
  } else {
    const hasMissingHook = ["deny-dangerous", "deny-git-mutations", "post-turn-safety", "gruff-code-quality"]
      .some((hookId) => !Object.prototype.hasOwnProperty.call(parsedHooks ?? {}, hookId));
    // A hooks alias receives only missing entries through a merge mapping, retaining the user's anchor.
    if (parsedHooks !== null && hasMissingHook && /^\*[^\s]+(?:\s+#.*)?$/u.test(hooksNodeValue)) {
      // A merge preserves the aliased defaults while the new choice belongs only to hooks.
      lines[hooksIndex] = lines[hooksIndex].slice(0, lines[hooksIndex].indexOf(":") + 1);
      lines.splice(hooksIndex + 1, 0, `  <<: ${hooksNodeValue}`);
      changed = true;
    }
    changed = insertHookEntry(lines, hooksIndex, "deny-dangerous", legacyEnabled) || changed;
    changed = insertHookEntry(lines, hooksIndex, "deny-git-mutations", legacyEnabled) || changed;
    changed = insertHookEntry(lines, hooksIndex, "post-turn-safety", "true") || changed;
    changed = insertHookEntry(lines, hooksIndex, "gruff-code-quality", "false") || changed;
  }
  // Write the staged hook config only when this migration changed its choices.
  if (changed) {
    const migrated = `${lines.join(eol)}${hadFinalNewline ? eol : ""}`;
    // Reparse migrated YAML when the original parsed successfully before accepting the staged result.
    if (parsedHooks !== null) yaml.load(migrated);
    fs.writeFileSync(path, migrated);
    console.log("changed");
  } else {
    console.log("unchanged");
  }
  process.exit(0);
}

let next = content;
// Separate a newly appended hooks section from a final line that lacks a newline.
if (next.length > 0 && !/\r?\n$/u.test(next)) next += eol;
next += [
  "",
  "# Hook toggles for goat-flow-shipped hooks.",
  "hooks:",
  "  deny-dangerous:",
  "    enabled: true",
  "  deny-git-mutations:",
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
  # A failed config read or staged write discards the transform and preserves the user's previous destination.
  if ! transform_result="$(node - "$STAGED_PAYLOAD_PATH" "$GOAT_FLOW_ROOT" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const configPath = process.argv[2];
const frameworkRoot = process.argv[3];
const yaml = require(require.resolve("js-yaml", { paths: [frameworkRoot] }));
const relativeBinaryPath = "strands_agents/.venv/bin/gruff-py";
const projectRoot = fs.realpathSync(process.cwd());
const candidatePath = path.join(projectRoot, relativeBinaryPath);

// Verify the repository-owned analyzer binary before saving an override; false leaves the user's config unchanged.
function candidateIsContainedExecutable() {
  try {
    fs.accessSync(candidatePath, fs.constants.X_OK);
    const binaryRealPath = fs.realpathSync(candidatePath);
    const relativeRealPath = path.relative(projectRoot, binaryRealPath);
    // A binary resolving outside the selected project cannot become its saved analyzer override.
    if (
      relativeRealPath === ".." ||
      relativeRealPath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeRealPath)
    ) {
      return false;
    }
    return fs.statSync(binaryRealPath).isFile();
  // A missing or non-executable environment binary leaves the user's analyzer configuration unchanged.
  } catch {
    return false;
  }
}

// Without a verified project binary, setup does not add an analyzer path.
if (!candidateIsContainedExecutable()) {
  console.log("unchanged");
  process.exit(0);
}

const content = fs.readFileSync(configPath, "utf8");
let parsedConfig;
try {
  parsedConfig = yaml.load(content);
// Invalid hand-edited YAML is preserved rather than rewritten while adding an analyzer path.
} catch {
  console.log("unchanged");
  process.exit(0);
}
const hooks = parsedConfig?.hooks;
const gruffHook = hooks?.["gruff-code-quality"];
// A missing or malformed Gruff entry, or an existing override, leaves this config unchanged.
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
// Keep the original final-newline choice when rebuilding the user's config.
if (hadFinalNewline) lines.pop();

// Find one flow mapping's closing brace across lines without counting quoted or commented braces.
function mappingClosePosition(lines, startLineIndex, openIndex) {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let lastCodeCharacter = "";
  // Search across mapping lines so multiline user YAML can receive the missing binary field.
  for (let lineIndex = startLineIndex; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const firstIndex = lineIndex === startLineIndex ? openIndex : 0;
    let escaped = false;
    // Inspect each character without treating the user's quoted braces as mapping boundaries.
    for (let index = firstIndex; index < line.length; index += 1) {
      const character = line[index];
      // An escaped character is literal user text and cannot change the YAML structure being read.
      if (escaped) { escaped = false; continue; }
      // A backslash inside a double-quoted value protects the next character from structural interpretation.
      if (inDouble && character === "\\") { escaped = true; continue; }
      // Track single-quoted user values so their punctuation cannot become YAML structure.
      if (!inDouble && character === "'") {
        inSingle = !inSingle;
        lastCodeCharacter = character;
        continue;
      }
      // Track double-quoted user values so their punctuation cannot become YAML structure.
      if (!inSingle && character === '"') {
        inDouble = !inDouble;
        lastCodeCharacter = character;
        continue;
      }
      // Quoted punctuation belongs to the user's value and does not open or close a mapping.
      if (inSingle || inDouble) continue;
      // An unquoted YAML comment ends the setting text; quoted hash characters remain part of the user's value.
      if (
        character === "#" &&
        (index === 0 || /\s/u.test(line[index - 1]))
      ) {
        break;
      }
      // Whitespace does not change where the user's flow mapping closes.
      if (/\s/u.test(character)) continue;
      // An unquoted opening brace starts another mapping that must remain intact.
      if (character === "{") {
        depth += 1;
        lastCodeCharacter = character;
        continue;
      }
      // An unquoted closing brace may end the mapping receiving the analyzer override.
      if (character === "}") {
        depth -= 1;
        // At the outer boundary, return the insertion point and whether its existing comma can be reused.
        if (depth === 0) {
          return {
            lineIndex,
            index,
            hasTrailingSeparator: lastCodeCharacter === ",",
          };
        }
        // Broken brace nesting returns null so setup preserves the user's original mapping.
        if (depth < 0) return null;
      }
      lastCodeCharacter = character;
    }
  }
  return null;
}

// Return the first YAML comment marker outside quoted scalars; line.length means no comment.
function yamlCommentIndex(line) {
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  // Find actual YAML comments while keeping hash characters inside the user's quoted values.
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    // An escaped character is literal user text and cannot change the YAML structure being read.
    if (escaped) { escaped = false; continue; }
    // A backslash inside a double-quoted value protects the next character from structural interpretation.
    if (inDouble && character === "\\") { escaped = true; continue; }
    // Track single-quoted user values so their punctuation cannot become YAML structure.
    if (!inDouble && character === "'") { inSingle = !inSingle; continue; }
    // Track double-quoted user values so their punctuation cannot become YAML structure.
    if (!inSingle && character === '"') { inDouble = !inDouble; continue; }
    // An unquoted YAML comment ends the setting text; quoted hash characters remain part of the user's value.
    if (
      !inSingle &&
      !inDouble &&
      character === "#" &&
      (index === 0 || /\s/u.test(line[index - 1]))
    ) {
      return index;
    }
  }
  return line.length;
}

// Find a key whose value opens a flow mapping at the caller's required nesting depth.
function mappingOpenIndex(line, key, initialDepth, expectedParentDepth) {
  const yamlCode = line.slice(0, yamlCommentIndex(line));
  // An empty or comment-only line cannot contain the analyzer's mapping entry.
  if (yamlCode.trim().length === 0) return -1;
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const entryPattern = new RegExp(
    `(?:^|[{,])\\s*(?:"${escapedKey}"|'${escapedKey}'|${escapedKey})\\s*:\\s*\\{`,
    "gu",
  );
  // Check candidate hook keys at the required nesting level so unrelated nested settings remain intact.
  for (const match of yamlCode.matchAll(entryPattern)) {
    const openIndex = match.index + match[0].lastIndexOf("{");
    let depth = initialDepth;
    let inSingle = false;
    let inDouble = false;
    let escaped = false;
    // Read the nesting before this key to distinguish a direct hook from a quoted or nested lookalike.
    for (let index = 0; index < openIndex; index += 1) {
      const character = yamlCode[index];
      // An escaped character is literal user text and cannot change the YAML structure being read.
      if (escaped) { escaped = false; continue; }
      // A backslash inside a double-quoted value protects the next character from structural interpretation.
      if (inDouble && character === "\\") { escaped = true; continue; }
      // Track single-quoted user values so their punctuation cannot become YAML structure.
      if (!inDouble && character === "'") { inSingle = !inSingle; continue; }
      // Track double-quoted user values so their punctuation cannot become YAML structure.
      if (!inSingle && character === '"') { inDouble = !inDouble; continue; }
      // Quoted punctuation belongs to the user's value and does not open or close a mapping.
      if (inSingle || inDouble) continue;
      // An unquoted container opens a nested value that must remain separate from the direct hook entry.
      if (character === "{" || character === "[") depth += 1;
      // An unquoted closing container returns the parser toward the direct hook entry.
      if (character === "}" || character === "]") depth -= 1;
    }
    // A direct unquoted mapping key supplies the safe analyzer-field insertion point.
    if (!inSingle && !inDouble && depth === expectedParentDepth) return openIndex;
  }
  return -1;
}

// Carry flow nesting forward so a nested lookalike key cannot be mistaken for a direct hook.
function mappingDepthAfterLine(line, initialDepth) {
  const yamlCode = line.slice(0, yamlCommentIndex(line));
  let depth = initialDepth;
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  // Carry nesting across the user's flow-mapping lines without counting quoted braces.
  for (const character of yamlCode) {
    // An escaped character is literal user text and cannot change the YAML structure being read.
    if (escaped) { escaped = false; continue; }
    // A backslash inside a double-quoted value protects the next character from structural interpretation.
    if (inDouble && character === "\\") { escaped = true; continue; }
    // Track single-quoted user values so their punctuation cannot become YAML structure.
    if (!inDouble && character === "'") { inSingle = !inSingle; continue; }
    // Track double-quoted user values so their punctuation cannot become YAML structure.
    if (!inSingle && character === '"') { inDouble = !inDouble; continue; }
    // Quoted punctuation belongs to the user's value and does not open or close a mapping.
    if (inSingle || inDouble) continue;
    // An unquoted container opens a nested value that must remain separate from the direct hook entry.
    if (character === "{" || character === "[") depth += 1;
    // An unquoted closing container returns the parser toward the direct hook entry.
    if (character === "}" || character === "]") depth -= 1;
  }
  return depth;
}

// Insert one property without reserializing user YAML; false means the parsed mapping was not located.
function appendFlowProperty(lines, lineIndex, openIndex, entry, hasProperties) {
  const close = mappingClosePosition(lines, lineIndex, openIndex);
  // No closing mapping boundary means the user's YAML cannot be safely amended.
  if (close === null) return false;
  // A multiline mapping receives the property on its closing line without reserializing user settings.
  if (close.lineIndex !== lineIndex) {
    const closeLine = lines[close.lineIndex];
    const separator = hasProperties && !close.hasTrailingSeparator ? ", " : "";
    lines[close.lineIndex] = `${closeLine.slice(0, close.index)}${separator}${entry} ${closeLine.slice(close.index)}`;
    return true;
  }
  const line = lines[lineIndex];
  const body = line.slice(openIndex + 1, close.index);
  const separator = close.hasTrailingSeparator ? " " : ", ";
  const nextBody = !hasProperties
    ? ` ${entry} `
    : `${body.replace(/\s+$/u, "")}${separator}${entry} `;
  lines[lineIndex] = `${line.slice(0, openIndex + 1)}${nextBody}${line.slice(close.index)}`;
  return true;
}

const hooksIndex = lines.findIndex((line) => /^(?:hooks|"hooks"|'hooks')\s*:/u.test(line));
// Without a hooks section, there is no existing Gruff choice to amend.
if (hooksIndex === -1) {
  console.log("unchanged");
  process.exit(0);
}
let hooksEnd = hooksIndex + 1;
// Bound the hooks section before searching for the analyzer entry.
while (hooksEnd < lines.length) {
  const line = lines[hooksEnd];
  // The next real top-level setting belongs to the user's other configuration.
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
const hooksIsFlow = /^(?:hooks|"hooks"|'hooks')\s*:\s*\{/u.test(
  lines[hooksIndex].slice(0, yamlCommentIndex(lines[hooksIndex])),
);
const expectedParentDepth = hooksIsFlow ? 1 : 0;
let mappingDepth = 0;
// Search only this hooks section for a direct Gruff flow mapping.
for (let index = hooksIndex; index < hooksEnd; index += 1) {
  const openIndex = mappingOpenIndex(
    lines[index],
    "gruff-code-quality",
    mappingDepth,
    expectedParentDepth,
  );
  // A verified direct mapping receives the missing binary override in place.
  if (openIndex !== -1) {
    changed = appendFlowProperty(
      lines,
      index,
      openIndex,
      `binaries: { py: ${relativeBinaryPath} }`,
      Object.keys(gruffHook).length > 0,
    );
    break;
  }
  mappingDepth = mappingDepthAfterLine(lines[index], mappingDepth);
}

// If flow insertion did not apply, look for the user's block-style Gruff entry.
if (!changed) {
  const directHookIndent = lines
    .slice(hooksIndex + 1, hooksEnd)
    .filter((line) => line.trim() !== "" && !line.trimStart().startsWith("#"))
    .map((line) => line.length - line.trimStart().length)
    .filter((indent) => indent > 0)
    .reduce((smallest, indent) => Math.min(smallest, indent), Infinity);
  const gruffIndex = lines.findIndex(
    (line, index) => {
      // Lines outside the hooks section cannot be this project's direct analyzer entry.
      if (index <= hooksIndex || index >= hooksEnd) return false;
      const match = /^( *)(?:gruff-code-quality|"gruff-code-quality"|'gruff-code-quality')\s*:\s*(?:#.*)?$/u.exec(line);
      return match !== null && match[1].length === directHookIndent;
    },
  );
  // An existing block-style Gruff entry can receive the missing binary field at its own indentation.
  if (gruffIndex !== -1) {
    let gruffEnd = gruffIndex + 1;
    // Find this hook's boundary so the new override does not enter a sibling hook.
    while (gruffEnd < hooksEnd) {
      const line = lines[gruffEnd];
      const indent = line.length - line.trimStart().length;
      // A nonblank sibling or parent setting ends this hook's block.
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
        // Search for the saved enabled choice only inside the current Gruff block.
        if (index <= gruffIndex || index >= gruffEnd) return false;
        const match = /^( *)enabled\s*:/u.exec(line);
        return match !== null && match[1].length === fieldIndent;
      },
    );
    // Keep the enabled choice first when placing the new binary override.
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

// If no safe supported YAML location was found, preserve the user's config unchanged.
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

# Retire the old plan-guard config and its guidance when setup installs the current plan workflow.
remove_config_plan_guard_entry() {
  local path="$1"
  local transform_result
  stage_existing_destination "$path"
  # A failed config read or staged write discards the transform and preserves the user's previous destination.
  if ! transform_result="$(node - "$STAGED_PAYLOAD_PATH" <<'NODE'
const fs = require("node:fs");

const path = process.argv[2];
const content = fs.readFileSync(path, "utf8");
const eol = content.includes("\r\n") ? "\r\n" : "\n";
const repeatedEol = new RegExp(`(?:${eol === "\r\n" ? "\\r\\n" : "\\n"}){3,}`, "gu");
const hadFinalNewline = /\r?\n$/u.test(content);
let lines = content.split(/\r?\n/u);
// Keep the original final-newline choice when rebuilding the user's config.
if (hadFinalNewline) lines.pop();

const start = lines.findIndex((line) => /^plan-guard\s*:/u.test(line));
// Without the retired plan-guard section, no removal is needed.
if (start === -1) {
  console.log("unchanged");
  process.exit(0);
}
let end = start + 1;
// Find the retired section's end before the user's next top-level choice.
while (end < lines.length) {
  const line = lines[end] ?? "";
  // The next top-level setting is preserved as part of the user's current config.
  if (line.trim() !== "" && /^[A-Za-z0-9_-]+:/u.test(line)) break;
  end += 1;
}
let prefixStart = start;
// Remove the retired section's own guidance along with its obsolete settings.
if (
  prefixStart > 0 &&
  lines[prefixStart - 1] === "# Workflow reminder settings for the plan checkbox guard."
) {
  prefixStart -= 1;
}
// Remove its separator too so the user's remaining config does not gain an extra blank block.
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

# Reconcile staged provider registrations with saved hook choices while preserving unrelated user commands and settings.
migrate_agent_hook_config() {
  local user_hook_config_path="$1"
  local registration_agent="${2:-$AGENT}"
  local registration_hook="${3:-}"
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
  # A failed config read or staged write discards the transform and preserves the user's previous destination.
  if ! transform_result="$(node - "$STAGED_PAYLOAD_PATH" "$desired_state_contract_path" "$registration_agent" "$GOAT_FLOW_ROOT" "$registration_hook" <<'NODE'
/**
 * Reconciles one staged user hook config from the TypeScript-generated desired-state contract.
 *
 * Use during standalone setup so enabled, disabled, duplicate, and retired rows match CLI and dashboard behavior.
 * Invalid user JSON is preserved; an invalid package contract stops installation before replacement.
 */
const childProcess = require("node:child_process");
const fs = require("node:fs");
const pathModule = require("node:path");
const { isDeepStrictEqual } = require("node:util");

const [userHookConfigPath, desiredStateContractPath, agentId, frameworkRoot, selectedHookId] =
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
 *
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
  // Search grouped provider definitions so managed commands can be repaired without claiming unrelated rows.
  if (Array.isArray(value)) {
    return value.some((nestedValue) =>
      valueReferencesManagedScript(nestedValue, scriptNames),
    );
  }
  // A primitive or null value cannot name a provider command owned by setup.
  if (!isObject(value)) return false;
  // An exact managed command match identifies a definition setup may refresh.
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
  // Missing or malformed hooks config leaves the registry default as the install choice.
  if (!isObject(configValue) || !isObject(configValue.hooks)) {
    return defaultEnabled === true;
  }
  const configuredHook =
    configValue.hooks[hookId] ??
    (hookId === "gruff-code-quality"
      ? configValue.hooks["gruff-on-change"]
      : undefined);
  // A saved boolean toggle is the user's authority over this hook's registration.
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
  // Find the YAML comment boundary without truncating hash characters in the user's quoted values.
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    // An escaped character is literal user text and cannot change the YAML structure being read.
    if (escaped) {
      escaped = false;
      continue;
    }
    // A backslash inside a double-quoted value protects the next character from structural interpretation.
    if (inDouble && character === "\\") {
      escaped = true;
      continue;
    }
    // Track single-quoted user values so their punctuation cannot become YAML structure.
    if (!inDouble && character === singleQuote) {
      // A doubled single quote is literal text in the user's YAML rather than the end of its value.
      if (inSingle && text[index + 1] === singleQuote) {
        index += 1;
        continue;
      }
      inSingle = !inSingle;
      continue;
    }
    // Track double-quoted user values so their punctuation cannot become YAML structure.
    if (!inSingle && character === "\"") {
      inDouble = !inDouble;
      continue;
    }
    // An unquoted YAML comment ends the setting text; quoted hash characters remain part of the user's value.
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
  // An empty scalar cannot identify a scan directory, so registration cannot use it.
  if (value.length === 0) return null;
  // Decode a single-quoted root while retaining literal quotes in the user's path.
  if (value.startsWith(singleQuote) && value.endsWith(singleQuote)) {
    return value.slice(1, -1).split(singleQuote + singleQuote).join(singleQuote);
  }
  // Decode a double-quoted root before checking where the user's post-turn scan will run.
  if (value.startsWith("\"") && value.endsWith("\"")) {
    try {
      const decoded = JSON.parse(value);
      return typeof decoded === "string" ? decoded : null;
    // A malformed quoted scan root is rejected so setup cannot register an ambiguous directory.
    } catch {
      return null;
    }
  }
  // YAML booleans, nulls and numbers cannot stand in for a user's scan-directory path.
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
  // A non-list value cannot supply explicit post-turn scan roots.
  if (!value.startsWith("[") || !value.endsWith("]")) return null;
  const body = value.slice(1, -1);
  // An empty list selects no scan directories and cannot satisfy explicit-root registration.
  if (body.trim().length === 0) return [];
  const rawItems = [];
  let item = "";
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  // Split the user's inline roots only at commas outside quoted paths.
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    // An escaped character is literal user text and cannot change the YAML structure being read.
    if (escaped) {
      item += character;
      escaped = false;
      continue;
    }
    // A backslash inside a double-quoted value protects the next character from structural interpretation.
    if (inDouble && character === "\\") {
      item += character;
      escaped = true;
      continue;
    }
    // Track single-quoted user values so their punctuation cannot become YAML structure.
    if (!inDouble && character === singleQuote) {
      item += character;
      // A doubled single quote belongs to the scan path and is retained in this list item.
      if (inSingle && body[index + 1] === singleQuote) {
        item += body[index + 1];
        index += 1;
        continue;
      }
      inSingle = !inSingle;
      continue;
    }
    // Track double-quoted user values so their punctuation cannot become YAML structure.
    if (!inSingle && character === "\"") {
      item += character;
      inDouble = !inDouble;
      continue;
    }
    // An unquoted comma separates the user's scan directories.
    if (!inSingle && !inDouble && character === ",") {
      rawItems.push(item);
      item = "";
      continue;
    }
    item += character;
  }
  // Unfinished quotes or escapes make the roots ambiguous, so setup rejects the list.
  if (inSingle || inDouble || escaped) return null;
  rawItems.push(item);
  const parsedItems = rawItems.map(yamlStringScalar);
  return parsedItems.every((candidate) => typeof candidate === "string")
    ? parsedItems
    : null;
}

/** Count leading spaces and reject tab-indented config as ambiguous. */
function lineIndent(line) {
  // Tab-indented config cannot prove the scan roots' nesting, so registration treats it as ambiguous.
  if (line.includes("\t")) return -1;
  return line.length - line.trimStart().length;
}

/** Read the explicit post-turn roots from the same YAML shapes the runtime accepts. */
function configuredPostTurnScanRoots() {
  let configText;
  try {
    configText = fs.readFileSync(".goat-flow/config.yaml", "utf8");
  // A missing or unreadable project config supplies no explicit scan roots for registration.
  } catch {
    return null;
  }
  const lines = configText.replace(/\r\n?/gu, "\n").split("\n");
  const hooksIndex = lines.findIndex(
    (line) =>
      lineIndent(line) === 0 && stripYamlComment(line).trim() === "hooks:",
  );
  // Without a supported hooks section, setup cannot establish explicit post-turn roots.
  if (hooksIndex < 0) return null;
  let hooksEnd = lines.length;
  // Find the hooks boundary before interpreting the user's scan settings.
  for (let index = hooksIndex + 1; index < lines.length; index += 1) {
    const cleanLine = stripYamlComment(lines[index]);
    // Another top-level setting ends the hooks section and stays outside this scan lookup.
    if (cleanLine.trim().length > 0 && lineIndent(lines[index]) <= 0) {
      hooksEnd = index;
      break;
    }
  }
  let hookIndex = -1;
  let hookIndent = -1;
  // Find the post-turn hook inside the user's hooks section.
  for (let index = hooksIndex + 1; index < hooksEnd; index += 1) {
    const indent = lineIndent(lines[index]);
    // A nested post-turn section establishes the scope of its scan settings.
    if (
      indent > 0 &&
      stripYamlComment(lines[index]).trim() === "post-turn-safety:"
    ) {
      hookIndex = index;
      hookIndent = indent;
      break;
    }
  }
  // Without a post-turn section, setup has no explicit roots to validate.
  if (hookIndex < 0) return null;
  // Look inside this hook for the user's explicit scan-roots setting.
  for (let index = hookIndex + 1; index < hooksEnd; index += 1) {
    const cleanLine = stripYamlComment(lines[index]);
    const trimmedLine = cleanLine.trim();
    // Blank guidance lines do not supply scan-root settings.
    if (trimmedLine.length === 0) continue;
    const indent = lineIndent(lines[index]);
    // A sibling or parent setting ends the post-turn hook's configuration.
    if (indent <= hookIndent) break;
    const fieldMatch = /^scan-roots:\s*(.*)$/u.exec(trimmedLine);
    // Other post-turn settings are not directory choices and remain outside this lookup.
    if (!fieldMatch) continue;
    const inlineValue = fieldMatch[1].trim();
    // An inline list is decoded using the same accepted root shapes as the runtime.
    if (inlineValue.length > 0) return yamlFlowStringList(inlineValue);
    const roots = [];
    // Read the block list of scan directories until another user setting begins.
    for (
      let rootIndex = index + 1;
      rootIndex < hooksEnd;
      rootIndex += 1
    ) {
      const rootLine = stripYamlComment(lines[rootIndex]);
      // Blank list lines do not add a directory to the user's scan scope.
      if (rootLine.trim().length === 0) continue;
      // A line outside this list's indentation ends the scan-root choices.
      if (lineIndent(lines[rootIndex]) <= indent) break;
      const itemMatch = /^-\s+(.+)$/u.exec(rootLine.trim());
      // A non-list child makes the explicit roots ambiguous, so setup refuses that registration contract.
      if (!itemMatch) return null;
      const root = yamlStringScalar(itemMatch[1]);
      // A null or non-string root cannot select a safe scan directory.
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
    // A file cannot act as the directory where the user's scan runs.
    if (!fs.statSync(directoryPath).isDirectory()) return null;
    return fs.realpathSync(directoryPath);
  // A deleted directory or denied filesystem lookup supplies no verified scan location.
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
  // Failed Git discovery or empty output cannot establish ownership of the user's scan directory.
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
    // A non-directory or unavailable file identity cannot prove two scan paths are the same directory.
    if (!stats.isDirectory() || stats.ino === 0n) return null;
    return { device: stats.dev, inode: stats.ino };
  // A removed or unreadable directory cannot provide the identity needed to verify its scan scope.
  } catch {
    return null;
  }
}

/** Compare physical spellings first, then exact identity for aliases such as Windows short paths. */
function filesystemPathsAreEquivalent(leftDirectory, rightDirectory) {
  // A missing directory on either side prevents setup from proving equivalent scan locations.
  if (!leftDirectory || !rightDirectory) return false;
  const spellingsMatch =
    pathModule.relative(leftDirectory, rightDirectory) === "" &&
    pathModule.relative(rightDirectory, leftDirectory) === "";
  // Equivalent physical path spellings already establish the user's directory identity.
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
  // An empty, absolute or non-string root cannot select a contained project scan directory.
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
  // A path escaping the selected project is outside the user's permitted scan scope.
  if (relativePathEscapesRoot(lexicalRelative)) return false;
  const physicalCandidate = physicalDirectory(lexicalCandidate);
  // A missing physical directory cannot receive a post-turn scan registration.
  if (physicalCandidate === null) return false;
  const physicalRelative = pathModule.relative(projectRoot, physicalCandidate);
  // A symlink resolving outside the selected project cannot expand the user's scan scope.
  if (relativePathEscapesRoot(physicalRelative)) return false;
  return filesystemPathsAreEquivalent(
    gitTopLevel(physicalCandidate),
    physicalCandidate,
  );
}

/** Apply the registrar's implicit-Git or all-explicit-roots registration contract. */
function postTurnRootContractAllowsRegistration() {
  const projectRoot = physicalDirectory(process.cwd());
  // An unresolved project directory cannot establish a safe post-turn registration.
  if (projectRoot === null) return false;
  // An exact project Git root satisfies the implicit scan contract without additional roots.
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
  // A hook already explained in this install does not repeat the same repair notice.
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
  // A disabled choice keeps a registration only when this hook's contract requires an inert installed row.
  if (!configuredHookEnabled(hookId, hookContract.defaultEnabled)) {
    return hookContract.retainRegistrationWhenDisabled;
  }
  // Other hooks do not need the post-turn scan-root prerequisite.
  if (hookId !== "post-turn-safety") return true;
  // Verified scan ownership allows the user's enabled post-turn hook to register.
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
    // An incomplete generated cleanup row cannot safely determine which provider commands setup owns.
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
    // An incomplete supported hook row stops setup before executable provider config is replaced.
    if (
      typeof hookContract.defaultEnabled !== "boolean" ||
      typeof hookContract.retainRegistrationWhenDisabled !== "boolean" ||
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
const hookEntries = managedHookEntries(agentContract).filter(([hookId]) => !selectedHookId || hookId === selectedHookId);
const supportedHookEntries = hookEntries.filter(
  ([, hookContract]) => hookContract.supported,
);
const currentConfig = readJsonObject(userHookConfigPath);
// Invalid user JSON remains untouched so setup never replaces settings the user needs to repair.
if (!currentConfig) {
  // A targeted Git-protection repair needs valid provider JSON; preserve the runtime and report the problem otherwise.
  if (selectedHookId) throw new Error("Cannot establish Git protection in invalid provider JSON; existing runtime preserved");
  console.log("unchanged");
  process.exit(0);
}
const originalConfig = JSON.stringify(currentConfig);

// Codex binds trust to row position. Keep each already-current hook where the user reviewed it.
const preservedCodexHooks = new Set();
// Current Codex rows keep their reviewed positions so refresh preserves the user's trust decisions.
if (agentId === "codex" && isObject(currentConfig.hooks)) {
  // Check each supported hook for an already-current Codex registration.
  for (const [hookId, hookContract] of supportedHookEntries) {
    // Hooks without a runnable registration choice or prerequisite do not qualify for position preservation.
    if (!shouldRegisterManagedHook(hookId, hookContract)) continue;
    const ownedEvents = {};
    // Compare the hook's owned rows across the provider's lifecycle events.
    for (const [eventName, entries] of Object.entries(currentConfig.hooks)) {
      // Malformed event values cannot supply current runnable Codex rows.
      if (!Array.isArray(entries)) continue;
      const ownedEntries = entries.filter((entry) =>
        valueReferencesManagedScript(entry, hookContract.cleanup.commandScriptNames),
      );
      // Only events containing owned commands contribute to this hook's current registration shape.
      if (ownedEntries.length > 0) ownedEvents[eventName] = ownedEntries;
    }
    // Stale fields, duplicate rows and misplaced events still take the ordinary repair path.
    if (isDeepStrictEqual(ownedEvents, hookContract.config.hooks)) {
      preservedCodexHooks.add(hookId);
    }
  }
}

// Antigravity stores managed hook definitions as top-level ids instead of shared lifecycle arrays.
if (agentId === "antigravity") {
  const managedHookIds = new Set([
    ...hookEntries.flatMap(([, hookContract]) => hookContract.cleanup.hookIds),
    ...(selectedHookId ? [] : desiredStateContract.retiredHookIds),
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
    // Remove only recognized managed definitions before restoring the user's enabled Antigravity hooks.
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
    selectedHookId ? [] : desiredStateContract.retiredHookScriptNames,
  );
  // Repair hooks whose current rows do not match the desired state.
  for (const [hookId, hookContract] of hookEntries) {
    // A current Codex hook keeps its reviewed rows instead of entering the repair path.
    if (preservedCodexHooks.has(hookId)) continue;
    removeManagedRowsFromSharedHooks(
      currentConfig.hooks,
      hookContract.cleanup.commandScriptNames,
    );
  }
  // Enabled hooks append one generated provider fragment; disabled hooks remain installed but inert.
  for (const [hookId, hookContract] of supportedHookEntries) {
    // The config toggle is the user's authority over whether their agent runs this hook.
    if (preservedCodexHooks.has(hookId)) continue;
    // A disabled choice or unmet prerequisite does not append a runnable registration.
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

# Rename Codex's retired hook feature flag while preserving an explicit current flag and the user's chosen boolean.
migrate_codex_hooks_feature_flag() {
  local path="$1"
  local transform_result
  stage_existing_destination "$path"
  # A failed config read or staged write discards the transform and preserves the user's previous destination.
  if ! transform_result="$(node - "$STAGED_PAYLOAD_PATH" <<'NODE'
const fs = require("node:fs");

const path = process.argv[2];
const content = fs.readFileSync(path, "utf8");
const eol = content.includes("\r\n") ? "\r\n" : "\n";
const hadFinalNewline = /\r?\n$/u.test(content);
const lines = content.split(/\r?\n/u);
// Keep the user's original final-newline choice when rebuilding Codex settings.
if (hadFinalNewline) lines.pop();

// Read a saved Codex hook flag without changing its boolean; null means the line has no migratable flag.
function parseFeatureBooleanAssignment(line, section) {
  // Blank and comment lines cannot supply a hook feature toggle.
  if (/^\s*(#|$)/u.test(line)) return null;
  const match = line.match(
    /^(\s*)([A-Za-z0-9_.-]+)(\s*=\s*)(true|false)(\s*(?:#.*)?)$/u,
  );
  // A non-boolean assignment is outside this hook-flag migration.
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
// Inspect Codex feature assignments while retaining the user's surrounding settings.
for (let index = 0; index < lines.length; index += 1) {
  const sectionMatch = lines[index].match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/u);
  // Track the TOML table so a hook flag is interpreted in its actual section.
  if (sectionMatch) {
    section = sectionMatch[1].trim();
    continue;
  }
  const assignment = parseFeatureBooleanAssignment(lines[index], section);
  // Unrelated assignments do not change the user's hook feature choice.
  if (!assignment) continue;
  // Collect the retired hook flag so its saved boolean can migrate.
  if (assignment.normalizedKey === "features.codex_hooks") {
    deprecated.push({ index, assignment });
  // A current hook flag takes priority over the user's earlier retired flag.
  } else if (assignment.normalizedKey === "features.hooks") {
    current.push(index);
  }
}

// Without the retired flag, the user's current feature settings need no migration.
if (deprecated.length === 0) {
  console.log("unchanged");
  process.exit(0);
}

const remove = new Set();
// If no current flag exists, rename the first retired flag while keeping its saved boolean.
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
  // Remove duplicate retired flags after retaining the user's first migrated choice.
  for (const entry of deprecated.slice(1)) remove.add(entry.index);
} else {
  // Remove retired flags when a current flag already records the user's choice.
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

# Refresh the active Codex permission profile while carrying forward the user's additional deny patterns.
migrate_codex_filesystem_permissions() {
  local path="$1"
  local transform_result
  stage_existing_destination "$path"
  # A failed config read or staged write discards the transform and preserves the user's previous destination.
  if ! transform_result="$(node - "$STAGED_PAYLOAD_PATH" <<'NODE'
const fs = require("node:fs");

const path = process.argv[2];
const content = fs.readFileSync(path, "utf8");
const eol = content.includes("\r\n") ? "\r\n" : "\n";
const hadFinalNewline = /\r?\n$/u.test(content);
const lines = content.split(/\r?\n/u);
// Keep the user's original final-newline choice when rebuilding Codex settings.
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

// Decode a quoted permission profile or key so setup and validation use the user's actual saved spelling.
function parseTomlBasicString(value) {
  try {
    return JSON.parse(`"${value}"`);
  // A quoted TOML value with escapes JSON cannot decode keeps the simple quote/backslash fallback for profile matching.
  } catch {
    return value.replace(/\\"/gu, '"').replace(/\\\\/gu, "\\");
  }
}

// Read a matched permission key; an empty result has no named restriction to retain during profile refresh.
function tomlKeyFromMatch(match) {
  return match[1] ?? match[2] ?? "";
}

// Read a matched permission mode; an empty result supplies no deny choice for the refreshed profile.
function tomlModeFromMatch(match) {
  return match[3] ?? match[4] ?? "";
}

// Select the user's nonempty default permission profile; absent or empty selections use the managed goat-flow profile.
function readActivePermissionProfile(configLines) {
  // Find the user's explicit active permission profile before falling back to the managed profile.
  for (const line of configLines) {
    const basicMatch = line.match(
      /^\s*default_permissions\s*=\s*"((?:\\.|[^"\\])*)"\s*(?:#.*)?$/u,
    );
    // A quoted default profile selects the permission table setup should refresh.
    if (basicMatch) {
      const profile = parseTomlBasicString(basicMatch[1]).trim();
      // An empty decoded profile does not select a permission table; continue to the fallback.
      if (profile) return profile;
    }
    const literalMatch = line.match(
      /^\s*default_permissions\s*=\s*'([^']+)'\s*(?:#.*)?$/u,
    );
    // A nonempty literal profile selects the user's active permission table.
    if (literalMatch && literalMatch[1].trim()) return literalMatch[1].trim();
  }
  return "goat-flow";
}

// Match the user's permission profile name literally so punctuation cannot select another TOML table.
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

// Single source of truth: a "none" key is only invalid if it contains * and does not end in the accepted /** subtree form.
//
// Exact paths and trailing /** subtrees are accepted; other globs require repair.
// Keep this check identical to isInvalidNoneKey in validate_codex_settings_after_install.
function isInvalidNoneKey(key) {
  // An exact path contains no unsupported glob and does not need this compatibility repair.
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
  "**/.ssh/**",
  "**/.aws/**",
  "**/.gnupg/**",
  "**/.config/gcloud/**",
  "**/.docker/**",
  "**/.kube/**",
  "**/.npmrc",
  "**/.netrc",
  "**/.git-credentials",
  "**/.config/gh/hosts.yml",
  "**/.pgpass",
  "**/.pypirc",
  "**/*.pem",
  "**/*.key",
  "**/*.pfx",
]);
// Retire earlier generated patterns during refresh; identical user-added patterns cannot be distinguished, so each removal is reported.
//
// The retired **/secrets/** and **/credentials* patterns also blocked application code such as secrets routes and credentials.ts providers.
const oldGeneratedPatterns = new Set([
  ".",
  "secrets/**",
  "**/secrets/**",
  ".ssh/**",
  ".aws/**",
  ".docker/**",
  ".gnupg/**",
  ".kube/**",
  "**/.env*",
  "**/credentials",
  "**/credentials*",
]);

// Quote a retained user deny pattern safely when writing the refreshed TOML permission profile.
function escapeTomlString(value) {
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
}

const regions = [];
const profileRegions = [];
let i = 0;
// Find only the active profile's permission regions before refreshing user settings.
while (i < lines.length) {
  // Record the active profile's metadata section for workspace inheritance checks.
  if (profileSectionPattern.test(lines[i])) {
    const start = i;
    i += 1;
    // Stop this profile region at the next TOML table so unrelated user settings remain intact.
    while (i < lines.length && !anySectionPattern.test(lines[i])) i += 1;
    profileRegions.push({ start, end: i });
  // Record the active profile's filesystem tables for deny-rule migration.
  } else if (filesystemSectionPattern.test(lines[i])) {
    const start = i;
    i += 1;
    // Stop this filesystem region at the next table without consuming unrelated settings.
    while (i < lines.length && !anySectionPattern.test(lines[i])) i += 1;
    regions.push({ start, end: i });
  } else {
    i += 1;
  }
}

// Without an active permission profile or selection, this setup has no profile to refresh.
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
// Check active profile metadata before deciding whether workspace inheritance needs repair.
for (const region of profileRegions) {
  // Inspect each metadata line without treating unrelated TOML tables as profile choices.
  for (let j = region.start; j < region.end; j += 1) {
    // Workspace inheritance already supplies the base editing permissions for this profile.
    if (/^\s*extends\s*=\s*":workspace"\s*(?:#.*)?$/u.test(lines[j])) {
      profileExtendsWorkspace = true;
    }
  }
}
// Inspect only active filesystem regions for legacy and additional deny rules.
for (const region of regions) {
  // Read each active permission line before rebuilding the selected profile.
  for (let j = region.start; j < region.end; j += 1) {
    const line = lines[j];
    // The retired project-root anchor needs the current workspace-root spelling.
    if (legacyProjectRootsPattern.test(line)) usesLegacyAnchor = true;
    // The retired none access value needs the current deny spelling.
    if (legacyAccessPattern.test(line) || legacyInlineAccessPattern.test(line)) {
      usesLegacyAccess = true;
    }
    // Collect each explicit deny entry so the refresh can retain the user's additional restrictions.
    for (const entry of line.matchAll(filesystemAccessEntryPattern)) {
      const pattern = tomlKeyFromMatch(entry);
      const mode = tomlModeFromMatch(entry);
      // A named none or deny entry contributes to the active restriction list.
      if ((mode === "none" || mode === "deny") && pattern) {
        activeDenyPatterns.add(pattern);
      }
      // A noncanonical, nonretired deny pattern is retained as the user's additional restriction.
      if (
        (mode === "none" || mode === "deny") &&
        pattern &&
        !canonicalDenyPatterns.has(pattern) &&
        !oldGeneratedPatterns.has(pattern)
      ) {
        additionalDenyPatterns.add(pattern);
      }
      // An unsupported none glob requires a profile refresh before Codex can use these settings.
      if (mode === "none" && isInvalidNoneKey(pattern)) {
        hasInvalidEntry = true;
      }
    }
    const noneMatch = line.match(noneEntryPattern);
    // A standalone unsupported none entry also triggers the compatibility refresh.
    if (noneMatch && isInvalidNoneKey(tomlKeyFromMatch(noneMatch))) {
      hasInvalidEntry = true;
    }
    const inlineMatch = line.match(inlineTablePattern);
    // An inline permission table needs the same compatibility checks as a block table.
    if (inlineMatch) {
      // Inspect each inline none entry before accepting the selected profile.
      for (const entry of inlineMatch[1].matchAll(inlineEntryPattern)) {
        // An unsupported inline glob triggers the same refresh as a standalone entry.
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
// A profile written by an earlier release still denies a retired pattern, so the refresh must run to drop it.
const retiredDenyPatterns = [...activeDenyPatterns].filter((pattern) =>
  oldGeneratedPatterns.has(pattern),
);

// A complete current profile needs no rewrite and keeps the user's existing settings bytes.
if (
  !hasInvalidEntry &&
  !usesLegacyAnchor &&
  !usesLegacyAccess &&
  !shouldRefreshGoatFlowProfile &&
  !missingCanonicalDenyPatterns &&
  retiredDenyPatterns.length === 0
) {
  console.log("unchanged");
  process.exit(0);
}
// Name each dropped pattern so a user who added the same text by hand can put it back deliberately.
for (const pattern of retiredDenyPatterns) {
  console.error(`  - retired Codex deny pattern removed: ${pattern}`);
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
  "# Rules match secret content shapes and credential stores, never plain folder",
  "# or file names such as secrets/ or credentials*, which collide with ordinary",
  "# application code. The Bash deny hook covers shell access to home stores.",
  '"**/.env" = "deny"',
  '"**/.env.local" = "deny"',
  '"**/.env.development" = "deny"',
  '"**/.env.production" = "deny"',
  '"**/.env.staging" = "deny"',
  '"**/.env.test" = "deny"',
  '"**/.envrc" = "deny"',
  '"**/.env.*.local" = "deny"',
  '"**/.ssh/**" = "deny"',
  '"**/.aws/**" = "deny"',
  '"**/.gnupg/**" = "deny"',
  '"**/.config/gcloud/**" = "deny"',
  '"**/.docker/**" = "deny"',
  '"**/.kube/**" = "deny"',
  '"**/.npmrc" = "deny"',
  '"**/.netrc" = "deny"',
  '"**/.git-credentials" = "deny"',
  '"**/.config/gh/hosts.yml" = "deny"',
  '"**/.pgpass" = "deny"',
  '"**/.pypirc" = "deny"',
  '"**/*.pem" = "deny"',
  '"**/*.key" = "deny"',
  '"**/*.pfx" = "deny"',
];
// Carry the user's additional deny patterns into the refreshed active profile.
for (const pattern of additionalDenyPatterns) {
  canonicalBlock.push(`"${escapeTomlString(pattern)}" = "deny"`);
}

const inRegion = new Array(lines.length).fill(false);
// Mark the old filesystem regions that the refreshed profile will replace.
for (const region of regions) {
  // Each line in these owned regions is omitted from the retained surrounding settings.
  for (let j = region.start; j < region.end; j += 1) inRegion[j] = true;
}
// Mark the old profile metadata region replaced by the refreshed profile.
for (const region of profileRegions) {
  // Keep metadata replacement bounded to this active profile's lines.
  for (let j = region.start; j < region.end; j += 1) inRegion[j] = true;
}

const firstRegionStart = Math.min(
  ...regions.map((region) => region.start),
  ...profileRegions.map((region) => region.start),
);
const before = lines.slice(0, firstRegionStart);
const after = [];
// Retain the settings after the first replaced region, excluding the other replaced profile regions.
for (let j = firstRegionStart; j < lines.length; j += 1) {
  // Lines outside the replaced regions remain part of the user's settings.
  if (!inRegion[j]) after.push(lines[j]);
}

// Trim only blank separators immediately before the rebuilt permission profile.
while (before.length && before[before.length - 1].trim() === "") before.pop();
let trailingStart = 0;
// Trim only blank separators immediately after the rebuilt permission profile.
while (trailingStart < after.length && after[trailingStart].trim() === "")
  trailingStart += 1;

const rebuilt = [...before];
// Separate the refreshed profile from earlier retained user settings.
if (rebuilt.length > 0) rebuilt.push("");
rebuilt.push(...canonicalBlock);
// Append later retained settings with one separator after the refreshed profile.
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

# Repair existing Claude permission lists during refresh so launch warnings stop and sample environment files remain usable.
#
# Retire removed tools, rename unsupported file-rule tools and expand broad environment denies while retaining valid user rules in order.
# Report migrated or unchanged; a current settings file keeps its original bytes and formatting.
migrate_claude_permission_deny() {
  local path="$1"
  local transform_result
  stage_existing_destination "$path"
  # A failed config read or staged write discards the transform and preserves the user's previous destination.
  if ! transform_result="$(node - "$STAGED_PAYLOAD_PATH" <<'NODE'
const fs = require("node:fs");
const path = process.argv[2];

// Claude removed MultiEdit in favor of Edit; keep all three migration lists aligned with agent-config-template-parity.test.ts.
const REMOVED_CLAUDE_TOOLS = new Set(["MultiEdit"]);
// File checks use Edit(path) for editing and Read(path) for reading; these unmatched forms warn at launch and enforce nothing.
const UNMATCHED_RULE_REWRITES = new Map([
  ["Write", "Edit"],
  ["NotebookEdit", "Edit"],
  ["Glob", "Read"],
]);
// Broad environment denies blocked reading and editing .env.example even with an allow rule, because deny rules take precedence.
// Expand only denies into explicit sensitive-file variants so the user's sample file no longer matches a deny.
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
// Retire earlier generated denies that blocked read-only quoted commands or application names such as secrets routes and credentials.ts.
// Identical user-added rules cannot be distinguished, so each removal is reported for the user to inspect.
const RETIRED_DENY_RULES = new Set([
  "Bash(*sudo *)",
  "Bash(*mkfs*)",
  "Bash(*dd if=*)",
  "Bash(*git reset --hard*)",
  "Read(**/secrets/**)",
  "Edit(**/secrets/**)",
  "Read(**/credentials*)",
  "Edit(**/credentials*)",
]);
// Home credential stores need ~/ rules; a bare **/ pattern only protects paths inside the current project.
// Migrate to home paths and protect the whole .docker and .kube directories so installed Codex permissions match the shipped template.
const HOME_ANCHOR_REWRITES = new Map([
  ["Read(**/.ssh/**)", "Read(~/.ssh/**)"],
  ["Read(**/.aws/**)", "Read(~/.aws/**)"],
  ["Read(**/.gnupg/**)", "Read(~/.gnupg/**)"],
  ["Read(**/.docker/config.json)", "Read(~/.docker/**)"],
  ["Read(**/.kube/config)", "Read(~/.kube/**)"],
  ["Read(**/.npmrc)", "Read(~/.npmrc)"],
  ["Read(**/.pypirc)", "Read(~/.pypirc)"],
  ["Edit(**/.ssh/**)", "Edit(~/.ssh/**)"],
  ["Edit(**/.aws/**)", "Edit(~/.aws/**)"],
  ["Edit(**/.gnupg/**)", "Edit(~/.gnupg/**)"],
  ["Edit(**/.docker/config.json)", "Edit(~/.docker/**)"],
  ["Edit(**/.kube/config)", "Edit(~/.kube/**)"],
  ["Edit(**/.npmrc)", "Edit(~/.npmrc)"],
  ["Edit(**/.pypirc)", "Edit(~/.pypirc)"],
]);

let raw;
try {
  raw = fs.readFileSync(path, "utf8");
// A settings file removed or made unreadable during setup is left unchanged instead of replaced.
} catch {
  console.log("unchanged");
  process.exit(0);
}

let settings;
try {
  settings = JSON.parse(raw);
} catch {
  // A hand-edited syntax error leaves no safe JSON to merge; preserve the user's settings for repair.
  console.log("unchanged");
  process.exit(0);
}

const perms = settings && settings.permissions;
// Without a permissions object, there are no existing Claude rule lists to migrate.
if (!perms || typeof perms !== "object") {
  console.log("unchanged");
  process.exit(0);
}

// Split a permission rule into tool name and path pattern; null for non-rules.
const parseRule = (entry) =>
  typeof entry === "string" ? entry.match(/^([A-Za-z]+)\((.*)\)$/u) : null;

// Replace a stale permission rule; an empty list retires it, while null keeps the user's existing rule.
// Only deny rules receive retirement, environment expansion and home anchoring; matching allow or ask choices remain as saved.
const replacementsFor = (entry, isDenyList) => {
  // A retired deny rule has no replacement; the user's allow and ask rules do not enter this retirement.
  if (isDenyList && RETIRED_DENY_RULES.has(entry)) return [];
  // A retired home-path deny rule receives the current anchored form.
  if (isDenyList && HOME_ANCHOR_REWRITES.has(entry)) {
    return [HOME_ANCHOR_REWRITES.get(entry)];
  }
  // A broad retired environment deny expands into the current explicit sensitive-file rules.
  if (isDenyList && ENV_DENY_EXPANSIONS.has(entry)) {
    return ENV_DENY_EXPANSIONS.get(entry);
  }
  const rule = parseRule(entry);
  // A renamed permission tool gets the current rule spelling while retaining the user's path pattern.
  if (rule && UNMATCHED_RULE_REWRITES.has(rule[1])) {
    return [`${UNMATCHED_RULE_REWRITES.get(rule[1])}(${rule[2]})`];
  }
  return null;
};

// Repair stale permission rules and avoid duplicate replacements while retaining untouched user rules in order.
// Return the repaired array, or null when the saved list needs no change.
const repairRules = (rules, isDenyList) => {
  // A missing or malformed rule list returns null so setup leaves that setting untouched.
  if (!Array.isArray(rules)) return null;
  const survivors = rules.filter((entry) => {
    const rule = parseRule(entry);
    return !(rule && REMOVED_CLAUDE_TOOLS.has(rule[1]));
  });
  const present = new Set(
    survivors.filter((entry) => replacementsFor(entry, isDenyList) === null),
  );
  const kept = [];
  // Repair surviving rules in order so unrelated user permissions keep their positions.
  for (const entry of survivors) {
    const replacements = replacementsFor(entry, isDenyList);
    // A rule needing no replacement is retained exactly as the user saved it.
    if (replacements === null) {
      kept.push(entry);
      continue;
    }
    // A retired rule has no replacement; name it so a user who typed the same rule can restore it on purpose.
    if (replacements.length === 0) {
      console.error(`  - retired Claude deny rule removed: ${entry}`);
    }
    // Append each replacement once without duplicating a restriction already present.
    for (const replacement of replacements) {
      // An existing equivalent rule already expresses this permission choice.
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
// Only denies receive environment expansion and home anchoring; applying these to allows would revoke the user's .env.example read choice.
for (const [arrayName, isDenyList] of [
  ["deny", true],
  ["allow", false],
  ["ask", false],
]) {
  const repaired = repairRules(perms[arrayName], isDenyList);
  // Replace a permission array only when its repaired rules differ from the user's saved array.
  if (repaired) {
    perms[arrayName] = repaired;
    migrated = true;
  }
}

// If every permission list is current, preserve the user's settings file unchanged.
if (!migrated) {
  console.log("unchanged");
  process.exit(0);
}
const eol = raw.includes("\r\n") ? "\r\n" : "\n";
const hadFinalNewline = /\r?\n$/u.test(raw);
let out = JSON.stringify(settings, null, 2);
// Restore Windows newlines when that was the user's existing settings style.
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

# Check the active Codex permission profile before setup reports completion; return problem text for the user to repair.
validate_codex_settings_after_install() {
  local path="$1"
  node - "$path" <<'NODE'
const fs = require("node:fs");
const path = process.argv[2];
// An absent Codex settings file has no installed permission profile to validate.
if (!fs.existsSync(path)) {
  console.log("ok");
  process.exit(0);
}
const content = fs.readFileSync(path, "utf8");
const problems = new Set();

// Single source of truth: must match isInvalidNoneKey in migrate_codex_filesystem_permissions.
//
// Use during setup validation to report unsupported none globs before the user launches Codex.
// Exact paths and trailing /** subtrees pass; other globs require repair.
function isInvalidNoneKey(key) {
  // An exact path contains no unsupported glob and passes this compatibility check.
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

// Decode a quoted permission profile or key so setup and validation use the user's actual saved spelling.
function parseTomlBasicString(value) {
  try {
    return JSON.parse(`"${value}"`);
  // A quoted TOML value with escapes JSON cannot decode keeps the simple quote/backslash fallback for profile matching.
  } catch {
    return value.replace(/\\"/gu, '"').replace(/\\\\/gu, "\\");
  }
}

// Select the user's nonempty default permission profile; absent or empty selections use the managed goat-flow profile.
function readActivePermissionProfile(configLines) {
  // Find the user's explicit active permission profile before falling back to the managed profile.
  for (const line of configLines) {
    const basicMatch = line.match(
      /^\s*default_permissions\s*=\s*"((?:\\.|[^"\\])*)"\s*(?:#.*)?$/u,
    );
    // A quoted default profile selects which permission table completion must validate.
    if (basicMatch) {
      const profile = parseTomlBasicString(basicMatch[1]).trim();
      // An empty decoded selection leaves validation to the default profile fallback.
      if (profile) return profile;
    }
    const literalMatch = line.match(
      /^\s*default_permissions\s*=\s*'([^']+)'\s*(?:#.*)?$/u,
    );
    // A nonempty literal selection identifies the user's active permission profile.
    if (literalMatch && literalMatch[1].trim()) return literalMatch[1].trim();
  }
  return "goat-flow";
}

// Match the user's permission profile name literally so punctuation cannot select another TOML table.
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

// Validate only the active [permissions.<default_permissions>.filesystem*] profile, keeping unrelated user tables outside these checks.
// A bare "*.pem" = "none" in another table is not a Codex filesystem error.
const regions = [];
const profileRegions = [];
let i = 0;
// Find only the active permission profile before reporting setup problems.
while (i < lines.length) {
  // Record the active profile's metadata region for workspace inheritance validation.
  if (profileSectionPattern.test(lines[i])) {
    const start = i;
    i += 1;
    // Bound profile metadata at the next table so unrelated settings cannot produce false errors.
    while (i < lines.length && !anySectionPattern.test(lines[i])) i += 1;
    profileRegions.push({ start, end: i });
  // Record the active filesystem regions whose restrictions Codex will apply.
  } else if (filesystemSectionPattern.test(lines[i])) {
    const start = i;
    i += 1;
    // Bound each filesystem region at the next TOML table.
    while (i < lines.length && !anySectionPattern.test(lines[i])) i += 1;
    regions.push({ start, end: i });
  } else {
    i += 1;
  }
}

let profileExtendsWorkspace = false;
// Check the active profile's metadata for its base workspace permissions.
for (const region of profileRegions) {
  // Inspect each metadata line without validating unrelated permission profiles.
  for (let j = region.start; j < region.end; j += 1) {
    // Workspace inheritance satisfies this profile's required base editing contract.
    if (/^\s*extends\s*=\s*":workspace"\s*(?:#.*)?$/u.test(lines[j])) {
      profileExtendsWorkspace = true;
    }
  }
}
// An active managed profile without workspace inheritance cannot be reported as usable.
if (
  activeProfile === "goat-flow" &&
  hasDefaultPermissions &&
  !profileExtendsWorkspace
) {
  problems.add('active goat-flow profile does not extend ":workspace"');
}

// Validate each active filesystem region before reporting setup completion.
for (const region of regions) {
  // Inspect each active permission entry for incompatible legacy forms.
  for (let j = region.start; j < region.end; j += 1) {
    const line = lines[j];
    const match = line.match(sectionEntryPattern);
    // An unsupported none glob is reported with the entry the user needs to repair.
    if (match && isInvalidNoneKey(match[1])) {
      problems.add(`section entry "${match[1]}" with access="none"`);
    }
    // A remaining legacy none value is reported rather than silently accepted.
    if (legacyAccessPattern.test(line) || legacyInlineAccessPattern.test(line)) {
      problems.add('legacy access value "none" still present');
    }
    // A remaining retired project-root anchor is reported for settings repair.
    if (legacyProjectRootsPattern.test(line)) {
      problems.add("legacy :project_roots anchor still present");
    }
    const inlineMatch = line.match(inlineTablePattern);
    // Inline permission tables receive the same checks as block entries.
    if (inlineMatch) {
      // Inspect every inline none entry in the active permission table.
      for (const entry of inlineMatch[1].matchAll(inlineEntryPattern)) {
        // An unsupported inline glob is included in the user's repair report.
        if (isInvalidNoneKey(entry[1])) {
          problems.add(`inline entry "${entry[1]}" with access="none"`);
        }
      }
    }
  }
}

// Collected permission problems prevent setup from claiming a usable Codex configuration.
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
# Create the learning, plan, log and hook folders that the selected project's workflows use.
for dir in .goat-flow/learning-loop/footguns .goat-flow/learning-loop/lessons .goat-flow/learning-loop/patterns .goat-flow/learning-loop/decisions .goat-flow/plans .goat-flow/scratchpad .goat-flow/state/locks .goat-flow/logs/sessions .goat-flow/logs/quality .goat-flow/logs/events .goat-flow/logs/critiques .goat-flow/logs/review .goat-flow/logs/security .goat-flow/skill-docs .goat-flow/skill-docs/playbooks .goat-flow/skill-docs/skill-quality-testing .goat-flow/hooks .goat-flow/hooks/deny-dangerous; do
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
# 4. Retire transitional skill references after installing their current replacements.
#
#    Doctrine lives at .goat-flow/skill-docs/; playbooks live in its playbooks/ folder.
#    Skill-authoring methodology lives at .goat-flow/skill-docs/skill-quality-testing/.
# ==========================================================================
legacy_reference_files=(
  ".goat-flow/skill-docs/browser-use.md"
  ".goat-flow/skill-docs/page-capture.md"
  ".goat-flow/skill-docs/skill-quality-testing.md"
)
removed_any=false
# Check the listed legacy references after their canonical replacements are available.
for legacy_file in "${legacy_reference_files[@]}"; do
  # Remove a legacy file only when that exact retired path exists.
  if [[ -f "$legacy_file" ]]; then
    rm -f "$legacy_file"
    # Retiring the old QA reference also retires its obsolete QA playbook folder.
    if [[ "$legacy_file" == ".goat-flow/skill-docs/skill-quality-testing.md" ]]; then
      echo "  ✓ migrated $legacy_file → .goat-flow/skill-docs/skill-quality-testing/README.md"
    else
      echo "  ✓ migrated $legacy_file → .goat-flow/skill-docs/playbooks/"
    fi
    removed_any=true
  fi
done
# Report the removed references so the user can see what this refresh retired.
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
# Retired playbooks may contain local guidance that users still need while adopting the replacement documents.
for retired_writing_playbook in \
  ".goat-flow/skill-docs/playbooks/writing-for-agents.md" \
  ".goat-flow/skill-docs/playbooks/writing-style.md"; do
  # An upgrade may find a locally edited copy; leave review and removal to the project owner.
  if [[ -f "$retired_writing_playbook" ]]; then
    echo "  - retained retired $retired_writing_playbook; review local content before removing it"
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
# Install each canonical skill for the selected agent using the manifest's file list.
for skill in "${SKILL_NAMES[@]}"; do
  skill_dir="$GOAT_FLOW_ROOT/workflow/skills/$skill"
  # A missing shipped skill is reported and skipped instead of creating an empty installed workflow.
  if [[ ! -d "$skill_dir" ]]; then
    echo "  ✗ $skill (template dir not found: $skill_dir)"
    continue
  fi
  readarray -t skill_files < <(manifest_eval skill-files "$skill")
  prune_unlisted_skill_references "$skill" "$SKILLS_DIR/$skill" "${skill_files[@]}"
  # Copy only the declared skill entry point and references into the user's agent directory.
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
  # Retired skill names need cleanup only when the manifest declares any.
  if [[ ${#STALE_NAMES[@]} -gt 0 ]]; then
    DEPRECATED_REMOVED=0
    echo "Deprecated skill cleanup:"
    # Check each retired skill destination without touching unrelated agent workflows.
    for stale in "${STALE_NAMES[@]}"; do
      [[ -n "$stale" ]] || continue
      stale_path="$SKILLS_DIR/$stale"
      # Remove an existing retired skill so the agent cannot discover its obsolete instructions.
      if [[ -d "$stale_path" ]]; then
        rm -rf "$stale_path"
        DEPRECATED_REMOVED=$((DEPRECATED_REMOVED + 1))
        REMOVED=$((REMOVED + 1))
        echo "  ✗ $stale_path (removed)"
      fi
    done
    # Tell the user when there were no retired skill folders to remove.
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
  # Change the saved framework version only when the user requested a version refresh.
  if $UPDATE_CONFIG_VERSION; then
    # Replace the existing version entry; a config without one receives a new entry.
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
  # Show the user which config migrations changed their saved setup.
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
  printf 'version: "%s"\n\nskills:\n  install: all\n\nhooks:\n  deny-dangerous:\n    enabled: true\n  deny-git-mutations:\n    enabled: true\n  post-turn-safety:\n    enabled: true\n  gruff-code-quality:\n    enabled: false\n' "$VERSION" > "$STAGED_PAYLOAD_PATH"
  # A first install may scaffold config, but a concurrent or existing user file wins.
  commit_staged_payload "$CONFIG_PATH" "create-only"
  COPIED=$((COPIED + 1))
  ensure_config_gruff_binary_entry "$CONFIG_PATH"
  # Report the newly saved Gruff path only when this transform added an override.
  if [[ "$LAST_TRANSFORM_RESULT" == "changed" ]]; then
    echo "  ✓ $CONFIG_PATH (scaffolded; strands_agents gruff-py path detected)"
  else
    echo "  ✓ $CONFIG_PATH (scaffolded)"
  fi
fi
echo ""

# Establish requested Git protection in every existing provider before shared policy bytes change.
# The selected provider may be new; seed its ordinary config before registration, preserving existing settings.
if $HOOKS_ENABLED; then
  # A provider with a separate hook file establishes Git protection in that dedicated destination.
  if [[ -n "${HOOK_CONFIG_DST:-}" && -n "${HOOK_CONFIG_SRC:-}" ]]; then
    copy_if_missing "$GOAT_FLOW_ROOT/$HOOK_CONFIG_SRC" "$HOOK_CONFIG_DST"
  # A provider with embedded hooks establishes Git protection in its settings destination.
  elif [[ -n "${SETTINGS_DST:-}" && -n "${SETTINGS_SRC:-}" ]]; then
    copy_if_missing "$GOAT_FLOW_ROOT/$SETTINGS_SRC" "$SETTINGS_DST"
  fi
  policy_providers="$(node - "$GOAT_FLOW_ROOT/workflow/hooks/agent-config/managed-hook-desired-state.json" <<'NODE'
const contract = require(process.argv[2]);
// An incomplete generated Git-protection contract stops setup before reconciling provider files.
if (!contract.agents || !Object.values(contract.agents).every((entry) => entry.hooks?.["deny-git-mutations"])) {
  throw new Error("Split Git policy registration contract is incomplete");
}
// Emit each provider's Git-guard config destination for the existing-install reconciliation pass.
for (const [agent, definition] of Object.entries(contract.agents)) {
  console.log(`${agent}\t${definition.hookConfigFile}`);
}
NODE
  )" || exit 1
  # Reconcile Git protection only in provider files the user already has installed.
  while IFS=$'\t' read -r policy_agent policy_config_path; do
    [[ -f "$policy_config_path" ]] || continue
    migrate_agent_hook_config "$policy_config_path" "$policy_agent" "deny-git-mutations"
  done <<< "$policy_providers"
fi

# ==========================================================================
# 8. Install hooks (always overwrite - verbatim copy)
# ==========================================================================
if $HOOKS_ENABLED; then
  echo "Hooks → $HOOKS_DIR/:"
  copy_file "$GOAT_FLOW_ROOT/workflow/hooks/run-with-bash.mjs" "$HOOKS_DIR/run-with-bash.mjs" "system-owned" "755"
  copy_file "$GOAT_FLOW_ROOT/workflow/hooks/hook-provider-adapters.mjs" "$HOOKS_DIR/hook-provider-adapters.mjs" "system-owned" "755"
  copy_file "$GOAT_FLOW_ROOT/workflow/hooks/hook-launch-runtime.mjs" "$HOOKS_DIR/hook-launch-runtime.mjs" "system-owned" "755"
  copy_file "$GOAT_FLOW_ROOT/workflow/hooks/hook-policy-state.cjs" "$HOOKS_DIR/hook-policy-state.cjs" "system-owned" "644"
  copy_file "$GOAT_FLOW_ROOT/workflow/hooks/vendor/js-yaml.cjs" "$HOOKS_DIR/vendor/js-yaml.cjs" "system-owned" "644"
  copy_file "$GOAT_FLOW_ROOT/workflow/hooks/gh-graphql-read.cjs" "$HOOKS_DIR/gh-graphql-read.cjs" "system-owned" "644"
  copy_file "$GOAT_FLOW_ROOT/workflow/hooks/vendor/graphql.cjs" "$HOOKS_DIR/vendor/graphql.cjs" "system-owned" "644"
  copy_file "$GOAT_FLOW_ROOT/workflow/hooks/deny-git-mutations.sh" "$HOOKS_DIR/deny-git-mutations.sh" "system-owned" "755"
  copy_file "$GOAT_FLOW_ROOT/workflow/hooks/deny-dangerous.sh" "$HOOKS_DIR/deny-dangerous.sh" "system-owned" "755"
  copy_file "$GOAT_FLOW_ROOT/workflow/hooks/gruff-code-quality.sh" "$HOOKS_DIR/gruff-code-quality.sh" "system-owned" "755"
  copy_file "$GOAT_FLOW_ROOT/workflow/hooks/post-turn-safety.sh" "$HOOKS_DIR/post-turn-safety.sh" "system-owned" "755"
  prune_unlisted_hook_files "$HOOKS_DIR"
  prune_legacy_agent_hook_copies
  echo "Hook policy → .goat-flow/hooks/deny-dangerous/:"
  # Install the shared policy reader and launch support used by the selected agent's guards.
  for hook_policy_script in \
    guard-runtime.sh \
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
  # A dedicated hook file is seeded or reconciled separately from the provider's settings.
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
# Seed or migrate settings only for providers whose manifest declares a settings file.
if [[ -n "${SETTINGS_SRC:-}" && -n "${SETTINGS_DST:-}" ]]; then
  # Existing settings receive narrow migrations; a managed force refresh cannot replace the user's permissions or comments.
  if [[ -f "$SETTINGS_DST" ]]; then
    SETTINGS_MIGRATIONS=()
    # Refresh Codex's hook flag and filesystem permissions in the staged settings file.
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
    # Refresh Claude's permission rules while preserving the user's other settings.
    elif [[ "$AGENT" == "claude" ]]; then
      migrate_claude_permission_deny "$SETTINGS_DST"
      # A migrated result removes launch warnings (removed tools, unmatched
      # Write/NotebookEdit/Glob rules) and applies the enumerated env policy.
      if [[ "$LAST_TRANSFORM_RESULT" == "migrated" ]]; then
        SETTINGS_MIGRATIONS+=("stale or superseded permission rules")
      fi
    fi
    # Summarize completed settings migrations so the user can inspect the refresh.
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
  # Migrate an existing local Claude override as well as the shared settings file.
  if [[ -f "$SETTINGS_LOCAL_DST" ]]; then
    migrate_claude_permission_deny "$SETTINGS_LOCAL_DST"
    # Report local permission changes only when the override actually changed.
    if [[ "$LAST_TRANSFORM_RESULT" == "migrated" ]]; then
      COPIED=$((COPIED + 1))
      echo "  ✓ $SETTINGS_LOCAL_DST (migrated: stale or superseded permission rules)"
    fi
  fi
fi
# Validate installed Codex settings before reporting a usable agent setup.
if [[ "$AGENT" == "codex" && -n "${SETTINGS_DST:-}" && -f "$SETTINGS_DST" ]]; then
  CODEX_VALIDATION="$(validate_codex_settings_after_install "$SETTINGS_DST")"
  # Invalid Codex permissions stop completion and show the settings the user needs to repair.
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
# Providers without a separate hook file receive enabled registrations in their existing settings.
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
# The goat and goat-plan skills read .goat-flow/plans/.active to select the user's current plan (ADR-017).
# Write this one-line directory marker automatically only when exactly one plan can be selected.
echo "Active plan marker:"
ACTIVE_FILE=".goat-flow/plans/.active"
# Keep the user's current plan pin instead of selecting another plan during refresh.
if [[ -f "$ACTIVE_FILE" ]]; then
  SKIPPED=$((SKIPPED + 1))
  echo "  · $ACTIVE_FILE (exists, skipped)"
else
  shopt -s nullglob
  version_subdirs=()
  # Look for versioned plan folders when setup needs to create an initial plan pin.
  for d in .goat-flow/plans/[0-9]*.[0-9]*.[0-9]*/; do
    [[ -d "$d" ]] && version_subdirs+=("$(basename "$d")")
  done
  shopt -u nullglob
  # One version folder gives setup an unambiguous initial plan destination.
  if [[ ${#version_subdirs[@]} -eq 1 ]]; then
    prepare_staged_payload "$ACTIVE_FILE"
    printf '%s\n' "${version_subdirs[0]}" > "$STAGED_PAYLOAD_PATH"
    # Setup suggests an unambiguous first marker but never overrides the user's selected plan.
    commit_staged_payload "$ACTIVE_FILE" "create-only"
    COPIED=$((COPIED + 1))
    echo "  ✓ $ACTIVE_FILE → ${version_subdirs[0]}"
  # Without a version folder, leave plan selection for the later project setup step.
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
  # Show Claude users where to merge the preserved project instructions after refresh.
  if [[ "$AGENT" == "claude" ]]; then
    echo ""
    echo "  For Claude, reconcile $SETTINGS_DST, then run:"
    echo "    npx @blundergoat/goat-flow@$VERSION hooks sync"
  # Show Codex users where to merge the preserved project instructions after refresh.
  elif [[ "$AGENT" == "codex" ]]; then
    echo ""
    echo "  For Codex, sync hooks or mirror workflow/hooks/agent-config/codex-hooks.json."
    echo "  Do not restore a direct .goat-flow/hooks/deny-dangerous.sh command; Codex hooks"
    echo "  run from the session cwd and need the Node git-root launcher."
  fi
  echo ""
fi

# Earlier ignore templates hid some setup files, so check Git's ignored-path status before telling the user where files may be hidden.
# Report existing ignored folders inside a Git repository; staging those files remains the user's choice.
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  hidden_paths=()
  # Inspect setup folders that a broad ignore rule might hide from the user's file searches.
  for hint_dir in \
    ".goat-flow/learning-loop" \
    ".goat-flow/skill-docs" \
    ".goat-flow/hooks" \
    ".goat-flow/plans"
  do
    # Record an existing folder only when Git confirms that it is ignored.
    if [[ -d "$hint_dir" ]] && \
       git -C . check-ignore -q "$hint_dir/." 2>/dev/null; then
      hidden_paths+=("$hint_dir/")
    fi
  done
  # Explain hidden setup folders when at least one was found.
  if [[ ${#hidden_paths[@]} -gt 0 ]]; then
    echo "⚠ Some installed directories are still gitignored:"
    # List each hidden path so the user knows where to inspect their installed workflow.
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
