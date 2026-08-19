/**
 * Agent-setup wrapper over the shared quality report contract.
 *
 * The contract text itself lives in one place, `appendQualityReportContract` in `compose-quality-contract.ts`: the
 * filename convention, JSON body shape, per-field rules, and the validate-before-confirming step.
 *
 * This module keeps the `appendAgentReportContract` name for the agent-setup composer and selects the `full` detail
 * level, because a user launching `goat-flow quality --agent <id>` gets the fully-explained variant that cold
 * agents follow with no other context.
 */
import { appendQualityReportContract } from "./compose-quality-contract.js";
import type { ReportContractInput } from "./compose-quality-contract.js";

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
