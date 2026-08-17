/**
 * Canonical per-agent profiles used by setup, fact extraction, and prompt rendering.
 */
import { KNOWN_AGENT_IDS, type AgentProfile, type AgentId } from "../types.js";
import { getAgentProfile } from "../agents/registry.js";

/**
 * Configuration profiles for all supported AI coding agents.
 *
 * Resolve each profile on first access so manifest drift cannot break unrelated CLI commands at import time.
 */
const lazyProfiles: Partial<Record<AgentId, AgentProfile>> = {};

for (const agentId of KNOWN_AGENT_IDS) {
  let cachedProfile: AgentProfile | undefined;
  Object.defineProperty(lazyProfiles, agentId, {
    enumerable: true,
    get: () => (cachedProfile ??= getAgentProfile(agentId)),
  });
}

export const PROFILES = lazyProfiles as Record<AgentId, AgentProfile>; // Every known agent id receives a getter above.
