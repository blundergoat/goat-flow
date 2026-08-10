/**
 * Defines the fixed offline scenarios that can close a user's hook verification gate.
 * Use when writers record proof or status views decide whether every required case passed.
 * Scenario payloads stay in their runners; this contract keeps only safe stable identifiers.
 */
import type { HookScenario } from "./cli-types.js";

/** Evidence level stored for one bounded verification family. */
type HookVerificationEvidenceLevel =
  "managed-hook-classifier" | "configured-hook-command";

/** One hook's complete scenario set and the evidence level users must produce. */
export interface HookVerificationContract {
  hookId: "deny-dangerous" | "gruff-code-quality" | "post-turn-safety";
  scenarioGroup: HookScenario;
  requiredScenarioIds: readonly string[];
  evidenceLevel: HookVerificationEvidenceLevel;
}

/** Canonical scenario sets shared by explicit verification and read-only status views. */
export const HOOK_VERIFICATION_CONTRACTS = {
  "deny-hook": {
    hookId: "deny-dangerous",
    scenarioGroup: "deny-hook",
    requiredScenarioIds: [
      "secret-shell-read",
      "pipe-to-shell",
      "repository-push",
      "read-only-control",
    ],
    evidenceLevel: "managed-hook-classifier",
  },
  "gruff-hook": {
    hookId: "gruff-code-quality",
    scenarioGroup: "gruff-hook",
    requiredScenarioIds: [
      "unsupported-tool-input",
      "non-source-edit",
      "source-dependency-result",
    ],
    evidenceLevel: "configured-hook-command",
  },
  "post-turn-hook": {
    hookId: "post-turn-safety",
    scenarioGroup: "post-turn-hook",
    requiredScenarioIds: ["valid-stop-result", "invalid-stop-input"],
    evidenceLevel: "configured-hook-command",
  },
} as const satisfies Record<HookScenario, HookVerificationContract>;

/**
 * Return the CLI scenario users run for one registry hook.
 * Use when repair guidance must name the exact bounded verification command.
 *
 * @param hookId - current registry hook; empty or unknown text is an internal contract error
 * @returns fixed scenario group; never null or empty for a current managed hook
 * @throws Error when a registry hook has no offline verification contract
 */
export function hookScenarioForHookId(hookId: string): HookScenario {
  const verificationContract = Object.values(HOOK_VERIFICATION_CONTRACTS).find(
    (candidateContract) => candidateContract.hookId === hookId,
  );
  // A missing mapping would leave the user's repair command pointing at no valid scenario.
  if (!verificationContract) {
    throw new Error(`Missing hook verification contract for ${hookId}`);
  }
  return verificationContract.scenarioGroup;
}
