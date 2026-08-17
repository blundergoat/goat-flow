/**
 * Builds the quality-assessment prompt a user copies into their agent, for whichever quality mode they selected.
 *
 * The mode is a real fork, not a formatting detail: agent-setup and the focused modes are different prompt contracts with different outputs.
 *
 * A user gets here from the dashboard Quality tab or `goat-flow quality prompt`, after choosing what they want assessed.
 */
import {
  type QualityInput,
  type QualityPayload,
} from "./compose-quality-common.js";
import { composeFocusedQuality } from "./compose-quality-focused.js";
import { composeAgentSetupQuality } from "./compose-quality-agent-setup.js";
export { composeArtifactQualityPrompt } from "./compose-quality-artifact.js";

/**
 * Compose the quality review prompt. Branching is intentional: the quality mode
 * selects a different prompt contract (agent-setup vs the focused modes).
 *
 * @param input - quality request; `qualityMode` defaults to `agent-setup` when unset
 * @returns the composed payload - command, agent, audit status/summary, and prompt text
 */
export function composeQuality(input: QualityInput): QualityPayload {
  const qualityMode = input.qualityMode ?? "agent-setup";
  if (qualityMode !== "agent-setup") {
    return composeFocusedQuality(input, qualityMode);
  }
  return composeAgentSetupQuality(input, qualityMode);
}
