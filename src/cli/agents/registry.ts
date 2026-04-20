/**
 * Manifest-backed agent registry (M12).
 *
 * `workflow/manifest.json` is the single writable authority for framework
 * support metadata. This module exposes the typed runtime facade consumed by
 * detection, prompts, config validation, and dashboard surfaces.
 */
import type { LoadedConfig } from "../config/types.js";
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

/** Re-export the canonical runtime authority for agent identity. */
export { KNOWN_AGENT_IDS } from "../types.js";

type ManifestAgents = Manifest["agents"];

/** Trim the trailing slash from a directory path. */
function trimDir(path: string | undefined): string | null {
  if (!path) return null;
  return path.replace(/\/$/, "");
}

/** Check whether a value is an agent ID. */
function isAgentId(value: string): value is AgentId {
  return (KNOWN_AGENT_IDS as readonly string[]).includes(value);
}

/** Convert manifest deny config into the runtime shape. */
function toDenyMechanism(deny: ManifestDenyMechanism): DenyMechanism {
  if (deny.type === "settings-deny") {
    return { type: "settings-deny", path: deny.path };
  }
  if (deny.type === "deny-script") {
    return { type: "deny-script", path: deny.path };
  }
  return {
    type: "both",
    settingsPath: deny.settings_path,
    scriptPath: deny.script_path,
  };
}

/** Require a manifest directory field to be present and non-empty. */
function requireDir(
  id: AgentId,
  field: string,
  path: string | undefined,
): string {
  const trimmed = trimDir(path);
  if (!trimmed) {
    throw new Error(`workflow/manifest.json agent "${id}" is missing ${field}`);
  }
  return trimmed;
}

/** Convert a manifest agent entry into the runtime profile. */
function toRuntimeProfile(
  id: AgentId,
  agent: ManifestAgentProfile,
): AgentProfile {
  return {
    id,
    name: agent.name,
    instructionFile: agent.instruction_file,
    settingsFile: agent.settings ?? null,
    hookConfigFile: agent.hook_config_file ?? agent.settings ?? null,
    skillsDir: requireDir(id, "skills_dir", agent.skills_dir),
    hooksDir: trimDir(agent.hooks_dir),
    denyMechanism: toDenyMechanism(agent.deny_mechanism),
    denyHookFile: agent.deny_hook ?? null,
    localPattern: agent.local_pattern,
    hookEvents: {
      preTool: agent.hook_events.pre_tool,
      postTurn: agent.hook_events.post_turn ?? null,
    },
  };
}

/** Return the manifest-backed runtime profile for one agent id. */
export function getAgentProfile(id: AgentId): AgentProfile {
  const agents = loadManifest().agents;
  const manifestAgent = agents[id];
  if (!manifestAgent) {
    throw new Error(`workflow/manifest.json is missing agent "${id}"`);
  }
  return toRuntimeProfile(id, manifestAgent);
}

/** Return manifest-backed agent entries that match the supported runtime ids. */
function getKnownManifestAgents(
  agents: ManifestAgents,
): Array<[AgentId, ManifestAgentProfile]> {
  return Object.entries(agents).filter(
    (entry): entry is [AgentId, ManifestAgentProfile] =>
      isKnownAgentId(entry[0], agents),
  );
}

/** Return the manifest-backed runtime profile record keyed by agent id. */
export function getAgentProfileMap(): Record<AgentId, AgentProfile> {
  const agents = loadManifest().agents;
  return Object.fromEntries(
    getKnownManifestAgents(agents).map(([id, agent]) => [
      id,
      toRuntimeProfile(id, agent),
    ]),
  ) as Record<AgentId, AgentProfile>;
}

/** Return all known manifest-backed runtime profiles in canonical order. */
export function getAgentProfiles(): AgentProfile[] {
  const agents = loadManifest().agents;
  return getKnownManifestAgents(agents).map(([id, agent]) =>
    toRuntimeProfile(id, agent),
  );
}

/** Return the manifest-backed supported agent ids. */
export function getKnownAgentIds(): AgentId[] {
  const agents = loadManifest().agents;
  return getKnownManifestAgents(agents).map(([id]) => id);
}

/** Type guard for manifest-backed agent ids. */
function isKnownAgentId(
  value: string,
  agents: ManifestAgents = loadManifest().agents,
): value is AgentId {
  return (
    isAgentId(value) && Object.prototype.hasOwnProperty.call(agents, value)
  );
}

/** Return configured agents as manifest-backed runtime profiles. */
export function getConfiguredAgents(config: LoadedConfig): AgentProfile[] {
  const configured = config.config.agents;
  if (configured === null) {
    return getAgentProfiles();
  }
  const agents = loadManifest().agents;
  return configured
    .filter((id): id is AgentId => isKnownAgentId(id, agents))
    .map((id) => toRuntimeProfile(id, agents[id]!));
}

/** Return configured agent ids that do not exist in the manifest-backed registry. */
export function findUnknownConfiguredAgents(configured: string[]): string[] {
  const agents = loadManifest().agents;
  return configured.filter((id) => !isKnownAgentId(id, agents));
}
