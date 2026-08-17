/**
 * Per-context facts narrowing for the audit pipeline.
 * The orchestrator extracts project facts once and reuses them across the aggregate and per-agent audits; this module hands each audit its own view
 * so a per-agent run cannot mutate the shared batch bundle.
 *
 * The deep-clone choices here are the isolation contract - the only exception is the dashboard-summary profile, which shares stack facts because that
 * profile never mutates them.
 */
import type { AgentId, ProjectFacts } from "../types.js";
import type { AuditFactProfile } from "./types.js";

/**
 * Build an isolated facts view for one audit context from a batch fact bundle.
 *
 * @param facts - shared extracted facts reused across aggregate and per-agent audits
 * @param options - optional agent/profile narrowing for the returned facts view
 * @returns facts narrowed to the requested agent/profile without mutating the batch bundle
 */
export function createAuditFactsView(
  facts: ProjectFacts,
  options: { agentId?: AgentId; factProfile?: AuditFactProfile } = {},
): ProjectFacts {
  const selectedAgents = options.agentId
    ? facts.agents.filter(
        (agentFacts) => agentFacts.agent.id === options.agentId,
      )
    : facts.agents;
  return {
    root: facts.root,
    stack:
      options.factProfile === "dashboard-summary"
        ? facts.stack
        : structuredClone(facts.stack),
    shared: structuredClone(facts.shared),
    agents: structuredClone(selectedAgents),
  };
}
