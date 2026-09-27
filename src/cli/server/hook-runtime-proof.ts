/**
 * Reads metadata-only results from the user's explicit offline hook verification.
 *
 * Use when CLI, audit, or dashboard status decides whether the current release passed every required scenario without executing checkout hooks during
 * the read-only view.
 * Only latest matching verdicts count; unrelated, partial, or old-version events stay non-green.
 */
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentProfiles } from "../agents/registry.js";
import { managedFileIsTrusted } from "./hook-managed-installation.js";
import { getHookSpec } from "./hooks-registry.js";
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

/** Identify the two policy hooks whose proof depends on complete installed runtime bytes. */
function isPolicyHook(hookId: string): boolean {
  return hookId === "deny-dangerous" || hookId === "deny-git-mutations";
}

/**
 * Bind offline policy proof to this installation's complete runtime revision.
 * Bytes and filesystem revisions both participate so repairing old bytes cannot revive earlier proof.
 * Reads trusted local files only. Error behavior: returns null for missing, redirected or unreadable dependencies.
 *
 * @param projectPath - selected checkout whose installed files supply the proof identity
 * @param agentId - provider whose managed hook directory is inspected
 * @param hookId - policy registry id; other hooks have no policy identity
 * @returns runtime fingerprint, or null when this installation cannot supply trustworthy policy proof
 */
export function managedPolicyRuntimeIdentity(
  projectPath: string,
  agentId: AgentId,
  hookId: string,
): string | null {
  if (!isPolicyHook(hookId)) return null;
  const spec = getHookSpec(hookId);
  const agent = getAgentProfiles().find((profile) => profile.id === agentId);
  if (!spec || !agent?.hooksDir) return null;
  const identity = createHash("sha256");
  try {
    for (const file of [...new Set(spec.scriptFiles)].sort()) {
      const path = join(projectPath, agent.hooksDir, file);
      if (!managedFileIsTrusted(projectPath, path)) return null;
      const revision = lstatSync(path, { bigint: true });
      identity.update(
        `${file}\0${revision.dev}:${revision.ino}:${revision.mtimeNs}:${revision.ctimeNs}\0`,
      );
      identity.update(readFileSync(path));
    }
    return identity.digest("hex");
  } catch {
    // A file can disappear or become unreadable after trust inspection; status then requires new proof.
    return null;
  }
}

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
 * Use after local install and trust checks pass; it swallows unreadable proof files as absent proof, so the UI keeps its verify action.
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
  const isPolicy = isPolicyHook(hookId);
  const runtimeIdentity = isPolicy
    ? managedPolicyRuntimeIdentity(projectPath, agentId, hookId)
    : null;
  if (isPolicy && runtimeIdentity === null) return false;
  const evidenceEvents = readHookEvidenceEvents(projectPath);

  // Newest matching events overwrite older attempts so a later failed rerun stays visible.
  for (const evidenceEvent of evidenceEvents) {
    // Other local activity cannot prove that a user ran this verification command.
    if (evidenceEvent.event_kind !== "hook.verify") continue;
    if (
      isPolicy &&
      evidenceText(evidenceEvent.payload, "runtime_identity") !==
        runtimeIdentity
    )
      continue;
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

/** Read only hook proof events. Error behavior: unreadable logs return no events and require fresh verification. */
function readHookEvidenceEvents(projectPath: string): EvidenceEnvelope[] {
  try {
    // Filtering before the limit prevents unrelated activity from evicting hook proof.
    return tailEvidenceEvents(
      projectPath,
      MAX_HOOK_PROOF_EVENTS,
      "hook.verify",
    );
  } catch {
    return [];
  }
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
