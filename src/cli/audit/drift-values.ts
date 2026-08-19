/**
 * Small shape guards shared by the drift comparisons that read a user's config files.
 *
 * Installed agent configuration is user-editable JSON and YAML, so anything read back from it arrives as `unknown`.
 * These guards are the single place that decides whether a value is usable, keeping every drift check from re-inventing its own defensive checks.
 *
 * They are deliberately permissive about *what* is inside a value and strict only about its shape.
 * A user who hand-edited their config into something unexpected should see a precise drift finding, not a crash midway through their audit.
 */
import type { AgentId } from "../types.js";

/** Known agent identifiers goat-flow can compare installed artifacts for. */
const KNOWN_AGENT_IDS = new Set(["claude", "codex", "antigravity", "copilot"]);

/**
 * Narrow an unknown config value to a plain object before reading fields from it.
 * Use on anything parsed out of a user's settings file, so a hand-edited array or string becomes a reported difference rather than a runtime error.
 *
 * @param candidate - parsed config value of unknown shape; null and arrays are not objects here
 * @returns true when fields can be read safely; false means the config cannot be inspected
 *   and the caller reports that as drift instead of guessing
 */
export function isRecord(
  candidate: unknown,
): candidate is Record<string, unknown> {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    !Array.isArray(candidate)
  );
}

/**
 * Check that a name read from config is an agent goat-flow actually supports.
 * Use before comparing a project's per-agent artifacts, so an unknown or misspelled agent name is skipped rather than producing findings against
 * something that cannot exist.
 *
 * @param candidate - agent name from manifest or config; an empty or unknown name never matches
 * @returns true when the name is a supported agent whose artifacts can be compared
 */
export function isAgentId(candidate: string): candidate is AgentId {
  return KNOWN_AGENT_IDS.has(candidate);
}
