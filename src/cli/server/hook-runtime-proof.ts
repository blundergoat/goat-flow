/**
 * Reads metadata-only results from the user's explicit offline hook verification.
 * Use when CLI, audit, or dashboard status decides whether the current release passed
 * every required scenario without executing checkout hooks during the read-only view.
 * Only latest matching verdicts count; unrelated, partial, or old-version events stay non-green.
 */
import { AUDIT_VERSION } from "../constants.js";
import {
  tailEvidenceEvents,
  type EvidenceEnvelope,
} from "../evidence/envelope.js";
import type { HookEffectiveState } from "../hook-contracts.js";
import {
  HOOK_VERIFICATION_CONTRACTS,
  type HookVerificationContract,
} from "../hook-verification-contracts.js";
import type { AgentId } from "../types.js";

const MAX_HOOK_PROOF_EVENTS = 500;

/** Return a string payload field, or null when local evidence omitted or changed its shape. */
function evidenceText(
  payload: Record<string, unknown> | undefined,
  fieldName: string,
): string | null {
  const fieldValue = payload?.[fieldName];
  return typeof fieldValue === "string" ? fieldValue : null;
}

/** One matching scenario id and its latest verdict shown to the status reader. */
interface RecordedScenarioVerdict {
  scenarioId: string;
  verdict: string;
}

/** Match one event payload to the user's agent, current release, and scenario contract. */
function recordedScenarioVerdict(
  eventPayload: Record<string, unknown> | undefined,
  agentId: AgentId,
  verificationContract: HookVerificationContract,
  requiredScenarioIds: ReadonlySet<string>,
): RecordedScenarioVerdict | null {
  // Missing or different metadata belongs to another hook, provider, release, or proof level.
  if (
    evidenceText(eventPayload, "hook_id") !== verificationContract.hookId ||
    evidenceText(eventPayload, "scenario_group") !==
      verificationContract.scenarioGroup ||
    evidenceText(eventPayload, "agent") !== agentId ||
    evidenceText(eventPayload, "framework_version") !== AUDIT_VERSION ||
    evidenceText(eventPayload, "evidence_level") !==
      verificationContract.evidenceLevel
  ) {
    return null;
  }
  const scenarioId = evidenceText(eventPayload, "scenario_id");
  // Unknown or empty identifiers never count toward the current user-visible contract.
  if (scenarioId === null || !requiredScenarioIds.has(scenarioId)) return null;
  return {
    scenarioId,
    verdict: evidenceText(eventPayload, "verdict") ?? "missing",
  };
}

/**
 * Check the newest current-release verdict for every scenario required by one hook.
 * Use after local install and trust checks pass; false means the UI keeps its verify action.
 *
 * @param projectPath - selected project; empty or unreadable paths provide no local proof
 * @param agentId - selected provider; an unknown provider cannot match recorded proof
 * @param hookId - registry hook identifier; empty or unknown text has no scenario contract
 * @returns true only when every required latest verdict is pass; false for absent or partial proof
 */
function hasCurrentHookRuntimeProof(
  projectPath: string,
  agentId: AgentId,
  hookId: string,
): boolean {
  const verificationContract = Object.values(HOOK_VERIFICATION_CONTRACTS).find(
    (candidateContract) => candidateContract.hookId === hookId,
  );
  // An unknown hook has no declared scenarios, so the UI cannot call it verified.
  if (!verificationContract) return false;
  const requiredScenarioIds = new Set<string>(
    verificationContract.requiredScenarioIds,
  );
  const latestScenarioVerdicts = new Map<string, string>();
  let evidenceEvents: EvidenceEnvelope[];

  try {
    // Tailing this kind alone keeps proof readable after unrelated terminal or dashboard
    // activity; a global window would evict every verification event and re-prompt the user.
    evidenceEvents = tailEvidenceEvents(
      projectPath,
      MAX_HOOK_PROOF_EVENTS,
      "hook.verify",
    );
  } catch {
    // For example, a user may revoke access to local logs; the UI then asks for proof again.
    return false;
  }

  // Newest matching events overwrite older attempts so a later failed rerun stays visible.
  for (const evidenceEvent of evidenceEvents) {
    // Other local activity cannot prove that a user ran this verification command.
    if (evidenceEvent.event_kind !== "hook.verify") continue;
    const recordedVerdict = recordedScenarioVerdict(
      evidenceEvent.payload,
      agentId,
      verificationContract,
      requiredScenarioIds,
    );
    // Unrelated or incomplete evidence leaves the user's current scenario set unchanged.
    if (recordedVerdict === null) continue;
    latestScenarioVerdicts.set(
      recordedVerdict.scenarioId,
      recordedVerdict.verdict,
    );
  }

  return verificationContract.requiredScenarioIds.every(
    (scenarioId) => latestScenarioVerdicts.get(scenarioId) === "pass",
  );
}

/**
 * Promote only the final offline scenario gate when current local proof is complete.
 * Use after provider evidence is classified; all earlier provider gaps stay unchanged.
 *
 * @param projectPath - selected project; empty or unreadable paths cannot promote proof
 * @param agentId - selected provider; unknown agents cannot match local events
 * @param hookId - registry hook; empty or unknown text has no proof contract
 * @param registrySupportGate - provider-owned gate; never null or empty
 * @returns effective after complete proof, otherwise the unchanged registry gate
 */
export function hookSupportGateAfterLocalProof(
  projectPath: string,
  agentId: AgentId,
  hookId: string,
  registrySupportGate: HookEffectiveState["status"],
): HookEffectiveState["status"] {
  // Local scenarios may close only their own final gate, never a provider evidence gap.
  if (registrySupportGate !== "scenario-unverified") {
    return registrySupportGate;
  }
  return hasCurrentHookRuntimeProof(projectPath, agentId, hookId)
    ? "effective"
    : registrySupportGate;
}
