/**
 * Check configuration shapes before drift comparisons inspect the user's settings.
 *
 * JSON and YAML edits can leave nulls, arrays, scalars, or unsupported agent names where checks expect structured values.
 * These guards let callers handle that absence or mismatch without reading fields from an unusable value.
 */
import type { AgentId } from "../types.js";

// Known agent identifiers goat-flow can compare installed artifacts for.
const KNOWN_AGENT_IDS = new Set(["claude", "codex", "antigravity", "copilot"]);

/**
 * Allow field inspection only for non-null, non-array objects parsed from the user's configuration.
 * Use before reading settings fields; the caller decides how an unusable value affects its audit result.
 *
 * @param candidate - parsed configuration value; null, arrays, and scalars fail the field-inspection guard
 * @returns - true for an inspectable object, including an empty object whose individual fields still need checking
 */
export function isRecord(
  candidate: unknown,
): candidate is Record<string, unknown> {
  // A user may replace a settings object with null or a list; callers must handle that shape before inspecting fields.
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    !Array.isArray(candidate)
  );
}

/**
 * Recognize supported agent names before comparing the project's per-agent installation files.
 * An unknown or misspelled name stays outside the supported-agent comparisons.
 *
 * @param candidate - agent name from manifest or configuration; empty or unknown names do not match
 * @returns - true when goat-flow has a supported agent whose installed artifacts can be compared
 */
export function isAgentId(candidate: string): candidate is AgentId {
  return KNOWN_AGENT_IDS.has(candidate);
}
