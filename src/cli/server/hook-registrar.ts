/**
 * Reconciles which hooks are registered against the agents actually installed in the user's selected project.
 *
 * A user reaches this by toggling a hook in the dashboard Hooks view or running `goat-flow hooks sync` after an upgrade.
 *
 * Registration is per agent because each one stores hooks differently, so enabling one hook can mean editing several config files.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { getAgentProfiles } from "../agents/registry.js";
import {
  readHookEnabled,
  readHookScanRoots,
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
  deriveManagedHookDesiredState,
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
  | "installed-version-behind"
  | "installed-content-diverged"
  | "installed-version-unclassified"
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
  scanRoots: HookScanRootState | null;
  agents: Record<AgentId, HookAgentState>;
}
/** Validated roots the post-turn scanner may inspect from one selected project. */
interface HookScanRootState {
  status: "implicit" | "configured" | "missing" | "invalid";
  roots: string[];
  issue: string | null;
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
 * Resolve an existing directory to its physical path.
 * Missing, non-directory, and filesystem-error inputs return `null` instead of throwing.
 *
 * @param directoryPath - candidate directory; missing or unreadable paths are invalid facts
 * @returns physical directory path, or `null` after any filesystem lookup failure
 * @throws Never; filesystem lookup errors are converted to `null`
 */
function physicalDirectory(directoryPath: string): string | null {
  try {
    if (!statSync(directoryPath).isDirectory()) return null;
    return realpathSync(directoryPath);
  } catch {
    return null;
  }
}

/** Function shape used to compare two platform-native filesystem paths. */
type RelativePathResolver = (from: string, to: string) => string;

/** Stable filesystem identity for one directory when the host exposes an inode or file ID. */
interface FilesystemDirectoryIdentity {
  device: bigint;
  inode: bigint;
}

/** Function shape used to resolve aliases that path spelling alone cannot compare. */
type DirectoryIdentityResolver = (
  directoryPath: string,
) => FilesystemDirectoryIdentity | null;

/**
 * Read one directory's device and inode/file ID without accepting unavailable zero identities.
 * @throws Never; missing paths and filesystem lookup failures return `null`
 */
function filesystemDirectoryIdentity(
  directoryPath: string,
): FilesystemDirectoryIdentity | null {
  try {
    const stats = statSync(directoryPath, { bigint: true });
    if (!stats.isDirectory() || stats.ino === 0n) return null;
    return { device: stats.dev, inode: stats.ino };
  } catch {
    return null;
  }
}

/**
 * Report whether two physical directory spellings identify the same filesystem location.
 * The injected resolver lets cross-platform tests exercise Windows path semantics on any host.
 *
 * @param leftDirectory - first physical directory spelling; empty cannot name a useful root
 * @param rightDirectory - second physical directory spelling; empty cannot name a useful root
 * @param relativePath - platform-native relative-path implementation used for equivalence
 * @param directoryIdentity - physical identity fallback for aliases such as Windows short paths
 * @returns true only when both spellings are identical under the selected path semantics
 */
export function filesystemPathsAreEquivalent(
  leftDirectory: string,
  rightDirectory: string,
  relativePath: RelativePathResolver = relative,
  directoryIdentity: DirectoryIdentityResolver = filesystemDirectoryIdentity,
): boolean {
  if (leftDirectory.length === 0 || rightDirectory.length === 0) return false;
  const spellingsMatch =
    relativePath(leftDirectory, rightDirectory) === "" &&
    relativePath(rightDirectory, leftDirectory) === "";
  if (spellingsMatch) return true;

  const leftIdentity = directoryIdentity(leftDirectory);
  const rightIdentity = directoryIdentity(rightDirectory);
  return (
    leftIdentity !== null &&
    rightIdentity !== null &&
    leftIdentity.device === rightIdentity.device &&
    leftIdentity.inode === rightIdentity.inode
  );
}

/**
 * Return the physical Git top-level for one directory.
 * Spawns one bounded read-only Git process; startup, timeout, and non-work-tree failures return `null`.
 *
 * @param directoryPath - existing directory Git should classify without modifying it
 * @returns physical work-tree root, or `null` when the bounded child process cannot prove one
 */
function gitTopLevel(directoryPath: string): string | null {
  const result = spawnSync(
    "git",
    ["-C", directoryPath, "rev-parse", "--show-toplevel"],
    {
      encoding: "utf-8",
      shell: false,
      timeout: 5_000,
      maxBuffer: 16_384,
    },
  );
  if (result.error || result.status !== 0 || result.stdout.trim() === "") {
    return null;
  }
  return physicalDirectory(result.stdout.trim());
}

/** Return whether a relative-path result escapes the root it was measured from. */
function relativePathEscapesRoot(relativePath: string): boolean {
  return (
    relativePath === ".." ||
    relativePath.startsWith(`..${String.fromCharCode(47)}`) ||
    relativePath.startsWith(`..${String.fromCharCode(92)}`) ||
    isAbsolute(relativePath)
  );
}

/** Check lexical and physical containment beneath the selected project root. */
function containedScanRoot(
  projectRoot: string,
  configuredRoot: string,
): string | null {
  // Drive, UNC, and host-absolute forms are never relative to the selected workspace.
  if (
    isAbsolute(configuredRoot) ||
    /^[A-Za-z]:[\\/]/u.test(configuredRoot) ||
    /^\\\\/u.test(configuredRoot)
  ) {
    return null;
  }
  const lexicalCandidate = resolve(projectRoot, configuredRoot);
  const lexicalRelative = relative(projectRoot, lexicalCandidate);
  if (relativePathEscapesRoot(lexicalRelative)) return null;
  const physicalCandidate = physicalDirectory(lexicalCandidate);
  if (physicalCandidate === null) return null;
  const physicalRelative = relative(projectRoot, physicalCandidate);
  if (relativePathEscapesRoot(physicalRelative)) return null;
  return physicalCandidate;
}

/**
 * Resolve the complete post-turn root contract before registration or status reads.
 * A Git project owns implicit `.`; a non-Git workspace must name only contained child Git roots.
 */
function postTurnScanRootState(
  projectPath: string,
  spec: HookSpec,
): HookScanRootState | null {
  if (spec.id !== "post-turn-safety") return null;
  const projectRoot = physicalDirectory(resolve(projectPath));
  if (projectRoot === null) {
    return {
      status: "invalid",
      roots: [],
      issue: "Selected project is not an existing directory.",
    };
  }
  if (
    filesystemPathsAreEquivalent(gitTopLevel(projectRoot) ?? "", projectRoot)
  ) {
    return { status: "implicit", roots: ["."], issue: null };
  }
  const configuredRoots = readHookScanRoots(projectPath, spec.id);
  if (configuredRoots === null) {
    return {
      status: "missing",
      roots: [],
      issue: "A non-Git workspace requires explicit post-turn scan roots.",
    };
  }
  for (const configuredRoot of configuredRoots) {
    const physicalRoot = containedScanRoot(projectRoot, configuredRoot);
    if (physicalRoot === null) {
      return {
        status: "invalid",
        roots: configuredRoots,
        issue: `Configured scan root is missing or escapes the selected project: ${configuredRoot}`,
      };
    }
    if (
      !filesystemPathsAreEquivalent(
        gitTopLevel(physicalRoot) ?? "",
        physicalRoot,
      )
    ) {
      return {
        status: "invalid",
        roots: configuredRoots,
        issue: `Configured scan root is not a Git repository: ${configuredRoot}`,
      };
    }
  }
  return { status: "configured", roots: configuredRoots, issue: null };
}

/** Return whether a hook's selected roots permit one complete registration. */
function scanRootsPermitRegistration(
  scanRootState: HookScanRootState | null,
): boolean {
  return (
    scanRootState === null ||
    scanRootState.status === "implicit" ||
    scanRootState.status === "configured"
  );
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
      command: `goat-flow hooks verify ${quotedProjectPath} --agent ${agent.id} --scenario ${hookScenarioForHookId(spec.id)} --trusted-target`,
      summary:
        "After confirming the checkout is trusted, run the explicit configured-command scenarios; normal audit does not execute project hooks.",
    };
  }
  return {
    command: null,
    summary: "Every required hook link has current evidence.",
  };
}

/** The observed facts about one agent's hook, gathered before they are combined into a single effective state. */
interface HookAgentStateFacts {
  isDesiredByUser: boolean;
  isRegistered: boolean;
  isCurrentVersionInstalled: boolean;
  isTrusted: boolean;
  doesProviderExclusionOwnState?: boolean;
}

/**
 * Combine registry and local facts into the single hook state a user sees, while preserving the causal provider gap.
 *
 * These arrive as one named object rather than five positional booleans, because a call reading `false, false, false`
 * tells the next reader nothing about which condition each one describes.
 *
 * When the provider itself excludes the hook, that exclusion owns the state and the local facts are treated as satisfied,
 * so the user is shown "the provider does not support this" instead of a repair they cannot perform.
 *
 * @param projectPath - selected project, used to check local proof of provider support
 * @param agent - agent whose hook state is being resolved
 * @param spec - hook being resolved, supplying its provider evidence
 * @param facts - the observed hook facts; `doesProviderExclusionOwnState` defaults to false
 * @returns the effective state, its label, evidence identity, and the repair the user should run; the identity is null
 *   when the provider is undocumented
 */
function effectiveAgentState(
  projectPath: string,
  agent: AgentProfile,
  spec: HookSpec,
  facts: HookAgentStateFacts,
): Pick<
  HookAgentState,
  | "effectiveState"
  | "effectiveStateLabel"
  | "evidenceIdentity"
  | "repairCommand"
  | "repairSummary"
> {
  const isOwnedByProviderExclusion =
    facts.doesProviderExclusionOwnState ?? false;
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
    facts.isDesiredByUser,
    effectiveSupportGate,
  );
  // A provider exclusion already explains the state, so local gaps must not add a second, unfixable complaint.
  effectiveStateFacts.isRegistered =
    isOwnedByProviderExclusion || facts.isRegistered;
  effectiveStateFacts.isCurrentVersionInstalled =
    isOwnedByProviderExclusion || facts.isCurrentVersionInstalled;
  effectiveStateFacts.isTrusted = isOwnedByProviderExclusion || facts.isTrusted;
  const effectiveState = classifyHookEffectiveState(effectiveStateFacts);
  const repair = effectiveStateRepair(
    projectPath,
    agent,
    spec,
    effectiveState,
    isOwnedByProviderExclusion,
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
  // M02's shared direction decides whether sync is safe, destructive, or unproven.
  if (!installationFacts.hasCurrentRequiredFiles) {
    if (installationFacts.changeDirection === "behind") {
      return "installed-version-behind";
    }
    if (installationFacts.changeDirection === "diverged") {
      return "installed-content-diverged";
    }
    return "installed-version-unclassified";
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
    "duplicate-registration":
      "The provider config contains an extra managed registration beyond the registry contract.",
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
    "installed-version-behind":
      "Installed hook bytes match the previous baseline and are behind the bundled registry version.",
    "installed-content-diverged":
      "Installed hook bytes carry local content that the bundled registry version does not contain.",
    "installed-version-unclassified":
      "Installed hook bytes differ, but no matching previous-install baseline proves whether they are older or locally changed.",
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
  const effectivePresentation = effectiveAgentState(projectPath, agent, spec, {
    isDesiredByUser,
    isRegistered: false,
    isCurrentVersionInstalled: false,
    isTrusted: false,
    doesProviderExclusionOwnState,
  });
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

/**
 * Name the gap between what the user asked for and what is actually installed, which is what the Hooks card shows as a repair prompt.
 *
 * @param shouldBeEnabled - whether the user has this hook switched on
 * @param installed - whether the file is really present and registered
 * @returns the drift direction, or `undefined` when the two agree and nothing needs repairing
 */
function hookDrift(
  shouldBeEnabled: boolean,
  installed: boolean,
): HookDrift | undefined {
  if (shouldBeEnabled && !installed) return "desired-on-actual-off";
  if (!shouldBeEnabled && installed) return "desired-off-actual-on";
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

/** Replace generic sync guidance when an invalid scan-root contract owns registration. */
function applyScanRootRepairGuidance(
  effectivePresentation: ReturnType<typeof effectiveAgentState>,
  isDesiredByUser: boolean,
  doesRootContractAllowRegistration: boolean,
): void {
  if (!isDesiredByUser || doesRootContractAllowRegistration) return;
  effectivePresentation.repairCommand = null;
  effectivePresentation.repairSummary =
    "Configure valid scan roots or disable this hook before registering it.";
}

/**
 * Replace generic stale-install guidance with the proven managed-file direction.
 * Diverged and unclassified bytes stay command-free because status cannot promise a safe sync.
 */
function applyManagedFileRepairGuidance(
  effectivePresentation: ReturnType<typeof effectiveAgentState>,
  installationIssue: HookInstallationIssue | null,
  installationFacts: ManagedHookInstallationFacts,
): void {
  const changedPaths = installationFacts.changedPaths.join(", ");
  if (installationIssue === "installed-version-behind") {
    effectivePresentation.repairSummary =
      "Installed bytes still match the previous-install baseline, so sync safely advances the managed files to this registry version.";
    return;
  }
  if (installationIssue === "installed-content-diverged") {
    effectivePresentation.repairCommand = null;
    effectivePresentation.repairSummary = `A sync would overwrite local content at ${changedPaths}; preserve or port those changes before any explicit replacement.`;
    return;
  }
  if (installationIssue === "installed-version-unclassified") {
    effectivePresentation.repairCommand = null;
    effectivePresentation.repairSummary = `No matching previous-install baseline proves the drift direction at ${changedPaths}; compare those files before choosing sync, which replaces their current bytes.`;
  }
}

/** Choose the root-contract issue before a generic installation repair reason. */
function supportedHookReason(
  isDesiredByUser: boolean,
  scanRootState: HookScanRootState | null,
  installationReason: string | null,
): string | null {
  if (isDesiredByUser && scanRootState?.issue) return scanRootState.issue;
  return installationReason;
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
  scanRootState: HookScanRootState | null,
): HookAgentState {
  const registrationState = readAgentHookState(projectPath, agent, spec);
  const installationFacts = managedHookInstallationFacts(
    projectPath,
    agent,
    spec,
  );
  const doesRootContractAllowRegistration =
    scanRootsPermitRegistration(scanRootState);
  const isRegistered =
    registrationState.installed && doesRootContractAllowRegistration;
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
  const effectivePresentation = effectiveAgentState(projectPath, agent, spec, {
    isDesiredByUser,
    isRegistered,
    isCurrentVersionInstalled,
    isTrusted: localDetails.isTrusted,
  });
  applyManagedFileRepairGuidance(
    effectivePresentation,
    localDetails.installationIssue,
    installationFacts,
  );
  applyScanRootRepairGuidance(
    effectivePresentation,
    isDesiredByUser,
    doesRootContractAllowRegistration,
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
  const reason = supportedHookReason(
    isDesiredByUser,
    scanRootState,
    localDetails.repairReason,
  );
  // A null reason keeps healthy rows concise while preserving exact local repair context.
  if (reason !== null) hookState.reason = reason;
  return hookState;
}

/** Build one provider row while applying the shared post-turn root eligibility gate. */
function agentHookState(
  projectPath: string,
  agent: AgentProfile,
  spec: HookSpec,
  shouldBeEnabled: boolean,
  scanRootState: HookScanRootState | null,
): HookAgentState {
  const unsupportedReason = unsupportedReasonForSpec(spec, agent);
  // A provider exclusion stays visible even when shared script files exist on disk.
  if (unsupportedReason) {
    return unsupportedAgentHookState(
      projectPath,
      agent,
      spec,
      shouldBeEnabled,
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
      shouldBeEnabled,
      "Agent manifest has no hook directory or hook config file.",
    );
  }
  return supportedAgentHookState(
    projectPath,
    agent,
    spec,
    shouldBeEnabled,
    scanRootState,
  );
}

/** Read persisted desired hook state, falling back to the registry default. */
function readDesired(projectPath: string, spec: HookSpec): boolean {
  return readHookEnabled(projectPath, spec.id, spec.defaultEnabled);
}

/**
 * Remove leftover hook config entries from an agent the registry now marks unsupported for this spec.
 * Without this, flipping an agent to unsupported strands dead registrations that agents may still attempt to run.
 *
 * Cleanup intentionally does not trust current manifest event metadata: a manifest can be corrected to remove a bogus event while stale managed
 * entries for that same event still exist on disk.
 *
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

/**
 * Reconcile one supported provider's scripts and registration without changing the desired toggle.
 * Side effects: may write managed scripts and the provider's existing hook configuration.
 * @throws HookRegistrarError when managed files cannot be replaced safely
 */
function reconcileSupportedAgentHook(
  projectPath: string,
  agent: AgentProfile,
  spec: HookSpec,
  isEnabled: boolean,
  doesRootContractAllowRegistration: boolean,
  profiles: AgentProfile[],
): void {
  if (!shouldReconcileAgent(projectPath, agent, spec, profiles)) return;
  const desiredState = deriveManagedHookDesiredState(agent, spec, isEnabled);
  const shouldRegisterHook =
    desiredState.registrationTargets.length > 0 &&
    doesRootContractAllowRegistration;
  // Disabling fills missing managed files but never refreshes existing inert bytes.
  if (!isEnabled) {
    if (desiredState.managedScriptFiles.length > 0) {
      copyHookScripts(projectPath, agent, spec, false);
    }
    if (hookConfigExists(projectPath, agent)) {
      writeAgentHookState(projectPath, agent, spec, false);
    }
    return;
  }
  // Current inert files let install and sync repair drift without changing the user's disabled choice.
  if (desiredState.managedScriptFiles.length > 0) {
    copyHookScripts(projectPath, agent, spec);
  }
  // A disabled hook removes managed rows from existing config but never scaffolds a missing config file.
  if (shouldRegisterHook || hookConfigExists(projectPath, agent)) {
    writeAgentHookState(projectPath, agent, spec, shouldRegisterHook);
  }
}

/** Converge one hook without registering a post-turn command against incomplete root coverage. */
function reconcileHook(
  projectPath: string,
  spec: HookSpec,
  isEnabled: boolean,
): void {
  const profiles = getAgentProfiles();
  const scanRootState = postTurnScanRootState(projectPath, spec);
  const doesRootContractAllowRegistration =
    scanRootsPermitRegistration(scanRootState);
  for (const agent of profiles) {
    if (unsupportedReasonForSpec(spec, agent)) {
      pruneUnsupportedAgentHookEntries(projectPath, agent, spec);
      continue;
    }
    if (!isSupportedAgent(agent)) continue;
    reconcileSupportedAgentHook(
      projectPath,
      agent,
      spec,
      isEnabled,
      doesRootContractAllowRegistration,
      profiles,
    );
  }
}

/**
 * Refuse a registrar mutation when M02 proves that sync would erase local hook content.
 * The preflight runs before any config, script, or tombstone write and names only project-relative paths.
 * Invariant: every requested hook and installed agent is inspected before the first mutation.
 *
 * @param projectPath - selected project inspected before any registrar mutation
 * @param specs - hook contracts the requested mutation would reconcile
 * @returns nothing when every changed path is behind, current, missing, or unclassified
 * @throws HookRegistrarError when any trusted baseline proves local divergence
 */
function assertNoKnownManagedHookDivergence(
  projectPath: string,
  specs: readonly HookSpec[],
): void {
  const profiles = getAgentProfiles();
  const divergedPaths = new Set<string>();
  for (const spec of specs) {
    for (const agent of profiles) {
      if (unsupportedReasonForSpec(spec, agent) || !isSupportedAgent(agent)) {
        continue;
      }
      if (!shouldReconcileAgent(projectPath, agent, spec, profiles)) continue;
      const installationFacts = managedHookInstallationFacts(
        projectPath,
        agent,
        spec,
      );
      if (installationFacts.changeDirection !== "diverged") continue;
      for (const changedPath of installationFacts.changedPaths) {
        divergedPaths.add(changedPath);
      }
    }
  }
  if (divergedPaths.size === 0) return;
  throw new HookRegistrarError(
    `Refusing to sync diverged managed hook files: ${[...divergedPaths].sort().join(", ")}. A sync would overwrite local content; preserve or port those changes before an explicit replacement.`,
    409,
  );
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
  const scanRoots = postTurnScanRootState(projectPath, spec);
  const agents = Object.fromEntries(
    getAgentProfiles().map((agent) => [
      agent.id,
      agentHookState(projectPath, agent, spec, enabled, scanRoots),
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
    scanRoots,
    agents,
  };
}

// Snapshots the current enabled/installed state of every known hook for one
// project; reads settings + script presence, so the result reflects on-disk
// reality, not the in-memory registry defaults.
export function readAllHookStates(projectPath: string): HookState[] {
  return listHookSpecs().map((spec) => readHookState(spec.id, projectPath));
}

/**
 * Apply one enabled choice after proving the registrar will not erase known local hook content.
 *
 * @param hookId - registry hook selected by the caller; unknown or fixed hooks are rejected
 * @param isEnabled - desired persisted state written after divergence preflight
 * @param projectPath - selected project whose managed hook surface may change
 * @returns refreshed public state for the selected hook
 * @throws HookRegistrarError for unknown hooks, fixed hooks, unsafe paths, or proven divergence
 */
export function applyHookState(
  hookId: string,
  isEnabled: boolean,
  projectPath: string,
): HookState {
  const spec = resolveSpec(hookId);
  if (!spec.togglable) {
    throw new HookRegistrarError(`Hook is not togglable: ${hookId}`, 400);
  }
  // Enabled reconciliation may replace scripts, so prove authority before any cleanup or config write.
  if (isEnabled) assertNoKnownManagedHookDivergence(projectPath, [spec]);
  pruneRemovedHookTombstones(projectPath);
  setHookEnabled(projectPath, spec.id, isEnabled);
  reconcileHook(projectPath, spec, isEnabled);
  return readHookState(spec.id, projectPath);
}

/**
 * Reapply persisted hook choices after refusing any baseline-proven local divergence.
 * Unclassified legacy bytes retain the existing explicit-sync upgrade path.
 *
 * @param projectPath - selected project whose togglable hook surfaces may be reconciled
 * @returns refreshed state for every registered hook after successful reconciliation
 * @throws HookRegistrarError when a managed path is unsafe, newer, or proven diverged
 */
export function syncHookStates(projectPath: string): HookState[] {
  const togglableSpecs = listHookSpecs().filter((spec) => spec.togglable);
  const enabledSpecs = togglableSpecs.filter((spec) =>
    readDesired(projectPath, spec),
  );
  assertNoKnownManagedHookDivergence(projectPath, enabledSpecs);
  pruneRemovedHookTombstones(projectPath);
  for (const spec of togglableSpecs) {
    reconcileHook(projectPath, spec, readDesired(projectPath, spec));
  }
  return readAllHookStates(projectPath);
}
