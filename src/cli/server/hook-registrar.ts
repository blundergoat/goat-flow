/**
 * Reconciles hook settings with agents detected in the user's selected project.
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
import { hookScenarioForHookId } from "../hook-verification-contracts.js";
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
  type AgentHookReadState,
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
import { hookSupportGateAfterLocalProof } from "./hook-runtime-proof.js";
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
type HookInstallationIssue =
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

/** Registry gate overrides applied to the optimistic effective-state chain shown in hook UIs. */
const HOOK_GATE_FACT_OVERRIDES: Record<
  HookEffectiveStatus,
  Partial<HookEffectiveStateFacts>
> = {
  disabled: { isDesired: false },
  "provider-undocumented": { providerDocumentation: "absent" },
  "provider-documentation-stale": { providerDocumentation: "stale" },
  "provider-documented-unsupported": {
    providerDocumentation: "fresh-unsupported",
  },
  "provider-capture-absent": { providerCapture: "absent" },
  "provider-capture-stale": { providerCapture: "stale" },
  "provider-capture-untrusted": { providerCapture: "untrusted" },
  "provider-capture-inconclusive": { providerCapture: "inconclusive" },
  "provider-live-unsupported": { providerCapture: "fresh-unsupported" },
  "not-registered": { isRegistered: false },
  "installation-stale": { isCurrentVersionInstalled: false },
  "runtime-untrusted": { isTrusted: false },
  "not-observed": { hasObservedRun: false },
  "result-undelivered": { hasDeliveredResult: false },
  "scenario-unverified": { isScenarioVerified: false },
  effective: {},
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
  const fullyEffectiveFacts: HookEffectiveStateFacts = {
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
  return {
    ...fullyEffectiveFacts,
    ...HOOK_GATE_FACT_OVERRIDES[effectiveSupportGate],
  };
}

/** States repaired by regenerating the user's managed config and files. */
const HOOK_SYNC_REPAIR_STATES = new Set<HookEffectiveStatus>([
  "not-registered",
  "installation-stale",
]);
/** States repaired by running the user's bounded offline scenarios. */
const HOOK_VERIFY_REPAIR_STATES = new Set<HookEffectiveStatus>([
  "not-observed",
  "result-undelivered",
  "scenario-unverified",
]);

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
  // A disabled hook is an intentional user choice, so no repair command is offered.
  if (effectiveState.status === "disabled") {
    return {
      command: null,
      summary:
        "The hook is intentionally disabled; enable it when this coverage is wanted.",
    };
  }
  // Provider evidence gaps require new proof rather than a local project mutation.
  if (effectiveState.status.startsWith("provider-")) {
    return {
      command: null,
      summary:
        "Provider evidence must be refreshed before local setup can claim this hook is effective.",
    };
  }
  // Missing or stale managed files can be restored through the canonical sync path.
  if (HOOK_SYNC_REPAIR_STATES.has(effectiveState.status)) {
    return {
      command: `goat-flow hooks sync ${quotedProjectPath}`,
      summary:
        "Re-sync the selected project to restore the registry-owned command and current hook files.",
    };
  }
  // Untrusted paths need human inspection before Goat Flow can safely rewrite them.
  if (effectiveState.status === "runtime-untrusted") {
    return {
      command: null,
      summary:
        "Inspect the managed config and hook paths, remove symlinks or hard links, then re-sync.",
    };
  }
  // Missing runtime proof has one bounded offline verification command for the user.
  if (HOOK_VERIFY_REPAIR_STATES.has(effectiveState.status)) {
    return {
      command: `goat-flow hooks verify ${quotedProjectPath} --agent ${agent.id} --scenario ${hookScenarioForHookId(spec.id)}`,
      summary:
        "Run the explicit configured-command scenarios; normal audit does not execute project hooks.",
    };
  }
  return {
    command: null,
    summary: "Every required hook link has current evidence.",
  };
}

/** Combine registry and local facts while preserving the user's causal provider gap. */
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
  const registrySupportGate = providerEvidence
    ? currentHookProviderSupportGate(providerEvidence)
    : "provider-undocumented";
  const effectiveSupportGate = hookSupportGateAfterLocalProof(
    projectPath,
    agent.id,
    spec.id,
    registrySupportGate,
  );
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

/** Build an unsupported-agent row that preserves the user's causal delivery gap. */
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

/**
 * Resolve local trust, installed-file drift, script path, and the first repair reason.
 * Use once per supported agent so every Hooks UI presents the same local diagnosis.
 * @param projectPath - selected project; empty text cannot identify trusted managed files
 * @param agent - selected provider; null config or hook paths remain untrusted or absent
 * @param spec - managed hook contract; empty script metadata cannot produce a path
 * @param registrationState - parsed config state; empty issue flags mean registration is healthy
 * @param isRegistered - false keeps installed-file issues behind registration repair
 * @param installationFacts - managed file facts; false values identify missing, stale, or unsafe files
 * @returns complete local details; null fields mean no path or repair issue is available
 */
function supportedHookLocalDetails(
  projectPath: string,
  agent: AgentProfile,
  spec: HookSpec,
  registrationState: AgentHookReadState,
  isRegistered: boolean,
  installationFacts: ManagedHookInstallationFacts,
) {
  const hookConfigPath =
    agent.hookConfigFile === null
      ? null
      : join(projectPath, agent.hookConfigFile);
  const isTrusted =
    installationFacts.hasTrustedRequiredFiles &&
    hookConfigPath !== null &&
    managedFileIsTrusted(projectPath, hookConfigPath);
  const installationIssue = installedHookIssue(
    isRegistered,
    installationFacts,
    isTrusted,
  );
  let repairReason: string | null = null;
  // Managed file and trust problems are the last local link and the first repair shown.
  if (installationIssue !== null) {
    repairReason = installationIssueReason(installationIssue);
    // Registration mismatches are more specific than generic config flags.
  } else if (registrationState.registrationIssue !== undefined) {
    repairReason = registrationIssueReason(registrationState.registrationIssue);
    // Invalid JSON prevents the user from relying on any configured row.
  } else if (registrationState.configInvalid) {
    repairReason = "Hook config file is invalid JSON.";
    // A missing config tells the user to create or sync the provider registration.
  } else if (registrationState.configMissing) {
    repairReason = "Hook config file is missing.";
  }
  const scriptPath =
    agent.hooksDir === null
      ? null
      : `${agent.hooksDir}/${spec.primaryScript}`.replace(/\/+/gu, "/");
  return { isTrusted, installationIssue, scriptPath, repairReason };
}

/**
 * Build one supported provider row for CLI, audit, and dashboard hook views.
 * Use when the manifest exposes registration surfaces for the selected agent.
 */
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
  const localDetails = supportedHookLocalDetails(
    projectPath,
    agent,
    spec,
    registrationState,
    isRegistered,
    installationFacts,
  );
  const drift = hookDrift(isDesiredByUser, installed);
  const effectivePresentation = effectiveAgentState(
    projectPath,
    agent,
    spec,
    isDesiredByUser,
    isRegistered,
    isCurrentVersionInstalled,
    localDetails.isTrusted,
  );
  const hookState: HookAgentState = {
    supported: true,
    installed,
    isRegistered,
    isCurrentVersionInstalled,
    isTrusted: localDetails.isTrusted,
    registrationIssue: registrationState.registrationIssue ?? null,
    installationIssue: localDetails.installationIssue,
    ...effectivePresentation,
    scriptPath: localDetails.scriptPath,
    configPath: agent.hookConfigFile,
  };
  // Drift is omitted when the user's desired and installed states already agree.
  if (drift !== undefined) hookState.drift = drift;
  // A null reason keeps healthy rows concise while preserving exact local repair context.
  if (localDetails.repairReason !== null) {
    hookState.reason = localDetails.repairReason;
  }
  return hookState;
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
