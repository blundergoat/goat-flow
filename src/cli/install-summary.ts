/**
 * Describe completed install changes using the admitted preview and observed registrations.
 * Build the closing text after verification while claims are held; the caller prints it only after successful claim release.
 */
import { getAgentProfile, getAgentProfiles } from "./agents/registry.js";
import { quoteManagedInstallProjectArgument } from "./managed-install-evidence.js";
import type { ManagedSetupPreview } from "./managed-setup-preview.js";
import { readManagedTargetEvidence } from "./managed-setup-write-set.js";
import { getPackageVersion } from "./paths.js";
import {
  readAgentHookState,
  type AgentHookReadState,
} from "./server/agent-hook-writer.js";
import { readAllHookStates } from "./server/hook-registrar.js";
import { listHookSpecs, type HookSpec } from "./server/hooks-registry.js";
import type { AgentId } from "./types.js";

/** Existing registration state for a hook in one admitted provider config. */
export interface InstallHookObservation {
  agent: AgentId;
  spec: HookSpec;
  state: AgentHookReadState;
}

/**
 * Classify the one config edit needed to reach desired registration state.
 * Missing or invalid configs stay outside migration because setup either seeds or preserves them.
 *
 * @param current - saved registration inspected before apply; missing or invalid configs have no migration row
 * @param shouldRegister - desired registration presence from the preview or observed result
 * @returns the required edit, or null when this existing registration needs no migration
 */
export function hookRegistrationEdit(
  current: AgentHookReadState,
  shouldRegister: boolean,
): "restore" | "repair" | "remove" | null {
  // Missing or invalid provider config cannot supply an existing registration to edit.
  if (current.configMissing || current.configInvalid) return null;
  // A matching current registration already has the desired presence, including an inert disabled policy.
  if (shouldRegister && current.installed) return null;
  // A desired registration needs restoration when absent, or repair when its existing row has drifted.
  if (shouldRegister) {
    return current.registrationIssue === "registration-missing"
      ? "restore"
      : "repair";
  }
  const hasOwnedRegistration =
    current.installed ||
    (current.registrationIssue !== undefined &&
      current.registrationIssue !== "registration-missing");
  return hasOwnedRegistration ? "remove" : null;
}

/**
 * Read registrations before apply, limited to configs already in the admitted write set.
 *
 * @param projectPath - target whose write claims are held before installation
 * @param preview - admitted file rows; providers outside these config paths are excluded
 * @returns prior registry readings for supported hooks; empty means no hook config is admitted
 */
export function observeInstallHookRegistrations(
  projectPath: string,
  preview: ManagedSetupPreview,
): InstallHookObservation[] {
  return getAgentProfiles().flatMap((profile) => {
    // Unselected providers without an admitted config path cannot contribute an install change.
    if (!preview.files.some((file) => file.path === profile.hookConfigFile))
      return [];
    return listHookSpecs()
      .filter((spec) => spec.unsupportedAgents?.[profile.id] === undefined)
      .map((spec) => ({
        agent: profile.id,
        spec,
        state: readAgentHookState(projectPath, profile, spec),
      }));
  });
}

/** Compare observed registrations; a disabled choice alone never proves removal. */
function completedHookChanges(
  projectPath: string,
  observations: readonly InstallHookObservation[],
): string[] {
  const states = new Map(
    readAllHookStates(projectPath).map((state) => [state.id, state]),
  );
  return observations.flatMap(({ agent, spec, state: before }) => {
    const after = readAgentHookState(projectPath, getAgentProfile(agent), spec);
    const label = `${agent}/${spec.id}`;
    // New or repaired registrations must match the registry's exact expected form after apply.
    if (after.installed && !before.installed) {
      const edit = hookRegistrationEdit(before, true);
      return [`  ${label} ${edit === "repair" ? "repaired" : "registered"}`];
    }
    // Missing registrations count as removals only when an owned row existed before apply.
    if (
      after.registrationIssue === "registration-missing" &&
      !after.configMissing &&
      !after.configInvalid &&
      hookRegistrationEdit(before, false) === "remove"
    ) {
      const reason =
        states.get(spec.id)?.enabled === false ? "disabled" : "not eligible";
      return [`  ${label} removed (${reason})`];
    }
    return [];
  });
}

/**
 * Render actual changed preview paths and remaining checks after managed verification and post-install writes.
 * The caller holds claims while reading these outcomes and must suppress this text if later cleanup fails.
 *
 * @param projectPath - verified target whose file outcomes are read under write claims
 * @param preview - admitted paths and pre-write hashes reused to identify actual changes
 * @param hookObservations - registration readings before apply; empty omits hook-change reporting
 * @returns closing text with pinned commands, without running the remaining checks
 */
export function renderInstallSummary(
  projectPath: string,
  preview: ManagedSetupPreview,
  hookObservations: readonly InstallHookObservation[],
): string {
  const outcomes = preview.files.map((file) => ({
    file,
    target: readManagedTargetEvidence(projectPath, file.path),
  }));
  const changed = outcomes.filter(
    ({ file, target }) =>
      target.status === "regular" && target.sha256 !== file.currentSha256,
  );
  const created = changed.filter(
    ({ file }) => file.currentStatus === "missing",
  ).length;
  const removed = outcomes.filter(
    ({ file, target }) =>
      file.currentStatus === "regular" && target.status === "missing",
  ).length;
  const preserved = outcomes.filter(
    ({ file, target }) =>
      file.state === "local-preserved" && target.sha256 === file.currentSha256,
  ).length;
  const replaced = changed.filter(
    ({ file }) =>
      file.currentStatus === "regular" &&
      (file.state === "both-changed" ||
        file.state === "unmanaged" ||
        file.authority === "granted-user-owned"),
  );
  const lines = [
    "",
    `Install verified for ${preview.agent} (${getPackageVersion()}).`,
    `Files changed: ${created} created, ${changed.length - created} updated, ${removed} removed; ${preserved} local change(s) preserved.`,
    "File counts cover previewed paths; other installer cleanup is reported separately.",
    ...replaced.map(({ file }) => `Replaced local content: ${file.path}`),
  ];
  const hookChanges = completedHookChanges(projectPath, hookObservations);
  // Unchanged registrations need no inventory in the closing summary.
  if (hookChanges.length > 0) lines.push("Hook registrations:", ...hookChanges);
  const invocation = `npx @blundergoat/goat-flow@${getPackageVersion()}`;
  const target = quoteManagedInstallProjectArgument(projectPath);
  lines.push(
    "Remaining review: reconcile preserved local changes, settings and project-specific instructions; audit and runtime checks have not run.",
    `  ${invocation} audit ${target} --agent ${preview.agent}`,
    `  ${invocation} stats ${target} --check`,
  );
  // Only hook-capable providers receive a runtime command; trust and disabled choices remain the operator's decisions.
  if (getAgentProfile(preview.agent).hookConfigFile !== null) {
    lines.push(
      "Inspect and trust the hook configuration before runtime verification. Disabled hooks stay disabled.",
      `  ${invocation} hooks verify ${target} --agent ${preview.agent} --trusted-target --scenario all`,
    );
  }
  return lines.join("\n");
}

/**
 * Print prepared completion only after its caller successfully releases write claims.
 *
 * @param summary - verified closing text; null keeps a failed installer silent here
 */
export function emitInstallSummary(summary: string | null): void {
  if (summary !== null) console.log(summary);
}
