/**
 * Resolves the set of agent IDs goat-flow supports and renders them for CLI help and error text.
 *
 * The manifest-backed list is the single source of truth; this module caches it once and offers pre-formatted help strings so the parser, handlers,
 * and `--help` output never hardcode agent names.
 *
 * The list-building helpers swallow manifest-load failures into a "run manifest" hint so a broken manifest degrades help text instead of crashing
 * argument parsing on every invocation.
 */

import type { AgentId } from "./types.js";
import { getKnownAgentIds } from "./agents/registry.js";

let cachedValidAgents: AgentId[] | null = null;

/**
 * Return the supported agent IDs, memoised after the first manifest read for the process lifetime.
 *
 * @returns the known agent IDs in manifest order; propagates (does not catch) a manifest-load
 *   throw, so callers that need a guaranteed string use the list/flags helpers below instead
 */
export function validAgents(): AgentId[] {
  return (cachedValidAgents ??= getKnownAgentIds());
}

/**
 * Format the supported agent IDs as a comma-separated string for `--help` and invalid-agent errors.
 * Catches a manifest-load failure and returns a safe fallback hint rather than letting it propagate.
 *
 * @returns the agents joined by ", "; on a manifest-load failure, the fallback string
 *   "run `goat-flow manifest` for the current list" so the surrounding command never crashes
 */
export function validAgentList(): string {
  try {
    return validAgents().join(", ");
  } catch {
    return "run `goat-flow manifest` for the current list";
  }
}

/**
 * Format the supported agents as example `--agent <id>` flags for usage and error messages.
 *
 * @returns each agent rendered as "--agent <id>", comma-joined; on a manifest-load throw, returns
 *   the generic "--agent <id> (run `goat-flow manifest` for valid ids)" fallback instead
 */
export function validAgentFlags(): string {
  try {
    return validAgents()
      .map((agent) => `--agent ${agent}`)
      .join(", ");
  } catch {
    return "--agent <id> (run `goat-flow manifest` for valid ids)";
  }
}

/** Banner text warning that multi-agent setup output must stay in sync. */
export const MULTI_AGENT_SYNC_BANNER = [
  "**Multi-agent sync:** This prompt generates setup for multiple agents. The execution loop",
  "(READ → SCOPE → ACT → VERIFY), autonomy tiers, and Definition of Done",
  "MUST be identical across all instruction files. Write these sections for the first agent,",
  "then COPY THEM VERBATIM to the other instruction files. Do not rephrase.",
];
