/**
 * Read agent support metadata for CLI prompts, audits, setup, and dashboard cards.
 * Use when a user picks an agent or when goat-flow needs to show which agent surfaces are available.
 * The manifest stays the single source of truth, while this file turns it into runtime-friendly profiles.
 */
import { loadManifest } from "../manifest/manifest.js";
import type {
  AgentProfile as ManifestAgentProfile,
  Manifest,
  ManifestDenyMechanism,
} from "../manifest/types.js";
import {
  KNOWN_AGENT_IDS,
  type AgentId,
  type AgentProfile,
  type DenyMechanism,
} from "../types.js";

/** Re-export the user-visible agent ids supported throughout CLI and dashboard flows. */
export { KNOWN_AGENT_IDS } from "../types.js";

type ManifestAgents = Manifest["agents"];

/**
 * Normalize a directory path before the UI shows it or uses it for navigation.
 * Use when a manifest path may have a trailing slash but still points at the same user-facing folder.
 *
 * @param directoryPath - directory from the manifest; `undefined` or empty means no folder is available
 *   for setup, audit, or dashboard actions
 * @returns the directory without one trailing slash, or `null` when no usable path exists
 */
function trimTrailingDirectorySlash(
  directoryPath: string | undefined,
): string | null {
  // No directory is available yet, so user-facing setup and audit actions cannot target it.
  if (!directoryPath) return null;

  return directoryPath.replace(/\/$/, "");
}

/**
 * Check whether a manifest key is one of the agent ids the user can select.
 * Use before turning manifest data into CLI flags, setup prompts, or dashboard rows.
 *
 * @param agentIdCandidate - manifest key being checked; an empty value means there is no selectable agent
 * @returns `true` when the id is supported by the visible agent list, otherwise `false`
 */
function isAgentId(agentIdCandidate: string): agentIdCandidate is AgentId {
  return (KNOWN_AGENT_IDS as readonly string[]).includes(agentIdCandidate);
}

/**
 * Convert manifest guardrail metadata into the runtime shape used by audit and setup screens.
 * Use when the UI needs to explain how an agent blocks unsafe commands.
 *
 * @param deny - manifest guardrail entry; missing paths mean the relevant setup surface cannot be shown
 * @returns runtime guardrail shape that downstream audit checks and dashboard labels understand
 */
function toRuntimeDenyMechanism(deny: ManifestDenyMechanism): DenyMechanism {
  // Settings-only guardrails show users the config file they need to inspect or install.
  if (deny.type === "settings-deny") {
    return { type: "settings-deny", path: deny.path };
  }

  // Script-only guardrails show users the hook file that enforces command safety.
  if (deny.type === "deny-script") {
    return { type: "deny-script", path: deny.path };
  }

  return {
    type: "both",
    settingsPath: deny.settings_path,
    scriptPath: deny.script_path,
  };
}

/**
 * Read a required manifest directory for an agent setup surface.
 * Use when missing metadata would leave the UI pointing users at nowhere.
 *
 * @param id - agent whose setup metadata is being loaded; empty is impossible after manifest id validation
 * @param field - manifest field name shown in the error; empty would make the operator message unclear
 * @param directoryPath - manifest directory value; `undefined` or empty blocks that agent setup path
 * @returns normalized directory path shown to CLI and dashboard users
 */
function requireManifestDirectory(
  id: AgentId,
  field: string,
  directoryPath: string | undefined,
): string {
  const trimmedDirectoryPath = trimTrailingDirectorySlash(directoryPath);

  // Missing setup directories make the selected agent impossible to install correctly.
  if (!trimmedDirectoryPath) {
    throw new Error(`workflow/manifest.json agent "${id}" is missing ${field}`);
  }

  return trimmedDirectoryPath;
}

/**
 * Read a required manifest capability before it appears in prompts or dashboard cards.
 * Use when missing copy would make the next setup action ambiguous for the user.
 *
 * @param id - agent whose capability is being loaded; empty is impossible after manifest id validation
 * @param field - capability field shown in the error; empty would make the operator message unclear
 * @param capabilityText - capability value from the manifest; `undefined` or empty blocks the setup prompt
 * @returns trimmed capability text that can be shown or passed through the CLI
 */
function requireAgentCapabilityText(
  id: AgentId,
  field: string,
  capabilityText: string | undefined,
): string {
  const trimmedCapabilityText = capabilityText?.trim();

  // Missing capability text leaves users without the command or label they need next.
  if (!trimmedCapabilityText) {
    throw new Error(
      `workflow/manifest.json agent "${id}" is missing capabilities.${field}`,
    );
  }

  return trimmedCapabilityText;
}

/**
 * Build the runtime profile used by audit, prompts, setup, and dashboard surfaces.
 * Use when the user-facing agent list needs manifest data in camelCase runtime fields.
 *
 * @param id - supported agent id being shown or audited; empty is impossible after manifest validation
 * @param agent - manifest agent entry; absent nested fields become `null` only when the UI can handle that
 * @returns runtime agent profile consumed by CLI and dashboard flows
 */
function toRuntimeProfile(
  id: AgentId,
  agent: ManifestAgentProfile,
): AgentProfile {
  const capabilities = agent.capabilities;
  return {
    id,
    name: agent.name,
    instructionFile: agent.instruction_file,
    terminalBinary: requireAgentCapabilityText(
      id,
      "terminal_binary",
      capabilities.terminal_binary,
    ),
    setupSurfaces: [...capabilities.setup_surfaces],
    promptInvocationStyle: capabilities.prompt_invocation_style,
    skillSource: capabilities.skill_source,
    supportsPostTurnHook: agent.hook_events?.post_turn != null,
    settingsFile: agent.settings ?? null,
    hookConfigFile: agent.hook_config_file ?? agent.settings ?? null,
    skillsDir: requireManifestDirectory(id, "skills_dir", agent.skills_dir),
    hooksDir: trimTrailingDirectorySlash(agent.hooks_dir),
    denyMechanism: agent.deny_mechanism
      ? toRuntimeDenyMechanism(agent.deny_mechanism)
      : null,
    denyHookFile: agent.deny_hook ?? null,
    localPattern: agent.local_pattern,
    hookEvents: agent.hook_events
      ? {
          preTool: agent.hook_events.pre_tool,
          postTurn: agent.hook_events.post_turn ?? null,
        }
      : null,
  };
}

/**
 * Return the manifest-backed runtime profile for one agent id.
 * Use when a CLI command or dashboard action needs details for the agent the user selected.
 * Throws when the manifest is missing that agent so setup does not show a broken profile.
 *
 * @param id - supported agent id to resolve; empty is impossible because callers use typed agent ids
 * @returns runtime profile derived from `workflow/manifest.json` for the selected agent
 */
export function getAgentProfile(id: AgentId): AgentProfile {
  const agents = loadManifest().agents;
  const manifestAgent = agents[id];

  // A supported agent without manifest data would leave setup and audit screens inconsistent.
  if (!manifestAgent) {
    throw new Error(`workflow/manifest.json is missing agent "${id}"`);
  }

  return toRuntimeProfile(id, manifestAgent);
}

/**
 * Return manifest entries for agents the user can actually choose.
 * Use before building ordered setup prompts, audits, or dashboard rows from the manifest.
 *
 * @param agents - manifest agent map; empty means no user-selectable agent profiles can be built
 * @returns supported manifest entries in manifest order, or an empty list when none are present
 */
function getKnownManifestAgents(
  agents: ManifestAgents,
): Array<[AgentId, ManifestAgentProfile]> {
  // Unknown manifest keys are ignored so experimental entries do not appear in the UI by accident.
  return Object.entries(agents).filter(
    (entry): entry is [AgentId, ManifestAgentProfile] =>
      isKnownAgentId(entry[0], agents),
  );
}

/**
 * Return the manifest-backed runtime profile record keyed by agent id.
 * Use when a screen needs quick lookup by the agent the user selected.
 *
 * @returns all supported runtime profiles as an id-keyed map; empty means no selectable agents loaded
 */
export function getAgentProfileMap(): Record<AgentId, AgentProfile> {
  const agents = loadManifest().agents;

  // Profiles stay keyed by id so dashboards and prompts can merge them with audit results.
  return Object.fromEntries(
    getKnownManifestAgents(agents).map(([id, agent]) => [
      id,
      toRuntimeProfile(id, agent),
    ]),
  ) as Record<AgentId, AgentProfile>;
}

/**
 * Return all known manifest-backed runtime profiles in canonical order.
 * Use when rendering the same agent order across CLI output, setup prompts, and dashboard cards.
 *
 * @returns supported runtime profiles in manifest order; empty means no selectable agents loaded
 */
export function getAgentProfiles(): AgentProfile[] {
  const agents = loadManifest().agents;

  // The manifest order is the user-facing order shown by setup and dashboard surfaces.
  return getKnownManifestAgents(agents).map(([id, agent]) =>
    toRuntimeProfile(id, agent),
  );
}

/**
 * Return the manifest-backed supported agent ids.
 * Use when a command needs the selectable agent ids without full profile details.
 *
 * @returns supported agent ids in manifest order; empty means no selectable agents loaded
 */
export function getKnownAgentIds(): AgentId[] {
  const agents = loadManifest().agents;

  // The id list mirrors the same ordering users see in setup and audit output.
  return getKnownManifestAgents(agents).map(([id]) => id);
}

/**
 * Check whether a manifest key is both known to the app and present in the manifest.
 * Use to keep incomplete or experimental agents out of user-facing lists.
 *
 * @param agentIdCandidate - manifest key being checked; empty means no selectable agent
 * @param agents - manifest agent map; empty means no manifest-backed agent can be selected
 * @returns `true` when the id is known and present, otherwise `false`
 */
function isKnownAgentId(
  agentIdCandidate: string,
  agents: ManifestAgents = loadManifest().agents,
): agentIdCandidate is AgentId {
  // Both checks must pass before the id appears in setup, audit, or dashboard choices.
  return (
    isAgentId(agentIdCandidate) &&
    Object.prototype.hasOwnProperty.call(agents, agentIdCandidate)
  );
}
