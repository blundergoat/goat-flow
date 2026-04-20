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
    skillsDir: trimDir(agent.skills_dir) ?? "",
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
  const manifestAgent = loadManifest().agents[id];
  if (!manifestAgent) {
    throw new Error(`workflow/manifest.json is missing agent "${id}"`);
  }
  return toRuntimeProfile(id, manifestAgent);
}

/** Return the manifest-backed runtime profile record keyed by agent id. */
export function getAgentProfileMap(): Record<AgentId, AgentProfile> {
  return Object.fromEntries(
    getKnownAgentIds().map((id) => [id, getAgentProfile(id)]),
  ) as Record<AgentId, AgentProfile>;
}

/** Return all known manifest-backed runtime profiles in canonical order. */
export function getAgentProfiles(): AgentProfile[] {
  return getKnownAgentIds().map((id) => getAgentProfile(id));
}

/** Return the manifest-backed supported agent ids. */
export function getKnownAgentIds(): AgentId[] {
  return Object.keys(loadManifest().agents).filter(isAgentId);
}

/** Type guard for manifest-backed agent ids. */
function isKnownAgentId(value: string): value is AgentId {
  return getKnownAgentIds().includes(value as AgentId);
}

/** Return configured agents as manifest-backed runtime profiles. */
export function getConfiguredAgents(config: LoadedConfig): AgentProfile[] {
  const configured = config.config.agents;
  if (configured === null) {
    return getAgentProfiles();
  }
  return configured.filter(isKnownAgentId).map((id) => getAgentProfile(id));
}

/** Return configured agent ids that do not exist in the manifest-backed registry. */
export function findUnknownConfiguredAgents(configured: string[]): string[] {
  return configured.filter((id) => !isKnownAgentId(id));
}
