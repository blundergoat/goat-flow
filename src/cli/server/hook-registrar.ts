/**
 * Registrar that reconciles `.goat-flow/config.yaml` hook truth to detected
 * hook-capable agent surfaces in the selected project.
 */
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { getAgentProfiles } from "../agents/registry.js";
import {
  readHookEnabled,
  removeHookConfig,
  removeTopLevelConfigBlock,
  setHookEnabled,
} from "../config/writer.js";
import { getTemplatePath } from "../paths.js";
import { AUDIT_VERSION } from "../constants.js";
import {
  classifyHookEffectiveState,
  type HookEffectiveState,
  type HookEffectiveStateFacts,
} from "../hook-contracts.js";
import { projectIsAheadOfCli } from "../version-compare.js";
import type { AgentId, AgentProfile } from "../types.js";
import {
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
import { writeFileAtomic } from "./safe-exec.js";

const DENY_DANGEROUS_POLICY_FILES = [
  "patterns-shell.sh",
  "patterns-paths.sh",
  "patterns-writes.sh",
  "deny-dangerous-self-test.sh",
];
const LEGACY_AGENT_HOOK_DIRS = [
  ".claude/hooks",
  ".codex/hooks",
  ".agents/hooks",
  ".github/hooks",
];
const LEGACY_DENY_DANGEROUS_SCRIPT_NAMES = [
  "guard-common.sh",
  "guard-destructive-shell.sh",
  "guard-secret-paths.sh",
  "guard-repository-writes.sh",
  "guardrails-self-test.sh",
  "deny-dangerous.self-test.sh",
];
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

/** HTTP-safe hook registrar failure with the status code routes should return. */
class HookRegistrarError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "HookRegistrarError";
  }
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

/** Managed file facts kept separate so the UI can name presence, version, and trust gaps. */
interface ManagedHookInstallationFacts {
  doAllFilesExist: boolean;
  areAllFilesCurrent: boolean;
  areAllFilesTrusted: boolean;
}

/** One installed managed file and the bundled source it must match. */
interface ManagedHookFileContract {
  installedPath: string;
  templatePath: string;
}

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

function unsupportedReasonForSpec(
  spec: HookSpec,
  agent: AgentProfile,
): string | null {
  return spec.unsupportedAgents?.[agent.id] ?? null;
}

/** Block hook script writes that would escape the selected project root; throws a 400 registrar error. */
function assertWithinProject(projectPath: string, targetPath: string): void {
  const root = resolve(projectPath);
  const target = resolve(targetPath);
  const fromRoot = relative(root, target);
  if (
    fromRoot === "" ||
    (fromRoot !== ".." &&
      !fromRoot.startsWith(`..${String.fromCharCode(47)}`) &&
      !fromRoot.startsWith(`..${String.fromCharCode(92)}`) &&
      !isAbsolute(fromRoot))
  ) {
    return;
  }
  throw new HookRegistrarError("Refusing to write outside project path", 400);
}

function scriptTarget(
  projectPath: string,
  agent: AgentProfile,
  script: string,
) {
  // A profile without a hook folder cannot produce a runnable path for the user.
  if (!agent.hooksDir) throw new Error(`${agent.id} has no hooks dir`);
  const target = join(projectPath, agent.hooksDir, script);
  assertWithinProject(projectPath, target);
  return target;
}

/** List installed files and bundled sources that make one hook version complete. */
function managedHookFileContracts(
  projectPath: string,
  agent: AgentProfile,
  spec: HookSpec,
): ManagedHookFileContract[] {
  const managedFiles = spec.scriptFiles.map((scriptFileName) => ({
    installedPath: scriptTarget(projectPath, agent, scriptFileName),
    templatePath: getTemplatePath(`workflow/hooks/${scriptFileName}`),
  }));

  // The deny dispatcher also depends on policy files outside the shared agent script list.
  if (spec.id === "deny-dangerous") {
    // Each policy file must match the bundled rule set before users see a current install.
    for (const policyFileName of DENY_DANGEROUS_POLICY_FILES) {
      managedFiles.push({
        installedPath: join(
          projectPath,
          ".goat-flow",
          "hooks",
          "deny-dangerous",
          policyFileName,
        ),
        templatePath: getTemplatePath(
          `workflow/hooks/deny-dangerous/${policyFileName}`,
        ),
      });
    }
  }

  return managedFiles;
}

/** Confirm a managed file and every path segment use the regular-file trust shape the launcher enforces. */
function managedFileIsTrusted(
  projectPath: string,
  managedFilePath: string,
): boolean {
  const absoluteProjectPath = resolve(projectPath);
  const absoluteManagedFilePath = resolve(managedFilePath);
  const pathFromProject = relative(
    absoluteProjectPath,
    absoluteManagedFilePath,
  );

  // A path outside the selected project can never become trusted hook code or configuration.
  if (
    pathFromProject === "" ||
    pathFromProject === ".." ||
    pathFromProject.startsWith(`..${String.fromCharCode(47)}`) ||
    pathFromProject.startsWith(`..${String.fromCharCode(92)}`) ||
    isAbsolute(pathFromProject)
  ) {
    return false;
  }

  try {
    const projectDirectoryEntry = lstatSync(absoluteProjectPath);
    // A redirected or non-directory project root cannot safely own the hook the user selected.
    if (
      projectDirectoryEntry.isSymbolicLink() ||
      !projectDirectoryEntry.isDirectory()
    ) {
      return false;
    }

    const managedPathParts = pathFromProject.split(/[\\/]+/u);
    let inspectedPath = absoluteProjectPath;
    // Every parent directory must be real so a later path segment cannot escape through a symlink.
    for (const [pathPartIndex, managedPathPart] of managedPathParts.entries()) {
      inspectedPath = join(inspectedPath, managedPathPart);
      const inspectedEntry = lstatSync(inspectedPath);
      const isFinalPathPart = pathPartIndex === managedPathParts.length - 1;
      // Symlinked path segments can redirect execution away from the managed checkout.
      if (inspectedEntry.isSymbolicLink()) return false;
      // Parent path segments must stay directories until the final managed file.
      if (!isFinalPathPart && !inspectedEntry.isDirectory()) return false;
      // The executable or config itself must be one regular, unshared file.
      if (
        isFinalPathPart &&
        (!inspectedEntry.isFile() || inspectedEntry.nlink !== 1)
      ) {
        return false;
      }
    }

    const physicalManagedFilePath = realpathSync(absoluteManagedFilePath);
    const physicalPathFromProject = relative(
      realpathSync(absoluteProjectPath),
      physicalManagedFilePath,
    );
    // Physical containment catches redirected filesystem paths the lexical check could not see.
    if (
      physicalPathFromProject === "" ||
      physicalPathFromProject === ".." ||
      physicalPathFromProject.startsWith(`..${String.fromCharCode(47)}`) ||
      physicalPathFromProject.startsWith(`..${String.fromCharCode(92)}`) ||
      isAbsolute(physicalPathFromProject)
    ) {
      return false;
    }
    return true;
  } catch {
    // For example, the user may have removed a hook file while the status screen was loading.
    return false;
  }
}

/** Read all managed hook files once and classify the install users can actually run. */
function managedHookInstallationFacts(
  projectPath: string,
  agent: AgentProfile,
  spec: HookSpec,
): ManagedHookInstallationFacts {
  const managedFiles = managedHookFileContracts(projectPath, agent, spec);
  const doAllFilesExist = managedFiles.every((managedFile) =>
    existsSync(managedFile.installedPath),
  );
  const areAllFilesCurrent =
    doAllFilesExist &&
    managedFiles.every((managedFile) => {
      try {
        return (
          readFileSync(managedFile.installedPath, "utf-8") ===
          readFileSync(managedFile.templatePath, "utf-8")
        );
      } catch {
        // For example, a file can become unreadable after the user opens the Hooks screen.
        return false;
      }
    });
  const areAllFilesTrusted =
    doAllFilesExist &&
    managedFiles.every((managedFile) =>
      managedFileIsTrusted(projectPath, managedFile.installedPath),
    );
  return {
    doAllFilesExist,
    areAllFilesCurrent,
    areAllFilesTrusted,
  };
}

type AgentProfilePathKey =
  | "instructionFile"
  | "skillsDir"
  | "settingsFile"
  | "hookConfigFile"
  | "hooksDir";

function profilePathIsUnique(
  profiles: AgentProfile[],
  key: AgentProfilePathKey,
  path: string | null,
): boolean {
  if (!path) return false;
  return profiles.filter((profile) => profile[key] === path).length === 1;
}

function agentInstalledSurfaceExists(
  projectPath: string,
  agent: AgentProfile,
  profiles: AgentProfile[],
): boolean {
  const uniqueOptionalMarkers = [
    profilePathIsUnique(profiles, "instructionFile", agent.instructionFile)
      ? agent.instructionFile
      : null,
    profilePathIsUnique(profiles, "skillsDir", agent.skillsDir)
      ? agent.skillsDir
      : null,
  ];
  const markers = [
    agent.settingsFile,
    agent.hookConfigFile,
    profilePathIsUnique(profiles, "hooksDir", agent.hooksDir)
      ? agent.hooksDir
      : null,
    ...uniqueOptionalMarkers,
  ].filter((marker): marker is string => typeof marker === "string");
  return markers.some((marker) => existsSync(join(projectPath, marker)));
}

function hookScriptResidueExists(
  projectPath: string,
  agent: AgentProfile,
  spec: HookSpec,
  profiles: AgentProfile[],
): boolean {
  const scriptFiles =
    spec.id === "deny-dangerous"
      ? [...spec.scriptFiles, ...LEGACY_DENY_DANGEROUS_SCRIPT_NAMES]
      : spec.scriptFiles;
  if (
    agent.hooksDir &&
    profilePathIsUnique(profiles, "hooksDir", agent.hooksDir) &&
    scriptFiles.some((script) =>
      existsSync(scriptTarget(projectPath, agent, script)),
    )
  ) {
    return true;
  }
  return LEGACY_AGENT_HOOK_DIRS.some((hooksDir) =>
    scriptFiles.some((script) =>
      existsSync(join(projectPath, hooksDir, script)),
    ),
  );
}

function shouldReconcileAgent(
  projectPath: string,
  agent: AgentProfile,
  spec: HookSpec,
  profiles: AgentProfile[],
): boolean {
  return (
    agentInstalledSurfaceExists(projectPath, agent, profiles) ||
    hookScriptResidueExists(projectPath, agent, spec, profiles)
  );
}

/** Check for an existing hook config before writing disabled state for optional hooks. */
function hookConfigExists(projectPath: string, agent: AgentProfile): boolean {
  return (
    agent.hookConfigFile !== null &&
    existsSync(join(projectPath, agent.hookConfigFile))
  );
}

function ensureGoatFlowGitignoreEntry(
  projectPath: string,
  entry: string,
): void {
  const gitignorePath = join(projectPath, ".goat-flow", ".gitignore");
  assertWithinProject(projectPath, gitignorePath);
  mkdirSync(join(projectPath, ".goat-flow"), { recursive: true });

  const original = existsSync(gitignorePath)
    ? readFileSync(gitignorePath, "utf-8")
    : "";
  const hasFinalNewline = original.length === 0 || original.endsWith("\n");
  const lines = original.split(/\r?\n/u).filter((line, index, all) => {
    return index < all.length - 1 || line.length > 0;
  });
  if (lines.includes(entry)) return;

  const next = `${lines.join("\n")}${lines.length > 0 ? "\n" : ""}${entry}\n`;
  writeFileAtomic(
    gitignorePath,
    hasFinalNewline ? next : next.trimEnd(),
    projectPath,
  );
}

function removeGoatFlowGitignoreEntry(
  projectPath: string,
  entry: string,
): void {
  const gitignorePath = join(projectPath, ".goat-flow", ".gitignore");
  assertWithinProject(projectPath, gitignorePath);
  if (!existsSync(gitignorePath)) return;
  const original = readFileSync(gitignorePath, "utf-8");
  const hasFinalNewline = original.endsWith("\n");
  const lines = original.split(/\r?\n/u);
  if (hasFinalNewline) lines.pop();
  const nextLines = lines.filter((line) => line !== entry);
  if (nextLines.length === lines.length) return;
  const next = `${nextLines.join("\n")}${hasFinalNewline ? "\n" : ""}`;
  writeFileAtomic(gitignorePath, next, projectPath);
}

/**
 * Keep the shared `.goat-flow/hooks/deny-dangerous/` policy store tracked by Git.
 *
 * Adds both `!hooks/` and `!hooks/**` negations to `.goat-flow/.gitignore` so the
 * deny-dangerous policy modules survive a fresh clone; without them a gitignored
 * `.goat-flow/` drops the store and the guard fails closed on checkout. Idempotent -
 * each entry is appended only when absent (writes `.goat-flow/.gitignore`).
 *
 * @param projectPath - target project root whose `.goat-flow/.gitignore` is updated
 */
function ensureHookGitignoreEntries(projectPath: string): void {
  ensureGoatFlowGitignoreEntry(projectPath, "!hooks/");
  ensureGoatFlowGitignoreEntry(projectPath, "!hooks/**");
}

function removeLegacyAgentScriptIfPresent(
  projectPath: string,
  hooksDir: string,
  script: string,
): void {
  const target = join(projectPath, hooksDir, script);
  assertWithinProject(projectPath, target);
  try {
    unlinkSync(target);
  } catch {
    /* target already gone - stale script pruning is idempotent */
  }
}

function removeLegacyAgentHookScripts(
  projectPath: string,
  spec: HookSpec,
): void {
  for (const hooksDir of LEGACY_AGENT_HOOK_DIRS) {
    for (const script of spec.scriptFiles) {
      removeLegacyAgentScriptIfPresent(projectPath, hooksDir, script);
    }
    if (spec.id === "deny-dangerous") {
      for (const script of LEGACY_DENY_DANGEROUS_SCRIPT_NAMES) {
        removeLegacyAgentScriptIfPresent(projectPath, hooksDir, script);
      }
    }
  }
}

/**
 * Read a managed hook script from the workflow template tree.
 * Use when enabling a hook so the selected project receives the same script the dashboard describes.
 *
 * @param script - managed script path under `workflow/hooks`; empty cannot resolve to an installable hook
 * @returns script contents written into the user's project
 */
function hookScriptContent(script: string): string {
  return readFileSync(getTemplatePath(`workflow/hooks/${script}`), "utf-8");
}

/**
 * Report whether an installed hook script is stamped newer than this CLI's bundled copy.
 * Guards the guardrail layer: `hooks sync` rewrites installed files from the running CLI's bundle, so an
 * older CLI run against a newer install would silently replace current deny/safety hooks with its own
 * stale copies.
 *
 * This never throws. A target that is missing, unreadable, or carries no version stamp is
 * reported as "not newer", so a first install or a repair still goes ahead for the user.
 *
 * @param target - absolute path of the installed hook script about to be overwritten
 * @returns true when the installed script is ahead of this CLI and must be left alone; false
 *   also covers "cannot tell", so the caller proceeds with the sync
 */
function installedHookIsNewer(target: string): boolean {
  // Nothing installed there yet, so this is a first install with no user work to protect.
  if (!existsSync(target)) return false;

  let installed: string;
  try {
    installed = readFileSync(target, "utf-8");
  } catch {
    // e.g. the user pointed the CLI at a project checkout they do not own, so the hook is
    // present but cannot be opened. Treat it as unknown rather than blocking their sync.
    return false;
  }

  const stamped = installed.match(
    /goat-flow-hook-version:\s*([0-9]+\.[0-9]+\.[0-9]+)/,
  );

  // A hand-written or pre-stamp hook carries no version, so we cannot claim it is newer.
  if (!stamped?.[1]) return false;

  return projectIsAheadOfCli(stamped[1], AUDIT_VERSION);
}

function copyHookScripts(
  projectPath: string,
  agent: AgentProfile,
  spec: HookSpec,
): void {
  if (!agent.hooksDir) return;
  mkdirSync(join(projectPath, agent.hooksDir), { recursive: true });
  for (const script of spec.scriptFiles) {
    const target = scriptTarget(projectPath, agent, script);
    if (installedHookIsNewer(target)) {
      throw new HookRegistrarError(
        `Refusing to overwrite ${script}: the installed hook is newer than this CLI (${AUDIT_VERSION}). Re-run with a matching goat-flow release instead of downgrading the guardrail.`,
        409,
      );
    }
    writeFileAtomic(target, hookScriptContent(script), projectPath);
    chmodSync(target, 0o755);
  }
  ensureHookGitignoreEntries(projectPath);
  if (spec.id === "deny-dangerous") {
    const targetDir = join(
      projectPath,
      ".goat-flow",
      "hooks",
      "deny-dangerous",
    );
    mkdirSync(targetDir, { recursive: true });
    for (const file of DENY_DANGEROUS_POLICY_FILES) {
      const source = getTemplatePath(`workflow/hooks/deny-dangerous/${file}`);
      const target = join(targetDir, file);
      assertWithinProject(projectPath, target);
      writeFileAtomic(target, readFileSync(source, "utf-8"), projectPath);
      chmodSync(target, 0o755);
    }
    for (const script of LEGACY_DENY_DANGEROUS_SCRIPT_NAMES) {
      removeScriptIfPresent(projectPath, agent, script);
    }
  }
  removeLegacyAgentHookScripts(projectPath, spec);
}

function removeScriptIfPresent(
  projectPath: string,
  agent: AgentProfile,
  script: string,
): void {
  const target = scriptTarget(projectPath, agent, script);
  try {
    unlinkSync(target);
  } catch {
    /* target already gone - script removal is idempotent, missing file is fine */
  }
}

function removeHookScripts(
  projectPath: string,
  agent: AgentProfile,
  spec: HookSpec,
): void {
  removeScriptIfPresent(projectPath, agent, spec.primaryScript);
  if (spec.id === "deny-dangerous") {
    for (const script of LEGACY_DENY_DANGEROUS_SCRIPT_NAMES) {
      removeScriptIfPresent(projectPath, agent, script);
    }
  }
  removeLegacyAgentHookScripts(projectPath, spec);
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

/** Explain the next operator-controlled action for the first unmet effective-state link. */
function effectiveStateRepair(
  projectPath: string,
  agent: AgentProfile,
  spec: HookSpec,
  effectiveState: HookEffectiveState,
): { command: string | null; summary: string } {
  const quotedProjectPath = JSON.stringify(resolve(projectPath));
  switch (effectiveState.status) {
    case "disabled":
      return {
        command: null,
        summary: "The hook is intentionally disabled; enable it when this coverage is wanted.",
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

/** Combine registry evidence with the selected project's local install and trust facts. */
function effectiveAgentState(
  projectPath: string,
  agent: AgentProfile,
  spec: HookSpec,
  isDesiredByUser: boolean,
  isRegistered: boolean,
  isCurrentVersionInstalled: boolean,
  isTrusted: boolean,
): Pick<
  HookAgentState,
  | "effectiveState"
  | "effectiveStateLabel"
  | "evidenceIdentity"
  | "repairCommand"
  | "repairSummary"
> {
  const providerEvidence = spec.providerEvidence?.[agent.id];
  const effectiveSupportGate =
    providerEvidence?.effectiveSupportGate ?? "provider-undocumented";
  const effectiveStateFacts = providerGateFacts(
    isDesiredByUser,
    effectiveSupportGate,
  );
  effectiveStateFacts.isRegistered = isRegistered;
  effectiveStateFacts.isCurrentVersionInstalled = isCurrentVersionInstalled;
  effectiveStateFacts.isTrusted = isTrusted;
  const effectiveState = classifyHookEffectiveState(effectiveStateFacts);
  const repair = effectiveStateRepair(
    projectPath,
    agent,
    spec,
    effectiveState,
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
  if (!installationFacts.doAllFilesExist) return "managed-files-missing";
  // Changed bytes mean setup no longer knows which hook version the user will run.
  if (!installationFacts.areAllFilesCurrent) {
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

/** Build the state payload for an agent that cannot host the requested hook. */
function unsupportedAgentHookState(
  projectPath: string,
  agent: AgentProfile,
  spec: HookSpec,
  isDesiredByUser: boolean,
  reason: string,
): HookAgentState {
  const effectivePresentation = effectiveAgentState(
    projectPath,
    agent,
    spec,
    isDesiredByUser,
    false,
    false,
    false,
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
  const installed = isRegistered && installationFacts.doAllFilesExist;
  const isCurrentVersionInstalled =
    installed && installationFacts.areAllFilesCurrent;
  const configFilePath = agent.hookConfigFile
    ? join(projectPath, agent.hookConfigFile)
    : null;
  const isTrusted =
    installationFacts.areAllFilesTrusted &&
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
