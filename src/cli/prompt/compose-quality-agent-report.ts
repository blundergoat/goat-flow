/**
 * Agent-setup wrapper over the shared quality report contract.
 *
 * The actual contract text - filename convention, JSON body shape, per-field
 * rules, and the validate-before-confirming step - lives in ONE place:
 * `appendQualityReportContract` in `compose-quality-common.ts`. This module
 * keeps the historical `appendAgentReportContract` name for the agent-setup
 * composer and selects the `full` detail level (a user launching
 * `goat-flow quality --agent <id>` gets the fully-explained variant, because
 * agent-setup runs are the ones cold agents follow with no other context).
 */
import { appendQualityReportContract } from "./compose-quality-common.js";
import type { ReportContractInput } from "./compose-quality-common.js";

/**
 * Append the full-detail JSON report contract block to an agent-setup prompt.
 *
 * @param lines - prompt line buffer; appended to in place
 * @param input - run facts embedded into the contract (agent, paths, prior report, mode)
 */
export function appendAgentReportContract(
  lines: string[],
  input: ReportContractInput,
): void {
  appendQualityReportContract(lines, input, { detail: "full" });
  // Agent-setup prompts continue with a closing section -> keep the blank line
  // the previous inline implementation always emitted.
  lines.push("");
}
