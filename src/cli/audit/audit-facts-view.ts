/**
 * Give each aggregate or per-agent audit a separate view of the extracted project facts.
 *
 * A selected agent receives only its own facts, so one report cannot alter another report's agent or shared state.
 * Dashboard summaries reuse stack facts because that profile excludes stack-dependent checks.
 */
import type { AgentId, ProjectFacts } from "../types.js";
import type { AuditFactProfile } from "./types.js";

/**
 * Prepare facts for one audit report while isolating mutable agent and shared state from the batch.
 *
 * @param facts - extracted target facts reused by aggregate and per-agent reports
 * @param options - omitted agent keeps all agents; dashboard-summary shares stack facts that its checks do not use
 * @returns - facts for the selected scope; an unmatched agent produces an empty agent list
 */
export function createAuditFactsView(
  facts: ProjectFacts,
  options: { agentId?: AgentId; factProfile?: AuditFactProfile } = {},
): ProjectFacts {
  // A per-agent report receives only that agent; an omitted selection keeps the aggregate view.
  const selectedAgents = options.agentId
    ? facts.agents.filter(
        (agentFacts) => agentFacts.agent.id === options.agentId,
      )
    : facts.agents;
  return {
    root: facts.root,
    // Summary checks do not use stack facts; full audits receive a private copy for their checks.
    stack:
      options.factProfile === "dashboard-summary"
        ? facts.stack
        : structuredClone(facts.stack),
    shared: structuredClone(facts.shared),
    agents: structuredClone(selectedAgents),
  };
}
