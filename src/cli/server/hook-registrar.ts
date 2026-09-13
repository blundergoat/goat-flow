/**
 * Reconciles which hooks are registered against the agents actually installed in the user's selected project.
 *
 * A user reaches this by toggling a hook in the dashboard Hooks view or running `goat-flow hooks sync` after an upgrade.
 *
 * Registration is per agent because each one stores hooks differently, so enabling one hook can mean editing several config files.
 */
import { spawnSync } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { getAgentProfiles } from "../agents/registry.js";
import {
  hookScanRootsUseYamlAliases,
  prepareHookConfig,
  readConfiguredHookChoices,
  readHookEnabled,
  readHookScanRoots,
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
  prepareAgentHookState,
  type AgentHookReadState,
  type AgentHookRegistrationIssue,
} from "./agent-hook-writer.js";
import {
  HookManagedInstallationError as HookRegistrarError,
  copyHookScripts,
  createManagedHookInspection,
  type ManagedHookInspection,
  managedFileIsTrusted,
  managedHookInstallationFacts,
  removeHookScripts,
  shouldReconcileAgent,
  type ManagedHookInstallationFacts,
} from "./hook-managed-installation.js";
import { hookSupportGateAfterLocalProof } from "./hook-runtime-proof.js";
import {
  executeHookChange,
  PreparedHookChange,
  type HookChangeIntent,
  type HookReplacementConfirmation,
} from "./hook-operation.js";

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

/**
 * Resolve the hook selected by the user.
 * Throws HTTP 400 for invalid IDs and HTTP 404 when a valid ID names no shipped hook.
 */
function resolveSpec(hookId: string): HookSpec {
  // Reject an invalid hook ID before it can select a registration or filesystem destination.
  if (!isValidHookIdShape(hookId)) {
    throw new HookRegistrarError("Invalid hook id", 400);
  }
  const spec = getHookSpec(hookId);
  // A well-formed ID still needs to name a shipped hook the user can manage.
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
 * Resolve a project or scan folder to its physical path before checking coverage.
 * Missing folders, non-directories and filesystem failures return null so callers can show an invalid-root state.
 *
 * @param directoryPath - candidate directory; missing or unreadable paths are invalid facts
 *
 * @returns physical directory path, or `null` after any filesystem lookup failure
 * @throws Never; filesystem lookup errors are converted to `null`
 */
function physicalDirectory(directoryPath: string): string | null {
  try {
    // A selected file cannot serve as a project or post-turn scan folder.
    if (!statSync(directoryPath).isDirectory()) return null;
    return realpathSync(directoryPath);
  } catch {
    // A folder may be moved or become unreadable after selection; report no usable physical root.
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
 * Read a folder's device and file ID to recognize aliases of the same selected scan root.
 * Missing, unreadable or unavailable identities return null; they cannot prove folder equivalence.
 *
 * @throws Never; missing paths and filesystem lookup failures return `null`
 */
function filesystemDirectoryIdentity(
  directoryPath: string,
): FilesystemDirectoryIdentity | null {
  try {
    const stats = statSync(directoryPath, { bigint: true });
    // Without a real directory ID, aliases cannot safely prove that two selected paths name the same folder.
    if (!stats.isDirectory() || stats.ino === 0n) return null;
    return { device: stats.dev, inode: stats.ino };
  } catch {
    // A removed folder or permission failure leaves directory identity unknown.
    return null;
  }
}

/**
 * Check whether two path spellings name the same selected project or scan folder.
 * The platform path resolver and physical IDs account for aliases such as Windows short paths.
 *
 * @param leftDirectory - first physical directory spelling; empty cannot name a useful root
 * @param rightDirectory - second physical directory spelling; empty cannot name a useful root
 *
 * @param relativePath - platform-native relative-path implementation used for equivalence
 * @param directoryIdentity - physical identity fallback for aliases such as Windows short paths
 *
 * @returns true only when both spellings are identical under the selected path semantics
 */
export function filesystemPathsAreEquivalent(
  leftDirectory: string,
  rightDirectory: string,
  relativePath: RelativePathResolver = relative,
  directoryIdentity: DirectoryIdentityResolver = filesystemDirectoryIdentity,
): boolean {
  // An empty path cannot establish that the user's selected folder matches a Git root.
  if (leftDirectory.length === 0 || rightDirectory.length === 0) return false;
  const spellingsMatch =
    relativePath(leftDirectory, rightDirectory) === "" &&
    relativePath(rightDirectory, leftDirectory) === "";
  // Matching physical spellings already establish that both paths identify the same scan folder.
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
  // Missing Git, a timeout or a non-repository folder supplies no proven scan root.
  if (result.error || result.status !== 0 || result.stdout.trim() === "") {
    return null;
  }
  return physicalDirectory(result.stdout.trim());
}

/**
 * Detect a scan path outside its selected root before post-turn registration can include another project.
 */
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
  // A configured relative folder must stay beneath the project selected in the dashboard.
  if (relativePathEscapesRoot(lexicalRelative)) return null;
  const physicalCandidate = physicalDirectory(lexicalCandidate);
  // A missing or unreadable scan folder needs repair before registration.
  if (physicalCandidate === null) return null;
  const physicalRelative = relative(projectRoot, physicalCandidate);
  // A linked folder outside the project cannot become an implicit post-turn scan target.
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
  // Only post-turn safety uses scan-root status; other hook rows have no root requirement.
  if (spec.id !== "post-turn-safety") return null;
  const projectRoot = physicalDirectory(resolve(projectPath));
  // The selected project must still exist before its post-turn hook can be registered.
  if (projectRoot === null) {
    return {
      status: "invalid",
      roots: [],
      issue: "Selected project is not an existing directory.",
    };
  }
  // A project that is itself a Git worktree can scan its own root without extra folder settings.
  if (
    filesystemPathsAreEquivalent(gitTopLevel(projectRoot) ?? "", projectRoot)
  ) {
    return { status: "implicit", roots: ["."], issue: null };
  }
  const configuredRoots = readHookScanRoots(projectPath, spec.id);
  // A non-Git workspace needs the user to select its child Git repositories explicitly.
  if (configuredRoots === null) {
    return {
      status: "missing",
      roots: [],
      issue: "A non-Git workspace requires explicit post-turn scan roots.",
    };
  }
  // js-yaml has already resolved any anchor or alias here, but the hook's own parser cannot: at Stop time such a config reads as no roots and fails
  // closed with a misleading message. Refuse it now, while the user is looking at the Hooks page or the sync output.
  if (hookScanRootsUseYamlAliases(projectPath)) {
    return {
      status: "invalid",
      roots: configuredRoots,
      issue:
        "Post-turn scan roots cannot use YAML anchors or aliases; write the list out in full.",
    };
  }
  return explicitScanRootState(projectRoot, configuredRoots);
}

/**
 * Check every explicit post-turn root against the selected project: each must stay inside it and be a Git repository.
 * The first failing root names the problem so the user can fix that one line of config.
 *
 * @param projectRoot - physical directory of the selected project; roots are resolved relative to it
 *
 * @param configuredRoots - the user's explicit `scan-roots` list, already free of YAML aliases
 * @returns `configured` with the same list when every root passes, else `invalid` naming the first bad root
 */
function explicitScanRootState(
  projectRoot: string,
  configuredRoots: string[],
): HookScanRootState {
  // Every configured repository must qualify before the post-turn hook can cover the chosen workspace.
  for (const configuredRoot of configuredRoots) {
    const physicalRoot = containedScanRoot(projectRoot, configuredRoot);
    // Show the first missing or escaping folder so the user can correct its config entry.
    if (physicalRoot === null) {
      return {
        status: "invalid",
        roots: configuredRoots,
        issue: `Configured scan root is missing or escapes the selected project: ${configuredRoot}`,
      };
    }
    // A contained folder still needs to be its own Git repository to qualify as a scan root.
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

/** Remove the retired plan-guard ignore entry from the prepared file while retaining user rules. */
function removeGoatFlowGitignoreEntry(change: PreparedHookChange): void {
  const path = ".goat-flow/.gitignore";
  const original = change.readText(path);
  // A fresh project has no retired ignore rule and needs no cleanup write.
  if (original === null) return;
  const hadFinalNewline = original.endsWith("\n");
  const lines = original.split(/\r?\n/u);
  // The final newline is formatting, not an extra retained rule.
  if (hadFinalNewline) lines.pop();
  const retained = lines.filter(
    (line) => line !== "logs/plan-guard-state.json",
  );
  // Preserve exact bytes when the user has no obsolete rule.
  if (retained.length === lines.length) return;
  change.replaceText(
    path,
    `${retained.join("\n")}${hadFinalNewline ? "\n" : ""}`,
  );
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
 * Combine provider support and local evidence into the hook state, label and next repair shown to the user.
 * Provider exclusions take precedence so the page does not offer local repairs for coverage the provider cannot deliver.
 *
 * @param projectPath - selected project, used to check local proof of provider support
 * @param agent - agent whose hook state is being resolved
 *
 * @param spec - hook being resolved, supplying its provider evidence
 * @param facts - the observed hook facts; `doesProviderExclusionOwnState` defaults to false. When the provider excludes the hook, that exclusion owns
 *
 * the state and the local facts count as satisfied, so the user is shown "the provider does not support this" instead of a repair they cannot
 * perform.
 *
 * @returns the effective state, its label, evidence identity, and the repair the user should run; the identity is null when the provider is
 * undocumented
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
    // A pristine older copy can be advanced by bundled Sync.
    if (installationFacts.changeDirection === "behind") {
      return "installed-version-behind";
    }
    // Local byte changes require review before the user replaces the installed hook.
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
 *
 * @param installed - whether the file is really present and registered
 * @returns the drift direction, or `undefined` when the two agree and nothing needs repairing
 */
function hookDrift(
  shouldBeEnabled: boolean,
  installed: boolean,
): HookDrift | undefined {
  // The user enabled this hook, but its installed state does not yet provide that coverage.
  if (shouldBeEnabled && !installed) return "desired-on-actual-off";
  // An installed registration can still run even though the user asked for the hook to be disabled.
  if (!shouldBeEnabled && installed) return "desired-off-actual-on";
  return undefined;
}

/**
 * Resolve local trust, installed-file drift, script path, and the first repair reason.
 * Use once per supported agent so every Hooks UI presents the same local diagnosis.
 *
 * @param projectPath - selected project whose hook files and config supply the displayed repair diagnosis
 * @param agent - selected provider; null config or hook paths remain untrusted or absent
 *
 * @param spec - managed hook contract; empty script metadata cannot produce a path
 * @param registrationState - parsed config state; empty issue flags mean registration is healthy
 *
 * @param isRegistered - false keeps installed-file issues behind registration repair
 * @param installationFacts - managed file facts; false values identify missing, stale, or unsafe files
 *
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
  }
  // Explain a specific registration mismatch before less precise file-level repair guidance.
  else if (registrationState.registrationIssue !== undefined) {
    repairReason = registrationIssueReason(registrationState.registrationIssue);
  }
  // Invalid JSON prevents the user from relying on any saved registration.
  else if (registrationState.configInvalid) {
    repairReason = "Hook config file is invalid JSON.";
  }
  // A missing provider config needs creation or synchronization before the hook can run.
  else if (registrationState.configMissing) {
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
  // A disabled hook or valid root selection needs no scan-folder repair prompt.
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
  // Known pristine history lets the page explain that a bundled refresh is safe.
  if (installationIssue === "installed-version-behind") {
    effectivePresentation.repairSummary =
      "Installed bytes still match the previous-install baseline, so sync safely advances the managed files to this registry version.";
    return;
  }
  // Local edits need an explicit replacement review, so do not offer a command that implies unconditional repair.
  if (installationIssue === "installed-content-diverged") {
    effectivePresentation.repairCommand = null;
    effectivePresentation.repairSummary = `A sync would overwrite local content at ${changedPaths}; it pauses for your review and explicit replacement approval on the Hooks page. Save wanted edits first.`;
    return;
  }
  // Without matching history, differing bytes need review even though their origin is unknown.
  if (installationIssue === "installed-version-unclassified") {
    effectivePresentation.repairCommand = null;
    effectivePresentation.repairSummary = `No matching previous-install baseline proves the drift direction at ${changedPaths}; Sync pauses for your review before replacing differing local bytes.`;
  }
}

/** Choose the root-contract issue before a generic installation repair reason. */
function supportedHookReason(
  isDesiredByUser: boolean,
  scanRootState: HookScanRootState | null,
  installationReason: string | null,
): string | null {
  // An enabled post-turn hook's invalid scan folders take precedence over generic install guidance.
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
  inspection: ManagedHookInspection,
): HookAgentState {
  const registrationState = readAgentHookState(projectPath, agent, spec);
  const installationFacts = managedHookInstallationFacts(
    projectPath,
    agent,
    spec,
    inspection,
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
  inspection: ManagedHookInspection,
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
    inspection,
  );
}

/** Read persisted desired hook state, falling back to the registry default. */
function readDesired(projectPath: string, spec: HookSpec): boolean {
  return readHookEnabled(projectPath, spec.id, spec.defaultEnabled);
}

/** Compose one provider's registration change from captured JSON, keeping unrelated user commands. */
function prepareHookRegistration(
  change: PreparedHookChange,
  agent: AgentProfile,
  spec: HookSpec,
  isEnabled: boolean,
): void {
  // Profiles without a hook config cannot store a registration.
  if (!agent.hookConfigFile) return;
  const text = change.readText(agent.hookConfigFile);
  change.replaceText(
    agent.hookConfigFile,
    prepareAgentHookState(text, agent, spec, isEnabled),
    0,
  );
}

/** Prepare one hook without registering a Stop command against incomplete scan-root coverage. */
function reconcileHook(
  change: PreparedHookChange,
  spec: HookSpec,
  isEnabled: boolean,
): void {
  const profiles = getAgentProfiles();
  const rootsPermitRegistration = scanRootsPermitRegistration(
    postTurnScanRootState(change.projectPath, spec),
  );
  // Each provider needs its own config shape, while shared hook files are deduplicated by the operation.
  for (const agent of profiles.filter(isSupportedAgent)) {
    // A provider without a hook config cannot receive registrations.
    if (!agent.hookConfigFile) continue;
    const configExists = change.readText(agent.hookConfigFile) !== null;
    // A provider excluded by this hook still needs its old owned registration removed.
    if (unsupportedReasonForSpec(spec, agent)) {
      // Remove an unsupported registration only from existing config; do not scaffold an unused provider.
      if (configExists) prepareHookRegistration(change, agent, spec, false);
      continue;
    }
    // A provider that is absent from the selected project must not be silently installed by Sync.
    if (!shouldReconcileAgent(change.projectPath, agent, spec, profiles))
      continue;
    const desired = deriveManagedHookDesiredState(agent, spec, isEnabled);
    const shouldRegister =
      desired.registrationTargets.length > 0 && rootsPermitRegistration;
    // Disabled hooks fill missing inert files but preserve every existing disabled-only byte.
    if (desired.managedScriptFiles.length > 0)
      copyHookScripts(change, agent, spec, isEnabled);
    // Disabling edits an existing config only; enabling may create the provider's missing hook config.
    if (shouldRegister || configExists)
      prepareHookRegistration(change, agent, spec, shouldRegister);
  }
}

/** Prepare exact tombstone cleanup before any config, registration, or script can be changed. */
function pruneRemovedHookTombstones(change: PreparedHookChange): void {
  // Every removed hook contributes exact owned files and registrations to the complete admission set.
  for (const spec of REMOVED_HOOK_TOMBSTONES) {
    // Check each provider for exact retired hook state left by an earlier installation.
    for (const agent of getAgentProfiles()) {
      // An existing supported config can lose its retired managed row while preserving user commands.
      if (
        isSupportedAgent(agent) &&
        agent.hookConfigFile &&
        change.readText(agent.hookConfigFile) !== null
      ) {
        prepareHookRegistration(change, agent, spec, false);
      }
      // Only profiles with a hook directory can own retired script cleanup.
      if (agent.hooksDir) removeHookScripts(change, agent, spec);
    }
  }
  removeGoatFlowGitignoreEntry(change);
}

/** Snapshot one hook across all known agents for dashboard and CLI consumers. */
function readHookState(
  hookId: string,
  projectPath: string,
  inspection: ManagedHookInspection = createManagedHookInspection(projectPath),
): HookState {
  const spec = resolveSpec(hookId);
  const enabled = readDesired(projectPath, spec);
  const scanRoots = postTurnScanRootState(projectPath, spec);
  const agents = Object.fromEntries(
    getAgentProfiles().map((agent) => [
      agent.id,
      agentHookState(projectPath, agent, spec, enabled, scanRoots, inspection),
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

/**
 * Read saved choices, registrations, files and available proof for every hook in the selected project.
 * Use after Sync or a toggle so shared dependencies refresh all affected rows.
 *
 * @param projectPath - selected project whose current hook state is read
 * @returns all registry hook rows; unavailable provider evidence remains visible in each row
 */
export function readAllHookStates(projectPath: string): HookState[] {
  const inspection = createManagedHookInspection(projectPath);
  return listHookSpecs().map((spec) =>
    readHookState(spec.id, projectPath, inspection),
  );
}

/** Keep Git protection registered before Sync can replace an older combined guard with separate policies. */
function prepareGitProtection(
  change: PreparedHookChange,
  gitSpec: HookSpec,
): void {
  const profiles = getAgentProfiles();
  // Only providers already present in the selected project receive this preparatory registration.
  for (const agent of profiles) {
    // Install separate Git protection only for supported providers already present in this project.
    if (
      isSupportedAgent(agent) &&
      !unsupportedReasonForSpec(gitSpec, agent) &&
      shouldReconcileAgent(change.projectPath, agent, gitSpec, profiles)
    ) {
      prepareHookRegistration(change, agent, gitSpec, true);
    }
  }
}

/**
 * Prepare the complete Sync or toggle result before any destination mutation.
 *
 * @param projectPath - project selected by the CLI or Hooks page
 * @param intent - requested action; toggles preserve the inherited Git choice before changing its sibling
 *
 * @returns captured, deduplicated operation with prepared provider configs and official files
 * @throws when captured state cannot safely produce the requested change
 */
function prepareHookChange(
  projectPath: string,
  intent: HookChangeIntent,
): PreparedHookChange {
  const change = new PreparedHookChange(projectPath, intent);
  const configPath = ".goat-flow/config.yaml";
  const config = prepareHookConfig(
    change.readText(configPath),
    change.projectPath,
    intent.kind === "toggle" ? intent : undefined,
    REMOVED_HOOK_TOMBSTONES.map((spec) => spec.id),
  );
  change.replaceText(configPath, config);
  const configuredChoices = readConfiguredHookChoices(config);
  /** Read the prepared enabled choice so Sync preserves saved settings and a toggle changes only its selected hook. */
  const desiredChoice = (spec: HookSpec): boolean =>
    configuredChoices[spec.id]?.enabled ?? spec.defaultEnabled;
  pruneRemovedHookTombstones(change);
  const gitSpec = resolveSpec("deny-git-mutations");
  // Register enabled Git protection before narrower policy bytes can replace an older combined guard.
  if (
    desiredChoice(gitSpec) &&
    (intent.kind === "sync" ||
      intent.hookId === "deny-dangerous" ||
      intent.hookId === "deny-git-mutations")
  ) {
    prepareGitProtection(change, gitSpec);
  }
  // Global Sync preserves every saved choice and refreshes all installed supported surfaces.
  if (intent.kind === "sync") {
    // Global Sync reconciles every toggle using its saved or inherited enabled choice.
    for (const spec of listHookSpecs().filter((spec) => spec.togglable))
      reconcileHook(change, spec, desiredChoice(spec));
  } else {
    const spec = resolveSpec(intent.hookId);
    // The dangerous-command toggle can also repair shared files required by enabled Git protection.
    if (spec.id === "deny-dangerous" && desiredChoice(gitSpec))
      reconcileHook(change, gitSpec, true);
    reconcileHook(change, spec, intent.enabled);
  }
  return change;
}

/**
 * Apply a user toggle after complete admission and any exact replacement confirmation.
 *
 * @param hookId - registry hook selected by the user; unknown or fixed hooks refuse the action
 * @param isEnabled - explicit desired choice to persist
 *
 * @param projectPath - selected project's hook files and settings
 * @param confirmation - reviewed replacement intent; omitted for ordinary safe toggles
 *
 * @returns refreshed state for the selected hook; shared rows are available through readAllHookStates
 * @throws HookRegistrarError for unsafe state, a replacement conflict, or a reported partial apply
 */
export function applyHookState(
  hookId: string,
  isEnabled: boolean,
  projectPath: string,
  confirmation?: HookReplacementConfirmation,
): HookState {
  const spec = resolveSpec(hookId);
  // Fixed registry entries cannot acquire toggle authority through a crafted request.
  if (!spec.togglable)
    throw new HookRegistrarError(`Hook is not togglable: ${hookId}`, 400);
  executeHookChange(
    () =>
      prepareHookChange(projectPath, {
        kind: "toggle",
        hookId,
        enabled: isEnabled,
      }),
    confirmation,
  );
  return readHookState(spec.id, projectPath);
}

/**
 * Sync installed hooks with the running CLI's bundle while retaining every persisted choice.
 *
 * @param projectPath - selected project; unsafe paths or invalid history refuse before destination writes
 * @param confirmation - exact replacement approval; absent means differing unknown or diverged files refuse
 *
 * @returns all hook rows after files and canonical hook history are verified
 * @throws HookRegistrarError for a refusal, stale review, partial apply, or failed claim release
 */
export function syncHookStates(
  projectPath: string,
  confirmation?: HookReplacementConfirmation,
): HookState[] {
  executeHookChange(
    () => prepareHookChange(projectPath, { kind: "sync" }),
    confirmation,
  );
  return readAllHookStates(projectPath);
}
