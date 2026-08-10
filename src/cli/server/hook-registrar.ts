/**
 * Registrar that reconciles `.goat-flow/config.yaml` hook truth to detected
 * hook-capable agent surfaces in the selected project.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getAgentProfiles } from "../agents/registry.js";
import {
  readHookEnabled,
  removeHookConfig,
  removeTopLevelConfigBlock,
  setHookEnabled,
} from "../config/writer.js";
import {
  classifyHookEffectiveState,
  type HookEffectiveState,
  type HookEffectiveStateFacts,
} from "../hook-contracts.js";
import type { AgentId, AgentProfile } from "../types.js";
import {
  currentHookProviderSupportGate,
  getHookSpec,
  isValidHookIdShape,
  listHookSpecs,
  type HookSpec,
} from "./hooks-registry.js";
import {
  readAgentHookState,
  writeAgentHookState,
  type AgentHookRegistrationIssue,
} from "./agent-hook-writer.js";
import {
  HookManagedInstallationError as HookRegistrarError,
  copyHookScripts,
  hookConfigExists,
  managedFileIsTrusted,
  managedHookInstallationFacts,
  removeHookScripts,
  shouldReconcileAgent,
  type ManagedHookInstallationFacts,
} from "./hook-managed-installation.js";
import { writeFileAtomic } from "./safe-exec.js";

const REMOVED_HOOK_TOMBSTONES: HookSpec[] = [
  {
    id: "plan-checkbox-guard",
    displayName: "Removed plan checkbox guard",
    description:
      "Legacy cleanup tombstone for stale plan checkbox guard installs.",
    event: "Stop",
    matcher: "",
    scriptFiles: ["plan-checkbox-guard.sh"],
    primaryScript: "plan-checkbox-guard.sh",
    togglable: false,
    defaultEnabled: false,
    requiresConfirmDialog: false,
  },
];

type HookDrift = "desired-on-actual-off" | "desired-off-actual-on";
/** Names the installed-file repair shown when registration exists but local coverage is stale. */
export type HookInstallationIssue =
  | "managed-files-missing"
  | "installed-version-mismatch"
  | "managed-path-untrusted";

/** Per-agent hook state shown by setup, audit, CLI, and dashboard views. */
export interface HookAgentState extends Record<"supported", boolean> {
  installed: boolean;
  isRegistered: boolean;
  isCurrentVersionInstalled: boolean;
  isTrusted: boolean;
  registrationIssue: AgentHookRegistrationIssue | null;
  installationIssue: HookInstallationIssue | null;
  effectiveState: HookEffectiveState;
  effectiveStateLabel: string;
  evidenceIdentity: string | null;
  repairCommand: string | null;
  repairSummary: string;
  scriptPath: string | null;
  configPath: string | null;
  drift?: HookDrift;
  reason?: string;
}

/** Dashboard-facing hook state including defaults, drift, and per-agent registration status. */
export interface HookState extends Record<"togglable" | "enabled", boolean> {
  id: string;
  name: string;
  description: string;
  defaultEnabled: boolean;
  requiresConfirmDialog: boolean;
  agents: Record<AgentId, HookAgentState>;
}

export { HookRegistrarError };

type HookEffectiveStatus = HookEffectiveState["status"];

const HOOK_EFFECTIVE_STATE_LABELS: Record<HookEffectiveStatus, string> = {
  disabled: "disabled",
  "provider-undocumented": "provider undocumented",
  "provider-documentation-stale": "provider documentation stale",
  "provider-documented-unsupported": "provider documented unsupported",
  "provider-capture-absent": "provider capture absent",
  "provider-capture-stale": "provider capture stale",
  "provider-capture-untrusted": "provider capture untrusted",
  "provider-capture-inconclusive": "provider capture inconclusive",
  "provider-live-unsupported": "provider live unsupported",
  "not-registered": "not registered",
  "installation-stale": "installation stale",
  "runtime-untrusted": "runtime untrusted",
  "not-observed": "not observed running",
  "result-undelivered": "result undelivered",
  "scenario-unverified": "scenario unverified",
  effective: "effective",
};

/** Validate and resolve a hook id into the registry spec; bad ids throw 400 and unknown ids throw 404. Throws on invalid input. */
function resolveSpec(hookId: string): HookSpec {
  if (!isValidHookIdShape(hookId)) {
    throw new HookRegistrarError("Invalid hook id", 400);
  }
  const spec = getHookSpec(hookId);
  if (!spec) throw new HookRegistrarError(`Unknown hook: ${hookId}`, 404);
  return spec;
}

/** Confirm an agent profile has all manifest paths needed for hook registration. */
function isSupportedAgent(agent: AgentProfile): boolean {
  return (
    agent.hooksDir !== null &&
    agent.hookConfigFile !== null &&
    agent.hookEvents !== null
  );
}

/** Return the registry reason shown when this hook cannot protect the selected agent. */
function unsupportedReasonForSpec(
  spec: HookSpec,
  agent: AgentProfile,
): string | null {
  return spec.unsupportedAgents?.[agent.id] ?? null;
}

/**
 * Remove one retired Goat Flow ignore rule while preserving user entries.
 * Use when an upgrade prunes a removed hook's final state file.
 *
 * @param projectPath - selected project; empty text cannot locate an owned ignore file
 * @param gitignoreEntry - exact managed rule; empty text matches no useful entry
 * @returns nothing; missing files or rules leave the user's policy unchanged
 */
function removeGoatFlowGitignoreEntry(
  projectPath: string,
  gitignoreEntry: string,
): void {
  const goatFlowGitignorePath = join(projectPath, ".goat-flow", ".gitignore");
  // No local ignore file means the retired state rule is already absent for the user.
  if (!existsSync(goatFlowGitignorePath)) return;

  const originalGitignore = readFileSync(goatFlowGitignorePath, "utf-8");
  const hadFinalNewline = originalGitignore.endsWith("\n");
  const gitignoreLines = originalGitignore.split(/\r?\n/u);
  // A final split item is not a rule, so exclude it from the retained content.
  if (hadFinalNewline) gitignoreLines.pop();
  // Keep every rule except the exact retired Goat Flow entry.
  const retainedGitignoreLines = gitignoreLines.filter(
    (gitignoreLine) => gitignoreLine !== gitignoreEntry,
  );
  // The rule was already absent, so setup must not rewrite the user's file.
  if (retainedGitignoreLines.length === gitignoreLines.length) return;

  const updatedGitignore = `${retainedGitignoreLines.join("\n")}${hadFinalNewline ? "\n" : ""}`;
  writeFileAtomic(goatFlowGitignorePath, updatedGitignore, projectPath);
}

/** Start with a complete chain, then lower the one registry-owned evidence gate. */
function providerGateFacts(
  isDesiredByUser: boolean,
  effectiveSupportGate: HookEffectiveStatus,
): HookEffectiveStateFacts {
  const providerFacts: HookEffectiveStateFacts = {
    isDesired: isDesiredByUser,
    providerDocumentation: "fresh-supported",
    providerCapture: "fresh-supported",
    isRegistered: true,
    isCurrentVersionInstalled: true,
    isTrusted: true,
    hasObservedRun: true,
    hasDeliveredResult: true,
    isScenarioVerified: true,
  };

  switch (effectiveSupportGate) {
    case "disabled":
      providerFacts.isDesired = false;
      break;
    case "provider-undocumented":
      providerFacts.providerDocumentation = "absent";
      break;
    case "provider-documentation-stale":
      providerFacts.providerDocumentation = "stale";
      break;
    case "provider-documented-unsupported":
      providerFacts.providerDocumentation = "fresh-unsupported";
      break;
    case "provider-capture-absent":
      providerFacts.providerCapture = "absent";
      break;
    case "provider-capture-stale":
      providerFacts.providerCapture = "stale";
      break;
    case "provider-capture-untrusted":
      providerFacts.providerCapture = "untrusted";
      break;
    case "provider-capture-inconclusive":
      providerFacts.providerCapture = "inconclusive";
      break;
    case "provider-live-unsupported":
      providerFacts.providerCapture = "fresh-unsupported";
      break;
    case "not-registered":
      providerFacts.isRegistered = false;
      break;
    case "installation-stale":
      providerFacts.isCurrentVersionInstalled = false;
      break;
    case "runtime-untrusted":
      providerFacts.isTrusted = false;
      break;
    case "not-observed":
      providerFacts.hasObservedRun = false;
      break;
    case "result-undelivered":
      providerFacts.hasDeliveredResult = false;
      break;
    case "scenario-unverified":
      providerFacts.isScenarioVerified = false;
      break;
    case "effective":
      break;
  }

  return providerFacts;
}

/** Return the explicit CLI scenario that verifies one installed hook without launching a model. */
function configuredScenarioForHook(spec: HookSpec): string {
  // The policy hook uses its bounded allow-and-block classifier group.
  if (spec.id === "deny-dangerous") return "deny-hook";
  // The Stop guard uses clean, finding, and incomplete repository fixtures.
  if (spec.id === "post-turn-safety") return "post-turn-hook";
  return "gruff-hook";
}

/**
 * Explain the next operator-controlled action for the first unmet effective-state link.
 * Provider exclusions stay command-free because project sync cannot repair host delivery.
 */
function effectiveStateRepair(
  projectPath: string,
  agent: AgentProfile,
  spec: HookSpec,
  effectiveState: HookEffectiveState,
  doesProviderExclusionOwnState = false,
): { command: string | null; summary: string } {
  const quotedProjectPath = JSON.stringify(resolve(projectPath));
  // A provider-limited hook needs new delivery evidence, not a local command the user can rerun.
  if (doesProviderExclusionOwnState && effectiveState.status !== "disabled") {
    return {
      command: null,
      summary:
        "Provider result delivery must be proven before Goat Flow can register this hook.",
    };
  }
  switch (effectiveState.status) {
    case "disabled":
      return {
        command: null,
        summary:
          "The hook is intentionally disabled; enable it when this coverage is wanted.",
      };
    case "provider-undocumented":
    case "provider-documentation-stale":
    case "provider-documented-unsupported":
    case "provider-capture-absent":
    case "provider-capture-stale":
    case "provider-capture-untrusted":
    case "provider-capture-inconclusive":
    case "provider-live-unsupported":
      return {
        command: null,
        summary:
          "Provider evidence must be refreshed before local setup can claim this hook is effective.",
      };
    case "not-registered":
    case "installation-stale":
      return {
        command: `goat-flow hooks sync ${quotedProjectPath}`,
        summary:
          "Re-sync the selected project to restore the registry-owned command and current hook files.",
      };
    case "runtime-untrusted":
      return {
        command: null,
        summary:
          "Inspect the managed config and hook paths, remove symlinks or hard links, then re-sync.",
      };
    case "not-observed":
    case "result-undelivered":
    case "scenario-unverified":
      return {
        command: `goat-flow hooks verify ${quotedProjectPath} --agent ${agent.id} --scenario ${configuredScenarioForHook(spec)}`,
        summary:
          "Run the explicit configured-command scenarios; normal audit does not execute project hooks.",
      };
    case "effective":
      return {
        command: null,
        summary: "Every required hook link has current evidence.",
      };
  }
}

/**
 * Combine registry evidence with the selected project's local install and trust facts.
 * Registry exclusions keep their causal provider gap ahead of unavailable local files.
 */
function effectiveAgentState(
  projectPath: string,
  agent: AgentProfile,
  spec: HookSpec,
  isDesiredByUser: boolean,
  isRegistered: boolean,
  isCurrentVersionInstalled: boolean,
  isTrusted: boolean,
  doesProviderExclusionOwnState = false,
): Pick<
  HookAgentState,
  | "effectiveState"
  | "effectiveStateLabel"
  | "evidenceIdentity"
  | "repairCommand"
  | "repairSummary"
> {
  const providerEvidence = spec.providerEvidence?.[agent.id];
  // Missing evidence keeps the user at an unverified provider state.
  const effectiveSupportGate = providerEvidence
    ? currentHookProviderSupportGate(providerEvidence)
    : "provider-undocumented";
  const effectiveStateFacts = providerGateFacts(
    isDesiredByUser,
    effectiveSupportGate,
  );
  effectiveStateFacts.isRegistered = doesProviderExclusionOwnState
    ? true
    : isRegistered;
  effectiveStateFacts.isCurrentVersionInstalled = doesProviderExclusionOwnState
    ? true
    : isCurrentVersionInstalled;
  effectiveStateFacts.isTrusted = doesProviderExclusionOwnState
    ? true
    : isTrusted;
  const effectiveState = classifyHookEffectiveState(effectiveStateFacts);
  const repair = effectiveStateRepair(
    projectPath,
    agent,
    spec,
    effectiveState,
    doesProviderExclusionOwnState,
  );
  return {
    effectiveState,
    effectiveStateLabel: HOOK_EFFECTIVE_STATE_LABELS[effectiveState.status],
    evidenceIdentity: providerEvidence?.identity ?? null,
    repairCommand: repair.command,
    repairSummary: repair.summary,
  };
}

/** Name the installed-file link that keeps an exact registration from being current and trusted. */
function installedHookIssue(
  isRegistered: boolean,
  installationFacts: ManagedHookInstallationFacts,
  isTrusted: boolean,
): HookInstallationIssue | null {
  // Registration diagnostics own the first repair while no exact command exists.
  if (!isRegistered) return null;
  // Missing script or policy files make the installed command incomplete.
  if (!installationFacts.hasAllRequiredFiles) {
    return "managed-files-missing";
  }
  // Changed bytes mean setup no longer knows which hook version the user will run.
  if (!installationFacts.hasCurrentRequiredFiles) {
    return "installed-version-mismatch";
  }
  // Symlinks, hard links, or redirected config paths cannot establish local trust.
  if (!isTrusted) return "managed-path-untrusted";
  return null;
}

/** Translate a machine registration issue into concise setup guidance for the user. */
function registrationIssueReason(
  registrationIssue: AgentHookRegistrationIssue,
): string {
  const issueReasons: Record<AgentHookRegistrationIssue, string> = {
    "registration-missing": "The managed hook command is not registered.",
    "retired-registration":
      "A retired hook registration must be migrated to the current dispatcher.",
    "event-mismatch":
      "The managed command is registered under the wrong lifecycle event.",
    "matcher-mismatch":
      "The registered tool matcher does not cover the registry contract.",
    "command-or-response-mismatch":
      "The registered launcher or provider response contract is stale.",
    "timeout-mismatch":
      "The registered host timeout does not match the hook deadline contract.",
  };
  return issueReasons[registrationIssue];
}

/** Translate installed byte and trust drift into the first repair detail shown in setup. */
function installationIssueReason(
  installationIssue: HookInstallationIssue,
): string {
  const issueReasons: Record<HookInstallationIssue, string> = {
    "managed-files-missing":
      "One or more managed hook or policy files are missing.",
    "installed-version-mismatch":
      "Installed hook bytes differ from the bundled registry version.",
    "managed-path-untrusted":
      "A managed hook or config path is symlinked, hard-linked, or non-regular.",
  };
  return issueReasons[installationIssue];
}

/**
 * Build the state payload for an agent that cannot host the requested hook.
 * Provider exclusions show their root cause; missing surfaces show the local setup gap.
 */
function unsupportedAgentHookState(
  projectPath: string,
  agent: AgentProfile,
  spec: HookSpec,
  isDesiredByUser: boolean,
  reason: string,
  doesProviderExclusionOwnState = false,
): HookAgentState {
  const effectivePresentation = effectiveAgentState(
    projectPath,
    agent,
    spec,
    isDesiredByUser,
    false,
    false,
    false,
    doesProviderExclusionOwnState,
  );
  return {
    supported: false,
    installed: false,
    isRegistered: false,
    isCurrentVersionInstalled: false,
    isTrusted: false,
    registrationIssue: null,
    installationIssue: null,
    ...effectivePresentation,
    scriptPath: null,
    configPath: null,
    reason,
  };
}

function hookDrift(
  desired: boolean,
  installed: boolean,
): HookDrift | undefined {
  if (desired && !installed) return "desired-on-actual-off";
  if (!desired && installed) return "desired-off-actual-on";
  return undefined;
}

function supportedAgentHookState(
  projectPath: string,
  agent: AgentProfile,
  spec: HookSpec,
  isDesiredByUser: boolean,
): HookAgentState {
  const registrationState = readAgentHookState(projectPath, agent, spec);
  const installationFacts = managedHookInstallationFacts(
    projectPath,
    agent,
    spec,
  );
  const isRegistered = registrationState.installed;
  const installed = isRegistered && installationFacts.hasAllRequiredFiles;
  const isCurrentVersionInstalled =
    installed && installationFacts.hasCurrentRequiredFiles;
  const configFilePath = agent.hookConfigFile
    ? join(projectPath, agent.hookConfigFile)
    : null;
  const isTrusted =
    installationFacts.hasTrustedRequiredFiles &&
    configFilePath !== null &&
    managedFileIsTrusted(projectPath, configFilePath);
  const installationIssue = installedHookIssue(
    isRegistered,
    installationFacts,
    isTrusted,
  );
  const drift = hookDrift(isDesiredByUser, installed);
  const effectivePresentation = effectiveAgentState(
    projectPath,
    agent,
    spec,
    isDesiredByUser,
    isRegistered,
    isCurrentVersionInstalled,
    isTrusted,
  );
  return {
    supported: true,
    installed,
    isRegistered,
    isCurrentVersionInstalled,
    isTrusted,
    registrationIssue: registrationState.registrationIssue ?? null,
    installationIssue,
    ...effectivePresentation,
    scriptPath: agent.hooksDir
      ? `${agent.hooksDir}/${spec.primaryScript}`.replace(/\/+/gu, "/")
      : null,
    configPath: agent.hookConfigFile,
    ...(drift ? { drift } : {}),
    ...(registrationState.configMissing
      ? { reason: "Hook config file is missing." }
      : {}),
    ...(registrationState.configInvalid
      ? { reason: "Hook config file is invalid JSON." }
      : {}),
    ...(registrationState.registrationIssue
      ? { reason: registrationIssueReason(registrationState.registrationIssue) }
      : {}),
    ...(installationIssue
      ? { reason: installationIssueReason(installationIssue) }
      : {}),
  };
}

function agentHookState(
  projectPath: string,
  agent: AgentProfile,
  spec: HookSpec,
  desired: boolean,
): HookAgentState {
  const unsupportedReason = unsupportedReasonForSpec(spec, agent);
  // A provider exclusion stays visible even when shared script files exist on disk.
  if (unsupportedReason) {
    return unsupportedAgentHookState(
      projectPath,
      agent,
      spec,
      desired,
      unsupportedReason,
      true,
    );
  }
  // A profile without registration surfaces cannot make this hook effective for the user.
  if (!isSupportedAgent(agent)) {
    return unsupportedAgentHookState(
      projectPath,
      agent,
      spec,
      desired,
      "Agent manifest has no hook directory or hook config file.",
    );
  }
  return supportedAgentHookState(projectPath, agent, spec, desired);
}

/** Read persisted desired hook state, falling back to the registry default. */
function readDesired(projectPath: string, spec: HookSpec): boolean {
  return readHookEnabled(projectPath, spec.id, spec.defaultEnabled);
}

/**
 * Remove leftover hook config entries from an agent the registry now marks
 * unsupported for this spec. Without this, flipping an
 * agent to unsupported strands dead registrations that agents may still
 * attempt to run. Cleanup intentionally does not trust current manifest event
 * metadata: a manifest can be corrected to remove a bogus event while stale
 * managed entries for that same event still exist on disk.
 * Scripts are shared across agents and stay untouched.
 */
function pruneUnsupportedAgentHookEntries(
  projectPath: string,
  agent: AgentProfile,
  spec: HookSpec,
): void {
  if (!isSupportedAgent(agent)) return;
  if (!hookConfigExists(projectPath, agent)) return;
  writeAgentHookState(projectPath, agent, spec, false);
}

function reconcileHook(
  projectPath: string,
  spec: HookSpec,
  enabled: boolean,
): void {
  const profiles = getAgentProfiles();
  for (const agent of profiles) {
    if (unsupportedReasonForSpec(spec, agent)) {
      pruneUnsupportedAgentHookEntries(projectPath, agent, spec);
      continue;
    }
    if (!isSupportedAgent(agent)) continue;
    if (!shouldReconcileAgent(projectPath, agent, spec, profiles)) continue;
    if (enabled) copyHookScripts(projectPath, agent, spec);
    else removeHookScripts(projectPath, agent, spec);
    if (enabled || hookConfigExists(projectPath, agent)) {
      writeAgentHookState(projectPath, agent, spec, enabled);
    }
  }
}

/**
 * Disable and remove one hook that used to exist in older installs.
 * Use during hook reconciliation so users do not keep stale controls for removed hooks.
 *
 * @param projectPath - project being cleaned; empty means no project hook files can be found
 * @param spec - removed hook descriptor; empty script lists mean only config state is cleared
 * @returns nothing; stale files and agent registrations are removed when present
 */
function pruneRemovedHookTombstone(projectPath: string, spec: HookSpec): void {
  const profiles = getAgentProfiles();

  // Each agent may have old registration state or old hook scripts from a previous release.
  for (const agent of profiles) {
    // Supported agents keep an explicit disabled state so the dashboard no longer offers the hook.
    if (isSupportedAgent(agent) && hookConfigExists(projectPath, agent)) {
      writeAgentHookState(projectPath, agent, spec, false);
    }

    // Legacy script files are removed so future audits do not report dead hook artifacts.
    if (agent.hooksDir) removeHookScripts(projectPath, agent, spec);
  }
}

/**
 * Remove all tombstoned hook artifacts from a project.
 * Use during reconciliation after a user upgrades from an older hook set.
 *
 * @param projectPath - project being cleaned; empty means there are no hook files or config blocks to edit
 * @returns nothing; removed hooks disappear from config, gitignore, and agent hook folders
 */
function pruneRemovedHookTombstones(projectPath: string): void {
  // Every tombstone clears both agent hook state and goat-flow config overrides.
  for (const spec of REMOVED_HOOK_TOMBSTONES) {
    pruneRemovedHookTombstone(projectPath, spec);
    removeHookConfig(projectPath, spec.id);
  }

  removeTopLevelConfigBlock(projectPath, "plan-guard");
  removeGoatFlowGitignoreEntry(projectPath, "logs/plan-guard-state.json");
}

/** Snapshot one hook across all known agents for dashboard and CLI consumers. */
function readHookState(hookId: string, projectPath: string): HookState {
  const spec = resolveSpec(hookId);
  const enabled = readDesired(projectPath, spec);
  const agents = Object.fromEntries(
    getAgentProfiles().map((agent) => [
      agent.id,
      agentHookState(projectPath, agent, spec, enabled),
    ]),
  ) as Record<AgentId, HookAgentState>;
  return {
    id: spec.id,
    name: spec.displayName,
    description: spec.description,
    togglable: spec.togglable,
    enabled,
    defaultEnabled: spec.defaultEnabled,
    requiresConfirmDialog: spec.requiresConfirmDialog,
    agents,
  };
}

// Snapshots the current enabled/installed state of every known hook for one
// project; reads settings + script presence, so the result reflects on-disk
// reality, not the in-memory registry defaults.
export function readAllHookStates(projectPath: string): HookState[] {
  return listHookSpecs().map((spec) => readHookState(spec.id, projectPath));
}

export function applyHookState(
  hookId: string,
  enabled: boolean,
  projectPath: string,
): HookState {
  pruneRemovedHookTombstones(projectPath);
  const spec = resolveSpec(hookId);
  if (!spec.togglable) {
    throw new HookRegistrarError(`Hook is not togglable: ${hookId}`, 400);
  }
  setHookEnabled(projectPath, spec.id, enabled);
  reconcileHook(projectPath, spec, enabled);
  return readHookState(spec.id, projectPath);
}

// Side-effecting: rewrites each togglable hook's installed files to match its
// persisted desired state, repairing drift (e.g. after a manual settings edit),
// then returns the refreshed snapshot. Non-togglable hooks are left untouched.
export function syncHookStates(projectPath: string): HookState[] {
  pruneRemovedHookTombstones(projectPath);
  for (const spec of listHookSpecs()) {
    if (!spec.togglable) continue;
    reconcileHook(projectPath, spec, readDesired(projectPath, spec));
  }
  return readAllHookStates(projectPath);
}
